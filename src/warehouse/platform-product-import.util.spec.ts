import type { ShopifyProductDetailsDto } from '../shopify/dto/shopify-data-response.dto';
import { isAllowedPlatformImageUrl } from './platform-image.util';
import {
  fromLightfunnelsProduct,
  fromShopifyProduct,
  fromYouCanProduct,
  ImportMappingError,
} from './platform-product-import.util';

function shopifyProduct(
  overrides: Partial<ShopifyProductDetailsDto> = {},
): ShopifyProductDetailsDto {
  return {
    legacyResourceId: '1001',
    title: 'Test Shirt',
    description: 'Synthetic product',
    hasOnlyDefaultVariant: false,
    featuredImage: { url: 'https://cdn.shopify.com/s/files/test.png' },
    options: [
      { id: 'o2', name: 'Color', position: 2, values: ['Red'] },
      { id: 'o1', name: 'Size', position: 1, values: ['M', 'L'] },
    ],
    variants: {
      data: [
        {
          sku: 'SKU-M',
          barcode: null,
          price: '20.00',
          inventoryQuantity: 4,
          selectedOptions: [
            { name: 'Color', value: 'Red' },
            { name: 'Size', value: 'M' },
          ],
        },
        {
          sku: 'sku-m',
          barcode: '4006381333931',
          price: '22.50',
          inventoryQuantity: -2,
          selectedOptions: [
            { name: 'Size', value: 'L' },
            { name: 'Color', value: 'Red' },
          ],
        },
      ],
      pageInfo: { hasNextPage: false },
    },
    ...overrides,
  } as unknown as ShopifyProductDetailsDto;
}

describe('platform product import mapping', () => {
  it('maps Shopify options in position order and drops a duplicate SKU', () => {
    const product = fromShopifyProduct(shopifyProduct());

    expect(product.externalId).toBe('1001');
    expect(product.options).toEqual(['Size', 'Color']);
    expect(product.variants).toEqual([
      expect.objectContaining({
        optionValues: ['M', 'Red'],
        sku: 'SKU-M',
        price: 20,
        costPrice: null,
        stock: 4,
      }),
      expect.objectContaining({
        optionValues: ['L', 'Red'],
        sku: null,
        barcode: '4006381333931',
        price: 22.5,
      }),
    ]);
  });

  it('imports a Shopify default-variant product without options', () => {
    const product = fromShopifyProduct(
      shopifyProduct({ hasOnlyDefaultVariant: true }),
    );
    expect(product.options).toEqual([]);
    expect(product.variants).toHaveLength(1);
    expect(product.variants[0].optionValues).toEqual([]);
  });

  it('rejects Shopify products with more variants than Zomaal supports', () => {
    const product = shopifyProduct();
    product.variants.pageInfo.hasNextPage = true;
    expect(() => fromShopifyProduct(product)).toThrow(ImportMappingError);
  });

  it('maps YouCan variations and cost price', () => {
    const product = fromYouCanProduct({
      id: 'yc-1',
      name: 'Test Bag',
      price: 100,
      cost_price: 40,
      thumbnail: 'https://cdn.youcan.shop/test.png',
      has_variants: true,
      variant_options: [{ name: 'Color', values: ['Black', 'Brown'] }],
      variants: [
        {
          variations: { Color: 'Black' },
          sku: 'BAG-B',
          price: 100,
          inventory: 3,
        },
        {
          variations: { Color: 'Brown' },
          sku: 'BAG-R',
          price: '110',
          cost_price: 45,
        },
      ],
    });

    expect(product.options).toEqual(['Color']);
    expect(product.variants).toEqual([
      expect.objectContaining({
        optionValues: ['Black'],
        sku: 'BAG-B',
        price: 100,
        costPrice: 40,
        stock: 3,
      }),
      expect.objectContaining({
        optionValues: ['Brown'],
        price: 110,
        costPrice: 45,
        stock: null,
      }),
    ]);
  });

  it('maps a YouCan product without variants to one default variant', () => {
    const product = fromYouCanProduct({
      id: 'yc-2',
      name: 'Test Mug',
      price: 30,
      inventory: 7,
      has_variants: false,
      variants: [{ variations: { default: 'default' }, sku: 'MUG-1' }],
    });
    expect(product.options).toEqual([]);
    expect(product.variants).toEqual([
      expect.objectContaining({
        optionValues: [],
        sku: 'MUG-1',
        price: 30,
        costPrice: null,
        stock: 7,
      }),
    ]);
  });

  it('turns Lightfunnels variant titles into a single Variant option', () => {
    const product = fromLightfunnelsProduct({
      id: 'lf-1',
      title: 'Test Cream',
      price: 15,
      variants: [
        { id: 'v1', title: '50ml', price: 15, sku: 'CREAM-50' },
        { id: 'v2', title: '100ml', price: 25, sku: '' },
      ],
    });
    expect(product.options).toEqual(['Variant']);
    expect(product.variants.map((variant) => variant.optionValues)).toEqual([
      ['50ml'],
      ['100ml'],
    ]);
    expect(product.variants[1].sku).toBeNull();
    expect(product.imageUrl).toBeNull();
  });

  it('only allows platform CDN image URLs over https', () => {
    expect(
      isAllowedPlatformImageUrl('https://cdn.shopify.com/s/files/a.png'),
    ).toBe(true);
    expect(isAllowedPlatformImageUrl('https://cdn.youcan.shop/a.png')).toBe(
      true,
    );
    expect(isAllowedPlatformImageUrl('http://cdn.shopify.com/a.png')).toBe(
      false,
    );
    expect(isAllowedPlatformImageUrl('https://169.254.169.254/latest')).toBe(
      false,
    );
    expect(
      isAllowedPlatformImageUrl('https://cdn.shopify.com.evil.test/a.png'),
    ).toBe(false);
    expect(isAllowedPlatformImageUrl('not a url')).toBe(false);
  });
});
