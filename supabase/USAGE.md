# Website usage counts

Apply `usage.sql` in the existing project's Supabase SQL Editor, then run `usage-test.sql` to check write-only access and counting. The tests roll back their synthetic records. Deploy the updated site after both succeed. No secret key belongs in the frontend.

## View the numbers

In the project's SQL Editor, run:

```sql
select * from public.notebook_usage_daily order by day desc;
select * from public.notebook_usage_pages order by day desc, page_views desc;
```

Or open these views in the Table Editor. Refresh to update the numbers. `active_last_5_minutes` counts browsers that have reported visible-tab activity within five minutes; visible tabs report once a minute. Reports are private to the project owner, not available through the public API.

`visitors` counts distinct browser identifiers in a UTC day. An identifier is reused on refresh and rotates each day. It is not a count of registered accounts, verified people, or unique people across multiple days. Summing visitors across days counts browser-days. A returning visitor is intentionally not identified across days.

Page views count initial visits and route changes, including the sample demo. Heartbeats update activity without increasing page views. Entry IDs, URLs, searches, and notebook content are never sent. Localhost and Java/server editions never report. DNT, GPC, opt-out, offline visitors, and blockers reduce counts. Client-generated events can be spoofed, so these are directional usage figures, not audited metrics.

The table keeps daily records until the project owner removes them. Optional retention, run by the owner:

```sql
delete from public.notebook_usage where day < current_date - 90;
```

The public key may execute only `record_notebook_usage`, which validates page categories and returns no records. It cannot select, insert, update, or delete usage rows directly. The RPC never touches `notebooks`, and existing notebook RLS stays unchanged. Do not add an anonymous SELECT policy or put a service-role key in the app to build a public dashboard.
