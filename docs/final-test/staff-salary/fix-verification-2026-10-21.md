# Staff & Salary fix verification — 2026-10-21

Status: **deployed and live API regression complete:267/267 observations passed,0 failed.**

- Application commit:`0326eaaf00cd5592087a2707a0f782759f0a055c`.
- Serving revision:`zomaal-backend-00065-zbd`,100% traffic; exact revision commit label and `/health` verified.
- [CI/CD run](https://github.com/Himatrooshe/Zomaal/actions/runs/39477403334): Test and build and Deploy production both completed successfully.
- Cloud Build:`971a2b5d-c1b9-4701-b9c1-36f9203957bd`,SUCCESS.
- [Sanitized live observations and selected responses](live-fix-retest-results-2026-10-21.json). Counts include requests/assertions/setup/cleanup, not267 distinct business cases.

## Changes

- Reject required null updates and trim/reject blank names.
- Bound pagination and strictly validate complete, real calendar dates.
- Add device-timezone report filters/grouping and a saved schedule timezone.
- Provision protected salary scheduling every fifteen minutes, with retry-safe per-date processing.
- Correct the stale inactive forecast paragraph: inactive accounts retain salary agreements, accrual and future forecasts, matching existing behavior and explicit regression tests.
- Extract the existing strict/DST-aware calendar helper into common code; Expenses preserves its public helpers and behavior.

## Local evidence

- `npm test -- --runInBand`: 135 suites /1,184 tests passed.
- All PostgreSQL gates:9 suites /221 tests passed, including23 new Staff HTTP/database regressions and8 existing salary transaction tests.
- `npm run build`, `npx prisma validate`, OpenAPI generation passed.
- Scoped implementation/new-regression ESLint and TypeScript Prettier checks passed.
- Repository-wide ESLint still fails existing unsafe mock/typing issues; it is not reported as a full lint pass.
- Migration status was current before generating the new migration. Generated SQL was reviewed; unrelated legacy Product table drops/FK removals were removed before applying locally. The committed migration adds only `StaffSalaryProfile.timezone TEXT NOT NULL DEFAULT 'UTC'`, wrapped in a transaction.
- Migration diff after local deployment has only previously known legacy removals, no missing additions.
- Read-only production inventory before scheduler rollout:0 profiles,0 due profiles,0 automatic profiles. Original account/data preserved.

## Rollout and rollback

CI applies the additive migration before startup. The salary secret is prepared and runtime access granted; CI enables/binds it. Configure the external Scheduler after the tested revision is serving. No existing salary cursors or payments are rewritten. Previous code can operate with the additive column; pause the salary Scheduler and revert the application commit if rollback is needed.

## Deployed live findings verification

| Initial finding | Actual retest result |
| --- | --- |
| STAFF-01 scheduling disabled | Protected endpoint enabled. Anonymous/wrong-secret401. Concurrent authorized calls200/200 with processed2/0. Cloud Scheduler `zomaal-staff-salary-run` ENABLED, every15 minutes; actual invocation finished `2026-10-20T18:54:14.457269168Z`,HTTP200 confirmed in its execution log. |
| STAFF-02 null PATCH500 | Null required staff fields/permission arrays return400. Original staff values retained; deliberate null role removal still succeeds. |
| STAFF-03 whitespace name | Whitespace-only name returns400; normal editing/login behavior passes. |
| STAFF-04 page overflow500 | Oversized page values return400 in Staff and Salary lists; valid pagination still works. |
| STAFF-05 impossible/reduced dates | Payment/profile impossible and reduced dates return400 without creating obligations or moving profile cursors. |
| STAFF-06 timezone missing | Phone-timezone list/trend200; saved Dhaka schedule returned `timezone:Asia/Dhaka`. Actual payout-month and local-year boundaries passed. |
| STAFF-07 inactive forecast guide mismatch | Documentation now matches established implementation/tests: deactivation removes access while agreements, scheduled obligations and forecasts continue. Active/inactive forecasts were the same as required; no historical records rewritten. |

### Financial and calendar evidence

- Due automatic Dhaka salary3.33 created once asPAID with an Expense; due manual salary4.44 createdPENDING without an Expense. Future local salary5.55 not accrued.
- Expenses moved32.50→35.83: only3.33 automatic salary counted. Replaying the scheduler returned processed0 and preserved35.83.
- A payout at `2026-09-01T00:30Z` for6.78 appears in September UTC and August New York.
- A payout at `2026-01-01T00:30Z` for7.89 creates a UTC-vs-New-York annual paid-total difference of exactly7.89 (14.67 vs6.78 for the fixture staff).
- January31 monthly manual catch-up produced exactly9 calendar dates: Jan31,Feb28,Mar31,Apr30,May31,Jun30,Jul31,Aug31,Sep30. Cursor advanced toOct31. No imaginary historical bank transfer was recorded.
- Invalid timezone and skipped `2011-12-30` in `Pacific/Apia` return400.
- Original live audit workflows repeated: staff/role/password changes, inactive token checks, store isolation, manual/automatic payout confirmation, atomic multi-staff batches, concurrent retries, linked readonly Expenses, Home totals, receipt ownership, upload errors, summary/history/trends.

## Cleanup and preservation

Both test stores and their business records were removed. Three synthetic staff accounts were deactivated and scheduled for normal30-day deletion before store removal. Their temporary passwords/tokens were removed from private state. One remaining synthetic receipt and photo were deleted from GCS by exact object name. Original store set, Staff list, salary summary/history, Expense ledger/summary and Home order/shipping counts matched pretest snapshots. Original active store restored; the original QA account remains available.

## Limits

This signs off the tested deployed API regressions and actual scheduler invocation. It does not claim mobile UI testing or an actual cash/bank transfer; salary PAID is an accounting record. Overnight natural recurrence and natural24-hour receipt expiry were not awaited. Plan staff limits, multi-owner phone policy and additional payment methods still follow the documented client dependencies.
