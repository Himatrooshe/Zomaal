# Stripe sandbox billing setup

Branch: `feature/stripe-checkout-webhooks`.

The catalog setup is ready for the approved Starter (99 MAD/month) and Pro
(199 MAD/month) prices. The catalog command only provisions products. The
runtime integration now supports owner-only hosted Checkout, signed webhooks,
payment-confirmed access/invoices, and provider-backed cancellation/resumption
in isolated staging. See the [staging QA report](qa/stripe-sandbox-staging-2026-10-30.md).

## Run when the sandbox key is available

1. Open your Stripe sandbox and put its secret key in the ignored local `.env`:
   `STRIPE_SECRET_KEY=sk_test_...`. Restricted sandbox keys (`rk_test_...`) also
   work if they can read/write Products and Prices. Never paste secrets into chat.
2. Preview without contacting Stripe: `npm run billing:catalog`.
3. Create/reuse sandbox products and recurring prices:
   `npm run billing:catalog -- --apply`.
4. Copy the printed `STRIPE_STARTER_MONTHLY_PRICE_ID` and
   `STRIPE_PRO_MONTHLY_PRICE_ID` into `.env`.

The command rejects live keys before making requests. Stable product IDs,
price lookup keys and idempotency keys make retries reuse matching resources.
Conflicting or archived resources produce an error rather than changing their
price or ownership. A partially completed run can be retried. No dependencies,
database migrations, customer records or payments are created. Products are not
automatically deleted on failure; inspect/archive unwanted sandbox resources in
Stripe if needed.

Yearly prices and tax treatment remain undecided; the script does not set tax
behavior or enable automatic tax. Confirm tax configuration before Checkout.
Sandbox IDs cannot be reused in live mode.

## Usage and permissions to preserve

- One subscription belongs to an owner and covers that owner's stores. Staff
  inherit plan availability while retaining their individual permission grants.
- Store usage is the actual count of stores owned by that account. Enforce the
  configured `Plan.maxStores` on the server; no numeric limits have been approved
  for these products yet.
- Orders are shown as unlimited in the approved design. Do not add metered
  charges, order caps or overage fees. Catalog prices are fixed monthly prices;
  Checkout uses quantity 1 per owner subscription, not per staff/store.
- Existing feature keys are `ads`, `whatsapp`, and `shop`. Display bullets do not
  grant permissions. Pro features must remain separate from staff authorization.
- Starter's advertised campaign management conflicts with the current single
  `ads` gate. Decide whether to split basic campaign access and Pro optimization
  before provisioning final Zomaal entitlements.
- Do not change permissions, activate plans, extend trials, reset usage or apply
  upgrade/downgrade proration from a browser redirect or product-creation result.

## Runtime staging configuration

```dotenv
STRIPE_BILLING_ENABLED=true
STRIPE_BILLING_ENVIRONMENT=staging
DATABASE_URL=postgresql://<staging-user>:<password>@<host>/zomaal_stripe_staging
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_STARTER_MONTHLY_PRICE_ID=price_...
STRIPE_PRO_MONTHLY_PRICE_ID=price_...
STRIPE_PUBLIC_BASE_URL=https://zomaal-stripe-staging-563898960389.us-central1.run.app
```

Runtime refuses live keys, a non-staging environment, or another database name.
Leave `STRIPE_BILLING_ENABLED=false` in production. Staging uses its own database
role, JWT/encryption keys, Secret Manager entries and Cloud Run runtime identity.
Third-party integrations and all automated schedulers are disabled there.

Post `{ planId, interval: "MONTHLY" }` with the owner's bearer token to
`/billing/stripe/checkout`; open the returned `checkoutUrl` in a browser. Repeated
requests reuse an open session. A paid subscription blocks additional checkouts;
plan changes/proration are intentionally not implemented.

Register a **snapshot** event destination at
`https://zomaal-stripe-staging-563898960389.us-central1.run.app/webhooks/stripe`,
with API version `2026-10-28.endive` (the installed SDK version), for:
`checkout.session.completed`, `invoice.paid`, `invoice.payment_failed`,
`customer.subscription.updated`, and `customer.subscription.deleted`.
Use the signing secret from this staging destination, not another endpoint or CLI
listener. It is separate from the API key. The handler reads the exact raw body,
verifies signatures/timestamps, and commits a receipt with billing changes.

Failed payments never extend access; past-due accounts retain only already paid
time. Immediate cancellation/unpaid/paused status revokes access. End-of-period
cancellation preserves the paid period. A browser return never grants access.
The existing `/billing/subscription/cancel` and `/resume` endpoints manage Stripe
subscriptions at the provider before updating local cancellation state.

## Remaining before a production rollout

Approve production entitlements, limits, taxes, yearly prices, and the Starter ads
policy. Implement a reviewed live-mode rollout; this branch deliberately only
enables isolated sandbox billing. Wire the frontend to the new Checkout API.
Payment-method display/customer portal and upgrades/downgrades/proration are not
included. Advance a Stripe test clock for full renewal/long-term dunning coverage.
The existing generic `BILLING_CHECKOUT_URL` is not a selected-plan session.

References: [Products](https://docs.stripe.com/api/products/create),
[Prices](https://docs.stripe.com/api/prices/create),
[Idempotency](https://docs.stripe.com/api/idempotent_requests),
[Sandboxes](https://docs.stripe.com/sandboxes).
