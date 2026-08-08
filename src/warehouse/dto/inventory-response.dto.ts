import { ApiProperty } from '@nestjs/swagger';
import {
  InventoryBucket,
  InventoryItemKind,
  InventoryMovementType,
} from '@prisma/client';
import { WarehouseBarcodeDto } from './barcode.dto';

export class InventoryLocationDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'Main Warehouse' })
  name: string;

  @ApiProperty({ example: 'MAIN' })
  code: string;

  @ApiProperty({ example: true })
  isDefault: boolean;

  @ApiProperty({ example: true })
  isActive: boolean;
}

export class InventoryBalanceResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 50 })
  onHand: number;

  @ApiProperty({ example: 2 })
  reserved: number;

  @ApiProperty({ example: 1 })
  damaged: number;

  @ApiProperty({ example: 10 })
  incoming: number;

  @ApiProperty({ example: 47 })
  available: number;

  @ApiProperty({ example: 1 })
  version: number;

  @ApiProperty({ type: InventoryLocationDto })
  location: InventoryLocationDto;
}

export class InventoryProductReferenceDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'Wireless Headphones' })
  name: string;
}

export class InventoryVariantReferenceDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'Default' })
  title: string;

  @ApiProperty({ nullable: true, example: 'HEADPHONE-001' })
  sku: string | null;

  @ApiProperty({ example: 249.99 })
  price: number;

  @ApiProperty({ example: 120 })
  costPrice: number;

  @ApiProperty({ example: 5 })
  lowStockAlertThreshold: number;

  @ApiProperty({ type: InventoryProductReferenceDto })
  product: InventoryProductReferenceDto;
}

export class InventoryPackagingReferenceDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'Large corrugated box' })
  name: string;

  @ApiProperty({ nullable: true, example: 'BOX-LARGE' })
  sku: string | null;

  @ApiProperty({
    nullable: true,
    example: '/warehouse/packaging/2d5e2688-0818-429a-bb03-8351130c60ea/image',
  })
  imageUrl: string | null;
}

export class InventoryItemResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ enum: InventoryItemKind })
  kind: InventoryItemKind;

  @ApiProperty({ nullable: true, type: InventoryVariantReferenceDto })
  variant: InventoryVariantReferenceDto | null;

  @ApiProperty({ nullable: true, type: InventoryPackagingReferenceDto })
  packagingMaterial: InventoryPackagingReferenceDto | null;

  @ApiProperty({ type: [WarehouseBarcodeDto] })
  barcodes: WarehouseBarcodeDto[];

  @ApiProperty({ type: [InventoryBalanceResponseDto] })
  balances: InventoryBalanceResponseDto[];

  @ApiProperty({ format: 'date-time' })
  createdAt: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt: string;
}

export class InventoryMovementLocationDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'Main Warehouse' })
  name: string;
}

export class InventoryMovementResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ enum: InventoryMovementType, example: 'MANUAL_ADJUSTMENT' })
  type: InventoryMovementType;

  @ApiProperty({ enum: InventoryBucket, example: 'ON_HAND' })
  bucket: InventoryBucket;

  @ApiProperty({ example: 10 })
  quantityDelta: number;

  @ApiProperty({ example: 60 })
  resultingQuantity: number;

  @ApiProperty({ nullable: true, example: 'Received stock from supplier' })
  reason: string | null;

  @ApiProperty({ nullable: true, example: 'SUPPLIER_DELIVERY' })
  referenceType: string | null;

  @ApiProperty({ nullable: true, example: 'DELIVERY-1001' })
  referenceId: string | null;

  @ApiProperty({ nullable: true, example: 'inventory-adjustment-001' })
  idempotencyKey: string | null;

  @ApiProperty({ format: 'uuid' })
  inventoryItemId: string;

  @ApiProperty({ format: 'uuid' })
  locationId: string;

  @ApiProperty({ format: 'date-time' })
  createdAt: string;

  @ApiProperty({ type: InventoryMovementLocationDto, required: false })
  location?: InventoryMovementLocationDto;
}
