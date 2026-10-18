# 14. Advertising

## Screens
Ads platforms (TikTok, Meta, Google, Snapchat) · Connect TikTok ("what we'll access") · Connected /
syncing · Select campaigns (search, refresh) · Per-platform dashboard (metrics, statistic, active) · Metric
filter · Pause campaign popup ("This will stop your ads immediately").

## Data flow (as Figma shows it)
1. The merchant connects an ad account (OAuth).
2. The merchant **selects which campaigns** to track.
3. Spend and metrics sync regularly and feed Home, Expenses (Ad spend), and product ROI.
4. The merchant can **pause** a campaign from the app.

Built today: TikTok, Google Ads, Meta Ads (Facebook / Instagram).

Not built yet: synced ad spend does not feed Home or Expenses for any platform (the ADS expense group is manual only).

Scheduled sync (production):
- Cloud Scheduler jobs `zomaal-ads-{tiktok,google,meta}-sync` call `/internal/ads/*/sync` every 6 hours, at minutes 0, 10 and 20 (UTC).
- They send the `x-zomaal-scheduler-secret` header, using Secret Manager `zomaal-ads-sync-scheduler-secret`.
- Setup and secret rotation: `scripts/setup-ads-scheduler.sh`.
- Cloud Run's request timeout is 60 s. Once many connections exist, raise it or split the sync.

Shared endpoints work for every platform:
- `/ads/connections` lists them all.
- `/ads/statistics` adds connections together. Amounts in different currencies are summed as-is.
- `/ads/campaigns?platform=…` lists campaigns from **every** active connection for that platform. Each card carries `connectionId`, `accountName` and its own `currency`.
- A campaign counts as active when its status is `ENABLE` / `ENABLED` (TikTok, Google) or `ACTIVE` (Meta).

## Google Ads (backend)

Endpoints (all need `Authorization`, ADS plan feature, a store):

| Method | Path | Permission | Notes |
|---|---|---|---|
| POST | `/ads/google/auth/start` | `ads.view` | Returns Google consent URL (state single-use, 10 min) |
| GET | `/auth/google-ads/callback` | public | Google redirects here; creates one `AdsConnection` per advertiser account |
| GET | `/ads/google/campaigns/:connectionId?refresh=true` | `ads.view` | Lists campaigns; `refresh=true` pulls from Google first |
| POST | `/ads/google/campaigns/:connectionId/selection` | `ads.view` | Body `{ externalCampaignIds: string[] }` (digits) |
| POST | `/ads/google/campaigns/:connectionId/:externalCampaignId/status` | `ads.manage` | Body `{ status: PAUSED \| ENABLED }`; Google is updated first, then our DB |
| POST | `/internal/ads/google/sync` | scheduler secret | Last 30 days of daily metrics for tracked campaigns |

Shared endpoints (`/ads/connections`, `/ads/campaigns?platform=GOOGLE`, `/ads/statistics`) work unchanged.

- Metrics mapped into `AdsMetricSnapshot`: spend, clicks, impressions, results (= conversions, rounded), CPM, CTR, cost per conversion, conversion rate. Google has no reach/frequency at campaign level → `null`.
- Money: Google `*_micros` ÷ 1,000,000. Currency = the Google account currency.
- Access tokens refresh automatically (1 h lifetime). A revoked refresh token → connection `REAUTHORIZATION_REQUIRED`, API returns 409 "Reconnect Google Ads…".
- A wrong `GOOGLE_ADS_CLIENT_SECRET` returns 503 and is logged; it does **not** flag merchant connections for reauth.
- Not supported in v1: manager (MCC) accounts as the connected account (clear 400), budget editing.
- Env: see `.env.example` → Google Ads section. API access is tied to the Google Cloud project that owns the OAuth client (developer tokens were sunset on 2026-09-09). Explorer access works on real accounts with 2,880 operations/day; Basic access raises that to 15,000.
- API version: `GOOGLE_ADS_API_VERSION` (default `v25`). Google retires each version about a year after release; v25 sunsets August 2027.
- A platform can have several connections (one per Google advertiser account).

## Meta Ads (backend)

Endpoints (all need `Authorization`, ADS plan feature, a store):

