import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { REQUIRED_PERMISSIONS } from './require-permission.decorator';
import { StoreAccessService } from './store-access.service';
import type { Permission } from './permissions';

/**
 * Enforces @RequirePermission. Runs after JwtAuthGuard, so req.user is set.
 *
 * On denial it throws a 403 whose body carries the module that was denied,
 * so the client can render the "Access Restricted — You don't have permission
 * to access {Module Name}" screen without having to parse a message string.
 */
@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly storeAccess: StoreAccessService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<Permission[]>(
      REQUIRED_PERMISSIONS,
      [context.getHandler(), context.getClass()],
    );

    // No decorator: the route isn't permission-gated. It is still behind
    // JwtAuthGuard, and whatever it calls still resolves the store through
    // StoreAccessService, so staff can't reach another store's data.
    if (!required || required.length === 0) {
      return true;
    }

    const request = context
      .switchToHttp()
      .getRequest<{ user?: JwtPayload; storeAccess?: unknown }>();
    const user = request.user;
    if (!user?.userId) {
      return false;
    }

    const access = await this.storeAccess.require(user.userId);

    const missing = required.filter((p) => !access.permissions.includes(p));
    if (missing.length > 0) {
      throw new ForbiddenException({
        statusCode: 403,
        error: 'Forbidden',
        message: `You don't have permission to access ${moduleLabel(missing[0])}. Please contact your store owner to request access.`,
        // Structured so the client renders the locked screen from data rather
        // than by string-matching the message.
        reason: 'PERMISSION_DENIED',
        module: moduleOf(missing[0]),
        missingPermissions: missing,
      });
    }

    // Hand the resolved access down to the handler so it doesn't have to
    // repeat the lookup this guard just did.
    request.storeAccess = access;
    void this.storeAccess.touchLastActive(access);

    return true;
  }
}

function moduleOf(permission: Permission): string {
  return permission.split('.')[0];
}

/** "orders.view" -> "Orders", for the message shown on the locked screen. */
function moduleLabel(permission: Permission): string {
  const key = moduleOf(permission);
  const labels: Record<string, string> = {
    orders: 'Orders',
    returns: 'Returns',
    products: 'Products',
    expenses: 'Expenses',
    ads: 'Advertising',
    customers: 'Customers',
    analytics: 'Analytics',
    shop: 'Shop',
  };
  return labels[key] ?? key;
}
