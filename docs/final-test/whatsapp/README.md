# WhatsApp Automation

## Handoff status — 22 October 2026

Merchant configuration/connection, templates, status settings, message log, analytics, balance and admin pricing/balance APIs are implemented. Actual delivery requires client Meta setup, approved templates, sender/pricing/balance and protected dispatch configuration. No real customer or owner WhatsApp receipt is certified by this handoff. Explicit preview mode is synthetic and must never count as live acceptance.

[Cross-module status and API gaps](../CURRENT-STATUS.md) · [Production API contract](../openapi.production.json).

This refresh consolidates recorded work; it does not claim a new full regression run. Unchecked UI/QA checklists remain acceptance work. Revision names below identify the version tested at that time.

- [Frontend developer guide](./frontend-developer.md)
- [QA tester guide](./qa-tester.md)
- Requirements and answered questions: [15-whatsapp.md](../../module-context/15-whatsapp.md)
- API schemas and routes: [OpenAPI](../openapi.production.json)
