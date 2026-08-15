# Shared shipping provider contract

All endpoints require a Zomaal bearer token. Supported `provider` values are:

```text
sendit
quicklivraison
forcelog
ozoneexpress
ameex
```

The existing provider-specific endpoints remain available. These shared routes
provide one stable response contract for courier screens and other backend
consumers.

## Connection

```http
GET {{baseUrl}}/shipping/providers/:provider/connection
```

Every provider returns `provider`, `connected`, `connectedAt`, `lastSyncedAt`,
`lastSyncError`, `message`, and `providerDetails`.

## Paginated shipments

```http
GET {{baseUrl}}/shipping/providers/:provider/shipments?page=1&limit=20
GET {{baseUrl}}/shipping/providers/:provider/shipments?search=TRACK&status=IN_TRANSIT&page=1&limit=20
```

Every shipment contains the same common fields:

```json
{
  "id": "local-id",
  "provider": "ameex",
  "providerCode": "TRACKING-CODE",
  "providerStatus": "IN_PROGRESS",
  "providerSubStatus": null,
  "normalizedStatus": "IN_TRANSIT",
  "reference": "ORDER-1",
  "recipientName": "Recipient",
  "recipientPhone": "0612345678",
  "address": "Address",
  "city": "Rabat",
  "cityId": 1,
  "codAmount": "100.0000",
  "fee": "35.0000",
  "currency": "MAD",
  "productName": "Product",
  "note": "Delivery note",
  "lastActionAt": "2026-08-15T00:00:00.000Z",
  "providerCreatedAt": "2026-08-14T00:00:00.000Z",
  "providerUpdatedAt": "2026-08-15T00:00:00.000Z",
  "createdAt": "2026-08-14T00:00:00.000Z",
  "updatedAt": "2026-08-15T00:00:00.000Z",
  "providerDetails": {}
}
```

Unavailable provider values are returned as `null`; provider-only information
is retained under `providerDetails`.

## Details and timeline

```http
GET {{baseUrl}}/shipping/providers/:provider/shipments/:code
GET {{baseUrl}}/shipping/providers/:provider/shipments/:code/timeline
```

Timeline events consistently return the provider, event type, provider status,
provider sub-status, normalized status, display name/color when available,
message, actor, proof image URL, event time, and provider-specific details.

## Manual synchronization

```http
POST {{baseUrl}}/shipping/providers/:provider/sync?limit=20
```

Optional provider-specific bounds can be passed through the common query:

```http
POST {{baseUrl}}/shipping/providers/sendit/sync?startPage=1&maxPages=5
POST {{baseUrl}}/shipping/providers/ameex/sync?limit=20&importPageSize=100&maxImportPages=10
```

The normalized result always contains `provider`, `success`, `message`,
`syncedAt`, `selected`, `processed`, `imported`, `refreshed`, `reconciled`,
`failed`, `failures`, `nextCursor`, and `providerDetails`.

## Overview

```http
GET {{baseUrl}}/shipping/providers/:provider/overview?days=7
```

Periods `7`, `30`, and `90` are supported. All providers return the same metric,
status-breakdown, performance-trend, top-city, data-update, and sync-health
shape. Average delivery days is calculated when delivery history and a valid
creation timestamp are available.

## Provider-specific actions

Parcel creation and operational actions keep their provider-specific routes
because the upstream request fields and capabilities are genuinely different.
Examples include Sendit returns, ForceLog stock, OzoneExpress delivery notes,
and provider-specific label formats. Their resulting shipments are available
through the shared read, timeline, sync, and overview contract above.
