-- Run after usage.sql. All synthetic events are rolled back.
begin;
set local role anon;
select public.record_notebook_usage('00000000-0000-4000-8000-000000000001', 'today', true);
select public.record_notebook_usage('00000000-0000-4000-8000-000000000001', 'entry', true);
select public.record_notebook_usage('00000000-0000-4000-8000-000000000001', 'entry', false);
do $$
begin
  begin
    perform * from public.notebook_usage;
    raise exception 'Anonymous visitor records were readable';
  exception when insufficient_privilege then null;
  end;
  begin
    perform * from public.notebook_usage_daily;
    raise exception 'Anonymous summaries were readable';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.record_notebook_usage('00000000-0000-4000-8000-000000000001', 'private@example.test', true);
    raise exception 'Arbitrary event data was accepted';
  exception when invalid_parameter_value then null;
  end;
end;
$$;
reset role;
do $$
declare record public.notebook_usage;
begin
  if has_table_privilege('authenticated', 'public.notebook_usage', 'SELECT') or
     has_table_privilege('authenticated', 'public.notebook_usage_daily', 'SELECT') or
     has_table_privilege('authenticated', 'public.notebook_usage_pages', 'SELECT') then
    raise exception 'Authenticated users could read usage reports';
  end if;
  select * into record from public.notebook_usage
    where visitor = '00000000-0000-4000-8000-000000000001' and day = (statement_timestamp() at time zone 'UTC')::date;
  if record.page_views is distinct from 2 or record.pages is distinct from '{"today":1,"entry":1}'::jsonb then
    raise exception 'Page views or heartbeat deduplication failed';
  end if;
end;
$$;
rollback;
select 'Usage checks passed; synthetic events rolled back' as result;
