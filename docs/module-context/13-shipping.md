# 13. Shipping companies

## Screens
Shipping companies (tabs by country: Morocco / Algeria / Egypt / Tunisia, search) · Select country ("more
coming soon") · Courier API credentials · Courier details (connected since, sync status, Sync now,
performance trend: shipments / delivery / return, top delivery cities with rate) · Courier orders
(Pending / Confirm / Shipped / Delivered).

## Data flow (as Figma shows it)
1. The merchant connects their **own courier account** by entering API credentials.
2. Orders are sent to the courier and get tracking numbers.
3. Courier statuses sync back every 15 minutes (or by webhook). They drive order status, revenue, returns, and
   customer risk.

Built today: Sendit, QuickLivraison, ForceLog, OzoneExpress, Ameex (Morocco).

## Questions

**Q13.1 (blocker) — Where does the merchant click "ship this order"?**
Figma has no dispatch button on Order details. Should dispatch be one order at a time from details, bulk from the list, or
done in the courier's own dashboard (Zomaal only reads)?
Assumption: a single dispatch from Order details, plus bulk later.
Answer:

**Q13.2 — Couriers per country at launch**
Which couriers are required for Algeria, Egypt, and Tunisia, or are those tabs "coming soon"? The timeline
mentions "Onaqatii". Is that a courier we need?
Answer:

**Q13.3 — Shipping fee source**
Should we use the actual fee from the courier API, or a price list the merchant enters (per city)?
Assumption: the courier API when available, otherwise a merchant-entered default.
Answer:

**Q13.4 — Courier stats scope**
Do performance and top cities count only shipments made through Zomaal?
Assumption: yes.
Answer:

**Q13.5 — Return fees**
Do couriers charge a return fee? Should it be stored and counted as a loss?
Assumption: yes, when the courier reports it.
Answer:
