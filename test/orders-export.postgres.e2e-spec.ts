import { randomUUID } from 'node:crypto';
import {
  EcommerceOrderStatus,
  EcommercePaymentStatus,
  EcommercePlatform,
  PrismaClient,
} from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import ExcelJS from 'exceljs';
import { Pool } from 'pg';
import { StoreAccessService } from '../src/access/store-access.service';
import { EcommerceOrderExportService } from '../src/ecommerce/ecommerce-order-export.service';
import type { PrismaService } from '../src/prisma/prisma.service';

// Explicit opt-in. Never fall back to the application's DATABASE_URL.
const url = process.env.ORDER_EXPORT_TEST_DATABASE_URL;
const postgres = url ? describe : describe.skip;

postgres('Orders Excel export with PostgreSQL', () => {
  let pool: Pool;
  let db: PrismaClient;
  let exporter: EcommerceOrderExportService;
  const ownerIds: string[] = [];
  let firstOwnerId: string;
  let firstOrderId: string;
  let cancelledOrderId: string;

  beforeAll(async () => {
    const parsed = new URL(url!);
    if (!/(?:test|_ci$|_smoke$)/.test(parsed.pathname))
      throw new Error(
        'ORDER_EXPORT_TEST_DATABASE_URL must identify a dedicated test database',
      );
    pool = new Pool({ connectionString: url, max: 5 });
    db = new PrismaClient({ adapter: new PrismaPg(pool) });
    const stores: Array<{ ownerId: string; storeId: string }> = [];
    for (let index = 0; index < 2; index++) {
      const owner = await db.user.create({
        data: { phone: `test-export-${randomUUID()}` },
      });
      ownerIds.push(owner.id);
      const store = await db.store.create({
        data: {
          userId: owner.id,
          ownerName: 'Export test owner',
          businessName: `Export test store ${index}`,
          address: 'Test',
          city: 'Test',
          country: 'MA',
        },
      });
      await db.user.update({
        where: { id: owner.id },
        data: { activeStoreId: store.id },
      });
      stores.push({ ownerId: owner.id, storeId: store.id });
    }
    firstOwnerId = stores[0].ownerId;
    const now = new Date('2026-10-18T10:00:00.000Z');
    const money = {
      grossSales: '120.00',
      discounts: '10.00',
      refunds: '0.00',
      netSales: '110.00',
      shipping: '5.00',
      tax: '0.00',
      totalCollected: '115.00',
    };
    for (const [index, store] of stores.entries()) {
      const connection = await db.ecommerceConnection.create({
        data: {
          storeId: store.storeId,
          platform: EcommercePlatform.MANUAL,
          externalAccountId: `export-test-${randomUUID()}`,
        },
      });
      const primary = await db.ecommerceOrder.create({
        data: {
          connectionId: connection.id,
          externalOrderId: `primary-${randomUUID()}`,
          orderName: index === 0 ? '=1+1' : 'other-store-order',
          status: EcommerceOrderStatus.OPEN,
          financialStatus: EcommercePaymentStatus.PAID,
          fulfillmentStatus: 'fulfilled',
          currency: 'MAD',
          itemCount: 2,
          processedAt: now,
          providerCreatedAt: now,
          providerUpdatedAt: now,
          manualCustomerPhone: 'private-test-phone',
          ...money,
        },
      });
      if (index === 0) {
        firstOrderId = primary.id;
        const cancelled = await db.ecommerceOrder.create({
          data: {
            connectionId: connection.id,
            externalOrderId: `cancelled-${randomUUID()}`,
            orderName: 'cancelled-test-order',
            status: EcommerceOrderStatus.CANCELLED,
            financialStatus: EcommercePaymentStatus.PAID,
            currency: 'MAD',
            processedAt: now,
            providerCreatedAt: now,
            providerUpdatedAt: now,
            cancelledAt: now,
            ...money,
          },
        });
        cancelledOrderId = cancelled.id;
      }
    }
    exporter = new EcommerceOrderExportService(
      db as PrismaService,
      new StoreAccessService(db as PrismaService),
    );
  });

  afterAll(async () => {
    if (db) {
      for (const id of ownerIds) await db.user.delete({ where: { id } });
      await db.$disconnect();
    }
    if (pool) await pool.end();
  });

  it('exports only the active store and respects cancelled-order filters', async () => {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await exporter.exportXlsx(firstOwnerId, {}));
    const sheet = workbook.getWorksheet('Orders');
    expect(sheet?.rowCount).toBe(2);
    expect(sheet?.getCell('A2').value).toBe('=1+1');
    expect(sheet?.getCell('A2').type).toBe(ExcelJS.ValueType.String);
    expect(sheet?.getCell('H2').value).toBe(120);
    expect(sheet?.getCell('Q2').value).toBe('2026-10-18T10:00:00.000Z');
    const cellTexts: string[] = [];
    sheet?.eachRow((row) =>
      row.eachCell((cell) => {
        if (typeof cell.value === 'string') cellTexts.push(cell.value);
      }),
    );
    expect(cellTexts).not.toContain('private-test-phone');
    expect(await db.ecommerceOrder.count({ where: { id: firstOrderId } })).toBe(
      1,
    );

    const inclusive = new ExcelJS.Workbook();
    await inclusive.xlsx.load(
      await exporter.exportXlsx(firstOwnerId, { includeCancelled: true }),
    );
    expect(inclusive.getWorksheet('Orders')?.rowCount).toBe(3);
    expect(
      await db.ecommerceOrder.count({ where: { id: cancelledOrderId } }),
    ).toBe(1);
  });
});
