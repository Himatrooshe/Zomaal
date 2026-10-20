import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { strictInteger } from '../../common/calendar-date.util';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class CustomerListQueryDto {
  @ApiPropertyOptional({ description: 'Matches name or phone number.' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 1000000, default: 1 })
  @IsOptional()
  @Transform(strictInteger)
  @IsInt()
  @Min(1)
  @Max(1000000)
  page?: number = 1;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20 })
  @IsOptional()
  @Transform(strictInteger)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}
