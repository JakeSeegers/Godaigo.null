# Network resilience plan

Goal: a network drop, a refresh or a closed tab should not end a game or put
the boards out of sync. Short problems stay hidden. Long problems give the
host a clear choice.

Status: Parts A and B are live (2026-09-30). "Pause on drop" (below) is live (js/game-pause.js, merged 2026-09-30 from
`feature/pause-on-drop`). It replaces
Phase 1 and the Wait / Kick part of Phase 2. Phase 2 rejoin-after-refresh and Phase 3 are still plans.

---

## What exists today

| Piece | Where | What it gives us |
|-------|-------|------------------|
| Refresh guard (Part A) | lobby.js `_inLiveOnlineGame()`, beforeunload | "Leave site?" in a live online game. Seat cleanup runs on pagehide only. |
| Reconnect grace (Part B) | lobby.js `_startReconnectGrace()` | Presence drop hidden for 5 s, no last-player-standing win for 60 s, host turn timeout paused for a reconnecting active player. |
| Channel auto-reconnect | lobby.js `setupGameBroadcast(true)` | Up to 5 tries with backoff after CHANNEL_ERROR / TIMED_OUT / CLOSED. |
| Connection badge | connection-monitor.js | `quality` good/fair/poor/offline, `isWorkable()`. |
| Scroll sync | lobby.js `scroll-state-sync(-request)` | Host re-sends the scroll state every few seconds. Asked for at once after a reconnect. |
| Match recording | match-recorder.js | Host saves every broadcast to `match_moves` (flush every 3 s). |
| Replay engine | replay-viewer.js `startBoard()` / `dispatch()` | Rebuilds a game from recorded moves through the real broadcast handlers. |
| Board fingerprint | match-witness.js | Hash of the public board per turn, compared between players. |
| Host re-election | match-recorder.js `adopt()`, sql `is_room_host()` | Host = oldest non-bot seat. A new host continues the recording. |

The gap: after a drop, **board moves sent while a player was away are lost** for
that player (only scrolls catch up). After a refresh, **the seat is gone** and
there is no way back into the game.

---

## Pause on drop (built, owner idea 2026-09-30)

Only the active player changes the board, so freezing the game while anyone is
disconnected means there is almost nothing to catch up. js/game-pause.js:

- Pause reasons: another player's presence leave, my own channel error, the host's
  Pause button (HUD, host only; Resume in the HUD or on the overlay).
- While paused: a clear overlay takes clicks and keys; text shows after 5 s (own
  drop 2 s, host pause at once). Bots and the host turn timeout wait. Every client
  adds the paused time back to `turnStartedAtMs`.
- Catch-up for the moves made before the others noticed the drop (up to ~30 s):
  message ids + a 150-message history on every client, `gp-resync-request` ->
  lowest present seat answers with the missed messages and its fingerprint ->
  replayed through the channel handlers -> fingerprints compared (retries) ->
  `gp-resync-done` unpauses the others (fallback 10 s after they are back).
- After 60 s: host sees Wait / Kick; if the host is the one gone, the others see
  Wait / Continue without them; the last human sees Wait / Claim win. Wait asks
  again after 2 min.
- The own channel now keeps retrying (every 30 s at most) instead of giving up after 5.
- Decisions taken: D1 = pause, D5 = block input.
- Known limit: response-window countdowns (15 s) keep running during a pause.
- Tested with a two-page Playwright harness (fake channel over BroadcastChannel):
  missed moves arrive, fingerprints match, clock extended, host pause, all three
  60 s panels. Not yet tested in a real online game.

The Phase 1 text below is the older, larger plan, kept for reference.

## Phase 1: catch up after a short drop (medium, client only)

No server changes. Makes Part B complete.

1. **Message ids.** `broadcastGameAction()` adds `_mid` (sender seat + counter)
   to every payload. Every client keeps a Set of seen `_mid`s and ignores a
   message it already applied. Needed before anything is ever re-sent.
2. **Host history buffer.** The host keeps the last ~300 messages in memory
   with a host sequence number (it already sees them all for MatchRecorder).
3. **Catch-up request.** After a reconnect (`isReconnectAttempt` + SUBSCRIBED),
   the client sends `resync-request { lastSeq }`. The host re-sends every
   message after `lastSeq` that the client did not send itself. The client
   applies them in order, skipping seen `_mid`s.
4. **Check the result.** After catch-up the client compares its board
   fingerprint (match-witness hash) with the host's (`resync-check`). A
   mismatch shows "Your board is out of sync" with a Reload button (which
   becomes "Rejoin" after Phase 2).
