import { Module } from '@nestjs/common';
import { BarcodeLabelService } from './barcode-label.service';
import { BarcodeController } from './barcode.controller';
import { BarcodeService } from './barcode.service';
import { CategoryController } from './category.controller';
import { CategoryService } from './category.service';
import { InventoryController } from './inventory.controller';
import { InventoryService } from './inventory.service';
import { MediaController } from './media.controller';
import { MediaService } from './media.service';
import { PackagingController } from './packaging.controller';
import { PackagingService } from './packaging.service';
import { ProductController } from './product.controller';
import { ProductService } from './product.service';
import { WarehouseStoreService } from './warehouse-store.service';

@Module({
  controllers: [
    CategoryController,
    BarcodeController,
    MediaController,
    ProductController,
    InventoryController,
    PackagingController,
  ],
  providers: [
    WarehouseStoreService,
    CategoryService,
    BarcodeService,
    BarcodeLabelService,
    MediaService,
    ProductService,
    InventoryService,
    PackagingService,
  ],
  exports: [PackagingService],
})
export class WarehouseModule {}
