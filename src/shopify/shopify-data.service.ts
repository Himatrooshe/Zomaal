import { Injectable, NotFoundException } from '@nestjs/common';
import { ShopifyConnectionService } from './shopify-connection.service';
import {
  SHOPIFY_DEFAULT_ORDER_FULFILLMENTS_PAGE_SIZE,
  SHOPIFY_DEFAULT_ORDER_LINE_ITEMS_PAGE_SIZE,
  SHOPIFY_DEFAULT_PAGE_SIZE,
  SHOPIFY_DEFAULT_PRODUCT_MEDIA_PAGE_SIZE,
  SHOPIFY_DEFAULT_PRODUCT_VARIANTS_PAGE_SIZE,
  SHOPIFY_MAX_ORDER_FULFILLMENTS_PAGE_SIZE,
  SHOPIFY_MAX_PAGE_SIZE,
  SHOPIFY_MAX_PRODUCT_MEDIA_PAGE_SIZE,
  type ShopifyDataPageQueryDto,
  type ShopifyOrderDetailsQueryDto,
  type ShopifyProductDetailsQueryDto,
} from './dto/shopify-data-query.dto';
import type {
  ShopifyAddressDto,
  ShopifyCustomerDto,
  ShopifyCustomerListResponseDto,
  ShopifyOrderDetailsDto,
  ShopifyOrderFulfillmentDto,
  ShopifyOrderLineItemDto,
  ShopifyMoneyDto,
  ShopifyOrderDto,
  ShopifyOrderListResponseDto,
  ShopifyPageInfoDto,
  ShopifyProductDetailsDto,
  ShopifyProductDto,
  ShopifyProductImageDto,
  ShopifyProductListResponseDto,
  ShopifyProductMediaDto,
  ShopifyProductVariantDto,
  ShopifyShopOverviewDto,
} from './dto/shopify-data-response.dto';

const SHOP_OVERVIEW_QUERY = `#graphql
  query ZomaalShopOverview {
    shop {
      id
      name
      myshopifyDomain
      url
      contactEmail
      currencyCode
      ianaTimezone
      createdAt
      updatedAt
      primaryDomain {
        host
        url
        sslEnabled
      }
      plan {
        publicDisplayName
        shopifyPlus
        partnerDevelopment
      }
      shopAddress {
        address1
        address2
        city
        province
        provinceCode
        country
        countryCodeV2
        zip
        phone
      }
    }
  }
`;

const PRODUCTS_QUERY = `#graphql
  query ZomaalProducts($first: Int!, $after: String, $query: String) {
    products(
      first: $first
      after: $after
      query: $query
      sortKey: UPDATED_AT
      reverse: true
    ) {
      nodes {
        id
        title
        handle
        status
        vendor
        productType
        tags
        totalInventory
        tracksInventory
        priceRangeV2 {
          minVariantPrice {
            amount
            currencyCode
          }
          maxVariantPrice {
            amount
            currencyCode
          }
        }
        featuredMedia {
          preview {
            image {
              url
              altText
              width
              height
            }
          }
        }
        createdAt
        updatedAt
      }
      pageInfo {
        hasNextPage
        hasPreviousPage
        startCursor
        endCursor
      }
    }
  }
`;

const PRODUCT_DETAILS_QUERY = `#graphql
  query ZomaalProductDetails(
    $id: ID!
    $variantsFirst: Int!
    $variantsAfter: String
    $mediaFirst: Int!
    $mediaAfter: String
  ) {
    product(id: $id) {
      id
      legacyResourceId
      title
      handle
      description
      descriptionHtml
      status
      vendor
      productType
      tags
      totalInventory
      tracksInventory
      isGiftCard
      hasOnlyDefaultVariant
      onlineStoreUrl
      publishedAt
      seo {
        title
        description
      }
      priceRangeV2 {
        minVariantPrice {
          amount
          currencyCode
        }
        maxVariantPrice {
          amount
          currencyCode
        }
      }
      featuredMedia {
        id
        alt
        mediaContentType
        status
        preview {
          image {
            url
            altText
            width
            height
          }
        }
      }
      options {
        id
        name
        position
        values
      }
      media(
        first: $mediaFirst
        after: $mediaAfter
        sortKey: POSITION
      ) {
        nodes {
          id
          alt
          mediaContentType
          status
          preview {
            image {
              url
              altText
              width
              height
            }
          }
        }
        pageInfo {
          hasNextPage
          hasPreviousPage
          startCursor
          endCursor
        }
      }
      variants(first: $variantsFirst, after: $variantsAfter) {
        nodes {
          id
          legacyResourceId
          title
          displayName
          sku
          barcode
          price
          compareAtPrice
          inventoryQuantity
          availableForSale
          taxable
          inventoryPolicy
          position
          selectedOptions {
            name
            value
          }
          image {
            url
            altText
            width
            height
          }
          createdAt
          updatedAt
        }
        pageInfo {
          hasNextPage
          hasPreviousPage
          startCursor
          endCursor
        }
      }
      createdAt
      updatedAt
    }
  }
`;

