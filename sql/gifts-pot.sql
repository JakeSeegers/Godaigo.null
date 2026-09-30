-- Gifts and the pot (owner, 2026-09-30), migration gifts_pot.
--
-- send_gift(name, phrase): the sender pays 100g; the receiver gets a random
--   25-100g (reward notice pop-up "A gift from X"); the rest goes to the pot.
--   A player receives at most one gift per UTC day (unique index). Guests
--   ("Guest" + 6 characters) cannot receive gifts; nobody can gift themself.
--   The message is one of the set phrases in _gift_phrases() (no free text).
-- The pot (game_pot, one row): when a real human game ends (finish_match:
--   finished with a winner, not last_standing, at least 2 non-guest humans,
--   at least 6 recorded turns), a chance (see below) that it pays out, split evenly
--   between those humans (leftover stays). Only if it holds >= 100g, at most
--   once per UTC day (pot_payouts.paid_on unique), and a player who already
--   won the pot today is left out.
--   Chance (migration pot_fill_chance_cap50): _pot_chance() = pot / 1000, at most
--   0.5: 1% per 10g, 100g = 10%, 500g or more = 50%. get_pot() returns it.
--   (Replaced pot_dynamic_chance, which used 2 / accounts active today.)
--   REPLACED by sql/pot-plinko.sql (migration pot_plinko): the pot is now decided by a
--   physics drop (pot_drops + edge function pot-drop), not random().
-- hermit_add_to_pot(amount): the Hermit adds (new) gold to the pot.
-- Badges: generous (send 10 gifts, activity 'gift_sent') and jackpot (win the
--   pot, activity 'pot_won'); both use the existing criteria types.

create table if not exists public.game_pot (
  id          integer primary key default 1 check (id = 1),
  amount      integer not null default 0 check (amount >= 0),
  updated_at  timestamptz not null default now()
);
insert into public.game_pot (id, amount) values (1, 0) on conflict (id) do nothing;

create table if not exists public.gifts (
  id         bigserial primary key,
  sender     uuid not null,
  recipient  uuid not null,
  cost       integer not null,
  received   integer not null,
  to_pot     integer not null,
  phrase     text not null default '',
  gift_day   date not null default ((now() at time zone 'utc')::date),
  created_at timestamptz not null default now()
);
create unique index if not exists gifts_one_per_day on public.gifts (recipient, gift_day);

create table if not exists public.pot_payouts (
  id         bigserial primary key,
  match_id   bigint,
  amount     integer not null,
  share      integer not null,
  winners    uuid[] not null,
  paid_on    date not null unique,
  created_at timestamptz not null default now()
);

-- Reward pop-ups now say where a reward came from: hermit (default), gift, pot.
alter table public.reward_notices add column if not exists kind text not null default 'hermit';
drop function if exists public.my_reward_notices();
create function public.my_reward_notices()
returns table (id bigint, title text, message text, gold integer, items text[], badge_id text, created_at timestamptz, kind text)
language sql stable security definer set search_path to 'public' as $$
  select n.id, n.title, n.message, n.gold, n.items, n.badge_id, n.created_at, n.kind
  from reward_notices n
  where n.user_id = auth.uid() and n.seen_at is null
  order by n.id;
$$;
revoke all on function public.my_reward_notices() from public, anon;
grant execute on function public.my_reward_notices() to authenticated;

alter table public.game_pot enable row level security;
alter table public.gifts enable row level security;
alter table public.pot_payouts enable row level security;

create or replace function public._utc_today() returns date language sql stable as $$
  select (now() at time zone 'utc')::date;
$$;

create or replace function public._gift_phrases() returns text[] language sql immutable as $$
  select array['For you!', 'Good game!', 'Thanks!', 'Well played!', 'Have fun!', 'You earned it!', 'Welcome!'];
$$;

create or replace function public._is_guest_name(p_name text) returns boolean language sql immutable as $$
  select coalesce(p_name, '') ~ '^Guest[A-Z0-9]{6}$';
$$;

