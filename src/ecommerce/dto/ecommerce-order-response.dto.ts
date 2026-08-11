import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  EcommerceOrderStatus,
  EcommercePaymentStatus,
  EcommercePlatform,
} from '@prisma/client';

export class FulfillmentLineItemDto {
  @ApiProperty({ description: 'Product title' })
  title: string;

  @ApiProperty({ description: 'Product SKU' })
  sku: string;

  @ApiProperty({ description: 'Quantity to fulfill' })
  quantity: number;
}

export class EcommerceOrderProductDto {
  @ApiProperty({ description: 'Provider line-item or snapshot identifier' })
  lineItemId: string;

  @ApiPropertyOptional({ nullable: true })
  productId: string | null;

  @ApiPropertyOptional({ nullable: true })
  variantId: string | null;

  @ApiProperty({ description: 'Product title captured on the order' })
  title: string;

  @ApiPropertyOptional({ nullable: true })
  variantTitle: string | null;

  @ApiPropertyOptional({ nullable: true })
  sku: string | null;

  @ApiProperty({ minimum: 1 })
  quantity: number;

  @ApiPropertyOptional({ nullable: true, example: '149.9000' })
  unitPrice: string | null;

  @ApiPropertyOptional({ nullable: true, example: '299.8000' })
  totalPrice: string | null;

  @ApiProperty({ example: 'MAD' })
  currency: string;

  @ApiPropertyOptional({ nullable: true, format: 'uri' })
  imageUrl: string | null;
}

export class EcommerceOrderProductsDto {
  @ApiProperty({ description: 'Zomaal internal order ID', format: 'uuid' })
  orderId: string;

  @ApiProperty({ enum: EcommercePlatform })
  platform: EcommercePlatform;

  @ApiProperty({ description: 'Source-platform order identifier' })
  externalOrderId: string;

  @ApiProperty({ description: 'Visible source order reference' })
  orderReference: string;

  @ApiProperty({ example: 'MAD' })
  currency: string;

  @ApiProperty({ description: 'Total quantity across returned product lines' })
  itemCount: number;

  @ApiProperty({ description: 'Number of distinct returned product lines' })
  productLineCount: number;

  @ApiProperty({
    description:
      'False only when the provider order contains more lines than this response can safely return.',
  })
  complete: boolean;

  @ApiProperty({ type: [EcommerceOrderProductDto] })
  products: EcommerceOrderProductDto[];
}

export class EcommerceFulfillmentPreviewDto {
  @ApiProperty({ enum: EcommercePlatform, description: 'Source platform' })
  platform: EcommercePlatform;

  @ApiProperty({ description: 'External order identifier' })
  externalOrderId: string;

  @ApiProperty({ description: 'Visible order reference (e.g. #1001)' })
  orderReference: string;

  @ApiProperty({
    description: 'Recipient name',
    required: false,
    nullable: true,
  })
  recipientName: string | null;

  @ApiProperty({
    description: 'Recipient phone number',
    required: false,
    nullable: true,
  })
  recipientPhone: string | null;

  @ApiProperty({
    description: 'Combined address lines',
    required: false,
    nullable: true,
  })
  address: string | null;

  @ApiProperty({ description: 'City', required: false, nullable: true })
  city: string | null;

  @ApiProperty({ description: 'Country', required: false, nullable: true })
  country: string | null;

  @ApiProperty({ description: 'Order currency (e.g. MAD, USD)' })
  currency: string;

  @ApiProperty({ description: 'Outstanding amount / Cash On Delivery amount' })
  codAmount: string;

  @ApiProperty({
    type: [FulfillmentLineItemDto],
    description: 'Unfulfilled physical line items',
  })
  lineItems: FulfillmentLineItemDto[];

  @ApiProperty({
    description: 'Customer notes',
    required: false,
    nullable: true,
  })
  notes: string | null;

  @ApiProperty({
    enum: EcommerceOrderStatus,
    description: 'Platform order status',
  })
  status: EcommerceOrderStatus;

  @ApiProperty({
    enum: EcommercePaymentStatus,
    description: 'Financial payment status',
  })
  financialStatus: EcommercePaymentStatus;

  @ApiProperty({
    description: 'Fulfillment status from platform',
    required: false,
    nullable: true,
  })
  fulfillmentStatus: string | null;
}

export class EcommerceOrderDto {
  @ApiProperty({ description: 'Zomaal internal order ID' })
  id: string;

  @ApiProperty({ description: 'External order ID' })
  externalOrderId: string;

  @ApiProperty({ description: 'Order name/reference' })
  orderName: string | null;

  @ApiProperty({ enum: EcommercePlatform, description: 'Source platform' })
  platform: EcommercePlatform;

  @ApiProperty({ enum: EcommerceOrderStatus })
  status: EcommerceOrderStatus;

  @ApiProperty({ enum: EcommercePaymentStatus })
  financialStatus: EcommercePaymentStatus;

  @ApiProperty({ description: 'Fulfillment status' })
  fulfillmentStatus: string | null;

  @ApiProperty({ description: 'Order currency' })
  currency: string;

  @ApiProperty({ description: 'Order gross sales' })
  grossSales: string;

  @ApiProperty({ description: 'Order total collected' })
  totalCollected: string;

  @ApiProperty({ description: 'Number of items' })
  itemCount: number;

  @ApiProperty({ description: 'When the order was processed' })
  processedAt: string;

  @ApiPropertyOptional({
    type: () => EcommerceOrderDispatchDto,
    nullable: true,
  })
  dispatch: EcommerceOrderDispatchDto | null;
}

export class EcommerceOrderDispatchDto {
  @ApiProperty({
    enum: ['SENDIT', 'QUICKLIVRAISON', 'FORCELOG', 'OZONEEXPRESS'],
  })
  provider: string;

  @ApiProperty({ example: 'ORD-A1B2C3D4' })
  merchantTracking: string;

  @ApiPropertyOptional({ nullable: true, example: 'OZ123456789MA' })
  providerTracking: string | null;

  @ApiProperty({ enum: ['PENDING', 'DISPATCHED', 'FAILED'] })
  status: string;

  @ApiPropertyOptional({ nullable: true })
  errorMessage: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt: string;
}

export class PaginationDto {
  @ApiProperty({ description: 'Total number of items' })
  total: number;

  @ApiProperty({ description: 'Current page number' })
  page: number;

  @ApiProperty({ description: 'Number of items per page' })
  limit: number;

  @ApiProperty({ description: 'Total number of pages' })
  totalPages: number;
}

export class EcommerceOrderListDto {
  @ApiProperty({
    type: [EcommerceOrderDto],
    description: 'List of synchronized orders',
  })
  data: EcommerceOrderDto[];

  @ApiProperty({ type: PaginationDto, description: 'Pagination metadata' })
  pagination: PaginationDto;
}
