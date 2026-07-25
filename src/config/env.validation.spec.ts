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

describe('validateEnvironment YouCan configuration', () => {
  const encryptionKey = Buffer.alloc(32, 2).toString('base64');
  const base = {
    DATABASE_URL: 'postgresql://postgres:password@localhost:5434/zomaal',
    JWT_SECRET: 'a-secure-test-jwt-secret-with-32-characters',
    SHIPPING_CREDENTIAL_ENCRYPTION_KEY: encryptionKey,
  };

  it('derives the callback and applies the documented wildcard scope', () => {
    const result = validateEnvironment({
      ...base,
      YOUCAN_CLIENT_ID: 'client-id',
      YOUCAN_CLIENT_SECRET: 'client-secret',
      YOUCAN_APP_URL: 'https://api.example.com',
      YOUCAN_TOKEN_ENCRYPTION_KEY: encryptionKey,
    });

    expect(result.YOUCAN_ENABLED).toBe(true);
    expect(result.YOUCAN_REDIRECT_URI).toBe(
      'https://api.example.com/auth/youcan/callback',
    );
    expect(result.YOUCAN_SCOPES).toBe('*');
  });

  it('normalizes legacy generic YouCan credential names', () => {
    const result = validateEnvironment({
      ...base,
      CLIENT_ID: 'legacy-client-id',
      CLIENT_SECRET: 'legacy-client-secret',
      YOUCAN_APP_URL: 'https://api.example.com',
      YOUCAN_TOKEN_ENCRYPTION_KEY: encryptionKey,
    });

    expect(result.YOUCAN_ENABLED).toBe(true);
    expect(result.YOUCAN_CLIENT_ID).toBe('legacy-client-id');
    expect(result.YOUCAN_CLIENT_SECRET).toBe('legacy-client-secret');
  });

  it('requires a dedicated encryption key when enabled', () => {
    expect(() =>
      validateEnvironment({
        ...base,
        YOUCAN_ENABLED: 'true',
        YOUCAN_CLIENT_ID: 'client-id',
        YOUCAN_CLIENT_SECRET: 'client-secret',
        YOUCAN_APP_URL: 'https://api.example.com',
      }),
    ).toThrow('YOUCAN_TOKEN_ENCRYPTION_KEY');
  });

  it('requires view-store-info to identify the connected account', () => {
    expect(() =>
      validateEnvironment({
        ...base,
        YOUCAN_CLIENT_ID: 'client-id',
        YOUCAN_CLIENT_SECRET: 'client-secret',
        YOUCAN_APP_URL: 'https://api.example.com',
        YOUCAN_TOKEN_ENCRYPTION_KEY: encryptionKey,
        YOUCAN_SCOPES: 'read-orders',
      }),
    ).toThrow('view-store-info');
  });

  it('requires the wildcard scope to be used alone', () => {
    expect(() =>
      validateEnvironment({
        ...base,
        YOUCAN_CLIENT_ID: 'client-id',
        YOUCAN_CLIENT_SECRET: 'client-secret',
        YOUCAN_APP_URL: 'https://api.example.com',
        YOUCAN_TOKEN_ENCRYPTION_KEY: encryptionKey,
        YOUCAN_SCOPES: '*,read-orders',
      }),
    ).toThrow('YOUCAN_SCOPES must use * alone');
  });
});

describe('validateEnvironment Lightfunnels configuration', () => {
  const encryptionKey = Buffer.alloc(32, 3).toString('base64');
  const base = {
    DATABASE_URL: 'postgresql://postgres:password@localhost:5434/zomaal',
    JWT_SECRET: 'a-secure-test-jwt-secret-with-32-characters',
    SHIPPING_CREDENTIAL_ENCRYPTION_KEY: encryptionKey,
  };

  it('derives the callback and applies the minimum revenue scopes', () => {
    const result = validateEnvironment({
      ...base,
      LIGHTFUNNELS_CLIENT_ID: 'client-id',
      LIGHTFUNNELS_CLIENT_SECRET: 'client-secret',
      LIGHTFUNNELS_APP_URL: 'http://localhost:3001',
      LIGHTFUNNELS_TOKEN_ENCRYPTION_KEY: encryptionKey,
    });

    expect(result.LIGHTFUNNELS_ENABLED).toBe(true);
    expect(result.LIGHTFUNNELS_REDIRECT_URI).toBe(
      'http://localhost:3001/auth/lightfunnels/callback',
    );
    expect(result.LIGHTFUNNELS_SCOPES).toBe('funnels,orders');
  });

  it('requires the orders and funnels scopes', () => {
    expect(() =>
      validateEnvironment({
        ...base,
        LIGHTFUNNELS_CLIENT_ID: 'client-id',
        LIGHTFUNNELS_CLIENT_SECRET: 'client-secret',
        LIGHTFUNNELS_APP_URL: 'http://localhost:3001',
        LIGHTFUNNELS_TOKEN_ENCRYPTION_KEY: encryptionKey,
        LIGHTFUNNELS_SCOPES: 'orders',
      }),
    ).toThrow('LIGHTFUNNELS_SCOPES must include funnels');
  });

  it('requires a dedicated encryption key when enabled', () => {
    expect(() =>
      validateEnvironment({
        ...base,
        LIGHTFUNNELS_ENABLED: 'true',
        LIGHTFUNNELS_CLIENT_ID: 'client-id',
        LIGHTFUNNELS_CLIENT_SECRET: 'client-secret',
        LIGHTFUNNELS_APP_URL: 'http://localhost:3001',
      }),
    ).toThrow('LIGHTFUNNELS_TOKEN_ENCRYPTION_KEY');
  });
});
