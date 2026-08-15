import { ShippingShipmentStatus } from '@prisma/client';
import { normalizeForceLogStatus } from './forcelog-status';

describe('normalizeForceLogStatus', () => {
  it.each([
    ['NEW_PARCEL', ShippingShipmentStatus.PENDING],
    ['Ramassé', ShippingShipmentStatus.PICKED_UP],
    ['En cours de livraison', ShippingShipmentStatus.OUT_FOR_DELIVERY],
    ['Livré', ShippingShipmentStatus.DELIVERED],
    ['Refusé', ShippingShipmentStatus.REFUSED],
    ['Annulé', ShippingShipmentStatus.CANCELLED],
    ['Injoignable', ShippingShipmentStatus.UNREACHABLE],
    ['Retour en cours', ShippingShipmentStatus.RETURN_IN_TRANSIT],
    ['Retourné à l’expéditeur', ShippingShipmentStatus.RETURNED_TO_SELLER],
  ])('normalizes %s', (providerStatus, expected) => {
    expect(normalizeForceLogStatus(providerStatus)).toBe(expected);
  });

  it('uses UNKNOWN for an unmapped provider value', () => {
    expect(normalizeForceLogStatus('provider-added-status')).toBe(
      ShippingShipmentStatus.UNKNOWN,
    );
  });
});
