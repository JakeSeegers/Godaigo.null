-- Stream games (2026-10-01, docs/twitch-votes.md)
-- In a stream game Twitch chat votes on what the bots do (js/stream-votes.js). Owner decision:
-- stream games pay rewards as normal. Every chat-steered bot is one leaderboard bot,
-- "Twitchbot" (seats are named "Twitchbot (<element bot>)").
--
-- STATUS 2026-10-01:
--   APPLIED: the two stream_mode columns, _is_stream_match, the Twitchbot deployed_bots row
--            (id 12), and an unused helper _match_stream_flag (drop it in part B).
--   NOT APPLIED: part B. The Supabase tool timed out on it several times (nothing applied).
--   Apply part B as ONE call (CLAUDE.md house rule 6).

-- ===================================================================== part A (applied)
alter table public.game_room add column if not exists stream_mode boolean not null default false;
alter table public.matches   add column if not exists stream_mode boolean not null default false;

create or replace function public._is_stream_match(p_match bigint)
returns boolean language sql stable security definer set search_path to 'public'
as $$ select coalesce((select stream_mode from matches where id = p_match), false); $$;
revoke all on function public._is_stream_match(bigint) from public, anon, authenticated;

insert into public.deployed_bots (owner, nickname, weights, is_active)
select null, 'Twitchbot', weights, true from public.deployed_bots where id = 1
and not exists (select 1 from public.deployed_bots where owner is null and nickname = 'Twitchbot');

-- ===================================================================== part B (NOT applied)
drop function if exists public._match_stream_flag();

-- Ladder: any "Twitchbot (...)" seat is the Twitchbot row; one bot in several seats never
-- loses to itself.
create or replace function public._ladder_apply_match(p_match_id bigint, p_winner_index integer)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_m     matches;
  v_seat  jsonb;
  v_wuser uuid; v_wbot bigint;
  v_lusers uuid[] := '{}'; v_lbots bigint[] := '{}';
  v_bot   bigint;
  v_is_bot boolean;
  v_name  text;
begin
  if p_match_id is null or p_winner_index is null then return null; end if;
  select * into v_m from matches where id = p_match_id;
  if not found then return null; end if;
  insert into ladder_applied (match_id) values (p_match_id) on conflict do nothing;
  if not found then return null; end if;

  for v_seat in select * from jsonb_array_elements(v_m.players) loop
    v_is_bot := coalesce((v_seat->>'is_bot')::boolean, false) or v_seat->>'user_id' is null;
    v_bot := null;
    if v_is_bot then
      v_name := trim(regexp_replace(coalesce(v_seat->>'username', ''), '^🤖', ''));
      if v_name ilike 'Twitchbot%' then v_name := 'Twitchbot'; end if;
      select id into v_bot from deployed_bots
      where owner is null and nickname = v_name
      limit 1;
    end if;
    if (v_seat->>'index')::integer = p_winner_index then
      if v_is_bot then v_wbot := v_bot; else v_wuser := (v_seat->>'user_id')::uuid; end if;
    elsif v_is_bot then
      if v_bot is not null then v_lbots := v_lbots || v_bot; end if;
    else
      v_lusers := v_lusers || (v_seat->>'user_id')::uuid;
    end if;
  end loop;
  v_lbots := array(select distinct b from unnest(v_lbots) b where b is distinct from v_wbot);
  return public._ladder_move(v_wuser, v_wbot, v_lusers, v_lbots);
end;
$function$;

-- start_match: same as before, plus matches.stream_mode from the room.
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

-- check (last statement of the same call)
select position('Twitchbot' in pg_get_functiondef('public._ladder_apply_match'::regproc)) > 0 as ladder,
       position('stream_mode' in pg_get_functiondef('public.start_match'::regproc)) > 0 as start,
       position('stream_mode' in pg_get_functiondef('public.list_matches_for_mining'::regproc)) > 0 as mining;
