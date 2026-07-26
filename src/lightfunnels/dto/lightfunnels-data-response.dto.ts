import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class LightfunnelsPageInfoDto {
  @ApiProperty({ description: 'Indicates if there are more items to fetch.' })
  hasNextPage!: boolean;

  @ApiProperty({
    description: 'Opaque cursor for the last item in the current page.',
    required: false,
  })
  endCursor?: string | null;
}

export class LightfunnelsEdgeDto<T> {
  @ApiProperty()
  cursor!: string;

  @ApiProperty()
  node!: T;
}

export class LightfunnelsPaginatedConnectionDto<T> {
  @ApiProperty()
  edges!: LightfunnelsEdgeDto<T>[];

  @ApiProperty()
  pageInfo!: LightfunnelsPageInfoDto;
}

export class LightfunnelsPaginatedResponseDto<T> {
  @ApiProperty()
  data!: LightfunnelsPaginatedConnectionDto<T>;
}

export class LightfunnelsDataResponseDto<T> {
  @ApiProperty()
  data!: T;
}

export class LightfunnelsProductDto {
  @ApiProperty()
  id!: string;

  @ApiPropertyOptional()
  title?: string;
}

export class LightfunnelsOrderDto {
  @ApiProperty()
  id!: string;

  @ApiPropertyOptional()
  name?: string;

  @ApiPropertyOptional()
  financial_status?: string;
}

export class LightfunnelsCustomerDto {
  @ApiProperty()
  id!: string;

  @ApiPropertyOptional()
  first_name?: string;

  @ApiPropertyOptional()
  last_name?: string;

  @ApiPropertyOptional()
  email?: string;
}
