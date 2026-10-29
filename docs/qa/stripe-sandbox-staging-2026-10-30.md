# Stripe isolated staging verification — 30 October 2026

## Environment and boundaries

- Service: https://zomaal-stripe-staging-563898960389.us-central1.run.app
- Final ready revision: `zomaal-stripe-staging-00004-ftv`, serving 100% of traffic.
- Database: `zomaal_stripe_staging`, on the existing Cloud SQL instance with a
  separate login role. No production merchant/order data was copied.
- Runtime identity: `zomaal-stripe-staging`, with Cloud SQL connection permission
  and access to staging secrets. JWT and encryption keys differ from production.
- Sandbox webhook: `/webhooks/stripe`, registered as its own Stripe snapshot
  destination on API version `2026-10-28.endive`.
- Staging keys only; live keys and another database name are refused by both
  configuration validation and the Stripe client. Schedulers and external
  business integrations are disabled. Production was not redeployed or migrated.
- Optional Redis retries are capped at one on staging so its intentionally absent
  Redis server does not delay cold starts. Rate limiting uses its database fallback.
- Staging starts with `node dist/main` after an explicit migration step. The
  default npm migration launcher delayed startup despite no pending migrations;
  production's entrypoint is unchanged. Apply future staging migrations before
  deploying a revision that depends on them.
- The supplied owner login was reproduced only in staging, with two empty QA
  stores, a synthetic staff member and an unrelated owner. Credentials/tokens are
  absent from this report. Staff has `products.view` and `ads.view` only.
- Staging plan fixtures use Starter with one store and no premium feature keys,
  and Pro with unlimited stores and `ads`, `shop`, `whatsapp`. These are test
  fixtures, not approval of final production entitlements or tax treatment.

## Verified with deployed API and real Stripe sandbox

The initial 18 API checks passed: owner/staff/other-owner login; plan availability
while expired; unauthenticated checkout rejection; unsigned webhook rejection;
expired-account write blocking; owner-only billing; forged amount/owner rejection;
Starter rejection for an existing two-store account; Pro checkout; same-session
reuse; cross-owner invoice isolation; and rejection of a staging JWT by production.

Chrome/Playwright completed Stripe-hosted Checkout. A decline test card produced
a genuine Stripe payment failure and a visible decline message, while the account
stayed read-only. The success test card completed the same sandbox Checkout.
No real card or real charge was used. An early browser assertion expected
different decline wording; inspecting Stripe's actual response corrected the
assertion. This was a test-locator issue, not a payment acceptance failure.

The subsequent 22 API/provider checks passed:

- Stripe reported the session `complete` and `paid`, with `livemode=false`.
- The verified webhook activated Pro (`provider=STRIPE`, `isReadOnly=false`).
- Exactly one invoice recorded **199.00 MAD**; replay did not duplicate it.
- Owner product-category writes succeeded after payment; the QA category was
  deleted after the check. Another subscription checkout was rejected.
- Staff inherited paid Pro availability and could read categories, but still
  could not write products, checkout, cancel/resume, or view billing history.
- An unrelated owner saw no invoice and remained read-only.
- Owner cancellation and resumption changed the actual Stripe subscription.
  Already paid access time remained unchanged.
- Replaying the signed real paid-invoice event returned HTTP 200 with
  `duplicate=true`, with one invoice remaining.
- Final end-of-period cancellation is enabled, preventing automatic sandbox
  renewals while leaving paid access available until **29 November 2026 22:45 UTC**.

Production baseline: the original login worked; the production account was
`TRIAL_ENDED`, had two stores, and the plans/invoices lists were empty. Sandbox
payment did not change this account's production subscription or permissions.
The final revision was smoke-tested again: health/login HTTP 200, active Pro,
one 199 MAD invoice, end-of-period cancellation, and an acknowledged duplicate
payment webhook. A final production read confirmed its original trial-ended,
manual, read-only state with zero invoices.

## Local verification

- `npm test -- --runInBand`: 144 suites, 1,395 tests passed.
- `STRIPE_TEST_DATABASE_URL=<dedicated-local-test-db> npm run test:e2e -- --runInBand stripe-billing.postgres`:
  18 tests passed. Real PostgreSQL, HTTP guards/validation, and raw-body signature
  handling; Stripe calls mocked. Covers concurrent receipts, invoice uniqueness,
  failed-payment periods, timeout idempotency, wrong-owner/live events, stale
  events after cancellation, starting checkout after an ended subscription, and
  a verified renewal invoice advancing the paid period exactly once.
- `npm run build`: passed.
- `npx prisma validate`: passed for the final schema.
- `npm run docs:generate`: generated the updated API contract.
- Focused ESLint/Prettier for changed billing/config/test files passed.
- Repository lint still reports 574 errors and 134 warnings in existing files.
- The additive migration was generated with Prisma's schema diff and reviewed:
  nullable Stripe links, unique Stripe invoice IDs and an event-receipt table.
  All migrations were applied to isolated staging and the disposable local test
  database; none were applied to production.

## Limits and next work

This validates monthly sandbox payment, access and permission flows, not live
charges. Yearly prices, production tax/entitlement policy, upgrades/downgrades,
proration, payment-method display and the customer portal remain out of scope.
Long-term renewal/dunning needs Stripe test-clock coverage. The frontend still
needs to call the new selected-plan Checkout endpoint. Production rollout is
disabled deliberately; it requires a separate reviewed live-mode change.

Rollback: redeploy the prior staging revision and set
`STRIPE_BILLING_ENABLED=false`. The migration is additive; leave the new columns
and receipt table in place rather than deleting payment history. Secrets remain
in the staging Secret Manager entries; never commit them into a deployment file.
