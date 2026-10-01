-- Server clock (2026-10-01), migration server_clock.
-- Match 43: Plunge87's computer clock was 106.7 s slow. The game used each
-- player's own clock for
--   * players.last_seen (heartbeat): his public room looked older than 90 s
--     to everyone else, so the lobby hid it;
--   * a turn's start time (turnStartedAt, sent by whoever ended the turn): the
--     next player's timer started 107 s short.
-- Now the server stamps last_seen itself (trigger), and clients read
-- server_now_ms() to know their own clock offset (js/multiplayer-state.js
-- window.serverNow()).

create or replace function public.server_now_ms()
returns bigint language sql stable as $$
  select (extract(epoch from clock_timestamp()) * 1000)::bigint;
$$;
grant execute on function public.server_now_ms() to anon, authenticated;

create or replace function public._players_server_last_seen()
returns trigger language plpgsql as $$
begin
  if new.last_seen is not null and (tg_op = 'INSERT' or new.last_seen is distinct from old.last_seen) then
    new.last_seen := now();
  end if;
  return new;
end;
$$;

drop trigger if exists players_server_last_seen on public.players;
create trigger players_server_last_seen
  before insert or update of last_seen on public.players
  for each row execute function public._players_server_last_seen();
