import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OzoneExpressClient } from './ozoneexpress.client';

describe('OzoneExpressClient', () => {
  const originalFetch = global.fetch;
  const credentials = { customerId: '12345', apiKey: 'secret-key' };

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('accepts credentials only when CHECK_API reports SUCCESS', async () => {
    const fetchMock: jest.MockedFunction<typeof fetch> = jest.fn();
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          CHECK_API: { RESULT: 'SUCCESS', MESSAGE: 'Valide API Key' },
          'PARCEL-INFO': {},
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    global.fetch = fetchMock;
    const config = {
      get: jest.fn((_key: string, fallback: string) => fallback),
    };
    const client = new OzoneExpressClient(config as unknown as ConfigService);

    await expect(client.checkConnection(credentials)).resolves.toEqual({
      authenticated: true,
    });
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe(
      'https://api.ozonexpress.ma/customers/12345/secret-key/parcel-info',
    );
    expect(options?.method).toBe('POST');
    expect(options?.body).toBeInstanceOf(FormData);
  });

  it('rejects HTTP 200 responses when CHECK_API reports ERROR', async () => {
    const fetchMock: jest.MockedFunction<typeof fetch> = jest.fn();
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          CHECK_API: {
            RESULT: 'ERROR',
            MESSAGE: 'Please verify your API Key',
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    global.fetch = fetchMock;
    const config = {
      get: jest.fn((_key: string, fallback: string) => fallback),
    };
    const client = new OzoneExpressClient(config as unknown as ConfigService);

    await expect(client.checkConnection(credentials)).rejects.toEqual(
      expect.any(UnauthorizedException),
    );
  });
});
