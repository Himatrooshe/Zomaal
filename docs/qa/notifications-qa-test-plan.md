# Notifications API — manual QA test plan

Branch: `feature/notifications` · Module doc: `docs/module-context/16-notifications.md`
Swagger: `{{BASE_URL}}/docs` (tag **Notifications**) · OpenAPI file: `docs/api/openapi.yaml`

## 1. Setup

| Variable | Value |
|---|---|
| `{{BASE_URL}}` | API base URL of the environment under test (staging / local) |
| `{{OWNER_TOKEN}}` | `accessToken` of a store **owner** (from `POST /auth/verify-otp`) |
| `{{STAFF_TOKEN}}` | `accessToken` of a **staff** member of the same store who has **only** `products.view` |
| `{{SCHEDULER_SECRET}}` | Ask the backend developer. Never paste it into tickets or chat. |

Common headers for every `/notifications` call:

```
Authorization: Bearer {{OWNER_TOKEN}}
Content-Type: application/json
```

Use a **dedicated test store**, not a real merchant store.

### How alerts get created

Notifications are produced by the system; there is no "create notification" endpoint.

- **Instant:** "Blacklisted customer placed an order" is created as soon as the order arrives.
- **Scheduled:** all other alerts are created when the scheduler endpoint runs (§3.7). In
  staging/production Cloud Scheduler calls it automatically; during QA, trigger it manually after
  setting up a condition.

Each alert fires **once** while its problem lasts. When the problem goes away (stock refilled,
salary paid, …) the next run marks it resolved (`resolvedAt` set). If the problem comes back, a
**new** alert is created.

## 2. Alert catalogue

| `type` | `severity` | `category` | Tab(s) | Created when | Visible to |
|---|---|---|---|---|---|
| `LOW_STOCK` | WARNING | INVENTORY | All, Warning, Inventory | Variant available stock is > 0 and ≤ its low-stock threshold | Owner + staff with `products.view` |
| `OUT_OF_STOCK` | CRITICAL | INVENTORY | All, Critical, Inventory | Variant available stock ≤ 0 | Owner + staff with `products.view` |
| `BLACKLISTED_CUSTOMER_ORDER` | CRITICAL | CUSTOMERS | All, Critical | New order from a blacklisted customer (Blacklist setting "Warn on new order" ON) | Owner + staff with `customers.view` |
| `SALES_DROP` | WARNING | SALES | All, Warning | Net sales of the last 7 days are ≥ 30% below the 7 days before; the earlier week needs ≥ 5 paid orders | Owner + staff with `analytics.view` |
| `SALARY_OVERDUE` | WARNING | STAFF | All, Warning | A salary payment is still PENDING after its due date | Owner only |
| `PLATFORM_DISCONNECTED` | CRITICAL | INTEGRATIONS | All, Critical | Shopify / YouCan / Lightfunnels connection is disconnected or needs re-authorization | Owner only |
| `PLATFORM_SYNC_FAILED` | WARNING | INTEGRATIONS | All, Warning | Active platform connection's last sync failed | Owner only |
| `COURIER_SYNC_FAILED` | WARNING | INTEGRATIONS | All, Warning | QuickLivraison / ForceLog / OzoneExpress / Ameex last sync failed | Owner only |

