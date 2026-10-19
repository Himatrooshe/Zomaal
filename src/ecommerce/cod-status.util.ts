import {
  EcommercePaymentStatus,
  Prisma,
  ShippingShipmentStatus,
} from '@prisma/client';

export const CodStatus = {
  PENDING: 'PENDING',
  COLLECTED: 'COLLECTED',
  FAILED: 'FAILED',
} as const;
export type CodStatus = (typeof CodStatus)[keyof typeof CodStatus];

// QuickLivraison `situation` / ForceLog `PAYMENT_STATUS`, accent- and
// case-insensitive. Unknown wording never counts as paid.
const COURIER_PAID_SITUATIONS = new Set(['PAID', 'PAYE', 'REGLE']);

const FAILED_SHIPMENT_STATUSES = new Set<ShippingShipmentStatus>([
  ShippingShipmentStatus.CANCELLED,
  ShippingShipmentStatus.REFUSED,
  ShippingShipmentStatus.RETURNED_TO_SELLER,
  ShippingShipmentStatus.RETURNED_TO_WAREHOUSE,
  ShippingShipmentStatus.RETURN_INSPECTION,
  ShippingShipmentStatus.RETURNED_TO_STOCK,
]);

export function isCourierPaidSituation(
  situation: string | null | undefined,
): boolean {
  if (!situation) return false;
  const normalized = situation
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toUpperCase();
  return COURIER_PAID_SITUATIONS.has(normalized);
}

/**
 * Cash on delivery is never marked by hand (client rule): it is Collected
 * when the courier reports the parcel paid, or when the platform marks the
 * order paid after delivery. Cash cannot be collected before delivery, so a
 * platform PAID alone (e.g. a prepaid order) does not count. Collected is
 * final; a refused / returned / cancelled parcel is Failed.
 */
export function nextCodStatus(input: {
  current: string | null;
  financialStatus: EcommercePaymentStatus;
  shipmentStatus: ShippingShipmentStatus | null;
  courierSituation: string | null;
}): CodStatus | null {
  if (input.current === null) return null;
  if (input.current === CodStatus.COLLECTED) return CodStatus.COLLECTED;
  if (isCourierPaidSituation(input.courierSituation)) {
    return CodStatus.COLLECTED;
  }
  if (
    input.shipmentStatus === ShippingShipmentStatus.DELIVERED &&
    input.financialStatus === EcommercePaymentStatus.PAID
  ) {
    return CodStatus.COLLECTED;
  }
  if (
    input.shipmentStatus &&
    FAILED_SHIPMENT_STATUSES.has(input.shipmentStatus)
  ) {
    return CodStatus.FAILED;
  }
  return CodStatus.PENDING;
}

/** Re-evaluates an order's COD status from its courier shipment and platform payment status. */
export async function refreshCodStatus(
  db: Pick<Prisma.TransactionClient, 'ecommerceOrder'>,
  orderId: string,
): Promise<CodStatus | null> {
  const order = await db.ecommerceOrder.findUnique({
    where: { id: orderId },
    select: {
      codStatus: true,
      financialStatus: true,
      dispatch: {
        select: {
          senditShipment: { select: { normalizedStatus: true } },
          quickLivraisonShipment: {
            select: { normalizedStatus: true, situation: true },
          },
          forceLogShipment: {
            select: { normalizedStatus: true, situation: true },
          },
          ozoneExpressShipment: { select: { normalizedStatus: true } },
        },
      },
    },
  });
  if (!order?.codStatus) return null;

  const dispatch = order.dispatch;
  const shipment: {
    normalizedStatus: ShippingShipmentStatus;
    situation?: string | null;
  } | null =
    dispatch?.senditShipment ??
    dispatch?.quickLivraisonShipment ??
    dispatch?.forceLogShipment ??
    dispatch?.ozoneExpressShipment ??
    null;
  const next = nextCodStatus({
    current: order.codStatus,
    financialStatus: order.financialStatus,
    shipmentStatus: shipment?.normalizedStatus ?? null,
    courierSituation: shipment?.situation ?? null,
  });
  if (!next || next === order.codStatus) return next;

  await db.ecommerceOrder.updateMany({
    where: { id: orderId, codStatus: order.codStatus },
    data: { codStatus: next },
  });
  return next;
}
