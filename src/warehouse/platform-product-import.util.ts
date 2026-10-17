import type { ShopifyProductDetailsDto } from '../shopify/dto/shopify-data-response.dto';

export const MAX_IMPORT_VARIANTS = 100;
const MAX_OPTIONS = 3;
const MAX_NAME = 255;
const MAX_OPTION_TEXT = 50;
const MAX_SKU = 100;

export interface ImportedVariant {
  optionValues: string[];
  sku: string | null;
  barcode: string | null;
  price: number;
  costPrice: number | null;
  stock: number | null;
}

/** A platform product normalized to the shape Zomaal products are created from. */
export interface ImportedProduct {
  externalId: string;
  name: string;
  description: string | null;
  imageUrl: string | null;
  options: string[];
  variants: ImportedVariant[];
}

export class ImportMappingError extends Error {}

export function fromShopifyProduct(
  product: ShopifyProductDetailsDto,
): ImportedProduct {
  if (product.variants.pageInfo.hasNextPage) {
    throw new ImportMappingError(
      `Products with more than ${MAX_IMPORT_VARIANTS} variants cannot be imported`,
    );
  }
  const options = product.hasOnlyDefaultVariant
    ? []
    : [...product.options]
        .sort((a, b) => a.position - b.position)
        .map((option) => option.name);
  return finalize({
    externalId: product.legacyResourceId,
    name: product.title,
    description: product.description,
    imageUrl: product.featuredImage?.url ?? null,
    options,
    variants: product.variants.data.map((variant) => ({
      optionValues: options.map(
        (name) =>
          variant.selectedOptions.find((option) => option.name === name)
            ?.value ?? '',
      ),
      sku: variant.sku,
      barcode: variant.barcode,
      price: toAmount(variant.price) ?? 0,
      costPrice: null,
      stock: variant.inventoryQuantity,
    })),
  });
}

/**
 * YouCan's product endpoint returns `variants` (each with a `variations`
 * map such as `{ "Size": "M" }`) and `variant_options`, which our typed DTO
 * does not model, so the raw payload is read defensively.
 */
export function fromYouCanProduct(raw: unknown): ImportedProduct {
  const product = asRecord(raw);
  const externalId = text(product.id);
  if (!externalId) throw new ImportMappingError('YouCan product has no id');
  const rawVariants = Array.isArray(product.variants)
    ? product.variants.map(asRecord)
    : [];
  const hasVariants = product.has_variants !== false && rawVariants.length > 1;
  const declaredOptions = Array.isArray(product.variant_options)
    ? product.variant_options
        .map((option) => text(asRecord(option).name))
        .filter((name): name is string => !!name)
    : [];
  const options = hasVariants
    ? declaredOptions.length
      ? declaredOptions
      : Object.keys(asRecord(rawVariants[0]?.variations))
    : [];

  const productPrice = toAmount(product.price);
  const productCost = toAmount(product.cost_price);
  const productStock = toCount(product.inventory);
  const variants: ImportedVariant[] = hasVariants
    ? rawVariants.map((variant) => {
        const variations = asRecord(variant.variations);
        return {
          optionValues: options.map((name) => text(variations[name]) ?? ''),
          sku: text(variant.sku),
          barcode: text(variant.barcode),
          price: toAmount(variant.price) ?? productPrice ?? 0,
          costPrice: toAmount(variant.cost_price) ?? productCost,
          stock: toCount(variant.inventory),
        };
      })
    : [
        {
          optionValues: [],
          sku: text(rawVariants[0]?.sku) ?? text(product.sku),
          barcode: text(rawVariants[0]?.barcode) ?? text(product.barcode),
          price: productPrice ?? toAmount(rawVariants[0]?.price) ?? 0,
          costPrice: productCost ?? toAmount(rawVariants[0]?.cost_price),
          stock: productStock ?? toCount(rawVariants[0]?.inventory),
        },
      ];

  return finalize({
    externalId,
    name: text(product.name) ?? `Product ${externalId}`,
    description: text(product.description),
    imageUrl: text(product.thumbnail),
    options,
    variants,
  });
}

