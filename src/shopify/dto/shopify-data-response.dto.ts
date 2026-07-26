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

export class ShopifyProductSeoDto {
  @ApiPropertyOptional({
    nullable: true,
    example: 'The Collection Snowboard: Hydrogen',
  })
  title!: string | null;

  @ApiPropertyOptional({
    nullable: true,
    example: 'A responsive, all-mountain snowboard.',
  })
  description!: string | null;
}

export class ShopifyProductOptionDto {
  @ApiProperty({ example: 'gid://shopify/ProductOption/123456789' })
  id!: string;

  @ApiProperty({ example: 'Size' })
  name!: string;

  @ApiProperty({ example: 1 })
  position!: number;

  @ApiProperty({ type: [String], example: ['154 cm', '158 cm'] })
  values!: string[];
}

export class ShopifyProductSelectedOptionDto {
  @ApiProperty({ example: 'Size' })
  name!: string;

  @ApiProperty({ example: '154 cm' })
  value!: string;
}

export class ShopifyProductMediaDto {
  @ApiProperty({ example: 'gid://shopify/MediaImage/123456789' })
  id!: string;

  @ApiPropertyOptional({ nullable: true, example: 'Hydrogen snowboard' })
  altText!: string | null;

  @ApiProperty({
    enum: ['EXTERNAL_VIDEO', 'IMAGE', 'MODEL_3D', 'VIDEO'],
    example: 'IMAGE',
  })
  mediaContentType!: string;

  @ApiProperty({
    enum: ['FAILED', 'PROCESSING', 'READY', 'UPLOADED'],
    example: 'READY',
  })
  status!: string;

  @ApiPropertyOptional({ type: ShopifyProductImageDto, nullable: true })
  previewImage!: ShopifyProductImageDto | null;
}

export class ShopifyProductMediaConnectionDto {
  @ApiProperty({ type: [ShopifyProductMediaDto] })
  data!: ShopifyProductMediaDto[];

  @ApiProperty({ type: ShopifyPageInfoDto })
  pageInfo!: ShopifyPageInfoDto;
}

export class ShopifyProductVariantDto {
  @ApiProperty({ example: 'gid://shopify/ProductVariant/123456789' })
  id!: string;

  @ApiProperty({
    description:
      'Numeric REST-compatible Shopify variant ID represented as a string.',
    example: '123456789',
  })
  legacyResourceId!: string;

  @ApiProperty({ example: '154 cm' })
  title!: string;

  @ApiProperty({ example: 'The Collection Snowboard: Hydrogen - 154 cm' })
  displayName!: string;

  @ApiPropertyOptional({ nullable: true, example: 'HYDROGEN-154' })
  sku!: string | null;

  @ApiPropertyOptional({ nullable: true, example: '0123456789012' })
  barcode!: string | null;

  @ApiProperty({
    description: 'Decimal price in the shop currency, represented as a string.',
    example: '600.00',
  })
  price!: string;

  @ApiPropertyOptional({
    nullable: true,
    description:
      'Decimal compare-at price in the shop currency, represented as a string.',
    example: '650.00',
  })
  compareAtPrice!: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description:
      'Aggregate inventory across locations. Null when Shopify does not expose a quantity.',
    example: 12,
  })
  inventoryQuantity!: number | null;

  @ApiProperty({ example: true })
  availableForSale!: boolean;

  @ApiProperty({ example: true })
  taxable!: boolean;

  @ApiProperty({
    enum: ['CONTINUE', 'DENY'],
    description: 'Behavior when inventory reaches zero.',
    example: 'DENY',
  })
  inventoryPolicy!: string;

  @ApiProperty({ example: 1 })
  position!: number;

  @ApiProperty({ type: [ShopifyProductSelectedOptionDto] })
  selectedOptions!: ShopifyProductSelectedOptionDto[];

  @ApiPropertyOptional({ type: ShopifyProductImageDto, nullable: true })
  image!: ShopifyProductImageDto | null;

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

export class ShopifyProductVariantConnectionDto {
  @ApiProperty({ type: [ShopifyProductVariantDto] })
  data!: ShopifyProductVariantDto[];

