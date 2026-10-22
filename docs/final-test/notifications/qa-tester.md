# QA Tester Guide — Notifications

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

## Test checklist

- [ ] Verify the success path against the matching Figma state using a connected test account.
- [ ] Check empty data, filters/pagination, nulls, invalid inputs, date and currency boundaries.
- [ ] Check authentication, role/plan permissions, store isolation, and disconnected-provider behavior.
- [ ] Check provider timeout/rate limits and retry/idempotency where applicable.
- [ ] Verify mutations through read APIs and check ledger/inventory effects where relevant.
- [ ] Mutate only an approved test account; clean up synthetic records unless asked to retain them.
- [ ] Report endpoint, environment, status, and masked test identifier only. Never include OTPs, passwords, tokens, API secrets, or customer PII.

## Module-specific checks

Test deduplication/resolution, severity, store/role isolation, read state, push failure behavior, and scheduler authentication.
