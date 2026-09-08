import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { StaffStatus } from '@prisma/client';
import { StoreAccessService, resolvePermissions } from './store-access.service';
import { ALL_PERMISSIONS, PERMISSIONS } from './permissions';

type PrismaStub = {
  store: { findUnique: jest.Mock };
  staffMember: { findUnique: jest.Mock; update: jest.Mock };
};

function build(prisma: Partial<PrismaStub> = {}) {
  const stub: PrismaStub = {
    store: { findUnique: jest.fn().mockResolvedValue(null) },
    staffMember: {
      findUnique: jest.fn().mockResolvedValue(null),
      update: jest.fn().mockResolvedValue({}),
    },
    ...prisma,
  } as PrismaStub;
  return { service: new StoreAccessService(stub as never), prisma: stub };
}

const STORE = { id: 'store-1', baseCurrency: 'MAD' };

describe('StoreAccessService', () => {
  it('resolves an owner and grants every permission', async () => {
    const { service } = build({
      store: { findUnique: jest.fn().mockResolvedValue(STORE) },
    });

    const access = await service.require('owner-user');

    expect(access.isOwner).toBe(true);
    expect(access.storeId).toBe('store-1');
    expect(access.staffMemberId).toBeNull();
    expect(access.permissions).toHaveLength(ALL_PERMISSIONS.length);
  });

  it('resolves a staff member to their store with only their role permissions', async () => {
    const { service } = build({
      staffMember: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'staff-1',
          status: StaffStatus.ACTIVE,
          permissionOverrides: [],
          store: STORE,
          role: { permissions: [PERMISSIONS.ORDERS_VIEW, PERMISSIONS.RETURNS_SCAN] },
        }),
        update: jest.fn(),
      },
    });

    const access = await service.require('staff-user');

    // The whole point of the foundation: a staff member reaches the owner's
    // store even though Store.userId only ever matches the owner.
    expect(access.storeId).toBe('store-1');
    expect(access.isOwner).toBe(false);
    expect(access.staffMemberId).toBe('staff-1');
    expect(access.permissions).toEqual([
      PERMISSIONS.ORDERS_VIEW,
      PERMISSIONS.RETURNS_SCAN,
    ]);
  });

  it('locks out a deactivated staff member even though their login still works', async () => {
    const { service } = build({
      staffMember: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'staff-1',
          status: StaffStatus.INACTIVE,
          permissionOverrides: [],
          store: STORE,
          role: { permissions: [PERMISSIONS.ORDERS_VIEW] },
        }),
        update: jest.fn(),
      },
    });

    await expect(service.require('staff-user')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('throws NotFound when the user is neither owner nor staff', async () => {
    const { service } = build();
    await expect(service.require('nobody')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('refuses staff on requireOwner, allows the owner', async () => {
    const staff = build({
      staffMember: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'staff-1',
          status: StaffStatus.ACTIVE,
          permissionOverrides: [],
          store: STORE,
          role: { permissions: ALL_PERMISSIONS },
        }),
        update: jest.fn(),
      },
    });
    // Even a staff member holding every permission cannot manage staff/roles.
    await expect(staff.service.requireOwner('staff-user')).rejects.toBeInstanceOf(
      ForbiddenException,
    );

    const owner = build({
      store: { findUnique: jest.fn().mockResolvedValue(STORE) },
    });
    await expect(owner.service.requireOwner('owner-user')).resolves.toMatchObject({
      isOwner: true,
    });
  });
});

describe('resolvePermissions', () => {
  it('inherits the role when there are no overrides', () => {
    expect(resolvePermissions([PERMISSIONS.ORDERS_VIEW], [])).toEqual([
      PERMISSIONS.ORDERS_VIEW,
    ]);
  });

  it('lets a non-empty override replace the role entirely', () => {
    expect(
      resolvePermissions([PERMISSIONS.ORDERS_VIEW], [PERMISSIONS.EXPENSES_ADD]),
    ).toEqual([PERMISSIONS.EXPENSES_ADD]);
  });

  it('drops unknown permission strings rather than trusting stored data', () => {
    expect(
      resolvePermissions([PERMISSIONS.ORDERS_VIEW, 'orders.nuke'], []),
    ).toEqual([PERMISSIONS.ORDERS_VIEW]);
  });
});