  @ApiProperty({ type: ShopifyPageInfoDto })
  pageInfo!: ShopifyPageInfoDto;
}

export class ShopifyProductDetailsDto extends ShopifyProductDto {
  @ApiProperty({
    description:
      'Numeric REST-compatible Shopify product ID represented as a string.',
    example: '9172411547890',
  })
  legacyResourceId!: string;

  @ApiProperty({
    example: 'A responsive, all-mountain snowboard.',
  })
  description!: string;

  @ApiProperty({
    description:
      'Merchant-authored HTML. Treat as untrusted content and sanitize before rendering.',
    example: '<p>A responsive, all-mountain snowboard.</p>',
  })
  descriptionHtml!: string;

  @ApiPropertyOptional({
    nullable: true,
    example:
      'https://zomaal-dev.myshopify.com/products/the-collection-snowboard-hydrogen',
  })
  onlineStoreUrl!: string | null;

  @ApiProperty({ example: false })
  isGiftCard!: boolean;

  @ApiProperty({ example: false })
  hasOnlyDefaultVariant!: boolean;

  @ApiPropertyOptional({
    type: String,
    format: 'date-time',
    nullable: true,
    example: '2026-07-01T10:30:00.000Z',
  })
  publishedAt!: string | null;

  @ApiProperty({ type: ShopifyProductSeoDto })
  seo!: ShopifyProductSeoDto;

  @ApiProperty({ type: [ShopifyProductOptionDto] })
  options!: ShopifyProductOptionDto[];

  @ApiProperty({ type: ShopifyProductMediaConnectionDto })
  media!: ShopifyProductMediaConnectionDto;

  @ApiProperty({ type: ShopifyProductVariantConnectionDto })
  variants!: ShopifyProductVariantConnectionDto;
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

export class ShopifyOrderTotalsDto {
  @ApiProperty({ type: ShopifyMoneyDto })
  subtotal!: ShopifyMoneyDto;

  @ApiProperty({ type: ShopifyMoneyDto })
  discounts!: ShopifyMoneyDto;

  @ApiProperty({ type: ShopifyMoneyDto })
  shipping!: ShopifyMoneyDto;

  @ApiProperty({ type: ShopifyMoneyDto })
  tax!: ShopifyMoneyDto;

  @ApiProperty({ type: ShopifyMoneyDto })
  total!: ShopifyMoneyDto;

  @ApiProperty({ type: ShopifyMoneyDto })
  refunded!: ShopifyMoneyDto;

  @ApiProperty({ type: ShopifyMoneyDto })
  outstanding!: ShopifyMoneyDto;
}

export class ShopifyOrderLineItemVariantDto {
  @ApiProperty({ example: 'gid://shopify/ProductVariant/43729072111858' })
  id!: string;

  @ApiProperty({
    description:
      'REST-compatible numeric Shopify variant ID represented as a string.',
    example: '43729072111858',
  })
  legacyResourceId!: string;
}

export class ShopifyOrderLineItemDto {
  @ApiProperty({ example: 'gid://shopify/LineItem/14028667248882' })
  id!: string;

  @ApiProperty({ example: 'Hydrogen Snowboard - 154 cm' })
  name!: string;

  @ApiProperty({ example: 'Hydrogen Snowboard' })
  title!: string;

  @ApiPropertyOptional({ nullable: true, example: '154 cm' })
  variantTitle!: string | null;

  @ApiPropertyOptional({ nullable: true, example: 'HYDROGEN-154' })
  sku!: string | null;

  @ApiPropertyOptional({ nullable: true, example: 'Hydrogen Vendor' })
  vendor!: string | null;

  @ApiProperty({ example: 2 })
  quantity!: number;

  @ApiProperty({ example: 2 })
  currentQuantity!: number;

  @ApiProperty({ example: 2 })
  refundableQuantity!: number;

  @ApiProperty({ example: 2 })
  unfulfilledQuantity!: number;

  @ApiProperty({ example: true })
  requiresShipping!: boolean;

  @ApiProperty({ example: true })
  taxable!: boolean;

  @ApiProperty({ example: false })
  isGiftCard!: boolean;

