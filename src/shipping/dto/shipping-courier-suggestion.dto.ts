import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsIn,
  IsOptional,
  IsString,
  IsUrl,
  Length,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateShippingCourierSuggestionDto {
  @ApiProperty({ example: 'Example Courier', minLength: 2, maxLength: 100 })
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  courierName: string;

  @ApiPropertyOptional({
    example: 'https://example-courier.ma',
    maxLength: 500,
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  @IsUrl({ require_protocol: true, protocols: ['http', 'https'] })
  website?: string;

  @ApiProperty({
    description: 'ISO 3166-1 alpha-2 country code.',
    enum: ['MA', 'DZ', 'TN', 'LY', 'EG'],
    example: 'MA',
  })
  @IsString()
  @Length(2, 2)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @IsIn(['MA', 'DZ', 'TN', 'LY', 'EG'])
  countryCode: string;

  @ApiPropertyOptional({ maxLength: 2000, example: 'Requested by our team.' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  notes?: string;
}

export class ShippingCourierSuggestionResponseDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() courierName: string;
  @ApiPropertyOptional({ nullable: true }) website: string | null;
  @ApiProperty({ example: 'MA' }) countryCode: string;
  @ApiPropertyOptional({ nullable: true }) notes: string | null;
  @ApiProperty({ enum: ['PENDING'] }) status: 'PENDING';
  @ApiProperty({ format: 'date-time' }) createdAt: string;
}
