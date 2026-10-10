# Saved games: save a game against bots, finish it later (2026-10-03)

Owner: "save a game and close the tab and restart it later". Owner choices: rewards stay normal,
the save lives on the account (any device).

## How it works
- Only online games where you are the only human (Quick Play, rooms of bots). No open bounty.
- In these games the Leave button reads "Save / Leave" and asks: Save & quit, Leave without saving, or
  Cancel (owner 2026-10-03: one button, not two; Pause is hidden too). Save & quit works at the start
  of your own turn, before you act. It sends the
  last moves (MatchRecorder.flushAll), calls save_game (seats with each bot's weights, the turn,
  MatchWitness.fingerprint), then leaves the room as usual. One save per account; a new save replaces it.
- Lobby card "Saved game: turn N vs ..." with Continue and Discard.
- Continue: a new private room, the same bot rows (name + weights), hostStartGame({resume}) puts every
  seat back (index, colour) and uses the saved deck seed; then every saved move goes through the
  game channel's own handlers (GamePause.dispatch) with you as a spectator (myPlayerIndex -1, isHost
  false, bots and the turn timeout wait via SaveGame.isRebuilding()); then your seat, full AP,
  bot memory reset; the fingerprint must match the save; resume_saved_game_started copies the old
  moves in front of the new match and deletes the save (no retries).
- Rewards: the new match holds the whole game, so wins pay as normal.

## Server: sql/saved-games.sql
saved_games (user_id pk), save_game, my_saved_game, load_saved_game, resume_saved_game_started,
delete_saved_game. STATUS: applied (the owner has used it). 2026-10-10: `state` column + `save_game(..., p_state jsonb default null)` for mid-turn saves, NOT applied yet (the tool call was cancelled); until then the client falls back to turn-start saves. Old note, 2026-10-03: NOT APPLIED. The Supabase tool timed out once (nothing applied,
not retried, house rule 6). Until it is applied the Save button stays hidden (save-game.js asks
my_saved_game first). Apply the file once in the Supabase SQL editor.

## Tested (local fake server, 2026-10-03)
Solo vs 2 bots, saved at turn 8 and at turn 23, page reloaded, Continue: board fingerprint, every
player's hand / active / activated scrolls, common area, stone pools and pawn positions all equal
to the moment of saving; my turn with 5 AP; the save used up; play went on 6 more turns, no errors.
Resume took 4-8 s.

## Stone check (2026-10-06)
Question: does Continue load stones correctly? Tested with an in-page fake server: Quick Play, a bot
brain plays your seat, Save & quit at turn 14-24, page reload, Continue, then a full compare.
- The game data was right every time: every player's stone pool, the shared source pools, every stone
  on the board, void AP, scrolls, pawns, AP.
- Bug found and fixed: the stone counters on screen showed 0/5 for every element after Continue. While
  rebuilding you are a spectator (seat -1), the counters read that empty seat's pool, and nothing redrew
  them when your seat came back. resume() now drops playerPools[-1] and redraws the stone counters,
  panels and opponent cards after step 4. After the fix: 3 runs (turns 15, 24, 23; 2-3 bots; once in
  seat 1 with void stones), zero differences, screen counters included.
- Note: the board fingerprint checked at resume covers tiles, board stones, pawns and activated
  elements, not the stone pools. The pools come from the last player-state-update of each player.

## Mid-turn saves and idle training (2026-10-10)
- Save works any time in your own turn: not while a scroll waits for a choice (selection mode, Take Flight,
  effect modals, transmute, cascade) or the response window is open, and not while a bot acts (bot-driver.js
  borrows the bot's seat then: myPlayerIndex = the bot). The save keeps {ap, void_ap}; resume() puts them back.
- Resume fixes: waits for a bot action the host started before the rebuild to finish (it would put the wrong
  seat and AP back), and takes your seat from the save (mySeat.index).
- Tested (fake server): 4 mid-turn saves at turns 9-15, 3-5 seats: your seat, AP, pawn, board, hands equal; two
  runs showed small bot-seat leftovers (a bot's shown AP once, a bot's stone pool off by one once), not chased yet.
- Idle training (js/idle-training.js): 10 min idle on your turn in a solo game -> quiet save -> lobby -> idle
  training at once; any input reloads and continues the saved game. Tested end to end: 0 differences.
