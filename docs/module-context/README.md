# Module context — data flow + open questions

One file per module (think of each file as a tab). Each file has the same shape:

1. **Screens** — what the Figma (`zomal-copy`, Page 1) section contains.
2. **Data flow (as Figma shows it)** — where the data comes from, who enters it, where it goes.
3. **Questions** — only the things we cannot decide from Figma or the code. Each question has
   our **current assumption**, so often you only need to write "yes" or correct it.
   Questions marked **(blocker)** change the data model or API — answer those first.

Figma numbers, names, phones, and currencies are placeholders. Don't read them as real data.

## Tabs

| # | Module | File |
|---|---|---|
| 0 | Cross-cutting (currency, country, language) | this file, below |
| 1 | Onboarding & Auth | [01-onboarding-auth.md](./01-onboarding-auth.md) |
| 2 | Home dashboard | [02-home-dashboard.md](./02-home-dashboard.md) |
| 3 | Orders (list, details, timeline) | [03-orders.md](./03-orders.md) |
| 4 | Returns | [04-returns.md](./04-returns.md) |
| 5 | Products, bundles, compare | [05-products.md](./05-products.md) |
| 6 | Packaging | [06-packaging.md](./06-packaging.md) |
| 7 | Purchases | [07-purchases.md](./07-purchases.md) |
| 8 | Zomaal Shop & My Orders | [08-zomaal-shop.md](./08-zomaal-shop.md) |
| 9 | Expenses | [09-expenses.md](./09-expenses.md) |
| 10 | Staff & Salary | [10-staff-salary.md](./10-staff-salary.md) |
| 11 | Customers & Risk Center (Blacklist, Duplicates) | [11-customers-risk.md](./11-customers-risk.md) |
| 12 | eCom platform integrations | [12-ecom-platforms.md](./12-ecom-platforms.md) |
| 13 | Shipping companies | [13-shipping.md](./13-shipping.md) |
| 14 | Advertising | [14-advertising.md](./14-advertising.md) |
| 15 | WhatsApp automation | [15-whatsapp.md](./15-whatsapp.md) |
| 16 | Notifications | [16-notifications.md](./16-notifications.md) |
| 17 | Settings, multi-store, plans & billing | [17-settings-billing.md](./17-settings-billing.md) |
| 18 | Apps menu: Reports / Item Value | [18-reports.md](./18-reports.md) |

---

## 0. Cross-cutting questions (affect every module)

Figma mixes **MAD**, **DH**, **$**, and **৳**. It also mixes **Moroccan** (+212, Casablanca) with
**Bangladeshi** (+880, Narayanganj, bKash/SSLCommerz) examples. Shipping tabs show
Morocco / Algeria / Egypt / Tunisia.

**Q0.1 (blocker) — Target markets at launch?**
Assumption: Morocco first, then other North African countries. The Bangladesh examples are designer placeholders.
Answer:

**Q0.2 (blocker) — One currency per store?**
Assumption: each store has one `baseCurrency`, set from its country at store creation. All
dashboards show that currency. When a Shopify store or ad account uses another currency (such as USD),
we convert it to the store currency. What is the conversion source: a daily rate, or should we not convert at all?
Answer:

**Q0.3 — App language(s)?**
The WhatsApp screen mentions English / Arabic / French templates. Should the app UI also support Arabic (RTL) and French?
Assumption: the backend returns codes and enums, and the app translates them. The backend has no i18n.
Answer:

**Q0.4 — Timezone for "Today" / "This month"?**
Assumption: the store's country timezone (Africa/Casablanca for Morocco), not the phone's timezone.
Answer:

**Q0.5 — Who is the Zomaal admin?**
Some data is managed by Zomaal, not the merchant: Shop catalog, promo codes, plans, and courier
list. Is there an admin panel (web) planned, and who builds it?
Assumption: a super-admin API exists, and a separate admin web app uses it.
Answer:
