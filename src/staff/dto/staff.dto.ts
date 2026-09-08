import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { StaffStatus } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  ArrayUnique,
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsPhoneNumber,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { ALL_PERMISSIONS, type Permission } from '../../access/permissions';

export class CreateStaffDto {
  @ApiProperty({ example: 'Sara Amrani', maxLength: 120 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name!: string;

  @ApiProperty({
    description: 'Login phone number, E.164 format. Must not already belong to another account.',
    example: '+212600000002',
  })
  @IsString()
  @IsPhoneNumber()
  phone!: string;

  @ApiProperty({ minLength: 8, format: 'password', writeOnly: true })
  @IsString()
  @MinLength(8)
  password!: string;

  @ApiPropertyOptional({ example: 'Operations Manager' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  jobTitle?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  photoUrl?: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'Must belong to this store.' })
  @IsOptional()
  @IsUUID()
  roleId?: string;

  @ApiPropertyOptional({
    enum: ALL_PERMISSIONS,
    isArray: true,
    description:
      'Per-person exception list. Non-empty REPLACES the role permissions entirely for this person. Leave empty to inherit the role.',
  })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsIn(ALL_PERMISSIONS, { each: true })
  permissionOverrides?: Permission[];
}

export class UpdateStaffDto {
  @ApiPropertyOptional({ maxLength: 120 })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional({ description: 'Login phone number, E.164 format.' })
  @IsOptional()
  @IsString()
  @IsPhoneNumber()
  phone?: string;

  @ApiPropertyOptional({
    minLength: 8,
    format: 'password',
    writeOnly: true,
    description: 'Leave blank to keep the current password unchanged.',
  })
  @IsOptional()
  @IsString()
  @MinLength(8)
  password?: string;

  @ApiPropertyOptional({ maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  jobTitle?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  photoUrl?: string;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  @IsOptional()
  @IsUUID()
  roleId?: string | null;

  @ApiPropertyOptional({ enum: ALL_PERMISSIONS, isArray: true })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsIn(ALL_PERMISSIONS, { each: true })
  permissionOverrides?: Permission[];
}

export class UpdateStaffStatusDto {
  @ApiProperty({
    enum: StaffStatus,
    description: 'Staff removal is deactivate-only — there is no delete.',
  })
  @IsIn(Object.values(StaffStatus))
  status!: StaffStatus;
}

export class StaffListQueryDto {
  @ApiPropertyOptional({ description: 'Matches name or phone.' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ enum: StaffStatus })
  @IsOptional()
  @IsIn(Object.values(StaffStatus))
  status?: StaffStatus;

  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsOptional()
  @Transform(({ value }) => parseInt(value, 10))
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20 })
  @IsOptional()
  @Transform(({ value }) => parseInt(value, 10))
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}

export class StaffRoleSummaryDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
}

export class StaffResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() phone!: string;
  @ApiPropertyOptional({ nullable: true, type: String }) jobTitle!: string | null;
  @ApiPropertyOptional({ nullable: true, type: String }) photoUrl!: string | null;
  @ApiProperty({ enum: StaffStatus }) status!: StaffStatus;
  @ApiPropertyOptional({ nullable: true, type: StaffRoleSummaryDto })
  role!: StaffRoleSummaryDto | null;
  @ApiProperty() joinedAt!: string;
  @ApiPropertyOptional({ nullable: true, type: String }) lastActiveAt!: string | null;
  @ApiPropertyOptional({ nullable: true, type: String }) lastLoginAt!: string | null;
}

export class StaffListResponseDto {
  @ApiProperty({ type: [StaffResponseDto] }) staff!: StaffResponseDto[];
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() limit!: number;
}

export class StaffDetailResponseDto extends StaffResponseDto {
  @ApiProperty({
    enum: ALL_PERMISSIONS,
    isArray: true,
    description: 'Effective permissions after applying any per-staff overrides.',
  })
  effectivePermissions!: Permission[];

  @ApiProperty({
    description: 'True when permissionOverrides is non-empty (this person deviates from their role).',
  })
  hasOverrides!: boolean;

  @ApiPropertyOptional({ nullable: true, type: String })
  nextPaymentDate!: string | null;
}
