# Purchases — live audit, 20 October 2026

## Result

**Not ready for final signoff. Six findings remain open.** This pass tested the deployed backend and reviewed the Figma purchase screens and original client answers. No application fixes, commits or deployments were made in this pass.

- Environment: production Cloud Run API; deployed baseline `5aa776d`.
- Test data: an isolated, clearly labelled temporary store under the approved QA owner. No real Shop order or supplier payment was placed.
- Local tests: 82 passed across Purchases, Shop orders, Expenses and Packaging. These are unit tests; they do not prove database constraints work in production.
- [Sanitized live observations](./live-server-results-2026-10-20.json). Observations include HTTP requests, assertions, setup and cleanup; they are not a count of distinct business scenarios.

## Open findings

| ID | Priority | Finding | Live evidence / expected result |
|---|---|---|---|
| PUR-01 | High | Concurrent edits can over-credit stock | A purchase started with quantity/stock 10. Concurrent PATCH requests for 15 and 20 both returned 200. Final history showed quantity 20 but available stock was 25. One other attempt stayed consistent. Retry must reload the purchase inside the transaction or use an equivalent concurrency guard. |
| PUR-02 | High | Receipt uploads fail | Valid PNG upload to `POST /expenses/receipts` returned 500 twice. Server logs identify `MediaAsset_purpose_check` rejecting `RECEIPT`. The receipt migration adds the enum but does not update the original purpose/attachment constraints. Repair and verify both upload and attachment constraints. This shared path also serves Expenses and Salary. |
| PUR-03 | High | Mixed-currency groups misstate totals | Same packaging purchased for 10 MAD, then 20 USD after changing only the temporary store currency. Summary correctly separated currencies, but group history displayed `totalCost: "30.00", currency: "USD"`. List groups use the same unsafe aggregation. Separate currencies or return an unknown total with explicit per-currency amounts. Never silently add currencies. |
| PUR-04 | Medium | Prices and calculated totals can overflow persisted money | `unitPrice: 10000000000000000, quantity: 1` and `unitPrice: 1000000000000, quantity: 1000000` each returned 500. Validate both the unit price and computed total before writes and return 400. |
| PUR-05 | High | Null PATCH fields bypass validation | `unitPrice: null` returned 500. `purchaseDate: null` returned 200 and changed the history date to `1970-01-01T00:00:00.000Z`; it also updates the expense date. Reject null for fields that cannot be cleared. Restore the original date when reproducing. |
| PUR-06 | Medium | Supplier and invoice client requirement missing | Original Google Doc Q7.4 explicitly requires selecting the supplier from the product and recording an invoice number. Purchase DTOs/schema expose neither. Sending `supplierName`/`invoiceNumber` returns 400 as unknown properties. These are illustrative field names, not an agreed replacement contract. The local module note's opposite answer is stale. Model the product supplier relationship and agree/document the API fields before frontend signoff. |

### Example responses and observed state

```json
{
  "receiptUpload": { "statusCode": 500, "message": "Internal server error" },
  "concurrentEdit": {
    "httpStatuses": [200, 200],
    "finalPurchaseQuantity": 20,
    "finalStock": 25
  },
  "mixedCurrencyGroup": {
    "totalCost": "30.00",
    "currency": "USD",
    "history": [
      { "currency": "USD", "totalCost": "20.00" },
      { "currency": "MAD", "totalCost": "10.00" }
    ]
  },
  "nullDateHistory": { "purchaseDate": "1970-01-01T00:00:00.000Z" }
}
```

The first object summarizes separate requests; it is not a single API response.

## Passing live flows

