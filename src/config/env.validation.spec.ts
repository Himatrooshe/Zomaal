import { validateEnvironment } from './env.validation';

describe('validateEnvironment Shopify configuration', () => {
  const encryptionKey = Buffer.alloc(32, 1).toString('base64');
  const base = {
    DATABASE_URL: 'postgresql://postgres:password@localhost:5434/zomaal',
    JWT_SECRET: 'a-secure-test-jwt-secret-with-32-characters',
    SHIPPING_CREDENTIAL_ENCRYPTION_KEY: encryptionKey,
  };

  it('prefers the Shopify CLI tunnel over stale localhost URLs', () => {
    const result = validateEnvironment({
      ...base,
      SHOPIFY_API_KEY: 'client-id',
      SHOPIFY_API_SECRET: 'client-secret',
      SHOPIFY_TOKEN_ENCRYPTION_KEY: encryptionKey,
      SHOPIFY_APP_URL: 'http://localhost:3001',
      SHOPIFY_REDIRECT_URI: 'http://localhost:3001/auth/shopify/callback',
      APP_URL: 'https://temporary-tunnel.example.com',
    });

    expect(result.SHOPIFY_APP_URL).toBe(
      'https://temporary-tunnel.example.com/',
    );
    expect(result.SHOPIFY_REDIRECT_URI).toBe(
      'https://temporary-tunnel.example.com/auth/shopify/callback',
    );
  });

  it('requires a dedicated token encryption key when enabled', () => {
    expect(() =>
      validateEnvironment({
        ...base,
        SHOPIFY_ENABLED: 'true',
        SHOPIFY_API_KEY: 'client-id',
        SHOPIFY_API_SECRET: 'client-secret',
        SHOPIFY_APP_URL: 'https://api.example.com',
      }),
    ).toThrow('SHOPIFY_TOKEN_ENCRYPTION_KEY');
  });
});
