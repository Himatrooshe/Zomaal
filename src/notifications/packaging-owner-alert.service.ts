import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  MetaGraphError,
  MetaWhatsAppApiService,
} from '../whatsapp/meta-whatsapp-api.service';
import {
  WhatsAppTokenEncryptionService,
  whatsAppAccessTokenContext,
} from '../whatsapp/whatsapp-token-encryption.service';
import { resolveCountryCode, toE164 } from '../whatsapp/whatsapp-phone.util';

const RETRY_MS = 15 * 60 * 1000;
const BATCH_SIZE = 50;

/** Owner inventory alerts have their own outbox; they never debit the merchant's
 * customer-message wallet. One notification cycle creates at most one send.
 * UNKNOWN requires review: resending an ambiguous provider response can duplicate it.
 */
@Injectable()
export class PackagingOwnerAlertService {
  private readonly logger = new Logger(PackagingOwnerAlertService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly meta: MetaWhatsAppApiService,
    private readonly encryption: WhatsAppTokenEncryptionService,
  ) {}

  async syncStore(storeId: string): Promise<void> {
    await this.prisma.packagingOwnerAlert.updateMany({
      where: {
        notification: { storeId, resolvedAt: { not: null } },
        status: { in: ['PENDING', 'BLOCKED', 'FAILED'] },
      },
      data: { status: 'CANCELLED', lastErrorCode: 'CONDITION_RESOLVED' },
    });
    const notifications = await this.prisma.notification.findMany({
      where: {
        storeId,
        resolvedAt: null,
        entityType: 'PACKAGING_MATERIAL',
        type: { in: ['LOW_STOCK', 'OUT_OF_STOCK'] },
      },
      select: { id: true },
    });
    await this.prisma.packagingOwnerAlert.createMany({
      data: notifications.map(({ id }) => ({ notificationId: id })),
      skipDuplicates: true,
    });
  }

  async dispatchDue(storeId?: string): Promise<{ processed: number }> {
    const scope = storeId
      ? Prisma.sql`AND n."storeId" = ${storeId}`
      : Prisma.empty;
    // A crash after Meta accepts cannot be safely replayed. Preserve that uncertainty.
    await this.prisma.$executeRaw`
      UPDATE "PackagingOwnerAlert" a SET status = 'UNKNOWN', "lastErrorCode" = 'SEND_OUTCOME_UNKNOWN', "updatedAt" = NOW()
      FROM "Notification" n WHERE a."notificationId" = n.id AND a.status = 'SENDING'
      AND a."updatedAt" < NOW() - INTERVAL '10 minutes' ${scope}`;
    let processed = 0;
    const deadline = Date.now() + 60000;
    // Claim only the row being processed; queued rows must not expire while
    // waiting behind slower provider requests in the same batch.
    while (processed < BATCH_SIZE && Date.now() < deadline) {
      const claimed = await this.prisma.$queryRaw<{ id: string }[]>`
        UPDATE "PackagingOwnerAlert" SET status = 'SENDING', "updatedAt" = NOW()
        WHERE id IN (
          SELECT a.id FROM "PackagingOwnerAlert" a JOIN "Notification" n ON n.id = a."notificationId"
          WHERE a.status IN ('PENDING', 'BLOCKED') AND a."nextAttemptAt" <= NOW()
          AND n."resolvedAt" IS NULL ${scope}
          ORDER BY a."nextAttemptAt", a.id LIMIT 1 FOR UPDATE OF a SKIP LOCKED
        ) RETURNING id`;
      if (!claimed.length) break;
      const { id } = claimed[0];
      processed++;
      try {
        await this.deliver(id);
      } catch {
        // Keep SENDING if persistence failed after provider acceptance. The next
        // run converts it to UNKNOWN, never to an automatic retry.
        this.logger.error(
          `Owner inventory alert ${id} could not finish; outcome retained for review`,
        );
      }
    }
    return { processed };
  }

