import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Prisma,
  WhatsAppConnectionStatus,
  WhatsAppMessageStatus,
} from '@prisma/client';
import { createHmac, timingSafeEqual } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { WhatsAppBalanceService } from './whatsapp-balance.service';
import { WhatsAppConnectionService } from './whatsapp-connection.service';
import { WhatsAppTemplateStatus } from './whatsapp.constants';

const STATUS_RANK: Partial<Record<WhatsAppMessageStatus, number>> = {
  SENT: 1,
  DELIVERED: 2,
  READ: 3,
};

const META_STATUS: Record<string, WhatsAppMessageStatus> = {
  sent: WhatsAppMessageStatus.SENT,
  delivered: WhatsAppMessageStatus.DELIVERED,
  read: WhatsAppMessageStatus.READ,
  failed: WhatsAppMessageStatus.FAILED,
};

// Meta's template events, folded into the statuses we gate sending on.
const TEMPLATE_EVENT_STATUS: Record<string, string> = {
  APPROVED: WhatsAppTemplateStatus.APPROVED,
  REINSTATED: WhatsAppTemplateStatus.APPROVED,
  FLAGGED: WhatsAppTemplateStatus.APPROVED,
  PENDING: WhatsAppTemplateStatus.PENDING,
  REJECTED: WhatsAppTemplateStatus.REJECTED,
  PAUSED: WhatsAppTemplateStatus.PAUSED,
  DISABLED: WhatsAppTemplateStatus.DISABLED,
  PENDING_DELETION: WhatsAppTemplateStatus.DISABLED,
  DELETED: WhatsAppTemplateStatus.DISABLED,
};

export interface WebhookSummary {
  statuses: number;
  templates: number;
  accounts: number;
}

@Injectable()
export class WhatsAppWebhookService {
  private readonly logger = new Logger(WhatsAppWebhookService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly balance: WhatsAppBalanceService,
    private readonly connections: WhatsAppConnectionService,
  ) {}

  /** Meta's subscription handshake (GET with hub.* query params). */
  verifySubscription(
    mode: string | undefined,
    token: string | undefined,
    challenge: string | undefined,
  ): string {
    const expected = this.configService
      .get<string>('META_WHATSAPP_WEBHOOK_VERIFY_TOKEN')
      ?.trim();
    if (!expected) {
      throw new ServiceUnavailableException(
        'WhatsApp webhook is not configured',
      );
    }
    if (
      mode !== 'subscribe' ||
      !token ||
      !challenge ||
      !safeEqual(token, expected)
    ) {
      throw new ForbiddenException('Webhook verification failed');
    }
    return challenge;
  }

  async handle(
    signature: string | undefined,
    rawBody: Buffer | undefined,
  ): Promise<WebhookSummary> {
    this.verifySignature(signature, rawBody);
    let payload: unknown;
    try {
      payload = JSON.parse(rawBody!.toString('utf8'));
    } catch {
      throw new BadRequestException('Malformed webhook body');
    }

    const summary: WebhookSummary = { statuses: 0, templates: 0, accounts: 0 };
    if (!isRecord(payload) || payload.object !== 'whatsapp_business_account') {
      return summary;
    }
    for (const entry of asArray(payload.entry)) {
      if (!isRecord(entry)) continue;
      const wabaId = asString(entry.id);
      for (const change of asArray(entry.changes)) {
        if (!isRecord(change) || !isRecord(change.value)) continue;
        try {
          if (change.field === 'messages') {
            for (const status of asArray(change.value.statuses)) {
              if (isRecord(status) && (await this.applyStatus(status))) {
                summary.statuses++;
              }
            }
          } else if (
            change.field === 'message_template_status_update' &&
            wabaId
          ) {
            if (await this.applyTemplateUpdate(wabaId, change.value)) {
              summary.templates++;
            }
          } else if (change.field === 'account_update' && wabaId) {
            if (await this.applyAccountUpdate(wabaId, change.value)) {
              summary.accounts++;
            }
          }
        } catch (err) {
          // Acknowledge anyway: Meta retries non-2xx for days, and one bad
          // change must not block the rest of the batch.
          this.logger.error(
            `WhatsApp webhook change (${String(change.field)}) failed: ${(err as Error).message}`,
          );
        }
      }
    }
    return summary;
  }

