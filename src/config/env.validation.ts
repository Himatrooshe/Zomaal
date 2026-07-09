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

  const port = Number(config.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    errors.push('PORT must be a valid TCP port');
  }

  if (errors.length > 0) {
    throw new Error(`Invalid environment configuration: ${errors.join(', ')}`);
  }

  return {
    ...config,
    PORT: port,
  };
}
