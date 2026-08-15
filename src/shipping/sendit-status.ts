import { ShippingShipmentStatus } from '@prisma/client';

const DELIVERY_STATUS_MAP: Record<string, ShippingShipmentStatus> = {
  PENDING: ShippingShipmentStatus.PENDING,
  TO_PREPARE: ShippingShipmentStatus.CONFIRMED,
  NEW_DESTINATION: ShippingShipmentStatus.CONFIRMED,
  SCHEDULED: ShippingShipmentStatus.CONFIRMED,
  TO_PICKUP: ShippingShipmentStatus.PICKUP_PENDING,
  PICKEDUP: ShippingShipmentStatus.PICKED_UP,
  WAREHOUSE: ShippingShipmentStatus.AT_WAREHOUSE,
  TRANSIT: ShippingShipmentStatus.IN_TRANSIT,
  DISTRIBUTED: ShippingShipmentStatus.OUT_FOR_DELIVERY,
  DELIVERING: ShippingShipmentStatus.OUT_FOR_DELIVERY,
  POSTPONED: ShippingShipmentStatus.POSTPONED,
  UNREACHABLE: ShippingShipmentStatus.UNREACHABLE,
  DELIVERED: ShippingShipmentStatus.DELIVERED,
  CANCELED: ShippingShipmentStatus.CANCELLED,
  CANCELLED: ShippingShipmentStatus.CANCELLED,
  REJECTED: ShippingShipmentStatus.REFUSED,
};

const RETURN_STATUS_MAP: Record<string, ShippingShipmentStatus> = {
  RETOUR_PENDING: ShippingShipmentStatus.RETURN_PENDING,
  RETURN_PENDING: ShippingShipmentStatus.RETURN_PENDING,
  TORETURN: ShippingShipmentStatus.RETURN_IN_TRANSIT,
  RETURN_WAREHOUSE: ShippingShipmentStatus.RETURNED_TO_WAREHOUSE,
  RETURN_TOCHECK: ShippingShipmentStatus.RETURN_INSPECTION,
  RETURN_STOCK: ShippingShipmentStatus.RETURNED_TO_STOCK,
  RETURN_SELLER: ShippingShipmentStatus.RETURNED_TO_SELLER,
};

export function normalizeSenditStatus(
  providerStatus: string | null | undefined,
  providerReturnStatus?: string | null,
): ShippingShipmentStatus {
  const returnStatus = normalizeCode(providerReturnStatus);
  if (returnStatus && RETURN_STATUS_MAP[returnStatus]) {
    return RETURN_STATUS_MAP[returnStatus];
  }

  const deliveryStatus = normalizeCode(providerStatus);
  return deliveryStatus
    ? (DELIVERY_STATUS_MAP[deliveryStatus] ?? ShippingShipmentStatus.UNKNOWN)
    : ShippingShipmentStatus.UNKNOWN;
}

function normalizeCode(value: string | null | undefined): string | null {
  const normalized = value?.trim().toUpperCase();
  return normalized || null;
}
