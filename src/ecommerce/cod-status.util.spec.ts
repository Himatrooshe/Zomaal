import { EcommercePaymentStatus, ShippingShipmentStatus } from '@prisma/client';
import {
  isCourierPaidSituation,
  nextCodStatus,
  refreshCodStatus,
} from './cod-status.util';

const base = {
  current: 'PENDING',
  financialStatus: EcommercePaymentStatus.PENDING,
  shipmentStatus: ShippingShipmentStatus.IN_TRANSIT,
  courierSituation: null,
};

describe('nextCodStatus', () => {
  it('leaves orders without cash on delivery alone', () => {
    expect(nextCodStatus({ ...base, current: null })).toBeNull();
  });

  it('stays pending while the parcel travels', () => {
    expect(nextCodStatus(base)).toBe('PENDING');
  });

  it('is collected when the courier reports the parcel paid', () => {
    expect(
      nextCodStatus({
        ...base,
        shipmentStatus: ShippingShipmentStatus.DELIVERED,
        courierSituation: 'Payé',
      }),
    ).toBe('COLLECTED');
  });

  it('is collected when the platform marks a delivered order paid', () => {
    expect(
      nextCodStatus({
        ...base,
        shipmentStatus: ShippingShipmentStatus.DELIVERED,
        financialStatus: EcommercePaymentStatus.PAID,
      }),
    ).toBe('COLLECTED');
  });

  it('does not count a platform payment before delivery', () => {
    expect(
      nextCodStatus({ ...base, financialStatus: EcommercePaymentStatus.PAID }),
    ).toBe('PENDING');
  });

  it('stays pending when delivered but not yet paid', () => {
    expect(
      nextCodStatus({
        ...base,
        shipmentStatus: ShippingShipmentStatus.DELIVERED,
      }),
    ).toBe('PENDING');
  });

  it.each([
    ShippingShipmentStatus.REFUSED,
    ShippingShipmentStatus.RETURNED_TO_SELLER,
    ShippingShipmentStatus.CANCELLED,
  ])('fails when the parcel is %s', (shipmentStatus) => {
    expect(nextCodStatus({ ...base, shipmentStatus })).toBe('FAILED');
  });

  it('keeps collected even if the parcel is later returned', () => {
    expect(
      nextCodStatus({
        ...base,
        current: 'COLLECTED',
        shipmentStatus: ShippingShipmentStatus.RETURNED_TO_SELLER,
      }),
    ).toBe('COLLECTED');
  });
});

describe('isCourierPaidSituation', () => {
  it.each(['PAID', 'paid', 'Payé', ' PAYE ', 'Réglé'])('accepts %s', (s) => {
    expect(isCourierPaidSituation(s)).toBe(true);
  });

  it.each([null, '', 'Non payé', 'At hub', 'UNPAID'])('rejects %s', (s) => {
    expect(isCourierPaidSituation(s)).toBe(false);
  });
});

describe('refreshCodStatus', () => {
  function makeDb(order: unknown) {
    return {
      ecommerceOrder: {
        findUnique: jest.fn().mockResolvedValue(order),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
  }

  it('marks a QuickLivraison parcel collected from its situation', async () => {
    const db = makeDb({
      codStatus: 'PENDING',
      financialStatus: EcommercePaymentStatus.PENDING,
      dispatch: {
        senditShipment: null,
        quickLivraisonShipment: {
          normalizedStatus: ShippingShipmentStatus.DELIVERED,
          situation: 'PAID',
        },
        forceLogShipment: null,
        ozoneExpressShipment: null,
      },
    });

    await expect(refreshCodStatus(db as never, 'order-1')).resolves.toBe(
      'COLLECTED',
    );
    expect(db.ecommerceOrder.updateMany).toHaveBeenCalledWith({
      where: { id: 'order-1', codStatus: 'PENDING' },
      data: { codStatus: 'COLLECTED' },
    });
  });

  it('writes nothing when the status is unchanged', async () => {
    const db = makeDb({
      codStatus: 'PENDING',
      financialStatus: EcommercePaymentStatus.PENDING,
      dispatch: {
        senditShipment: {
          normalizedStatus: ShippingShipmentStatus.IN_TRANSIT,
        },
        quickLivraisonShipment: null,
        forceLogShipment: null,
        ozoneExpressShipment: null,
      },
    });

    await expect(refreshCodStatus(db as never, 'order-1')).resolves.toBe(
      'PENDING',
    );
    expect(db.ecommerceOrder.updateMany).not.toHaveBeenCalled();
  });

  it('skips orders with no cash on delivery', async () => {
    const db = makeDb({
      codStatus: null,
      financialStatus: EcommercePaymentStatus.PAID,
      dispatch: null,
    });

    await expect(refreshCodStatus(db as never, 'order-1')).resolves.toBeNull();
    expect(db.ecommerceOrder.updateMany).not.toHaveBeenCalled();
  });
});
