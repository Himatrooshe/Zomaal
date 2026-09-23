# Commit Safety — No Dummy Data & No Secrets

Use this before every commit (and while implementing). Two failure modes ship easily:

1. Fake/static catalogs mistaken for a working feature
2. Real credentials pasted into code, Swagger examples, OpenAPI, or docs

Either one is a breach or a product bug. Re-read this file before `git commit`.

---

## Part A — No dummy / static data

| Mistake | Bad | OK |
|---|---|---|
| Hardcoded catalog in services/controllers | Fake product arrays returned by an API | Empty list / 404 / platform fetch |
| Live store IDs in unit tests | Real YouCan/Shopify UUIDs & product titles copied from Postman | Synthetic ids (`product-1`, `order-nested`) |
| Dummy rows written to DB to “prove” a feature | `INSERT` of test products/orders left in Postgres | Sync real connected data, or use a disposable local DB you reset |
| Static fallback that looks like real data | Always return `"Sample Product"` / stock `142` | `null`, omit field, or `Product ${id}` only when the platform omitted a name |
| Swagger / DTO `example:` values driving runtime | Examples used in business logic | `@ApiProperty({ example: ... })` only — never read at runtime |

### Dummy-data pre-commit checklist

1. Diff production code (`git diff -- ':!*.spec.ts'`): no product names or store UUIDs from a live curl/Postman session.
2. Specs may invent data — keep it obviously fake. Do not paste live merchant catalog strings into `*.spec.ts`.
3. No new seed/fixture files unless the ticket asked for them.
4. After API tests, prefer platform re-sync over hand-inserted catalog rows.
5. Fallbacks: missing name/image/stock/cost → `null` or ``Product ${id}``, never invented metrics.

---

## Part B — No secrets in GitHub

**Never commit real secrets.** Git history keeps them forever even after a later delete.

### What must never appear in tracked files

| Secret type | Examples | Where it belongs |
|---|---|---|
| Passwords | `LOGGER_PASSWORD`, `SUPERADMIN_PASSWORD`, any real login password | Local `.env` / Secret Manager only |
| API keys & client secrets | `SHOPIFY_API_SECRET`, `YOUCAN_CLIENT_SECRET`, Twilio, courier keys | `.env` / Secret Manager |
| JWT / encryption keys | `JWT_SECRET`, `*_TOKEN_ENCRYPTION_KEY` | `.env` / Secret Manager |
| OAuth / access tokens | Shopify `shpat_…`, bearer JWTs, refresh tokens | Never in repo; never in Swagger examples |
| Cloud credentials | GCP SA JSON, `.gcp-local/credentials.txt` | Already gitignored under `.gcp-local/` |
| Connection strings with passwords | Real `DATABASE_URL=…:password@…` | `.env` / Secret Manager |

### Safe placeholders (use these in committed code)

- Passwords in Swagger / OpenAPI / DTO examples → `your-password`
- Env template (`.env.example`) → empty values or `YOUR_*` / `YOUR_BASE64_32_BYTE_KEY`
- Unit tests → obvious fakes (`client-secret`, `a-secure-test-jwt-secret-with-32-characters`) — never copy from `.env`

### Secrets pre-commit checklist

1. Search the diff for real values:

   ```bash
   git diff --cached -U0 | rg -i 'password|secret|api[_-]?key|token|Bearer |shpat_|-----BEGIN'
   ```

2. Confirm `.env` is **not** staged (`git status` / `git check-ignore -v .env`).
3. Confirm `.gcp-local/` is not staged.
4. Swagger `@ApiProperty({ example })` and OpenAPI `examples` must not use live `LOGGER_PASSWORD` or any production credential.
5. After changing login DTO examples, regenerate or patch `docs/api/openapi.yaml` so it does not reintroduce the real password (`npm run docs:generate` when that is the project workflow).
6. If a secret was ever committed historically: rotate it in the provider **and** scrub Git history (or treat the key as burned). Deleting the line in a new commit is not enough by itself.

### Agent habit (secrets)

- Do **not** print full `.env` contents into chat logs, commits, or docs.
- Do **not** put live curl `Authorization: Bearer …` headers into markdown files.
- Local verification credentials stay in the terminal / agent session only.

---

## Compare Products branch — audit notes

- Runtime paths load Warehouse / Shopify / YouCan / Lightfunnels from APIs + DB — no static catalog.
- Unit-test fixtures use synthetic ids/names only.
- Live Postman/curl used existing store data + YouCan sync; no fake compare catalog inserted for the feature.
- Removed real logger password from Swagger / OpenAPI examples (`your-password` placeholder instead).

---

## Part C — What not to commit as “test helpers”

| Keep | Remove / do not add |
|---|---|
| `src/**/*.spec.ts` unit tests | Checked-in Postman collections (`docs/postman/`) |
| `test/` Nest e2e (`npm run test:e2e`) | `*-postman-testing.md` manual curl guides |
| `docs/api/openapi.yaml` (generated API contract) | Ad-hoc Postman dumps with tokens/passwords |
| Product docs (`shipping-provider-contract.md`, integration notes) | Local scratch folders used only to “prove” a feature |

Manual API checks belong in local Postman/Insomnia (import OpenAPI), not in the repo. Secrets and live JWTs must never land in those guides.

---

## Before every commit

1. Re-read this file.
2. Run the dummy-data scan and the secrets scan above.
3. Confirm you are not adding Postman collections or manual testing markdown with credentials.
4. Only then `git add` / `git commit`.

---

## Related docs (Returns & tracking spine)

- [`returns-module.md`](./returns-module.md) — Returns scope and branch work plan (`update/order-return`). Always merge latest `main` into the feature branch before coding.
- [`product-shipping-tracking-architecture.md`](./product-shipping-tracking-architecture.md) — Client brief for product code ↔ order ↔ shipping tracking across other modules. Do not seed demo returns/orders to “match Figma.”
- Figma placeholders are layout-only — `.cursor/rules/figma-placeholders-not-data.mdc`.
