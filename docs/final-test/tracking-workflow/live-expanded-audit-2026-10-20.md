# Expanded live audit — tracking, packs and Returns

**Latest: [fix deployment and live retest](./live-fix-retest-2026-10-20.md) — all reported findings resolved; 97 live checks passed.**
Date: 20 October 2026. Deployed code: `75c8524`. **This audit supersedes the earlier limited live sign-off. Additional issues remain. No backend code was changed during this audit.**

[Sanitized checks and evidence](./live-expanded-results-2026-10-20.json).

## Scope and method

All requests in this pass hit the deployed production API. A newly created, labelled QA store isolated products, orders and Returns from `oshi-ecom`. Authentication, permission guards, controllers, PostgreSQL transactions, stock and ledgers ran normally. No mocked backend services or direct production database writes were used.

The saved results contain 377 expanded API check records and 35 courier check records, including setup, repeated requests and cleanup; these are not distinct-scenario counts. Group failure markers repeat their underlying failing expectation. The missing QuickLivraison secret and expected upstream rejection of a Bangladesh contact are classified separately from code bugs.

## Findings

| ID | Finding | Live result | Required follow-up |
|---|---|---|---|
| LIVE-01 | Returns limit validation disagrees with OpenAPI | `GET /ecommerce/returns?limit=101` returns 200, maximum documented as 100 | Enforce the documented maximum before querying |
| LIVE-02 | Changed manual-order retry payload is silently ignored | Same key, shipping changed 15 → 16; HTTP 201 returns same order with shipping 15 | Define and enforce the payload-conflict contract, normally 409; no duplicate/overwrite occurred |
| LIVE-03 | Oversized damage cost reaches PostgreSQL | `damageCost: 10000000000000000` returns 500 | Bound amounts and allocation totals to database limits; invalid input should return 400 |
| LIVE-04 | Authorized staff cannot read order financials | Staff granted `orders.view` gets 404; same staff can read Returns and verify permitted quantities | Resolve the staff store before financial summary lookup |
| LIVE-05 | Store deletion fails after inventory activity | DELETE temporary store returns 500; logs confirm `InventoryMovement_inventoryItemId_fkey` | Make explicit store deletion handle its dependent inventory history correctly |
| LIVE-06 | Deleted provider parcel still appears pending | ForceLog deletion succeeds; Zomaal scan still reports PENDING | Reconcile successful provider deletion with local dispatch, shipment and stock state |
| CONFIG-01 | QuickLivraison callback secret missing | Public webhook returns 503: secret not configured | Configure matching shared secret in deployment and provider dashboard before valid callback acceptance testing |

## What passed live

- Missing authentication, malformed scans, unknown tracking and forged QR metadata handling.
- Returns search validation, invalid UUIDs, invalid quantities, duplicate conditions, foreign lines/components, whole-pack/component conflicts and atomic rejection. Omitted lines retain existing allocations.
- Whole-pack GOOD, RETURNED, DAMAGED, LOST and MISSING corrections; mixed component/simple conditions and repeated product codes on separate order lines.
- Partial returns stay pending; completed allocations process; another open return blocks reopening an older completed return.
- Simultaneous detect returns one existing open request. Simultaneous identical verification is safe. Two different changes with the same revision produce one 200 and one 409.
- Concurrent financial refreshes, explicit zero damage cost, four-decimal money and repeated allocation submissions.
- Stock, financial and journal snapshots remained unchanged after rejected batches, including the oversized-value 500.
- Staff read-only permissions deny processing/scanning; granted permissions allow verification; deactivation revokes existing-token access. The separate financial-summary denial is LIVE-04.
- Real MAD → USD conversion produced a USD unit-cost snapshot of 3.0843 for a MAD 30 purchase cost; the live financial ledger matched allocated converted costs. Correction restored zero loss. An order with an unavailable currency rate returned 503 without stock, condition or ledger writes.
- Inventory barcode resolution and PDF/SVG label rendering, with cross-store isolation.

## Real ForceLog parcel and labels

A prepaid, clearly marked **QA TEST — DO NOT COLLECT OR DELIVER** order was submitted through the actual ForceLog integration. The first attempt using the approved Bangladesh contact was rejected as `Invalid Phone Number`; the existing supplied Moroccan client contact was then accepted. No pickup request was made.

- Real tracking: `F-CSA1PNDZYH8E`.
- Zomaal scan resolved the correct pack/order with status PENDING, ordered pack quantity 2, A=4 and B=2.
- Real ForceLog PDF sticker contained the pack code and `x2`; its QR decoded to the tracking number.
- Real Zomaal PDF QR decoded to a PACK object containing pack quantity 2 and component quantities A=4, B=2. Both exact decoded values resolved through the live scan API.
- A forged QR order ID and DELIVERED status did not override the real tracking match or database PENDING state.
- Duplicate dispatch was rejected without creating another parcel. Concurrent financial syncs recognized no delivered revenue.
- Detection through the real tracking value, mixed pack conditions, a MAD 50 loss and correction back to Good passed.
- ForceLog confirmed successful deletion while the parcel was still new. No physical pickup/delivery occurred. Local status remaining PENDING after deletion is LIVE-06.

This verifies digital decoding of the real provider and Zomaal labels. It does not certify a physical printer, phone camera or a genuine courier Delivered/Returned callback.

## Cleanup

- Original active store restored. Its catalog, order counts and courier dispatch counts match the pre-test baseline.
- ForceLog test parcel deleted successfully at the provider.
- All inventory buckets for both temporary component products are zero. Three temporary products archived and their category deactivated.
- The temporary store is renamed `[QA ARCHIVED - DELETE BUG] …` and retained because its deletion endpoint failed. Its synthetic orders, Returns and immutable inventory history remain for reproducing the bugs.
- One disposable QA staff account was deactivated and scheduled for the normal 30-day account deletion. No OTP or customer message was requested for it.
- The original test account, connected catalog and earlier QA order remain available.

## Remaining acceptance

Fix the findings above and retest them live. Valid QuickLivraison callback acceptance requires its missing shared secret. A physical printer/camera and actual courier movement would be needed to certify physical scanning and genuine Delivered/Returned notifications; no fabricated delivery events or database-failure injection were applied in production.
