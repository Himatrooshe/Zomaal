import { BadGatewayException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AmeexClient } from './ameex.client';

describe('AmeexClient', () => {
  const originalFetch = global.fetch;
  const credentials = { apiId: 'api-id', apiKey: 'api-key' };

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('validates credentials with the documented headers and status endpoint', async () => {
    const fetchMock: jest.MockedFunction<typeof fetch> = jest.fn();
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify([{ CODE: 'DELIVERED', NAME: 'Livré' }]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    global.fetch = fetchMock;
    const config = {
      get: jest.fn((_key: string, fallback: string) => fallback),
    };
    const client = new AmeexClient(config as unknown as ConfigService);

    await expect(client.checkConnection(credentials)).resolves.toEqual([
      { CODE: 'DELIVERED', NAME: 'Livré' },
    ]);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBeInstanceOf(URL);
    expect((url as URL).href).toBe(
      'https://api.ameex.app/customer/Delivery/Parcels/Statuts',
    );
    expect(options?.headers).toMatchObject({
      'C-Api-Id': 'api-id',
      'C-Api-Key': 'api-key',
    });
  });

  it('rejects an HTTP 200 response with an explicit provider error', async () => {
    const fetchMock: jest.MockedFunction<typeof fetch> = jest.fn();
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ RESULT: 'ERROR', MESSAGE: 'Invalid key' }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      ),
    );
    global.fetch = fetchMock;
    const client = new AmeexClient({
      get: jest.fn((_key: string, fallback: string) => fallback),
    } as unknown as ConfigService);

    await expect(client.checkConnection(credentials)).rejects.toBeInstanceOf(
      BadGatewayException,
    );
  });

  it('maps a parcel to Ameex multipart field names', async () => {
    const fetchMock: jest.MockedFunction<typeof fetch> = jest.fn();
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ CODE: 'TGR1223B1EL127' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    global.fetch = fetchMock;
    const client = new AmeexClient({
      get: jest.fn((_key: string, fallback: string) => fallback),
    } as unknown as ConfigService);

    await client.addParcel(credentials, {
      type: 'SIMPLE',
      orderNumber: 'ZM-AM-001',
      receiver: 'Test Receiver',
      phone: '0612345678',
      city: '1',
      address: 'Test address',
      cod: 100,
    });

    const body = fetchMock.mock.calls[0][1]?.body as FormData;
    expect(body.get('business')).toBe('api-id');
    expect(body.get('order_num')).toBe('ZM-AM-001');
    expect(body.get('receiver')).toBe('Test Receiver');
    expect(body.get('cod')).toBe('100');
  });

  it('requests a remote parcel page with DataTables fields', async () => {
    const fetchMock: jest.MockedFunction<typeof fetch> = jest.fn();
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ recordsTotal: 0, data: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    global.fetch = fetchMock;
    const client = new AmeexClient({
      get: jest.fn((_key: string, fallback: string) => fallback),
    } as unknown as ConfigService);

    await client.listParcels(credentials, { start: 100, length: 50 });

    const [url, options] = fetchMock.mock.calls[0];
    expect((url as URL).pathname).toBe('/customer/Delivery/Parcels/Json');
    const body = options?.body as FormData;
    expect(body.get('start')).toBe('100');
    expect(body.get('length')).toBe('50');
    expect(body.get('search[value]')).toBeNull();
    expect(body.get('date[from]')).toBe('01/01/2000');
    expect(body.get('date[to]')).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);
    expect(body.get('all_data')).toBe('1');
  });

  it('sends one comma-separated mass-tracking request', async () => {
    const fetchMock: jest.MockedFunction<typeof fetch> = jest.fn();
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ data: {} }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    global.fetch = fetchMock;
    const client = new AmeexClient({
      get: jest.fn((_key: string, fallback: string) => fallback),
    } as unknown as ConfigService);

    await client.massTracking(credentials, { codes: ['AM-1', 'AM-2'] });

    const [url, options] = fetchMock.mock.calls[0];
    expect((url as URL).pathname).toBe(
      '/customer/Delivery/Parcels/MassTracking',
    );
    expect((options?.body as FormData).get('codes')).toBe('AM-1,AM-2');
  });
});
