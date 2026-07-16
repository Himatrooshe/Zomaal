import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class ForceLogParcelDto {
  @ApiProperty({
    description:
      'Merchant order reference. It should be unique in the connected ForceLog account.',
    example: 'ZM-2026-000123',
    maxLength: 20,
  })
  @IsString()
  @MaxLength(20)
  ORDER_NUM: string;

  @ApiProperty({
    description: 'Full name of the parcel recipient.',
    example: 'Youssef El Amrani',
    maxLength: 50,
  })
  @IsString()
  @MaxLength(50)
  RECEIVE: string;

  @ApiProperty({
    description:
      'Recipient phone number accepted by ForceLog, including the country code when applicable.',
    example: '0612345678',
    maxLength: 14,
  })
  @IsString()
  @MaxLength(14)
  PHONE: string;

  @ApiProperty({
    description:
      'Destination city ID/code or city name as returned by `GET /shipping/forcelog/cities`.',
    example: 'Casablanca',
    maxLength: 50,
  })
  @IsString()
  @MaxLength(50)
  CITY: string;

  @ApiProperty({
    description: 'Complete street address for delivery.',
    example: '12 Rue Al Massira, Maarif',
    maxLength: 100,
  })
  @IsString()
  @MaxLength(100)
  ADDRESS: string;

  @ApiPropertyOptional({
    description: 'Delivery directions or recipient availability details.',
    example: 'Call before delivery; apartment 4',
    maxLength: 100,
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  HOW?: string;

  @ApiPropertyOptional({
    description: 'Plain-language description of the parcel contents.',
    example: 'Two cotton shirts',
    maxLength: 100,
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  PRODUCT_NATURE?: string;

  @ApiPropertyOptional({
    description:
      'Cash-on-delivery amount in Moroccan dirhams. Omit or use `0` for a prepaid parcel.',
    example: 349,
    minimum: 0,
  })
  @IsOptional()
  @IsNumber()
  COD?: number;

  @ApiPropertyOptional({
    description:
      'Whether the recipient may open and inspect the parcel before accepting it.',
    example: false,
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  CAN_OPEN?: boolean;

  @ApiPropertyOptional({
    description:
      'Comma-separated ForceLog stock references. Add `:quantity` when the quantity is greater than one.',
    example: 'TSHIRT-BLK-M:2,JEANS-BLU-32',
  })
  @IsOptional()
  @IsString()
  STOCK?: string;

  @ApiPropertyOptional({
    description: 'Whether ForceLog should handle the parcel as fragile.',
    example: true,
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  FRAGILE?: boolean;

  @ApiPropertyOptional({
    description: 'Carton/package reference understood by ForceLog.',
    example: 'CARTON-M',
  })
  @IsOptional()
  @IsString()
  CARTON?: string;
}

export class ForceLogRelaunchDto {
  @ApiProperty({
    description: 'ForceLog parcel code to relaunch.',
    example: 'FL123456789MA',
    maxLength: 20,
  })
  @IsString()
  @MaxLength(20)
  CODE: string;

  @ApiProperty({
    description: 'Updated recipient full name.',
    example: 'Salma Bennani',
    maxLength: 50,
  })
  @IsString()
  @MaxLength(50)
  RECEIVER: string;

  @ApiProperty({
    description: 'Updated recipient phone number.',
    example: '0623456789',
    maxLength: 14,
  })
  @IsString()
  @MaxLength(14)
  PHONE: string;

  @ApiProperty({
    description: 'Updated delivery street address.',
    example: '8 Avenue Mohammed V, Agdal',
    maxLength: 100,
  })
  @IsString()
  @MaxLength(100)
  ADDRESS: string;

  @ApiProperty({
    description: 'Updated cash-on-delivery amount in Moroccan dirhams.',
    example: 299,
    minimum: 0,
  })
  @IsNumber()
  COD: number;

  @ApiPropertyOptional({
    description: 'Reason or delivery note attached to the relaunch request.',
    example: 'Customer confirmed the new address by phone',
    maxLength: 100,
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  COMMENT?: string;
}

export class ForceLogRelaunchZoneDto extends ForceLogRelaunchDto {
  @ApiProperty({
    description:
      'New destination city ID/code obtained from `GET /shipping/forcelog/cities`.',
    example: 'Rabat',
    maxLength: 50,
  })
  @IsString()
  @MaxLength(50)
  CITY: string;
}
