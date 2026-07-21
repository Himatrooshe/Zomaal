const REQUIRED_ENV_KEYS = ['DATABASE_URL', 'JWT_SECRET'] as const;
const SHOPIFY_CALLBACK_PATH = '/auth/shopify/callback';

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
  const developmentOtpCode =
    typeof config.DEV_OTP_CODE === 'string' ? config.DEV_OTP_CODE : '123456';

  if (developmentOtpEnabled && nodeEnv === 'production') {
    errors.push('DEV_OTP_ENABLED must never be true in production');
  }
  if (developmentOtpEnabled && !/^\d{6}$/.test(developmentOtpCode)) {
    errors.push('DEV_OTP_CODE must contain exactly 6 digits');
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
    if (asString(value) && !normalizeUrl(asString(value))) {
      errors.push(`${key} must be an absolute HTTP or HTTPS URL`);
    }
  }

  if (errors.length > 0) {
    throw new Error(`Invalid environment configuration: ${errors.join(', ')}`);
  }

  return {
    ...config,
    PORT: port,
    SHOPIFY_ENABLED: shopifyEnabled,
    SHOPIFY_APP_URL: shopifyAppUrl,
    SHOPIFY_REDIRECT_URI: shopifyRedirectUri,
    SHOPIFY_API_VERSION: shopifyApiVersion,
    SHOPIFY_OAUTH_STATE_TTL_SECONDS: oauthStateTtlSeconds,
    SHOPIFY_TOKEN_REFRESH_SKEW_SECONDS: refreshSkewSeconds,
    SHOPIFY_HTTP_TIMEOUT_MS: shopifyHttpTimeoutMs,
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
