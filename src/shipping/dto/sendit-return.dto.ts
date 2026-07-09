import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsString } from 'class-validator';

export class SenditReturnDto {
  @ApiProperty({ enum: ['WAREHOUSE', 'HOME'] })
  @IsIn(['WAREHOUSE', 'HOME'])
  type: 'WAREHOUSE' | 'HOME';

  @ApiProperty()
  @IsInt()
  district_id: number;

  @ApiProperty()
  @IsString()
  name: string;

  @ApiProperty()
  @IsString()
  phone: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  address?: string;

  @ApiProperty()
  @IsString()
  note: string;

  @ApiProperty({ example: 'DX1,DX2,DX3' })
  @IsString()
  deliveries: string;
}

export class SenditUpdateReturnDto {
  @ApiPropertyOptional({ enum: ['WAREHOUSE', 'HOME'] })
  @IsOptional()
  @IsIn(['WAREHOUSE', 'HOME'])
  type?: 'WAREHOUSE' | 'HOME';

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  address?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  note?: string;

  @ApiPropertyOptional({ example: 'DX1,DX2,DX3' })
  @IsOptional()
  @IsString()
  deliveries?: string;
}
