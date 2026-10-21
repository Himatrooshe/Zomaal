// Run after npm run build: node --max-old-space-size=96 scripts/test-order-export-memory.cjs
// Exercise the compiled production exporter within a small V8 heap. The regular
// unit test reads every exported row and checks the workbook's values/styles.
const assert = require('node:assert/strict');
const { Prisma } = require('@prisma/client');
const {
  EcommerceOrderExportService,
  MAX_ORDER_EXPORT_ROWS,
} = require('../dist/ecommerce/ecommerce-order-export.service');

async function main() {
  const zero = new Prisma.Decimal(0);
  const timestamp = new Date('2026-10-22T00:00:00Z');
  const orders = Array.from({ length: MAX_ORDER_EXPORT_ROWS }, (_, index) => ({
    externalOrderId: `memory-test-${index}`,
    orderName: `=QA-${index}`,
    status: 'OPEN',
    financialStatus: 'PENDING',
    fulfillmentStatus: null,
    currency: 'MAD',
    grossSales: zero,
    discounts: zero,
    shipping: zero,
    refunds: zero,
    netSales: zero,
    totalCollected: zero,
    codAmount: null,
    codStatus: null,
    itemCount: 0,
    processedAt: timestamp,
    cancelledAt: null,
    connection: { platform: 'MANUAL' },
    dispatch: null,
  }));
  const service = new EcommerceOrderExportService(
    { ecommerceOrder: { findMany: async () => orders } },
    { requireStore: async () => ({ id: 'isolated-memory-test' }) },
  );
  const buffer = await service.exportXlsx('isolated-test-owner', {});
  assert.equal(buffer.subarray(0, 2).toString(), 'PK');
  assert.ok(buffer.length > 0);
  console.log(
    JSON.stringify({
      exportedRows: orders.length,
      xlsxBytes: buffer.length,
      peakRssKiB: process.resourceUsage().maxRSS,
      heapLimitMiB: Math.round(
        require('node:v8').getHeapStatistics().heap_size_limit / 1024 / 1024,
      ),
    }),
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
