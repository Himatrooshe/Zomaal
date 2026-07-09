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
  @ApiProperty()
  @IsInt()
  pickup_district_id: number;

  @ApiProperty()
  @IsInt()
  district_id: number;

  @ApiProperty()
  @IsString()
  name: string;

  @ApiProperty()
  @IsNumber()
  amount: number;

  @ApiProperty()
  @IsString()
  address: string;

  @ApiProperty()
  @IsString()
  phone: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  comment?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  reference?: string;

  @ApiPropertyOptional({ description: '0 = no, 1 = yes' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1)
  allow_open?: number;

  @ApiPropertyOptional({ description: '0 = no, 1 = yes' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1)
  allow_try?: number;

  @ApiPropertyOptional({ description: '0 = no, 1 = yes' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1)
  products_from_stock?: number;

  @ApiPropertyOptional({
    description: "Free text or stock format like 'P1:2;P2:1'.",
  })
  @IsOptional()
  @IsString()
  products?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  packaging_id?: number;

  @ApiPropertyOptional({ description: '0 = no, 1 = yes' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1)
  option_exchange?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  delivery_exchange_id?: string;
}
