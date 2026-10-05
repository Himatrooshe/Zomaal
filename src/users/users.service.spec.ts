import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { UsersService } from './users.service';

type UserUpdateCall = {
  where: { id: string };
  data: Record<string, unknown>;
};

type PrismaStub = {
  user: {
    findUnique: jest.Mock;
    update: jest.Mock<unknown, [UserUpdateCall]>;
    delete: jest.Mock;
    findMany: jest.Mock;
    deleteMany: jest.Mock;
  };
  store: { update: jest.Mock };
  staffMember: { update: jest.Mock };
};

function build() {
  const prisma: PrismaStub = {
    user: {
      findUnique: jest.fn(),
      update: jest.fn<unknown, [UserUpdateCall]>(),
      delete: jest.fn(),
      findMany: jest.fn(),
      deleteMany: jest.fn(),
    },
    store: { update: jest.fn() },
    staffMember: { update: jest.fn() },
  };
  const service = new UsersService(prisma as never);
  return { service, prisma };
}

const BASE_USER = {
  id: 'user-1',
  phone: '+212600000001',
  isPhoneVerified: true,
  onboardingComplete: true,
  passwordHash: null,
  hashedRefreshToken: 'hashed',
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
};

const STORE_ROW = {
  id: 'store-1',
  ownerName: 'Ahmed Alaoui',
  ownerPhotoUrl: 'https://example.com/avatar.png',
  address: '123 Rue Hassan II',
  city: 'Casablanca',
  businessName: 'Atlas',
  country: 'Morocco',
  logoUrl: null,
  isActive: true,
  baseCurrency: 'MAD',
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
  userId: 'user-1',
};

