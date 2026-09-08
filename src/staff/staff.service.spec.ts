import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { StaffStatus } from '@prisma/client';
import { StaffService } from './staff.service';
import { PERMISSIONS } from '../access/permissions';

const STORE_ACCESS = { storeId: 'store-1', isOwner: true };

function build() {
  const prisma = {
    user: { findUnique: jest.fn(), create: jest.fn() },
    staffMember: { findMany: jest.fn(), findFirst: jest.fn(), count: jest.fn(), update: jest.fn() },
    role: { findFirst: jest.fn() },
  };
  const storeAccess = { requireOwner: jest.fn().mockResolvedValue(STORE_ACCESS) };
  const service = new StaffService(prisma as never, storeAccess as never);
  return { service, prisma, storeAccess };
}

const STAFF_ROW = {
  id: 'staff-1',
  name: 'Sara Amrani',
  jobTitle: 'Ops',
  photoUrl: null,
  status: StaffStatus.ACTIVE,
  joinedAt: new Date('2026-01-01'),
  lastActiveAt: null,
  lastLoginAt: null,
  permissionOverrides: [],
  user: { phone: '+212600000002' },
  role: { id: 'role-1', name: 'Manager', permissions: [PERMISSIONS.ORDERS_VIEW] },
  salaryProfile: null,
};

describe('StaffService', () => {
  it('rejects any non-owner via requireOwner', async () => {
    const { service, storeAccess, prisma } = build();
    storeAccess.requireOwner.mockRejectedValue(new ForbiddenException('nope'));
    await expect(service.list('staff-user', {})).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.staffMember.findMany).not.toHaveBeenCalled();
  });

  it('rejects creating staff with a phone already in use', async () => {
    const { service, prisma } = build();
    prisma.user.findUnique.mockResolvedValue({ id: 'existing-user' });

    await expect(
      service.create('owner-user', {
        name: 'X',
        phone: '+212600000002',
        password: 'password123',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('rejects creating staff with a role from another store', async () => {
    const { service, prisma } = build();
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.role.findFirst.mockResolvedValue(null);

    await expect(
      service.create('owner-user', {
        name: 'X',
        phone: '+212600000003',
        password: 'password123',
        roleId: 'role-from-elsewhere',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('creates staff and resolves effective permissions from the role', async () => {
    const { service, prisma } = build();
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.role.findFirst.mockResolvedValue({ id: 'role-1' });
    prisma.user.create.mockResolvedValue({ staffMembership: STAFF_ROW });

    const result = await service.create('owner-user', {
      name: 'Sara Amrani',
      phone: '+212600000002',
      password: 'password123',
      roleId: 'role-1',
    });

    expect(result.effectivePermissions).toEqual([PERMISSIONS.ORDERS_VIEW]);
    expect(result.hasOverrides).toBe(false);
    // Password must never leak back out.
    expect(result).not.toHaveProperty('password');
    expect(result).not.toHaveProperty('passwordHash');
  });

  it('non-empty permissionOverrides replaces the role entirely for that person', async () => {
    const { service, prisma } = build();
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.user.create.mockResolvedValue({
      staffMembership: {
        ...STAFF_ROW,
        permissionOverrides: [PERMISSIONS.EXPENSES_VIEW],
      },
    });

    const result = await service.create('owner-user', {
      name: 'Sara Amrani',
      phone: '+212600000002',
      password: 'password123',
      permissionOverrides: [PERMISSIONS.EXPENSES_VIEW],
    });

    expect(result.effectivePermissions).toEqual([PERMISSIONS.EXPENSES_VIEW]);
    expect(result.hasOverrides).toBe(true);
  });

  it('404s editing staff outside this store', async () => {
    const { service, prisma } = build();
    prisma.staffMember.findFirst.mockResolvedValue(null);

    await expect(
      service.update('owner-user', 'someone-elses-staff', { name: 'x' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('leaving password blank on update never touches passwordHash', async () => {
    const { service, prisma } = build();
    prisma.staffMember.findFirst.mockResolvedValue(STAFF_ROW);
    prisma.staffMember.update.mockResolvedValue(STAFF_ROW);

    await service.update('owner-user', 'staff-1', { name: 'Renamed' });

    const call = prisma.staffMember.update.mock.calls[0][0];
    expect(call.data.user.update.passwordHash).toBeUndefined();
  });

  it('deactivating staff never deletes the row', async () => {
    const { service, prisma } = build();
    prisma.staffMember.findFirst.mockResolvedValue(STAFF_ROW);
    prisma.staffMember.update.mockResolvedValue({ ...STAFF_ROW, status: StaffStatus.INACTIVE });

    const result = await service.setStatus('owner-user', 'staff-1', StaffStatus.INACTIVE);

    expect(result.status).toBe(StaffStatus.INACTIVE);
    expect(prisma.staffMember.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: StaffStatus.INACTIVE } }),
    );
  });
});
