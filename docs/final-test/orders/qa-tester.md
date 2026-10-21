# QA Tester Guide — Orders

Updated 19 October 2026.

## References

- Figma: [Orders (Figma section 1:4178)](https://www.figma.com/design/6g6gVrZZovSVOOfRB9vPGw/zomal-copy?node-id=0-1).
- [Module requirements](../../module-context/03-orders.md).
- [OpenAPI contract](../../api/openapi.yaml).

## Current status

Excel export is merged and deployed; other order flows are implemented.

## Main flow

List, search/filter, order details, combined platform/courier timeline, financial impact, Excel export.

## Test checklist

- [ ] Verify the success path against the matching Figma state using a connected test account.
- [ ] Check empty data, filters/pagination, nulls, invalid inputs, date and currency boundaries.
- [ ] Check authentication, role/plan permissions, store isolation, and disconnected-provider behavior.
- [ ] Check provider timeout/rate limits and retry/idempotency where applicable.
- [ ] Verify mutations through read APIs and check ledger/inventory effects where relevant.
- [ ] Mutate only an approved test account; clean up synthetic records unless asked to retain them.
- [ ] Report endpoint, environment, status, and masked test identifier only. Never include OTPs, passwords, tokens, API secrets, or customer PII.

## Module-specific checks

Test all status filters, pagination, search, timeline sources/order, financial fields, Excel rows and active filters, and role permissions.

## Deployed fixes — 21 October 2026

All five expanded-audit findings are fixed on application `9d4e661`, production revision `zomaal-backend-00070-94q`. The live retest passed 155/155 recorded observations. See [fix verification and remaining acceptance](./live-fix-verification-2026-10-21.md) and [sanitized live results](./live-fix-retest-results-2026-10-21.json).

- Required name, phone and address must contain a non-whitespace character.
- Send an official ISO 4217 currency code; case is normalized. Omission uses the store currency.
- Price and shipping accept at most four decimal places. Individual and computed overflow returns 400 before customer/order writes.
- Boolean list/export query values must be exact `true`/`false`; list pagination must use complete integer values. Malformed values return 400.
- Timelines resolve the active owner store or assigned staff store. Access outside that store returns 404. Reload the selected order after switching stores.
- Keep the same retry key and original payload for retries. Changed payloads return 409; concurrent exact retries preserve one order.

The initial expanded audit is historical. Its five findings are closed; broader provider/device/large-export acceptance limits remain as listed in the fix report.

## Live staff access verification — 21 October 2026

The Orders view/edit/export permission matrix, role inheritance and replacement overrides, immediate grant/revocation, deactivation and staff assigned-store isolation passed 118/118 recorded live observations. See [staff access results and scope](./live-staff-access-2026-10-21.md). Separate merchant-owner isolation subsequently passed 114/114 recorded live observations. See [owner isolation results and cleanup](./live-owner-isolation-2026-10-21.md). Real courier/device acceptance and the large production export boundary remain outside these checks.

## Live export boundary finding — 22 October 2026

The earlier 10,000-row heap failure is **fixed** on `31c0dd4`, production `zomaal-backend-00071-h7g`. The live retest passed 34/34 recorded observations: 10,000 rows return a complete XLSX, two concurrent exports succeed, and 10,001 rows return 413. Do not silently truncate exports. [Fix and live evidence](./export-memory-fix-verification-2026-10-22.md). The same run verified real ForceLog PDFs, software-decoded tracking, pack conditions and cancellation. Genuine courier-origin status events and physical-device scanning remain outstanding. See [full flow evidence and limits](./live-courier-flow-2026-10-22.md).

For courier sync, inspect the response `success` and `failures` fields, not HTTP 200 alone. Ameex currently reports a failed sync because its firewall rejects backend traffic; Sendit is disconnected. See [client/provider actions](../shipping/client-actions-2026-10-22.md).
