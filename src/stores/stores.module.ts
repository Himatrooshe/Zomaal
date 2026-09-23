import { Module } from '@nestjs/common';
import { StoresService } from './stores.service';
import { StoresController } from './stores.controller';
import { ProfileMediaModule } from '../profile-media/profile-media.module';

@Module({
  imports: [ProfileMediaModule],
  controllers: [StoresController],
  providers: [StoresService],
  exports: [StoresService],
})
export class StoresModule {}
