import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { PermissionGuard } from './permission.guard';
import type { StoreAccessService, StoreAccess } from './store-access.service';
import { PERMISSIONS } from './permissions';

function setup(
  required: string[] | undefined,
  request: Record<string, unknown>,
) {
  const reflector = {
    getAllAndOverride: jest.fn().mockReturnValue(required),
  } as unknown as Reflector;
  const storeAccess = {
    require: jest.fn(),
    touchLastActive: jest.fn().mockResolvedValue(undefined),
  } as unknown as StoreAccessService;
  const context = {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;

  return { guard: new PermissionGuard(reflector, storeAccess), storeAccess, context, request };
}

const ACCESS: StoreAccess = {
  storeId: 'store-1',
  baseCurrency: 'MAD',
  userId: 'staff-user',
  isOwner: false,
  staffMemberId: 'staff-1',
  permissions: [PERMISSIONS.EXPENSES_VIEW],
};

describe('PermissionGuard', () => {
  it('passes through untouched when the route carries no @RequirePermission', async () => {
    const { guard, storeAccess, context } = setup(undefined, { user: { userId: 'x' } });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(storeAccess.require).not.toHaveBeenCalled();
  });

  it('passes through when @RequirePermission is an empty array', async () => {
    const { guard, storeAccess, context } = setup([], { user: { userId: 'x' } });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(storeAccess.require).not.toHaveBeenCalled();
  });

  it('denies when there is no authenticated user on the request', async () => {
    const { guard, context } = setup([PERMISSIONS.EXPENSES_VIEW], {});

    await expect(guard.canActivate(context)).resolves.toBe(false);
  });

  it('allows a staff member who holds the required permission, and attaches storeAccess', async () => {
    const request: Record<string, unknown> = { user: { userId: 'staff-user' } };
    const { guard, storeAccess, context } = setup([PERMISSIONS.EXPENSES_VIEW], request);
    (storeAccess.require as jest.Mock).mockResolvedValue(ACCESS);

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.storeAccess).toBe(ACCESS);
    expect(storeAccess.touchLastActive).toHaveBeenCalledWith(ACCESS);
  });

  it('denies a staff member missing the required permission with a structured 403 naming the module', async () => {
    const request: Record<string, unknown> = { user: { userId: 'staff-user' } };
    const { guard, storeAccess, context } = setup([PERMISSIONS.EXPENSES_ADD], request);
    (storeAccess.require as jest.Mock).mockResolvedValue(ACCESS); // only has expenses.view

    await expect(guard.canActivate(context)).rejects.toMatchObject(
      new ForbiddenException({
        statusCode: 403,
        error: 'Forbidden',
        message:
          "You don't have permission to access Expenses. Please contact your store owner to request access.",
        reason: 'PERMISSION_DENIED',
        module: 'expenses',
        missingPermissions: [PERMISSIONS.EXPENSES_ADD],
      }),
    );
  });

  it('requires ALL listed permissions (AND, not OR)', async () => {
    const request: Record<string, unknown> = { user: { userId: 'staff-user' } };
    const { guard, storeAccess, context } = setup(
      [PERMISSIONS.EXPENSES_VIEW, PERMISSIONS.EXPENSES_DELETE],
      request,
    );
    (storeAccess.require as jest.Mock).mockResolvedValue(ACCESS); // has view, not delete

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('an owner (all permissions) always passes a permission-gated route', async () => {
    const request: Record<string, unknown> = { user: { userId: 'owner-user' } };
    const { guard, storeAccess, context } = setup([PERMISSIONS.EXPENSES_DELETE], request);
    (storeAccess.require as jest.Mock).mockResolvedValue({
      ...ACCESS,
      isOwner: true,
      staffMemberId: null,
      permissions: [PERMISSIONS.EXPENSES_DELETE],
    });

    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it('propagates the deactivated-staff ForbiddenException from StoreAccessService as-is', async () => {
    const request: Record<string, unknown> = { user: { userId: 'staff-user' } };
    const { guard, storeAccess, context } = setup([PERMISSIONS.EXPENSES_VIEW], request);
    (storeAccess.require as jest.Mock).mockRejectedValue(
      new ForbiddenException('This staff account has been deactivated'),
    );

    await expect(guard.canActivate(context)).rejects.toThrow(
      'This staff account has been deactivated',
    );
  });
});