-- Send a gift. Returns {received, to_pot, gold (sender's new gold), to}.
create or replace function public.send_gift(p_to text, p_phrase integer)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid    uuid := auth.uid();
  v_me     text;
  v_to     uuid;
  v_name   text;
  v_phrase text := (public._gift_phrases())[p_phrase];
  v_amount integer;
  v_gold   integer;
begin
  if v_uid is null then raise exception 'not signed in'; end if;
  if v_phrase is null then raise exception 'bad phrase'; end if;
  select user_id, display_name into v_to, v_name from user_profiles where lower(display_name) = lower(trim(p_to)) limit 1;
  if v_to is null then raise exception 'no such player'; end if;
  if v_to = v_uid then raise exception 'cannot gift yourself'; end if;
  if public._is_guest_name(v_name) then raise exception 'guests cannot get gifts'; end if;
  if exists (select 1 from gifts where recipient = v_to and gift_day = public._utc_today()) then
    raise exception 'already got a gift today';
  end if;

  update user_profiles set gold = gold - 100, updated_at = now()
  where user_id = v_uid and gold >= 100
  returning gold, display_name into v_gold, v_me;
  if not found then raise exception 'not enough gold'; end if;

  v_amount := 25 + floor(random() * 76)::integer;   -- 25..100
  insert into gifts (sender, recipient, cost, received, to_pot, phrase)
  values (v_uid, v_to, 100, v_amount, 100 - v_amount, v_phrase);   -- unique index: one per day

  perform award_gold(v_to, v_amount, 'Gift from ' || coalesce(v_me, 'a player'));
  update game_pot set amount = amount + (100 - v_amount), updated_at = now() where id = 1;

  insert into user_activities (user_id, activity_type, gold_spent, description, metadata)
  values (v_uid, 'gift_sent', 100, 'Gift to ' || v_name, jsonb_build_object('to', v_to, 'received', v_amount));
  insert into reward_notices (user_id, title, message, gold, kind)
  values (v_to, 'A gift from ' || coalesce(v_me, 'a player') || '!', v_phrase, v_amount, 'gift');

  return jsonb_build_object('received', v_amount, 'to_pot', 100 - v_amount, 'gold', v_gold, 'to', v_name);
end;
$$;

create or replace function public.get_pot()
returns jsonb language sql stable security definer set search_path to 'public' as $$
  select jsonb_build_object(
    'amount', (select amount from game_pot where id = 1),
    'paid_today', exists (select 1 from pot_payouts where paid_on = public._utc_today()),
    'min', 100);
$$;

create or replace function public.hermit_add_to_pot(p_amount integer)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare v integer;
begin
  if not public.is_hermit() then raise exception 'hermit only'; end if;
  if p_amount is null or p_amount < 1 or p_amount > 100000 then raise exception 'bad amount'; end if;
  update game_pot set amount = amount + p_amount, updated_at = now() where id = 1 returning amount into v;
  return v;
end;
$$;

-- Roll the pot for a just-finished match (called from finish_match).
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
  v_share  integer;
  u        uuid;
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

  if random() >= public._pot_chance() then return; end if;

  select amount into v_pot from game_pot where id = 1 for update;
  if v_pot < 100 then return; end if;
  v_share := v_pot / array_length(v_users, 1);
  if v_share < 1 then return; end if;

  insert into pot_payouts (match_id, amount, share, winners, paid_on)
  values (p_match, v_share * array_length(v_users, 1), v_share, v_users, public._utc_today());
  update game_pot set amount = amount - v_share * array_length(v_users, 1), updated_at = now() where id = 1;

  foreach u in array v_users loop
    perform award_gold(u, v_share, 'Won the pot');
    insert into reward_notices (user_id, title, message, gold, kind)
    values (u, 'You won the pot!', 'The pot paid out at the end of your game. Everyone in it got an equal share.', v_share, 'pot');
    insert into user_activities (user_id, activity_type, gold_awarded, description, metadata)
    values (u, 'pot_won', v_share, 'Won the pot', jsonb_build_object('match_id', p_match));
  end loop;
exception when unique_violation then
  return;   -- another game paid the pot today at the same moment
end;
$$;

-- Same as the live finish_match, plus the pot roll when the match really finishes now.
create or replace function public.finish_match(p_match_id bigint, p_winner_index integer, p_win_type text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_match record;
begin
  select * into v_match from matches where id = p_match_id;
  if not found then return; end if;
  if not (public.is_room_host(v_match.room_id) or public.is_hermit()) then
    raise exception 'not authorized';
  end if;
  update matches
  set status = 'finished', ended_at = now(), winner_index = p_winner_index,
      win_type = left(p_win_type, 32)
  where id = p_match_id and status = 'playing';
  if found then
    begin
      perform public._maybe_pay_pot(p_match_id);
    exception when others then
      null;   -- the pot must never stop a game from being recorded
    end;
  end if;
end;
$function$;

revoke all on function public._maybe_pay_pot(bigint) from public, anon, authenticated;
revoke all on function public.send_gift(text, integer) from public, anon;
revoke all on function public.hermit_add_to_pot(integer) from public, anon;
grant execute on function public.send_gift(text, integer) to authenticated;
grant execute on function public.hermit_add_to_pot(integer) to authenticated;
grant execute on function public.get_pot() to anon, authenticated;

insert into public.badges (id, name, description, icon, image, criteria, xp_reward, gold_reward, rarity, is_active) values
  ('generous', 'Generous', 'Send 10 gifts.', '🎁', 'px-generous.png', '{"type":"activity_count","activity_type":"gift_sent","count":10}', 0, 50, 'rare', true),
  ('jackpot',  'Jackpot',  'Win the pot.',   '💰', 'px-jackpot.png',  '{"type":"first_time","activity_type":"pot_won"}',              0,  0, 'epic', true)
on conflict (id) do update set name = excluded.name, description = excluded.description, icon = excluded.icon,
  image = excluded.image, criteria = excluded.criteria, gold_reward = excluded.gold_reward, rarity = excluded.rarity;

-- ── Chance: migrations pot_fill_chance + pot_fill_chance_cap50 ──────────────
create or replace function public._pot_chance()
returns numeric language sql stable security definer set search_path to 'public' as $$
  select least(0.5, greatest(0, (select amount from game_pot where id = 1)) / 1000.0)::numeric;
$$;
revoke all on function public._pot_chance() from public, anon, authenticated;
drop function if exists public._active_today();

create or replace function public.get_pot()
returns jsonb language sql stable security definer set search_path to 'public' as $$
  select jsonb_build_object(
    'amount', (select amount from game_pot where id = 1),
    'paid_today', exists (select 1 from pot_payouts where paid_on = public._utc_today()),
    'min', 100,
    'chance', round(public._pot_chance(), 3));
$$;
grant execute on function public.get_pot() to anon, authenticated;
-- _maybe_pay_pot (live version) uses: if random() >= public._pot_chance() then return; end if;
