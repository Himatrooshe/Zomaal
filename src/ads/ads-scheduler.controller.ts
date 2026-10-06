import {
  Controller,
  Header,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { AdsSchedulerGuard } from './ads-scheduler.guard';
import {
  TikTokAdsSyncService,
  type ScheduledTikTokAdsSyncResponse,
} from './tiktok/tiktok-ads-sync.service';
import {
  GoogleAdsSyncService,
  type ScheduledGoogleAdsSyncResponse,
} from './google/google-ads-sync.service';

@ApiExcludeController()
@UseGuards(AdsSchedulerGuard)
@Controller('internal/ads')
export class AdsSchedulerController {
  constructor(
    private readonly tiktokSync: TikTokAdsSyncService,
    private readonly googleSync: GoogleAdsSyncService,
  ) {}

  @Post('tiktok/sync')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  synchronizeTikTok(): Promise<ScheduledTikTokAdsSyncResponse> {
    return this.tiktokSync.syncAllActiveConnections();
  }

  @Post('google/sync')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  synchronizeGoogle(): Promise<ScheduledGoogleAdsSyncResponse> {
    return this.googleSync.syncAllActiveConnections();
  }
}
