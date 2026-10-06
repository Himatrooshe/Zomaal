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

Built today: TikTok, Google Ads.

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
- A platform can have several connections (one per Google advertiser account). `/ads/statistics` adds them up; `/ads/campaigns` currently shows only the first active connection.

## Questions

**Q14.1 (blocker) — Which platforms for launch?**
Meta, Google, and Snapchat each require an app review. What order?
Assumption: Meta next, then Google, then Snapchat.
Answer:

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
