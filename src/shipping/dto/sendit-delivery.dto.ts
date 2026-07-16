import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export class SenditDeliveryDto {
  @ApiProperty({
    description:
      'Sendit district ID where the parcel will be collected. Obtain it from GET /shipping/sendit/districts/pickup-cities.',
    example: 1,
  })
  @IsInt()
  pickup_district_id: number;

  @ApiProperty({
    description:
      'Sendit destination district ID. Obtain it from GET /shipping/sendit/districts.',
    example: 58,
  })
  @IsInt()
  district_id: number;

  @ApiProperty({
    description: 'Recipient full name.',
    example: 'Sara Amrani',
  })
  @IsString()
  name: string;

  @ApiProperty({
    description: 'Cash-on-delivery amount in Moroccan dirhams (MAD).',
    example: 349.9,
  })
  @IsNumber()
  amount: number;

  @ApiProperty({
    description:
      'Complete delivery address, including neighborhood or landmark.',
    example: '12 Rue Al Massira, Maarif, Casablanca',
  })
  @IsString()
  address: string;

  @ApiProperty({
    description: 'Recipient telephone number accepted by Sendit.',
    example: '0612345678',
  })
  @IsString()
  phone: string;

  @ApiPropertyOptional({
    description: 'Delivery instructions visible to the carrier.',
    example: 'Call before delivery.',
  })
  @IsOptional()
  @IsString()
  comment?: string;

  @ApiPropertyOptional({
    description: 'Merchant-defined order or parcel reference.',
    example: 'ORDER-2026-0042',
  })
  @IsOptional()
  @IsString()
  reference?: string;

  @ApiPropertyOptional({
    description: 'Allow the recipient to open the parcel: 0 = no, 1 = yes.',
    enum: [0, 1],
    example: 1,
    minimum: 0,
    maximum: 1,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1)
  allow_open?: number;

  @ApiPropertyOptional({
    description: 'Allow the recipient to try the product: 0 = no, 1 = yes.',
    enum: [0, 1],
    example: 0,
    minimum: 0,
    maximum: 1,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1)
  allow_try?: number;

  @ApiPropertyOptional({
    description: 'Fulfil from Sendit-managed stock: 0 = no, 1 = yes.',
    enum: [0, 1],
    example: 0,
    minimum: 0,
    maximum: 1,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1)
  products_from_stock?: number;

  @ApiPropertyOptional({
    description:
      "Product description, or Sendit stock quantities formatted as 'PRODUCT_CODE:QUANTITY' entries separated by semicolons.",
    example: 'SKU-TSHIRT-L:2;SKU-CAP:1',
  })
  @IsOptional()
  @IsString()
  products?: string;

  @ApiPropertyOptional({
    description: 'Sendit packaging option identifier, when packaging is used.',
    example: 2,
  })
  @IsOptional()
  @IsInt()
  packaging_id?: number;

  @ApiPropertyOptional({
    description: 'Create this as an exchange delivery: 0 = no, 1 = yes.',
    enum: [0, 1],
    example: 0,
    minimum: 0,
    maximum: 1,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1)
  option_exchange?: number;

  @ApiPropertyOptional({
    description:
      'Existing Sendit delivery code associated with an exchange. Used with option_exchange = 1.',
    example: 'DH000123456MA',
  })
  @IsOptional()
  @IsString()
  delivery_exchange_id?: string;
}
