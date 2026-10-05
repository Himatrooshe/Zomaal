# 17. Settings, multi-store, plans & billing

Built on branch `feature/plans-billing`. See **What's built** at the end. QA plan: `docs/qa/plans-billing-qa-test-plan.md`.

## Screens
Settings (edit profile, store information, change password, plan & billing, about, privacy, delete
account, logout) · Store list popup (current store, switch, add new store) · Plans & Pricing (Starter
99 MAD, Pro 199 MAD, monthly / yearly, feature list) · Billing information (card) · Plan & Billing (current
plan, next billing, payment method, billing history) · Cancel subscription · Free trial banner (7 days) ·
Trial ended / Subscription expired overlays · Checkout via SSLCommerz (annual membership).

## Data flow (as Figma shows it)
1. A new user gets a 7-day free trial.
2. The user picks Starter or Pro, monthly or yearly, and pays by card.
3. The plan unlocks features. Pro adds Ad optimization, WhatsApp automation, Multi-store, and Zomaal Shop.
4. When the trial or subscription ends, the app is locked behind the plan screen.

## Questions

**Q17.1 (blocker) — App Store / Play Store billing rules**
Apple and Google usually require in-app purchase for digital subscriptions sold inside a mobile app
(they take 15–30%). Should we use in-app purchase, or have users pay on the web only?
Answer: Users pay on the web only.

**Q17.2 (blocker) — Payment gateway for web or card billing**
Which gateway for Morocco? SSLCommerz is Bangladesh-only.
Answer: Not decided yet. Until it is, a Zomaal admin records the payment and activates the plan manually (super-admin API).

**Q17.3 — Final prices**
Starter 99 MAD and Pro 199 MAD per month. What is the yearly price? (Figma shows "126 MAD + tax".) Is tax/VAT included?
Answer: Yes. Prices are set by admin in the database (super-admin API), not hardcoded; Figma numbers are placeholders.

**Q17.4 (blocker) — What is locked when the trial or subscription ends?**
Everything blocked, or read-only (the user can see data but not sync or add)? Does syncing stop?
Assumption: read-only. Syncing pauses.
Answer: Read-only, syncing stopped.

**Q17.5 — Cancel subscription**
Does it take effect immediately or at the end of the billing period? Any refunds?
Assumption: at period end, with no refunds.
Answer: At the end of the period. No refund.

**Q17.6 — Multi-store**
Is each store fully separate (own data, own integrations, own staff)? Is one subscription per account
or per store? What is the store limit on Pro?
Assumption: fully separate stores, one subscription per account, limit to be defined.
Answer: Starter: one subscription, one store. Pro: multiple businesses.

**Q17.7 — Delete account**
Delete immediately, or after a grace period (for example 30 days)? What happens to the stores and staff?
Assumption: 30-day grace period, then everything is deleted.
Answer: 30-day grace period.

Existing merchants: every account that already owns a store gets a fresh 7-day trial starting on release
day (done by the migration).

## What's built

**Data.** `Plan` (admin-managed prices, `maxStores` with null meaning unlimited, `features` such as `ads`,
`shop` and `whatsapp`, display `featureList`). `Subscription` (one per owner account; `accessEndsAt` is the
single date that decides access). `BillingInvoice` (billing history; plan name and amount are snapshotted
so later price changes never rewrite history). `User.deletionRequestedAt` / `deletionScheduledFor`.

**Status** is derived from dates, never stored: `TRIALING`, `ACTIVE`, `TRIAL_ENDED`, `EXPIRED`. The last
two make the account read-only.

**Trial.** 7 days from the owner's first store, with every feature and unlimited stores.

**Locked account (Q17.4).**
- Any write by the owner or their staff returns `402` with `reason: SUBSCRIPTION_INACTIVE`. Reads keep working.
- Still allowed while locked: auth, profile and delete account (`/users`), billing, notifications, and switching store.
- Scheduled platform, metrics, TikTok Ads and QuickLivraison syncs skip locked accounts.
- Shopify webhooks keep processing because GDPR requires it.

**Plan limits (Q17.6).**
- Creating a store beyond `maxStores` returns `403` with `reason: PLAN_UPGRADE_REQUIRED` and `feature: multi_store`. The first store is always allowed.
- Ads (`/ads`, `/ads/tiktok`) and Zomaal Shop (`/shop`) need the `ads` / `shop` plan feature.

**Merchant API.**
- `GET /billing/plans`
- `GET /billing/subscription` (owner and staff; staff get `canManage: false`)
- `POST /billing/subscription/cancel` and `/resume` (owner only)
- `GET /billing/invoices` (owner only)
- `checkoutUrl` comes from `BILLING_CHECKOUT_URL`; it is null until the web payment page exists.

**Super-admin API.**
- `GET/POST /admin/plans`, `PATCH /admin/plans/:planId`
- `GET /admin/merchants/:userId/subscription`
- `POST /admin/merchants/:userId/subscription/activate` records a payment received outside the app. Renewing the same plan early extends from the current end; anything else starts now.
- `POST /admin/merchants/:userId/subscription/extend-trial`
- Every admin change is written to the admin activity log.

**Delete account (Q17.7).**
- `DELETE /users/me` schedules deletion in 30 days and signs out other devices.
- `POST /users/me/deletion/cancel` undoes it.
- `POST /internal/accounts/run` (Cloud Scheduler, daily, `ACCOUNTS_SCHEDULER_*`) deletes due accounts. Stores and staff cascade; billing history is kept, detached from the user.

**Notifications** (owner only, `BILLING` category):
- `TRIAL_ENDING` (warning, 3 days before)
- `SUBSCRIPTION_ENDING` (warning, 3 days before; activation is manual, so there is no auto-renew)
- `SUBSCRIPTION_EXPIRED` (critical)

**Not built yet.** Payment gateway or web checkout (waiting on Q17.2), and stored card / payment method
(`paymentMethod` is always null).
