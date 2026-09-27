-- The current bot champion = the NEWEST promoted row (2026-09-27, migration
-- champion_promoted).
--
-- Before this, clients took the row with the highest win_rate. But each
-- row's confirm record is against whichever champion it faced at the time,
-- so win_rate cannot be compared between rows: row 14 beat row 12 (the
-- champion then) 5-4-3, yet row 12 kept the higher number (0.40 vs 0.08) and
-- stayed in use. Now a hill climb that beats the champion inserts its row
-- with promoted = true, and clients read
--   order by promoted desc, created_at desc limit 1
-- (js/bot.js, js/game-ui.js, js/lobby.js, tools/arena-headless.mjs).

alter table public.bot_champion_weights add column if not exists promoted boolean not null default false;

-- Row 12 was the champion until row 14 beat it in the confirmation.
update public.bot_champion_weights set promoted = true where id in (12, 14);
