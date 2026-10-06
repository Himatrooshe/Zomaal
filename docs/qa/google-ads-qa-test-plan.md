# Google Ads — QA test plan

Use a synthetic merchant on a store with the ADS plan feature (trial or Pro).
The real `GOOGLE_ADS_CLIENT_SECRET` lives in `.env` / Secret Manager only.

## Prerequisites

- `GOOGLE_ADS_ENABLED=true`, client ID/secret, redirect URI registered on the OAuth client in Google Cloud Console. No developer token is needed.
- Google Cloud project → Google Ads API → Overview shows the access level. **Test** → only Google Ads *test* accounts work. **Explorer** or higher → real accounts.
- If the OAuth consent screen is in Testing mode, the tester's Google account must be listed as a test user (refresh tokens then expire after 7 days).
- A Google Ads advertiser account (not a manager/MCC) the tester can sign in to.

## Connect

| # | Step | Expected |
|---|---|---|
| 1 | `POST /ads/google/auth/start` without token | 401 |
| 2 | Same, user without a store | 404 Store not found |
| 3 | Same, valid merchant | 200, `authorizationUrl` on accounts.google.com with `scope=…/auth/adwords`, `access_type=offline`, `prompt=consent` |
| 4 | Open URL in a browser | Google sign-in page (no `invalid_client` / `redirect_uri_mismatch`) |
| 5 | Approve | Redirect to success URL `?google_ads=connected`; `GET /ads/connections?platform=GOOGLE` shows the account(s) with currency |
| 6 | Deny on consent screen | Redirect to failure URL `?google_ads=failed` |
| 7 | Reuse the same callback URL | 401 state invalid or already used |
| 8 | Callback with forged / missing state | 401 / 400 |
| 9 | Sign in with a manager-only account | 400 "Manager (MCC) accounts are not supported yet" |
| 10 | Server has a wrong client secret | 503 "misconfigured on the server", server log `invalid_client`; existing connections stay ACTIVE |

## Campaigns

| # | Step | Expected |
|---|---|---|
| 11 | `GET /ads/google/campaigns/:id?refresh=true` | Campaigns from Google (no REMOVED), budget `.toFixed(2)`, `objective` = channel type |
| 12 | Unknown / other store's connection id | 404 |
| 13 | Non-UUID id | 400 |
| 14 | `POST …/selection` with `["abc"]` | 400 digits only |
| 15 | Select one campaign | `tracked: true` only for that campaign |
| 16 | `POST …/:campaignId/status {"status":"PAUSED"}` (owner) | 200; campaign shows Paused in Google Ads UI and in our list |
| 17 | Same with `ENABLED` | Resumed in Google and our list |
| 18 | Staff without `ads.manage` | 403 |
| 19 | `{"status":"REMOVED"}` | 400 |
| 20 | Revoke app access at myaccount.google.com/permissions, then pause | 409 Reconnect; connection `REAUTHORIZATION_REQUIRED`; campaign status unchanged |

## Sync and dashboard

| # | Step | Expected |
|---|---|---|
| 21 | `POST /internal/ads/google/sync` without scheduler secret | 401 |
| 22 | With secret | 200 counts; snapshots for tracked campaigns, last 30 days |
| 23 | `GET /ads/campaigns?platform=GOOGLE&days=7` | Spend/clicks/impressions match Google Ads UI for the same dates (account time zone) |
| 24 | `GET /ads/statistics?period=week&metric=spent` | GOOGLE entry `available: true` |
| 25 | Locked (expired) billing account | Sync skips it; writes return 402 |

## Cleanup

Delete the synthetic user (cascades store and ads rows). Disconnect the test app in Google account permissions.
