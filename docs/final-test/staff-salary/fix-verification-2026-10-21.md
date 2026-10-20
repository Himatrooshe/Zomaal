# Staff & Salary fix verification — 2026-10-21

Status: implemented and locally verified; production deployment/live retest pending.

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

Final production revision, CI/CD result, actual scheduler run and sanitized live responses will be added after deployment and retest.
