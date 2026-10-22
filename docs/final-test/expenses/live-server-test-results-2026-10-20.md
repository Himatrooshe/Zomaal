# Expenses — production audit, 20 October 2026

> Historical evidence. Original failures and observations below describe the tested revision at that time. Use [the subsequent verification](./fix-verification-2026-10-20.md) and [current module status](../CURRENT-STATUS.md) for resolved findings and remaining acceptance.

## Result

**Not ready for final signoff.** 345 recorded live observations: **313 passed, 32 failed assertions**, grouped into **10 live findings**. This count includes requests, setup and cleanup, not 345 unique business scenarios. There is also one requirement gap confirmed from code, with insufficient nonzero live courier data to reproduce its financial effect.

- Live code `b1ee535aadf260548bce6c07e4b74026866c14a0`, revision `zomaal-backend-00063-qdf`.
- [Sanitized observations and selected responses](./live-server-results-2026-10-20.json).
- [Client requirements](https://docs.google.com/document/d/1MyQOGeuSC72AGZzJBZSEKMs3jXKPDAHavN1tqo8pJoc/edit), Q9.1–Q9.5 and Q0.4, checked directly through Google Drive.
- [Figma Expenses section](https://www.figma.com/design/6g6gVrZZovSVOOfRB9vPGw/zomal-copy?node-id=1-7802), including visually inspected Breakdown frame `1:8463`.
- Existing local unit coverage: **66 tests passed**, three suites (`expenses.service`, `ads-spend.service`, `staff-salary`). These unit passes did not catch the live database/HTTP issues below.
- This audit changed no application code, migrations or deployment settings.

## Live findings

| ID | Priority | Finding | Actual live result |
|---|---|---|---|
| EXP-01 | High | Existing receipt cannot be replaced | PATCH with a fresh valid receipt returns 500. Original receipt remains readable. |
| EXP-02 | Medium | Current receipt retry fails | PATCH with the currently attached receipt ID returns 400 instead of replaying successfully. |
| EXP-03 | High | Money bounds and precision are unsafe | Amount `10000000000000000` returns 500; `0.00001` and `0.004` are accepted with response amount `0.00`. |
| EXP-04 | High | Null PATCH fields bypass validation | Null title, amount, paymentMethod and categoryId return 500. Null category name/group also return 500. Null spentAt silently succeeds without clearing/changing the date. |
| EXP-05 | High | Automatic expense groups accept manual writes | Direct creation in SHIPPING/ADS returns 201 and reassignment into those groups returns 200. SALARY/PURCHASES protections work. |
| EXP-06 | Medium | Manual submissions can double-count on retry | Two identical POSTs with the same `Idempotency-Key` header create two rows, total `2.46` for a `1.23` expense. The API does not advertise this header; this is a missing retry-safety capability, not a broken documented header contract. |
| EXP-07 | Medium | Calendar/date boundary validation is inconsistent | `2026-02-30` is accepted. A row exactly equal to an explicit `dateTo` timestamp is excluded despite the inclusive query description. Date-only full-day bounds pass. |
| EXP-08 | Medium | Integer query parsing is permissive and unbounded | `page=1.5`, `page=1junk`, `limit=2junk`, `months=1.5` and `months=2junk` are accepted. An extremely large page returns 500. |
| EXP-09 | Low | Required display names can contain only spaces | Whitespace expense title and category name return 201. |
| EXP-10 | Medium | Monthly trend does not follow the phone timezone | An expense entered as `2026-10-01T01:00:00+06:00` increases September's UTC bucket. Supplying `timezone=Asia/Dhaka` returns 400. The API currently documents UTC buckets; this fails the client's Q0.4 requirement rather than its existing UTC contract. |

## Additional code-confirmed requirement gap

**EXP-11 — Courier costs do not feed Expenses Shipping totals/trends.** Client Q9.2 says to use courier API costs. `ExpensesService.summary()`/`trend()` read the Expense ledger and ad metrics; there is no courier-cost aggregate or automatic Shipping expense producer. Order financial events contain shipping costs separately. Manual SHIPPING entries being accepted is not proof of a courier integration.

The four retained live order financial summaries all reported shipping cost `0.00`. No nonzero courier bill was available to prove a missing amount in this live account. **Do not describe a positive courier-fee integration as live verified.** No courier status or provider fee was fabricated on production.

## Actual selected responses

### Receipt replacement

PATCH `/expenses/<synthetic-expense-id>` with a newly uploaded valid receipt:

```json
{ "statusCode": 500, "message": "Internal server error" }
```

### Receipt replay

```json
{
  "statusCode": 400,
  "message": "Receipt not found, already used, or expired. Upload it again."
}
```

### Small positive amount

POST amount `0.00001` returned HTTP 201 with:

```json
{ "amount": "0.00" }
```

### Phone timezone

The local October boundary increased September from `8.88` to `9.38`; the timezone query returned HTTP 400:

```json
{ "message": ["property timezone should not exist"] }
```

## Passing live coverage

- Empty list/summary/ad-spend state, five summary groups, zero-filled chart, both CASH/BANK methods, detail response and decimal addition for ordinary amounts.
- Create/edit/delete manual expenses; clear nullable notes; search case-insensitively; category/group filters; page totals; empty search and out-of-range empty page.
- Expense edits and deletion update totals. Home includes manual operating expenses and deducts them from profit.
- Date-only filters include both midnight and the final millisecond, exclude the next day and agree between list and summary. Offset timestamp intervals select the same UTC interval. Reversed ranges return 400. Two-month trend matches fixture sums.
- Exact duplicate category names and concurrent duplicate category creation return 409. Category rename/icon/color updates persist. In-use and system categories cannot be deleted. Custom categories cannot be assigned system groups.
- Zero/negative/non-numeric amounts, unknown enums/fields/UUIDs, excess ordinary field lengths and malformed URLs are rejected. Unknown items return 404. Invalid supported-route UUIDs return 400.
- Real private PNG receipt upload and byte-for-byte preview work. Uploaded receipt takes precedence over external URL. An invalid replacement preserves metadata and the previous image. Consumed receipts cannot be attached to another expense; simultaneous consumption creates one expense and rejects the other.
- Missing/corrupt/PDF receipts return 400; files above 5 MiB return 413. Deleting an expense removes its attached receipt content.
- Real Purchases APIs create a linked read-only expense, update it when purchase price changes and remove it when the purchase is deleted. Stock/expense totals return to their previous values.
- Synthetic paid salary records create linked SALARY expenses. BANK_TRANSFER maps to BANK. Pending manual salaries create no expense until recorded. Concurrent record-expense calls create one linked expense, with total `11.25` for the two test salaries. Salary-generated expenses reject direct changes/deletion. A salary-linked private receipt is readable.
- Home expenses and profit change exactly once for confirmed salary costs. A bonus can be entered under OTHER without claiming it is salary-generated. No actual money transfer was performed.
- Expense viewers can read lists, details, chart, summary, ad breakdown and receipt, but cannot create/edit/delete expenses/categories or upload receipts. Cross-store expense/category/image access is denied; foreign categories/receipts cannot be attached. Missing-token requests return 401.

## Limits and unverified acceptance

- All live calls above hit production, not a local API. The 66 unit tests are separate local evidence.
- The live ad account count was zero and spend was `0.00`. Nonzero ad spend, FX conversion/missing-rate behavior, disconnected-account historical spend, and real ad-provider errors were not exercised live. Existing unit tests cover the aggregation logic with controlled fixtures.
- Actual 24-hour receipt expiry was not exercised by waiting a day or changing production timestamps. Fake expired assets were not inserted into production.
- Concurrent receipt consumption was tested; concurrent replacement remains blocked by EXP-01. No assertion is made that every possible network/database interleaving has been exhausted.
- No real courier charge, mobile UI/camera, push receipt, or bank transfer is claimed as part of this API audit.

## Harness corrections

One early probe used a nonexistent GET category-detail route; its 404 was correct, and the documented PATCH route was subsequently tested and returned 400 for an invalid UUID. A purchase probe initially omitted the item's configured supplier list; the rejection was correct, the fixture was corrected, and the valid integration passed. Both corrections are annotated in the JSON evidence and excluded from product findings.

## Cleanup

Temporary store, expenses, categories, purchases, packaging and salary records were deleted. Two remaining synthetic receipt objects were removed from that temporary store's cloud prefix. Disposable staff was deactivated and scheduled for account deletion. **Original owner account, store list, expense ledger/summary, Purchases and Home counts were preserved.**

## Suggested fix order

1. Receipt replacement/replay, money validation and required-field null validation.
2. Source-group protection and durable manual-expense idempotency.
3. Strict date/query/name validation and inclusive timestamp behavior.
4. Phone-timezone chart alignment and courier-cost aggregation without duplicating order-ledger profit costs.

Fixes should be followed by another deployed live retest. This report is an audit, not a fix signoff.