| Method | Path | Permission | Notes |
|---|---|---|---|
| POST | `/ads/meta/auth/start` | `ads.view` | Returns the Facebook Login URL (state single-use, 10 min) |
| GET | `/auth/meta-ads/callback` | public | Facebook redirects here; creates one `AdsConnection` per usable ad account |
| GET | `/ads/meta/campaigns/:connectionId?refresh=true` | `ads.view` | Lists campaigns; `refresh=true` pulls from Meta first |
| POST | `/ads/meta/campaigns/:connectionId/selection` | `ads.view` | Body `{ externalCampaignIds: string[] }` (digits) |
| POST | `/ads/meta/campaigns/:connectionId/:externalCampaignId/status` | `ads.manage` | Body `{ status: PAUSED \| ACTIVE }`; Meta is updated first, then our DB |
| POST | `/internal/ads/meta/sync` | scheduler secret | Last 28 days of daily insights for tracked campaigns |

- Sign-in: Facebook Login asks for `ads_read` (required) and `ads_management` (needed only to pause or resume). If the merchant declines `ads_management`, the connection still works read-only and pausing returns 403.
- Tokens: the code is exchanged for a long-lived user token (about 60 days). Meta issues no refresh token, so when it expires the connection becomes `REAUTHORIZATION_REQUIRED` and the API returns 409 "Reconnect Meta Ads…". Every Graph call is signed with `appsecret_proof`.
- Ad accounts: disabled and closed accounts are skipped. Active, unsettled, under-review and grace-period accounts are connected. Deleted and archived campaigns are skipped.
- Budget: the campaign daily budget, or the lifetime budget when there is no daily one. Meta sends it in the currency's smallest unit; we convert it to the normal amount. Ad set budgets are not shown.
- Metrics mapped into `AdsMetricSnapshot`:
  - spend, impressions, reach, frequency, CPM.
  - clicks = link clicks; CTR = link-click CTR.
  - results, cost per result and conversion rate (results ÷ link clicks).
- "Results" are chosen by campaign objective:
  - Sales → purchases.
  - Leads → leads.
  - Engagement and messages → conversations started.
  - Traffic → link clicks.
  - App promotion → installs.
  - Awareness and reach → no results (`null` cost per result).
- Currency: the ad account currency, falling back to the store base currency.
- Rate limits and Meta outages return 503. A wrong app id or secret at sign-in returns 503 and is logged. Only an expired or revoked user token flags a connection for reconnect.
- Env: see `.env.example` → Meta Ads section. `META_ADS_APP_ID` / `META_ADS_APP_SECRET` fall back to the WhatsApp `META_APP_ID` / `META_APP_SECRET`, so one Meta app can serve both. `META_ADS_CONFIG_ID` switches to a Facebook Login for Business configuration.
- API version: `META_ADS_API_VERSION` (default `v25.0`). Meta supports each version for about two years.
- Going live:
  1. Create the Meta app and add Facebook Login (or Login for Business) with the redirect URI.
  2. Pass App Review for **Advanced Access** to `ads_read` and `ads_management`. This needs business verification.
  3. Set the secrets and `META_ADS_ENABLED=true`. The sync job already runs.
  4. Until App Review is approved, only app admins, developers and testers can connect.
- Not supported in v1: budget editing, ad set / ad level views, system-user (business) tokens.

## Questions

**Q14.1 (blocker) — Which platforms for launch?**
Meta, Google, and Snapchat each require an app review. What order?
Assumption: Meta next, then Google, then Snapchat.
Answer: TikTok, Google and Meta are built. Meta still needs App Review before real merchants can connect. Snapchat is next.

**Q14.2 — Why select campaigns?**
Is it only to hide campaigns that aren't for this store, or also to link campaigns to products (see tab 5, Q5.5)?
Assumption: both. The selected campaigns count toward this store's ad spend.
Answer:

**Q14.3 — Write actions**
Pause is shown. Is resume needed? What about budget editing? (Write access needs extra permissions and review.)
Assumption: pause and resume only.
Answer:

**Q14.4 — Metrics list**
Which metrics must be in the metric filter? For example: spend, impressions, clicks, CTR, CPC, CPM, conversions, cost per conversion, ROAS.
Answer:

**Q14.5 — "Ad Optimization" (Pro plan)**
What is this feature? Recommendations, auto-pause rules, or something else?
Answer:
