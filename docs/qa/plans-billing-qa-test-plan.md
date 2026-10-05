# Plans & billing API — manual QA test plan

Branch: `feature/plans-billing` · Module doc: `docs/module-context/17-settings-billing.md`
Swagger: `{{BASE_URL}}/docs` (tags **Billing**, **Admin Billing**, **Users**) · OpenAPI file: `docs/api/openapi.yaml`

## 1. Setup

| Variable | Value |
|---|---|
| `{{BASE_URL}}` | API base URL of the environment under test (staging / local) |
| `{{OWNER_TOKEN}}` | `accessToken` of a **new** test owner (from `POST /auth/verify-otp`) |
| `{{STAFF_TOKEN}}` | `accessToken` of a staff member of the same store |
| `{{ADMIN_TOKEN}}` | `accessToken` from `POST /admin/auth/login` (Zomaal admin panel account) |
| `{{OWNER_USER_ID}}` | The owner's user `id` (from `GET /users/me`) |
| `{{SCHEDULER_SECRET}}` | Ask the backend developer. Never paste it into tickets or chat. |

Headers:

```
Authorization: Bearer {{OWNER_TOKEN}}      (merchant routes)
Authorization: Bearer {{ADMIN_TOKEN}}      (/admin routes)
Content-Type: application/json
```

Use **test accounts and test plans only** (e.g. plan codes starting with `QA_`). Plans created on
staging are visible to every merchant on staging; deactivate them (`isActive: false`) when done.

### Key rules

- **Trial:** the trial starts when an owner creates their **first** store. It lasts 7 days and includes every feature, with unlimited stores.
- **Status** comes from `accessEndsAt`:

| `status` | Meaning | Read-only |
|---|---|---|
| `TRIALING` | In free trial | No |
| `ACTIVE` | Paid plan, period not ended | No |
| `TRIAL_ENDED` | Trial over, never paid | **Yes** |
| `EXPIRED` | Paid period over | **Yes** |

- **Read-only:**
  - Any create, update or delete by the owner **or their staff** returns **402** (§5). Viewing data still works.
  - Scheduled syncs (platform orders, metrics, TikTok Ads, QuickLivraison) stop.
  - These keep working: login and auth, `/users/*` (profile, delete account), `/billing/*`, `/notifications/*`, switching store.
- **Payment:** there is no in-app payment yet. A Zomaal admin records a payment received outside the app with `activate` (§4.4).
- **Cancel:** takes effect at the end of the paid period, with no refund. The plan stays usable until `accessEndsAt`.
- **Money:** all amounts are strings with 2 decimals (`"10.00"`); dates are ISO 8601 UTC.

## 2. Merchant endpoints

### 2.1 Current subscription

`GET {{BASE_URL}}/billing/subscription` (owner and staff)

**200 OK**: example right after the first store is created:

```json
{
  "status": "TRIALING",
  "isReadOnly": false,
  "plan": null,
  "interval": null,
  "trialEndsAt": "2026-10-12T14:59:21.274Z",
  "trialDaysLeft": 7,
  "currentPeriodStart": null,
  "currentPeriodEnd": null,
  "renewsAt": null,
  "cancelAtPeriodEnd": false,
  "canceledAt": null,
  "accessEndsAt": "2026-10-12T14:59:21.274Z",
  "provider": "MANUAL",
  "paymentMethod": null,
  "entitlements": { "maxStores": null, "storesUsed": 1, "features": ["ads", "shop", "whatsapp"] },
  "checkoutUrl": null,
  "canManage": true
}
```

- `plan` is the plan object (§2.2) once a paid plan is active.
- `trialDaysLeft` is only set while `TRIALING`; it counts partial days up.
- `renewsAt` is only set while `ACTIVE` and not cancelled.
- `entitlements.maxStores: null` means unlimited.
- `checkoutUrl` is the web payment page. It is `null` until the page exists; the app should then show "contact us".
- `canManage` is `false` for staff, who cannot cancel, resume or see invoices.

