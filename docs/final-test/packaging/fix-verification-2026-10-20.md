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
- Repository lint has pre-existing errors. New packaging implementation/tests are checked separately; full-lint status is not a pass.

## Deployment and live retest

Pending execution. The pre-fix audit is retained alongside this record.

## External acceptance

Actual owner WhatsApp receipt remains dependent on the client's Meta setup and an approved inventory template. Mocked dispatch is not production send proof. Real courier delivery events, actual Shop-admin delivery and mobile push receipt remain distinct acceptance checks from manual inventory mutations.
