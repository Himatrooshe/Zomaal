const REQUIRED_ENV_KEYS = ['DATABASE_URL', 'JWT_SECRET'] as const;
const SHOPIFY_CALLBACK_PATH = '/auth/shopify/callback';
const YOUCAN_CALLBACK_PATH = '/auth/youcan/callback';
const LIGHTFUNNELS_CALLBACK_PATH = '/auth/lightfunnels/callback';

export function validateEnvironment(
  config: Record<string, unknown>,
): Record<string, unknown> {
  const errors: string[] = [];

  for (const key of REQUIRED_ENV_KEYS) {
    if (!config[key]) {
      errors.push(`${key} is required`);
    }
  }

  const jwtSecret =
    typeof config.JWT_SECRET === 'string' ? config.JWT_SECRET : '';
  if (jwtSecret && jwtSecret.length < 32) {
    errors.push('JWT_SECRET must be at least 32 characters long');
  }

  const shippingEncryptionKey =
    typeof config.SHIPPING_CREDENTIAL_ENCRYPTION_KEY === 'string'
      ? Buffer.from(config.SHIPPING_CREDENTIAL_ENCRYPTION_KEY, 'base64')
      : Buffer.alloc(0);
  if (shippingEncryptionKey.length !== 32) {
    errors.push(
      'SHIPPING_CREDENTIAL_ENCRYPTION_KEY must be a base64-encoded 32-byte key',
    );
  }

  const port = Number(config.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    errors.push('PORT must be a valid TCP port');
  }

  const developmentOtpEnabled = config.DEV_OTP_ENABLED === 'true';
  const nodeEnv = typeof config.NODE_ENV === 'string' ? config.NODE_ENV : '';
  const productImageBucket = asString(config.PRODUCT_IMAGE_BUCKET);
  const developmentOtpCode =
    typeof config.DEV_OTP_CODE === 'string' ? config.DEV_OTP_CODE : '123456';
  const oauthMobileRedirectSchemes = normalizeCsv(
    asString(config.OAUTH_MOBILE_REDIRECT_SCHEMES),
  ).map((scheme) => scheme.replace(/:$/, '').toLowerCase());

  if (developmentOtpEnabled && nodeEnv === 'production') {
    errors.push('DEV_OTP_ENABLED must never be true in production');
  }
  if (developmentOtpEnabled && !/^\d{6}$/.test(developmentOtpCode)) {
    errors.push('DEV_OTP_CODE must contain exactly 6 digits');
  }
  if (nodeEnv === 'production' && !productImageBucket) {
    errors.push('PRODUCT_IMAGE_BUCKET is required in production');
  }
  if (productImageBucket && !isValidBucketName(productImageBucket)) {
    errors.push(
      'PRODUCT_IMAGE_BUCKET is not a valid Cloud Storage bucket name',
    );
  }

  const loggerPhone =
    typeof config.LOGGER_PHONE === 'string' ? config.LOGGER_PHONE : '';
  const loggerPassword =
    typeof config.LOGGER_PASSWORD === 'string' ? config.LOGGER_PASSWORD : '';

  if ((loggerPhone && !loggerPassword) || (!loggerPhone && loggerPassword)) {
    errors.push('LOGGER_PHONE and LOGGER_PASSWORD must be configured together');
  }
  if (loggerPassword && loggerPassword.length < 8) {
    errors.push('LOGGER_PASSWORD must be at least 8 characters long');
  }

  const ecommerceSyncSchedulerEnabled =
    config.ECOMMERCE_SYNC_SCHEDULER_ENABLED === 'true';
  const ecommerceSyncSchedulerSecret = asString(
    config.ECOMMERCE_SYNC_SCHEDULER_SECRET,
  );
  const ecommerceSyncConcurrency = boundedPositiveInteger(
    'ECOMMERCE_SYNC_CONCURRENCY',
    config.ECOMMERCE_SYNC_CONCURRENCY,
    2,
    10,
    errors,
  );
  const ecommerceSyncMaxConnections = boundedPositiveInteger(
    'ECOMMERCE_SYNC_MAX_CONNECTIONS',
    config.ECOMMERCE_SYNC_MAX_CONNECTIONS,
    100,
    1000,
    errors,
  );
  const ecommerceSyncMinIntervalMinutes = boundedPositiveInteger(
    'ECOMMERCE_SYNC_MIN_INTERVAL_MINUTES',
    config.ECOMMERCE_SYNC_MIN_INTERVAL_MINUTES,
    15,
    1440,
    errors,
  );

  if (
    ecommerceSyncSchedulerEnabled &&
    ecommerceSyncSchedulerSecret.length < 32
  ) {
    errors.push(
      'ECOMMERCE_SYNC_SCHEDULER_SECRET must be at least 32 characters when scheduled synchronization is enabled',
    );
  }

  const quickLivraisonSyncSchedulerEnabled =
    config.QUICKLIVRAISON_SYNC_SCHEDULER_ENABLED === 'true';
  const quickLivraisonSyncSchedulerSecret = asString(
    config.QUICKLIVRAISON_SYNC_SCHEDULER_SECRET,
  );
  const quickLivraisonSyncConcurrency = boundedPositiveInteger(
    'QUICKLIVRAISON_SYNC_CONCURRENCY',
    config.QUICKLIVRAISON_SYNC_CONCURRENCY,
    2,
    10,
    errors,
  );
  const quickLivraisonSyncMaxConnections = boundedPositiveInteger(
    'QUICKLIVRAISON_SYNC_MAX_CONNECTIONS',
    config.QUICKLIVRAISON_SYNC_MAX_CONNECTIONS,
    100,
    1000,
    errors,
  );
  const quickLivraisonSyncMinIntervalMinutes = boundedPositiveInteger(
    'QUICKLIVRAISON_SYNC_MIN_INTERVAL_MINUTES',
    config.QUICKLIVRAISON_SYNC_MIN_INTERVAL_MINUTES,
    15,
    1440,
    errors,
  );
  if (
    quickLivraisonSyncSchedulerEnabled &&
    quickLivraisonSyncSchedulerSecret.length < 32
  ) {
    errors.push(
      'QUICKLIVRAISON_SYNC_SCHEDULER_SECRET must be at least 32 characters when scheduled synchronization is enabled',
    );
  }

  const shopifyApiKey = asString(config.SHOPIFY_API_KEY);
  const shopifyApiSecret = asString(config.SHOPIFY_API_SECRET);
  const shopifyEnabled =
    config.SHOPIFY_ENABLED === 'true' ||
    Boolean(shopifyApiKey || shopifyApiSecret);
  const cliAppUrl =
    normalizeUrl(asString(config.APP_URL)) ||
    normalizeUrl(asString(config.HOST));
  const shopifyAppUrl =
    cliAppUrl || normalizeUrl(asString(config.SHOPIFY_APP_URL));
  const configuredRedirectUri = asString(config.SHOPIFY_REDIRECT_URI);
  const shopifyRedirectUri =
    (cliAppUrl
      ? new URL(SHOPIFY_CALLBACK_PATH, cliAppUrl).toString()
      : normalizeUrl(configuredRedirectUri)) ||
    (shopifyAppUrl
      ? new URL(SHOPIFY_CALLBACK_PATH, shopifyAppUrl).toString()
      : '');
  const shopifyApiVersion = asString(config.SHOPIFY_API_VERSION) || '2026-07';
  const shopifyScopes = normalizeCsv(
    asString(config.SHOPIFY_SCOPES) ||
      asString(config.SCOPES) ||
      'read_products,read_orders,read_customers',
  );
  const shopifyTokenEncryptionKey = decodeBase64Key(
    asString(config.SHOPIFY_TOKEN_ENCRYPTION_KEY),
  );
  const oauthStateTtlSeconds = positiveInteger(
    config.SHOPIFY_OAUTH_STATE_TTL_SECONDS,
    600,
  );
  const refreshSkewSeconds = positiveInteger(
    config.SHOPIFY_TOKEN_REFRESH_SKEW_SECONDS,
    300,
  );
  const shopifyHttpTimeoutMs = positiveInteger(
    config.SHOPIFY_HTTP_TIMEOUT_MS,
    15000,
  );

  if (shopifyEnabled) {
    if (!shopifyApiKey) {
      errors.push('SHOPIFY_API_KEY is required when Shopify is enabled');
    }
    if (!shopifyApiSecret) {
      errors.push('SHOPIFY_API_SECRET is required when Shopify is enabled');
    }
    if (!shopifyAppUrl) {
      errors.push(
        'SHOPIFY_APP_URL, APP_URL, or HOST is required when Shopify is enabled',
      );
    }
    if (!shopifyRedirectUri) {
      errors.push(
        'SHOPIFY_REDIRECT_URI could not be derived when Shopify is enabled',
      );
    }
    if (shopifyTokenEncryptionKey.length !== 32) {
      errors.push(
        'SHOPIFY_TOKEN_ENCRYPTION_KEY must be a base64-encoded 32-byte key',
      );
    }
    if (!/^(?:\d{4}-(?:01|04|07|10)|unstable)$/.test(shopifyApiVersion)) {
      errors.push(
        'SHOPIFY_API_VERSION must be a quarterly version such as 2026-07',
      );
    }
  }

  for (const [key, value] of [
    [
      'SHOPIFY_AUTH_SUCCESS_REDIRECT_URL',
      config.SHOPIFY_AUTH_SUCCESS_REDIRECT_URL,
    ],
    [
      'SHOPIFY_AUTH_FAILURE_REDIRECT_URL',
      config.SHOPIFY_AUTH_FAILURE_REDIRECT_URL,
    ],
  ] as const) {
    if (
      asString(value) &&
      !isValidOAuthCompletionUrl(asString(value), oauthMobileRedirectSchemes)
    ) {
      errors.push(oauthCompletionUrlError(key, oauthMobileRedirectSchemes));
    }
  }

  // CLIENT_ID and CLIENT_SECRET are retained as migration aliases because
  // early YouCan installations used those generic names. Namespaced values
  // always win and should be used for new deployments.
  const youCanClientId =
    asString(config.YOUCAN_CLIENT_ID) || asString(config.CLIENT_ID);
  const youCanClientSecret =
    asString(config.YOUCAN_CLIENT_SECRET) || asString(config.CLIENT_SECRET);
  const youCanEnabled =
    config.YOUCAN_ENABLED === 'true' ||
    Boolean(youCanClientId || youCanClientSecret);
  const youCanAppUrl =
    normalizeUrl(asString(config.YOUCAN_APP_URL)) ||
    normalizeUrl(asString(config.APP_URL)) ||
    normalizeUrl(asString(config.HOST));
  const youCanRedirectUri =
    normalizeUrl(asString(config.YOUCAN_REDIRECT_URI)) ||
    (youCanAppUrl
      ? new URL(YOUCAN_CALLBACK_PATH, youCanAppUrl).toString()
      : '');
  const youCanTokenEncryptionKey = decodeBase64Key(
    asString(config.YOUCAN_TOKEN_ENCRYPTION_KEY),
  );
  const youCanScopes = normalizeCsv(asString(config.YOUCAN_SCOPES) || '*');
  const youCanOauthStateTtlSeconds = positiveInteger(
    config.YOUCAN_OAUTH_STATE_TTL_SECONDS,
    600,
  );
  const youCanTokenRefreshSkewSeconds = positiveInteger(
    config.YOUCAN_TOKEN_REFRESH_SKEW_SECONDS,
    300,
  );
  const youCanHttpTimeoutMs = positiveInteger(
    config.YOUCAN_HTTP_TIMEOUT_MS,
    15000,
  );

  if (youCanEnabled) {
    if (!youCanClientId) {
      errors.push('YOUCAN_CLIENT_ID is required when YouCan is enabled');
    }
    if (!youCanClientSecret) {
      errors.push('YOUCAN_CLIENT_SECRET is required when YouCan is enabled');
    }
    if (!youCanRedirectUri) {
      errors.push(
        'YOUCAN_REDIRECT_URI or YOUCAN_APP_URL is required when YouCan is enabled',
      );
    }
    if (youCanTokenEncryptionKey.length !== 32) {
      errors.push(
        'YOUCAN_TOKEN_ENCRYPTION_KEY must be a base64-encoded 32-byte key',
      );
    }
    if (youCanScopes.includes('*') && youCanScopes.length !== 1) {
      errors.push('YOUCAN_SCOPES must use * alone');
    } else if (
      !youCanScopes.includes('*') &&
      !youCanScopes.includes('view-store-info')
    ) {
      errors.push(
        'YOUCAN_SCOPES must be * or include view-store-info so the connected store can be identified',
      );
    }
  }

  for (const [key, value] of [
    [
      'YOUCAN_AUTH_SUCCESS_REDIRECT_URL',
      config.YOUCAN_AUTH_SUCCESS_REDIRECT_URL,
    ],
    [
      'YOUCAN_AUTH_FAILURE_REDIRECT_URL',
      config.YOUCAN_AUTH_FAILURE_REDIRECT_URL,
    ],
  ] as const) {
    if (
      asString(value) &&
      !isValidOAuthCompletionUrl(asString(value), oauthMobileRedirectSchemes)
    ) {
      errors.push(oauthCompletionUrlError(key, oauthMobileRedirectSchemes));
    }
  }

  const lightfunnelsClientId = asString(config.LIGHTFUNNELS_CLIENT_ID);
  const lightfunnelsClientSecret = asString(config.LIGHTFUNNELS_CLIENT_SECRET);
  const lightfunnelsEnabled =
    config.LIGHTFUNNELS_ENABLED === 'true' ||
    Boolean(lightfunnelsClientId || lightfunnelsClientSecret);
  const lightfunnelsAppUrl =
    normalizeUrl(asString(config.LIGHTFUNNELS_APP_URL)) ||
    normalizeUrl(asString(config.APP_URL)) ||
    normalizeUrl(asString(config.HOST));
  const lightfunnelsRedirectUri =
    normalizeUrl(asString(config.LIGHTFUNNELS_REDIRECT_URI)) ||
    (lightfunnelsAppUrl
      ? new URL(LIGHTFUNNELS_CALLBACK_PATH, lightfunnelsAppUrl).toString()
      : '');
  const lightfunnelsScopes = normalizeCsv(
    asString(config.LIGHTFUNNELS_SCOPES) || 'orders,funnels,products,customers',
  );
  const lightfunnelsTokenEncryptionKey = decodeBase64Key(
    asString(config.LIGHTFUNNELS_TOKEN_ENCRYPTION_KEY),
  );
  const lightfunnelsOauthStateTtlSeconds = positiveInteger(
    config.LIGHTFUNNELS_OAUTH_STATE_TTL_SECONDS,
    600,
  );
  const lightfunnelsHttpTimeoutMs = positiveInteger(
    config.LIGHTFUNNELS_HTTP_TIMEOUT_MS,
    15000,
  );

  if (lightfunnelsEnabled) {
    if (!lightfunnelsClientId) {
      errors.push(
        'LIGHTFUNNELS_CLIENT_ID is required when Lightfunnels is enabled',
      );
    }
    if (!lightfunnelsClientSecret) {
      errors.push(
        'LIGHTFUNNELS_CLIENT_SECRET is required when Lightfunnels is enabled',
      );
    }
    if (!lightfunnelsRedirectUri) {
      errors.push(
        'LIGHTFUNNELS_REDIRECT_URI or LIGHTFUNNELS_APP_URL is required when Lightfunnels is enabled',
      );
    }
    if (lightfunnelsTokenEncryptionKey.length !== 32) {
      errors.push(
        'LIGHTFUNNELS_TOKEN_ENCRYPTION_KEY must be a base64-encoded 32-byte key',
      );
    }
    if (!lightfunnelsScopes.includes('orders')) {
      errors.push(
        'LIGHTFUNNELS_SCOPES must include orders for revenue synchronization',
      );
    }
    if (!lightfunnelsScopes.includes('funnels')) {
      errors.push(
        'LIGHTFUNNELS_SCOPES must include funnels so the connected account can be identified',
      );
    }
    if (!lightfunnelsScopes.includes('products')) {
      errors.push(
        'LIGHTFUNNELS_SCOPES must include products for catalog synchronization',
      );
    }
    if (!lightfunnelsScopes.includes('customers')) {
      errors.push(
        'LIGHTFUNNELS_SCOPES must include customers for customer metrics and data access',
      );
    }
  }

  for (const [key, value] of [
    [
      'LIGHTFUNNELS_AUTH_SUCCESS_REDIRECT_URL',
      config.LIGHTFUNNELS_AUTH_SUCCESS_REDIRECT_URL,
    ],
    [
      'LIGHTFUNNELS_AUTH_FAILURE_REDIRECT_URL',
      config.LIGHTFUNNELS_AUTH_FAILURE_REDIRECT_URL,
    ],
  ] as const) {
    if (
      asString(value) &&
      !isValidOAuthCompletionUrl(asString(value), oauthMobileRedirectSchemes)
    ) {
      errors.push(oauthCompletionUrlError(key, oauthMobileRedirectSchemes));
    }
  }

  if (errors.length > 0) {
    throw new Error(`Invalid environment configuration: ${errors.join(', ')}`);
  }

  return {
    ...config,
    PORT: port,
    PRODUCT_IMAGE_BUCKET: productImageBucket,
    OAUTH_MOBILE_REDIRECT_SCHEMES: oauthMobileRedirectSchemes.join(','),
    ECOMMERCE_SYNC_SCHEDULER_ENABLED: ecommerceSyncSchedulerEnabled,
    ECOMMERCE_SYNC_SCHEDULER_SECRET: ecommerceSyncSchedulerSecret,
    ECOMMERCE_SYNC_CONCURRENCY: ecommerceSyncConcurrency,
    ECOMMERCE_SYNC_MAX_CONNECTIONS: ecommerceSyncMaxConnections,
    ECOMMERCE_SYNC_MIN_INTERVAL_MINUTES: ecommerceSyncMinIntervalMinutes,
    QUICKLIVRAISON_SYNC_SCHEDULER_ENABLED: quickLivraisonSyncSchedulerEnabled,
    QUICKLIVRAISON_SYNC_SCHEDULER_SECRET: quickLivraisonSyncSchedulerSecret,
    QUICKLIVRAISON_SYNC_CONCURRENCY: quickLivraisonSyncConcurrency,
    QUICKLIVRAISON_SYNC_MAX_CONNECTIONS: quickLivraisonSyncMaxConnections,
    QUICKLIVRAISON_SYNC_MIN_INTERVAL_MINUTES:
      quickLivraisonSyncMinIntervalMinutes,
    SHOPIFY_ENABLED: shopifyEnabled,
    SHOPIFY_APP_URL: shopifyAppUrl,
    SHOPIFY_REDIRECT_URI: shopifyRedirectUri,
    SHOPIFY_API_VERSION: shopifyApiVersion,
    SHOPIFY_SCOPES: shopifyScopes.join(','),
    SHOPIFY_OAUTH_STATE_TTL_SECONDS: oauthStateTtlSeconds,
    SHOPIFY_TOKEN_REFRESH_SKEW_SECONDS: refreshSkewSeconds,
    SHOPIFY_HTTP_TIMEOUT_MS: shopifyHttpTimeoutMs,
    YOUCAN_ENABLED: youCanEnabled,
    YOUCAN_CLIENT_ID: youCanClientId,
    YOUCAN_CLIENT_SECRET: youCanClientSecret,
    YOUCAN_APP_URL: youCanAppUrl,
    YOUCAN_REDIRECT_URI: youCanRedirectUri,
    YOUCAN_SCOPES: youCanScopes.join(','),
    YOUCAN_OAUTH_STATE_TTL_SECONDS: youCanOauthStateTtlSeconds,
    YOUCAN_TOKEN_REFRESH_SKEW_SECONDS: youCanTokenRefreshSkewSeconds,
    YOUCAN_HTTP_TIMEOUT_MS: youCanHttpTimeoutMs,
    LIGHTFUNNELS_ENABLED: lightfunnelsEnabled,
    LIGHTFUNNELS_CLIENT_ID: lightfunnelsClientId,
    LIGHTFUNNELS_CLIENT_SECRET: lightfunnelsClientSecret,
    LIGHTFUNNELS_APP_URL: lightfunnelsAppUrl,
    LIGHTFUNNELS_REDIRECT_URI: lightfunnelsRedirectUri,
    LIGHTFUNNELS_SCOPES: lightfunnelsScopes.join(','),
    LIGHTFUNNELS_OAUTH_STATE_TTL_SECONDS: lightfunnelsOauthStateTtlSeconds,
    LIGHTFUNNELS_HTTP_TIMEOUT_MS: lightfunnelsHttpTimeoutMs,
  };
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeUrl(value: string): string {
  if (!value) {
    return '';
  }

  const candidate = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  try {
    const url = new URL(candidate);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return '';
    }
    url.hash = '';
    return url.toString();
  } catch {
    return '';
  }
}

