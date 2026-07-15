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
});
