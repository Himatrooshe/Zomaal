# Staff & Salary — QA handoff

## Handoff status — 22 October 2026

Fix `0326eaa` passed 267/267 live observations. Strict input/date validation, saved schedule timezone, local-calendar reports and protected 15-minute scheduling are deployed; a real Scheduler invocation returned 200. PAID is an accounting record. Bank transfer, natural overnight recurrence and unresolved client policies are not certified.

[Verification evidence](./fix-verification-2026-10-21.md) · [Cross-module status and API gaps](../CURRENT-STATUS.md) · [Production API contract](../openapi.production.json).

This refresh consolidates recorded work; it does not claim a new full regression run. Unchecked UI/QA checklists remain acceptance work. Revision names below identify the version tested at that time.

Use a disposable store and synthetic staff phones; keep the original `oshi-ecom` account and data intact. Never use a real salary profile for artificial payments.

## Required regressions

- Create/edit staff with and without a salary profile; duplicate phone; unknown/cross-store staff/role.
- Role inheritance, replacement overrides and clearing all access. Test existing tokens after permission removal, deactivation and reactivation. Staff cannot manage Staff, Roles or Salary.
- Reject whitespace names, required null fields, invalid amounts and unknown fields. Null role removal remains valid.
- Reject impossible/reduced/timezone-less timestamps, invalid IANA timezones, oversized/fractional/hex/scientific pagination. Failures400, never500; no partial rows persisted.
- Save/edit profile timezone; omit it on edit and verify it/cursor persist. Date-only input preserves its label; explicit timestamps convert into the supplied timezone's calendar date.
- Compare UTC, Dhaka, Casablanca and New York status lists and payout month/year boundaries. Display chips must agree with filtered lists. Due today stays pending in that local day.
- Create PENDING/PAID single and multi-staff batches. Retry unchanged UUID key, changed payload, duplicate due date and concurrent submissions. Verify one obligation and one expense.
- Record a manual salary expense twice/concurrently; confirm automatic pending payment; future paidAt must fail. Confirm totals/history/Expenses/Home and immutable historical amounts after profile edits.
- Upload photo/receipt; replace/read photo, reject missing/corrupt/unsupported/oversize. Batch receipt belongs to first submitted staff; consumed upload cannot be reused. Foreign/stale receipt must roll back the entire batch.
- Inactive staff keep their salary agreement, recorded history, future forecast and accrual; deactivation only removes access.
- Scheduler without/wrong secret401. Using protected credentials, process one due local profile and one future-local profile; only the due one accrues. Replay/concurrent invocation creates no duplicate. Test actual Cloud Scheduler success and logs.
- Verify month-end clamping, daily/weekly/monthly catch-up and concurrent cursor edits in the dedicated PostgreSQL suite; do not fabricate production time or money.

## Results and cleanup

The original [live audit](live-server-test-results-2026-10-21.md) is historical. Final deployment/retest evidence belongs in [fix verification](fix-verification-2026-10-21.md). Observation counts include setup/assertions/cleanup and are not unique business case counts.

Delete disposable stores, deactivate/schedule deletion of synthetic users, remove exact synthetic cloud media objects and compare original snapshots. Do not report a mobile UI or actual money-transfer test from API-only evidence.
