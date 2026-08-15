# Sendit local Postman testing

## Setup

1. Configure `DATABASE_URL`, `JWT_SECRET`, Twilio credentials, and
   `SHIPPING_CREDENTIAL_ENCRYPTION_KEY` in `.env`.
   For local testing without Twilio, set `DEV_OTP_ENABLED=true` and
   `DEV_OTP_CODE=123456`. This mode is rejected when `NODE_ENV=production`.
2. Generate an encryption key once with `openssl rand -base64 32`. Keep the
   same key after credentials have been saved; changing it makes existing
   credentials unreadable.
3. Apply the database migration and start the API:

   ```bash
   npx prisma migrate deploy
   npm run start:dev
   ```

   Step 1 shipment persistence requires migration
   `20260813000000_add_sendit_shipment_foundation` to be applied before creating
   a Sendit delivery.

   If an existing development database was originally created with
   `prisma db push` and has no migration history, apply the new table once:

   ```bash
   npx prisma db execute --file prisma/migrations/20260714000000_add_sendit_connection/migration.sql
   ```

4. Open Swagger at `http://localhost:3001/docs` (or the configured `PORT`).

## Postman environment

Create these variables:

| Variable          | Example                      |
| ----------------- | ---------------------------- |
| `baseUrl`         | `http://localhost:3001`      |
| `accessToken`     | Set after OTP verification   |
| `phone`           | A valid E.164 phone number   |
| `senditPublicKey` | Customer's Sendit public key |
| `senditSecretKey` | Customer's Sendit secret key |

For every `/shipping` request, use Bearer Token `{{accessToken}}`.

## 1. Authenticate with Zomaal

Send OTP. In development OTP mode this does not contact Twilio:

```http
POST {{baseUrl}}/auth/send-otp
Content-Type: application/json

{
  "phone": "{{phone}}",
  "channel": "sms"
}
```

Verify the received OTP:

```http
POST {{baseUrl}}/auth/verify-otp
Content-Type: application/json

{
  "phone": "{{phone}}",
  "otp": "123456"
}
```

Copy `accessToken` from the response into the Postman environment.

## 2. Check initial connection status

```http
GET {{baseUrl}}/shipping/sendit/connection
Authorization: Bearer {{accessToken}}
```

An unconnected account returns HTTP 200 with `"connected": false`.

## 3. Connect Sendit

```http
POST {{baseUrl}}/shipping/sendit/connection
Authorization: Bearer {{accessToken}}
Content-Type: application/json

{
  "public_key": "{{senditPublicKey}}",
  "secret_key": "{{senditSecretKey}}"
}
```

Valid credentials return HTTP 201 with `"connected": true`. Invalid Sendit
credentials return HTTP 401 and are not saved.

## 4. Read Sendit data

```http
GET {{baseUrl}}/shipping/sendit/deliveries?page=1
Authorization: Bearer {{accessToken}}
```

Other useful checks:

```http
GET {{baseUrl}}/shipping/sendit/districts?page=1
GET {{baseUrl}}/shipping/sendit/pickups?page=1
GET {{baseUrl}}/shipping/sendit/returns?page=1
GET {{baseUrl}}/shipping/sendit/deliveries/statuses
```

Calling these before connecting returns HTTP 409 with the message
`Connect your Sendit account before using this feature`.

## 5. Create and verify a persisted Sendit shipment

First obtain valid pickup and destination district IDs:

```http
GET {{baseUrl}}/shipping/sendit/districts/pickup-cities
Authorization: Bearer {{accessToken}}
```

```http
GET {{baseUrl}}/shipping/sendit/districts?page=1
Authorization: Bearer {{accessToken}}
```

Creating a delivery calls the real Sendit account and may create a billable
shipment. Use test recipient data approved for that account:

```http
POST {{baseUrl}}/shipping/sendit/deliveries
Authorization: Bearer {{accessToken}}
Content-Type: application/json

{
  "pickup_district_id": 1,
  "district_id": 58,
  "name": "Sendit Test Recipient",
  "amount": 100,
  "address": "Test address, Casablanca",
  "phone": "0612345678",
  "comment": "Zomaal Step 1 test",
  "reference": "ZOMAAL-STEP1-001",
  "allow_open": 0,
  "allow_try": 0,
  "products_from_stock": 0,
  "products": "Test product"
}
```

