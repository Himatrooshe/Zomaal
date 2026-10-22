# Staff & Salary final tests

## Handoff status — 22 October 2026

Fix `0326eaa` passed 267/267 live observations. Strict input/date validation, saved schedule timezone, local-calendar reports and protected 15-minute scheduling are deployed; a real Scheduler invocation returned 200. PAID is an accounting record. Bank transfer, natural overnight recurrence and unresolved client policies are not certified.

[Verification evidence](./fix-verification-2026-10-21.md) · [Cross-module status and API gaps](../CURRENT-STATUS.md) · [Production API contract](../openapi.production.json).

This refresh consolidates recorded work; it does not claim a new full regression run. Unchecked UI/QA checklists remain acceptance work. Revision names below identify the version tested at that time.

**Latest status:** application commit `0326eaa`, serving revision `zomaal-backend-00065-zbd`;267/267 live observations passed after successful CI/CD. Salary Scheduler configured and an actual execution verifiedHTTP200. Original account/data preserved; disposable test data removed.

- [Final deployed verification](fix-verification-2026-10-21.md)
- [Deployed live responses and observations](live-fix-retest-results-2026-10-21.json)
- [Frontend developer handoff](frontend-developer.md)
- [QA tester handoff](qa-tester.md)
- [Historical initial audit](live-server-test-results-2026-10-21.md)

Inactive staff retain salary agreements and forecasts; deactivation removes access. This resolves a stale documentation sentence while preserving established behavior.

## Backend audit correction — 22 October 2026

See the [backend fix log](../../backend-live-audit-fixes-2026-10-22.md) for the new Store/Role/Category validation, accounting-currency protection and strict pagination/boolean contracts. The log distinguishes verified local tests from deployment and live retest. Historical module observations above keep their original date and scope.