  private async deliver(id: string): Promise<void> {
    const row = await this.prisma.packagingOwnerAlert.findUniqueOrThrow({
      where: { id },
      include: {
        notification: {
          include: {
            store: { include: { user: true, whatsAppConnection: true } },
          },
        },
      },
    });
    const n = row.notification;
    const material = n.entityId
      ? await this.prisma.packagingMaterial.findFirst({
          where: {
            id: n.entityId,
            storeId: n.storeId,
            isActive: true,
            lowStockAlert: true,
          },
          include: { inventoryItem: { include: { balances: true } } },
        })
      : null;
    const available =
      material?.inventoryItem?.balances.reduce(
        (sum, b) => sum + b.onHand - b.reserved - b.damaged,
        0,
      ) ?? 0;
    if (
      n.resolvedAt ||
      !material ||
      available > material.minimumLevel ||
      (n.type === 'OUT_OF_STOCK') !== available <= 0
    ) {
      await this.finish(id, 'CANCELLED', 'CONDITION_RESOLVED');
      return;
    }
    if (!this.meta.isEnabled()) {
      await this.block(id, 'WHATSAPP_DISABLED');
      return;
    }
    const connection = n.store.whatsAppConnection;
    if (
      !connection ||
      connection.status !== 'ACTIVE' ||
      !connection.encryptedAccessToken ||
      (connection.accessTokenExpiresAt &&
        connection.accessTokenExpiresAt <= new Date())
    ) {
      await this.block(id, 'WHATSAPP_NOT_CONNECTED');
      return;
    }
    // TEMPORARY CLIENT DEPENDENCY: client must approve this inventory template
    // in Meta. Body parameters, in order: material name, available, minimum, unit.
    // No default template name or fabricated approval is used.
    const templateName = this.config
      .get<string>('PACKAGING_OWNER_WHATSAPP_TEMPLATE', '')
      .trim();
    const language = this.config
      .get<string>('PACKAGING_OWNER_WHATSAPP_LANGUAGE', 'fr')
      .trim();
    if (!templateName) {
      await this.block(id, 'TEMPLATE_NOT_CONFIGURED');
      return;
    }
    const recipient = toE164(
      n.store.user.phone,
      resolveCountryCode(n.store.country),
    );
    if (!recipient) {
      await this.block(id, 'OWNER_PHONE_INVALID');
      return;
    }
    if (
      recipient ===
      toE164(connection.displayPhoneNumber, resolveCountryCode(n.store.country))
    ) {
      await this.block(id, 'SENDER_IS_RECIPIENT');
      return;
    }
    let token: string;
    try {
      token = this.encryption.decrypt(
        connection.encryptedAccessToken,
        whatsAppAccessTokenContext(connection.wabaId),
      );
      const templates = await this.meta.listTemplates(token, connection.wabaId);
      if (
        !templates.some(
          (t) =>
            t.name === templateName &&
            t.language === language &&
            t.status === 'APPROVED',
        )
      ) {
        await this.block(id, 'TEMPLATE_NOT_APPROVED');
        return;
      }
    } catch {
      await this.block(id, 'WHATSAPP_PREFLIGHT_FAILED');
      return;
    }
    // Recheck resolution immediately before the external side effect.
    const current = await this.prisma.notification.findUnique({
      where: { id: n.id },
      select: { resolvedAt: true },
    });
    if (!current || current.resolvedAt) {
      await this.finish(id, 'CANCELLED', 'CONDITION_RESOLVED');
      return;
    }
    await this.prisma.packagingOwnerAlert.update({
      where: { id },
      data: { attempts: { increment: 1 } },
    });
    let messageId: string;
    try {
      ({ messageId } = await this.meta.sendTemplate(
        token,
        connection.phoneNumberId,
        {
          to: recipient,
          templateName,
          language,
          bodyParameters: [
            material.name,
            String(available),
            String(material.minimumLevel),
            material.unit,
          ],
        },
      ));
    } catch (error) {
      // Only an explicit Meta rejection is known not to have been accepted.
      // Network errors, malformed success and server errors remain UNKNOWN.
      const rejected =
        error instanceof MetaGraphError &&
        error.httpStatus >= 400 &&
        error.httpStatus < 500;
      if (rejected && error.isTransient && row.attempts + 1 < 3) {
        await this.prisma.packagingOwnerAlert.update({
          where: { id },
          data: {
            status: 'PENDING',
            lastErrorCode: error.errorCode,
            nextAttemptAt: new Date(Date.now() + RETRY_MS),
          },
        });
      } else {
        await this.finish(
          id,
          rejected ? 'FAILED' : 'UNKNOWN',
          rejected ? error.errorCode : 'SEND_OUTCOME_UNKNOWN',
        );
      }
      return;
    }
    // Intentionally outside the send catch: a DB failure must never reschedule
    // a message that the provider has already accepted.
    await this.prisma.packagingOwnerAlert.update({
      where: { id },
      data: {
        status: 'SENT',
        providerMessageId: messageId,
        sentAt: new Date(),
        lastErrorCode: null,
      },
    });
  }

  private block(id: string, code: string) {
    return this.prisma.packagingOwnerAlert.update({
      where: { id },
      data: {
        status: 'BLOCKED',
        lastErrorCode: code,
        nextAttemptAt: new Date(Date.now() + RETRY_MS),
      },
    });
  }
  private finish(id: string, status: string, code: string) {
    return this.prisma.packagingOwnerAlert.update({
      where: { id },
      data: { status, lastErrorCode: code },
    });
  }
}
