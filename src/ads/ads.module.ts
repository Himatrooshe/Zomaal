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
import { GoogleAdsController } from './google/google-ads.controller';
import { GoogleAdsOAuthController } from './google/google-ads-oauth.controller';
import { GoogleAdsApiService } from './google/google-ads-api.service';
import { GoogleAdsAuthService } from './google/google-ads-auth.service';
import { GoogleAdsCampaignService } from './google/google-ads-campaign.service';
import { GoogleAdsSyncService } from './google/google-ads-sync.service';

// Each ad platform (TikTok, Google; Meta/Snapchat later) has its own
// *AdsApiService/*AdsAuthService/etc. under src/ads/<platform>/, writing into
// the same AdsConnection/AdsCampaign/AdsMetricSnapshot tables —
// AdsController, AdsDashboardService and AdsConnectionService are generic.
//
// Pause/resume is wired for Google (POST /ads/google/campaigns/.../status).
// TikTokAdsApiService.setCampaignStatus() exists but is not exposed yet.
@Module({
  controllers: [
    AdsController,
    TikTokAdsController,
    TikTokAdsOAuthController,
    GoogleAdsController,
    GoogleAdsOAuthController,
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
    GoogleAdsApiService,
    GoogleAdsAuthService,
    GoogleAdsCampaignService,
    GoogleAdsSyncService,
  ],
  exports: [AdsConnectionService, AdsDashboardService],
})
export class AdsModule {}
