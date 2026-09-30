-- The pot drop (owner, 2026-09-30), migration pot_plinko.
--
-- The pot is no longer rolled with random(). When a game qualifies (same rules
-- as before, see sql/gifts-pot.sql: real finished game, not last_standing, 2+
-- non-guest humans, 6+ turns, pot >= 100g, pot not paid today), _maybe_pay_pot
-- records a pending drop in pot_drops: a random seed and coins = pot / 10
-- (at most 70). The edge function supabase/functions/pot-drop runs the plinko
-- physics (js/plinko-sim.js, Matter.js 0.19.0) with that seed and calls
-- _settle_pot_drop: if a coin fell into the treasure slot, the pot pays out
-- exactly like before (equal split, reward notice kind 'pot', 'pot_won'
-- activity for the Jackpot badge, once per UTC day via pot_payouts.paid_on).
-- Every player of the game then replays the same drop at game over
-- (js/pot-plinko.js, get_pot_drop).
-- Odds: each coin about 1 in 100 (tools/plinko-tune.mjs). _pot_chance() now
-- reports 1 - 0.99 ^ coins for the Shop.

create table if not exists public.pot_drops (
  id          bigserial primary key,
  match_id    bigint not null unique,
  room_id     integer,
  seed        bigint not null,
  pot_amount  integer not null,
  coins       integer not null,
  users       uuid[] not null,
  status      text not null default 'pending',   -- pending / done
  slots       integer[],
  hit_coin    integer,
  won         boolean not null default false,
  share       integer,
  sim_version integer,
  created_at  timestamptz not null default now(),
  done_at     timestamptz
);
create index if not exists pot_drops_room on public.pot_drops (room_id, created_at desc);
create index if not exists pot_drops_pending on public.pot_drops (created_at) where status = 'pending';
alter table public.pot_drops enable row level security;

create or replace function public._pot_coins(p_pot integer)
returns integer language sql immutable as $$
  select least(70, greatest(0, coalesce(p_pot, 0)) / 10);
$$;

create or replace function public._pot_chance()
returns numeric language sql stable security definer set search_path to 'public' as $$
  select case when amount < 100 then 0
              else (1 - power(0.99, public._pot_coins(amount)))::numeric end
  from game_pot where id = 1;
$$;
revoke all on function public._pot_chance() from public, anon, authenticated;

create or replace function public.get_pot()
returns jsonb language sql stable security definer set search_path to 'public' as $$
  select jsonb_build_object(
    'amount', (select amount from game_pot where id = 1),
    'paid_today', exists (select 1 from pot_payouts where paid_on = public._utc_today()),
    'min', 100,
    'coins', public._pot_coins((select amount from game_pot where id = 1)),
    'chance', round(public._pot_chance(), 3));
$$;
grant execute on function public.get_pot() to anon, authenticated;

-- Called from finish_match: record a drop when the game qualifies.
create or replace function public._maybe_pay_pot(p_match bigint)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  m        record;
  v_pot    integer;
  v_users  uuid[];
begin
  select * into m from matches where id = p_match;
  if not found or m.status <> 'finished' or m.winner_index is null
     or coalesce(m.win_type, '') = 'last_standing' then return; end if;
  if coalesce(public._match_turns(p_match), 0) < 6 then return; end if;
  if exists (select 1 from pot_payouts where paid_on = public._utc_today()) then return; end if;

  -- Human, non-guest players who have not won the pot today.
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
$$;
revoke all on function public._maybe_pay_pot(bigint) from public, anon, authenticated;

-- The edge function reports the physics result. Service role only.
-- p_slots: landing slot per coin (-1 = treasure). Pays when a coin hit.
create or replace function public._settle_pot_drop(p_id bigint, p_slots integer[], p_version integer)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  d        record;
  v_hit    integer;
  v_pot    integer;
  v_users  uuid[];
  v_share  integer;
  v_won    boolean := false;
  u        uuid;
