-- Saved games (2026-10-03, owner): save a game against bots, close the tab, resume later
-- (docs/saved-games.md). Only for online games where the saver is the ONLY human. The moves are
-- already on the server (match_moves, js/match-recorder.js); a save just points at the match and
-- keeps the seats (with each bot's weights) and the board fingerprint at save time.
-- Resume (js/save-game.js): a new private room with the same seats, the board rebuilt from the
-- saved moves, then resume_saved_game_started copies the old moves into the new match (so its
-- replay, turn count and rewards cover the whole game) and deletes the save: no retries.
-- One save per account; kept 30 days (matches.keep while saved). RLS on, no client policies.

create table if not exists public.saved_games (
  user_id     uuid primary key,
  match_id    bigint not null,
  room_id     integer,
  seats       jsonb not null,
  deck_seed   bigint,
  turn        integer,
  fingerprint text,
  saved_at    timestamptz not null default now()
);
alter table public.saved_games enable row level security;

create or replace function public.save_game(p_room integer, p_seats jsonb, p_turn integer, p_fingerprint text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  me uuid := auth.uid();
  v_match matches%rowtype;
  v_humans integer;
begin
  if me is null then raise exception 'not signed in'; end if;
  if not public.is_room_host(p_room) then raise exception 'only the host can save'; end if;
  select m.* into v_match from matches m join game_room r on r.match_id = m.id where r.id = p_room;
  if v_match.id is null or v_match.status <> 'playing' then raise exception 'no game to save'; end if;
  select count(*) into v_humans from jsonb_array_elements(v_match.players) p
  where nullif(p->>'user_id', '') is not null and not coalesce((p->>'is_bot')::boolean, false);
  if v_humans <> 1 or not (v_match.players @> jsonb_build_array(jsonb_build_object('user_id', me::text))) then
    raise exception 'only games against bots can be saved';
  end if;
  if exists (select 1 from player_bounties where room_id = p_room and status = 'open') then
    raise exception 'games with a bounty cannot be saved';
  end if;
  if jsonb_typeof(p_seats) <> 'array' or jsonb_array_length(p_seats) < 2 or jsonb_array_length(p_seats) > 5
     or length(p_seats::text) > 200000 then
    raise exception 'bad seats';
  end if;
  -- An older save is replaced: let its match be cleaned up again.
  update matches set keep = false
  where id = (select match_id from saved_games where user_id = me) and id <> v_match.id and not coalesce(is_public, false);
  insert into saved_games (user_id, match_id, room_id, seats, deck_seed, turn, fingerprint, saved_at)
  values (me, v_match.id, p_room, p_seats, v_match.deck_seed, p_turn, left(p_fingerprint, 64), now())
  on conflict (user_id) do update set match_id = excluded.match_id, room_id = excluded.room_id,
    seats = excluded.seats, deck_seed = excluded.deck_seed, turn = excluded.turn,
    fingerprint = excluded.fingerprint, saved_at = now();
  update matches set keep = true where id = v_match.id;
  return jsonb_build_object('saved', true, 'turn', p_turn,
                            'moves', (select count(*) from match_moves where match_id = v_match.id));
end;
$$;

create or replace function public.my_saved_game()
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  select jsonb_build_object('match_id', s.match_id, 'turn', s.turn, 'saved_at', s.saved_at,
           'seats', (select jsonb_agg(jsonb_build_object('index', x->'index', 'color', x->'color',
                       'username', x->'username', 'is_bot', x->'is_bot')) from jsonb_array_elements(s.seats) x))
  from saved_games s join matches m on m.id = s.match_id
  where s.user_id = auth.uid() and s.saved_at > now() - interval '30 days';
$$;

create or replace function public.load_saved_game()
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  select jsonb_build_object('match_id', s.match_id, 'seats', s.seats, 'deck_seed', s.deck_seed,
           'turn', s.turn, 'fingerprint', s.fingerprint, 'settings', m.settings,
           'moves', coalesce((select jsonb_agg(jsonb_build_object('seq', mv.seq, 'event', mv.event,
                                'sender', mv.sender, 'payload', mv.payload) order by mv.seq)
                              from match_moves mv where mv.match_id = s.match_id), '[]'::jsonb))
  from saved_games s join matches m on m.id = s.match_id
  where s.user_id = auth.uid() and m.status in ('playing', 'abandoned')
    and s.saved_at > now() - interval '30 days';
$$;

-- The resumed game started in p_new_room: its match gets the old moves in front (so replays,
-- turn counts and rewards see the whole game), the old match is closed, the save is used up.
create or replace function public.resume_saved_game_started(p_new_room integer)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  me uuid := auth.uid();
  s saved_games%rowtype;
  v_new bigint;
  v_n integer;
begin
  if me is null then raise exception 'not signed in'; end if;
  select * into s from saved_games where user_id = me for update;
  if not found then raise exception 'no saved game'; end if;
  if not public.is_room_host(p_new_room) then raise exception 'not your room'; end if;
  select match_id into v_new from game_room where id = p_new_room;
  if v_new is null or v_new = s.match_id then raise exception 'the new game is not recorded yet'; end if;

  select count(*) into v_n from match_moves where match_id = s.match_id;
  -- make room in front of the new match's own moves (two steps: no key clashes)
  update match_moves set seq = -seq where match_id = v_new;
  update match_moves set seq = -seq + v_n where match_id = v_new;
  insert into match_moves (match_id, seq, event, sender, payload, at)
  select v_new, seq, event, sender, payload, at from match_moves where match_id = s.match_id;
  update matches set move_count = (select count(*) from match_moves where match_id = v_new),
                     settings = coalesce(settings, '{}'::jsonb) || jsonb_build_object('resumed_from', s.match_id)
  where id = v_new;

  update matches set status = 'abandoned', ended_at = coalesce(ended_at, now()),
                     keep = coalesce(is_public, false)
  where id = s.match_id and status = 'playing';
  update matches set keep = coalesce(is_public, false) where id = s.match_id;
  delete from saved_games where user_id = me;
  return jsonb_build_object('match_id', v_new, 'copied', v_n);
end;
$$;

create or replace function public.delete_saved_game()
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare me uuid := auth.uid(); v_match bigint;
begin
  if me is null then raise exception 'not signed in'; end if;
  delete from saved_games where user_id = me returning match_id into v_match;
  if v_match is not null then
    update matches set keep = coalesce(is_public, false) where id = v_match;
  end if;
end;
$$;

revoke all on function public.save_game(integer, jsonb, integer, text) from public, anon;
revoke all on function public.my_saved_game() from public, anon;
revoke all on function public.load_saved_game() from public, anon;
revoke all on function public.resume_saved_game_started(integer) from public, anon;
revoke all on function public.delete_saved_game() from public, anon;
grant execute on function public.save_game(integer, jsonb, integer, text) to authenticated;
grant execute on function public.my_saved_game() to authenticated;
grant execute on function public.load_saved_game() to authenticated;
grant execute on function public.resume_saved_game_started(integer) to authenticated;
grant execute on function public.delete_saved_game() to authenticated;
