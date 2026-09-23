# Returns module — scope, client mapping, and work plan

**Branch:** `update/order-return`  
**Related (shared spine, other modules):** [`product-shipping-tracking-architecture.md`](./product-shipping-tracking-architecture.md)  
**Safety:** [`no-dummy-static-data.md`](./no-dummy-static-data.md) · Figma placeholders are layout-only (see `.cursor/rules/figma-placeholders-not-data.mdc`)

---

## What this module owns

Warehouse-facing **inbound** flow when a parcel comes back (or must be verified):

1. List returns + summary cards + filters (All / Need verification / Delayed)
2. Scan **shipping barcode** (or enter order id manually) → resolve **order** → show products + customer
3. Set line **condition** (Good / Damaged / Lost / Returned / Missing) + optional damage cost
4. Persist open `ReturnRequest`, advance to PROCESSED when every line has a condition
5. Live **loss preview** (original order value, delivery cost, net loss)

It does **not** own: generating product codes, creating packs, creating outbound shipments, or recognizing Delivered revenue. Those live in the shared architecture doc.

---

## Client brief — parts that apply *here*

| Client idea | Returns usage |
|---|---|
| Scan shipping company barcode | `POST /ecommerce/returns/detect` (same resolve path as `GET /ecommerce/scan`) |
| Tracking → Order → Product(s) | Detect resolves tracking/QR/order ref → order lines (product codes + titles) |
| Do not rely on product code alone | Correct: same `DH564BJ0` on many orders; scan keys off **shipment → order** |
| Condition Good / Damaged / Lost / Returned / Missing | `POST /ecommerce/returns/:id/verify` → `recordProductConditionByLineId` |
| Damage cost + return/loss costs | `damageCost` on verify; `lossSummary` on detect/verify |
| Manual fallback | Search by order id/name; name/phone only for **manual** orders (no invented PII) |
| Pack on ticket (`PK82LQ7`) | Shared scan already expands pack → components; returns verify still per order line |

Ignore Figma demo numbers/names/IDs. Empty/`null` when real data is missing is correct.

---

## Current API surface

| Method | Path | Screen |
|---|---|---|
| `GET` | `/ecommerce/returns` | Returns list + summary |
| `GET` | `/ecommerce/returns/search?q=` | Manual verification search |
| `POST` | `/ecommerce/returns/detect` | Scan / manual → Return Detected |
| `POST` | `/ecommerce/returns/:returnRequestId/verify` | Confirm conditions |
| `GET` | `/ecommerce/scan` | Shared shipping-barcode resolve (also used by detect) |
| `GET` | `/ecommerce/returns/summary` | Bucket metrics (received / pending / damaged / missing) |

Statuses: stored `NEED_VERIFICATION` \| `PROCESSED`. UI **DELAYED** = need-verification older than **2 days** (computed on read).

---

## What we already built (on this branch)

- Phase 1 (`f422aef`): line conditions, financial events, manual orders, scan resolve, inventory on condition
- Phase 2 (`06fb032`): `ReturnRequest` / lines, list/search/detect/verify, race-safe open return, loss preview
- Migrations: `ReturnRequest` + partial unique open-return index

---

## Gaps for this module (industry, not Figma parity)

1. Detect response should include stored **`reason`** (accepted on verify today)
2. **`imageUrl`** only when warehouse/platform image exists — never fake
3. Optional **`currency`** on list summary (or document FE uses store `baseCurrency`)
4. Unblock **local compile** on this branch so we can demo without Cloud Run only
5. Dedicated **unit tests** for detect/verify/list filters/idempotency
6. Showcase needs **real** orders + tracking links (sync or manual) — not seeded fake returns

Port from `main` only if needed on this branch: return → customer risk hook (`recordReturnRisk`). Do not switch to `main` to finish work.

---

## Work plan (stay on `update/order-return`)

### Step 0 — Sync + baseline
- [x] **Pull latest `main` into this branch before coding** (`git fetch origin` then `git merge origin/main` on the feature branch; resolve conflicts here — do not move day-to-day work onto `main`)
- [x] Confirm branch + Prisma migrations applied locally
- [x] Fix compile blockers so `npm run start:dev` runs on this branch
- [x] Login + `GET /ecommerce/returns` returns empty shape (OK) or real rows

### Step 1 — API completeness for Return Detected
- [x] Add `reason: string | null` to detect response from `ReturnRequest.reason`
- [x] Resolve `imageUrl` from linked warehouse variant/media when present
- [x] Add `currency` on list/summary from store `baseCurrency` (preferred) **or** document FE contract

### Step 2 — Showcase path (real data only)
- [x] Ensure store has ≥1 **manual or synced** order with lines linked to `productCode` (verified with real Lightfunnels/YouCan orders; demo manual seeds removed from local DB)
- [ ] Ensure order has a **shipping tracking** (dispatch `providerTracking` or event metadata `number`)
- [x] `POST .../detect` with order id → inspect products + lossSummary
- [x] `POST .../verify` with condition + optional damageCost → list cards update
- [ ] Optional: one old open return for Delayed tab (>2 days)

### Step 3 — Hardening
- [x] Unit tests: list currency, detect reason/imageUrl, verify loss summary
- [ ] Swagger/OpenAPI notes for manual search PII limitation
- [x] Pre-commit: no-dummy + secrets scan ([`no-dummy-static-data.md`](./no-dummy-static-data.md)); removed local demo returns/manual orders/customers from API testing

### Step 4 — Merge readiness
- [ ] Diff review vs client Returns scope only
- [ ] Human opens PR / merges when ready (no drive-by work on `main`)

---

## Explicit non-goals on this branch

- Generating product / pack codes (Warehouse)
- Creating courier shipments / webhooks for Delivered revenue (Shipping + financials)
- Building WhatsApp order intake UI (Manual orders — architecture doc)
- Matching Figma placeholder catalog/metrics
