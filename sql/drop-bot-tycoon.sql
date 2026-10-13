-- Drop the leftovers of the removed Bot Tycoon / Void Knight economy (2026-10-13).
-- The client stopped using these long ago: captured_bots (0 rows), void_knight
-- (1 row), user_profiles.capture_stones, deployed_bots.captured_bot_id (all null),
-- and record_deployed_bot_result(). Re-runnable.
-- admin_delete_user is redefined first because it still deleted from captured_bots.

create or replace function public.admin_delete_user(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not public.is_hermit() then
    raise exception 'not authorized';
  end if;
  if p_user_id = 'a91140c8-20c3-4fa8-81d9-4c65660c4a81'::uuid then
    raise exception 'cannot delete the admin account';
  end if;

  -- Remove this user's data from every table that references them, then the
  -- auth login itself (which cascades auth.identities/sessions/etc.).
  delete from public.deployed_bots   where owner   = p_user_id;
  delete from public.ladder          where user_id = p_user_id;
  delete from public.players         where user_id = p_user_id;
  delete from public.user_activities where user_id = p_user_id;
  delete from public.user_profiles   where user_id = p_user_id;
  delete from auth.users             where id      = p_user_id;
end;
$function$;

do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname = 'record_deployed_bot_result' loop
    execute 'drop function ' || f.sig;
  end loop;
end $$;

alter table public.deployed_bots drop column if exists captured_bot_id;
alter table public.user_profiles drop column if exists capture_stones;
drop table if exists public.captured_bots;
drop table if exists public.void_knight;

-- Check: every row should say false.
select 'captured_bots' as what, to_regclass('public.captured_bots') is not null as still_there
union all select 'void_knight', to_regclass('public.void_knight') is not null
union all select 'capture_stones', exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'user_profiles' and column_name = 'capture_stones')
union all select 'captured_bot_id', exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'deployed_bots' and column_name = 'captured_bot_id')
union all select 'record_deployed_bot_result', exists (select 1 from pg_proc where proname = 'record_deployed_bot_result');
