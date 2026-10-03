-- Game plans (2026-10-03, owner): "X invites you to play", Doodle style.
-- The creator invites up to 5 friends (or players they shared a game with in the
-- last 30 days) and proposes up to 8 times. Everyone answers each time with
-- Yes / If need be / No and sees everyone's answers. The creator picks the final
-- time (the client stars the best one). Near that time the creator opens a room;
-- members see a Join button. Step 2 (emails) and step 3 (calendar busy times)
-- come later (docs/game-plans.md).
-- Times are stored as timestamptz (UTC); the client shows them in each player's
-- own time zone. RLS on, no client policies: everything goes through these functions.

create table if not exists public.game_plans (
  id          bigserial primary key,
  creator     uuid not null,
  title       text not null default '',
  status      text not null default 'open' check (status in ('open', 'set', 'cancelled')),
  final_slot  integer,
  room_id     integer,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create table if not exists public.game_plan_slots (
  plan_id bigint not null references public.game_plans(id) on delete cascade,
  slot    integer not null,
  at      timestamptz not null,
  primary key (plan_id, slot)
);
create table if not exists public.game_plan_members (
  plan_id     bigint not null references public.game_plans(id) on delete cascade,
  user_id     uuid not null,
  answered_at timestamptz,
  primary key (plan_id, user_id)
);
create index if not exists game_plan_members_user_idx on public.game_plan_members (user_id);
create table if not exists public.game_plan_votes (
  plan_id bigint not null references public.game_plans(id) on delete cascade,
  user_id uuid not null,
  slot    integer not null,
  answer  smallint not null check (answer in (0, 1, 2)),   -- 0 no, 1 if need be, 2 yes
  primary key (plan_id, user_id, slot)
);
alter table public.game_plans enable row level security;
alter table public.game_plan_slots enable row level security;
alter table public.game_plan_members enable row level security;
alter table public.game_plan_votes enable row level security;

-- Friends, or played in the same recorded game in the last 30 days.
create or replace function public._may_plan_with(a uuid, b uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select public._are_friends(a, b) or exists (
    select 1 from matches m
    where m.started_at > now() - interval '30 days'
      and m.players @> jsonb_build_array(jsonb_build_object('user_id', a::text))
      and m.players @> jsonb_build_array(jsonb_build_object('user_id', b::text)));
$$;

create or replace function public.create_game_plan(p_title text, p_users uuid[], p_slots timestamptz[])
returns bigint
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  me uuid := auth.uid();
  v_name text;
  v_id bigint;
  u uuid;
  i integer;
  v_users uuid[];
  v_slots timestamptz[];
begin
  if me is null then raise exception 'not signed in'; end if;
  select display_name into v_name from user_profiles where user_id = me;
  if public._is_guest_name(v_name) then raise exception 'guests cannot plan games'; end if;
  v_users := array(select distinct x from unnest(coalesce(p_users, '{}')) x where x is not null and x <> me);
  if coalesce(array_length(v_users, 1), 0) < 1 or array_length(v_users, 1) > 5 then
    raise exception 'invite 1 to 5 players';
  end if;
  foreach u in array v_users loop
    if not public._may_plan_with(me, u) then raise exception 'you can only invite friends or recent players'; end if;
  end loop;
  v_slots := array(select distinct x from unnest(coalesce(p_slots, '{}')) x
                   where x > now() and x < now() + interval '60 days' order by x);
  if coalesce(array_length(v_slots, 1), 0) < 1 or array_length(v_slots, 1) > 8 then
    raise exception 'propose 1 to 8 future times (within 60 days)';
  end if;
  if (select count(*) from game_plans where creator = me and created_at > now() - interval '1 day') >= 5 then
    raise exception 'you can make 5 plans a day';
  end if;

  insert into game_plans (creator, title)
  values (me, left(coalesce(nullif(trim(p_title), ''), 'Godaigo with ' || coalesce(v_name, 'friends')), 60))
  returning id into v_id;
  for i in 1 .. array_length(v_slots, 1) loop
    insert into game_plan_slots (plan_id, slot, at) values (v_id, i - 1, v_slots[i]);
  end loop;
  insert into game_plan_members (plan_id, user_id) values (v_id, me);
  foreach u in array v_users loop
    insert into game_plan_members (plan_id, user_id) values (v_id, u);
  end loop;
  return v_id;
end;
$$;

-- Plans I am in that still matter (not cancelled; final time not more than 12 h ago;
-- open plans whose every time has passed drop off after 1 day).
create or replace function public.my_game_plans()
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce(jsonb_agg(x order by x->>'created_at' desc), '[]'::jsonb) from (
    select jsonb_build_object(
      'id', p.id, 'title', p.title, 'status', p.status, 'final_slot', p.final_slot, 'room_id', p.room_id,
      'created_at', p.created_at, 'creator', p.creator, 'mine', p.creator = auth.uid(),
      'creator_name', (select display_name from user_profiles where user_id = p.creator),
      'slots', (select jsonb_agg(jsonb_build_object('slot', s.slot, 'at', s.at) order by s.slot)
                from game_plan_slots s where s.plan_id = p.id),
      'members', (select jsonb_agg(jsonb_build_object('user_id', gm.user_id, 'name', up.display_name,
                    'name_color', up.name_color, 'answered', gm.answered_at is not null) order by gm.user_id = p.creator desc, up.display_name)
                  from game_plan_members gm left join user_profiles up on up.user_id = gm.user_id where gm.plan_id = p.id),
      'votes', coalesce((select jsonb_agg(jsonb_build_object('user_id', v.user_id, 'slot', v.slot, 'answer', v.answer))
                         from game_plan_votes v where v.plan_id = p.id), '[]'::jsonb)) as x
    from game_plans p
    join game_plan_members me on me.plan_id = p.id and me.user_id = auth.uid()
    where p.status <> 'cancelled'
      and (case when p.status = 'set'
                then (select at from game_plan_slots where plan_id = p.id and slot = p.final_slot) > now() - interval '12 hours'
                else (select max(at) from game_plan_slots where plan_id = p.id) > now() - interval '1 day' end)
    limit 30
  ) t;
$$;

-- p_answers: {"0": 2, "1": 0, ...} (slot -> 0 no / 1 if need be / 2 yes). Allowed while open
-- and after the time is set (people can still change their mind).
create or replace function public.vote_game_plan(p_plan bigint, p_answers jsonb)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare me uuid := auth.uid(); k text; a integer;
begin
  if me is null then raise exception 'not signed in'; end if;
  if not exists (select 1 from game_plan_members where plan_id = p_plan and user_id = me) then raise exception 'not in this plan'; end if;
  if not exists (select 1 from game_plans where id = p_plan and status in ('open', 'set')) then raise exception 'this plan is closed'; end if;
  for k, a in select key, value::integer from jsonb_each_text(coalesce(p_answers, '{}'::jsonb)) loop
    if a not in (0, 1, 2) or not exists (select 1 from game_plan_slots where plan_id = p_plan and slot = k::integer) then continue; end if;
    insert into game_plan_votes (plan_id, user_id, slot, answer) values (p_plan, me, k::integer, a)
    on conflict (plan_id, user_id, slot) do update set answer = excluded.answer;
  end loop;
  update game_plan_members set answered_at = now() where plan_id = p_plan and user_id = me;
  update game_plans set updated_at = now() where id = p_plan;
end;
$$;

-- Creator: pick the final time (null = back to open), cancel, or link the room.
create or replace function public.set_game_plan_time(p_plan bigint, p_slot integer)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  if not exists (select 1 from game_plans where id = p_plan and creator = auth.uid() and status in ('open', 'set')) then
    raise exception 'not your plan';
  end if;
  if p_slot is not null and not exists (select 1 from game_plan_slots where plan_id = p_plan and slot = p_slot) then
    raise exception 'no such time';
  end if;
  update game_plans set final_slot = p_slot, status = case when p_slot is null then 'open' else 'set' end,
                        room_id = null, updated_at = now()
  where id = p_plan;
end;
$$;

create or replace function public.cancel_game_plan(p_plan bigint)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  update game_plans set status = 'cancelled', updated_at = now() where id = p_plan and creator = auth.uid();
  if not found then raise exception 'not your plan'; end if;
end;
$$;

-- The creator opened a room for the planned game: members see a Join button.
create or replace function public.open_game_plan_room(p_plan bigint, p_room integer)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  if not exists (select 1 from game_plans where id = p_plan and creator = auth.uid() and status = 'set') then
    raise exception 'not your plan';
  end if;
  if not public.is_room_host(p_room) then raise exception 'not your room'; end if;
  update game_plans set room_id = p_room, updated_at = now() where id = p_plan;
end;
$$;

revoke all on function public._may_plan_with(uuid, uuid) from public, anon, authenticated;
revoke all on function public.create_game_plan(text, uuid[], timestamptz[]) from public, anon;
revoke all on function public.my_game_plans() from public, anon;
revoke all on function public.vote_game_plan(bigint, jsonb) from public, anon;
revoke all on function public.set_game_plan_time(bigint, integer) from public, anon;
revoke all on function public.cancel_game_plan(bigint) from public, anon;
revoke all on function public.open_game_plan_room(bigint, integer) from public, anon;
grant execute on function public.create_game_plan(text, uuid[], timestamptz[]) to authenticated;
grant execute on function public.my_game_plans() to authenticated;
grant execute on function public.vote_game_plan(bigint, jsonb) to authenticated;
grant execute on function public.set_game_plan_time(bigint, integer) to authenticated;
grant execute on function public.cancel_game_plan(bigint) to authenticated;
grant execute on function public.open_game_plan_room(bigint, integer) to authenticated;
