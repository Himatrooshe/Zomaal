# 15. WhatsApp automation

Not built yet.

## Screens
Connect WhatsApp (delivery updates, status alerts, EN / AR / FR templates) · Connecting · Connected
(business number, active) · Automation dashboard (balance, sent today, failed, cost per message) · Status
settings (Picked up, Warehouse, In transit, Distributed, In delivery, Reschedule, Canceled, Denied,
Delivered, each with a delay and an editable message) · Edit message (variables `{customer_name}`,
`{order_id}`, `{store_name}`, include product image, send immediately / after delay, preview) · Balance
history (top-ups, −per message) · Message analytics · Change / Disconnect WhatsApp.

## Data flow (as Figma shows it)
1. The merchant connects their WhatsApp Business number.
2. The merchant turns on messages per courier status and edits the text.
3. When a courier status changes, a message is sent to the customer after the chosen delay.
4. Each message deducts from a **prepaid balance**.

## Questions

**Q15.1 (blocker) — Provider and number ownership**
Should we use the Meta WhatsApp Cloud API directly (Embedded Signup, with the merchant's own number) or a provider like Twilio / 360dialog?
Or does Zomaal send from one shared number?
Assumption: Meta Cloud API with the merchant's own number.
Answer:

**Q15.2 (blocker) — Balance and pricing**
How does the merchant top up (which payment gateway), and who sets the per-message price? Meta charges per
conversation or template category, not a flat $0.01.
Answer:

**Q15.3 — Template approval**
WhatsApp business messages must use Meta-approved templates. Every edit needs re-approval (minutes to hours). Is that acceptable,
or should merchants only choose from pre-approved Zomaal templates?
Assumption: pre-approved templates in 3 languages. The merchant picks one and toggles it on or off.
Answer:

**Q15.4 — Which orders trigger messages?**
The statuses are courier statuses, so messages would only go out for orders shipped through Zomaal couriers. Is that right?
The customer phone is also needed (see tab 11, Q11.4).
Answer:

**Q15.5 — Language per customer**
How do we pick EN / AR / FR per customer: store default, customer country, or order language?
Assumption: store default.
Answer:
