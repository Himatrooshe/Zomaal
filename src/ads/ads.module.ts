import { Module } from '@nestjs/common';
import { CurrencyModule } from '../currency/currency.module';
import { AdsController } from './ads.controller';
import { AdsSpendService } from './ads-spend.service';
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
import { MetaAdsController } from './meta/meta-ads.controller';
import { MetaAdsOAuthController } from './meta/meta-ads-oauth.controller';
import { MetaAdsApiService } from './meta/meta-ads-api.service';
import { MetaAdsAuthService } from './meta/meta-ads-auth.service';
import { MetaAdsCampaignService } from './meta/meta-ads-campaign.service';
import { MetaAdsSyncService } from './meta/meta-ads-sync.service';
import {
  SnapchatAdsController,
  SnapchatAdsOAuthController,
} from './snapchat/snapchat-ads.controller';
import { SnapchatAdsApiService } from './snapchat/snapchat-ads-api.service';
import { SnapchatAdsAuthService } from './snapchat/snapchat-ads-auth.service';
import { SnapchatAdsService } from './snapchat/snapchat-ads.service';

// Each ad platform (TikTok, Google, Meta, Snapchat) has its own
// *AdsApiService/*AdsAuthService/etc. under src/ads/<platform>/, writing into
// the same AdsConnection/AdsCampaign/AdsMetricSnapshot tables —
// AdsController, AdsDashboardService and AdsConnectionService are generic.
//
// Pause/resume is wired for Google and Meta (POST /ads/<platform>/campaigns/.../status).
// TikTokAdsApiService.setCampaignStatus() exists but is not exposed yet.
@Module({
  imports: [CurrencyModule],
  controllers: [
    AdsController,
    TikTokAdsController,
    TikTokAdsOAuthController,
    GoogleAdsController,
    GoogleAdsOAuthController,
    MetaAdsController,
    MetaAdsOAuthController,
    AdsSchedulerController,
    SnapchatAdsController,
    SnapchatAdsOAuthController,
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
    MetaAdsApiService,
    MetaAdsAuthService,
    MetaAdsCampaignService,
    MetaAdsSyncService,
    AdsSpendService,
    SnapchatAdsApiService,
    SnapchatAdsAuthService,
    SnapchatAdsService,
  ],
  exports: [AdsConnectionService, AdsDashboardService, AdsSpendService],
})
export class AdsModule {}
