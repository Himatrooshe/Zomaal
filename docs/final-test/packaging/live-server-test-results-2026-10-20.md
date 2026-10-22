# Packaging — live audit, 20 October 2026

> Historical evidence. Original failures and observations below describe the tested revision at that time. Use [the subsequent verification](./fix-verification-2026-10-20.md) and [current module status](../CURRENT-STATUS.md) for resolved findings and remaining acceptance.

## Result

**Not ready for final signoff: five findings remain open.** On production, 181 recorded observations produced **174 passes and 7 failed assertions**. These include requests, assertions, setup and cleanup, not 181 unique business scenarios. Multiple failed assertions map to the same finding; the WhatsApp gap is identified from requirements and implementation, not from a message-send attempt.

- Serving code: `54e1048`, revision `zomaal-backend-00062-gmt`, 100% traffic.
- [Live observations and selected responses](./live-server-results-2026-10-20.json).
- **66 unit tests passed**, six suites.
- **17 local PostgreSQL service checks passed**: [separate local evidence](./local-postgres-results-2026-10-20.json). These do not replace live delivery acceptance.
- No application fixes, migrations, merges or deployments were performed in this audit.

## Open findings

| ID | Priority | Finding | Evidence / correction needed |
|---|---|---|---|
| PKG-01 | Medium | Successful image replacement cannot be retried safely | The first `PATCH /warehouse/packaging/:id` with a fresh imageUploadId returned 200. Repeating the identical successful replacement returned 400: `Image <qa-id> cannot be attached as PACKAGING`. The image remains readable, but a client retry after a lost response is rejected. Recognize the already-current image and preserve it while accepting the retry. |
| PKG-02 | Medium | Inventory integer overflow reaches the database and returns 500 | Absolute stock `2147483648`, adjustment delta `2147483648`, and the valid-sized delta `2147483640` added to on-hand 10 each returned 500. Server logs confirm PostgreSQL integer-range errors (`22003`). Validate input and resulting bucket balances against the storage range before writes; return 400. The failed transactions left stock unchanged. |
| PKG-03 | High | Production low-stock notification evaluator is disabled | At available 10 / minimum 10 / alert enabled, the Packaging response correctly says LOW_STOCK, but the Inventory notification feed is empty. `POST /internal/notifications/run` returns 503, `Scheduled notification evaluation is not enabled`. No notification scheduler variables are present in the live revision; the us-central1 Scheduler list contains only three ad-sync jobs. Configure the evaluator's enabled flag, secret binding and schedule, then verify notification creation, resolution and deduplication live. The unauthenticated probe did not execute global evaluation. |
| PKG-04 | High | Owner WhatsApp low-stock alert is not wired | The client Q6.3 answer requires the owner phone and Notifications. Figma explicitly labels the toggle as a WhatsApp low-stock alert. Packaging currently has only notification candidates/in-app/push logic; no Packaging or Notifications call invokes the WhatsApp service, and WhatsApp triggers contain no inventory/low-stock path. This needs backend wiring and the approved owner-alert template/provider configuration. The previously reported client-side Meta prerequisite remains separate; fixing Meta alone does not add this missing trigger. No WhatsApp message was sent in this audit. |
| PKG-05 | Low | Blank inventory journal reasons are accepted | A stock adjustment with `reason: "   "` returned 201 and persisted `reason: ""`. The required minimum-length check runs before trimming. Trim and reject blank/too-short reasons before writes so the stock audit trail retains a meaningful explanation. |

### Source locations

- Image retry: `src/warehouse/packaging.service.ts`, `update()` and `attachImage()`.
- Integer bounds and blank reasons: `src/warehouse/dto/inventory.dto.ts`, `src/warehouse/inventory.service.ts`, `src/warehouse/inventory-balance.util.ts`.
- Alert runtime: `src/notifications/notifications-scheduler.guard.ts`, the deployment workflow and Cloud Scheduler configuration.
- Owner WhatsApp: `src/notifications/notification-evaluator.service.ts`, Packaging and WhatsApp integration.

## Selected actual live results

**Threshold status — HTTP 200, selected fields:**

```json
{
  "onHand": 10,
  "available": 10,
  "minimumLevel": 10,
  "lowStockAlert": true,
  "stockStatus": "LOW_STOCK"
}
```

**Inventory notification list at that threshold — HTTP 200:**

```json
{
  "items": [],
  "unreadCount": 0,
  "pagination": { "total": 0, "page": 1, "limit": 100, "totalPages": 0 }
}
```

**Notification evaluator probe — HTTP 503:**

```json
{
  "message": "Scheduled notification evaluation is not enabled",
  "error": "Service Unavailable",
  "statusCode": 503
}
```

**Oversized stock — HTTP 500:**

```json
{ "statusCode": 500, "message": "Internal server error" }
```

**Whitespace-only stock reason — HTTP 201, selected fields:**

```json
{ "reason": "", "quantityDelta": 1 }
```

## Passing live flows