  private async applyStatus(status: Record<string, unknown>): Promise<boolean> {
    const providerMessageId = asString(status.id);
    const next = META_STATUS[asString(status.status) ?? ''];
    if (!providerMessageId || !next) return false;

    const message = await this.prisma.whatsAppMessage.findUnique({
      where: { providerMessageId },
      select: { id: true, storeId: true, status: true, rawPayload: true },
    });
    if (!message || message.status === WhatsAppMessageStatus.FAILED) {
      return false;
    }

    const at = timestampOf(status.timestamp);
    const currentRank = STATUS_RANK[message.status] ?? 0;
    const raw = {
      ...(isRecord(message.rawPayload) ? message.rawPayload : {}),
      [next.toLowerCase()]: status,
    } as Prisma.InputJsonValue;

    if (next === WhatsAppMessageStatus.FAILED) {
      // A "failed" after delivery/read is noise; never take back a delivery.
      if (currentRank >= 2) return false;
      const first = asArray(status.errors)[0];
      const error = isRecord(first) ? first : {};
      await this.prisma.whatsAppMessage.update({
        where: { id: message.id },
        data: {
          status: WhatsAppMessageStatus.FAILED,
          failedAt: at,
          errorCode:
            typeof error.code === 'number' || typeof error.code === 'string'
              ? String(error.code)
              : 'UNKNOWN',
          errorMessage:
            asString(
              isRecord(error.error_data) ? error.error_data.details : null,
            ) ??
            asString(error.message) ??
            asString(error.title),
          rawPayload: raw,
        },
      });
      await this.balance.refundMessage(message.storeId, message.id);
      return true;
    }

    // Webhooks can arrive out of order: keep the furthest status, but still
    // record when each step happened.
    const nextRank = STATUS_RANK[next] ?? 0;
    await this.prisma.whatsAppMessage.update({
      where: { id: message.id },
      data: {
        ...(nextRank > currentRank ? { status: next } : {}),
        ...timestampField(next, at),
        rawPayload: raw,
      },
    });
    return true;
  }

  private async applyTemplateUpdate(
    wabaId: string,
    value: Record<string, unknown>,
  ): Promise<boolean> {
    const status = TEMPLATE_EVENT_STATUS[asString(value.event) ?? ''];
    const name = asString(value.message_template_name);
    const language = asString(value.message_template_language);
    const metaTemplateId =
      asString(value.message_template_id) ??
      (typeof value.message_template_id === 'number'
        ? String(value.message_template_id)
        : null);
    if (!status || !name || !language) return false;

    const stores = await this.prisma.whatsAppConnection.findMany({
      where: { wabaId },
      select: { storeId: true },
    });
    if (stores.length === 0) return false;

    const reason = asString(value.reason);
    const { count } = await this.prisma.whatsAppTemplate.updateMany({
      where: {
        storeId: { in: stores.map((s) => s.storeId) },
        name,
        language,
      },
      data: {
        status,
        rejectedReason:
          status === WhatsAppTemplateStatus.REJECTED && reason !== 'NONE'
            ? reason
            : null,
        ...(metaTemplateId ? { metaTemplateId } : {}),
      },
    });
    return count > 0;
  }

  private async applyAccountUpdate(
    wabaId: string,
    value: Record<string, unknown>,
  ): Promise<boolean> {
    const event = asString(value.event);
    if (event !== 'PARTNER_REMOVED' && event !== 'ACCOUNT_DELETED') {
      return false;
    }
    const active = await this.prisma.whatsAppConnection.findMany({
      where: { wabaId, status: WhatsAppConnectionStatus.ACTIVE },
      select: { storeId: true },
    });
    for (const row of active) {
      await this.connections.markReauthRequired(
        row.storeId,
        new Error(`Meta reported ${event} for this WhatsApp account`),
      );
    }
    return active.length > 0;
  }

  private verifySignature(
    signature: string | undefined,
    rawBody: Buffer | undefined,
  ): void {
    const secret = this.configService.get<string>('META_APP_SECRET')?.trim();
    if (!secret) {
      throw new ServiceUnavailableException(
        'WhatsApp webhook is not configured',
      );
    }
    if (!signature || !rawBody) {
      throw new UnauthorizedException('Missing WhatsApp webhook signature');
    }
    const expected = `sha256=${createHmac('sha256', secret)
      .update(rawBody)
      .digest('hex')}`;
    if (!safeEqual(signature, expected)) {
      throw new UnauthorizedException('Invalid WhatsApp webhook signature');
    }
  }
}

function timestampField(
  status: WhatsAppMessageStatus,
  at: Date,
): Prisma.WhatsAppMessageUpdateInput {
  if (status === WhatsAppMessageStatus.SENT) return { sentAt: at };
  if (status === WhatsAppMessageStatus.DELIVERED) return { deliveredAt: at };
  if (status === WhatsAppMessageStatus.READ) return { readAt: at };
  return {};
}

function timestampOf(value: unknown): Date {
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds > 0
    ? new Date(seconds * 1000)
    : new Date();
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
