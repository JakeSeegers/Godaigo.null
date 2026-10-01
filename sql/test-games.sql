-- Test games (2026-10-01)
-- A test room (game_room.test_mode) is a normal online game where bots play every seat in the
-- players' own browsers (js/test-game.js), to find network / Supabase / connection problems.
-- Each human browser sends a report at the end (report_test_run). When at least 2 different
-- non-guest humans of the same match have reported and the match has enough recorded turns,
-- every reporter gets the test reward once (test_payouts), at most max_per_day per UTC day.
-- Reports are kept for the hermit view (hermit_test_reports).
-- RLS on, no client policies: everything goes through these functions.

alter table public.game_room add column if not exists test_mode boolean not null default false;

create table if not exists public.test_settings (
  id            integer primary key default 1 check (id = 1),
  enabled       boolean not null default true,
  gold_per_game integer not null default 150 check (gold_per_game between 0 and 2000),
  max_per_day   integer not null default 2   check (max_per_day between 0 and 20),
  min_turns     integer not null default 20  check (min_turns between 1 and 500),
  updated_at    timestamptz not null default now()
);
insert into public.test_settings (id) values (1) on conflict (id) do nothing;
alter table public.test_settings enable row level security;

create table if not exists public.test_reports (
  id         bigserial primary key,
  room_id    integer not null,
  match_id   bigint not null,
  user_id    uuid not null,
  stats      jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (match_id, user_id)
);
create index if not exists test_reports_created_idx on public.test_reports (created_at desc);
alter table public.test_reports enable row level security;

create table if not exists public.test_payouts (
  match_id bigint not null,
  user_id  uuid not null,
  gold     integer not null,
  paid_on  date not null default (now() at time zone 'utc')::date,
  paid_at  timestamptz not null default now(),
  primary key (match_id, user_id)
);
create index if not exists test_payouts_user_day_idx on public.test_payouts (user_id, paid_on);
alter table public.test_payouts enable row level security;

-- Public: is the test reward on, and how much (lobby text, room badge).
create or replace function public.get_test_settings()
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  select jsonb_build_object('enabled', enabled, 'gold', gold_per_game,
                            'max_per_day', max_per_day, 'min_turns', min_turns)
  from test_settings where id = 1;
$$;

create or replace function public.hermit_set_test_settings(p_enabled boolean, p_gold integer,
                                                           p_max_per_day integer, p_min_turns integer)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not is_hermit() then raise exception 'not allowed'; end if;
  update test_settings
  set enabled = coalesce(p_enabled, enabled),
      gold_per_game = coalesce(p_gold, gold_per_game),
      max_per_day = coalesce(p_max_per_day, max_per_day),
      min_turns = coalesce(p_min_turns, min_turns),
      updated_at = now()
  where id = 1;
  return get_test_settings();
end;
$$;

