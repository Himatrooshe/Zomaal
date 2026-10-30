# Snapchat Ads connection and reporting

Snapchat uses the existing `AdsConnection`, `AdsOAuthState`, `AdsCampaign`, and
`AdsMetricSnapshot` tables. No schema change or migration is required. The Ads
API client only performs GET requests; the OAuth token endpoint uses POST.
This implementation does not create, pause, resume, delete or change budgets on
Snapchat campaigns.

## Configuration and OAuth

See `.env.example` for `SNAPCHAT_ADS_*` settings. Production credentials are held
in `zomaal-snapchat-ads-client-id` and `zomaal-snapchat-ads-client-secret` in
Secret Manager. `zomaal-ads-token-encryption-key` supplies the shared AES-256-GCM
key. Preserve this key when deploying; rotating it without re-encrypting stored
tokens prevents existing connections from being decrypted.

The registered callback is:
`https://zomaal-backend-563898960389.us-central1.run.app/auth/snapchat-ads/callback`.
The requested scope is `snapchat-marketing-api`. Snap's scope allows reading and
writing, but Zomaal's implementation is reporting-only. API access also follows
the authorizing Snapchat user's ad-account permissions.

1. Sign in to Zomaal and POST `/ads/snapchat/auth/start` with the access token.
2. Open the returned `authorizationUrl` in the merchant's browser. The state is
   hashed at rest, expires after ten minutes by default, and is single-use.
3. The merchant signs in to Snapchat and consents. Client credentials alone
   cannot authorize a merchant's ad accounts.
4. The callback rechecks the original active store, staff permission, subscription
   and ads entitlement, exchanges the code, and discovers active ad accounts.
5. One encrypted connection is stored per store/account. Access tokens last
   about an hour. A database row lock serializes refresh-token rotation across
   instances. Revocation is committed before HTTP 409 asks the merchant to
   reconnect; credential misconfiguration does not revoke merchant connections.

Without optional frontend redirect settings the callback returns JSON connection
summaries, with no credentials. A frontend completion redirect adds
`snapchat_ads=connected` or `snapchat_ads=failed` and must be an HTTPS URL.

## API and permissions

All merchant routes require a valid Zomaal access token, active-store isolation
and the plan's `ads` feature. Expired subscriptions cannot perform writes.

| Method and path                                        | Permission   | Behavior                                                    |
| ------------------------------------------------------ | ------------ | ----------------------------------------------------------- |
| POST `/ads/snapchat/auth/start`                        | `ads.manage` | Start OAuth                                                 |
| GET `/ads/connections?platform=SNAPCHAT`               | `ads.view`   | Safe connection summaries                                   |
| GET `/ads/snapchat/campaigns/:connectionId`            | `ads.view`   | Cached campaign list                                        |
| POST `/ads/snapchat/campaigns/:connectionId/refresh`   | `ads.manage` | Read current campaigns from Snap into the mirror            |
| POST `/ads/snapchat/campaigns/:connectionId/selection` | `ads.manage` | Save `{ externalCampaignIds: ["<Snap UUID>"] }`             |
| POST `/ads/snapchat/sync/:connectionId`                | `ads.manage` | Fetch real daily metrics for tracked campaigns              |
| GET `/ads/snapchat/metrics/:connectionId?days=7`       | `ads.view`   | Account-currency/calendar reporting; accepts 1, 7, 30 or 90 |
| DELETE `/ads/connections/:connectionId`                | `ads.manage` | Clear local credentials and disconnect                      |

Disconnect now requires `ads.manage` for every platform. A read-only ads viewer
must not be able to remove a connection. Unknown, unavailable, duplicate and
cross-account campaign selections are rejected rather than silently truncated.
There is no Snapchat campaign-status mutation route.

## Data contract

- Account currency and IANA timezone come from Snap. Missing metadata is an error,
  never a guessed MAD/USD label. Micro-currency is divided by 1,000,000 using
  decimals; snapshots retain the shared schema's four-decimal monetary precision.
- `clicks` maps to `swipes`. `purchases` / shared snapshot `results` maps specifically
  to `conversion_purchases`; it is not an inferred campaign objective result.
- Attribution uses conversion time, a 28-day swipe window and a one-day view
  window. Compare Snap Ads Manager using the same settings and account timezone.
- Daily reach/frequency can be null. Multi-day reach is not added or estimated.
- Initial sync requests 90 account-calendar days in <=30-day windows. Later syncs
  re-read 30 days. Selection changes invalidate freshness and trigger another
  full backfill, so newly selected campaigns are not limited to the prior window.
- Sync has a cross-instance lease, rechecks entitlement and tracked campaigns
  before writes, and atomically replaces only successfully fetched windows.
  Provider failures preserve cached values. A successful empty window removes
  stale values instead of leaving old spend visible forever.
- `syncState` distinguishes `NOT_SYNCED`, `SYNCED` and `SYNC_FAILED`.
  `dataUpdatedAt` is null before a completed sync. Do not treat an un-synced
  response as proof that the advertiser spent zero.
- Provider-deleted/missing campaigns retain stored financial history, with local
  status `UNAVAILABLE` when absent from a complete refreshed campaign list.
- Provider pagination is followed without forwarding tokens to another origin
  or account path. Partial failures, malformed reports and unsafe counts fail
  explicitly; sample stats (`test=true`) are never requested.

The native Snapchat metrics route is the comparison surface for this integration.
The existing shared cross-platform statistics route has pre-existing currency,
ratio and timezone limitations recorded during the Google Ads review. This work
does not claim to close those findings or prove mixed-currency ring-chart totals.
The existing financial spend service reads tracked snapshots and uses real FX
conversion, retaining unavailable conversions separately.

Snap updates measurement data approximately every 15 minutes and finalizes
delivery metrics about 48 hours after the account-local day ends. A successful
connection to an empty ad account is not proof of nonzero reporting accuracy.

## Scheduler and rollout

`POST /internal/ads/snapchat/sync` uses the existing scheduler guard and secret.
Only active connections with tracked campaigns and a currently entitled owner
are processed. `scripts/setup-ads-scheduler.sh` includes the Snapchat job at minute
30 every six hours, staggered from the other platforms. Configure/run the job
after the first authorized account has passed a manual sync.

CI runs the API/unit suite, the PostgreSQL Snapchat workflow and the existing
backend gates before production deployment. Rollback by setting
`SNAPCHAT_ADS_ENABLED=false` and pausing the Snapchat Scheduler job, or redeploying
the previous backend revision. Keep stored history and the encryption key.

Initial live QA used an explicitly approved temporary merchant with a normal
seven-day trial, a viewer and another store for isolation checks. The owner later
explicitly authorized a separate seven-day production trial extension for their
own account, ending 6 November 2026 at 00:00:32 UTC; this is an administrative
testing grant, not a paid subscription. Real account
IDs, tokens, credentials and detailed advertising metrics belong in private QA
artifacts, not committed reports.

References: [Authentication](https://developers.snap.com/marketing-api/Ads-API/authentication),
[Organizations](https://developers.snap.com/marketing-api/Ads-API/organizations),
[Campaigns](https://developers.snap.com/marketing-api/Ads-API/campaigns),
[Measurement](https://developers.snap.com/marketing-api/Ads-API/measurement),
[Monetary values](https://developers.snap.com/marketing-api/Ads-API/monetary-values).
