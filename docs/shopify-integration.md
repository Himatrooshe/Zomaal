# Shopify integration

Zomaal connects a merchant-owned Shopify shop to the authenticated user's single
Zomaal store. It is a standalone app (`embedded = false`) using Shopify managed
installation configuration and authorization code grant to acquire expiring
offline tokens.

## Ownership and secrets

- All connection-management endpoints require a Zomaal access token.
- The Zomaal user must create a store before starting Shopify authorization.
- A Shopify shop can belong to only one Zomaal store.
- Shopify access and refresh tokens are encrypted with AES-256-GCM and
  shop-specific authenticated context.
- Shopify tokens are never returned to the frontend or written to application
  logs.
- OAuth states are random, stored only as SHA-256 hashes, expire after ten
  minutes by default, and can be used only once.

## Frontend contract

### Start authorization

```http
POST /shopify/auth/start
Authorization: Bearer <zomaalAccessToken>
Content-Type: application/json

{
  "shopDomain": "atlas-market.myshopify.com"
}
```

The response contains `authorizationUrl`, `shopDomain`, and `expiresAt`.
Navigate the current browser window to `authorizationUrl`. Do not fetch that URL
from the frontend as an API request.

Shopify redirects the browser to `/auth/shopify/callback`. The backend performs
all validation and token exchange. When
`SHOPIFY_AUTH_SUCCESS_REDIRECT_URL`/`SHOPIFY_AUTH_FAILURE_REDIRECT_URL` are set,
the browser returns to the frontend with either:

```text
?shopify=connected
?shopify=failed
```

The frontend must then call `GET /shopify/connection`; it must not infer the
final connection state only from the query parameter.

### Connection state

```http
GET /shopify/connection
Authorization: Bearer <zomaalAccessToken>
```

Possible `status` values:

- `not_connected`
- `active`
- `disconnected`
- `reauthorization_required`

When `scopeUpdateRequired` is true, start authorization again after the Shopify
app configuration has been deployed with the required scopes.

### Verify and disconnect

```http
POST /shopify/connection/verify
DELETE /shopify/connection
Authorization: Bearer <zomaalAccessToken>
```

Disconnecting removes local credentials. The merchant must uninstall the app in
Shopify Admin to revoke the Shopify installation.

### Read Shopify data

All data endpoints require the Zomaal access token and an active Shopify
connection. Responses are read live from Shopify, use
`Cache-Control: private, no-store`, and are not persisted by Zomaal.

```http
GET /shopify/store
GET /shopify/products?first=20&query=status%3Aactive
GET /shopify/orders?first=20&query=financial_status%3Apaid
GET /shopify/customers?first=20
Authorization: Bearer <zomaalAccessToken>
Accept: application/json
```

The three list endpoints return:

```json
{
  "data": [],
  "pageInfo": {
    "hasNextPage": false,
    "hasPreviousPage": false,
    "startCursor": null,
    "endCursor": null
  }
}
```

`first` defaults to 20 and accepts 1–100. To request the next page, pass the
previous response's `pageInfo.endCursor` unchanged as `after`. The optional
`query` value uses Shopify search syntax. Cursors are opaque and must not be
decoded or modified by the client.

#### Postman query tests

In Postman, add `first`, `after`, and `query` in the **Params** tab so Postman
handles URL encoding. For the first page, disable or delete the `after` row.
The backend treats an empty `after` or `query` value as omitted, but clients
should still avoid sending unused parameters.

Start with these unfiltered requests:

```http
GET /shopify/products?first=5
GET /shopify/orders?first=5
GET /shopify/customers?first=5
```

Supported Shopify search examples for the `query` parameter:

| Resource  | `query` value                                          | Purpose                    |
| --------- | ------------------------------------------------------ | -------------------------- |
| Products  | `status:active`                                        | Active products            |
| Products  | `inventory_total:>0 status:active`                     | Active products in stock   |
| Products  | `vendor:Snowdevil OR vendor:Icedevil`                  | Either vendor              |
| Products  | `sku:XYZ-12345`                                        | Variant SKU                |
| Products  | `updated_at:>'2026-07-01T00:00:00Z'`                   | Recently updated products  |
| Orders    | `status:open`                                          | Open orders                |
| Orders    | `financial_status:paid fulfillment_status:unfulfilled` | Paid, unfulfilled orders   |
| Orders    | `created_at:>='2026-07-01T00:00:00Z'`                  | Orders after a date        |
| Orders    | `current_total_price:>=50 current_total_price:<=200`   | Orders in a price range    |
| Orders    | `name:1001-A`                                          | Order name                 |
| Customers | `first_name:Jane last_name:Reeves`                     | Customer name              |
| Customers | `email:"bo.wang@example.com"`                          | Exact email                |
| Customers | `phone:*`                                              | Customers with a phone     |
| Customers | `updated_at:>'2026-07-01T00:00:00Z'`                   | Recently updated customers |

For pagination:

1. Send `GET /shopify/products?first=2` without `after`.
2. If `pageInfo.hasNextPage` is `true`, copy the non-empty
   `pageInfo.endCursor`.
3. Send the same request again with that exact cursor in the Postman `after`
   parameter.
4. Keep `first` and `query` unchanged while moving through a result set.

Shopify search uses spaces for `AND`, uppercase `OR`, and supports comparison
operators such as `:>`, `:>=`, `:<`, and `:<=`. Do not use the deprecated
customer `orders_count` filter.

Products require `read_products`, orders require `read_orders`, and customers
require `read_customers` (the corresponding write scopes also include read
access). Shopify limits order access to the latest 60 days by default; older
orders require approved `read_all_orders` access. Customer/order names and
customer email/phone fields are protected customer data and require the
corresponding Shopify production approval.

Expected integration errors are:

- `401`: invalid Zomaal token or Shopify must be reauthorized.
- `403`: missing Shopify scope or protected customer data approval.
- `404`: the user has no Zomaal store.
- `409`: Shopify is not actively connected.
- `502`: Shopify returned a malformed or schema-invalid response.
- `503`: Shopify timed out, remained throttled after retries, or is unavailable.

## Local Shopify CLI workflow

Shopify CLI is installed on the developer workstation, not in the production
Docker image.

1. Start local dependencies:

   ```bash
   docker compose up -d postgres redis
   ```

2. Link this repository to the existing development app:

   ```bash
   shopify app config link
   ```

3. Review the generated `shopify.app.toml`. Use
   `shopify.app.toml.example` as the Zomaal configuration reference and retain
   the scopes pulled from the Shopify app.

4. Validate configuration:

   ```bash
   shopify app config validate
   ```

5. Start the NestJS API through Shopify's HTTPS development tunnel:

   ```bash
   shopify app dev
   ```

The CLI supplies `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`, `APP_URL`/`HOST`,
`SCOPES`, and `PORT`. The developer must still provide database, Redis, Zomaal
JWT, shipping encryption, and `SHOPIFY_TOKEN_ENCRYPTION_KEY` values in `.env`.

## Production

Render deploys the Docker backend. Shopify CLI deploys Shopify configuration;
`shopify app deploy` does not deploy the NestJS application.

1. Deploy the backend and migration to Render.
2. Confirm the Render health endpoint is reachable.
3. Configure the production TOML with the Render HTTPS origin, callback
   `/auth/shopify/callback`, and webhook `/webhooks/shopify`.
4. Set `[build].automatically_update_urls_on_dev = false`.
5. Run:

   ```bash
   shopify app config validate --config production
   shopify app deploy --config production
   ```

## Webhooks

`POST /webhooks/shopify` validates the exact raw body and required Shopify
headers. Supported lifecycle/privacy topics are:

- `app/uninstalled`
- `customers/data_request`
- `customers/redact`
- `shop/redact`

Webhook IDs are stored for idempotency without retaining payload PII. Zomaal
currently stores no Shopify customer/order payloads. If such tables are added,
their data-export and redaction behavior must be added to the two customer
privacy handlers before release.
