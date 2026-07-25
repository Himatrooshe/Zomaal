import { Module } from '@nestjs/common';
import { YouCanController, YouCanOAuthController } from './youcan.controller';
import { YouCanApiService } from './youcan-api.service';
import { YouCanAuthService } from './youcan-auth.service';
import { YouCanConnectionService } from './youcan-connection.service';
import { YouCanTokenEncryptionService } from './youcan-token-encryption.service';

@Module({
  controllers: [YouCanController, YouCanOAuthController],
  providers: [
    YouCanApiService,
    YouCanAuthService,
    YouCanConnectionService,
    YouCanTokenEncryptionService,
  ],
  exports: [YouCanConnectionService],
})
export class YouCanModule {}
