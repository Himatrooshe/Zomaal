import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ShopifyPageInfoDto {
  @ApiProperty({
    description: 'Whether another page exists after this response.',
    example: true,
  })
  hasNextPage!: boolean;

  @ApiProperty({
    description: 'Whether a page exists before this response.',
    example: false,
  })
  hasPreviousPage!: boolean;

  @ApiPropertyOptional({
    description: 'Cursor for the first returned record.',
    nullable: true,
    example: 'eyJsYXN0X2lkIjo2MzIxMzk1MjE5LCJsYXN0X3ZhbHVlIjoiNjMyMTM5NTIxOSJ9',
  })
  startCursor!: string | null;

  @ApiPropertyOptional({
    description:
      'Cursor to send as `after` when requesting the next page. Treat it as an opaque value.',
    nullable: true,
    example: 'eyJsYXN0X2lkIjo2MzIxMzk1MjIwLCJsYXN0X3ZhbHVlIjoiNjMyMTM5NTIyMCJ9',
  })
  endCursor!: string | null;
}

export class ShopifyMoneyDto {
  @ApiProperty({
    description:
      'Decimal monetary value represented as a string to avoid floating-point precision loss.',
    example: '349.90',
  })
  amount!: string;

  @ApiProperty({
    description: 'ISO 4217 currency code.',
    example: 'MAD',
  })
  currencyCode!: string;
}

export class ShopifyAddressDto {
  @ApiPropertyOptional({ nullable: true, example: '12 Rue Al Massira' })
  address1!: string | null;

  @ApiPropertyOptional({ nullable: true, example: 'Maarif' })
  address2!: string | null;

  @ApiPropertyOptional({ nullable: true, example: 'Casablanca' })
  city!: string | null;

  @ApiPropertyOptional({ nullable: true, example: 'Casablanca-Settat' })
  province!: string | null;

  @ApiPropertyOptional({ nullable: true, example: 'CAS' })
  provinceCode!: string | null;

  @ApiPropertyOptional({ nullable: true, example: 'Morocco' })
  country!: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'ISO 3166-1 alpha-2 country code.',
    example: 'MA',
  })
  countryCode!: string | null;

  @ApiPropertyOptional({ nullable: true, example: '20000' })
  zip!: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Shop contact phone in the format supplied by Shopify.',
    example: '+212612345678',
  })
  phone!: string | null;
}

export class ShopifyPlanDto {
  @ApiProperty({ example: 'Basic' })
  displayName!: string;

  @ApiProperty({ example: false })
  shopifyPlus!: boolean;

  @ApiProperty({
    description: 'Whether this is a Shopify development store.',
    example: false,
  })
  partnerDevelopment!: boolean;
}

export class ShopifyDomainDto {
  @ApiProperty({ example: 'atlas-market.com' })
  host!: string;

  @ApiProperty({ example: 'https://atlas-market.com' })
  url!: string;

  @ApiProperty({
    description: 'Whether SSL is enabled for the Shopify primary domain.',
    example: true,
  })
  sslEnabled!: boolean;
}

export class ShopifyShopOverviewDto {
  @ApiProperty({ example: 'gid://shopify/Shop/123456789' })
  id!: string;

  @ApiProperty({ example: 'Atlas Market' })
  name!: string;

  @ApiProperty({ example: 'atlas-market.myshopify.com' })
  myshopifyDomain!: string;

  @ApiProperty({ example: 'https://atlas-market.com' })
  onlineStoreUrl!: string;

  @ApiProperty({ example: 'hello@atlas-market.com' })
  contactEmail!: string;

  @ApiProperty({ example: 'MAD' })
  currencyCode!: string;

  @ApiProperty({ example: 'Africa/Casablanca' })
  timezone!: string;

  @ApiProperty({
    type: String,
    format: 'date-time',
    example: '2024-10-08T12:00:00.000Z',
  })
  createdAt!: string;

  @ApiProperty({
    type: String,
    format: 'date-time',
    example: '2026-07-19T08:30:00.000Z',
  })
  updatedAt!: string;

