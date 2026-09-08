# Reviewed: safe to drop

Required by the "Reject destructive production migrations" gate in
`.github/workflows/ci-cd.yml`. See `docs/destructive-migrations.md`.

## What this migration drops

- `ExpenseEntry` (table)
- `AdSpendEntry` (table)
- `ExpenseCategory` (enum) — dropped to free the name for the new
  `ExpenseCategory` **table**, which is why the drop can't simply be deferred
- `AdPlatform` (enum) — only ever used by `AdSpendEntry`

## What was checked, and what was found

**1. Nothing can have written to either table.** Both were created by
`20260830174828_add_expense_and_ad_spend_ledger` as part of a manual
expense/ad-spend ledger that was deliberately made read-only before it ever
shipped: the `POST`/`PATCH`/`DELETE` endpoints were removed, leaving only
`GET` handlers that always returned empty/zero. There has never been a code
path capable of inserting a row.

**2. Production has never had these tables at all.** The migration that
creates them (2026-08-30) has never been applied to production — prod's most
recent Cloud Run revision is `zomaal-backend-00033-kzh` (2026-08-27), which
predates it, and the deploy pipeline has been blocked since. Verified via
`gcloud run revisions list`. So in production this migration will create the
tables and drop them within the same `prisma migrate deploy` run, touching no
data.

**3. The only consumer was deleted in the same commit.** `src/finance/` (the
entire dormant module: both controllers, both services, both DTO files) is
removed, and `FinanceModule` is unregistered from `app.module.ts`. Verified
with `grep -rn "ExpenseEntry\|AdSpendEntry\|AdPlatform"` over `src/` — no
references remain outside the deleted module.

**4. `AdPlatform` is not the ads module's enum.** The live ads integration
uses a separate enum, `AdsPlatform` (note the `s`), on `AdsConnection` /
`AdsCampaign` / `AdsMetricSnapshot`. That one is untouched.

## Deliberately NOT dropped

`Product`, `ProductImage`, `ProductListing`, `ProductVariant` — Prisma's diff
wants to drop these on every migration because they were removed from
`schema.prisma` long ago without a migration. They are intentionally left in
place: deployed code wrote to them between 2026-07-27 and 2026-08-09, so they
may hold real production rows that nobody has verified. The resulting
removal-only schema drift is expected and is tolerated by the drift check
(warning, not failure). See the note in
`20260830174828_add_expense_and_ad_spend_ledger/migration.sql`.

Reviewed by: Claude Opus 5, on behalf of the repository owner, 2026-09-07.
