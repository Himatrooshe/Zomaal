import { EcommerceOrderStatus, EcommercePaymentStatus } from '@prisma/client';
import type { ShopifyConnectionService } from '../shopify/shopify-connection.service';
import { ShopifyRevenueAdapter } from './shopify-revenue.adapter';

describe('ShopifyRevenueAdapter', () => {
  it('normalizes Shopify financials without customer payloads', async () => {
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
      }),
    ]);
    expect(JSON.stringify(result)).not.toContain('customer');
  });
});
