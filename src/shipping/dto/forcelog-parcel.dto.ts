import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class ForceLogParcelDto {
  @ApiProperty({ maxLength: 20 })
  @IsString()
  @MaxLength(20)
  ORDER_NUM: string;

  @ApiProperty({ maxLength: 50 })
  @IsString()
  @MaxLength(50)
  RECEIVE: string;

  @ApiProperty({ maxLength: 14 })
  @IsString()
  @MaxLength(14)
  PHONE: string;

  @ApiProperty({ description: 'Destination city code or name.', maxLength: 50 })
  @IsString()
  @MaxLength(50)
  CITY: string;

  @ApiProperty({ maxLength: 100 })
  @IsString()
  @MaxLength(100)
  ADDRESS: string;

  @ApiPropertyOptional({ maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  HOW?: string;

  @ApiPropertyOptional({ maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  PRODUCT_NATURE?: string;

  @ApiPropertyOptional({ description: 'Cash on delivery amount.' })
  @IsOptional()
  @IsNumber()
  COD?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  CAN_OPEN?: boolean;

  @ApiPropertyOptional({
    description: 'Stock references and quantities, e.g. REF1:2,REF2.',
  })
  @IsOptional()
  @IsString()
  STOCK?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  FRAGILE?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  CARTON?: string;
}

export class ForceLogRelaunchDto {
  @ApiProperty({ maxLength: 20 })
  @IsString()
  @MaxLength(20)
  CODE: string;

  @ApiProperty({ maxLength: 50 })
  @IsString()
  @MaxLength(50)
  RECEIVER: string;

  @ApiProperty({ maxLength: 14 })
  @IsString()
  @MaxLength(14)
  PHONE: string;

  @ApiProperty({ maxLength: 100 })
  @IsString()
  @MaxLength(100)
  ADDRESS: string;

  @ApiProperty()
  @IsNumber()
  COD: number;

  @ApiPropertyOptional({ maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  COMMENT?: string;
}

export class ForceLogRelaunchZoneDto extends ForceLogRelaunchDto {
  @ApiProperty({ description: 'New destination city ID.', maxLength: 50 })
  @IsString()
  @MaxLength(50)
  CITY: string;
}
