import type { ShopifyConnectionService } from '../shopify/shopify-connection.service';
import type { ProductData } from './interfaces/ecommerce-product-adapter.interface';
import { ShopifyProductAdapter } from './shopify-product.adapter';

describe('ShopifyProductAdapter', () => {
  it('prepares the custom ID and upserts product data with productSet', async () => {
    let callCount = 0;
    let capturedOperation = '';
    let capturedVariables: Record<string, unknown> | undefined;
    const graphqlForUser = jest.fn(
      (
        _userId: string,
        operation: string,
        variables?: Record<string, unknown>,
      ): Promise<unknown> => {
        callCount += 1;
        if (callCount === 1) {
          return Promise.resolve({
            metafieldDefinitions: {
              nodes: [{ type: { name: 'id' } }],
            },
          });
        }
        if (callCount === 2) {
          return Promise.resolve({
            locations: {
              nodes: [
                {
                  id: 'gid://shopify/Location/1',
                  name: 'Main',
                  isActive: true,
                },
              ],
            },
          });
        }
        capturedOperation = operation;
        capturedVariables = variables;
        return Promise.resolve({
          productSet: {
            product: { id: 'gid://shopify/Product/1' },
            userErrors: [],
          },
        });
      },
    );
    const service = new ShopifyProductAdapter({
      graphqlForUser,
    } as unknown as ShopifyConnectionService);

    const result = await service.publishProduct('user-id', productFixture());

    expect(result).toEqual({
      externalProductId: 'gid://shopify/Product/1',
    });
    expect(callCount).toBe(3);
    expect(capturedOperation).toContain('productSet');
    const variables = capturedVariables as {
      input: {
        title: string;
        productOptions: unknown[];
        variants: Array<{
          sku: string;
          price: number;
          inventoryQuantities: unknown[];
        }>;
        files: unknown[];
        metafields: unknown[];
      };
      identifier: unknown;
    };
    expect(variables.input.title).toBe('Winter Hat');
    expect(variables.input.productOptions).toEqual([
      {
        name: 'Title',
        position: 1,
        values: [{ name: 'Black' }, { name: 'Black 2' }],
      },
    ]);
    expect(variables.input.variants).toEqual([
      expect.objectContaining({
        sku: 'HAT-BLK',
        price: 99,
        inventoryQuantities: [
          {
            locationId: 'gid://shopify/Location/1',
            name: 'available',
            quantity: 12,
          },
        ],
      }),
      expect.objectContaining({
        sku: 'HAT-BLK-2',
        price: 109,
      }),
    ]);
    expect(variables.input.files).toEqual([
      {
        originalSource: 'https://example.com/hat.jpg',
        contentType: 'IMAGE',
      },
    ]);
    expect(variables.input.metafields).toEqual([
      {
        namespace: 'zomaal',
        key: 'product_publish_id',
        value: 'publish-request-1',
      },
    ]);
    expect(variables.identifier).toEqual({
      customId: {
        namespace: 'zomaal',
        key: 'product_publish_id',
        value: 'publish-request-1',
      },
    });
  });

  it('creates the Shopify id metafield definition when it is missing', async () => {
    let callCount = 0;
    let creationOperation = '';
    let creationVariables: Record<string, unknown> | undefined;
    const graphqlForUser = jest.fn(
      (
        _userId: string,
        operation: string,
        variables?: Record<string, unknown>,
      ): Promise<unknown> => {
        callCount += 1;
        if (callCount === 1) {
          return Promise.resolve({
            metafieldDefinitions: { nodes: [] },
          });
        }
        if (callCount === 2) {
          creationOperation = operation;
          creationVariables = variables;
          return Promise.resolve({
            metafieldDefinitionCreate: {
              createdDefinition: {
                id: 'gid://shopify/MetafieldDefinition/1',
              },
              userErrors: [],
            },
          });
        }
        if (callCount === 3) {
          return Promise.resolve({
            locations: {
              nodes: [
                {
                  id: 'gid://shopify/Location/1',
                  name: 'Main',
                  isActive: true,
                },
              ],
            },
          });
        }
        return Promise.resolve({
          productSet: {
            product: { id: 'gid://shopify/Product/1' },
            userErrors: [],
          },
        });
      },
    );
    const service = new ShopifyProductAdapter({
      graphqlForUser,
    } as unknown as ShopifyConnectionService);

    await service.publishProduct('user-id', productFixture());

    expect(callCount).toBe(4);
    expect(creationOperation).toContain('metafieldDefinitionCreate');
    const definition = creationVariables?.definition as Record<string, unknown>;
    expect(definition).toMatchObject({
      namespace: 'zomaal',
      key: 'product_publish_id',
      type: 'id',
      ownerType: 'PRODUCT',
      pin: true,
    });
  });
});

function productFixture(): ProductData {
  return {
    idempotencyKey: 'publish-request-1',
    title: 'Winter Hat',
    description: '<p>Warm hat</p>',
    vendor: 'Zomaal',
    status: 'ACTIVE',
    variants: [
      {
        title: 'Black',
        sku: 'HAT-BLK',
        price: 99,
        compareAtPrice: 129,
        inventoryQty: 12,
      },
      {
        title: 'Black',
        sku: 'HAT-BLK-2',
        price: 109,
        inventoryQty: 5,
      },
    ],
    images: [{ url: 'https://example.com/hat.jpg', position: 0 }],
  };
}