  @ApiProperty({ type: ShopifyDomainDto })
  primaryDomain!: ShopifyDomainDto;

  @ApiProperty({ type: ShopifyPlanDto })
  plan!: ShopifyPlanDto;

  @ApiProperty({ type: ShopifyAddressDto })
  address!: ShopifyAddressDto;
}

export class ShopifyProductImageDto {
  @ApiProperty({ example: 'https://cdn.shopify.com/s/files/product.jpg' })
  url!: string;

  @ApiPropertyOptional({
    nullable: true,
    example: 'Black leather handbag',
  })
  altText!: string | null;

  @ApiPropertyOptional({ nullable: true, example: 1200 })
  width!: number | null;

  @ApiPropertyOptional({ nullable: true, example: 1200 })
  height!: number | null;
}

export class ShopifyProductPriceRangeDto {
  @ApiProperty({ type: ShopifyMoneyDto })
  minimum!: ShopifyMoneyDto;

  @ApiProperty({ type: ShopifyMoneyDto })
  maximum!: ShopifyMoneyDto;
}

export class ShopifyProductDto {
  @ApiProperty({ example: 'gid://shopify/Product/6321395219' })
  id!: string;

  @ApiProperty({ example: 'Leather Handbag' })
  title!: string;

  @ApiProperty({ example: 'leather-handbag' })
  handle!: string;

  @ApiProperty({
    description:
      'Shopify product status. Clients should tolerate new enum values in future API versions.',
    enum: ['ACTIVE', 'ARCHIVED', 'DRAFT', 'UNLISTED'],
    example: 'ACTIVE',
  })
  status!: string;

  @ApiProperty({ example: 'Atlas' })
  vendor!: string;

  @ApiProperty({ example: 'Handbags' })
  productType!: string;

  @ApiProperty({ type: [String], example: ['leather', 'women'] })
  tags!: string[];

  @ApiProperty({
    description:
      'Inventory summed across variants. Negative values can represent oversold inventory.',
    example: 18,
  })
  totalInventory!: number;

  @ApiProperty({
    description:
      'Whether at least one product variant has inventory tracking enabled.',
    example: true,
  })
  tracksInventory!: boolean;

  @ApiProperty({ type: ShopifyProductPriceRangeDto })
  priceRange!: ShopifyProductPriceRangeDto;

  @ApiPropertyOptional({
    type: ShopifyProductImageDto,
    nullable: true,
  })
  featuredImage!: ShopifyProductImageDto | null;

  @ApiProperty({
    type: String,
    format: 'date-time',
    example: '2026-07-01T10:30:00.000Z',
  })
  createdAt!: string;

  @ApiProperty({
    type: String,
    format: 'date-time',
    example: '2026-07-18T15:40:00.000Z',
  })
  updatedAt!: string;
}

export class ShopifyProductListResponseDto {
  @ApiProperty({ type: [ShopifyProductDto] })
  data!: ShopifyProductDto[];

  @ApiProperty({ type: ShopifyPageInfoDto })
  pageInfo!: ShopifyPageInfoDto;
}

export class ShopifyOrderCustomerDto {
  @ApiProperty({ example: 'gid://shopify/Customer/7321395219' })
  id!: string;

  @ApiProperty({ example: 'Sara Amrani' })
  displayName!: string;
}

export class ShopifyOrderDto {
  @ApiProperty({ example: 'gid://shopify/Order/8321395219' })
  id!: string;

  @ApiProperty({ example: '#1042' })
  name!: string;

  @ApiPropertyOptional({
    nullable: true,
    enum: [
      'AUTHORIZED',
      'EXPIRED',
      'PAID',
      'PARTIALLY_PAID',
      'PARTIALLY_REFUNDED',
      'PENDING',
      'REFUNDED',
      'VOIDED',
    ],
    example: 'PAID',
  })
  financialStatus!: string | null;

  @ApiProperty({
    enum: [
      'FULFILLED',
      'IN_PROGRESS',
      'ON_HOLD',
      'OPEN',
      'PARTIALLY_FULFILLED',
      'PENDING_FULFILLMENT',
      'REQUEST_DECLINED',
      'RESTOCKED',
      'SCHEDULED',
      'UNFULFILLED',
    ],
    example: 'UNFULFILLED',
  })
  fulfillmentStatus!: string;

