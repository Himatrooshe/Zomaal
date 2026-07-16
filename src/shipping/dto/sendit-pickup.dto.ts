import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString } from 'class-validator';

export class SenditPickupDto {
  @ApiProperty({
    description:
      'Sendit pickup district ID. Obtain it from GET /shipping/sendit/districts/pickup-cities.',
    example: 1,
  })
  @IsInt()
  district_id: number;

  @ApiProperty({
    description: 'Pickup contact or business name.',
    example: 'Zomaal Store',
  })
  @IsString()
  name: string;

  @ApiProperty({
    description: 'Pickup contact telephone number.',
    example: '0612345678',
  })
  @IsString()
  phone: string;

  @ApiProperty({
    description: 'Complete address where Sendit should collect the parcels.',
    example: '45 Boulevard Zerktouni, Casablanca',
  })
  @IsString()
  address: string;

  @ApiProperty({
    description: 'Instructions for the Sendit pickup agent.',
    example: 'Collect from reception after 14:00.',
  })
  @IsString()
  note: string;

  @ApiPropertyOptional({
    description: 'Comma-separated delivery codes to include in the pickup.',
    example: 'DH000123456MA,DH000123457MA',
  })
  @IsOptional()
  @IsString()
  deliveries?: string;

  @ApiPropertyOptional({
    description: 'Comma-separated Sendit movement codes to include.',
    example: 'MH000123456MA',
  })
  @IsOptional()
  @IsString()
  movements?: string;
}

export class SenditUpdatePickupDto {
  @ApiPropertyOptional({
    description: 'Updated pickup contact or business name.',
    example: 'Zomaal Store - Maarif',
  })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({
    description: 'Updated pickup contact telephone number.',
    example: '0612345678',
  })
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiPropertyOptional({
    description: 'Updated pickup address.',
    example: '45 Boulevard Zerktouni, Casablanca',
  })
  @IsOptional()
  @IsString()
  address?: string;

  @ApiPropertyOptional({
    description: 'Updated instructions for the pickup agent.',
    example: 'Collect from reception after 14:00.',
  })
  @IsOptional()
  @IsString()
  note?: string;

  @ApiPropertyOptional({
    description: 'Replacement comma-separated delivery-code list.',
    example: 'DH000123456MA,DH000123457MA',
  })
  @IsOptional()
  @IsString()
  deliveries?: string;

  @ApiPropertyOptional({
    description: 'Replacement comma-separated movement-code list.',
    example: 'MH000123456MA',
  })
  @IsOptional()
  @IsString()
  movements?: string;
}
