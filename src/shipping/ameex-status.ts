import { ShippingShipmentStatus } from '@prisma/client';

const STATUS_MAP: Record<string, ShippingShipmentStatus> = {
  NEW: ShippingShipmentStatus.PENDING,
  NEW_PARCEL: ShippingShipmentStatus.PENDING,
  DRAFT: ShippingShipmentStatus.PENDING,
  PENDING: ShippingShipmentStatus.PENDING,
  CONFIRMED: ShippingShipmentStatus.CONFIRMED,
  CONFIRMED_BY_LIVREUR: ShippingShipmentStatus.CONFIRMED,
  PICKUP_PENDING: ShippingShipmentStatus.PICKUP_PENDING,
  WAITING_PICKUP: ShippingShipmentStatus.PICKUP_PENDING,
  PICKED_UP: ShippingShipmentStatus.PICKED_UP,
  WAREHOUSE: ShippingShipmentStatus.AT_WAREHOUSE,
  RECEIVED: ShippingShipmentStatus.AT_WAREHOUSE,
  DISPOSITION: ShippingShipmentStatus.AT_WAREHOUSE,
  IN_PROGRESS: ShippingShipmentStatus.IN_TRANSIT,
  IN_SHIPMENT: ShippingShipmentStatus.IN_TRANSIT,
  SENT: ShippingShipmentStatus.IN_TRANSIT,
  TRAVELLING: ShippingShipmentStatus.IN_TRANSIT,
  DISTRIBUTION: ShippingShipmentStatus.OUT_FOR_DELIVERY,
  POSTPONED: ShippingShipmentStatus.POSTPONED,
  SCHEDULED: ShippingShipmentStatus.POSTPONED,
  NO_ANSWER: ShippingShipmentStatus.UNREACHABLE,
  NO_ANSWER_TEAM: ShippingShipmentStatus.UNREACHABLE,
  NO_ANSWER_SMS: ShippingShipmentStatus.UNREACHABLE,
  UNREACHABLE: ShippingShipmentStatus.UNREACHABLE,
  UNREACHABLE_TEAM: ShippingShipmentStatus.UNREACHABLE,
  VOICEMAIL: ShippingShipmentStatus.UNREACHABLE,
  VOICEMAIL_TEAM: ShippingShipmentStatus.UNREACHABLE,
  WRONG_NUMBER: ShippingShipmentStatus.UNREACHABLE,
  OUT_OF_AREA: ShippingShipmentStatus.UNREACHABLE,
  DELIVERED: ShippingShipmentStatus.DELIVERED,
  CANCELLED: ShippingShipmentStatus.CANCELLED,
  CANCELED: ShippingShipmentStatus.CANCELLED,
  REFUSED: ShippingShipmentStatus.REFUSED,
  REFUSE: ShippingShipmentStatus.REFUSED,
  DOESNT_ORDER: ShippingShipmentStatus.REFUSED,
  PREPAR_RETURN: ShippingShipmentStatus.RETURN_PENDING,
  RETURN: ShippingShipmentStatus.RETURN_IN_TRANSIT,
  RETURN_IN_PROGRESS: ShippingShipmentStatus.RETURN_IN_TRANSIT,
  RETURNED: ShippingShipmentStatus.RETURNED_TO_SELLER,
  REFUNDED: ShippingShipmentStatus.RETURNED_TO_SELLER,
  RELAUNCH: ShippingShipmentStatus.PENDING,
  RELAUNCH_NEW: ShippingShipmentStatus.PENDING,
  RELAUNCH_TEAM: ShippingShipmentStatus.PENDING,
  RESEND_NEW_CITY: ShippingShipmentStatus.IN_TRANSIT,
};

export function normalizeAmeexStatus(
  status: string,
  subStatus?: string | null,
) {
  const sub = normalizeCode(subStatus);
  const main = normalizeCode(status);
  return STATUS_MAP[sub] ?? STATUS_MAP[main] ?? ShippingShipmentStatus.UNKNOWN;
}

export function normalizeAmeexStatusCode(value?: string | null) {
  return value ? normalizeCode(value) : null;
}

function normalizeCode(value?: string | null) {
  return (value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}
