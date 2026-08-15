import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional } from 'class-validator';

export class QuickLivraisonOverviewQueryDto {
  @ApiPropertyOptional({
    description: 'Rolling UTC period used by the performance trend.',
    enum: [7, 30, 90],
    default: 7,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsIn([7, 30, 90])
  days?: 7 | 30 | 90;
}
