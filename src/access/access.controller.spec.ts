import { AccessController } from './access.controller';
import { PERMISSIONS, PERMISSIONS_BY_MODULE, ALL_PERMISSIONS } from './permissions';
import type { StoreAccessService } from './store-access.service';

describe('AccessController', () => {
  it('returns session bootstrap from StoreAccessService.session', async () => {
    const session = jest.fn().mockResolvedValue({
      storeId: 'store-1',
      baseCurrency: 'MAD',
      isOwner: false,
      staffMemberId: 'staff-1',
      status: 'ACTIVE',
      roleName: 'Operations Manager',
      effectivePermissions: [PERMISSIONS.ORDERS_VIEW],
      permissionsByModule: {
        ...Object.fromEntries(
          Object.keys(PERMISSIONS_BY_MODULE).map((m) => [m, []]),
        ),
        orders: [PERMISSIONS.ORDERS_VIEW],
      },
    });
    const controller = new AccessController({
      session,
    } as unknown as StoreAccessService);

    const result = await controller.me({ userId: 'user-1' } as never);

    expect(session).toHaveBeenCalledWith('user-1');
    expect(result.isOwner).toBe(false);
    expect(result.effectivePermissions).toEqual([PERMISSIONS.ORDERS_VIEW]);
  });

  it('returns the full permission catalogue grouped by module', () => {
    const controller = new AccessController({} as StoreAccessService);
    const result = controller.catalogue();

    expect(result.modules).toHaveLength(Object.keys(PERMISSIONS_BY_MODULE).length);
    const allKeys = result.modules.flatMap((m) => m.permissions);
    expect(allKeys).toEqual(expect.arrayContaining(ALL_PERMISSIONS));
    expect(allKeys).toHaveLength(ALL_PERMISSIONS.length);
  });
});
