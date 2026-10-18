import { Injectable, PayloadTooLargeException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import ExcelJS from 'exceljs';
import { StoreAccessService } from '../access/store-access.service';
import { PrismaService } from '../prisma/prisma.service';
import { EcommerceOrderExportQueryDto } from './dto/ecommerce-order-export-query.dto';
import { orderWhere } from './order-filter.util';

export const MAX_ORDER_EXPORT_ROWS = 10_000;
export const ORDERS_XLSX_MIME =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const ORDER_SELECT = {
  externalOrderId: true,
  orderName: true,
  status: true,
  financialStatus: true,
  fulfillmentStatus: true,
  currency: true,
  grossSales: true,
  discounts: true,
  shipping: true,
  refunds: true,
  netSales: true,
  totalCollected: true,
  codAmount: true,
  codStatus: true,
  itemCount: true,
  processedAt: true,
  cancelledAt: true,
  connection: { select: { platform: true } },
  dispatch: {
    select: { provider: true, providerTracking: true, merchantTracking: true },
  },
} satisfies Prisma.EcommerceOrderSelect;

type ExportOrder = Prisma.EcommerceOrderGetPayload<{
  select: typeof ORDER_SELECT;
}>;

const COLUMNS = [
  { header: 'Order reference', key: 'orderReference', width: 24 },
  { header: 'External order ID', key: 'externalOrderId', width: 28 },
  { header: 'Platform', key: 'platform', width: 18 },
  { header: 'Order status', key: 'status', width: 20 },
  { header: 'Payment status', key: 'financialStatus', width: 20 },
  { header: 'Fulfillment status', key: 'fulfillmentStatus', width: 22 },
  { header: 'Currency', key: 'currency', width: 12 },
  { header: 'Gross sales', key: 'grossSales', width: 18 },
  { header: 'Discounts', key: 'discounts', width: 16 },
  { header: 'Shipping charged', key: 'shipping', width: 20 },
  { header: 'Refunds', key: 'refunds', width: 16 },
  { header: 'Net sales', key: 'netSales', width: 18 },
  { header: 'Total collected', key: 'totalCollected', width: 20 },
  { header: 'COD amount', key: 'codAmount', width: 18 },
  { header: 'COD status', key: 'codStatus', width: 18 },
  { header: 'Item count', key: 'itemCount', width: 14 },
  { header: 'Processed at (UTC)', key: 'processedAt', width: 26 },
  { header: 'Cancelled at (UTC)', key: 'cancelledAt', width: 26 },
  { header: 'Courier', key: 'courier', width: 20 },
  { header: 'Tracking number', key: 'tracking', width: 28 },
];

@Injectable()
export class EcommerceOrderExportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storeAccess: StoreAccessService,
  ) {}

  async exportXlsx(
    userId: string,
    query: EcommerceOrderExportQueryDto,
  ): Promise<Buffer> {
    const store = await this.storeAccess.requireStore(userId);
    const orders = await this.prisma.ecommerceOrder.findMany({
      where: orderWhere(store.id, query),
      orderBy: [{ processedAt: 'desc' }, { id: 'desc' }],
      take: MAX_ORDER_EXPORT_ROWS + 1,
      select: ORDER_SELECT,
    });
    if (orders.length > MAX_ORDER_EXPORT_ROWS) {
      throw new PayloadTooLargeException(
        `Export exceeds ${MAX_ORDER_EXPORT_ROWS} orders. Narrow the Orders filters and try again.`,
      );
    }
    return buildWorkbook(orders);
  }
}

async function buildWorkbook(orders: ExportOrder[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Zomaal';
  const sheet = workbook.addWorksheet('Orders');
  sheet.columns = COLUMNS;
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  sheet.autoFilter = { from: 'A1', to: 'T1' };
  sheet.getRow(1).font = { bold: true };

  for (const order of orders) {
    sheet.addRow({
      orderReference: order.orderName ?? order.externalOrderId,
      externalOrderId: order.externalOrderId,
      platform: order.connection.platform,
      status: order.status,
      financialStatus: order.financialStatus,
      fulfillmentStatus: order.fulfillmentStatus ?? '',
      currency: order.currency,
      grossSales: money(order.grossSales),
      discounts: money(order.discounts),
      shipping: money(order.shipping),
      refunds: money(order.refunds),
      netSales: money(order.netSales),
      totalCollected: money(order.totalCollected),
      codAmount: order.codAmount ? money(order.codAmount) : null,
      codStatus: order.codStatus ?? '',
      itemCount: order.itemCount,
      processedAt: order.processedAt.toISOString(),
      cancelledAt: order.cancelledAt?.toISOString() ?? '',
      courier: order.dispatch?.provider ?? '',
      tracking:
        order.dispatch?.providerTracking ??
        order.dispatch?.merchantTracking ??
        '',
    });
  }
  for (const key of [
    'grossSales',
    'discounts',
    'shipping',
    'refunds',
    'netSales',
    'totalCollected',
    'codAmount',
  ]) {
    sheet.getColumn(key).numFmt = '#,##0.00';
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

function money(value: Prisma.Decimal): number {
  return Number(value.toFixed(2));
}
