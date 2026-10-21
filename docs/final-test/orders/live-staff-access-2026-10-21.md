# Orders — staff permissions live test

**118/118 recorded live observations passed; zero failures. No bug was reproduced in this scope.** Counts include setup, read-state assertions, and cleanup rather than 118 distinct permission scenarios.

Started: 2026-10-21T17:20:03.731Z (UTC). Finished: 2026-10-21T17:22:51.048Z (UTC).

Production revision `zomaal-backend-00070-94q` served application `9d4e661190cb9bf9bafaf413e219e2c881ed6f52` with 100% traffic. The same revision remained ready after cleanup. This run used actual production login/API requests and a disposable staff login, role, store, catalog and manual orders. No source change or deployment was needed.

## Verified behavior

| Case | Live result |
|---|---|
| Role with no grants | Order list, summary, detail, products, timeline, financials, creation and export rejected with 403. |
| Locked-screen error | Response identified `PERMISSION_DENIED`, the Orders module and missing `orders.view`. |
| `orders.view` only | All six tested reads returned 200; creation, financial sync and export returned 403. |
| `orders.export` override only | XLSX returned 200 with one assigned-store order and 20 columns; list/create denied. Bootstrap reflected the replacement override. |
| `orders.edit` override only | Creation and exact retry returned 201 with one unique order; own manual financial sync returned 200. View/export remained denied. |
| Empty overrides | Inherited the role again and removed the prior per-person action override. |
| Role changes on an existing JWT | Export grant applied immediately; view revocation applied immediately. |
| Unrelated permission override | Replaced role grants: expense read succeeded, Orders export denied. |
| Owner administration boundaries | Staff could not list/manage staff or roles, escalate its own grants, or create owner stores. |
| Assigned store after owner switches | Staff retained its assigned store and could read its own fixture order. |
| Other-store order access | Detail, products, timeline, financial read and financial sync all returned 404. Search omitted the foreign order; export was header-only. |
| Store switch attempts | Staff could not select either owner store as an owner; assigned-store bootstrap remained unchanged. |
| Deactivation | Existing JWT rejected list, timeline and export with 403; a fresh login attempt returned 401. Reactivation restored assigned-store access. |

## Cleanup

The disposable staff login was scheduled for the documented 30-day account-deletion grace period and deactivated before deleting the fixture store. Store deletion removed its staff membership, role, synthetic catalog/orders and associated business records. The User record remains scheduled for standard deletion on 2026-11-20T17:21:44.703Z; it was not represented as physically purged in this run. Its credentials and token were removed from the private runner state.

The uploaded image was deleted from cloud storage. Original active store, store list, Home order metrics, staff list/totals and roles matched their baselines. The original test account was retained.

## Scope limits

Foreign-store probes used two stores belonging to the same owner and a staff login assigned to only one. This certifies staff assigned-store isolation; it does not establish production isolation between unrelated merchant owners. No real courier dispatch/cancellation, physical shipment, or production-scale 10,001-row export was generated.

[Sanitized live observations](./live-staff-access-results-2026-10-21.json).
