# Frontend Developer Guide — Notifications

## Handoff status — 22 October 2026

The inventory-alert lifecycle passed 28/28 live observations on revision `00068-vbx`; API/device-validation and scheduler checks were repeated on `00069-vb7`. In-app generation, deduplication, read state and resolution are verified. FCM was not configured at the last recorded check, so real push receipt remains open. Overdue customer/COD payment alerts and Sendit sync-failure alerts are not implemented; the full client alert list is unresolved.

[Verification evidence](./retest-latest-revision-2026-10-21.md) · [Cross-module status and API gaps](../CURRENT-STATUS.md) · [Production API contract](../openapi.production.json).

This refresh consolidates recorded work; it does not claim a new full regression run. Unchecked UI/QA checklists remain acceptance work. Revision names below identify the version tested at that time.

Updated 22 October 2026 (documentation reconciliation; original test dates are retained).

## References

- Figma: [Notifications UI in Figma (refer to Home and notification states)](https://www.figma.com/design/6g6gVrZZovSVOOfRB9vPGw/zomal-copy?node-id=0-1).
- [Module requirements](../../module-context/16-notifications.md).
- [OpenAPI contract](../openapi.production.json).

## Main flow

Trigger event; display notification once; persist read/unread; send push when configured.

## Integration requirements

Use the routes and exact schemas in OpenAPI. Handle loading, empty, success, validation, permission, disconnected-provider, provider-error, and retry states. Preserve null/unconverted amounts as unknown; use store currency and API precision. Figma names, phone numbers, prices, and metrics are placeholders. Do not fabricate production-looking data. Where an approved client dependency is temporary static configuration, add an adjacent code comment identifying it as temporary and naming its source/assumption.

## Completion checklist

- [ ] In-scope Figma screens and states use API data.
- [ ] Request fields, enums, permissions, and store scoping match OpenAPI.
- [ ] Empty, loading, error, retry, access-denied, and disconnected states are covered.
- [ ] No real-looking catalog, metrics, or order data is hardcoded.
- [ ] Keep TikTok/Snapchat, Reports, and gateway-dependent checkout out of this pass.
