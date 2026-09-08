import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { RolesService } from './roles.service';
import { PERMISSIONS } from '../access/permissions';

const STORE_ACCESS = { storeId: 'store-1', isOwner: true };

function build() {
  const prisma = {
    role: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
  };
  const storeAccess = {
    requireOwner: jest.fn().mockResolvedValue(STORE_ACCESS),
  };
  const service = new RolesService(prisma as never, storeAccess as never);
  return { service, prisma, storeAccess };
}

const ROLE_ROW = {
  id: 'role-1',
  name: 'Manager',
  description: null,
  permissions: [PERMISSIONS.ORDERS_VIEW],
  isSystem: false,
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
  _count: { staffMembers: 0 },
};

describe('RolesService', () => {
  it('rejects any non-owner via requireOwner before touching the database', async () => {
    const { service, storeAccess, prisma } = build();
    storeAccess.requireOwner.mockRejectedValue(
      new ForbiddenException('Only the store owner can manage staff and roles'),
    );
    await expect(service.list('staff-user')).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.role.findMany).not.toHaveBeenCalled();
  });

  it('lists roles scoped to the caller\'s store', async () => {
    const { service, prisma } = build();
    prisma.role.findMany.mockResolvedValue([ROLE_ROW]);

    const result = await service.list('owner-user');

    expect(prisma.role.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { storeId: 'store-1' } }),
    );
    expect(result).toEqual([
      expect.objectContaining({ id: 'role-1', name: 'Manager', staffCount: 0 }),
    ]);
  });

  it('rejects creating a role with a name that already exists in the store', async () => {
    const { service, prisma } = build();
    prisma.role.findUnique.mockResolvedValue(ROLE_ROW);

    await expect(
      service.create('owner-user', { name: 'Manager', permissions: [] }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.role.create).not.toHaveBeenCalled();
  });

  it('creates a role scoped to the store', async () => {
    const { service, prisma } = build();
    prisma.role.findUnique.mockResolvedValue(null);
    prisma.role.create.mockResolvedValue(ROLE_ROW);

    await service.create('owner-user', {
      name: 'Manager',
      permissions: [PERMISSIONS.ORDERS_VIEW],
    });

    expect(prisma.role.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ storeId: 'store-1', name: 'Manager' }),
      }),
    );
  });

  it('404s updating a role that does not belong to this store', async () => {
    const { service, prisma } = build();
    prisma.role.findFirst.mockResolvedValue(null);

    await expect(
      service.update('owner-user', 'role-x', { name: 'New name' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('allows editing a system role (isSystem only blocks delete)', async () => {
    const { service, prisma } = build();
    const systemRole = { ...ROLE_ROW, isSystem: true };
    prisma.role.findFirst.mockResolvedValue(systemRole);
    prisma.role.findUnique.mockResolvedValue(null);
    prisma.role.update.mockResolvedValue(systemRole);

    await expect(
      service.update('owner-user', 'role-1', { description: 'edited' }),
    ).resolves.toBeDefined();
    expect(prisma.role.update).toHaveBeenCalled();
  });

  it('blocks deleting a system role', async () => {
    const { service, prisma } = build();
    prisma.role.findFirst.mockResolvedValue({ ...ROLE_ROW, isSystem: true });

    await expect(service.remove('owner-user', 'role-1')).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(prisma.role.delete).not.toHaveBeenCalled();
  });

  it('blocks deleting a role that still has staff assigned', async () => {
    const { service, prisma } = build();
    prisma.role.findFirst.mockResolvedValue({
      ...ROLE_ROW,
      _count: { staffMembers: 2 },
    });

    await expect(service.remove('owner-user', 'role-1')).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(prisma.role.delete).not.toHaveBeenCalled();
  });

  it('deletes an unused, non-system role', async () => {
    const { service, prisma } = build();
    prisma.role.findFirst.mockResolvedValue(ROLE_ROW);
    prisma.role.delete.mockResolvedValue(ROLE_ROW);

    await service.remove('owner-user', 'role-1');
    expect(prisma.role.delete).toHaveBeenCalledWith({ where: { id: 'role-1' } });
  });
});
