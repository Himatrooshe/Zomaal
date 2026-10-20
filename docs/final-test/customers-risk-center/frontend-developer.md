# Customers & Risk Center — frontend handoff

**Status: deployed on revision`zomaal-backend-00066-bbg`; 342/342 live observations passed.** See [report and actual failures](live-server-test-results-2026-10-21.md).

## APIs

- `GET /customers?search=&page=1&limit=20`: customer totals, highRiskCount and page rows; customer identity originates from orders.
- `GET /customers/:id`: risk counters, proximity, blacklist state/reason and up to100 order-history rows.
- `GET /customers/blacklist`: paginated blacklistedCustomers and bounded atRiskCustomers watchlist. page/limit only paginate blacklisted rows.
- `GET/PUT /customers/blacklist/settings`: four category limits, combined mode/limit and warnOnNewOrder. Zero disables a limit; combined mode replaces individual checks.
- `POST /customers/:id/blacklist` with optional reason; omitted/blank reason auto-fills. `DELETE` on the same path removes blacklist and resets counters.
- `GET /customers/duplicate-orders?days=30&page=1&limit=20`: Main plus duplicates; canCancel and dispatchStatus.
- `POST /customers/duplicate-orders/cancel` with orderIds; must retain at least one per group. `POST /customers/duplicate-orders/:groupId/keep` keeps the group's extras.

## Permissions and behavior

customers.view gates Customers/details/duplicate listing. customers.blacklist gates the blacklist screen/settings/actions. Duplicate cancel requires orders.cancel; keep requires orders.edit. Use server permission codes for restricted screens.

Blacklist is warning-only under current assumptions; orders are still accepted. Do not tell users an order was auto-cancelled or shipping blocked solely by the blacklist. Platform duplicate cancellation can return platformCancelRequired:true; display the instruction to cancel on that platform. Manual duplicate cancellation returns false.

## Historical findings — fixed by0e7d246

The initial audit found split phone identities and missing warnings, same-title false duplicates, incorrect cancellation badges, all-member cancellation races, coerced numeric queries and overflow/null settings500. These failures were fixed and passed deployed retesting. Client-side validation remains useful for UX.

All data used in this audit was synthetic and removed. Client decisions are in `docs/module-context/11-customers-risk.md`, including retrospective re-evaluation when settings are lowered, which is currently undefined.

## Updated contract for the fix

Phone identity is normalized on ingestion; a single legacy formatted record keeps its ID/history/blacklist during normalization. Display the canonical E.164 value returned. A409 historical-phone collision requires reconciliation; do not create another customer to bypass the conflict. Phone-format search supports equivalent international formatting. Non-phone imported references remain unchanged for compatibility.

Known warehouse/platform identities take precedence over a title match. Keep/cancel can return400/404/409 when a concurrent decision changed the group: refresh the list. The backend serializes review and dispatch claiming, so UI button disabling is only a UX aid. Customer history now shows cancelled duplicate badges correctly.

Send integer numeric settings with values0–100000. Omit unchanged settings; do not sendnull. Use digit-only pagination within page1–1000000,limit1–100,days1–90. All invalid values now return400 instead of truncation/database500.

See [fix verification](fix-verification-2026-10-21.md) for deployed status. The historical findings above are resolved; final verification records the deployed evidence.
