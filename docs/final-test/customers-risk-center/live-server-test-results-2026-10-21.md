# Customers & Risk Center — live audit, 2026-10-21

> Historical evidence. Original failures and observations below describe the tested revision at that time. Use [the subsequent verification](./fix-verification-2026-10-21.md) and [current module status](../CURRENT-STATUS.md) for resolved findings and remaining acceptance.

## Result

**Not ready for signoff.** 326 recorded observations: **291 passed, 35 failed expectations**, across seven finding groups. Counts include setup, requests, assertions, repeated reproductions and cleanup; they are not326 unique business cases.

- API: `https://zomaal-backend-563898960389.us-central1.run.app`.
- Serving revision: `zomaal-backend-00065-zbd`, application commit `0326eaa`.
- Actual deployed HTTP requests, with27 synthetic manual orders, two temporary products and one temporary staff account in disposable stores. No production database fixtures, timestamp edits, platform orders or real courier parcels were fabricated.
- Test date:2026-10-21 Asia/Dhaka (2026-10-20 UTC).
- [Sanitized observations and selected live responses](live-server-results-2026-10-21.json).
- Local baseline only: `npm test -- --runInBand customers` passed5 suites /70 tests. Those existing tests did not expose the deployed integration failures below.
- No application fixes, merge or deployment performed in this audit.

## Reproduced findings

| ID | Priority | Live finding | Reproduction / actual result |
| --- | --- | --- | --- |
| CUST-01 | High | Equivalent phone formatting splits customer identity and bypasses blacklist warning | Orders for `+212600000208` and `+212 600 000208` created different Customer IDs. After blacklisting the canonical phone, another order using the formatted version received no `CUSTOMER_BLACKLISTED_WARNING`. The customer upsert trims outer whitespace but does not normalize the identity. |
| CUST-02 | High | Same title groups different known products as duplicates | Two distinct warehouse products/codes `U1OL9AGY` and `E12F38VP`, same display title, same phone: one duplicate group. Strong warehouse identities disagree but the name fallback still matches. Module context describes warehouse identity first, followed by weaker fallbacks. |
| CUST-03 | Medium | Customer history shows cancelled duplicate as “Order placed” | Cancel duplicate returned200; order detail statusCANCELLED, but Customer Details history row remained `Order placed`. The order's creation event outranks fallback status and the duplicate-cancellation event is not recognized by that status mapping. |
| CUST-04 | High | Concurrent cancellation can remove every order in a group | Two simultaneous POSTs to `/customers/duplicate-orders/cancel`, each selecting a different member of the same two-order group: both returned200 in two of four independent attempts. Subsequent GETs confirmed both persisted statusesCANCELLED. Sequential/all-selected rejection works; group membership is decided outside the transaction and lacks shared group serialization/revalidation. |
| CUST-05 | Medium | Pagination/lookback coercion and overflow | `page=1.5`, `page=1junk`, `limit=1.5`, `limit=2junk` return200 in Customers, Blacklist and Duplicate Orders. `days=1.5` /`days=2junk` also return200. Huge page `999999999999999999999` returns500 on Customers/Blacklist and200 with unsafe metadata on Duplicate Orders. DTOs use `parseInt` and lack a safe page upper bound. |
| CUST-06 | Medium | Null blacklist settings return500 | PUT `/customers/blacklist/settings` with null for each of returnsLimit,cancellationsLimit,refusalsLimit,noAnswerLimit,combinedLimit,useCombinedLimit,warnOnNewOrder returns500. Optional validators skip null while database columns are required. Each probe was followed by restoration of valid test-store settings. |
| CUST-07 | Medium | Category limit overflow reaches PostgreSQL | `{"returnsLimit":2147483648}` returns500. The per-category DTO has no maximum matching the persisted integer range. Negative/fractional/string values correctly return400; combinedLimit already has a100000 cap. |

### Selected actual responses

```http
PUT /customers/blacklist/settings
Content-Type: application/json

{"returnsLimit": null}

HTTP 500
{"message":"Internal server error","statusCode":500}
```

```http
GET /customers?page=1.5
HTTP 200
# Response page is silently coerced to1.

GET /customers?page=999999999999999999999
HTTP 500
```

Concurrent cancel result (reproduced twice):

```json
{"requestStatuses":[200,200],"persistedOrderStatuses":["CANCELLED","CANCELLED"]}
```

The raw evidence retains the original customer/order IDs for synthetic records and actual responses. It excludes owner credentials, staff passwords, access/refresh tokens and baseline original-customer data.

## Passed live flows

### Customers and risk counters

- Empty screens, order-driven customer creation, same exact phone merges, name/address refresh, case-insensitive name search, phone search and unmatched search.
- Customer totalOrders, history length, exact retry and concurrent manual retry: one order/customer count for one idempotency key.
- Real pagination retains global matching counts across pages and an empty page past the end.
- Return detection increments risk once; repeated and concurrent detection of the same open return reuse its ID and preserve a single increment.
- Returns limit2: first return produces proximity1 and High Risk/watchlist entry; second return automatically blacklists with reason`2 returns`.
- Combined limit2 replaces individual return limit1: first return remains unblocked with combined proximity1; second blacklists.
- Zero limits disable automatic blacklist and proximity while retaining actual counters.

### Blacklist

- Manual add with trimmed reason, omitted reason auto-fill, repeat add, remove and repeat remove.
- Removal clears all four counters, blacklist reason/timestamp and blocked state; customer order history is retained.
- Blacklisted customer orders still succeed (warning-only policy) and generate timeline warning and in-app alert. Warning toggle off suppresses the warning event; on restores it.
- Search/pagination counts, blacklisted-vs-at-risk mutual exclusion, correctly scoped search.

### Duplicate review

- Same phone/product forms a group with oldest Main; a different phone does not join it.
- Group metadata, total counts,24h window metadata, manual platform and canCancel flags; in-app duplicate alert generated.
- Selecting every order sequentially rejected400. Single duplicate cancel succeeded200 and required no external platform action. Customer cancellation risk remained0, as intended for merchant cleanup.
- A cancelled duplicate retry is rejected without another side effect. Keep removes its group; keeping a no-longer-current group returns404.
- Invalid mixed selections with a missing order returned404 and did not partially cancel a valid order.
- Four cancellation race attempts: two protected one order, two allowed both cancellations. The failures are retained; no favorable-only reporting.

### Access and validation

- customers.view allows Customers/detail/duplicate listing; blocks blacklist management and duplicate writes without their separate permissions.
- customers.blacklist permits settings management but does not grant general Customers listing. Removing permissions takes effect on an existing token.
- Cross-store customer detail, blacklist/unblacklist, duplicate keep and duplicate cancellation return404; other store list stays empty.
- Anonymous routes401; invalid UUID400, unknown customer/group404.
- Empty/duplicate/invalid/oversized duplicate selection arrays400; unknown/mixed-missing IDs404.
- Most invalid negative/zero/nonnumeric/range queries and invalid setting types correctly return400. Failures are listed separately above.

## Observed policy needing a client decision

Lowering returnsLimit to1 for an existing, unblocked customer with returnsCount1 does not immediately blacklist them. Their counters stay1, isBlacklisted staysfalse, proximity.remaining becomes0; settings are applied when the next risk signal increments a counter. This is recorded as observed behavior rather than an extra failed expectation because the current requirements do not define retrospective re-evaluation. Clarify this before final product acceptance.

The other Q11 open decisions remain documented in `docs/module-context/11-customers-risk.md`: warning vs automatic actions, store-only vs shared risk, phone availability on platform orders, duplicate matching/window and platform cancellation permissions. This audit follows the currently documented warning-only, store-scoped,24h assumptions.

## Cleanup and original data

- Both temporary stores,27 synthetic orders, test customers, blacklist settings/reviews, products and their database media records were removed through the store-delete API.
- Temporary staff was deactivated and scheduled for normal30-day deletion before its store was removed. Private staff password/token removed after cleanup.
- Two synthetic GCS product images were removed by exact object name after store deletion.
- Original account retained, active store restored; original store set, Customers list, Blacklist screen/settings, original duplicate group IDs, Expense summary and Home order/shipping/warehouse counts matched pretest snapshots.

## Limits

- Live manual-order/customer/return paths and public risk APIs were exercised. No real courier refusal/no-answer callback or third-party platform cancellation was initiated in this audit.
- No production timestamps were changed to simulate a24h gap. Existing utility/unit cases cover time-window boundaries locally; that is not reported as live time-passage coverage.
- No mobile UI, physical barcode scan or actual push-device delivery claim is made from API results.
- Fix the seven finding groups, deploy through CI/CD, then repeat live regression before signoff.
