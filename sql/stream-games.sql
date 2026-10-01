-- Stream games (2026-10-01, docs/twitch-votes.md)
-- STATUS 2026-10-01: only the two stream_mode columns and _is_stream_match are applied (migration
-- stream_games_columns). The function changes below are NOT applied yet (Supabase tool timed out).
-- In a stream game Twitch chat votes on what the bots do (js/stream-votes.js), so chat can
-- gang up on a player. Stream games therefore pay nothing: no win XP / gold, no ladder move,
-- no bounty, no pot drop, and the combo miner skips them (chat picks are not bot lessons).
-- The host sets game_room.stream_mode before the game starts; start_match copies it into
-- matches.stream_mode, which is what every check below reads (it cannot change mid-game).

alter table public.game_room add column if not exists stream_mode boolean not null default false;
alter table public.matches   add column if not exists stream_mode boolean not null default false;

create or replace function public._is_stream_match(p_match bigint)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce((select stream_mode from matches where id = p_match), false);
$$;
revoke all on function public._is_stream_match(bigint) from public, anon, authenticated;

-- start_match: same as before, plus stream_mode from the room.
create or replace function public.start_match(p_room_id integer, p_deck_seed bigint, p_players jsonb, p_settings jsonb)
returns bigint
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_room record;
  v_id   bigint;
  v_players jsonb;
begin
  if not (public.is_room_host(p_room_id) or public.is_hermit()) then
    raise exception 'not authorized';
  end if;
  select * into v_room from game_room where id = p_room_id;
  if not found or v_room.status <> 'playing' then raise exception 'room not playing'; end if;
  if jsonb_typeof(p_players) <> 'array' or jsonb_array_length(p_players) > 5 then
    raise exception 'bad players';
  end if;

  if v_room.match_id is not null then
    select id into v_id from matches
    where id = v_room.match_id and room_id = p_room_id and status = 'playing';
    if found then return v_id; end if;
  end if;

  update matches set status = 'abandoned', ended_at = last_move_at
  where status = 'playing' and last_move_at < now() - interval '30 minutes';
  delete from matches
  where status <> 'playing' and not keep and started_at < now() - interval '30 days';

  select coalesce(jsonb_agg(
           case when nullif(p->>'user_id', '') is not null then
             p || jsonb_build_object('rank',
               (select l.rank from ladder l where l.user_id = (p->>'user_id')::uuid
                  and l.entity_type = 'player' limit 1))
           else p end), '[]'::jsonb)
    into v_players
    from jsonb_array_elements(p_players) p;

  insert into matches (room_id, player_count, deck_seed, players, settings, stream_mode)
  values (p_room_id, jsonb_array_length(p_players), p_deck_seed, v_players,
          coalesce(p_settings, '{}'::jsonb), coalesce(v_room.stream_mode, false))
  returning id into v_id;
  update game_room set match_id = v_id where id = p_room_id;
  return v_id;
end;
$function$;

-- claim_game_win: a stream game pays nothing (checked first, so no pending row is made).
create or replace function public.claim_game_win(p_room_id integer)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid       uuid := auth.uid();
  v_room      record;
  v_seat      record;
  v_prev      record;
  v_n         integer;
  v_xp        integer;
  v_witnesses integer;
