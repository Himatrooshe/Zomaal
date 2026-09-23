import { Module } from '@nestjs/common';
import { LightfunnelsModule } from '../lightfunnels/lightfunnels.module';
import { ShopifyModule } from '../shopify/shopify.module';
import { YouCanModule } from '../youcan/youcan.module';
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
import { ProductComparisonPdfService } from './product-comparison-pdf.service';
import { ProductService } from './product.service';
import { WarehouseStoreService } from './warehouse-store.service';

@Module({
  imports: [ShopifyModule, YouCanModule, LightfunnelsModule],
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
    ProductComparisonPdfService,
    InventoryService,
    PackagingService,
  ],
  exports: [
    PackagingService,
    BarcodeLabelService,
    InventoryService,
    MediaService,
  ],
})
export class WarehouseModule {}
