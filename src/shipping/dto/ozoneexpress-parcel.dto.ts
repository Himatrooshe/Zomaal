import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class OzoneExpressProductDto {
  @ApiProperty()
  @IsString()
  ref: string;

  @ApiProperty()
  @IsNumber()
  qnty: number;
}

export class OzoneExpressParcelDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  trackingNumber?: string;

  @ApiProperty()
  @IsString()
  receiver: string;

  @ApiProperty()
  @IsString()
  phone: string;

  @ApiProperty({ description: 'OzoneExpress city ID.' })
  @IsString()
  city: string;

  @ApiProperty()
  @IsString()
  address: string;

  @ApiProperty()
  @IsNumber()
  price: number;

  @ApiProperty({ description: '1 = stock, 0 = pickup' })
  @IsIn([0, 1])
  stock: 0 | 1;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  note?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  nature?: string;

  @ApiPropertyOptional({ description: '1 = open package, 2 = do not open' })
  @IsOptional()
  @IsIn([1, 2])
  open?: 1 | 2;

  @ApiPropertyOptional({ description: '1 = yes, 0 = no' })
  @IsOptional()
  @IsIn([0, 1])
  fragile?: 0 | 1;

  @ApiPropertyOptional({ description: '1 = yes, 0 = no' })
  @IsOptional()
  @IsIn([0, 1])
  replace?: 0 | 1;

  @ApiPropertyOptional({ type: [OzoneExpressProductDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OzoneExpressProductDto)
  products?: OzoneExpressProductDto[];
}

export class OzoneExpressTrackingDto {
  @ApiProperty({
    oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
  })
  trackingNumber: string | string[];
}

export class OzoneExpressDeliveryNoteParcelsDto {
  @ApiProperty()
  @IsString()
  ref: string;

  @ApiProperty({ type: [String] })
  @IsArray()
  @IsString({ each: true })
  codes: string[];
}

export class OzoneExpressDeliveryNoteRefDto {
  @ApiProperty()
  @IsString()
  ref: string;
}
