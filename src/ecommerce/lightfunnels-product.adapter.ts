import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { LightfunnelsConnectionService } from '../lightfunnels/lightfunnels-connection.service';
import {
  EcommerceProductAdapter,
  ProductData,
} from './interfaces/ecommerce-product-adapter.interface';

interface LightfunnelsProductCreateResponse {
  productCreate: {
    product: {
      id: string;
    } | null;
    errors: { message: string }[];
  };
}

@Injectable()
export class LightfunnelsProductAdapter implements EcommerceProductAdapter {
  constructor(
    private readonly connectionService: LightfunnelsConnectionService,
  ) {}

  async publishProduct(
    userId: string,
    product: ProductData,
  ): Promise<{ externalProductId: string }> {
    const query = `
      mutation productCreate($input: ProductInput!) {
        productCreate(input: $input) {
          product {
            id
          }
          errors {
            message
          }
        }
      }
    `;

    const input = {
      title: product.title,
      description: product.description,
      status: product.status === 'ACTIVE' ? 'PUBLISHED' : 'DRAFT',
      variants: product.variants.map((v) => ({
        price: v.price,
        compare_at_price: v.compareAtPrice,
        sku: v.sku,
        quantity: v.inventoryQty,
      })),
      images: product.images.map((img) => ({
        url: img.url,
      })),
    };

    const response =
      await this.connectionService.graphqlForUser<LightfunnelsProductCreateResponse>(
        userId,
        query,
        { input },
      );

    if (response.productCreate.errors?.length > 0) {
      throw new InternalServerErrorException(
        `Lightfunnels Error: ${response.productCreate.errors.map((e) => e.message).join(', ')}`,
      );
    }

    if (!response.productCreate.product) {
      throw new InternalServerErrorException(
        'Product was not created on Lightfunnels',
      );
    }

    return { externalProductId: response.productCreate.product.id };
  }
}
