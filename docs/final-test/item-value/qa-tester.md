# Item Value — QA tester guide

## Handoff status — 22 October 2026

`7a1cb34` / revision `zomaal-backend-00072-kmd` passed 100/100 live observations. Store-scoped current physical stock valuation, whole-filter summaries, unknown costs/FX, permissions and isolation are deployed. No historical valuation or detailed Figma screen is provided; frontend/device and large-catalog acceptance remain separate. Reports are outside v1.

[Verification evidence](./live-server-test-results-2026-10-22.md) · [Cross-module status and API gaps](../CURRENT-STATUS.md) · [Production API contract](../openapi.production.json).

This refresh consolidates recorded work; it does not claim a new full regression run. Unchecked UI/QA checklists remain acceptance work. Revision names below identify the version tested at that time.

Updated 22 October 2026. Deployed as `7a1cb34`, revision `zomaal-backend-00072-kmd`. Local unit/PostgreSQL checks and 100/100 recorded live observations passed. No detailed Figma screen is available.

## Acceptance checklist

- Empty store: 200, no rows, zero known totals and `complete: true`.
- Multi-location product stock: aggregate on-hand; distinguish reserved/damaged from available; exclude incoming-only and zero-stock items.
- Archived products and inactive packaging with physical stock remain valued. A virtual pack never adds another copy of component inventory value.
- Variant warehouse cost drives product valuation. Packaging cost comes from the latest purchase date, then creation time/id, using actual paid totals, not Shop list price. Verify manual, Shop variant and legacy Shop product links.
- Latest invalid historical cost does not silently fall back to an older cost. Zero product cost and missing purchases remain unvalued. Confirmed free packaging stays known zero without an FX quote.
- Known foreign currency converts through a real quote. Missing/invalid quotes remain null/incomplete. No fabricated rate.
- Kind filters, alphabetical pagination, duplicate names, empty pages and stable IDs work. Summary covers all filtered rows and remains unchanged across pages, except snapshot time.
- Invalid/fractional/scientific/hexadecimal/unsafe page values, duplicate query values, invalid kinds, limit outside 1–100 and injected store IDs return 400.
- Missing authentication 401; staff lacking `products.view` or deactivated 403; no-store caller 404. Changing permissions affects the current session.
- Two independent owners only see their own store; switching an owner's active store does not move assigned staff. A foreign purchase must never supply a local material's cost.
- Repeated reads do not change balances, purchase records or inventory/financial journals. Permission activity timestamps may update normally.
- Restore original store selection and delete only disposable QA fixtures/accounts. Preserve real imported records and the retained merchant account.

Unit tests cover decimal valuation, FX caching and invalid quotes. `test/item-value-workflow.postgres.e2e-spec.ts` uses the real controller, validation, permissions, store access and PostgreSQL relationships; test auth identities and exchange quotes are controlled at their boundaries. The CI gate runs it before deployment. Real production quotes and JWTs are checked separately during live acceptance.

[Requirements](../../module-context/18-reports.md) · [OpenAPI](../openapi.production.json).

[Deployment, live evidence and limits](./live-server-test-results-2026-10-22.md) · [Sanitized QA response examples](./live-server-results-2026-10-22.json).

Deployed Swagger: https://zomaal-backend-563898960389.us-central1.run.app/docs
