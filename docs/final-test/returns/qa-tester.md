# QA Tester Guide — Returns

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

## Test checklist

- [ ] Verify the success path against the matching Figma state using a connected test account.
- [ ] Check empty data, filters/pagination, nulls, invalid inputs, date and currency boundaries.
- [ ] Check authentication, role/plan permissions, store isolation, and disconnected-provider behavior.
- [ ] Check provider timeout/rate limits and retry/idempotency where applicable.
- [ ] Verify mutations through read APIs and check ledger/inventory effects where relevant.
- [ ] Mutate only an approved test account; clean up synthetic records unless asked to retain them.
- [ ] Report endpoint, environment, status, and masked test identifier only. Never include OTPs, passwords, tokens, API secrets, or customer PII.

## Module-specific checks

Test barcode and manual lookup, delayed/verification state, each item condition, stock movement, losses, duplicate provider events, and authorization.

## Shared tracking/pack contract after the later fixes

Use the [tracking frontend contract](../tracking-workflow/frontend-developer.md) and [regression guide](../tracking-workflow/qa-tester.md) for whole-pack/component quantities, `expectedRevision`, exact retry safety, correction/reopening, stock/ledger rollback and 503 on unavailable conversion. The [97/97 live retest](../tracking-workflow/live-fix-retest-2026-10-20.md) includes later bounds and access fixes. The initial manual-return report remains evidence only for its stated scenario/date. Later Orders label software decoding does not certify a phone camera or genuine courier-delivery event.

## Backend audit correction — 22 October 2026

See the [backend fix log](../../backend-live-audit-fixes-2026-10-22.md) for the new Store/Role/Category validation, accounting-currency protection and strict pagination/boolean contracts. The fixes are deployed on `zomaal-backend-00073-c2b` and passed 79/79 live observations; the log records both local and deployed evidence. Historical module observations above keep their original date and scope.
