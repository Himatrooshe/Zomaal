# Returns — live server test results

Date: 19 October 2026. Target: production Cloud Run API. Approved account: `oshi-ecom`, phone ending `0654`.

## Scope

This run uses real authenticated HTTP requests to the live server and checks the persisted return, inventory movements, and financial ledger through read APIs. It creates one explicitly labelled QA manual order, containing five lines of two units each. A QA warehouse product has unit sale price BDT 100 and unit purchase cost BDT 30. Opening synthetic stock is 50 units.

The fixture is an **undispatched manual order**. No parcel, courier dispatch, provider webhook, SMS, or WhatsApp message was created. This tests the live manual-return path, not an actual carrier delivery/return cycle.

## Passing live checks

- Actual test-account password login and authenticated API requests.
- Product image upload, category/product creation, and manual-order creation.
- Retrying manual-order creation with the original idempotency key retrieves the same order. Only one QA order exists.
- Manual search finds the order.
- Concurrent detect requests return the same return-request ID.
- A payload with a valid first line followed by an unrelated line receives HTTP 400; all line conditions remain null and stock/loss totals remain unchanged.
- Partial verification remains NEED_VERIFICATION until the fifth line is checked, then becomes PROCESSED.
- Each condition produces the expected persisted stock and ledger result.
- Repeating the full verification payload adds no inventory movement or ledger entry.
- Explicit damage amounts, cost corrections, and condition corrections append only the financial difference and restore stock correctly.

## Live condition observations

Each row is another line on the same order, so loss totals accumulate. The preview includes the order's BDT 15 shipping amount as a documented proxy; that is not evidence of an incurred courier fee.

| Newly recorded condition | On hand | Damaged | Cumulative item loss in ledger | Return loss preview |
| --- | ---: | ---: | ---: | ---: |
| Good | 50 | 0 | 0 | 15 |
| Returned | 50 | 0 | 0 | 15 |
| Damaged, no explicit amount | 50 | 2 | 60 | 75 |
| Lost | 48 | 2 | 120 | 135 |
| Missing | 46 | 2 | 180 | 195 |

All amounts above are BDT. Damaged stock is included in total on hand; available stock subtracts damaged and reserved quantities.

## Live corrections

| Correction | On hand | Damaged | Item loss in ledger | Loss preview |
| --- | ---: | ---: | ---: | ---: |
| Damage amount changed to 7.50 | 46 | 2 | 127.50 | 142.50 |
| Damage amount changed to 10 | 46 | 2 | 130 | 145 |
| Lost line changed to Good | 48 | 2 | 70 | 85 |
| Missing line changed to Good | 50 | 2 | 10 | 25 |
| Damaged line changed to Good | 50 | 0 | 0 | 15 |

Final item loss and net financial-ledger impact are zero. Historical ledger entries are retained as an audit trail.

## Cleanup and retained records

- Synthetic stock was set to zero after verifying the corrections.
- The QA product is archived and its QA category is inactive.
- Final on-hand, reserved, and damaged quantities are all zero.
- One QA manual order, one processed return, and their immutable audit history remain because orders/returns have no delete route.
- One QA-labelled customer with a non-contact test identifier remains.
- The original two YouCan orders were not changed.

The QA order is still OPEN/PENDING, so Home now includes **3 total orders**, including this one QA order. Returns summary includes **10 received QA units, BDT 1,000**. These are test records, not actual sales or delivered revenue. Warehouse totals include one archived product and zero active QA products.

## Additional issues discovered

1. Manual-order creation returned HTTP 201 while OpenAPI documented 200. Documentation corrected in `8f8c578`.
2. Creating a MANUAL order source incorrectly marked the Home remote catalog as incomplete. The Home calculation now excludes MANUAL sources from remote-catalog metric completeness. Regression coverage also checks that a genuinely missing remote metric still marks it incomplete.

Follow-up deployment and live verification: **passed**. [CI/CD run](https://github.com/Himatrooshe/Zomaal/actions/runs/39259407812) passed tests, the PostgreSQL Returns gate, build, deployment, and smoke check. A final live read confirms Home `catalog.complete: true`, the published schema's HTTP 201 response, the processed QA return, zero synthetic stock, and zero item loss/net ledger impact.

## Coverage limits

Actual courier return events, delivered-parcel stock restoration, delayed status after two elapsed days, staff permissions, and cross-store access were not exercised on production by this run. Their synthetic database scenarios passed in the separate PostgreSQL workflow suite. Live role/time/provider checks need suitable accounts, elapsed time, or an actual provider test parcel.

This run uses BDT throughout. It does not validate currency conversion between the account's BDT base currency and its existing AED source orders.

Sanitized HTTP checks and persisted-state snapshots are saved in [live-server-results.json](./live-server-results.json). No credentials, tokens, real customer details, or order IDs are included.
