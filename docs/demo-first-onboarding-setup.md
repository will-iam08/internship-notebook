# Demo-first onboarding: manual setup steps

This note covers the two pieces of demo-first onboarding that need you to change settings in the
Firebase console or on GitHub. The app code does not and must not change those settings, so these
steps are yours to do when you are ready. Neither step is required for the feature to ship: the
launch providers are Google and email/password, and email/password already sends its own
confirmation email through Firebase.

## 1. Add GitHub sign-in later (deferred provider)

The sign-up page reserves an empty row in the provider stack so a GitHub button can be added later
without moving the existing buttons. No GitHub code ships today. When you want to turn it on:

1. Register an OAuth app on GitHub
   - Go to GitHub, Settings, Developer settings, OAuth Apps, New OAuth App.
   - Application name: something recognizable, for example "My Internship Notebook".
   - Homepage URL: your site, for example https://internshipnotebook.app/.
   - Authorization callback URL: the Firebase handler for your project,
     https://my-internship-notebook.firebaseapp.com/__/auth/handler
   - Create the app, then copy the Client ID and generate a Client secret.
2. Enable GitHub in Firebase
   - Firebase console, your project, Build, Authentication, Sign-in method.
   - Add a new provider, choose GitHub, paste the Client ID and Client secret, and save.
   - Confirm the callback URL Firebase shows matches the one you set on GitHub.
3. Tell me to wire it up
   - Once the provider is enabled, the code change is small: add a GitHub button in the reserved
     slot and a GithubAuthProvider sign-in path. That is a follow-up task, not part of this feature.

Note: Firebase sends no email for a GitHub (or Google) sign-in, only for email/password accounts.
A welcome email for GitHub sign-ups would need the email service described below.

## 2. Welcome email for Google (and later GitHub) sign-ups (optional, needs approval)

Firebase's built-in email delivery only covers email/password accounts (verification and password
reset). It sends nothing for Google or GitHub sign-ins. So a welcome email for those providers needs
a separate email-sending service. That is new infrastructure and a new dependency, so the app does
not add it until you approve and set it up. Until then, no welcome email is sent for Google sign-ups,
and email/password sign-ups keep using the existing Firebase confirmation email.

If you decide you want welcome emails for provider sign-ups:

1. Choose an email provider (for example a transactional email service) and create an account and
   API key. Note the cost and the sending domain you will verify.
2. Decide where the send runs. A Cloud Function triggered on new-account creation is the usual
   choice, so the secret API key never ships in the browser bundle.
3. Verify your sending domain with the email provider (SPF and DKIM records) so welcome emails are
   not marked as spam.
4. Approve the dependency and tell me the provider. Only then will any welcome-email code be added,
   and it will live server-side (the Cloud Function), not in the client.

Until all of the above is approved and set up, the feature sends no welcome email for Google
sign-ups and adds no email-service dependency.
