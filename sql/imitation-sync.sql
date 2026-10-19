-- imitation-sync.sql: "Learn from my play" saved to the account (owner 2026-10-18).
-- Before this, the learned adjustments (js/bot-imitation.js) and the on/off
-- switch lived only in one browser's localStorage, so learning on another
-- device or before a cleared cache was lost. Re-runnable.
--
--   my_imitation_state()                    -> {deltas, enabled, updated_at} or null
--   save_imitation_state(deltas, enabled)   -> upsert (hermit only, like the feature)

create table if not exists public.bot_imitation_state (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  deltas     jsonb not null default '{}'::jsonb,
  enabled    boolean not null default false,
  updated_at timestamptz not null default now()
);
alter table public.bot_imitation_state enable row level security;  -- no client policies: RPCs only

create or replace function public.my_imitation_state()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_hermit() then return null; end if;
  return (select jsonb_build_object('deltas', deltas, 'enabled', enabled, 'updated_at', updated_at)
          from bot_imitation_state where user_id = auth.uid());
end $$;

create or replace function public.save_imitation_state(p_deltas jsonb, p_enabled boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_at timestamptz;
begin
  if not public.is_hermit() then raise exception 'not authorized'; end if;
  if p_deltas is null or jsonb_typeof(p_deltas) <> 'object' then raise exception 'deltas must be an object'; end if;
  if length(p_deltas::text) > 20000 then raise exception 'deltas too big'; end if;
  if exists (select 1 from jsonb_each(p_deltas) where jsonb_typeof(value) <> 'number') then
    raise exception 'deltas must be numbers';
  end if;
  insert into bot_imitation_state (user_id, deltas, enabled, updated_at)
    values (auth.uid(), p_deltas, coalesce(p_enabled, false), now())
  on conflict (user_id) do update set deltas = excluded.deltas, enabled = excluded.enabled, updated_at = now()
  returning updated_at into v_at;
  return jsonb_build_object('ok', true, 'updated_at', v_at);
end $$;

revoke all on function public.my_imitation_state() from public, anon;
grant execute on function public.my_imitation_state() to authenticated;
revoke all on function public.save_imitation_state(jsonb, boolean) from public, anon;
grant execute on function public.save_imitation_state(jsonb, boolean) to authenticated;

-- Check: table and both functions exist.
select 'table' as what, to_regclass('public.bot_imitation_state') is not null as ok
union all select proname, true from pg_proc where proname in ('my_imitation_state', 'save_imitation_state');
