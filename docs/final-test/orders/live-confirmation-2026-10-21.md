# Orders — fresh live confirmation

A separate production run requested after the fix deployment passed **155/155 recorded observations**, zero failed. Fresh disposable fixtures were used; this is an additional run rather than a reuse of the earlier result.

- Started: 2026-10-21T16:55:51.806Z (UTC).
- Finished: 2026-10-21T16:58:07.225Z (UTC).
- Application commit: `9d4e661190cb9bf9bafaf413e219e2c881ed6f52`.
- Revision: `zomaal-backend-00070-94q`, 100% traffic; same revision after cleanup.

All five reported findings remained fixed: whitespace-only fields and invalid currencies return 400, individual/computed money overflows return 400 without creating or overwriting customers, malformed queries return 400, and timelines return 404 outside the active store. Ordinary creation, valid values, concurrent retries/conflicts, catalog price preservation, stock invariants, and empty/filtered XLSX exports also passed.

Counts include setup, persisted-state assertions and cleanup. The disposable store and synthetic records were deleted; the single uploaded image was removed. Original store selection/list and Home order metrics were preserved. No source change or new deployment was required for this confirmation.

This run retains the scope limits in [fix verification](./live-fix-verification-2026-10-21.md), including actual courier/device acceptance and production-scale export limits.

[Sanitized observations](./live-confirmation-results-2026-10-21.json).
