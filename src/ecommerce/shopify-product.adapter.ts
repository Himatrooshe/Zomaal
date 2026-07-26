import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ShopifyConnectionService } from '../shopify/shopify-connection.service';
import {
  EcommerceProductAdapter,
  ProductData,
} from './interfaces/ecommerce-product-adapter.interface';

interface ShopifyProductCreateResponse {
  productCreate: {
    product: {
      id: string;
    } | null;
    userErrors: { field: string[]; message: string }[];
  };
}

@Injectable()
export class ShopifyProductAdapter implements EcommerceProductAdapter {
  constructor(private readonly connectionService: ShopifyConnectionService) {}

  async publishProduct(
    userId: string,
    product: ProductData,
  ): Promise<{ externalProductId: string }> {
    const input: any = {
      title: product.title,
      descriptionHtml: product.description,
      vendor: product.vendor,
      status: product.status === 'ACTIVE' ? 'ACTIVE' : 'DRAFT',
      variants: product.variants.map((v) => ({
        price: v.price.toString(),
        compareAtPrice: v.compareAtPrice?.toString(),
        sku: v.sku,
        // options mapping can be complex without knowing option names, using default for MVP
      })),
    };

    const media = product.images?.map((img) => ({
      mediaContentType: 'IMAGE',
      originalSource: img.url,
    }));

    const query = `
      mutation productCreate($input: ProductInput!, $media: [CreateMediaInput!]) {
        productCreate(input: $input, media: $media) {
          product {
            id
          }
          userErrors {
            field
            message
          }
        }
      }
    `;

    const response =
      await this.connectionService.graphqlForUser<ShopifyProductCreateResponse>(
        userId,
        query,
        { input, media: media?.length ? media : undefined },
      );

    if (response.productCreate.userErrors.length > 0) {
      throw new InternalServerErrorException(
        `Shopify Error: ${response.productCreate.userErrors.map((e) => e.message).join(', ')}`,
      );
    }

    if (!response.productCreate.product) {
      throw new InternalServerErrorException(
        'Product was not created on Shopify',
      );
    }

    // Return the global ID
    return { externalProductId: response.productCreate.product.id };
  }
}
