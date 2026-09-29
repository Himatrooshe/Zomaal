# 12. eCom platform integrations

## Screens
eCom platforms (connected list + available: Shopify, YouCan, Lightfunnels, WooCommerce, Dropify, TikTok,
"Can't find your platform?") · Connect (store credentials) · Connected success ("first sync in
progress") · Platform details (last / next sync, every 15 min, Sync now, revenue, today's / month's new
orders, recent syncs) · Disconnect.

## Data flow (as Figma shows it)
1. The merchant connects a store platform.
2. Zomaal syncs orders every 15 minutes. Webhooks make it faster where available.
3. Orders feed Orders, Home, Customers, and Products.

Built today: Shopify, YouCan, and Lightfunnels (OAuth).

## Questions

**Q12.1 (blocker) — Which new platforms, in what order?**
Figma lists WooCommerce, Dropify, and TikTok (TikTok Shop?). Which are required for launch?
Assumption: none for launch. WooCommerce comes next.
Answer:

**Q12.2 — "Store credentials" form vs OAuth**
Shopify, YouCan, and Lightfunnels use OAuth (no credentials typed). Is the credentials form only for platforms
without OAuth (such as WooCommerce API keys)?
Assumption: yes.
Answer:

**Q12.3 — First sync history**
How far back should we import on connect: 30 days, 90 days, or everything?
Assumption: 90 days.
Answer:

**Q12.4 — Disconnect: what happens to old data?**
Assumption: orders are kept (marked as from a disconnected source). Tokens are deleted.
Answer:

**Q12.5 — More than one store of the same platform?**
For example, two Shopify stores under one Zomaal store. Or should each be a separate Zomaal store (multi-store, tab 17)?
Assumption: one platform connection per Zomaal store.
Answer:

**Q12.6 — "Can't find your platform?"**
Where does the request go (email, admin panel, WhatsApp)?
Answer:
