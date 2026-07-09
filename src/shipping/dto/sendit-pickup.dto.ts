import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString } from 'class-validator';

export class SenditPickupDto {
  @ApiProperty()
  @IsInt()
  district_id: number;

  @ApiProperty()
  @IsString()
  name: string;

  @ApiProperty()
  @IsString()
  phone: string;

  @ApiProperty()
  @IsString()
  address: string;

  @ApiProperty()
  @IsString()
  note: string;

  @ApiPropertyOptional({ example: 'DHXXXXX1,DHXXXXX2' })
  @IsOptional()
  @IsString()
  deliveries?: string;

  @ApiPropertyOptional({ example: 'MHXXXXX1' })
  @IsOptional()
  @IsString()
  movements?: string;
}

export class SenditUpdatePickupDto {
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

  @ApiPropertyOptional({ example: 'DHXXXXX1,DHXXXXX2' })
  @IsOptional()
  @IsString()
  deliveries?: string;

  @ApiPropertyOptional({ example: 'MHXXXXX1' })
  @IsOptional()
  @IsString()
  movements?: string;
}
