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

Built today: TikTok.

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
