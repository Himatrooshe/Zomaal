import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StoreAccessService } from '../access/store-access.service';
import { CreateRoleDto, UpdateRoleDto, RoleResponseDto } from './dto/role.dto';
import type { Permission } from '../access/permissions';

@Injectable()
export class RolesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storeAccess: StoreAccessService,
  ) {}

  async list(userId: string): Promise<RoleResponseDto[]> {
    const { storeId } = await this.storeAccess.requireOwner(userId);

    const roles = await this.prisma.role.findMany({
      where: { storeId },
      orderBy: { createdAt: 'asc' },
      include: { _count: { select: { staffMembers: true } } },
    });

    return roles.map(toRoleResponse);
  }

  async create(userId: string, dto: CreateRoleDto): Promise<RoleResponseDto> {
    const { storeId } = await this.storeAccess.requireOwner(userId);

    const existing = await this.prisma.role.findUnique({
      where: { storeId_name: { storeId, name: dto.name } },
    });
    if (existing) {
      throw new ConflictException('A role with this name already exists');
    }

    const role = await this.prisma.role.create({
      data: {
        storeId,
        name: dto.name,
        description: dto.description ?? null,
        permissions: dto.permissions,
      },
      include: { _count: { select: { staffMembers: true } } },
    });

    return toRoleResponse(role);
  }

  async update(
    userId: string,
    roleId: string,
    dto: UpdateRoleDto,
  ): Promise<RoleResponseDto> {
    const { storeId } = await this.storeAccess.requireOwner(userId);
    const role = await this.requireRole(storeId, roleId);

    if (dto.name && dto.name !== role.name) {
      const clash = await this.prisma.role.findUnique({
        where: { storeId_name: { storeId, name: dto.name } },
      });
      if (clash) {
        throw new ConflictException('A role with this name already exists');
      }
    }

    const updated = await this.prisma.role.update({
      where: { id: roleId },
      data: {
        name: dto.name,
        description: dto.description,
        permissions: dto.permissions as Permission[] | undefined,
      },
      include: { _count: { select: { staffMembers: true } } },
    });

    return toRoleResponse(updated);
  }

  async remove(userId: string, roleId: string): Promise<void> {
    const { storeId } = await this.storeAccess.requireOwner(userId);
    const role = await this.requireRole(storeId, roleId);

    if (role.isSystem) {
      throw new ConflictException('System roles cannot be deleted');
    }
    if (role._count.staffMembers > 0) {
      throw new ConflictException(
        'This role is still assigned to staff members. Reassign them before deleting it.',
      );
    }

    await this.prisma.role.delete({ where: { id: roleId } });
  }

  private async requireRole(storeId: string, roleId: string) {
    const role = await this.prisma.role.findFirst({
      where: { id: roleId, storeId },
      include: { _count: { select: { staffMembers: true } } },
    });
    if (!role) {
      throw new NotFoundException('Role not found');
    }
    return role;
  }
}

function toRoleResponse(role: {
  id: string;
  name: string;
  description: string | null;
  permissions: string[];
  isSystem: boolean;
  createdAt: Date;
  updatedAt: Date;
  _count: { staffMembers: number };
}): RoleResponseDto {
  return {
    id: role.id,
    name: role.name,
    description: role.description,
    permissions: role.permissions as Permission[],
    isSystem: role.isSystem,
    staffCount: role._count.staffMembers,
    createdAt: role.createdAt.toISOString(),
    updatedAt: role.updatedAt.toISOString(),
  };
}
