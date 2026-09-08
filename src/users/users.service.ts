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
  include: { store: true; staffMembership: true };
}>;

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  async getProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { store: true, staffMembership: true },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return this.toProfileResponse(user);
  }

  // name/photo/address/city never live on User directly — every other part
  // of this codebase keeps display fields on the store-scoped record
  // instead (see StaffMember.name's own comment for why). This resolves
  // the same way: the store owner edits Store's own fields, a staff member
  // edits their own StaffMember fields. A user with neither yet
  // (mid-onboarding) has nothing to write to. Phone is deliberately not
  // handled here — see AuthService.requestPhoneChange/confirmPhoneChange,
  // since changing the login identifier needs OTP re-verification.
  async updateProfile(userId: string, dto: UpdateUserProfileDto) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { store: true, staffMembership: true },
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

    if (user.store) {
      await this.prisma.store.update({
        where: { id: user.store.id },
        data: {
          ...(dto.name !== undefined && { ownerName: dto.name }),
          ...(dto.photoUrl !== undefined && { ownerPhotoUrl: dto.photoUrl }),
          ...(dto.address !== undefined && { address: dto.address }),
          ...(dto.city !== undefined && { city: dto.city }),
        },
      });
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

    // Most users only ever authenticated via OTP and have no password set —
    // this doubles as "set a password for the first time" for them, so only
    // demand (and verify) the current one when there's something to check
    // it against.
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

    // Revoke the refresh token so every other signed-in device is forced
    // back through /auth/login — the standard "log out everywhere" behavior
    // after a password change. The access token already issued to the
    // current device simply expires on its normal 15-minute schedule.
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

    // Hard delete, matching the mockup's "permanently delete" wording.
    // Every relation off User cascades (Store included, as of the
    // add-owner-photo-and-store-cascade migration), so this alone tears
    // down the store and everything scoped to it for an owner, or just the
    // staff membership for a staff account.
    await this.prisma.user.delete({ where: { id: userId } });

    return { message: 'Account deleted successfully' };
  }

  private toProfileResponse(user: UserWithProfileRelations) {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { hashedRefreshToken, passwordHash, staffMembership, ...result } =
      user;

    return {
      ...result,
      name: user.store?.ownerName ?? staffMembership?.name ?? null,
      photoUrl: user.store?.ownerPhotoUrl ?? staffMembership?.photoUrl ?? null,
      address: user.store?.address ?? staffMembership?.address ?? null,
      city: user.store?.city ?? staffMembership?.city ?? null,
    };
  }
}
