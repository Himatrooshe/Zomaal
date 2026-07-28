export interface ProductVariantData {
  title?: string;
  sku?: string;
  price: number;
  compareAtPrice?: number;
  inventoryQty: number;
}

export interface ProductImageData {
  url: string;
  position: number;
}

export interface ProductData {
  idempotencyKey: string;
  title: string;
  description?: string;
  vendor?: string;
  status: string;
  variants: ProductVariantData[];
  images: ProductImageData[];
}

export interface EcommerceProductAdapter {
  publishProduct(
    userId: string,
    product: ProductData,
  ): Promise<{ externalProductId: string }>;
}
