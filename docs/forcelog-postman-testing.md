# ForceLog — Postman testing

Environment variables:

```text
baseUrl=http://localhost:3000
access_token=<Zomaal access token>
forcelog_code=<tracking number returned by ForceLog>
```

Apply the ForceLog shipment migration before restarting the API:

```bash
npx prisma migrate deploy
npm run build
```

## 1. Connect ForceLog

```http
POST {{baseUrl}}/shipping/forcelog/connection
Authorization: Bearer {{access_token}}
Content-Type: application/json
```

```json
{
  "apiKey": "YOUR_FORCELOG_API_KEY"
}
```

## 2. Create and automatically store a parcel

```http
POST {{baseUrl}}/shipping/forcelog/parcels
Authorization: Bearer {{access_token}}
Content-Type: application/json
```

```json
{
  "ORDER_NUM": "ZM-FL-TEST-101",
  "RECEIVE": "ForceLog Test",
  "PHONE": "YOUR_MOROCCAN_TEST_PHONE",
  "CITY": "RBTVIL",
  "ADDRESS": "Test address, Rabat",
  "HOW": "Test parcel - do not dispatch",
  "PRODUCT_NATURE": "Test product",
  "COD": 100,
  "CAN_OPEN": true,
  "FRAGILE": false
}
```

Zomaal accepts `RECEIVE` and maps it to ForceLog's live `RECEIVER` input key.
Save `ADD-PARCEL.NEW-PARCEL.TRACKING_NUMBER` as `forcelog_code`.

## 3. Read local shipments

```http
GET {{baseUrl}}/shipping/forcelog/shipments?page=1&limit=20
Authorization: Bearer {{access_token}}
```

Filters:

```http
GET {{baseUrl}}/shipping/forcelog/shipments?search={{forcelog_code}}
GET {{baseUrl}}/shipping/forcelog/shipments?status=PENDING
GET {{baseUrl}}/shipping/forcelog/shipments?status=DELIVERED&page=1&limit=20
```

Get one local shipment:

```http
GET {{baseUrl}}/shipping/forcelog/shipments/{{forcelog_code}}
Authorization: Bearer {{access_token}}
```

## 4. Refresh or import one parcel

```http
POST {{baseUrl}}/shipping/forcelog/shipments/{{forcelog_code}}/refresh
Authorization: Bearer {{access_token}}
```

This calls ForceLog, then upserts the normalized local parcel. It also imports a
tracking code created outside Zomaal.

The existing provider-detail endpoint also reconciles the local record:

```http
GET {{baseUrl}}/shipping/forcelog/parcels/{{forcelog_code}}
Authorization: Bearer {{access_token}}
```

## 5. Timeline

```http
GET {{baseUrl}}/shipping/forcelog/shipments/{{forcelog_code}}/timeline
Authorization: Bearer {{access_token}}
```

ForceLog does not expose historical parcel events. Zomaal records the statuses
observed during creation and subsequent refreshes.

## 6. Refresh a batch

```http
POST {{baseUrl}}/shipping/forcelog/shipments/sync?limit=20
Authorization: Bearer {{access_token}}
```

ForceLog has no account-wide parcel-list endpoint. Batch sync refreshes only
tracking codes already known to Zomaal, up to 100 per request.

## 7. ForceLog overview

```http
GET {{baseUrl}}/shipping/forcelog/overview?days=7
Authorization: Bearer {{access_token}}
```

Supported periods are `7`, `30`, and `90` days. The response contains all-time
KPIs, status breakdown, performance trend, top cities, and sync health.

## 8. Shared shipping screens

```http
GET {{baseUrl}}/shipping/integrations
GET {{baseUrl}}/shipping/home?days=1
Authorization: Bearer {{access_token}}
```

ForceLog now contributes shipment counts, active shipments, stored delivery
fees, status cost cards, and the provider cost breakdown.
