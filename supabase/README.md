# Optional Supabase sync

The browser edition works locally without configuration or an account. Supabase sync uses native `fetch` for Auth and PostgREST; it adds no runtime dependencies. The Java Server Edition does not use it.

## Set up a project

1. Create a project in the [Supabase Dashboard](https://supabase.com/dashboard).
2. Open **SQL Editor**, paste [schema.sql](schema.sql), and run the whole script. It creates one notebook row per user, ownership policies, and a server timestamp trigger. It can be rerun without deleting notebook data.
3. Under **Authentication → Sign In / Providers**, enable **Email** sign-in and allow new users to sign up. Keep email confirmation enabled if you want addresses verified. Under **Authentication → URL Configuration**, set **Site URL** to the deployed site (for example, `https://internshipnotebook.app/`). Confirmation emails use this URL to return to the site; users then sign in in Settings. Configure the project's [custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp) for confirmation and password-reset email delivery to users. The default mail service is restricted to project team addresses and is unsuitable for public signup.
4. Copy the **Project URL** and a **publishable key** or legacy **anon public key** from the project's connection/API settings. Never copy the `service_role` key or a secret key into browser files.
5. Fill in the empty values in [`src/main/resources/public/runtime-config.js`](../src/main/resources/public/runtime-config.js):

   ```js
   window.__SUPABASE__ = {
     url: "https://YOUR_PROJECT_REF.supabase.co",
     anonKey: "YOUR_PUBLISHABLE_OR_ANON_PUBLIC_KEY"
   };
   ```

   `index.html` already loads this external script before the app's module. The app's Content Security Policy blocks arbitrary inline scripts. If you use a custom Supabase hostname, allow its exact HTTPS origin in the `connect-src` policy too.
6. Run `npm run build`, publish the resulting static files, and open **Settings → Cloud sync → Create account**. Enter an email and password. If confirmation is required, check the email, confirm the address, return to Settings and sign in. If Supabase returns a session immediately, the card signs in immediately. Choose **Sync now**. Repeat on another device using the same account.

## Account creation and recovery

The card handles immediate sessions, confirmation-required signup, identified existing accounts, weak passwords, rate limits, and offline failures. Supabase can obscure an existing account during signup; a response without a session is never treated as signed in. When the response does not identify a duplicate, the card asks the visitor to check email and then sign in. See [Supabase signup behavior](https://supabase.com/docs/reference/javascript/auth-signup).

**Forgot password?** asks for the email and calls Auth's recovery endpoint. Accepted requests show “If that address has an account, a reset email is on its way”; this does not verify account existence or delivery. Network, rate-limit, and server errors are reported instead of claiming success. Password-reset emails require the project's SMTP to be configured. This card requests the email only; it does not include a password-update screen or consume recovery tokens. Configure the recovery email template/redirect to a password-update destination before offering a complete recovery flow.

## Behavior and limits

Sync happens when you choose **Sync now**. Signing in or creating an account alone does not upload the notebook. Entries keep using the existing local browser storage. Passwords are never saved, and access tokens stay in memory only; reloading the page or an expired session requires signing in again.

The whole notebook includes active and recently deleted pages, notes, links, stage history, interview question progress and notes (`interview`), and compact mock-interview history (`mock`, up to the latest five sessions per page). Answers and transcripts are never stored. Browser preferences, pending drafts, demo data, credentials, and tokens are not synced. The Java Server Edition still does not store interview prep or mock history.

Sync uses last-write-wins by the notebook's `updatedAt` edit timestamp: the newer whole notebook wins, equal timestamps do nothing, and an empty cloud slot receives the local notebook. This replaces a whole copy rather than merging individual pages. The SQL trigger rejects older or equal timestamp updates, and the client reads back after uploading to catch a newer concurrent save. Keep device clocks accurate and download a JSON backup before replacing a notebook you need to keep. The table's `updated_at` is the server receipt timestamp, separate from the notebook's edit timestamp.

## Security and disabling

The anon key is safe to ship with this schema: it identifies the project, while [Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security) checks `auth.uid() = user_id` for every notebook read and write. Signed-out requests have no notebook access, and users cannot read or overwrite another user's row. Do not disable RLS or use a privileged key in the browser.

The notebook is readable by the project owner through Supabase; it is not end-to-end encrypted. Anyone using the same unlocked browser profile can still read the local notebook. Removing an Auth user in the Dashboard also deletes that user's cloud notebook through the foreign key; it leaves browser copies intact.

To disable cloud sync, leave `window.__SUPABASE__` unset or set both values to empty strings, then rebuild/redeploy the static files and reload while online to refresh the PWA cache. The Cloud sync card disappears and no Supabase requests are made. Existing local notebooks remain available; disabling configuration does not delete existing cloud rows.
