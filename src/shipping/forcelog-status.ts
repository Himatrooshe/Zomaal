import { ShippingShipmentStatus } from '@prisma/client';

const STATUS_MAP: Record<string, ShippingShipmentStatus> = {
  NEW: ShippingShipmentStatus.PENDING,
  NEW_PARCEL: ShippingShipmentStatus.PENDING,
  NOUVEAU_COLIS: ShippingShipmentStatus.PENDING,
  PENDING: ShippingShipmentStatus.PENDING,
  CONFIRMED: ShippingShipmentStatus.CONFIRMED,
  CONFIRME: ShippingShipmentStatus.CONFIRMED,
  PROGRAMME: ShippingShipmentStatus.CONFIRMED,
  PICKUP_PENDING: ShippingShipmentStatus.PICKUP_PENDING,
  RAMASSAGE: ShippingShipmentStatus.PICKUP_PENDING,
  PICKED_UP: ShippingShipmentStatus.PICKED_UP,
  RAMASSE: ShippingShipmentStatus.PICKED_UP,
  COLLECTE: ShippingShipmentStatus.PICKED_UP,
  AT_WAREHOUSE: ShippingShipmentStatus.AT_WAREHOUSE,
  WAREHOUSE: ShippingShipmentStatus.AT_WAREHOUSE,
  ENTREPOT: ShippingShipmentStatus.AT_WAREHOUSE,
  IN_TRANSIT: ShippingShipmentStatus.IN_TRANSIT,
  TRANSIT: ShippingShipmentStatus.IN_TRANSIT,
  DISTRIBUTION: ShippingShipmentStatus.OUT_FOR_DELIVERY,
  DISTRIBUE: ShippingShipmentStatus.OUT_FOR_DELIVERY,
  OUT_FOR_DELIVERY: ShippingShipmentStatus.OUT_FOR_DELIVERY,
  EN_COURS_DE_LIVRAISON: ShippingShipmentStatus.OUT_FOR_DELIVERY,
  POSTPONED: ShippingShipmentStatus.POSTPONED,
  REPORTE: ShippingShipmentStatus.POSTPONED,
  UNREACHABLE: ShippingShipmentStatus.UNREACHABLE,
  INJOIGNABLE: ShippingShipmentStatus.UNREACHABLE,
  DELIVERED: ShippingShipmentStatus.DELIVERED,
  LIVRE: ShippingShipmentStatus.DELIVERED,
  CANCELLED: ShippingShipmentStatus.CANCELLED,
  CANCELED: ShippingShipmentStatus.CANCELLED,
  ANNULE: ShippingShipmentStatus.CANCELLED,
  REFUSED: ShippingShipmentStatus.REFUSED,
  REFUSE: ShippingShipmentStatus.REFUSED,
  RETURN_PENDING: ShippingShipmentStatus.RETURN_PENDING,
  RETOUR_EN_ATTENTE: ShippingShipmentStatus.RETURN_PENDING,
  RETURN_IN_TRANSIT: ShippingShipmentStatus.RETURN_IN_TRANSIT,
  RETOUR_EN_COURS: ShippingShipmentStatus.RETURN_IN_TRANSIT,
  RETURNED_TO_WAREHOUSE: ShippingShipmentStatus.RETURNED_TO_WAREHOUSE,
  RETOUR_ENTREPOT: ShippingShipmentStatus.RETURNED_TO_WAREHOUSE,
  RETURN_INSPECTION: ShippingShipmentStatus.RETURN_INSPECTION,
  RETOUR_CONTROLE: ShippingShipmentStatus.RETURN_INSPECTION,
  RETURNED_TO_STOCK: ShippingShipmentStatus.RETURNED_TO_STOCK,
  RETOUR_STOCK: ShippingShipmentStatus.RETURNED_TO_STOCK,
  RETURNED_TO_SELLER: ShippingShipmentStatus.RETURNED_TO_SELLER,
  RETOURNE_A_L_EXPEDITEUR: ShippingShipmentStatus.RETURNED_TO_SELLER,
  RETOURNE_AU_CLIENT: ShippingShipmentStatus.RETURNED_TO_SELLER,
};

export function normalizeForceLogStatus(
  value: string | null | undefined,
): ShippingShipmentStatus {
  const key = normalizeForceLogStatusCode(value);
  if (!key) return ShippingShipmentStatus.UNKNOWN;
  if (STATUS_MAP[key]) return STATUS_MAP[key];

  if (key.includes('RETOUR')) {
    if (key.includes('EXPEDITEUR') || key.includes('CLIENT')) {
      return ShippingShipmentStatus.RETURNED_TO_SELLER;
    }
    if (key.includes('STOCK')) return ShippingShipmentStatus.RETURNED_TO_STOCK;
    if (key.includes('CONTROLE') || key.includes('INSPECTION')) {
      return ShippingShipmentStatus.RETURN_INSPECTION;
    }
    if (key.includes('ENTREPOT') || key.includes('WAREHOUSE')) {
      return ShippingShipmentStatus.RETURNED_TO_WAREHOUSE;
    }
    if (key.includes('COURS') || key.includes('TRANSIT')) {
      return ShippingShipmentStatus.RETURN_IN_TRANSIT;
    }
    return ShippingShipmentStatus.RETURN_PENDING;
  }
  if (key.includes('LIVR')) return ShippingShipmentStatus.DELIVERED;
  if (key.includes('REFUS')) return ShippingShipmentStatus.REFUSED;
  if (key.includes('ANNUL')) return ShippingShipmentStatus.CANCELLED;
  if (key.includes('REPORT')) return ShippingShipmentStatus.POSTPONED;
  if (key.includes('INJOIGN')) return ShippingShipmentStatus.UNREACHABLE;
  if (key.includes('DISTRIB')) return ShippingShipmentStatus.OUT_FOR_DELIVERY;
  if (key.includes('TRANSIT')) return ShippingShipmentStatus.IN_TRANSIT;
  if (key.includes('ENTREPOT')) return ShippingShipmentStatus.AT_WAREHOUSE;
  if (key.includes('RAMASS') || key.includes('COLLECT')) {
    return ShippingShipmentStatus.PICKED_UP;
  }
  if (key.includes('NOUVEAU')) return ShippingShipmentStatus.PENDING;
  return ShippingShipmentStatus.UNKNOWN;
}

export function normalizeForceLogStatusCode(
  value: string | null | undefined,
): string | null {
  if (!value?.trim()) return null;
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}
