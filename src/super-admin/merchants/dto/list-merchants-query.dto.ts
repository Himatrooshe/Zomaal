import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBooleanString, IsOptional, IsString } from 'class-validator';

export class ListMerchantsQueryDto {
  @ApiPropertyOptional({
    description:
      'Case-insensitive match on business name, owner name, or phone.',
  })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({
    description: '"true" or "false" — filter by active/suspended.',
  })
  @IsOptional()
  @IsBooleanString()
  isActive?: string;
}