begin
  if v_uid is null then raise exception 'not signed in'; end if;

  select * into v_room from game_room where id = p_room_id;
  if not found or v_room.status <> 'finished' then
    return jsonb_build_object('success', false, 'reason', 'not_finished');
  end if;
  if public._is_stream_match(v_room.match_id) then
    return jsonb_build_object('success', false, 'reason', 'stream_game');
  end if;
  if v_room.created_at > now() - interval '3 minutes' then
    return jsonb_build_object('success', false, 'reason', 'too_short');
  end if;

  select * into v_seat from players where game_id = p_room_id and user_id = v_uid limit 1;
  if not found or v_seat.player_index is distinct from v_room.current_turn_index then
    return jsonb_build_object('success', false, 'reason', 'not_winner');
  end if;

  select * into v_prev from game_rewards where room_id = p_room_id and user_id = v_uid;
  if found then
    return jsonb_build_object('success', false,
      'reason', case when v_prev.status = 'pending' then 'awaiting_witness' else 'already_claimed' end);
  end if;
  if (select count(*) from game_rewards
      where user_id = v_uid and claimed_at > now() - interval '1 hour') >= 4 then
    return jsonb_build_object('success', false, 'reason', 'rate_limited');
  end if;

  select count(*) into v_n from players where game_id = p_room_id;
  v_n  := greatest(2, least(5, v_n));
  v_xp := 75 + (v_n - 1) * 25;

  if exists (select 1 from match_reports r
             where r.room_id = p_room_id and r.reporter <> v_uid
               and r.winner_index = v_seat.player_index and r.confirms) then
    insert into game_rewards (room_id, user_id, xp, num_players, status, match_id)
    values (p_room_id, v_uid, v_xp, v_n, 'pending', v_room.match_id);
    return public._pay_game_win(p_room_id, v_uid, v_xp, v_n);
  end if;

  select count(*) into v_witnesses from players
  where game_id = p_room_id and user_id is not null and user_id <> v_uid
    and last_seen > now() - interval '90 seconds';

  if v_witnesses = 0 then
    if not public._long_enough(v_room.match_id, v_room.created_at) then
      return jsonb_build_object('success', false, 'reason', 'too_short');
    end if;
    insert into game_rewards (room_id, user_id, xp, num_players, status, match_id)
    values (p_room_id, v_uid, v_xp, v_n, 'pending', v_room.match_id);
    return public._pay_game_win(p_room_id, v_uid, v_xp, v_n);
  end if;

  insert into game_rewards (room_id, user_id, xp, num_players, status, match_id)
  values (p_room_id, v_uid, v_xp, v_n, 'pending', v_room.match_id);
  return jsonb_build_object('success', false, 'reason', 'awaiting_witness', 'xp', v_xp);
end;
$function$;

-- _pay_game_win: second guard (every payer goes through here).
create or replace function public._pay_game_win(p_room_id integer, p_user uuid, p_xp integer, p_n integer)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_res   jsonb;
  v_match bigint;
  v_idx   integer;
begin
  select match_id into v_match from game_rewards where room_id = p_room_id and user_id = p_user;
  v_match := coalesce(v_match, (select match_id from game_room where id = p_room_id), public._room_match(p_room_id, now()));
  if public._is_stream_match(v_match) then
    delete from game_rewards where room_id = p_room_id and user_id = p_user and status = 'pending';
    return jsonb_build_object('success', false, 'reason', 'stream_game');
  end if;

  insert into game_rewards (room_id, user_id, xp, num_players, status, match_id)
  values (p_room_id, p_user, p_xp, p_n, 'paid', v_match)
  on conflict (room_id, user_id) do update
    set status = 'paid', claimed_at = now(), match_id = coalesce(game_rewards.match_id, excluded.match_id);

  v_res := update_user_xp(p_user, p_xp, 'Game win (' || p_n || ' players)');
  insert into user_activities (user_id, activity_type, xp_awarded, description, metadata)
  values (p_user, 'game_complete', p_xp, 'Completed game with ' || p_n || ' players',
          jsonb_build_object('num_players', p_n, 'won', true, 'room_id', p_room_id));
  insert into user_activities (user_id, activity_type, description, metadata)
  values (p_user, 'game_win', 'Won game with ' || p_n || ' players',
          jsonb_build_object('num_players', p_n, 'room_id', p_room_id));

  if v_match is not null then
    select (p->>'index')::integer into v_idx
    from matches m, jsonb_array_elements(m.players) p
    where m.id = v_match and p->>'user_id' = p_user::text limit 1;
    if v_idx is not null then perform public._ladder_apply_match(v_match, v_idx); end if;
  end if;

  perform public._pay_bounty(p_room_id, p_user);

  return v_res || jsonb_build_object('success', true, 'xp', p_xp, 'num_players', p_n);
end;
$function$;

