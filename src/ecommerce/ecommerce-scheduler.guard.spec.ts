import {
  ServiceUnavailableException,
  UnauthorizedException,
  type ExecutionContext,
} from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { EcommerceSchedulerGuard } from './ecommerce-scheduler.guard';

describe('EcommerceSchedulerGuard', () => {
  function setup(
    values: Record<string, unknown>,
    providedSecret?: string,
  ): {
    guard: EcommerceSchedulerGuard;
    context: ExecutionContext;
  } {
    const config = {
      get: jest.fn((key: string, fallback: unknown) => values[key] ?? fallback),
    } as unknown as ConfigService;
    const context = {
      switchToHttp: () => ({
        getRequest: () => ({
          headers: {
            'x-zomaal-scheduler-secret': providedSecret,
          },
        }),
      }),
    } as unknown as ExecutionContext;

    return {
      guard: new EcommerceSchedulerGuard(config),
      context,
    };
  }

  it('accepts the configured scheduler secret', () => {
    const secret = 'a'.repeat(32);
    const { guard, context } = setup(
      {
        ECOMMERCE_SYNC_SCHEDULER_ENABLED: true,
        ECOMMERCE_SYNC_SCHEDULER_SECRET: secret,
      },
      secret,
    );

    expect(guard.canActivate(context)).toBe(true);
  });

  it('rejects an invalid scheduler secret', () => {
    const { guard, context } = setup(
      {
        ECOMMERCE_SYNC_SCHEDULER_ENABLED: true,
        ECOMMERCE_SYNC_SCHEDULER_SECRET: 'a'.repeat(32),
      },
      'b'.repeat(32),
    );

    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });

  it('keeps the endpoint unavailable when scheduling is disabled', () => {
    const { guard, context } = setup(
      {
        ECOMMERCE_SYNC_SCHEDULER_ENABLED: false,
        ECOMMERCE_SYNC_SCHEDULER_SECRET: '',
      },
      'a'.repeat(32),
    );

    expect(() => guard.canActivate(context)).toThrow(
      ServiceUnavailableException,
    );
  });
});
