import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import {
  ArrayUnique,
  IsArray,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { ALL_PERMISSIONS, type Permission } from '../../access/permissions';

export class CreateRoleDto {
  @ApiProperty({ example: 'Warehouse Staff', maxLength: 80 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  name!: string;

  @ApiPropertyOptional({ example: 'Packs and ships orders from the warehouse.' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  description?: string;

  @ApiProperty({
    enum: ALL_PERMISSIONS,
    isArray: true,
    example: ['orders.view', 'returns.scan'],
    description:
      'Sub-action permission keys this role grants. An empty array is a role with no access — valid, but the UI should warn.',
  })
  @IsArray()
  @ArrayUnique()
  @IsIn(ALL_PERMISSIONS, { each: true })
  permissions!: Permission[];
}

export class UpdateRoleDto extends PartialType(CreateRoleDto) {}

export class RoleResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiPropertyOptional({ nullable: true, type: String }) description!: string | null;
  @ApiProperty({ enum: ALL_PERMISSIONS, isArray: true }) permissions!: Permission[];
  @ApiProperty() isSystem!: boolean;
  @ApiProperty({ description: 'Number of active staff currently on this role.' })
  staffCount!: number;
  @ApiProperty() createdAt!: string;
  @ApiProperty() updatedAt!: string;
}

export class RoleListResponseDto {
  @ApiProperty({ type: [RoleResponseDto] })
  roles!: RoleResponseDto[];
}
