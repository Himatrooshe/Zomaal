import { PayloadTooLargeException } from '@nestjs/common';
import {
  EcommercePaymentStatus,
  EcommercePlatform,
  EcommerceOrderStatus,
  Prisma,
} from '@prisma/client';
import ExcelJS from 'exceljs';
import { StoreAccessService } from '../access/store-access.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  EcommerceOrderExportService,
  MAX_ORDER_EXPORT_ROWS,
} from './ecommerce-order-export.service';

const order = {
  externalOrderId: 'external-42',
  orderName: '=1+1',
  status: EcommerceOrderStatus.OPEN,
  financialStatus: EcommercePaymentStatus.PAID,
  fulfillmentStatus: 'fulfilled',
  currency: 'MAD',
  grossSales: new Prisma.Decimal('120.00'),
  discounts: new Prisma.Decimal('10.00'),
  shipping: new Prisma.Decimal('5.00'),
  refunds: new Prisma.Decimal('0.00'),
  netSales: new Prisma.Decimal('110.00'),
  totalCollected: new Prisma.Decimal('115.00'),
  codAmount: null,
  codStatus: null,
  itemCount: 2,
  processedAt: new Date('2026-10-18T10:00:00.000Z'),
  cancelledAt: null,
  connection: { platform: EcommercePlatform.SHOPIFY },
  dispatch: {
    provider: 'SENDIT',
    providerTracking: 'TRK-42',
    merchantTracking: 'M-42',
  },
};

describe('EcommerceOrderExportService', () => {
  const findMany = jest.fn();
  const service = new EcommerceOrderExportService(
    { ecommerceOrder: { findMany } } as unknown as PrismaService,
    {
      requireStore: jest.fn().mockResolvedValue({ id: 'store-a' }),
    } as unknown as StoreAccessService,
  );

  beforeEach(() => jest.clearAllMocks());

  it('exports matching store orders as an actual XLSX with numeric money and text references', async () => {
    findMany.mockResolvedValue([order]);

    const buffer = await service.exportXlsx('owner-a', {
      platform: EcommercePlatform.SHOPIFY,
      includeCancelled: true,
      includeRefunded: true,
      includeDispatched: true,
    });
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const sheet = workbook.getWorksheet('Orders');

    expect(buffer.subarray(0, 2).toString()).toBe('PK');
    expect(sheet?.rowCount).toBe(2);
    expect(sheet?.getCell('A2').value).toBe('=1+1');
    expect(sheet?.getCell('A2').type).toBe(ExcelJS.ValueType.String);
    expect(sheet?.getCell('H2').value).toBe(120);
    expect(sheet?.getCell('S2').value).toBe('SENDIT');
    expect(sheet?.getCell('T2').value).toBe('TRK-42');
    expect(sheet?.getCell('H2').numFmt).toBe('#,##0.00');
    expect(sheet?.getRow(1).font.bold).toBe(true);
    expect(sheet?.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 });
    expect(sheet?.autoFilter).toBe('A1:T1');
    const calls = findMany.mock.calls as unknown as Array<
      [Prisma.EcommerceOrderFindManyArgs]
    >;
    expect(calls[0][0].where).toMatchObject({
      connection: { storeId: 'store-a', platform: 'SHOPIFY' },
    });
    expect(calls[0][0].take).toBe(MAX_ORDER_EXPORT_ROWS + 1);
  });

  it('returns a usable header-only workbook for no matching orders', async () => {
    findMany.mockResolvedValue([]);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await service.exportXlsx('owner-a', {}));
    expect(workbook.getWorksheet('Orders')?.rowCount).toBe(1);
    const calls = findMany.mock.calls as unknown as Array<
      [Prisma.EcommerceOrderFindManyArgs]
    >;
    expect(calls[0][0].where).toMatchObject({
      connection: { storeId: 'store-a' },
      status: { not: 'CANCELLED' },
      dispatch: { is: null },
    });
  });

  it('rejects oversized exports instead of sending a partial workbook', async () => {
    findMany.mockResolvedValue(Array(MAX_ORDER_EXPORT_ROWS + 1).fill(order));
    await expect(service.exportXlsx('owner-a', {})).rejects.toThrow(
      PayloadTooLargeException,
    );
  });

  it('exports the full supported boundary with unique text references and numeric amounts', async () => {
    findMany.mockResolvedValue(
      Array.from({ length: MAX_ORDER_EXPORT_ROWS }, (_, index) => ({
        ...order,
        orderName: `=QA-${index}`,
        externalOrderId: `boundary-${index}`,
      })),
    );
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await service.exportXlsx('owner-a', {}));
    const sheet = workbook.getWorksheet('Orders')!;
    expect(sheet.rowCount).toBe(MAX_ORDER_EXPORT_ROWS + 1);
    expect(sheet.columnCount).toBe(20);
    expect(sheet.getCell('B2').value).toBe('boundary-0');
    expect(sheet.getCell(`B${sheet.rowCount}`).value).toBe('boundary-9999');
    const references = new Set<string>();
    sheet.eachRow((row, index) => {
      if (index === 1) return;
      references.add(row.getCell(2).text);
      expect(row.getCell(1).type).toBe(ExcelJS.ValueType.String);
      expect(row.getCell(8).value).toBe(120);
      expect(row.getCell(8).numFmt).toBe('#,##0.00');
    });
    expect(references.size).toBe(MAX_ORDER_EXPORT_ROWS);
  });
});
