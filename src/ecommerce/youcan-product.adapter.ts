import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { YouCanConnectionService } from '../youcan/youcan-connection.service';
import {
  EcommerceProductAdapter,
  ProductData,
} from './interfaces/ecommerce-product-adapter.interface';

@Injectable()
export class YouCanProductAdapter implements EcommerceProductAdapter {
  constructor(private readonly connectionService: YouCanConnectionService) {}

  async publishProduct(
    userId: string,
    product: ProductData,
  ): Promise<{ externalProductId: string }> {
    const payload = {
      name: product.title,
      description: product.description,
      visibility: product.status === 'ACTIVE' ? 1 : 0,
      price: product.variants[0]?.price || 0,
      compare_at_price: product.variants[0]?.compareAtPrice || null,
      sku: product.variants[0]?.sku || '',
      inventory: product.variants[0]?.inventoryQty || 0,
      has_variants: product.variants.length > 1,
      variants: product.variants.map((v) => ({
        price: v.price,
        compare_at_price: v.compareAtPrice,
        sku: v.sku,
        inventory: v.inventoryQty,
      })),
      images: product.images.map((img) => ({
        url: img.url,
        sort_order: img.position,
      })),
    };

    try {
      const response = await this.connectionService.postJsonForUser<{
        product: { id: string };
      }>(userId, '/products', payload);

      return { externalProductId: response.product.id };
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : 'Failed to create product';
      throw new InternalServerErrorException(`YouCan Error: ${message}`);
    }
  }
}
