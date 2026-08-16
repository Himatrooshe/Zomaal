import { ApiProperty } from '@nestjs/swagger';
import { WarehouseProductKind, WarehouseProductStatus } from '@prisma/client';
import { WarehouseBarcodeDto } from './barcode.dto';
import { ProductCategoryResponseDto } from './category-response.dto';

export class ProductOptionValueResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'M' })
  value: string;

  @ApiProperty({ example: 0 })
  position: number;
}

export class ProductOptionResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'Size' })
  name: string;

  @ApiProperty({ example: 0 })
  position: number;

  @ApiProperty({ type: [ProductOptionValueResponseDto] })
  values: ProductOptionValueResponseDto[];
}

export class WarehouseMediaReferenceDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ enum: ['PRODUCT_MAIN', 'PRODUCT_GALLERY', 'VARIANT'] })
  purpose: string;

  @ApiProperty({ example: 0 })
  position: number;

  @ApiProperty({ example: 'image/webp' })
  contentType: string;

  @ApiProperty({
    description:
      'Authenticated relative URL. Prefix it with the API base URL and send the bearer token when loading.',
    example: '/warehouse/media/6ee20108-004a-49c8-bff1-f197b7b67939/content',
  })
  url: string;
}

export class WarehouseVariantOptionResponseDto {
  @ApiProperty({ example: 'Size' })
  name: string;

  @ApiProperty({ example: 'M' })
  value: string;
}

export class WarehouseInventoryLocationResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'Main Warehouse' })
  name: string;

  @ApiProperty({ example: 10 })
  onHand: number;

  @ApiProperty({ example: 2 })
  reserved: number;

  @ApiProperty({ example: 1 })
  damaged: number;

  @ApiProperty({ example: 5 })
  incoming: number;

  @ApiProperty({ example: 7 })
  available: number;
}

export class WarehouseVariantInventoryResponseDto {
  @ApiProperty({ example: 10 })
  onHand: number;

  @ApiProperty({ example: 2 })
  reserved: number;

  @ApiProperty({ example: 1 })
  damaged: number;

  @ApiProperty({ example: 7 })
  available: number;

  @ApiProperty({ type: [WarehouseInventoryLocationResponseDto] })
  locations: WarehouseInventoryLocationResponseDto[];
}

export class WarehouseVariantResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'M / Black' })
  title: string;

  @ApiProperty({ nullable: true, example: 'TSHIRT-M-BLACK' })
  sku: string | null;

  @ApiProperty({ example: 50, description: 'Retail/base selling price.' })
  price: number;

  @ApiProperty({ example: 20, description: 'Merchant purchase cost.' })
  costPrice: number;

  @ApiProperty({ example: 5 })
  lowStockAlertThreshold: number;

  @ApiProperty({
    description:
      'True only for the hidden variant used by a product without options.',
    example: false,
  })
  isDefault: boolean;

  @ApiProperty({ type: [WarehouseVariantOptionResponseDto] })
  options: WarehouseVariantOptionResponseDto[];

  @ApiProperty({ nullable: true, format: 'uuid' })
  inventoryItemId: string | null;

  @ApiProperty({ nullable: true, type: WarehouseBarcodeDto })
  barcode: WarehouseBarcodeDto | null;

  @ApiProperty({ type: WarehouseVariantInventoryResponseDto })
  inventory: WarehouseVariantInventoryResponseDto;

  @ApiProperty({ type: [WarehouseMediaReferenceDto] })
  images: WarehouseMediaReferenceDto[];
}

export class WarehouseProductInventorySummaryDto {
  @ApiProperty({ description: 'Sum across all variants.', example: 30 })
  onHand: number;

  @ApiProperty({ description: 'Sum across all variants.', example: 27 })
  available: number;
}

export class WarehouseProductGiftResponseDto {
  @ApiProperty({ format: 'uuid' })
  variantId: string;

  @ApiProperty({ example: 1 })
  quantity: number;

  @ApiProperty({ format: 'uuid' })
  productId: string;

  @ApiProperty({ example: 'Wireless Noise-Cancelling Headphones' })
  productName: string;

  @ApiProperty({ example: 'Default' })
  variantTitle: string;

  @ApiProperty({ example: 249.99 })
  price: number;

  @ApiProperty({ nullable: true, type: WarehouseMediaReferenceDto })
  image: WarehouseMediaReferenceDto | null;
}

export class WarehouseProductPackagingResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  packagingMaterialId: string;

  @ApiProperty({ example: 'Large corrugated box' })
  name: string;

  @ApiProperty({ example: 1 })
  quantityPerUnit: number;

  @ApiProperty({ example: 20 })
  ownedQuantity: number;

  @ApiProperty({
    nullable: true,
    example: '/warehouse/packaging/2d5e2688-0818-429a-bb03-8351130c60ea/image',
  })
  imageUrl: string | null;
}

export class WarehouseProductBundleComponentDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  variantId: string;

  @ApiProperty({ format: 'uuid' })
  productId: string;

  @ApiProperty({ example: 'Wireless Mouse' })
  productName: string;

  @ApiProperty({ example: 'Default' })
  variantTitle: string;

  @ApiProperty({ nullable: true, example: 'MOUSE-001' })
  sku: string | null;

  @ApiProperty({ example: 1 })
  quantity: number;

  @ApiProperty({ example: 45 })
  availableUnits: number;

  @ApiProperty({ example: 45 })
  availableBundles: number;

  @ApiProperty({ example: 40 })
  unitCost: number;
}

export class WarehouseProductResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'Premium Cotton T-Shirt' })
  name: string;

  @ApiProperty({ nullable: true, example: 'Cotton T-shirt with size options.' })
  description: string | null;

  @ApiProperty({ enum: WarehouseProductStatus, example: 'ACTIVE' })
  status: WarehouseProductStatus;

  @ApiProperty({ enum: WarehouseProductKind, example: 'STANDARD' })
  kind: WarehouseProductKind;

  @ApiProperty({
    description: 'Optimistic-lock version required by PATCH.',
    example: 1,
  })
  version: number;

  @ApiProperty({ nullable: true, type: ProductCategoryResponseDto })
  category: ProductCategoryResponseDto | null;

  @ApiProperty({ type: [ProductOptionResponseDto] })
  options: ProductOptionResponseDto[];

  @ApiProperty({ type: [WarehouseMediaReferenceDto] })
  images: WarehouseMediaReferenceDto[];

  @ApiProperty({ type: [WarehouseVariantResponseDto] })
  variants: WarehouseVariantResponseDto[];

  @ApiProperty({ type: WarehouseProductInventorySummaryDto })
  inventory: WarehouseProductInventorySummaryDto;

  @ApiProperty({ nullable: true, type: WarehouseProductGiftResponseDto })
  gift: WarehouseProductGiftResponseDto | null;

  @ApiProperty({ type: [WarehouseProductPackagingResponseDto] })
  packaging: WarehouseProductPackagingResponseDto[];

  @ApiProperty({ type: [WarehouseProductBundleComponentDto] })
  bundleComponents: WarehouseProductBundleComponentDto[];

  @ApiProperty({ format: 'date-time' })
  createdAt: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt: string;

  @ApiProperty({ nullable: true, format: 'date-time' })
  archivedAt: string | null;
}

export class WarehouseProductPaginationDto {
  @ApiProperty({ example: 45 })
  total: number;

  @ApiProperty({ example: 1 })
  page: number;

  @ApiProperty({ example: 20 })
  limit: number;

  @ApiProperty({ example: 3 })
  totalPages: number;
}

export class WarehouseProductListResponseDto {
  @ApiProperty({ type: [WarehouseProductResponseDto] })
  data: WarehouseProductResponseDto[];

  @ApiProperty({ type: WarehouseProductPaginationDto })
  pagination: WarehouseProductPaginationDto;
}

export class ProductPerformancePeriodDto {
  @ApiProperty({ enum: ['7D', '30D', '90D', 'CUSTOM'] })
  period: string;

  @ApiProperty({ format: 'date-time' })
  from: string;

  @ApiProperty({ format: 'date-time' })
  to: string;
}

export class ProductPerformanceMetricsDto {
  @ApiProperty() totalOrders: number;
  @ApiProperty() deliveredOrders: number;
  @ApiProperty() cancelledOrders: number;
  @ApiProperty() returnedOrders: number;
  @ApiProperty() totalUnits: number;
  @ApiProperty() totalRevenue: string;
  @ApiProperty() totalCost: string;
  @ApiProperty() grossProfit: string;
  @ApiProperty() netProfit: string;
  @ApiProperty({ nullable: true }) roi: number | null;
  @ApiProperty() deliveryRate: number;
  @ApiProperty() cancellationRate: number;
  @ApiProperty() returnRate: number;
}

export class ProductPerformancePointDto {
  @ApiProperty({ format: 'date' })
  date: string;
  @ApiProperty() orders: number;
  @ApiProperty() units: number;
  @ApiProperty() revenue: string;
  @ApiProperty() profit: string;
}

export class ProductTopCityDto {
  @ApiProperty() city: string;
  @ApiProperty() orders: number;
  @ApiProperty() revenue: string;
}

export class ProductPerformanceResponseDto {
  @ApiProperty({ format: 'uuid' })
  productId: string;
  @ApiProperty() currency: string;
  @ApiProperty({ type: ProductPerformancePeriodDto })
  period: ProductPerformancePeriodDto;
  @ApiProperty({ type: ProductPerformanceMetricsDto })
  metrics: ProductPerformanceMetricsDto;
  @ApiProperty({ type: [ProductPerformancePointDto] })
  performance: ProductPerformancePointDto[];
  @ApiProperty({ type: [ProductTopCityDto] })
  topCities: ProductTopCityDto[];
  @ApiProperty({ nullable: true, format: 'date-time' })
  dataUpdatedAt: string | null;
}
