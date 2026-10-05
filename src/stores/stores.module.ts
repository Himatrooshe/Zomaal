import { Module } from '@nestjs/common';
import { StoresService } from './stores.service';
import { StoresController } from './stores.controller';
import { ProfileMediaModule } from '../profile-media/profile-media.module';
import { BillingModule } from '../billing/billing.module';

@Module({
  imports: [ProfileMediaModule, BillingModule],
  controllers: [StoresController],
  providers: [StoresService],
  exports: [StoresService],
})
export class StoresModule {}
