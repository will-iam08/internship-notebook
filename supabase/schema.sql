-- Apply this whole script in the Supabase SQL editor; rerunning preserves notebooks.
begin;

-- Keep one JSON notebook per account and remove it if its Auth user is deleted.
create table if not exists public.notebooks (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

-- Require an ownership policy for all access through the public Data API.
alter table public.notebooks enable row level security;

-- Remove inherited API grants, including DELETE; anonymous visitors have no access.
revoke all on public.notebooks from anon, authenticated;

-- Signed-in users can read and save; the policies below restrict which row.
grant select, insert, update on public.notebooks to authenticated;

-- Replace this script's SELECT policy safely when rerunning setup.
drop policy if exists notebooks_select_own on public.notebooks;

-- A user may read only the notebook matching their authenticated user ID.
create policy notebooks_select_own on public.notebooks
  for select to authenticated
  using ((select auth.uid()) = user_id);

-- Replace this script's INSERT policy safely when rerunning setup.
drop policy if exists notebooks_insert_own on public.notebooks;

-- A user may create a notebook only for their own authenticated user ID.
create policy notebooks_insert_own on public.notebooks
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

-- Replace this script's UPDATE policy safely when rerunning setup.
drop policy if exists notebooks_update_own on public.notebooks;

-- Check both the existing owner and the replacement owner to prevent reassignment.
create policy notebooks_update_own on public.notebooks
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- Reject stale concurrent upserts, then record server receipt time for accepted edits.
create or replace function public.touch_notebook_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Keep the newer whole notebook if another device saved after the client's read.
  if (new.data->>'updatedAt')::timestamptz <= (old.data->>'updatedAt')::timestamptz then
    return old;
  end if;
  new.updated_at = now();
  return new;
end;
$$;

-- Replace this script's timestamp trigger safely when rerunning setup.
drop trigger if exists notebooks_updated_at on public.notebooks;

-- Refresh updated_at on accepted updates, including PostgREST upserts.
create trigger notebooks_updated_at
  before update on public.notebooks
  for each row execute function public.touch_notebook_updated_at();

-- Install the table, policies, and trigger together.
commit;