function isValidOAuthCompletionUrl(
  value: string,
  allowedMobileSchemes: string[],
): boolean {
  try {
    const url = new URL(value);
    const scheme = url.protocol.replace(/:$/, '').toLowerCase();
    if (scheme === 'http' || scheme === 'https') {
      return Boolean(normalizeUrl(value));
    }
    return (
      allowedMobileSchemes.includes(scheme) &&
      Boolean(url.hostname || url.pathname)
    );
  } catch {
    return false;
  }
}

function oauthCompletionUrlError(
  key: string,
  allowedMobileSchemes: string[],
): string {
  const mobileHint =
    allowedMobileSchemes.length > 0
      ? ` or use an allowed mobile scheme (${allowedMobileSchemes
          .map((scheme) => `${scheme}://`)
          .join(', ')})`
      : '';
  return `${key} must be an absolute HTTP or HTTPS URL${mobileHint}`;
}

function decodeBase64Key(value: string): Buffer {
  try {
    return value ? Buffer.from(value, 'base64') : Buffer.alloc(0);
  } catch {
    return Buffer.alloc(0);
  }
}

function positiveInteger(value: unknown, fallback: number): number {
  const parsed = Number(value ?? fallback);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function boundedPositiveInteger(
  key: string,
  value: unknown,
  fallback: number,
  maximum: number,
  errors: string[],
): number {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > maximum) {
    errors.push(`${key} must be an integer between 1 and ${maximum}`);
    return fallback;
  }

  return parsed;
}

function normalizeCsv(value: string): string[] {
  return [
    ...new Set(
      value
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean),
    ),
  ].sort();
}

function isValidBucketName(value: string): boolean {
  const components = value.split('.');
  return (
    value.length >= 3 &&
    value.length <= 222 &&
    components.every(
      (component) =>
        component.length >= 1 &&
        component.length <= 63 &&
        /^[a-z0-9](?:[a-z0-9_-]*[a-z0-9])?$/.test(component),
    ) &&
    !/^\d{1,3}(?:\.\d{1,3}){3}$/.test(value) &&
    !value.startsWith('goog') &&
    !value.includes('google')
  );
}