const ORDERS_QUERY = `#graphql
  query ZomaalOrders($first: Int!, $after: String, $query: String) {
    orders(
      first: $first
      after: $after
      query: $query
      sortKey: PROCESSED_AT
      reverse: true
    ) {
      nodes {
        id
        name
        displayFinancialStatus
        displayFulfillmentStatus
        currentTotalPriceSet {
          shopMoney {
            amount
            currencyCode
          }
        }
        currentSubtotalLineItemsQuantity
        customer {
          id
          displayName
        }
        createdAt
        updatedAt
        processedAt
        cancelledAt
      }
      pageInfo {
        hasNextPage
        hasPreviousPage
        startCursor
        endCursor
      }
    }
  }
`;

const ORDER_DETAILS_QUERY = `#graphql
  query ZomaalOrderDetails(
    $id: ID!
    $lineItemsFirst: Int!
    $lineItemsAfter: String
    $fulfillmentsFirst: Int!
  ) {
    order(id: $id) {
      id
      legacyResourceId
      name
      confirmationNumber
      currencyCode
      displayFinancialStatus
      displayFulfillmentStatus
      fullyPaid
      taxesIncluded
      test
      currentSubtotalLineItemsQuantity
      currentSubtotalPriceSet {
        shopMoney {
          amount
          currencyCode
        }
      }
      currentTotalDiscountsSet {
        shopMoney {
          amount
          currencyCode
        }
      }
      currentShippingPriceSet {
        shopMoney {
          amount
          currencyCode
        }
      }
      currentTotalTaxSet {
        shopMoney {
          amount
          currencyCode
        }
      }
      currentTotalPriceSet {
        shopMoney {
          amount
          currencyCode
        }
      }
      totalRefundedSet {
        shopMoney {
          amount
          currencyCode
        }
      }
      totalOutstandingSet {
        shopMoney {
          amount
          currencyCode
        }
      }
      discountCodes
      tags
      customer {
        id
        displayName
      }
      lineItems(first: $lineItemsFirst, after: $lineItemsAfter) {
        nodes {
          id
          name
          title
          variantTitle
          sku
          vendor
          quantity
          currentQuantity
          refundableQuantity
          unfulfilledQuantity
          requiresShipping
          taxable
          isGiftCard
          originalUnitPriceSet {
            shopMoney {
              amount
              currencyCode
            }
          }
          discountedUnitPriceSet {
            shopMoney {
              amount
              currencyCode
            }
          }
          originalTotalSet {
            shopMoney {
              amount
              currencyCode
            }
          }
          discountedTotalSet {
            shopMoney {
              amount
              currencyCode
            }
          }
          totalDiscountSet {
            shopMoney {
              amount
              currencyCode
            }
          }
          image {
            url
            altText
            width
            height
          }
          variant {
            id
            legacyResourceId
          }
        }
        pageInfo {
          hasNextPage
          hasPreviousPage
          startCursor
          endCursor
        }
      }
      fulfillments(first: $fulfillmentsFirst) {
        id
        legacyResourceId
        name
        status
        displayStatus
        totalQuantity
        trackingInfo(first: 10) {
          company
          number
          url
        }
        createdAt
        updatedAt
        deliveredAt
        estimatedDeliveryAt
        inTransitAt
      }
      createdAt
      updatedAt
      processedAt
      cancelledAt
      cancelReason
      closedAt
    }
  }
`;

const CUSTOMERS_QUERY = `#graphql
  query ZomaalCustomers($first: Int!, $after: String, $query: String) {
    customers(
      first: $first
      after: $after
      query: $query
      sortKey: UPDATED_AT
      reverse: true
    ) {
      nodes {
        id
        displayName
        firstName
        lastName
        defaultEmailAddress {
          emailAddress
        }
        defaultPhoneNumber {
          phoneNumber
        }
        numberOfOrders
        amountSpent {
          amount
          currencyCode
        }
        state
        verifiedEmail
        tags
        defaultAddress {
          city
          provinceCode
          countryCodeV2
        }
        createdAt
        updatedAt
      }
      pageInfo {
        hasNextPage
        hasPreviousPage
        startCursor
        endCursor
      }
    }
  }
`;

interface RawMoney {
  amount: string;
  currencyCode: string;
}

interface RawMoneyBag {
  shopMoney: RawMoney;
}

interface RawPageInfo {
  hasNextPage: boolean;
  hasPreviousPage: boolean;
  startCursor: string | null;
  endCursor: string | null;
}

interface RawConnection<T> {
  nodes: T[];
  pageInfo: RawPageInfo;
}

interface RawShopOverviewResponse {
  shop: {
    id: string;
    name: string;
    myshopifyDomain: string;
    url: string;
    contactEmail: string;
    currencyCode: string;
    ianaTimezone: string;
    createdAt: string;
    updatedAt: string;
    primaryDomain: {
      host: string;
      url: string;
      sslEnabled: boolean;
    };
    plan: {
      publicDisplayName: string;
      shopifyPlus: boolean;
      partnerDevelopment: boolean;
    };
    shopAddress: {
      address1: string | null;
      address2: string | null;
      city: string | null;
      province: string | null;
      provinceCode: string | null;
      country: string | null;
      countryCodeV2: string | null;
      zip: string | null;
      phone: string | null;
    };
  };
}

interface RawProduct {
  id: string;
  title: string;
  handle: string;
  status: string;
  vendor: string;
  productType: string;
  tags: string[];
  totalInventory: number;
  tracksInventory: boolean;
  priceRangeV2: {
    minVariantPrice: RawMoney;
    maxVariantPrice: RawMoney;
  };
  featuredMedia: {
    preview: {
      image: {
        url: string;
        altText: string | null;
        width: number | null;
        height: number | null;
      } | null;
    } | null;
  } | null;
  createdAt: string;
  updatedAt: string;
}

interface RawProductsResponse {
  products: RawConnection<RawProduct>;
}

interface RawProductImage {
  url: string;
  altText: string | null;
  width: number | null;
  height: number | null;
}

interface RawProductMedia {
  id: string;
  alt: string | null;
  mediaContentType: string;
  status: string;
  preview: {
    image: RawProductImage | null;
  } | null;
}

interface RawProductVariant {
  id: string;
  legacyResourceId: string | number;
  title: string;
  displayName: string;
  sku: string | null;
  barcode: string | null;
  price: string;
  compareAtPrice: string | null;
  inventoryQuantity: number | null;
  availableForSale: boolean;
  taxable: boolean;
  inventoryPolicy: string;
  position: number;
  selectedOptions: Array<{
    name: string;
    value: string;
  }>;
  image: RawProductImage | null;
  createdAt: string;
  updatedAt: string;
}

interface RawProductDetails extends Omit<RawProduct, 'featuredMedia'> {
  legacyResourceId: string | number;
  description: string;
  descriptionHtml: string;
  onlineStoreUrl: string | null;
  isGiftCard: boolean;
  hasOnlyDefaultVariant: boolean;
  publishedAt: string | null;
  seo: {
    title: string | null;
    description: string | null;
  };
  featuredMedia: RawProductMedia | null;
  options: Array<{
    id: string;
    name: string;
    position: number;
    values: string[];
  }>;
  media: RawConnection<RawProductMedia>;
  variants: RawConnection<RawProductVariant>;
}

interface RawProductDetailsResponse {
  product: RawProductDetails | null;
}

interface RawOrder {
  id: string;
  name: string;
  displayFinancialStatus: string | null;
  displayFulfillmentStatus: string;
  currentTotalPriceSet: RawMoneyBag;
  currentSubtotalLineItemsQuantity: number;
  customer: {
    id: string;
    displayName: string;
  } | null;
  createdAt: string;
  updatedAt: string;
  processedAt: string | null;
  cancelledAt: string | null;
}

interface RawOrdersResponse {
  orders: RawConnection<RawOrder>;
}

interface RawOrderLineItem {
  id: string;
  name: string;
  title: string;
  variantTitle: string | null;
  sku: string | null;
  vendor: string | null;
  quantity: number;
  currentQuantity: number;
  refundableQuantity: number;
  unfulfilledQuantity: number;
  requiresShipping: boolean;
  taxable: boolean;
  isGiftCard: boolean;
  originalUnitPriceSet: RawMoneyBag;
  discountedUnitPriceSet: RawMoneyBag;
  originalTotalSet: RawMoneyBag;
  discountedTotalSet: RawMoneyBag;
  totalDiscountSet: RawMoneyBag;
  image: RawProductImage | null;
  variant: {
    id: string;
    legacyResourceId: string | number;
  } | null;
}

interface RawOrderFulfillment {
  id: string;
  legacyResourceId: string | number;
  name: string;
  status: string;
  displayStatus: string | null;
  totalQuantity: number;
  trackingInfo: Array<{
    company: string | null;
    number: string | null;
    url: string | null;
  }>;
  createdAt: string;
  updatedAt: string;
  deliveredAt: string | null;
  estimatedDeliveryAt: string | null;
  inTransitAt: string | null;
}

interface RawOrderDetails extends RawOrder {
  legacyResourceId: string | number;
  confirmationNumber: string | null;
  currencyCode: string;
  fullyPaid: boolean;
  taxesIncluded: boolean;
  test: boolean;
  currentSubtotalPriceSet: RawMoneyBag;
  currentTotalDiscountsSet: RawMoneyBag;
  currentShippingPriceSet: RawMoneyBag;
  currentTotalTaxSet: RawMoneyBag;
  totalRefundedSet: RawMoneyBag;
  totalOutstandingSet: RawMoneyBag;
  discountCodes: string[];
  tags: string[];
  lineItems: RawConnection<RawOrderLineItem>;
  fulfillments: RawOrderFulfillment[];
  cancelReason: string | null;
  closedAt: string | null;
}

interface RawOrderDetailsResponse {
  order: RawOrderDetails | null;
}

interface RawCustomer {
  id: string;
  displayName: string;
  firstName: string | null;
  lastName: string | null;
  defaultEmailAddress: { emailAddress: string } | null;
  defaultPhoneNumber: { phoneNumber: string } | null;
  numberOfOrders: string;
  amountSpent: RawMoney;
  state: string;
  verifiedEmail: boolean;
  tags: string[];
  defaultAddress: {
    city: string | null;
    provinceCode: string | null;
    countryCodeV2: string | null;
  } | null;
  createdAt: string;
  updatedAt: string;
}

interface RawCustomersResponse {
  customers: RawConnection<RawCustomer>;
}

@Injectable()
export class ShopifyDataService {
  constructor(private readonly connectionService: ShopifyConnectionService) {}

  async getOverview(userId: string): Promise<ShopifyShopOverviewDto> {
    const { shop } =
      await this.connectionService.graphqlForUser<RawShopOverviewResponse>(
        userId,
        SHOP_OVERVIEW_QUERY,
      );

    return {
      id: shop.id,
      name: shop.name,
      myshopifyDomain: shop.myshopifyDomain,
      onlineStoreUrl: shop.url,
      contactEmail: shop.contactEmail,
      currencyCode: shop.currencyCode,
      timezone: shop.ianaTimezone,
      createdAt: shop.createdAt,
      updatedAt: shop.updatedAt,
      primaryDomain: {
        host: shop.primaryDomain.host,
        url: shop.primaryDomain.url,
        sslEnabled: shop.primaryDomain.sslEnabled,
      },
      plan: {
        displayName: shop.plan.publicDisplayName,
        shopifyPlus: shop.plan.shopifyPlus,
        partnerDevelopment: shop.plan.partnerDevelopment,
      },
      address: mapAddress(shop.shopAddress),
    };
  }

  async listProducts(
    userId: string,
    query: ShopifyDataPageQueryDto,
  ): Promise<ShopifyProductListResponseDto> {
    const { products } =
      await this.connectionService.graphqlForUser<RawProductsResponse>(
        userId,
        PRODUCTS_QUERY,
        paginationVariables(query),
      );

    return {
      data: products.nodes.map(mapProduct),
      pageInfo: mapPageInfo(products.pageInfo),
    };
  }

  async getProductDetails(
    userId: string,
    productId: string,
    query: ShopifyProductDetailsQueryDto,
  ): Promise<ShopifyProductDetailsDto> {
    const { product } =
      await this.connectionService.graphqlForUser<RawProductDetailsResponse>(
        userId,
        PRODUCT_DETAILS_QUERY,
        {
          id: `gid://shopify/Product/${productId}`,
          variantsFirst: pageSize(
            query.variantsFirst,
            SHOPIFY_DEFAULT_PRODUCT_VARIANTS_PAGE_SIZE,
            SHOPIFY_MAX_PAGE_SIZE,
          ),
          variantsAfter: query.variantsAfter?.trim() || null,
          mediaFirst: pageSize(
            query.mediaFirst,
            SHOPIFY_DEFAULT_PRODUCT_MEDIA_PAGE_SIZE,
            SHOPIFY_MAX_PRODUCT_MEDIA_PAGE_SIZE,
          ),
          mediaAfter: query.mediaAfter?.trim() || null,
        },
      );

    if (!product) {
      throw new NotFoundException('Shopify product not found');
    }

    return mapProductDetails(product);
  }

  async listOrders(
    userId: string,
    query: ShopifyDataPageQueryDto,
  ): Promise<ShopifyOrderListResponseDto> {
    const { orders } =
      await this.connectionService.graphqlForUser<RawOrdersResponse>(
        userId,
        ORDERS_QUERY,
        paginationVariables(query),
      );

    return {
      data: orders.nodes.map(mapOrder),
      pageInfo: mapPageInfo(orders.pageInfo),
    };
  }

  async getOrderDetails(
    userId: string,
    orderId: string,
    query: ShopifyOrderDetailsQueryDto,
  ): Promise<ShopifyOrderDetailsDto> {
    const { order } =
      await this.connectionService.graphqlForUser<RawOrderDetailsResponse>(
        userId,
        ORDER_DETAILS_QUERY,
        {
          id: `gid://shopify/Order/${orderId}`,
          lineItemsFirst: pageSize(
            query.lineItemsFirst,
            SHOPIFY_DEFAULT_ORDER_LINE_ITEMS_PAGE_SIZE,
            SHOPIFY_MAX_PAGE_SIZE,
          ),
          lineItemsAfter: query.lineItemsAfter?.trim() || null,
          fulfillmentsFirst: pageSize(
            query.fulfillmentsFirst,
            SHOPIFY_DEFAULT_ORDER_FULFILLMENTS_PAGE_SIZE,
            SHOPIFY_MAX_ORDER_FULFILLMENTS_PAGE_SIZE,
          ),
        },
      );

    if (!order) {
      throw new NotFoundException('Shopify order not found');
    }

    return mapOrderDetails(order);
  }

  async listCustomers(
    userId: string,
    query: ShopifyDataPageQueryDto,
  ): Promise<ShopifyCustomerListResponseDto> {
    const { customers } =
      await this.connectionService.graphqlForUser<RawCustomersResponse>(
        userId,
        CUSTOMERS_QUERY,
        paginationVariables(query),
      );

    return {
      data: customers.nodes.map(mapCustomer),
      pageInfo: mapPageInfo(customers.pageInfo),
    };
  }
}

function paginationVariables(
  query: ShopifyDataPageQueryDto,
): Record<string, unknown> {
  return {
    first: Math.min(
      Math.max(query.first ?? SHOPIFY_DEFAULT_PAGE_SIZE, 1),
      SHOPIFY_MAX_PAGE_SIZE,
    ),
    after: query.after?.trim() || null,
    query: query.query?.trim() || null,
  };
}

function pageSize(
  value: number | undefined,
  fallback: number,
  maximum: number,
): number {
  return Math.min(Math.max(value ?? fallback, 1), maximum);
}

function mapMoney(money: RawMoney): ShopifyMoneyDto {
  return {
    amount: money.amount,
    currencyCode: money.currencyCode,
  };
}

function mapPageInfo(pageInfo: RawPageInfo): ShopifyPageInfoDto {
  return {
    hasNextPage: pageInfo.hasNextPage,
    hasPreviousPage: pageInfo.hasPreviousPage,
    startCursor: pageInfo.startCursor,
    endCursor: pageInfo.endCursor,
  };
}

