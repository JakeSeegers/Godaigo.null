-- Idle training (screensaver), owner 2026-10-09. js/idle-training.js.
--
-- When a signed-in player sits idle in the lobby, their browser plays watchable
-- bot games for a COMMUNAL training run. A new training style ("pooled climb"):
-- every browser works on the same shared list of challengers, so no one has to
-- finish a run alone.
--
--   * A challenger = the current champion (bot_champion_weights, newest promoted
--     row) changed a little: 'explore' (numbers moved more) or 'formula' (may
--     gain / lose / change a formula term). The browser picks the kind at random.
--   * idle_training_job(): the current champion plus an open challenger to test
--     (the least played one), or none = "make a new one" (idle_training_new).
--   * Every finished game (challenger vs champion, 2 players) is reported with
--     idle_training_report(). Games from everyone add up on the challenger.
--   * Judged like Train Bot's hill climb: dropped early when clearly worse
--     (under 35% after 12 decided games, under 45% after 24), promoted at 40
--     decided games with 58% or more (a new bot_champion_weights row with
--     promoted = true, so every bot uses it from the next page load), else
--     dropped. 60 games in total without a verdict (draws) = dropped.
--   * A new champion needs games from at least 2 different players (owner,
--     2026-10-10): one person, or one broken browser, can never change
--     everyone's bots alone. A challenger that passed with games from only one
--     player stays open ("waiting for a second player") and is handed to other
--     players first; it is promoted when another player's game comes in and it
--     still has 58% or more.
--   * A new champion makes the old champion's open challengers 'stale'.
-- Limits: one report per 20 s per account, 30 new challengers per account per
-- day, 6 open challengers per champion.

create table if not exists public.idle_candidates (
  id bigserial primary key,
  champion_id bigint not null,
  weights jsonb not null,
  kind text not null check (kind in ('explore', 'formula')),
  created_by uuid,
  created_at timestamptz not null default now(),
  wins int not null default 0,
  losses int not null default 0,
  draws int not null default 0,
  status text not null default 'open' check (status in ('open', 'promoted', 'dropped', 'stale')),
  decided_at timestamptz,
  new_champion_id bigint
);
create index if not exists idle_candidates_open on public.idle_candidates (champion_id) where status = 'open';

create table if not exists public.idle_games (
  id bigserial primary key,
  candidate_id bigint not null references public.idle_candidates(id) on delete cascade,
  user_id uuid not null,
  result text not null check (result in ('win', 'loss', 'draw')),
  turns int,
  at timestamptz not null default now()
);
create index if not exists idle_games_user_at on public.idle_games (user_id, at desc);
create index if not exists idle_games_cand on public.idle_games (candidate_id);

alter table public.idle_candidates enable row level security;
alter table public.idle_games enable row level security;

create or replace function public._idle_champion()
returns public.bot_champion_weights
language sql stable security definer set search_path to 'public'
as $$
  select * from bot_champion_weights order by promoted desc, created_at desc limit 1;
$$;

-- Short public numbers for the screensaver bar.
create or replace function public._idle_summary(p_champion bigint)
returns jsonb
language sql stable security definer set search_path to 'public'
as $$
  select jsonb_build_object(
    'open', (select count(*) from idle_candidates where champion_id = p_champion and status = 'open'),
    'tested', (select count(*) from idle_candidates where champion_id = p_champion and status <> 'open'),
    'games_today', (select count(*) from idle_games where at > now() - interval '24 hours'),
    'players_today', (select count(distinct user_id) from idle_games where at > now() - interval '24 hours'),
    'my_games', (select count(*) from idle_games where user_id = auth.uid()),
    'last_promotion', (select max(decided_at) from idle_candidates where status = 'promoted')
  );
$$;

create or replace function public._idle_cand_json(c public.idle_candidates)
returns jsonb
language sql stable security definer set search_path to 'public'
as $$
  select jsonb_build_object('id', c.id, 'weights', c.weights, 'kind', c.kind, 'wins', c.wins, 'losses', c.losses,
    'draws', c.draws, 'status', c.status,
    'players', (select count(distinct user_id) from idle_games where candidate_id = c.id));
