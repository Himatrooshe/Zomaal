import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, WhatsAppBalanceEntryType } from '@prisma/client';
import { NotificationType } from '../notifications/notification-type';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';

const Decimal = Prisma.Decimal;
type Decimal = Prisma.Decimal;
type Db = Prisma.TransactionClient | PrismaService;

const LOW_BALANCE_DEDUPE_KEY = 'whatsapp-balance-low';
const DEFAULT_LOW_BALANCE_MESSAGES = 20;

export type DebitResult =
  | { ok: true; balanceAfter: Decimal }
  | { ok: false; balance: Decimal };

export interface AdminCreditInput {
  type: 'TOP_UP' | 'ADJUSTMENT';
  amount: string;
  note?: string | null;
  idempotencyKey: string;
}

@Injectable()
export class WhatsAppBalanceService {
  private readonly logger = new Logger(WhatsAppBalanceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly notifications: NotificationsService,
  ) {}

  async getBalance(
    storeId: string,
    currency: string,
    db: Db = this.prisma,
  ): Promise<Decimal> {
    const agg = await db.whatsAppBalanceEntry.aggregate({
      where: { storeId, currency },
      _sum: { amount: true },
    });
    return agg._sum.amount ?? new Decimal(0);
  }

  async getPrice(currency: string): Promise<Decimal | null> {
    const row = await this.prisma.whatsAppPricing.findUnique({
      where: { currency },
      select: { pricePerMessage: true },
    });
    return row?.pricePerMessage ?? null;
  }

  /**
   * Charges one send attempt. Serialized per store so two dispatch workers
   * can't both spend the last credit.
   */
  async debitForMessage(input: {
    storeId: string;
    messageId: string;
    attempt: number;
    amount: Decimal;
    currency: string;
  }): Promise<DebitResult> {
    return this.prisma.$transaction(async (tx) => {
      await this.lockStore(tx, input.storeId);
      const balance = await this.getBalance(input.storeId, input.currency, tx);
      if (balance.lessThan(input.amount)) return { ok: false, balance };

      await tx.whatsAppBalanceEntry.create({
        data: {
          storeId: input.storeId,
          messageId: input.messageId,
          type: WhatsAppBalanceEntryType.MESSAGE,
          amount: input.amount.negated(),
          currency: input.currency,
          idempotencyKey: `message:${input.messageId}:${input.attempt}`,
        },
      });
      return { ok: true, balanceAfter: balance.minus(input.amount) };
    });
  }

  /**
   * Returns whatever is still charged for this message. Safe to call more
   * than once (dispatch failure, then a late "failed" webhook).
   */
  async refundMessage(storeId: string, messageId: string): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      await this.lockStore(tx, storeId);
      const entries = await tx.whatsAppBalanceEntry.findMany({
        where: { storeId, messageId },
        select: { amount: true, currency: true },
      });
      if (entries.length === 0) return false;
      const net = entries.reduce(
        (sum, e) => sum.plus(e.amount),
        new Decimal(0),
      );
      if (!net.isNegative()) return false;

