# Courier, scan, return and export flow — live verification

**22 October 2026 (Asia/Dhaka)** · Production application `9d4e661` · Cloud Run revision `zomaal-backend-00070-94q`, 100% traffic.

**111/112 recorded observations passed; one confirmed backend defect.** Counts include setup and cleanup. Two incorrect harness assumptions were corrected as explained below. No application code or production configuration changed during this run.

## Documentation reviewed

- [Shipping contract](../../shipping-provider-contract.md): connection, shipments, timeline, synchronization and provider-specific labels/actions.
- [Product/order/tracking architecture](../../product-shipping-tracking-architecture.md): tracking → order → product/pack components.
- [Shipping context](../../module-context/13-shipping.md), [Returns specification](../../returns-module.md) and deployed `/docs/openapi.json`.
- Existing progress notes and Shipping QA guide record the client's courier-dashboard dispatch workflow. The older context document's single-order dispatch assumption is stale; this test also exercises the existing backend dispatch API, which does not establish frontend acceptance of that older assumption.

Public browsing did not yield authoritative current vendor API documentation. The protocol review relies on repository/deployed contracts, with real ForceLog responses verified separately below. No unsupported vendor contract is inferred from search results.

## Confirmed defect: exactly 10,000 export rows crash the instance

1. Created a disposable, owner-scoped QA store through the production API.
2. Seeded 10,000 clearly labeled, zero-value, pending export-only rows directly into that store's manual connection. These rows contained no customer data or order lines; one pre-existing QA parcel order made 10,001 matching rows. This tests the production export endpoint, not bulk API order creation.
3. `GET /ecommerce/orders/export?includeCancelled=true&includeRefunded=true&includeDispatched=true` correctly returned **413** for 10,001 matching rows.
4. Removed one seeded row. With exactly **10,000 matching rows**, the same endpoint returned **503** after approximately 7.6 seconds.
5. Server stderr recorded: `FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory`. Instance termination and a new instance startup followed. The container is configured with 512 MiB memory.

The implementation loads all matching orders, builds a full ExcelJS workbook and then serializes it to a buffer. The observed heap failure is consistent with that in-memory path. The export's advertised 10,000-row success boundary is therefore **not accepted**. A bounded-memory implementation is the next fix; merely returning 413 above the limit does not cover it. Repeating the crashing request was unnecessary once logs confirmed the cause.

All 9,999 remaining seeded export-only rows were removed, then the isolated store and its remaining QA order were deleted.

## Passing real ForceLog flow

- Created a fresh zero-COD pack order with explicit **QA / DO NOT COLLECT OR DELIVER** instructions; no pickup requested.
- Dispatched through the real ForceLog API and received provider and merchant tracking references.
- Dispatch reserved four units of component A and two units of component B. A repeated dispatch returned 400.
- Real tracking resolved the exact QA order and pack; forged QR order/product/status metadata did not override stored truth.
- Retrieved a genuine ForceLog PDF and Zomaal QR PDF. Both printed the pack code and contained a decodable QR code.
- Software-decoded both PDFs, submitted their exact decoded values to the live scan API, and verified the order and component quantities. Scanner trailing CR/LF was handled; the original active store received 404 for this other store's tracking.
- ForceLog confirmed deletion of the newly created parcel. Zomaal scan then returned CANCELLED, all reservations were released, and revenue stayed zero.

## Passing scan-to-return flow

Using that actual provider tracking reference, with synthetic goods only:

- Return detection identified the order/pack; repeated scans reused the open return.
- Recorded component A: one Damaged at MAD 120 plus three Good; component B: two Missing at purchase cost MAD 10 each.
- Return became PROCESSED and item loss was exactly **MAD 140**.
- Exact verification retry changed neither inventory nor financial ledger.
- Correcting both packs to Good reversed item loss to zero and restored both component stocks to 20, with no damaged or reserved units.

This tests warehouse condition entry on a cancelled synthetic parcel, not a courier-origin delivered-then-returned physical parcel.

## Callback checks

- QuickLivraison missing/invalid signatures: 401. Locally signed, unknown-parcel events and exact retries: 200. Altering the raw body while retaining its signature: 401.
- Ameex unknown-reference callbacks in JSON and form encoding: 200 with zero matched shipments.
- Sendit missing signature: 401. A malformed event without the required `lastActionAt`: 400. A valid-shape event for an unknown code: 404, before connection credential lookup. The account is disconnected from Sendit, so matched-shipment signature verification was not exercised.
- These are application-boundary probes, **not genuine callbacks delivered by the courier**.

Harness corrections: the initial Sendit assertion expected 401 from a malformed payload, while the documented malformed-event response is 400. An initial OpenAPI assertion used `{id}` instead of the actual `{returnRequestId}` parameter. Both were verified against the source and deployed contract and corrected; neither was an application defect. The export 503 remains the only unresolved recorded failure.

## Local verification

All commands ran in the clean Orders worktree against a newly created local PostgreSQL test database, with its committed migrations applied. No migrations were run in production.

- `TRACKING_TEST_DATABASE_URL=<local-test-db> RETURNS_TEST_DATABASE_URL=<local-test-db> npm run test:e2e -- --runInBand tracking-pack-workflow.postgres returns-workflow.postgres` — **82 passed**. Includes duplicate/stale status handling, revenue recognition/reversal/reinstatement, concurrency, stock and ledger rollback, pack allocations and store isolation. Provider network calls are mocked here.
- `ORDER_EXPORT_TEST_DATABASE_URL=<local-test-db> npm run test:e2e -- --runInBand orders-export.postgres` — **1 passed**; this small-data test does not cover the newly observed production memory failure.
- `npm test -- --runInBand src/shipping/sendit-webhook.controller.spec.ts src/shipping/quicklivraison-webhook.service.spec.ts src/ecommerce/ecommerce-order-export.service.spec.ts` — **2 matching suites, 7 tests passed**; no Sendit controller test file matched.
- Test cleanup left zero users, stores, orders and inventory movements in the local database; the database was then dropped.

## Cleanup and remaining acceptance

ForceLog parcel deletion was confirmed, the disposable store and dependent data were removed, and all three exact image objects were deleted. The original store list, active store, Home order totals and catalog matched their baselines. The temporary database connection file was removed and the local proxy stopped.

Still required:

1. Fix the 10,000-row export heap failure and repeat both sides of the production boundary.
2. Genuine courier-origin Delivered/Returned events for a representative parcel, including fees and resulting revenue/stock changes.
3. Physical label printing and phone/handheld scanning; frontend/Figma/device behavior.
4. Fresh courier-dashboard-created import/matching acceptance, plus representative parcels for the other providers. Today's connection read showed QuickLivraison, ForceLog, OzoneExpress and Ameex connected; Sendit disconnected. Only ForceLog had stored shipments before this run.

[Sanitized observations and server evidence](./live-courier-flow-results-2026-10-22.json).
