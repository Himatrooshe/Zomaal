import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

export class QuickLivraisonDeliveryDto {
  @ApiProperty({
    description:
      'QuickLivraison destination city/district ID. Obtain it from GET /shipping/quicklivraison/cities.',
    example: 123,
  })
  @IsInt()
  district_id: number;

  @ApiProperty({ description: 'Recipient full name.', example: 'Jean Dupont' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({
    description:
      'Cash-on-delivery amount in Moroccan dirhams (MAD). Use 0 for a prepaid parcel.',
    example: 250,
    minimum: 0,
  })
  @IsNumber()
  @Min(0)
  amount: number;

  @ApiProperty({
    description: 'Recipient phone number.',
    example: '0612345678',
  })
  @IsString()
  @IsNotEmpty()
  phone: string;

  @ApiProperty({
    description: 'Complete delivery address.',
    example: '123 Rue Principale, Casablanca',
  })
  @IsString()
  @IsNotEmpty()
  address: string;

  @ApiPropertyOptional({
    description: 'Your unique parcel/order reference.',
    example: 'ORDER-1001',
  })
  @IsOptional()
  @IsString()
  code?: string;

  @ApiPropertyOptional({
    description: 'Delivery instructions or internal note.',
    example: 'Call before delivery',
  })
  @IsOptional()
  @IsString()
  note?: string;

  @ApiPropertyOptional({
    description: 'Allow the recipient to open the parcel before accepting it.',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  open?: boolean;

  @ApiPropertyOptional({
    description: 'Allow the recipient to try the product.',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  try?: boolean;

  @ApiPropertyOptional({
    description: 'Marks this delivery as an exchange.',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  echange?: boolean;

  @ApiPropertyOptional({
    description: 'Tracking/reference of the parcel being exchanged.',
  })
  @IsOptional()
  @IsString()
  echange_colis?: string;

  @ApiPropertyOptional({
    description: 'Seller/contact name shown for the parcel.',
  })
  @IsOptional()
  @IsString()
  vendeur_name?: string;

  @ApiPropertyOptional({ description: 'Seller/contact phone number.' })
  @IsOptional()
  @IsString()
  vendeur_phone?: string;

  @ApiPropertyOptional({
    description: 'Store name associated with the parcel.',
  })
  @IsOptional()
  @IsString()
  store_name?: string;

  @ApiPropertyOptional({
    description:
      'Product name when not using QuickLivraison stock product IDs.',
    example: 'Running shoes',
  })
  @IsOptional()
  @IsString()
  prd_name?: string;

  @ApiPropertyOptional({
    description: 'Product quantity for non-stock mode.',
    example: 1,
    minimum: 1,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  qte_prd?: number;

  @ApiPropertyOptional({
    description:
      'Stock mode quantities keyed by QuickLivraison product ID. Obtain IDs from GET /shipping/quicklivraison/products.',
    example: { '42': 2 },
    type: 'object',
    additionalProperties: { type: 'integer', minimum: 1 },
  })
  @IsOptional()
  @IsObject()
  received_quantity?: Record<string, number>;
}
