# Ameex Postman testing

Set these Postman variables:

```text
baseUrl = http://localhost:3000
access_token = a valid Zomaal access token
```

Use `Authorization: Bearer {{access_token}}` for every endpoint except the
public webhook.

Apply the database migration first:

```bash
npx prisma migrate deploy
npx prisma generate
```

## 1. Connect and validate credentials

```http
POST {{baseUrl}}/shipping/ameex/connection
Content-Type: application/json
```

```json
{
  "apiId": "YOUR_AMEEX_API_ID",
  "apiKey": "YOUR_AMEEX_API_KEY"
}
```

Expected result:

```json
{
  "connected": true,
  "provider": "ameex.ma",
  "connectedAt": "2026-08-15T00:00:00.000Z",
  "message": "Ameex account is connected"
}
```

Credentials are validated through Ameex's read-only parcel-status endpoint and
then encrypted per user. They are never returned.

## 2. Verify the provider status list

```http
GET {{baseUrl}}/shipping/ameex/statuses
```

## 3. Create a test parcel

The published Ameex collection requires a city ID but does not include a cities
endpoint. Obtain a valid city ID from the Ameex dashboard or support.

```http
POST {{baseUrl}}/shipping/ameex/parcels
Content-Type: application/json
```

```json
{
  "type": "SIMPLE",
  "orderNumber": "ZM-AM-TEST-001",
  "replace": false,
  "open": "YES",
  "try": "YES",
  "fragile": 0,
  "receiver": "Ameex Test Recipient",
  "phone": "0612345678",
  "city": "VALID_AMEEX_CITY_ID",
  "address": "Test address",
  "comment": "Test parcel - do not dispatch",
  "product": "Test product",
  "cod": 100
}
```

On success, the tracking code from Ameex is automatically stored locally.

## 4. Test details, tracking, and local APIs

Replace `AMEEX_CODE` with the returned tracking code.

```http
GET  {{baseUrl}}/shipping/ameex/provider/parcels/AMEEX_CODE
GET  {{baseUrl}}/shipping/ameex/provider/parcels/AMEEX_CODE/tracking
POST {{baseUrl}}/shipping/ameex/shipments/AMEEX_CODE/refresh
GET  {{baseUrl}}/shipping/ameex/shipments/AMEEX_CODE
GET  {{baseUrl}}/shipping/ameex/shipments/AMEEX_CODE/timeline
```

## 5. List, filter, sync, and overview

```http
GET  {{baseUrl}}/shipping/ameex/shipments?page=1&limit=20
GET  {{baseUrl}}/shipping/ameex/shipments?search=ZM-AM&status=PENDING&page=1&limit=20
POST {{baseUrl}}/shipping/ameex/shipments/sync?limit=20&importPageSize=100&maxImportPages=10
GET  {{baseUrl}}/shipping/ameex/overview?days=7
GET  {{baseUrl}}/shipping/integrations
GET  {{baseUrl}}/shipping/home?days=7
```

The Sync Now request has no body. It first imports remote Ameex parcel-list
pages, then uses Ameex Mass Tracking for up to 25 active local shipments.
Delivered, cancelled, returned-to-stock, and returned-to-seller shipments are
skipped by tracking sync. `importPageSize` and `maxImportPages` are safety
bounds for one manual request; no cron job is required.

The remote list request includes a broad creation-date range because Ameex's
published parcel-list form documents date filters. If a mass-tracking response
does not identify a requested parcel, Zomaal automatically falls back to the
single-parcel tracking endpoint. The response reports how many such calls were
made in `trackingFallbacks`.

## 6. Configure and test the webhook

After deploying this version, enter this production URL in the Ameex webhook
field:

```text
https://zomaal-backend-828793303867.us-central1.run.app/shipping/ameex/webhook
```

Ameex only sends webhook updates for parcels created through its API. The
published contract does not define a signature or shared secret, so Zomaal only
accepts updates for tracking codes already stored locally.

Local form-urlencoded test:

```http
POST {{baseUrl}}/shipping/ameex/webhook
Content-Type: application/x-www-form-urlencoded
```

```text
CODE=AMEEX_CODE
STATUT=DELIVERED
COMMENT=Webhook test
STATUT_NAME=Livré
STATUT_COLOR=#24d651
```

Expected result:

```json
{
  "received": true,
  "matchedShipments": 1
}
```

Sending the same status payload again is safe: its timeline event is upserted
idempotently instead of duplicated.
