# Frontend Developer Guide — Packaging

## Handoff status — 22 October 2026

Fix `b1ee535` passed 208/208 production observations. Image retries, integer bounds, trimmed stock reasons and scheduled in-app inventory alerts are fixed. The owner WhatsApp outbox is implemented; actual receipt is still blocked by client Meta configuration and an approved inventory template.

[Verification evidence](./fix-verification-2026-10-20.md) · [Cross-module status and API gaps](../CURRENT-STATUS.md) · [Production API contract](../openapi.production.json).

This refresh consolidates recorded work; it does not claim a new full regression run. Unchecked UI/QA checklists remain acceptance work. Revision names below identify the version tested at that time.

Updated 22 October 2026 (documentation reconciliation; original test dates are retained).

## References

- Figma: [Packaging list and setup (Figma section 1:11814)](https://www.figma.com/design/6g6gVrZZovSVOOfRB9vPGw/zomal-copy?node-id=0-1).
- [Module requirements](../../module-context/06-packaging.md).
- [OpenAPI contract](../openapi.production.json).

## Main flow

Create packaging; set unit/minimum level; link products; restock; verify order consumption and low-stock states.

## Integration requirements

Use the routes and exact schemas in OpenAPI. Handle loading, empty, success, validation, permission, disconnected-provider, provider-error, and retry states. Preserve null/unconverted amounts as unknown; use store currency and API precision. Figma names, phone numbers, prices, and metrics are placeholders. Do not fabricate production-looking data. Where an approved client dependency is temporary static configuration, add an adjacent code comment identifying it as temporary and naming its source/assumption.

## Completion checklist

- [ ] In-scope Figma screens and states use API data.
- [ ] Request fields, enums, permissions, and store scoping match OpenAPI.
- [ ] Empty, loading, error, retry, access-denied, and disconnected states are covered.
- [ ] No real-looking catalog, metrics, or order data is hardcoded.
- [ ] Keep TikTok/Snapchat, Reports, and gateway-dependent checkout out of this pass.


## Client answers confirmed

- Consume packaging per delivered product unit: 3 products use 3 boxes. Show the configured quantity per unit; the Figma “per order” caption is not the client rule.
- Packaging cost reduces profit. Current backend uses the last paid price; average versus last cost is not expressly settled by the client answer.
- Owner WhatsApp and in-app alerts are required. The current toggle does not prove either notification has been sent.
- Delivered Zomaal Shop purchases should increase packaging stock automatically.

## Current integration handoff

- Send `openingStock` on create. Later absolute stock uses `PUT /warehouse/inventory/items/:id/stock`; reuse an idempotency key only for the identical operation.
- Quantities/thresholds are integers. Separate available, on-hand, reserved and damaged stock.
- Replaying the current `imageUploadId` succeeds. Null removes the image; invalid/consumed replacement preserves the existing material.
- Trim stock reasons to 3–500 characters. Input/result overflow returns 400 with unchanged stock/journal.
- In-app notifications run through the enabled protected five-minute evaluator. `stockStatus` alone does not establish WhatsApp or handset delivery.
- Supplier names are available on material create/edit/read; purchase snapshots stay independent.

## Fix contract — 20 October 2026

- Replaying the current `imageUploadId` succeeds without deleting the current image. A different, consumed upload still fails validation.
- Inventory quantities are signed 32-bit integers; final buckets must be between 0 and 2,147,483,647. Input overflow and computed overflow return 400 with no stock or journal mutation.
- Stock reasons are trimmed before validation and must contain 3–500 characters after trimming.
- `POST /notifications/evaluate` (owner only) refreshes notifications for the active store. Normal refresh also runs every five minutes when the protected scheduler is configured.
- `GET /notifications` includes nullable `ownerWhatsApp: { status, lastErrorCode, sentAt }`. Statuses: PENDING, SENDING, BLOCKED, SENT, FAILED, CANCELLED, UNKNOWN. SENT means Meta accepted the message, not proof of handset receipt.
- BLOCKED means a dependency is missing; show its reason rather than a success toast. UNKNOWN requires operator review before any resend. Unchanged low-stock conditions do not create duplicate owner messages; a resolved condition followed by a new low-stock cycle creates a new notification.
- Owner alerts use the owner's account phone and the store's active WhatsApp connection. They use a separate outbox and do not debit the customer-message wallet. Client confirmation of owner-alert billing remains pending.

### Client Meta dependency

Real owner WhatsApp delivery still needs the client's working Meta app/connection, encrypted token and an approved inventory template. Configure `PACKAGING_OWNER_WHATSAPP_TEMPLATE` and language (default `fr`). Body parameters in order: material name, available stock, minimum level, unit. The backend checks actual Meta approval; it does not substitute static success or a fabricated template name.


## Deployed live retest

`b1ee535` / `zomaal-backend-00063-qdf`: **208/208 production observations passed**. [Verification and actual responses](./fix-verification-2026-10-20.md). PKG-01/02/03/05 are closed; PKG-04 backend path is implemented and reports BLOCKED / WHATSAPP_DISABLED until client Meta/template prerequisites are met. Original QA account retained; synthetic test data/images cleaned.
