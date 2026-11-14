-- Run once in the existing project's SQL editor. Rerunning keeps existing counts.
begin;

create table if not exists public.notebook_usage (
  day date not null,
  visitor uuid not null,
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  page_views integer not null default 0 check (page_views between 0 and 10000),
  pages jsonb not null default '{}'::jsonb,
  primary key (day, visitor)
);
alter table public.notebook_usage enable row level security;
revoke all on public.notebook_usage from public, anon, authenticated;

-- This write-only RPC cannot read or modify notebook content or return visitor records.
create or replace function public.record_notebook_usage(p_visitor uuid, p_page text, p_page_view boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  today date := (statement_timestamp() at time zone 'UTC')::date;
  increment integer := case when p_page_view then 1 else 0 end;
begin
  if p_visitor is null or p_page is null or p_page_view is null or
    not (p_page = any(array['welcome','today','board','notebook','insights','deleted','settings','entry','setup','build','export','signup'])) then
    raise exception 'Invalid usage event' using errcode = '22023';
  end if;
  insert into public.notebook_usage as u (day, visitor, page_views, pages)
  values (today, p_visitor, increment, case when p_page_view then jsonb_build_object(p_page, 1) else '{}'::jsonb end)
  on conflict (day, visitor) do update
    set last_seen = statement_timestamp(),
        page_views = least(u.page_views + increment, 10000),
        pages = case when p_page_view then jsonb_set(u.pages, array[p_page],
          to_jsonb(least(coalesce((u.pages->>p_page)::integer, 0) + 1, 10000))) else u.pages end;
end;
$$;
revoke all on function public.record_notebook_usage(uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.record_notebook_usage(uuid, text, boolean) to anon, authenticated;

-- Private summaries for the owner in Supabase's Table Editor or SQL Editor.
create or replace view public.notebook_usage_daily with (security_invoker = true) as
select day, count(*) as visitors, sum(page_views) as page_views,
       count(*) filter (where last_seen > statement_timestamp() - interval '5 minutes') as active_last_5_minutes
from public.notebook_usage group by day;

create or replace view public.notebook_usage_pages with (security_invoker = true) as
select day, page.key as page, sum(page.value::integer) as page_views
from public.notebook_usage, lateral jsonb_each_text(pages) as page
group by day, page.key;

revoke all on public.notebook_usage_daily, public.notebook_usage_pages from public, anon, authenticated;
notify pgrst, 'reload schema';
commit;
