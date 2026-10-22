# Frontend Developer Guide — Onboarding and Auth

## Handoff status — 22 October 2026

The retained Bangladesh test account passed production SMS verification, first-password setup, login, store creation and trial read. Morocco SMS was unavailable in the recorded country response. Forgot-password, logo upload, adverse OTP cases and WhatsApp OTP have not been signed off.

[Cross-module status and API gaps](../CURRENT-STATUS.md) · [Production API contract](../openapi.production.json).

This refresh consolidates recorded work; it does not claim a new full regression run. Unchecked UI/QA checklists remain acceptance work. Revision names below identify the version tested at that time.

Updated 22 October 2026 (documentation reconciliation; original test dates are retained).

## References

- Figma: [Onboarding flow](https://www.figma.com/design/6g6gVrZZovSVOOfRB9vPGw/zomal-copy?node-id=1-1990) and [Forgot Password](https://www.figma.com/design/6g6gVrZZovSVOOfRB9vPGw/zomal-copy?node-id=18108-0).
- Requirements and API flow: [module context](../../module-context/01-onboarding-auth.md).
- Full request and response schemas: [OpenAPI](../openapi.production.json).

## Backend flow

1. Request SMS verification with `POST /auth/send-otp`. SMS is the default channel.
2. Verify with `POST /auth/verify-otp`. The response includes tokens, `hasPassword`, and `isProfileCompleted`.
3. Set the first password with `PATCH /users/me/password`. Replace both tokens with the returned pair.
4. Create the store with `POST /stores`. This selects the new store and completes onboarding.
5. Read the trial banner from `GET /billing/subscription`.
6. Login uses `POST /auth/login`; `rememberMe` controls refresh-token lifetime.

Forgot password uses `POST /auth/forgot-password/request`, `/auth/forgot-password/verify`, and `/auth/forgot-password/reset`. The reset token expires in ten minutes and is single-use.

## UI behavior

- Load phone country and channel availability from `GET /auth/countries`. Disable channels whose returned flag is false.
- Use E.164 phone format. Production currently reports Morocco SMS disabled; handle the API's 400 response and do not show SMS as available there.
- Show loading, resend timer, wrong/expired code, rate-limit, provider error, and network retry states.
- Route users without a password to Set Password; after that, route users without a completed profile to Create Store; otherwise open Home.
- Store creation requires owner name, business name, address, and city. Country and currency default to Morocco and MAD. Logo is optional and can be uploaded after store creation via `POST /stores/me/logo`.
- Do not log passwords, OTPs, reset tokens, or bearer tokens.
- WhatsApp OTP is excluded from this handoff. The tested path was SMS to a Bangladesh number.

## Verified production flow

SMS send and verification, first password setup, login, store creation, active-store read, and trial read succeeded on the user-provided Bangladesh test account. The user asked to keep this account and store for later flow tests. Forgot-password and logo upload were not tested.
