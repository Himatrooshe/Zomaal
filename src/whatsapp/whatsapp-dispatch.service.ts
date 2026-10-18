import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Prisma,
  WhatsAppConnectionStatus,
  WhatsAppMessageStatus,
  type WhatsAppMessage,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  MetaGraphError,
  MetaWhatsAppApiService,
} from './meta-whatsapp-api.service';
import { WhatsAppBalanceService } from './whatsapp-balance.service';
import { WhatsAppConnectionService } from './whatsapp-connection.service';
import {
  MAX_SEND_ATTEMPTS,
  RETRY_DELAY_MINUTES,
  SENDING_STALE_MINUTES,
  WhatsAppTemplateStatus,
  templateVariables,
} from './whatsapp.constants';
import {
  WhatsAppTokenEncryptionService,
  whatsAppAccessTokenContext,
} from './whatsapp-token-encryption.service';

const DEFAULT_BATCH_SIZE = 100;

export interface DispatchSummary {
  claimed: number;
  sent: number;
  skipped: number;
  failed: number;
  retried: number;
  recovered: number;
}

type Outcome = 'sent' | 'skipped' | 'failed' | 'retried';

class StopSend extends Error {
  constructor(
    readonly status: 'SKIPPED' | 'FAILED',
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

@Injectable()
export class WhatsAppDispatchService {
  private readonly logger = new Logger(WhatsAppDispatchService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly meta: MetaWhatsAppApiService,
    private readonly encryption: WhatsAppTokenEncryptionService,
    private readonly balance: WhatsAppBalanceService,
    private readonly connections: WhatsAppConnectionService,
  ) {}

  async runDue(): Promise<DispatchSummary> {
    const recovered = await this.recoverStale();
    const ids = await this.claimDue(this.batchSize());
    const summary: DispatchSummary = {
      claimed: ids.length,
      sent: 0,
      skipped: 0,
      failed: 0,
      retried: 0,
      recovered,
    };
    for (const id of ids) {
      const outcome = await this.processOne(id).catch((err: Error) => {
        this.logger.error(
          `WhatsApp dispatch crashed for ${id}: ${err.message}`,
        );
        return 'failed';
      });
      summary[outcome]++;
    }
    return summary;
  }

  /** Atomically moves due rows to SENDING; concurrent runs never share a row. */
  async claimDue(limit: number): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
      UPDATE "WhatsAppMessage"
      SET "status" = 'SENDING'::"WhatsAppMessageStatus", "updatedAt" = NOW()
      WHERE "id" IN (
        SELECT "id" FROM "WhatsAppMessage"
        WHERE "status" = 'SCHEDULED'::"WhatsAppMessageStatus"
          AND "sendAfter" <= NOW()
        ORDER BY "sendAfter" ASC
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING "id"`;
    return rows.map((r) => r.id);
  }

  async processOne(id: string): Promise<Outcome> {
    const message = await this.prisma.whatsAppMessage.findUnique({
      where: { id },
    });
    if (!message || message.status !== WhatsAppMessageStatus.SENDING) {
      return 'skipped';
    }

    let charged = false;
    try {
      const { connection, price } = await this.preflight(message);

      const attempt = message.attempts + 1;
      const debit = await this.balance.debitForMessage({
        storeId: message.storeId,
        messageId: message.id,
        attempt,
        amount: price,
        currency: message.currency,
      });
      if (!debit.ok) {
        await this.balance.checkLowBalance(
          message.storeId,
          message.currency,
          debit.balance,
        );
        throw new StopSend(
          'FAILED',
          'INSUFFICIENT_BALANCE',
          'Not enough WhatsApp balance to send this message',
        );
      }
      charged = true;
      await this.prisma.whatsAppMessage.update({
        where: { id },
        data: { attempts: attempt },
      });

      const accessToken = this.encryption.decrypt(
        connection.encryptedAccessToken!,
        whatsAppAccessTokenContext(connection.wabaId),
      );
      const sent = await this.meta.sendTemplate(
        accessToken,
        connection.phoneNumberId,
        {
          to: message.recipientPhone,
          templateName: message.templateName,
          language: message.language,
          bodyParameters: templateVariables(message.variables),
        },
      );
      await this.prisma.whatsAppMessage.update({
        where: { id },
        data: {
          status: WhatsAppMessageStatus.SENT,
          providerMessageId: sent.messageId,
          sentAt: new Date(),
          cost: price,
          errorCode: null,
          errorMessage: null,
          rawPayload: { send: sent.raw } as Prisma.InputJsonValue,
        },
      });
      await this.balance.checkLowBalance(
        message.storeId,
        message.currency,
        debit.balanceAfter,
      );
      return 'sent';
    } catch (err) {
      if (charged) {
        await this.balance
          .refundMessage(message.storeId, message.id)
          .catch((refundErr: Error) =>
            this.logger.error(
              `Refund failed for WhatsApp message ${id}: ${refundErr.message}`,
            ),
          );
      }
      return this.handleFailure(message, err);
    }
  }

  private async preflight(message: WhatsAppMessage) {
    const [connection, setting, template] = await Promise.all([
      this.prisma.whatsAppConnection.findUnique({
        where: { storeId: message.storeId },
      }),
      this.prisma.whatsAppStatusSetting.findUnique({
        where: {
          storeId_trigger: {
            storeId: message.storeId,
            trigger: message.trigger,
          },
        },
        select: { enabled: true },
      }),
      this.prisma.whatsAppTemplate.findUnique({
        where: {
          storeId_name_language: {
            storeId: message.storeId,
            name: message.templateName,
            language: message.language,
          },
        },
        select: { status: true },
      }),
    ]);

    if (
      !connection ||
      connection.status !== WhatsAppConnectionStatus.ACTIVE ||
      !connection.encryptedAccessToken
    ) {
      throw new StopSend(
        'SKIPPED',
        'NOT_CONNECTED',
        'WhatsApp is not connected for this store',
      );
    }
    if (!setting?.enabled) {
      throw new StopSend(
        'SKIPPED',
        'AUTOMATION_DISABLED',
        'This status message was turned off before it was sent',
      );
    }
    if (!message.orderId) {
      throw new StopSend('SKIPPED', 'ORDER_REMOVED', 'The order was deleted');
    }
    const currentStatus = await this.currentShipmentStatus(message.orderId);
    if (currentStatus !== message.trigger) {
      throw new StopSend(
        'SKIPPED',
        'STATUS_CHANGED',
        `The parcel moved to ${currentStatus ?? 'an unknown status'} before the message was due`,
      );
    }
    if (template?.status !== WhatsAppTemplateStatus.APPROVED) {
      throw new StopSend(
        'FAILED',
        'TEMPLATE_NOT_APPROVED',
        `Template ${message.templateName} (${message.language}) is ${template?.status ?? WhatsAppTemplateStatus.NOT_SUBMITTED}, not approved by Meta`,
      );
    }
    const price = await this.balance.getPrice(message.currency);
    if (!price) {
      throw new StopSend(
        'FAILED',
        'PRICING_NOT_SET',
        `No WhatsApp message price is set for ${message.currency}`,
      );
    }
    return { connection, price };
  }

  private async currentShipmentStatus(orderId: string) {
    const dispatch = await this.prisma.ecommerceOrderDispatch.findUnique({
      where: { orderId },
      select: {
        senditShipment: { select: { normalizedStatus: true } },
        quickLivraisonShipment: { select: { normalizedStatus: true } },
        forceLogShipment: { select: { normalizedStatus: true } },
        ozoneExpressShipment: { select: { normalizedStatus: true } },
      },
    });
    if (!dispatch) return null;
    return (
      (
        dispatch.senditShipment ??
        dispatch.quickLivraisonShipment ??
        dispatch.forceLogShipment ??
        dispatch.ozoneExpressShipment
      )?.normalizedStatus ?? null
    );
  }

  private async handleFailure(
    message: WhatsAppMessage,
    err: unknown,
  ): Promise<Outcome> {
    if (err instanceof StopSend) {
      await this.finish(message.id, err.status, err.code, err.message);
      return err.status === 'SKIPPED' ? 'skipped' : 'failed';
    }

    if (err instanceof MetaGraphError) {
      if (err.isAuthError) {
        await this.connections
          .markReauthRequired(message.storeId, err)
          .catch(() => undefined);
        await this.finish(message.id, 'FAILED', 'NOT_AUTHORIZED', err.message);
        return 'failed';
      }
      const attempts = message.attempts + 1;
      if (err.isTransient && attempts < MAX_SEND_ATTEMPTS) {
        await this.prisma.whatsAppMessage.updateMany({
          where: { id: message.id, status: WhatsAppMessageStatus.SENDING },
          data: {
            status: WhatsAppMessageStatus.SCHEDULED,
            sendAfter: new Date(Date.now() + RETRY_DELAY_MINUTES * 60_000),
            errorCode: err.errorCode,
            errorMessage: err.message,
          },
        });
        return 'retried';
      }
      await this.finish(message.id, 'FAILED', err.errorCode, err.message);
      return 'failed';
    }

    this.logger.error(
      `WhatsApp send failed for ${message.id}: ${(err as Error).message}`,
    );
    await this.finish(
      message.id,
      'FAILED',
      'INTERNAL_ERROR',
      'The message could not be sent',
    );
    return 'failed';
  }

  /** SENDING rows left behind by a crashed run: refund and close them. */
  async recoverStale(): Promise<number> {
    const cutoff = new Date(Date.now() - SENDING_STALE_MINUTES * 60_000);
    const stale = await this.prisma.whatsAppMessage.findMany({
      where: {
        status: WhatsAppMessageStatus.SENDING,
        updatedAt: { lt: cutoff },
      },
      select: { id: true, storeId: true },
      take: 200,
    });
    for (const row of stale) {
      await this.balance.refundMessage(row.storeId, row.id).catch(() => false);
      await this.finish(
        row.id,
        'FAILED',
        'SEND_INTERRUPTED',
        'Sending was interrupted; the charge was refunded',
      );
    }
    return stale.length;
  }

  private async finish(
    id: string,
    status: 'SKIPPED' | 'FAILED',
    code: string,
    message: string,
  ): Promise<void> {
    await this.prisma.whatsAppMessage.updateMany({
      where: { id, status: WhatsAppMessageStatus.SENDING },
      data: {
        status,
        errorCode: code,
        errorMessage: message.slice(0, 500),
        ...(status === 'FAILED' ? { failedAt: new Date() } : {}),
      },
    });
  }

  private batchSize(): number {
    const configured = Number(
      this.configService.get<string>('WHATSAPP_DISPATCH_BATCH_SIZE'),
    );
    return Number.isInteger(configured) && configured > 0 && configured <= 500
      ? configured
      : DEFAULT_BATCH_SIZE;
  }
}