  @ApiProperty({ type: ShopifyMoneyDto })
  originalUnitPrice!: ShopifyMoneyDto;

  @ApiProperty({ type: ShopifyMoneyDto })
  discountedUnitPrice!: ShopifyMoneyDto;

  @ApiProperty({ type: ShopifyMoneyDto })
  originalTotal!: ShopifyMoneyDto;

  @ApiProperty({ type: ShopifyMoneyDto })
  discountedTotal!: ShopifyMoneyDto;

  @ApiProperty({ type: ShopifyMoneyDto })
  totalDiscount!: ShopifyMoneyDto;

  @ApiPropertyOptional({
    type: ShopifyProductImageDto,
    nullable: true,
  })
  image!: ShopifyProductImageDto | null;

  @ApiPropertyOptional({
    type: ShopifyOrderLineItemVariantDto,
    nullable: true,
  })
  variant!: ShopifyOrderLineItemVariantDto | null;
}

export class ShopifyOrderLineItemConnectionDto {
  @ApiProperty({ type: [ShopifyOrderLineItemDto] })
  data!: ShopifyOrderLineItemDto[];

  @ApiProperty({ type: ShopifyPageInfoDto })
  pageInfo!: ShopifyPageInfoDto;
}

export class ShopifyFulfillmentTrackingInfoDto {
  @ApiPropertyOptional({ nullable: true, example: 'DHL Express' })
  company!: string | null;

  @ApiPropertyOptional({ nullable: true, example: 'JD0146000062812345' })
  number!: string | null;

  @ApiPropertyOptional({
    nullable: true,
    example: 'https://www.dhl.com/global-en/home/tracking.html',
  })
  url!: string | null;
}

export class ShopifyOrderFulfillmentDto {
  @ApiProperty({ example: 'gid://shopify/Fulfillment/5180048834802' })
  id!: string;

  @ApiProperty({
    description:
      'REST-compatible numeric Shopify fulfillment ID represented as a string.',
    example: '5180048834802',
  })
  legacyResourceId!: string;

  @ApiProperty({ example: '#1042.1' })
  name!: string;

  @ApiProperty({ example: 'SUCCESS' })
  status!: string;

  @ApiPropertyOptional({ nullable: true, example: 'IN_TRANSIT' })
  displayStatus!: string | null;

  @ApiProperty({ example: 2 })
  totalQuantity!: number;

  @ApiProperty({ type: [ShopifyFulfillmentTrackingInfoDto] })
  trackingInfo!: ShopifyFulfillmentTrackingInfoDto[];

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: string;

  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
  deliveredAt!: string | null;

  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
  estimatedDeliveryAt!: string | null;

  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
  inTransitAt!: string | null;
}

export class ShopifyOrderDetailsDto extends ShopifyOrderDto {
  @ApiProperty({
    description:
      'REST-compatible numeric Shopify order ID represented as a string.',
    example: '6632134869234',
  })
  legacyResourceId!: string;

  @ApiPropertyOptional({ nullable: true, example: 'ABC123XYZ' })
  confirmationNumber!: string | null;

  @ApiProperty({ example: 'MAD' })
  currencyCode!: string;

  @ApiProperty({ example: true })
  fullyPaid!: boolean;

  @ApiProperty({ example: false })
  taxesIncluded!: boolean;

  @ApiProperty({ example: false })
  test!: boolean;

  @ApiProperty({ type: ShopifyOrderTotalsDto })
  totals!: ShopifyOrderTotalsDto;

  @ApiProperty({ type: [String], example: ['SUMMER10'] })
  discountCodes!: string[];

  @ApiProperty({ type: [String], example: ['mobile', 'priority'] })
  tags!: string[];

  @ApiProperty({ type: ShopifyOrderLineItemConnectionDto })
  lineItems!: ShopifyOrderLineItemConnectionDto;

  @ApiProperty({ type: [ShopifyOrderFulfillmentDto] })
  fulfillments!: ShopifyOrderFulfillmentDto[];

  @ApiPropertyOptional({ nullable: true, example: null })
  cancelReason!: string | null;

  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
  closedAt!: string | null;
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
