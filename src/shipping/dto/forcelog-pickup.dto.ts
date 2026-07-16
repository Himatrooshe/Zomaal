import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export class ForceLogPickupDto {
  @ApiProperty({
    description: 'Phone number ForceLog should call for the pickup.',
    example: '0612345678',
    maxLength: 14,
  })
  @IsString()
  @MaxLength(14)
  PHONE: string;

  @ApiProperty({
    description:
      'Pickup city ID/code or name as returned by `GET /shipping/forcelog/cities`.',
    example: 'Casablanca',
    maxLength: 50,
  })
  @IsString()
  @MaxLength(50)
  CITY: string;

  @ApiProperty({
    description: 'Complete address from which ForceLog should collect parcels.',
    example: '25 Boulevard Zerktouni, 2nd floor',
    maxLength: 100,
  })
  @IsString()
  @MaxLength(100)
  ADDRESS: string;

  @ApiPropertyOptional({
    description: 'Pickup instructions, contact name, or preferred time window.',
    example: 'Ask for Nadia; available 14:00-17:00',
    maxLength: 100,
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  HOW?: string;

  @ApiPropertyOptional({
    description:
      'Whether the driver should bring printed parcel stickers to the pickup.',
    example: true,
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  STICKERS?: boolean;
}
