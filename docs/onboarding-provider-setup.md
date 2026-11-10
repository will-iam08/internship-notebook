# Onboarding: Optional Provider and Email Service Setup

This document covers the two deferred pieces of the demo-first onboarding that require
manual setup by the site owner before they can go live. Neither is required for the core
onboarding flow: Google sign-in and email/password sign-up work as-is; the GitHub button
slot and the Welcome Email Service are reserved for later.

---

## GitHub OAuth (deferred provider)

The sign-up page reserves an empty slot above the Google button for a future GitHub button.
No GitHub auth code ships yet. When you are ready to add it:

### 1. Create a GitHub OAuth App

1. Go to GitHub Settings -> Developer settings -> OAuth Apps -> New OAuth App.
2. Fill in:
   - Application name: My Internship Notebook
   - Homepage URL: `https://internshipnotebook.app`
   - Authorization callback URL: copy the Firebase OAuth redirect URI from the next step.
3. After creating the app, copy the **Client ID** and generate a **Client Secret**.

### 2. Enable GitHub in Firebase

1. Open the [Firebase Console](https://console.firebase.google.com/) and pick your project.
2. Go to Authentication -> Sign-in method -> Add new provider -> GitHub.
3. Enable it and paste the Client ID and Client Secret from GitHub.
4. Copy the **Firebase OAuth redirect URI** shown and paste it back into the GitHub OAuth
   App's callback URL field (GitHub Settings -> your OAuth App -> Authorization callback URL).
5. Save both sides.

### 3. Add the button in code

The `viewSignup()` function in `js/app.js` has a comment marking where the GitHub button
goes. Add a button in that slot that calls `signInGitHub()` (a new function you add to
`js/cloud.js` following the same pattern as `signInGoogle()`). Wire it in the `actions`
map the same way `cloud-google` is wired. No other sign-up page changes are needed.

### Notes

- Do not ship the button without testing the full redirect flow in your Firebase project.
- Keep the existing Google + email/password paths working while adding GitHub.
- The Firebase SDK version in use already includes GitHub auth support - no SDK upgrade needed.

---

## Welcome Email Service (optional, not wired)

No welcome email code ships with the onboarding feature. Email/password sign-ups rely on
the Firebase verification email that Firebase sends automatically after account creation.

If you want to send a custom welcome email (e.g. with tips on using the notebook), that
requires a separate backend service. The recommended approach:

### Option A: Firebase Cloud Functions + Email provider

1. Enable Cloud Functions in your Firebase project (requires the Blaze billing plan).
2. Write a Cloud Function triggered on `onCreate` for Firebase Auth users:
   - Use an email provider (Resend, Postmark, SendGrid, etc.) to send the welcome email.
   - Include only the user's verified email - do not include application data.
3. Deploy the function with `firebase deploy --only functions`.
4. Test with a new test account before enabling it for real users.

### Option B: Webhook from Firebase Auth

Some email providers accept Firebase Auth webhooks directly. Check your provider's docs.

### What NOT to do

- Do not add any welcome-email code to the browser-side JavaScript. All email sending
  must happen server-side, away from credentials that could be leaked to the browser.
- Do not log application data or notebook content in the welcome email or the Cloud Function.
- Until the service is provisioned and tested, leave the code as-is. The Firebase verification
  email that already ships is sufficient for account security.

---

## Summary of what ships now vs. what does not

| Feature | Ships now | Requires this setup |
| --- | --- | --- |
| Google sign-in | Yes | No |
| Email + password sign-up | Yes | No |
| Firebase verification email | Yes (automatic) | No |
| GitHub sign-in button | Slot reserved, no code | Yes - both steps above |
| Custom welcome email | Not wired | Yes - Cloud Function + provider |
