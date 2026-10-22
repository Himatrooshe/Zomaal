# Products and Inventory — live test results

> Historical evidence. Original failures and observations below describe the tested revision at that time. Use [the subsequent verification](./fix-verification-2026-10-20.md) and [current module status](../CURRENT-STATUS.md) for resolved findings and remaining acceptance.

Date: 19 October 2026. Environment: deployed Cloud Run API, approved `oshi-ecom` test account.

Update, 20 October: all five failures below were fixed, deployed and retested live. This file preserves the original findings. See [fix verification](./fix-verification-2026-10-20.md) for current status.

## Client requirements available

The recorded client answers are in [05-products.md](../../module-context/05-products.md), with the shared workflow in [product-shipping-tracking-architecture.md](../../product-shipping-tracking-architecture.md). These are saved requirements; the original Google Doc and Figma were not freshly inspected during this test run.

- Products may be created manually or imported. Match platform order lines by SKU.
- Generate product codes automatically; keep product code, order ID and courier tracking number separate.
- Reserve stock at dispatch; deduct at delivery; returns follow the physical condition.
- Keep stock management in Zomaal; do not push stock changes to platforms.
- Purchase cost is entered explicitly, not recalculated as a purchase-weighted average.
- Allow discounted bundle pricing; derive bundle stock from component quantities and availability.
- Deduct gifts with orders and account for their cost.
- Product-level ad spend mapping remains a client dependency (Q5.5). This test does not certify ad allocation.

## Passed on the live server

| Area | Verified |
|---|---|
| Access and validation | Missing token 401; malformed UUID/query values 400; unknown product 404; disconnected Shopify catalog rejected |
| Catalog | YouCan catalog returned six real products; Warehouse/YouCan available, Shopify/Lightfunnels unavailable |
| Creation | Simple product and two-option-value variant product; generated codes/barcodes; opening balances 20 and 21 |
| Retry safety | Identical create returns same product; changed create payload under same key returns 409 |
| Duplicate SKU | New product with an existing store SKU returns 409 |
| Lists | Name/SKU/barcode/category/status filters; low-stock and out-of-stock filters |
| Basic edits | Name, selling price and purchase cost persist; stale version 409; negative price/cost rejected |
| Gift setup | Link a gift variant and remove it using null |
| Images | Main upload, gallery addition and first variant-image attachment |
| Variant addition | Add Size L with zero opening stock; new code and option value returned; stocked variant deletion rejected 400 |
| Inventory | On-hand/reserved/damaged/incoming changes; available = onHand − reserved − damaged; negative/overallocated balances rejected without writes |
| Inventory retries | Adjustment and final-stock retries do not apply twice; movement history retains opening balance |
| Concurrent stock changes | Two distinct concurrent increments both retained; simultaneous same-key retries return one movement and add one unit |
| Barcodes | Lookup resolves expected inventory; PDF label and SVG preview render |
| Performance | 7D/30D/90D zero-sales metrics; missing/reversed custom dates rejected |
| Comparison | Two warehouse products; zero-data insight null; PDF export; same-product comparison rejected |
| Bundles | Discounted price 199 retained; cost = sum of quantity × component cost; component cost edits refresh bundle cost; reservation reduces derived availability |
| Import | One real YouCan product imported as DRAFT with importStock false; zero opening stock; generated codes/barcode; image copied; missing cost flagged; repeat skipped as ALREADY_IMPORTED |
| Lifecycle | Archive excludes product from default lists; activate restores it |

The first SVG request used `format=SVG`, which correctly returned 400. The contract requires lowercase `format=svg`; the corrected request passed. This was a test-script error, not a backend bug.

## Confirmed live bugs

| ID | Reproduction | Actual | Expected / evidence |
|---|---|---|---|
| PROD-01 | PATCH /warehouse/products/:id with current version and fresh mainImageUploadId | 500 | Replace main image. Server log: MediaAsset_attachment_check rejects detaching an ATTACHED asset without an owner. |
| PROD-02 | Add a gallery image, then PATCH removeMediaIds with its attached media ID | 500 | Remove gallery image. Same media attachment constraint as PROD-01. |
| PROD-03 | PATCH with description: null | 500 | Null is documented as accepted. Server log: Cannot read properties of null (reading trim). |
| PROD-04 | PATCH with name containing three spaces | 200; saved name becomes empty | Reject blank normalized names with 400. The QA name was immediately restored. |
| PROD-05 | Add Size L with zero opening stock, then PATCH removeVariantIds with its ID | 500 | Delete an unused, zero-stock variant as documented. Server log: InventoryMovement_inventoryItemId_fkey prevents deleting its inventory item because creation recorded an opening movement, even at zero quantity. Preserve inventory audit history in the fix. |

These bugs were unfixed at the time of this initial report; all five subsequently passed the linked live fix retest. No application changes were committed, merged or deployed in this run. Transaction failures were followed by successful reads; subsequent independent tests continued.

## Automated verification

The warehouse product, edit, import, inventory, barcode, label, media, comparison and platform-import suites passed: **10 suites, 75 tests**.

Command:

```sh
npm test -- --runInBand --silent warehouse/product.service.spec.ts warehouse/product-edit.spec.ts warehouse/product-import.spec.ts warehouse/inventory.service.spec.ts warehouse/barcode.service.spec.ts warehouse/barcode-label.service.spec.ts warehouse/media.service.spec.ts warehouse/product-comparison.util.spec.ts warehouse/product-comparison-pdf.service.spec.ts warehouse/platform-product-import.util.spec.ts warehouse/platform-image.util.spec.ts
```

The extra platform-image filename selected no additional suite. The tested warehouse implementation files match fetched origin/main; the pre-existing workspace changes were preserved. These tests use mocked collaborators and did not catch the live database constraints above. The complete backend suite, build and lint were not rerun because no backend code was changed.

## Scope limits

- No real courier dispatch, delivery or return was generated. Manual RESERVED adjustments check arithmetic, not automatic dispatch triggers. The prior Returns report covers its separate stock workflow tests.
- Live staff permissions and cross-store isolation were not tested with another identity.
- Shopify/Lightfunnels imports were not tested live because those platforms are disconnected.
- Import with platform opening stock enabled was not exercised.
- No nonzero sales-performance or shipping/gift/packaging recognition was certified here. Packaging consumption requires its own lifecycle test.
- The store base currency is BDT, while connected platform data may use another currency. Imported money conversion was not certified; the imported draft was archived.
- No frontend/browser interaction, physical scan/print, provider timeout injection, or visual Figma comparison was performed.

## Cleanup

Four products were created during this run: two labelled QA products, one labelled QA bundle and one imported draft. Their synthetic stock is cleared, all four products are archived and the QA category is inactive after cleanup verification. Audit rows and attached media remain with archived records; no hard-delete APIs were used. Failed image replacements may also leave temporary uploads until the existing expiry cleanup runs.

See [sanitized request results](./live-server-results.json) for request outcomes. The private recovery file containing fixture IDs stays outside the repository. No credentials, bearer tokens, customer details or raw server logs are included here.