5. **Own outbox.** While `ConnectionMonitor` says offline, the player's own
   actions go into a small queue instead of being lost, and are sent (with
   their `_mid`) after the reconnect. Simpler alternative: block board input
   with a "Reconnecting..." overlay while offline. **Recommended: the overlay**
   (a queued move can conflict with moves the others made meanwhile).

Risk: a message applied twice (step 1 prevents it) or out of order (host seq
order prevents it). Test with 2 browsers and `context.setOffline()`.

---

## Phase 2: rejoin after a refresh (big, server + client)

This is "Part C" from the chat on 2026-09-30.

### Server (new sql file, e.g. sql/player-away.sql)
- `players.away_since timestamptz` (null = here).
- `mark_player_away(p_player_id)`: own seat only. Used by pagehide INSTEAD of
  `remove_player` while the room is `playing`. The seat stays.
- `my_active_game()`: the caller's seat in a `playing` room, if any.
- `get_live_match_moves(p_room)`: all `match_moves` so far, for a player
  seated in that room only. No new leak: every seat already receives every
  broadcast live.
- `mark_player_back(p_player_id)`: clears `away_since`.
- Cleanup: an away seat in a playing room is removed by the host's choice
  (below) or after a hard limit (for example 10 min) by the existing sweeps.
- Last-player-standing (`startLastManStandingPoll`, players DELETE handler)
  needs no change: an away seat is still a seat, so nobody wins while that
  player may come back. The win comes when the seat is removed.

### Client
1. On load (after sign-in), `my_active_game()`. If there is one: "You were in
   a game. Rejoin?" (and skip the intro).
2. Rejoin: the host flushes its recorder (`resync` message asks it to), then
   the client loads `get_live_match_moves`, starts the board like a replay
   (`startBoard()` with the real seat, not -1), dispatches every move at full
   speed with sounds and effects muted, then joins the live channel.
3. Catch the tail with Phase 1 (moves after the last flushed one).
4. Fingerprint check (Phase 1 step 4). On mismatch: try once more, then tell
   the player and the host.
5. `mark_player_back()`.

### Host choice: Wait / Kick
- When a player has been gone 60 s (Part B timer), the host sees a small panel:
  "(color) lost connection. **Wait** / **Kick**", with how long they have been gone.
- **Wait:** see decision D1 below. Ask again every 2 minutes.
- **Kick:** `remove_player` (host is allowed). Their seat goes, the game goes
  on as today.
- Everyone else sees "(color) lost connection, the host is waiting" or
  "(color) was removed".
- If the host is the one who is gone: the next host (oldest non-bot seat)
  gets the panel, like `adopt()` does for the recording.

---

## Phase 3: host drops

Bots run on the host's browser (bot-driver.js), and the host enforces the turn
timer and scroll sync. Today a host blip pauses the bots and the timers.
- Check that a new host takes over bot turns after the host is removed
  (to verify: bot-driver.js on host change).
- With Phase 2, a host refresh keeps the host seat, so the host role comes
  back with it. Bots wait until then (or until the next host takes over
  after the Kick / hard limit).

---

## Decisions for the owner

| # | Question | Suggestion |
|---|----------|------------|
| D1 | While the host waits: pause the whole game, or skip the missing player's turns? | Pause if it is their turn; skip their turns otherwise. |
| D2 | Longest wait before an automatic kick? | 5 minutes. |
| D3 | Does a player who rejoined keep XP / ladder for a win? | Yes (the recorded game is still one game). |
| D4 | When a player is kicked, should a bot take over their seat? | Later. Not in the first version. |
| D5 | Phase 1 step 5: queue actions while offline, or block input? | Block input with an overlay. |

---

## Test plan

Playwright can run 2 to 5 players in one browser (separate contexts) and cut
one off with `context.setOffline(true)`. Scenarios, each in a 2-player and a
3-player game with one bot:

1. 3 s drop on your own turn, on another player's turn. Nothing visible, boards match.
2. 20 s drop while others move. "Lost connection" / "is back", boards match after catch-up.
3. 90 s drop in a 2-player game. No win before 60 s; host gets Wait / Kick (Phase 2).
4. F5 on your own turn: rejoin, same board, same hand, same AP, timer fair.
5. Host F5 with a bot in the game: bots continue after the host is back.
6. Tab closed for good: host kicks, game goes on; the last-player-standing win still works.
7. Game over while someone is away: no double game over.

Each scenario ends with a fingerprint compare of all boards.

---

## Order of work

1. Phase 1 steps 1-4 + overlay (step 5). About a day, client only.
2. Phase 2 server sql, then client rejoin, then the host panel. Several days.
3. Phase 3 checks.
4. Automated test scenarios above, run before each release that touches lobby.js.
