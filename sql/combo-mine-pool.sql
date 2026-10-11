-- Pooled combo mining (owner 2026-10-11). js/idle-training.js + js/replay-viewer.js.
--
-- Every idling browser can mine finished games for combos, not only the
-- hermit's. The game data it gets is detached from the players' accounts:
--   * idle_mine_job() hands out a one-time job token, never the match id;
--     seats are "Player 1..5" (bots keep their bot names), no account ids,
--     no ranks, no dates. Names and account ids are also blanked inside the
--     recorded messages (none were found there on 2026-10-11; a safety net).
--   * Rank and experience still weigh a combo (combo_candidates.trust), but
--     only here on the server, the same way as the hermit's own mining.
--   * A browser could send made-up combos, so a game's combos count only when
--     two different accounts report the same result for it (same seats, turns
--     and combo signatures). After 4 reports without a match the game is
--     skipped. The hermit's own mining (save_combo_candidates) is trusted as
--     before.
-- Limits: 40 jobs per account per day; a job must be reported within 45 min.

create table if not exists public.mine_jobs (
  id          bigserial primary key,
  token       uuid not null default gen_random_uuid() unique,
  match_id    bigint not null references public.matches(id) on delete cascade,
  user_id     uuid not null,
  created_at  timestamptz not null default now(),
  done_at     timestamptz,
  result_hash text,
  rows        jsonb
);
create index if not exists mine_jobs_match on public.mine_jobs (match_id);
create index if not exists mine_jobs_user on public.mine_jobs (user_id, created_at desc);
alter table public.mine_jobs enable row level security;   -- no client policies: RPCs only

-- The candidate insert of save_combo_candidates, without the hermit check
-- (server-internal; save_combo_candidates and idle_mine_report call it).
create or replace function public._save_combo_rows(p_match_id bigint, p_rows jsonb)
returns integer
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_m       matches;
  v_row     jsonb;
  v_seat    integer;
  v_player  jsonb;
  v_uid     uuid;
  v_bot     boolean;
  v_rank    integer;
  v_games   integer;
  v_size    integer;
  v_trust   real;
  v_n       integer := 0;
begin
  select * into v_m from matches where id = p_match_id;
  if not found then raise exception 'no such match'; end if;
  delete from combo_candidates where match_id = p_match_id;
  select greatest(count(*), 1) into v_size from ladder;

  for v_row in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) limit 60 loop
    v_seat := (v_row->>'seat')::integer;
    select p into v_player from jsonb_array_elements(v_m.players) p
      where (p->>'index')::integer = v_seat limit 1;
    v_uid := nullif(v_player->>'user_id', '')::uuid;
    v_bot := coalesce((v_player->>'is_bot')::boolean, v_uid is null);
    v_rank := coalesce((v_player->>'rank')::integer,
                       (select l.rank from ladder l where l.user_id = v_uid and l.entity_type = 'player' limit 1));
    v_games := case when v_uid is null then 0 else
      (select count(*) from matches mm where mm.status = 'finished'
         and mm.players @> jsonb_build_array(jsonb_build_object('user_id', v_uid::text))) end;
    v_trust := case when v_bot or v_uid is null then 0 else
      (case when v_rank is null then 0.3 else greatest(0.2, 1.0 - (v_rank - 1)::real / v_size) end)
      * least(1.0, 0.2 + v_games / 10.0) end;
    insert into combo_candidates (match_id, seat, user_id, is_bot, rank, games, trust, gain, turns,
                                  start_turn, end_turn, signature, steps)
    values (p_match_id, v_seat, v_uid, v_bot, v_rank, v_games, v_trust,
            (v_row->>'gain')::real, greatest(1, (v_row->>'turns')::integer),
            (v_row->>'start_turn')::integer, (v_row->>'end_turn')::integer,
            left(v_row->>'signature', 300),
            case when length((v_row->'steps')::text) <= 8000 then v_row->'steps' else '[]'::jsonb end);
    v_n := v_n + 1;
  end loop;
  update matches set mined_at = now() where id = p_match_id;
  return v_n;
end;
$$;

create or replace function public.save_combo_candidates(p_match_id bigint, p_rows jsonb)
returns integer
language plpgsql security definer set search_path to 'public'
as $$
begin
  if not public.is_hermit() then raise exception 'not authorized'; end if;
  return public._save_combo_rows(p_match_id, p_rows);
end;
$$;

-- A finished game with names and account ids taken out.
create or replace function public._anon_replay(p_match_id bigint)
returns jsonb
language plpgsql stable security definer set search_path to 'public'
as $$
declare
  v_m     matches;
  v_seats jsonb;
  v_subs  jsonb;
