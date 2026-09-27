import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { StaffStatus } from '@prisma/client';
import {
  ALL_PERMISSIONS,
  PERMISSION_MODULES,
  type Permission,
  type PermissionModule,
} from '../permissions';

export class AccessMeResponseDto {
  @ApiProperty()
  storeId!: string;

  @ApiProperty()
  baseCurrency!: string;

  @ApiProperty({
    description: 'True when the caller owns the store. Owners manage staff/roles; staff never can.',
  })
  isOwner!: boolean;

  @ApiPropertyOptional({
    nullable: true,
    type: String,
    description: 'StaffMember id when the caller is staff; null for owners.',
  })
  staffMemberId!: string | null;

  @ApiPropertyOptional({
    enum: StaffStatus,
    nullable: true,
    description: 'Staff account status. Null for owners.',
  })
  status!: StaffStatus | null;

  @ApiPropertyOptional({
    nullable: true,
    type: String,
    description: 'Assigned role name when the caller is staff; null for owners or unassigned staff.',
  })
  roleName!: string | null;

  @ApiProperty({
    enum: ALL_PERMISSIONS,
    isArray: true,
    description: 'Effective permissions for this session. Owners receive the full catalogue.',
  })
  effectivePermissions!: Permission[];

  @ApiProperty({
    description: 'Same permissions grouped by module for nav / Access Restricted screens.',
    type: 'object',
    additionalProperties: {
      type: 'array',
      items: { type: 'string', enum: ALL_PERMISSIONS },
    },
  })
  permissionsByModule!: Record<PermissionModule, Permission[]>;
}

export class PermissionModuleDto {
  @ApiProperty({ enum: Object.values(PERMISSION_MODULES) })
  module!: PermissionModule;

  @ApiProperty({ enum: ALL_PERMISSIONS, isArray: true })
  permissions!: Permission[];
}

export class PermissionsCatalogueResponseDto {
  @ApiProperty({ type: [PermissionModuleDto] })
  modules!: PermissionModuleDto[];
}
