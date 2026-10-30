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
import { SnapchatAdsService } from './snapchat/snapchat-ads.service';
import {
  TikTokAdsSyncService,
  type ScheduledTikTokAdsSyncResponse,
} from './tiktok/tiktok-ads-sync.service';
import {
  GoogleAdsSyncService,
  type ScheduledGoogleAdsSyncResponse,
} from './google/google-ads-sync.service';
import {
  MetaAdsSyncService,
  type ScheduledMetaAdsSyncResponse,
} from './meta/meta-ads-sync.service';

@ApiExcludeController()
@UseGuards(AdsSchedulerGuard)
@Controller('internal/ads')
export class AdsSchedulerController {
  constructor(
    private readonly tiktokSync: TikTokAdsSyncService,
    private readonly googleSync: GoogleAdsSyncService,
    private readonly metaSync: MetaAdsSyncService,
    private readonly snapchatSync: SnapchatAdsService,
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

  @Post('meta/sync')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  synchronizeMeta(): Promise<ScheduledMetaAdsSyncResponse> {
    return this.metaSync.syncAllActiveConnections();
  }

  @Post('snapchat/sync')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  synchronizeSnapchat() {
    return this.snapchatSync.syncAll();
  }
}
