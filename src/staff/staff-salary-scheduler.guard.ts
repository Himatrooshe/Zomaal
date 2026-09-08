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

// Same shared-secret-header pattern as EcommerceSchedulerGuard — Cloud Run
// scales to zero, so automatic salary generation runs off an external Cloud
// Scheduler hit rather than an in-process cron.
@Injectable()
export class StaffSalarySchedulerGuard implements CanActivate {
  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const enabled =
      this.configService.get<string>('STAFF_SALARY_SCHEDULER_ENABLED', 'false') === 'true';
    const expectedSecret = this.configService.get<string>(
      'STAFF_SALARY_SCHEDULER_SECRET',
      '',
    );

    if (!enabled || !expectedSecret) {
      throw new ServiceUnavailableException(
        'Scheduled salary processing is not enabled',
      );
    }

    const request = context.switchToHttp().getRequest<SchedulerRequest>();
    const headerValue = request.headers['x-zomaal-scheduler-secret'];
    const providedSecret = Array.isArray(headerValue) ? headerValue[0] : headerValue;

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