      await tx.whatsAppBalanceEntry.create({
        data: {
          storeId,
          messageId,
          type: WhatsAppBalanceEntryType.REFUND,
          amount: net.negated(),
          currency: entries[0].currency,
          idempotencyKey: `refund:${messageId}:${entries.length}`,
        },
      });
      return true;
    });
  }

  async adminCredit(storeId: string, input: AdminCreditInput, adminId: string) {
    const store = await this.prisma.store.findUnique({
      where: { id: storeId },
      select: { id: true, baseCurrency: true },
    });
    if (!store) throw new NotFoundException('Store not found');

    const amount = parseAmount(input.amount);
    if (amount.isZero()) {
      throw new BadRequestException('amount must not be zero');
    }
    if (input.type === 'TOP_UP' && amount.isNegative()) {
      throw new BadRequestException(
        'A top-up must be positive; use ADJUSTMENT to remove credit',
      );
    }
    const currency = store.baseCurrency;

    const result = await this.prisma.$transaction(async (tx) => {
      await this.lockStore(tx, storeId);
      const existing = await tx.whatsAppBalanceEntry.findUnique({
        where: {
          storeId_idempotencyKey: {
            storeId,
            idempotencyKey: `admin:${input.idempotencyKey}`,
          },
        },
      });
      if (existing) {
        return {
          entry: existing,
          balance: await this.getBalance(storeId, currency, tx),
          replayed: true,
        };
      }

      const balance = await this.getBalance(storeId, currency, tx);
      if (balance.plus(amount).isNegative()) {
        throw new BadRequestException(
          `Adjustment would make the balance negative (current ${balance.toFixed(2)} ${currency})`,
        );
      }
      const entry = await tx.whatsAppBalanceEntry.create({
        data: {
          storeId,
          type: input.type,
          amount,
          currency,
          note: input.note?.trim() || null,
          idempotencyKey: `admin:${input.idempotencyKey}`,
          recordedByAdminId: adminId,
        },
      });
      return { entry, balance: balance.plus(amount), replayed: false };
    });

    await this.checkLowBalance(storeId, currency, result.balance);
    return {
      entry: serializeEntry(result.entry),
      balance: result.balance.toFixed(2),
      currency,
      replayed: result.replayed,
    };
  }

  async history(storeId: string, page: number, limit: number) {
    const store = await this.prisma.store.findUnique({
      where: { id: storeId },
      select: { baseCurrency: true },
    });
    if (!store) throw new NotFoundException('Store not found');

    const where: Prisma.WhatsAppBalanceEntryWhereInput = { storeId };
    const [rows, total, balance] = await Promise.all([
      this.prisma.whatsAppBalanceEntry.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.whatsAppBalanceEntry.count({ where }),
      this.getBalance(storeId, store.baseCurrency),
    ]);
    return {
      balance: balance.toFixed(2),
      currency: store.baseCurrency,
      data: rows.map(serializeEntry),
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  async listPricing() {
    const rows = await this.prisma.whatsAppPricing.findMany({
      orderBy: { currency: 'asc' },
    });
    return rows.map(serializePricing);
  }

  async setPricing(currency: string, pricePerMessage: string, adminId: string) {
    const price = parseAmount(pricePerMessage);
    if (!price.isPositive() || price.isZero()) {
      throw new BadRequestException('pricePerMessage must be greater than 0');
    }
    const code = currency.trim().toUpperCase();
    const row = await this.prisma.whatsAppPricing.upsert({
      where: { currency: code },
      create: {
        currency: code,
        pricePerMessage: price,
        updatedByAdminId: adminId,
      },
      update: { pricePerMessage: price, updatedByAdminId: adminId },
    });
    return serializePricing(row);
  }

  lowBalanceThreshold(price: Decimal): Decimal {
    const messages =
      Number(this.configService.get<string>('WHATSAPP_LOW_BALANCE_MESSAGES')) ||
      DEFAULT_LOW_BALANCE_MESSAGES;
    return price.times(messages);
  }

  /** Raises the low-balance alert, or clears it once credit is back. */
  async checkLowBalance(
    storeId: string,
    currency: string,
    balance?: Decimal,
  ): Promise<void> {
    try {
      const price = await this.getPrice(currency);
      if (!price) return;
      const current = balance ?? (await this.getBalance(storeId, currency));
      if (current.lessThan(this.lowBalanceThreshold(price))) {
        await this.notifications.raise({
          storeId,
          type: NotificationType.WHATSAPP_BALANCE_LOW,
          title: 'WhatsApp balance is low',
          message: `Your WhatsApp balance is ${current.toFixed(2)} ${currency}. Automated messages stop when it runs out — contact Zomaal to top up.`,
          dedupeKey: LOW_BALANCE_DEDUPE_KEY,
          metadata: { balance: current.toFixed(2), currency },
        });
      } else {
        await this.notifications.resolve(storeId, [LOW_BALANCE_DEDUPE_KEY]);
      }
    } catch (err) {
      this.logger.warn(
        `Low-balance check failed for store ${storeId}: ${(err as Error).message}`,
      );
    }
  }

  private async lockStore(
    tx: Prisma.TransactionClient,
    storeId: string,
  ): Promise<void> {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'whatsapp-balance:' + storeId}, 0))::text`;
  }
}

function parseAmount(value: string): Decimal {
  try {
    const amount = new Decimal(value);
    if (!amount.isFinite()) throw new Error('not finite');
    // Two decimals keeps every ledger row exact in the .toFixed(2) API output.
    if (amount.decimalPlaces() > 2) {
      throw new BadRequestException('Amounts support at most 2 decimals');
    }
    return amount;
  } catch (err) {
    if (err instanceof BadRequestException) throw err;
    throw new BadRequestException('Invalid amount');
  }
}

export function serializeEntry(entry: {
  id: string;
  type: WhatsAppBalanceEntryType;
  amount: Decimal;
  currency: string;
  note: string | null;
  messageId: string | null;
  createdAt: Date;
}) {
  return {
    id: entry.id,
    type: entry.type,
    amount: entry.amount.toFixed(2),
    currency: entry.currency,
    note: entry.note,
    messageId: entry.messageId,
    createdAt: entry.createdAt.toISOString(),
  };
}

function serializePricing(row: {
  currency: string;
  pricePerMessage: Decimal;
  updatedAt: Date;
}) {
  return {
    currency: row.currency,
    pricePerMessage: row.pricePerMessage.toFixed(2),
    updatedAt: row.updatedAt.toISOString(),
  };
}
