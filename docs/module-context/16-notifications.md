# 16. Notifications

Not built yet.

## Screens
Notifications (All / Critical / Warning / Inventory). Examples: low stock ("5 items left"), overdue
payments ("2 customers have overdue payments"), unusual sales drop ("30% vs last week").

## Data flow (as Figma shows it)
The system generates notifications from other modules (stock, payments, sales). The merchant only reads them.

## Questions

**Q16.1 (blocker) — Full list of notification types**
Please list every alert you want, with its trigger. Candidates: low stock (product and packaging), new
blacklisted customer order, duplicate orders detected, courier sync failed, platform disconnected,
salary due, trial or subscription ending, WhatsApp balance low.
Answer:

**Q16.2 — "Customers have overdue payments"**
What does this mean for a COD business? Money a courier has not yet paid out to the merchant?
Answer:

**Q16.3 — "Unusual sales drop" rule**
Is it this week vs last week, a 30% drop, and checked daily?
Assumption: yes.
Answer:

**Q16.4 — Push notifications?**
In-app list only, or also phone push (Firebase)? Do staff receive them too (based on permissions)?
Assumption: in-app + push. Staff get the ones for modules they can access.
Answer:
