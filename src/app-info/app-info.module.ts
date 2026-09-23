import { Module } from '@nestjs/common';
import { AppInfoController } from './app-info.controller';
import { AppInfoService } from './app-info.service';

@Module({
  controllers: [AppInfoController],
  providers: [AppInfoService],
})
export class AppInfoModule {}
