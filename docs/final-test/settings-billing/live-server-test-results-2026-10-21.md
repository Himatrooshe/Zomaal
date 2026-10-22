# Settings and billing — recorded production results, 21 October 2026

This report was assembled on 22 October from the unchanged [recorded JSON observations](./live-server-results-2026-10-21.json); it is not a new live run.

Tested revision: `zomaal-backend-00068-vbx`, application `2b31110`, at 100% traffic as recorded. **33/34 observations passed; one failed acceptance check.** Counts include setup, assertions and cleanup.

## Outstanding finding

`GET /billing/plans` returned 200 with zero active plans. Authentication/route availability worked; the Pricing screen still has no options. Configure approved admin-managed plan records before plan-selection/manual-activation acceptance. No production plans or prices were invented by this refresh.

## Recorded checks

| Check | HTTP | Result |
| --- | --- | --- |
| read stores | 200 | Passed |
| one original store active at start | — | Passed |
| GET active plans | 200 | Passed |
| active plans available to pricing screen | — | Failed acceptance |
| GET subscription | 200 | Passed |
| GET billing invoices | 200 | Passed |
| invalid invoice pagination | 400 | Passed |
| billing route requires access token | 401 | Passed |
| cancel rejects trial without changing it | 409 | Passed |
| resume rejects trial without pending cancellation | 409 | Passed |
| confirm subscription unchanged | 200 | Passed |
| rejected billing actions preserve trial fields | — | Passed |
| create isolated second store | 201 | Passed |
| GET active store after create | 200 | Passed |
| creating store selects it | — | Passed |
| list stores after create | 200 | Passed |
| store list has one active badge | — | Passed |
| profile for selected store | 200 | Passed |
| profile contains selected store | — | Passed |
| subscription entitlement count | 200 | Passed |
| account trial has unlimited stores and reports count | — | Passed |
| update disposable store settings | 200 | Passed |
| store update returns saved values | — | Passed |
| invalid empty city update rejected | 400 | Passed |
| read store after invalid update | 200 | Passed |
| invalid setting leaves stored values intact | — | Passed |
| invalid select ID rejected | 400 | Passed |
| unowned store selection rejected | 404 | Passed |
| deletion of nonexistent store rejected | 404 | Passed |
| GET packaging for new store | 200 | Passed |
| new store starts without another store packaging data | — | Passed |
| restore original selected store | 200 | Passed |
| delete isolated store | 200 | Passed |
| verify final stores | 200 | Passed |

## Preservation and limits

The disposable second store was removed and the original store selected again. The original subscription/trial stayed unchanged. This run did not activate a paid subscription, advance production time, delete the retained account or process a charge. Gateway/web checkout, stored cards, full paid/expired/suspended behavior, final account-deletion execution and frontend/device acceptance remain open. See [current status](../CURRENT-STATUS.md) and the module QA guide.
