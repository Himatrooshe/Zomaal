import { Module } from '@nestjs/common';
import { ShopImageStorageService } from '../super-admin/shop/shop-image-storage.service';
import { ProfileMediaController } from './profile-media.controller';
import { ProfileMediaService } from './profile-media.service';

@Module({
  controllers: [ProfileMediaController],
  providers: [ShopImageStorageService, ProfileMediaService],
  exports: [ProfileMediaService],
})
export class ProfileMediaModule {}
