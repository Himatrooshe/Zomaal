# Stripe sandbox catalog setup

Branch: `feature/stripe-subscriptions`.

The catalog setup is ready for the approved Starter (99 MAD/month) and Pro
(199 MAD/month) prices. This is product provisioning, not a working payment
integration. It does not activate subscriptions or change Zomaal plan records.

## Run when the sandbox key is available

1. Open your Stripe sandbox and put its secret key in the ignored local `.env`:
   `STRIPE_SECRET_KEY=sk_test_...`. Restricted sandbox keys (`rk_test_...`) also
   work if they can read/write Products and Prices. Never paste secrets into chat.
2. Preview without contacting Stripe: `npm run billing:catalog`.
3. Create/reuse sandbox products and recurring prices:
   `npm run billing:catalog -- --apply`.
4. Copy the printed `STRIPE_STARTER_MONTHLY_PRICE_ID` and
   `STRIPE_PRO_MONTHLY_PRICE_ID` into `.env`. These names are reserved for the
   upcoming runtime integration; the existing billing service does not use them.

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
  future Checkout must use quantity 1 per owner subscription, not per staff/store.
- Existing feature keys are `ads`, `whatsapp`, and `shop`. Display bullets do not
  grant permissions. Pro features must remain separate from staff authorization.
- Starter's advertised campaign management conflicts with the current single
  `ads` gate. Decide whether to split basic campaign access and Pro optimization
  before provisioning final Zomaal entitlements.
- Do not change permissions, activate plans, extend trials, reset usage or apply
  upgrade/downgrade proration from a browser redirect or product-creation result.

## Remaining subscription integration

Still required: server-side plan/price mapping and price verification; owner-only
Checkout creation; approved success/cancel destinations; Stripe customer and
subscription linkage; signed, idempotent webhooks; payment-confirmed period and
invoice updates; failed-payment policy; provider-backed cancellation/resumption;
and integration tests for staff denial, expiry, retries and store limits.

The webhook signing secret (`whsec_...`) will be separate from the API key. Add it
when a webhook receiver is implemented. The existing generic
`BILLING_CHECKOUT_URL` is not a selected-plan checkout session.

References: [Products](https://docs.stripe.com/api/products/create),
[Prices](https://docs.stripe.com/api/prices/create),
[Idempotency](https://docs.stripe.com/api/idempotent_requests),
[Sandboxes](https://docs.stripe.com/sandboxes).
