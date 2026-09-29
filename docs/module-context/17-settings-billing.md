# 17. Settings, multi-store, plans & billing

Billing and subscriptions are not built yet.

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
Answer:

**Q17.2 (blocker) — Payment gateway for web or card billing**
Which gateway for Morocco? SSLCommerz is Bangladesh-only.
Answer:

**Q17.3 — Final prices**
Starter 99 MAD and Pro 199 MAD per month. What is the yearly price? (Figma shows "126 MAD + tax".) Is tax/VAT included?
Answer:

**Q17.4 (blocker) — What is locked when the trial or subscription ends?**
Everything blocked, or read-only (the user can see data but not sync or add)? Does syncing stop?
Assumption: read-only. Syncing pauses.
Answer:

**Q17.5 — Cancel subscription**
Does it take effect immediately or at the end of the billing period? Any refunds?
Assumption: at period end, with no refunds.
Answer:

**Q17.6 — Multi-store**
Is each store fully separate (own data, own integrations, own staff)? Is one subscription per account
or per store? What is the store limit on Pro?
Assumption: fully separate stores, one subscription per account, limit to be defined.
Answer:

**Q17.7 — Delete account**
Delete immediately, or after a grace period (for example 30 days)? What happens to the stores and staff?
Assumption: 30-day grace period, then everything is deleted.
Answer:
