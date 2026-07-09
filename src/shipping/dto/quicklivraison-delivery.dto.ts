import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
} from 'class-validator';

export class QuickLivraisonDeliveryDto {
  @ApiProperty()
  @IsInt()
  district_id: number;

  @ApiProperty()
  @IsString()
  name: string;

  @ApiProperty()
  @IsNumber()
  amount: number;

  @ApiProperty({ description: 'Recipient phone number.' })
  @IsString()
  phone: string;

  @ApiProperty()
  @IsString()
  address: string;

  @ApiPropertyOptional({ description: 'Custom unique parcel code.' })
  @IsOptional()
  @IsString()
  code?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  note?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  open?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  try?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  echange?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  echange_colis?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  vendeur_name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  vendeur_phone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  store_name?: string;

  @ApiPropertyOptional({ description: 'Product name for non-stock mode.' })
  @IsOptional()
  @IsString()
  prd_name?: string;

  @ApiPropertyOptional({ description: 'Quantity for non-stock mode.' })
  @IsOptional()
  @IsInt()
  qte_prd?: number;

  @ApiPropertyOptional({
    description: 'Stock mode product quantities, e.g. {"1": 2}.',
  })
  @IsOptional()
  @IsObject()
  received_quantity?: Record<string, number>;
}
