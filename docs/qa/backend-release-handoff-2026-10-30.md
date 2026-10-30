# Zomaal backend release and QA handoff — 30 October 2026

Prepared for the backend, frontend and QA teams. Dates below use Bangladesh time
(UTC+06:00) unless UTC is explicitly stated. No passwords, keys, bearer tokens or
OAuth authorization links are included.

## Release and environments

Release code: `718c0946be1fa2393f3af2537c94a8e90f215961` on `main`.
Combines the returns/currency/notifications fixes, Stripe catalog and Checkout,
signed billing webhooks, and Snapchat OAuth/reporting. The merge preserves both
Stripe and Snapchat PostgreSQL checks in CI.

- Production API: https://zomaal-backend-563898960389.us-central1.run.app
- Stripe sandbox staging: https://zomaal-stripe-staging-563898960389.us-central1.run.app
- [Release CI and deployment](https://github.com/Himatrooshe/Zomaal/actions/runs/40978440952)
- Production deployment verified: **`zomaal-backend-00077-d5f`**, ready and serving
  **100% of traffic**. Both CI jobs passed; final API smoke checks passed at
  **06:22:59 Bangladesh time** on 30 October.
- Production Snapchat is enabled. Production Stripe billing remains disabled;
  merging its code does not enable live payments or sandbox access grants there.
- Staging has its own database, database role, JWT/encryption keys and runtime
  identity. Its schedulers and external business integrations are disabled.

## Backend issues and fixes

| Issue                                   | Delivered behavior                                                                                                                                                                                                                                                                                                                                    | Acceptance still needed                                                                                                                                                          |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| BE-04 / D5: returns customer search     | List and order picker search manual or linked customer names and phones, plus order identifiers. Names are case-insensitive; whitespace and formatted phone input are handled. Queries and linked customers stay scoped to the active store.                                                                                                          | Retest the frontend search box against real saved customer records. Legacy orders without a saved customer are not backfilled automatically.                                     |
| BE-02 / D6: currency and return losses  | Convert amounts before aggregation. Lists/summaries use store currency; details and immutable allocations use order currency. Partial good/lost quantities allocate loss proportionally. Carrier fees and packaging costs are converted before posting. Missing FX causes an explicit error instead of an invented 1:1 rate, before condition writes. | Compare real carrier events and mixed-currency summaries. Historical misbooked events are not rewritten by this release.                                                         |
| Returns scanning and validation         | Validate and trim the detection value; validate order UUIDs and search inputs before service execution. Invalid arrays/objects/empty input fail clearly.                                                                                                                                                                                              | Frontend must send `{ "value": "<trimmed scan>" }`. Repeat the not-found scanner scenario with an entitled account; an expired subscription's 402 previously blocked that check. |
| Notification badges                     | Group unread counts into one database snapshot for consistent all/critical/warning/inventory counts.                                                                                                                                                                                                                                                  | Confirm frontend badge/category display after reading notifications.                                                                                                             |
| BE-01 / D1: renewal and expired account | Monthly sandbox catalog, hosted Checkout, signed webhook activation, invoice recording, cancellation/resumption and expiry/permission tests are implemented. Billing remains reachable while ordinary writes are locked.                                                                                                                              | Production billing is deliberately disabled. Production plans, final feature/store policy, taxes and live-mode rollout are still required.                                       |
| BE-03 / D10: app information            | Existing `/app/info` supports public legal/about/support configuration. No legal copy or URLs were invented.                                                                                                                                                                                                                                          | Publish approved pages and set `PRIVACY_POLICY_URL`, `ABOUT_APP_URL`, `TERMS_OF_SERVICE_URL`, `SUPPORT_EMAIL` on the deployed service. Verify current responses and every link.  |

The separate logout/session-revocation ticket is not closed by this release.
Earlier frontend fixture checks are not evidence of current production behavior.

## Stripe subscriptions

Approved sandbox products: **Starter 99 MAD/month**, **Pro 199 MAD/month**.
Yearly prices and tax treatment are not configured. Prices are fixed subscriptions,
quantity one per owner; no per-store/staff or metered-order charges were added.

A subscription covers the owner's stores. Usage is the actual owned-store count;
the server enforces the selected plan's store capacity. Staff inherit feature
availability while keeping their individual permissions. Display bullets do not
grant access. Sandbox fixture limits/features are QA policy, not approval of final
production entitlements. Starter campaign management versus the existing `ads`
feature gate still needs a product decision.

All merchant billing routes below use the **staging** base URL and bearer token.
Invoice history and subscription management are owner-only; staff may inspect
subscription availability but cannot manage billing.

| Method | Path                                     | Purpose                                                                                                              |
| ------ | ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| POST   | `/auth/login`                            | Login with `{ "phone": "<E.164>", "password": "<password>" }`; use the returned `accessToken`.                       |
| GET    | `/billing/plans`                         | List active plans and obtain the Zomaal plan UUID.                                                                   |
| GET    | `/billing/subscription`                  | Inspect status, access deadline, feature/store usage and read-only state.                                            |
| POST   | `/billing/stripe/checkout`               | Owner sends `{ "planId": "<Zomaal UUID>", "interval": "MONTHLY" }`; returns `sessionId`, `checkoutUrl`, `expiresAt`. |
| GET    | `/billing/stripe/return?outcome=success` | Public browser return; informational only. `outcome=cancel` handles cancellation.                                    |
| POST   | `/webhooks/stripe`                       | Public provider endpoint requiring a valid `Stripe-Signature` over the exact raw body.                               |
| GET    | `/billing/invoices`                      | Owner's invoice history.                                                                                             |
| POST   | `/billing/subscription/cancel`           | Set provider-backed end-of-period cancellation.                                                                      |
| POST   | `/billing/subscription/resume`           | Undo a pending cancellation before the paid period ends.                                                             |

Checkout validates server-side prices/currency and existing store count, reuses
open sessions and persists retry idempotency. A browser redirect never grants
access. Verified paid-invoice events activate access; duplicate receipts cannot
create duplicate invoices. Failed payments do not extend paid time. Immediate
cancellation/unpaid/paused status revokes access; scheduled cancellation preserves
the already-paid period.

Webhook URL:
`https://zomaal-stripe-staging-563898960389.us-central1.run.app/webhooks/stripe`

Snapshot events: `checkout.session.completed`, `invoice.paid`,
`invoice.payment_failed`, `customer.subscription.updated`,
`customer.subscription.deleted`. Endpoint API version: `2026-10-28.endive`.

Required staging configuration names:

```dotenv
STRIPE_BILLING_ENABLED=true
STRIPE_BILLING_ENVIRONMENT=staging
DATABASE_URL=<isolated database named zomaal_stripe_staging>
STRIPE_SECRET_KEY=<sandbox secret key>
STRIPE_WEBHOOK_SECRET=<this staging endpoint's signing secret>
STRIPE_STARTER_MONTHLY_PRICE_ID=<sandbox price ID>
STRIPE_PRO_MONTHLY_PRICE_ID=<sandbox price ID>
STRIPE_PUBLIC_BASE_URL=https://zomaal-stripe-staging-563898960389.us-central1.run.app
```

Do not copy this enablement block into production. Runtime refuses live keys or
another database name when enabled. The additive migration
`20261030040000_stripe_sandbox_billing` adds nullable Stripe links, unique invoice
IDs and webhook receipts. Production keeps its migration entrypoint; staging
starts directly with `node dist/main`, so future staging migrations must be
applied explicitly before deploying dependent code.

## Snapchat connection and reporting

Production scope: OAuth account connection, campaign discovery/selection and
reporting. The implementation does not change Snapchat campaigns or budgets.
The callback is:
`https://zomaal-backend-563898960389.us-central1.run.app/auth/snapchat-ads/callback`

Required server configuration: `SNAPCHAT_ADS_ENABLED=true`,
`SNAPCHAT_ADS_CLIENT_ID`, `SNAPCHAT_ADS_CLIENT_SECRET`,
`SNAPCHAT_ADS_REDIRECT_URI`, and a stable `ADS_TOKEN_ENCRYPTION_KEY`.
Credentials are stored in Secret Manager; preserve the encryption key across
deployments. Client credentials alone do not authorize an advertiser account.

Use the **production** base URL. Login to Zomaal first, then send
`Authorization: Bearer <accessToken>`. The active store and plan's `ads` feature
apply to all merchant routes. Expired access blocks writes with 402; staff also
need the permission shown below.

| Order    | Method and path                                        | Permission / action                                                                  |
| -------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| 1        | POST `/auth/login`                                     | Obtain the Zomaal access token.                                                      |
| 2        | POST `/ads/snapchat/auth/start`                        | `ads.manage`; open returned `authorizationUrl` in a browser and consent.             |
| 3        | GET `/auth/snapchat-ads/callback`                      | Public provider redirect only; Snapchat supplies code/state. Do not call manually.   |
| 4        | GET `/ads/connections?platform=SNAPCHAT`               | `ads.view`; choose the returned connection ID for the intended active store/account. |
| 5        | POST `/ads/snapchat/campaigns/:connectionId/refresh`   | `ads.manage`; fetch campaigns into the local mirror.                                 |
| 6        | GET `/ads/snapchat/campaigns/:connectionId`            | `ads.view`; inspect cached campaigns.                                                |
| 7        | POST `/ads/snapchat/campaigns/:connectionId/selection` | `ads.manage`; body `{ "externalCampaignIds": ["<Snap campaign UUID>"] }`.            |
| 8        | POST `/ads/snapchat/sync/:connectionId`                | `ads.manage`; fetch actual daily metrics for tracked campaigns.                      |
| 9        | GET `/ads/snapchat/metrics/:connectionId?days=7`       | `ads.view`; supported days: 1, 7, 30, 90.                                            |
| Optional | DELETE `/ads/connections/:connectionId`                | `ads.manage`; disconnect locally. This permission now applies to all ad platforms.   |

OAuth state is hashed, expires and is single-use. The callback rechecks the
store/permission/subscription before saving encrypted credentials. Refresh-token
rotation is serialized across instances; revoked access requires reconnection.
Unknown, duplicate, unavailable and cross-account campaign IDs are rejected.

Native reporting uses the account's actual currency and timezone. Micro-currency
amounts divide by 1,000,000; clicks mean swipes and purchases mean
`conversion_purchases`. Attribution uses conversion time, a 28-day swipe window
and a one-day view window. Match these settings in Ads Manager when comparing.
Initial/changed selections backfill 90 days in up-to-30-day chunks; subsequent
syncs reread 30 days. Failures preserve cached financial history. Reach/frequency
may be null; multi-day reach is not summed. `syncState` and `dataUpdatedAt`
distinguish no completed sync from a genuine zero-spend result.

`POST /internal/ads/snapchat/sync` uses the scheduler guard and secret. The setup
script includes a six-hour job, but the actual job still needs provisioning after
the first real account passes manual sync. Shared cross-platform statistics have
pre-existing currency/ratio/timezone limitations; this release does not close
those Google Ads review findings. Use the native Snapchat metrics route for QA.

## QA evidence and current account access

- Combined release: **145 suites / 1,423 unit tests passed**.
- PostgreSQL regressions: **75 passed** — Stripe 18, Snapchat 17, returns 22,
  backend audit 18.
  Provider calls are mocked in these database tests; raw-body signatures,
  transactions, permissions and HTTP validation use the real application paths.
- Stripe catalog: **6 tests passed**. Build, Prisma validation, OpenAPI generation,
  focused ESLint/Prettier and diff checks passed.
- Full repository lint has existing debt: last full run reported **574 errors and
  134 warnings**. Focused passing lint does not mean the repository is lint-clean.
- The first combined CI run passed Stripe/Snapchat but failed the older backend
  audit fixture because it did not register the new Stripe dependency. A
  three-line test-setup correction fixed it; all 18 audit tests then passed
  locally. This correction does not change runtime behavior.
- Deployed Stripe staging: **18 prepayment + 22 postpayment checks passed**.
  Chrome completed hosted Checkout with both a declined and successful test card.
  Signed payment activated Pro and recorded exactly one **199 MAD** invoice;
  replay returned duplicate acknowledgment. Owner writes, staff restrictions,
  invoice/store isolation, provider cancellation/resumption and production
  rejection of staging JWTs were checked. No real charge was made.
- Staging owner: active Stripe Pro with end-of-period cancellation enabled;
  paid access ends **30 November 2026 at 04:45:08** Bangladesh time.
- Snapchat production baseline: **14 checks passed**, including real logins,
  authorization URL/callback configuration, view-only restrictions, missing and
  invalid IDs, forged-state rejection and connection-list access. Completion of
  OAuth and nonzero advertiser data are separate acceptance checks.
- A subsequent read of the real production owner's account confirmed **one
  ACTIVE Snapchat connection and two cached campaigns**, reporting in USD.
  Its account timezone is `America/Los_Angeles`.
  Native metrics currently return `NOT_SYNCED`, `dataUpdatedAt=null`, and no
  reported campaigns. Connection is verified; actual advertiser metric sync
  and nonzero-value accuracy are not yet verified.
- The production owner account received an explicitly authorized,
  audited **seven-day trial extension**, not a paid activation. Access is
  `TRIALING`, with `ads`, `shop` and `whatsapp`, until
  **6 November 2026 at 06:00:32** Bangladesh time. No invoice/payment was created.
  Its Snapchat authorization-start request returned HTTP 200 after the grant.
  The trial eventually expires; it is not permanent premium access.
- Final post-deployment smoke check passed: production health/login/subscription
  and Snapchat reads returned HTTP 200; owner remains writable with two stores,
  three premium feature keys and zero invoices. Production still has zero plan
  records, and Stripe Checkout returns HTTP 503 as intended while disabled.
  Staging health/login returned HTTP 200; Pro remains active, with two plans,
  exactly one 199 MAD invoice and scheduled cancellation. No new payment or
  campaign selection/sync was performed by these final checks.

## Remaining work and rollback

1. The real advertiser connection is saved. Confirm the intended campaigns,
   select and sync them, then compare native spend, swipes, impressions and
   purchases with Snap Ads Manager. Current `NOT_SYNCED` status is not proof of
   zero spend. The earlier temporary QA merchant consent had not produced a
   saved connection; the later owner account check is the current evidence.
2. Provision the Snapchat scheduler after manual sync acceptance. Wire the
   frontend to these native reporting endpoints and display freshness/errors.
3. Approve final production plan/store/features/taxes and yearly prices; perform
   a separate live-mode Stripe rollout. Frontend selected-plan Checkout wiring,
   upgrades/downgrades/proration, customer portal and payment-method display remain.
4. Extend Stripe test-clock coverage for actual long-term renewal/dunning. A
   mocked-provider renewal regression passed, but does not replace that coverage.
5. Finish legal/support configuration, frontend/carrier acceptance, the separate
   logout ticket and shared Ads statistics findings.

Rollback: redeploy the previous production revision for a code regression;
disable Snapchat and pause its job if needed. Keep Stripe disabled on production.
Leave additive billing tables/columns and payment history intact. Preserve token
encryption keys and existing credentials. Local `.env` edits alone never update
Cloud Run configuration.

Detailed repository references: `docs/qa/sqa-backend-blockers-fixes-2026-10-29.md`,
`docs/qa/stripe-sandbox-staging-2026-10-30.md`,
`docs/qa/stripe-sandbox-staging-results-2026-10-30.json`,
`docs/stripe-subscriptions-setup.md`, `docs/snapchat-ads-integration.md`,
and generated `docs/api/openapi.yaml`.
