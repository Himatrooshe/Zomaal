// TEMPORARY — tests for the frontend preview mock; delete with src/whatsapp/mock/.
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  type CallHandler,
  type ExecutionContext,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom, of } from 'rxjs';
import type { StoreAccessService } from '../../access/store-access.service';
import type { PrismaService } from '../../prisma/prisma.service';
import { MOCK_DATA_HEADER, MOCK_MESSAGES } from './whatsapp-mock.fixtures';
import { WhatsAppMockInterceptor } from './whatsapp-mock.interceptor';
import { WhatsAppMockService, type MockRequest } from './whatsapp-mock.service';

interface MessageRow {
  status: string;
  text: string;
}
interface TemplateRow {
  status: string;
}
interface SettingRow {
  trigger: string;
  enabled: boolean;
  delayMinutes: number;
}
interface Page<T> {
  data: T[];
  meta: { page: number; limit: number; total: number };
}

function build(env: Record<string, string>, isOwner = true) {
  const config = new ConfigService(env);
  const storeAccess = {
    require: jest.fn().mockResolvedValue({
      storeId: 'store-1',
      baseCurrency: 'EUR',
      userId: 'user-1',
      isOwner,
      staffMemberId: null,
      permissions: [],
    }),
  } as unknown as StoreAccessService;
  const prisma = {
    store: {
      findUnique: jest.fn().mockResolvedValue({ businessName: 'Test Store' }),
    },
  } as unknown as PrismaService;
  return new WhatsAppMockService(config, prisma, storeAccess);
}

function call<T = unknown>(
  service: WhatsAppMockService,
  handler: string,
  request: Partial<MockRequest> = {},
): Promise<T> {
  return service.handlerFor(handler)!({
    user: { userId: 'user-1' },
    params: {},
    query: {},
    body: {},
    ...request,
  }) as Promise<T>;
}

async function validationMessages(promise: Promise<unknown>) {
  const error: unknown = await promise.catch((e: unknown) => e);
  expect(error).toBeInstanceOf(BadRequestException);
  return ((error as BadRequestException).getResponse() as { message: unknown })
    .message;
}

const connectBody = {
  code: 'any-code',
  wabaId: '100000000000000',
  phoneNumberId: '100000000000001',
};

