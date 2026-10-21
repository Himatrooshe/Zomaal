# Frontend Developer Guide — Orders

Updated 19 October 2026.

## References

- Figma: [Orders (Figma section 1:4178)](https://www.figma.com/design/6g6gVrZZovSVOOfRB9vPGw/zomal-copy?node-id=0-1).
- [Module requirements](../../module-context/03-orders.md).
- [OpenAPI contract](../../api/openapi.yaml).

## Backend status

Excel export is merged and deployed; other order flows are implemented.

## Main flow

List, search/filter, order details, combined platform/courier timeline, financial impact, Excel export.

## Integration requirements

Use the routes and exact schemas in OpenAPI. Handle loading, empty, success, validation, permission, disconnected-provider, provider-error, and retry states. Preserve null/unconverted amounts as unknown; use store currency and API precision. Figma names, phone numbers, prices, and metrics are placeholders. Do not fabricate production-looking data. Where an approved client dependency is temporary static configuration, add an adjacent code comment identifying it as temporary and naming its source/assumption.

## Completion checklist

- [ ] In-scope Figma screens and states use API data.
- [ ] Request fields, enums, permissions, and store scoping match OpenAPI.
- [ ] Empty, loading, error, retry, access-denied, and disconnected states are covered.
- [ ] No real-looking catalog, metrics, or order data is hardcoded.
- [ ] Keep TikTok/Snapchat, Reports, and gateway-dependent checkout out of this pass.

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