Copy `data.code` from Sendit's successful response into a Postman variable
named `senditDeliveryCode`, then verify Zomaal's local copy:

```http
GET {{baseUrl}}/shipping/sendit/shipments/{{senditDeliveryCode}}
Authorization: Bearer {{accessToken}}
```

The local response should include `providerStatus`, `normalizedStatus`,
`codAmount`, `fee`, and one initial `delivery.created` event. This endpoint
does not call Sendit. A different user or unknown code returns HTTP 404.

## 6. Receive and verify a Sendit status webhook

The webhook URL configured in Sendit must be publicly reachable over HTTPS:

```text
https://YOUR_API_HOST/shipping/sendit/webhook
```

Choose Sendit's delivery-status-update event and associate the same API
credential pair that is connected to the Zomaal user. Do not add a Zomaal
Bearer token to this public provider callback.

To simulate Sendit from Postman, create a `senditSecretKey` environment
variable and add this pre-request script. It signs the exact raw JSON body in
the same way as Sendit:

```javascript
const CryptoJS = pm.require('npm:crypto-js@4.2.0');
const rawBody = pm.request.body.raw;
const signature = CryptoJS.HmacSHA256(
  rawBody,
  pm.environment.get('senditSecretKey'),
).toString(CryptoJS.enc.Hex);

pm.request.headers.upsert({
  key: 'X-Sendit-Signature',
  value: signature,
});
```

Use a delivery code already persisted by step 5:

```http
POST {{baseUrl}}/shipping/sendit/webhook
Content-Type: application/json
X-Sendit-Signature: generated-by-the-pre-request-script

{
  "event": "delivery.status.update",
  "code": "{{senditDeliveryCode}}",
  "oldStatus": "UNREACHABLE",
  "newStatus": "POSTPONED",
  "lastActionAt": "2026-08-13 16:05:05",
  "message": "Programmé par le client",
  "proofImage": "https://app.sendit.ma/storage/deliveries/test-proof.jpg",
  "deliverBy": "2026-08-14",
  "counterUnreachable": 1
}
```

A verified event returns HTTP 200. Read the shipment again with
`GET /shipping/sendit/shipments/{{senditDeliveryCode}}`; its current status and
timeline should contain the update. Sending the exact callback again remains
idempotent and does not create a duplicate timeline event. A missing or invalid
signature returns HTTP 401. An unsupported event or incomplete payload returns
HTTP 400.

`localhost` cannot receive real Sendit callbacks. For local testing, expose the
local API through an HTTPS tunnel and configure that public URL in Sendit.

## 7. Read the frontend shipment list and timeline

The Orders tab reads Zomaal's local database and does not call Sendit. Results
default to 20 records per page:

```http
GET {{baseUrl}}/shipping/sendit/shipments?page=1&limit=20
Authorization: Bearer {{accessToken}}
```

For a frontend **Load more** action, request the next page and append its
`data` array to the existing list:

```http
GET {{baseUrl}}/shipping/sendit/shipments?page=2&limit=20
Authorization: Bearer {{accessToken}}
```

Stop loading when `page >= totalPages`. Search and normalized-status filters
are applied by the backend before pagination:

```http
GET {{baseUrl}}/shipping/sendit/shipments?search=DHF4201&status=POSTPONED&page=1&limit=20
Authorization: Bearer {{accessToken}}
```

`status` accepts the `ShippingShipmentStatus` values documented in Swagger,
including `PENDING`, `CONFIRMED`, `IN_TRANSIT`, `OUT_FOR_DELIVERY`, `DELIVERED`,
`CANCELLED`, `RETURN_PENDING`, and the other normalized states.

Read only the newest-first event timeline for one shipment:

```http
GET {{baseUrl}}/shipping/sendit/shipments/{{senditDeliveryCode}}/timeline
Authorization: Bearer {{accessToken}}
```

