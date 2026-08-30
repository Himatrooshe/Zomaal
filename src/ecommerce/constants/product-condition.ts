// Recorded by the warehouse scan-and-condition workflow when a shipment
// comes back. GOOD/RETURNED restock the item; DAMAGED moves it to the
// damaged bucket; LOST/MISSING create no inventory movement — there is
// nothing physical to place in a bucket.
export const ProductCondition = {
  GOOD: 'GOOD',
  DAMAGED: 'DAMAGED',
  LOST: 'LOST',
  RETURNED: 'RETURNED',
  MISSING: 'MISSING',
} as const;

export type ProductCondition =
  (typeof ProductCondition)[keyof typeof ProductCondition];

export const PRODUCT_CONDITIONS = Object.values(ProductCondition);
