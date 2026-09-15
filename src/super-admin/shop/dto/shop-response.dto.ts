import { ApiProperty } from '@nestjs/swagger';
import { ShopProductStatus } from '@prisma/client';

export class MessageResponseDto {
  @ApiProperty({ example: 'Category deleted' })
  message: string;
}

export class ShopCategoryResponseDto {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
  @ApiProperty() slug: string;
  @ApiProperty() isActive: boolean;
  @ApiProperty() sortOrder: number;
  @ApiProperty({
    description: 'Number of products currently in this category.',
  })
  productCount: number;
  @ApiProperty() createdAt: string;
  @ApiProperty() updatedAt: string;
}

export class ShopProductImageDto {
  @ApiProperty() id: string;
  @ApiProperty({ example: '/shop-media/images/3f0c…' }) url: string;
}

export class ShopProductCategoryRefDto {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
}

export class ShopProductResponseDto {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
  @ApiProperty() slug: string;
  @ApiProperty({ nullable: true }) sku: string | null;
  @ApiProperty({ nullable: true }) description: string | null;
  @ApiProperty({ description: 'Fixed to 2 decimal places.' }) price: string;
  @ApiProperty() stock: number;
  @ApiProperty() lowStock: boolean;
  @ApiProperty({ enum: ShopProductStatus }) status: ShopProductStatus;
  @ApiProperty({ type: ShopProductCategoryRefDto })
  category: ShopProductCategoryRefDto;
  @ApiProperty({
    type: [ShopProductImageDto],
    description: 'Gallery in display order; the first image is the cover.',
  })
  images: ShopProductImageDto[];
  @ApiProperty({
    nullable: true,
    description: 'Public URL of the cover image, or null if none.',
  })
  imageUrl: string | null;
  @ApiProperty() createdAt: string;
  @ApiProperty() updatedAt: string;
}

export class ShopImportResultDto {
  @ApiProperty() created: number;
  @ApiProperty() updated: number;
  @ApiProperty() createdCategories: number;
}
