# Notifications — live server test

Date: 21 October 2026 (UTC)
Environment: production Cloud Run API
Revision: `zomaal-backend-00068-vbx`, commit `2b31110ed4ad68a2624b13dd11e989bd658efc4d`, 100% traffic
Health: `GET /health` returned HTTP 200 (`Hello Zomaal!`)

## Results

All tested API and alert-lifecycle checks passed. The live test used one clearly
labeled, temporary store and packaging item. The test store was deleted after
the run; the original store was restored as active. A final check found exactly
the original store, zero remaining notifications, and zero unread counts.

### API behavior

| Check | Production response |
|---|---|
| Authenticated `GET /notifications` on an empty account | 200; empty items, total 0, unread 0 |
| `GET /notifications/unread-count` | 200; all, critical, warning, inventory each 0 |
| All / Critical / Warning / Inventory list tabs | Each 200; empty items |
| Missing authentication | 401 |
| Unknown tab and invalid pagination | Each 400 with validation messages |
| Mark all read when empty | 200, `{ "marked": 0 }` |
| Mark a valid but nonexistent notification UUID read | 404, `Notification not found` |
| Malformed notification UUID | 400 |
| Invalid push-device token | 400 |
| Delete nonexistent push-device token | 204; no row was created |
| Missing or incorrect scheduler secret | 401 |

### Scheduled inventory alert lifecycle

The real Cloud Scheduler job `zomaal-notifications-evaluate` is enabled on
`*/5 * * * *` UTC. Its latest observed invocation returned HTTP 200. The live
test invoked that configured job against the disposable store and observed:

1. Available packaging at its minimum created one `LOW_STOCK` notification with
   the expected available quantity and inventory entity reference.
2. Re-running evaluation kept one active alert (deduplicated).
3. Marking the alert read returned 204; its per-user `isRead` became true and
   unread counts returned zero.
4. Setting available stock to zero resolved the low-stock alert and created one
   `OUT_OF_STOCK` alert with available quantity zero.
5. Re-running evaluation kept one active out-of-stock alert.
6. Restocking above the minimum resolved the out-of-stock alert.

There were **28/28 passing recorded checks** in this isolated lifecycle run,
including setup, API reads, scheduled invocations, state assertions, and
cleanup. This count is observations, not 28 unique notification types.

## Limits and remaining acceptance

- The serving revision has no `PUSH_NOTIFICATIONS_ENABLED` or `FCM_PROJECT_ID`
  configuration. Push delivery and actual device receipt were not tested.
- Only the inventory alert lifecycle was generated live. Salary, sales-drop,
  platform/courier failures, billing transitions, blacklist, duplicate-order,
  and WhatsApp events were not independently triggered in production here.
- Figma mentions overdue customer payments; that notification is not
  implemented. The client has not confirmed the full alert list (Q16.1).
- No source code change or deployment was needed: no defect was reproduced in
  the tested scope.

Sanitized machine-readable observations: [live-server-results-2026-10-21.json](./live-server-results-2026-10-21.json).
