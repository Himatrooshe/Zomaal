import type { YouCanConnectionService } from '../youcan/youcan-connection.service';
import type { ProductData } from './interfaces/ecommerce-product-adapter.interface';
import { YouCanProductAdapter } from './youcan-product.adapter';

describe('YouCanProductAdapter', () => {
  it('uses the documented product, variant, and image fields', async () => {
    const postJsonForUser = jest.fn().mockResolvedValue({ id: 'product-id' });
    const service = new YouCanProductAdapter({
      postJsonForUser,
    } as unknown as YouCanConnectionService);

    const result = await service.publishProduct('user-id', productFixture());

    expect(result).toEqual({ externalProductId: 'product-id' });
    expect(postJsonForUser).toHaveBeenCalledWith(
      'user-id',
      '/products',
      expect.objectContaining({
        name: 'Winter Hat',
        visibility: true,
        track_inventory: true,
        has_variants: true,
        variant_options: [
          {
            name: 'Title',
            type: 4,
            values: ['Black', 'Large'],
          },
        ],
        variants: [
          expect.objectContaining({
            variations: { Title: 'Black' },
            sku: 'HAT-BLK',
            inventory: 12,
          }),
          expect.objectContaining({
            variations: { Title: 'Large' },
            sku: 'HAT-L',
            inventory: 5,
          }),
        ],
        images: [
          {
            name: 'https://example.com/hat.jpg',
            order: 0,
            type: 1,
          },
        ],
      }),
    );
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
        title: 'Large',
        sku: 'HAT-L',
        price: 109,
        inventoryQty: 5,
      },
    ],
    images: [{ url: 'https://example.com/hat.jpg', position: 0 }],
  };
}
