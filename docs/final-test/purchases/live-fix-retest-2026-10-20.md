# Purchases — deployed live retest, 20 October 2026

## Result

**All six reported findings passed the production retest. 284 recorded checks passed; zero failed.** The count includes requests, assertions, setup and cleanup, not 284 distinct business scenarios.

- Deployed code: `54e104890b51d4a42e9fa5516ab5236279c4b373`.
- Serving revision: `zomaal-backend-00062-gmt`, **100% traffic**; actual revision commit label and health checked before testing.
- [CI test/build and production deployment both succeeded](https://github.com/Himatrooshe/Zomaal/actions/runs/39340906840).
- API: production Cloud Run service. All retest stages ran after the new revision was ready.
- [Sanitized observations and selected API responses](./live-fix-retest-results-2026-10-20.json).

## Original findings retested live

| Finding | Production result |
|---|---|
| PUR-01: concurrent stock drift | Three concurrent edit pairs returned 200/200; each ended at purchase quantity **20**, stock **20**. Edit/delete race returned 200/200 with zero final stock and no expense. Delete/delete race returned 200/404, with zero stock and no duplicate reversal. |
| PUR-02: receipt constraints | Actual Cloud Storage upload 201; purchase attachment 201/200; private PNG preview 200 with exact uploaded bytes. Replacement, clearing and deleting a purchase remove its old receipt. Reuse returns 400 without creating another purchase. Foreign-store preview returns 404 and attachment 400; rejected replacement preserves the existing receipt. |
| PUR-03: mixed currencies | MAD and USD purchases have separate currency-qualified list groups. Qualified MAD details total **10.00 MAD**. Legacy mixed details return null total/currency plus **10.00 MAD** and **20.00 USD** separately. |
| PUR-04: money overflow | Oversized unit prices and computed totals return 400 on both create and PATCH. Existing purchase history and expense remain identical after rejected updates. |
| PUR-05: null updates | Null price/date/quantity/payment method return 400. Purchase date remains **2026-10-18**, rather than becoming 1970. Notes/receipt null clearing still works. |
| PUR-06: supplier/invoice | Product and packaging supplier lists save through their APIs and appear in product-options. Purchase create/edit/history retain supplier and invoice values. Later product supplier changes preserve the purchase snapshot. Unknown/duplicate/null supplier lists and blank/null invoices reject with 400 as appropriate. |

## Actual response excerpts

These are selected fields from separate live responses; identifiers are omitted.

**Legacy mixed-currency group — HTTP 200:**

```json
{
  "totalCost": null,
  "currency": null,
  "totalCostByCurrency": [
    { "currency": "USD", "amount": "20.00" },
    { "currency": "MAD", "amount": "10.00" }
  ]
}
```

**Supplier/invoice PATCH — HTTP 200:**

```json
{
  "supplierName": "Local Supplier",
  "invoiceNumber": "INV-002",
  "quantity": 1,
  "unitPrice": "10.00",
  "totalCost": "10.00",
  "stockAdded": false
}
```

**Computed total overflow — HTTP 400:**

```json
{
  "message": "totalCost exceeds the supported monetary range"
}
```

**Purchase history after rejected null date — HTTP 200:**

```json
{
  "purchaseDate": "2026-10-18T00:00:00.000Z"
}
```

The raw sanitized response excerpts in the JSON evidence retain additional fields and masked test identifiers.

## Other passing production checks

- Empty states, source tabs, search and item-type selection.
- Product and packaging purchases, sequential quantity/price/date/payment/note edits, last packaging cost, addToStock=false and variant-specific stock.
- Exactly one expense per purchase; generated expense edit/delete and manual Purchase Costs entries blocked with 409.
- Reserved, damaged and consumed stock block unsafe purchase changes; ordinary deletion reverses stock and keeps the journal until explicit test-store deletion.
- Invalid quantities, precision, dates, enums, UUIDs, targets, wrong variants and unknown fields reject cleanly.
- Staff view-only permission and cross-store purchase isolation.
- Archived products/materials disappear from selectors and cannot be purchased.
- Original warehouse cost stays 25 after purchase-price changes.

No unexpected 500 response occurred in the recorded checks. A read of the new revision's ExceptionsHandler logs returned no entries during this retest.

## Cleanup

- Both labelled temporary stores deleted.
- All **14** synthetic purchases removed, including their expenses; scoped inventory journals removed with the temporary store.
- Two remaining synthetic product-image objects removed from Cloud Storage. Receipt objects were removed by their lifecycle operations; the foreign temporary upload was explicitly removed.
- Disposable staff account deactivated and scheduled through the standard account-deletion flow. No staff password or token is stored in this report.
- Original store list and active store restored; original Purchases response and Home order/shipping counts and warehouse-product count verified unchanged.

## Acceptance limits

- Receipt expiry after 24 hours was verified locally in PostgreSQL; no production clock or expiry was altered.
- This pass did not place/pay for/deliver a real Zomaal Shop order. Shop fulfillment has existing unit coverage; manual Purchases and their receipt/stock/expense flows were tested live here.
- No mobile/frontend application was run; this is backend production acceptance of the reported fixes.
- Supplier/invoice fields remain optional for compatibility, with no fabricated historical backfill.
