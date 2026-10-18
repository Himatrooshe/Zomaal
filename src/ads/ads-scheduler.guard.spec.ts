import {
  ServiceUnavailableException,
  UnauthorizedException,
  type ExecutionContext,
} from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { AdsSchedulerGuard } from './ads-scheduler.guard';

describe('AdsSchedulerGuard', () => {
  const secret = 'a'.repeat(32);

  function setup(
    values: Record<string, unknown>,
    providedSecret?: string,
  ): { guard: AdsSchedulerGuard; context: ExecutionContext } {
    const config = {
      get: jest.fn((key: string, fallback: unknown) => values[key] ?? fallback),
    } as unknown as ConfigService;
    const context = {
      switchToHttp: () => ({
        getRequest: () => ({
          headers: { 'x-zomaal-scheduler-secret': providedSecret },
        }),
      }),
    } as unknown as ExecutionContext;
    return { guard: new AdsSchedulerGuard(config), context };
  }

  it.each(['true', true])(
    'accepts the secret when enabled is %p',
    (enabled) => {
      const { guard, context } = setup(
        {
          ADS_SYNC_SCHEDULER_ENABLED: enabled,
          ADS_SYNC_SCHEDULER_SECRET: secret,
        },
        secret,
      );
      expect(guard.canActivate(context)).toBe(true);
    },
  );

  it('rejects a wrong secret', () => {
    const { guard, context } = setup(
      { ADS_SYNC_SCHEDULER_ENABLED: 'true', ADS_SYNC_SCHEDULER_SECRET: secret },
      'b'.repeat(32),
    );
    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });

  it('rejects a missing secret header', () => {
    const { guard, context } = setup({
      ADS_SYNC_SCHEDULER_ENABLED: 'true',
      ADS_SYNC_SCHEDULER_SECRET: secret,
    });
    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });

  it.each(['false', false, undefined])(
    'stays unavailable when enabled is %p, even with a secret',
    (enabled) => {
      const { guard, context } = setup(
        {
          ADS_SYNC_SCHEDULER_ENABLED: enabled,
          ADS_SYNC_SCHEDULER_SECRET: secret,
        },
        secret,
      );
      expect(() => guard.canActivate(context)).toThrow(
        ServiceUnavailableException,
      );
    },
  );

  it('stays unavailable when no secret is configured', () => {
    const { guard, context } = setup(
      { ADS_SYNC_SCHEDULER_ENABLED: 'true', ADS_SYNC_SCHEDULER_SECRET: '' },
      '',
    );
    expect(() => guard.canActivate(context)).toThrow(
      ServiceUnavailableException,
    );
  });
});
