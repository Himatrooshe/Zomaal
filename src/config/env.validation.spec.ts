import { validateEnvironment } from './env.validation';

describe('validateEnvironment Snapchat Marketing API', () => {
  const base = {
    DATABASE_URL: 'postgresql://local/test',
    JWT_SECRET: 'x'.repeat(40),
    SHIPPING_CREDENTIAL_ENCRYPTION_KEY: Buffer.alloc(32, 6).toString('base64'),
  };
  const snap = {
    SNAPCHAT_ADS_ENABLED: 'true',
    SNAPCHAT_ADS_CLIENT_ID: 'fake-client',
    SNAPCHAT_ADS_CLIENT_SECRET: 'fake-secret',
    SNAPCHAT_ADS_REDIRECT_URI: 'https://api.example/auth/snapchat-ads/callback',
    ADS_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
  };
  it('defaults to disabled without requiring provider credentials', () => {
    expect(validateEnvironment(base).SNAPCHAT_ADS_ENABLED).toBe('false');
  });
  it('accepts complete HTTPS OAuth configuration', () => {
    expect(validateEnvironment({ ...base, ...snap }).SNAPCHAT_ADS_ENABLED).toBe(
      'true',
    );
  });
  it.each(['SNAPCHAT_ADS_CLIENT_ID', 'SNAPCHAT_ADS_CLIENT_SECRET'])(
    'requires %s when enabled',
    (key) => {
      expect(() =>
        validateEnvironment({ ...base, ...snap, [key]: '' }),
      ).toThrow(key);
    },
  );
  it('requires the exact HTTPS callback path', () => {
    expect(() =>
      validateEnvironment({
        ...base,
        ...snap,
        SNAPCHAT_ADS_REDIRECT_URI: 'http://api.example/other',
      }),
    ).toThrow('Snapchat redirect');
  });
  it('requires a valid shared encryption key', () => {
    expect(() =>
      validateEnvironment({
        ...base,
        ...snap,
        ADS_TOKEN_ENCRYPTION_KEY: 'bad',
      }),
    ).toThrow('ADS_TOKEN_ENCRYPTION_KEY');
  });
  it('bounds timeout and state expiration settings', () => {
    expect(() =>
      validateEnvironment({
        ...base,
        ...snap,
        SNAPCHAT_ADS_HTTP_TIMEOUT_MS: '0',
      }),
    ).toThrow('SNAPCHAT_ADS_HTTP_TIMEOUT_MS');
  });
  it('rejects unsafe frontend redirects', () => {
    expect(() =>
      validateEnvironment({
        ...base,
        ...snap,
        SNAPCHAT_ADS_AUTH_SUCCESS_REDIRECT_URL: 'javascript:alert(1)',
      }),
    ).toThrow('SNAPCHAT_ADS_AUTH_SUCCESS_REDIRECT_URL');
  });
});

describe('validateEnvironment warehouse image storage', () => {
  const base = {
    DATABASE_URL: 'postgresql://postgres:password@localhost:5434/zomaal',
    JWT_SECRET: 'a-secure-test-jwt-secret-with-32-characters',
    SHIPPING_CREDENTIAL_ENCRYPTION_KEY: Buffer.alloc(32, 6).toString('base64'),
  };

  it('requires a product image bucket in production', () => {
    expect(() =>
      validateEnvironment({ ...base, NODE_ENV: 'production' }),
    ).toThrow('PRODUCT_IMAGE_BUCKET is required in production');
  });

  it('accepts and normalizes the configured product image bucket', () => {
    const result = validateEnvironment({
      ...base,
      NODE_ENV: 'production',
      PRODUCT_IMAGE_BUCKET: ' zomaal-product-images-prod-zomaal ',
    });

    expect(result.PRODUCT_IMAGE_BUCKET).toBe(
      'zomaal-product-images-prod-zomaal',
    );
  });

  it('rejects invalid Cloud Storage bucket names', () => {
    expect(() =>
      validateEnvironment({
        ...base,
        PRODUCT_IMAGE_BUCKET: 'Invalid Bucket Name',
      }),
    ).toThrow('not a valid Cloud Storage bucket name');
  });
});

