# Packaging fixes — verification record

## Changes

- Image replacement reads the attachment under a PostgreSQL row lock. Repeating the current image succeeds; concurrent replacements preserve the final image.
- Stock input and resulting balances reject integer overflow with 400. Blank/short reasons are rejected after trimming.
- Protected notification scheduling is enabled in CI/CD. `scripts/setup-notifications-scheduler.py --prepare --project <project>` provisions its secret and access; run without `--prepare` after deploy to configure the five-minute job. No credential values are logged.
- A new additive `PackagingOwnerAlert` table stores one owner WhatsApp attempt per notification cycle. It rechecks current stock, alert settings, connection and approved Meta template before sending. Ambiguous outcomes are not automatically retried. Resolving/restocking cancels pending alerts.
- Owners can refresh the active store through `POST /notifications/evaluate`; notification responses expose owner delivery status without credentials or recipient phone.

## Local verification

- Unit tests: 135 suites, 1,184 tests passed.
- PostgreSQL suites: 141 tests passed, including 22 new packaging regressions.
- Packaging delivery, Shop replenishment, stock reservation and cost/profit service checks: 17 passed against a dedicated local PostgreSQL database.
- Build, Prisma validation and OpenAPI generation passed.
- Schema drift has only existing legacy table removals; this additive migration does not drop those tables.
- Repository lint has pre-existing errors. The changed implementation and new packaging PostgreSQL suite passed scoped ESLint; existing `notifications.service.spec.ts` retains earlier unsafe-mock lint errors, and the notification DTO has earlier transform warnings. Full-lint status is not a pass.
- Scoped TypeScript formatting passed. Generated OpenAPI keeps the repository generator's YAML layout; checking that generated YAML with Prettier still reports formatting differences.

## Deployment and live retest

**Deployed and live regression passed.** The pre-fix audit is retained alongside this record.

- Commit `b1ee535aadf260548bce6c07e4b74026866c14a0`, revision `zomaal-backend-00063-qdf`, 100% traffic; health passed.
- [CI/CD run](https://github.com/Himatrooshe/Zomaal/actions/runs/39418721529): both Test and build and Deploy production completed successfully.
- **208 recorded live observations: 208 passed, zero failed.** These include requests, assertions, setup and cleanup, not 208 unique business scenarios. [Sanitized observations and selected responses](./live-server-fix-retest-results-2026-10-20.json).
- Image replacement replay returned 200. Concurrent replacements retained readable content. Invalid replacements preserved the current image.
- Oversized absolute stock and delta returned 400. A valid-sized delta whose result overflowed also returned 400. Blank journal reasons returned 400; rejected writes preserved stock.
- Real in-app LOW_STOCK and OUT_OF_STOCK notifications appeared. Repeated evaluation deduplicated them. Restock and alert toggle off resolved notifications and cancelled pending owner sends. A later low-stock cycle created a fresh notification.
- Owner-only evaluation succeeded; staff invocation returned 403. Existing view/edit/stock permission and store-isolation checks passed.
- Missing scheduler credentials now return 401. Cloud Scheduler job `zomaal-notifications-evaluate` is ENABLED on `*/5 * * * *` (UTC). An actual job invocation returned HTTP 200 at `2026-10-20T12:32:25.634885879Z`.
- Temporary store, test data and three remaining cloud image objects were removed. Original account and Packaging, Purchases and Home counts were preserved. Disposable staff was deactivated and scheduled for account deletion.

### Actual owner WhatsApp response

```json
{
  "status": "BLOCKED",
  "lastErrorCode": "WHATSAPP_DISABLED",
  "sentAt": null
}
```

PKG-01, PKG-02, PKG-03 and PKG-05 are closed by the deployed live retest. PKG-04 backend wiring, durable queue, template checks and status reporting are implemented. **Actual owner WhatsApp receipt remains open for client Meta setup and approved-template acceptance.** No production owner message was claimed as sent.

## External acceptance

Actual owner WhatsApp receipt remains dependent on the client's Meta setup and an approved inventory template. Mocked dispatch is not production send proof. Real courier delivery events, actual Shop-admin delivery and mobile push receipt remain distinct acceptance checks from manual inventory mutations.
