-- Trial combos (owner 2026-10-11). js/idle-training.js, js/game-ui.js (Train
-- Bot), js/bot.js (WEIGHTS.extraCombos). Run after sql/idle-training.sql and
-- sql/bot-combo-finds.sql.
--
-- A combo bots found in training (bot_combo_finds) at least 5 times, from at
-- least 2 accounts, is a "trial combo". idle_trial_combo() names the next one
-- to test against the current champion: not taught already, not in the
-- champion's own extraCombos, not tried against this champion before.
-- The browser makes a challenger = champion + extraCombos [that signature]
-- (kind 'combo'): only that challenger follows the combo, so the test measures
-- the combo alone. It must win like any challenger (58%, 40 decided, 2+
-- players); promoted, the combo rides along in the champion's weights and
-- every bot follows it from then on.

alter table public.idle_candidates drop constraint if exists idle_candidates_kind_check;
alter table public.idle_candidates add constraint idle_candidates_kind_check
  check (kind in ('explore', 'formula', 'imitation', 'combo'));

create or replace function public.idle_trial_combo()
returns text
language plpgsql stable security definer set search_path to 'public'
as $$
declare
  v_ch bot_champion_weights;
  v_sig text;
begin
  if auth.uid() is null then raise exception 'sign in first'; end if;
  v_ch := _idle_champion();
  if v_ch.id is null then return null; end if;
  select f.signature into v_sig
    from bot_combo_finds f
   group by f.signature
  having count(*) >= 5 and count(distinct f.found_by) >= 2
     and not coalesce(v_ch.weights->'extraCombos', '[]'::jsonb) ? f.signature
     and f.signature not in (select g.signature from public.get_bot_combos() g)
     and not exists (select 1 from idle_candidates c where c.champion_id = v_ch.id and c.kind = 'combo'
                       and coalesce(c.weights->'extraCombos', '[]'::jsonb) ? f.signature)
   order by count(*) desc, avg(f.gain) desc
   limit 1;
  return v_sig;
end;
$$;
revoke all on function public.idle_trial_combo() from public, anon;
grant execute on function public.idle_trial_combo() to authenticated;

-- idle_training_new: kind 'combo' (also in sql/idle-training.sql)
create or replace function public.idle_training_new(p_champion bigint, p_weights jsonb, p_kind text)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_ch bot_champion_weights;
  v_c idle_candidates;
begin
  if auth.uid() is null then raise exception 'sign in first'; end if;
  v_ch := _idle_champion();
  if v_ch.id is distinct from p_champion then raise exception 'the champion changed'; end if;
  if p_kind not in ('explore', 'formula', 'imitation', 'combo') then raise exception 'bad kind'; end if;
  if jsonb_typeof(p_weights) <> 'object' or length(p_weights::text) > 20000 then raise exception 'bad weights'; end if;
  if p_kind = 'imitation' then
    -- one open at a time: test that one
    select * into v_c from idle_candidates where champion_id = v_ch.id and status = 'open' and kind = 'imitation' limit 1;
    if v_c.id is not null then return _idle_cand_json(v_c); end if;
    -- these exact adjustments were already judged against this champion
    if exists (select 1 from idle_candidates where champion_id = v_ch.id and kind = 'imitation' and weights = p_weights) then
      raise exception 'already tested';
    end if;
  end if;
  if p_kind = 'combo' then
    -- trial combo (sql/combo-trials.sql): one open at a time, never the same combo twice per champion
    select * into v_c from idle_candidates where champion_id = v_ch.id and status = 'open' and kind = 'combo' limit 1;
    if v_c.id is not null then return _idle_cand_json(v_c); end if;
    if exists (select 1 from idle_candidates where champion_id = v_ch.id and kind = 'combo'
                 and weights->'extraCombos' = p_weights->'extraCombos') then
      raise exception 'already tested';
    end if;
  end if;
  -- full: test one of the open ones instead
  if (select count(*) from idle_candidates where champion_id = v_ch.id and status = 'open') >= 6
     or (select count(*) from idle_candidates where created_by = auth.uid() and created_at > now() - interval '24 hours') >= 30 then
    select * into v_c from idle_candidates where champion_id = v_ch.id and status = 'open'
      order by (wins + losses + draws) limit 1;
    if v_c.id is null then raise exception 'try again later'; end if;
    return _idle_cand_json(v_c);
  end if;
  insert into idle_candidates (champion_id, weights, kind, created_by)
    values (v_ch.id, p_weights, p_kind, auth.uid()) returning * into v_c;
  return _idle_cand_json(v_c);
end;
$$;
