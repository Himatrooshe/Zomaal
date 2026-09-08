import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { StaffStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ALL_PERMISSIONS, type Permission } from './permissions';

/**
 * The single place that answers "which store is this user acting on, and what
 * are they allowed to do there".
 *
 * Before staff existed, every service resolved the store itself with
 * `prisma.store.findUnique({ where: { userId } })` — there were 7 copies of
 * that lookup plus 11 inline `store: { userId }` filters, all of which
 * silently assumed the caller owns the store. A staff member would have
 * resolved to nothing and got "Store not found".
 *
 * Callers should depend on this instead. It resolves either kind of user:
 *   - an OWNER, via the pre-existing Store.userId 1:1
 *   - a STAFF member, via StaffMember.userId
 */

export interface StoreAccess {
  storeId: string;
  baseCurrency: string;
  userId: string;
  isOwner: boolean;
  /** Null for owners — owners are not staff members. */
  staffMemberId: string | null;
  /** Owners implicitly hold every permission. */
  permissions: Permission[];
}

@Injectable()
export class StoreAccessService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Resolves the caller's store and permissions, or throws.
   *
   * Deliberately throws NotFoundException (not Forbidden) when there is no
   * store at all, matching what every existing caller already did, so
   * swapping this in doesn't change any current response.
   */
  async require(userId: string): Promise<StoreAccess> {
    const owned = await this.prisma.store.findUnique({
      where: { userId },
      select: { id: true, baseCurrency: true },
    });

    if (owned) {
      return {
        storeId: owned.id,
        baseCurrency: owned.baseCurrency,
        userId,
        isOwner: true,
        staffMemberId: null,
        // An owner is never permission-gated. Listing every permission (rather
        // than special-casing isOwner at each check) keeps callers from having
        // to remember the exception.
        permissions: [...ALL_PERMISSIONS],
      };
    }

    const staff = await this.prisma.staffMember.findUnique({
      where: { userId },
      select: {
        id: true,
        status: true,
        permissionOverrides: true,
        store: { select: { id: true, baseCurrency: true } },
        role: { select: { permissions: true } },
      },
    });

    if (!staff) {
      throw new NotFoundException('Store not found');
    }

    // A deactivated staff member keeps their login credentials but loses all
    // access. Checked here as well as at login, so deactivating someone takes
    // effect immediately rather than whenever their token happens to expire.
    if (staff.status !== StaffStatus.ACTIVE) {
      throw new ForbiddenException('This staff account has been deactivated');
    }

    return {
      storeId: staff.store.id,
      baseCurrency: staff.store.baseCurrency,
      userId,
      isOwner: false,
      staffMemberId: staff.id,
      permissions: resolvePermissions(
        staff.role?.permissions ?? [],
        staff.permissionOverrides,
      ),
    };
  }

  /**
   * Owner-only gate for things a role can never grant — managing staff and
   * managing roles. Kept as an explicit method rather than a permission so
   * it's impossible to hand out by editing a role.
   */
  async requireOwner(userId: string): Promise<StoreAccess> {
    const access = await this.require(userId);
    if (!access.isOwner) {
      throw new ForbiddenException(
        'Only the store owner can manage staff and roles',
      );
    }
    return access;
  }

  /** Records activity for the "Last Active 2 hours ago" line. Best-effort. */
  async touchLastActive(access: StoreAccess): Promise<void> {
    if (!access.staffMemberId) return;
    await this.prisma.staffMember
      .update({
        where: { id: access.staffMemberId },
        data: { lastActiveAt: new Date() },
      })
      .catch(() => undefined);
  }
}

/**
 * A staff member's own override list, when non-empty, replaces their role's
 * permissions outright. Empty means "inherit the role", which is the normal
 * case and the reason roles are worth having — editing a role updates
 * everyone still inheriting it.
 */
export function resolvePermissions(
  rolePermissions: string[],
  overrides: string[],
): Permission[] {
  const source = overrides.length > 0 ? overrides : rolePermissions;
  return source.filter((p): p is Permission =>
    (ALL_PERMISSIONS as string[]).includes(p),
  );
}
