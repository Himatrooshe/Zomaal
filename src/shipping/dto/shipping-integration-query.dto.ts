import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  Length,
  MaxLength,
} from 'class-validator';

export class ShippingIntegrationQueryDto {
  @ApiPropertyOptional({
    description: 'ISO 3166-1 alpha-2 country code.',
    enum: ['MA', 'DZ', 'TN', 'LY', 'EG'],
    example: 'MA',
  })
  @IsOptional()
  @IsString()
  @Length(2, 2)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.toUpperCase() : value,
  )
  @IsIn(['MA', 'DZ', 'TN', 'LY', 'EG'])
  country?: string;

  @ApiPropertyOptional({
    description: 'Case-insensitive courier name or description search.',
    maxLength: 100,
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @ApiPropertyOptional({
    description: 'Restrict the catalog to connected or disconnected couriers.',
    type: Boolean,
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => {
    if (value === 'true' || value === true) return true;
    if (value === 'false' || value === false) return false;
    return value;
  })
  @IsBoolean()
  connected?: boolean;
}
