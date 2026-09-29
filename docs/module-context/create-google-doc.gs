/**
 * Creates the "Zomaal — Module context & open questions" Google Doc,
 * with one tab per module.
 *
 * Setup (one time):
 *   1. Open https://script.google.com → New project.
 *   2. Paste this whole file into Code.gs.
 *   3. Left sidebar → Services (+) → "Google Docs API" → Add.
 *   4. Select `createModuleContextDoc` in the toolbar → Run → allow access.
 *   5. Open the doc URL printed in the Execution log.
 */

const DOC_TITLE = 'Zomaal — Module context & open questions';

const TABS = [
  {
    "title": "Overview",
    "markdown": "# Module context — data flow + open questions\n\nOne tab per module. Each tab has the same shape:\n\n1. **Screens** — what the Figma (`zomal-copy`, Page 1) section contains.\n2. **Data flow (as Figma shows it)** — where the data comes from, who enters it, where it goes.\n3. **Questions** — only the things we cannot decide from Figma or the code. Each question has our **current assumption**, so often you only need to write \"yes\" or correct it. Questions marked **(blocker)** change the data model or API — answer those first.\n\nFigma numbers, names, phones, and currencies are placeholders. Don't read them as real data.\n\n## Tabs\n\n| # | Module |\n|---|---|\n| 0 | Cross-cutting (currency, country, language) |\n| 1 | Onboarding & Auth |\n| 2 | Home dashboard |\n| 3 | Orders (list, details, timeline) |\n| 4 | Returns |\n| 5 | Products, bundles, compare |\n| 6 | Packaging |\n| 7 | Purchases |\n| 8 | Zomaal Shop & My Orders |\n| 9 | Expenses |\n| 10 | Staff & Salary |\n| 11 | Customers & Risk Center (Blacklist, Duplicates) |\n| 12 | eCom platform integrations |\n| 13 | Shipping companies |\n| 14 | Advertising |\n| 15 | WhatsApp automation |\n| 16 | Notifications |\n| 17 | Settings, multi-store, plans & billing |\n| 18 | Apps menu: Reports / Item Value |\n\n---\n\n## 0. Cross-cutting questions (affect every module)\n\nFigma mixes **MAD**, **DH**, **$**, and **৳**. It also mixes **Moroccan** (+212, Casablanca) with **Bangladeshi** (+880, Narayanganj, bKash/SSLCommerz) examples. Shipping tabs show Morocco / Algeria / Egypt / Tunisia.\n\n**Q0.1 (blocker) — Target markets at launch?**\nAssumption: Morocco first, then other North African countries. The Bangladesh examples are designer placeholders.\nAnswer:\n\n**Q0.2 (blocker) — One currency per store?**\nAssumption: each store has one `baseCurrency`, set from its country at store creation. All dashboards show that currency. When a Shopify store or ad account uses another currency (such as USD), we convert it to the store currency. What is the conversion source: a daily rate, or should we not convert at all?\nAnswer:\n\n**Q0.3 — App language(s)?**\nThe WhatsApp screen mentions English / Arabic / French templates. Should the app UI also support Arabic (RTL) and French?\nAssumption: the backend returns codes and enums, and the app translates them. The backend has no i18n.\nAnswer:\n\n**Q0.4 — Timezone for \"Today\" / \"This month\"?**\nAssumption: the store's country timezone (Africa/Casablanca for Morocco), not the phone's timezone.\nAnswer:\n\n**Q0.5 — Who is the Zomaal admin?**\nSome data is managed by Zomaal, not the merchant: Shop catalog, promo codes, plans, and courier list. Is there an admin panel (web) planned, and who builds it?\nAssumption: a super-admin API exists, and a separate admin web app uses it.\nAnswer:\n"
  },
  {
    "title": "1. Onboarding & Auth",
    "markdown": "# 1. Onboarding & Auth\n\n## Screens\nGet Started · Onboarding slides · Phone Number (WhatsApp / SMS toggle) · Verify OTP · Set Password · Create Store · Login (Remember me) · Forgot password (phone → OTP → new password → success).\n\n## Data flow (as Figma shows it)\n1. The user enters a phone number (default +212) and picks **WhatsApp or SMS** for the OTP.\n2. OTP is verified. The user sets a password.\n3. **Create Store**: logo, user name, business name, address, city, country (\"Morocco — Auto-detected\").\n4. After this the user lands on Home, with a 7-day free trial banner in the sidebar.\n5. Login is phone + password. Forgot password reuses the OTP flow.\n\n## Questions\n\n**Q1.1 (blocker) — Password or numeric passcode?**\nOne Figma version says \"Enter Passcode\" and another says \"Enter Password\".\nAssumption: a normal password, minimum 8 characters.\nAnswer:\n\n**Q1.2 — OTP over WhatsApp: which provider?**\nSMS goes through Twilio today. Should WhatsApp OTP also go through Twilio (WhatsApp sender), or through the same WhatsApp Business API used for automation (tab 15)?\nAssumption: Twilio for both.\nAnswer:\n\n**Q1.3 — How is the country \"auto-detected\"?**\nFrom the phone prefix, or from IP? Can the user change it later? Does country decide currency, timezone, and which couriers are listed?\nAssumption: from the phone prefix, editable in Create Store, and it drives currency, timezone, and courier list.\nAnswer:\n\n**Q1.4 — Social login?**\nThe onboarding screen has an \"Apple\" text layer. Do we need Sign in with Apple / Google?\nAssumption: no, phone only.\nAnswer:\n\n**Q1.5 — Staff login**\nDo staff use the same login screen (phone + password), and land directly in the owner's store?\nAssumption: yes. The backend already supports this (see `docs/staff-module.md` (repo)).\nAnswer:\n\n**Q1.6 — When does the free trial start?**\nAt account creation or at store creation? Is a card required?\nAssumption: at store creation, and no card is required.\nAnswer:\n"
  },
  {
    "title": "2. Home dashboard",
    "markdown": "# 2. Home dashboard\n\n## Screens\nHome (\"Your Latest Insights\") · time range picker (Today / Yesterday / Last 7 days / Last 1 month / custom calendar) · hide-values state · tooltips · empty state (\"No order yet\") · Trial ended / Subscription expired overlays. The sidebar also shows Profit and Lost profit.\n\n## Data flow (as Figma shows it)\nHome only reads data; nothing is entered here. The cards pull from other modules:\n\n| Card | Comes from |\n|---|---|\n| Total income / Orders count | Orders (tab 3) |\n| Total confirm orders value | Orders with status \"confirmed\" |\n| Revenue / Refunds / Refund cost | Orders + platform refunds |\n| Total shipping cost / Avg shipping per order | Shipping (tab 13) |\n| Total ad spend / Results / Avg cost per result | Advertising (tab 14) |\n| Total expenses / Avg cost per order | Expenses (tab 9) |\n| Profit / Lost orders (Lost profit) | Calculated |\n\n## Questions\n\n**Q2.1 (blocker) — When does an order count as revenue?**\nOptions: when placed, when confirmed, or when delivered.\nAssumption: revenue counts at **Delivered**, which matches the COD reality and the existing architecture doc. \"Total confirm orders value\" is a separate card for confirmed orders that are not yet delivered.\nAnswer:\n\n**Q2.2 (blocker) — Profit formula**\nAssumption: Profit = delivered revenue − product cost − shipping cost − ad spend − other expenses (salary, rent, and so on). Should salary and other expenses be included, or should Home show gross profit only?\nAnswer:\n\n**Q2.3 — What is \"Lost orders\" / \"Lost profit\"?**\nIs it the value of cancelled + refused + returned orders, or the money actually lost (shipping + return fees + damaged goods)?\nAssumption: money actually lost (shipping + return costs + damage).\nAnswer:\n\n**Q2.4 — \"Results\" in ad spend**\nShould we use the platform's own result metric (purchases or conversions as TikTok/Meta report them), or our orders count?\nAssumption: the platform's result metric.\nAnswer:\n\n**Q2.5 — Multi-store**\nDoes Home show only the currently selected store, or can it show all stores combined?\nAssumption: the current store only.\nAnswer:\n"
  },
  {
    "title": "3. Orders (list, details, timeline)",
    "markdown": "# 3. Orders (list, details, timeline)\n\n## Screens\nOrders list (tabs All / Confirm / Delivered, search) · Order details (Customer info, Order info with Source + COD amount + COD status, items, totals, Shipping info with courier + tracking + est. delivery, Financial impact: revenue / shipping cost / net profit) · Order Timeline · empty state.\n\n## Data flow (as Figma shows it)\n1. Orders arrive from Shopify / YouCan / Lightfunnels sync (tab 12), or are manual orders.\n2. The order is shipped with a courier (tab 13) and gets a tracking number.\n3. Courier status updates feed the **timeline**. The Figma timeline is courier-style: \"Picked up\", \"Out of zone\", \"Postponed\", \"Unreachable\", \"Collection point\", \"Packaging fees\", \"Returned to seller\".\n4. The details screen calculates per-order revenue, shipping cost, and net profit.\n\n## Questions\n\n**Q3.1 (blocker) — Is there an order confirmation step inside Zomaal?**\nTabs say \"Confirm\", and Home has \"Total confirm orders value\". In Moroccan COD, a call center usually calls the customer to confirm first. Does the merchant or staff mark orders **Confirmed** in Zomaal, or does \"confirmed\" come from the platform?\nAssumption: it comes from the platform or courier. Zomaal has no confirmation workflow.\nAnswer:\n\n**Q3.2 (blocker) — Timeline source**\nThe architecture says the timeline comes from the platform (Shopify events). The Figma timeline shows courier events. Should we merge both into one timeline when the order was shipped with one of our couriers?\nAssumption: yes, merged and sorted by time, with a source label on each event.\nAnswer:\n\n**Q3.3 — Full order status list for the tabs**\nFigma has All / Confirm / Delivered, but details show \"Shipped\". What is the final tab list?\nAssumption: All / Pending / Confirmed / Shipped / Delivered / Cancelled / Returned.\nAnswer:\n\n**Q3.4 — COD status: who marks \"Collected\"?**\nOptions: the courier settlement API, manual marking by the merchant, or automatic when Delivered.\nAssumption: automatic on Delivered, with manual override.\nAnswer:\n\n**Q3.5 — Can the merchant create or edit orders in the app?**\nStaff permissions list \"Edit Orders, Cancel Orders, Export Orders\", but Figma has no create/edit screen. Should edits and cancels be pushed back to Shopify/YouCan?\nAssumption: manual orders can be created (the backend supports them). Cancel is pushed back to the platform, and edit is not in v1.\nAnswer:\n\n**Q3.6 — Per-order \"Net profit\"**\nShould it subtract a share of ad spend (CPO), or only product cost + shipping?\nAssumption: product cost + shipping + packaging only. Ad spend is not assigned per order.\nAnswer:\n\n**Q3.7 — Export Orders format?**\nCSV or Excel? Which columns?\nAnswer:\n"
  },
  {
    "title": "4. Returns",
    "markdown": "# 4. Returns\n\nMost of this is already decided. See `docs/returns-module.md` (repo). Only the remaining gaps are listed here.\n\n## Screens\nReturns list (All / Need verification / Delayed / Processed) · Scan · Manual verification (search) · Return detected (order, customer, products, financial impact: original value, shipping cost, net loss) · empty.\n\n## Data flow (as Figma shows it)\n1. The courier marks the parcel as returned, and it comes back to the warehouse.\n2. Staff **scan** the courier barcode, or search manually, which resolves the order and its products.\n3. Staff set a condition per product (Good / Damaged / Lost / Returned / Missing).\n4. Stock and the loss figure update automatically.\n\n## Questions\n\n**Q4.1 — \"Delayed\" threshold**\nAssumption: a return still unverified after 2 days is Delayed. Should it be fixed or configurable per store?\nAnswer:\n\n**Q4.2 — Stock effect per condition**\nAssumption: Good goes back to sellable stock. Damaged, Lost, and Missing count as a loss at cost price. Is that correct?\nAnswer:\n\n**Q4.3 — Which barcode is on the returned parcel?**\nAssumption: the courier's own label (tracking number). Do any couriers put their own internal code instead?\nAnswer:\n\n**Q4.4 — Returns for orders not shipped through Zomaal**\nCan a merchant log a return for an order shipped by a Shopify plugin or manually (no tracking in Zomaal)?\nAssumption: yes, by searching the order number manually.\nAnswer:\n"
  },
  {
    "title": "5. Products, bundles, compare",
    "markdown": "# 5. Products, bundles, compare\n\n## Screens\nProducts list (All / Active / Low stock / Out of stock, filter by category / stock / status) · Product details (pricing summary, inventory, basic info) · Performance (7D / 30D / 90D / custom: delivery, cancel, and return rates, revenue, cost, gross and net profit, ROI, top cities) · Update stock · Add / Edit product (image, tracking code \"Generate\", status, pricing, purchase cost, inventory, variants, gift, packaging) · Bundle (select products, total auto-calculated) · Category create/select · Compare Products (A vs B).\n\n## Data flow (as Figma shows it)\n1. The merchant creates a product in Zomaal with price, purchase cost, stock, variants, and category.\n2. Zomaal generates a **tracking code** (product code) used on labels and scans.\n3. Orders reduce stock. Packaging linked to the product is deducted on delivery.\n4. Performance and Compare read from orders, shipping statuses, and ad spend.\n\n## Questions\n\n**Q5.1 (blocker) — Where do products come from?**\nAre they created only in Zomaal, imported from Shopify/YouCan, or both? If imported, how do we match a platform product to a Zomaal product (by SKU)?\nAssumption: they are created in Zomaal, and platform order lines are matched by SKU.\nAnswer:\n\n**Q5.2 (blocker) — When is stock deducted?**\nOptions: order placed, confirmed, shipped, or delivered. (Packaging says \"on delivery\".)\nAssumption: stock is reserved at confirm or ship, and permanently deducted at delivery. It comes back if the order is cancelled or returned in Good condition.\nAnswer:\n\n**Q5.3 — Stock sync back to the platform?**\nShould Zomaal push stock levels to Shopify/YouCan?\nAssumption: no, Zomaal is read-only toward platforms in v1.\nAnswer:\n\n**Q5.4 — Purchase cost: fixed or from Purchases?**\nIs cost typed once on the product, or updated from purchases (average cost)?\nAssumption: typed on the product. A new purchase updates it to the weighted average.\nAnswer:\n\n**Q5.5 (blocker) — Ad spend per product (ROI, CPO, Net profit in Performance and Compare)**\nAds are per campaign, not per product. How do we link a campaign to a product? Options: the merchant manually links campaigns to products, matching by campaign name, or no product-level ad cost.\nAssumption: the merchant links campaigns to products manually.\nAnswer:\n\n**Q5.6 — Bundle price and stock**\nThe total is \"auto calculated\" (sum of components). Can the merchant override it with a discount price? Bundle stock = the smallest component stock?\nAssumption: yes to both.\nAnswer:\n\n**Q5.7 — Gift**\nIs the gift product deducted from stock on each order, and is its cost counted in the order's profit?\nAssumption: yes to both.\nAnswer:\n\n**Q5.8 — Tracking code format**\nIs it random (e.g. 8 characters), or does the merchant type their own SKU? Do we need label printing (PDF / Bluetooth printer)?\nAssumption: auto-generated with manual override, and no printing in v1.\nAnswer:\n"
  },
  {
    "title": "6. Packaging",
    "markdown": "# 6. Packaging\n\n## Screens\nPackaging list · Add packaging item (photo, unit: pieces / rolls / meters / sheets, stock, minimum level, \"Auto Reorder Alert — WhatsApp alert when stock is low\") · Details (stock, min level, used in products \"1 per order\", stock history: used in order −1, restock +50) · Update stock.\n\n## Data flow (as Figma shows it)\n1. The merchant creates packaging materials with their stock.\n2. On the product, the merchant picks which packaging is used (tab 5).\n3. When an order is **delivered**, packaging stock goes down automatically.\n4. When stock reaches the minimum, an alert is sent (WhatsApp).\n\n## Questions\n\n**Q6.1 — Per order or per unit?**\nIf an order has 3 of the same product, deduct 1 box or 3?\nAssumption: follow the quantity set on the product link. \"1 per order\" means 1 per order, regardless of quantity.\nAnswer:\n\n**Q6.2 — Packaging cost**\nFigma has no price field on packaging. Should packaging cost count in order profit?\nAssumption: yes. The cost comes from Purchases (tab 7) as the average cost.\nAnswer:\n\n**Q6.3 — Where does the low-stock WhatsApp alert go?**\nTo the owner's phone? Does it use the WhatsApp automation balance (tab 15)? Should it also show in Notifications (tab 16)?\nAssumption: owner phone, not charged to the balance, and also shown in Notifications.\nAnswer:\n\n**Q6.4 — Restock from Zomaal Shop**\nWhen the merchant buys boxes from Zomaal Shop, should packaging stock increase automatically on delivery?\nAssumption: yes, if the shop item is linked to a packaging material.\nAnswer:\n"
  },
  {
    "title": "7. Purchases",
    "markdown": "# 7. Purchases\n\n## Screens\nPurchases list (All / Manual / From Shop) · Purchases details (history: date, quantity, unit price, total cost) · Add purchase (select product, purchase info, date) · Select product · empty state.\n\n## Data flow (as Figma shows it)\n1. **Manual**: the merchant records buying stock from a supplier (product, quantity, price, date).\n2. **From Shop**: created automatically when the merchant orders from Zomaal Shop (tab 8).\n3. Purchases feed the \"Purchase Costs\" category in Expenses (tab 9).\n\n## Questions\n\n**Q7.1 (blocker) — What can be purchased?**\nIn \"Select a Product\", should the merchant see warehouse products, packaging materials, or both?\nAssumption: both.\nAnswer:\n\n**Q7.2 — Does a purchase increase stock automatically?**\nAssumption: yes, stock goes up when the purchase is saved (manual), or when the Shop order is delivered (From Shop).\nAnswer:\n\n**Q7.3 — Expense recording**\nIs every purchase automatically an expense under \"Purchase Costs\"?\nAssumption: yes, and it cannot also be added manually in Expenses (to avoid double counting).\nAnswer:\n\n**Q7.4 — Supplier info**\nDo we need supplier name, invoice number, or a receipt photo on manual purchases?\nAssumption: an optional note + receipt photo. No supplier list.\nAnswer:\n"
  },
  {
    "title": "8. Zomaal Shop & My Orders",
    "markdown": "# 8. Zomaal Shop & My Orders\n\n## Screens\nExplore the Shop · Shop (products, popular items) · Product details (size, color, quantity, tier price, specifications) · Favorites · My Cart · Shipping address / Add address · Checkout (promo code, Online payment or Cash on delivery) · Confirm COD (\"Repeated cancellations may restrict your account\") · My Orders (All / Processing / Shipped / Delivered / Cancelled) · Order track.\n\n## Data flow (as Figma shows it)\n1. **Zomaal** (not the merchant) sells supplies such as boxes, bubble wrap, and stickers to merchants.\n2. The merchant orders and pays online or by COD.\n3. Zomaal fulfills the order, and its status shows in My Orders with a timeline (courier + tracking).\n4. The order becomes a \"From Shop\" purchase (tab 7).\n5. Plans say \"Access Zomaal Shop\" is a **Pro** feature.\n\n## Questions\n\n**Q8.1 (blocker) — Who manages the shop catalog, prices, promo codes, and order statuses?**\nAssumption: Zomaal staff, through a super-admin panel. Order status changes are made manually by Zomaal admins.\nAnswer:\n\n**Q8.2 (blocker) — Online payment gateway**\nWhich gateway for Morocco (CMI, Stripe, PayZone)? The Figma checkout shows SSLCommerz (Bangladesh).\nAnswer:\n\n**Q8.3 — COD cancellation restriction**\nWhat exactly does \"Repeated cancellations may restrict your account\" mean? For example, \"after 3 cancelled COD orders, COD is disabled and only online payment is allowed\"?\nAssumption: that rule, with a limit set by the admin.\nAnswer:\n\n**Q8.4 — Delivery fee rules**\nFigma shows \"Free\". Is it always free, a flat fee, or free above a minimum amount?\nAnswer:\n\n**Q8.5 — Starter plan**\nCan Starter users see the shop but not buy, or is it hidden entirely?\nAssumption: hidden, with an upgrade prompt.\nAnswer:\n"
  },
  {
    "title": "9. Expenses",
    "markdown": "# 9. Expenses\n\n## Screens\nExpenses (total, % vs last month, All / This month / Last month / Custom, chart, categories: Shipping costs, Ad spend, Staff salary, Purchase costs, Other) · Breakdown (pie) · Other expenses list · Expense details (amount, category, date, payment method, note, receipt) · Add expense (category: Bills, Supplies, Marketing, Employee salary, + create) · Create category.\n\n## Data flow (as Figma shows it)\nFour categories fill **automatically** from other modules:\n\n| Category | Source |\n|---|---|\n| Shipping costs | Shipping (tab 13) |\n| Ad spend | Advertising (tab 14) |\n| Staff salary | Staff salary payments (tab 10) |\n| Purchase costs | Purchases (tab 7) |\n| Other | Entered manually by the merchant |\n\n## Questions\n\n**Q9.1 (blocker) — Double counting**\nThe Add Expense list includes \"Employee salary\" and \"Marketing\". If a merchant adds salary manually while staff salary is automatic, it counts twice. Should the manual list only allow \"Other\" sub-categories?\nAssumption: manual expenses always go under Other. The automatic groups are read-only.\nAnswer:\n\n**Q9.2 — Shipping cost source**\nShould we use the actual fee from the courier API, or a per-city rate the merchant enters? What about orders shipped outside Zomaal?\nAssumption: the courier API fee when available, otherwise a default fee the merchant sets per courier.\nAnswer:\n\n**Q9.3 — Recurring expenses**\nRent is monthly. Do we need \"repeat every month\" on manual expenses?\nAssumption: not in v1.\nAnswer:\n\n**Q9.4 — \"Revenue\" row in the Figma categories list**\nOne Figma state shows \"Revenue — 0% of total expenses\". Is that a design mistake?\nAssumption: yes, and we will ignore it.\nAnswer:\n\n**Q9.5 — Payment methods list**\nFigma shows Cash and Bank. Is anything else needed (card, mobile wallet)?\nAnswer:\n"
  },
  {
    "title": "10. Staff & Salary",
    "markdown": "# 10. Staff & Salary\n\nMostly built. See `docs/staff-module.md` (repo). Only the remaining gaps are listed here.\n\n## Screens\nStaff management (list, active/inactive) · Staff details (contact, salary, permissions per module, activity) · Add / Edit staff (photo, basic info \"use for login\", salary, permissions incl. Advertising and Shop, account status) · Manage salary info (automatic vs manual expense, daily / weekly / monthly, payment date, method) · Salary tab (breakdown chart, Paid / Pending / Overdue) · Add salary record (multi-select staff) · Access restricted (for staff).\n\n## Data flow (as Figma shows it)\n1. The owner adds staff with a phone + password and picks permissions.\n2. Staff log in and see only the modules they were given.\n3. The owner sets the salary. **Automatic** = recorded as paid and as an expense on the payment date. **Manual** = the owner records payments.\n4. Payments feed \"Staff salary\" in Expenses (tab 9).\n\n## Questions\n\n**Q10.1 — Staff limit per plan?**\nThe upgrade banner says \"Increase your speed with more members\". How many staff can Starter and Pro have?\nAnswer:\n\n**Q10.2 — Can one staff phone work for several stores or owners?**\nAssumption: no, one staff account belongs to one store.\nAnswer:\n\n**Q10.3 — Salary changes mid-period**\nIf the salary changes mid-month, do old unpaid records keep the old amount?\nAssumption: yes. Only future records use the new amount.\nAnswer:\n\n**Q10.4 — Activity log**\n\"Last active / Last login\" is shown. Does the owner need a full audit log (who edited which order)?\nAssumption: last login only in v1.\nAnswer:\n"
  },
  {
    "title": "11. Customers & Risk Center",
    "markdown": "# 11. Customers & Risk Center (Blacklist, Duplicate Orders)\n\n## Screens\nCustomers list · Customer details (orders placed, risk score, cancellations, refusals, no-answer, total risk actions, order history, \"Add to blacklist — reason auto-filled\") · Blacklist (At-risk customers \"2/3 returns — 1 more = blacklist\", Blacklisted) · Blacklist settings (limits for returns / cancellations / refusals / no-answer, combined limit, warn on new order) · Remove from blacklist · Duplicate orders (groups by \"Same phone number\", main vs duplicates, cancel selected).\n\n## Data flow (as Figma shows it)\n1. Customers are built automatically from orders, with the **phone number** as the identity.\n2. Risk counters go up from order and courier outcomes (return, cancel, refusal, no answer).\n3. When a limit is reached, the customer is blacklisted. New orders from them trigger a warning.\n4. Duplicate orders are detected and grouped. The merchant cancels the extras.\n\n## Questions\n\n**Q11.1 (blocker) — What does blacklisting actually do?**\nOptions: warning only, auto-cancel new orders, or block shipping through Zomaal.\nAssumption: warning only (the timeline event + a flag on the order).\nAnswer:\n\n**Q11.2 (blocker) — Blacklist shared between merchants?**\nIs the blacklist per store only, or is there a network-wide \"bad customer\" score across all Zomaal merchants? This has privacy and legal implications.\nAssumption: per store only.\nAnswer:\n\n**Q11.3 — Refusals / No answer only for Zomaal-shipped orders**\nThose statuses come from our couriers. For merchants shipping outside Zomaal, only returns and cancellations count. Is that OK?\nAnswer:\n\n**Q11.4 — Customer phone for platform orders**\nShopify hides customer phone and name unless the app is approved for \"protected customer data\". Is applying for that approval in scope? Without it, Customers and Blacklist only work for YouCan, Lightfunnels, and manual orders.\nAnswer:\n\n**Q11.5 (blocker) — Duplicate order rule**\nWhat makes two orders duplicates: same phone within X hours, same phone + same product, or something else? What is X?\nAssumption: same phone + same product within 24 hours, and the oldest order is \"Main\".\nAnswer:\n\n**Q11.6 — Cancel duplicates on the platform too?**\nShould \"Cancel selected\" also cancel the order on Shopify/YouCan?\nAssumption: yes, when the platform API allows it. Otherwise it is only marked cancelled in Zomaal.\nAnswer:\n"
  },
  {
    "title": "12. eCom platform integrations",
    "markdown": "# 12. eCom platform integrations\n\n## Screens\neCom platforms (connected list + available: Shopify, YouCan, Lightfunnels, WooCommerce, Dropify, TikTok, \"Can't find your platform?\") · Connect (store credentials) · Connected success (\"first sync in progress\") · Platform details (last / next sync, every 15 min, Sync now, revenue, today's / month's new orders, recent syncs) · Disconnect.\n\n## Data flow (as Figma shows it)\n1. The merchant connects a store platform.\n2. Zomaal syncs orders every 15 minutes. Webhooks make it faster where available.\n3. Orders feed Orders, Home, Customers, and Products.\n\nBuilt today: Shopify, YouCan, and Lightfunnels (OAuth).\n\n## Questions\n\n**Q12.1 (blocker) — Which new platforms, in what order?**\nFigma lists WooCommerce, Dropify, and TikTok (TikTok Shop?). Which are required for launch?\nAssumption: none for launch. WooCommerce comes next.\nAnswer:\n\n**Q12.2 — \"Store credentials\" form vs OAuth**\nShopify, YouCan, and Lightfunnels use OAuth (no credentials typed). Is the credentials form only for platforms without OAuth (such as WooCommerce API keys)?\nAssumption: yes.\nAnswer:\n\n**Q12.3 — First sync history**\nHow far back should we import on connect: 30 days, 90 days, or everything?\nAssumption: 90 days.\nAnswer:\n\n**Q12.4 — Disconnect: what happens to old data?**\nAssumption: orders are kept (marked as from a disconnected source). Tokens are deleted.\nAnswer:\n\n**Q12.5 — More than one store of the same platform?**\nFor example, two Shopify stores under one Zomaal store. Or should each be a separate Zomaal store (multi-store, tab 17)?\nAssumption: one platform connection per Zomaal store.\nAnswer:\n\n**Q12.6 — \"Can't find your platform?\"**\nWhere does the request go (email, admin panel, WhatsApp)?\nAnswer:\n"
  },
  {
    "title": "13. Shipping companies",
    "markdown": "# 13. Shipping companies\n\n## Screens\nShipping companies (tabs by country: Morocco / Algeria / Egypt / Tunisia, search) · Select country (\"more coming soon\") · Courier API credentials · Courier details (connected since, sync status, Sync now, performance trend: shipments / delivery / return, top delivery cities with rate) · Courier orders (Pending / Confirm / Shipped / Delivered).\n\n## Data flow (as Figma shows it)\n1. The merchant connects their **own courier account** by entering API credentials.\n2. Orders are sent to the courier and get tracking numbers.\n3. Courier statuses sync back every 15 minutes (or by webhook). They drive order status, revenue, returns, and customer risk.\n\nBuilt today: Sendit, QuickLivraison, ForceLog, OzoneExpress, Ameex (Morocco).\n\n## Questions\n\n**Q13.1 (blocker) — Where does the merchant click \"ship this order\"?**\nFigma has no dispatch button on Order details. Should dispatch be one order at a time from details, bulk from the list, or done in the courier's own dashboard (Zomaal only reads)?\nAssumption: a single dispatch from Order details, plus bulk later.\nAnswer:\n\n**Q13.2 — Couriers per country at launch**\nWhich couriers are required for Algeria, Egypt, and Tunisia, or are those tabs \"coming soon\"? The timeline mentions \"Onaqatii\". Is that a courier we need?\nAnswer:\n\n**Q13.3 — Shipping fee source**\nShould we use the actual fee from the courier API, or a price list the merchant enters (per city)?\nAssumption: the courier API when available, otherwise a merchant-entered default.\nAnswer:\n\n**Q13.4 — Courier stats scope**\nDo performance and top cities count only shipments made through Zomaal?\nAssumption: yes.\nAnswer:\n\n**Q13.5 — Return fees**\nDo couriers charge a return fee? Should it be stored and counted as a loss?\nAssumption: yes, when the courier reports it.\nAnswer:\n"
  },
  {
    "title": "14. Advertising",
    "markdown": "# 14. Advertising\n\n## Screens\nAds platforms (TikTok, Meta, Google, Snapchat) · Connect TikTok (\"what we'll access\") · Connected / syncing · Select campaigns (search, refresh) · Per-platform dashboard (metrics, statistic, active) · Metric filter · Pause campaign popup (\"This will stop your ads immediately\").\n\n## Data flow (as Figma shows it)\n1. The merchant connects an ad account (OAuth).\n2. The merchant **selects which campaigns** to track.\n3. Spend and metrics sync regularly and feed Home, Expenses (Ad spend), and product ROI.\n4. The merchant can **pause** a campaign from the app.\n\nBuilt today: TikTok.\n\n## Questions\n\n**Q14.1 (blocker) — Which platforms for launch?**\nMeta, Google, and Snapchat each require an app review. What order?\nAssumption: Meta next, then Google, then Snapchat.\nAnswer:\n\n**Q14.2 — Why select campaigns?**\nIs it only to hide campaigns that aren't for this store, or also to link campaigns to products (see tab 5, Q5.5)?\nAssumption: both. The selected campaigns count toward this store's ad spend.\nAnswer:\n\n**Q14.3 — Write actions**\nPause is shown. Is resume needed? What about budget editing? (Write access needs extra permissions and review.)\nAssumption: pause and resume only.\nAnswer:\n\n**Q14.4 — Metrics list**\nWhich metrics must be in the metric filter? For example: spend, impressions, clicks, CTR, CPC, CPM, conversions, cost per conversion, ROAS.\nAnswer:\n\n**Q14.5 — \"Ad Optimization\" (Pro plan)**\nWhat is this feature? Recommendations, auto-pause rules, or something else?\nAnswer:\n"
  },
  {
    "title": "15. WhatsApp automation",
    "markdown": "# 15. WhatsApp automation\n\nNot built yet.\n\n## Screens\nConnect WhatsApp (delivery updates, status alerts, EN / AR / FR templates) · Connecting · Connected (business number, active) · Automation dashboard (balance, sent today, failed, cost per message) · Status settings (Picked up, Warehouse, In transit, Distributed, In delivery, Reschedule, Canceled, Denied, Delivered, each with a delay and an editable message) · Edit message (variables `{customer_name}`, `{order_id}`, `{store_name}`, include product image, send immediately / after delay, preview) · Balance history (top-ups, −per message) · Message analytics · Change / Disconnect WhatsApp.\n\n## Data flow (as Figma shows it)\n1. The merchant connects their WhatsApp Business number.\n2. The merchant turns on messages per courier status and edits the text.\n3. When a courier status changes, a message is sent to the customer after the chosen delay.\n4. Each message deducts from a **prepaid balance**.\n\n## Questions\n\n**Q15.1 (blocker) — Provider and number ownership**\nShould we use the Meta WhatsApp Cloud API directly (Embedded Signup, with the merchant's own number) or a provider like Twilio / 360dialog? Or does Zomaal send from one shared number?\nAssumption: Meta Cloud API with the merchant's own number.\nAnswer:\n\n**Q15.2 (blocker) — Balance and pricing**\nHow does the merchant top up (which payment gateway), and who sets the per-message price? Meta charges per conversation or template category, not a flat $0.01.\nAnswer:\n\n**Q15.3 — Template approval**\nWhatsApp business messages must use Meta-approved templates. Every edit needs re-approval (minutes to hours). Is that acceptable, or should merchants only choose from pre-approved Zomaal templates?\nAssumption: pre-approved templates in 3 languages. The merchant picks one and toggles it on or off.\nAnswer:\n\n**Q15.4 — Which orders trigger messages?**\nThe statuses are courier statuses, so messages would only go out for orders shipped through Zomaal couriers. Is that right? The customer phone is also needed (see tab 11, Q11.4).\nAnswer:\n\n**Q15.5 — Language per customer**\nHow do we pick EN / AR / FR per customer: store default, customer country, or order language?\nAssumption: store default.\nAnswer:\n"
  },
  {
    "title": "16. Notifications",
    "markdown": "# 16. Notifications\n\nNot built yet.\n\n## Screens\nNotifications (All / Critical / Warning / Inventory). Examples: low stock (\"5 items left\"), overdue payments (\"2 customers have overdue payments\"), unusual sales drop (\"30% vs last week\").\n\n## Data flow (as Figma shows it)\nThe system generates notifications from other modules (stock, payments, sales). The merchant only reads them.\n\n## Questions\n\n**Q16.1 (blocker) — Full list of notification types**\nPlease list every alert you want, with its trigger. Candidates: low stock (product and packaging), new blacklisted customer order, duplicate orders detected, courier sync failed, platform disconnected, salary due, trial or subscription ending, WhatsApp balance low.\nAnswer:\n\n**Q16.2 — \"Customers have overdue payments\"**\nWhat does this mean for a COD business? Money a courier has not yet paid out to the merchant?\nAnswer:\n\n**Q16.3 — \"Unusual sales drop\" rule**\nIs it this week vs last week, a 30% drop, and checked daily?\nAssumption: yes.\nAnswer:\n\n**Q16.4 — Push notifications?**\nIn-app list only, or also phone push (Firebase)? Do staff receive them too (based on permissions)?\nAssumption: in-app + push. Staff get the ones for modules they can access.\nAnswer:\n"
  },
  {
    "title": "17. Settings, multi-store, plans & billing",
    "markdown": "# 17. Settings, multi-store, plans & billing\n\nBilling and subscriptions are not built yet.\n\n## Screens\nSettings (edit profile, store information, change password, plan & billing, about, privacy, delete account, logout) · Store list popup (current store, switch, add new store) · Plans & Pricing (Starter 99 MAD, Pro 199 MAD, monthly / yearly, feature list) · Billing information (card) · Plan & Billing (current plan, next billing, payment method, billing history) · Cancel subscription · Free trial banner (7 days) · Trial ended / Subscription expired overlays · Checkout via SSLCommerz (annual membership).\n\n## Data flow (as Figma shows it)\n1. A new user gets a 7-day free trial.\n2. The user picks Starter or Pro, monthly or yearly, and pays by card.\n3. The plan unlocks features. Pro adds Ad optimization, WhatsApp automation, Multi-store, and Zomaal Shop.\n4. When the trial or subscription ends, the app is locked behind the plan screen.\n\n## Questions\n\n**Q17.1 (blocker) — App Store / Play Store billing rules**\nApple and Google usually require in-app purchase for digital subscriptions sold inside a mobile app (they take 15–30%). Should we use in-app purchase, or have users pay on the web only?\nAnswer:\n\n**Q17.2 (blocker) — Payment gateway for web or card billing**\nWhich gateway for Morocco? SSLCommerz is Bangladesh-only.\nAnswer:\n\n**Q17.3 — Final prices**\nStarter 99 MAD and Pro 199 MAD per month. What is the yearly price? (Figma shows \"126 MAD + tax\".) Is tax/VAT included?\nAnswer:\n\n**Q17.4 (blocker) — What is locked when the trial or subscription ends?**\nEverything blocked, or read-only (the user can see data but not sync or add)? Does syncing stop?\nAssumption: read-only. Syncing pauses.\nAnswer:\n\n**Q17.5 — Cancel subscription**\nDoes it take effect immediately or at the end of the billing period? Any refunds?\nAssumption: at period end, with no refunds.\nAnswer:\n\n**Q17.6 — Multi-store**\nIs each store fully separate (own data, own integrations, own staff)? Is one subscription per account or per store? What is the store limit on Pro?\nAssumption: fully separate stores, one subscription per account, limit to be defined.\nAnswer:\n\n**Q17.7 — Delete account**\nDelete immediately, or after a grace period (for example 30 days)? What happens to the stores and staff?\nAssumption: 30-day grace period, then everything is deleted.\nAnswer:\n"
  },
  {
    "title": "18. Apps menu: Reports / Item Value",
    "markdown": "# 18. Apps menu: Reports / Item Value\n\n## Screens\nThe \"Manage Your Business\" apps grid has **Reports** and **Item Value** tiles, but Figma has **no screens** for them. Plans mention \"Smart Alerts & Advanced Reports\".\n\n## Data flow\nUnknown. No design exists yet.\n\n## Questions\n\n**Q18.1 — What is \"Reports\"?**\nWhich reports (sales, profit and loss, courier performance, product performance), and in what format (in-app charts, PDF, Excel)?\nAnswer:\n\n**Q18.2 — What is \"Item Value\"?**\nIs it inventory valuation (stock × cost), or something else?\nAssumption: inventory valuation.\nAnswer:\n\n**Q18.3 — Are designs coming, or is this out of scope for v1?**\nAnswer:\n"
  }
].map(function (t) {
  return { title: t.title.slice(0, 50), markdown: t.markdown };
});

