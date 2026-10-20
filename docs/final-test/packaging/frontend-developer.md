# Frontend Developer Guide — Packaging

Updated 20 October 2026.

## References

- Figma: [Packaging list and setup (Figma section 1:11814)](https://www.figma.com/design/6g6gVrZZovSVOOfRB9vPGw/zomal-copy?node-id=0-1).
- [Module requirements](../../module-context/06-packaging.md).
- [OpenAPI contract](../../api/openapi.yaml).

## Backend status

Live audit completed on revision `zomaal-backend-00062-gmt` (`54e1048`). **Five findings remain open; final signoff is blocked.** Stock/threshold/usage APIs work, but image retries, integer limits, blank movement reasons and notification scheduling need fixes. Owner WhatsApp stock alerts are not wired. See [live audit](./live-server-test-results-2026-10-20.md).

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

## Integration handoff after live audit

- Send openingStock on create; use PUT /warehouse/inventory/items/:id/stock for later absolute quantities. Reuse the same idempotency key only for retrying the same stock operation.
- Stock and threshold values are integers for all four units. Display available separately from onHand when reservations/damage matter.
- Send imageUploadId only when choosing a new upload, and null to remove it. Repeating the same successful replacement currently returns 400; preserve form state and reload the material before retrying.
- Reject blank stock reasons in the UI; the backend currently accepts whitespace and stores an empty reason. Backend validation still needs fixing.
- Handle current overflow 500 responses without claiming a stock change succeeded; the audit confirmed those failed transactions leave stock unchanged. Server-side 400 bounds are still required.
- Display stockStatus from the API. LOW_STOCK does not currently mean a notification was delivered: the live evaluator is disabled. Do not report the WhatsApp toggle as a confirmed send.
- Supplier names from the Purchases rollout are available on packaging create/edit/read; existing purchase snapshots remain independent.

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
