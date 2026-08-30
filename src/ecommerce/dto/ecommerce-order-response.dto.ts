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

  @ApiPropertyOptional({
    nullable: true,
    example: 'DH564BJ0',
    description:
      'Internal Product Tracking Code, resolved by matching SKU against a linked warehouse variant. Null when the line has no matching warehouse product yet — the courier contents field falls back to the title in that case.',
  })
  productCode?: string | null;
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

  @ApiProperty({
    description: 'Gross sales before discounts',
    example: '249.98',
  })
  grossSales: string;

  @ApiProperty({ description: 'Total discount amount', example: '25.00' })
  discounts: string;

  @ApiProperty({
    description: 'Shipping cost charged to the customer',
    example: '10.00',
  })
  shipping: string;

  @ApiProperty({ description: 'Total refunded amount', example: '0.00' })
  refunds: string;

  @ApiProperty({
    description: 'Net sales after discounts and refunds',
    example: '224.98',
  })
  netSales: string;

  @ApiProperty({
    description: 'Total amount collected from customer',
    example: '234.98',
  })
  totalCollected: string;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Cash on delivery amount (MAD)',
    example: '234.98',
  })
  codAmount: string | null;

  @ApiPropertyOptional({
    nullable: true,
    enum: ['PENDING', 'COLLECTED', 'FAILED'],
  })
  codStatus: string | null;

  @ApiProperty({ description: 'Number of items' })
  itemCount: number;

  @ApiProperty({
    description: 'When the order was processed',
    format: 'date-time',
  })
  processedAt: string;

  @ApiPropertyOptional({ nullable: true, format: 'date-time' })
  cancelledAt: string | null;

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

export class ScannedShipmentProductDto {
  @ApiProperty({ example: 'DH564BJ0' })
  productCode: string;

  @ApiProperty({ example: 'Nike T-Shirt Black M' })
  productName: string;

  @ApiProperty({ example: 2 })
  quantity: number;

  @ApiProperty({
    nullable: true,
    enum: ['GOOD', 'DAMAGED', 'LOST', 'RETURNED', 'MISSING'],
    description: 'Null until a condition has been recorded for this line.',
  })
  condition: string | null;

  @ApiProperty({ nullable: true, example: '120.00' })
  damageCost: string | null;
}

export class ScannedShipmentResponseDto {
  @ApiProperty({ format: 'uuid', description: 'Zomaal internal order ID' })
  orderId: string;

  @ApiProperty({
    nullable: true,
    example: '#10482',
    description: 'Visible order reference shown to the merchant',
  })
  orderName: string | null;

  @ApiProperty({
    enum: ['SENDIT', 'QUICKLIVRAISON', 'FORCELOG', 'OZONEEXPRESS'],
  })
  provider: string;

  @ApiProperty({ example: 'SH92831' })
  trackingNumber: string;

  @ApiProperty({
    enum: ['PENDING', 'DISPATCHED', 'FAILED'],
    description:
      'Whether we succeeded in handing the parcel to the courier. Does not change again after that — this is NOT the shipment tracking status, see `status` for that.',
  })
  dispatchStatus: string;

  @ApiProperty({
    nullable: true,
    enum: [
      'PENDING',
      'CONFIRMED',
      'PICKUP_PENDING',
      'PICKED_UP',
      'AT_WAREHOUSE',
      'IN_TRANSIT',
      'OUT_FOR_DELIVERY',
      'POSTPONED',
      'UNREACHABLE',
      'DELIVERED',
      'CANCELLED',
      'REFUSED',
      'RETURN_PENDING',
      'RETURN_IN_TRANSIT',
      'RETURNED_TO_WAREHOUSE',
      'RETURN_INSPECTION',
      'RETURNED_TO_STOCK',
      'RETURNED_TO_SELLER',
      'UNKNOWN',
    ],
    description:
      'The live carrier shipment status — what the mockup\'s "Current Status: 🟢 In Transit" refers to. Always read fresh from the database, never from a scanned QR payload (status changes after printing). Null only when the courier hasn\'t sent a status update yet.',
  })
  status: string | null;