| Case | Status |
|---|---|
| No / invalid token | 401 `Unauthorized` |
| User has no store yet (still onboarding) | 404 `Store not found` |

### 2.2 Plans (Plans & Pricing screen)

`GET {{BASE_URL}}/billing/plans`: active plans only, sorted by `sortOrder`.

```json
[
  {
    "id": "uuid",
    "code": "QA_STARTER",
    "name": "QA Starter",
    "description": null,
    "monthlyPrice": "10.00",
    "yearlyPrice": "100.00",
    "currency": "MAD",
    "taxIncluded": true,
    "maxStores": 1,
    "features": [],
    "featureList": ["1 store"],
    "isActive": true,
    "sortOrder": 0
  }
]
```

`monthlyPrice` / `yearlyPrice` is `null` when the plan is not sold at that interval. Empty list `[]`
when no plans exist; that is still 200.

### 2.3 Cancel subscription (owner only)

`POST {{BASE_URL}}/billing/subscription/cancel` (no body) → **200**, same body as §2.1 with
`cancelAtPeriodEnd: true`, `canceledAt` set, `renewsAt: null`. `status` stays `ACTIVE` and
`accessEndsAt` is unchanged.

| Case | Status |
|---|---|
| Calling again while already cancelled | 200 (no change) |
| On trial / expired (not an active paid plan) | 409 `Only an active paid subscription can be cancelled` |
| Staff token | 403 |

### 2.4 Resume (undo cancel, owner only)

`POST {{BASE_URL}}/billing/subscription/resume` → **200**, `cancelAtPeriodEnd: false`, `renewsAt` set.

| Case | Status |
|---|---|
| Nothing pending | 409 `There is no pending cancellation to undo` |
| Staff token | 403 |

### 2.5 Billing history (owner only)

`GET {{BASE_URL}}/billing/invoices?page=1&limit=20` (limit 1–100)

```json
{
  "items": [
    {
      "id": "uuid",
      "planName": "QA Pro",
      "interval": "MONTHLY",
      "amount": "20.00",
      "currency": "MAD",
      "periodStart": "2026-10-05T14:59:21.961Z",
      "periodEnd": "2026-11-05T14:59:21.961Z",
      "paidAt": "2026-10-05T14:59:21.961Z",
      "provider": "MANUAL",
      "providerReference": null
    }
  ],
  "pagination": { "total": 3, "page": 1, "limit": 2, "totalPages": 2 }
}
```

Newest first. `planName` and `amount` are what was charged at the time, so later price changes do not alter them. Staff token → 403.

## 3. Delete account (30-day grace)

### 3.1 Request deletion

`DELETE {{BASE_URL}}/users/me` → **200**

```json
{
  "message": "Your account will be permanently deleted in 30 days. Log in and cancel before then to keep it.",
  "deletionScheduledFor": "2026-11-04T14:59:22.393Z"
}
```

- Calling again returns the **same** date; it does not reset to 30 days.
- Other devices are signed out at their next token refresh. The current access token keeps working until it expires.
- `GET /users/me` now shows `deletionRequestedAt` and `deletionScheduledFor`. The app should show a "deletion pending — cancel" banner.

### 3.2 Cancel deletion

`POST {{BASE_URL}}/users/me/deletion/cancel` → **200**
`{ "message": "Account deletion cancelled", "deletionScheduledFor": null }`

Nothing pending → 409 `No account deletion is pending`.

### 3.3 Purge job (internal)

`POST {{BASE_URL}}/internal/accounts/run`, header `x-zomaal-scheduler-secret: {{SCHEDULER_SECRET}}`

→ **200** `{ "due": 0, "deleted": 0, "failed": 0 }`

