import { NotFoundException } from '@nestjs/common';
import { EcommerceOrderTimelineService } from './ecommerce-order-timeline.service';

describe('Order timeline store scope', () => {
  function setup() {
    const findFirst = jest.fn().mockResolvedValue(null);
    const findMany = jest.fn().mockResolvedValue([]);
    const requireStore = jest.fn().mockResolvedValue({ id: 'active-store' });
    const service = new EcommerceOrderTimelineService(
      {
        ecommerceOrder: { findFirst },
        ecommerceOrderEvent: { findMany },
      } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      { requireStore } as never,
    );
    return { service, findFirst, findMany, requireStore };
  }

  it('rejects an order outside the resolved active store before reading events', async () => {
    const { service, findFirst, findMany, requireStore } = setup();
    await expect(
      service.getTimeline('owner', 'other-store-order', false),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(requireStore).toHaveBeenCalledWith('owner');
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'other-store-order',
          connection: { storeId: 'active-store' },
        },
      }),
    );
    expect(findMany).not.toHaveBeenCalled();
  });

  it('allows an authorized staff user to read cached events in their resolved store', async () => {
    const { service, findFirst, findMany, requireStore } = setup();
    const event = {
      id: 'event',
      type: 'ORDER_CREATED',
      title: 'Created',
      occurredAt: new Date(),
      createdAt: new Date(),
      metadata: null,
      synthetic: false,
    };
    findFirst.mockResolvedValue({
      id: 'order',
      externalOrderId: 'MANUAL-test',
      connection: { platform: 'MANUAL' },
      events: [event],
    });
    findMany.mockResolvedValue([event]);
    const result = await service.getTimeline('staff', 'order', false);
    expect(requireStore).toHaveBeenCalledWith('staff');
    expect(result).toMatchObject({ orderId: 'order', platform: 'MANUAL' });
  });
});
