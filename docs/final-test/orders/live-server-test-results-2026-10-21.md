# Orders — Live Server Test Results

> Historical read/export check. The later [expanded audit](./live-expanded-audit-2026-10-21.md) found five additional bug groups; all five are now fixed and verified. See [current fix verification](./live-fix-verification-2026-10-21.md).

**Date:** 2026-10-21  
**Environment:** Production Cloud Run  
**Revision:** `zomaal-backend-00069-vb7`  
**Application commit:** `ecae39f` (`fix(orders): document manual timeline platform`)

## Outcome

The tested Orders API paths passed on production. One API contract mismatch was found and corrected: manual order timelines returned `platform: MANUAL`, while the generated DTO/OpenAPI contract omitted `MANUAL`. The correction was merged to `main`, passed CI, deployed, and was verified against the live OpenAPI and timeline endpoint.

## Production checks

| Check | Result |
|---|---|
| Authentication | Pass — login returned 200 |
| Orders list | Pass — authenticated request returned 200 |
| Status summary | Pass — returned 200 |
| Invalid list filters and pagination | Pass — rejected with 400 |
| Unauthenticated list/export | Pass — rejected with 401 |
| Order detail | Pass — returned 200 |
| Existing order timeline | Pass — returned 200; cached events were available and newest-first |
| Manual order timeline | Pass — returned 200 with `platform: MANUAL`, 2 events, `stale: false` |
| Order financial summary | Pass — returned 200 with expected response shape |
| Excel export | Pass — XLSX MIME type, attachment filename, valid ZIP/XLSX signature, 20 headers, 4 rows on the unfiltered fixture set |
| Filtered Excel export | Pass — YouCan filter returned 2 data rows plus header, consistent with the matching list filter |
| Live OpenAPI platform enum | Pass — includes `SHOPIFY`, `YOUCAN`, `LIGHTFUNNELS`, and `MANUAL` |
| Health after deployment | Pass — `Hello Zomaal!` |

Customer names, contact details, order identifiers, addresses, and amounts are intentionally omitted from this report.

## Fix deployed

Updated `OrderTimelineDto.platform` and regenerated `docs/api/openapi.yaml` to include `MANUAL`. The production timeline response already supported manual orders; the defect was in API documentation/client-generation metadata.

Validation before deployment: 136 Jest suites passed, 1,188 tests passed, TypeScript build passed, Prisma Client generation passed, and OpenAPI generation passed. GitHub Actions test/build and production deployment jobs succeeded.

## Remaining Orders coverage

These production scenarios were not exercised in this pass and should remain on the QA checklist:

- Creating, editing, and deleting manual orders with valid and invalid product/quantity combinations.
- Duplicate submission/idempotency and concurrent order changes.
- Empty-result and maximum-size export behavior, plus date/payment/status filter combinations.
- Courier label creation, tracking callbacks, delivery/refusal/return/lost transitions, and inventory/profit reconciliation; these depend on usable courier test credentials or a sandbox/test shipment.
- Cross-store access checks using a second authorized merchant account.
