-- Spectate mode (owner 2026-10-09). js/spectate.js.
-- The host ticks "Allow spectators" in the waiting room (game_room.allow_spectators,
-- set by the host like test_mode). While that game is being played, anyone signed in
-- can watch it from the lobby: list_watchable_games() fills the "Games you can watch"
-- list, get_live_match(room) gives the recorded moves so far (match_moves, written by
-- the host's match recorder), and the viewer then listens to the room's live channel.
-- Spectators see public information only (the client hides hands).

alter table public.game_room add column if not exists allow_spectators boolean not null default false;

-- Games being played right now that allow spectators (started in the last 4 hours).
create or replace function public.list_watchable_games()
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'room_id', r.id,
      'host_name', r.host_name,
      'match_id', m.id,
      'started_at', m.started_at,
      'move_count', m.move_count,
      'players', (select jsonb_agg(jsonb_build_object('index', p->'index', 'color', p->'color', 'username', p->'username', 'is_bot', p->'is_bot'))
                  from jsonb_array_elements(m.players) p)
    ) order by m.started_at desc), '[]'::jsonb)
  from game_room r
  join matches m on m.id = r.match_id
  where r.allow_spectators
    and r.status = 'playing'
    and m.status = 'playing'
    and m.started_at > now() - interval '4 hours'
    and auth.uid() is not null;
$$;

-- One live game for a spectator: the seats, deck seed, settings and every move so far.
create or replace function public.get_live_match(p_room integer)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_r game_room;
  v_m matches;
begin
  if auth.uid() is null then raise exception 'sign in to watch'; end if;
  select * into v_r from game_room where id = p_room;
  if not found then raise exception 'no such game'; end if;
  if not coalesce(v_r.allow_spectators, false) then raise exception 'this game does not allow spectators'; end if;
  if v_r.match_id is null then raise exception 'game not started'; end if;
  select * into v_m from matches where id = v_r.match_id;
  if not found or v_m.status <> 'playing' then raise exception 'game is over'; end if;
  return public._match_summary(v_m) || jsonb_build_object(
    'room_id', v_r.id,
    'deck_seed', v_m.deck_seed,
    'settings', v_m.settings,
    'seats', v_m.players,
    'moves', (select coalesce(jsonb_agg(jsonb_build_object(
                'seq', mm.seq, 'event', mm.event, 'sender', mm.sender,
                'payload', mm.payload, 't', extract(epoch from mm.at) * 1000) order by mm.seq), '[]'::jsonb)
              from match_moves mm where mm.match_id = v_m.id)
  );
end;
$$;

revoke all on function public.list_watchable_games() from public, anon;
revoke all on function public.get_live_match(integer) from public, anon;
grant execute on function public.list_watchable_games() to authenticated;
grant execute on function public.get_live_match(integer) to authenticated;
