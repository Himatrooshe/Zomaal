import type { LightfunnelsConnectionService } from '../lightfunnels/lightfunnels-connection.service';
import type { ProductData } from './interfaces/ecommerce-product-adapter.interface';
import { LightfunnelsProductAdapter } from './lightfunnels-product.adapter';

describe('LightfunnelsProductAdapter', () => {
  it('writes product details, variants, inventory, and images', async () => {
    let capturedVariables: Record<string, unknown> | undefined;
    const graphqlForUser = jest.fn(
      (
        _userId: string,
        _operation: string,
        variables?: Record<string, unknown>,
      ) => {
        capturedVariables = variables;
        return Promise.resolve({
          productCreate: {
            product: { id: 'lightfunnels-product-id' },
            errors: [],
          },
        });
      },
    );
    const service = new LightfunnelsProductAdapter({
      graphqlForUser,
    } as unknown as LightfunnelsConnectionService);

    const result = await service.publishProduct('user-id', productFixture());

    expect(result).toEqual({
      externalProductId: 'lightfunnels-product-id',
    });
    expect(capturedVariables).toEqual({
      input: {
        title: 'Winter Hat',
        description: '<p>Warm hat</p>',
        status: 'PUBLISHED',
        variants: [
          {
            price: 99,
            compare_at_price: 129,
            sku: 'HAT-BLK',
            quantity: 12,
          },
        ],
        images: [{ url: 'https://example.com/hat.jpg' }],
      },
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
    ],
    images: [{ url: 'https://example.com/hat.jpg', position: 0 }],
  };
}
