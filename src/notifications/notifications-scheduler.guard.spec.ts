import {
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { NotificationsSchedulerGuard } from './notifications-scheduler.guard';

const SECRET = 'x'.repeat(40);

function guard(env: Record<string, string>) {
  const config = {
    get: jest.fn((key: string, fallback?: string) => env[key] ?? fallback),
  };
  return new NotificationsSchedulerGuard(config as never);
}

function context(secret?: string) {
  return {
    switchToHttp: () => ({
      getRequest: () => ({
        headers: secret ? { 'x-zomaal-scheduler-secret': secret } : {},
      }),
    }),
  } as never;
}

describe('NotificationsSchedulerGuard', () => {
  const enabled = {
    NOTIFICATIONS_SCHEDULER_ENABLED: 'true',
    NOTIFICATIONS_SCHEDULER_SECRET: SECRET,
  };

  it('rejects when disabled', () => {
    expect(() => guard({}).canActivate(context(SECRET))).toThrow(
      ServiceUnavailableException,
    );
  });

  it('rejects a missing or wrong secret', () => {
    expect(() => guard(enabled).canActivate(context())).toThrow(
      UnauthorizedException,
    );
    expect(() => guard(enabled).canActivate(context('wrong'))).toThrow(
      UnauthorizedException,
    );
  });

  it('accepts the configured secret', () => {
    expect(guard(enabled).canActivate(context(SECRET))).toBe(true);
  });
});