- Missing or wrong secret → 401 `Invalid scheduler credentials`.
- Scheduler disabled → 503.
- To test a real purge, ask the backend developer to move the test account's `deletionScheduledFor` into the past, then run it.
- After a purge, the user, their stores and staff are gone (login creates a fresh user). Billing history is kept for accounting.

## 4. Super-admin endpoints

All need `{{ADMIN_TOKEN}}`. A merchant token → 401. Every change appears in the admin activity log.

### 4.1 List plans (incl. inactive)

`GET {{BASE_URL}}/admin/plans` → array of plans (§2.2 shape).

### 4.2 Create plan

`POST {{BASE_URL}}/admin/plans`

```json
{
  "code": "QA_PRO",
  "name": "QA Pro",
  "description": "Optional text",
  "monthlyPrice": "20.00",
  "yearlyPrice": "200.00",
  "currency": "MAD",
  "taxIncluded": true,
  "maxStores": null,
  "features": ["ads", "shop", "whatsapp"],
  "featureList": ["Multiple businesses", "Ad optimization"],
  "isActive": true,
  "sortOrder": 1
}
```

- `code`: 2–32 characters, uppercase letters, digits or `_`, unique.
- Prices: positive with at most 2 decimals. At least one of `monthlyPrice` / `yearlyPrice` is required.
- `maxStores`: integer ≥ 1, or `null` / omitted for unlimited.
- `features`: any of `ads`, `shop`, `whatsapp` (what the plan unlocks). `featureList` is display text only.

| Case | Status |
|---|---|
| Success | 201 with the plan |
| No price | 409 `A plan needs a monthly price, a yearly price, or both` |
| Duplicate `code` | 409 `A plan with code QA_PRO already exists` |
| `code: "bad code"`, empty `name`, `monthlyPrice: "1.999"`, `features: ["nope"]` | 400 listing each problem |

### 4.3 Update plan

`PATCH {{BASE_URL}}/admin/plans/{planId}`: any subset of the create fields, e.g. `{ "monthlyPrice": "25.00" }`.

- Applies to **future** payments only; existing invoices are unchanged.
- `isActive: false` hides the plan from `/billing/plans` but keeps current subscribers.
- Clearing the only price returns 409. Unknown id returns 404. A non-UUID id returns 400.

### 4.4 Activate / renew (record a payment)

`POST {{BASE_URL}}/admin/merchants/{{OWNER_USER_ID}}/subscription/activate`

```json
{
  "planId": "uuid",
  "interval": "MONTHLY",
  "periods": 1,
  "amount": "10.00",
  "currency": "MAD",
  "paidAt": "2026-10-05T10:00:00.000Z",
  "providerReference": "bank transfer ref",
  "note": "optional"
}
```

- `periods`: 1–24 (default 1).
- `currency` defaults to the plan's currency.
- `paidAt` defaults to now.

**200**: `{ "subscription": { ...§2.1 }, "invoices": [ ...§2.5 items ] }`

Expected behaviour:

| Situation | New period |
|---|---|
| From trial / expired / different plan or interval | Starts **now**, ends now + periods |
| Same plan + interval, still active (early renewal) | Starts at current `accessEndsAt`, so no paid days are lost |

Activating also clears any pending cancellation and unlocks a read-only account immediately.

| Case | Status |
|---|---|
| Plan not sold at that interval | 409 `Plan QA_PRO is not sold yearly` |
| Unknown plan | 404 `Plan not found` |
| User id that owns no store | 404 `Merchant not found` |

### 4.5 Extend trial

`POST {{BASE_URL}}/admin/merchants/{{OWNER_USER_ID}}/subscription/extend-trial` with `{ "days": 5 }` (1–90)

- Adds the days to the current trial end. If the trial already ended, the days count from today.
- Already on a paid plan → 409 `Account is already on a paid plan`.

### 4.6 View a merchant's billing

`GET {{BASE_URL}}/admin/merchants/{{OWNER_USER_ID}}/subscription` returns the same shape as §4.4. An unknown merchant returns 404.

