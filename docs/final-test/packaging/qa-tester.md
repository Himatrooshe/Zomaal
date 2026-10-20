# QA Tester Guide — Packaging

Updated 20 October 2026.

## References

- Figma: [Packaging list and setup (Figma section 1:11814)](https://www.figma.com/design/6g6gVrZZovSVOOfRB9vPGw/zomal-copy?node-id=0-1).
- [Module requirements](../../module-context/06-packaging.md).
- [OpenAPI contract](../../api/openapi.yaml).

## Current status

Live audit completed on revision `zomaal-backend-00062-gmt` (`54e1048`). **Five findings remain open; final signoff is blocked.** Stock/threshold/usage APIs work, but image retries, integer limits, blank movement reasons and notification scheduling need fixes. Owner WhatsApp stock alerts are not wired. See [live audit](./live-server-test-results-2026-10-20.md).

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

## Executed coverage and retest queue

- Live: 181 recorded observations, 174 passed and 7 failed assertions across the listed runtime/configuration findings. The WhatsApp requirement gap was established from code and client requirements, with no send attempt.
- Existing units: 66 tests passed. Dedicated local PostgreSQL services: 17 checks passed, including delivery consumption and deduplication.
- Retest PKG-01 through PKG-05 after fixes; retain the current evidence as the pre-fix baseline.
- Actual courier delivery consumption, actual Shop-admin delivery, real mobile push and owner WhatsApp receipt still require production acceptance. Do not count manual stock adjustments as proof of delivery consumption.
- Test data/store/images removed; original Packaging, Purchases and Home counts preserved.

## Fix regression coverage

New PostgreSQL suite: `PACKAGING_TEST_DATABASE_URL=<dedicated-local-test-db> npm run test:e2e -- --runInBand packaging-workflow.postgres`.

Covers replay/concurrent image replacement and rollback; absolute/delta/result integer overflow; blank/short trimmed reasons; valid integer maximum; queue deduplication; blocked Meta configuration in the notification response; approved-template dispatch with mocked Meta; uncertain-outcome protection; cancellation and new alert cycles; real evaluator restock resolution; owner/staff/store access. Meta send tests in this suite are mocked and do not prove production message delivery.

Live retest must separately verify the deployed revision, real image preview/replay, rejected stock writes without changed balances, scheduler authentication, low/out-of-stock creation and deduplication, toggle/restock resolution, and the actual `ownerWhatsApp` blocker. Preserve the original QA account and delete temporary records/images.


## Deployed live retest

`b1ee535` / `zomaal-backend-00063-qdf`: **208/208 production observations passed**. [Verification and actual responses](./fix-verification-2026-10-20.md). PKG-01/02/03/05 are closed; PKG-04 backend path is implemented and reports BLOCKED / WHATSAPP_DISABLED until client Meta/template prerequisites are met. Original QA account retained; synthetic test data/images cleaned.
