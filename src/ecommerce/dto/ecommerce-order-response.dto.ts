import { ApiProperty } from '@nestjs/swagger';
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

  @ApiProperty({ description: 'When the order was created on the platform' })
  providerCreatedAt: string;
}

export class EcommerceOrderListDto {
  @ApiProperty({
    type: [EcommerceOrderDto],
    description: 'List of synchronized orders',
  })
  data: EcommerceOrderDto[];

  @ApiProperty({ description: 'Total number of orders matching the filter' })
  total: number;
}
