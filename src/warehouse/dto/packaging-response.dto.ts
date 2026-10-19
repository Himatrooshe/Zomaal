import { ApiProperty } from '@nestjs/swagger';
import { PackagingUnit } from '@prisma/client';
import {
  PACKAGING_SOURCES,
  PACKAGING_STOCK_STATUSES,
  type PackagingSource,
  type PackagingStockStatus,
} from './packaging.dto';

export class OwnedPackagingMaterialResponseDto {
  @ApiProperty({ type: [String] })
  supplierNames: string[];
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({
    enum: PACKAGING_SOURCES,
    description:
      'SHOP = credited from a delivered Zomaal Shop purchase (name, SKU and photo come from the shop catalog). MANUAL = added by the merchant.',
  })
  source: PackagingSource;

  @ApiProperty({
    nullable: true,
    type: String,
    description:
      'Variant identifier from the Zomaal packaging shop catalog. Null for merchant-added packaging.',
    example: 'shop-box-large-brown',
  })
  zomaalShopVariantId: string | null;

  @ApiProperty({ example: 'Large corrugated box' })
  name: string;

  @ApiProperty({ nullable: true, type: String, example: 'BOX-LARGE-BROWN' })
  sku: string | null;

  @ApiProperty({ enum: PackagingUnit })
  unit: PackagingUnit;

  @ApiProperty({
    nullable: true,
    type: String,
    description:
      'Authenticated relative image URL. Null when there is no photo.',
    example: '/warehouse/packaging/2d5e2688-0818-429a-bb03-8351130c60ea/image',
  })
  imageUrl: string | null;

  @ApiProperty({
    nullable: true,
    type: String,
    format: 'uuid',
    description:
      'Use with /warehouse/inventory/items/:id for Update stock (PUT …/stock) and stock history (GET …/movements).',
  })
  inventoryItemId: string | null;

  @ApiProperty({ description: 'Physical stock across locations.', example: 25 })
  onHand: number;

  @ApiProperty({
    description:
      'On-hand minus reserved and damaged quantities across locations.',
    example: 20,
  })
  available: number;

  @ApiProperty({ example: 10 })
  minimumLevel: number;

  @ApiProperty({ description: 'Auto Reorder Alert on/off.' })
  lowStockAlert: boolean;

  @ApiProperty({
    enum: PACKAGING_STOCK_STATUSES,
    description:
      'OUT_OF_STOCK when available ≤ 0, LOW_STOCK when available ≤ minimumLevel.',
  })
  stockStatus: PackagingStockStatus;

  @ApiProperty({ description: 'Products that use this packaging.' })
  usedInProducts: number;

  @ApiProperty({ format: 'date-time' })
  createdAt: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt: string;
}

export class PackagingProductUsageDto {
  @ApiProperty({ format: 'uuid' })
  productId: string;

  @ApiProperty()
  productName: string;

  @ApiProperty({
    nullable: true,
    type: String,
    format: 'uuid',
    description: 'Set when only one variant uses it; null = every variant.',
  })
  variantId: string | null;

  @ApiProperty({ nullable: true, type: String })
  variantTitle: string | null;

  @ApiProperty({
    description: 'Units of packaging used per unit of product sold.',
    example: 1,
  })
  quantityPerUnit: number;
}

export class PackagingMaterialDetailResponseDto extends OwnedPackagingMaterialResponseDto {
  @ApiProperty()
  reserved: number;

  @ApiProperty()
  damaged: number;

  @ApiProperty({ type: [PackagingProductUsageDto] })
  products: PackagingProductUsageDto[];
}

export class ArchivePackagingResponseDto {
  @ApiProperty({ example: true })
  archived: boolean;
}
