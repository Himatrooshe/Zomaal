# Orders — expanded live audit, 21 October 2026

> Historical audit: all five findings below were subsequently fixed, deployed, and retested. See [current fix verification](./live-fix-verification-2026-10-21.md).

Production revision: `zomaal-backend-00069-vb7`, 100% of traffic. Application commit: `ecae39f`.

## Result

**Five confirmed bug groups remain open.** This audit used authenticated production HTTP requests and a disposable, clearly labeled store with synthetic catalog, customer, and order data. No courier dispatch or external customer message was requested. Backend source was not changed in this audit.

The runner recorded 134 application observations: 109 passed and 25 failed. Several observations refer to the same defect, so these are not 25 distinct bugs. Setup and cleanup observations are included. Two incorrect harness expectations were excluded, as explained below.

## Confirmed findings

| ID | Problem | Production evidence | Expected behavior / impact |
|---|---|---|---|
| ORD-01 | Required contact/address fields accept whitespace | A customer name, shipping address, or phone consisting of three spaces each returned 201 and persisted one new order | Trim and reject empty required values with 400 before any mutation. Invalid contact data can otherwise enter dispatch workflows. |
| ORD-02 | Currency validation only checks length | `currency: "123"` returned 201 and persisted an order | Reject invalid currency codes with 400. Stored currency values must be usable by the financial pipeline. |
| ORD-03 | Monetary bounds and mutation atomicity | Unit price `1e20`, shipping `1e20`, and quantity 1000 × unit price `1e15` each returned 500. No order persisted. A separate oversized-money request using a new synthetic customer left one customer record behind | Validate individual and computed amounts against database capacity before customer/order mutations. Invalid requests should return 400 and leave no partial customer data. |
| ORD-04 | Invalid query values are silently coerced | List/export accepted boolean values such as `includeInRevenue=garbage` with 200. The list also accepted `page=1junk`, `page=1.5`, `limit=2junk`, and `limit=2.5` with 200 | Reject malformed boolean and integer filters with 400. Current conversion silently changes the requested filters or page size. |
| ORD-05 | Timeline does not follow the active store | After switching from the disposable store to the original store, detail, products, and financials for the disposable order returned 404, but its timeline returned 200 | Resolve the same active store context as other order endpoints. This was demonstrated across two stores belonging to the same owner; cross-owner access was not tested. |

Source review supports these observations: `CreateManualOrderDto` does not trim required strings or constrain currency/amount capacity; manual-order creation upserts the customer before its order transaction; query transforms use permissive boolean conversion and `parseInt`; the timeline lookup scopes by owner rather than the active store.

## Passing live scenarios

- New manual orders return 201 with expected totals, MANUAL platform, and PENDING payment state.
- An identical retry returns the same order. A changed payload for the same key returns 409 without a second order.
- Three concurrent identical submissions return one unique order. Two concurrent conflicting submissions produce one 201 and one 409.
- An exact retry preserves the original price after a catalog edit; a new request uses the edited price.
- Omitting the retry key creates separate orders, as documented.
- Undispatched orders leave the fixture's 50 on-hand units and zero reservations unchanged.
- Manual timeline and financial-summary reads return 200 in the correct active store.
- The 100-line and quantity-1000 boundaries are accepted with expected totals.
- Empty arrays, 101 lines, zero/negative/fractional/oversized quantities, unknown products, mixed valid/unknown products, negative amounts, empty required fields, null quantity/items, unexpected properties, and short retry keys are rejected with 400 and no new order.
- Fifteen export/list comparisons passed, including MANUAL/SHOPIFY, PENDING/PAID/REFUNDED, fulfillment and inclusion filters, order-reference/external-ID search, and empty results. XLSX workbooks have 20 columns and the expected row count; empty workbooks retain their headers. No formula cell was found.
- Unsupported platform/payment enum values and unsupported export pagination/date parameters return 400. Unauthenticated export returns 401.
- The original active store cannot retrieve the fixture's order detail, products, or financials; its list excludes the fixture, and its manual-order creation rejects the foreign product code.

## Scope corrections and remaining acceptance

Editing/deleting individual manual orders is outside the current v1 API. Order export supports the documented list filters, without date-range or pagination parameters. These unsupported operations were not classified as missing implementations.

`UNKNOWN` is a valid payment-status enum. A probe initially expected it to be invalid; that expectation was corrected and excluded from findings/counts. An initial fixture product-price update omitted the required product version and correctly returned 400; the corrected versioned request passed. That harness error was also excluded.

The existing export unit suite passed with **3/3 tests**, including rejection above 10,000 rows:

```sh
npm test -- --runInBand src/ecommerce/ecommerce-order-export.service.spec.ts
```

That capacity guard was tested locally with the checked-out deployment code, not by creating 10,001 production orders. Large live exports, staff role combinations, separate-owner access, and real courier delivery/return callbacks remain separate acceptance checks. The earlier tracking workflow reports cover their own explicitly recorded cases.

## Cleanup

The disposable store was deleted through the production API, removing its synthetic orders, customers, catalog, inventory, and related records. The one uploaded test image was deleted from cloud storage. The original store list and active store were restored. Original Home order metrics match the captured baseline. The existing test account and its original data remain available.

Sanitized observations: [live-expanded-results-2026-10-21.json](./live-expanded-results-2026-10-21.json). Tokens, credentials, contact details, original identifiers, and raw response payloads are excluded.