/**
 * Lightfunnels exposes variants as `{ id, title, price, sku }` without
 * option names, so a multi-variant product gets a single "Variant" option
 * whose values are the variant titles. No cost, stock or image URL is
 * available.
 */
export function fromLightfunnelsProduct(raw: unknown): ImportedProduct {
  const product = asRecord(raw);
  const externalId = text(product.id);
  if (!externalId) {
    throw new ImportMappingError('Lightfunnels product has no id');
  }
  const rawVariants = Array.isArray(product.variants)
    ? product.variants.map(asRecord)
    : [];
  const productPrice = toAmount(product.price);
  const multi = rawVariants.length > 1;
  const variants: ImportedVariant[] = rawVariants.length
    ? rawVariants.map((variant, index) => ({
        optionValues: multi
          ? [text(variant.title) ?? `Variant ${index + 1}`]
          : [],
        sku: text(variant.sku),
        barcode: null,
        price: toAmount(variant.price) ?? productPrice ?? 0,
        costPrice: null,
        stock: null,
      }))
    : [
        {
          optionValues: [],
          sku: null,
          barcode: null,
          price: productPrice ?? 0,
          costPrice: null,
          stock: null,
        },
      ];
  return finalize({
    externalId,
    name: text(product.title) ?? `Product ${externalId}`,
    description: text(product.description),
    imageUrl: null,
    options: multi ? ['Variant'] : [],
    variants,
  });
}

/** Enforces Zomaal's product limits and drops duplicate SKUs / combinations. */
function finalize(product: ImportedProduct): ImportedProduct {
  if (product.options.length > MAX_OPTIONS) {
    throw new ImportMappingError(
      `Products with more than ${MAX_OPTIONS} options cannot be imported`,
    );
  }
  if (product.variants.length > MAX_IMPORT_VARIANTS) {
    throw new ImportMappingError(
      `Products with more than ${MAX_IMPORT_VARIANTS} variants cannot be imported`,
    );
  }
  if (!product.variants.length) {
    throw new ImportMappingError('Product has no variants');
  }
  const seenSkus = new Set<string>();
  const seenCombinations = new Set<string>();
  const variants: ImportedVariant[] = [];
  for (const variant of product.variants) {
    const optionValues = variant.optionValues.map(
      (value) => clip(value, MAX_OPTION_TEXT) || 'Default',
    );
    const combination = optionValues
      .map((value) => value.toLowerCase())
      .join('\u0000');
    if (seenCombinations.has(combination)) continue;
    seenCombinations.add(combination);

    let sku = variant.sku ? clip(variant.sku, MAX_SKU) : null;
    if (sku && seenSkus.has(sku.toLowerCase())) sku = null;
    if (sku) seenSkus.add(sku.toLowerCase());
    variants.push({
      ...variant,
      optionValues,
      sku: sku || null,
      barcode: variant.barcode?.trim() || null,
      price: Math.max(0, variant.price),
      costPrice:
        variant.costPrice === null ? null : Math.max(0, variant.costPrice),
    });
  }
  return {
    ...product,
    name: clip(product.name, MAX_NAME) || `Product ${product.externalId}`,
    description: product.description?.trim() || null,
    options: product.options.map(
      (name, index) => clip(name, MAX_OPTION_TEXT) || `Option ${index + 1}`,
    ),
    variants,
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown): string | null {
  if (typeof value === 'number') return String(value);
  if (typeof value !== 'string') return null;
  return value.trim() || null;
}

function toAmount(value: unknown): number | null {
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim()
        ? Number(value)
        : NaN;
  return Number.isFinite(parsed) ? Math.round(parsed * 10000) / 10000 : null;
}

function toCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.trunc(value)
    : null;
}

function clip(value: string, max: number) {
  return value.trim().slice(0, max).trim();
}
