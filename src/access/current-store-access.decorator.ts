import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { StoreAccess } from './store-access.service';

/**
 * Pulls the StoreAccess that PermissionGuard already resolved for this
 * request, so a handler behind @RequirePermission doesn't repeat the same
 * store/permission lookup the guard just did.
 *
 * Only populated on routes guarded by PermissionGuard. Do not use this on a
 * route that isn't — request.storeAccess will be undefined there.
 */
export const CurrentStoreAccess = createParamDecorator(
  (data: unknown, ctx: ExecutionContext): StoreAccess => {
    const request = ctx
      .switchToHttp()
      .getRequest<Request & { storeAccess: StoreAccess }>();
    return request.storeAccess;
  },
);