-- One test report per (match, player). Pays the test reward once 2+ non-guest humans reported.
-- Returns { saved, reporters, paid: [user ids paid now], my_gold, reason }.
create or replace function public.report_test_run(p_room integer, p_stats jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_room game_room%rowtype;
  v_match matches%rowtype;
  v_set test_settings%rowtype;
  v_turns integer;
  v_humans uuid[];
  v_reporters uuid[];
  v_paid uuid[] := '{}';
  v_today date := (now() at time zone 'utc')::date;
  u uuid;
  v_my_gold integer := 0;
  v_reason text := null;
begin
  if v_uid is null then raise exception 'not signed in'; end if;
  select * into v_room from game_room where id = p_room;
  if not found or not coalesce(v_room.test_mode, false) then raise exception 'not a test room'; end if;
  -- the room's current match, else the newest match of that room
  select * into v_match from matches
  where id = coalesce(v_room.match_id, (select max(id) from matches where room_id = p_room));
  if not found then raise exception 'no match for this room'; end if;
  if v_match.started_at < now() - interval '6 hours' then raise exception 'match too old'; end if;
  if not (v_match.players @> jsonb_build_array(jsonb_build_object('user_id', v_uid::text))) then
    raise exception 'not a player of this match';
  end if;

  insert into test_reports (room_id, match_id, user_id, stats)
  values (p_room, v_match.id, v_uid,
          case when length(coalesce(p_stats, '{}'::jsonb)::text) > 60000
               then jsonb_build_object('too_big', length(p_stats::text)) else coalesce(p_stats, '{}'::jsonb) end)
  on conflict (match_id, user_id) do update set stats = excluded.stats, created_at = now();

  select * into v_set from test_settings where id = 1;
  v_turns := coalesce(_match_turns(v_match.id), 0);

  -- non-guest humans of this match
  select coalesce(array_agg(distinct (p->>'user_id')::uuid), '{}') into v_humans
  from jsonb_array_elements(v_match.players) p
  join user_profiles up on up.user_id = (p->>'user_id')::uuid
  where not coalesce((p->>'is_bot')::boolean, false) and nullif(p->>'user_id', '') is not null
    and not _is_guest_name(up.display_name);

  select coalesce(array_agg(distinct r.user_id), '{}') into v_reporters
  from test_reports r where r.match_id = v_match.id and r.user_id = any(v_humans);

  if not v_set.enabled then v_reason := 'test rewards are off';
  elsif v_turns < v_set.min_turns then v_reason := 'game too short (' || v_turns || ' of ' || v_set.min_turns || ' turns)';
  elsif coalesce(array_length(v_reporters, 1), 0) < 2 then v_reason := 'waiting for another player''s report';
  else
    foreach u in array v_reporters loop
      if exists (select 1 from test_payouts where match_id = v_match.id and user_id = u) then continue; end if;
      if (select count(*) from test_payouts where user_id = u and paid_on = v_today) >= v_set.max_per_day then continue; end if;
      insert into test_payouts (match_id, user_id, gold) values (v_match.id, u, v_set.gold_per_game);
      perform _grant_reward(u, 'Test game reward',
        'Thanks for helping test online play! Your test game report was received.',
        v_set.gold_per_game, null, null);
      v_paid := v_paid || u;
    end loop;
  end if;

  v_my_gold := coalesce((select gold from test_payouts where match_id = v_match.id and user_id = v_uid), 0);
  if v_my_gold = 0 and v_reason is null then
    v_reason := case when not (v_uid = any(v_humans)) then 'guests get no test reward'
                     else 'daily test reward limit reached' end;
  end if;
  return jsonb_build_object('saved', true, 'match_id', v_match.id, 'turns', v_turns,
                            'reporters', coalesce(array_length(v_reporters, 1), 0),
                            'paid', to_jsonb(v_paid), 'my_gold', coalesce(v_my_gold, 0), 'reason', v_reason);
end;
$$;

-- Hermit: recent test matches with their reports, newest first.
create or replace function public.hermit_test_reports(p_days integer default 7)
returns table (match_id bigint, room_id integer, started_at timestamptz, status text,
               turns integer, desync_count integer, check_status text, players jsonb,
               reports jsonb, paid integer)
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not is_hermit() then raise exception 'not allowed'; end if;
  return query
  select m.id, m.room_id, m.started_at, m.status, _match_turns(m.id), m.desync_count, m.check_status,
         m.players,
         coalesce((select jsonb_agg(jsonb_build_object('user_id', r.user_id,
                     'name', (select display_name from user_profiles where user_id = r.user_id),
                     'at', r.created_at, 'stats', r.stats) order by r.created_at)
                   from test_reports r where r.match_id = m.id), '[]'::jsonb),
         (select count(*)::integer from test_payouts tp where tp.match_id = m.id)
  from matches m
  where m.id in (select distinct r.match_id from test_reports r
                 where r.created_at > now() - make_interval(days => greatest(1, least(coalesce(p_days, 7), 60))))
  order by m.started_at desc;
end;
$$;

revoke all on function public.report_test_run(integer, jsonb) from public, anon;
revoke all on function public.hermit_set_test_settings(boolean, integer, integer, integer) from public, anon;
revoke all on function public.hermit_test_reports(integer) from public, anon;
grant execute on function public.get_test_settings() to anon, authenticated;
grant execute on function public.report_test_run(integer, jsonb) to authenticated;
grant execute on function public.hermit_set_test_settings(boolean, integer, integer, integer) to authenticated;
grant execute on function public.hermit_test_reports(integer) to authenticated;
