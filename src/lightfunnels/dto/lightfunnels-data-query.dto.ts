import { Transform, Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export const LIGHTFUNNELS_DEFAULT_PAGE_SIZE = 20;
export const LIGHTFUNNELS_MAX_PAGE_SIZE = 100;

export class LightfunnelsIdParamDto {
  @ApiProperty({
    description: 'Lightfunnels ID (e.g. order_yCnsyn0pA_9qLKaIHwlip).',
    example: 'order_yCnsyn0pA_9qLKaIHwlip',
  })
  @IsString()
  @MinLength(1)
  id!: string;
}

function trimQueryValue({ value }: { value: unknown }): unknown {
  if (typeof value === 'string') {
    return value.trim();
  }
  return value;
}

export class LightfunnelsDataPageQueryDto {
  @ApiPropertyOptional({
    description: 'Maximum number of records to return.',
    default: LIGHTFUNNELS_DEFAULT_PAGE_SIZE,
    minimum: 1,
    maximum: LIGHTFUNNELS_MAX_PAGE_SIZE,
    example: 20,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(LIGHTFUNNELS_MAX_PAGE_SIZE)
  first: number = LIGHTFUNNELS_DEFAULT_PAGE_SIZE;

  @ApiPropertyOptional({
    description: 'Opaque `endCursor` returned by the previous response.',
    example: 'eyJsYXN0X2lkIjo2MzIxMzk1MjE5fQ==',
    maxLength: 2048,
  })
  @IsOptional()
  @Transform(trimQueryValue)
  @IsString()
  @MinLength(1)
  @MaxLength(2048)
  after?: string;

  @ApiPropertyOptional({
    description: 'Optional Lightfunnels search query.',
    example: 'status:active',
    maxLength: 500,
  })
  @IsOptional()
  @Transform(trimQueryValue)
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  query?: string;
}