describe('WhatsAppMockService (temporary preview data)', () => {
  it('interceptor runs the real handler when WHATSAPP_MOCK_DATA is off', async () => {
    const interceptor = new WhatsAppMockInterceptor(build({}));
    const next: CallHandler = { handle: () => of('real') };
    const context = {
      getHandler: () => ({ name: 'dashboard' }),
    } as unknown as ExecutionContext;
    await expect(
      firstValueFrom(interceptor.intercept(context, next)),
    ).resolves.toBe('real');
  });

  it('interceptor answers from the mock and flags the response when on', async () => {
    const interceptor = new WhatsAppMockInterceptor(
      build({ WHATSAPP_MOCK_DATA: 'true' }),
    );
    const setHeader = jest.fn();
    const context = {
      getHandler: () => ({ name: 'config' }),
      switchToHttp: () => ({
        getRequest: () => ({ params: {}, query: {}, body: {} }),
        getResponse: () => ({ setHeader }),
      }),
    } as unknown as ExecutionContext;
    const next: CallHandler = { handle: () => of('real') };
    await expect(
      firstValueFrom(interceptor.intercept(context, next)),
    ).resolves.toMatchObject({ enabled: true, mock: true, appId: null });
    expect(setHeader).toHaveBeenCalledWith(MOCK_DATA_HEADER, 'true');
  });

  it('keeps the owner-only rule', async () => {
    const service = build({ WHATSAPP_MOCK_DATA: 'true' }, false);
    await expect(call(service, 'dashboard')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('walks connect → language → disconnect like the real flow', async () => {
    const service = build({ WHATSAPP_MOCK_DATA: 'true' });
    await expect(call(service, 'getConnection')).resolves.toEqual({
      connected: false,
      connection: null,
    });
    const before = await call<Page<TemplateRow>>(service, 'listTemplates');
    expect(before.data.every((t) => t.status === 'NOT_SUBMITTED')).toBe(true);

    const connected = await call(service, 'connect', { body: connectBody });
    expect(connected).toMatchObject({
      connected: true,
      connection: { status: 'ACTIVE', verifiedName: 'Test Store' },
      templates: { total: 24, submitted: 24, failed: 0 },
    });
    const after = await call<Page<TemplateRow>>(service, 'listTemplates');
    const statuses = after.data.map((t) => t.status);
    expect(statuses.every((s) => typeof s === 'string')).toBe(true);
    expect(statuses).toContain('APPROVED');
    expect(statuses).toContain('PENDING');
    expect(statuses).toContain('REJECTED');

    await call(service, 'updateConnection', { body: { language: 'en' } });
    const settings = await call<{ language: string }>(
      service,
      'listStatusSettings',
    );
    expect(settings.language).toBe('en');

    await expect(call(service, 'disconnect')).resolves.toEqual({
      disconnected: true,
      cancelledMessages: 1,
    });
    await expect(call(service, 'getConnection')).resolves.toMatchObject({
      connected: false,
      connection: { status: 'DISCONNECTED' },
    });
  });

  it('rejects the same bad input as the real endpoints', async () => {
    const service = build({ WHATSAPP_MOCK_DATA: 'true' });
    await expect(
      call(service, 'connect', { body: { ...connectBody, wabaId: 'abc' } }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      call(service, 'updateStatusSetting', {
        params: { trigger: 'DELIVERED' },
        body: { delayMinutes: 999999 },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      call(service, 'updateStatusSetting', {
        params: { trigger: 'NOPE' },
        body: { enabled: true },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(call(service, 'disconnect')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('rejects unknown fields like the global ValidationPipe', async () => {
    const service = build({ WHATSAPP_MOCK_DATA: 'true' });
    const error = await validationMessages(
      call(service, 'updateStatusSetting', {
        params: { trigger: 'DELIVERED' },
        body: { enabled: true, unknownField: 'x' },
      }),
    );
    expect(error).toEqual(['property unknownField should not exist']);
  });

  it('returns every validation error for an empty connect body', async () => {
    const service = build({ WHATSAPP_MOCK_DATA: 'true' });
    const error = await validationMessages(
      call(service, 'connect', { body: {} }),
    );
    expect(error).toEqual(
      expect.arrayContaining([
        'code should not be empty',
        'wabaId must be a numeric Meta id',
        'phoneNumberId must be a numeric Meta id',
      ]),
    );
  });

  it('validates query strings with the real DTOs', async () => {
    const service = build({ WHATSAPP_MOCK_DATA: 'true' });
    await expect(
      call(service, 'messages', { query: { limit: '500' } }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      call(service, 'analytics', { query: { from: 'yesterday' } }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('remembers status settings per store in memory', async () => {
    const service = build({ WHATSAPP_MOCK_DATA: 'true' });
    const updated = await call(service, 'updateStatusSetting', {
      params: { trigger: 'IN_TRANSIT' },
      body: { enabled: true, delayMinutes: 15 },
    });
    expect(updated).toMatchObject({
      trigger: 'IN_TRANSIT',
      enabled: true,
      delayMinutes: 15,
    });
    const list = await call<Page<SettingRow>>(service, 'listStatusSettings');
    expect(list.data.find((s) => s.trigger === 'IN_TRANSIT')).toMatchObject({
      enabled: true,
      delayMinutes: 15,
    });
  });

  it('shows the same numbers on dashboard, balance history and analytics', async () => {
    const service = build({ WHATSAPP_MOCK_DATA: 'true' });
    const [dashboard, history, analytics, messages] = await Promise.all([
      call<{ currency: string; balance: string }>(service, 'dashboard'),
      call<Page<{ amount: string }> & { balance: string }>(
        service,
        'balanceHistory',
        { query: { limit: '100' } },
      ),
      call<{ totals: { sent: number } }>(service, 'analytics'),
      call<Page<MessageRow>>(service, 'messages', {
        query: { limit: '100' },
      }),
    ]);

    expect(dashboard.currency).toBe('EUR');
    expect(dashboard.balance).toBe(history.balance);
    const ledgerSum = history.data.reduce(
      (sum, e) => sum + Number(e.amount),
      0,
    );
    expect(ledgerSum.toFixed(2)).toBe(history.balance);
    expect(messages.meta.total).toBe(MOCK_MESSAGES.length);
    expect(analytics.totals.sent).toBe(
      messages.data.filter((m) =>
        ['SENT', 'DELIVERED', 'READ'].includes(m.status),
      ).length,
    );
    expect(messages.data.every((m) => m.text.includes('Test Store'))).toBe(
      true,
    );
  });

  it('filters and paginates the message log', async () => {
    const service = build({ WHATSAPP_MOCK_DATA: 'true' });
    const failed = await call<Page<MessageRow>>(service, 'messages', {
      query: { status: 'FAILED' },
    });
    expect(failed.data.length).toBeGreaterThan(0);
    expect(failed.data.every((m) => m.status === 'FAILED')).toBe(true);

    const page2 = await call<Page<MessageRow>>(service, 'messages', {
      query: { page: '2', limit: '5' },
    });
    expect(page2.meta).toMatchObject({ page: 2, limit: 5 });
    expect(page2.data).toHaveLength(5);
  });
});
