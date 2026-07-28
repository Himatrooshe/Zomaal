import {
  Injectable,
  InternalServerErrorException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ShopifyConnectionService } from '../shopify/shopify-connection.service';
import {
  EcommerceProductAdapter,
  ProductData,
} from './interfaces/ecommerce-product-adapter.interface';

interface ShopifyLocationsResponse {
  locations: {
    nodes: Array<{
      id: string;
      name: string;
      isActive: boolean;
    }>;
  };
}

interface ShopifyProductSetResponse {
  productSet: {
    product: {
      id: string;
    } | null;
    userErrors: Array<{
      field: string[] | null;
      message: string;
    }>;
  };
}

interface ShopifyMetafieldDefinitionsResponse {
  metafieldDefinitions: {
    nodes: Array<{
      type: {
        name: string;
      };
    }>;
  };
}

interface ShopifyMetafieldDefinitionCreateResponse {
  metafieldDefinitionCreate: {
    createdDefinition: {
      id: string;
    } | null;
    userErrors: Array<{
      code: string | null;
      message: string;
    }>;
  };
}

const PRODUCT_ID_NAMESPACE = 'zomaal';
const PRODUCT_ID_KEY = 'product_publish_id';

@Injectable()
export class ShopifyProductAdapter implements EcommerceProductAdapter {
  private readonly preparedUsers = new Set<string>();

  constructor(private readonly connectionService: ShopifyConnectionService) {}

  async publishProduct(
    userId: string,
    product: ProductData,
  ): Promise<{ externalProductId: string }> {
    await this.ensureProductIdDefinition(userId);

    const locations =
      await this.connectionService.graphqlForUser<ShopifyLocationsResponse>(
        userId,
        `#graphql
          query ZomaalProductInventoryLocation {
            locations(first: 50) {
              nodes {
                id
                name
                isActive
              }
            }
          }
        `,
      );
    const location = locations.locations.nodes.find((item) => item.isActive);
    if (!location) {
      throw new ServiceUnavailableException(
        'Shopify does not have an active inventory location',
      );
    }

    const variantNames = uniqueVariantNames(product);
    const input = {
      title: product.title,
      descriptionHtml: product.description,
      vendor: product.vendor,
      status: product.status === 'ACTIVE' ? 'ACTIVE' : 'DRAFT',
      productOptions: [
        {
          name: 'Title',
          position: 1,
          values: variantNames.map((name) => ({ name })),
        },
      ],
      variants: product.variants.map((variant, index) => ({
        optionValues: [
          {
            optionName: 'Title',
            name: variantNames[index],
          },
        ],
        price: variant.price,
        compareAtPrice: variant.compareAtPrice,
        sku: variant.sku,
        inventoryQuantities: [
          {
            locationId: location.id,
            name: 'available',
            quantity: variant.inventoryQty,
          },
        ],
      })),
      files: product.images.map((image) => ({
        originalSource: image.url,
        contentType: 'IMAGE',
      })),
      metafields: [
        {
          namespace: PRODUCT_ID_NAMESPACE,
          key: PRODUCT_ID_KEY,
          value: product.idempotencyKey,
        },
      ],
    };
    const identifier = {
      customId: {
        namespace: PRODUCT_ID_NAMESPACE,
        key: PRODUCT_ID_KEY,
        value: product.idempotencyKey,
      },
    };

    const response =
      await this.connectionService.graphqlForUser<ShopifyProductSetResponse>(
        userId,
        `#graphql
          mutation ZomaalPublishProduct(
            $input: ProductSetInput!
            $identifier: ProductSetIdentifiers
          ) {
            productSet(
              input: $input
              identifier: $identifier
              synchronous: true
            ) {
              product {
                id
              }
              userErrors {
                field
                message
              }
            }
          }
        `,
        { input, identifier },
      );

    if (response.productSet.userErrors.length > 0) {
      throw new InternalServerErrorException(
        `Shopify Error: ${response.productSet.userErrors
          .map((error) => error.message)
          .join(', ')}`,
      );
    }
    if (!response.productSet.product) {
      throw new InternalServerErrorException(
        'Product was not created on Shopify',
      );
    }
    return { externalProductId: response.productSet.product.id };
  }

  private async ensureProductIdDefinition(userId: string): Promise<void> {
    if (this.preparedUsers.has(userId)) {
      return;
    }

    const existing =
      await this.connectionService.graphqlForUser<ShopifyMetafieldDefinitionsResponse>(
        userId,
        `#graphql
          query ZomaalProductIdDefinition {
            metafieldDefinitions(
              first: 1
              ownerType: PRODUCT
              namespace: "${PRODUCT_ID_NAMESPACE}"
              key: "${PRODUCT_ID_KEY}"
            ) {
              nodes {
                type {
                  name
                }
              }
            }
          }
        `,
      );
    const definition = existing.metafieldDefinitions.nodes[0];
    if (definition) {
      if (definition.type.name !== 'id') {
        throw new InternalServerErrorException(
          `Shopify metafield ${PRODUCT_ID_NAMESPACE}.${PRODUCT_ID_KEY} exists with type ${definition.type.name}; it must use type id`,
        );
      }
      this.preparedUsers.add(userId);
      return;
    }

    const creation =
      await this.connectionService.graphqlForUser<ShopifyMetafieldDefinitionCreateResponse>(
        userId,
        `#graphql
          mutation ZomaalCreateProductIdDefinition(
            $definition: MetafieldDefinitionInput!
          ) {
            metafieldDefinitionCreate(definition: $definition) {
              createdDefinition {
                id
              }
              userErrors {
                code
                message
              }
            }
          }
        `,
        {
          definition: {
            name: 'Zomaal product publish ID',
            namespace: PRODUCT_ID_NAMESPACE,
            key: PRODUCT_ID_KEY,
            description:
              'Stable identifier used by Zomaal to prevent duplicate product publication.',
            type: 'id',
            ownerType: 'PRODUCT',
            pin: true,
          },
        },
      );
    const result = creation.metafieldDefinitionCreate;
    const createdConcurrently =
      result.userErrors.length > 0 &&
      result.userErrors.every(
        (error) =>
          error.code === 'TAKEN' ||
          /already exists|has been taken/i.test(error.message),
      );
    if (!result.createdDefinition && !createdConcurrently) {
      throw new InternalServerErrorException(
        `Shopify Error: ${
          result.userErrors.map((error) => error.message).join(', ') ||
          'Unable to configure the Zomaal product ID'
        }`,
      );
    }
    this.preparedUsers.add(userId);
  }
}

function uniqueVariantNames(product: ProductData): string[] {
  const used = new Set<string>();
  return product.variants.map((variant, index) => {
    const base =
      variant.title?.trim() ||
      (product.variants.length === 1
        ? 'Default Title'
        : `Variant ${index + 1}`);
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
