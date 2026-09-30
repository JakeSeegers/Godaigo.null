-- More achievement badges (owner, 2026-09-30), migration more_badges.
--
-- New criteria types in check_badge_criteria() (runs from check_badges_trigger
-- on every user_activities insert):
--   all_scrolls    every scroll id in _all_scroll_ids() cast at least once
--                  (user_activities 'scroll_cast', description 'Cast <ID>';
--                  response scrolls are logged too since this change,
--                  js/scrolls/response-window.js playerResponds)
--   bots_defeated  bots in your paid wins (game_rewards 'paid' + matches.players
--                  is_bot), not counting wins where the others left
--   human_wins     paid wins with at least one other human, same rule
--   fast_win       a paid real win (win_type 'scrolls') in under 10 of your own
--                  turns (distinct turnNumber of turn-change / turn-sync moves
--                  with your playerIndex)
--   all_emojis     every emoji that has a price, in cosmetics_owned
--   all_cosmetics  every name style and pawn item that has a price (reward-only
--                  items have no price, so they never count)
-- Win-based ones are checked on game_win, game_complete and daily_login, so a
-- win confirmed late still counts later. Buying ones on gold_spent.
-- Pictures: images/badges/px-*.png (Raven Fantasy Icons, Clockwork Raven).

create or replace function public._all_scroll_ids()
returns text[] language sql immutable as $$
  select array['EARTH_SCROLL_1','EARTH_SCROLL_2','EARTH_SCROLL_3','EARTH_SCROLL_4','EARTH_SCROLL_5',
               'WATER_SCROLL_1','WATER_SCROLL_2','WATER_SCROLL_3','WATER_SCROLL_4','WATER_SCROLL_5',
               'FIRE_SCROLL_1','FIRE_SCROLL_2','FIRE_SCROLL_3','FIRE_SCROLL_4','FIRE_SCROLL_5',
               'WIND_SCROLL_1','WIND_SCROLL_2','WIND_SCROLL_3','WIND_SCROLL_4','WIND_SCROLL_5',
               'VOID_SCROLL_1','VOID_SCROLL_2','VOID_SCROLL_3','VOID_SCROLL_4','VOID_SCROLL_5',
               'CATACOMB_SCROLL_1','CATACOMB_SCROLL_2','CATACOMB_SCROLL_3','CATACOMB_SCROLL_4','CATACOMB_SCROLL_5',
               'CATACOMB_SCROLL_6','CATACOMB_SCROLL_7','CATACOMB_SCROLL_8','CATACOMB_SCROLL_9','CATACOMB_SCROLL_10'];
$$;

-- Every shop cosmetic id ever sold; items without a price today are skipped.
create or replace function public._shop_cosmetic_ids()
returns text[] language sql immutable as $$
  select array(select i from unnest(array[
    'name_gold','name_crimson','name_blue','name_emerald','name_purple','name_rainbow',
    'name_el_earth','name_el_water','name_el_fire','name_el_wind','name_el_void',
    'name_silver','name_bronze','name_obsidian','name_shimmer','name_ember','name_tide','name_voidpulse','name_glitch',
    'pawn_rim_gold','pawn_rim_silver','pawn_rim_runes','pawn_base_lotus','pawn_base_plinth',
    'pawn_trail_ink','pawn_trail_embers','pawn_trail_drops','pawn_trail_leaves','pawn_trail_void']) i
    where public.cosmetic_price(i) is not null);
$$;

create or replace function public._shop_emoji_ids()
returns text[] language sql immutable as $$
  select array(select 'emoji_P' || lpad(n::text, 2, '0') from generate_series(0, 99) n
               where public.cosmetic_price('emoji_P' || lpad(n::text, 2, '0')) is not null);
$$;

