import { Global, Module } from '@nestjs/common';
import { PermissionGuard } from './permission.guard';
import { StoreAccessService } from './store-access.service';

/**
 * Global because almost every feature module needs to resolve the caller's
 * store, and making each one import this explicitly would be noise. Mirrors
 * how PrismaModule and RedisModule are already registered.
 */
@Global()
@Module({
  providers: [StoreAccessService, PermissionGuard],
  exports: [StoreAccessService, PermissionGuard],
})
export class AccessModule {}
