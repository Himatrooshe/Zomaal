import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, timingSafeEqual } from 'crypto';

@Injectable()
export class QuickLivraisonSchedulerGuard implements CanActivate {
  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext) {
    const enabled = this.configService.get<boolean>(
      'QUICKLIVRAISON_SYNC_SCHEDULER_ENABLED',
      false,
    );
    const expected = this.configService.get<string>(
      'QUICKLIVRAISON_SYNC_SCHEDULER_SECRET',
      '',
    );
    if (!enabled || !expected) {
      throw new ServiceUnavailableException(
        'Scheduled QuickLivraison synchronization is not enabled',
      );
    }
    const request = context.switchToHttp().getRequest<{
      headers: Record<string, string | string[] | undefined>;
    }>();
    const value = request.headers['x-zomaal-scheduler-secret'];
    const provided = Array.isArray(value) ? value[0] : value;
    if (!provided || !timingSafeEqual(sha256(provided), sha256(expected))) {
      throw new UnauthorizedException('Invalid scheduler credentials');
    }
    return true;
  }
}

function sha256(value: string) {
  return createHash('sha256').update(value, 'utf8').digest();
}