describe('validateEnvironment demo login', () => {
  const base = {
    DATABASE_URL: 'postgresql://postgres:password@localhost:5434/zomaal',
    JWT_SECRET: 'a-secure-test-jwt-secret-with-32-characters',
    SHIPPING_CREDENTIAL_ENCRYPTION_KEY: Buffer.alloc(32, 6).toString('base64'),
    PRODUCT_IMAGE_BUCKET: 'zomaal-product-images-test',
  };
  const demoLogin = {
    LOGGER_PHONE: '+212612345678',
    LOGGER_PASSWORD: 'a-test-password',
  };

  it('refuses a demo login in production', () => {
    expect(() =>
      validateEnvironment({ ...base, ...demoLogin, NODE_ENV: 'production' }),
    ).toThrow('must not be set in production');
  });

  it('allows a demo login outside production', () => {
    expect(() =>
      validateEnvironment({ ...base, ...demoLogin, NODE_ENV: 'development' }),
    ).not.toThrow();
  });
});

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

  it('derives the callback and applies all required e-commerce scopes', () => {
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
    expect(result.LIGHTFUNNELS_SCOPES).toBe(
      'customers,funnels,orders,products',
    );
  });

  it('requires the orders, funnels, products, and customers scopes', () => {
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

    expect(() =>
      validateEnvironment({
        ...base,
        LIGHTFUNNELS_CLIENT_ID: 'client-id',
        LIGHTFUNNELS_CLIENT_SECRET: 'client-secret',
        LIGHTFUNNELS_APP_URL: 'http://localhost:3001',
        LIGHTFUNNELS_TOKEN_ENCRYPTION_KEY: encryptionKey,
        LIGHTFUNNELS_SCOPES: 'orders,funnels,customers',
      }),
    ).toThrow('LIGHTFUNNELS_SCOPES must include products');

    expect(() =>
      validateEnvironment({
        ...base,
        LIGHTFUNNELS_CLIENT_ID: 'client-id',
        LIGHTFUNNELS_CLIENT_SECRET: 'client-secret',
        LIGHTFUNNELS_APP_URL: 'http://localhost:3001',
        LIGHTFUNNELS_TOKEN_ENCRYPTION_KEY: encryptionKey,
        LIGHTFUNNELS_SCOPES: 'orders,funnels,products',
      }),
    ).toThrow('LIGHTFUNNELS_SCOPES must include customers');
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

describe('salary scheduler configuration', () => {
  const base = {
    DATABASE_URL: 'postgresql://localhost/test',
    JWT_SECRET: 'x'.repeat(32),
    SHIPPING_CREDENTIAL_ENCRYPTION_KEY: Buffer.alloc(32).toString('base64'),
  };
  it('defaults to disabled and requires a strong secret when enabled', () => {
    expect(validateEnvironment(base).STAFF_SALARY_SCHEDULER_ENABLED).toBe(
      'false',
    );
    expect(() =>
      validateEnvironment({
        ...base,
        STAFF_SALARY_SCHEDULER_ENABLED: 'true',
        STAFF_SALARY_SCHEDULER_SECRET: 'short',
      }),
    ).toThrow('STAFF_SALARY_SCHEDULER_SECRET');
    expect(
      validateEnvironment({
        ...base,
        STAFF_SALARY_SCHEDULER_ENABLED: 'true',
        STAFF_SALARY_SCHEDULER_SECRET: 'x'.repeat(32),
      }).STAFF_SALARY_SCHEDULER_ENABLED,
    ).toBe('true');
  });
  it('rejects a misspelled enabled flag', () => {
    expect(() =>
      validateEnvironment({ ...base, STAFF_SALARY_SCHEDULER_ENABLED: 'yes' }),
    ).toThrow('STAFF_SALARY_SCHEDULER_ENABLED');
  });
});

describe('validateEnvironment Meta Ads', () => {
  const base = {
    DATABASE_URL: 'postgresql://postgres:password@localhost:5434/zomaal',
    JWT_SECRET: 'a-secure-test-jwt-secret-with-32-characters',
    SHIPPING_CREDENTIAL_ENCRYPTION_KEY: Buffer.alloc(32, 6).toString('base64'),
    PRODUCT_IMAGE_BUCKET: 'zomaal-product-images-test',
  };
  const enabled = {
    META_ADS_ENABLED: 'true',
    META_ADS_REDIRECT_URI: 'https://api.example.test/auth/meta-ads/callback',
  };

  it('needs app credentials and a redirect URI when enabled', () => {
    expect(() =>
      validateEnvironment({ ...base, META_ADS_ENABLED: 'true' }),
    ).toThrow(
      /META_ADS_APP_ID \(or META_APP_ID\).*META_ADS_APP_SECRET \(or META_APP_SECRET\).*META_ADS_REDIRECT_URI/,
    );
  });

  it('accepts the shared WhatsApp Meta app credentials', () => {
    const result = validateEnvironment({
      ...base,
      ...enabled,
      META_APP_ID: 'shared-app-id',
      META_APP_SECRET: 'shared-app-secret',
    });
    expect(result.META_ADS_ENABLED).toBe('true');
  });

  it('rejects a malformed API version', () => {
    expect(() =>
      validateEnvironment({ ...base, META_ADS_API_VERSION: 'v25' }),
    ).toThrow('META_ADS_API_VERSION must look like v25.0');
  });
});

describe('validateEnvironment ads sync scheduler', () => {
  const base = {
    DATABASE_URL: 'postgresql://postgres:password@localhost:5434/zomaal',
    JWT_SECRET: 'a-secure-test-jwt-secret-with-32-characters',
    SHIPPING_CREDENTIAL_ENCRYPTION_KEY: Buffer.alloc(32, 6).toString('base64'),
    PRODUCT_IMAGE_BUCKET: 'zomaal-product-images-test',
  };

  it('needs a 32-character secret when enabled', () => {
    expect(() =>
      validateEnvironment({
        ...base,
        ADS_SYNC_SCHEDULER_ENABLED: 'true',
        ADS_SYNC_SCHEDULER_SECRET: 'short',
      }),
    ).toThrow('ADS_SYNC_SCHEDULER_SECRET must be at least 32 characters');
  });

  it('rejects a non-boolean flag', () => {
    expect(() =>
      validateEnvironment({ ...base, ADS_SYNC_SCHEDULER_ENABLED: 'yes' }),
    ).toThrow('ADS_SYNC_SCHEDULER_ENABLED must be true or false');
  });

  it('defaults to disabled', () => {
    expect(validateEnvironment(base).ADS_SYNC_SCHEDULER_ENABLED).toBe('false');
  });
});
