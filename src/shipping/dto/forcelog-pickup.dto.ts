import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export class ForceLogPickupDto {
  @ApiProperty({ maxLength: 14 })
  @IsString()
  @MaxLength(14)
  PHONE: string;

  @ApiProperty({ description: 'Pickup city code or name.', maxLength: 50 })
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

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  STICKERS?: boolean;
}
