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

// Same shared-secret-header pattern as EcommerceSchedulerGuard — an
// external Cloud Scheduler job hits /internal/ads/tiktok/sync with this
// header, no in-process cron.
@Injectable()
export class AdsSchedulerGuard implements CanActivate {
  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const enabled = this.configService.get<boolean>('ADS_SYNC_SCHEDULER_ENABLED', false);
    const expectedSecret = this.configService.get<string>('ADS_SYNC_SCHEDULER_SECRET', '');

    if (!enabled || !expectedSecret) {
      throw new ServiceUnavailableException('Scheduled ads synchronization is not enabled');
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
