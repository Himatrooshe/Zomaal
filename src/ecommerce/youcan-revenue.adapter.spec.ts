import { BadGatewayException } from '@nestjs/common';
import { EcommerceOrderStatus, EcommercePaymentStatus } from '@prisma/client';
import type { YouCanConnectionService } from '../youcan/youcan-connection.service';
import { YouCanRevenueAdapter } from './youcan-revenue.adapter';

describe('YouCanRevenueAdapter', () => {
  it('normalizes paid YouCan order financials without customer data', async () => {
    const getJsonForUser = jest.fn().mockResolvedValue({
      data: [
        {
          id: '72aa7882-3898-49a8-87a2-506af3dd7320',
          ref: '021',
          vat: 10,
          total: 300,
          status_object: { slug: 'closed' },
          payment: { status_text: 'paid' },
          shipping: { status_text: 'fulfilled', price: 20 },
          shipping_status: 'fulfilled',
          created_at: '2026-07-18T10:00:00.000Z',
          updated_at: '2026-07-19T10:00:00.000Z',
          variants: [
            { id: 'line-1', price: 200, quantity: 1 },
            { id: 'line-2', price: 100, quantity: 1 },
          ],
          refunds: [{ amount: 50 }],
        },
      ],
      meta: {
        pagination: {
          current_page: 1,
          total_pages: 2,
          links: { next: 'https://api.youcan.shop/orders?page=2' },
        },
      },
    });
    const getStoreCurrency = jest.fn().mockResolvedValue('MAD');
    const adapter = new YouCanRevenueAdapter({
      getJsonForUser,
      getStoreCurrency,
    } as unknown as YouCanConnectionService);

    const result = await adapter.fetchOrdersPage(
      'user-id',
      null,
      null,
      new Date('2026-07-20T00:00:00.000Z'),
    );

    expect(getJsonForUser).toHaveBeenCalledWith('user-id', '/orders', {
      page: 1,
      limit: 50,
      sort_field: 'created_at',
      sort_order: 'asc',
      include: 'payment,shipping,discount,refunds,variants',
    });
    expect(result).toEqual({
      orders: [
        expect.objectContaining({
          externalOrderId: '72aa7882-3898-49a8-87a2-506af3dd7320',
          orderName: '021',
          status: EcommerceOrderStatus.CLOSED,
          financialStatus: EcommercePaymentStatus.PARTIALLY_REFUNDED,
          fulfillmentStatus: 'fulfilled',
          currency: 'MAD',
          itemCount: 2,
          grossSales: '300.0000',
          discounts: '30.0000',
          refunds: '50.0000',
          netSales: '220.0000',
          shipping: '20.0000',
          tax: '10.0000',
          totalCollected: '250.0000',
        }),
      ],
      hasNextPage: true,
      endCursor: '2',
    });
    expect(JSON.stringify(result)).not.toContain('customer');
  });

  it('does not count pending order totals as collected revenue', async () => {
    const adapter = new YouCanRevenueAdapter({
      getJsonForUser: jest.fn().mockResolvedValue({
        data: [
          {
            id: 'order-id',
            ref: '022',
            vat: 0,
            total: 100,
            status: 1,
            payment: { status_text: 'pending' },
            shipping: { price: 0 },
            created_at: '2026-07-18T10:00:00.000Z',
            updated_at: '2026-07-18T10:00:00.000Z',
            variants: [{ price: 100, quantity: 1 }],
            refunds: [],
          },
        ],
        meta: {
          pagination: { current_page: 1, total_pages: 1, links: {} },
        },
      }),
      getStoreCurrency: jest.fn().mockResolvedValue('MAD'),
    } as unknown as YouCanConnectionService);

    const result = await adapter.fetchOrdersPage(
      'user-id',
      null,
      null,
      new Date(),
    );

    expect(result.orders[0]).toEqual(
      expect.objectContaining({
        financialStatus: EcommercePaymentStatus.PENDING,
        totalCollected: '0.0000',
      }),
    );
  });

  it('rejects malformed pagination cursors before calling YouCan', async () => {
    const getJsonForUser = jest.fn();
    const adapter = new YouCanRevenueAdapter({
      getJsonForUser,
      getStoreCurrency: jest.fn(),
    } as unknown as YouCanConnectionService);

    await expect(
      adapter.fetchOrdersPage('user-id', 'not-a-page', null, new Date()),
    ).rejects.toBeInstanceOf(BadGatewayException);
    expect(getJsonForUser).not.toHaveBeenCalled();
  });
});
