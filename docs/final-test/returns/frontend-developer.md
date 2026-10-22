# Frontend Developer Guide — Returns

## Handoff status — 22 October 2026

The manual-return flow passed live detection, all five conditions, corrections, repeat submissions and atomic invalid-batch rejection. Subsequent tracking/pack fixes passed 97/97 live observations, including Returns bounds and staff financial access. Genuine courier Delivered/Returned events and physical scans remain separate acceptance.

[Verification evidence](./../tracking-workflow/live-fix-retest-2026-10-20.md) · [Cross-module status and API gaps](../CURRENT-STATUS.md) · [Production API contract](../openapi.production.json).

This refresh consolidates recorded work; it does not claim a new full regression run. Unchecked UI/QA checklists remain acceptance work. Revision names below identify the version tested at that time.

Updated 22 October 2026 (documentation reconciliation; original test dates are retained).

## References

- Figma: [Returns (Figma section 1:3967)](https://www.figma.com/design/6g6gVrZZovSVOOfRB9vPGw/zomal-copy?node-id=0-1).
- [Module requirements](../../module-context/04-returns.md).
- [OpenAPI contract](../openapi.production.json).

## Main flow

List returns; scan courier label or enter order number; inspect order/items/loss; record item condition; verify stock and ledger.

## Integration requirements

Use the routes and exact schemas in OpenAPI. Handle loading, empty, success, validation, permission, disconnected-provider, provider-error, and retry states. Preserve null/unconverted amounts as unknown; use store currency and API precision. Figma names, phone numbers, prices, and metrics are placeholders. Do not fabricate production-looking data. Where an approved client dependency is temporary static configuration, add an adjacent code comment identifying it as temporary and naming its source/assumption.

## Completion checklist

- [ ] In-scope Figma screens and states use API data.
- [ ] Request fields, enums, permissions, and store scoping match OpenAPI.
- [ ] Empty, loading, error, retry, access-denied, and disconnected states are covered.
- [ ] No real-looking catalog, metrics, or order data is hardcoded.
- [ ] Keep TikTok/Snapchat, Reports, and gateway-dependent checkout out of this pass.

## Shared tracking/pack contract after the later fixes

Use the [tracking frontend contract](../tracking-workflow/frontend-developer.md) and [regression guide](../tracking-workflow/qa-tester.md) for whole-pack/component quantities, `expectedRevision`, exact retry safety, correction/reopening, stock/ledger rollback and 503 on unavailable conversion. The [97/97 live retest](../tracking-workflow/live-fix-retest-2026-10-20.md) includes later bounds and access fixes. The initial manual-return report remains evidence only for its stated scenario/date. Later Orders label software decoding does not certify a phone camera or genuine courier-delivery event.

## Backend audit correction — 22 October 2026

See the [backend fix log](../../backend-live-audit-fixes-2026-10-22.md) for the new Store/Role/Category validation, accounting-currency protection and strict pagination/boolean contracts. The fixes are deployed on `zomaal-backend-00073-c2b` and passed 79/79 live observations; the log records both local and deployed evidence. Historical module observations above keep their original date and scope.
