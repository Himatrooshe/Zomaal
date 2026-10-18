import { YouCanConnectionService } from './youcan-connection.service';
import { YouCanDataService } from './youcan-data.service';

describe('YouCanDataService', () => {
  it('returns bare YouCan order details in the Zomaal data envelope', async () => {
    const order = { id: 'order-1', ref: '100', total: '250' };
    const connection = {
      getJsonForUser: jest.fn().mockResolvedValue(order),
    };
    const service = new YouCanDataService(
      connection as unknown as YouCanConnectionService,
    );

    await expect(service.getOrderDetails('user-1', 'order-1')).resolves.toEqual(
      { data: order },
    );
    expect(connection.getJsonForUser).toHaveBeenCalledWith(
      'user-1',
      '/orders/order-1',
      { include: 'payment,shipping,discount,refunds,variants' },
    );
  });
});
