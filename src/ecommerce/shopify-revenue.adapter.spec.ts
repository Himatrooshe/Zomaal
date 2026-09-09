import { EcommerceOrderStatus, EcommercePaymentStatus } from '@prisma/client';
import type { ShopifyConnectionService } from '../shopify/shopify-connection.service';
import { ShopifyRevenueAdapter } from './shopify-revenue.adapter';

describe('ShopifyRevenueAdapter', () => {
  it('normalizes Shopify financials, with null customer fields when the order has no shipping address', async () => {
    const graphqlForUser = jest.fn().mockResolvedValue({
      orders: {
        nodes: [
          {
            id: 'gid://shopify/Order/1',
            name: '#1001',
            closed: false,
            createdAt: '2026-07-18T10:00:00.000Z',
            updatedAt: '2026-07-19T10:00:00.000Z',
            processedAt: '2026-07-18T10:01:00.000Z',
            cancelledAt: null,
            displayFinancialStatus: 'PARTIALLY_REFUNDED',
            displayFulfillmentStatus: 'FULFILLED',
            currentSubtotalLineItemsQuantity: 2,
            subtotalPriceSet: {
              shopMoney: { amount: '90.00', currencyCode: 'MAD' },
            },
            currentSubtotalPriceSet: {
              shopMoney: { amount: '70.00', currencyCode: 'MAD' },
            },
            totalDiscountsSet: {
              shopMoney: { amount: '10.00', currencyCode: 'MAD' },
            },
            currentShippingPriceSet: {
              shopMoney: { amount: '5.00', currencyCode: 'MAD' },
            },
            currentTotalTaxSet: {
              shopMoney: { amount: '0.00', currencyCode: 'MAD' },
            },
            netPaymentSet: {
              shopMoney: { amount: '75.00', currencyCode: 'MAD' },
            },
          },
        ],
        pageInfo: { hasNextPage: false, endCursor: null },
      },
    });
    const adapter = new ShopifyRevenueAdapter({
      graphqlForUser,
    } as unknown as ShopifyConnectionService);

    const result = await adapter.fetchOrdersPage(
      'user-id',
      null,
      new Date('2026-07-01T00:00:00.000Z'),
      new Date('2026-07-19T00:00:00.000Z'),
    );

    expect(graphqlForUser).toHaveBeenCalledWith(
      'user-id',
      expect.stringContaining('query ZomaalRevenueOrders'),
      {
        first: 50,
        after: null,
        query:
          "updated_at:>='2026-07-01T00:00:00.000Z' updated_at:<='2026-07-19T00:00:00.000Z'",
      },
    );
    expect(result.orders).toEqual([
      expect.objectContaining({
        externalOrderId: 'gid://shopify/Order/1',
        orderName: '#1001',
        status: EcommerceOrderStatus.OPEN,
        financialStatus: EcommercePaymentStatus.PARTIALLY_REFUNDED,
        currency: 'MAD',
        grossSales: '100.0000',
        discounts: '10.0000',
        refunds: '20.0000',
        netSales: '70.0000',
        totalCollected: '75.0000',
        customerName: null,
        customerPhone: null,
      }),
    ]);
  });

  it('extracts customer name/phone from the shipping address for the Customer module, order-level phone as fallback', async () => {
    const graphqlForUser = jest.fn().mockResolvedValue({
      orders: {
        nodes: [
          {
            id: 'gid://shopify/Order/2',
            name: '#1002',
            closed: false,
            createdAt: '2026-07-18T10:00:00.000Z',
            updatedAt: '2026-07-19T10:00:00.000Z',
            processedAt: '2026-07-18T10:01:00.000Z',
            cancelledAt: null,
            displayFinancialStatus: 'PAID',
            displayFulfillmentStatus: 'FULFILLED',
            currentSubtotalLineItemsQuantity: 1,
            subtotalPriceSet: {
              shopMoney: { amount: '50.00', currencyCode: 'MAD' },
            },
            currentSubtotalPriceSet: {
              shopMoney: { amount: '50.00', currencyCode: 'MAD' },
            },
            totalDiscountsSet: {
              shopMoney: { amount: '0.00', currencyCode: 'MAD' },
            },
            currentShippingPriceSet: {
              shopMoney: { amount: '0.00', currencyCode: 'MAD' },
            },
            currentTotalTaxSet: {
              shopMoney: { amount: '0.00', currencyCode: 'MAD' },
            },
            netPaymentSet: {
              shopMoney: { amount: '50.00', currencyCode: 'MAD' },
            },
            phone: '+212600000099',
            shippingAddress: {
              city: 'Casablanca',
              name: 'Ahmed Alaoui',
              phone: '+212611111111',
            },
          },
        ],
        pageInfo: { hasNextPage: false, endCursor: null },
      },
    });
    const adapter = new ShopifyRevenueAdapter({
      graphqlForUser,
    } as unknown as ShopifyConnectionService);

    const result = await adapter.fetchOrdersPage(
      'user-id',
      null,
      null,
      new Date(),
    );

    expect(result.orders[0]).toEqual(
      expect.objectContaining({
        customerName: 'Ahmed Alaoui',
        // Shipping-address phone takes precedence over the order-level one.
        customerPhone: '+212611111111',
      }),
    );
  });
});
