import { Injectable } from '@nestjs/common';
import { ShopifyConnectionService } from './shopify-connection.service';
import {
  SHOPIFY_DEFAULT_PAGE_SIZE,
  SHOPIFY_MAX_PAGE_SIZE,
  type ShopifyDataPageQueryDto,
} from './dto/shopify-data-query.dto';
import type {
  ShopifyAddressDto,
  ShopifyCustomerDto,
  ShopifyCustomerListResponseDto,
  ShopifyMoneyDto,
  ShopifyOrderDto,
  ShopifyOrderListResponseDto,
  ShopifyPageInfoDto,
  ShopifyProductDto,
  ShopifyProductListResponseDto,
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

interface RawOrder {
  id: string;
  name: string;
  displayFinancialStatus: string | null;
  displayFulfillmentStatus: string;
  currentTotalPriceSet: {
    shopMoney: RawMoney;
  };
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
