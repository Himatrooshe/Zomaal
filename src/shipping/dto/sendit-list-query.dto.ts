import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class SenditListQueryDto {
  @ApiPropertyOptional({
    description: 'One-based result page.',
    example: 1,
    minimum: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({
    description:
      'Provider search text, such as a tracking code, customer name, phone number, or reference.',
    example: 'ORDER-2026-0042',
  })
  @IsOptional()
  @IsString()
  querystring?: string;
}
