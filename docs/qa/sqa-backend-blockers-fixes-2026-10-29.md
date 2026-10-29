# Backend follow-up to the 27–28 October SQA report

## Scope and status

This records local backend verification, not a production deployment or a new
frontend audit. Existing uncommitted currency and returns fixes were preserved.
No database schema, production records, subscription entitlements or cloud
settings were changed.

| Blocker | Local result | Remaining acceptance |
| --- | --- | --- |
| BE-04 / D5 | Both returns list and order lookup search manual and linked customer names/phones, plus order identifiers. Case-insensitive names, trimmed queries and formatted phone input are supported. Linked customer fields are returned when manual fields are absent. | Deploy and retest the frontend textbox against real saved customer records. |
| BE-02 / D6 | Existing currency changes pass unit and PostgreSQL regressions covering mixed-currency totals, prorated good/lost quantities, carrier fees, immutable order-currency allocations and missing-rate rejection before condition writes. | Deploy and retest real carrier events. Existing historical misbooked events are not rewritten. |
| BE-01 / D1 | Admin plan creation/update and manual payment activation already exist; billing remains reachable while locked. Placeholder prices must not be seeded. | Approved prices, intervals, tax treatment, features and store limits; production plan provisioning; manual renewal instructions or a real payment integration. |
| BE-03 / D10 | `/app/info` already exposes configurable links and support email. Missing fields remain null. | Publish approved documents and configure the values below on the deployed service. |

## Search contract

- Returns list: `GET /ecommerce/returns?search=<term>`.
- Order picker: `GET /ecommerce/returns/search?q=<term>`.
- Every query remains scoped to the authenticated active store. Linked customer
  matches also require the customer to belong to that store.
- Synced orders search the saved Customer relation. Legacy orders without a
  saved customer can still match order identifiers. No live marketplace lookup
  or customer backfill is triggered by search.
- List row values and summary cards use store currency. Detail/loss previews and
  immutable financial events use order currency. Costs are converted before
  posting; reporting converts amounts before aggregation. Never relabel an
  amount or assume an exchange rate of 1 when the currencies differ.

## Production configuration to complete

Get approved public destinations, then set the following on Cloud Run (editing
local `.env` does not change production):

```dotenv
PRIVACY_POLICY_URL=
ABOUT_APP_URL=
TERMS_OF_SERVICE_URL=
SUPPORT_EMAIL=
BILLING_CHECKOUT_URL=
```

The first three fields point to published pages, not inline document text.
Keep checkout empty until a functioning payment page exists. A checkout URL by
itself does not confirm payment or activate a subscription. Until a gateway is
selected, use the established manual payment process:

1. Use super-admin `GET /admin/plans` to inspect existing records.
2. Create approved plans with `POST /admin/plans`, or update existing records via
   `PATCH /admin/plans/:planId`. Set the approved monthly/yearly price, currency,
   tax treatment, feature keys, display features, store limit and active status.
3. Confirm the merchant sees the approved active plans at `GET /billing/plans`.
4. After an actual payment, record it using
   `POST /admin/merchants/:userId/subscription/activate` with the approved plan,
   interval, amount and payment reference. Do not use trial extension as a
   substitute for a paid renewal.
5. Retest an expired account: reads and billing remain accessible, ordinary
   writes return 402, and recorded activation restores the purchased access.
6. Check `GET /app/info`, open every returned legal/about URL and confirm the
   published content; then retest Settings on web and mobile.

## Verification

- `npm test -- --runInBand`: 143 suites, 1,389 tests passed.
- `npm run test:e2e -- --runInBand returns-workflow.postgres`: 22 tests passed
  using `RETURNS_TEST_DATABASE_URL` pointing to the existing disposable local
  PostgreSQL database. Includes actual customer search results, formatted phones,
  case-insensitive names, whitespace trimming and isolation between stores.
- `npm run build`: passed.
- `npx prisma validate`: passed.
- `npm run docs:generate`: passed; updated `docs/api/openapi.yaml`.
- Focused ESLint and Prettier checks passed for the five changed search/API/test
  files; `git diff --check` also passed.
- Repository lint (`npm run lint -- --fix=false`) remains failing with unrelated
  repository-wide debt. Its initial run reported 576 errors and 134 warnings,
  including two test-matcher typing errors corrected during this work.

No real customer message, courier dispatch, payment or production account
mutation was performed. The local PostgreSQL fixtures are cleaned by the suite.

## Rollout and rollback

Deploy the code and regenerated API contract together. No migration is needed
for the search fix. Roll back by redeploying the previous backend revision.
Provision approved configuration separately and preserve prior values. Deactivate
an unwanted plan via its admin API rather than deleting subscriptions or invoices.
