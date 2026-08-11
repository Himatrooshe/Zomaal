import type { ShopifyConnectionService } from '../shopify/shopify-connection.service';
import type { YouCanConnectionService } from '../youcan/youcan-connection.service';
import type { LightfunnelsConnectionService } from '../lightfunnels/lightfunnels-connection.service';
import { ShopifyFulfillmentAdapter } from './shopify-fulfillment.adapter';
import { YouCanFulfillmentAdapter } from './youcan-fulfillment.adapter';
import { LightfunnelsFulfillmentAdapter } from './lightfunnels-fulfillment.adapter';

describe('e-commerce order product adapters', () => {
  it('maps every Shopify order line instead of only unfulfilled lines', async () => {
    const graphqlForUser = jest.fn().mockResolvedValue({
      order: {
        id: 'gid://shopify/Order/42',
        name: '#42',
        currencyCode: 'MAD',
        lineItems: {
          nodes: [
            {
              id: 'gid://shopify/LineItem/1',
              title: 'Leather bag',
              variantTitle: 'Brown',
              sku: 'BAG-BROWN',
              quantity: 2,
              product: { id: 'gid://shopify/Product/10' },
              variant: { id: 'gid://shopify/ProductVariant/11' },
              image: { url: 'https://cdn.shopify.com/bag.jpg' },
              originalUnitPriceSet: {
                shopMoney: { amount: '149.9000', currencyCode: 'MAD' },
              },
              priceAfterAllDiscountsBeforeTaxesSet: {
                shopMoney: { amount: '289.8000', currencyCode: 'MAD' },
              },
            },
          ],
          pageInfo: { hasNextPage: false },
        },
      },
    });
    const adapter = new ShopifyFulfillmentAdapter({
      graphqlForUser,
    } as unknown as ShopifyConnectionService);

    const result = await adapter.fetchOrderProducts(
      'user-id',
      'gid://shopify/Order/42',
    );

    expect(result.complete).toBe(true);
    expect(result.products[0]).toEqual(
      expect.objectContaining({
        title: 'Leather bag',
        quantity: 2,
        unitPrice: '149.9000',
        totalPrice: '289.8000',
      }),
    );
    expect(graphqlForUser).toHaveBeenCalledWith(
      'user-id',
      expect.stringContaining('lineItems(first: 250)'),
      { id: 'gid://shopify/Order/42' },
    );
  });

  it('maps YouCan order variants with quantities and prices', async () => {
    const connection = {
      getJsonForUser: jest.fn().mockResolvedValue({
        data: {
          id: 'youcan-order-id',
          ref: '#100',
          currency: 'mad',
          variants: [
            {
              id: 'line-1',
              product_id: 'product-1',
              product_variant_id: 'variant-1',
              product_name: 'Sneakers',
              sku: 'SHOE-1',
              quantity: '2',
              price: '75.25',
            },
          ],
        },
      }),
      getStoreCurrency: jest.fn().mockResolvedValue('MAD'),
    };
    const adapter = new YouCanFulfillmentAdapter(
      connection as unknown as YouCanConnectionService,
    );

    const result = await adapter.fetchOrderProducts(
      'user-id',
      'youcan-order-id',
    );

    expect(result.products[0]).toEqual(
      expect.objectContaining({
        productId: 'product-1',
        variantId: 'variant-1',
        quantity: 2,
        unitPrice: '75.2500',
        totalPrice: '150.5000',
      }),
    );
  });

  it('maps Lightfunnels variant and order-bump snapshots', async () => {
    const graphqlForUser = jest.fn().mockResolvedValue({
      orders: {
        edges: [
          {
            node: {
              id: 'lightfunnels-order-id',
              name: '#200',
              currency: 'mad',
              items: [
                {
                  __typename: 'VariantSnapshot',
                  id: 'snapshot-1',
                  variant_id: 'variant-1',
                  title: 'Watch',
                  sku: 'WATCH-1',
                  price: 99.9,
                },
                {
                  __typename: 'OrderBumpSnapshot',
                  id: 'snapshot-2',
                  product_id: 'product-2',
                  title: 'Gift box',
                  sku: 'BOX-1',
                  price: 10,
                },
              ],
            },
          },
        ],
      },
    });
    const adapter = new LightfunnelsFulfillmentAdapter({
      graphqlForUser,
    } as unknown as LightfunnelsConnectionService);

    const result = await adapter.fetchOrderProducts(
      'user-id',
      'lightfunnels-order-id',
    );

    expect(result.products).toHaveLength(2);
    expect(result.products[0]).toEqual(
      expect.objectContaining({
        variantId: 'variant-1',
        unitPrice: '99.9000',
      }),
    );
    expect(result.products[1]).toEqual(
      expect.objectContaining({
        productId: 'product-2',
        unitPrice: '10.0000',
      }),
    );
    expect(graphqlForUser).toHaveBeenCalledWith(
      'user-id',
      expect.stringContaining('ZomaalLightfunnelsOrderProducts'),
      { query: 'id:lightfunnels-order-id' },
      'orders',
    );
  });
});
