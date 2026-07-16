const REQUIRED_ENV_KEYS = ['DATABASE_URL', 'JWT_SECRET'] as const;

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

  if (errors.length > 0) {
    throw new Error(`Invalid environment configuration: ${errors.join(', ')}`);
  }

  return {
    ...config,
    PORT: port,
  };
}
