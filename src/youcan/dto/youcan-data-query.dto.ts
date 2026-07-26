import { Type } from 'class-transformer';
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

export const YOUCAN_DEFAULT_PAGE_SIZE = 20;
export const YOUCAN_MAX_PAGE_SIZE = 100;

export class YouCanIdParamDto {
  @ApiProperty({
    description: 'Numeric or string YouCan ID.',
    example: 'd9b2d63d-a233-4123-8321',
  })
  @IsString()
  @MinLength(1)
  id!: string;
}

export class YouCanDataPageQueryDto {
  @ApiPropertyOptional({
    description: 'Page number for pagination.',
    default: 1,
    minimum: 1,
    example: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({
    description: 'Maximum number of records to return.',
    default: YOUCAN_DEFAULT_PAGE_SIZE,
    minimum: 1,
    maximum: YOUCAN_MAX_PAGE_SIZE,
    example: 20,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(YOUCAN_MAX_PAGE_SIZE)
  limit: number = YOUCAN_DEFAULT_PAGE_SIZE;

  @ApiPropertyOptional({
    description: 'Optional search query.',
    example: 'shirt',
    maxLength: 500,
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  q?: string;
}
