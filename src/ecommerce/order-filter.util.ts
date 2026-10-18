import { Prisma } from '@prisma/client';
import { EcommerceOrderQueryDto } from './dto/ecommerce-order-query.dto';

/** Shared list/export scope so the downloaded rows match the Orders screen. */
export function orderWhere(
  storeId: string,
  query: EcommerceOrderQueryDto,
): Prisma.EcommerceOrderWhereInput {
  const connection: Prisma.EcommerceConnectionWhereInput = { storeId };
  if (query.platform) connection.platform = query.platform;
  if (query.includeInRevenue !== undefined)
    connection.includeInRevenue = query.includeInRevenue;

  const where: Prisma.EcommerceOrderWhereInput = { connection };
  if (query.financialStatus) where.financialStatus = query.financialStatus;
  if (query.fulfillmentStatus)
    where.fulfillmentStatus = query.fulfillmentStatus;
  if (query.search) {
    where.OR = [
      { externalOrderId: query.search },
      { orderName: { contains: query.search, mode: 'insensitive' } },
    ];
  }
  if (!query.includeCancelled) where.status = { not: 'CANCELLED' };
  if (!query.includeRefunded && !query.financialStatus)
    where.financialStatus = { notIn: ['REFUNDED', 'PARTIALLY_REFUNDED'] };
  if (!query.includeDispatched) where.dispatch = { is: null };
  return where;
}
