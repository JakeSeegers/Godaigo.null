-- One-off, applied 2026-09-30 (migration merge_test_accounts_into_hermit), owner request.
-- Deleted 7 accounts from the leaderboard (the owner's old test accounts jake2, JakeS,
-- JakeS1, JakeS2, Jakeon, and guests Guest58TA7A, GuestLXNE3T) and gave TheHermit their
-- XP (+7325) and gold (+2440), level from the new XP (no level-up bonus), and the best
-- ladder rank of the group (1). Other ladder rows moved up into the freed places, same
-- order, older gaps kept. Their 10 bot_champion_weights rows now belong to TheHermit
-- (created_by has no ON DELETE CASCADE). Deleting auth.users cascaded profiles,
-- activities, ladder, friends, recovery and session logs. Kept for the record only;
-- do not run again.
do $$
declare
  h uuid := 'a91140c8-20c3-4fa8-81d9-4c65660c4a81';
  ids uuid[] := array['a1df1f2f-1181-4763-a525-7e3dc08ed69f','bfe6e4e4-0423-4b8c-a188-ef0c5cd7baf6','3cb99d40-3524-4d41-8416-d218666d8572',
                      '288b7dab-a878-4c70-bc78-0b93ffa067b9','b2720437-2990-4b40-801c-9ee506aede4c','e2265c52-52a5-43fb-bad2-59616364e8e9',
                      'b60aea1e-ecdb-495f-ab34-bd1ad06c838a']::uuid[];
  v_xp int; v_gold int; v_top int; v_n int;
begin
  select count(*) into v_n from user_profiles where user_id = any(ids);
  if v_n <> 7 then raise exception 'expected 7 profiles, found %', v_n; end if;
  select coalesce(sum(total_xp),0), coalesce(sum(gold),0) into v_xp, v_gold from user_profiles where user_id = any(ids);
  update user_profiles
  set total_xp = total_xp + v_xp, current_level = floor((total_xp + v_xp) / 1000) + 1,
      gold = gold + v_gold, updated_at = now()
  where user_id = h;
  insert into user_activities (user_id, activity_type, xp_awarded, gold_awarded, description)
  values (h, 'xp_awarded', v_xp, v_gold, 'Merged 7 old test and guest accounts (2026-09-30)');
  select min(rank) into v_top from ladder where user_id = any(ids) or user_id = h;
  create temp table _vac on commit drop as
    select rank v from ladder where (user_id = any(ids) or user_id = h) and rank <> v_top;
  delete from ladder where user_id = any(ids);
  update ladder l set rank = case when l.user_id = h then v_top
                                  else l.rank - (select count(*) from _vac where v < l.rank) end,
                      updated_at = now();
  update bot_champion_weights set created_by = h where created_by = any(ids);
  delete from auth.users where id = any(ids);
end $$;
