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
      'QuickLivraison destination city/district identifier. Resolve the identifier with GET /shipping/quicklivraison/cities before creating the delivery.',
    example: 123,
    type: Number,
  })
  @IsInt()
  district_id: number;

  @ApiProperty({
    description: 'Full name of the person receiving the parcel.',
    example: 'Sara El Amrani',
  })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({
    description:
      'Cash-on-delivery amount in Moroccan dirhams (MAD). Use 0 for a prepaid parcel.',
    example: 250,
    minimum: 0,
    type: Number,
  })
  @IsNumber()
  @Min(0)
  amount: number;

  @ApiProperty({
    description:
      'Recipient phone number as accepted by QuickLivraison. A Moroccan national-format number is shown in the example.',
    example: '0612345678',
  })
  @IsString()
  @IsNotEmpty()
  phone: string;

  @ApiProperty({
    description:
      'Complete street address used by the courier for the final delivery.',
    example: '123 Rue Al Massira, Maarif, Casablanca',
  })
  @IsString()
  @IsNotEmpty()
  address: string;

  @ApiPropertyOptional({
    description:
      'Merchant-defined parcel or order reference used to reconcile the provider parcel with your order.',
    example: 'ORDER-1001',
  })
  @IsOptional()
  @IsString()
  code?: string;

  @ApiPropertyOptional({
    description: 'Instructions forwarded to the delivery operation.',
    example: 'Call the recipient before delivery',
  })
  @IsOptional()
  @IsString()
  note?: string;

  @ApiPropertyOptional({
    description: 'Allow the recipient to open the parcel before accepting it.',
    default: false,
    example: false,
    type: Boolean,
  })
  @IsOptional()
  @IsBoolean()
  open?: boolean;

  @ApiPropertyOptional({
    description:
      'Allow the recipient to try the product before accepting the parcel.',
    default: false,
    example: false,
    type: Boolean,
  })
  @IsOptional()
  @IsBoolean()
  try?: boolean;

  @ApiPropertyOptional({
    description:
      'Marks the delivery as an exchange. When true, provide echange_colis with the original parcel tracking number.',
    default: false,
    example: false,
    type: Boolean,
  })
  @IsOptional()
  @IsBoolean()
  echange?: boolean;

  @ApiPropertyOptional({
    description:
      'QuickLivraison tracking number of the original parcel being exchanged. Used when echange is true.',
    example: 'PARCEL_87654321',
  })
  @IsOptional()
  @IsString()
  echange_colis?: string;

  @ApiPropertyOptional({
    description: 'Seller/contact name shown for the parcel.',
    example: 'Zomaal Store',
  })
  @IsOptional()
  @IsString()
  vendeur_name?: string;

  @ApiPropertyOptional({
    description: 'Seller/contact phone number shown for the parcel.',
    example: '0600000000',
  })
  @IsOptional()
  @IsString()
  vendeur_phone?: string;

  @ApiPropertyOptional({
    description: 'Store name associated with the parcel.',
    example: 'Zomaal Store',
  })
  @IsOptional()
  @IsString()
  store_name?: string;

  @ApiPropertyOptional({
    description:
      'Human-readable product name for non-stock deliveries. For stock fulfillment, use received_quantity instead.',
    example: 'Running shoes',
  })
  @IsOptional()
  @IsString()
  prd_name?: string;

  @ApiPropertyOptional({
    description:
      'Product quantity for a non-stock delivery. Pair it with prd_name.',
    example: 1,
    minimum: 1,
    type: Number,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  qte_prd?: number;

  @ApiPropertyOptional({
    description:
      'Stock-fulfillment quantities keyed by QuickLivraison product ID. Resolve product IDs with GET /shipping/quicklivraison/products. Do not send this field for a non-stock delivery.',
    example: { '42': 2 },
    type: 'object',
    additionalProperties: { type: 'integer', minimum: 1 },
  })
  @IsOptional()
  @IsObject()
  received_quantity?: Record<string, number>;
}
