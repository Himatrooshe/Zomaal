import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateUserProfileDto } from './dto/update-user-profile.dto';
import { ChangePasswordDto } from './dto/change-password.dto';

const BCRYPT_ROUNDS = 10;

type UserWithProfileRelations = Prisma.UserGetPayload<{
  include: {
    stores: true;
    activeStore: true;
    staffMembership: true;
  };
}>;

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  async getProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        stores: { orderBy: { createdAt: 'asc' } },
        activeStore: true,
        staffMembership: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return this.toProfileResponse(user);
  }

  // name/photo/address/city never live on User directly — every other part
  // of this codebase keeps display fields on the store-scoped record
  // instead (see StaffMember.name's own comment for why). This resolves
  // the same way: the store owner edits the *active* Store's fields, a
  // staff member edits their own StaffMember fields. Phone is deliberately
  // not handled here — see AuthService.requestPhoneChange/confirmPhoneChange.
  async updateProfile(userId: string, dto: UpdateUserProfileDto) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        stores: { orderBy: { createdAt: 'asc' } },
        activeStore: true,
        staffMembership: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (
      dto.name === undefined &&
      dto.photoUrl === undefined &&
      dto.address === undefined &&
      dto.city === undefined
    ) {
      throw new BadRequestException('Provide at least one field to update');
    }

    const activeStore =
      user.activeStore ??
      user.stores.find((s) => s.id === user.activeStoreId) ??
      user.stores[0] ??
      null;

    if (activeStore) {
      await this.prisma.store.update({
        where: { id: activeStore.id },
        data: {
          ...(dto.name !== undefined && { ownerName: dto.name }),
          ...(dto.photoUrl !== undefined && { ownerPhotoUrl: dto.photoUrl }),
          ...(dto.address !== undefined && { address: dto.address }),
          ...(dto.city !== undefined && { city: dto.city }),
        },
      });
      if (!user.activeStoreId) {
        await this.prisma.user.update({
          where: { id: userId },
          data: { activeStoreId: activeStore.id },
        });
      }
    } else if (user.staffMembership) {
      await this.prisma.staffMember.update({
        where: { id: user.staffMembership.id },
        data: {
          ...(dto.name !== undefined && { name: dto.name }),
          ...(dto.photoUrl !== undefined && { photoUrl: dto.photoUrl }),
          ...(dto.address !== undefined && { address: dto.address }),
          ...(dto.city !== undefined && { city: dto.city }),
        },
      });
    } else {
      throw new BadRequestException(
        'Complete store setup before editing your profile',
      );
    }

    return this.getProfile(userId);
  }

  async changePassword(userId: string, dto: ChangePasswordDto) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (user.passwordHash) {
      if (!dto.currentPassword) {
        throw new BadRequestException('Current password is required');
      }

      const currentMatches = await bcrypt.compare(
        dto.currentPassword,
        user.passwordHash,
      );
      if (!currentMatches) {
        throw new UnauthorizedException('Current password is incorrect');
      }

      const sameAsCurrent = await bcrypt.compare(
        dto.newPassword,
        user.passwordHash,
      );
      if (sameAsCurrent) {
        throw new BadRequestException(
          'New password must be different from the current password',
        );
      }
    }

    const passwordHash = await bcrypt.hash(dto.newPassword, BCRYPT_ROUNDS);

    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash, hashedRefreshToken: null },
    });

    return { message: 'Password updated successfully' };
  }

  async deleteAccount(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    await this.prisma.user.delete({ where: { id: userId } });

    return { message: 'Account deleted successfully' };
  }

  private toProfileResponse(user: UserWithProfileRelations) {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { hashedRefreshToken, passwordHash, staffMembership, stores, activeStore, activeStoreId, ...result } =
      user;

    const current =
      activeStore ??
      stores.find((s) => s.id === activeStoreId) ??
      stores[0] ??
      null;

    return {
      ...result,
      name: current?.ownerName ?? staffMembership?.name ?? null,
      photoUrl: current?.ownerPhotoUrl ?? staffMembership?.photoUrl ?? null,
      address: current?.address ?? staffMembership?.address ?? null,
      city: current?.city ?? staffMembership?.city ?? null,
      store: current
        ? {
            ...current,
            isCurrent: true,
            createdAt: current.createdAt.toISOString(),
            updatedAt: current.updatedAt.toISOString(),
          }
        : null,
      stores: stores.map((s) => ({
        ...s,
        isCurrent: current ? s.id === current.id : false,
        createdAt: s.createdAt.toISOString(),
        updatedAt: s.updatedAt.toISOString(),
      })),
    };
  }
}
