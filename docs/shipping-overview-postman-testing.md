# Shared shipping APIs — Postman testing

Environment variables:

```text
baseUrl=http://localhost:3000
access_token=<Zomaal access token>
```

For the deployed API, use the Cloud Run URL as `baseUrl`.

## 1. Shipping companies and summary

```http
GET {{baseUrl}}/shipping/integrations
Authorization: Bearer {{access_token}}
```

The response retains the `countries` catalog and adds:

```json
{
  "summary": {
    "connectedCouriers": 2,
    "totalShipments": 142,
    "activeShipments": 24
  },
  "countries": []
}
```

Each company now includes `analyticsAvailable`, `totalShipments`,
`activeShipments`, and `dataUpdatedAt`. Sendit, QuickLivraison, ForceLog, and
OzoneExpress all have local shipment analytics.

Optional filters:

```http
GET {{baseUrl}}/shipping/integrations?country=MA
GET {{baseUrl}}/shipping/integrations?search=quick
GET {{baseUrl}}/shipping/integrations?connected=true
GET {{baseUrl}}/shipping/integrations?country=MA&search=send&connected=true
```

The top-level summary is global and is not changed by catalog filters.

## 2. Suggest a courier

```http
POST {{baseUrl}}/shipping/integrations/suggestions
Authorization: Bearer {{access_token}}
Content-Type: application/json
```

```json
{
  "courierName": "Example Courier",
  "website": "https://example-courier.ma",
  "countryCode": "MA",
  "notes": "We use this courier for Casablanca deliveries."
}
```

`website` and `notes` are optional. A successful request returns `201 Created`
with `status: "PENDING"`.

## 3. Shipping home cards

Today:

```http
GET {{baseUrl}}/shipping/home?days=1
Authorization: Bearer {{access_token}}
```

Other supported periods:

```http
GET {{baseUrl}}/shipping/home?days=7
GET {{baseUrl}}/shipping/home?days=30
GET {{baseUrl}}/shipping/home?days=90
```

The response combines locally tracked Sendit, QuickLivraison, ForceLog, and OzoneExpress shipments and
returns:

- total shipping cost;
- average cost per shipment that has a stored fee;
- total and priced shipment counts;
- fee-data coverage percentage;
- delivery, cancelled, refused, and pickup cost cards;
- per-provider cost breakdown.

All monetary strings use MAD with four decimal places. Missing provider fees are
not treated as zero. Use `costCoveragePercentage` to determine whether a cost is
complete or partial.
