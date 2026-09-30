import {
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SenditClient } from './sendit.client';

describe('SenditClient', () => {
  const originalFetch = global.fetch;
  const credentials = { publicKey: 'public-key', secretKey: 'secret-key' };

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('authenticates with the documented credential field names and timeout', async () => {
    const fetchMock: jest.MockedFunction<typeof fetch> = jest.fn();
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          message: 'Authenticated',
          data: { token: 'token', name: 'Store' },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    global.fetch = fetchMock;
    const client = new SenditClient(config());

    await expect(client.authenticate(credentials)).resolves.toMatchObject({
      success: true,
      data: { token: 'token' },
    });

    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('https://app.sendit.ma/api/v1/login');
    expect(options?.body).toBe(
      JSON.stringify({
        public_key: 'public-key',
        secret_key: 'secret-key',
      }),
    );
    expect(options?.signal).toBeInstanceOf(AbortSignal);
  });

  it('preserves provider credential rejection as unauthorized', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ success: false, message: 'Unauthorized' }),
          { status: 401, headers: { 'Content-Type': 'application/json' } },
        ),
      );
    const client = new SenditClient(config());

    await expect(client.authenticate(credentials)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('maps network failures to service unavailable', async () => {
    global.fetch = jest.fn().mockRejectedValue(new TypeError('fetch failed'));
    const client = new SenditClient(config());

    await expect(client.authenticate(credentials)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});

function config() {
  return {
    get: jest.fn((key: string, fallback: unknown) => {
      if (key === 'SENDIT_API_TIMEOUT_MS') return 2500;
      return fallback;
    }),
  } as unknown as ConfigService;
}
