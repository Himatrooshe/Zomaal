import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Min,
  ValidateNested,
} from 'class-validator';

export class AmeexProductDto {
  @ApiProperty() @IsString() @IsNotEmpty() id: string;
  @ApiProperty({ minimum: 1 }) @Type(() => Number) @IsInt() @Min(1) qty: number;
}

export class AmeexParcelDto {
  @ApiProperty({ enum: ['SIMPLE', 'STOCK'], default: 'SIMPLE' })
  @IsIn(['SIMPLE', 'STOCK'])
  type: 'SIMPLE' | 'STOCK';

  @ApiPropertyOptional({ description: 'Merchant order/reference number.' })
  @IsOptional()
  @IsString()
  orderNumber?: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  replace?: boolean;

  @ApiPropertyOptional() @IsOptional() @IsString() exchangeCode?: string;

  @ApiPropertyOptional({ enum: ['YES', 'NO'], default: 'NO' })
  @IsOptional()
  @IsIn(['YES', 'NO'])
  open?: 'YES' | 'NO';

  @ApiPropertyOptional({ enum: ['YES', 'NO'], default: 'NO' })
  @IsOptional()
  @IsIn(['YES', 'NO'])
  try?: 'YES' | 'NO';

  @ApiPropertyOptional({ enum: [0, 1], default: 0 })
  @IsOptional()
  @IsIn([0, 1])
  fragile?: 0 | 1;

  @ApiProperty() @IsString() @IsNotEmpty() receiver: string;
  @ApiProperty() @IsString() @IsNotEmpty() phone: string;
  @ApiProperty({ description: 'Ameex city ID.' })
  @IsString()
  @IsNotEmpty()
  @Matches(/^\d+$/, { message: 'city must be a numeric Ameex city ID' })
  city: string;
  @ApiProperty() @IsString() @IsNotEmpty() address: string;
  @ApiPropertyOptional() @IsOptional() @IsString() comment?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() product?: string;
  @ApiProperty({ minimum: 0 }) @IsNumber() @Min(0) cod: number;

  @ApiPropertyOptional({ type: [AmeexProductDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AmeexProductDto)
  products?: AmeexProductDto[];
}

export class AmeexMassCodesDto {
  @ApiProperty({ type: [String], maxItems: 25 })
  @IsArray()
  @IsString({ each: true })
  codes: string[];
}

export class AmeexWebhookDto {
  @ApiProperty() @IsString() @IsNotEmpty() CODE: string;
  @ApiProperty() @IsString() @IsNotEmpty() STATUT: string;
  @ApiPropertyOptional() @IsOptional() @IsString() DATE?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() COMMENT?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() STATUT_S?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() STATUT_NAME?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() STATUT_COLOR?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() STATUT_S_NAME?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() STATUT_S_COLOR?: string;
}
