# Returns workflow test results — 19 October 2026

Tested backend revision: `b86a72b`.

Subsequent production manual-return testing is recorded separately in [live-server-test-results.md](./live-server-test-results.md). The results below describe the earlier isolated PostgreSQL run.

## Result

- Real PostgreSQL workflow suite: **14 passed**.
- Backend unit and HTTP regression suite: **135 suites, 1,179 tests passed**.
- Targeted ESLint, backend build, and whitespace checks passed.
- CI/CD: [run 39243081962](https://github.com/Himatrooshe/Zomaal/actions/runs/39243081962) — tests, the PostgreSQL Returns gate, build, production deployment, and deployment smoke check all passed.

## Method and data

Tests call the actual Returns HTTP controller, validation pipe, permission guard, access service, return service, condition writer, inventory engine, customer risk service, and financial ledger against a dedicated local PostgreSQL database with all committed migrations applied.

Authentication is replaced with synthetic test identities at the test-server boundary. Permissions and store access still use the real guard and database records. No external courier, marketplace, SMS, or WhatsApp service is contacted. Synthetic delivery and return timeline events model a parcel that was delivered and then returned.

Each standard fixture has 20 units initially, 2 sold units, purchase cost MAD 30 per unit, sale value MAD 200, and shipping cost MAD 15. Delivery reduces stock to 18. Revenue recognition and reversal run through the real ledger before return verification.

## Condition results

| Recorded condition | Total on hand | Damaged units | Return net loss |
| --- | ---: | ---: | ---: |
| Good | 20 | 0 | MAD 15 |
| Returned | 20 | 0 | MAD 15 |
| Damaged, default purchase cost | 20 | 2 | MAD 75 |
| Lost | 18 | 0 | MAD 75 |
| Missing | 18 | 0 | MAD 75 |

The damaged bucket is part of total on-hand stock, so the damaged fixture has 18 sellable units. An explicit damage amount of MAD 7.50 produces net loss MAD 22.50. Corrections from damage 7.50 → damage 10 → lost → good produce losses 22.50 → 25 → 75 → 15, with matching ledger totals and stock balances.

## Other passing cases

- Exact verification retries create no extra stock movements or ledger events.
- Partial verification stays open until all return lines have a condition.
- An unmatched product line does not invent purchase costs or stock; an explicit damage amount still counts.
- Concurrent scans resolve to one open return and increment customer return risk once.
- Third-party tracking barcode input, trailing scan newline, and QR payload resolve the same return.
- An unverified request older than two days appears in Delayed and leaves that tab when processed.
- Another store cannot detect or verify the return and sees no matching list/search result.
- Staff with only Returns view permission can read but receive 403 for scan/verify.
- A request containing a valid line followed by an unrelated line returns 400 before changing the valid line.

## Defects found and fixed

1. Verification read order lines without warehouse purchase costs, understating Damaged/Lost/Missing loss previews. The fixture returned MAD 15 instead of MAD 75. Verification now loads the costs used by the shared loss calculation.
2. Verification validated and changed lines in the same loop. An invalid later line could return 400 after earlier stock/ledger changes. It now validates membership of every submitted line before applying changes.

Both defects have regression coverage in the PostgreSQL suite, which is now a required CI step before deployment.

## Cleanup and remaining live coverage

Fixture cleanup confirmed zero remaining users, stores, returns, inventory movements, and financial events in the disposable database. That database was then removed. The production test account and its orders were not mutated.

Actual courier return webhooks/status mappings still require a provider test parcel. These fixture tests do not establish live courier behavior or frontend visual parity with Figma.

All financial fixtures use MAD throughout. Foreign-currency conversion is not established by this suite; the production test account's BDT base currency and AED source-order values remain a separate configuration/verification item.
