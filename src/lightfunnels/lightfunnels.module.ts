import { Module } from '@nestjs/common';
import { LightfunnelsApiService } from './lightfunnels-api.service';
import { LightfunnelsAuthService } from './lightfunnels-auth.service';
import { LightfunnelsConnectionService } from './lightfunnels-connection.service';
import {
  LightfunnelsController,
  LightfunnelsOAuthController,
} from './lightfunnels.controller';
import { LightfunnelsTokenEncryptionService } from './lightfunnels-token-encryption.service';

@Module({
  controllers: [LightfunnelsController, LightfunnelsOAuthController],
  providers: [
    LightfunnelsApiService,
    LightfunnelsAuthService,
    LightfunnelsConnectionService,
    LightfunnelsTokenEncryptionService,
  ],
  exports: [LightfunnelsConnectionService],
})
export class LightfunnelsModule {}
