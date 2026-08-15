import { ShippingShipmentStatus } from '@prisma/client';
import { normalizeSenditStatus } from './sendit-status';

describe('normalizeSenditStatus', () => {
  it.each([
    ['PENDING', ShippingShipmentStatus.PENDING],
    ['TO_PREPARE', ShippingShipmentStatus.CONFIRMED],
    ['NEW_DESTINATION', ShippingShipmentStatus.CONFIRMED],
    ['SCHEDULED', ShippingShipmentStatus.CONFIRMED],
    ['TO_PICKUP', ShippingShipmentStatus.PICKUP_PENDING],
    ['PICKEDUP', ShippingShipmentStatus.PICKED_UP],
    ['WAREHOUSE', ShippingShipmentStatus.AT_WAREHOUSE],
    ['TRANSIT', ShippingShipmentStatus.IN_TRANSIT],
    ['DISTRIBUTED', ShippingShipmentStatus.OUT_FOR_DELIVERY],
    ['DELIVERING', ShippingShipmentStatus.OUT_FOR_DELIVERY],
    ['POSTPONED', ShippingShipmentStatus.POSTPONED],
    ['UNREACHABLE', ShippingShipmentStatus.UNREACHABLE],
    ['DELIVERED', ShippingShipmentStatus.DELIVERED],
    ['CANCELED', ShippingShipmentStatus.CANCELLED],
    ['REJECTED', ShippingShipmentStatus.REFUSED],
  ])('maps Sendit delivery status %s', (provider, normalized) => {
    expect(normalizeSenditStatus(provider)).toBe(normalized);
  });

  it.each([
    ['RETOUR_PENDING', ShippingShipmentStatus.RETURN_PENDING],
    ['TORETURN', ShippingShipmentStatus.RETURN_IN_TRANSIT],
    ['RETURN_WAREHOUSE', ShippingShipmentStatus.RETURNED_TO_WAREHOUSE],
    ['RETURN_TOCHECK', ShippingShipmentStatus.RETURN_INSPECTION],
    ['RETURN_STOCK', ShippingShipmentStatus.RETURNED_TO_STOCK],
    ['RETURN_SELLER', ShippingShipmentStatus.RETURNED_TO_SELLER],
  ])('gives return status %s precedence', (providerReturn, normalized) => {
    expect(normalizeSenditStatus('REJECTED', providerReturn)).toBe(normalized);
  });

  it('normalizes casing and safely preserves unknown provider states', () => {
    expect(normalizeSenditStatus(' delivered ')).toBe(
      ShippingShipmentStatus.DELIVERED,
    );
    expect(normalizeSenditStatus('SOME_FUTURE_STATUS')).toBe(
      ShippingShipmentStatus.UNKNOWN,
    );
  });
});
