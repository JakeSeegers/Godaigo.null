-- Bot network challengers in idle training (2026-10-13, js/bot-net.js).
-- idle_training_new accepts kind 'net': the champion plus a trained network
-- (weights.net). Like 'imitation': one open per champion, the same network
-- never tested twice against the same champion. Re-runnable.
alter table public.idle_candidates drop constraint if exists idle_candidates_kind_check;
alter table public.idle_candidates add constraint idle_candidates_kind_check
  check (kind in ('explore', 'formula', 'imitation', 'combo', 'net'));

create or replace function public.idle_training_new(p_champion bigint, p_weights jsonb, p_kind text)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare
  v_ch bot_champion_weights;
  v_c idle_candidates;
begin
  if auth.uid() is null then raise exception 'sign in first'; end if;
  v_ch := _idle_champion();
  if v_ch.id is distinct from p_champion then raise exception 'the champion changed'; end if;
  if p_kind not in ('explore', 'formula', 'imitation', 'combo', 'net') then raise exception 'bad kind'; end if;
  if jsonb_typeof(p_weights) <> 'object' or length(p_weights::text) > 40000 then raise exception 'bad weights'; end if;
  if p_kind = 'net' and jsonb_typeof(p_weights->'net') <> 'object' then raise exception 'no network'; end if;
  if p_kind in ('imitation', 'net') then
    select * into v_c from idle_candidates where champion_id = v_ch.id and status = 'open' and kind = p_kind limit 1;
    if v_c.id is not null and p_kind = 'imitation' then return _idle_cand_json(v_c); end if;
    if v_c.id is not null and p_kind = 'net' then raise exception 'a network is already being tested'; end if;
    if exists (select 1 from idle_candidates where champion_id = v_ch.id and kind = p_kind
                 and (case when p_kind = 'net' then weights->'net' = p_weights->'net' else weights = p_weights end)) then
      raise exception 'already tested';
    end if;
  end if;
  if p_kind = 'combo' then
    select * into v_c from idle_candidates where champion_id = v_ch.id and status = 'open' and kind = 'combo' limit 1;
    if v_c.id is not null then return _idle_cand_json(v_c); end if;
    if exists (select 1 from idle_candidates where champion_id = v_ch.id and kind = 'combo'
                 and weights->'extraCombos' = p_weights->'extraCombos') then
      raise exception 'already tested';
    end if;
  end if;
  if (select count(*) from idle_candidates where champion_id = v_ch.id and status = 'open') >= 6
     or (select count(*) from idle_candidates where created_by = auth.uid() and created_at > now() - interval '24 hours') >= 30 then
    select * into v_c from idle_candidates where champion_id = v_ch.id and status = 'open'
      order by (wins + losses + draws) limit 1;
    if v_c.id is null then raise exception 'try again later'; end if;
    if p_kind = 'net' then raise exception 'the pool is full, try again later'; end if;
    return _idle_cand_json(v_c);
  end if;
  insert into idle_candidates (champion_id, weights, kind, created_by)
    values (v_ch.id, p_weights, p_kind, auth.uid()) returning * into v_c;
  return _idle_cand_json(v_c);
end;
$function$;

-- Check: both should say true.
select (select position('''net''' in prosrc) > 0 from pg_proc where proname = 'idle_training_new') as function_accepts_net,
       (select pg_get_constraintdef(oid) like '%net%' from pg_constraint where conname = 'idle_candidates_kind_check') as table_accepts_net;
