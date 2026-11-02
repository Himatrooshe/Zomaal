# Issue 04 backend changes — 2 November 2026

This document records the backend implementation and local verification before
deployment. Check the release workflow for deployment status.

## Delivered behavior

- Expired writes still return `402 SUBSCRIPTION_INACTIVE` and the derived
  subscription status. Responses now include `canManage`, based on the billing
  owner's identity. Owners receive trial/renewal guidance; staff receive a
  read-only message directing them to the owner.
- Stripe's public return endpoint sends HTTP 303 to the configured
  `BILLING_CHECKOUT_SUCCESS_URL` or `BILLING_CHECKOUT_CANCEL_URL`. It preserves
  existing URL parameters and sets `outcome`. Without a configured destination,
  the existing informational JSON response remains available. Only known success
  and cancel outcomes redirect; request-supplied redirect destinations are ignored.
- Return URLs are validated at startup using the existing completion URL rules:
  HTTP(S) or explicitly allowlisted mobile schemes. Browser returns never
  activate subscriptions or create invoices; signed payment webhooks still do so.
- Both checkout store-capacity checks return a structured HTTP 409 with
  `reason=PLAN_STORE_LIMIT_EXCEEDED`, `storesUsed`, `maxStores`, and guidance to
  choose a plan that covers all owned stores. Inactive stores continue to count.
- Updated the environment example, generated OpenAPI contract and
  [integration instructions](../stripe-subscriptions-setup.md).

No schema migration, dependency change, production plan seed, JWT sharing or
production billing enablement was introduced.

## Verification

- `npm test -- --runInBand`: **146 suites, 1,440 tests passed**.
- Final focused check, `npm test -- --runInBand billing config/env.validation.spec.ts`:
  **7 suites, 99 tests passed**.
- `STRIPE_TEST_DATABASE_URL=postgresql://oshi@127.0.0.1:5432/zomaal_issue04_test npm run test:e2e -- --runInBand stripe-billing.postgres`:
  **20 tests passed**. Used a newly created local database with the repository's
  existing migrations and mocked Stripe calls. No deployed data or provider
  subscriptions were changed. Includes checkout, store eligibility, redirected
  returns without access/invoice grants, signed activation, invoice replay,
  cancellation/resumption, and owner/staff isolation.
- `npm run build`: passed on the final source.
- `npx prisma validate`: passed.
- `npm run docs:generate`: passed.
- `git diff --check`: passed.
- Changed-file formatting and lint commands below both passed:

```bash
npx prettier --check src/billing/stripe-billing.controller.ts src/billing/stripe-client.service.ts src/billing/stripe-client.service.spec.ts src/billing/stripe-billing.controller.spec.ts src/billing/subscription-access.interceptor.ts src/billing/subscription-access.interceptor.spec.ts src/billing/stripe-billing.service.ts src/config/env.validation.ts src/config/env.validation.spec.ts test/stripe-billing.postgres.e2e-spec.ts docs/stripe-subscriptions-setup.md
npx eslint src/billing/stripe-billing.controller.ts src/billing/stripe-client.service.ts src/billing/stripe-client.service.spec.ts src/billing/stripe-billing.controller.spec.ts src/billing/subscription-access.interceptor.ts src/billing/subscription-access.interceptor.spec.ts src/billing/stripe-billing.service.ts src/config/env.validation.ts src/config/env.validation.spec.ts test/stripe-billing.postgres.e2e-spec.ts
```

Repository-wide `npx eslint '{src,apps,libs,test}/**/*.ts'` still reports the
documented baseline of **574 errors and 134 warnings** in existing files. Used
read-only linting because `npm run lint` includes `--fix` and would rewrite
unrelated files. The full lint output is in
`/private/tmp/zomaal-issue04-repository-lint.log` for this session.

## Integration and release still required

The frontend source is outside this workspace. Its deployed build was confirmed
to mix production subscription calls with staging plans/checkout and one shared
token. It still needs consistent staging login and API routing, owner/staff UI
using `canManage`, and subscription/invoice refresh after returning from checkout.
Set both app return URLs to that staging-connected frontend when deploying this
backend change. The browser's outcome flag is informational; wait for server
subscription state before presenting payment as confirmed.

No new Stripe-hosted payment or Safari/iPhone acceptance run was performed for
this patch. Keep Issue 04 open until the frontend changes and full device
acceptance pass. To roll back, remove the two optional app return URL settings
or deploy the previous backend revision; no database rollback is needed.
