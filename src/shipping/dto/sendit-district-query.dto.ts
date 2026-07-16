import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Min } from 'class-validator';
import { Transform, Type } from 'class-transformer';

export class SenditDistrictQueryDto {
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
    description: 'Case-insensitive district/city search text.',
    example: 'Casablanca',
  })
  @IsOptional()
  @IsString()
  querystring?: string;

  @ApiPropertyOptional({
    name: 'pickup-district',
    description:
      'Set to 1 to return only districts that Sendit accepts as pickup locations.',
    example: 1,
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
