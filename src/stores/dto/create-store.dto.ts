import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsUrl,
  IsISO4217CurrencyCode,
  ValidateIf,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { trimText } from '../../common/calendar-date.util';

export class CreateStoreDto {
  @ApiProperty({
    description: 'Store owner’s full name.',
    example: 'Ahmed Alaoui',
  })
  @Transform(trimText)
  @IsString()
  @IsNotEmpty()
  ownerName!: string;

  @ApiProperty({
    description: 'Customer-facing business/store name.',
    example: 'Atlas Market',
  })
  @Transform(trimText)
  @IsString()
  @IsNotEmpty()
  businessName!: string;

  @ApiProperty({
    description: 'Store or pickup address.',
    example: '123 Rue Hassan II',
  })
  @Transform(trimText)
  @IsString()
  @IsNotEmpty()
  address!: string;

  @ApiProperty({ example: 'Casablanca' })
  @Transform(trimText)
  @IsString()
  @IsNotEmpty()
  city!: string;

  @ApiPropertyOptional({
    description: 'The app serves Morocco only for now; defaults to Morocco.',
    example: 'Morocco',
    default: 'Morocco',
  })
  @ValidateIf((_, value: unknown) => value !== undefined)
  @Transform(trimText)
  @IsString()
  @IsNotEmpty()
  country?: string;

  @ApiPropertyOptional({
    description: 'Public HTTPS URL of the store logo.',
    example: 'https://example.com/logo.png',
    format: 'uri',
  })
  @IsOptional()
  @IsString()
  @IsUrl()
  logoUrl?: string;

  @ApiPropertyOptional({
    description:
      'Official ISO 4217 accounting currency (e.g. MAD, USD, EUR). Defaults to MAD. Chosen at creation and cannot subsequently be changed.',
    example: 'MAD',
  })
  @ValidateIf((_, value: unknown) => value !== undefined)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.toUpperCase() : value,
  )
  @IsString()
  @IsISO4217CurrencyCode()
  baseCurrency?: string;
}
