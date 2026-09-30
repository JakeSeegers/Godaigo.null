-- Remove the Lotus Leaf pawn base (owner, 2026-09-30). Nobody owned it.
-- Same as the live cosmetic_price() minus 'pawn_base_lotus', so it can no
-- longer be bought (buy_cosmetic raises 'unknown item' for a null price).
create or replace function public.cosmetic_price(p_id text)
returns integer
language sql
immutable
as $function$
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
    when p_id = 'pawn_base_plinth'  then 125
    when p_id = 'pawn_trail_ink'    then 150
    when p_id = 'pawn_trail_embers' then 150
    when p_id = 'pawn_trail_drops'  then 150
    when p_id = 'pawn_trail_leaves' then 150
    when p_id = 'pawn_trail_void'   then 150
    when p_id ~ '^emoji_P[0-9]{2}$'
         and p_id not in ('emoji_P10', 'emoji_P11', 'emoji_P84', 'emoji_P94', 'emoji_P95') then 50
  end;
$function$;