function createModuleContextDoc() {
  const doc = DocumentApp.create(DOC_TITLE);
  const docId = doc.getId();
  doc.saveAndClose();

  const requests = [
    {
      updateDocumentTabProperties: {
        tabProperties: { tabId: 't.0', title: TABS[0].title },
        fields: 'title',
      },
    },
  ];
  for (let i = 1; i < TABS.length; i++) {
    requests.push({ addDocumentTab: { tabProperties: { title: TABS[i].title, index: i } } });
  }
  Docs.Documents.batchUpdate({ requests: requests }, docId);

  const reopened = DocumentApp.openById(docId);
  const tabs = reopened.getTabs();
  for (let i = 0; i < TABS.length; i++) {
    const tab = tabs.find(function (t) { return t.getTitle() === TABS[i].title; }) || tabs[i];
    renderMarkdown(tab.asDocumentTab().getBody(), TABS[i].markdown);
  }
  reopened.saveAndClose();

  Logger.log('Created: ' + reopened.getUrl());
}

function renderMarkdown(body, markdown) {
  const lines = markdown.split('\n');
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed === '') { i++; continue; }

    if (trimmed.startsWith('|')) {
      const rows = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        const cells = lines[i].trim().replace(/^\||\|$/g, '').split('|').map(function (c) { return c.trim(); });
        if (!cells.every(function (c) { return /^:?-{2,}:?$/.test(c); })) rows.push(cells);
        i++;
      }
      appendTable(body, rows);
      continue;
    }

    if (trimmed === '---') { body.appendHorizontalRule(); i++; continue; }

    const heading = trimmed.match(/^(#{1,3})\s+(.*)$/);
    if (heading) {
      const level = heading[1].length;
      const p = appendRich(body.appendParagraph(''), heading[2]);
      p.setHeading([null, DocumentApp.ParagraphHeading.HEADING1, DocumentApp.ParagraphHeading.HEADING2,
        DocumentApp.ParagraphHeading.HEADING3][level]);
      i++; continue;
    }

    const bullet = trimmed.match(/^[-*]\s+(.*)$/);
    const numbered = trimmed.match(/^\d+\.\s+(.*)$/);
    if (bullet || numbered) {
      const item = appendRich(body.appendListItem(''), (bullet || numbered)[1]);
      item.setGlyphType(bullet ? DocumentApp.GlyphType.BULLET : DocumentApp.GlyphType.NUMBER);
      i++; continue;
    }

    if (/^Answer:\s*$/.test(trimmed)) {
      const box = body.appendTable([['Answer: ']]);
      box.setBorderColor('#f9ab00');
      const cell = box.getCell(0, 0);
      cell.setBackgroundColor('#fff8e1');
      cell.editAsText().setBold(0, 6, true).setForegroundColor(0, 6, '#b06000');
      i++; continue;
    }

    const p = appendRich(body.appendParagraph(''), trimmed);
    if (/^Assumption:/.test(trimmed)) {
      p.editAsText().setItalic(true).setForegroundColor('#5f6368');
    }
    const blocker = p.getText().indexOf('(blocker)');
    if (blocker >= 0) {
      p.editAsText().setForegroundColor(blocker, blocker + 8, '#d93025').setBold(blocker, blocker + 8, true);
    }
    i++;
  }

  const first = body.getChild(0);
  if (body.getNumChildren() > 1 && first.getType() === DocumentApp.ElementType.PARAGRAPH
      && first.asParagraph().getText() === '') {
    first.removeFromParent();
  }
}

