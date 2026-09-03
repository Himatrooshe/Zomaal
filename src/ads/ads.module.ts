import { Module } from '@nestjs/common';
import { AdsController } from './ads.controller';
import { AdsConnectionService } from './ads-connection.service';
import { AdsDashboardService } from './ads-dashboard.service';
import { AdsTokenEncryptionService } from './ads-token-encryption.service';
import { AdsSchedulerGuard } from './ads-scheduler.guard';
import { AdsSchedulerController } from './ads-scheduler.controller';
import { TikTokAdsController } from './tiktok/tiktok-ads.controller';
import { TikTokAdsOAuthController } from './tiktok/tiktok-ads-oauth.controller';
import { TikTokAdsApiService } from './tiktok/tiktok-ads-api.service';
import { TikTokAdsAuthService } from './tiktok/tiktok-ads-auth.service';
import { TikTokAdsCampaignService } from './tiktok/tiktok-ads-campaign.service';
import { TikTokAdsSyncService } from './tiktok/tiktok-ads-sync.service';

// TikTok is the first ad platform implementation. Adding Meta/Google/
// Snapchat later means: a MetaAdsApiService/MetaAdsAuthService/etc. under
// src/ads/meta/, registered here, writing into the same AdsConnection/
// AdsCampaign/AdsMetricSnapshot tables — AdsController, AdsDashboardService,
// and AdsConnectionService are already generic and need no changes.
//
// Pause/resume (POST .../status) is deferred — TikTokAdsApiService already
// has setCampaignStatus() implemented but nothing calls it yet.
@Module({
  controllers: [
    AdsController,
    TikTokAdsController,
    TikTokAdsOAuthController,
    AdsSchedulerController,
  ],
  providers: [
    AdsConnectionService,
    AdsDashboardService,
    AdsTokenEncryptionService,
    AdsSchedulerGuard,
    TikTokAdsApiService,
    TikTokAdsAuthService,
    TikTokAdsCampaignService,
    TikTokAdsSyncService,
  ],
  exports: [AdsConnectionService, AdsDashboardService],
})
export class AdsModule {}
