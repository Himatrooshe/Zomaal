import { IsString, IsNotEmpty, IsOptional, IsUrl } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateStoreDto {
  @ApiProperty({
    description: 'Store owner’s full name.',
    example: 'Ahmed Alaoui',
  })
  @IsString()
  @IsNotEmpty()
  ownerName!: string;

  @ApiProperty({
    description: 'Customer-facing business/store name.',
    example: 'Atlas Market',
  })
  @IsString()
  @IsNotEmpty()
  businessName!: string;

  @ApiProperty({
    description: 'Store or pickup address.',
    example: '123 Rue Hassan II',
  })
  @IsString()
  @IsNotEmpty()
  address!: string;

  @ApiProperty({ example: 'Casablanca' })
  @IsString()
  @IsNotEmpty()
  city!: string;

  @ApiProperty({ example: 'Morocco' })
  @IsString()
  @IsNotEmpty()
  country!: string;

  @ApiPropertyOptional({
    description: 'Public HTTPS URL of the store logo.',
    example: 'https://example.com/logo.png',
    format: 'uri',
  })
  @IsOptional()
  @IsString()
  @IsUrl()
  logoUrl?: string;
}
