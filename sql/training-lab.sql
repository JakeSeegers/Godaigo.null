-- training-lab.sql: hermit-only reads + one action for the Training Lab
-- (js/training-lab.js, owner 2026-10-18). Re-runnable. Run it in the SQL editor.
--
--   hermit_training_lab(p_limit)   every idle challenger (open first, then the
--                                  latest decided), without network weights,
--                                  plus how much position data is saved.
--   hermit_reject_candidate(p_id)  drop one open challenger by hand.
--
-- Games in position_samples: move chunks use game keys 'key#n', so a game =
-- the part before '#'. The same real game mined by two accounts counts once.

create or replace function public.hermit_training_lab(p_limit int default 40)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_champ bigint;
begin
  if not public.is_hermit() then raise exception 'not authorized'; end if;
  select id into v_champ from bot_champion_weights order by promoted desc, created_at desc limit 1;
  return jsonb_build_object(
    'champion_id', v_champ,
    'candidates', coalesce((
      select jsonb_agg(to_jsonb(c) order by (c.status = 'open') desc, coalesce(c.decided_at, c.created_at) desc)
      from (
        select ic.id, ic.champion_id, ic.kind, ic.status, ic.wins, ic.losses, ic.draws,
               ic.created_at, ic.decided_at, ic.new_champion_id,
               ic.weights - 'net' as weights, ic.weights ? 'net' as has_net,
               (select count(distinct g.user_id) from idle_games g where g.candidate_id = ic.id) as players,
               (select max(g.at) from idle_games g where g.candidate_id = ic.id) as last_game
        from idle_candidates ic
        order by (ic.status = 'open') desc, coalesce(ic.decided_at, ic.created_at) desc
        limit greatest(1, least(coalesce(p_limit, 40), 200))
      ) c), '[]'::jsonb),
    'data', (
      select jsonb_build_object(
        'rows', count(*),
        'games', count(distinct (case when source like 'mined%' then null else created_by end, split_part(game_key, '#', 1))),
        'mined_games', count(distinct split_part(game_key, '#', 1)) filter (where source like 'mined%'),
        'move_rows', count(*) filter (where source like 'moves%'),
        'games_7d', count(distinct (case when source like 'mined%' then null else created_by end, split_part(game_key, '#', 1)))
                    filter (where created_at > now() - interval '7 days'),
        'accounts', count(distinct created_by),
        'first_at', min(created_at))
      from position_samples));
end $$;

create or replace function public.hermit_reject_candidate(p_id bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_n int;
begin
  if not public.is_hermit() then raise exception 'not authorized'; end if;
  update idle_candidates set status = 'dropped', decided_at = now()
    where id = p_id and status = 'open';
  get diagnostics v_n = row_count;
  return jsonb_build_object('ok', v_n = 1);
end $$;

revoke all on function public.hermit_training_lab(int) from public, anon;
grant execute on function public.hermit_training_lab(int) to authenticated;
revoke all on function public.hermit_reject_candidate(bigint) from public, anon;
grant execute on function public.hermit_reject_candidate(bigint) to authenticated;

-- Check: both functions exist.
select proname, true as ok from pg_proc where proname in ('hermit_training_lab', 'hermit_reject_candidate');
