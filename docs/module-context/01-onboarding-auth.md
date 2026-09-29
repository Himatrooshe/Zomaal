# 1. Onboarding & Auth

## Screens
Get Started · Onboarding slides · Phone Number (WhatsApp / SMS toggle) · Verify OTP · Set Password
· Create Store · Login (Remember me) · Forgot password (phone → OTP → new password → success).

## Data flow (as Figma shows it)
1. The user enters a phone number (default +212) and picks **WhatsApp or SMS** for the OTP.
2. OTP is verified. The user sets a password.
3. **Create Store**: logo, user name, business name, address, city, country ("Morocco — Auto-detected").
4. After this the user lands on Home, with a 7-day free trial banner in the sidebar.
5. Login is phone + password. Forgot password reuses the OTP flow.

## Questions

**Q1.1 (blocker) — Password or numeric passcode?**
One Figma version says "Enter Passcode" and another says "Enter Password".
Assumption: a normal password, minimum 8 characters.
Answer:

**Q1.2 — OTP over WhatsApp: which provider?**
SMS goes through Twilio today. Should WhatsApp OTP also go through Twilio (WhatsApp sender), or through the same WhatsApp
Business API used for automation (tab 15)?
Assumption: Twilio for both.
Answer:

**Q1.3 — How is the country "auto-detected"?**
From the phone prefix, or from IP? Can the user change it later? Does country decide currency, timezone, and
which couriers are listed?
Assumption: from the phone prefix, editable in Create Store, and it drives currency, timezone, and courier list.
Answer:

**Q1.4 — Social login?**
The onboarding screen has an "Apple" text layer. Do we need Sign in with Apple / Google?
Assumption: no, phone only.
Answer:

**Q1.5 — Staff login**
Do staff use the same login screen (phone + password), and land directly in the owner's store?
Assumption: yes. The backend already supports this (see `docs/staff-module.md`).
Answer:

**Q1.6 — When does the free trial start?**
At account creation or at store creation? Is a card required?
Assumption: at store creation, and no card is required.
Answer:
