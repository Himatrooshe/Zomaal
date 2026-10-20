# Customers & Risk Center fix verification — 2026-10-21

Status: **deployed; 342/342 live observations passed,0 failed.**

- Application commit:`0e7d246b4aa5577738f824455c852fcdfb9fc48c`.
- Serving revision:`zomaal-backend-00066-bbg`,100% traffic; revision commit label and health verified.
- [CI/CD run](https://github.com/Himatrooshe/Zomaal/actions/runs/39484499733): Test and build and Deploy production both completed successfully.
- Cloud Build:`63a35f20-968e-4b54-8c4a-4c4c4bffefe3`,SUCCESS.
- Production read-only catalog/migration verification confirmed `Customer_storeId_phoneDigits_idx` exists and migration`20261020192724_customer_phone_lookup_index` is applied.
- [Sanitized deployed observations and responses](live-fix-retest-results-2026-10-21.json). Counts include setup, requests, assertions and cleanup; they are not342 distinct business cases.

## Local verification

- Full unit suite:135 suites /1184 tests passed.
- All PostgreSQL gates:10 suites /256 tests passed; includes35 new Customers HTTP/database regressions.
- Build, Prisma schema validation, generated OpenAPI, scoped new/changed Customers implementation and new regression ESLint, and TypeScript Prettier passed.
- Repository-wide ESLint still fails existing unsafe mocks/typing issues:581 errors,135 warnings in the recorded run. This is not a repository-wide lint pass.
- Migration status was current before generation. Generated SQL contained unrelated legacy Product table drops; those were removed before local application. The committed migration creates only Customer_storeId_phoneDigits_idx; no data or table/column drops. Prisma cannot represent that expression index in schema.prisma. Schema diff after application shows only previously known legacy removals, with no missing additions.

## Behavior and rollout

Phone normalization retains a single legacy row's ID/history/risk. Historical collisions fail409 instead of silently merging histories; read-only production inventory found no such collisions. Existing invalid non-phone references remain distinct. Duplicate matching respects identifier precedence, Customer history honors cancellation, numeric/null input validation rejects400 and keep/cancel/dispatch claims serialize within a database transaction. Courier network calls are outside that lock.

No bulk customer rewrite; the additive index is compatible with prior app versions. Roll back the application commit if needed and leave the index intact. The existing retrospective-threshold question remains a client decision. ## Seven findings — actual deployed retest

| Finding | Verified response / persisted result |
| --- | --- |
| CUST-01 phone identity/blacklist bypass | Canonical and spaced phone produce one customer with2 orders. After canonical blacklisting, a spaced-phone order containsCUSTOMER_BLACKLISTED_WARNING. National,00-prefix and punctuated variants retain the same customer ID/blacklist and total6 orders/history entries. |
| CUST-02 title-based false duplicate | Known warehouse products`EJ3UPIR1` and`Z0V27CNC` share a display title; groupCount0. Same-product positive duplicate groups still form correctly. |
| CUST-03 history status | Cancelling a duplicate persistsCANCELLED and Customer history now says`Cancelled`, with customer cancellation risk still0. |
| CUST-04 concurrent whole-group cancellation | Four independent opposite-member races each returned200/400. Subsequent GETs found exactly oneCANCELLED and oneOPEN order in every pair. No all-cancelled group. |
| CUST-05 malformed/overflow queries | Fractional/junk page/limit/days and huge pages return400 across Customers/Blacklist/Duplicates, instead of silent coercion or500. Valid paging/counts still pass. |
| CUST-06 null settings | All seven required blacklist setting fields rejectnull with400; valid settings can still be saved. |
| CUST-07 limit overflow | Per-category integer overflow returns400; limits are documented0–100000, matching combined-limit validation. |

## Other repeated live checks

- Order-driven customer creation, exact/concurrent order retries, counts/history/address/name refresh and search.
- Individual threshold2, combined threshold2 replacing category threshold1, disabled limits, proximity/watchlist/high-risk totals and automatic blacklist reason.
- Manual blacklist/unblacklist, reason trimming/default, counter reset, warning toggle, in-app duplicate/blacklisted-order alerts.
- Duplicate keep, repeat/invalid cancellation, whole-group rejection, unknown/mixed IDs with atomic rollback.
- Cancelled duplicate dispatch request returns409 before a courier request is made.
- Permission removal applies to existing tokens; Customers vs Blacklist vs duplicate write permissions remain distinct; cross-store access404, missing authentication401.
- Repeated/concurrent return detection increments risk once.

## Cleanup

Both disposable stores were deleted with30 synthetic orders, test customers, risk/review data and two products. The synthetic staff account was deactivated and scheduled for normal30-day deletion before store deletion. Its temporary password/token were removed from private state. Two synthetic GCS product images were removed by exact object name.

Original account and store set retained; original active store restored. Original Customers list, Blacklist screen/settings, duplicate group IDs, Expense summary and Home order/shipping/warehouse counts matched the pretest snapshots.

## Limits and unchanged client decisions

This verifies deployed API regressions. It does not claim mobile UI, physical scanning, a live courier refusal/no-answer callback or a real third-party platform cancellation. No production timestamps or historical customer rows were fabricated for testing.

Single-legacy-row normalization, ambiguous legacy collision409, landlines/store-country behavior, platform identity/SKU fallbacks,24h boundary and dispatch-claim races passed real local PostgreSQL fixtures. The public live API cannot create an old unnormalized row after the fix; those legacy branches are therefore documented as PostgreSQL coverage, not invented live evidence.

Existing ambiguous legacy collisions require reconciliation; data is not silently merged. The pre-rollout production read-only check found0 such groups. Lowering thresholds remains prospective until another risk increment; retrospective behavior still needs the client's decision. Other Q11 assumptions remain documented in module context.
