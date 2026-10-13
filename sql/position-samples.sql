-- Position samples for the bot network (2026-10-13, step 1: collect data).
-- Bot arena games (Train Bot, idle training, screenings) save some positions:
-- what the bot notices about the board for one seat (features, see
-- js/bot-terms.js features()), the weighted-sum score there (eval), and how
-- the game ended for that seat (result 1 win / 0 loss / 0.5 no winner,
-- progress = elements at the end). Later a small network learns the part the
-- weighted sum gets wrong. Re-runnable. RLS on, no client policies.

create table if not exists public.position_samples (
  id          bigserial primary key,
  created_at  timestamptz not null default now(),
  created_by  uuid not null,
  source      text not null,
  game_key    text not null,
  n_players   int not null,
  seat        int not null,
  turn        int not null,
  version     int not null,
  features    real[] not null,
  eval        real,
  result      real not null,
  progress    int
);
create index if not exists position_samples_user_day on public.position_samples (created_by, created_at);
create index if not exists position_samples_game on public.position_samples (created_by, game_key);
alter table public.position_samples enable row level security;

-- One finished game per call, max 80 rows, 6000 rows per account per day,
-- the same game (same key) from the same account only once.
create or replace function public.report_positions(p_rows jsonb, p_source text, p_game text, p_players int, p_version int)
returns int language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); n int := 0; r jsonb;
begin
  if uid is null or jsonb_typeof(p_rows) <> 'array' then return 0; end if;
  if p_players not between 2 and 5 or coalesce(p_version, 0) < 1 then return 0; end if;
  if exists (select 1 from position_samples where created_by = uid and game_key = p_game) then return 0; end if;
  if (select count(*) from position_samples where created_by = uid and created_at > now() - interval '1 day') > 6000 then return 0; end if;
  for r in select * from jsonb_array_elements(p_rows) limit 80 loop
    if jsonb_typeof(r->'f') <> 'array' or jsonb_array_length(r->'f') > 200 then continue; end if;
    insert into position_samples (created_by, source, game_key, n_players, seat, turn, version, features, eval, result, progress)
    values (uid, left(coalesce(p_source, 'train'), 20), left(p_game, 80), p_players,
            (r->>'seat')::int, (r->>'turn')::int, p_version,
            array(select x::real from jsonb_array_elements_text(r->'f') x),
            (r->>'ev')::real, least(1, greatest(0, (r->>'result')::real)), (r->>'prog')::int);
    n := n + 1;
  end loop;
  delete from position_samples where created_at < now() - interval '90 days';
  return n;
end $$;

-- Hermit: read samples in id order (for training) and a short summary.
create or replace function public.hermit_position_samples(p_after bigint, p_limit int)
returns setof public.position_samples language plpgsql security definer set search_path = public as $$
begin
  if not public.is_hermit() then raise exception 'not authorized'; end if;
  return query select * from position_samples where id > coalesce(p_after, 0) order by id limit least(greatest(coalesce(p_limit, 1000), 1), 5000);
end $$;

create or replace function public.hermit_position_summary()
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.is_hermit() then raise exception 'not authorized'; end if;
  return (select jsonb_build_object('rows', count(*), 'games', count(distinct (created_by, game_key)),
    'accounts', count(distinct created_by), 'wins', count(*) filter (where result = 1),
    'by_players', (select jsonb_object_agg(n_players, c) from (select n_players, count(*) c from position_samples group by 1) t))
    from position_samples);
end $$;

revoke all on function public.report_positions(jsonb, text, text, int, int) from public, anon;
grant execute on function public.report_positions(jsonb, text, text, int, int) to authenticated;
revoke all on function public.hermit_position_samples(bigint, int) from public, anon;
grant execute on function public.hermit_position_samples(bigint, int) to authenticated;
revoke all on function public.hermit_position_summary() from public, anon;
grant execute on function public.hermit_position_summary() to authenticated;

-- Check: should list all three functions and the table.
select 'table' as what, to_regclass('public.position_samples') is not null as ok
union all select proname, true from pg_proc where proname in ('report_positions', 'hermit_position_samples', 'hermit_position_summary');
