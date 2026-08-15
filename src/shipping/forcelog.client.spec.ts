import { ConfigService } from '@nestjs/config';
import { ForceLogClient } from './forcelog.client';

describe('ForceLogClient', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('validates a connection with the authenticated cities endpoint', async () => {
    const fetchMock: jest.MockedFunction<typeof fetch> = jest.fn();
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify([{ ID: 1, NAME: 'Casablanca' }]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    global.fetch = fetchMock;
    const config = {
      get: jest.fn((_key: string, fallback: string) => fallback),
    };
    const client = new ForceLogClient(config as unknown as ConfigService);

    await expect(client.checkConnection('secret-key')).resolves.toEqual([
      { ID: 1, NAME: 'Casablanca' },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.forcelog.ma/customer/Cities');
    expect(options?.method).toBe('GET');
    expect(new Headers(options?.headers).get('X-API-Key')).toBe('secret-key');
  });

  it('maps RECEIVE to the RECEIVER field accepted by ForceLog', async () => {
    const fetchMock: jest.MockedFunction<typeof fetch> = jest.fn();
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ 'ADD-PARCEL': { RESULT: 'SUCCESS' } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    global.fetch = fetchMock;
    const config = {
      get: jest.fn((_key: string, fallback: string) => fallback),
    };
    const client = new ForceLogClient(config as unknown as ConfigService);

    await client.addParcel('secret-key', {
      ORDER_NUM: 'ZM-FL-TEST-001',
      RECEIVE: 'ForceLog Test',
      PHONE: '0612345678',
      CITY: 'RBTVIL',
      ADDRESS: 'Test address, Rabat',
      COD: 100,
      CAN_OPEN: true,
      FRAGILE: false,
    });

    const [, options] = fetchMock.mock.calls[0];
    const headers = new Headers(options?.headers);
    expect(typeof options?.body).toBe('string');
    const body = JSON.parse(options?.body as string) as Record<string, unknown>;
    expect(headers.get('Content-Type')).toBe('application/json');
    expect(body.RECEIVER).toBe('ForceLog Test');
    expect(body.RECEIVE).toBeUndefined();
    expect(body.CITY).toBe('RBTVIL');
    expect(body.CAN_OPEN).toBe(true);
    expect(body.FRAGILE).toBe(false);
  });
});