begin
  select * into d from pot_drops where id = p_id for update;
  if not found then raise exception 'no such drop'; end if;
  if d.status <> 'pending' then return to_jsonb(d); end if;
  if coalesce(array_length(p_slots, 1), 0) <> d.coins then raise exception 'wrong slot count'; end if;
  v_hit := array_position(p_slots, -1) - 1;   -- 0-based coin index, null = no hit

  if v_hit is not null and not exists (select 1 from pot_payouts where paid_on = public._utc_today()) then
    v_users := array(select x from unnest(d.users) x
                     where not exists (select 1 from pot_payouts pp where pp.paid_on = public._utc_today() and x = any(pp.winners)));
    select amount into v_pot from game_pot where id = 1 for update;
    if coalesce(array_length(v_users, 1), 0) >= 1 and v_pot >= 100 then
      v_share := v_pot / array_length(v_users, 1);
      begin
        insert into pot_payouts (match_id, amount, share, winners, paid_on)
        values (d.match_id, v_share * array_length(v_users, 1), v_share, v_users, public._utc_today());
        v_won := true;
      exception when unique_violation then
        v_won := false;   -- another game paid the pot today at the same moment
      end;
      if v_won then
        update game_pot set amount = amount - v_share * array_length(v_users, 1), updated_at = now() where id = 1;
        foreach u in array v_users loop
          perform award_gold(u, v_share, 'Won the pot');
          insert into reward_notices (user_id, title, message, gold, kind)
          values (u, 'You won the pot!', 'A coin fell into the treasure! Everyone in the game got an equal share.', v_share, 'pot');
          insert into user_activities (user_id, activity_type, gold_awarded, description, metadata)
          values (u, 'pot_won', v_share, 'Won the pot', jsonb_build_object('match_id', d.match_id));
        end loop;
      end if;
    end if;
  end if;

  update pot_drops set status = 'done', slots = p_slots, hit_coin = v_hit, won = v_won,
         share = case when v_won then v_share end, sim_version = p_version, done_at = now()
  where id = p_id returning * into d;
  return to_jsonb(d);
end;
$$;
revoke all on function public._settle_pot_drop(bigint, integer[], integer) from public, anon, authenticated;
grant execute on function public._settle_pot_drop(bigint, integer[], integer) to service_role;

-- Pending drops for the edge function: the room's newest, plus stale ones. Service role only.
create or replace function public._pending_pot_drops(p_room integer)
returns setof public.pot_drops
language sql stable security definer set search_path to 'public' as $$
  (select * from pot_drops where status = 'pending' and room_id = p_room
     and created_at > now() - interval '30 minutes' order by id desc limit 1)
  union
  (select * from pot_drops where status = 'pending' and created_at < now() - interval '1 minute'
     order by id limit 5);
$$;
revoke all on function public._pending_pot_drops(integer) from public, anon, authenticated;
grant execute on function public._pending_pot_drops(integer) to service_role;

-- The newest drop of a room (last 10 minutes) for a player of that game.
create or replace function public.get_pot_drop(p_room integer)
returns jsonb
language sql stable security definer set search_path to 'public' as $$
  select jsonb_build_object('id', d.id, 'seed', d.seed, 'coins', d.coins, 'pot_amount', d.pot_amount,
                            'status', d.status, 'slots', d.slots, 'hit_coin', d.hit_coin, 'won', d.won,
                            'share', d.share, 'sim_version', d.sim_version,
                            'pot_now', (select amount from game_pot where id = 1))
  from pot_drops d
  join matches m on m.id = d.match_id
  where d.room_id = p_room and d.created_at > now() - interval '10 minutes'
    and (public.is_hermit() or exists (
      select 1 from jsonb_array_elements(m.players) p where p->>'user_id' = auth.uid()::text))
  order by d.id desc
  limit 1;
$$;
revoke all on function public.get_pot_drop(integer) from public, anon;
grant execute on function public.get_pot_drop(integer) to authenticated;
