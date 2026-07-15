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

   If an existing development database was originally created with
   `prisma db push` and has no migration history, apply the new table once:

   ```bash
   npx prisma db execute --file prisma/migrations/20260714000000_add_sendit_connection/migration.sql
   ```

4. Open Swagger at `http://localhost:3001/docs` (or the configured `PORT`).

## Postman environment

Create these variables:

| Variable | Example |
| --- | --- |
| `baseUrl` | `http://localhost:3001` |
| `accessToken` | Set after OTP verification |
| `phone` | A valid E.164 phone number |
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

## 5. Disconnect

```http
DELETE {{baseUrl}}/shipping/sendit/connection
Authorization: Bearer {{accessToken}}
```

Afterward, the status endpoint returns `"connected": false`, and Sendit data
endpoints return HTTP 409 until the customer reconnects.
