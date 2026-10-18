import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  WhatsAppConnectionStatus,
  WhatsAppMessageStatus,
  type WhatsAppConnection,
} from '@prisma/client';
import { randomInt } from 'crypto';
import { StoreAccessService } from '../access/store-access.service';
import { NotificationType } from '../notifications/notification-type';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  MetaGraphError,
  MetaWhatsAppApiService,
} from './meta-whatsapp-api.service';
import { requireWhatsAppOwner } from './whatsapp-access.util';
import {
  TEMPLATE_EXAMPLE_VALUES,
  WHATSAPP_LANGUAGES,
  WHATSAPP_TEMPLATES,
  WhatsAppTemplateStatus,
  type WhatsAppLanguage,
} from './whatsapp.constants';
import {
  WhatsAppTokenEncryptionService,
  whatsAppAccessTokenContext,
  whatsAppPinContext,
} from './whatsapp-token-encryption.service';

export const DISCONNECTED_DEDUPE_KEY = 'whatsapp-disconnected';

export interface ConnectInput {
  code: string;
  wabaId: string;
  phoneNumberId: string;
  language?: WhatsAppLanguage;
}

export interface ProvisionSummary {
  total: number;
  submitted: number;
  failed: number;
}

@Injectable()
export class WhatsAppConnectionService {
  private readonly logger = new Logger(WhatsAppConnectionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storeAccess: StoreAccessService,
    private readonly meta: MetaWhatsAppApiService,
    private readonly encryption: WhatsAppTokenEncryptionService,
    private readonly notifications: NotificationsService,
  ) {}

  config() {
    return this.meta.publicConfig();
  }

  async getConnection(userId: string) {
    const access = await requireWhatsAppOwner(this.storeAccess, userId);
    const connection = await this.prisma.whatsAppConnection.findUnique({
      where: { storeId: access.storeId },
    });
    return serializeConnection(connection);
  }

  async connect(userId: string, input: ConnectInput) {
    this.meta.assertConfigured();
    this.encryption.assertConfigured();
    const access = await requireWhatsAppOwner(this.storeAccess, userId);
    const wabaId = input.wabaId.trim();
    const phoneNumberId = input.phoneNumberId.trim();

    const taken = await this.prisma.whatsAppConnection.findFirst({
      where: {
        phoneNumberId,
        storeId: { not: access.storeId },
        status: { not: WhatsAppConnectionStatus.DISCONNECTED },
      },
      select: { id: true },
    });
    if (taken) {
      throw new ConflictException(
        'This WhatsApp number is already connected to another store',
      );
    }

    const existing = await this.prisma.whatsAppConnection.findUnique({
      where: { storeId: access.storeId },
    });

    let registrationError: string | null = null;
    let pin: string;
    let token: { accessToken: string; expiresAt: Date | null };
    let phone: Awaited<ReturnType<MetaWhatsAppApiService['getPhoneNumber']>>;
    try {
      token = await this.meta.exchangeCode(input.code.trim());
      const phoneIds = await this.meta.listPhoneNumberIds(
        token.accessToken,
        wabaId,
      );
      if (!phoneIds.includes(phoneNumberId)) {
        throw new BadRequestException(
          'This phone number does not belong to the selected WhatsApp Business Account',
        );
      }
      phone = await this.meta.getPhoneNumber(token.accessToken, phoneNumberId);
      await this.meta.subscribeApp(token.accessToken, wabaId);

      pin =
        existing?.wabaId === wabaId && existing.encryptedRegistrationPin
          ? this.encryption.decrypt(
              existing.encryptedRegistrationPin,
              whatsAppPinContext(wabaId),
            )
          : String(randomInt(0, 1_000_000)).padStart(6, '0');
      try {
        await this.meta.registerPhone(token.accessToken, phoneNumberId, pin);
      } catch (err) {
        if (!(err instanceof MetaGraphError) || err.isAuthError) throw err;
        // Already registered elsewhere with a 2FA PIN we don't know: the
        // connection still works if the number is registered; sends will tell.
        registrationError = `Number registration failed: ${err.message}`;
        this.logger.warn(
          `WhatsApp register failed for store ${access.storeId}: ${err.message}`,
        );
      }
    } catch (err) {
      if (err instanceof MetaGraphError) throw err.toHttpException();
      throw err;
    }

    if (existing && existing.wabaId !== wabaId) {
      await this.prisma.whatsAppTemplate.deleteMany({
        where: { storeId: access.storeId },
      });
    }

    const now = new Date();
    const data = {
      wabaId,
      phoneNumberId,
      displayPhoneNumber: phone.displayPhoneNumber,
      verifiedName: phone.verifiedName,
      encryptedAccessToken: this.encryption.encrypt(
        token.accessToken,
        whatsAppAccessTokenContext(wabaId),
      ),
      accessTokenExpiresAt: token.expiresAt,
      encryptedRegistrationPin: this.encryption.encrypt(
        pin,
        whatsAppPinContext(wabaId),
      ),
      status: WhatsAppConnectionStatus.ACTIVE,
      lastError: registrationError,
      connectedAt: now,
      disconnectedAt: null,
      ...(input.language ? { language: input.language } : {}),
    };
    await this.prisma.whatsAppConnection.upsert({
      where: { storeId: access.storeId },
      create: { storeId: access.storeId, ...data },
      update: data,
    });
    await this.notifications
      .resolve(access.storeId, [DISCONNECTED_DEDUPE_KEY])
      .catch(() => undefined);

    const templates = await this.provisionTemplates(
      access.storeId,
      token.accessToken,
      wabaId,
    ).catch((err: Error) => {
      this.logger.warn(
        `Template provisioning failed for store ${access.storeId}: ${err.message}`,
      );
      return null;
    });

    const connection = await this.prisma.whatsAppConnection.findUnique({
      where: { storeId: access.storeId },
    });
    return { ...serializeConnection(connection), templates };
  }

