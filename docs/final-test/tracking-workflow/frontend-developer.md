# Frontend — tracking, packs and returns

## Handoff status — 22 October 2026

Main corrections `75c8524`/`9a090ca` and callback follow-up `5aa776d` passed 97/97 live observations. Pack components, condition revisions, retry safety, financial reconciliation, staff financial access and confirmed provider cancellation are covered. Subsequent Orders export/provider acceptance is in the Orders and Shipping reports. Genuine delivery/return events and physical scanning are still open.

[Verification evidence](./live-fix-retest-2026-10-20.md) · [Cross-module status and API gaps](../CURRENT-STATUS.md) · [Production API contract](../openapi.production.json).

This refresh consolidates recorded work; it does not claim a new full regression run. Unchecked UI/QA checklists remain acceptance work. Revision names below identify the version tested at that time.

**Latest: [fix deployment and live retest](./live-fix-retest-2026-10-20.md) — all reported findings resolved; 97 live checks passed.**
Implementation: `75c8524`, 20 October 2026. See [verification report](./fix-verification-2026-10-20.md). The earlier audit is historical.

## Scan and details

- Resolve shipping barcodes with `GET /ecommerce/scan?value=…` (use the published OpenAPI query parameter if your generated client differs). Keep order ID and order-line ID; one product code can appear in many orders.
- Display pack `components`: `componentVariantId`, product code, name, quantity per pack and total physical quantity. Keep the parent order line. Never infer contents from a product title.
- Show returned `allocations`, `conditionComplete` and `conditionRevision`. A partial line has `condition: null`; a complete line can have `condition: "MIXED"`.
- HTTP 409 means tracking/reference ambiguity or stale revision. Ask the user to select the correct order using Returns search; refresh after a revision conflict. Do not select the first candidate automatically.
- New pack QR `items` contain `{productCode, quantity}`. Existing QR payloads still resolve using `trackingNumber`. Fetch the backend for current status.
- Use `GET /ecommerce/returns/:returnRequestId` to reopen a saved details screen. Detection can create a new request after a previous request was processed; do not use detection as a read operation.

## Condition submission

`POST /ecommerce/returns/:returnRequestId/verify`:

```json
{
  "lines": [
    {"orderLineId":"PACK_LINE_UUID","componentVariantId":"A_VARIANT_UUID","quantity":3,"condition":"GOOD","expectedRevision":0},
    {"orderLineId":"PACK_LINE_UUID","componentVariantId":"A_VARIANT_UUID","quantity":1,"condition":"DAMAGED","damageCost":30,"expectedRevision":0},
    {"orderLineId":"PACK_LINE_UUID","componentVariantId":"B_VARIANT_UUID","quantity":2,"condition":"MISSING","expectedRevision":0}
  ]
}
```

Example: two packs each contain 2 A and 1 B, so expected totals are A=4 and B=2.

- Each request **replaces** the current allocations of each included line. Send its complete desired snapshot, including previously entered quantities. Omitted lines retain their snapshot.
- Component quantities count individual component units; whole-pack quantities count packs. Do not mix both representations for a line.
- Every row of a repeated line needs an explicit positive integer quantity. Combine rows with the same component and condition. Over-allocation, foreign components and ambiguous duplicates return 400 before writes.
- A single whole-line row may omit quantity for legacy compatibility: all ordered units get that condition.
- Conditions: GOOD, RETURNED, DAMAGED, LOST, MISSING. `damageCost` is a total for the allocation in order currency, not a per-unit cost. Omitted damage cost defaults to purchase cost. Lost/Missing use purchase cost.
- Partial quantities keep the saved return pending. Full quantities process it. Correcting back to partial reopens it atomically, unless another open request exists (409).
- Send the last `conditionRevision` as `expectedRevision`. An exact retry is safe. A changed stale snapshot returns 409. Refetch before resubmitting changes.
- If real currency conversion is unavailable, verification returns 503 with no stock or ledger mutation. Show a retryable error.

## Values and integration limits

Returns cards count physical units. Received values allocate actual line selling value by component purchase costs; zero-cost packs use physical quantity weights. Damaged/missing values show actual purchase-cost losses.

Ameex references must resolve to exactly one owner order; use the internal order UUID where possible. Actual provider ticket printing, camera scanning and callback delivery still require a real provider test parcel. Meta/WhatsApp activation remains dependent on the client's Meta setup; these fixes do not certify outbound WhatsApp delivery.


## Current contract after live fixes

- Deployment `5aa776d` includes the main fixes in `9a090ca`.
- Returns limit is 1–100; oversized monetary values return 400.
- Keep manual-order retry keys attached to the original payload. Exact retries are safe after catalog edits; changed payloads return 409. Use a new key for a new order.
- Authorized staff can read/refresh financials within their store. Route permissions still apply; cross-store IDs return 404.
- A provider-deleted ForceLog shipment resolves CANCELLED, releases reservations and creates no pre-pickup sales/shipping loss. A cancelled dispatch is terminal; a new shipment currently requires a replacement order.
- Explicit store deletion now succeeds even with inventory history. It permanently deletes that store's dependent data; the last remaining store remains protected.
- QuickLivraison callback connectivity is verified with the real provider; no secret belongs in frontend code. Signed connectivity probes and untracked-parcel events are acknowledged without creating shipments.
