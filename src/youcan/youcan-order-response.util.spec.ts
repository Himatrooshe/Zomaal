import { unwrapYouCanOrder } from './youcan-order-response.util';

describe('unwrapYouCanOrder', () => {
  it('accepts the resource shape returned by YouCan GET /orders/{id}', () => {
    const order = { id: 'order-1', variants: [] };

    expect(unwrapYouCanOrder({ ...order })).toEqual(order);
  });

  it.each(['order', 'data'] as const)(
    'accepts an order wrapped in %s',
    (wrapper) => {
      const order = { id: 'order-1' };

      expect(unwrapYouCanOrder({ [wrapper]: order })).toEqual(order);
    },
  );

  it('rejects responses without an order identifier', () => {
    expect(unwrapYouCanOrder({ message: 'not found' })).toBeNull();
    expect(unwrapYouCanOrder(null)).toBeNull();
  });
});
