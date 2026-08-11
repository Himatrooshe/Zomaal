# Lightfunnels OAuth and revenue testing

Import `docs/postman/Zomaal-Lightfunnels-OAuth.postman_collection.json` into
Postman and run requests in numerical order.

## Required configuration

Add these values to your local environment. The OAuth callback must be an exact
match for the redirect URI whitelisted in the Lightfunnels app:

```dotenv
LIGHTFUNNELS_ENABLED=true
LIGHTFUNNELS_CLIENT_ID=your-client-id
LIGHTFUNNELS_CLIENT_SECRET=your-client-secret
LIGHTFUNNELS_APP_URL=http://localhost:3001
LIGHTFUNNELS_REDIRECT_URI=http://localhost:3001/auth/lightfunnels/callback
LIGHTFUNNELS_SCOPES=orders,funnels,products,customers
LIGHTFUNNELS_TOKEN_ENCRYPTION_KEY=base64-encoded-32-byte-key
LIGHTFUNNELS_OAUTH_STATE_TTL_SECONDS=600
LIGHTFUNNELS_HTTP_TIMEOUT_MS=15000
```

Generate the independent encryption key once:

```bash
openssl rand -base64 32
```

Do not expose the client secret or encryption key to the frontend. In the
Lightfunnels application settings, whitelist:

```text
http://localhost:3001/auth/lightfunnels/callback
```

## Test flow

1. Run **Login to Zomaal**.
2. Run **Start Lightfunnels OAuth**. This is a `POST`, requires the Zomaal
   bearer token, and returns `authorizationUrl`.
3. Copy `authorizationUrl` from the response or Postman Console and open it in
   a browser. Approve the requested permissions.
4. Lightfunnels redirects the browser to the public callback. The backend
   exchanges the one-time code and stores the permanent access token encrypted.
5. Run the connection status and verification requests.
6. List connections. The collection saves the `LIGHTFUNNELS` connection ID.
7. Run the sync request until its response has `"hasMore": false`.
8. Run the revenue summary and timeseries requests for the frontend overview.

The summary returns totals grouped by currency and by platform. Shopify,
YouCan, and Lightfunnels totals are combined only when they use the same
currency. A newly connected account is included in revenue after its first
complete synchronization.

Swagger is available at `http://localhost:3001/docs` when
`SWAGGER_ENABLED=true`.
