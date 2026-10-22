# Orders

## Handoff status — 22 October 2026

All five expanded-audit findings passed 155/155 live observations on `9d4e661`. Staff access passed 118/118 and separate-owner isolation 114/114. Export heap fixes in `31c0dd4` passed 34/34 live observations: 10,000 rows and two concurrent exports succeed; 10,001 rows return 413. Ameex access, genuine courier events and physical-device scanning remain open.

[Verification evidence](./export-memory-fix-verification-2026-10-22.md) · [Cross-module status and API gaps](../CURRENT-STATUS.md) · [Production API contract](../openapi.production.json).

This refresh consolidates recorded work; it does not claim a new full regression run. Unchecked UI/QA checklists remain acceptance work. Revision names below identify the version tested at that time.

**Latest status — 22 October 2026:** the export heap failure is fixed on `31c0dd4`, production `zomaal-backend-00071-h7g`. **34/34 live observations passed**, including 10,000-row exports and two concurrent exports; 10,001 rows return 413. [Fix, deployment and live evidence](./export-memory-fix-verification-2026-10-22.md). Ameex firewall access, Sendit connection and real-world/device acceptance remain open.

**Current status — 21 October 2026:** all five expanded-audit findings are fixed and verified live. Application commit `9d4e661`, production revision `zomaal-backend-00070-94q`, 100% traffic. **155/155 recorded live observations passed**, zero failed. Disposable data and image removed; original account/store and Home order metrics preserved.

- [Separate merchant-owner isolation — 114/114 passed](./live-owner-isolation-2026-10-21.md)
- [Staff permissions and assigned-store live test — 118/118 passed](./live-staff-access-2026-10-21.md)
- [Fresh independent live confirmation — 155/155 passed](./live-confirmation-2026-10-21.md)
- [Fix verification, deployment and remaining acceptance](./live-fix-verification-2026-10-21.md)
- [Sanitized deployed response evidence](./live-fix-retest-results-2026-10-21.json)
- [Frontend developer guide](./frontend-developer.md)
- [QA tester guide](./qa-tester.md)
- [Historical expanded audit](./live-expanded-audit-2026-10-21.md)
- [Historical expanded observations](./live-expanded-results-2026-10-21.json)
- [Initial read/export check](./live-server-test-results-2026-10-21.md)
- [Orders requirements and current contract](../../module-context/03-orders.md)
- [OpenAPI](../openapi.production.json)
