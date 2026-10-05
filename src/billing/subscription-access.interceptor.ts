import {
  CallHandler,
  ExecutionContext,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { from, Observable, switchMap } from 'rxjs';
import { SubscriptionService } from './subscription.service';
import { ALLOW_WHEN_LOCKED, REQUIRED_PLAN_FEATURE } from './billing.decorators';
import type { PlanFeature } from './plan-features';

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Q17.4: when the trial or subscription ends the account is read-only.
 * An interceptor (not a guard) because it must run after each controller's
 * JwtAuthGuard has set req.user. Requests without a merchant user — webhooks,
 * schedulers, super-admin — pass straight through.
 */
@Injectable()
export class SubscriptionAccessInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly subscriptions: SubscriptionService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();

    const request = context
      .switchToHttp()
      .getRequest<{ method: string; user?: { userId?: string } }>();
    const userId = request.user?.userId;
    if (!userId) return next.handle();

    const targets = [context.getHandler(), context.getClass()];
    const allowWhenLocked =
      this.reflector.getAllAndOverride<boolean>(ALLOW_WHEN_LOCKED, targets) ??
      false;
    const feature = this.reflector.getAllAndOverride<PlanFeature | undefined>(
      REQUIRED_PLAN_FEATURE,
      targets,
    );
    const isWrite = !READ_METHODS.has(request.method.toUpperCase());

    if (!feature && (!isWrite || allowWhenLocked)) return next.handle();

    return from(this.subscriptions.stateForUser(userId)).pipe(
      switchMap((state) => {
        // No store yet (onboarding) — nothing to enforce.
        if (!state) return next.handle();

        if (isWrite && !allowWhenLocked && state.isReadOnly) {
          throw new HttpException(
            {
              statusCode: HttpStatus.PAYMENT_REQUIRED,
              error: 'Payment Required',
              message:
                state.status === 'TRIAL_ENDED'
                  ? 'Your free trial has ended. Choose a plan to keep making changes.'
                  : 'Your subscription has expired. Renew to keep making changes.',
              reason: 'SUBSCRIPTION_INACTIVE',
              subscriptionStatus: state.status,
            },
            HttpStatus.PAYMENT_REQUIRED,
          );
        }

        if (feature && !state.features.includes(feature)) {
          throw new ForbiddenException({
            statusCode: 403,
            error: 'Forbidden',
            message:
              'This feature is not included in your plan. Upgrade to use it.',
            reason: 'PLAN_UPGRADE_REQUIRED',
            feature,
          });
        }
        return next.handle();
      }),
    );
  }
}
