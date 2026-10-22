# QA Tester Guide — Onboarding and Auth

## Handoff status — 22 October 2026

The retained Bangladesh test account passed production SMS verification, first-password setup, login, store creation and trial read. Morocco SMS was unavailable in the recorded country response. Forgot-password, logo upload, adverse OTP cases and WhatsApp OTP have not been signed off.

[Cross-module status and API gaps](../CURRENT-STATUS.md) · [Production API contract](../openapi.production.json).

This refresh consolidates recorded work; it does not claim a new full regression run. Unchecked UI/QA checklists remain acceptance work. Revision names below identify the version tested at that time.

Updated 22 October 2026 (documentation reconciliation; original test dates are retained).

## References

- Figma: [Onboarding flow](https://www.figma.com/design/6g6gVrZZovSVOOfRB9vPGw/zomal-copy?node-id=1-1990) and [Forgot Password](https://www.figma.com/design/6g6gVrZZovSVOOfRB9vPGw/zomal-copy?node-id=18108-0).
- [Requirements and answers](../../module-context/01-onboarding-auth.md)
- [OpenAPI contract](../openapi.production.json)

## Production checks completed

- [x] SMS OTP send and verification for the user-provided Bangladesh test number.
- [x] First password setup and login.
- [x] Store creation; `GET /stores/me` confirmed it was the current store.
- [x] `GET /billing/subscription` returned `TRIALING`, seven days remaining, and writable access.
- [x] Final login reported `hasPassword=true` and `isProfileCompleted=true`.
- [x] The user asked to retain this account/store for further tests. Do not delete or reset it.
- [ ] Logo upload was not tested.
- [ ] Forgot-password flow was not tested; it changes the account password.

## Environment-specific behavior

Production `GET /auth/countries` reports Morocco with `sms=false`. A Moroccan SMS request returns 400 before Twilio is called. Bangladesh SMS was accepted and verified; this does not prove delivery in Morocco. WhatsApp OTP is excluded from this handoff.

## Remaining QA cases

- [ ] Test password recovery, reset-token expiry, and one-time use with a separate approved account.
- [ ] Test logo upload with a safe image and invalid file types.
- [ ] Re-test Morocco once the allowed phone verification route is confirmed.
- [ ] Check wrong/expired OTP, rate limits, duplicate phone, inactive staff login, and remember-me refresh lifetime.

Never record OTPs, passwords, tokens, full phone numbers, or provider secrets in test artifacts.
