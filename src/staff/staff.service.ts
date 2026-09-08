import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, StaffStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { StoreAccessService, resolvePermissions } from '../access/store-access.service';
import type { Permission } from '../access/permissions';
import {
  CreateStaffDto,
  StaffDetailResponseDto,
  StaffListQueryDto,
  StaffListResponseDto,
  StaffResponseDto,
  UpdateStaffDto,
} from './dto/staff.dto';

const STAFF_INCLUDE = {
  user: { select: { phone: true } },
  role: { select: { id: true, name: true } },
} satisfies Prisma.StaffMemberInclude;

const STAFF_DETAIL_INCLUDE = {
  user: { select: { phone: true } },
  role: { select: { id: true, name: true, permissions: true } },
  salaryProfile: { select: { nextPaymentDate: true } },
} satisfies Prisma.StaffMemberInclude;

type StaffWithBasics = Prisma.StaffMemberGetPayload<{ include: typeof STAFF_INCLUDE }>;
type StaffWithDetail = Prisma.StaffMemberGetPayload<{ include: typeof STAFF_DETAIL_INCLUDE }>;

const BCRYPT_ROUNDS = 10;

@Injectable()
export class StaffService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storeAccess: StoreAccessService,
  ) {}

  async list(
    userId: string,
    query: StaffListQueryDto,
  ): Promise<StaffListResponseDto> {
    const { storeId } = await this.storeAccess.requireOwner(userId);

    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const where: Prisma.StaffMemberWhereInput = {
      storeId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' } },
              { user: { phone: { contains: query.search } } },
            ],
          }
        : {}),
    };

    const [staff, total] = await Promise.all([
      this.prisma.staffMember.findMany({
        where,
        include: STAFF_INCLUDE,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.staffMember.count({ where }),
    ]);

    return {
      staff: staff.map(toStaffResponse),
      total,
      page,
      limit,
    };
  }

  async details(userId: string, staffId: string): Promise<StaffDetailResponseDto> {
    const { storeId } = await this.storeAccess.requireOwner(userId);
    const staff = await this.requireStaff(storeId, staffId, STAFF_DETAIL_INCLUDE);
    return toStaffDetailResponse(staff);
  }

  async create(userId: string, dto: CreateStaffDto): Promise<StaffDetailResponseDto> {
    const { storeId } = await this.storeAccess.requireOwner(userId);

    const existingPhone = await this.prisma.user.findUnique({
      where: { phone: dto.phone },
    });
    if (existingPhone) {
      throw new ConflictException('This phone number is already registered');
    }

    if (dto.roleId) {
      await this.requireRoleInStore(storeId, dto.roleId);
    }

    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);

    const user = await this.prisma.user.create({
      data: {
        phone: dto.phone,
        passwordHash,
        onboardingComplete: true,
        staffMembership: {
          create: {
            storeId,
            name: dto.name,
            jobTitle: dto.jobTitle ?? null,
            photoUrl: dto.photoUrl ?? null,
            roleId: dto.roleId ?? null,
            permissionOverrides: dto.permissionOverrides ?? [],
          },
        },
      },
      include: { staffMembership: { include: STAFF_DETAIL_INCLUDE } },
    });

    return toStaffDetailResponse(user.staffMembership as StaffWithDetail);
  }

  async update(
    userId: string,
    staffId: string,
    dto: UpdateStaffDto,
  ): Promise<StaffDetailResponseDto> {
    const { storeId } = await this.storeAccess.requireOwner(userId);
    const staff = await this.requireStaff(storeId, staffId, STAFF_INCLUDE);

    if (dto.phone && dto.phone !== staff.user.phone) {
      const clash = await this.prisma.user.findUnique({ where: { phone: dto.phone } });
      if (clash) {
        throw new ConflictException('This phone number is already registered');
      }
    }

    if (dto.roleId) {
      await this.requireRoleInStore(storeId, dto.roleId);
    }

    const passwordHash = dto.password
      ? await bcrypt.hash(dto.password, BCRYPT_ROUNDS)
      : undefined;

    // `user: { update }` is a nested relation write, which forces the
    // "Checked" StaffMemberUpdateInput variant — roleId must be expressed as
    // a `role` relation op (connect/disconnect) rather than the raw scalar.
    const roleOp =
      dto.roleId === undefined
        ? undefined
        : dto.roleId === null
          ? { disconnect: true }
          : { connect: { id: dto.roleId } };

    const updated = await this.prisma.staffMember.update({
      where: { id: staffId },
      data: {
        name: dto.name,
        jobTitle: dto.jobTitle,
        photoUrl: dto.photoUrl,
        role: roleOp,
        permissionOverrides: dto.permissionOverrides as Permission[] | undefined,
        user: {
          update: {
            phone: dto.phone,
            passwordHash,
          },
        },
      },
      include: STAFF_DETAIL_INCLUDE,
    });

    return toStaffDetailResponse(updated);
  }

  /**
   * Deactivate/reactivate — never delete (removal is deactivate-only).
   */
  async setStatus(
    userId: string,
    staffId: string,
    status: StaffStatus,
  ): Promise<StaffDetailResponseDto> {
    const { storeId } = await this.storeAccess.requireOwner(userId);
    await this.requireStaff(storeId, staffId, STAFF_INCLUDE);

    const updated = await this.prisma.staffMember.update({
      where: { id: staffId },
      data: { status },
      include: STAFF_DETAIL_INCLUDE,
    });

    return toStaffDetailResponse(updated);
  }

  private async requireStaff<T extends Prisma.StaffMemberInclude>(
    storeId: string,
    staffId: string,
    include: T,
  ): Promise<Prisma.StaffMemberGetPayload<{ include: T }>> {
    const staff = await this.prisma.staffMember.findFirst({
      where: { id: staffId, storeId },
      include,
    });
    if (!staff) {
      throw new NotFoundException('Staff member not found');
    }
    return staff;
  }

  private async requireRoleInStore(storeId: string, roleId: string): Promise<void> {
    const role = await this.prisma.role.findFirst({ where: { id: roleId, storeId } });
    if (!role) {
      throw new NotFoundException('Role not found');
    }
  }
}

function toStaffResponse(staff: StaffWithBasics): StaffResponseDto {
  return {
    id: staff.id,
    name: staff.name,
    phone: staff.user.phone,
    jobTitle: staff.jobTitle,
    photoUrl: staff.photoUrl,
    status: staff.status,
    role: staff.role ? { id: staff.role.id, name: staff.role.name } : null,
    joinedAt: staff.joinedAt.toISOString(),
    lastActiveAt: staff.lastActiveAt?.toISOString() ?? null,
    lastLoginAt: staff.lastLoginAt?.toISOString() ?? null,
  };
}

function toStaffDetailResponse(staff: StaffWithDetail): StaffDetailResponseDto {
  return {
    ...toStaffResponse(staff),
    effectivePermissions: resolvePermissions(
      staff.role?.permissions ?? [],
      staff.permissionOverrides,
    ),
    hasOverrides: staff.permissionOverrides.length > 0,
    nextPaymentDate: staff.salaryProfile?.nextPaymentDate?.toISOString() ?? null,
  };
}
