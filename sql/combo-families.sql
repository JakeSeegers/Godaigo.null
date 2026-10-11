-- Combo families + one-player idle promotion (owner 2026-10-11). Run after
-- sql/combo-train-trials.sql. Safe to run more than once.
--
-- 1. Combo families. Two combos used to count as "the same" only when the
--    whole signature matched (turn breaks, reveals, breaks, scroll choices),
--    so nothing ever repeated: 9 mined combos, 9 different signatures, none
--    taught. Now everything groups by FAMILY = the first 2 scrolls cast, in
--    order, without choices, turns, reveals or breaks (bots follow a combo
--    once they hold its first two scrolls, bot.js updateCombo / comboPairShare):
--      "WATER_SCROLL_5 / FIRE_SCROLL_5[x] > reveal > FIRE_SCROLL_5"
--      -> "WATER_SCROLL_5 > FIRE_SCROLL_5"
--    Bots get one signature per family: the best example (gain x trust).
--    Hermit On / Off flags and every "already tried" check also match by family.
-- 2. Idle training: the "games from 2+ players" rule is gone. At 40 decided
--    games: 58%+ = promoted, else dropped.

create or replace function public._combo_family(p_sig text)
returns text
language sql immutable
as $$
  select coalesce(
    (select array_to_string((array_agg(regexp_replace(t.tok, '\[.*$', '') order by t.ord))[1:2], ' > ')
       from regexp_split_to_table(replace(coalesce(p_sig, ''), ' / ', ' > '), ' > ') with ordinality as t(tok, ord)
      where t.tok ~ '^[A-Z]+_SCROLL_[0-9]+'),
    p_sig);
$$;

-- Taught combos (public): one row per family.
create or replace function public.get_bot_combos()
returns table (signature text, times integer, score real)
language sql stable security definer set search_path to 'public'
as $$
  with s as (
    select public._combo_family(c.signature) as fam,
           (array_agg(c.signature order by c.gain * c.trust desc))[1] as best_sig,
           count(*)::integer as times, count(distinct c.match_id)::integer as matches,
           sum(c.gain * c.trust)::real as score, sum(c.trust)::real as trust_sum
    from combo_candidates c
    where not c.is_bot
    group by 1
  ), f as (
    select distinct on (public._combo_family(signature)) public._combo_family(signature) as fam, signature, state
    from combo_flags order by public._combo_family(signature), updated_at desc
  )
  select s.best_sig, s.times, s.score
  from s left join f on f.fam = s.fam
  where f.state = 'on' or (f.state is null and s.matches >= 2 and s.trust_sum >= 1.0)
  union all
  select f.signature, 0, 0::real from f
  where f.state = 'on' and not exists (select 1 from s where s.fam = f.fam)
  order by 3 desc
  limit 40;
$$;

create or replace function public.hermit_combo_summary(p_min_count integer default 1)
returns table (signature text, times integer, matches integer, players integer, avg_gain real, avg_trust real, score real,
               best_match bigint, best_steps jsonb, last_seen timestamptz, state text, taught boolean)
language plpgsql stable security definer set search_path to 'public'
as $$
begin
  if not public.is_hermit() then raise exception 'not authorized'; end if;
  return query
    with s as (
      select public._combo_family(c.signature) as fam,
             (array_agg(c.signature order by c.gain * c.trust desc))[1] as best_sig,
             count(*)::integer as times,
             count(distinct c.match_id)::integer as matches,
             count(distinct c.user_id)::integer as players,
             avg(c.gain)::real as avg_gain,
             avg(c.trust)::real as avg_trust,
             sum(c.gain * c.trust)::real as score,
             (array_agg(c.match_id order by c.gain * c.trust desc))[1] as best_match,
             (array_agg(c.steps order by c.gain * c.trust desc))[1] as best_steps,
             max(c.created_at) as last_seen,
             sum(c.trust)::real as trust_sum
      from combo_candidates c
      where not c.is_bot
      group by 1
    ), f as (
      select distinct on (public._combo_family(cf.signature)) public._combo_family(cf.signature) as fam, cf.state
      from combo_flags cf order by public._combo_family(cf.signature), cf.updated_at desc
    )
    select s.best_sig, s.times, s.matches, s.players, s.avg_gain, s.avg_trust, s.score, s.best_match,
           s.best_steps, s.last_seen, coalesce(f.state, 'auto'),
           case when f.state = 'on' then true when f.state = 'off' then false
                else s.matches >= 2 and s.trust_sum >= 1.0 end
    from s left join f on f.fam = s.fam
    where s.times >= greatest(1, coalesce(p_min_count, 1))
    order by s.score desc
    limit 100;
end;
$$;

-- A flag set on one signature covers its whole family: drop older flags of it.
create or replace function public.hermit_set_combo_state(p_signature text, p_state text)
returns void
language plpgsql security definer set search_path to 'public'
as $$
begin
  if not public.is_hermit() then raise exception 'not authorized'; end if;
  delete from combo_flags where public._combo_family(signature) = public._combo_family(p_signature);
  if p_state is null or p_state = 'auto' then
    return;
  elsif p_state in ('on', 'off') then
    insert into combo_flags (signature, state) values (p_signature, p_state);
  else
    raise exception 'bad state';
  end if;
