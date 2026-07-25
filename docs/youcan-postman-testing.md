# YouCan OAuth: configuration and Postman testing

## 1. Configure the YouCan Partner app

- Set **Embedded** to `False`.
- Set the redirect URI to the exact value of `YOUCAN_REDIRECT_URI`.
- For local testing, that is normally
  `http://localhost:3000/auth/youcan/callback`.
- The OAuth authorization request uses the wildcard scope registered for the
  app.

OAuth redirect URI comparison is exact. Scheme, host, port, path, and trailing
slash must match.

## 2. Configure Zomaal

Use the namespaced variables shown in `.env.example`:

```dotenv
YOUCAN_ENABLED=true
YOUCAN_CLIENT_ID=your-partner-client-id
YOUCAN_CLIENT_SECRET=your-partner-client-secret
YOUCAN_APP_URL=http://localhost:3000
YOUCAN_REDIRECT_URI=http://localhost:3000/auth/youcan/callback
YOUCAN_SCOPES=*
YOUCAN_TOKEN_ENCRYPTION_KEY=base64-encoded-32-byte-key
```

Generate the encryption key once:

```bash
openssl rand -base64 32
```

Use `YOUCAN_CLIENT_ID` and `YOUCAN_CLIENT_SECRET` for new deployments to prevent
collisions with other OAuth providers. Existing generic `CLIENT_ID` and
`CLIENT_SECRET` values remain supported as migration aliases, with the
namespaced values taking precedence.

YouCan's current authorization server requires one standard `scope` query
parameter. Zomaal therefore sends `scope=*` by default and encodes configured
named scopes as one space-delimited value. Do not send `scope[]`; the current
server rejects it as an array. The integration only calls store-information
and order-reading endpoints.

After changing `YOUCAN_SCOPES`, restart Zomaal and run the OAuth connection flow
again. Existing tokens do not gain newly configured scopes automatically.

Apply the migration before starting the API:

```bash
npx prisma migrate deploy
npm run start:dev
```

## 3. Import and run the Postman collection

Import `docs/postman/Zomaal-YouCan-OAuth.postman_collection.json`.

1. Set the `baseUrl`, `phone`, and `password` collection variables.
2. Run **1. Login to Zomaal**. Its test script saves the Zomaal access token.
3. Run **2. Start YouCan OAuth**.
4. Copy `authorizationUrl` from the JSON response or Postman Console and open
   it in a browser.
5. Log in with any YouCan seller account and approve the requested permission.
   YouCan redirects the browser to Zomaal's public callback; Postman must not
   call the callback manually.
6. Run **3. Get YouCan connection status**. Expect `connected: true` and
   `status: "active"`.
7. Run **4. Verify YouCan credentials**. Expect `verified: true` and non-secret
   store identity fields.

If the local frontend is not running, leave
`YOUCAN_AUTH_SUCCESS_REDIRECT_URL` and `YOUCAN_AUTH_FAILURE_REDIRECT_URL` empty.
The callback will return JSON instead of redirecting to the frontend.

The optional disconnect request deletes the locally encrypted tokens. It does
not claim to revoke provider-side access; use the YouCan Seller Area to revoke
the app when needed.