function mapAddress(
  address: RawShopOverviewResponse['shop']['shopAddress'],
): ShopifyAddressDto {
  return {
    address1: address.address1,
    address2: address.address2,
    city: address.city,
    province: address.province,
    provinceCode: address.provinceCode,
    country: address.country,
    countryCode: address.countryCodeV2,
    zip: address.zip,
    phone: address.phone,
  };
}

function mapProduct(product: RawProduct): ShopifyProductDto {
  return {
    id: product.id,
    title: product.title,
    handle: product.handle,
    status: product.status,
    vendor: product.vendor,
    productType: product.productType,
    tags: product.tags,
    totalInventory: product.totalInventory,
    tracksInventory: product.tracksInventory,
    priceRange: {
      minimum: mapMoney(product.priceRangeV2.minVariantPrice),
      maximum: mapMoney(product.priceRangeV2.maxVariantPrice),
    },
    featuredImage: product.featuredMedia?.preview?.image
      ? {
          url: product.featuredMedia.preview.image.url,
          altText: product.featuredMedia.preview.image.altText,
          width: product.featuredMedia.preview.image.width,
          height: product.featuredMedia.preview.image.height,
        }
      : null,
    createdAt: product.createdAt,
    updatedAt: product.updatedAt,
  };
}

function mapProductDetails(
  product: RawProductDetails,
): ShopifyProductDetailsDto {
  return {
    ...mapProduct({
      ...product,
      featuredMedia: product.featuredMedia
        ? {
            preview: product.featuredMedia.preview,
          }
        : null,
    }),
    legacyResourceId: String(product.legacyResourceId),
    description: product.description,
    descriptionHtml: product.descriptionHtml,
    onlineStoreUrl: product.onlineStoreUrl,
    isGiftCard: product.isGiftCard,
    hasOnlyDefaultVariant: product.hasOnlyDefaultVariant,
    publishedAt: product.publishedAt,
    seo: {
      title: product.seo.title,
      description: product.seo.description,
    },
    options: product.options.map((option) => ({
      id: option.id,
      name: option.name,
      position: option.position,
      values: option.values,
    })),
    media: {
      data: product.media.nodes.map(mapProductMedia),
      pageInfo: mapPageInfo(product.media.pageInfo),
    },
    variants: {
      data: product.variants.nodes.map(mapProductVariant),
      pageInfo: mapPageInfo(product.variants.pageInfo),
    },
  };
}

function mapProductMedia(media: RawProductMedia): ShopifyProductMediaDto {
  return {
    id: media.id,
    altText: media.alt,
    mediaContentType: media.mediaContentType,
    status: media.status,
    previewImage: mapNullableProductImage(media.preview?.image ?? null),
  };
}

function mapProductVariant(
  variant: RawProductVariant,
): ShopifyProductVariantDto {
  return {
    id: variant.id,
    legacyResourceId: String(variant.legacyResourceId),
    title: variant.title,
    displayName: variant.displayName,
    sku: variant.sku,
    barcode: variant.barcode,
    price: variant.price,
    compareAtPrice: variant.compareAtPrice,
    inventoryQuantity: variant.inventoryQuantity,
    availableForSale: variant.availableForSale,
    taxable: variant.taxable,
    inventoryPolicy: variant.inventoryPolicy,
    position: variant.position,
    selectedOptions: variant.selectedOptions.map((option) => ({
      name: option.name,
      value: option.value,
    })),
    image: mapNullableProductImage(variant.image),
    createdAt: variant.createdAt,
    updatedAt: variant.updatedAt,
  };
}

function mapNullableProductImage(
  image: RawProductImage | null,
): ShopifyProductImageDto | null {
  return image
    ? {
        url: image.url,
        altText: image.altText,
        width: image.width,
        height: image.height,
      }
    : null;
}

function mapOrder(order: RawOrder): ShopifyOrderDto {
  return {
    id: order.id,
    name: order.name,
    financialStatus: order.displayFinancialStatus,
    fulfillmentStatus: order.displayFulfillmentStatus,
    totalPrice: mapMoney(order.currentTotalPriceSet.shopMoney),
    itemCount: order.currentSubtotalLineItemsQuantity,
    customer: order.customer
      ? {
          id: order.customer.id,
          displayName: order.customer.displayName,
        }
      : null,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
    processedAt: order.processedAt,
    cancelledAt: order.cancelledAt,
  };
}

