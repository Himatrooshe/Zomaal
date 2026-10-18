# WhatsApp automation — what's left

Code is on `main` and deployed. Production currently runs **mock data** (`WHATSAPP_MOCK_DATA=true`), real WhatsApp is off.
Module details: `docs/module-context/15-whatsapp.md`.

## 1. From Zomaal / client (blocks real WhatsApp)
- [ ] Meta Business account + business verification.
- [ ] Meta app (type Business) with the **WhatsApp** product, Tech Provider approval.
- [ ] App review for `whatsapp_business_management` and `whatsapp_business_messaging`.
- [ ] Embedded Signup configuration (Facebook Login for Business).
- [ ] Send us: `META_APP_ID`, `META_APP_SECRET`, `META_WHATSAPP_CONFIG_ID`.

## 2. Backend / ops (after the keys arrive)
- [ ] Generate `WHATSAPP_TOKEN_ENCRYPTION_KEY` (`openssl rand -base64 32`), `META_WHATSAPP_WEBHOOK_VERIFY_TOKEN`
      and `WHATSAPP_SCHEDULER_SECRET` (`openssl rand -hex 32`).
- [ ] Store `META_APP_SECRET`, `WHATSAPP_TOKEN_ENCRYPTION_KEY`, `META_WHATSAPP_WEBHOOK_VERIFY_TOKEN`,
      `WHATSAPP_SCHEDULER_SECRET` in Secret Manager; add them to `secrets:` in `.github/workflows/ci-cd.yml`.
- [ ] Meta webhook: callback `https://zomaal-backend-563898960389.us-central1.run.app/webhooks/whatsapp`,
      same verify token, subscribe `messages`, `message_template_status_update`, `account_update`.
- [ ] Cloud Scheduler: every minute `POST /internal/whatsapp/dispatch` with the scheduler secret header.
- [ ] Cloud Run env: `WHATSAPP_MOCK_DATA=false`, `WHATSAPP_ENABLED=true`, `WHATSAPP_SCHEDULER_ENABLED=true`, `META_APP_ID`, `META_WHATSAPP_CONFIG_ID`.
- [ ] Run the end-to-end QA (section 5 of `Zomaal-WhatsApp-API-QA-Test-Plan.md`).
- [ ] Delete the mock: follow "Removing the mock" in `docs/module-context/15-whatsapp.md`.

## 3. Super admin (can be done now)
- [ ] Set the price per message for each store currency: `PUT /admin/whatsapp/pricing/:currency` (e.g. `MAD`).
      Without it every message fails with `PRICING_NOT_SET`.
- [ ] Add `whatsapp` to `features` of every paid plan that should include it (trials already have it).
- [ ] Credit merchant balances on request: `POST /admin/stores/:storeId/whatsapp/balance`.

## 4. Frontend
- [ ] Build the screens against mock data (guide: `Zomaal-WhatsApp-Frontend-API-Guide.md`, section 0).
- [ ] Wire the Meta Embedded Signup popup once `GET /whatsapp/config` returns a real `appId` (no `mock`).

## Not in v1 (decide later)
Editable message text, image header, per-customer language, Ameex-triggered messages, self-serve balance top-up.
