import { Module } from '@nestjs/common';
import { LightfunnelsApiService } from './lightfunnels-api.service';
import { LightfunnelsAuthService } from './lightfunnels-auth.service';
import { LightfunnelsConnectionService } from './lightfunnels-connection.service';
import {
  LightfunnelsController,
  LightfunnelsOAuthController,
} from './lightfunnels.controller';
import { LightfunnelsTokenEncryptionService } from './lightfunnels-token-encryption.service';
import { LightfunnelsDataService } from './lightfunnels-data.service';
import { LightfunnelsDataController } from './lightfunnels-data.controller';

@Module({
  controllers: [
    LightfunnelsController,
    LightfunnelsOAuthController,
    LightfunnelsDataController,
  ],
  providers: [
    LightfunnelsApiService,
    LightfunnelsAuthService,
    LightfunnelsConnectionService,
    LightfunnelsTokenEncryptionService,
    LightfunnelsDataService,
  ],
  exports: [LightfunnelsConnectionService, LightfunnelsDataService],
})
export class LightfunnelsModule {}