  @ApiProperty({ type: ShopifyMoneyDto })
  totalPrice!: ShopifyMoneyDto;

  @ApiProperty({
    description:
      'Current quantity of subtotal-contributing items after returns, refunds, edits, and cancellations.',
    example: 3,
  })
  itemCount!: number;

  @ApiPropertyOptional({ type: ShopifyOrderCustomerDto, nullable: true })
  customer!: ShopifyOrderCustomerDto | null;

  @ApiProperty({
    type: String,
    format: 'date-time',
    example: '2026-07-18T15:40:00.000Z',
  })
  createdAt!: string;

  @ApiProperty({
    type: String,
    format: 'date-time',
    example: '2026-07-18T15:45:00.000Z',
  })
  updatedAt!: string;

  @ApiPropertyOptional({
    type: String,
    format: 'date-time',
    nullable: true,
    description:
      'When the order was processed. Can be null for orders that have not been processed.',
    example: '2026-07-18T15:41:00.000Z',
  })
  processedAt!: string | null;

  @ApiPropertyOptional({
    type: String,
    format: 'date-time',
    nullable: true,
    example: null,
  })
  cancelledAt!: string | null;
}

export class ShopifyOrderListResponseDto {
  @ApiProperty({ type: [ShopifyOrderDto] })
  data!: ShopifyOrderDto[];

  @ApiProperty({ type: ShopifyPageInfoDto })
  pageInfo!: ShopifyPageInfoDto;
}

export class ShopifyCustomerLocationDto {
  @ApiPropertyOptional({ nullable: true, example: 'Casablanca' })
  city!: string | null;

  @ApiPropertyOptional({ nullable: true, example: 'CAS' })
  provinceCode!: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'ISO 3166-1 alpha-2 country code.',
    example: 'MA',
  })
  countryCode!: string | null;
}

export class ShopifyCustomerDto {
  @ApiProperty({ example: 'gid://shopify/Customer/7321395219' })
  id!: string;

  @ApiProperty({ example: 'Sara Amrani' })
  displayName!: string;

  @ApiPropertyOptional({ nullable: true, example: 'Sara' })
  firstName!: string | null;

  @ApiPropertyOptional({ nullable: true, example: 'Amrani' })
  lastName!: string | null;

  @ApiPropertyOptional({ nullable: true, example: 'sara@example.com' })
  email!: string | null;

  @ApiPropertyOptional({ nullable: true, example: '+212612345678' })
  phone!: string | null;

  @ApiProperty({
    description:
      'Order count represented as a string because Shopify returns an unsigned 64-bit integer.',
    example: '4',
  })
  orderCount!: string;

  @ApiProperty({ type: ShopifyMoneyDto })
  amountSpent!: ShopifyMoneyDto;

  @ApiProperty({
    enum: ['DECLINED', 'DISABLED', 'ENABLED', 'INVITED'],
    example: 'ENABLED',
  })
  state!: string;

  @ApiProperty({ example: true })
  verifiedEmail!: boolean;

  @ApiProperty({ type: [String], example: ['VIP', 'repeat-customer'] })
  tags!: string[];

  @ApiPropertyOptional({
    type: ShopifyCustomerLocationDto,
    nullable: true,
  })
  defaultLocation!: ShopifyCustomerLocationDto | null;

  @ApiProperty({
    type: String,
    format: 'date-time',
    example: '2025-11-12T09:15:00.000Z',
  })
  createdAt!: string;

  @ApiProperty({
    type: String,
    format: 'date-time',
    example: '2026-07-18T15:40:00.000Z',
  })
  updatedAt!: string;
}

export class ShopifyCustomerListResponseDto {
  @ApiProperty({ type: [ShopifyCustomerDto] })
  data!: ShopifyCustomerDto[];

  @ApiProperty({ type: ShopifyPageInfoDto })
  pageInfo!: ShopifyPageInfoDto;
}