end;
$$;

create or replace function public.hermit_bot_combo_summary(p_limit integer default 40)
returns table (signature text, times integer, finders integer, avg_gain real, best_steps jsonb, last_seen timestamptz)
language plpgsql stable security definer set search_path to 'public'
as $$
begin
  if not public.is_hermit() then raise exception 'not authorized'; end if;
  return query
    select (array_agg(f.signature order by f.gain desc))[1], count(*)::integer, count(distinct f.found_by)::integer,
           avg(f.gain)::real, (array_agg(f.steps order by f.gain desc))[1], max(f.created_at)
    from bot_combo_finds f
    group by public._combo_family(f.signature)
    order by count(*) desc, avg(f.gain) desc
    limit greatest(1, least(coalesce(p_limit, 40), 200));
end;
$$;

-- Practice spots: any mined moment whose family is taught.
create or replace function public.idle_practice_job()
returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare
  me uuid := auth.uid();
  v_c combo_candidates;
begin
  if me is null then raise exception 'sign in first'; end if;
  if (select count(*) from idle_games where user_id = me and kind = 'practice' and at > now() - interval '24 hours') >= 60 then
    return null;
  end if;
  select c.* into v_c
    from combo_candidates c join matches m on m.id = c.match_id
   where not c.is_bot and c.gain > 0 and c.start_turn is not null and m.status = 'finished'
     and public._combo_family(c.signature) in (select public._combo_family(g.signature) from public.get_bot_combos() g)
   order by random() limit 1;
  if v_c.id is null then return null; end if;
  return jsonb_build_object('replay', public._anon_replay(v_c.match_id), 'seat', v_c.seat,
    'start_turn', v_c.start_turn, 'turns', v_c.turns, 'gain', v_c.gain, 'signature', v_c.signature);
end;
$$;

-- Gate 1 by family: found in 5+ different games; not taught, not in the
-- champion's extraCombos, not tried (idle or Train Bot) against this champion.
create or replace function public._combo_gate1(p_ch public.bot_champion_weights)
returns table (signature text, games integer, avg_gain real)
language sql stable security definer set search_path to 'public'
as $$
  with g as (
    select public._combo_family(f.signature) as fam,
           (array_agg(f.signature order by f.gain desc))[1] as best_sig,
           count(distinct coalesce(f.game_key, f.id::text))::integer as games,
           avg(f.gain)::real as avg_gain
      from bot_combo_finds f
     group by 1
  )
  select g.best_sig, g.games, g.avg_gain
    from g
   where g.games >= 5
     and not exists (select 1 from jsonb_array_elements_text(coalesce(p_ch.weights->'extraCombos', '[]'::jsonb)) e
                      where public._combo_family(e) = g.fam)
     and g.fam not in (select public._combo_family(t.signature) from public.get_bot_combos() t)
     and not exists (select 1 from idle_candidates c, jsonb_array_elements_text(coalesce(c.weights->'extraCombos', '[]'::jsonb)) e
                      where c.champion_id = p_ch.id and c.kind = 'combo' and public._combo_family(e) = g.fam)
     and not exists (select 1 from combo_train_trials t where t.champion_id = p_ch.id and public._combo_family(t.signature) = g.fam);
$$;
revoke all on function public._combo_gate1(public.bot_champion_weights) from public, anon, authenticated;

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
   where not exists (select 1 from combo_screens s where s.champion_id = v_ch.id
                       and public._combo_family(s.signature) = public._combo_family(g.signature))
   order by g.games desc, g.avg_gain desc limit 1;
  if v_sig is null then return null; end if;
  return jsonb_build_object('signature', v_sig, 'champion_id', v_ch.id);
end;
$$;

create or replace function public.report_combo_screen(p_signature text, p_champion bigint, p_wins int, p_losses int, p_draws int)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare
  me uuid := auth.uid();
  v_ch bot_champion_weights;
  v_fam text := public._combo_family(p_signature);
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
  if not exists (select 1 from public._combo_gate1(v_ch) g where public._combo_family(g.signature) = v_fam) then
    return jsonb_build_object('ok', false, 'reason', 'not due');
  end if;
  if exists (select 1 from combo_screens where champion_id = v_ch.id and public._combo_family(signature) = v_fam) then
    return jsonb_build_object('ok', false, 'reason', 'already screened');
  end if;
  insert into combo_screens (signature, champion_id, user_id, wins, losses, draws, passed)
  values (p_signature, v_ch.id, me, p_wins, p_losses, p_draws, p_wins >= p_losses);
  return jsonb_build_object('ok', true, 'passed', p_wins >= p_losses);
