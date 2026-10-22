# Frontend Developer Guide — WhatsApp Automation

## Handoff status — 22 October 2026

Merchant configuration/connection, templates, status settings, message log, analytics, balance and admin pricing/balance APIs are implemented. Actual delivery requires client Meta setup, approved templates, sender/pricing/balance and protected dispatch configuration. No real customer or owner WhatsApp receipt is certified by this handoff. Explicit preview mode is synthetic and must never count as live acceptance.

[Cross-module status and API gaps](../CURRENT-STATUS.md) · [Production API contract](../openapi.production.json).

This refresh consolidates recorded work; it does not claim a new full regression run. Unchecked UI/QA checklists remain acceptance work. Revision names below identify the version tested at that time.

Updated 22 October 2026 (documentation reconciliation; original test dates are retained).

## References

- Figma: [WhatsApp Automation (Figma section 1:16665)](https://www.figma.com/design/6g6gVrZZovSVOOfRB9vPGw/zomal-copy?node-id=0-1).
- [Module requirements](../../module-context/15-whatsapp.md).
- [OpenAPI contract](../openapi.production.json).

## Main flow

Connect merchant WABA; configure approved templates/status rules; send eligible message; inspect delivery, analytics, and balance.

## Integration requirements

Use the routes and exact schemas in OpenAPI. Handle loading, empty, success, validation, permission, disconnected-provider, provider-error, and retry states. Preserve null/unconverted amounts as unknown; use store currency and API precision. Figma names, phone numbers, prices, and metrics are placeholders. Do not fabricate production-looking data. Where an approved client dependency is temporary static configuration, add an adjacent code comment identifying it as temporary and naming its source/assumption.

## Completion checklist

- [ ] In-scope Figma screens and states use API data.
- [ ] Request fields, enums, permissions, and store scoping match OpenAPI.
- [ ] Empty, loading, error, retry, access-denied, and disconnected states are covered.
- [ ] No real-looking catalog, metrics, or order data is hardcoded.
- [ ] Keep TikTok/Snapchat, Reports, and gateway-dependent checkout out of this pass.

## Current API integration notes

Use the production OpenAPI for `/whatsapp/config`, connect/connection, templates/sync, status-settings, dashboard, balance/history, messages and analytics. Owner access and the WhatsApp plan gate apply. If `X-Zomaal-Mock-Data: true` or config `mock: true` appears, label it as synthetic preview: it proves no message, balance transaction or Meta connection. The optional preview implementation is documented in module context; its current production enablement was not inspected in this refresh. Never count preview responses as live completion. Owner inventory alerts are a separate outbox; see Packaging for BLOCKED/UNKNOWN handling.
