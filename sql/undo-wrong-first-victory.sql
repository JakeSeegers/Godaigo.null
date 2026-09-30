-- One-off fix, applied 2026-09-30 (migration undo_wrong_first_victory). Kept for the record; do not run again.
-- The backfill at the end of sql/more-badges.sql called check_badge_criteria(u, 'game_win', ...)
-- for every account. The 'first_time' criteria only compares the activity type, so it gave
-- First Victory (+25g) to 31 accounts that had never won. This removed the badge, the 25g and
-- the two activity rows from exactly those accounts (none had a real game_win or showed the badge).
do $$
declare v_ids uuid[];
begin
  select array_agg(distinct a.user_id) into v_ids from user_activities a
  where a.activity_type = 'badge_earned' and a.description = 'Earned badge: First Victory'
    and a.created_at between '2026-09-30 20:29:00' and '2026-09-30 20:29:10'
    and not exists (select 1 from user_activities g where g.user_id = a.user_id and g.activity_type = 'game_win');
  if coalesce(array_length(v_ids, 1), 0) <> 31 then raise exception 'expected 31, got %', array_length(v_ids, 1); end if;
  update user_profiles
  set badges_earned = coalesce((select jsonb_agg(x) from jsonb_array_elements(badges_earned) x where x <> '"first_victory"'::jsonb), '[]'::jsonb),
      shown_badges = array_remove(shown_badges, 'first_victory'), gold = gold - 25, updated_at = now()
  where user_id = any(v_ids);
  delete from user_activities
  where user_id = any(v_ids) and created_at between '2026-09-30 20:29:00' and '2026-09-30 20:29:10'
    and ((activity_type = 'badge_earned' and description = 'Earned badge: First Victory')
      or (activity_type = 'gold_awarded' and description = 'Badge reward: First Victory'));
end $$;
