# Shipping Companies

## Handoff status — 22 October 2026

QuickLivraison callback connectivity and signatures passed; two genuine existing parcels imported. ForceLog label/QR, cancellation and bounded sync passed; OzoneExpress sync passed with no imported parcels. Ameex requests were rejected by its firewall and need provider access; Sendit was disconnected. Controlled order matching, genuine status events and printed-label/phone scans remain open.

[Verification evidence](./client-actions-2026-10-22.md) · [Cross-module status and API gaps](../CURRENT-STATUS.md) · [Production API contract](../openapi.production.json).

This refresh consolidates recorded work; it does not claim a new full regression run. Unchecked UI/QA checklists remain acceptance work. Revision names below identify the version tested at that time.

- [Frontend developer guide](./frontend-developer.md)
- [QA tester guide](./qa-tester.md)
- Requirements and answered questions: [13-shipping.md](../../module-context/13-shipping.md)
- API schemas and routes: [OpenAPI](../openapi.production.json)


## Courier flow follow-up — 22 October 2026

[Live ForceLog label, tracking, cancellation and pack-return verification](../orders/live-courier-flow-2026-10-22.md) passed. Labels were decoded in software; no physical pickup/device or genuine provider Delivered/Returned callback was tested. The same run found an open Orders export heap failure at exactly 10,000 rows.

## Export fix and provider blocker — 22 October 2026

The Orders export memory defect is [fixed and verified live](../orders/export-memory-fix-verification-2026-10-22.md). Ameex API access is blocked by Imunify360 (upstream 403); Sendit is disconnected. See [client/provider actions](./client-actions-2026-10-22.md). Existing QuickLivraison parcels imported successfully; fresh controlled parcel matching and physical acceptance remain pending.
