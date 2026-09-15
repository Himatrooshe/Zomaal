import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class UpdateMerchantDto {
  @ApiPropertyOptional({ example: 'Zomaal Demo Store' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(150)
  businessName?: string;

  @ApiPropertyOptional({ example: 'Jane Doe' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(150)
  ownerName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  address?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  city?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  country?: string;

  @ApiPropertyOptional({
    description:
      'Suspends the merchant when false. Not yet enforced as an access gate elsewhere in the app — informational/operational for now.',
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