-- report_game_result: the witness report is still stored (desync checks), but a stream game
-- never moves the ladder for a bot win.
create or replace function public.report_game_result(p_room_id integer, p_winner_index integer, p_confirms boolean, p_activated jsonb, p_at_shrine boolean, p_fingerprint text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid     uuid := auth.uid();
  v_seat    record;
  v_pending record;
  v_m       matches;
  v_wseat   jsonb;
  v_humans  integer;
begin
  if v_uid is null then raise exception 'not signed in'; end if;
  select * into v_seat from public._witness_seat(p_room_id);
  if not found then return; end if;

  insert into match_reports (room_id, reporter, seat, winner_index, confirms, activated, at_shrine, fingerprint)
  values (p_room_id, v_uid, v_seat.seat, p_winner_index, coalesce(p_confirms, false),
          p_activated, p_at_shrine, left(p_fingerprint, 64))
  on conflict (room_id, reporter) do update
    set winner_index = excluded.winner_index, confirms = excluded.confirms,
        activated = excluded.activated, at_shrine = excluded.at_shrine,
        fingerprint = excluded.fingerprint, created_at = now();

  if not coalesce(p_confirms, false) and v_seat.seat is distinct from p_winner_index then
    update matches set disputed = true where id = v_seat.match_id;
  end if;

  if public._is_stream_match(v_seat.match_id) then return; end if;

  if coalesce(p_confirms, false) and v_seat.seat is distinct from p_winner_index then
    for v_pending in
      select g.* from game_rewards g
      where g.room_id = p_room_id and g.status = 'pending' and g.user_id <> v_uid
    loop
      perform public._pay_game_win(p_room_id, v_pending.user_id, v_pending.xp,
                                   coalesce(v_pending.num_players, 2));
    end loop;

    select * into v_m from matches where id = v_seat.match_id;
    if found then
      select p into v_wseat from jsonb_array_elements(v_m.players) p
      where (p->>'index')::integer = p_winner_index limit 1;
      if v_wseat is not null and (coalesce((v_wseat->>'is_bot')::boolean, false) or v_wseat->>'user_id' is null) then
        select count(*) into v_humans from jsonb_array_elements(v_m.players) p
        where p->>'user_id' is not null and not coalesce((p->>'is_bot')::boolean, false);
        if v_uid is distinct from v_m.created_by or v_humans <= 1 then
          perform public._ladder_apply_match(v_m.id, p_winner_index);
        end if;
      end if;
    end if;
  end if;
end;
$function$;

-- _maybe_pay_pot: no pot drop after a stream game.
create or replace function public._maybe_pay_pot(p_match bigint)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  m        record;
  v_pot    integer;
  v_users  uuid[];
begin
  select * into m from matches where id = p_match;
  if not found or m.status <> 'finished' or m.winner_index is null
     or coalesce(m.win_type, '') = 'last_standing' or coalesce(m.stream_mode, false) then return; end if;
  if coalesce(public._match_turns(p_match), 0) < 6 then return; end if;
  if exists (select 1 from pot_payouts where paid_on = public._utc_today()) then return; end if;

  select coalesce(array_agg(distinct (p->>'user_id')::uuid), '{}') into v_users
  from jsonb_array_elements(m.players) p
  join user_profiles up on up.user_id = (p->>'user_id')::uuid
  where not coalesce((p->>'is_bot')::boolean, false) and p->>'user_id' is not null
    and not public._is_guest_name(up.display_name);
  if coalesce(array_length(v_users, 1), 0) < 2 then return; end if;
  v_users := array(select x from unnest(v_users) x
                   where not exists (select 1 from pot_payouts pp where pp.paid_on = public._utc_today() and x = any(pp.winners)));
  if coalesce(array_length(v_users, 1), 0) < 1 then return; end if;

  select amount into v_pot from game_pot where id = 1;
  if v_pot < 100 then return; end if;

  insert into pot_drops (match_id, room_id, seed, pot_amount, coins, users)
  values (p_match, m.room_id, floor(random() * 4294967296)::bigint, v_pot, public._pot_coins(v_pot), v_users)
  on conflict (match_id) do nothing;
end;
$function$;

-- Combo miner: chat picks are not lessons for the bots.
create or replace function public.list_matches_for_mining(p_limit integer default 20)
returns table(id bigint, room_id integer, ended_at timestamp with time zone, move_count integer, player_count integer)
language plpgsql
stable security definer
set search_path to 'public'
as $function$
begin
  if not public.is_hermit() then raise exception 'not authorized'; end if;
  return query
    select m.id, m.room_id, m.ended_at, m.move_count, m.player_count
    from matches m
    where m.status = 'finished' and m.mined_at is null and not m.stream_mode
    order by m.id
    limit greatest(1, least(coalesce(p_limit, 20), 100));
end;
$function$;
