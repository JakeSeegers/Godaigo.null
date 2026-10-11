-- Combo practice duels (owner 2026-10-11). js/replay-viewer.js practiceDuel,
-- js/idle-training.js. Run AFTER sql/idle-training.sql and sql/combo-mine-pool.sql.
--
-- idle_practice_job(): one anonymous spot (sql/combo-mine-pool.sql
-- _anon_replay) where a player pulled off a combo the bots are TAUGHT
-- (get_bot_combos): the seat, the turn it started, how many turns it took and
-- what the player gained. The browser replays to that turn, lets the
-- challenger play that seat (champion on every other seat), then the champion,
-- and reports a win / loss / draw for the challenger. Null = no taught combo
-- yet, or 60 practice results from this account in 24 hours.
-- idle_training_report gains p_kind ('game' or 'practice', stored in
-- idle_games.kind); practice results count toward the same promotion rule.

alter table public.idle_games add column if not exists kind text not null default 'game';

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
     and c.signature in (select signature from public.get_bot_combos())
   order by random() limit 1;
  if v_c.id is null then return null; end if;
  return jsonb_build_object('replay', public._anon_replay(v_c.match_id), 'seat', v_c.seat,
    'start_turn', v_c.start_turn, 'turns', v_c.turns, 'gain', v_c.gain, 'signature', v_c.signature);
end;
$$;
revoke all on function public.idle_practice_job() from public, anon;
grant execute on function public.idle_practice_job() to authenticated;

drop function if exists public.idle_training_report(bigint, text, int);
create or replace function public.idle_training_report(p_candidate bigint, p_result text, p_turns int, p_kind text default 'game')
returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_c idle_candidates;
  v_dec int;
  v_rate float;
  v_new bigint;
  v_verdict text := null;
  v_players int;
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
    select count(distinct user_id) into v_players from idle_games where candidate_id = v_c.id;
    v_verdict := case when v_rate < 0.58 then 'dropped'
                      when v_players >= 2 then 'promoted'
                      when v_c.wins + v_c.losses + v_c.draws >= 80 then 'dropped'
                      else null end;   -- passed, waiting for a second player
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
revoke all on function public.idle_training_report(bigint, text, int, text) from public, anon;
grant execute on function public.idle_training_report(bigint, text, int, text) to authenticated;
