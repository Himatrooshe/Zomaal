import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, timingSafeEqual } from 'crypto';

type SchedulerRequest = {
  headers: Record<string, string | string[] | undefined>;
};

// Same shared-secret-header pattern as StaffSalarySchedulerGuard — Cloud Run
// scales to zero, so evaluation runs off an external Cloud Scheduler hit.
@Injectable()
export class NotificationsSchedulerGuard implements CanActivate {
  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const enabled =
      this.configService.get<string>(
        'NOTIFICATIONS_SCHEDULER_ENABLED',
        'false',
      ) === 'true';
    const expectedSecret = this.configService.get<string>(
      'NOTIFICATIONS_SCHEDULER_SECRET',
      '',
    );

    if (!enabled || !expectedSecret) {
      throw new ServiceUnavailableException(
        'Scheduled notification evaluation is not enabled',
      );
    }

    const request = context.switchToHttp().getRequest<SchedulerRequest>();
    const headerValue = request.headers['x-zomaal-scheduler-secret'];
    const providedSecret = Array.isArray(headerValue)
      ? headerValue[0]
      : headerValue;

    if (
      !providedSecret ||
      !timingSafeEqual(sha256(providedSecret), sha256(expectedSecret))
    ) {
      throw new UnauthorizedException('Invalid scheduler credentials');
    }

    return true;
  }
}

function sha256(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}
