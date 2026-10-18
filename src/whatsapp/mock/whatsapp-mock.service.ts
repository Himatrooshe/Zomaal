/**
 * TEMPORARY — WhatsApp mock responses for frontend preview.
 *
 * When `WHATSAPP_MOCK_DATA=true`, `WhatsAppMockInterceptor` answers every
 * merchant `/whatsapp/*` endpoint from here instead of the real services.
 * Nothing is written to the database and Meta is never called:
 * - connection, language and status settings live in process memory per
 *   store (lost on restart, not shared between Cloud Run instances);
 * - messages, balance history and analytics are derived from the static
 *   `MOCK_MESSAGES` list, so every screen shows the same consistent numbers.
 *
 * Real behaviour that is kept on purpose: JWT + plan guards, the owner-only
 * 403, the store's real base currency and name, and the same validation
 * errors as the real endpoints.
 *
 * Remove together with the rest of `src/whatsapp/mock/` when Meta is live.
 */
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Prisma,
  WhatsAppBalanceEntryType,
  WhatsAppConnectionStatus,
  WhatsAppMessageStatus,
} from '@prisma/client';
import { StoreAccessService } from '../../access/store-access.service';
import { PrismaService } from '../../prisma/prisma.service';
import { requireWhatsAppOwner } from '../whatsapp-access.util';
import { TEMPLATE_VARIABLES } from '../whatsapp-settings.service';
import {
  CUSTOMER_NAME_FALLBACK,
  MAX_DELAY_MINUTES,
  WHATSAPP_LANGUAGES,
  WHATSAPP_TEMPLATES,
  WHATSAPP_TRIGGERS,
  WhatsAppTemplateStatus,
  isWhatsAppTrigger,
  renderTemplateBody,
  type WhatsAppLanguage,
  type WhatsAppTrigger,
} from '../whatsapp.constants';
import type { WhatsAppController } from '../whatsapp.controller';
import {
  MOCK_CONNECTION_ID,
  MOCK_DEFAULT_STATUS_SETTINGS,
  MOCK_DISPLAY_PHONE_NUMBER,
  MOCK_MESSAGES,
  MOCK_PRICE_PER_MESSAGE,
  MOCK_TEMPLATE_OVERRIDES,
  MOCK_TOP_UP_AMOUNT,
  MOCK_TOP_UP_DAYS_AGO,
  MOCK_WABA_ID,
  MOCK_PHONE_NUMBER_ID,
  mockOrderId,
  type MockMessageSpec,
} from './whatsapp-mock.fixtures';

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;
const MAX_RANGE_DAYS = 366;
const DEFAULT_LOW_BALANCE_MESSAGES = 20;
const NUMERIC_META_ID = /^\d{5,30}$/;

/** The minimal request the interceptor hands over. */
export interface MockRequest {
  user?: { userId: string };
  params: Record<string, string | undefined>;
  query: Record<string, unknown>;
  body: unknown;
}

type MockHandler = (request: MockRequest) => Promise<unknown>;

/** One entry per WhatsAppController method; the interceptor looks up by method name. */
type MockHandlers = Record<keyof WhatsAppController, MockHandler>;

interface MockConnectionState {
  status: WhatsAppConnectionStatus;
  connectedAt: Date;
  disconnectedAt: Date | null;
}

interface MockStoreState {
  connection: MockConnectionState | null;
  language: WhatsAppLanguage;
  settings: Map<WhatsAppTrigger, { enabled: boolean; delayMinutes: number }>;
}

interface MockStore {
  storeId: string;
  currency: string;
  storeName: string;
  state: MockStoreState;
}

