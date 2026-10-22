# Notifications — latest production revision retest

**Date:** 2026-10-21
**Revision:** `zomaal-backend-00069-vb7`
**Health:** HTTP 200

Retested the user-facing API after the latest deployment. The account had no notifications at the start or end of the check.

| Check | Result |
|---|---|
| All, Critical, Warning, and Inventory tabs | All returned 200 with 0 items and 0 unread |
| `unreadOnly=true` | 200 with 0 items |
| Unread count | 200; all four tab counts were 0 |
| Missing authentication | 401 |
| Unknown tab, page 0, and limit 101 | Each returned 400 |
| Mark all read on empty list | 200; marked 0 |
| Malformed notification UUID | 400 |
| Valid but nonexistent notification UUID | 404 |
| Syntactically invalid push token | 400 |
| Temporary test device cleanup | DELETE returned 204; test device removed |

A one-character alphanumeric token was briefly accepted because it matches the DTO's allowed-character rule. It was immediately removed. The API performs syntactic validation only; a real device registration and push delivery were not tested. This observation is not classified as a defect without a defined minimum-token contract.

No notifications or stores were created by this retest; the temporary device entry was removed. The previous production lifecycle report remains the evidence for scheduler-driven inventory alert generation, deduplication, read-state, and resolution. Push delivery and other notification triggers remain unverified as listed in [the original live report](./live-server-test-results-2026-10-21.md).

## Additional live verification

- Cloud Run reports revision `zomaal-backend-00069-vb7` as the latest ready revision.
- The production Cloud Scheduler job `zomaal-notifications-evaluate` is `ENABLED` on `*/5 * * * *` (UTC). Cloud Scheduler logs show HTTP 200 for its 10:25 and 10:30 UTC executions.
- Immediately after those executions, authenticated `GET /notifications` and `GET /notifications/unread-count` both returned 200 with an empty list and zero counts. No unexpected notification was left on the test account.
- Push remains unavailable: the serving Cloud Run service has neither `PUSH_NOTIFICATIONS_ENABLED` nor `FCM_PROJECT_ID`. No actual FCM device delivery can be verified until deployment configuration and a real test device/token are available.
- The previous disposable inventory lifecycle run on revision `00068-vbx` remains the evidence for alert generation, deduplication, mark-read, resolution, and cleanup. The `00069-vb7` deployment changed only the Orders timeline OpenAPI contract; it contains no Notifications source changes.