$$;

create or replace function public.idle_training_job()
returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_ch bot_champion_weights;
  v_c idle_candidates;
  v_open int;
begin
  if auth.uid() is null then raise exception 'sign in first'; end if;
  v_ch := _idle_champion();
  if v_ch.id is null then raise exception 'no champion yet'; end if;
  update idle_candidates set status = 'stale', decided_at = now()
    where status = 'open' and champion_id <> v_ch.id;
  select count(*) into v_open from idle_candidates where champion_id = v_ch.id and status = 'open';
  -- some room left: sometimes ask for a new challenger, so the search keeps moving
  if v_open = 0 or (v_open < 6 and random() < 0.3 and not exists (
       select 1 from idle_candidates c where c.champion_id = v_ch.id and c.status = 'open' and c.wins + c.losses >= 40
         and not exists (select 1 from idle_games g where g.candidate_id = c.id and g.user_id = auth.uid()))) then
    v_c := null;
  else
    -- a challenger waiting for a second player goes to someone who has not played it yet
    select c.* into v_c from idle_candidates c where c.champion_id = v_ch.id and c.status = 'open'
      order by (case when c.wins + c.losses >= 40
                      and not exists (select 1 from idle_games g where g.candidate_id = c.id and g.user_id = auth.uid())
                     then 0 else 1 end),
               (c.wins + c.losses + c.draws) + random() * 4
      limit 1;
  end if;
  return jsonb_build_object(
    'champion_id', v_ch.id, 'champion', v_ch.weights,
    'candidate', case when v_c.id is null then null else _idle_cand_json(v_c) end,
    'summary', _idle_summary(v_ch.id));
end;
$$;

create or replace function public.idle_training_new(p_champion bigint, p_weights jsonb, p_kind text)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_ch bot_champion_weights;
  v_c idle_candidates;
begin
  if auth.uid() is null then raise exception 'sign in first'; end if;
  v_ch := _idle_champion();
  if v_ch.id is distinct from p_champion then raise exception 'the champion changed'; end if;
  if p_kind not in ('explore', 'formula') then raise exception 'bad kind'; end if;
  if jsonb_typeof(p_weights) <> 'object' or length(p_weights::text) > 20000 then raise exception 'bad weights'; end if;
  -- full: test one of the open ones instead
  if (select count(*) from idle_candidates where champion_id = v_ch.id and status = 'open') >= 6
     or (select count(*) from idle_candidates where created_by = auth.uid() and created_at > now() - interval '24 hours') >= 30 then
    select * into v_c from idle_candidates where champion_id = v_ch.id and status = 'open'
      order by (wins + losses + draws) limit 1;
    if v_c.id is null then raise exception 'try again later'; end if;
    return _idle_cand_json(v_c);
  end if;
  insert into idle_candidates (champion_id, weights, kind, created_by)
    values (v_ch.id, p_weights, p_kind, auth.uid()) returning * into v_c;
  return _idle_cand_json(v_c);
end;
$$;

create or replace function public.idle_training_report(p_candidate bigint, p_result text, p_turns int)
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
  insert into idle_games (candidate_id, user_id, result, turns) values (v_c.id, auth.uid(), p_result, p_turns);
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

revoke all on function public._idle_champion() from public, anon, authenticated;
revoke all on function public._idle_summary(bigint) from public, anon, authenticated;
revoke all on function public._idle_cand_json(public.idle_candidates) from public, anon, authenticated;
revoke all on function public.idle_training_job() from public, anon;
revoke all on function public.idle_training_new(bigint, jsonb, text) from public, anon;
revoke all on function public.idle_training_report(bigint, text, int) from public, anon;
grant execute on function public.idle_training_job() to authenticated;
grant execute on function public.idle_training_new(bigint, jsonb, text) to authenticated;
grant execute on function public.idle_training_report(bigint, text, int) to authenticated;
