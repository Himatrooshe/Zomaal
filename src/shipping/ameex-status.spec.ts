import { ShippingShipmentStatus } from '@prisma/client';
import { normalizeAmeexStatus } from './ameex-status';

describe('Ameex status normalization', () => {
  it.each([
    ['IN_PROGRESS', null, ShippingShipmentStatus.IN_TRANSIT],
    ['DISTRIBUTION', null, ShippingShipmentStatus.OUT_FOR_DELIVERY],
    ['DELIVERED', null, ShippingShipmentStatus.DELIVERED],
    ['IN_PROGRESS', 'POSTPONED', ShippingShipmentStatus.POSTPONED],
    ['IN_PROGRESS', 'NO_ANSWER_TEAM', ShippingShipmentStatus.UNREACHABLE],
    ['NEW_PARCEL', null, ShippingShipmentStatus.PENDING],
    ['WAITING_PICKUP', null, ShippingShipmentStatus.PICKUP_PENDING],
    ['IN_SHIPMENT', null, ShippingShipmentStatus.IN_TRANSIT],
    ['IN_PROGRESS', 'REFUSE', ShippingShipmentStatus.REFUSED],
    ['IN_PROGRESS', 'PREPAR_RETURN', ShippingShipmentStatus.RETURN_PENDING],
  ])('maps %s / %s', (status, subStatus, expected) => {
    expect(normalizeAmeexStatus(status, subStatus)).toBe(expected);
  });
});