begin
  select * into v_m from matches where id = p_match_id;
  if not found then return null; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'index', p->'index', 'color', p->'color', 'is_bot', coalesce((p->>'is_bot')::boolean, false),
           'username', case when coalesce((p->>'is_bot')::boolean, false) then p->'username'
                            else to_jsonb('Player ' || ((p->>'index')::integer + 1)) end)
           order by (p->>'index')::integer), '[]'::jsonb),
         coalesce(jsonb_agg(jsonb_build_object('name', p->>'username', 'uid', p->>'user_id',
           'anon', 'Player ' || ((p->>'index')::integer + 1)))
           filter (where nullif(p->>'user_id', '') is not null and not coalesce((p->>'is_bot')::boolean, false)), '[]'::jsonb)
    into v_seats, v_subs
    from jsonb_array_elements(v_m.players) p;
  return jsonb_build_object(
    'id', 0,
    'deck_seed', v_m.deck_seed,
    'settings', jsonb_build_object('scarce_tiles', v_m.settings->'scarce_tiles'),
    'seats', v_seats,
    'winner_index', v_m.winner_index,
    'win_type', v_m.win_type,
    'moves', (select coalesce(jsonb_agg(jsonb_build_object(
                'seq', mm.seq, 'event', mm.event, 'sender', mm.sender,
                'payload', public._anon_payload(mm.payload, v_subs)) order by mm.seq), '[]'::jsonb)
              from match_moves mm where mm.match_id = p_match_id));
end;
$$;

-- Names (as whole JSON strings) and account ids blanked in one message.
create or replace function public._anon_payload(p jsonb, subs jsonb)
returns jsonb
language plpgsql immutable set search_path to 'public'
as $$
declare
  t text;
  s jsonb;
begin
  if p is null or jsonb_array_length(subs) = 0 then return p; end if;
  t := p::text;
  for s in select * from jsonb_array_elements(subs) loop
    if length(s->>'uid') > 0 then t := replace(t, s->>'uid', ''); end if;
    if length(s->>'name') > 0 then t := replace(t, to_jsonb(s->>'name')::text, to_jsonb(s->>'anon')::text); end if;
  end loop;
  return t::jsonb;
end;
$$;

-- One anonymous game to mine, or null when there is none.
create or replace function public.idle_mine_job()
returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare
  me uuid := auth.uid();
  v_match bigint;
  v_job mine_jobs;
begin
  if me is null then raise exception 'sign in first'; end if;
  if (select count(*) from mine_jobs where user_id = me and created_at > now() - interval '24 hours') >= 40 then
    return null;
  end if;
  -- games with one report from someone else first (finishes the check), then the oldest
  select m.id into v_match
    from matches m
   where m.status = 'finished' and m.mined_at is null and not coalesce(m.stream_mode, false)
     and coalesce(m.move_count, 0) between 1 and 6000
     and not exists (select 1 from mine_jobs j where j.match_id = m.id and j.user_id = me)
     and (select count(*) from mine_jobs j where j.match_id = m.id and j.done_at is not null) < 4
   order by (exists (select 1 from mine_jobs j where j.match_id = m.id and j.done_at is not null)) desc, m.id
   limit 1;
  if v_match is null then return null; end if;
  insert into mine_jobs (match_id, user_id) values (v_match, me) returning * into v_job;
  return jsonb_build_object('job', v_job.token, 'replay', public._anon_replay(v_match));
end;
$$;

-- The combos one browser found. They count once a second account found the same.
create or replace function public.idle_mine_report(p_job uuid, p_rows jsonb)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare
  me uuid := auth.uid();
  v_job mine_jobs;
  v_hash text;
  v_n integer;
begin
  if me is null then raise exception 'sign in first'; end if;
  select * into v_job from mine_jobs where token = p_job and user_id = me for update;
  if v_job.id is null or v_job.done_at is not null or v_job.created_at < now() - interval '45 minutes' then
    return jsonb_build_object('ok', false, 'reason', 'no such job');
  end if;
  if jsonb_typeof(coalesce(p_rows, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_rows, '[]'::jsonb)) > 60
     or length(coalesce(p_rows, '[]'::jsonb)::text) > 200000 then
    raise exception 'bad rows';
  end if;
  select md5(coalesce(string_agg(x, '|' order by x), '')) into v_hash
    from (select concat_ws(':', r->>'seat', r->>'start_turn', r->>'end_turn', r->>'signature') x
            from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) r) q;
  update mine_jobs set done_at = now(), result_hash = v_hash, rows = coalesce(p_rows, '[]'::jsonb)
   where id = v_job.id;
  perform 1 from matches where id = v_job.match_id and mined_at is null for update;
  if not found then return jsonb_build_object('ok', true, 'accepted', false, 'reason', 'already mined'); end if;
  if exists (select 1 from mine_jobs j where j.match_id = v_job.match_id and j.user_id <> me
               and j.done_at is not null and j.result_hash = v_hash) then
    v_n := public._save_combo_rows(v_job.match_id, coalesce(p_rows, '[]'::jsonb));
    return jsonb_build_object('ok', true, 'accepted', true, 'combos', v_n);
  end if;
  if (select count(*) from mine_jobs j where j.match_id = v_job.match_id and j.done_at is not null) >= 4 then
    update matches set mined_at = now() where id = v_job.match_id;   -- reports never agreed: skip it
  end if;
  return jsonb_build_object('ok', true, 'accepted', false, 'reason', 'waiting for a second report');
end;
$$;

revoke all on function public._save_combo_rows(bigint, jsonb) from public, anon, authenticated;
revoke all on function public._anon_replay(bigint) from public, anon, authenticated;
revoke all on function public._anon_payload(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.idle_mine_job() from public, anon;
revoke all on function public.idle_mine_report(uuid, jsonb) from public, anon;
grant execute on function public.idle_mine_job() to authenticated;
grant execute on function public.idle_mine_report(uuid, jsonb) to authenticated;
