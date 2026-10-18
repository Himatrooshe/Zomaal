# 15. WhatsApp automation

Built on `feature/whatsapp-automation` (backend). Swagger tags: **WhatsApp**, **WhatsApp Webhooks**, **Admin WhatsApp**.

## Screens
Connect WhatsApp (delivery updates, status alerts, EN / AR / FR templates) · Connecting · Connected
(business number, active) · Automation dashboard (balance, sent today, failed, cost per message) · Status
settings (Picked up, Warehouse, In transit, Distributed, In delivery, Reschedule, Canceled, Denied,
Delivered, each with a delay and an editable message) · Edit message (variables `{customer_name}`,
`{order_id}`, `{store_name}`, include product image, send immediately / after delay, preview) · Balance
history (top-ups, −per message) · Message analytics · Change / Disconnect WhatsApp.

## Data flow (as built)
1. The merchant connects their own WhatsApp Business number through Meta Embedded Signup.
2. The merchant turns on messages per courier status and sets a delay.
3. When a courier status changes, a message is queued and sent to the customer after the delay.
4. Each sent message deducts Zomaal's price per message from a **prepaid balance**.

## Questions

**Q15.1 (blocker) — Provider and number ownership**
Should we use the Meta WhatsApp Cloud API directly (Embedded Signup, with the merchant's own number) or a provider like Twilio / 360dialog?
Or does Zomaal send from one shared number?
Answer: Meta Cloud API with the merchant's own number (Embedded Signup).

**Q15.2 (blocker) — Balance and pricing**
How does the merchant top up (which payment gateway), and who sets the per-message price? Meta charges per
conversation or template category, not a flat $0.01.
Answer: The super admin credits the balance manually after payment outside the app. Zomaal sets the price per
message per currency in the admin API. Note: with the merchant's own WABA, **Meta bills the merchant's WhatsApp
Business Account directly** for each template message; the Zomaal balance is Zomaal's own fee on top.

**Q15.3 — Template approval**
WhatsApp business messages must use Meta-approved templates. Every edit needs re-approval (minutes to hours). Is that acceptable,
or should merchants only choose from pre-approved Zomaal templates?
Answer: Zomaal templates only (8 statuses × EN / AR / FR = 24). They are submitted to the merchant's WABA on
connect; the merchant toggles each status and sets its delay. Message text is not editable.

**Q15.4 — Which orders trigger messages?**
The statuses are courier statuses, so messages would only go out for orders shipped through Zomaal couriers. Is that right?
The customer phone is also needed (see tab 11, Q11.4).
Answer: Yes — orders dispatched through Sendit, QuickLivraison, ForceLog or OzoneExpress. Ameex shipments are not
linked to an order dispatch, so they do not trigger messages yet.

**Q15.5 — Language per customer**
How do we pick EN / AR / FR per customer: store default, customer country, or order language?
Answer: Store default (`PATCH /whatsapp/connection { language }`, default `fr`).

## Implementation notes

### Merchant API (owner only, plan feature `whatsapp`)
| Method | Path | Purpose |
|---|---|---|
| GET | `/whatsapp/config` | `appId`, `configId`, `graphApiVersion` for FB.init / FB.login |
| POST | `/whatsapp/connect` | `{ code, wabaId, phoneNumberId, language? }` from Embedded Signup |
| GET / PATCH / DELETE | `/whatsapp/connection` | View, change language, disconnect |
| GET | `/whatsapp/status-settings` | 8 statuses with enabled, delay, template status, text |
| PUT | `/whatsapp/status-settings/:trigger` | `{ enabled?, delayMinutes? }` (0 – 10080) |
| GET | `/whatsapp/templates` | 24 templates with Meta approval status |
| POST | `/whatsapp/templates/sync` | Resubmit missing templates, refresh statuses |
| GET | `/whatsapp/dashboard` | Balance, price, messages remaining, today's counts |
| GET | `/whatsapp/balance/history` | Ledger: TOP_UP, MESSAGE (−), REFUND, ADJUSTMENT |
| GET | `/whatsapp/messages` | Message log (filters: status, trigger) |
| GET | `/whatsapp/analytics` | Totals, per-status, daily series (`from`, `to`) |

### Admin API (super admin)
`GET /admin/whatsapp/pricing`, `PUT /admin/whatsapp/pricing/:currency { pricePerMessage }`,
`GET /admin/stores/:storeId/whatsapp/balance`, `POST /admin/stores/:storeId/whatsapp/balance { type, amount, note?, idempotencyKey }`.
All writes go to the activity log.

### Status mapping (Figma label → courier status)
Picked up → `PICKED_UP` · Warehouse → `AT_WAREHOUSE` · In transit → `IN_TRANSIT` · In delivery → `OUT_FOR_DELIVERY` ·
Reschedule → `POSTPONED` · Canceled → `CANCELLED` · Denied → `REFUSED` · Delivered → `DELIVERED`.
**Distributed** has no matching normalized courier status, so it is not offered.

### Sending rules
- Queued from the courier → financial sync (`syncFromDispatchId`), at most one message per order per status.
- Not queued when the courier status is older than `WHATSAPP_MAX_STATUS_AGE_HOURS` (default 24) — courier
  refreshes of old parcels must not message customers.
- Recipient: courier recipient phone → customer phone → manual customer phone, normalized to E.164 mobile
  (store country, default MA). No valid mobile → logged as `SKIPPED / NO_VALID_PHONE`.
- Variables: `{{1}}` customer name (localized fallback), `{{2}}` order name / tracking, `{{3}}` store name.
- Cloud Scheduler calls `POST /internal/whatsapp/dispatch` every minute (`x-zomaal-scheduler-secret`).
  At send time a message is skipped if WhatsApp was disconnected, the status was turned off, or the parcel
  already moved to another status (`STATUS_CHANGED`). It fails if the template is not approved, no price is set
  for the store currency, or the balance is too low.
- The balance is debited before sending and refunded when Meta rejects the send or later reports `failed`.
  Transient Meta errors are retried up to 3 times, 5 minutes apart.
- Webhook `/webhooks/whatsapp` (signature `X-Hub-Signature-256`, app secret) updates sent / delivered / read /
  failed, template approvals, and flags the connection for reconnect when Meta removes access.
- Notifications: `WHATSAPP_BALANCE_LOW` (cleared after a top-up) and `WHATSAPP_DISCONNECTED`.

### Not in v1
Editable message text, product image header, per-customer language, Ameex-triggered messages.

### Go-live checklist (ops)
1. Meta app with WhatsApp product, Tech Provider approval, Embedded Signup configuration.
2. Webhook callback `https://<backend>/webhooks/whatsapp`, verify token = `META_WHATSAPP_WEBHOOK_VERIFY_TOKEN`,
   subscribe to `messages`, `message_template_status_update`, `account_update`.
3. Secrets in Secret Manager: `META_APP_SECRET`, `WHATSAPP_TOKEN_ENCRYPTION_KEY`, `WHATSAPP_SCHEDULER_SECRET`,
   `META_WHATSAPP_WEBHOOK_VERIFY_TOKEN`; then `WHATSAPP_ENABLED=true`, `WHATSAPP_SCHEDULER_ENABLED=true`.
4. Cloud Scheduler job: every minute, `POST /internal/whatsapp/dispatch` with the scheduler secret header.
5. Super admin sets the price per message for each store currency.
