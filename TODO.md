# Godaigo – Project TODO

High-level task list for the Godaigo game project. Update this as you complete or add work.

---

## 🔴 In progress / Broken

### Wandering River (Water IV) – **not fixed, still broken**
- Intended: transform any non–player tile to count as a chosen element until the start of your next turn. Flip gives that element’s scroll; end turn on tile gives that element’s stones; red fire indicator; buff clears at beginning of your next turn.
- Current state: little progress; behavior is still wrong or missing. Needs full pass:
  - [ ] Tile selection mode: confirm clicks register and selection + element picker complete.
  - [ ] Buff storage: confirm `activeBuffs.wanderingRiver` is written/read with correct `tileId` (id type consistency).
  - [ ] Scroll on flip: `revealTile()` uses effective element for `onTileRevealed`; confirm void (and other) scrolls are granted when flipping a transformed tile.
  - [ ] Stone on end turn: shrine replenish uses effective element; confirm standing on transformed tile gives correct stones.
  - [ ] Indicator: red fire symbol (♦) and red styling; re-apply after tile reveal (element is replaced on reveal).
  - [ ] Clearing: clear at start of caster’s next turn (multi and single player); confirm `clearWanderingRiverForPlayer` is called in all end-turn paths and on receiving turn-change in multiplayer.

---

## ✅ Completed (other)

- **Game Log missing a real remote human's moves/stone placements** — User-reported: with a lobby-added bot the Game Log always looked complete, but with a real second human account, that player's moves and stone placements silently never appeared in the other client's panel (casts/effects/responses were always fine). Root cause: `action-log.js` only hooks the LOCAL, sending-side functions (`broadcastPlayerMovement`, `window.placeStone`) — a client's own `ActionLog` never sees an action that arrives purely as an already-applied broadcast payload. Casts/effects were unaffected because `lobby.js`'s scroll-resolution receive handlers genuinely rerun `spellSystem.scrollEffects.execute()` on every client (which calls the shared `logScrollEvent` hook `action-log.js` also chains onto) — but movement and stone placement are applied on receipt through separate, purely-visual functions (`movePlayerVisually`/`placeStoneVisually`) that never touch the wrapped functions. Went unnoticed with bots specifically because a lobby-added bot's turns are driven by the HOST'S OWN browser impersonating it (`bot-driver.js`'s `asBot()`), so a bot's moves/stones already ran through the normal local hooks. Fixed by calling `window.ActionLog.record()` directly from `lobby.js`'s `'player-move'`/`'stone-place'` broadcast receive handlers; added an optional `playerIndexOverride` param to `record()` so the move entry uses the payload's own `playerIndex` rather than the ambient (and receive-side, potentially lagging) `activePlayerIndex`.
- **Telekinesis (Void IV) – fixed illegal-placement bug + added legal-slot glow highlighting** — A bot-reported (and human-confirmed) case where a tile moved by Telekinesis landed touching zero other tiles, isolated from the rest of the board.
  - **Root cause**: `findNearestSnapPoint()`'s Telekinesis rule (`js/game-core.js`) checked `touchingCount < 1` even though the player-facing status text and the drag-fail error message both always said "must touch 2+ others" — fixed to `< 2` to match. Separately, `bot-effects.js`'s `driveTelekinesis()` picks its destination by probing hexes adjacent to the tile's own *current* position *before* picking it up, so the tile being moved was still in `placedTiles` and got counted as a "neighbor" of its own soon-to-be-vacated spot — trivially passing even a correct `>=1`/`>=2` check while the real post-move destination could have zero genuine neighbors. Added an `excludeTileId` param threaded through `countTouchingTiles()` → `findNearestSnapPoint()`, passed as the moved tile's own id from the bot's dry-run search (and from `game-ui.js`'s human drag-drop handlers, defensively) so the check reflects the board as it will actually look after the move.
  - **New UI**: `showLegalPlacementHighlights(mode, excludeTileId)` / `clearLegalPlacementHighlights()` (`game-core.js`) draw faint pulsing gold hex outlines (`.legal-placement-hex`, `css/board.css`) over every empty slot that's currently a legal drop target, computed once at drag start (not per-frame) and cleared on drop/cancel. Wired into `startPlayerTileDrag()` (`mode: 'player-tile'`, 2+ touching *unrevealed* tiles) and `startTileDrag()` (`mode: 'telekinesis'`, 2+ touching tiles, any revealed state) — both the human drag paths and the underlying rule the bot uses.
- **End-of-turn scroll overflow** – Modal to resolve hand/active overflow; “make space” flow (active → common, then hand → active).
- **Scroll / UI** – Stone formation display, common area/opponent popout toggles, Shifting Sands fix, spell selection close button, scroll state validation, Inspiring Draught fix, initial stone counts for testing.
- **Shifting Sands (Earth II) – ability rule change** – Tiles with stones are still ineligible, but a tile with exactly one player is now a valid swap target (the player is carried along and recentered on the tile after the swap); tiles with 2+ players remain ineligible. Added dedicated `isTileEligibleForShiftingSands()` / `getEligibleTilesForShiftingSands()` in `scroll-effects.js` rather than loosening the shared `getEligibleTilesForSwap()` — Telekinesis (drag highlighting) and Heavy Stomp (`getEligibleTilesForFlip()`) both still call the shared function and keep the old, stricter no-players rule. Updated `scroll-definitions.js` description and the multiplayer `tile-swap` receiver in `lobby.js` to recenter the carried player on other clients (same `movedPlayers` shape as the existing `telekinesis-move` handler).
- **Take Flight (Wind IV) – destination rule + who chooses** – New destination rule: must be an unoccupied hex on a tile currently occupied by another player (not a player tile); cancels with no drag UI shown if no valid destination exists for the chosen target. New chooser rule: self-target still has the caster choose (as before); opponent-target now hands the choice to the TARGET instead. In real multiplayer (`isMultiplayer` true, target on a different client) that's a genuine hand-off — caster broadcasts `take-flight-choose-request`, the target's own client runs the drag UI (`ScrollEffects.enterTakeFlightChoiceAsTarget`) and broadcasts the result back (`take-flight`), which the caster's client (which stashed a `window.pendingTakeFlightCompletion`) uses to resolve its own `onSelectionEffectComplete`; either side can cancel via `take-flight-cancel-request`. Outside real multiplayer (solo/hotseat) the casting client still drives the drag directly for the opponent, same as the old behavior. Destination legality (`getValidTakeFlightDestinations()`/`isValidTakeFlightDestination()` in `scroll-effects.js`) is shared by the human drop-handler (`game-ui.js`) and the bot's `driveTakeFlightDrag()` so neither can propose an illegal drop.
- **Take Flight – bot response when it's the one choosing** – `driveTakeFlightDrag()` (`bot-effects.js`) now rolls a uniform-random valid destination instead of its old goal-seeking-toward-hidden-tiles heuristic, and responds immediately rather than never acting. It resolves ANY open `take-flight-drag` selection (not just self-targeted ones), so in local/arena play (`isMultiplayer` false) it also stands in for a bot-controlled opponent being targeted, since that drag still runs on the same page.
- **Take Flight – bot-driver.js integration for a bot added via the lobby's "Add Bot" button** – Corrects an earlier wrong assumption in this file: bots added this way (`js/bot-driver.js`, a real `players` row per bot, host's browser impersonates it via `asBot()`) are a completely different system from `bot.js`/`BotArena`'s Shift+B / arena-simulation tools, and were never covered by the `driveTakeFlightDrag()` fix above — the `take-flight-choose-request` broadcast only ever checked `myPlayerIndex === targetPlayerIndex` in `lobby.js`, which is never true for the host merely *driving* a bot (impersonation only happens transiently inside `asBot()`), so a targeted lobby-added bot silently did nothing. Fixed in two parts:
  - **Different client drives the bot** (a guest targets a bot the host drives): `lobby.js`'s listener falls back to `BotDriver.resolveTakeFlightChoice()` (`bot-driver.js`) when the target isn't the local human player; it checks `BotDriver.isBot(targetPlayerIndex)`, impersonates via `asBot()` (same discipline as `driveBotTurn()`), rolls a random valid destination via `ScrollEffects.getValidTakeFlightDestinations()`, and finalizes via `ScrollEffects.finalizeTakeFlightChoice()` — broadcasting `take-flight-cancel-request` instead if none exist.
  - **Same client is both caster and bot-driving host** (the common single-browser "host adds a bot, then plays as the human themselves" setup — turned out to be the actual repro): the broadcast round-trip above can never work here regardless of the fix, because `lobby.js`'s channel is `broadcast:{self:false}` — a client never receives its own sends. `enterTakeFlightMode()` (`scroll-effects.js`) now detects this case (`isHost && isMultiplayer && BotDriver.isBot(targetPlayerIndex)`) and skips the broadcast hand-off entirely: it still calls the normal local `_enterTakeFlightDrag()` setup, then immediately calls `BotEffects.driveSelection()` (dispatches on the `take-flight-drag` selectionMode it just opened) to resolve it synchronously, right then, with zero broadcast dependency.