- Empty list, four units (PIECES/ROLLS/METERS/SHEETS), defaults, trimmed name/SKU, supplier list and image upload.
- Private image content matches the actual uploaded PNG; replacement, removal and wrong-purpose/missing-image rejection work. A concurrent replacement pair returned 200/200 and left a readable image; this one observation is not proof of every interleaving.
- Name/SKU/unit/minimum/alert edits persist without changing stock. SKU and image can be cleared.
- Search by SKU, empty search, MANUAL/SHOP source filters, LOW_STOCK and OUT_OF_STOCK filters.
- Threshold equality correctly reports LOW_STOCK; zero reports OUT_OF_STOCK. Available stock excludes reserved and damaged units.
- Absolute stock update retries return the same movement. Concurrent +2/+3 adjustments preserve the +5 sum; duplicate concurrent +4 applies once.
- Below-reserved/damaged stock updates and over-reservation reject with 400 without invalid balances.
- Purchases restock packaging and purchase deletion reverses that stock.
- Opening stock journal is recorded; archived material retains history.
- Product link and quantityPerUnit appear in Packaging details. Linked material cannot be archived (409). Unlinking clears usage. Archived materials disappear, reject details/repeated archive (404) and cannot be linked to products (400).
- Invalid names, enums, fractions, initial quantities above one million, null non-clearable fields, unknown fields, corrupt/missing image files and invalid UUIDs reject cleanly.
- Missing auth returns 401; foreign material, image and inventory access returns 404.
- Staff with products.view can list/read; create/edit/archive/stock changes return 403.

## Delivery, cost and alert logic — local PostgreSQL only

The dedicated local checks call the compiled production services against PostgreSQL. Delivery events exist only in the disposable local database. No courier callback or delivery was fabricated on production.

- Shop delivery credits packaging once on replay and once for simultaneous duplicate calls; a new delivery reactivates archived Shop material and adds stock.
- Shop-derived name/SKU/photo remain protected by the service.
- Reserving products for dispatch leaves packaging stock unchanged.
- Delivery of three units consumes three boxes; repeated delivery does not consume them again, with one PACKAGING_CONSUMED movement per line.
- A quantityPerUnit multiplier of two on an order for two units consumes four boxes once, including duplicate financial syncs.
- With revenue 300, product cost 60 and packaging cost 6, net profit is 234.
- Minimum-equality alert candidates, active-notification deduplication, toggle-off exclusion/resolution and zero-stock OUT_OF_STOCK candidates work when the services are actually invoked.

The local fixture script initially omitted processedAt and used the event-level field name netProfitImpact for a summary response. Those harness mistakes were corrected to the real schema/summary contract before the successful 17-check run. They are not application findings.

## Figma and client requirements

Reviewed Figma section `1:11814`, including the Add Packaging frame `1:11875`, Packaging list `1:11832`, Details `1:11931`, and Update Stock `1:11815`. Visually inspected Add Packaging. The backend supplies the photo/unit/stock/minimum/toggle/detail/history fields, but the WhatsApp label is not fulfilled by the current alert implementation.

The [original client document](https://docs.google.com/document/d/1MyQOGeuSC72AGZzJBZSEKMs3jXKPDAHavN1tqo8pJoc/edit) provides answers missing from the older local module notes:

- Q6.1: three products deduct three boxes: consumption is per delivered unit, not once per order.
- Q6.2: packaging must reduce profit. The existing implementation uses the last paid purchase cost; the client answer does not explicitly settle average versus last cost.
- Q6.3: owner phone and notification.
- Q6.4: Shop delivery automatically increases stock.

Stock is currently whole numbers for all units. Figma's decimal placeholder does not establish support for fractional meter/roll stock; frontend inputs must follow the integer API contract.

## Acceptance still pending

- Actual courier-triggered delivered-order packaging consumption and repeated real callbacks on production.
- Actual Shop-admin delivery creating a SHOP-sourced material on production.
- Production notification evaluation and owner WhatsApp delivery after the gaps above are fixed, plus a real mobile push/device test.
- 24-hour image expiry and external storage outages were not forced on production.
- No mobile/frontend build was run; this pass is backend/API testing with design field comparison.

## Cleanup

The labelled QA store, seven test materials, its synthetic product/category, stock journals, temporary uploads and purchase/expense records were removed. Three remaining synthetic image objects were separately removed from its Cloud Storage prefix. The disposable viewer account was deactivated and scheduled through the standard account-deletion endpoint.

Original Packaging and Purchases API responses, original store list/selection, and Home order/shipping counts plus warehouse-product count were verified unchanged. The dedicated local database also contains zero users/stores/inventory movements after cleanup.

## Commands

In `/private/tmp/zomaal-tracking-workflow`:

```sh
npm test -- --runInBand packaging.service.spec.ts inventory.service.spec.ts notification-evaluator.service.spec.ts order-stock.service.spec.ts order-stock.util.spec.ts packaging-cost.util.spec.ts
# 66 tests passed in 6 suites
node /private/tmp/zomaal-packaging-postgres-20261020.cjs
# 17 local service/database checks passed
```

The live Node/fetch harness stages were setup, core, media, invalid, links, alerts, permissions, remaining and cleanup. The private harness and raw state stay outside the repository; published evidence masks test identifiers and contains no passwords or tokens.

Recommended next fixes: integer bounds and journal validation; image retry handling; enable and test notification scheduling; implement the owner WhatsApp trigger with its client/provider dependencies explicitly documented.
