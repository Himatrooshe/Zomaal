import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class YouCanPaginationMetaDto {
  @ApiProperty({ example: 1 })
  current_page!: number;

  @ApiProperty({ example: 5 })
  last_page!: number;

  @ApiProperty({ example: 20 })
  per_page!: number;

  @ApiProperty({ example: 100 })
  total!: number;
}

export class YouCanDataResponseDto<T> {
  @ApiProperty()
  data!: T;
}

export class YouCanPaginatedResponseDto<T> {
  @ApiProperty()
  data!: T[];

  @ApiPropertyOptional()
  meta?: {
    pagination?: YouCanPaginationMetaDto;
  };
}

export class YouCanProductDto {
  @ApiProperty()
  id!: string;

  @ApiPropertyOptional()
  name?: string;

  @ApiPropertyOptional()
  slug?: string;

  @ApiPropertyOptional()
  price?: number;
}

export class YouCanOrderDto {
  @ApiProperty()
  id!: string;

  @ApiPropertyOptional()
  ref?: string;

  @ApiPropertyOptional()
  total?: string;

  @ApiPropertyOptional()
  currency?: string;

  @ApiPropertyOptional()
  status?: number;
}

export class YouCanCustomerDto {
  @ApiProperty()
  id!: string;

  @ApiPropertyOptional()
  first_name?: string;

  @ApiPropertyOptional()
  last_name?: string;

  @ApiPropertyOptional()
  email?: string;
}
