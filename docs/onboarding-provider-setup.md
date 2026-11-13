# Optional account setup

Cloud sync uses Supabase email/password sign-in only, and stays hidden until the site owner supplies runtime configuration. Follow [the Supabase setup guide](../supabase/README.md) to create a project, install the ownership policies, provision users, and enable the Settings card.

The app provides no account creation, OAuth providers, password reset, or welcome-email service. Manage accounts and passwords through the Supabase Dashboard. Existing Firebase accounts and notebooks are not migrated; export a JSON backup from the old app before moving data.
