/**
 * One-time backfill for the Customer module (see CustomerRiskService).
 *
 * Scope, honestly: this can only link orders whose customer identity is
 * ALREADY stored somewhere —
 *   - MANUAL orders: manualCustomerName/manualCustomerPhone, captured at
 *     creation time.
 *   - Orders dispatched through one of Zomaal's own couriers: the courier
 *     shipment's recipientName/recipientPhone.
 * Shopify/YouCan/Lightfunnels orders synced *before* this feature shipped
 * never had a phone captured at sync time — there's nothing to backfill
 * them from locally. They get linked automatically the next time
 * EcommerceSyncService's normal periodic/manual sync re-fetches them (any
 * order whose provider `updated_at` changes going forward will pick up
 * customerId then); orders that never change again stay unlinked until a
 * fuller re-sync is run. This script does not call out to any platform API
 * itself — it stays local-data-only, no rate limits, no auth needed.
 *
 * Run: npx ts-node scripts/backfill-customers.ts
 * (loads .env itself — this runs standalone, not through Nest's
 * ConfigModule, which is what every other entry point relies on for that)
 */
import 'dotenv/config';
import { PrismaService } from '../src/prisma/prisma.service';
import { CustomerRiskService } from '../src/customers/customer-risk.service';
import { EcommercePlatform } from '@prisma/client';

const BATCH_SIZE = 200;

