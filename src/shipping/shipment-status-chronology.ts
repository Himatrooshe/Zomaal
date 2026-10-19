import { ShippingShipmentStatus } from '@prisma/client';

export const TERMINAL_SHIPMENT_STATUSES: ShippingShipmentStatus[] = [
  ShippingShipmentStatus.DELIVERED,
  ShippingShipmentStatus.CANCELLED,
  ShippingShipmentStatus.REFUSED,
  ShippingShipmentStatus.RETURNED_TO_SELLER,
  ShippingShipmentStatus.RETURNED_TO_STOCK,
  ShippingShipmentStatus.RETURNED_TO_WAREHOUSE,
  ShippingShipmentStatus.RETURN_INSPECTION,
];
const terminal = new Set(TERMINAL_SHIPMENT_STATUSES);

export function staleShipmentStatus(
  previous: {
    normalizedStatus: ShippingShipmentStatus;
    providerUpdatedAt?: Date | null;
  } | null,
  next: ShippingShipmentStatus,
  providerUpdatedAt?: Date | null,
): boolean {
  if (!previous) return false;
  if (
    providerUpdatedAt &&
    previous.providerUpdatedAt &&
    (providerUpdatedAt < previous.providerUpdatedAt ||
      (providerUpdatedAt.getTime() === previous.providerUpdatedAt.getTime() &&
        next !== previous.normalizedStatus))
  )
    return true;
  // A generic progress refresh cannot reopen a terminal parcel. A genuine
  // later terminal correction (e.g. Returned -> Delivered) remains possible.
  return terminal.has(previous.normalizedStatus) && !terminal.has(next);
}

export function terminalRegressionFilter(next: ShippingShipmentStatus) {
  return terminal.has(next)
    ? {}
    : { normalizedStatus: { notIn: TERMINAL_SHIPMENT_STATUSES } };
}
