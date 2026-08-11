# E-commerce home implementation plan

This plan turns Shopify, YouCan, and Lightfunnels into one home-screen data
source while keeping provider credentials and customer PII out of dashboard
storage.

## Phase 1 — home summary and operational completion

- Add cached product and customer counts per e-commerce connection.
- Add a refresh endpoint that reads counts from each provider.
- Add one home endpoint returning revenue, orders, catalog/customer counts,
  shipping/dispatch state, connection health, and recent orders.
- Replace the dummy courier tracking response with calls to the existing
  Sendit, QuickLivraison, ForceLog, and OzoneExpress clients.
- Persist dispatch attempts as `PENDING`, `DISPATCHED`, or `FAILED` and keep
  provider tracking numbers and safe error messages.
- Remove the Lightfunnels schema-debug route from the public application.
- Fix conflicting normalized-order filters.

## Phase 2 — normalized product catalog

- Add provider-neutral product and variant snapshots with source IDs, title,
  state, price, currency, inventory, SKU, image, and timestamps.
- Add Shopify, YouCan, and Lightfunnels product sync adapters.
- Link imported products to warehouse products explicitly; never infer a link
  from title alone.
- Add low-stock, out-of-stock, top-product, and recent-product home cards.

## Phase 3 — customer workspace

- Decide and document the exact customer fields the product needs before
  persisting PII.
- Add encrypted/minimized customer snapshots and retention controls.
- Extend Shopify customer data-request and redaction handlers before enabling
  customer PII persistence.
- Add customer list, detail, search, repeat-customer, and lifetime-value APIs.

## Phase 4 — event-driven freshness

- Shopify completed: subscribe to order, refund, product, customer, uninstall,
  and mandatory privacy events through `shopify.app.toml`.
- Shopify completed: idempotently project current order/revenue state, refresh
  exact product/customer counts, reject stale order updates, and expose webhook
  health timestamps without retaining webhook payload PII.
- Keep scheduled order and metric reconciliation as recovery because provider
  webhook delivery is not guaranteed. The normal frontend does not need a
  manual Sync button.
- Add equivalent event subscriptions where YouCan and Lightfunnels support
  them; scheduled reconciliation remains the fallback for providers or
  resources without reliable webhook coverage.
- Make YouCan and Lightfunnels order synchronization use provider-supported
  update watermarks instead of restarting completed scans from page one.
- Store courier webhook events and normalize shipment status history.

## Home API contract

`GET /ecommerce/home?from=YYYY-MM-DD&to=YYYY-MM-DD&timezone=Area/City`
returns:

- selected-period revenue and per-platform totals;
- order totals and actionable states;
- cached provider product/customer totals and warehouse catalog totals;
- connected courier and dispatch totals;
- provider connection/sync health;
- recent normalized orders.

`POST /ecommerce/connections/:connectionId/metrics/refresh` refreshes cached
product/customer counts without storing customer records.

`POST /internal/ecommerce/sync` is scheduler-only. It reconciles normalized
orders and product/customer totals across all active providers and is not a
normal end-user action.
