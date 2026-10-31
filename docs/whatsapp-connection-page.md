# WhatsApp owner connection page

The public page at `/whatsapp-connect/` uses the existing owner login and
WhatsApp APIs. It is served from `public/` by the existing Express static-file
middleware and included in the production Docker image. No schema, permission,
dispatch or billing changes are required.

## Meta configuration

In Facebook Login for Business settings, enable **Login with the JavaScript
SDK** and add the production hostname to **Allowed Domains for the JavaScript
SDK**:

```text
zomaal-backend-563898960389.us-central1.run.app
```

Use the existing Embedded Signup configuration with the WhatsApp product,
WhatsApp accounts asset and the `whatsapp_business_management` and
`whatsapp_business_messaging` permissions. The app/configuration IDs and Graph
version are read from authenticated `GET /whatsapp/config`; no secrets are
embedded in the page. The page loads the SDK from `connect.facebook.net` only
after owner login and configuration checks. Use an app-role user for initial
tests if permissions still have standard access.

## Connection flow

1. Open the page over HTTPS and sign in with the Zomaal owner account.
2. Check the displayed active store. Switch stores in the main application
   before continuing if necessary.
3. Select the message language and click **Connect WhatsApp**. Allow the popup.
4. Complete Meta consent and choose an eligible business account and number.
5. The page waits for both `authResponse.code` and a trusted
   `WA_EMBEDDED_SIGNUP` finish event containing `waba_id` and `phone_number_id`.
   Either arrival order is supported. Access tokens are never substituted for
   authorization codes.
6. The page submits one `POST /whatsapp/connect` with those values. That existing
   endpoint exchanges the code, verifies number ownership, subscribes the WABA,
   attempts number registration and provisions message templates.
7. Check the returned connection status, then inspect template approval, price
   and balance using the existing APIs. This page sends no customer messages and
   does not enable the dispatch scheduler.

If Meta does not offer the test number, do not assume it can be onboarded through
this configuration. Test-asset API access is separate from Embedded Signup
eligibility. Capture Meta's non-sensitive error text and check its onboarding
requirements instead of registering another number unintentionally.

## Session and failure behavior

The JWT, signup code and IDs stay in memory, never local/session storage or URL
parameters. Password inputs are cleared before loading Meta's SDK. Only exact
Facebook origins are accepted for completion messages. Duplicate callbacks,
untrusted origins, events after sign-out, cancellation and incomplete IDs cannot
submit a connection. The page does not print raw SDK payloads or codes.

Signup expires locally after ten minutes. Expired Zomaal sessions require login
again. After a timeout or failed connection request, use **Refresh status** before
starting another signup; the provider or server may already have processed it.
Existing store/subscription/owner guards remain authoritative on the server.

The page does not disconnect an existing number automatically. The existing
connection endpoint can replace a connection when the owner explicitly approves
another signup; check the selected account/number carefully.

## Verification boundary

Local Chrome verification uses simulated Meta callbacks and API responses to
exercise the page. It does not prove real Meta consent, test-number eligibility,
template approval or message delivery. Production checks must separately verify
the public page and authenticated configuration. The owner completes real Meta
consent; no account is reported connected until the backend confirms it.

References: [Meta Embedded Signup implementation](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/implementation/),
[Meta Embedded Signup collection](https://www.postman.com/meta/whatsapp-business-platform/documentation/du6gzjv/embedded-signup).
