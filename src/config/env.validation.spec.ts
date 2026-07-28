import { validateEnvironment } from './env.validation';

describe('validateEnvironment OAuth completion redirects', () => {
  const encryptionKey = Buffer.alloc(32, 4).toString('base64');
  const base = {
    DATABASE_URL: 'postgresql://postgres:password@localhost:5434/zomaal',
    JWT_SECRET: 'a-secure-test-jwt-secret-with-32-characters',
    SHIPPING_CREDENTIAL_ENCRYPTION_KEY: encryptionKey,
  };

  it('accepts an explicitly allowlisted mobile deep-link scheme', () => {
    const result = validateEnvironment({
      ...base,
      OAUTH_MOBILE_REDIRECT_SCHEMES: 'zomaal',
      SHOPIFY_AUTH_SUCCESS_REDIRECT_URL:
        'zomaal://settings/integrations/shopify',
      YOUCAN_AUTH_FAILURE_REDIRECT_URL: 'zomaal://settings/integrations/youcan',
      LIGHTFUNNELS_AUTH_SUCCESS_REDIRECT_URL:
        'zomaal://settings/integrations/lightfunnels',
    });

    expect(result.OAUTH_MOBILE_REDIRECT_SCHEMES).toBe('zomaal');
  });

  it('rejects custom schemes that are not explicitly allowlisted', () => {
    expect(() =>
      validateEnvironment({
        ...base,
        OAUTH_MOBILE_REDIRECT_SCHEMES: 'zomaal',
        LIGHTFUNNELS_AUTH_SUCCESS_REDIRECT_URL:
          'untrusted://settings/integrations/lightfunnels',
      }),
    ).toThrow(
      'LIGHTFUNNELS_AUTH_SUCCESS_REDIRECT_URL must be an absolute HTTP or HTTPS URL or use an allowed mobile scheme (zomaal://)',
    );
  });

  it('rejects executable URL schemes', () => {
    expect(() =>
      validateEnvironment({
        ...base,
        OAUTH_MOBILE_REDIRECT_SCHEMES: 'zomaal',
        SHOPIFY_AUTH_FAILURE_REDIRECT_URL: 'javascript:alert(1)',
      }),
    ).toThrow('SHOPIFY_AUTH_FAILURE_REDIRECT_URL');
  });
});

describe('validateEnvironment scheduled e-commerce synchronization', () => {
  const encryptionKey = Buffer.alloc(32, 5).toString('base64');
  const base = {
    DATABASE_URL: 'postgresql://postgres:password@localhost:5434/zomaal',
    JWT_SECRET: 'a-secure-test-jwt-secret-with-32-characters',
    SHIPPING_CREDENTIAL_ENCRYPTION_KEY: encryptionKey,
  };

  it('requires a strong secret when the scheduler is enabled', () => {
    expect(() =>
      validateEnvironment({
        ...base,
        ECOMMERCE_SYNC_SCHEDULER_ENABLED: 'true',
        ECOMMERCE_SYNC_SCHEDULER_SECRET: 'too-short',
      }),
    ).toThrow('ECOMMERCE_SYNC_SCHEDULER_SECRET must be at least 32 characters');
  });

  it('normalizes safe scheduler limits', () => {
    const result = validateEnvironment({
      ...base,
      ECOMMERCE_SYNC_SCHEDULER_ENABLED: 'true',
      ECOMMERCE_SYNC_SCHEDULER_SECRET: 'a'.repeat(32),
      ECOMMERCE_SYNC_CONCURRENCY: '4',
      ECOMMERCE_SYNC_MAX_CONNECTIONS: '250',
      ECOMMERCE_SYNC_MIN_INTERVAL_MINUTES: '30',
    });

    expect(result.ECOMMERCE_SYNC_SCHEDULER_ENABLED).toBe(true);
    expect(result.ECOMMERCE_SYNC_CONCURRENCY).toBe(4);
    expect(result.ECOMMERCE_SYNC_MAX_CONNECTIONS).toBe(250);
    expect(result.ECOMMERCE_SYNC_MIN_INTERVAL_MINUTES).toBe(30);
  });

  it('rejects unsafe scheduler limits', () => {
    expect(() =>
      validateEnvironment({
        ...base,
        ECOMMERCE_SYNC_CONCURRENCY: '11',
      }),
    ).toThrow('ECOMMERCE_SYNC_CONCURRENCY');
  });
});

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

  it('requires product and inventory write scopes when enabled', () => {
    expect(() =>
      validateEnvironment({
        ...base,
        SHOPIFY_API_KEY: 'client-id',
        SHOPIFY_API_SECRET: 'client-secret',
        SHOPIFY_APP_URL: 'https://api.example.com',
        SHOPIFY_TOKEN_ENCRYPTION_KEY: encryptionKey,
        SHOPIFY_SCOPES: 'read_products,read_locations',
      }),
    ).toThrow('write_products');
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

  it('requires edit-products when using explicit scopes', () => {
    expect(() =>
      validateEnvironment({
        ...base,
        YOUCAN_CLIENT_ID: 'client-id',
        YOUCAN_CLIENT_SECRET: 'client-secret',
        YOUCAN_APP_URL: 'https://api.example.com',
        YOUCAN_TOKEN_ENCRYPTION_KEY: encryptionKey,
        YOUCAN_SCOPES: 'view-store-info,read-orders',
      }),
    ).toThrow('edit-products');
  });

  it('requires upload-media when using explicit scopes', () => {
    expect(() =>
      validateEnvironment({
        ...base,
        YOUCAN_CLIENT_ID: 'client-id',
        YOUCAN_CLIENT_SECRET: 'client-secret',
        YOUCAN_APP_URL: 'https://api.example.com',
        YOUCAN_TOKEN_ENCRYPTION_KEY: encryptionKey,
        YOUCAN_SCOPES: 'view-store-info,edit-products',
      }),
    ).toThrow('upload-media');
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