describe('UsersService', () => {
  describe('getProfile', () => {
    it('throws NotFoundException when the user no longer exists', async () => {
      const { service, prisma } = build();
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.getProfile('missing')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('resolves name/photoUrl/address/city from the active store for an owner and strips secrets', async () => {
      const { service, prisma } = build();
      prisma.user.findUnique.mockResolvedValue({
        ...BASE_USER,
        activeStoreId: 'store-1',
        activeStore: STORE_ROW,
        stores: [STORE_ROW],
        staffMembership: null,
      });

      const profile = await service.getProfile('user-1');

      expect(profile.name).toBe('Ahmed Alaoui');
      expect(profile.photoUrl).toBe('https://example.com/avatar.png');
      expect(profile.address).toBe('123 Rue Hassan II');
      expect(profile.city).toBe('Casablanca');
      expect(profile.stores).toHaveLength(1);
      expect(profile.stores[0].isCurrent).toBe(true);
      expect(profile).not.toHaveProperty('passwordHash');
      expect(profile).not.toHaveProperty('hashedRefreshToken');
    });

    it('resolves name/photoUrl/address/city from the staff record for a staff member', async () => {
      const { service, prisma } = build();
      prisma.user.findUnique.mockResolvedValue({
        ...BASE_USER,
        activeStoreId: null,
        activeStore: null,
        stores: [],
        staffMembership: {
          id: 'staff-1',
          name: 'Sara Amrani',
          photoUrl: null,
          address: null,
          city: null,
        },
      });

      const profile = await service.getProfile('user-1');

      expect(profile.name).toBe('Sara Amrani');
      expect(profile.photoUrl).toBeNull();
      expect(profile.address).toBeNull();
      expect(profile.city).toBeNull();
      expect(profile.stores).toEqual([]);
    });

    it('returns null name/photoUrl/address/city for a user with neither a store nor a staff membership', async () => {
      const { service, prisma } = build();
      prisma.user.findUnique.mockResolvedValue({
        ...BASE_USER,
        activeStoreId: null,
        activeStore: null,
        stores: [],
        staffMembership: null,
      });

      const profile = await service.getProfile('user-1');

      expect(profile.name).toBeNull();
      expect(profile.photoUrl).toBeNull();
      expect(profile.address).toBeNull();
      expect(profile.city).toBeNull();
    });
  });

  describe('updateProfile', () => {
    it('rejects when no fields are supplied', async () => {
      const { service, prisma } = build();
      prisma.user.findUnique.mockResolvedValue({
        ...BASE_USER,
        activeStoreId: 'store-1',
        activeStore: { id: 'store-1' },
        stores: [{ id: 'store-1' }],
        staffMembership: null,
      });

      await expect(service.updateProfile('user-1', {})).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(prisma.store.update).not.toHaveBeenCalled();
    });

    it('writes name/photo to the active store for an owner', async () => {
      const { service, prisma } = build();
      prisma.user.findUnique
        .mockResolvedValueOnce({
          ...BASE_USER,
          activeStoreId: 'store-1',
          activeStore: { id: 'store-1' },
          stores: [{ id: 'store-1' }],
          staffMembership: null,
        })
        .mockResolvedValueOnce({
          ...BASE_USER,
          activeStoreId: 'store-1',
          activeStore: {
            ...STORE_ROW,
            ownerName: 'New Name',
            ownerPhotoUrl: 'https://example.com/new.png',
          },
          stores: [
            {
              ...STORE_ROW,
              ownerName: 'New Name',
              ownerPhotoUrl: 'https://example.com/new.png',
            },
          ],
          staffMembership: null,
        });

      const profile = await service.updateProfile('user-1', {
        name: 'New Name',
        photoUrl: 'https://example.com/new.png',
      });

      expect(prisma.store.update).toHaveBeenCalledWith({
        where: { id: 'store-1' },
        data: {
          ownerName: 'New Name',
          ownerPhotoUrl: 'https://example.com/new.png',
        },
      });
      expect(prisma.staffMember.update).not.toHaveBeenCalled();
      expect(profile.name).toBe('New Name');
    });

    it('writes address/city to the active store for an owner', async () => {
      const { service, prisma } = build();
      prisma.user.findUnique
        .mockResolvedValueOnce({
          ...BASE_USER,
          activeStoreId: 'store-1',
          activeStore: { id: 'store-1' },
          stores: [{ id: 'store-1' }],
          staffMembership: null,
        })
        .mockResolvedValueOnce({
          ...BASE_USER,
          activeStoreId: 'store-1',
          activeStore: {
            ...STORE_ROW,
            address: '45 Boulevard Zerktouni',
            city: 'Casablanca',
          },
          stores: [
            {
              ...STORE_ROW,
              address: '45 Boulevard Zerktouni',
              city: 'Casablanca',
            },
          ],
          staffMembership: null,
        });

      await service.updateProfile('user-1', {
        address: '45 Boulevard Zerktouni',
        city: 'Casablanca',
      });

      expect(prisma.store.update).toHaveBeenCalledWith({
        where: { id: 'store-1' },
        data: { address: '45 Boulevard Zerktouni', city: 'Casablanca' },
      });
    });

    it('writes address/city to the staff record for a staff member', async () => {
      const { service, prisma } = build();
      prisma.user.findUnique
        .mockResolvedValueOnce({
          ...BASE_USER,
          activeStoreId: null,
          activeStore: null,
          stores: [],
          staffMembership: { id: 'staff-1' },
        })
        .mockResolvedValueOnce({
          ...BASE_USER,
          activeStoreId: null,
          activeStore: null,
          stores: [],
          staffMembership: {
            id: 'staff-1',
            name: 'Sara Amrani',
            address: '45 Boulevard Zerktouni',
            city: 'Casablanca',
          },
        });

      await service.updateProfile('user-1', {
        address: '45 Boulevard Zerktouni',
        city: 'Casablanca',
      });

      expect(prisma.staffMember.update).toHaveBeenCalledWith({
        where: { id: 'staff-1' },
        data: { address: '45 Boulevard Zerktouni', city: 'Casablanca' },
      });
      expect(prisma.store.update).not.toHaveBeenCalled();
    });

    it('writes name/photo to the staff record for a staff member', async () => {
      const { service, prisma } = build();
      prisma.user.findUnique
        .mockResolvedValueOnce({
          ...BASE_USER,
          activeStoreId: null,
          activeStore: null,
          stores: [],
          staffMembership: { id: 'staff-1' },
        })
        .mockResolvedValueOnce({
          ...BASE_USER,
          activeStoreId: null,
          activeStore: null,
          stores: [],
          staffMembership: { id: 'staff-1', name: 'New Name', photoUrl: null },
        });

      await service.updateProfile('user-1', { name: 'New Name' });

      expect(prisma.staffMember.update).toHaveBeenCalledWith({
        where: { id: 'staff-1' },
        data: { name: 'New Name' },
      });
      expect(prisma.store.update).not.toHaveBeenCalled();
    });

    it('rejects when the user has neither a store nor a staff membership', async () => {
      const { service, prisma } = build();
      prisma.user.findUnique.mockResolvedValue({
        ...BASE_USER,
        activeStoreId: null,
        activeStore: null,
        stores: [],
        staffMembership: null,
      });

      await expect(
        service.updateProfile('user-1', { name: 'New Name' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('changePassword', () => {
    it('sets a password for the first time without requiring currentPassword', async () => {
      const { service, prisma } = build();
      prisma.user.findUnique.mockResolvedValue({
        ...BASE_USER,
        passwordHash: null,
      });

      const result = await service.changePassword('user-1', {
        newPassword: 'NewPass123',
      });

      expect(result).toEqual({ message: 'Password updated successfully' });
      const call = prisma.user.update.mock.calls[0][0];
      expect(call.where).toEqual({ id: 'user-1' });
      expect(call.data.hashedRefreshToken).toBeNull();
      expect(await bcrypt.compare('NewPass123', call.data.passwordHash)).toBe(
        true,
      );
    });

    it('requires currentPassword when a password already exists', async () => {
      const { service, prisma } = build();
      const existingHash = await bcrypt.hash('OldPass123', 10);
      prisma.user.findUnique.mockResolvedValue({
        ...BASE_USER,
        passwordHash: existingHash,
      });

      await expect(
        service.changePassword('user-1', { newPassword: 'NewPass123' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('rejects an incorrect currentPassword', async () => {
      const { service, prisma } = build();
      const existingHash = await bcrypt.hash('OldPass123', 10);
      prisma.user.findUnique.mockResolvedValue({
        ...BASE_USER,
        passwordHash: existingHash,
      });

      await expect(
        service.changePassword('user-1', {
          currentPassword: 'WrongPassword',
          newPassword: 'NewPass123',
        }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('rejects a new password identical to the current one', async () => {
      const { service, prisma } = build();
      const existingHash = await bcrypt.hash('SamePass123', 10);
      prisma.user.findUnique.mockResolvedValue({
        ...BASE_USER,
        passwordHash: existingHash,
      });

      await expect(
        service.changePassword('user-1', {
          currentPassword: 'SamePass123',
          newPassword: 'SamePass123',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('updates the password and revokes the refresh token when currentPassword matches', async () => {
      const { service, prisma } = build();
      const existingHash = await bcrypt.hash('OldPass123', 10);
      prisma.user.findUnique.mockResolvedValue({
        ...BASE_USER,
        passwordHash: existingHash,
      });

      await service.changePassword('user-1', {
        currentPassword: 'OldPass123',
        newPassword: 'NewPass123',
      });

      const call = prisma.user.update.mock.calls[0][0];
      expect(call.data.hashedRefreshToken).toBeNull();
      expect(await bcrypt.compare('NewPass123', call.data.passwordHash)).toBe(
        true,
      );
    });

    it('throws NotFoundException when the user no longer exists', async () => {
      const { service, prisma } = build();
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.changePassword('missing', { newPassword: 'NewPass123' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('deleteAccount', () => {
    const NOW = new Date('2026-10-05T12:00:00.000Z');
    const IN_30_DAYS = new Date('2026-11-04T12:00:00.000Z');

    it('schedules deletion 30 days out and signs out other devices', async () => {
      const { service, prisma } = build();
      prisma.user.findUnique.mockResolvedValue({
        ...BASE_USER,
        deletionScheduledFor: null,
      });

      const result = await service.deleteAccount('user-1', NOW);

      expect(prisma.user.delete).not.toHaveBeenCalled();
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: {
          deletionRequestedAt: NOW,
          deletionScheduledFor: IN_30_DAYS,
          hashedRefreshToken: null,
        },
      });
      expect(result.deletionScheduledFor).toBe(IN_30_DAYS.toISOString());
    });

    it('keeps the original date when asked again', async () => {
      const { service, prisma } = build();
      prisma.user.findUnique.mockResolvedValue({
        ...BASE_USER,
        deletionScheduledFor: IN_30_DAYS,
      });

      const result = await service.deleteAccount(
        'user-1',
        new Date('2026-10-20T00:00:00.000Z'),
      );

      expect(prisma.user.update).not.toHaveBeenCalled();
      expect(result.deletionScheduledFor).toBe(IN_30_DAYS.toISOString());
    });

    it('throws NotFoundException when the user no longer exists', async () => {
      const { service, prisma } = build();
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.deleteAccount('missing')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('cancelDeletion', () => {
    it('clears a pending deletion', async () => {
      const { service, prisma } = build();
      prisma.user.findUnique.mockResolvedValue({
        ...BASE_USER,
        deletionScheduledFor: new Date('2026-11-04T12:00:00.000Z'),
      });

      await service.cancelDeletion('user-1');

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { deletionRequestedAt: null, deletionScheduledFor: null },
      });
    });

    it('409 when nothing is pending', async () => {
      const { service, prisma } = build();
      prisma.user.findUnique.mockResolvedValue({
        ...BASE_USER,
        deletionScheduledFor: null,
      });

      await expect(service.cancelDeletion('user-1')).rejects.toBeInstanceOf(
        ConflictException,
      );
    });
  });

  describe('purgeDueAccounts', () => {
    it('deletes only accounts still due, so a last-second cancel wins', async () => {
      const { service, prisma } = build();
      const now = new Date('2026-11-04T12:00:00.000Z');
      prisma.user.findMany.mockResolvedValue([{ id: 'a' }, { id: 'b' }]);
      prisma.user.deleteMany
        .mockResolvedValueOnce({ count: 1 })
        .mockResolvedValueOnce({ count: 0 });

      const result = await service.purgeDueAccounts(now);

      expect(prisma.user.deleteMany).toHaveBeenCalledWith({
        where: { id: 'a', deletionScheduledFor: { lte: now } },
      });
      expect(result).toEqual({ due: 2, deleted: 1, failed: 0 });
    });

    it('keeps going when one purge fails', async () => {
      const { service, prisma } = build();
      prisma.user.findMany.mockResolvedValue([{ id: 'a' }, { id: 'b' }]);
      prisma.user.deleteMany
        .mockRejectedValueOnce(new Error('boom'))
        .mockResolvedValueOnce({ count: 1 });

      const result = await service.purgeDueAccounts();

      expect(result).toEqual({ due: 2, deleted: 1, failed: 1 });
    });
  });
});
