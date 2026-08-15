# OzoneExpress Postman testing

Use a valid Zomaal JWT in `{{access_token}}` and set:

```text
baseUrl = http://localhost:3000
Authorization = Bearer {{access_token}}
Content-Type = application/json
```

Apply the database migration before starting the API:

```bash
npx prisma migrate deploy
npx prisma generate
```

## 1. Verify the connection

```http
GET {{baseUrl}}/shipping/ozoneexpress/connection
```

The response should contain `"connected": true`.

## 2. Resolve a city ID

```http
GET {{baseUrl}}/shipping/ozoneexpress/cities
```

Use the provider's city ID as a string in the create body. Rabat was confirmed as
`1984` in the live account.

## 3. Create and automatically store a parcel

```http
POST {{baseUrl}}/shipping/ozoneexpress/parcels
```

```json
{
  "trackingNumber": "ZM-OZ-TEST-003",
  "receiver": "OzoneExpress Test",
  "phone": "0777296081",
  "city": "1984",
  "address": "Test address, Rabat",
  "price": 100,
  "stock": 0,
  "note": "Test parcel - do not dispatch",
  "nature": "Test product",
  "open": 1,
  "fragile": 0,
  "replace": 0
}
```

Expected provider result: `ADD-PARCEL.RESULT` is `SUCCESS`. The API stores the
parcel locally during the same request. A duplicate merchant tracking number may
be rejected by OzoneExpress, so increment the test suffix.

The provider's quoted prices are stored separately. For the confirmed Rabat
response they were delivery `35 MAD`, refusal `10 MAD`, and return `0 MAD`. The
dashboard only counts the price matching the final shipment outcome.

## 4. Import an already-created parcel

`ZM-OZ-TEST-002` was created before local persistence existed. Import it with:

```http
POST {{baseUrl}}/shipping/ozoneexpress/shipments/ZM-OZ-TEST-002/refresh
```

This fetches parcel information and tracking history, then stores both. It is
also the recovery endpoint for any parcel created before a failed database write.

## 5. Test local list, filtering, and load more

```http
GET {{baseUrl}}/shipping/ozoneexpress/shipments?page=1&limit=20
GET {{baseUrl}}/shipping/ozoneexpress/shipments?search=ZM-OZ&status=PENDING&page=1&limit=20
```

For a frontend Load More button, request `page=2` with the same `limit`, search,
and status. Append `data` to the existing list. Stop when the current page reaches
`pagination.totalPages`.

## 6. Test details and timeline

```http
GET {{baseUrl}}/shipping/ozoneexpress/shipments/ZM-OZ-TEST-002
GET {{baseUrl}}/shipping/ozoneexpress/shipments/ZM-OZ-TEST-002/timeline
```

The timeline is generated from OzoneExpress's real `TRACKING.HISTORY` timestamps,
statuses, and comments. `Nouveau Colis` is normalized to `PENDING`.

The raw provider endpoints remain available when debugging:

```http
GET  {{baseUrl}}/shipping/ozoneexpress/parcels/ZM-OZ-TEST-002
POST {{baseUrl}}/shipping/ozoneexpress/tracking
```

Tracking body:

```json
{ "trackingNumber": "ZM-OZ-TEST-002" }
```

Both raw calls also reconcile their successful response into local storage.

## 7. Refresh a batch and test analytics

```http
POST {{baseUrl}}/shipping/ozoneexpress/shipments/sync?limit=20
GET  {{baseUrl}}/shipping/ozoneexpress/overview?days=7
GET  {{baseUrl}}/shipping/companies
GET  {{baseUrl}}/shipping/home?days=7
```

OzoneExpress does not expose an account-wide parcel-list operation in the supplied
contract, so batch sync refreshes locally known tracking numbers. Import historical
tracking numbers once with the single-parcel refresh endpoint; subsequent batch
syncs keep them current.
