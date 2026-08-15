import { ShippingShipmentStatus } from '@prisma/client';
import { normalizeQuickLivraisonStatus } from './quicklivraison-status';

describe('normalizeQuickLivraisonStatus', () => {
  it.each([
    ['NEW_PARCEL', ShippingShipmentStatus.PENDING],
    ['PROGRAMMER', ShippingShipmentStatus.CONFIRMED],
    ['DISTRIBUTION', ShippingShipmentStatus.IN_TRANSIT],
    ['IN_PROGRESS', ShippingShipmentStatus.OUT_FOR_DELIVERY],
    ['POSTPONED', ShippingShipmentStatus.POSTPONED],
    ['NOANSWER', ShippingShipmentStatus.UNREACHABLE],
    ['DELIVERED', ShippingShipmentStatus.DELIVERED],
    ['REFUSE', ShippingShipmentStatus.REFUSED],
    ['CANCELED', ShippingShipmentStatus.CANCELLED],
    ['RETURNED', ShippingShipmentStatus.RETURNED_TO_WAREHOUSE],
    ['RETURNED_CLIENT', ShippingShipmentStatus.RETURNED_TO_SELLER],
    ['Livré', ShippingShipmentStatus.DELIVERED],
    ['Reporté', ShippingShipmentStatus.POSTPONED],
  ])('maps %s to %s', (providerStatus, expected) => {
    expect(normalizeQuickLivraisonStatus(providerStatus)).toBe(expected);
  });

  it('prefers a recognized secondary status', () => {
    expect(normalizeQuickLivraisonStatus('IN_PROGRESS', 'POSTPONED')).toBe(
      ShippingShipmentStatus.POSTPONED,
    );
  });

  it('falls back to the primary status when the secondary value is unknown', () => {
    expect(normalizeQuickLivraisonStatus('DELIVERED', 'provider wording')).toBe(
      ShippingShipmentStatus.DELIVERED,
    );
  });

  it('returns UNKNOWN for an undocumented value', () => {
    expect(normalizeQuickLivraisonStatus('something new')).toBe(
      ShippingShipmentStatus.UNKNOWN,
    );
  });
});
