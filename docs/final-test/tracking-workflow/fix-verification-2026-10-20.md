# Tracking workflow fixes — verification

**Latest: [fix deployment and live retest](./live-fix-retest-2026-10-20.md) — all reported findings resolved; 97 live checks passed.**
Date: 20 October 2026. Commit: `75c8524`.

## Implemented

- Tracking ambiguity returns 409 instead of selecting an arbitrary order.
- Scans and return details expose pack components and physical quantities; QR contents include quantities.
- Partial and mixed conditions, component allocations, explicit revisions and safe repeated submissions.
- Atomic stock, condition, loss and return-status reconciliation; corrections replace the previous allocation snapshot.
- Revenue reinstatement for genuine delivery corrections, safe concurrent financial synchronization and shared inventory updates.
- Ameex order-reference linking and fee/status integration. Owner-wide ambiguity prevents automatic association.
- Older courier updates and terminal-to-progress regressions are rejected in the affected ingestion paths.
- Read-only saved-return details endpoint and updated OpenAPI/module context.

## Local verification

- `npm test -- --runInBand`: 135 suites, 1,182 passed.
- PostgreSQL tracking regression suite: 59 passed. Existing Returns and Products suites also passed; combined run: 86 passed.
- `npm run build`: passed.
- `npm run docs:generate`: passed using placeholder configuration; expected missing Twilio credentials log, no live credentials used.
- Prisma schema validation: passed. New migration adds two columns only; reviewed SQL has no removals. Drift inspection still lists pre-existing legacy Product-table removals; that generated diff was NOT applied.
- Prettier check and `git diff --check`: passed.
- ESLint: production changes and new test suite pass. Two existing test files retain their baseline 24 and 6 errors; no new lint errors remain. A global lint-clean claim would be incorrect.

## Deployment and live retest

CI/CD run: [39330274719](https://github.com/Himatrooshe/Zomaal/actions/runs/39330274719). Both Test and build and Deploy production completed successfully. Commit `75c8524` is deployed.

**Live API: 67 checks passed, zero failures.** [Sanitized results and response samples](./live-fix-results-2026-10-20.json).

Fixture: one clearly labelled manual order, two packs (each 2 A + 1 B) and two separate A units. Store/order currency BDT. No actual courier dispatch, external order or customer message was created.

- Pack response exposed A=4 and B=2 with component IDs and per-pack quantities.
- Overflow, foreign components and conflicting whole-line duplicates returned 400 without stock or financial changes. Changed stale revision returned 409.
- A1 damaged at 30 + B2 missing at 10 each + separate A1 lost at 30 produced total item loss **80.00**, net impact **−80.00**, and complete mixed lines.
- Component A stock: on hand 19, damaged 1; B: on hand 18, damaged 0. Exact repeated verification retained the same stock and financial ledger.
- Correcting every unit to Good restored both products to on hand 20, damaged 0, item loss 0 and net impact 0.
- Replacing a completed allocation with one partial unit reopened the saved return. Completing it again restored PROCESSED; GET details reflected both changes.
- Cleanup: all synthetic inventory buckets zero; all three QA products archived; QA category inactive. One QA manual order and one processed return remain as audit history. Test account preserved.
- Final Home: six connected products, ten connected customers, eight warehouse products (all archived), zero active warehouse products, catalog complete; four total orders; four connected couriers and **zero dispatches**.
- Dedicated local regression database cleanup checked users, stores, movements, financial events and return requests: all zero. The empty test database is retained for reproducible regression runs.

These live checks certify the manual-order allocation API. Courier lifecycle, collision and rollback scenarios were verified with the real local PostgreSQL services and synthetic provider snapshots, not by changing production courier statuses.

## Limits

No real courier dispatch is created by automated tests. Actual ticket printing, physical camera scanning, real callback delivery, provider Lost/Damaged vocabulary and cross-currency courier fee handling require provider test-parcel acceptance. Client-side Meta activation remains pending for WhatsApp delivery.
