import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class SenditSyncQueryDto {
  @ApiPropertyOptional({
    description:
      'One-based Sendit page where this bounded sync run should begin.',
    minimum: 1,
    default: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  startPage?: number;

  @ApiPropertyOptional({
    description:
      'Maximum provider pages to process in this request. Use nextPage from the response to continue a larger backfill.',
    minimum: 1,
    maximum: 20,
    default: 5,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  maxPages?: number;
}