  async updateLanguage(userId: string, language: WhatsAppLanguage) {
    const access = await requireWhatsAppOwner(this.storeAccess, userId);
    const connection = await this.requireConnection(access.storeId);
    const updated = await this.prisma.whatsAppConnection.update({
      where: { id: connection.id },
      data: { language },
    });
    return serializeConnection(updated);
  }

  async disconnect(userId: string) {
    const access = await requireWhatsAppOwner(this.storeAccess, userId);
    const connection = await this.requireConnection(access.storeId);

    if (connection.encryptedAccessToken) {
      try {
        const accessToken = this.encryption.decrypt(
          connection.encryptedAccessToken,
          whatsAppAccessTokenContext(connection.wabaId),
        );
        await this.meta.unsubscribeApp(accessToken, connection.wabaId);
      } catch (err) {
        this.logger.warn(
          `WhatsApp unsubscribe failed for store ${access.storeId}: ${(err as Error).message}`,
        );
      }
    }

    const now = new Date();
    const [, cancelled] = await this.prisma.$transaction([
      this.prisma.whatsAppConnection.update({
        where: { id: connection.id },
        data: {
          status: WhatsAppConnectionStatus.DISCONNECTED,
          encryptedAccessToken: null,
          accessTokenExpiresAt: null,
          disconnectedAt: now,
        },
      }),
      this.prisma.whatsAppMessage.updateMany({
        where: {
          storeId: access.storeId,
          status: WhatsAppMessageStatus.SCHEDULED,
        },
        data: {
          status: WhatsAppMessageStatus.SKIPPED,
          errorCode: 'NOT_CONNECTED',
          errorMessage: 'WhatsApp was disconnected before the message was sent',
        },
      }),
    ]);
    return { disconnected: true, cancelledMessages: cancelled.count };
  }