function appendTable(body, rows) {
  const width = rows[0].length;
  const plainRows = rows.map(function (r) {
    const padded = r.slice(0, width);
    while (padded.length < width) padded.push('');
    return padded.map(function (c) { return parseInline(c).text; });
  });
  const table = body.appendTable(plainRows);
  table.setBorderColor('#dadce0');
  for (let r = 0; r < rows.length; r++) {
    for (let c = 0; c < width; c++) {
      const cell = table.getCell(r, c);
      applyInline(cell.editAsText(), parseInline(rows[r][c] || ''));
      if (r === 0) {
        cell.editAsText().setBold(true);
        cell.setBackgroundColor('#f1f3f4');
      }
    }
  }
}

function appendRich(element, markdownText) {
  const parsed = parseInline(markdownText);
  element.setText(parsed.text);
  if (parsed.text.length > 0) applyInline(element.editAsText(), parsed);
  return element;
}

function applyInline(text, parsed) {
  parsed.styles.forEach(function (s) {
    if (s.end < s.start) return;
    if (s.type === 'bold') text.setBold(s.start, s.end, true);
    if (s.type === 'italic') text.setItalic(s.start, s.end, true);
    if (s.type === 'code') text.setFontFamily(s.start, s.end, 'Roboto Mono').setForegroundColor(s.start, s.end, '#188038');
  });
}

function parseInline(input) {
  const src = input.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
  let text = '';
  const styles = [];
  const re = /\*\*([^*]+)\*\*|`([^`]+)`|\*([^*]+)\*/g;
  let last = 0;
  let m;
  while ((m = re.exec(src)) !== null) {
    text += src.slice(last, m.index);
    const inner = m[1] || m[2] || m[3];
    const type = m[1] ? 'bold' : m[2] ? 'code' : 'italic';
    styles.push({ type: type, start: text.length, end: text.length + inner.length - 1 });
    text += inner;
    last = re.lastIndex;
  }
  text += src.slice(last);
  return { text: text, styles: styles };
}
