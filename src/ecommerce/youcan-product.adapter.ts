import {
  BadGatewayException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { YouCanConnectionService } from '../youcan/youcan-connection.service';
import {
  EcommerceProductAdapter,
  ProductData,
} from './interfaces/ecommerce-product-adapter.interface';

interface YouCanProductCreateResponse {
  id?: string;
  product?: {
    id?: string;
  };
}

@Injectable()
export class YouCanProductAdapter implements EcommerceProductAdapter {
  constructor(private readonly connectionService: YouCanConnectionService) {}

  async publishProduct(
    userId: string,
    product: ProductData,
  ): Promise<{ externalProductId: string }> {
    const firstVariant = product.variants[0];
    if (!firstVariant) {
      throw new InternalServerErrorException(
        'YouCan products require at least one variant',
      );
    }

    const hasVariants = product.variants.length > 1;
    const variantNames = uniqueVariantNames(product);
    const payload = {
      name: product.title,
      description: product.description,
      visibility: product.status === 'ACTIVE',
      track_inventory: true,
      price: firstVariant.price,
      compare_at_price: firstVariant.compareAtPrice,
      sku: hasVariants ? undefined : firstVariant.sku,
      inventory: hasVariants ? 0 : firstVariant.inventoryQty,
      has_variants: hasVariants,
      variant_options: hasVariants
        ? [
            {
              name: 'Title',
              type: 4,
              values: variantNames,
            },
          ]
        : undefined,
      variants: hasVariants
        ? product.variants.map((variant, index) => ({
            variations: { Title: variantNames[index] },
            price: variant.price,
            compare_at_price: variant.compareAtPrice,
            sku: variant.sku,
            inventory: variant.inventoryQty,
          }))
        : undefined,
      vendors: product.vendor ? [product.vendor] : undefined,
      images: product.images.map((image) => ({
        name: image.url,
        order: image.position,
        type: 1,
      })),
    };

    try {
      const response =
        await this.connectionService.postJsonForUser<YouCanProductCreateResponse>(
          userId,
          '/products',
          payload,
        );
      const externalProductId = response.id ?? response.product?.id;
      if (!externalProductId) {
        throw new BadGatewayException(
          'YouCan product response did not include an identifier',
        );
      }
      return { externalProductId };
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : 'Failed to create product';
      throw new InternalServerErrorException(`YouCan Error: ${message}`);
    }
  }
}

function uniqueVariantNames(product: ProductData): string[] {
  const used = new Set<string>();
  return product.variants.map((variant, index) => {
    const base = variant.title?.trim() || `Variant ${index + 1}`;
    let candidate = base;
    let suffix = 2;
    while (used.has(candidate.toLowerCase())) {
      candidate = `${base} ${suffix}`;
      suffix += 1;
    }
    used.add(candidate.toLowerCase());
    return candidate;
  });
}