function mapOrderDetails(order: RawOrderDetails): ShopifyOrderDetailsDto {
  return {
    ...mapOrder(order),
    legacyResourceId: String(order.legacyResourceId),
    confirmationNumber: order.confirmationNumber,
    currencyCode: order.currencyCode,
    fullyPaid: order.fullyPaid,
    taxesIncluded: order.taxesIncluded,
    test: order.test,
    totals: {
      subtotal: mapMoney(order.currentSubtotalPriceSet.shopMoney),
      discounts: mapMoney(order.currentTotalDiscountsSet.shopMoney),
      shipping: mapMoney(order.currentShippingPriceSet.shopMoney),
      tax: mapMoney(order.currentTotalTaxSet.shopMoney),
      total: mapMoney(order.currentTotalPriceSet.shopMoney),
      refunded: mapMoney(order.totalRefundedSet.shopMoney),
      outstanding: mapMoney(order.totalOutstandingSet.shopMoney),
    },
    discountCodes: order.discountCodes,
    tags: order.tags,
    lineItems: {
      data: order.lineItems.nodes.map(mapOrderLineItem),
      pageInfo: mapPageInfo(order.lineItems.pageInfo),
    },
    fulfillments: order.fulfillments.map(mapOrderFulfillment),
    cancelReason: order.cancelReason,
    closedAt: order.closedAt,
  };
}

function mapOrderLineItem(lineItem: RawOrderLineItem): ShopifyOrderLineItemDto {
  return {
    id: lineItem.id,
    name: lineItem.name,
    title: lineItem.title,
    variantTitle: lineItem.variantTitle,
    sku: lineItem.sku,
    vendor: lineItem.vendor,
    quantity: lineItem.quantity,
    currentQuantity: lineItem.currentQuantity,
    refundableQuantity: lineItem.refundableQuantity,
    unfulfilledQuantity: lineItem.unfulfilledQuantity,
    requiresShipping: lineItem.requiresShipping,
    taxable: lineItem.taxable,
    isGiftCard: lineItem.isGiftCard,
    originalUnitPrice: mapMoney(lineItem.originalUnitPriceSet.shopMoney),
    discountedUnitPrice: mapMoney(lineItem.discountedUnitPriceSet.shopMoney),
    originalTotal: mapMoney(lineItem.originalTotalSet.shopMoney),
    discountedTotal: mapMoney(lineItem.discountedTotalSet.shopMoney),
    totalDiscount: mapMoney(lineItem.totalDiscountSet.shopMoney),
    image: mapNullableProductImage(lineItem.image),
    variant: lineItem.variant
      ? {
          id: lineItem.variant.id,
          legacyResourceId: String(lineItem.variant.legacyResourceId),
        }
      : null,
  };
}

function mapOrderFulfillment(
  fulfillment: RawOrderFulfillment,
): ShopifyOrderFulfillmentDto {
  return {
    id: fulfillment.id,
    legacyResourceId: String(fulfillment.legacyResourceId),
    name: fulfillment.name,
    status: fulfillment.status,
    displayStatus: fulfillment.displayStatus,
    totalQuantity: fulfillment.totalQuantity,
    trackingInfo: fulfillment.trackingInfo.map((tracking) => ({
      company: tracking.company,
      number: tracking.number,
      url: tracking.url,
    })),
    createdAt: fulfillment.createdAt,
    updatedAt: fulfillment.updatedAt,
    deliveredAt: fulfillment.deliveredAt,
    estimatedDeliveryAt: fulfillment.estimatedDeliveryAt,
    inTransitAt: fulfillment.inTransitAt,
  };
}

function mapCustomer(customer: RawCustomer): ShopifyCustomerDto {
  return {
    id: customer.id,
    displayName: customer.displayName,
    firstName: customer.firstName,
    lastName: customer.lastName,
    email: customer.defaultEmailAddress?.emailAddress ?? null,
    phone: customer.defaultPhoneNumber?.phoneNumber ?? null,
    orderCount: String(customer.numberOfOrders),
    amountSpent: mapMoney(customer.amountSpent),
    state: customer.state,
    verifiedEmail: customer.verifiedEmail,
    tags: customer.tags,
    defaultLocation: customer.defaultAddress
      ? {
          city: customer.defaultAddress.city,
          provinceCode: customer.defaultAddress.provinceCode,
          countryCode: customer.defaultAddress.countryCodeV2,
        }
      : null,
    createdAt: customer.createdAt,
    updatedAt: customer.updatedAt,
  };
}
