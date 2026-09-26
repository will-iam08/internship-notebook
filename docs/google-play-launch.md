# Google Play launch checklist

The website is already an installable PWA. The smallest honest Android release is a Trusted Web Activity (TWA), which opens the same HTTPS app full-screen through Chrome instead of maintaining a second UI codebase.

## Complete before packaging

1. Choose and connect a dedicated custom domain. The TWA's Digital Asset Links file is tied to that domain, so packaging against the temporary GitHub Pages URL would create avoidable rework.
2. Keep the privacy policy and account-deletion page publicly reachable at stable URLs.
3. Test Google sign-in, email verification, password reset, sync, conflict handling, and account deletion on the production domain.
4. Create the Play Console developer account. Store registration, identity verification, legal acceptance, and any fee must be completed by the owner.
5. Choose the final Android application ID (suggested: `app.coopcompass.notebook`) and store listing name.

## Package after the domain is final

1. Use Bubblewrap to generate a TWA from the production web manifest.
2. Create and securely back up the Android signing key. Never commit it.
3. Publish `/.well-known/assetlinks.json` on the production domain with the application ID and signing certificate fingerprint.
4. Build an Android App Bundle (`.aab`) and verify the relationship with the Digital Asset Links tester.
5. Complete the Play Data safety form using the behavior documented in `privacy.html`: local browser data; optional Firebase Authentication and Firestore sync; no ads or sale of data.
6. Provide the public privacy-policy and deletion URLs, screenshots, feature graphic, support contact, content rating, and reviewer access instructions.
7. Release to internal testing first, then the required closed/open test track, before production.

Do not add Firebase secrets, service-account JSON, Android keystores, recovery codes, or Play API credentials to this repository.
