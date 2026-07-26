import { Module } from '@nestjs/common';

import { YouCanController, YouCanOAuthController } from './youcan.controller';
import { YouCanApiService } from './youcan-api.service';
import { YouCanAuthService } from './youcan-auth.service';
import { YouCanConnectionService } from './youcan-connection.service';
import { YouCanTokenEncryptionService } from './youcan-token-encryption.service';
import { YouCanDataService } from './youcan-data.service';
import { YouCanDataController } from './youcan-data.controller';

@Module({
  controllers: [YouCanController, YouCanOAuthController, YouCanDataController],
  providers: [
    YouCanApiService,
    YouCanAuthService,
    YouCanConnectionService,
    YouCanTokenEncryptionService,
    YouCanDataService,
  ],
  exports: [YouCanConnectionService, YouCanDataService],
})
export class YouCanModule {}
