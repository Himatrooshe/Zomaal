import { BadGatewayException } from '@nestjs/common';
import { EcommerceOrderStatus, EcommercePaymentStatus } from '@prisma/client';
import type { LightfunnelsConnectionService } from '../lightfunnels/lightfunnels-connection.service';
import { LightfunnelsRevenueAdapter } from './lightfunnels-revenue.adapter';

describe('LightfunnelsRevenueAdapter', () => {
  it('normalizes paid orders and excludes test orders', async () => {
    const graphqlForUser = jest.fn().mockResolvedValue({
      orders: {
        edges: [
          {
            cursor: 'cursor-1',
            node: {
              id: 'order-id',
              name: '#1001',
              created_at: '2026-07-18T10:00:00.000Z',
              updated_at: '2026-07-19T10:00:00.000Z',
              cancelled_at: null,
              financial_status: 'partially_refunded',
              fulfillment_status: 'fulfilled',
              discount_value: '10',
              subtotal: '100',
              shipping: '5',
              total: '105',
              refunded_amount: '20',
              net_payment: '85',
              currency: 'mad',
              test: false,
              items: [{ __typename: 'OrderItem' }],
            },
          },
          {
            cursor: 'cursor-2',
            node: {
              id: 'test-order',
              test: true,
            },
          },
        ],
        pageInfo: { hasNextPage: true, endCursor: 'cursor-2' },
      },
    });
    const adapter = new LightfunnelsRevenueAdapter({
      graphqlForUser,
    } as unknown as LightfunnelsConnectionService);

    const result = await adapter.fetchOrdersPage('user-id', null);

    expect(result).toEqual({
      orders: [
        expect.objectContaining({
          externalOrderId: 'order-id',
          orderName: '#1001',
          status: EcommerceOrderStatus.OPEN,
          financialStatus: EcommercePaymentStatus.PARTIALLY_REFUNDED,
          fulfillmentStatus: 'fulfilled',
          currency: 'MAD',
          itemCount: 1,
          grossSales: '100.0000',
          discounts: '10.0000',
          refunds: '20.0000',
          netSales: '70.0000',
          shipping: '5.0000',
          tax: '10.0000',
          totalCollected: '85.0000',
        }),
      ],
      hasNextPage: true,
      endCursor: 'cursor-2',
    });
    expect(graphqlForUser).toHaveBeenCalledWith(
      'user-id',
      expect.stringContaining('query ZomaalLightfunnelsOrders'),
      {
        first: 25,
        after: null,
        query: 'order_by:id order_dir:asc',
      },
      'orders',
    );
  });

  it('does not count pending totals as collected revenue', async () => {
    const adapter = new LightfunnelsRevenueAdapter({
      graphqlForUser: jest.fn().mockResolvedValue({
        orders: {
          edges: [
            {
              cursor: 'cursor-1',
              node: {
                id: 'order-id',
                name: '#1002',
                created_at: 1784368800,
                updated_at: 1784368800,
                cancelled_at: 1784368800,
                financial_status: 'pending',
                fulfillment_status: null,
                discount_value: 0,
                subtotal: 100,
                shipping: 0,
                total: 100,
                refunded_amount: 0,
                net_payment: 100,
                currency: 'USD',
                test: false,
                items: [],
              },
            },
          ],
          pageInfo: { hasNextPage: false, endCursor: null },
        },
      }),
    } as unknown as LightfunnelsConnectionService);

    const result = await adapter.fetchOrdersPage('user-id', null);

    expect(result.orders[0]).toEqual(
      expect.objectContaining({
        status: EcommerceOrderStatus.CANCELLED,
        financialStatus: EcommercePaymentStatus.PENDING,
        totalCollected: '0.0000',
      }),
    );
  });

  it('rejects a missing pagination cursor when another page exists', async () => {
    const adapter = new LightfunnelsRevenueAdapter({
      graphqlForUser: jest.fn().mockResolvedValue({
        orders: {
          edges: [],
          pageInfo: { hasNextPage: true, endCursor: null },
        },
      }),
    } as unknown as LightfunnelsConnectionService);

    await expect(
      adapter.fetchOrdersPage('user-id', null),
    ).rejects.toBeInstanceOf(BadGatewayException);
  });
});
