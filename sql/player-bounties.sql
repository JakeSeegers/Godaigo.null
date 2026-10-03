-- Player bounties (2026-10-03, owner): "Beat me and win this."
-- Any signed-in (not guest) player in a WAITING room can put 100 to 500 gold on it; adds from
-- several players stack. The room's host is the one to beat.
--   * a human (not the host, not a guest) wins a game of 6+ turns and that win is PAID
--     (game_rewards.status = 'paid', i.e. witness-confirmed): the winner gets the whole bounty;
--   * the host wins, a guest wins, or the game was shorter than 6 turns: everyone gets their
--     own gold back;
--   * a bot wins, the game ends with no winner, or it is abandoned: the gold goes into the pot.
-- Settlement is lazy and idempotent (_settle_player_bounty): the client calls it at game over
-- and at sign-in. It does not touch _pay_game_win / finish_match (house rule 6 note).
-- RLS on, no client policies: everything goes through these functions.

create table if not exists public.player_bounties (
  room_id     integer primary key,
  host        uuid,
  host_name   text,
  total       integer not null default 0,
  status      text not null default 'open' check (status in ('open', 'paid', 'refunded', 'potted')),
  winner      uuid,
  winner_name text,
  match_id    bigint,
  created_at  timestamptz not null default now(),
  settled_at  timestamptz
);
create table if not exists public.player_bounty_stakes (
  room_id  integer not null,
  user_id  uuid not null,
  gold     integer not null,
  added_at timestamptz not null default now(),
  primary key (room_id, user_id)
);
create index if not exists player_bounties_open_idx on public.player_bounties (status) where status = 'open';
create index if not exists player_bounty_stakes_user_idx on public.player_bounty_stakes (user_id);
alter table public.player_bounties enable row level security;
alter table public.player_bounty_stakes enable row level security;

-- Pay gold with a pop-up (reward_notices kind 'bounty', js/rewards.js).
create or replace function public._bounty_notice(p_user uuid, p_title text, p_message text, p_gold integer)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  if coalesce(p_gold, 0) > 0 then perform award_gold(p_user, p_gold, p_title); end if;
  insert into reward_notices (user_id, title, message, gold, kind)
  values (p_user, p_title, coalesce(p_message, ''), coalesce(p_gold, 0), 'bounty');
end;
$$;

create or replace function public.post_player_bounty(p_room integer, p_gold integer)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid  uuid := auth.uid();
  v_name text;
  v_host record;
  v_b    player_bounties%rowtype;
  v_total integer;
begin
  if v_uid is null then raise exception 'not signed in'; end if;
  select display_name into v_name from user_profiles where user_id = v_uid;
  if public._is_guest_name(v_name) then raise exception 'guests cannot post bounties'; end if;
  if p_gold is null or p_gold < 100 or p_gold > 500 then raise exception 'bounty must be 100 to 500 gold'; end if;
  if not exists (select 1 from game_room where id = p_room and status = 'waiting') then
    raise exception 'bounties can only be added before the game starts';
  end if;
  if not exists (select 1 from players where game_id = p_room and user_id = v_uid) then
    raise exception 'not in this room';
  end if;
  select * into v_b from player_bounties where room_id = p_room for update;
  if found and v_b.status <> 'open' then raise exception 'this bounty is closed'; end if;

  update user_profiles set gold = gold - p_gold, updated_at = now()
  where user_id = v_uid and gold >= p_gold;
  if not found then raise exception 'not enough gold'; end if;

  if v_b.room_id is null then
    -- the host = first human seat (same rule as is_room_host)
    select p.user_id, coalesce(up.display_name, p.username) as name into v_host
    from players p left join user_profiles up on up.user_id = p.user_id
    where p.game_id = p_room and p.username not like '🤖%'
    order by p.created_at asc limit 1;
    insert into player_bounties (room_id, host, host_name, total)
    values (p_room, v_host.user_id, v_host.name, 0);
  end if;
  insert into player_bounty_stakes (room_id, user_id, gold) values (p_room, v_uid, p_gold)
  on conflict (room_id, user_id) do update set gold = player_bounty_stakes.gold + excluded.gold, added_at = now();
  update player_bounties set total = total + p_gold where room_id = p_room returning total into v_total;
  insert into user_activities (user_id, activity_type, gold_spent, description, metadata)
  values (v_uid, 'gold_spent', p_gold, 'Bounty', jsonb_build_object('item', 'bounty', 'room', p_room));
  return v_total;
end;
$$;

create or replace function public.get_player_bounty(p_room integer)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  select jsonb_build_object('room_id', b.room_id, 'total', b.total, 'status', b.status,
           'host', b.host, 'host_name', b.host_name, 'winner_name', b.winner_name,
           'stakes', coalesce((select jsonb_agg(jsonb_build_object('name', up.display_name, 'gold', s.gold) order by s.added_at)
                               from player_bounty_stakes s left join user_profiles up on up.user_id = s.user_id
                               where s.room_id = b.room_id), '[]'::jsonb))
  from player_bounties b where b.room_id = p_room;
$$;

create or replace function public.list_player_bounties()
returns table (room_id integer, total integer, host_name text)
language sql
stable
security definer
set search_path to 'public'
as $$
  select b.room_id, b.total, b.host_name
  from player_bounties b join game_room r on r.id = b.room_id
  where b.status = 'open' and r.status in ('waiting', 'playing');
$$;

-- Refund every stake / move the total into the pot.
create or replace function public._bounty_refund(p_room integer, p_why text)
returns void language plpgsql security definer set search_path to 'public' as $$
declare s record;
begin
  for s in select * from player_bounty_stakes where room_id = p_room loop
    perform public._bounty_notice(s.user_id, 'Bounty refunded', p_why, s.gold);
  end loop;
  update player_bounties set status = 'refunded', settled_at = now() where room_id = p_room;
end;
$$;
create or replace function public._bounty_pot(p_room integer, p_why text)
returns void language plpgsql security definer set search_path to 'public' as $$
declare s record; v_total integer;
begin
  select total into v_total from player_bounties where room_id = p_room;
  update game_pot set amount = amount + coalesce(v_total, 0), updated_at = now() where id = 1;
  for s in select * from player_bounty_stakes where room_id = p_room loop
    perform public._bounty_notice(s.user_id, 'Your bounty went into the pot', p_why, 0);
  end loop;
  update player_bounties set status = 'potted', settled_at = now() where room_id = p_room;
end;
$$;

-- Returns the bounty status after trying to settle it.
create or replace function public._settle_player_bounty(p_room integer)
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  b      player_bounties%rowtype;
  r      game_room%rowtype;
  m      matches%rowtype;
  v_seat jsonb;
  v_win  uuid;
  v_name text;
  v_paid text;
begin
  select * into b from player_bounties where room_id = p_room for update;
  if not found then return null; end if;
  if b.status <> 'open' then return b.status; end if;

  select * into r from game_room where id = p_room;
  select * into m from matches where room_id = p_room and started_at >= b.created_at - interval '1 minute'
  order by id desc limit 1;

  if m.id is null then
    -- never started: refund when the room is gone or has waited 2 hours
    if r.id is null or (r.status = 'waiting' and b.created_at < now() - interval '2 hours') or r.status = 'finished' then
      perform public._bounty_refund(p_room, 'The game never started, so you get your gold back.');
      return 'refunded';
    end if;
    return 'open';
  end if;
  update player_bounties set match_id = m.id where room_id = p_room;

  if m.status = 'playing' then
    if m.last_move_at < now() - interval '30 minutes' then
      perform public._bounty_pot(p_room, 'The game was abandoned, so the bounty went into the pot.');
      return 'potted';
    end if;
    return 'open';
  end if;
  if m.status = 'abandoned' or m.winner_index is null then
    perform public._bounty_pot(p_room, 'The game ended with no winner, so the bounty went into the pot.');
    return 'potted';
  end if;

  select p into v_seat from jsonb_array_elements(m.players) p where (p->>'index')::integer = m.winner_index limit 1;
  if v_seat is null or coalesce((v_seat->>'is_bot')::boolean, false) or nullif(v_seat->>'user_id', '') is null then
    perform public._bounty_pot(p_room, 'A bot won, so the bounty went into the pot.');
    return 'potted';
  end if;
  v_win := (v_seat->>'user_id')::uuid;
  select display_name into v_name from user_profiles where user_id = v_win;

  if v_win = b.host then
    perform public._bounty_refund(p_room, coalesce(b.host_name, 'The host') || ' defended the bounty, so everyone gets their gold back.');
    return 'refunded';
  end if;
  if public._is_guest_name(v_name) or coalesce(public._match_turns(m.id), 0) < 6 then
    perform public._bounty_refund(p_room, 'The game was too short or won by a guest, so you get your gold back.');
    return 'refunded';
  end if;

  select status into v_paid from game_rewards where room_id = p_room and user_id = v_win;
  if v_paid = 'paid' then
    perform public._bounty_notice(v_win, 'Bounty won!',
      'You beat ' || coalesce(b.host_name, 'the host') || ' and took the bounty.', b.total);
    update player_bounties set status = 'paid', winner = v_win, winner_name = v_name, settled_at = now()
    where room_id = p_room;
    return 'paid';
  end if;
  if coalesce(m.ended_at, now()) < now() - interval '1 day' then
    perform public._bounty_refund(p_room, 'The win was never confirmed, so you get your gold back.');
    return 'refunded';
  end if;
  return 'open';   -- win still waiting for a witness
end;
$$;

create or replace function public.settle_player_bounty(p_room integer)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_status text;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  v_status := public._settle_player_bounty(p_room);
  return public.get_player_bounty(p_room) || jsonb_build_object('status', v_status);
end;
$$;

-- Sign-in: settle every open bounty I staked on or might have won (my last games).
create or replace function public.settle_my_player_bounties()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_uid uuid := auth.uid(); x record; n integer := 0;
begin
  if v_uid is null then raise exception 'not signed in'; end if;
  for x in
    select b.room_id from player_bounties b
    where b.status = 'open' and (
      exists (select 1 from player_bounty_stakes s where s.room_id = b.room_id and s.user_id = v_uid)
      or exists (select 1 from game_rewards g where g.room_id = b.room_id and g.user_id = v_uid))
    limit 20
  loop
    if public._settle_player_bounty(x.room_id) <> 'open' then n := n + 1; end if;
  end loop;
  return n;
end;
$$;

revoke all on function public._bounty_notice(uuid, text, text, integer) from public, anon, authenticated;
revoke all on function public._bounty_refund(integer, text) from public, anon, authenticated;
revoke all on function public._bounty_pot(integer, text) from public, anon, authenticated;
revoke all on function public._settle_player_bounty(integer) from public, anon, authenticated;
revoke all on function public.post_player_bounty(integer, integer) from public, anon;
revoke all on function public.settle_player_bounty(integer) from public, anon;
revoke all on function public.settle_my_player_bounties() from public, anon;
grant execute on function public.post_player_bounty(integer, integer) to authenticated;
grant execute on function public.settle_player_bounty(integer) to authenticated;
grant execute on function public.settle_my_player_bounties() to authenticated;
grant execute on function public.get_player_bounty(integer) to anon, authenticated;
grant execute on function public.list_player_bounties() to anon, authenticated;