-- Paid wins of a user with the match data needed by the win badges.
create or replace function public._paid_wins(p_user uuid)
returns table (match_id bigint, win_type text, idx integer, bots integer, other_humans integer)
language sql stable security definer set search_path to 'public' as $$
  select m.id, m.win_type,
         (select (p->>'index')::integer from jsonb_array_elements(m.players) p where p->>'user_id' = p_user::text limit 1),
         (select count(*)::integer from jsonb_array_elements(m.players) p where (p->>'is_bot')::boolean),
         (select count(*)::integer from jsonb_array_elements(m.players) p
           where not coalesce((p->>'is_bot')::boolean, false) and coalesce(p->>'user_id', '') <> p_user::text)
  from game_rewards g
  join matches m on m.id = g.match_id
  where g.user_id = p_user and g.status = 'paid';
$$;

create or replace function public._own_turns(p_match bigint, p_idx integer)
returns integer language sql stable security definer set search_path to 'public' as $$
  select count(distinct (payload->>'turnNumber'))::integer
  from match_moves
  where match_id = p_match and event in ('turn-change', 'turn-sync')
    and (payload->>'playerIndex') ~ '^[0-9]+$' and (payload->>'playerIndex')::integer = p_idx
    and (payload->>'turnNumber') ~ '^[0-9]+$';
$$;

create or replace function public.check_badge_criteria(p_user_id uuid, p_activity_type character varying, p_metadata jsonb DEFAULT '{}'::jsonb)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
    badge_rec      record;
    user_profile   record;
    activity_count integer;
    current_badges jsonb;
    v_win_check    boolean := p_activity_type in ('game_win', 'game_complete', 'daily_login');
    v_buy_check    boolean := p_activity_type = 'gold_spent';
begin
    select * into user_profile from user_profiles where user_id = p_user_id;
    current_badges := coalesce(user_profile.badges_earned, '[]'::jsonb);

    for badge_rec in select * from badges where is_active = true loop
        if current_badges ? badge_rec.id then
            continue;
        end if;

        case badge_rec.criteria->>'type'

            when 'xp_threshold' then
                if user_profile.total_xp >= (badge_rec.criteria->>'threshold')::integer then
                    perform award_badge(p_user_id, badge_rec.id);
                end if;

            when 'level_reached' then
                if user_profile.current_level >= (badge_rec.criteria->>'level')::integer then
                    perform award_badge(p_user_id, badge_rec.id);
                end if;

            when 'activity_count' then
                select count(*) into activity_count
                from   user_activities
                where  user_id       = p_user_id
                and    activity_type = coalesce(badge_rec.criteria->>'activity_type', p_activity_type);
                if activity_count >= (badge_rec.criteria->>'count')::integer then
                    perform award_badge(p_user_id, badge_rec.id);
                end if;

            when 'first_time' then
                if p_activity_type = badge_rec.criteria->>'activity_type' then
                    perform award_badge(p_user_id, badge_rec.id);
                end if;

            when 'all_scrolls' then
                if p_activity_type = 'scroll_cast' and (
                    select count(distinct substr(description, 6)) from user_activities
                    where user_id = p_user_id and activity_type = 'scroll_cast'
                      and substr(description, 6) = any(public._all_scroll_ids())
                ) >= array_length(public._all_scroll_ids(), 1) then
                    perform award_badge(p_user_id, badge_rec.id);
                end if;

            when 'bots_defeated' then
                if v_win_check and (
                    select coalesce(sum(bots), 0) from public._paid_wins(p_user_id)
                    where coalesce(win_type, '') <> 'last_standing'
                ) >= (badge_rec.criteria->>'count')::integer then
                    perform award_badge(p_user_id, badge_rec.id);
                end if;

            when 'human_wins' then
                if v_win_check and (
                    select count(*) from public._paid_wins(p_user_id)
                    where other_humans > 0 and coalesce(win_type, '') <> 'last_standing'
                ) >= (badge_rec.criteria->>'count')::integer then
                    perform award_badge(p_user_id, badge_rec.id);
                end if;

            when 'fast_win' then
                if v_win_check and exists (
                    select 1 from public._paid_wins(p_user_id) w
                    where w.win_type = 'scrolls' and w.idx is not null
                      and public._own_turns(w.match_id, w.idx) between 1 and (badge_rec.criteria->>'turns')::integer - 1
                ) then
                    perform award_badge(p_user_id, badge_rec.id);
                end if;

            when 'all_emojis' then
                if v_buy_check and not exists (
                    select 1 from unnest(public._shop_emoji_ids()) e where not (e = any(coalesce(user_profile.cosmetics_owned, '{}')))
                ) then
                    perform award_badge(p_user_id, badge_rec.id);
                end if;

            when 'all_cosmetics' then
                if v_buy_check and not exists (
                    select 1 from unnest(public._shop_cosmetic_ids()) c where not (c = any(coalesce(user_profile.cosmetics_owned, '{}')))
                ) then
                    perform award_badge(p_user_id, badge_rec.id);
                end if;

            else
                -- Unknown criteria type (e.g. 'special' Hermit badges): skip.
                null;
        end case;
    end loop;
