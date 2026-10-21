# Orders — separate merchant-owner live isolation

Date: 21 October 2026. Environment: production Cloud Run, application `9d4e661`, revision `zomaal-backend-00070-94q`.

**Result: 114/114 recorded observations passed; zero failed. No new API defect found.** The count includes fixture setup, API assertions and cleanup checks, rather than 114 distinct scenarios.

## Method

Used two separately authenticated merchant users, each owning its own disposable store, product and manual order. The original merchant account was preserved. The second identity was created through the staff API, authenticated normally, then became an owner through the store API after its empty bootstrap store was deleted. Verified both stores' owner IDs matched their respective JWT subjects and differed from each other. No fabricated tokens or courier requests were used.

## Verified in both directions

- Own order details, products, timeline and financial reads: 200. Foreign equivalents: 404.
- Foreign fulfillment preview, shipping QR, financial synchronization and return-condition writes: 404.
- Lists and shared external-reference searches contain only the requesting owner's order. Foreign customer searches return no rows.
- Each full XLSX export contains its own single order; foreign-filter exports contain headers only.
- Foreign store selection, deletion and warehouse-product reads: 404. Failed switches preserve the active store.
- A foreign product code in a new manual order returns 400 and creates neither an order nor a customer.
- The same idempotency key creates separate orders for separate owners.
- Rejected condition changes preserve financial state and inventory. Undispatched stock remains 50, reserved stock remains zero.

## Cleanup

Both fixture stores, orders, products and image objects were removed. The temporary second owner was permanently deleted in a guarded database transaction scoped to its verified identity and sole QA store; normal store deletion forbids deleting an owner's final store. No schema changes or migrations were applied. The original owner's extra store and bootstrap store were removed through the API. Original active store, store list and Home order metrics matched their baselines. Temporary login credentials were removed from runner state.

A local cleanup transaction initially exceeded Prisma's default transaction-start wait; retrying with a longer connection wait succeeded. This was a test-runner cleanup issue, not an API failure.

## Remaining acceptance

- Real courier label/callback behavior and physical barcode scanning still need representative parcel/device tests. This run created no carrier parcel.
- The 10,001-row production export rejection boundary remains untested live; local guard coverage is documented separately.
- This run verifies backend responses, not Figma rendering or frontend/device behavior.

See [sanitized observations](./live-owner-isolation-results-2026-10-21.json), [staff access verification](./live-staff-access-2026-10-21.md), and [earlier full live confirmation](./live-confirmation-2026-10-21.md).
