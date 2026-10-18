import { YouCanConnectionService } from '../youcan/youcan-connection.service';
import { YouCanOrderTimelineAdapter } from './youcan-order-timeline.adapter';

describe('YouCanOrderTimelineAdapter', () => {
  it('maps events from YouCan’s bare order detail response', async () => {
    const getJsonForUser = jest.fn().mockResolvedValue({
      id: 'order-1',
      payment_status_new: 'Paid',
      shipping_status: 'Shipped',
      updated_at: '2026-10-18T10:00:00.000Z',
    });
    const adapter = new YouCanOrderTimelineAdapter({
      getJsonForUser,
    } as unknown as YouCanConnectionService);

    const events = await adapter.fetchEvents('user-1', 'order-1');

    expect(events).toHaveLength(2);
    expect(events.map((event) => event.source)).toEqual(['YOUCAN', 'YOUCAN']);
    expect(getJsonForUser).toHaveBeenCalledWith('user-1', '/orders/order-1', {
      include: 'payment,shipping',
    });
  });
});
