import {
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { QuickLivraisonSchedulerGuard } from './quicklivraison-scheduler.guard';

describe('QuickLivraisonSchedulerGuard', () => {
  function createGuard(enabled: boolean, secret: string) {
    return new QuickLivraisonSchedulerGuard({
      get: jest.fn((key: string, fallback: unknown) => {
        if (key === 'QUICKLIVRAISON_SYNC_SCHEDULER_ENABLED') return enabled;
        if (key === 'QUICKLIVRAISON_SYNC_SCHEDULER_SECRET') return secret;
        return fallback;
      }),
    } as never);
  }

  function context(provided?: string) {
    return {
      switchToHttp: () => ({
        getRequest: () => ({
          headers: provided ? { 'x-zomaal-scheduler-secret': provided } : {},
        }),
      }),
    } as ExecutionContext;
  }

  it('allows the configured scheduler secret', () => {
    expect(
      createGuard(true, 'correct-secret').canActivate(
        context('correct-secret'),
      ),
    ).toBe(true);
  });

  it('rejects invalid scheduler credentials', () => {
    expect(() =>
      createGuard(true, 'correct-secret').canActivate(context('wrong')),
    ).toThrow(UnauthorizedException);
  });

  it('fails closed while scheduling is disabled', () => {
    expect(() =>
      createGuard(false, 'correct-secret').canActivate(
        context('correct-secret'),
      ),
    ).toThrow(ServiceUnavailableException);
  });
});