The response excludes raw provider payloads and internal deduplication keys.
An unknown code, or a code owned by another Zomaal user, returns HTTP 404.

## 8. Import existing Sendit deliveries and reconcile missed updates

Step 4 calls Sendit's paginated delivery list and copies each provider snapshot
into Zomaal's local shipment store. It is useful for the first account backfill
and as a recovery path when a webhook was delayed or missed.

Start with a bounded sync. By default it processes at most five Sendit pages:

```http
POST {{baseUrl}}/shipping/sendit/shipments/sync
Authorization: Bearer {{accessToken}}
```

To explicitly control the provider page range:

```http
POST {{baseUrl}}/shipping/sendit/shipments/sync?startPage=1&maxPages=5
Authorization: Bearer {{accessToken}}
```

Example response:

```json
{
  "success": true,
  "message": "Sendit shipments synchronized",
  "pagesSynced": 5,
  "processed": 50,
  "imported": 42,
  "reconciled": 8,
  "nextPage": 6,
  "providerTotal": 124,
  "syncedAt": "2026-08-13T18:00:00.000Z"
}
```

When `nextPage` is not null, continue the backfill with that value:

```http
POST {{baseUrl}}/shipping/sendit/shipments/sync?startPage=6&maxPages=5
Authorization: Bearer {{accessToken}}
```

Stop when `nextPage` is null. Repeating the same page range is safe: shipments
are reconciled by Sendit delivery code, and unchanged statuses do not create
duplicate timeline events. `maxPages` accepts 1-20. Each provider page still
counts toward Sendit's API request quota.

After syncing, verify imported shipments through:

```http
GET {{baseUrl}}/shipping/sendit/shipments?page=1&limit=20
Authorization: Bearer {{accessToken}}
```

## 9. Read the Sendit courier overview dashboard

The Step 5 overview reads only Zomaal's normalized shipment and timeline data.
Run the Step 4 sync first when the account already has deliveries in Sendit.

Request the default rolling seven-day chart:

```http
GET {{baseUrl}}/shipping/sendit/overview?days=7
Authorization: Bearer {{accessToken}}
```

`days` accepts only `7`, `30`, or `90`. It controls the UTC performance chart;
the headline metrics, current status distribution, and top cities are all-time.

Example response:

```json
{
  "period": {
    "days": 7,
    "from": "2026-08-07T00:00:00.000Z",
    "to": "2026-08-13T12:00:00.000Z",
    "timezone": "UTC"
  },
  "metrics": {
    "totalShipments": 120,
    "activeShipments": 20,
    "deliveredShipments": 80,
    "returnedShipments": 10,
    "deliveredRate": 80,
    "returnRate": 8.33,
    "averageDeliveryDays": 2.5
  },
  "statusBreakdown": [
    { "status": "PENDING", "count": 4 },
    { "status": "IN_TRANSIT", "count": 16 },
    { "status": "DELIVERED", "count": 80 }
  ],
  "performance": [
    {
      "date": "2026-08-13",
      "shipmentCount": 7,
      "delivered": 5,
      "returned": 1
    }
  ],
  "topCities": [
    {
      "city": "Casablanca",
      "shipments": 50,
      "delivered": 40,
      "deliveryRate": 80
    }
  ],
  "dataUpdatedAt": "2026-08-13T11:30:00.000Z"
}
```

The real `performance` response contains one entry for every UTC date in the
selected period, including zero-value days. `deliveredRate` is delivered divided
by resolved shipments. `returnRate` is shipments currently in a normalized
return state divided by all shipments. `averageDeliveryDays` is null until at
least one shipment has a delivered timeline event.

To test the other chart periods:

```http
GET {{baseUrl}}/shipping/sendit/overview?days=30
GET {{baseUrl}}/shipping/sendit/overview?days=90
Authorization: Bearer {{accessToken}}
```

## 10. Disconnect

```http
DELETE {{baseUrl}}/shipping/sendit/connection
Authorization: Bearer {{accessToken}}
```

Afterward, the status endpoint returns `"connected": false`, and Sendit data
endpoints return HTTP 409 until the customer reconnects.
