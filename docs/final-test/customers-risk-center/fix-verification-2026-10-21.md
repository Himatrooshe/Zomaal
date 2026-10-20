# Customers & Risk Center fix verification — 2026-10-21

Status: implemented and locally verified; deployment/live retest pending.

## Local verification

- Full unit suite:135 suites /1184 tests passed.
- All PostgreSQL gates:10 suites /256 tests passed; includes35 new Customers HTTP/database regressions.
- Build, Prisma schema validation, generated OpenAPI, scoped new/changed Customers implementation and new regression ESLint, and TypeScript Prettier passed.
- Repository-wide ESLint still fails existing unsafe mocks/typing issues:581 errors,135 warnings in the recorded run. This is not a repository-wide lint pass.
- Migration status was current before generation. Generated SQL contained unrelated legacy Product table drops; those were removed before local application. The committed migration creates only Customer_storeId_phoneDigits_idx; no data or table/column drops. Prisma cannot represent that expression index in schema.prisma. Schema diff after application shows only previously known legacy removals, with no missing additions.

## Behavior and rollout

Phone normalization retains a single legacy row's ID/history/risk. Historical collisions fail409 instead of silently merging histories; read-only production inventory found no such collisions. Existing invalid non-phone references remain distinct. Duplicate matching respects identifier precedence, Customer history honors cancellation, numeric/null input validation rejects400 and keep/cancel/dispatch claims serialize within a database transaction. Courier network calls are outside that lock.

No bulk customer rewrite; the additive index is compatible with prior app versions. Roll back the application commit if needed and leave the index intact. The existing retrospective-threshold question remains a client decision. Final CI/CD, serving revision, live responses and cleanup evidence will be added after deployment.