## 5. Enforcement checks

| # | Setup | Request | Expected |
|---|---|---|---|
| E1 | Plan with `maxStores: 1` active, owner has 1 store | `POST /stores` | 403 `{ "reason": "PLAN_UPGRADE_REQUIRED", "feature": "multi_store", "message": "Your plan allows 1 store. Upgrade to add more businesses." }` |
| E2 | Same owner during trial | `POST /stores` | 201 (trial = unlimited) |
| E3 | Plan without `ads` | `GET /ads/connections` | 403 `{ "reason": "PLAN_UPGRADE_REQUIRED", "feature": "ads" }` |
| E4 | Plan with `ads` | `GET /ads/connections` | 200 |
| E5 | Plan without `shop` | any `/shop/...` | 403 `feature: "shop"` |
| E6 | Account expired* | `PUT /stores/me` `{ "city": "X" }` | 402 `{ "reason": "SUBSCRIPTION_INACTIVE", "subscriptionStatus": "EXPIRED", "message": "Your subscription has expired. Renew to keep making changes." }` |
| E7 | Trial ended* | any POST/PUT/PATCH/DELETE (e.g. create expense) | 402, `subscriptionStatus: "TRIAL_ENDED"`, message mentions the free trial |
| E8 | Account expired* | `GET /stores/me`, `GET /billing/subscription` | 200 (`isReadOnly: true`) |
| E9 | Account expired* | `PATCH /users/me`, `POST /notifications/read-all`, `POST /billing/subscription/...` | Not 402 |
| E10 | Account expired*, staff token | any write | 402 (staff are locked with the owner) |
| E11 | E6, then admin `activate` | `PUT /stores/me` | 200 |

\* Expiring: ask the backend developer to set the test account's `accessEndsAt` in the past (there is
no API to shorten access on purpose).

## 6. Billing notifications

These show up in `GET /notifications` for the **owner only**, with `category: "BILLING"`, after the
notifications scheduler runs (`POST /internal/notifications/run`; see the Notifications QA plan).

| `type` | `severity` | When | `title` example |
|---|---|---|---|
| `TRIAL_ENDING` | WARNING | Trial ends in ≤ 3 days | `Your free trial ends in 2 days` |
| `SUBSCRIPTION_ENDING` | WARNING | Paid plan ends in ≤ 3 days | `Your QA Pro plan ends in 1 day` |
| `SUBSCRIPTION_EXPIRED` | CRITICAL | Trial ended / plan expired | `Your free trial has ended` / `Your subscription has expired` |

- `entityType: "SUBSCRIPTION"`, `metadata: { accessEndsAt, status }`.
- When the situation changes (e.g. admin activates a plan), the next run sets `resolvedAt`.
- A later period alerts again.

## 7. Suggested end-to-end run

1. New phone number → verify OTP → `GET /billing/subscription` returns 404.
2. `POST /stores` → `GET /billing/subscription` returns `TRIALING` with 7 days.
3. Admin creates `QA_STARTER` (maxStores 1, no features, monthly + yearly) and `QA_PRO` (unlimited, all features, monthly only).
4. `GET /billing/plans` lists both.
5. `POST /billing/subscription/cancel` returns 409 (trial).
6. Admin activates `QA_STARTER` monthly → `ACTIVE`, 1 invoice.
7. Run E1 and E3.
8. Cancel → cancel again → resume → resume again (409).
9. Admin renews `QA_STARTER` early → the new invoice period starts at the previous end.
10. Admin activates `QA_PRO` → E4 passes, entitlements unlimited.
11. Admin `extend-trial` returns 409.
12. Expire (backend dev) → E6, E8, E9, E10, then notifications run → `SUBSCRIPTION_EXPIRED`.
13. Admin activates again → E11, and the notification resolves on the next run.
14. Delete account → delete again (same date) → cancel → cancel again (409).
15. Clean up: deactivate the `QA_*` plans.
