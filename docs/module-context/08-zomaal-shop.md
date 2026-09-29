# 8. Zomaal Shop & My Orders

## Screens
Explore the Shop · Shop (products, popular items) · Product details (size, color, quantity, tier price,
specifications) · Favorites · My Cart · Shipping address / Add address · Checkout (promo code, Online
payment or Cash on delivery) · Confirm COD ("Repeated cancellations may restrict your account") · My
Orders (All / Processing / Shipped / Delivered / Cancelled) · Order track.

## Data flow (as Figma shows it)
1. **Zomaal** (not the merchant) sells supplies such as boxes, bubble wrap, and stickers to merchants.
2. The merchant orders and pays online or by COD.
3. Zomaal fulfills the order, and its status shows in My Orders with a timeline (courier + tracking).
4. The order becomes a "From Shop" purchase (tab 7).
5. Plans say "Access Zomaal Shop" is a **Pro** feature.

## Questions

**Q8.1 (blocker) — Who manages the shop catalog, prices, promo codes, and order statuses?**
Assumption: Zomaal staff, through a super-admin panel. Order status changes are made manually by Zomaal admins.
Answer:

**Q8.2 (blocker) — Online payment gateway**
Which gateway for Morocco (CMI, Stripe, PayZone)? The Figma checkout shows SSLCommerz (Bangladesh).
Answer:

**Q8.3 — COD cancellation restriction**
What exactly does "Repeated cancellations may restrict your account" mean? For example, "after 3 cancelled COD orders,
COD is disabled and only online payment is allowed"?
Assumption: that rule, with a limit set by the admin.
Answer:

**Q8.4 — Delivery fee rules**
Figma shows "Free". Is it always free, a flat fee, or free above a minimum amount?
Answer:

**Q8.5 — Starter plan**
Can Starter users see the shop but not buy, or is it hidden entirely?
Assumption: hidden, with an upgrade prompt.
Answer:
