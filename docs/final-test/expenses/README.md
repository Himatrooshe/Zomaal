# Expenses

- [Live audit and findings — 20 October 2026](./live-server-test-results-2026-10-20.md)
- [Sanitized live evidence and responses](./live-server-results-2026-10-20.json)
- [Frontend developer guide](./frontend-developer.md)
- [QA tester guide](./qa-tester.md)
- [Confirmed client requirements](../../module-context/09-expenses.md)
- [OpenAPI](../../api/openapi.yaml)

**Not ready for final signoff.** 345 production observations: 313 passed and 32 failed assertions across ten live finding groups. An additional missing courier-cost integration is confirmed from code, but nonzero live provider fees were unavailable. Receipt replacement, money/null validation, automatic-group guards, retry safety, date/query/name validation and phone-timezone alignment need fixes. No application changes or deployments were made during this audit.