Available stock = on hand − reserved − damaged (same number as the product list's stock badge).

## 3. Endpoints

### 3.1 List notifications

`GET {{BASE_URL}}/notifications`

| Query param | Type | Default | Notes |
|---|---|---|---|
| `tab` | `ALL` \| `CRITICAL` \| `WARNING` \| `INVENTORY` | `ALL` | |
| `unreadOnly` | `true` \| `false` | `false` | Unread for the **calling user** |
| `page` | integer ≥ 1 | `1` | |
| `limit` | integer 1–100 | `20` | |

**200 OK**

```json
{
  "items": [
    {
      "id": "uuid",
      "type": "LOW_STOCK",
      "severity": "WARNING",
      "category": "INVENTORY",
      "title": "<product name> is running low",
      "message": "3 items left",
      "entityType": "WAREHOUSE_VARIANT",
      "entityId": "uuid-of-variant",
      "metadata": { "productId": "uuid", "available": 3, "threshold": 5 },
      "resolvedAt": null,
      "isRead": false,
      "readAt": null,
      "createdAt": "2026-10-05T13:40:42.275Z"
    }
  ],
  "unreadCount": 8,
  "pagination": { "total": 8, "page": 1, "limit": 20, "totalPages": 1 }
}
```

- `items` are newest first.
- `unreadCount` is unread across **all** tabs for the calling user (not just this page or tab).
- `entityType` / `entityId` tell the app where to navigate:

| `entityType` | `entityId` is | Types |
|---|---|---|
| `WAREHOUSE_VARIANT` | variant id | LOW_STOCK, OUT_OF_STOCK |
| `ECOMMERCE_ORDER` | order id | BLACKLISTED_CUSTOMER_ORDER |
| `STAFF_SALARY_PAYMENT` | salary payment id | SALARY_OVERDUE |
| `ECOMMERCE_CONNECTION` | connection id | PLATFORM_DISCONNECTED, PLATFORM_SYNC_FAILED |
| `SHIPPING_PROVIDER` | courier code, e.g. `QUICKLIVRAISON` | COURIER_SYNC_FAILED |
| `null` | `null` | SALES_DROP |

`metadata` per type:

| Type | `metadata` |
|---|---|
| LOW_STOCK / OUT_OF_STOCK | `{ productId, available, threshold }` |
| BLACKLISTED_CUSTOMER_ORDER | `{ customerId }` |
| SALES_DROP | `{ currency, currentNetSales, previousNetSales, changePercent }`, amounts as strings with 2 decimals, e.g. `"600.00"`, `"-83.3"` |
| SALARY_OVERDUE | `{ staffMemberId, amount, paymentDate }` |
| PLATFORM_* | `{ platform, status }` |
| COURIER_SYNC_FAILED | `{ provider }` |

**Errors**

| Case | Status | Body (`message`) |
|---|---|---|
| No / invalid token | 401 | `Unauthorized` |
| `tab=FOO` | 400 | `["tab must be one of the following values: ALL, CRITICAL, WARNING, INVENTORY"]` |
| `limit=101` | 400 | `["limit must not be greater than 100"]` |
| Deactivated staff account | 403 | `This staff account has been deactivated` |

### 3.2 Unread badge counts

`GET {{BASE_URL}}/notifications/unread-count`

**200 OK**

```json
{ "all": 8, "critical": 3, "warning": 5, "inventory": 2 }
```

Counts follow the same visibility rules as the list (staff only count what they can see).

### 3.3 Mark one as read

`POST {{BASE_URL}}/notifications/{notificationId}/read` (no body)

| Case | Status |
|---|---|
| Success (also when already read) | **204 No Content**, empty body |
| `notificationId` not a UUID | 400 `Validation failed (uuid is expected)` |
| Unknown id, another store's id, or a notification this user can't see | 404 `Notification not found` |

Read state is **per user**: the owner reading an alert does not mark it read for staff, and the reverse.

### 3.4 Mark all as read

`POST {{BASE_URL}}/notifications/read-all`

Body (optional):

```json
{ "tab": "WARNING" }
```

Omit `tab` or send `{}` to mark everything visible as read.

**200 OK**

```json
{ "marked": 5 }
```

`marked` = how many were newly marked read (0 if nothing was unread). Invalid `tab` → 400.

### 3.5 Register device for push

`PUT {{BASE_URL}}/notifications/devices`

```json
{ "token": "<FCM registration token from the app>", "platform": "ANDROID" }
```

- `platform`: `IOS` | `ANDROID` | `WEB`
- `token`: letters, digits, `:`, `_`, `-` only, max 4096 characters

| Case | Status |
|---|---|
| Success (also re-registering the same token) | **204** |
| Bad `platform` | 400 `["platform must be one of the following values: IOS, ANDROID, WEB"]` |
| Token with spaces / symbols | 400 `["token is not a valid FCM token"]` |

If a different user registers the same token (e.g. logs in on the same phone), the device moves to
that user.

### 3.6 Unregister device (logout)

`DELETE {{BASE_URL}}/notifications/devices/{token}` → **204** always. It only removes the token if it
belongs to the caller.

### 3.7 Run the evaluator (internal, QA trigger)

`POST {{BASE_URL}}/internal/notifications/run`

```
x-zomaal-scheduler-secret: {{SCHEDULER_SECRET}}
```

(no `Authorization` header, no body)

**200 OK**

```json
{ "stores": 3, "failedStores": 0, "raised": 7, "resolved": 0 }
```

| Case | Status |
|---|---|
| Missing or wrong secret | 401 `Invalid scheduler credentials` |
| Scheduler disabled on the environment | 503 `Scheduled notification evaluation is not enabled` |

This endpoint is intentionally **not** in Swagger.

## 4. Setting up each condition (test store)

| Alert | How to create it | How to clear it |
|---|---|---|
| LOW_STOCK | Product with low-stock alert threshold 5 → `PUT /warehouse/inventory/items/{inventoryItemId}/stock` with `{"quantity": 3, "reason": "QA low stock", "idempotencyKey": "qa-low-0001"}` → run evaluator | Set quantity to 20 → run evaluator |
| OUT_OF_STOCK | Same, `quantity: 0` → run evaluator | Set quantity above 0 |
| BLACKLISTED_CUSTOMER_ORDER | `POST /ecommerce/orders/manual` for a test phone → `POST /customers/{customerId}/blacklist` → create a **second** manual order for the same phone. Alert appears immediately, no evaluator needed. | One-off alert; never resolves |
| SALARY_OVERDUE | `POST /staff/salary/payments` with `status: "PENDING"` and `paymentDate` 3 days ago → run evaluator | `POST /staff/salary/payments/{paymentId}/pay` → run evaluator |
| PLATFORM_DISCONNECTED | Disconnect a test Shopify/YouCan/Lightfunnels connection → run evaluator | Reconnect → run evaluator |
| PLATFORM_SYNC_FAILED | Needs a failing sync (e.g. revoked token on the platform side). Ask backend if hard to reproduce. | Next successful sync → run evaluator |
| COURIER_SYNC_FAILED | Connect a courier with an invalid/expired API key and trigger sync | Fix key, sync, run evaluator |
| SALES_DROP | Needs 2 weeks of real paid orders. Ask backend to prepare data on staging. | Sales recover → run evaluator |

## 5. Test cases

### Listing & tabs

| # | Steps | Expected |
|---|---|---|
| L1 | New store, no alerts: `GET /notifications` | 200, `items: []`, `unreadCount: 0`, `pagination.total: 0` |
| L2 | `GET /notifications/unread-count` on empty store | `{all:0, critical:0, warning:0, inventory:0}` |
| L3 | Create LOW_STOCK + OUT_OF_STOCK + blacklisted order + overdue salary, run evaluator, list ALL | All 4 present, newest first |
| L4 | `tab=CRITICAL` | Only `severity: CRITICAL` (OUT_OF_STOCK, BLACKLISTED_CUSTOMER_ORDER, PLATFORM_DISCONNECTED) |
| L5 | `tab=WARNING` | Only `severity: WARNING` |
| L6 | `tab=INVENTORY` | Only LOW_STOCK / OUT_OF_STOCK |
| L7 | `page=2&limit=3` with 8 alerts | 3 items, `totalPages: 3` |
| L8 | `unreadOnly=true` after reading one | That one is excluded |
| L9 | No `Authorization` header | 401 |
| L10 | `tab=FOO`, `limit=0`, `limit=101`, `page=0` | 400 each |

### Read state

| # | Steps | Expected |
|---|---|---|
| R1 | Owner `POST /notifications/{id}/read` | 204; item now `isRead: true`, `readAt` set; `unread-count` decreases by 1 |
| R2 | Repeat R1 | 204 again, counts unchanged |
| R3 | After owner reads, staff lists the same alert | Still `isRead: false` for staff |
| R4 | `POST /notifications/read-all` `{"tab":"WARNING"}` | `marked` = unread warnings; `unread-count.warning` = 0, critical unchanged |
| R5 | `POST /notifications/read-all` `{}` | All counts 0 |
| R6 | Read-all again | `{ "marked": 0 }` |
| R7 | Read with id `not-a-uuid` | 400 |
| R8 | Read with random valid UUID | 404 |
| R9 | Owner of **store B** reads a store-A notification id | 404 |

### Staff visibility

| # | Steps | Expected |
|---|---|---|
| S1 | Staff with only `products.view` lists ALL | Only LOW_STOCK / OUT_OF_STOCK |
| S2 | Same staff `unread-count` | Counts only those |
| S3 | Staff marks a SALARY_OVERDUE id as read (id taken from owner's list) | 404 |
| S4 | Give staff `customers.view` | BLACKLISTED_CUSTOMER_ORDER becomes visible |
| S5 | Give staff `analytics.view` | SALES_DROP becomes visible |
| S6 | Any staff permissions | SALARY_OVERDUE, PLATFORM_*, COURIER_* never visible |
| S7 | Deactivate staff, call `GET /notifications` with their token | 403 |

### Lifecycle (dedupe / resolve / re-fire)

| # | Steps | Expected |
|---|---|---|
| C1 | Run evaluator twice without changes | Second response `raised: 0`; no duplicate rows in the list |
| C2 | LOW_STOCK active → set stock to 20 → run | `resolved` ≥ 1; alert stays in list with `resolvedAt` set |
| C3 | After C2, set stock to 1 → run | **New** LOW_STOCK row, message `1 item left`, unread |
| C4 | OUT_OF_STOCK active → set stock to 2 → run | OUT_OF_STOCK resolved **and** a new LOW_STOCK raised |
| C5 | SALARY_OVERDUE active → pay salary → run | Alert gets `resolvedAt` |
| C6 | Blacklisted customer places a 3rd order | Another alert for the new order (one per order) |
| C7 | Blacklist setting "Warn on new order" OFF, blacklisted customer orders | No alert |
| C8 | Item 1 left | Message `1 item left` (singular); 3 left → `3 items left` |

### Push devices

| # | Steps | Expected |
|---|---|---|
| P1 | `PUT /notifications/devices` valid body | 204 |
| P2 | Same token again with another platform | 204 (updated, not duplicated) |
| P3 | `platform: "BLACKBERRY"` | 400 |
| P4 | `token: "bad token!"` | 400 |
| P5 | Missing body fields | 400 |
| P6 | `DELETE /notifications/devices/{token}` | 204 |
| P7 | With push enabled on the environment and a real device registered: trigger LOW_STOCK | Phone receives push with the alert title and message. Tapping it opens the item via `data.entityType` / `data.entityId`. |
| P8 | Staff with `products.view` registered on a device, trigger LOW_STOCK | Staff device receives push; staff **without** `products.view` does not |
| P9 | Trigger SALARY_OVERDUE | Only the owner's device receives push |

Push payload `data`: `notificationId`, `storeId`, `type`, `entityType`, `entityId` (the last two
only when present). P7–P9 need `PUSH_NOTIFICATIONS_ENABLED=true` and `FCM_PROJECT_ID` set on the
environment.

### Scheduler endpoint

| # | Steps | Expected |
|---|---|---|
| E1 | No `x-zomaal-scheduler-secret` header | 401 |
| E2 | Wrong secret | 401 |
| E3 | Correct secret | 200 with `{stores, failedStores, raised, resolved}` |
| E4 | Sending a user Bearer token instead of the secret | 401 (user tokens don't work here) |

## 6. Known limits (not bugs)

- No packaging low-stock alert yet (packaging has no minimum-level field).
- No duplicate-order, overdue-customer-payment, trial-ending or WhatsApp-balance alerts yet.
- Sendit sync failures don't alert (Sendit doesn't store sync errors).
- Courier connections belong to the owner account, so a courier alert appears in **every** store
  that owner has.
- Raw provider error text is never shown in alerts. That is intentional.
