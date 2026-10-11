-- Combo screening (owner 2026-10-11): trial combos earn their way in by
-- evidence, not by who found them. Replaces the "2+ accounts" rule of
-- sql/combo-trials.sql. Run after sql/bot-combo-finds.sql and sql/combo-trials.sql.
--
-- Gate 1, it recurs: a bot-found combo counts once it was found in 5+
--   different games (bot_combo_finds.game_key, one key per training game).
-- Gate 2, a screening: a browser plays 8 fast games, champion + combo
--   (extraCombos) against the champion, seats swapped, and reports the record
--   (report_combo_screen). It passes when it does not lose (wins >= losses).
--   Train Bot screens one at the start of a run, idle training between games.
-- Gate 3, the trial (sql/combo-trials.sql): idle_trial_combo() now names only
--   SCREENED combos; Train Bot round 1 and idle 'combo' challengers test them.
-- A failed screening is not repeated against the same champion.

-- Gate 1: one key per training game
alter table public.bot_combo_finds add column if not exists game_key text;

drop function if exists public.report_bot_combos(jsonb, text);
create or replace function public.report_bot_combos(p_rows jsonb, p_source text default null, p_game text default null)
returns integer
language plpgsql security definer set search_path to 'public'
as $$
declare
  me uuid := auth.uid();
  v_row jsonb;
  v_n integer := 0;
begin
  if me is null then raise exception 'sign in first'; end if;
  if jsonb_typeof(coalesce(p_rows, '[]'::jsonb)) <> 'array' then raise exception 'bad rows'; end if;
  if (select count(*) from bot_combo_finds where found_by = me and created_at > now() - interval '24 hours') >= 400 then
    return 0;
  end if;
  for v_row in select * from jsonb_array_elements(p_rows) limit 20 loop
    insert into bot_combo_finds (signature, gain, turns, steps, source, found_by, game_key)
    values (left(v_row->>'signature', 300), (v_row->>'gain')::real, greatest(1, (v_row->>'turns')::integer),
            case when length((v_row->'steps')::text) <= 8000 then v_row->'steps' else null end,
            left(p_source, 20), me, left(p_game, 80));
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;
revoke all on function public.report_bot_combos(jsonb, text, text) from public, anon;
grant execute on function public.report_bot_combos(jsonb, text, text) to authenticated;

-- Gate 2: screenings
create table if not exists public.combo_screens (
  id          bigserial primary key,
  signature   text not null,
  champion_id bigint not null,
  user_id     uuid not null,
  wins        integer not null,
  losses      integer not null,
  draws       integer not null,
  passed      boolean not null,
  at          timestamptz not null default now()
);
create index if not exists combo_screens_sig on public.combo_screens (signature, champion_id);
alter table public.combo_screens enable row level security;   -- no client policies: RPCs only

-- Combos that passed gate 1 for the current champion (not taught, not in its
-- extraCombos, not tried as a challenger against it).
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
                       and coalesce(c.weights->'extraCombos', '[]'::jsonb) ? f.signature);
$$;
revoke all on function public._combo_gate1(public.bot_champion_weights) from public, anon, authenticated;

-- The next combo to screen against the current champion (or null).
create or replace function public.combo_screen_due()
returns jsonb
language plpgsql stable security definer set search_path to 'public'
as $$
declare
  v_ch bot_champion_weights;
  v_sig text;
begin
  if auth.uid() is null then raise exception 'sign in first'; end if;
  v_ch := _idle_champion();
  if v_ch.id is null then return null; end if;
  select g.signature into v_sig from public._combo_gate1(v_ch) g
   where not exists (select 1 from combo_screens s where s.signature = g.signature and s.champion_id = v_ch.id)
   order by g.games desc, g.avg_gain desc limit 1;
  if v_sig is null then return null; end if;
  return jsonb_build_object('signature', v_sig, 'champion_id', v_ch.id);
end;
$$;

-- A screening result. The first one per combo and champion counts.
create or replace function public.report_combo_screen(p_signature text, p_champion bigint, p_wins int, p_losses int, p_draws int)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare
  me uuid := auth.uid();
  v_ch bot_champion_weights;
begin
  if me is null then raise exception 'sign in first'; end if;
  v_ch := _idle_champion();
  if v_ch.id is distinct from p_champion then return jsonb_build_object('ok', false, 'reason', 'the champion changed'); end if;
  if least(p_wins, p_losses, p_draws) < 0 or p_wins + p_losses + p_draws < 4 or p_wins + p_losses + p_draws > 40 then
    raise exception 'bad record';
  end if;
  if (select count(*) from combo_screens where user_id = me and at > now() - interval '24 hours') >= 20 then
    return jsonb_build_object('ok', false, 'reason', 'too many today');
  end if;
  if not exists (select 1 from public._combo_gate1(v_ch) g where g.signature = p_signature) then
    return jsonb_build_object('ok', false, 'reason', 'not due');
  end if;
  if exists (select 1 from combo_screens where signature = p_signature and champion_id = v_ch.id) then
    return jsonb_build_object('ok', false, 'reason', 'already screened');
  end if;
  insert into combo_screens (signature, champion_id, user_id, wins, losses, draws, passed)
  values (p_signature, v_ch.id, me, p_wins, p_losses, p_draws, p_wins >= p_losses);
  return jsonb_build_object('ok', true, 'passed', p_wins >= p_losses);
end;
$$;

-- Gate 3 entry: only screened combos become trial combos now.
create or replace function public.idle_trial_combo()
returns text
language plpgsql stable security definer set search_path to 'public'
as $$
declare
  v_ch bot_champion_weights;
  v_sig text;
begin
  if auth.uid() is null then raise exception 'sign in first'; end if;
  v_ch := _idle_champion();
  if v_ch.id is null then return null; end if;
  select g.signature into v_sig from public._combo_gate1(v_ch) g
   where exists (select 1 from combo_screens s where s.signature = g.signature and s.champion_id = v_ch.id and s.passed)
   order by g.games desc, g.avg_gain desc limit 1;
  return v_sig;
end;
$$;

revoke all on function public.combo_screen_due() from public, anon;
revoke all on function public.report_combo_screen(text, bigint, int, int, int) from public, anon;
grant execute on function public.combo_screen_due() to authenticated;
grant execute on function public.report_combo_screen(text, bigint, int, int, int) to authenticated;
grant execute on function public.idle_trial_combo() to authenticated;
