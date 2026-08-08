import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ProductCategoryCountDto {
  @ApiProperty({
    description:
      'Number of warehouse products currently assigned to the category.',
    example: 12,
  })
  products: number;
}

export class ProductCategoryResponseDto {
  @ApiProperty({
    format: 'uuid',
    example: '48147007-8231-4702-a15c-62f423992583',
  })
  id: string;

  @ApiProperty({ example: 'Electronics' })
  name: string;

  @ApiProperty({ example: 'electronics' })
  slug: string;

  @ApiProperty({ nullable: true, example: 'Electronic warehouse products' })
  description: string | null;

  @ApiProperty({ example: 0 })
  position: number;

  @ApiProperty({ example: true })
  isActive: boolean;

  @ApiProperty({ format: 'uuid' })
  storeId: string;

  @ApiProperty({ nullable: true, format: 'uuid', example: null })
  parentId: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt: string;

  @ApiPropertyOptional({ type: ProductCategoryCountDto })
  _count?: ProductCategoryCountDto;
}
