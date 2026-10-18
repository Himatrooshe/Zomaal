import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ShippingShipmentStatus,
  WhatsAppConnectionStatus,
  WhatsAppMessageStatus,
} from '@prisma/client';
import { isUniqueConstraintError } from '../common/prisma-errors.util';
import { PrismaService } from '../prisma/prisma.service';
import {
  CUSTOMER_NAME_FALLBACK,
  WHATSAPP_LANGUAGES,
  WHATSAPP_TEMPLATES,
  isWhatsAppTrigger,
  type WhatsAppLanguage,
} from './whatsapp.constants';
import { resolveCountryCode, toE164 } from './whatsapp-phone.util';

const DEFAULT_MAX_STATUS_AGE_HOURS = 24;

export interface ShipmentStatusInput {
  orderId: string;
  status: ShippingShipmentStatus;
  /** When the courier reported this status; null when the courier gives no time. */
  statusChangedAt?: Date | null;
  recipientPhone?: string | null;
  recipientName?: string | null;
}

export type QueueResult =
  | 'QUEUED'
  | 'SKIPPED_NO_PHONE'
  | 'ALREADY_QUEUED'
  | 'NOT_A_TRIGGER'
  | 'STALE_STATUS'
  | 'NOT_CONNECTED'
  | 'DISABLED'
  | 'ORDER_NOT_FOUND';

/**
 * Queues the customer message for a courier status change. Leaf provider
 * (Prisma + Config only) so the courier/financial path can call it without
 * pulling the WhatsApp module — and its Meta client — into ShippingModule.
 */
@Injectable()
export class WhatsAppTriggerService {
  private readonly logger = new Logger(WhatsAppTriggerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  async onShipmentStatus(input: ShipmentStatusInput): Promise<QueueResult> {
    if (!isWhatsAppTrigger(input.status)) return 'NOT_A_TRIGGER';
    if (this.configService.get<string>('WHATSAPP_ENABLED') !== 'true') {
      return 'NOT_CONNECTED';
    }
    const trigger = input.status;

    // Courier refreshes re-run this for old parcels; a customer should never
    // get "out for delivery" about a parcel that moved days ago.
    const maxAgeHours =
      Number(this.configService.get<string>('WHATSAPP_MAX_STATUS_AGE_HOURS')) ||
      DEFAULT_MAX_STATUS_AGE_HOURS;
    if (
      input.statusChangedAt &&
      Date.now() - input.statusChangedAt.getTime() > maxAgeHours * 3_600_000
    ) {
      return 'STALE_STATUS';
    }

    const order = await this.prisma.ecommerceOrder.findUnique({
      where: { id: input.orderId },
      select: {
        id: true,
        orderName: true,
        externalOrderId: true,
        manualCustomerName: true,
        manualCustomerPhone: true,
        customer: { select: { name: true, phone: true } },
        dispatch: { select: { merchantTracking: true } },
        connection: {
          select: {
            store: {
              select: {
                id: true,
                businessName: true,
                country: true,
                baseCurrency: true,
                whatsAppConnection: {
                  select: { status: true, language: true },
                },
                whatsAppStatusSettings: {
                  where: { trigger },
                  select: { enabled: true, delayMinutes: true },
                },
              },
            },
          },
        },
      },
    });
    if (!order) return 'ORDER_NOT_FOUND';

    const store = order.connection.store;
    if (store.whatsAppConnection?.status !== WhatsAppConnectionStatus.ACTIVE) {
      return 'NOT_CONNECTED';
    }
    const setting = store.whatsAppStatusSettings[0];
    if (!setting?.enabled) return 'DISABLED';

    const language = toLanguage(store.whatsAppConnection.language);
    const country = resolveCountryCode(
      store.country,
      this.configService.get<string>('OTP_DEFAULT_COUNTRY'),
    );
    const recipientPhone =
      [input.recipientPhone, order.customer?.phone, order.manualCustomerPhone]
        .map((phone) => toE164(phone, country))
        .find((phone): phone is string => !!phone) ?? null;
    const customerName = firstNonEmpty(
      input.recipientName,
      order.customer?.name,
      order.manualCustomerName,
    );
    const orderLabel =
      firstNonEmpty(order.orderName, order.dispatch?.merchantTracking) ??
      `#${order.externalOrderId}`;

    const now = new Date();
    const template = WHATSAPP_TEMPLATES[trigger];
    try {
      await this.prisma.whatsAppMessage.create({
        data: {
          storeId: store.id,
          orderId: order.id,
          trigger,
          templateName: template.name,
          language,
          recipientPhone: recipientPhone ?? '',
          variables: [
            truncate(customerName ?? CUSTOMER_NAME_FALLBACK[language], 60),
            truncate(orderLabel, 40),
            truncate(store.businessName, 60),
          ],
          status: recipientPhone
            ? WhatsAppMessageStatus.SCHEDULED
            : WhatsAppMessageStatus.SKIPPED,
          errorCode: recipientPhone ? null : 'NO_VALID_PHONE',
          errorMessage: recipientPhone
            ? null
            : 'The order has no valid mobile number for the customer',
          sendAfter: new Date(now.getTime() + setting.delayMinutes * 60_000),
          currency: store.baseCurrency,
          idempotencyKey: `${order.id}:${trigger}`,
        },
      });
    } catch (err) {
      if (isUniqueConstraintError(err)) return 'ALREADY_QUEUED';
      throw err;
    }
    if (!recipientPhone) {
      this.logger.debug(`No valid phone for order ${order.id}; skipped`);
      return 'SKIPPED_NO_PHONE';
    }
    return 'QUEUED';
  }
}

function toLanguage(value: string | null | undefined): WhatsAppLanguage {
  return (WHATSAPP_LANGUAGES as readonly string[]).includes(value ?? '')
    ? (value as WhatsAppLanguage)
    : 'fr';
}

function firstNonEmpty(
  ...values: Array<string | null | undefined>
): string | null {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) return trimmed;
  }
  return null;
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}
