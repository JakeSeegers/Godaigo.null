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
delete_saved_game. STATUS 2026-10-03: NOT APPLIED. The Supabase tool timed out once (nothing applied,
not retried, house rule 6). Until it is applied the Save button stays hidden (save-game.js asks
my_saved_game first). Apply the file once in the Supabase SQL editor.

## Tested (local fake server, 2026-10-03)
Solo vs 2 bots, saved at turn 8 and at turn 23, page reloaded, Continue: board fingerprint, every
player's hand / active / activated scrolls, common area, stone pools and pawn positions all equal
to the moment of saving; my turn with 5 AP; the save used up; play went on 6 more turns, no errors.
Resume took 4-8 s.
