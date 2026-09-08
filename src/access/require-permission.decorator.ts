import { SetMetadata } from '@nestjs/common';
import type { Permission } from './permissions';

export const REQUIRED_PERMISSIONS = 'requiredPermissions';

/**
 * Gates a route behind one or more permissions. Owners always pass.
 *
 * Multiple permissions are AND-ed — the caller must hold all of them. Routes
 * needing "any of" should be split, which is clearer than encoding boolean
 * logic in a decorator.
 *
 *   @RequirePermission(PERMISSIONS.ORDERS_VIEW)
 *   @Get('orders')
 */
export const RequirePermission = (...permissions: Permission[]) =>
  SetMetadata(REQUIRED_PERMISSIONS, permissions);