end;
$$;

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
   where exists (select 1 from combo_screens s where s.champion_id = v_ch.id and s.passed
                   and public._combo_family(s.signature) = public._combo_family(g.signature))
   order by g.games desc, g.avg_gain desc limit 1;
  return v_sig;
end;
$$;

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
  if public._combo_family(public.idle_trial_combo()) is distinct from public._combo_family(p_signature) then
    return jsonb_build_object('ok', false, 'reason', 'not due');
  end if;
  insert into combo_train_trials (signature, champion_id, user_id) values (p_signature, v_ch.id, me)
  on conflict (signature, champion_id, user_id) do nothing;
  return jsonb_build_object('ok', true);
end;
$$;

-- 2. Idle training without the 2-player rule.
create or replace function public.idle_training_report(p_candidate bigint, p_result text, p_turns integer, p_kind text default 'game')
returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_c idle_candidates;
  v_dec int;
  v_rate float;
  v_new bigint;
  v_verdict text := null;
begin
  if auth.uid() is null then raise exception 'sign in first'; end if;
  if p_result not in ('win', 'loss', 'draw') then raise exception 'bad result'; end if;
  if exists (select 1 from idle_games where user_id = auth.uid() and at > now() - interval '20 seconds') then
    return jsonb_build_object('ok', false, 'reason', 'too fast');
  end if;
  select * into v_c from idle_candidates where id = p_candidate for update;
  if v_c.id is null then raise exception 'no such challenger'; end if;
  if v_c.status <> 'open' then
    return jsonb_build_object('ok', false, 'reason', v_c.status, 'candidate', _idle_cand_json(v_c));
  end if;
  insert into idle_games (candidate_id, user_id, result, turns, kind)
    values (v_c.id, auth.uid(), p_result, p_turns, case when p_kind = 'practice' then 'practice' else 'game' end);
  update idle_candidates set
      wins = wins + (p_result = 'win')::int,
      losses = losses + (p_result = 'loss')::int,
      draws = draws + (p_result = 'draw')::int
    where id = v_c.id returning * into v_c;
  v_dec := v_c.wins + v_c.losses;
  v_rate := case when v_dec > 0 then v_c.wins::float / v_dec else 0 end;
  if (v_dec >= 12 and v_rate < 0.35) or (v_dec >= 24 and v_rate < 0.45) then
    v_verdict := 'dropped';
  elsif v_dec >= 40 then
    v_verdict := case when v_rate >= 0.58 then 'promoted' else 'dropped' end;
  elsif v_c.wins + v_c.losses + v_c.draws >= 60 then
    v_verdict := 'dropped';
  end if;
  if v_verdict = 'promoted' then
    -- still the champion it was tested against?
    if (_idle_champion()).id is distinct from v_c.champion_id then
      v_verdict := 'stale';
    else
      insert into bot_champion_weights (weights, confirm_wins, confirm_losses, confirm_draws, win_rate, promoted, created_by)
        values (v_c.weights, v_c.wins, v_c.losses, v_c.draws, v_rate, true, v_c.created_by) returning id into v_new;
      update idle_candidates set status = 'stale', decided_at = now()
        where status = 'open' and champion_id = v_c.champion_id and id <> v_c.id;
    end if;
  end if;
  if v_verdict is not null then
    update idle_candidates set status = v_verdict, decided_at = now(), new_champion_id = v_new
      where id = v_c.id returning * into v_c;
  end if;
  return jsonb_build_object('ok', true, 'candidate', _idle_cand_json(v_c), 'new_champion_id', v_new);
end;
$$;

-- Challengers that already passed 40 decided games while waiting for a
-- second player get their verdict now.
do $$
declare v_c idle_candidates; v_new bigint;
begin
  for v_c in select * from idle_candidates where status = 'open' and wins + losses >= 40 order by id loop
    if v_c.wins::float / (v_c.wins + v_c.losses) >= 0.58 and (_idle_champion()).id = v_c.champion_id then
      insert into bot_champion_weights (weights, confirm_wins, confirm_losses, confirm_draws, win_rate, promoted, created_by)
        values (v_c.weights, v_c.wins, v_c.losses, v_c.draws, v_c.wins::float / (v_c.wins + v_c.losses), true, v_c.created_by)
        returning id into v_new;
      update idle_candidates set status = 'promoted', decided_at = now(), new_champion_id = v_new where id = v_c.id;
      update idle_candidates set status = 'stale', decided_at = now()
        where status = 'open' and champion_id = v_c.champion_id and id <> v_c.id;
    elsif (select status from idle_candidates where id = v_c.id) = 'open' then
      update idle_candidates set status = 'dropped', decided_at = now() where id = v_c.id;
    end if;
  end loop;
end $$;

grant execute on function public._combo_family(text) to authenticated;

select public._combo_family('WATER_SCROLL_5 / FIRE_SCROLL_5[x] > reveal > FIRE_SCROLL_5') as family_test,
       (select count(distinct public._combo_family(signature)) from combo_candidates) as mined_families,
       (select json_object_agg(status, n) from (select status, count(*) n from idle_candidates group by status) s) as idle_status;
