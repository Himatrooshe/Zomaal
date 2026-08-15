import { ShippingShipmentStatus } from '@prisma/client';

const STATUS_MAP: Record<string, ShippingShipmentStatus> = {
  NEW: ShippingShipmentStatus.PENDING,
  NEW_PARCEL: ShippingShipmentStatus.PENDING,
  NOUVEAU_COLIS: ShippingShipmentStatus.PENDING,
  PENDING: ShippingShipmentStatus.PENDING,
  PROGRAMMER: ShippingShipmentStatus.CONFIRMED,
  PROGRAMME: ShippingShipmentStatus.CONFIRMED,
  SCHEDULED: ShippingShipmentStatus.CONFIRMED,
  PICKED_UP: ShippingShipmentStatus.PICKED_UP,
  RAMASSE: ShippingShipmentStatus.PICKED_UP,
  AT_WAREHOUSE: ShippingShipmentStatus.AT_WAREHOUSE,
  ENTREPOT: ShippingShipmentStatus.AT_WAREHOUSE,
  DISTRIBUTION: ShippingShipmentStatus.IN_TRANSIT,
  DISTRIBUE: ShippingShipmentStatus.IN_TRANSIT,
  IN_TRANSIT: ShippingShipmentStatus.IN_TRANSIT,
  IN_PROGRESS: ShippingShipmentStatus.OUT_FOR_DELIVERY,
  EN_COURS: ShippingShipmentStatus.OUT_FOR_DELIVERY,
  OUT_FOR_DELIVERY: ShippingShipmentStatus.OUT_FOR_DELIVERY,
  POSTPONED: ShippingShipmentStatus.POSTPONED,
  REPORTE: ShippingShipmentStatus.POSTPONED,
  NOANSWER: ShippingShipmentStatus.UNREACHABLE,
  NO_ANSWER: ShippingShipmentStatus.UNREACHABLE,
  UNREACHABLE: ShippingShipmentStatus.UNREACHABLE,
  INJOIGNABLE: ShippingShipmentStatus.UNREACHABLE,
  DELIVERED: ShippingShipmentStatus.DELIVERED,
  LIVRE: ShippingShipmentStatus.DELIVERED,
  REFUSE: ShippingShipmentStatus.REFUSED,
  REFUSED: ShippingShipmentStatus.REFUSED,
  CANCELED: ShippingShipmentStatus.CANCELLED,
  CANCELLED: ShippingShipmentStatus.CANCELLED,
  ANNULE: ShippingShipmentStatus.CANCELLED,
  RETURNED: ShippingShipmentStatus.RETURNED_TO_WAREHOUSE,
  RETOURNE: ShippingShipmentStatus.RETURNED_TO_WAREHOUSE,
  RETURNED_CLIENT: ShippingShipmentStatus.RETURNED_TO_SELLER,
  RETOURNE_CLIENT: ShippingShipmentStatus.RETURNED_TO_SELLER,
};

export function normalizeQuickLivraisonStatus(
  status: string | null | undefined,
  secondaryStatus?: string | null,
): ShippingShipmentStatus {
  return (
    normalizedValue(secondaryStatus) ??
    normalizedValue(status) ??
    ShippingShipmentStatus.UNKNOWN
  );
}

function normalizedValue(
  value: string | null | undefined,
): ShippingShipmentStatus | undefined {
  if (!value?.trim()) {
    return undefined;
  }

  const key = value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

  return STATUS_MAP[key];
}
