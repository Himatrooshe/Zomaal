import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMinSize,
  IsArray,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';

export class ForceLogReturnRequestDto {
  @ApiProperty({
    description:
      'One or more ForceLog parcel codes selected from the eligible-return endpoint.',
    type: [String],
    example: ['FL123456789MA', 'FL123456790MA'],
    minItems: 1,
  })
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  PARCELS: string[];

  @ApiProperty({
    description: 'Phone number ForceLog should call to arrange collection.',
    example: '0612345678',
  })
  @IsString()
  PHONE: string;

  @ApiProperty({
    description: 'Pickup neighborhood, district, or quarter.',
    example: 'Maarif',
    minLength: 5,
  })
  @IsString()
  @MinLength(5)
  QUARTER: string;

  @ApiProperty({
    description:
      'Pickup city ID/code obtained from `GET /shipping/forcelog/cities`.',
    example: 'Casablanca',
  })
  @IsString()
  CITY: string;

  @ApiPropertyOptional({
    description: 'Additional collection instructions for ForceLog.',
    example: 'Call 30 minutes before arrival',
  })
  @IsOptional()
  @IsString()
  NOTE?: string;
}
