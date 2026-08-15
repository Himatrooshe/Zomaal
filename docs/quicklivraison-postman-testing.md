# QuickLivraison shipping API testing

Use these Postman environment variables:

```text
baseUrl=https://zomaal-backend-828793303867.us-central1.run.app
access_token=<Zomaal access token>
quicklivraison_tracking=<tracking number returned by QuickLivraison>
```

Never store a QuickLivraison API key in this collection. Connect it once through
`POST /shipping/quicklivraison/connection`; Zomaal stores it encrypted.

## 1. Synchronize existing parcels

```http
POST {{baseUrl}}/shipping/quicklivraison/shipments/sync
Authorization: Bearer {{access_token}}
```

Expected response:

```json
{
  "success": true,
  "message": "QuickLivraison shipments synchronized",
  "processed": 120,
  "imported": 100,
  "reconciled": 20,
  "syncedAt": "2026-08-13T00:00:00.000Z"
}
```

The QuickLivraison REST list contains only tracking/status/store information.
Therefore, imported historical parcels can have null recipient, address, city,
and amount fields. Newly created parcels and webhook events contain richer data.

## 2. List, search, filter, and paginate

```http
GET {{baseUrl}}/shipping/quicklivraison/shipments?page=1&limit=20
Authorization: Bearer {{access_token}}
```

Optional parameters:

```text
search=PARCEL_12345678
status=DELIVERED
page=1
limit=20
```

The frontend Load More button should request the next page and append `data`.
Stop when `page >= totalPages`.

## 3. Local shipment detail and timeline

```http
GET {{baseUrl}}/shipping/quicklivraison/shipments/{{quicklivraison_tracking}}
Authorization: Bearer {{access_token}}
```

```http
GET {{baseUrl}}/shipping/quicklivraison/shipments/{{quicklivraison_tracking}}/timeline
Authorization: Bearer {{access_token}}
```

## 4. Overview

```http
GET {{baseUrl}}/shipping/quicklivraison/overview?days=7
Authorization: Bearer {{access_token}}
```

Allowed periods are `7`, `30`, and `90` days. The response includes metrics,
status breakdown, performance trend, top cities, and `sync` health.

## 5. Configure the production webhook

Create a strong secret in the QuickLivraison dashboard and configure the exact
same value in Cloud Run as `QUICKLIVRAISON_WEBHOOK_SECRET`.

Webhook URL:

```text
https://zomaal-backend-828793303867.us-central1.run.app/shipping/quicklivraison/webhook
```

QuickLivraison sends `X-Webhook-Signature: sha256=<hex>`. The endpoint rejects
missing or invalid signatures. Use QuickLivraison's dashboard Test button only
after the tracking number in the test payload has been created or synchronized
locally; an unknown tracking number returns `404`.

Successful response:

```json
{
  "success": true,
  "message": "QuickLivraison webhook received"
}
```

QuickLivraison disables a webhook after ten consecutive failures, so confirm a
real status change appears in the local timeline after deployment.

## 6. Automatic synchronization

Configure Cloud Run with:

```text
QUICKLIVRAISON_SYNC_SCHEDULER_ENABLED=true
QUICKLIVRAISON_SYNC_SCHEDULER_SECRET=<random secret of at least 32 characters>
QUICKLIVRAISON_SYNC_CONCURRENCY=2
QUICKLIVRAISON_SYNC_MAX_CONNECTIONS=100
QUICKLIVRAISON_SYNC_MIN_INTERVAL_MINUTES=15
```

Configure Cloud Scheduler to call every 15 minutes:

```http
POST https://zomaal-backend-828793303867.us-central1.run.app/internal/shipping/quicklivraison/sync
X-Zomaal-Scheduler-Secret: <same scheduler secret>
```

This internal endpoint selects stale connections, synchronizes them with bounded
concurrency, records per-account sync health, and returns an aggregate summary.
