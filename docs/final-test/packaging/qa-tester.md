# QA Tester Guide — Packaging

## Handoff status — 22 October 2026

Fix `b1ee535` passed 208/208 production observations. Image retries, integer bounds, trimmed stock reasons and scheduled in-app inventory alerts are fixed. The owner WhatsApp outbox is implemented; actual receipt is still blocked by client Meta configuration and an approved inventory template.

[Verification evidence](./fix-verification-2026-10-20.md) · [Cross-module status and API gaps](../CURRENT-STATUS.md) · [Production API contract](../openapi.production.json).

This refresh consolidates recorded work; it does not claim a new full regression run. Unchecked UI/QA checklists remain acceptance work. Revision names below identify the version tested at that time.

Updated 22 October 2026 (documentation reconciliation; original test dates are retained).

## References

- Figma: [Packaging list and setup (Figma section 1:11814)](https://www.figma.com/design/6g6gVrZZovSVOOfRB9vPGw/zomal-copy?node-id=0-1).
- [Module requirements](../../module-context/06-packaging.md).
- [OpenAPI contract](../openapi.production.json).

## Main flow

Create packaging; set unit/minimum level; link products; restock; verify order consumption and low-stock states.

## Test checklist

- [ ] Verify the success path against the matching Figma state using a connected test account.
- [ ] Check empty data, filters/pagination, nulls, invalid inputs, date and currency boundaries.
- [ ] Check authentication, role/plan permissions, store isolation, and disconnected-provider behavior.
- [ ] Check provider timeout/rate limits and retry/idempotency where applicable.
- [ ] Verify mutations through read APIs and check ledger/inventory effects where relevant.
- [ ] Mutate only an approved test account; clean up synthetic records unless asked to retain them.
- [ ] Report endpoint, environment, status, and masked test identifier only. Never include OTPs, passwords, tokens, API secrets, or customer PII.

## Module-specific checks

Test threshold equality, update/restock, delivered-order consumption, duplicate events, in-app alert, and owner WhatsApp alert separately.


## Client answers confirmed

- Consume packaging per delivered product unit: 3 products use 3 boxes. Show the configured quantity per unit; the Figma “per order” caption is not the client rule.
- Packaging cost reduces profit. Current backend uses the last paid price; average versus last cost is not expressly settled by the client answer.
- Owner WhatsApp and in-app alerts are required. The current toggle does not prove either notification has been sent.
- Delivered Zomaal Shop purchases should increase packaging stock automatically.

## Executed coverage and remaining acceptance

The initial 181-observation audit is historical. Fix `b1ee535` passed 208/208 deployed observations; PKG-01/02/03/05 are closed. PKG-04 has a working backend outbox with explicit dependency status, while actual owner receipt awaits Meta/template setup.

Actual courier-driven consumption, Shop-admin fulfillment, device push and owner WhatsApp receipt must be accepted separately. Local delivery/deduplication and mocked Meta tests are not physical delivery evidence. Original account and module snapshots were preserved; disposable data/images were removed.

## Fix regression coverage

New PostgreSQL suite: `PACKAGING_TEST_DATABASE_URL=<dedicated-local-test-db> npm run test:e2e -- --runInBand packaging-workflow.postgres`.

Covers replay/concurrent image replacement and rollback; absolute/delta/result integer overflow; blank/short trimmed reasons; valid integer maximum; queue deduplication; blocked Meta configuration in the notification response; approved-template dispatch with mocked Meta; uncertain-outcome protection; cancellation and new alert cycles; real evaluator restock resolution; owner/staff/store access. Meta send tests in this suite are mocked and do not prove production message delivery.

The deployed retest verified the revision, image preview/replay, rejected stock writes without balance changes, scheduler authentication, alert creation/deduplication, toggle/restock resolution and the reported `ownerWhatsApp` blocker. Repeat these cases after future changes. Preserve the original QA account and delete temporary records/images.


## Deployed live retest

`b1ee535` / `zomaal-backend-00063-qdf`: **208/208 production observations passed**. [Verification and actual responses](./fix-verification-2026-10-20.md). PKG-01/02/03/05 are closed; PKG-04 backend path is implemented and reports BLOCKED / WHATSAPP_DISABLED until client Meta/template prerequisites are met. Original QA account retained; synthetic test data/images cleaned.
