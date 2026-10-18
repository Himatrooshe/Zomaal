import type { ValidationPipeOptions } from '@nestjs/common';

/** Options of the global ValidationPipe; reuse them anywhere a request body is validated by hand. */
export const GLOBAL_VALIDATION_PIPE_OPTIONS: ValidationPipeOptions = {
  whitelist: true,
  forbidNonWhitelisted: true,
  forbidUnknownValues: true,
  transform: true,
};
