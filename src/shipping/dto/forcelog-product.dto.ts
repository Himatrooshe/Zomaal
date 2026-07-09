import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';

export class ForceLogProductVariantDto {
  @ApiProperty()
  @IsString()
  NAME: string;

  @ApiProperty()
  @IsInt()
  QUANTITY: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  BARCODE?: string;
}

export class ForceLogProductDto {
  @ApiProperty()
  @IsString()
  PRODUCT_NAME: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  QUANTITY?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  BARCODE?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  CATEGORY_ID?: number;

  @ApiPropertyOptional({ type: [ForceLogProductVariantDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ForceLogProductVariantDto)
  VARIANTS?: ForceLogProductVariantDto[];
}