end;
$function$;

revoke all on function public._paid_wins(uuid) from public, anon, authenticated;
revoke all on function public._own_turns(bigint, integer) from public, anon, authenticated;
revoke execute on function public.check_badge_criteria(uuid, character varying, jsonb) from public, anon, authenticated;

insert into public.badges (id, name, description, icon, image, criteria, xp_reward, gold_reward, rarity, is_active) values
  ('scroll_master',    'Scroll Master',     'Cast every scroll at least once.',                       '📜', 'px-scroll-master.png',    '{"type":"all_scrolls"}',                 0, 100, 'legendary', true),
  ('bots_10',          'Bot Breaker',       'Defeat 10 bots.',                                        '💀', 'px-bots-10.png',          '{"type":"bots_defeated","count":10}',    0,  25, 'rare',      true),
  ('bots_20',          'Bot Slayer',        'Defeat 20 bots.',                                        '💀', 'px-bots-20.png',          '{"type":"bots_defeated","count":20}',    0,  50, 'epic',      true),
  ('bots_50',          'Bot Bane',          'Defeat 50 bots.',                                        '💀', 'px-bots-50.png',          '{"type":"bots_defeated","count":50}',    0, 100, 'epic',      true),
  ('bots_100',         'Machine''s End',    'Defeat 100 bots.',                                       '💀', 'px-bots-100.png',         '{"type":"bots_defeated","count":100}',   0, 200, 'legendary', true),
  ('peoples_champion', 'People''s Champion','Win 10 games against other players.',                    '🧡', 'px-peoples-champion.png', '{"type":"human_wins","count":10}',       0, 100, 'epic',      true),
  ('emote_collector',  'Emote Collector',   'Own every emoji.',                                       '💬', 'px-emote-collector.png',  '{"type":"all_emojis"}',                  0, 250, 'legendary', true),
  ('fashionista',      'Fashionista',       'Own every name style and pawn item in the shop.',        '👘', 'px-fashionista.png',      '{"type":"all_cosmetics"}',               0, 250, 'legendary', true),
  ('lightning_win',    'Lightning Win',     'Win a game in fewer than 10 of your own turns.',         '⚡', 'px-lightning-win.png',    '{"type":"fast_win","turns":10}',         0,  75, 'epic',      true)
on conflict (id) do update set name = excluded.name, description = excluded.description, icon = excluded.icon,
  image = excluded.image, criteria = excluded.criteria, gold_reward = excluded.gold_reward, rarity = excluded.rarity;

-- Give everyone the new badges they already earned.
do $$
declare u uuid;
begin
  for u in select user_id from user_profiles loop
    perform public.check_badge_criteria(u, 'game_win', '{}'::jsonb);
    perform public.check_badge_criteria(u, 'scroll_cast', '{}'::jsonb);
    perform public.check_badge_criteria(u, 'gold_spent', '{}'::jsonb);
  end loop;
end $$;
