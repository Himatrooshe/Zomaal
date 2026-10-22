# Live findings — fixes and deployment retest

Date: 20 October 2026. Main fixes: `9a090ca`. Follow-up for signed provider connectivity probes: `5aa776d`.

## Changes

- Enforce Returns limit 1–100.
- Reject oversized damage amounts and computed allocation losses with 400 before stock or ledger writes.
- Persist manual-order request fingerprints, preserving exact retries after catalog changes and returning 409 for changed payloads. Older orders compare persisted customer/shipping/line values.
- Resolve staff/active-store access for financial reads and refreshes.
- Delete explicitly authorized stores with their restricted inventory/product/expense dependencies in one transaction, preserving the last-store rule and other stores' records.
- Reconcile confirmed ForceLog deletion with CANCELLED local tracking/dispatch state, released stock and financial synchronization. Authenticated provider absence also reconciles pending parcels deleted before the fix; terminal delivery history is preserved.
- Register a QuickLivraison callback with the provider-generated signing secret held in Secret Manager and bound through CI/CD. Preserve the two existing provider callbacks. Acknowledge signed untracked-parcel events without creating synthetic shipments.

## Local checks

- Full unit suite: 1,184 passed across 135 suites.
- Tracking PostgreSQL suite: 65 passed, including the live-finding regressions. The previous combined run passed existing Returns and Products suites as well; CI runs all of these gates.
- Build, Prisma validation, Prettier and whitespace checks passed.
- Production changes/new tests pass ESLint. The existing `ecommerce.service.spec.ts` retains its baseline 24 errors; no global lint-clean claim is made.
- No schema migration or dependency changes.

## Deployment and live checks

[Main CI/CD run](https://github.com/Himatrooshe/Zomaal/actions/runs/39335927163); [signed-probe follow-up run](https://github.com/Himatrooshe/Zomaal/actions/runs/39337469445). Main fixes deployed successfully to revision `zomaal-backend-00060-nzj`, with 100% traffic and health passing. All 69 live checks for the main fixes passed. Follow-up `5aa776d` deployed successfully to revision `zomaal-backend-00061-ffw`, verified against the revision commit label with 100% traffic and a passing health check. Both jobs in the follow-up CI/CD run completed successfully.


## Verified after the main deployment

- Returns limit=101 and oversized condition costs return 400 without stock or financial changes.
- Legacy manual-order exact retry succeeds; a changed payload returns 409.
- New fingerprinted retries preserve the original order/price after catalog edits. Concurrent changed payloads produce one 201 and one 409.
- Authorized staff financial read and refresh return 200; access to another store returns 404.
- The previous deleted ForceLog parcel now resolves CANCELLED after an authenticated refresh, and repeated refreshes are safe.
- A fresh real ForceLog parcel reserves A=4 and B=2. Provider deletion immediately yields CANCELLED in live scans and releases reservations without sales or shipping loss. Retrying the cancelled dispatch returns a clean 400.
- Both newly generated provider/Zomaal PDF labels decode successfully; QR quantities remain two packs, A=4 and B=2.

Initial fixture activation failed because its category was intentionally archived. The category was restored and the complete core suite rerun successfully. QuickLivraison accepted valid signatures but its own non-status connectivity probe initially returned 400; `5aa776d` adds signed non-status acknowledgement without business-data mutations.


## Main-fix live retest and cleanup

All **88 recorded live checks passed**, covering the six reported code findings, actual provider label decoding, cancelled-status scanning and final cleanup. Counts include setup and cleanup assertions, rather than 88 distinct business scenarios.

The retained temporary QA store was deleted successfully through the fixed API, including its inventory history, synthetic orders and Returns. Original active store restored; original Home still reports six connected products, ten connected customers, eight archived warehouse products, zero active warehouse products, four total orders, four connected shipping providers and zero dispatches. The original account and prior test order remain available.

The fresh ForceLog test parcel was deleted at the provider before pickup. Its cancellation history remains in local courier records, with no reservation, delivered revenue or shipping-loss balance. The disposable QA staff user remains deactivated and scheduled for the standard account-deletion grace period.


## Final result

**All seven reported findings are resolved. 97 recorded live checks passed, zero failed:** 88 checks for the main fixes and 9 callback/configuration checks. [Sanitized results and response evidence](./live-fix-retest-results-2026-10-20.json).

- QuickLivraison's own dashboard test sent a real callback and returned `{ "success": true, "status_code": 200 }`.
- Provider-generated HMAC signature accepted; missing/forged signatures rejected with 401.
- New Zomaal callback active, failure count zero, and both pre-existing callbacks preserved. The secret remains in Secret Manager and is bound through CI/CD.
- The dashboard's connectivity-test response is the proof of HTTP 200. Its real shipment-notification metadata remains null until an actual shipment notification; that metadata is not populated by the test button.
- The QA store deletion succeeded and its synthetic database records were removed. Original account/store and previous retained test order remain available.

No schema migration or dependency change was needed. Code is merged into main. Earlier audit reports remain historical; this report supersedes their unresolved findings.

## Remaining physical acceptance

Provider and Zomaal PDFs were decoded digitally and resolved through the live API with the current CANCELLED state. A physical printer/camera was not used, and no physical pickup or delivery was requested. A real Delivered/Returned parcel notification was not manufactured in production; financial lifecycle/rollback/concurrency regressions are covered by the PostgreSQL suite. This is a sign-off for the reported backend fixes, not a claim that every conceivable edge case has been exhausted.
