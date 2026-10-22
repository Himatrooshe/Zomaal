# 16. Notifications

Backend built on `feature/notifications` (`src/notifications/`).

## Screens
Notifications (All / Critical / Warning / Inventory). Examples: low stock ("5 items left"), overdue
payments ("2 customers have overdue payments"), unusual sales drop ("30% vs last week").

## Data flow (as Figma shows it)
The system generates notifications from other modules (stock, payments, sales). The merchant only reads them.

## What is built

| Type | Tab | Trigger | Who sees it |
|---|---|---|---|
| `LOW_STOCK` | Warning, Inventory | Variant available (onHand − reserved − damaged) ≤ its low-stock threshold | Owner + staff with `products.view` |
| `OUT_OF_STOCK` | Critical, Inventory | Variant available ≤ 0 | Owner + staff with `products.view` |
| `SALARY_OVERDUE` | Warning | Salary payment still PENDING after its due day (UTC) | Owner only |
| `BLACKLISTED_CUSTOMER_ORDER` | Critical | New order from a blacklisted customer, when "Warn on new order" is on | Owner + staff with `customers.view` |
| `SALES_DROP` | Warning | Net sales of the last 7 days ≥ 30% below the 7 days before (needs ≥ 5 orders in the earlier week) | Owner + staff with `analytics.view` |
| `PLATFORM_DISCONNECTED` | Critical | Shopify / YouCan / Lightfunnels connection not ACTIVE | Owner only |
| `PLATFORM_SYNC_FAILED` | Warning | Active platform connection has a stored sync error | Owner only |
| `COURIER_SYNC_FAILED` | Warning | QuickLivraison / ForceLog / OzoneExpress / Ameex has a stored sync error | Owner only |
| `TRIAL_ENDING`, `SUBSCRIPTION_ENDING`, `SUBSCRIPTION_EXPIRED` | Warning / Critical | Trial or manually activated subscription approaches or passes its end date | Owner only |
| `WHATSAPP_BALANCE_LOW`, `WHATSAPP_DISCONNECTED` | Warning / Critical | WhatsApp balance crosses its configured threshold or the connection is disconnected | Owner only |
| `DUPLICATE_ORDERS` | Warning | New order joins a duplicate group (same phone + same product within 24h) | Owner + staff with `customers.view` |

- State-based alerts (stock, salary, sales, connections) are evaluated by `POST /internal/notifications/run`
  (Cloud Scheduler, shared-secret header). An alert fires once when its condition starts and is marked
  resolved when it clears, so it can fire again next time.
- The blacklisted-order and duplicate-orders alerts fire immediately at order ingestion. The duplicate
  alert is resolved when the merchant cancels or keeps the group.
- Read state is per user. Push goes through FCM when `PUSH_NOTIFICATIONS_ENABLED=true`.

`LOW_STOCK` / `OUT_OF_STOCK` also cover packaging with "Auto Reorder Alert" on, at or below its minimum
level (`entityType: PACKAGING_MATERIAL`).

**Not built yet:** overdue customer payments (Q16.2) and Sendit sync failures
(no stored Sendit sync error is available).

**Production status (21 October 2026):** the in-app API and scheduled inventory
alert lifecycle passed live checks on revision `zomaal-backend-00068-vbx`.
The evaluator scheduler runs every five minutes and its recent invocation
returned HTTP 200. Firebase push is not configured on the serving revision, so
phone delivery is still unverified. See the
[live test report](../final-test/notifications/live-server-test-results-2026-10-21.md).

## Questions

**Q16.1 (blocker) — Full list of notification types**
Please list every alert you want, with its trigger. Candidates: low stock (product and packaging), new
blacklisted customer order, duplicate orders detected, courier sync failed, platform disconnected,
salary due, trial or subscription ending, WhatsApp balance low.
Answer: Not answered yet. Built the table above in the meantime.

**Q16.2 — "Customers have overdue payments"**
What does this mean for a COD business? Money a courier has not yet paid out to the merchant?
Answer:

**Q16.3 — "Unusual sales drop" rule**
Is it this week vs last week, a 30% drop, and checked daily?
Assumption: yes.
Answer: yes.

**Q16.4 — Push notifications?**
In-app list only, or also phone push (Firebase)? Do staff receive them too (based on permissions)?
Assumption: in-app + push. Staff get the ones for modules they can access.
Answer: Also in app and push.
