import {
  BadRequestException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { UsersService } from './users.service';

type UserUpdateCall = {
  where: { id: string };
  data: { hashedRefreshToken: string | null; passwordHash: string };
};

type PrismaStub = {
  user: {
    findUnique: jest.Mock;
    update: jest.Mock<unknown, [UserUpdateCall]>;
    delete: jest.Mock;
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

describe('UsersService', () => {
  describe('getProfile', () => {
    it('throws NotFoundException when the user no longer exists', async () => {
      const { service, prisma } = build();
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.getProfile('missing')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('resolves name/photoUrl from the store for an owner and strips secrets', async () => {
      const { service, prisma } = build();
      prisma.user.findUnique.mockResolvedValue({
        ...BASE_USER,
        store: {
          id: 'store-1',
          ownerName: 'Ahmed Alaoui',
          ownerPhotoUrl: 'https://example.com/avatar.png',
        },
        staffMembership: null,
      });

      const profile = await service.getProfile('user-1');

      expect(profile.name).toBe('Ahmed Alaoui');
      expect(profile.photoUrl).toBe('https://example.com/avatar.png');
      expect(profile).not.toHaveProperty('passwordHash');
      expect(profile).not.toHaveProperty('hashedRefreshToken');
    });

    it('resolves name/photoUrl from the staff record for a staff member', async () => {
      const { service, prisma } = build();
      prisma.user.findUnique.mockResolvedValue({
        ...BASE_USER,
        store: null,
        staffMembership: {
          id: 'staff-1',
          name: 'Sara Amrani',
          photoUrl: null,
        },
      });

      const profile = await service.getProfile('user-1');

      expect(profile.name).toBe('Sara Amrani');
      expect(profile.photoUrl).toBeNull();
    });

    it('returns null name/photoUrl for a user with neither a store nor a staff membership', async () => {
      const { service, prisma } = build();
      prisma.user.findUnique.mockResolvedValue({
        ...BASE_USER,
        store: null,
        staffMembership: null,
      });

      const profile = await service.getProfile('user-1');

      expect(profile.name).toBeNull();
      expect(profile.photoUrl).toBeNull();
    });
  });

  describe('updateProfile', () => {
    it('rejects when no fields are supplied', async () => {
      const { service, prisma } = build();
      prisma.user.findUnique.mockResolvedValue({
        ...BASE_USER,
        store: { id: 'store-1' },
        staffMembership: null,
      });

      await expect(service.updateProfile('user-1', {})).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(prisma.store.update).not.toHaveBeenCalled();
    });

    it('writes name/photo to the store for an owner', async () => {
      const { service, prisma } = build();
      prisma.user.findUnique
        .mockResolvedValueOnce({
          ...BASE_USER,
          store: { id: 'store-1' },
          staffMembership: null,
        })
        .mockResolvedValueOnce({
          ...BASE_USER,
          store: {
            id: 'store-1',
            ownerName: 'New Name',
            ownerPhotoUrl: 'https://example.com/new.png',
          },
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

    it('writes name/photo to the staff record for a staff member', async () => {
      const { service, prisma } = build();
      prisma.user.findUnique
        .mockResolvedValueOnce({
          ...BASE_USER,
          store: null,
          staffMembership: { id: 'staff-1' },
        })
        .mockResolvedValueOnce({
          ...BASE_USER,
          store: null,
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
        store: null,
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
    it('deletes the user', async () => {
      const { service, prisma } = build();
      prisma.user.findUnique.mockResolvedValue(BASE_USER);

      const result = await service.deleteAccount('user-1');

      expect(prisma.user.delete).toHaveBeenCalledWith({
        where: { id: 'user-1' },
      });
      expect(result).toEqual({ message: 'Account deleted successfully' });
    });

    it('throws NotFoundException when the user no longer exists', async () => {
      const { service, prisma } = build();
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.deleteAccount('missing')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });
});