- **Take Flight – dropped the hand-vs-active-area disposition rule** – The scroll now always stays in the caster's active area no matter who's targeted; removed the old "opponent target -> scroll moves to their hand" mutation from `finalizeTakeFlightChoice()` (`scroll-effects.js`) and the matching sync block from the `take-flight` broadcast receiver (`lobby.js`).
- **Psychic (Void I) – ransom mechanic: pay 2 AP to negate** – User request, ported from an old unmerged PR (`#10 serene-cannon-ll0uiv`) plus hardening found during design review, across `js/scrolls/response-window.js`, `js/scrolls/effects/scroll-effects.js`, `js/scrolls/scroll-definitions.js`, `js/multiplayer-state.js`, `js/lobby.js`.
  - **The mechanic**: when Psychic wins response arbitration, the original caster (whose client always resolves the response stack — `isArbitratorClient()`) gets a local pay/decline prompt (15s timer, timeout = decline, no prompt at all if they can't afford it). Pay 2 AP → Psychic is negated entirely: no counter, no steal, the original scroll resolves normally, Psychic still moves to the common area but does NOT count as a void activation and the 2 AP already spent casting it is not refunded (judgment calls, easy to flip — see `showPsychicRansomPrompt()`'s comment). Decline/timeout/can't-afford → existing behavior unchanged.
  - **Bots always pay if they can afford it** (explicit user request) — `isBotControlledCaster()` checks `BotDriver.isBot()` (lobby-added bot) or `BotArena.isRunning()` (headless/self-play match) and skips straight to paying, no UI, no 15s wall-clock wait per occurrence.
  - **Why this needed a real restructure, not just an inserted popup**: `resolveResponseStack()` used to decide the outcome and broadcast it to every client synchronously, in one pass — there's no way to "pause" a JS function mid-run for an up-to-15s human decision. Split into `resolveResponseStack()` (pops the stack, decides whether to prompt) and a new `finishResponseResolution(responses, originalScroll, ransomPaid)` (the actual resolve/broadcast/close-out), called either immediately or from the prompt's callback once the decision comes back.
  - **Re-entrancy guard (`_resolving`)**: while the prompt is open, `isResponseWindowOpen` deliberately stays `true` (only `finishResponseResolution` clears it) — anything that polls it to decide "should another player respond right now" (`bot.js`'s `waitForQuiescence()`, `bot-driver.js`'s `respondForBots()`) could otherwise fire `BotEffects.decideResponse()` again for some other player mid-decision. Found that `decideResponse()` calls straight into `playerResponds()`, which unconditionally spends AP and pushes onto `this.responseStack` *before* anything checks resolution state — a stray call would silently waste a bot's AP and scroll for a response that can never actually be counted (the stack's already been drained into local variables by that point). Added a `this._resolving` flag, set the instant `resolveResponseStack()` starts and cleared only when a fresh window opens for the next cast; `playerResponds()`/`playerPasses()`/`handleRemoteResponse()`/`handleRemotePass()` all early-return with a warning if it's set. Note: it's not an *extension* of the original response window's own up-to-15s timer — that timer is fully cleared before the ransom prompt's own, separate, up-to-15s timer even starts, so total worst-case delay before Psychic's outcome is settled is up to ~30s, not 15s.
  - **New result type `counter-negated`** (alongside the existing `countered-original`/`response-resolved`/`resolved`/`countered`) — dispatched via the same `scroll-resolved` CustomEvent/`response-resolved` broadcast machinery everywhere else uses; handled in `multiplayer-state.js` (arbitrator's own client) and `lobby.js` (every other client) as disposition-only (move Psychic to common area) with no `scrollEffects.execute()` call, since no steal was ever queued for a negated Psychic.
  - **`ScrollEffects.addPendingBuff()`/`removePendingBuff()`** — new single entry points for all `psychicPending`/`reflectPending` writes (previously each of the ~4 call sites did its own raw array push), deduped by a new per-resolution `eventId` (`generateEventId()`) that's threaded through every broadcast that can carry the same logical event (`psychic-buff-applied`, `reflect-buff-applied`, `psychic-triggered`, `reflect-triggered`, `response-resolved`) — guards against the same steal/reflect getting queued twice from two different arrival paths (local execute + broadcast echo), and against a bystander client's copy of a pending buff lingering forever once another client consumes it (now cleared via `removePendingBuff` when the `*-triggered` broadcast arrives).
  - **`ScrollEffects.MAX_EFFECT_CHAIN_DEPTH`** — a hard ceiling (4) on synchronous `execute()` → `execute()` chains (Reflect duplicating a scroll, etc.), general hardening not specific to Psychic but added alongside it.
  - Not yet done: a live smoke test (pay / decline / can't-afford / bot-auto-pay, in both solo and real multiplayer) — the reference PR this was ported from noted the same gap for its own version.

---

## 🔲 To do / Backlog

### **Complete ability code for all scrolls (Water, Fire, Wind, Void, Catacomb)**
- Implement or finish the **effect logic** for every scroll in `js/scrolls/effects/scroll-effects.js` so each scroll’s ability works as designed.
- **Water (5):** I–III and V have effects; **IV (Wandering River)** is broken (see above). Ensure all five are correct.
- **Fire (5):** I–V have effect stubs; verify and complete behavior for each (e.g. Unbidden Lamplight, Arson, Sacrificial Pyre, Scorched Earth, Burning Motivation).
- **Wind (5):** All five entries exist in `effects`; verify each ability works correctly.
- **Void (5):** All five entries exist in `effects`; verify each ability works correctly.
- **Earth (5):** I–V have effects; verify Iron Stance, Shifting Sands, Heavy Stomp, etc. are complete.
- **Catacomb (10):** All ten entries exist in `effects`; verify each ability works correctly.
- Use `js/scrolls/scroll-definitions.js` and `docs/game-design-document.md` for names, descriptions, and intended behavior.

### Game design & content
- [ ] **Reaction phase** – Allow responses with scroll activations (see design doc).
- [ ] **Game phases** – Expand Main Phase, Reaction Phase, etc. in code and UI.
- [ ] **Balance / content** – Scroll balance, deck sizes, stone counts (beyond test values).

### Scroll system
- [ ] **Scroll limits** – Confirm MAX_HAND_SIZE / MAX_ACTIVE_SIZE (currently 2/2) and any per-mode overrides.
- [ ] **Common area rules** – Max one scroll per element; clarify behavior when full.
- [ ] **Catacomb / multi-element** – Ensure all catacomb patterns and win-condition contributions work as designed.

### Multiplayer & sync
- [ ] **Wandering River in MP** – Turn-change and clear logic when receiving `turn-change` from network (lobby.js).
- [ ] **Scroll overflow modal in MP** – Overflow modal and Done path sync state correctly with other clients.
- [ ] **Tile flip / reveal sync** – Effective element (Wandering River) consistent when tile is revealed by another client.

### UI / UX
- [ ] **Indicators** – Any other “transformed” or temporary effects that need a clear indicator.
- [ ] **Accessibility** – Keyboard/screen reader support, focus management in modals.
- [ ] **Mobile / responsive** – Touch, viewport, and layout on small screens.

### Economy / purchases
- [x] **Emoji/cosmetics purchases live in `localStorage`, not the database** - DONE 2026-09-27 (name colours 2026-09-24, emojis via sql/emoji-server.sql).
  found while building Bot Tycoon capture stones (`docs/bot-tycoon-proposal.md`).
  `js/emoji-system.js`'s `purchaseEmoji()` deducts gold via the real
  `award_gold` RPC but then persists WHICH emojis you own to
  `localStorage['godaigo_emojis_' + userId]` (`loadInventory()`/
  `saveInventory()`), not to any Supabase table — same for cosmetics
  (`js/cosmetics-system.js`, same pattern). Consequence: clearing browser
  storage, switching browsers, or switching devices silently loses
  everything you've paid gold for, even though the gold deduction itself
  is real and permanent. The `shop_items` table and `user_profiles.inventory`
  jsonb column both exist in the schema and LOOK like they were meant for
  exactly this — `shop_items` has 0 rows and `inventory` is unused; neither
  is actually read by the current purchase code. Should be migrated to a
  real per-user, per-item ownership table (or at minimum write into
  `user_profiles.inventory`) so purchases survive across devices/sessions
  like gold and XP already do. Capture stones (`user_profiles.capture_stones`
  column + `captured_bots` table) were deliberately built the RIGHT way
  from the start rather than copying this pattern — see that entry in
  `planning/current.md`.

### Connectivity / performance
- [x] **RLS `auth.<fn>()` → `(select auth.<fn>())` performance fix — APPLIED**
  — user confirmed go-ahead; migration `fix_auth_rls_initplan_performance`
  applied to the live project (`lovybwpypkaarstnvkbz`) rewriting all 13
  flagged policies across `players`/`game_room`/`user_activities`/
  `bot_champion_weights`/`deployed_bots`/`captured_bots`/`void_knight`.
  Verified both ways: `get_advisors` re-run shows zero `auth_rls_initplan`
  warnings left (only the pre-existing, untouched `unindexed_foreign_keys`
  INFO items remain), and a `pg_policies` re-read confirms every policy's
  logical condition is unchanged — same columns, same roles, same command —
  just wrapped. See `planning/current.md`'s "CONNECTIVITY & PERFORMANCE,
  FOLLOW-UP" entry for the exact before/after.
- [ ] **`admin_delete_user`/`admin_list_users` callable by any signed-in
  user** — found via the same advisor scan, unrelated to connectivity/perf.
  Deliberately not investigated further (didn't check whether either
  function has an internal guard like `nuke_all_rooms`'s `is_hermit()`) —
  flagged rather than silently left, explicitly out of scope for this pass.
- [x] **Root cause of the 8/20 playtest breakage — CONFIRMED via live Supabase
  logs, not just theory.** `subscribeToLobby()`'s `players` postgres_changes
  handler re-ran two full `select *` queries on EVERY row a change touched —
  and `updateHeartbeat()`'s bot-sweep PATCH touches N bot rows in one
  statement, which Realtime fans out into N separate change events. Real
  logs showed 16 near-identical queries in ~600ms following one heartbeat
  tick, repeating every ~15s for a ~49-minute session across 4 recreated
  game rooms. Fixed: `js/lobby.js`'s `scheduleHostAndListRefresh()` debounces
  that handler's tail (300ms trailing). See `planning/current.md` for the
  full evidence trail.
- [ ] **Live playtest under real degraded network conditions** — the
  connection-monitor work (see `planning/current.md`'s "CONNECTIVITY &
  PERFORMANCE" entry) was verified by static code review + `node --check`
  only; this sandbox has no outbound network access to the live Supabase
  project. Confirm the badge/gate/reconnect logic actually behaves
  correctly with a real bad connection (throttled devtools network, or a
  genuinely flaky wifi) before considering it fully proven out.
- [ ] **Turn-sync/common-area-sync/heartbeat/disconnect-sweep frequencies
  reviewed but left unchanged** — `turnSyncInterval` (5s), `commonAreaSyncInterval`
  (10s), `_heartbeatInterval`/`_disconnectMonitorInterval` (15s each) are all
  additional host-side or per-player background chatter in `game-core.js`/
  `lobby.js`, same family as the turn-timeout/scroll-state-sync/last-man-
  standing intervals that WERE reduced in that pass. Not touched because
  they seemed reasonably paced already, not because they're provably fine —
  worth a second look if connection issues persist after the fixes above.
- [ ] **`js/config.js` is confirmed dead code** — never loaded by `index.html`,
  every constant duplicated in files that ARE loaded (see the file's own
  header comment and `js/INDEX.md`). Left in place since deleting it wasn't
  in scope of the connectivity/performance pass that found it — worth an
  explicit decision (delete vs. keep as reference) rather than leaving it
  to keep silently misleading whoever next trusts CLAUDE.md's file map.
- [ ] **`.planning/` directory appears stale/abandoned** — found while fixing
  the `js/tutorial.js` doc drift above: `.planning/REQUIREMENTS.md` /
  `ROADMAP.md` / `PROJECT.md` still track "delete js/tutorial.js" as a
  pending cleanup item, but the file is already gone from disk and
  `index.html` — the deletion happened without that tracking system being
  updated (or through a different workflow entirely). This is a separate,
  dot-prefixed directory from the `planning/current.md` this project's own
  CLAUDE.md points to as the session-start file — not touched here since
  it's unclear whether it's still in active use; worth clarifying with the
  user whether it should be reconciled or removed.

### Code quality & docs
- [ ] **TODO/FIXME in code** – Search codebase for inline TODOs and either implement or move to this file.
- [ ] **Tests** – Unit or integration tests for SpellSystem, scroll effects, turn/overflow logic.
- [ ] **Design doc** – Keep `docs/game-design-document.md` in sync with implemented rules.

### Optional / polish
- [ ] **Save / load** – Save game state (tiles, scrolls, turn, AP) and resume.
- [ ] **Replay or log** – Optional action log or replay for debugging and clarity.
- [ ] **Performance** – Profile and optimize if needed.

---

## 📁 Key files

| Area              | Files |
|-------------------|--------|
| Core game logic   | `js/game-core.js` |
| UI & input        | `js/game-ui.js` |
| Scroll effects    | `js/scrolls/effects/scroll-effects.js` |
| Scroll data       | `js/scrolls/scroll-definitions.js` |
| Multiplayer       | `js/lobby.js`, `js/multiplayer-state.js` |
| Styles            | `css/board.css`, `css/styles.css` |
| Design            | `docs/game-design-document.md` |

---

*Last updated: confirmed the actual root cause of the 8/20 playtest breakage via live Supabase log analysis (a postgres_changes fan-out bug in the players-subscription handler, now fixed), applied the RLS auth_rls_initplan performance migration to the live project with user confirmation (verified via get_advisors + pg_policies), and flagged one remaining live-project finding (an admin-RPC access question) — see Connectivity/performance.*