  @ApiProperty({ type: [ScannedShipmentProductDto] })
  products: ScannedShipmentProductDto[];
}

export class RecordedProductConditionResponseDto {
  @ApiProperty({ format: 'uuid' })
  orderId: string;

  @ApiProperty({ example: 'DH564BJ0' })
  productCode: string;

  @ApiProperty({
    enum: ['GOOD', 'DAMAGED', 'LOST', 'RETURNED', 'MISSING'],
  })
  condition: string;

  @ApiProperty({ nullable: true, example: '120.00' })
  damageCost: string | null;

  @ApiProperty({ nullable: true, example: 'Tear on left sleeve' })
  notes: string | null;

  @ApiProperty({ format: 'date-time' })
  recordedAt: string;

  @ApiProperty({
    description:
      'True when this recorded a stock movement (GOOD/RETURNED restock on-hand, DAMAGED moves to the damaged bucket). False for LOST/MISSING — nothing physical came back — or when the line has no linked inventory item.',
  })
  inventoryUpdated: boolean;
}

export class OrderFinancialEventDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({
    enum: ['REVENUE_RECOGNIZED', 'REVENUE_REVERSED', 'DAMAGE_LOSS'],
  })
  type: string;

  @ApiProperty({ example: '600.00' })
  revenue: string;

  @ApiProperty({ example: '150.00' })
  productCost: string;

  @ApiProperty({ example: '50.00' })
  shippingCost: string;

  @ApiProperty({ example: '0.00' })
  damageCost: string;

  @ApiProperty({
    example: '400.00',
    description: 'Signed contribution to profit from this event.',
  })
  netProfitImpact: string;

  @ApiProperty({ example: 'Carrier marked shipment as delivered' })
  reason: string;

  @ApiProperty({ format: 'date-time' })
  createdAt: string;
}

export class OrderFinancialSummaryDto {
  @ApiProperty({ format: 'uuid' })
  orderId: string;

  @ApiProperty({ example: 'MAD' })
  currency: string;

  @ApiProperty({
    example: '600.00',
    description: 'Recognized revenue net of any reversal — 0 until DELIVERED.',
  })
  revenue: string;

  @ApiProperty({ example: '150.00' })
  productCost: string;

  @ApiProperty({ example: '50.00' })
  shippingCost: string;

  @ApiProperty({ example: '0.00' })
  damageCost: string;

  @ApiProperty({
    example: '400.00',
    description:
      "Sum of every event's netProfitImpact — always correct regardless of event mix.",
  })
  netProfit: string;

  @ApiProperty({ type: [OrderFinancialEventDto] })
  events: OrderFinancialEventDto[];
}

export class FinancialSyncResultDto {
  @ApiProperty({
    description: 'True when this call created a new financial event.',
  })
  applied: boolean;

  @ApiProperty({
    enum: [
      'NOT_DISPATCHED',
      'NO_CARRIER_STATUS_YET',
      'IN_PROGRESS',
      'DELIVERED',
      'CANCELLED',
    ],
    description:
      'NOT_DISPATCHED/NO_CARRIER_STATUS_YET/IN_PROGRESS all mean applied=false with no error — they are expected states, not failures.',
  })
  reason: string;

  @ApiPropertyOptional({
    enum: [
      'PENDING',
      'CONFIRMED',
      'PICKUP_PENDING',
      'PICKED_UP',
      'AT_WAREHOUSE',
      'IN_TRANSIT',
      'OUT_FOR_DELIVERY',
      'POSTPONED',
      'UNREACHABLE',
      'DELIVERED',
      'CANCELLED',
      'REFUSED',
      'RETURN_PENDING',
      'RETURN_IN_TRANSIT',
      'RETURNED_TO_WAREHOUSE',
      'RETURN_INSPECTION',
      'RETURNED_TO_STOCK',
      'RETURNED_TO_SELLER',
      'UNKNOWN',
    ],
    description:
      'The live carrier status this decision was based on. Omitted when there is no linked shipment yet.',
  })
  shipmentStatus?: string;
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
