-- Emojis on the server (2026-09-27, migration emoji_server).
--
-- Before this, which emojis you owned lived only in the browser
-- (localStorage), so a new browser or device lost them even though the gold
-- was really spent. Now emojis use the same path as name colours and pawn
-- items: buy_cosmetic('emoji_<id>') pays the server price and adds the id to
-- user_profiles.cosmetics_owned. No emoji purchase was ever logged on the
-- server, so there is nothing to carry over.
--
-- Prices must match EMOJI_ITEMS in js/emoji-system.js:
--   emoji_E01..E13 30, E14..E26 60, E27..E40 120, E41..E48 150,
--   E49..E62 200, E63..E83 400; Pipoya pixel emotes emoji_P00..P99 50.

create or replace function public.cosmetic_price(p_id text)
returns integer
language sql
immutable
as $$
  select case
    when p_id = 'name_gold'    then 50
    when p_id = 'name_crimson' then 50
    when p_id = 'name_blue'    then 50
    when p_id = 'name_emerald' then 50
    when p_id = 'name_purple'  then 75
    when p_id = 'name_rainbow' then 200
    when p_id = 'name_el_earth' then 100
    when p_id = 'name_el_water' then 100
    when p_id = 'name_el_fire'  then 100
    when p_id = 'name_el_wind'  then 100
    when p_id = 'name_el_void'  then 100
    when p_id = 'name_silver'   then 75
    when p_id = 'name_bronze'   then 75
    when p_id = 'name_obsidian' then 100
    when p_id = 'name_shimmer'  then 150
    when p_id = 'name_ember'    then 175
    when p_id = 'name_tide'     then 175
    when p_id = 'name_voidpulse' then 175
    when p_id = 'name_glitch'   then 250
    when p_id = 'pawn_rim_gold'     then 100
    when p_id = 'pawn_rim_silver'   then 100
    when p_id = 'pawn_rim_runes'    then 150
    when p_id = 'pawn_base_lotus'   then 125
    when p_id = 'pawn_base_plinth'  then 125
    when p_id = 'pawn_trail_ink'    then 150
    when p_id = 'pawn_trail_embers' then 150
    when p_id = 'pawn_trail_drops'  then 150
    when p_id = 'pawn_trail_leaves' then 150
    when p_id = 'pawn_trail_void'   then 150
    -- Emojis
    when p_id ~ '^emoji_P[0-9]{2}$' then 50
    when p_id ~ '^emoji_E[0-9]{2}$' then
      case
        when substr(p_id, 8)::int between 1  and 13 then 30
        when substr(p_id, 8)::int between 14 and 26 then 60
        when substr(p_id, 8)::int between 27 and 40 then 120
        when substr(p_id, 8)::int between 41 and 48 then 150
        when substr(p_id, 8)::int between 49 and 62 then 200
        when substr(p_id, 8)::int between 63 and 83 then 400
      end
  end;
$$;
