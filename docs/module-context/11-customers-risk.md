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
