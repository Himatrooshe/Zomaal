# 10. Staff & Salary

Mostly built. See `docs/staff-module.md`. Only the remaining gaps are listed here.

## Screens
Staff management (list, active/inactive) · Staff details (contact, salary, permissions per module,
activity) · Add / Edit staff (photo, basic info "use for login", salary, permissions incl. Advertising
and Shop, account status) · Manage salary info (automatic vs manual expense, daily / weekly / monthly,
payment date, method) · Salary tab (breakdown chart, Paid / Pending / Overdue) · Add salary record
(multi-select staff) · Access restricted (for staff).

## Data flow (as Figma shows it)
1. The owner adds staff with a phone + password and picks permissions.
2. Staff log in and see only the modules they were given.
3. The owner sets the salary. **Automatic** = recorded as paid and as an expense on the payment date.
   **Manual** = the owner records payments.
4. Payments feed "Staff salary" in Expenses (tab 9).

## Questions

**Q10.1 — Staff limit per plan?**
The upgrade banner says "Increase your speed with more members". How many staff can Starter and Pro have?
Answer:

**Q10.2 — Can one staff phone work for several stores or owners?**
Assumption: no, one staff account belongs to one store.
Answer:

**Q10.3 — Salary changes mid-period**
If the salary changes mid-month, do old unpaid records keep the old amount?
Assumption: yes. Only future records use the new amount.
Answer:

**Q10.4 — Activity log**
"Last active / Last login" is shown. Does the owner need a full audit log (who edited which order)?
Assumption: last login only in v1.
Answer:

## Live audit and corrections — 2026-10-21

The live audit recorded228 observations,213 passed and15 failed expectations. Validation, page overflow, malformed dates, timezone support and scheduler provisioning are addressed in the linked Staff & Salary final-test documents. The inactive-forecast sentence in the old guide was stale: existing behavior and explicit regression tests require salary accrual and projections to continue after access deactivation. This fix preserves that established rule. See [final-test handoff](../final-test/staff-salary/README.md) for deployed status.

### Deployed verification

Application `0326eaa`,revision `zomaal-backend-00065-zbd`:267/267 live observations passed after successful CI/CD. Actual salary Scheduler execution returnedHTTP200; invalid inputs now400 and device-timezone reports/saved schedules are supported. Original account/business data preserved and disposable QA records/media removed. [Full report](../final-test/staff-salary/fix-verification-2026-10-21.md).