- Empty list and zero totals; All/Manual/From Shop separation; search; product/packaging selectors and type filters.
- Manual product and packaging creation, defaults and `addToStock: false`.
- Required variant selection; only the selected variant receives stock.
- Quantity edits move stock by the delta in sequential requests. Price/date/note/payment edits synchronize the same expense.
- Exactly one linked automatic expense per purchase; direct creation in Purchase Costs and direct edit/delete of generated expenses return 409.
- Product cost stays 25 despite purchase prices changing. Product costs are numeric in the warehouse response; purchase/expense money is formatted as strings.
- Packaging options show the last paid price and updated stock.
- Reserved/damaged/consumed stock prevents unsafe purchase deletion/reduction with 409. Rejected reductions leave stock and expense values intact.
- Purchase deletion reverses stock, removes the expense, retains stock journal history; repeat deletion returns 404.
- Invalid quantity, negative/over-precision price, invalid/far-future date, both targets, wrong variant, unknown fields and invalid enum/UUID return 400.
- Nonexistent receipt attachment returns 400 and creates no orphan expense.
- Cross-store reads, edits, deletes and purchases against foreign products/materials return 404.
- Missing login returns 401. Staff with only `shop.view` can read Purchases but cannot create a purchase or use the product selector (403).
- Archived product/material cannot be purchased and disappears from the selector.

## Figma and client-document comparison

Read the Purchases section metadata (`1:4656`), covering list (`1:4657`), details (`1:4815`), add (`1:4894`) and product selection (`1:4933`). Visually inspected the Add Purchase frame. The API supports the product image/selection, quantity, unit price, calculated total, date, source tabs and history fields shown there.

The [original client document](https://docs.google.com/document/d/1MyQOGeuSC72AGZzJBZSEKMs3jXKPDAHavN1tqo8pJoc/edit) Q7.4 overrides the contradictory local module answer. Figma's Add Purchase frame does not show the later supplier/invoice requirement, so matching that frame alone does not satisfy the client's answer.

Q7.2 in the original document explicitly describes Shop stock increasing on delivery. The current manual `addToStock` switch is documented locally and tested as implemented; the client answer itself does not explicitly describe that switch.

## Blocked or not verified live

- Receipt attachment, preview, replacement, reuse, expiry, cross-store access and deletion cannot receive live signoff until PUR-02 is fixed. Clearing an absent receipt succeeded; that does not prove receipt removal works.
- Shop-delivered purchases and their read-only rule have existing unit coverage. This pass did not place or deliver a real Shop order or use admin credentials to fabricate delivery.
- No merchant mobile/frontend build was run. This is API testing and backend-to-design field comparison, not a visual frontend acceptance test.
- Other staff permission combinations, large catalogs beyond selector limits and provider outages were not exhaustively tested.

## Cleanup and evidence quality

- All eight synthetic purchases were removed; the temporary store and its scoped inventory journals were deleted.
- Original store list, Purchases response and Home order/shipping counts and warehouse-product count were verified unchanged; original active store restored.
- Disposable staff account deactivated and scheduled through the standard account-deletion endpoint. Its temporary password was removed from the test state.
- Two synthetic product-image objects were separately removed from the temporary store's Cloud Storage prefix. Failed receipt uploads clean up their uploaded objects in the existing service.
- Two early harness assertions were incorrect: Expenses uses `expenses`, not `items`/`data`; warehouse cost prices are numbers, not strings. Corrected readbacks passed. They are excluded from product failures in the sanitized evidence. A list-only null-update check was also excluded because the list does not expose every history date. The explicit history read confirmed PUR-05.

## Commands executed

In `/private/tmp/zomaal-tracking-workflow`:

```sh
npm test -- --runInBand purchases.service.spec.ts
# 17 passed
npm test -- --runInBand shop-orders.service.spec.ts expenses.service.spec.ts packaging.service.spec.ts
# 65 passed
```

Live Node/fetch harness stages: setup, core, invalid, advanced, verify, lifecycle, cleanup. Private harness/state remain outside the repository. Sanitized observations contain no passwords, tokens, customer PII or provider secrets.

## Recommended fix order

1. PUR-01 transaction safety, with a real PostgreSQL concurrency regression test.
2. PUR-02 forward migration for media constraints, with upload/attach integration tests.
3. PUR-05 null validation and PUR-04 money bounds on create and update.
4. PUR-03 currency-safe list/group responses and frontend handling.
5. PUR-06 supplier/invoice schema, endpoint contract and frontend requirements.

Then deploy and rerun the failing cases and receipt lifecycle on production before signoff.
