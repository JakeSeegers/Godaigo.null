-- Combos found by bots in training games (owner 2026-10-11). js/bot-arena.js
-- (combo watcher) + js/replay-viewer.js (hermit Combos tab).
--
-- Training games (Train Bot, idle training) run in players' browsers and are
-- not recorded, so the replay miner never sees them. bot-arena.js watches them
-- as they are played: each seat's position is scored at the start and end of
-- every turn, casts are noted with what came before them in that turn (moves,
-- AP walked, stones placed, stones broken), and the miner's own rule
-- (Replay.findCombos) picks combo windows at game end.
-- These rows are kept APART from combo_candidates: bots never teach
-- themselves their own habits. They are for looking at (hermit Combos tab),
-- and later for testing (a found combo would have to beat the champion in
-- games before it is ever taught).
-- Limits: 20 rows per call, 400 per account per day.

create table if not exists public.bot_combo_finds (
  id         bigserial primary key,
  signature  text not null,
  gain       real not null,
  turns      integer not null,
  steps      jsonb,
  source     text,
  found_by   uuid,
  created_at timestamptz not null default now()
);
create index if not exists bot_combo_finds_sig on public.bot_combo_finds (signature);
alter table public.bot_combo_finds enable row level security;   -- no client policies: RPCs only

create or replace function public.report_bot_combos(p_rows jsonb, p_source text default null)
returns integer
language plpgsql security definer set search_path to 'public'
as $$
declare
  me uuid := auth.uid();
  v_row jsonb;
  v_n integer := 0;
begin
  if me is null then raise exception 'sign in first'; end if;
  if jsonb_typeof(coalesce(p_rows, '[]'::jsonb)) <> 'array' then raise exception 'bad rows'; end if;
  if (select count(*) from bot_combo_finds where found_by = me and created_at > now() - interval '24 hours') >= 400 then
    return 0;
  end if;
  for v_row in select * from jsonb_array_elements(p_rows) limit 20 loop
    insert into bot_combo_finds (signature, gain, turns, steps, source, found_by)
    values (left(v_row->>'signature', 300), (v_row->>'gain')::real, greatest(1, (v_row->>'turns')::integer),
            case when length((v_row->'steps')::text) <= 8000 then v_row->'steps' else null end,
            left(p_source, 20), me);
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

create or replace function public.hermit_bot_combo_summary(p_limit integer default 40)
returns table (signature text, times integer, finders integer, avg_gain real, best_steps jsonb, last_seen timestamptz)
language plpgsql stable security definer set search_path to 'public'
as $$
begin
  if not public.is_hermit() then raise exception 'not authorized'; end if;
  return query
    select f.signature, count(*)::integer, count(distinct f.found_by)::integer, avg(f.gain)::real,
           (array_agg(f.steps order by f.gain desc))[1], max(f.created_at)
    from bot_combo_finds f
    group by f.signature
    order by count(*) desc, avg(f.gain) desc
    limit greatest(1, least(coalesce(p_limit, 40), 200));
end;
$$;

revoke all on function public.report_bot_combos(jsonb, text) from public, anon;
revoke all on function public.hermit_bot_combo_summary(integer) from public, anon;
grant execute on function public.report_bot_combos(jsonb, text) to authenticated;
grant execute on function public.hermit_bot_combo_summary(integer) to authenticated;