  /** Creates any missing Zomaal templates and refreshes approval statuses. */
  async syncTemplates(userId: string) {
    const access = await requireWhatsAppOwner(this.storeAccess, userId);
    const connection = await this.requireConnection(access.storeId);
    if (
      connection.status !== WhatsAppConnectionStatus.ACTIVE ||
      !connection.encryptedAccessToken
    ) {
      throw new ConflictException(
        'Reconnect WhatsApp before syncing templates',
      );
    }
    const accessToken = this.encryption.decrypt(
      connection.encryptedAccessToken,
      whatsAppAccessTokenContext(connection.wabaId),
    );
    try {
      return await this.provisionTemplates(
        access.storeId,
        accessToken,
        connection.wabaId,
      );
    } catch (err) {
      if (err instanceof MetaGraphError) {
        if (err.isAuthError) await this.markReauthRequired(access.storeId, err);
        throw err.toHttpException();
      }
      throw err;
    }
  }

  async provisionTemplates(
    storeId: string,
    accessToken: string,
    wabaId: string,
  ): Promise<ProvisionSummary> {
    const remote = await this.meta.listTemplates(accessToken, wabaId);
    const byKey = new Map(remote.map((t) => [`${t.name}:${t.language}`, t]));
    const summary: ProvisionSummary = { total: 0, submitted: 0, failed: 0 };

    for (const definition of Object.values(WHATSAPP_TEMPLATES)) {
      for (const language of WHATSAPP_LANGUAGES) {
        summary.total++;
        const key = { storeId, name: definition.name, language };
        const found = byKey.get(`${definition.name}:${language}`);
        let state: {
          status: string;
          metaTemplateId: string | null;
          rejectedReason: string | null;
        };
        if (found) {
          state = {
            status: found.status,
            metaTemplateId: found.id,
            rejectedReason: found.rejectedReason,
          };
        } else {
          try {
            const created = await this.meta.createTemplate(
              accessToken,
              wabaId,
              {
                name: definition.name,
                language,
                body: definition.bodies[language],
                exampleValues: TEMPLATE_EXAMPLE_VALUES[language],
              },
            );
            summary.submitted++;
            state = {
              status: created.status,
              metaTemplateId: created.id,
              rejectedReason: null,
            };
          } catch (err) {
            if (err instanceof MetaGraphError && err.isAuthError) throw err;
            summary.failed++;
            state = {
              status: WhatsAppTemplateStatus.NOT_SUBMITTED,
              metaTemplateId: null,
              rejectedReason: `Submission failed: ${(err as Error).message}`,
            };
          }
        }
        await this.prisma.whatsAppTemplate.upsert({
          where: { storeId_name_language: key },
          create: { ...key, trigger: definition.trigger, ...state },
          update: state,
        });
      }
    }
    return summary;
  }

  /** Token revoked or expired: stop sending and tell the owner. */
  async markReauthRequired(storeId: string, err: Error): Promise<void> {
    await this.prisma.whatsAppConnection.updateMany({
      where: { storeId, status: WhatsAppConnectionStatus.ACTIVE },
      data: {
        status: WhatsAppConnectionStatus.REAUTHORIZATION_REQUIRED,
        lastError: err.message,
      },
    });
    await this.notifications
      .raise({
        storeId,
        type: NotificationType.WHATSAPP_DISCONNECTED,
        title: 'WhatsApp needs to be reconnected',
        message:
          'Meta no longer accepts Zomaal’s access to your WhatsApp number. Automated messages are paused until you reconnect.',
        dedupeKey: DISCONNECTED_DEDUPE_KEY,
      })
      .catch(() => undefined);
  }

  private async requireConnection(storeId: string) {
    const connection = await this.prisma.whatsAppConnection.findUnique({
      where: { storeId },
    });
    if (!connection) throw new NotFoundException('WhatsApp is not connected');
    return connection;
  }
}

export function serializeConnection(connection: WhatsAppConnection | null) {
  if (!connection) {
    return { connected: false, connection: null };
  }
  return {
    connected: connection.status === WhatsAppConnectionStatus.ACTIVE,
    connection: {
      id: connection.id,
      status: connection.status,
      wabaId: connection.wabaId,
      phoneNumberId: connection.phoneNumberId,
      displayPhoneNumber: connection.displayPhoneNumber,
      verifiedName: connection.verifiedName,
      language: connection.language,
      lastError: connection.lastError,
      connectedAt: connection.connectedAt.toISOString(),
      disconnectedAt: connection.disconnectedAt?.toISOString() ?? null,
    },
  };
}