async function main() {
  const prisma = new PrismaService();
  await prisma.$connect();
  const customerRisk = new CustomerRiskService(prisma);

  let linked = 0;
  let skippedNoPhone = 0;
  let processed = 0;

  try {
    // MANUAL orders — customer captured at creation.
    let cursor: string | undefined;
    for (;;) {
      const orders = await prisma.ecommerceOrder.findMany({
        where: {
          customerId: null,
          connection: { platform: EcommercePlatform.MANUAL },
        },
        select: {
          id: true,
          manualCustomerName: true,
          manualCustomerPhone: true,
          manualShippingAddress: true,
          connection: { select: { storeId: true } },
        },
        take: BATCH_SIZE,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        orderBy: { id: 'asc' },
      });
      if (orders.length === 0) break;

      for (const order of orders) {
        processed++;
        const customer = await customerRisk.upsertCustomer({
          storeId: order.connection.storeId,
          phone: order.manualCustomerPhone,
          name: order.manualCustomerName,
          address: order.manualShippingAddress,
        });
        if (!customer) {
          skippedNoPhone++;
          continue;
        }
        await prisma.ecommerceOrder.update({
          where: { id: order.id },
          data: { customerId: customer.id },
        });
        linked++;
      }

      cursor = orders[orders.length - 1].id;
      if (orders.length < BATCH_SIZE) break;
    }

    // Orders with a Zomaal courier dispatch — recipient identity lives on
    // the shipment. One typed fetch per courier (each table has its own
    // shape — a single generic loop over `prisma.<model>` can't be
    // type-checked correctly), all funnelled through this one routine.
    const linkCandidates = async (
      label: string,
      candidates: Array<{
        recipientName: string | null;
        recipientPhone: string;
        orderId: string;
        storeId: string;
      }>,
    ) => {
      for (const candidate of candidates) {
        processed++;
        const customer = await customerRisk.upsertCustomer({
          storeId: candidate.storeId,
          phone: candidate.recipientPhone,
          name: candidate.recipientName,
        });
        if (!customer) {
          skippedNoPhone++;
          continue;
        }
        await prisma.ecommerceOrder.update({
          where: { id: candidate.orderId },
          data: { customerId: customer.id },
        });
        linked++;
      }
      console.log(`${label}: ${candidates.length} candidate shipments scanned`);
    };

    const dispatchSelect = {
      order: {
        select: { id: true, connection: { select: { storeId: true } } },
      },
    } as const;

    const sendit = await prisma.senditShipment.findMany({
      where: {
        dispatchId: { not: null },
        dispatch: { order: { customerId: null } },
      },
      select: {
        recipientName: true,
        recipientPhone: true,
        dispatch: { select: dispatchSelect },
      },
      take: 5000,
    });
    await linkCandidates(
      'Sendit',
      sendit.flatMap((s) =>
        s.dispatch?.order
          ? [
              {
                recipientName: s.recipientName,
                recipientPhone: s.recipientPhone,
                orderId: s.dispatch.order.id,
                storeId: s.dispatch.order.connection.storeId,
              },
            ]
          : [],
      ),
    );

    const quickLivraison = await prisma.quickLivraisonShipment.findMany({
      where: {
        dispatchId: { not: null },
        dispatch: { order: { customerId: null } },
      },
      select: {
        recipientName: true,
        recipientPhone: true,
        dispatch: { select: dispatchSelect },
      },
      take: 5000,
    });
    await linkCandidates(
      'QuickLivraison',
      quickLivraison.flatMap((s) =>
        s.dispatch?.order && s.recipientPhone
          ? [
              {
                recipientName: s.recipientName,
                recipientPhone: s.recipientPhone,
                orderId: s.dispatch.order.id,
                storeId: s.dispatch.order.connection.storeId,
              },
            ]
          : [],
      ),
    );

    const forceLog = await prisma.forceLogShipment.findMany({
      where: {
        dispatchId: { not: null },
        dispatch: { order: { customerId: null } },
      },
      select: {
        recipientName: true,
        recipientPhone: true,
        dispatch: { select: dispatchSelect },
      },
      take: 5000,
    });
    await linkCandidates(
      'ForceLog',
      forceLog.flatMap((s) =>
        s.dispatch?.order && s.recipientPhone
          ? [
              {
                recipientName: s.recipientName,
                recipientPhone: s.recipientPhone,
                orderId: s.dispatch.order.id,
                storeId: s.dispatch.order.connection.storeId,
              },
            ]
          : [],
      ),
    );

    const ozoneExpress = await prisma.ozoneExpressShipment.findMany({
      where: {
        dispatchId: { not: null },
        dispatch: { order: { customerId: null } },
      },
      select: {
        recipientName: true,
        recipientPhone: true,
        dispatch: { select: dispatchSelect },
      },
      take: 5000,
    });
    await linkCandidates(
      'OzoneExpress',
      ozoneExpress.flatMap((s) =>
        s.dispatch?.order && s.recipientPhone
          ? [
              {
                recipientName: s.recipientName,
                recipientPhone: s.recipientPhone,
                orderId: s.dispatch.order.id,
                storeId: s.dispatch.order.connection.storeId,
              },
            ]
          : [],
      ),
    );

    // AmeexShipment has no dispatchId FK (unlike the other four couriers) —
    // it's matched to a dispatch only by `reference`, the same lookup the
    // live Ameex flows themselves never do either (Ameex simply doesn't
    // link back to EcommerceOrderDispatch yet), so this does it explicitly
    // for backfill purposes.
    const ameex = await prisma.ameexShipment.findMany({
      where: { reference: { not: null }, recipientPhone: { not: null } },
      select: { reference: true, recipientName: true, recipientPhone: true },
      take: 5000,
    });
    const ameexCandidates: Array<{
      recipientName: string | null;
      recipientPhone: string;
      orderId: string;
      storeId: string;
    }> = [];
    for (const shipment of ameex) {
      if (!shipment.reference || !shipment.recipientPhone) continue;
      const dispatch = await prisma.ecommerceOrderDispatch.findFirst({
        where: {
          provider: 'AMEEX',
          merchantTracking: shipment.reference,
          order: { customerId: null },
        },
        select: {
          orderId: true,
          order: { select: { connection: { select: { storeId: true } } } },
        },
      });
      if (!dispatch) continue;
      ameexCandidates.push({
        recipientName: shipment.recipientName,
        recipientPhone: shipment.recipientPhone,
        orderId: dispatch.orderId,
        storeId: dispatch.order.connection.storeId,
      });
    }
    await linkCandidates('Ameex', ameexCandidates);

    // Every order linked above just went from customerId=null to set —
    // upsertCustomer/linkCandidates never touch totalOrders (that's only
    // bumped by CustomerRiskService.recordNewOrder for orders that are
    // actually new going forward), so a backfilled customer would
    // otherwise show 0 orders despite having history now. Reconcile it
    // here to the real linked count for every customer touched by any
    // backfill run, not just this one.
    const counts = await prisma.ecommerceOrder.groupBy({
      by: ['customerId'],
      where: { customerId: { not: null } },
      _count: { _all: true },
    });
    let reconciled = 0;
    for (const row of counts) {
      if (!row.customerId) continue;
      await prisma.customer.updateMany({
        where: { id: row.customerId, totalOrders: { not: row._count._all } },
        data: { totalOrders: row._count._all },
      });
      reconciled++;
    }

    console.log(
      `Backfill complete — processed: ${processed}, linked: ${linked}, skipped (no phone): ${skippedNoPhone}, totalOrders reconciled for ${reconciled} customers`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error('Customer backfill failed:', error);
  process.exitCode = 1;
});
