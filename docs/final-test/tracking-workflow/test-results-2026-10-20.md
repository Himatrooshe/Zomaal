# Client tracking and return architecture — edge-case audit

**Historical audit — fixes and retest are tracked in [the verification report](./fix-verification-2026-10-20.md).**

Date: 20 October 2026. Code: fetched `origin/main`, commit `6f8d8d4`.

**Result: 38 database-backed tests, 28 passed and 10 failed expectations.** Fourteen existing Returns cases were reused as a baseline; the 24 additional cases passed 14 and failed 10. Failed expectations include existing bugs, unsupported workflow features and one advisory QR representation change. They are not ten independent confirmed regressions.

All tests ran against a dedicated local PostgreSQL database, using the real stock, financial, scan, Returns, permission and ForceLog persistence services. Synthetic provider snapshots entered the actual ForceLog reconciliation method. Outbound courier requests were mocked. No production data or code was changed; nothing was committed, merged or deployed during this audit.

## Client requirements

The supplied workflow requires tracking number → store-owned order → product/pack components. Product codes identify variants, not individual sales. Stock and financial effects must be attached to a particular order/line. The same code may occur in many orders. Pack contents and partial returned units need accurate quantities and independent conditions when they differ.

References: [client architecture brief](../../product-shipping-tracking-architecture.md), [Products context](../../module-context/05-products.md), [initial Returns live report](../returns/live-server-test-results.md).

## Passing additional cases

- Two orders share the same product code; each tracking value resolves its own order. Returning one releases only its reservation and leaves the other order's condition untouched.
- A QR's misleading order/product fields do not override the real store-owned tracking match.
- Two packs, each containing two A units and one B unit: delivery deducts A=4 and B=2. Whole-pack GOOD, RETURNED, DAMAGED, LOST and MISSING conditions update component stock correctly. Damage/loss costs use the total component purchase cost.
- Serial duplicate delivery events do not duplicate stock or revenue entries.
- A stale timeline DELIVERED event with an earlier occurrence time does not override a newer RETURNED outcome or resurrect revenue.
- The four dispatch adapters SENDIT, QUICKLIVRAISON, FORCELOG and OZONEEXPRESS send `DH564BJ0 x2` in their product/nature request fields rather than the long title. This checks the outgoing request construction, not actual printed courier labels.
- ForceLog snapshot ingestion links an existing dispatch and its manual order; repeated DELIVERED snapshots are idempotent when processed serially.
- ForceLog CANCELLED before delivery releases reserved stock and recognizes no sales or shipping loss. REFUSED and RETURNED_TO_SELLER release reserved stock, recognize no sales and book the known MAD 15 courier fee as a loss.

## Findings

| ID | Classification | Reproduction and actual result | Required outcome |
|---|---|---|---|
| TRACK-01 | Resolution bug | Two orders in one store have the same tracking value. Scan silently returns the first match via findFirst. | Resolve ambiguity with a carrier/order discriminator or an explicit selection/conflict response; never choose arbitrarily. |
| PACK-01 | Scan response gap | Scan a two-pack order. The response contains only the pack code, name and pack count. Neither component code nor component quantity is exposed. | Provide physical contents with per-pack and ordered quantities, keeping the parent pack and order line identity. |
| PACK-02 | Advisory representation | Pack QR items are code strings; component quantities and top-level single-line pack count are not included. | QR enrichment is one option. This particular shape is not an established client/API requirement: a correct database-backed scan expansion can meet the client need without changing existing QR format. |
| COND-01 | Missing feature | Submit different conditions for components of one pack. componentVariantId/quantity fields receive 400 because the current verification DTO only supports a whole order line. | Independently allocate conditions to physical pack components without exceeding ordered quantities. The test payload is a proposed contract, not an existing documented request. |
| COND-02 | Missing feature | Two units on one line, one Damaged and one Good: quantity-specific condition rows receive 400. | Persist per-condition quantities and calculate stock/loss for the affected units only. |
| COND-03 | Validation bug | Submit the same orderLineId twice, first GOOD then DAMAGED, with no quantity fields. The API returns 200 and processes both as successive whole-line updates. | Reject conflicting duplicates in the current whole-line contract before any write. Do not use this as a partial-quantity workaround. |
| FIN-01 | Financial lifecycle bug | Timeline Delivered → Returned → later genuine Delivered correction. Scan status becomes DELIVERED but summary revenue remains 0.00 instead of MAD 215.00. | Reconcile to the latest genuine outcome with append-only compensating events, retaining shipping/cost rules. |
| FIN-02 | Concurrency bug | Two simultaneous financial syncs for the first delivery. One request rejects with Prisma P2002; the other succeeds. Reproduced across runs; an earlier run also passed, so timing matters. | Both requests complete safely and yield one revenue recognition and one stock effect. This test established the request failure, not a duplicate revenue charge. |
| AMEEX-01 | Missing order integration | An Ameex shipment has the manual order reference and its own tracking code, but no timeline tracking event. Scan throws 404. | Link/import the carrier shipment to the order and use it for scans/status/financial updates. Current AmeexShipment has no EcommerceOrderDispatch relation; connecting the account alone does not complete this chain. |
| STATUS-01 | Courier chronology bug | ForceLog reconciliation receives DELIVERED, then an older supported IN_TRANSIT snapshot. Scan regresses to IN_TRANSIT. Supplied provider update timestamps are not used by this snapshot path. | Apply a defined chronology/transition policy that rejects stale regressions while allowing valid corrections. |

The 10 failed test expectations above are nine workflow finding groups if PACK-02 is treated as advisory. Prioritize wrong-order resolution, conflicting conditions, stale courier status and concurrent financial synchronization before broader pack/quantity implementation.

## Commands and artifacts

```sh
TRACKING_TEST_DATABASE_URL=<dedicated-local-test-db> npm run test:e2e -- --runInBand tracking-pack-workflow.postgres --json --outputFile=<temporary-results-file>
```

The suite source is preserved as a `.txt` artifact beside this report. Copy it to `test/tracking-pack-workflow.postgres.e2e-spec.ts` in an isolated checkout before running. It requires the existing migrations in a dedicated local test database and refuses nonlocal or non-test URLs. It intentionally fails on current main; it has not been added to the green CI gate. The raw failure logs remain outside the repository; the saved JSON includes test names/statuses only.

No backend implementation was edited, so build/lint/full unit tests were not rerun in this audit. Existing Products fix verification remains separate and valid.

## Cleanup and limits

- Cleanup confirmed users=0, stores=0, inventory movements=0, financial events=0 in the dedicated database. The empty database was then removed.
- No provider network request, real shipment, SMS/WhatsApp, payment or live account mutation occurred.
- Actual carrier printing, physical barcode/camera scanning and real provider webhook delivery remain unverified.
- ForceLog persistence was exercised with synthetic provider responses. Other carriers' stale-update policies were not tested here.
- Courier-level LOST/DAMAGED are not represented explicitly in the current ShippingShipmentStatus enum. Warehouse conditions exist; mapping any actual provider loss/damage vocabulary still needs provider-specific contract checks.
- Single-currency fixtures use MAD. This does not verify foreign-currency loss/courier-fee conversion.
