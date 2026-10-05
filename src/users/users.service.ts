import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateUserProfileDto } from './dto/update-user-profile.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { ACCOUNT_DELETION_GRACE_DAYS } from '../billing/plan-features';

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
  private readonly logger = new Logger(UsersService.name);

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

  /**
   * Q17.7: deletion has a 30-day grace period. The request signs out other
   * devices; the account (and, for an owner, every store) is removed by
   * purgeDueAccounts once the grace period ends.
   */
  async deleteAccount(userId: string, now: Date = new Date()) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const scheduledFor =
      user.deletionScheduledFor ??
      new Date(
        now.getTime() + ACCOUNT_DELETION_GRACE_DAYS * 24 * 60 * 60 * 1000,
      );

    if (!user.deletionScheduledFor) {
      await this.prisma.user.update({
        where: { id: userId },
        data: {
          deletionRequestedAt: now,
          deletionScheduledFor: scheduledFor,
          hashedRefreshToken: null,
        },
      });
    }

    return {
      message: `Your account will be permanently deleted in ${ACCOUNT_DELETION_GRACE_DAYS} days. Log in and cancel before then to keep it.`,
      deletionScheduledFor: scheduledFor.toISOString(),
    };
  }

  async cancelDeletion(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });

    if (!user) {
      throw new NotFoundException('User not found');
    }
    if (!user.deletionScheduledFor) {
      throw new ConflictException('No account deletion is pending');
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: { deletionRequestedAt: null, deletionScheduledFor: null },
    });

    return {
      message: 'Account deletion cancelled',
      deletionScheduledFor: null,
    };
  }

  /** Scheduler: permanently delete accounts whose grace period has ended. */
  async purgeDueAccounts(now: Date = new Date(), batchSize = 50) {
    const due = await this.prisma.user.findMany({
      where: { deletionScheduledFor: { lte: now } },
      select: { id: true },
      orderBy: { deletionScheduledFor: 'asc' },
      take: batchSize,
    });

    let deleted = 0;
    let failed = 0;
    for (const { id } of due) {
      try {
        // deleteMany re-checks the condition, so a last-second cancel wins.
        const result = await this.prisma.user.deleteMany({
          where: { id, deletionScheduledFor: { lte: now } },
        });
        deleted += result.count;
      } catch (error) {
        failed += 1;
        this.logger.error(`Failed to purge account ${id}: ${String(error)}`);
      }
    }

    return { due: due.length, deleted, failed };
  }

  private toProfileResponse(user: UserWithProfileRelations) {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const {
      hashedRefreshToken,
      passwordHash,
      staffMembership,
      stores,
      activeStore,
      activeStoreId,
      ...result
    } = user;

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
