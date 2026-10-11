-- Train Bot trial combos on the server (owner 2026-10-11). Run after
-- sql/combo-screening.sql. Safe to run more than once.
--
-- Before: Train Bot remembered a tried trial combo only in that browser
-- (localStorage, newest one only), so the server kept naming the same combo
-- and Train Bot skipped it until idle training tried it.
-- Now: Train Bot reports the trial when round 1 starts (won = null) and
-- again when the run ends (won = the final champion carries the combo).
-- _combo_gate1 leaves out a combo already tried against the current champion,
-- so idle_trial_combo() and combo_screen_due() move on to the next one.

create table if not exists public.combo_train_trials (
  id          bigserial primary key,
  signature   text not null,
  champion_id bigint not null,
  user_id     uuid not null,
  won         boolean,
  at          timestamptz not null default now(),
  unique (signature, champion_id, user_id)
);
alter table public.combo_train_trials enable row level security;   -- no client policies: RPCs only

-- p_won null = the trial starts; true / false = how it ended (updates the row).
create or replace function public.report_combo_trial(p_signature text, p_won boolean default null)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare
  me uuid := auth.uid();
  v_ch bot_champion_weights;
begin
  if me is null then raise exception 'sign in first'; end if;
  v_ch := _idle_champion();
  if v_ch.id is null then return jsonb_build_object('ok', false, 'reason', 'no champion'); end if;
  if p_won is not null then
    update combo_train_trials set won = p_won
     where user_id = me and signature = p_signature and won is null
       and id = (select max(id) from combo_train_trials where user_id = me and signature = p_signature);
    return jsonb_build_object('ok', found);
  end if;
  if (select count(*) from combo_train_trials where user_id = me and at > now() - interval '24 hours') >= 10 then
    return jsonb_build_object('ok', false, 'reason', 'too many today');
  end if;
  -- only a combo the server would name right now (screened, due)
  if public.idle_trial_combo() is distinct from p_signature then
    return jsonb_build_object('ok', false, 'reason', 'not due');
  end if;
  insert into combo_train_trials (signature, champion_id, user_id) values (p_signature, v_ch.id, me)
  on conflict (signature, champion_id, user_id) do nothing;
  return jsonb_build_object('ok', true);
end;
$$;

-- Same as sql/combo-screening.sql, plus: not tried by Train Bot against this champion.
create or replace function public._combo_gate1(p_ch public.bot_champion_weights)
returns table (signature text, games integer, avg_gain real)
language sql stable security definer set search_path to 'public'
as $$
  select f.signature, count(distinct coalesce(f.game_key, f.id::text))::integer, avg(f.gain)::real
    from bot_combo_finds f
   group by f.signature
  having count(distinct coalesce(f.game_key, f.id::text)) >= 5
     and not coalesce(p_ch.weights->'extraCombos', '[]'::jsonb) ? f.signature
     and f.signature not in (select g.signature from public.get_bot_combos() g)
     and not exists (select 1 from idle_candidates c where c.champion_id = p_ch.id and c.kind = 'combo'
                       and coalesce(c.weights->'extraCombos', '[]'::jsonb) ? f.signature)
     and not exists (select 1 from combo_train_trials t where t.champion_id = p_ch.id and t.signature = f.signature);
$$;
revoke all on function public._combo_gate1(public.bot_champion_weights) from public, anon, authenticated;

revoke all on function public.report_combo_trial(text, boolean) from public, anon;
grant execute on function public.report_combo_trial(text, boolean) to authenticated;

select to_regclass('public.combo_train_trials') is not null as table_ok,
       exists (select 1 from pg_proc where proname = 'report_combo_trial') as function_ok;
