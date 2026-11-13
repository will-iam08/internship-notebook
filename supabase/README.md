# Optional Supabase sync

The browser edition works locally without configuration or an account. Supabase sync uses native `fetch` for Auth and PostgREST; it adds no runtime dependencies. The Java Server Edition does not use it.

## Set up a project

1. Create a project in the [Supabase Dashboard](https://supabase.com/dashboard).
2. Open **SQL Editor**, paste [schema.sql](schema.sql), and run the whole script. It creates one notebook row per user, ownership policies, and a server timestamp trigger. It can be rerun without deleting notebook data.
3. Under **Authentication → Sign In / Providers**, enable **Email** sign-in. Create an email/password user under **Authentication → Users → Add user** and confirm the email before signing in. This app provides sign-in only; account creation and password management remain in Supabase.
4. Copy the **Project URL** and the legacy **anon public key** from the project's connection/API settings. Never copy the `service_role` key or a secret key into browser files.
5. Fill in the empty values in [`src/main/resources/public/runtime-config.js`](../src/main/resources/public/runtime-config.js):

   ```js
   window.__SUPABASE__ = {
     url: "https://YOUR_PROJECT_REF.supabase.co",
     anonKey: "YOUR_ANON_PUBLIC_KEY"
   };
   ```

   `index.html` already loads this external script before the app's module. The app's Content Security Policy blocks arbitrary inline scripts. If you use a custom Supabase hostname, allow its exact HTTPS origin in the `connect-src` policy too.
6. Run `npm run build`, publish the resulting static files, and open **Settings → Cloud sync**. Sign in, then choose **Sync now**. Repeat on another device using the same account.

## Behavior and limits

Sync happens when you choose **Sync now**. Signing in alone does not upload the notebook. Entries keep using the existing local browser storage. Credentials and the access token stay in memory; reloading the page or an expired session requires signing in again.

Sync compares the notebook's `updatedAt` edit timestamp: the newer whole notebook wins, equal timestamps do nothing, and an empty cloud slot receives the local notebook. This replaces a whole copy rather than merging individual pages. The SQL trigger rejects older or equal timestamp updates, and the client reads back after uploading to catch a newer concurrent save. Keep device clocks accurate and download a JSON backup before replacing a notebook you need to keep. The table's `updated_at` is the server receipt timestamp, separate from the notebook's edit timestamp.

## Security and disabling

The anon key is safe to ship with this schema: it identifies the project, while [Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security) checks `auth.uid() = user_id` for every notebook read and write. Signed-out requests have no notebook access, and users cannot read or overwrite another user's row. Do not disable RLS or use a privileged key in the browser.

The notebook is readable by the project owner through Supabase; it is not end-to-end encrypted. Anyone using the same unlocked browser profile can still read the local notebook. Removing an Auth user in the Dashboard also deletes that user's cloud notebook through the foreign key; it leaves browser copies intact.

To disable cloud sync, leave `window.__SUPABASE__` unset or set both values to empty strings, then rebuild/redeploy the static files and reload while online to refresh the PWA cache. The Cloud sync card disappears and no Supabase requests are made. Existing local notebooks remain available; disabling configuration does not delete existing cloud rows.
