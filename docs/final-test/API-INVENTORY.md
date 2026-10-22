# Published production API inventory

Captured 22 October 2026 after backend fixes deployed on revision `zomaal-backend-00073-c2b`. Full schemas, permissions and request/response contracts are in [the production snapshot](./openapi.production.json).

331 paths / 405 operations. Publication is not a claim that every operation or provider/device flow passed acceptance. See [current status](./CURRENT-STATUS.md) and the [backend verification log](../backend-live-audit-fixes-2026-10-22.md).

| Method | Path | API tags | Summary |
| --- | --- | --- | --- |
| GET | `/access/me` | Access | Session bootstrap — who am I and what can I do? |
| GET | `/access/permissions` | Access | Permission catalogue for Add/Edit Staff toggles |
| GET | `/admin/activity` | Admin Activity Log | Audit trail of every super admin write, newest first |
| POST | `/admin/auth/login` | Admin Auth | Sign in to the Zomaal Shop admin panel |
| POST | `/admin/auth/logout` | Admin Auth | Revoke the current refresh token |
| POST | `/admin/auth/refresh` | Admin Auth | Exchange a refresh token for a new token pair |
| GET | `/admin/customers/blacklisted` | Admin Platform Oversight | Blacklisted customers across all merchants |
| GET | `/admin/dashboard/summary` | Admin Platform Oversight | Dashboard: catalog, merchant, order, integration and blacklist KPIs, signups trend, recent admin activity |
| GET | `/admin/integrations` | Admin Platform Oversight | Every merchant's Shopify/YouCan/Lightfunnels connection, with health |
| GET | `/admin/me` | Admin Auth | Get the signed-in super admin identity |
| PATCH | `/admin/me/password` | Admin Auth | Change the super admin password |
| GET | `/admin/merchants` | Admin Merchants | List Zomaal merchants (store-owning users) |
| GET | `/admin/merchants/{userId}` | Admin Merchants | Get one merchant |
| PATCH | `/admin/merchants/{userId}` | Admin Merchants | Edit a merchant's store details, or activate/suspend them |
| DELETE | `/admin/merchants/{userId}` | Admin Merchants | Permanently delete a merchant account |
| GET | `/admin/merchants/{userId}/overview` | Admin Merchants | Merchant detail: connections, staff, order stats, recent orders, customers |
| GET | `/admin/merchants/{userId}/subscription` | Admin Billing | A merchant's subscription and billing history |
| POST | `/admin/merchants/{userId}/subscription/activate` | Admin Billing | Record a payment received outside the app and activate / extend the plan |
| POST | `/admin/merchants/{userId}/subscription/extend-trial` | Admin Billing | Give a merchant extra free-trial days |
| GET | `/admin/plans` | Admin Billing | All plans, including inactive ones |
| POST | `/admin/plans` | Admin Billing | Create a plan (prices are set here, never hardcoded) |
| PATCH | `/admin/plans/{planId}` | Admin Billing | Update a plan |
| GET | `/admin/shop/banners` | Admin Shop Operations | Shop home banners |
| POST | `/admin/shop/banners` | Admin Shop Operations | Create a banner (then upload its image) |
| PATCH | `/admin/shop/banners/{id}` | Admin Shop Operations | Update a banner |
| DELETE | `/admin/shop/banners/{id}` | Admin Shop Operations | Delete a banner |
| POST | `/admin/shop/banners/{id}/image` | Admin Shop Operations | Upload or replace the banner image (JPEG/PNG/WebP, max 5 MB) |
| GET | `/admin/shop/categories` | Admin Shop Catalog | List shop categories |
| POST | `/admin/shop/categories` | Admin Shop Catalog | Create a shop category |
| PATCH | `/admin/shop/categories/{id}` | Admin Shop Catalog | Update a shop category |
| DELETE | `/admin/shop/categories/{id}` | Admin Shop Catalog | Delete a shop category |
| GET | `/admin/shop/orders` | Admin Shop Operations | All merchant orders from the Zomaal Shop |
| GET | `/admin/shop/orders/export` | Admin Shop Operations | Export orders as CSV (same filters as the list) |
| GET | `/admin/shop/orders/{id}` | Admin Shop Operations | Order detail |
| POST | `/admin/shop/orders/{id}/cancel` | Admin Shop Operations | Cancel an order before delivery (stock is returned) |
| PATCH | `/admin/shop/orders/{id}/note` | Admin Shop Operations | Internal note (never shown to the merchant) |
| POST | `/admin/shop/orders/{id}/status` | Admin Shop Operations | Move an order forward: CONFIRMED → SHIPPED → DELIVERED |
| GET | `/admin/shop/products` | Admin Shop Catalog | List shop products |
| POST | `/admin/shop/products` | Admin Shop Catalog | Create a shop product |
| GET | `/admin/shop/products/export` | Admin Shop Catalog | Export products as CSV (same filters as the list) |
| POST | `/admin/shop/products/import` | Admin Shop Catalog | Import products from CSV |
| PATCH | `/admin/shop/products/{id}` | Admin Shop Catalog | Update a shop product |
| DELETE | `/admin/shop/products/{id}` | Admin Shop Catalog | Delete a shop product |
| GET | `/admin/shop/products/{id}` | Admin Shop Catalog | Get one shop product, including its image gallery |
| POST | `/admin/shop/products/{id}/images` | Admin Shop Catalog | Add images to a product's gallery |
| PATCH | `/admin/shop/products/{id}/images/order` | Admin Shop Catalog | Reorder the gallery — the first image becomes the cover |
| DELETE | `/admin/shop/products/{id}/images/{imageId}` | Admin Shop Catalog | Remove one image from a product gallery |
| PUT | `/admin/shop/products/{id}/specs` | Admin Shop Catalog | Set the Specifications tab rows (replaces the whole list) |
| PUT | `/admin/shop/products/{id}/variants` | Admin Shop Catalog | Set the product options (size / color, each with its own stock and optional price) |
| GET | `/admin/shop/promo-codes` | Admin Shop Operations | Promo codes with usage stats |
| POST | `/admin/shop/promo-codes` | Admin Shop Operations | Create a promo code |
| PATCH | `/admin/shop/promo-codes/{id}` | Admin Shop Operations | Update a promo code |
| DELETE | `/admin/shop/promo-codes/{id}` | Admin Shop Operations | Delete a promo code (past orders keep the code they used) |
| GET | `/admin/shop/settings` | Admin Shop Operations | Shop settings: currency, delivery fee, Cash on Delivery rules |
| PATCH | `/admin/shop/settings` | Admin Shop Operations | Update shop settings |
| GET | `/admin/stores/{storeId}/whatsapp/balance` | Admin WhatsApp | A store's WhatsApp balance and ledger |
| POST | `/admin/stores/{storeId}/whatsapp/balance` | Admin WhatsApp | Credit (or adjust) a store’s WhatsApp balance |
| GET | `/admin/whatsapp/pricing` | Admin WhatsApp | Zomaal price per WhatsApp message, per currency |
| PUT | `/admin/whatsapp/pricing/{currency}` | Admin WhatsApp | Set the price per message for a currency |
| GET | `/ads/campaigns` | Ads | Get tracked campaigns with performance metrics for one platform |
| GET | `/ads/connections` | Ads | List connected ad platform accounts |
| DELETE | `/ads/connections/{id}` | Ads | Disconnect an ad platform account |
| POST | `/ads/google/auth/start` | Ads — Google | Start connecting a Google Ads account |
| GET | `/ads/google/campaigns/{connectionId}` | Ads — Google | List campaigns for "Select Campaigns" |
| POST | `/ads/google/campaigns/{connectionId}/selection` | Ads — Google | Save which campaigns to track ("Save Campaigns") |
| POST | `/ads/google/campaigns/{connectionId}/{externalCampaignId}/status` | Ads — Google | Pause or resume a campaign on Google Ads |
| POST | `/ads/meta/auth/start` | Ads — Meta | Start connecting Meta ad accounts (Facebook / Instagram) |
| GET | `/ads/meta/campaigns/{connectionId}` | Ads — Meta | List campaigns for "Select Campaigns" |
| POST | `/ads/meta/campaigns/{connectionId}/selection` | Ads — Meta | Save which campaigns to track ("Save Campaigns") |
| POST | `/ads/meta/campaigns/{connectionId}/{externalCampaignId}/status` | Ads — Meta | Pause or resume a campaign on Meta |
| GET | `/ads/statistics` | Ads | Get the cross-platform metric breakdown ring chart |
| POST | `/ads/tiktok/auth/start` | Ads — TikTok | Start connecting a TikTok Ads account |
| GET | `/ads/tiktok/campaigns/{connectionId}` | Ads — TikTok | List campaigns for the "Select Campaigns" screen |
| POST | `/ads/tiktok/campaigns/{connectionId}/selection` | Ads — TikTok | Save which campaigns to track ("Save Campaigns") |
| GET | `/app/info` | App | About this App + Privacy Policy links |
| POST | `/auth/change-phone/confirm` | Auth | Edit Profile — confirm a phone number change |
| POST | `/auth/change-phone/request` | Auth | Edit Profile — request a phone number change |
| GET | `/auth/countries` | Auth | Countries for the phone number picker |
| POST | `/auth/forgot-password/request` | Auth | Forgot password — send an OTP |
| POST | `/auth/forgot-password/reset` | Auth | Forgot password — set the new password |
| POST | `/auth/forgot-password/verify` | Auth | Forgot password — verify the OTP |
| GET | `/auth/google-ads/callback` | Ads — Google OAuth | Complete Google Ads OAuth authorization |
| GET | `/auth/lightfunnels/callback` | Lightfunnels OAuth | Complete Lightfunnels OAuth authorization |
| POST | `/auth/login` | Auth | Log in with phone number and password |
| POST | `/auth/logout` | Auth | Log out the current device |
| GET | `/auth/meta-ads/callback` | Ads — Meta OAuth | Complete Meta Ads (Facebook Login) authorization |
| POST | `/auth/refresh` | Auth | Rotate refresh token and issue a new token pair |
| POST | `/auth/send-otp` | Auth | Send OTP to phone number |
| GET | `/auth/shopify/callback` | Shopify OAuth | Complete Shopify authorization |
| GET | `/auth/tiktok/callback` | Ads — TikTok OAuth | Complete TikTok Ads OAuth authorization |
| POST | `/auth/verify-otp` | Auth | Verify OTP and log in or register |
| GET | `/auth/youcan/callback` | YouCan OAuth | Complete YouCan OAuth authorization |
| GET | `/billing/invoices` | Billing | Billing history (owner only), newest first |
| GET | `/billing/plans` | Billing | Plans & Pricing screen — active plans, cheapest first |
| GET | `/billing/subscription` | Billing | Plan & Billing screen, trial banner and locked overlay state |
| POST | `/billing/subscription/cancel` | Billing | Cancel subscription — takes effect at the end of the paid period, no refund |
| POST | `/billing/subscription/resume` | Billing | Undo a pending cancellation before the period ends |
| GET | `/customers` | Customers | Customers list — search, totals, high-risk flag |
| GET | `/customers/blacklist` | Customers | Blacklist screen — total, At Risk Customers, Blacklisted Customers |
| GET | `/customers/blacklist/settings` | Customers | Blacklist Settings screen — current risk limits |
| PUT | `/customers/blacklist/settings` | Customers | Blacklist Settings screen — Save Settings |
| GET | `/customers/duplicate-orders` | Customers | Duplicate Orders screen — groups by same phone |
| POST | `/customers/duplicate-orders/cancel` | Customers | Cancel selected duplicates |
| POST | `/customers/duplicate-orders/{groupId}/keep` | Customers | Not duplicates — keep every order in the group |
| GET | `/customers/{customerId}` | Customers | Customer Details — risk score breakdown + order history |
| POST | `/customers/{customerId}/blacklist` | Customers | Add to Blacklist |
| DELETE | `/customers/{customerId}/blacklist` | Customers | Remove from Blacklist |
| GET | `/ecommerce/connections` | E-commerce Revenue | List connected e-commerce accounts |
| POST | `/ecommerce/connections/{connectionId}/metrics/refresh` | E-commerce Revenue | Refresh product and customer totals for one account |
| POST | `/ecommerce/connections/{connectionId}/sync` | E-commerce Revenue | Synchronize order revenue from one account |
| GET | `/ecommerce/home` | E-commerce Revenue | Get the consolidated e-commerce home-screen payload |
| GET | `/ecommerce/orders` | E-commerce Revenue | List synchronized e-commerce orders |
| GET | `/ecommerce/orders/export` | E-commerce Revenue | Download filtered orders as Excel |
| POST | `/ecommerce/orders/manual` | E-commerce Revenue | Create an order from a non-platform source |
| GET | `/ecommerce/orders/status-summary` | E-commerce Revenue | Get order counts and value by fulfillment/courier outcome |
| POST | `/ecommerce/orders/timeline/backfill` | E-commerce Revenue | Backfill synthetic timeline events for existing YouCan/Lightfunnels orders |
| GET | `/ecommerce/orders/{orderId}` | E-commerce Revenue | Get details of a synchronized e-commerce order |
| POST | `/ecommerce/orders/{orderId}/condition` | E-commerce Revenue | Record a returned product's condition |
| POST | `/ecommerce/orders/{orderId}/dispatch` | E-commerce Revenue | Dispatch an order to a courier |
| GET | `/ecommerce/orders/{orderId}/financials` | E-commerce Revenue | Get an order's financial summary |
| POST | `/ecommerce/orders/{orderId}/financials/sync` | E-commerce Revenue | Re-check the order's shipping status and apply financial events |
| GET | `/ecommerce/orders/{orderId}/fulfillment-preview` | E-commerce Revenue | Fetch live fulfillment details |
| GET | `/ecommerce/orders/{orderId}/products` | E-commerce Revenue | View all product lines on a synchronized order |
| GET | `/ecommerce/orders/{orderId}/shipping-qr` | E-commerce Revenue | Render the order's shipment QR sticker |
| GET | `/ecommerce/orders/{orderId}/timeline` | E-commerce Revenue | Get the event timeline for an order |
| GET | `/ecommerce/returns` | E-commerce Returns | List return requests (Returns screen) |
| POST | `/ecommerce/returns/detect` | E-commerce Returns | Resolve a scan/manual code to a return (Scan + Return Detected screens) |
| GET | `/ecommerce/returns/search` | E-commerce Returns | Search orders for Manual Verification |
| GET | `/ecommerce/returns/summary` | E-commerce Revenue | Get returned-item counts and value by outcome |
| GET | `/ecommerce/returns/{returnRequestId}` | E-commerce Returns | Read a saved return with its component/quantity conditions |
| POST | `/ecommerce/returns/{returnRequestId}/verify` | E-commerce Returns | Record conditions and confirm a return (Return Detected screen "Confirm") |
| GET | `/ecommerce/revenue/summary` | E-commerce Revenue | Get combined revenue totals |
| GET | `/ecommerce/revenue/timeseries` | E-commerce Revenue | Get daily combined revenue |
| GET | `/ecommerce/scan` | E-commerce Revenue | Resolve a scanned shipping barcode/QR to its order and products |
| GET | `/expenses` | Expenses | List/search expenses (Expenses screen) |
| POST | `/expenses` | Expenses | Add an expense (Add Expense screen) |
| GET | `/expenses/ad-spend` | Expenses | Ad spend by platform and ad account ("Ad spend" category) |
| GET | `/expenses/categories` | Expenses | List expense categories (Add Expense / Create Category screens) |
| POST | `/expenses/categories` | Expenses | Create an expense category (Create Category screen) |
| PATCH | `/expenses/categories/{categoryId}` | Expenses | Update an expense category |
| DELETE | `/expenses/categories/{categoryId}` | Expenses | Delete an expense category |
| POST | `/expenses/receipts` | Expenses | Upload a receipt photo (Add Expense / Add Salary Record screens) |
| GET | `/expenses/receipts/{assetId}` | Expenses | Read a private receipt photo |
| GET | `/expenses/summary` | Expenses | Totals by group (Expenses Breakdown screen) |
| GET | `/expenses/trend` | Expenses | Monthly totals (Expenses line chart) |
| GET | `/expenses/{expenseId}` | Expenses | Get one expense (Expense details screen) |
| PATCH | `/expenses/{expenseId}` | Expenses | Edit an expense |
| DELETE | `/expenses/{expenseId}` | Expenses | Delete an expense |
| POST | `/lightfunnels/auth/start` | Lightfunnels | Start connecting a Lightfunnels account |
| GET | `/lightfunnels/connection` | Lightfunnels | Get the current store’s Lightfunnels connection status |
| DELETE | `/lightfunnels/connection` | Lightfunnels | Remove locally stored Lightfunnels credentials |
| POST | `/lightfunnels/connection/verify` | Lightfunnels | Verify stored credentials with Lightfunnels |
| GET | `/lightfunnels/data/customers` | Lightfunnels Store Data | List customers from the connected Lightfunnels store |
| GET | `/lightfunnels/data/orders` | Lightfunnels Store Data | List orders from the connected Lightfunnels store |
| GET | `/lightfunnels/data/orders/{id}` | Lightfunnels Store Data | Get complete details for one Lightfunnels order |
| GET | `/lightfunnels/data/products` | Lightfunnels Store Data | List products from the connected Lightfunnels store |
| GET | `/lightfunnels/data/products/{id}` | Lightfunnels Store Data | Get complete details for one Lightfunnels product |
| GET | `/notifications` | Notifications | Notifications list — All / Critical / Warning / Inventory tabs |
| PUT | `/notifications/devices` | Notifications | Register this device for push notifications |
| DELETE | `/notifications/devices/{token}` | Notifications | Stop push on this device (call on logout) |
| POST | `/notifications/evaluate` | Notifications | Owner: refresh notifications for the active store and process its pending inventory alerts |
| POST | `/notifications/read-all` | Notifications | Mark every visible notification (optionally one tab) as read |
| GET | `/notifications/unread-count` | Notifications | Unread badge counts per tab for the calling user |
| POST | `/notifications/{notificationId}/read` | Notifications | Mark one notification as read (idempotent) |
| GET | `/purchases` | Purchases | Purchases List: totals + one row per product (All / Manual / From Shop) |
| POST | `/purchases` | Purchases | Add Purchase (manual / personal / outside the Zomaal Shop) |
| GET | `/purchases/groups/{key}` | Purchases | Purchases Details: product card + history (date, qty, box price, total, supplier and invoice) |
| GET | `/purchases/product-options` | Purchases | Add Purchase → Select Product: your products and packaging (not the Zomaal Shop catalog) |
| PATCH | `/purchases/{id}` | Purchases | Edit a manual purchase (From Shop entries are read-only) |
| DELETE | `/purchases/{id}` | Purchases | Delete a manual purchase |
| GET | `/roles` | Roles | List roles for the store (Staff management screen) |
| POST | `/roles` | Roles | Create a role (owner-only) |
| PATCH | `/roles/{roleId}` | Roles | Update a role (owner-only) |
| DELETE | `/roles/{roleId}` | Roles | Delete a role (owner-only) |
| GET | `/shipping/ameex/connection` | Shipping - Ameex | Check Ameex connection |
| POST | `/shipping/ameex/connection` | Shipping - Ameex | Validate and connect an Ameex account |
| DELETE | `/shipping/ameex/connection` | Shipping - Ameex | Disconnect Ameex |
| GET | `/shipping/ameex/overview` | Shipping - Ameex | Get Ameex overview analytics |
| POST | `/shipping/ameex/parcels` | Shipping - Ameex | Create and locally store an Ameex parcel |
| GET | `/shipping/ameex/provider/parcels/{code}` | Shipping - Ameex | Get raw Ameex parcel information |
| GET | `/shipping/ameex/provider/parcels/{code}/tracking` | Shipping - Ameex | Get raw Ameex tracking history |
| GET | `/shipping/ameex/shipments` | Shipping - Ameex | List locally stored Ameex shipments |
| POST | `/shipping/ameex/shipments/sync` | Shipping - Ameex | Import and synchronize Ameex shipments |
| GET | `/shipping/ameex/shipments/{code}` | Shipping - Ameex | Get one locally stored Ameex shipment |
| POST | `/shipping/ameex/shipments/{code}/refresh` | Shipping - Ameex | Refresh or import one Ameex shipment |
| GET | `/shipping/ameex/shipments/{code}/timeline` | Shipping - Ameex | Get an Ameex shipment timeline |
| GET | `/shipping/ameex/statuses` | Shipping - Ameex | Get Ameex parcel statuses |
| POST | `/shipping/ameex/webhook` | Provider Webhooks | Receive an Ameex parcel status webhook |
| GET | `/shipping/forcelog/cities` | Shipping - ForceLog | List ForceLog cities |
| GET | `/shipping/forcelog/connection` | Shipping - ForceLog | Check ForceLog account connection |
| POST | `/shipping/forcelog/connection` | Shipping - ForceLog | Connect or replace the current user's ForceLog account |
| DELETE | `/shipping/forcelog/connection` | Shipping - ForceLog | Disconnect the current user's ForceLog account |
| GET | `/shipping/forcelog/overview` | Shipping - ForceLog | Get ForceLog overview analytics |
| POST | `/shipping/forcelog/parcels` | Shipping - ForceLog | Add a ForceLog parcel |
| POST | `/shipping/forcelog/parcels/relaunch` | Shipping - ForceLog | Relaunch a ForceLog parcel to a new customer |
| POST | `/shipping/forcelog/parcels/relaunch-zone` | Shipping - ForceLog | Relaunch a ForceLog parcel to a new city |
| GET | `/shipping/forcelog/parcels/{code}` | Shipping - ForceLog | Get ForceLog parcel details |
| DELETE | `/shipping/forcelog/parcels/{code}` | Shipping - ForceLog | Delete a ForceLog parcel with NEW_PARCEL status |
| GET | `/shipping/forcelog/parcels/{code}/sticker` | Shipping - ForceLog | Get a ForceLog parcel sticker as base64 PDF |
| POST | `/shipping/forcelog/pickups` | Shipping - ForceLog | Create a ForceLog pickup request |
| POST | `/shipping/forcelog/returns` | Shipping - ForceLog | Request a ForceLog parcel return |
| POST | `/shipping/forcelog/returns/eligible` | Shipping - ForceLog | Get ForceLog parcels eligible for return |
| GET | `/shipping/forcelog/shipments` | Shipping - ForceLog | List locally stored ForceLog shipments |
| POST | `/shipping/forcelog/shipments/sync` | Shipping - ForceLog | Refresh locally known ForceLog shipments |
| GET | `/shipping/forcelog/shipments/{code}` | Shipping - ForceLog | Get one locally stored ForceLog shipment |
| POST | `/shipping/forcelog/shipments/{code}/refresh` | Shipping - ForceLog | Refresh or import one ForceLog shipment |
| GET | `/shipping/forcelog/shipments/{code}/timeline` | Shipping - ForceLog | Get a stored ForceLog shipment timeline |
| GET | `/shipping/forcelog/stock` | Shipping - ForceLog | List ForceLog stock products |
| POST | `/shipping/forcelog/stock/products` | Shipping - ForceLog | Add a ForceLog stock product |
| GET | `/shipping/home` | Shipping Overview | Get unified shipping home metrics |
| GET | `/shipping/integrations` | Shipping Integrations | Load the complete shipping integration catalog |
| POST | `/shipping/integrations/suggestions` | Shipping Integrations | Suggest a shipping courier |
| POST | `/shipping/integrations/{companyCode}/connection` | Shipping Integrations | Connect or replace a shipping company account |
| DELETE | `/shipping/integrations/{companyCode}/connection` | Shipping Integrations | Disconnect a shipping company account |
| GET | `/shipping/ozoneexpress/cities` | Shipping - OzoneExpress | List OzoneExpress cities |
| GET | `/shipping/ozoneexpress/connection` | Shipping - OzoneExpress | Check OzoneExpress account connection |
| POST | `/shipping/ozoneexpress/connection` | Shipping - OzoneExpress | Connect or replace the current user's OzoneExpress account |
| DELETE | `/shipping/ozoneexpress/connection` | Shipping - OzoneExpress | Disconnect the current user's OzoneExpress account |
| POST | `/shipping/ozoneexpress/delivery-notes` | Shipping - OzoneExpress | Create an OzoneExpress delivery note |
| POST | `/shipping/ozoneexpress/delivery-notes/parcels` | Shipping - OzoneExpress | Add parcels to an OzoneExpress delivery note |
| POST | `/shipping/ozoneexpress/delivery-notes/save` | Shipping - OzoneExpress | Save an OzoneExpress delivery note |
| GET | `/shipping/ozoneexpress/delivery-notes/{ref}/pdf-links` | Shipping - OzoneExpress | Get OzoneExpress delivery note PDF links |
| GET | `/shipping/ozoneexpress/overview` | Shipping - OzoneExpress | Get OzoneExpress overview analytics |
| POST | `/shipping/ozoneexpress/parcels` | Shipping - OzoneExpress | Add an OzoneExpress parcel |
| GET | `/shipping/ozoneexpress/parcels/{trackingNumber}` | Shipping - OzoneExpress | Get OzoneExpress parcel information |
| GET | `/shipping/ozoneexpress/shipments` | Shipping - OzoneExpress | List locally stored OzoneExpress shipments |
| POST | `/shipping/ozoneexpress/shipments/sync` | Shipping - OzoneExpress | Refresh locally known OzoneExpress shipments |
| GET | `/shipping/ozoneexpress/shipments/{trackingNumber}` | Shipping - OzoneExpress | Get one locally stored OzoneExpress shipment |
| POST | `/shipping/ozoneexpress/shipments/{trackingNumber}/refresh` | Shipping - OzoneExpress | Refresh or import one OzoneExpress shipment |
| GET | `/shipping/ozoneexpress/shipments/{trackingNumber}/timeline` | Shipping - OzoneExpress | Get a stored OzoneExpress shipment timeline |
| POST | `/shipping/ozoneexpress/tracking` | Shipping - OzoneExpress | Track one or more OzoneExpress parcels |
| GET | `/shipping/providers/{provider}/connection` | Shipping - Shared Providers | Get normalized courier connection status |
| GET | `/shipping/providers/{provider}/overview` | Shipping - Shared Providers | Get normalized courier analytics |
| GET | `/shipping/providers/{provider}/shipments` | Shipping - Shared Providers | List normalized courier shipments |
| GET | `/shipping/providers/{provider}/shipments/{code}` | Shipping - Shared Providers | Get normalized shipment details |
| GET | `/shipping/providers/{provider}/shipments/{code}/timeline` | Shipping - Shared Providers | Get a normalized shipment timeline |
| POST | `/shipping/providers/{provider}/sync` | Shipping - Shared Providers | Run normalized manual courier synchronization |
| GET | `/shipping/quicklivraison/cities` | Shipping - QuickLivraison | List QuickLivraison city IDs |
| GET | `/shipping/quicklivraison/cities/fees-delays` | Shipping - QuickLivraison | List QuickLivraison cities with fees and delays |
| GET | `/shipping/quicklivraison/connection` | Shipping - QuickLivraison | Check QuickLivraison account connection |
| POST | `/shipping/quicklivraison/connection` | Shipping - QuickLivraison | Connect or replace the current user's QuickLivraison account |
| DELETE | `/shipping/quicklivraison/connection` | Shipping - QuickLivraison | Disconnect the current user's QuickLivraison account |
| POST | `/shipping/quicklivraison/deliveries` | Shipping - QuickLivraison | Create a QuickLivraison delivery |
| GET | `/shipping/quicklivraison/deliveries` | Shipping - QuickLivraison | List QuickLivraison deliveries |
| POST | `/shipping/quicklivraison/deliveries/bulk` | Shipping - QuickLivraison | Create QuickLivraison deliveries in bulk |
| GET | `/shipping/quicklivraison/deliveries/{trackingNumber}` | Shipping - QuickLivraison | Track a QuickLivraison delivery by tracking number |
| GET | `/shipping/quicklivraison/overview` | Shipping - QuickLivraison | Get QuickLivraison overview analytics |
| GET | `/shipping/quicklivraison/products` | Shipping - QuickLivraison | List QuickLivraison products in stock |
| GET | `/shipping/quicklivraison/shipments` | Shipping - QuickLivraison | List locally stored QuickLivraison shipments |
| POST | `/shipping/quicklivraison/shipments/sync` | Shipping - QuickLivraison | Synchronize existing QuickLivraison shipments |
| GET | `/shipping/quicklivraison/shipments/{trackingNumber}` | Shipping - QuickLivraison | Get one locally stored QuickLivraison shipment |
| GET | `/shipping/quicklivraison/shipments/{trackingNumber}/timeline` | Shipping - QuickLivraison | Get a QuickLivraison shipment timeline |
| POST | `/shipping/quicklivraison/webhook` | Provider Webhooks | Receive a QuickLivraison webhook event |
| GET | `/shipping/sendit/connection` | Shipping - Sendit | Check Sendit account connection |
| POST | `/shipping/sendit/connection` | Shipping - Sendit | Connect or replace the current user's Sendit account |
| DELETE | `/shipping/sendit/connection` | Shipping - Sendit | Disconnect the current user's Sendit account |
| GET | `/shipping/sendit/deliveries` | Shipping - Sendit | List Sendit deliveries |
| POST | `/shipping/sendit/deliveries` | Shipping - Sendit | Create a Sendit delivery |
| POST | `/shipping/sendit/deliveries/labels` | Shipping - Sendit | Generate Sendit delivery labels |
| GET | `/shipping/sendit/deliveries/statuses` | Shipping - Sendit | List Sendit delivery statuses |
| GET | `/shipping/sendit/deliveries/{code}` | Shipping - Sendit | Get a Sendit delivery |
| PUT | `/shipping/sendit/deliveries/{code}` | Shipping - Sendit | Replace a Sendit delivery |
| DELETE | `/shipping/sendit/deliveries/{code}` | Shipping - Sendit | Delete a Sendit delivery |
| GET | `/shipping/sendit/districts` | Shipping - Sendit | List Sendit districts and cities |
| GET | `/shipping/sendit/districts/pickup-cities` | Shipping - Sendit | List Sendit pickup cities |
| GET | `/shipping/sendit/districts/{id}` | Shipping - Sendit | Get a Sendit district |
| GET | `/shipping/sendit/overview` | Shipping - Sendit | Get the Sendit courier overview dashboard |
| GET | `/shipping/sendit/pickups` | Shipping - Sendit | List Sendit pickup requests |
| POST | `/shipping/sendit/pickups` | Shipping - Sendit | Create a Sendit pickup request |
| GET | `/shipping/sendit/pickups/{code}` | Shipping - Sendit | Get a Sendit pickup request |
| PUT | `/shipping/sendit/pickups/{code}` | Shipping - Sendit | Update a Sendit pickup request |
| DELETE | `/shipping/sendit/pickups/{code}` | Shipping - Sendit | Delete a Sendit pickup request |
| GET | `/shipping/sendit/returns` | Shipping - Sendit | List Sendit return requests |
| POST | `/shipping/sendit/returns` | Shipping - Sendit | Create a Sendit return request |
| GET | `/shipping/sendit/returns/{code}` | Shipping - Sendit | Get a Sendit return request |
| PUT | `/shipping/sendit/returns/{code}` | Shipping - Sendit | Update a Sendit return request |
| DELETE | `/shipping/sendit/returns/{code}` | Shipping - Sendit | Delete a Sendit return request |
| GET | `/shipping/sendit/shipments` | Shipping - Sendit | List Sendit shipments stored by Zomaal |
| POST | `/shipping/sendit/shipments/sync` | Shipping - Sendit | Synchronize existing Sendit shipments into Zomaal |
| GET | `/shipping/sendit/shipments/{code}` | Shipping - Sendit | Get a Sendit shipment stored by Zomaal |
| GET | `/shipping/sendit/shipments/{code}/timeline` | Shipping - Sendit | Get a stored Sendit shipment timeline |
| POST | `/shipping/sendit/webhook` | Provider Webhooks | Receive a Sendit webhook event |
| GET | `/shop/addresses` | Zomaal Shop | Saved delivery addresses (default first) |
| POST | `/shop/addresses` | Zomaal Shop | Add Address |
| PATCH | `/shop/addresses/{id}` | Zomaal Shop | Edit an address, or make it the default |
| DELETE | `/shop/addresses/{id}` | Zomaal Shop | Delete an address |
| GET | `/shop/cart` | Zomaal Shop | My Cart |
| DELETE | `/shop/cart` | Zomaal Shop | Clear All |
| POST | `/shop/cart/items` | Zomaal Shop | Add to cart (merges with an existing line for the same product/option) |
| PATCH | `/shop/cart/items/{id}` | Zomaal Shop | Change a cart line quantity |
| DELETE | `/shop/cart/items/{id}` | Zomaal Shop | Remove from cart |
| GET | `/shop/categories` | Zomaal Shop | Active categories that have products (with a cover image) |
| POST | `/shop/checkout/preview` | Zomaal Shop | Checkout screen: totals, promo code result, address, payment methods, blockers |
| GET | `/shop/favorites` | Zomaal Shop | Favorites |
| POST | `/shop/favorites/{productId}` | Zomaal Shop | Add a product to favorites (idempotent) |
| DELETE | `/shop/favorites/{productId}` | Zomaal Shop | Remove a product from favorites (idempotent) |
| GET | `/shop/home` | Zomaal Shop | Shop home: banners, categories, popular items, cart & favorites counts |
| POST | `/shop/orders` | Zomaal Shop | Place the order (Confirm Cash on Delivery Order) |
| GET | `/shop/orders` | Zomaal Shop | My Zomaal Shop orders |
| GET | `/shop/orders/{id}` | Zomaal Shop | Order details / Order track |
| POST | `/shop/orders/{id}/cancel` | Zomaal Shop | Cancel a pending order |
| GET | `/shop/products` | Zomaal Shop | Browse/search products (paginated) |
| GET | `/shop/products/popular` | Zomaal Shop | Popular items: featured, then best sellers (90 days), then newest |
| GET | `/shop/products/{id}` | Zomaal Shop | Product Details: gallery, price/sale price, sizes, colors, variants, specifications |
| POST | `/shopify/auth/start` | Shopify | Start connecting a Shopify store |
| GET | `/shopify/connection` | Shopify | Get the current store’s Shopify connection status |
| DELETE | `/shopify/connection` | Shopify | Remove Shopify credentials from Zomaal |
| POST | `/shopify/connection/verify` | Shopify | Verify the connection against Shopify |
| GET | `/shopify/customers` | Shopify Data | List customers from the connected Shopify store |
| GET | `/shopify/orders` | Shopify Data | List orders from the connected Shopify store |
| GET | `/shopify/orders/{orderId}` | Shopify Data | Get complete details for one Shopify order |
| GET | `/shopify/products` | Shopify Data | List products from the connected Shopify store |
| GET | `/shopify/products/{productId}` | Shopify Data | Get complete details for one Shopify product |
| GET | `/shopify/store` | Shopify Data | Get the connected Shopify store overview |
| GET | `/staff` | Staff | List/search staff (Staff management screen) |
| POST | `/staff` | Staff | Add a new staff member (Add New Staff screen) |
| GET | `/staff/salary/payments` | Staff Salary | List salary payments across all staff (All / Paid / Pending / Overdue filters) |
| POST | `/staff/salary/payments` | Staff Salary | Add salary record(s) for selected staff |
| POST | `/staff/salary/payments/{paymentId}/expense` | Staff Salary | Record the linked expense for a paid salary (retry safe) |
| POST | `/staff/salary/payments/{paymentId}/pay` | Staff Salary | Confirm an actual salary payout (retry safe) |
| GET | `/staff/salary/summary` | Staff Salary | Salary tab totals (Total Salary Paid / Pending Payments) |
| GET | `/staff/salary/trend` | Staff Salary | Monthly payout totals across all staff (Salary bar chart) |
| GET | `/staff/{staffId}` | Staff | Staff details (Staff Details screen) |
| PATCH | `/staff/{staffId}` | Staff | Edit a staff member (Edit Staff info screen) |
| POST | `/staff/{staffId}/photo` | Staff | Upload or replace a staff photo (owner only) |
| GET | `/staff/{staffId}/salary` | Staff Salary | Get a staff member's salary profile (Manage Salary Info screen) |
| PUT | `/staff/{staffId}/salary` | Staff Salary | Set/update a staff member's salary profile |
| GET | `/staff/{staffId}/salary/annual-summary` | Staff Salary | Annual salary paid and remaining obligations |
| GET | `/staff/{staffId}/salary/payments` | Staff Salary | List salary payment history for a staff member |
| PATCH | `/staff/{staffId}/status` | Staff | Deactivate or reactivate a staff member |
| POST | `/stores` | Stores | Create a store for the current user |
| GET | `/stores` | Stores | List all stores owned by the current user |
| GET | `/stores/me` | Stores | Get the current (active) store |
| PUT | `/stores/me` | Stores | Update the current (active) store |
| POST | `/stores/me/logo` | Stores | Upload store logo |
| POST | `/stores/select` | Stores | Switch the active store |
| DELETE | `/stores/{storeId}` | Stores | Delete an owned store |
| GET | `/users/me` | Users | Get current user profile |
| PATCH | `/users/me` | Users | Edit Profile — update name, photo, and/or address |
| DELETE | `/users/me` | Users | Delete Account |
| POST | `/users/me/deletion/cancel` | Users | Cancel a pending account deletion |
| PATCH | `/users/me/password` | Users | Change Password |
| POST | `/users/me/photo` | Users | Upload profile photo |
| POST | `/warehouse/barcodes/generate` | Warehouse Barcodes | Generate an available internal Code 128 value |
| POST | `/warehouse/barcodes/labels/batch` | Warehouse Barcodes | Render a multi-page barcode label PDF |
| GET | `/warehouse/barcodes/resolve` | Warehouse Barcodes | Resolve a physical scanner value to store inventory |
| POST | `/warehouse/barcodes/validate` | Warehouse Barcodes | Validate barcode syntax and store availability |
| GET | `/warehouse/barcodes/{barcodeId}/label` | Warehouse Barcodes | Render one printable barcode sticker |
| POST | `/warehouse/categories` | Warehouse Categories | Create a store-owned product category |
| GET | `/warehouse/categories` | Warehouse Categories | List product categories |
| PATCH | `/warehouse/categories/{id}` | Warehouse Categories | Update a product category |
| DELETE | `/warehouse/categories/{id}` | Warehouse Categories | Archive a product category |
| GET | `/warehouse/inventory/items/{id}` | Warehouse Inventory | Get balances for an inventory item |
| POST | `/warehouse/inventory/items/{id}/adjustments` | Warehouse Inventory | Apply an idempotent manual stock adjustment |
| GET | `/warehouse/inventory/items/{id}/movements` | Warehouse Inventory | Get auditable inventory movement history |
| PUT | `/warehouse/inventory/items/{id}/stock` | Warehouse Inventory | Set the final on-hand stock quantity |
| GET | `/warehouse/item-value` | Item Value | Get current warehouse inventory value |
| POST | `/warehouse/media` | Warehouse Media | Upload a temporary private warehouse image |
| DELETE | `/warehouse/media/{id}` | Warehouse Media | Delete an unattached temporary upload |
| GET | `/warehouse/media/{id}/content` | Warehouse Media | Read a private warehouse image |
| GET | `/warehouse/packaging` | Warehouse Packaging | List packaging owned by the current merchant |
| POST | `/warehouse/packaging` | Warehouse Packaging | Add a packaging item |
| GET | `/warehouse/packaging/{id}` | Warehouse Packaging | Packaging details |
| PATCH | `/warehouse/packaging/{id}` | Warehouse Packaging | Edit a packaging item |
| DELETE | `/warehouse/packaging/{id}` | Warehouse Packaging | Archive a packaging item |
| GET | `/warehouse/packaging/{id}/image` | Warehouse Packaging | Read an owned packaging material image |
| POST | `/warehouse/products` | Warehouse Products | Create a complete merchant warehouse product |
| GET | `/warehouse/products` | Warehouse Products | Search and list merchant warehouse products |
| POST | `/warehouse/products/backfill-product-codes` | Warehouse Products | Backfill Product Tracking Codes for existing variants |
| POST | `/warehouse/products/bundles` | Warehouse Products | Create a product bundle from existing variants |
| GET | `/warehouse/products/compare` | Warehouse Products | Compare two products side by side across catalogs |
| GET | `/warehouse/products/compare/export` | Warehouse Products | Export a product comparison as a PDF |
| GET | `/warehouse/products/compare/platforms` | Warehouse Products | List platforms available for Compare Products |
| GET | `/warehouse/products/compare/products` | Warehouse Products | Search products for the Compare Products picker |
| POST | `/warehouse/products/import` | Warehouse Products | Import products from Shopify, YouCan or Lightfunnels |
| GET | `/warehouse/products/{id}` | Warehouse Products | Get a complete warehouse product |
| PATCH | `/warehouse/products/{id}` | Warehouse Products | Edit a warehouse product |
| POST | `/warehouse/products/{id}/activate` | Warehouse Products | Activate or restore a warehouse product |
| POST | `/warehouse/products/{id}/archive` | Warehouse Products | Archive a warehouse product |
| GET | `/warehouse/products/{id}/performance` | Warehouse Products | Get product-level order and financial performance |
| POST | `/webhooks/shopify` | Shopify Webhooks | Receive a Shopify webhook |
| GET | `/webhooks/whatsapp` | WhatsApp Webhooks | Meta webhook verification handshake |
| POST | `/webhooks/whatsapp` | WhatsApp Webhooks | Receive WhatsApp Cloud API webhooks |
| GET | `/whatsapp/analytics` | WhatsApp | Sent / delivered / read / failed and cost over a range |
| GET | `/whatsapp/balance/history` | WhatsApp | Balance ledger: top-ups, message charges, refunds |
| GET | `/whatsapp/config` | WhatsApp | Embedded Signup settings for the Connect WhatsApp button |
| POST | `/whatsapp/connect` | WhatsApp | Finish Embedded Signup and connect the merchant number |
| GET | `/whatsapp/connection` | WhatsApp | The store's WhatsApp number connection |
| PATCH | `/whatsapp/connection` | WhatsApp | Change the language of customer messages |
| DELETE | `/whatsapp/connection` | WhatsApp | Disconnect WhatsApp |
| GET | `/whatsapp/dashboard` | WhatsApp | Balance, price per message and today’s counts |
| GET | `/whatsapp/messages` | WhatsApp | Message log, newest first |
| GET | `/whatsapp/status-settings` | WhatsApp | Which courier statuses send a message, and after what delay |
| PUT | `/whatsapp/status-settings/{trigger}` | WhatsApp | Turn one status message on/off or change its delay |
| GET | `/whatsapp/templates` | WhatsApp | Zomaal templates with text and Meta approval status |
| POST | `/whatsapp/templates/sync` | WhatsApp | Resubmit missing templates and refresh approval statuses from Meta |
| POST | `/youcan/auth/start` | YouCan | Start connecting a YouCan seller account |
| GET | `/youcan/connection` | YouCan | Get the current store’s YouCan connection status |
| DELETE | `/youcan/connection` | YouCan | Remove locally stored YouCan credentials |
| POST | `/youcan/connection/verify` | YouCan | Verify the stored credentials with YouCan |
| GET | `/youcan/data/customers` | YouCan Store Data | List customers from the connected YouCan store |
| GET | `/youcan/data/orders` | YouCan Store Data | List orders from the connected YouCan store |
| GET | `/youcan/data/orders/{id}` | YouCan Store Data | Get complete details for one YouCan order |
| GET | `/youcan/data/products` | YouCan Store Data | List products from the connected YouCan store |
| GET | `/youcan/data/products/{id}` | YouCan Store Data | Get complete details for one YouCan product |
