# Item Value — implementation, deployment and live verification

**22 October 2026 (Asia/Dhaka). Tested backend acceptance: passed.**

- Code commit `7a1cb34`, Cloud Run revision `zomaal-backend-00072-kmd`, 100% traffic.
- [CI/CD run](https://github.com/Himatrooshe/Zomaal/actions/runs/39662709829): test/build, required PostgreSQL workflow, deployment and smoke check all succeeded.
- **100/100 recorded live observations passed**, zero failed. Includes setup and cleanup observations, not 100 distinct scenarios.
- `GET /warehouse/item-value` now returns 200 rather than the earlier production 404. The original merchant account remains available.

## Delivered behavior

Current, store-scoped physical inventory valuation with all-item summary, kind filter and pagination. Products use variant warehouse cost. Packaging uses the latest purchase's actual paid total divided by quantity, including legacy Shop links. A repeatable-read transaction keeps stock and purchase-cost reads consistent; FX lookup happens afterward. Missing costs and exchange quotes remain unknown instead of generating invented amounts.

Only products with physical stock are included; archived products and inactive packaging with stock remain included. Incoming-only stock and virtual bundle inventory are excluded. Product components are counted as physical variants, without adding derived pack quantity again. Reserved and damaged units remain within on-hand and are separated from available units.

Requires `products.view`, resolves owner active store or staff assignment, and sends `Cache-Control: private, no-store`. Summary covers the whole kind-filtered inventory, independently of page. Monetary values are decimal strings; row values round to two decimals and summary money sums displayed row values. This API does not reconstruct historical inventory value.

## Review changes to the earlier local implementation

1. A confirmed free packaging purchase is known zero, including a foreign-currency free purchase. Legacy zero-cost products still lack provenance and remain unvalued.
2. Pagination rejects malformed, fractional, scientific, hexadecimal, duplicate and unsafe integer values; unknown query fields cannot override store scope.
3. Packaging lookup selects only the latest purchase per material in PostgreSQL, rather than loading the complete purchase history. Both the material and purchase are store-scoped, and date/creation/id ordering is deterministic.
4. Missing, negative, zero or non-finite FX quotes cannot manufacture a positive-cost valuation. A verified free purchase needs no FX quote.
5. Added cache/error documentation, full module registration, generated OpenAPI schemas, frontend/QA guides and a required PostgreSQL CI gate.

No dependency, schema or migration change was introduced. Existing unrelated workspace changes were preserved by developing on a clean feature worktree based on current main. Reverting the feature is schema-compatible and does not require rewriting inventory or purchases.

## Live results

Temporary merchant/store identities and inventory were seeded directly into a strictly scoped QA fixture. Store A was created through the app API; independent owner B and assigned staff used normal password login and genuine JWTs. Stock/purchase fixtures were set up through the database to exercise the read endpoint. This does not certify onboarding/SMS or product/purchase creation APIs. No notification, parcel or outbound customer-message flow was invoked.

| Scenario | Actual production result |
| --- | --- |
| Standard variant, MAD 12.50, 8 units across two locations | On-hand value 100.00; available 75.00; reserved 12.50; damaged 12.50 |
| Archived variant, 2 units at MAD 2 | Included at 4.00 |
| Six packaging units, latest purchase 18 / 6 | Unit cost 3.0000, value 18.00; a later-inserted older purchase did not override it |
| Four free packaging units paid in EUR | Known zero unit cost/value, not unvalued |
| Legacy zero product cost / packaging without a purchase | Null costs and values; incomplete subtotal |
| Live EUR packaging conversion | Positive real quote; quantity and displayed unit cost reconciled within rounding precision |
| Unsupported currency | Null cost/value, never an invented rate |
| Overall QA stock | Eight physical rows, 33 on-hand, 31 available, one reserved and one damaged |
| Incoming-only and virtual pack rows | Excluded |
| Kind filter | Product subtotal 104.00 across three physical product rows; packaging summary independent |
| Pagination / far page | Stable alphabetical rows, full filtered summary, empty far page retaining total/summary |
| Fourteen malformed query probes | 400 |
| Missing authentication / no-store user | 401 / 404 |
| Separate merchant owner | Only its own row and MAD 297.00 valuation |
| Staff owner-store switch | Staff continued reading its assigned store |
| Permission removal / deactivation | Existing staff JWT immediately received 403; restored permission worked |
| Repeated reads | Exact balances and purchase records unchanged; no new inventory or financial ledger events |
| New latest purchase | Next snapshot reflected 24.00 rather than cached 18.00 |
| Inactive packaging with stock | Still included at the updated value |
| Empty store | 200, complete zero valuation |
| Deployed OpenAPI / health | Item Value route and error contracts published; health 200 |

The unsupported-currency scenario is not a forced outage of the real FX provider. Deterministic quote conversion and missing/invalid quote paths are additionally verified locally.

## Local verification

- `npm test -- --runInBand` — **140 suites, 1,241 tests passed**.
- `ITEM_VALUE_TEST_DATABASE_URL=<disposable local DB> npm run test:e2e -- --runInBand item-value-workflow.postgres` — **27 tests passed**. Uses the real HTTP controller, validation, permission guard, store access and PostgreSQL; auth identities and FX quotes are controlled at test boundaries.
- The database suite includes actual manual purchase relations, legacy Shop variant/product links, discounted paid totals, invalid latest quantities, multi-location/archived/virtual stock, no cross-store purchase-cost leakage, paging, unsafe input, permissions and business-data immutability.
- `npm run build` — passed.
- Targeted ESLint and Prettier for changed code, workflow and tests — passed.
- `npx prisma validate` — passed.
- `npm run docs:generate` with synthetic local environment settings — passed; generated Item Value path and schemas committed.
- Existing constrained-heap Orders export check — passed after the module addition.
- `git diff --check` — passed.

After local fixture cleanup, the database contained zero users, stores, purchases, inventory balances and Shop catalog products; it was then dropped. No new production migration was needed.

## Cleanup

- Deleted both disposable user accounts with explicit identity/ownership checks; the original owner ID was excluded from deletion.
- Removed the peer store for the no-store acceptance case, then deleted the owner A fixture store and its inventory/purchases through the app's owner-authorized deletion endpoint. An additional empty fixture store was created, verified and deleted.
- Confirmed no fixture stock/cost rows remained. Original store list and selected store matched baseline; original Home order/catalog metrics were preserved. Temporary passwords and tokens were removed from runner state.
- Uploaded no images, created no courier parcel, and sent no SMS/WhatsApp messages. The temporary database proxy was stopped and its connection file removed.

## Remaining limits

No detailed Item Value Figma screen is available; frontend/device visual acceptance remains separate. This small controlled live test is not a large-catalog/load certification. Legacy Shop-link relationships were verified in PostgreSQL locally, while live cost fixtures used manual purchase links. Warehouse product cost is assumed to be in store base currency, as in the current warehouse contract; no historical cost/currency reconstruction is attempted. Reports remain outside v1.

[Sanitized observations and QA response examples](./live-server-results-2026-10-22.json) · [Frontend guide](./frontend-developer.md) · [QA guide](./qa-tester.md).
