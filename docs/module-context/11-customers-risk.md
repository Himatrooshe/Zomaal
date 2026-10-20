# 11. Customers & Risk Center (Blacklist, Duplicate Orders)

## Screens
Customers list · Customer details (orders placed, risk score, cancellations, refusals, no-answer, total
risk actions, order history, "Add to blacklist — reason auto-filled") · Blacklist (At-risk customers
"2/3 returns — 1 more = blacklist", Blacklisted) · Blacklist settings (limits for returns / cancellations /
refusals / no-answer, combined limit, warn on new order) · Remove from blacklist · Duplicate orders
(groups by "Same phone number", main vs duplicates, cancel selected).

## Data flow (as Figma shows it)
1. Customers are built automatically from orders, with the **phone number** as the identity.
2. Risk counters go up from order and courier outcomes (return, cancel, refusal, no answer).
3. When a limit is reached, the customer is blacklisted. New orders from them trigger a warning.
4. Duplicate orders are detected and grouped. The merchant cancels the extras.

## Duplicate orders (built, using the Q11.5 / Q11.6 assumptions)

**Rule.** Two orders are duplicates when they have the same customer (same store + phone, E.164), share
at least one product, and were placed within 24 hours of the group's oldest order. The oldest order is
**Main**. Cancelled orders and orders the merchant already decided on are left out. Product matches compare each line pair. Matching warehouse variants win; conflicting known variants cannot be overridden by SKU/title. Within one connection, conflicting platform variant/product IDs cannot be overridden by weaker keys. Case-insensitive SKU supports cross-platform matching; normalized title is the final fallback when stronger comparable identities are missing.
Orders without a phone (e.g. Shopify without protected customer data, Q11.4) cannot be grouped.

Groups are computed when read, so there is no stored "group" table. Merchant decisions are stored per
order in `DuplicateOrderReview` (`KEPT` | `CANCELLED`).

| Method | Path | Permission | What it does |
|---|---|---|---|
| GET | `/customers/duplicate-orders?days=30&page=1&limit=20` | `customers.view` | Groups placed in the last `days` (1–90), newest first. Each order has `canCancel` and `dispatchStatus`. |
| POST | `/customers/duplicate-orders/cancel` | `orders.cancel` | Body `{ "orderIds": [uuid] }`. Cancels the selected orders. |
| POST | `/customers/duplicate-orders/:groupId/keep` | `orders.edit` | "Not duplicates": keeps every order in the group (`groupId` = main order ID). The group disappears. |

**Cancel rules.**
- Every selected order must be in a current group, and at least one order per group must stay.
- An order already dispatched through a Zomaal courier (dispatch not `FAILED`) cannot be cancelled → `409`.
- Manual orders: status becomes `CANCELLED`.
- Platform orders: our Shopify scopes are read-only and YouCan/Lightfunnels write access isn't wired, so
  the order is cancelled **in Zomaal only**. The response returns `platformCancelRequired: true` so the
  app can tell the merchant to cancel it on the platform too. Zomaal blocks courier dispatch for it.
- A `DUPLICATE_ORDER_CANCELLED` timeline event is added to each cancelled order.
- A cancelled duplicate does not count as a customer cancellation for blacklist risk.

**Alert.** A new order that creates or joins a group raises `DUPLICATE_ORDERS` (see module 16), once
per group. Cancel or keep resolves it.

**To change when the client answers:** the 24h window is `DUPLICATE_WINDOW_HOURS` in
`src/customers/duplicate-orders.util.ts`. Real platform cancel needs write scopes
(`write_orders` on Shopify) and a cancel call in `DuplicateOrdersService.cancel`.

## Questions

**Q11.1 (blocker) — What does blacklisting actually do?**
Options: warning only, auto-cancel new orders, or block shipping through Zomaal.
Assumption: warning only (the timeline event + a flag on the order).
Answer:

**Q11.2 (blocker) — Blacklist shared between merchants?**
Is the blacklist per store only, or is there a network-wide "bad customer" score across all Zomaal
merchants? This has privacy and legal implications.
Assumption: per store only.
Answer:

**Q11.3 — Refusals / No answer only for Zomaal-shipped orders**
Those statuses come from our couriers. For merchants shipping outside Zomaal, only returns and cancellations count. Is that OK?
Answer:

**Q11.4 — Customer phone for platform orders**
Shopify hides customer phone and name unless the app is approved for "protected customer data". Is
applying for that approval in scope? Without it, Customers and Blacklist only work for YouCan, Lightfunnels, and manual orders.
Answer:

**Q11.5 (blocker) — Duplicate order rule**
What makes two orders duplicates: same phone within X hours, same phone + same product, or something else?
What is X?
Assumption: same phone + same product within 24 hours, and the oldest order is "Main".
Answer:

**Q11.6 — Cancel duplicates on the platform too?**
Should "Cancel selected" also cancel the order on Shopify/YouCan?
Assumption: yes, when the platform API allows it. Otherwise it is only marked cancelled in Zomaal.
Answer:

## Live audit — 2026-10-21

Serving revision `zomaal-backend-00065-zbd`:326 recorded observations,291 passed and35 failed expectations across seven finding groups. Reproduced: formatted-phone identity/blacklist-warning bypass; same-title false duplicate matches between distinct warehouse products; incorrect cancelled-duplicate customer-history badge; concurrent cancellation of every group member; numeric query coercion/overflow; null settings500; per-category integer overflow500. Existing Customers unit baseline:70 passed. Original account/business snapshots preserved; synthetic stores/orders/products/staff access/media cleaned up. No application fixes or deployment occurred in this audit.

See [live report and handoffs](../final-test/customers-risk-center/README.md). Lowering risk limits does not retrospectively blacklist existing customers until the next risk increment; client requirements do not yet define retrospective re-evaluation, so this is documented separately rather than counted as a failed test.

## Fix contract — 2026-10-21

Customer phone ingestion normalizes valid international, spaced/punctuated,00-prefix and store-country national phone formats to E.164, including landlines. A single existing legacy-formatted customer is renamed in place, keeping its ID, risk state and order history. Non-phone legacy references retain their exact identity. Multiple existing rows that normalize to the same phone return409 for reconciliation; risk histories are never silently combined or deleted. A read-only pre-rollout production inventory found17 customers,14 valid phones,12 needing formatting normalization and0 colliding groups. There is no bulk rewrite.

Duplicate keep/cancel and dispatch claiming now share a short store-scoped database transaction lock. Membership and the surviving-order rule are re-evaluated inside that transaction; external courier network calls happen after the claim commits. Customer history honors stored/duplicate cancellation.

Pagination accepts digit-only page1–1,000,000 and limit1–100; duplicate days1–90. Required settings rejectnull and all risk limits are integer0–100,000. Invalid input returns400. Lowering thresholds remains prospective until another risk event; retrospective policy still needs the client decision noted above.

The additive migration creates only a store+phone-digits expression index (Prisma does not model expression indexes). No customer/order/risk rows are migrated or removed. The previous app remains compatible with the extra index. See the final-test verification for actual rollout status.
