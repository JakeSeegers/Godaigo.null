-- Hermit rewards: sign-up events, game bounties, special badges, badge slots.
-- Added 2026-09-30 (migration hermit_rewards) for the stream.
--
-- Everything that gives gold, items or badges runs here, on the server:
--   * hermit_events + claim_signup_events(): "the first N people to make a
--     real (non-guest) account after the event starts get a reward".
--   * game_bounties: the Hermit puts a reward on a game; the winner gets it
--     when their win is paid (_pay_game_win calls _pay_bounty).
--   * reward_notices: one row per reward given; the client shows it as a
--     pop-up with the Hermit's message (my_reward_notices / mark seen).
--   * badges.image + criteria {"type":"special"}: Hermit badges with a
--     picture from images/badges/ (badge list: images/badges/badges.json).
--     check_badge_criteria() skips the "special" type, so only a reward
--     can give one.
--   * user_profiles.badge_slots (1 free, max 3, 700g each) and
--     shown_badges (the badges shown next to the player's name).
-- Reward items are cosmetic ids added to cosmetics_owned (they may be
-- hidden items with no shop price, e.g. pawn_rim_plunger).
-- All new tables: RLS on, no client policies (RPCs only).

alter table public.badges add column if not exists image text;
alter table public.user_profiles add column if not exists badge_slots integer not null default 1;
alter table public.user_profiles add column if not exists shown_badges text[] not null default '{}';

create table if not exists public.hermit_events (
  id          bigserial primary key,
  kind        text not null default 'first_signup' check (kind in ('first_signup')),
  title       text not null default '',
  message     text not null default '',
  gold        integer not null default 0 check (gold between 0 and 100000),
  items       text[] not null default '{}',
  badge_id    text,
  max_winners integer not null default 1 check (max_winners between 1 and 1000),
  active      boolean not null default true,
  started_at  timestamptz not null default now(),
  ended_at    timestamptz
);

create table if not exists public.hermit_event_winners (
  event_id   bigint not null references public.hermit_events(id) on delete cascade,
  user_id    uuid not null,
  username   text,
  awarded_at timestamptz not null default now(),
  primary key (event_id, user_id)
);

create table if not exists public.game_bounties (
  room_id     integer primary key,
  title       text not null default '',
  message     text not null default '',
  gold        integer not null default 0 check (gold between 0 and 100000),
  items       text[] not null default '{}',
  badge_id    text,
  created_at  timestamptz not null default now(),
  winner      uuid,
  winner_name text,
  paid_at     timestamptz
);

create table if not exists public.reward_notices (
  id         bigserial primary key,
  user_id    uuid not null,
  title      text not null default '',
  message    text not null default '',
  gold       integer not null default 0,
  items      text[] not null default '{}',
  badge_id   text,
  created_at timestamptz not null default now(),
  seen_at    timestamptz
);
create index if not exists reward_notices_user_idx on public.reward_notices (user_id) where seen_at is null;

alter table public.hermit_events enable row level security;
alter table public.hermit_event_winners enable row level security;
alter table public.game_bounties enable row level security;
alter table public.reward_notices enable row level security;

-- ── Helpers ─────────────────────────────────────────────────────
-- Clean a list of cosmetic ids: known shapes only, no duplicates.
create or replace function public._clean_items(p_items text[])
returns text[]
language sql
immutable
as $$
  select coalesce(array_agg(distinct i), '{}')
  from unnest(coalesce(p_items, '{}')) i
  where i ~ '^(name|pawn)_[a-z0-9_]{2,40}$';
$$;

-- Give one reward: gold, items, badge, and a notice for the pop-up.
create or replace function public._grant_reward(p_user uuid, p_title text, p_message text,
                                                p_gold integer, p_items text[], p_badge text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_items text[] := public._clean_items(p_items);
begin
  if coalesce(p_gold, 0) > 0 then
    perform award_gold(p_user, p_gold, 'Hermit reward: ' || coalesce(nullif(p_title, ''), 'special'));
  end if;
  if array_length(v_items, 1) > 0 then
    update user_profiles
    set cosmetics_owned = array(select distinct unnest(cosmetics_owned || v_items)), updated_at = now()
    where user_id = p_user;
  end if;
  if p_badge is not null and exists (select 1 from badges where id = p_badge) then
    perform award_badge(p_user, p_badge);
  end if;
  insert into reward_notices (user_id, title, message, gold, items, badge_id)
  values (p_user, coalesce(p_title, ''), coalesce(p_message, ''), coalesce(p_gold, 0), v_items, p_badge);
end;
$$;

-- ── Special badges (Hermit) ─────────────────────────────────────
-- Create or update a special badge from images/badges/badges.json.
-- Never touches the normal (earned by playing) badges.
create or replace function public.hermit_upsert_badge(p_id text, p_name text, p_description text, p_image text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not public.is_hermit() then raise exception 'hermit only'; end if;
  if p_id !~ '^[a-z0-9_]{2,40}$' then raise exception 'bad badge id'; end if;
  if p_image is not null and p_image !~ '^[A-Za-z0-9_\-]{1,60}\.(png|webp|gif)$' then raise exception 'bad image name'; end if;
  insert into badges (id, name, description, icon, image, criteria, xp_reward, gold_reward, rarity, is_active)
  values (p_id, left(coalesce(p_name, p_id), 255), coalesce(p_description, ''), '🎖️', p_image,
          '{"type":"special"}'::jsonb, 0, 0, 'legendary', true)
  on conflict (id) do update
    set name = excluded.name, description = excluded.description, image = excluded.image
    where badges.criteria->>'type' = 'special';
end;
$$;

-- ── Sign-up events ──────────────────────────────────────────────
create or replace function public.hermit_start_signup_event(p_title text, p_message text, p_gold integer,
                                                            p_items text[], p_badge text, p_max integer)
returns bigint
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_id bigint;
begin
  if not public.is_hermit() then raise exception 'hermit only'; end if;
  if p_badge is not null and not exists (select 1 from badges where id = p_badge) then raise exception 'unknown badge'; end if;
  insert into hermit_events (kind, title, message, gold, items, badge_id, max_winners)
  values ('first_signup', coalesce(p_title, ''), coalesce(p_message, ''), greatest(coalesce(p_gold, 0), 0),
          public._clean_items(p_items), p_badge, greatest(coalesce(p_max, 1), 1))
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.hermit_stop_event(p_id bigint)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not public.is_hermit() then raise exception 'hermit only'; end if;
  update hermit_events set active = false, ended_at = coalesce(ended_at, now()) where id = p_id;
end;
$$;

create or replace function public.hermit_list_events()
returns table (id bigint, title text, message text, gold integer, items text[], badge_id text,
               max_winners integer, active boolean, started_at timestamptz, ended_at timestamptz, winners text[])
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not public.is_hermit() then raise exception 'hermit only'; end if;
  return query
    select e.id, e.title, e.message, e.gold, e.items, e.badge_id, e.max_winners, e.active, e.started_at, e.ended_at,
           coalesce((select array_agg(w.username order by w.awarded_at) from hermit_event_winners w where w.event_id = e.id), '{}')
    from hermit_events e
    order by e.id desc
    limit 20;
end;
$$;

-- Called by the client after sign-in / sign-up. Pays every active event
-- this account qualifies for: a real account (not "Guest" + 6 characters)
-- made after the event started, while winners are still left.
create or replace function public.claim_signup_events()
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'auth'
as $$
declare
  v_uid     uuid := auth.uid();
  v_created timestamptz;
  v_name    text;
  v_n       integer;
  v_out     jsonb := '[]'::jsonb;
  ev        record;
begin
  if v_uid is null then return v_out; end if;
  select u.created_at, u.raw_user_meta_data->>'username' into v_created, v_name from auth.users u where u.id = v_uid;
  if v_created is null or coalesce(v_name, '') ~ '^Guest[A-Z0-9]{6}$' then return v_out; end if;
  -- The profile must exist first, or the gold would go nowhere (the client retries later).
  if not exists (select 1 from user_profiles where user_id = v_uid) then return v_out; end if;
  select coalesce(display_name, v_name) into v_name from user_profiles where user_id = v_uid;

  for ev in
    select * from hermit_events
    where active and kind = 'first_signup' and started_at <= v_created
    order by id
    for update
  loop
    continue when exists (select 1 from hermit_event_winners w where w.event_id = ev.id and w.user_id = v_uid);
    select count(*) into v_n from hermit_event_winners w where w.event_id = ev.id;
    if v_n >= ev.max_winners then
      update hermit_events set active = false, ended_at = coalesce(ended_at, now()) where id = ev.id;
      continue;
    end if;
    insert into hermit_event_winners (event_id, user_id, username) values (ev.id, v_uid, v_name);
    perform public._grant_reward(v_uid, ev.title, ev.message, ev.gold, ev.items, ev.badge_id);
    if v_n + 1 >= ev.max_winners then
      update hermit_events set active = false, ended_at = now() where id = ev.id;
    end if;
    v_out := v_out || jsonb_build_object('event', ev.id, 'title', ev.title);
  end loop;
  return v_out;
end;
$$;

-- ── Game bounties ───────────────────────────────────────────────
create or replace function public.hermit_set_bounty(p_room integer, p_title text, p_message text, p_gold integer,
                                                    p_items text[], p_badge text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not public.is_hermit() then raise exception 'hermit only'; end if;
  if not exists (select 1 from game_room where id = p_room) then raise exception 'no such room'; end if;
  if p_badge is not null and not exists (select 1 from badges where id = p_badge) then raise exception 'unknown badge'; end if;
  insert into game_bounties (room_id, title, message, gold, items, badge_id)
  values (p_room, coalesce(p_title, ''), coalesce(p_message, ''), greatest(coalesce(p_gold, 0), 0),
          public._clean_items(p_items), p_badge)
  on conflict (room_id) do update
    set title = excluded.title, message = excluded.message, gold = excluded.gold, items = excluded.items,
        badge_id = excluded.badge_id, created_at = now(), winner = null, winner_name = null, paid_at = null;
end;
$$;

create or replace function public.hermit_clear_bounty(p_room integer)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not public.is_hermit() then raise exception 'hermit only'; end if;
  delete from game_bounties where room_id = p_room and paid_at is null;
end;
$$;

-- All rooms right now (waiting or playing, private too), for the Hermit.
create or replace function public.hermit_list_rooms()
returns table (id integer, host_name text, status text, is_private boolean, players text[],
               bounty_title text, bounty_gold integer, bounty_badge text, bounty_winner text)
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not public.is_hermit() then raise exception 'hermit only'; end if;
  return query
    select r.id, r.host_name, r.status, r.is_private,
           coalesce((select array_agg(p.username order by p.player_index) from players p where p.game_id = r.id), '{}'),
           b.title, b.gold, b.badge_id, b.winner_name
    from game_room r
    left join game_bounties b on b.room_id = r.id
    where r.status in ('waiting', 'playing')
    order by r.created_at desc
    limit 50;
end;
$$;

-- Public: unpaid bounties, so room cards and players in the game can show them.
create or replace function public.list_bounties()
returns table (room_id integer, title text, gold integer, badge_id text, has_items boolean)
language sql
stable
security definer
set search_path to 'public'
as $$
  select b.room_id, b.title, b.gold, b.badge_id, coalesce(array_length(b.items, 1), 0) > 0
  from game_bounties b
  where b.paid_at is null;
$$;

-- Pay a room's bounty to the winner (called from _pay_game_win).
create or replace function public._pay_bounty(p_room integer, p_user uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  b record;
  v_name text;
begin
  select * into b from game_bounties where room_id = p_room and paid_at is null for update;
  if not found then return; end if;
  select display_name into v_name from user_profiles where user_id = p_user;
  update game_bounties set winner = p_user, winner_name = v_name, paid_at = now() where room_id = p_room;
  perform public._grant_reward(p_user, b.title, b.message, b.gold, b.items, b.badge_id);
end;
$$;

-- Same as the live _pay_game_win (sql/ladder-secure.sql era), plus the bounty.
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

  -- Hermit bounty on this game (sql/hermit-rewards.sql).
  perform public._pay_bounty(p_room_id, p_user);

  return v_res || jsonb_build_object('success', true, 'xp', p_xp, 'num_players', p_n);
end;
$function$;

-- ── Reward pop-ups ──────────────────────────────────────────────
create or replace function public.my_reward_notices()
returns table (id bigint, title text, message text, gold integer, items text[], badge_id text, created_at timestamptz)
language sql
stable
security definer
set search_path to 'public'
as $$
  select n.id, n.title, n.message, n.gold, n.items, n.badge_id, n.created_at
  from reward_notices n
  where n.user_id = auth.uid() and n.seen_at is null
  order by n.id;
$$;

create or replace function public.mark_reward_notice_seen(p_id bigint)
returns void
language sql
security definer
set search_path to 'public'
as $$
  update reward_notices set seen_at = now() where id = p_id and user_id = auth.uid();
$$;

-- ── Badge slots ─────────────────────────────────────────────────
create or replace function public.badge_slot_price() returns integer language sql immutable as $$ select 700 $$;

-- Buy one more badge slot (max 3). Returns the new gold total.
create or replace function public.buy_badge_slot()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid   uuid := auth.uid();
  v_price integer := public.badge_slot_price();
  v_gold  integer;
begin
  if v_uid is null then raise exception 'not signed in'; end if;
  update user_profiles
  set gold = gold - v_price, badge_slots = badge_slots + 1, updated_at = now()
  where user_id = v_uid and gold >= v_price and badge_slots < 3
  returning gold into v_gold;
  if not found then
    if exists (select 1 from user_profiles where user_id = v_uid and badge_slots >= 3) then
      raise exception 'all slots owned';
    end if;
    raise exception 'not enough gold';
  end if;
  insert into user_activities (user_id, activity_type, gold_spent, description, metadata)
  values (v_uid, 'gold_spent', v_price, 'Badge slot', jsonb_build_object('item', 'badge_slot'));
  return v_gold;
end;
$$;

-- Choose which earned badges show next to your name (at most badge_slots).
create or replace function public.set_shown_badges(p_ids text[])
returns text[]
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid  uuid := auth.uid();
  v_prof record;
  v_ids  text[];
begin
  if v_uid is null then raise exception 'not signed in'; end if;
  select badges_earned, badge_slots into v_prof from user_profiles where user_id = v_uid;
  if not found then raise exception 'no profile'; end if;
  select coalesce(array_agg(x order by ord), '{}') into v_ids
  from (select distinct on (x) x, ord from unnest(coalesce(p_ids, '{}')) with ordinality as t(x, ord) order by x, ord) d;
  if array_length(v_ids, 1) > v_prof.badge_slots then raise exception 'not enough badge slots'; end if;
  if exists (select 1 from unnest(v_ids) x where not (coalesce(v_prof.badges_earned, '[]'::jsonb) ? x)) then
    raise exception 'badge not earned';
  end if;
  update user_profiles set shown_badges = v_ids, updated_at = now() where user_id = v_uid;
  return v_ids;
end;
$$;

-- ── Grants ──────────────────────────────────────────────────────
revoke all on function public._clean_items(text[]) from public, anon, authenticated;
revoke all on function public._grant_reward(uuid, text, text, integer, text[], text) from public, anon, authenticated;
revoke all on function public._pay_bounty(integer, uuid) from public, anon, authenticated;
revoke all on function public._pay_game_win(integer, uuid, integer, integer) from public, anon, authenticated;

revoke all on function public.hermit_upsert_badge(text, text, text, text) from public, anon;
revoke all on function public.hermit_start_signup_event(text, text, integer, text[], text, integer) from public, anon;
revoke all on function public.hermit_stop_event(bigint) from public, anon;
revoke all on function public.hermit_list_events() from public, anon;
revoke all on function public.hermit_set_bounty(integer, text, text, integer, text[], text) from public, anon;
revoke all on function public.hermit_clear_bounty(integer) from public, anon;
revoke all on function public.hermit_list_rooms() from public, anon;
revoke all on function public.claim_signup_events() from public, anon;
revoke all on function public.my_reward_notices() from public, anon;
revoke all on function public.mark_reward_notice_seen(bigint) from public, anon;
revoke all on function public.buy_badge_slot() from public, anon;
revoke all on function public.set_shown_badges(text[]) from public, anon;

grant execute on function public.hermit_upsert_badge(text, text, text, text) to authenticated;
grant execute on function public.hermit_start_signup_event(text, text, integer, text[], text, integer) to authenticated;
grant execute on function public.hermit_stop_event(bigint) to authenticated;
grant execute on function public.hermit_list_events() to authenticated;
grant execute on function public.hermit_set_bounty(integer, text, text, integer, text[], text) to authenticated;
grant execute on function public.hermit_clear_bounty(integer) to authenticated;
grant execute on function public.hermit_list_rooms() to authenticated;
grant execute on function public.claim_signup_events() to authenticated;
grant execute on function public.my_reward_notices() to authenticated;
grant execute on function public.mark_reward_notice_seen(bigint) to authenticated;
grant execute on function public.buy_badge_slot() to authenticated;
grant execute on function public.set_shown_badges(text[]) to authenticated;
grant execute on function public.list_bounties() to anon, authenticated;
