# Packaging

- [Frontend developer guide](./frontend-developer.md)
- [QA tester guide](./qa-tester.md)
- [Deployed fixes and live retest](./fix-verification-2026-10-20.md)
- [Live retest evidence and responses](./live-server-fix-retest-results-2026-10-20.json)
- [Requirements and answered questions](../../module-context/06-packaging.md)
- [API schemas and routes](../../api/openapi.yaml)

## Current status — 20 October 2026

Backend fixes deployed as `b1ee535`, revision `zomaal-backend-00063-qdf`. **208/208 live observations passed.** Image retries, stock bounds, blank reasons and scheduled in-app notifications are fixed. Owner WhatsApp alert queue and dependency status are implemented; **actual receipt still awaits client Meta setup and an approved inventory template**.

[Pre-fix audit](./live-server-test-results-2026-10-20.md) is historical evidence; its five open findings describe the earlier revision. Delivery/Shop-admin events, push receipt and real owner WhatsApp receipt are separate acceptance checks.