@Injectable()
export class WhatsAppMockService implements OnModuleInit {
  private readonly logger = new Logger(WhatsAppMockService.name);
  private readonly stateByStore = new Map<string, MockStoreState>();

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly storeAccess: StoreAccessService,
  ) {}

  onModuleInit(): void {
    if (this.isEnabled()) {
      this.logger.warn(
        'WHATSAPP_MOCK_DATA=true — /whatsapp/* returns STATIC PREVIEW DATA, not real WhatsApp data',
      );
    }
  }

  isEnabled(): boolean {
    return this.configService.get<string>('WHATSAPP_MOCK_DATA') === 'true';
  }

  /** Returns undefined for handlers that have no mock, so the real one runs. */
  handlerFor(name: string): MockHandler | undefined {
    return Object.prototype.hasOwnProperty.call(this.handlers, name)
      ? this.handlers[name as keyof MockHandlers]
      : undefined;
  }

  private readonly handlers: MockHandlers = {
    config: () => Promise.resolve(this.config()),
    getConnection: async (req) =>
      this.serializeConnection(await this.store(req)),
    connect: async (req) => this.connect(await this.store(req), req.body),
    updateConnection: async (req) =>
      this.updateLanguage(await this.store(req), req.body),
    disconnect: async (req) => this.disconnect(await this.store(req)),
    listStatusSettings: async (req) =>
      this.listStatusSettings(await this.store(req)),
    updateStatusSetting: async (req) =>
      this.updateStatusSetting(
        await this.store(req),
        req.params.trigger,
        req.body,
      ),
    listTemplates: async (req) => this.listTemplates(await this.store(req)),
    syncTemplates: async (req) => this.syncTemplates(await this.store(req)),
    dashboard: async (req) => this.dashboard(await this.store(req)),
    balanceHistory: async (req) =>
      this.balanceHistory(await this.store(req), req.query),
    messages: async (req) => this.messages(await this.store(req), req.query),
    analytics: async (req) => this.analytics(await this.store(req), req.query),
  };

  // ---------- connection ----------

  /** `mock: true` tells the frontend to skip Meta's FB.login popup. */
  private config() {
    return {
      enabled: true,
      appId: null,
      configId: null,
      graphApiVersion: 'v21.0',
      mock: true,
    };
  }

  private connect(store: MockStore, body: unknown) {
    const input = asRecord(body);
    if (typeof input.code !== 'string' || !input.code.trim()) {
      throw new BadRequestException(['code should not be empty']);
    }
    if (
      typeof input.wabaId !== 'string' ||
      !NUMERIC_META_ID.test(input.wabaId)
    ) {
      throw new BadRequestException(['wabaId must be a numeric Meta id']);
    }
    if (
      typeof input.phoneNumberId !== 'string' ||
      !NUMERIC_META_ID.test(input.phoneNumberId)
    ) {
      throw new BadRequestException([
        'phoneNumberId must be a numeric Meta id',
      ]);
    }
    if (input.language !== undefined) {
      store.state.language = parseLanguage(input.language);
    }
    store.state.connection = {
      status: WhatsAppConnectionStatus.ACTIVE,
      connectedAt: new Date(),
      disconnectedAt: null,
    };
    const total = WHATSAPP_TRIGGERS.length * WHATSAPP_LANGUAGES.length;
    return {
      ...this.serializeConnection(store),
      templates: { total, submitted: total, failed: 0 },
    };
  }

  private updateLanguage(store: MockStore, body: unknown) {
    this.requireConnection(store);
    store.state.language = parseLanguage(asRecord(body).language);
    return this.serializeConnection(store);
  }

  private disconnect(store: MockStore) {
    const connection = this.requireConnection(store);
    connection.status = WhatsAppConnectionStatus.DISCONNECTED;
    connection.disconnectedAt = new Date();
    return {
      disconnected: true,
      cancelledMessages: MOCK_MESSAGES.filter(
        (m) => m.status === WhatsAppMessageStatus.SCHEDULED,
      ).length,
    };
  }

  private serializeConnection(store: MockStore) {
    const connection = store.state.connection;
    if (!connection) return { connected: false, connection: null };
    return {
      connected: connection.status === WhatsAppConnectionStatus.ACTIVE,
      connection: {
        id: MOCK_CONNECTION_ID,
        status: connection.status,
        wabaId: MOCK_WABA_ID,
        phoneNumberId: MOCK_PHONE_NUMBER_ID,
        displayPhoneNumber: MOCK_DISPLAY_PHONE_NUMBER,
        verifiedName: store.storeName,
        language: store.state.language,
        lastError: null,
        connectedAt: connection.connectedAt.toISOString(),
        disconnectedAt: connection.disconnectedAt?.toISOString() ?? null,
      },
    };
  }

  private requireConnection(store: MockStore): MockConnectionState {
    if (!store.state.connection) {
      throw new NotFoundException('WhatsApp is not connected');
    }
    return store.state.connection;
  }

  // ---------- settings + templates ----------

  private listStatusSettings(store: MockStore) {
    const language = store.state.language;
    return {
      language,
      variables: TEMPLATE_VARIABLES,
      data: WHATSAPP_TRIGGERS.map((trigger) => {
        const setting = store.state.settings.get(trigger);
        const template = WHATSAPP_TEMPLATES[trigger];
        return {
          trigger,
          enabled: setting?.enabled ?? false,
          delayMinutes: setting?.delayMinutes ?? 0,
          templateName: template.name,
          templateStatus: this.templateState(store, trigger, language).status,
          body: template.bodies[language],
        };
      }),
    };
  }

  private updateStatusSetting(
    store: MockStore,
    trigger: string | undefined,
    body: unknown,
  ) {
    if (!isWhatsAppTrigger(trigger)) {
      throw new BadRequestException(
        `trigger must be one of ${WHATSAPP_TRIGGERS.join(', ')}`,
      );
    }
    const input = asRecord(body);
    if (input.enabled !== undefined && typeof input.enabled !== 'boolean') {
      throw new BadRequestException(['enabled must be a boolean value']);
    }
    if (
      input.delayMinutes !== undefined &&
      (typeof input.delayMinutes !== 'number' ||
        !Number.isInteger(input.delayMinutes) ||
        input.delayMinutes < 0 ||
        input.delayMinutes > MAX_DELAY_MINUTES)
    ) {
      throw new BadRequestException(
        `delayMinutes must be a whole number between 0 and ${MAX_DELAY_MINUTES}`,
      );
    }
    const current = store.state.settings.get(trigger) ?? {
      enabled: false,
      delayMinutes: 0,
    };
    store.state.settings.set(trigger, {
      enabled: input.enabled ?? current.enabled,
      delayMinutes: input.delayMinutes ?? current.delayMinutes,
    });
    return this.listStatusSettings(store).data.find(
      (s) => s.trigger === trigger,
    )!;
  }

  private listTemplates(store: MockStore) {
    const updatedAt = store.state.connection?.connectedAt.toISOString() ?? null;
    return {
      variables: TEMPLATE_VARIABLES,
      data: WHATSAPP_TRIGGERS.flatMap((trigger) => {
        const template = WHATSAPP_TEMPLATES[trigger];
        return WHATSAPP_LANGUAGES.map((language) => {
          const state = this.templateState(store, trigger, language);
          return {
            trigger,
            name: template.name,
            language,
            body: template.bodies[language],
            status: state.status,
            rejectedReason: state.rejectedReason,
            updatedAt: state.submitted ? updatedAt : null,
          };
        });
      }),
    };
  }

  private syncTemplates(store: MockStore) {
    if (store.state.connection?.status !== WhatsAppConnectionStatus.ACTIVE) {
      throw new ConflictException(
        'Reconnect WhatsApp before syncing templates',
      );
    }
    return {
      total: WHATSAPP_TRIGGERS.length * WHATSAPP_LANGUAGES.length,
      submitted: 0,
      failed: 0,
    };
  }

  /** NOT_SUBMITTED until "connected" (same as real); then approved except the overrides. */
  private templateState(
    store: MockStore,
    trigger: WhatsAppTrigger,
    language: WhatsAppLanguage,
  ) {
    if (!store.state.connection) {
      return {
        status: WhatsAppTemplateStatus.NOT_SUBMITTED as string,
        rejectedReason: null as string | null,
        submitted: false,
      };
    }
    const override = MOCK_TEMPLATE_OVERRIDES.find(
      (o) => o.trigger === trigger && o.language === language,
    );
    return {
      status: (override?.status ?? WhatsAppTemplateStatus.APPROVED) as string,
      rejectedReason: override?.rejectedReason ?? null,
      submitted: true,
    };
  }

  // ---------- dashboard, balance, messages, analytics ----------

  private dashboard(store: MockStore) {
    const now = new Date();
    const dayStart = new Date(now);
    dayStart.setUTCHours(0, 0, 0, 0);
    const rows = this.buildMessages(store, now);
    const today = countStatuses(rows.filter((m) => m.createdAt >= dayStart));
    const price = new Prisma.Decimal(MOCK_PRICE_PER_MESSAGE);
    const balance = this.ledger(store, now).balance;
    return {
      connectionStatus: store.state.connection?.status ?? null,
      connected:
        store.state.connection?.status === WhatsAppConnectionStatus.ACTIVE,
      balance: balance.toFixed(2),
      currency: store.currency,
      pricePerMessage: price.toFixed(2),
      messagesRemaining: balance.dividedToIntegerBy(price).toNumber(),
      lowBalance: balance.lessThan(price.times(this.lowBalanceMessages())),
      scheduled: rows.filter(
        (m) => m.status === WhatsAppMessageStatus.SCHEDULED,
      ).length,
      today: {
        sent: today.sent,
        delivered: today.delivered,
        read: today.read,
        failed: today.failed,
        cost: today.cost,
      },
    };
  }

  private balanceHistory(store: MockStore, query: Record<string, unknown>) {
    const { page, limit } = parsePage(query);
    const { balance, entries } = this.ledger(store, new Date());
    const total = entries.length;
    return {
      balance: balance.toFixed(2),
      currency: store.currency,
      data: entries.slice((page - 1) * limit, page * limit),
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  private messages(store: MockStore, query: Record<string, unknown>) {
    const { page, limit } = parsePage(query);
    const status = optionalString(query.status);
    const trigger = optionalString(query.trigger);
    if (
      status &&
      !(Object.values(WhatsAppMessageStatus) as string[]).includes(status)
    ) {
      throw new BadRequestException([
        `status must be one of the following values: ${Object.values(WhatsAppMessageStatus).join(', ')}`,
      ]);
    }
    if (trigger && !isWhatsAppTrigger(trigger)) {
      throw new BadRequestException(
        `trigger must be one of ${WHATSAPP_TRIGGERS.join(', ')}`,
      );
    }
    const rows = this.buildMessages(store, new Date()).filter(
      (m) =>
        (!status || m.status === status) && (!trigger || m.trigger === trigger),
    );
    const total = rows.length;
    return {
      data: rows
        .slice((page - 1) * limit, page * limit)
        .map(({ createdAt, ...row }) => ({
          ...row,
          createdAt: createdAt.toISOString(),
        })),
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  private analytics(store: MockStore, query: Record<string, unknown>) {
    const to = optionalString(query.to);
    const from = optionalString(query.from);
    const end = to ? parseDate(to, 'to') : new Date();
    const start = from
      ? parseDate(from, 'from')
      : new Date(end.getTime() - 30 * DAY_MS);
    if (start >= end) throw new BadRequestException('from must be before to');
    if (end.getTime() - start.getTime() > MAX_RANGE_DAYS * DAY_MS) {
      throw new BadRequestException(
        `The range can cover at most ${MAX_RANGE_DAYS} days`,
      );
    }

    const rows = this.buildMessages(store, new Date()).filter(
      (m) => m.createdAt >= start && m.createdAt < end,
    );
    const totals = countStatuses(rows);
    const days = new Map<string, MockMessageRow[]>();
    for (const row of rows) {
      const day = row.createdAt.toISOString().slice(0, 10);
      days.set(day, [...(days.get(day) ?? []), row]);
    }
    return {
      from: start.toISOString(),
      to: end.toISOString(),
      currency: store.currency,
      totals: {
        ...totals,
        deliveryRate:
          totals.sent > 0
            ? Math.round((totals.delivered / totals.sent) * 1000) / 10
            : null,
        readRate:
          totals.sent > 0
            ? Math.round((totals.read / totals.sent) * 1000) / 10
            : null,
      },
      byTrigger: WHATSAPP_TRIGGERS.map((trigger) => {
        const counts = countStatuses(rows.filter((m) => m.trigger === trigger));
        return {
          trigger,
          sent: counts.sent,
          delivered: counts.delivered,
          failed: counts.failed,
          skipped: counts.skipped,
        };
      }),
      daily: [...days.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, dayRows]) => {
          const counts = countStatuses(dayRows);
          return {
            date,
            sent: counts.sent,
            delivered: counts.delivered,
            failed: counts.failed,
            cost: counts.cost,
          };
        }),
    };
  }

  /** Expands the static specs into message-log rows with times relative to `now`. */
  private buildMessages(store: MockStore, now: Date): MockMessageRow[] {
    const language = store.state.language;
    return MOCK_MESSAGES.map((spec) =>
      toMessageRow(spec, now, language, store),
    ).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  /** Mock top-up, then a charge per message that reached Meta and a refund when Meta failed it. */
  private ledger(store: MockStore, now: Date) {
    const price = new Prisma.Decimal(MOCK_PRICE_PER_MESSAGE);
    const entries: Array<{
      id: string;
      type: WhatsAppBalanceEntryType;
      amount: string;
      currency: string;
      note: string | null;
      messageId: string | null;
      createdAt: string;
    }> = [];
    let balance = new Prisma.Decimal(MOCK_TOP_UP_AMOUNT);
    entries.push({
      id: '00000000-0000-4000-8000-000000000201',
      type: WhatsAppBalanceEntryType.TOP_UP,
      amount: balance.toFixed(2),
      currency: store.currency,
      note: 'Mock top-up (preview data)',
      messageId: null,
      createdAt: new Date(
        now.getTime() - MOCK_TOP_UP_DAYS_AGO * DAY_MS,
      ).toISOString(),
    });
    for (const row of this.buildMessages(store, now)) {
      if (!row.sentAt) continue;
      balance = balance.minus(price);
      entries.push({
        id: row.id.replace('-8000-', '-8001-'),
        type: WhatsAppBalanceEntryType.MESSAGE,
        amount: price.negated().toFixed(2),
        currency: store.currency,
        note: null,
        messageId: row.id,
        createdAt: row.sentAt,
      });
      if (row.status === WhatsAppMessageStatus.FAILED && row.failedAt) {
        balance = balance.plus(price);
        entries.push({
          id: row.id.replace('-8000-', '-8002-'),
          type: WhatsAppBalanceEntryType.REFUND,
          amount: price.toFixed(2),
          currency: store.currency,
          note: null,
          messageId: row.id,
          createdAt: row.failedAt,
        });
      }
    }
    entries.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return { balance, entries };
  }

  private lowBalanceMessages(): number {
    return (
      Number(this.configService.get<string>('WHATSAPP_LOW_BALANCE_MESSAGES')) ||
      DEFAULT_LOW_BALANCE_MESSAGES
    );
  }

  // ---------- store context ----------

  /** Real owner check + real store currency/name; mock state is per store. */
  private async store(request: MockRequest): Promise<MockStore> {
    const access = await requireWhatsAppOwner(
      this.storeAccess,
      request.user?.userId ?? '',
    );
    const store = await this.prisma.store.findUnique({
      where: { id: access.storeId },
      select: { businessName: true },
    });
    let state = this.stateByStore.get(access.storeId);
    if (!state) {
      state = {
        connection: null,
        language: 'fr',
        settings: new Map(
          Object.entries(MOCK_DEFAULT_STATUS_SETTINGS) as Array<
            [WhatsAppTrigger, { enabled: boolean; delayMinutes: number }]
          >,
        ),
      };
      this.stateByStore.set(access.storeId, state);
    }
    return {
      storeId: access.storeId,
      currency: access.baseCurrency,
      storeName: store?.businessName ?? '',
      state,
    };
  }
}

interface MockMessageRow {
  id: string;
  trigger: WhatsAppTrigger;
  status: WhatsAppMessageStatus;
  recipientPhone: string | null;
  templateName: string;
  language: string;
  text: string;
  order: { id: string; orderName: string };
  cost: string | null;
  currency: string;
  errorCode: string | null;
  errorMessage: string | null;
  sendAfter: string;
  sentAt: string | null;
  deliveredAt: string | null;
  readAt: string | null;
  failedAt: string | null;
  createdAt: Date;
}

/** Timestamps follow the real lifecycle: created → sendAfter → sent → delivered → read / failed. */
function toMessageRow(
  spec: MockMessageSpec,
  now: Date,
  language: WhatsAppLanguage,
  store: MockStore,
): MockMessageRow {
  const createdAt = new Date(
    now.getTime() - spec.createdMinutesAgo * MINUTE_MS,
  );
  const sendAfter = new Date(
    createdAt.getTime() + spec.delayMinutes * MINUTE_MS,
  );
  const after = (minutes: number) =>
    new Date(sendAfter.getTime() + minutes * MINUTE_MS).toISOString();

  const reachedMeta =
    spec.status === WhatsAppMessageStatus.SENT ||
    spec.status === WhatsAppMessageStatus.DELIVERED ||
    spec.status === WhatsAppMessageStatus.READ ||
    (spec.status === WhatsAppMessageStatus.FAILED &&
      /^\d+$/.test(spec.errorCode ?? ''));
  const delivered =
    spec.status === WhatsAppMessageStatus.DELIVERED ||
    spec.status === WhatsAppMessageStatus.READ;

  const template = WHATSAPP_TEMPLATES[spec.trigger];
  return {
    id: spec.id,
    trigger: spec.trigger,
    status: spec.status,
    recipientPhone: spec.recipientPhone,
    templateName: template.name,
    language,
    text: renderTemplateBody(template.bodies[language], [
      spec.customerName || CUSTOMER_NAME_FALLBACK[language],
      spec.orderName,
      store.storeName,
    ]),
    order: { id: mockOrderId(spec.id), orderName: spec.orderName },
    cost: reachedMeta ? MOCK_PRICE_PER_MESSAGE : null,
    currency: store.currency,
    errorCode: spec.errorCode ?? null,
    errorMessage: spec.errorMessage ?? null,
    sendAfter: sendAfter.toISOString(),
    sentAt: reachedMeta ? after(0) : null,
    deliveredAt: delivered ? after(2) : null,
    readAt: spec.status === WhatsAppMessageStatus.READ ? after(17) : null,
    failedAt:
      spec.status === WhatsAppMessageStatus.FAILED
        ? after(reachedMeta ? 1 : 0)
        : null,
    createdAt,
  };
}

/** Same counting rules as WhatsAppInsightsService.statusCounts. */
function countStatuses(rows: MockMessageRow[]) {
  const n = (status: WhatsAppMessageStatus) =>
    rows.filter((r) => r.status === status).length;
  const delivered = n(WhatsAppMessageStatus.DELIVERED);
  const read = n(WhatsAppMessageStatus.READ);
  const charged = rows.filter(
    (r) =>
      r.status === WhatsAppMessageStatus.SENT ||
      r.status === WhatsAppMessageStatus.DELIVERED ||
      r.status === WhatsAppMessageStatus.READ,
  );
  return {
    sent: n(WhatsAppMessageStatus.SENT) + delivered + read,
    delivered: delivered + read,
    read,
    failed: n(WhatsAppMessageStatus.FAILED),
    skipped: n(WhatsAppMessageStatus.SKIPPED),
    cost: charged
      .reduce((sum, r) => sum.plus(r.cost ?? 0), new Prisma.Decimal(0))
      .toFixed(2),
  };
}

function parseLanguage(value: unknown): WhatsAppLanguage {
  if (
    typeof value !== 'string' ||
    !(WHATSAPP_LANGUAGES as readonly string[]).includes(value)
  ) {
    throw new BadRequestException([
      `language must be one of the following values: ${WHATSAPP_LANGUAGES.join(', ')}`,
    ]);
  }
  return value as WhatsAppLanguage;
}

function parsePage(query: Record<string, unknown>) {
  const page = query.page === undefined ? 1 : Number(query.page);
  const limit = query.limit === undefined ? 20 : Number(query.limit);
  if (!Number.isInteger(page) || page < 1) {
    throw new BadRequestException(['page must not be less than 1']);
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new BadRequestException(['limit must be between 1 and 100']);
  }
  return { page, limit };
}

function parseDate(value: string, field: string): Date {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new BadRequestException(`${field} must be an ISO 8601 date`);
  }
  return date;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
