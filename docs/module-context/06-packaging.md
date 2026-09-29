# 6. Packaging

## Screens
Packaging list · Add packaging item (photo, unit: pieces / rolls / meters / sheets, stock, minimum level,
"Auto Reorder Alert — WhatsApp alert when stock is low") · Details (stock, min level, used in products
"1 per order", stock history: used in order −1, restock +50) · Update stock.

## Data flow (as Figma shows it)
1. The merchant creates packaging materials with their stock.
2. On the product, the merchant picks which packaging is used (tab 5).
3. When an order is **delivered**, packaging stock goes down automatically.
4. When stock reaches the minimum, an alert is sent (WhatsApp).

## Questions

**Q6.1 — Per order or per unit?**
If an order has 3 of the same product, deduct 1 box or 3?
Assumption: follow the quantity set on the product link. "1 per order" means 1 per order, regardless of quantity.
Answer:

**Q6.2 — Packaging cost**
Figma has no price field on packaging. Should packaging cost count in order profit?
Assumption: yes. The cost comes from Purchases (tab 7) as the average cost.
Answer:

**Q6.3 — Where does the low-stock WhatsApp alert go?**
To the owner's phone? Does it use the WhatsApp automation balance (tab 15)? Should it also show in Notifications (tab 16)?
Assumption: owner phone, not charged to the balance, and also shown in Notifications.
Answer:

**Q6.4 — Restock from Zomaal Shop**
When the merchant buys boxes from Zomaal Shop, should packaging stock increase automatically on delivery?
Assumption: yes, if the shop item is linked to a packaging material.
Answer:
