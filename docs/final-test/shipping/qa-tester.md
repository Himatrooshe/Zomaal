# QA Tester Guide — Shipping Companies

## Handoff status — 22 October 2026

QuickLivraison callback connectivity and signatures passed; two genuine existing parcels imported. ForceLog label/QR, cancellation and bounded sync passed; OzoneExpress sync passed with no imported parcels. Ameex requests were rejected by its firewall and need provider access; Sendit was disconnected. Controlled order matching, genuine status events and printed-label/phone scans remain open.

[Verification evidence](./client-actions-2026-10-22.md) · [Cross-module status and API gaps](../CURRENT-STATUS.md) · [Production API contract](../openapi.production.json).

This refresh consolidates recorded work; it does not claim a new full regression run. Unchecked UI/QA checklists remain acceptance work. Revision names below identify the version tested at that time.

Updated 22 October 2026 (documentation reconciliation; original test dates are retained).

## References

- Figma: [Shipping Updated (Figma section 1:5039)](https://www.figma.com/design/6g6gVrZZovSVOOfRB9vPGw/zomal-copy?node-id=0-1).
- [Module requirements](../../module-context/13-shipping.md).
- [OpenAPI contract](../openapi.production.json).

## Main flow

Connect courier; import shipments created in courier dashboard; match order/tracking; inspect status, timeline, fee, and performance.

## Test checklist

- [ ] Verify the success path against the matching Figma state using a connected test account.
- [ ] Check empty data, filters/pagination, nulls, invalid inputs, date and currency boundaries.
- [ ] Check authentication, role/plan permissions, store isolation, and disconnected-provider behavior.
- [ ] Check provider timeout/rate limits and retry/idempotency where applicable.
- [ ] Verify mutations through read APIs and check ledger/inventory effects where relevant.
- [ ] Mutate only an approved test account; clean up synthetic records unless asked to retain them.
- [ ] Report endpoint, environment, status, and masked test identifier only. Never include OTPs, passwords, tokens, API secrets, or customer PII.

## Module-specific checks

Test provider sync/reconciliation, order matching, unknown statuses, duplicate events, actual fees, webhook signatures, and imported dashboard-created shipments.


## Provider access and sync acceptance — 22 October 2026

Treat `success: false` as a failed sync even when HTTP is 200. Ameex currently rejects backend requests through Imunify360 and requires provider-side allowlisting; Sendit is disconnected. [Client/provider actions](./client-actions-2026-10-22.md) records the required setup. QuickLivraison imported two genuine existing parcels; ForceLog/OzoneExpress bounded sync passed. Fresh controlled matching, genuine delivery/return events and physical scans still need acceptance.
