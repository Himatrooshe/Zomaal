import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMinSize, IsArray, IsString, MinLength } from 'class-validator';

export class ForceLogReturnRequestDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  PARCELS: string[];

  @ApiProperty()
  @IsString()
  PHONE: string;

  @ApiProperty({ minLength: 5 })
  @IsString()
  @MinLength(5)
  QUARTER: string;

  @ApiProperty({ description: 'City ID.' })
  @IsString()
  CITY: string;

  @ApiPropertyOptional()
  @IsString()
  NOTE?: string;
}
