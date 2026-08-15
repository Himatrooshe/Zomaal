import { Prisma, ShippingShipmentStatus } from '@prisma/client';
import {
  normalizeOzoneExpressStatus,
  ozoneFeeForStatus,
} from './ozoneexpress-status';

describe('OzoneExpress status mapping', () => {
  it.each([
    ['Nouveau Colis', ShippingShipmentStatus.PENDING],
    ['Ramassé', ShippingShipmentStatus.PICKED_UP],
    ['En cours de livraison', ShippingShipmentStatus.OUT_FOR_DELIVERY],
    ['Livré', ShippingShipmentStatus.DELIVERED],
    ['Refusé', ShippingShipmentStatus.REFUSED],
    ['Retour en cours', ShippingShipmentStatus.RETURN_IN_TRANSIT],
  ])('normalizes %s', (value, expected) => {
    expect(normalizeOzoneExpressStatus(value)).toBe(expected);
  });

  it('selects the outcome-specific provider charge', () => {
    const prices = {
      deliveredPrice: new Prisma.Decimal(35),
      returnedPrice: new Prisma.Decimal(0),
      refusedPrice: new Prisma.Decimal(10),
    };
    expect(
      ozoneFeeForStatus(ShippingShipmentStatus.DELIVERED, prices)?.toString(),
    ).toBe('35');
    expect(
      ozoneFeeForStatus(ShippingShipmentStatus.REFUSED, prices)?.toString(),
    ).toBe('10');
    expect(
      ozoneFeeForStatus(ShippingShipmentStatus.PENDING, prices),
    ).toBeNull();
  });
});
