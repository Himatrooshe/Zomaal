# Customers & Risk Center — QA handoff

**Current result: seven reproduced issue groups, awaiting fixes/deployment/retest.** [Live report](live-server-test-results-2026-10-21.md) · [Sanitized responses](live-server-results-2026-10-21.json).

## Priority regression cases

1. Same canonical/formatted phone must resolve to one identity and retain blacklist warnings.
2. Distinct known warehouse product codes with identical titles must not match through a weaker title fallback.
3. Cancel a duplicate and compare stored order state, customer history and timeline. All must show cancellation while merchant duplicate cleanup leaves customer cancellation risk unchanged.
4. Simultaneously cancel opposite members of a two-order group. At least one must survive. Repeat and inspect persisted states; this audit reproduced bothCANCELLED in two of four attempts.
5. Fraction/junk/oversized page/limit/days values must fail400 rather than truncate or throw500. Verify counts/pagination after correction.
6. Null required blacklist settings and integer overflow must fail400 without persisting partial values.
7. Repeat threshold/combined/disabled-limit, blacklist reset, warning toggle, reason auto-fill, keep group, mixed-selection atomicity, permission removal and store-isolation cases.
8. Repeat concurrent manual-order retries and return detection; totals/risk increment once.

## Test discipline

Use disposable stores, synthetic warehouse products/phones and manual orders. Preserve the original QA account. Do not rewrite production timestamps to test a24h window or manufacture courier outcomes. Genuine courier callbacks, platform cancellation and phone access approvals remain separate integration acceptance. Record counts as observations, not unique business cases.

After testing, schedule deletion/deactivate synthetic staff, delete test stores, remove exact test cloud media objects and compare original snapshots. Do not publish tokens/passwords or original customer records in evidence.

## Fix regressions

Test spaced/national/00-prefix phones and a blacklisted equivalent, concurrent first-sighting upserts, a single legacy row preserving its ID/history and a controlled historical alias collision returning409 without data loss. Add distinct known variants with equal titles/SKUs, same-variant changed-title/SKU controls and cross-platform SKU fallback. Repeat opposite-member cancellation races and inspect persisted states. Keep/cancel and dispatch-claim concurrency are covered by the PostgreSQL gate; do not fabricate an actual courier shipment.

`CUSTOMERS_TEST_DATABASE_URL=<dedicated local test database> npm run test:e2e -- --runInBand customers-risk.postgres` adds35 HTTP/database regressions. It never falls back to the application DATABASE_URL. CI runs the same gate. [Final deployed verification](fix-verification-2026-10-21.md) will record production acceptance.
