import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Min } from 'class-validator';
import { Transform, Type } from 'class-transformer';

export class SenditDistrictQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  querystring?: string;

  @ApiPropertyOptional({
    name: 'pickup-district',
    description: 'Use 1 to filter pickup districts.',
  })
  @IsOptional()
  @Transform(
    ({ obj, value }: { obj: Record<string, unknown>; value: unknown }) =>
      value ?? obj['pickup-district'],
  )
  @Type(() => Number)
  @IsInt()
  pickupDistrict?: number;
}
