# Godaigo Bot — Improvement Roadmap

> Written for AI consumption. An agent picking up ANY stage below should read this
> file top to bottom first, then the KEY FACTS section twice.
> Parent index: [docs/INDEX.md](INDEX.md) · Game modules: [js/INDEX.md](../js/INDEX.md)

---

## TWO INDEPENDENT TRACKS

This roadmap now has two tracks that can progress in parallel — they touch
different concerns and neither blocks the other:

- **STRATEGY TRACK** (Stages 2–3c below): makes the bot *smarter* — lookahead,
  weight evolution, learning. Runs fine inside the current host-browser model.
- **RUNTIME TRACK** (Stages R1–R5, new section below STAGE 1.5): moves *where*
  the bot executes — off the host player's browser and onto a backend, so a
  human host is no longer required for bots to play. Does not change bot
  intelligence at all; Stage 1's `scoreAction()` moves verbatim.

## STAGE STATUS

| Stage | Name | Status | Files |
|-------|------|--------|-------|
| 0 | Game-state API (snapshot / legal actions / apply) | **DONE** | `js/bot-state.js` |
| 1 | Utility-scored bot (replaces rule ladder) | **DONE** | `js/bot.js` |
| 1.5 | Multiplayer bot player (host-driven, any count up to 5-player cap) | **DONE** | `js/bot-driver.js` + lobby.js `addBotPlayer()`/`removeBotPlayer()` |
| R1 | Narrow driver to pure adapter | **DONE** | `js/bot-driver.js` |
| R2 | One backend path for move validation (shadow-mode, `endTurn` only) | **DONE** | `validate-end-turn` edge fn + `persistCurrentTurnIndex()` |
| R3 | Backend-authoritative turn validation | TODO | Supabase edge function + game-core.js call sites |
| R4 | Replace host-browser impersonation with backend-driven bot turns | TODO | `js/bot-driver.js` (removed), backend service |
| R5 | Server-side bot execution + bot-vs-bot | TODO | backend service running `bot.js` logic headless |
| 2 | Forward model + lookahead search | **DONE** (steps 1–4; step 5 MCTS optional, not started) | `js/bot-sim.js` + `bot.js` searchPick |
| 3a | Weight evolution via self-play arena | **DONE** (run + evolve built; first measurements taken; large-scale evolution awaits R5; cheat-panel "🧬 Train Weights" button runs a modest preset without the console) | `js/bot-arena.js`, `js/game-ui.js` cheat panel |
| 2.5 | Scroll-effect usage: selection targets + response scrolls | **DONE** — full choice-space inventory covered: all selection effects, response scrolls, Excavate's deferred teleport, and the 2 previously-drag-only scrolls (Take Flight, Telekinesis). Step 4 (simulator whitelist) first tranche done: Create/Transmute/Arson simulated with 9/9 harness scenarios at zero divergence | `js/bot-effects.js` + bot-sim whitelist |
| 3b | Human game logging → eval set / cloning data | TODO | `js/bot-logger.js` (new) + Supabase table |
| 3c | Neural RL (optional, last) | TODO | — |

---

## KEY FACTS & GOTCHAS (read twice — violating these breaks everything)

1. **Game globals are NOT on `window`.** `game-core.js` is a classic script whose
   state lives in top-level `let`/`const` (`placedTiles`, `placedStones`,
   `playerPositions`, `activePlayerIndex`, `sourcePool`, `playerPools`,
   `playerPoolCapacity`, `getTotalAP()`, `spendAP()`, `canPlayerMoveToHex()`,
   `getAllHexagonPositions()`, `hexToPixel()`, `pixelToHex()`, `placeStone()`).
   Classic scripts share the global *lexical* environment, so later scripts
   (bot-state.js, bot.js) reference them as **bare identifiers**.
   `window.placedTiles` is `undefined` — do not use it. Exceptions that ARE on
   window: `window.spellSystem`, `window.SCROLL_DEFINITIONS`, `window.placedStones`,
   `window.placeStone`, `window.stonePools`, `window.playerPools`,
   `window.updateStoneCount`, `window.revealTile`.

2. **Two different "pools" — do not confuse them:**
   - `playerPool` (window getter) = the DISPLAY player's personal stone pool
     `{earth,water,fire,wind,void}`, capacity 5 each (`playerPoolCapacity`).
     In multiplayer it shows MY pool, not necessarily the active player's.
     For the active player's pool always use `playerPools[activePlayerIndex]`.
   - `window.stonePools` (alias of internal `sourcePool`) = the SHARED source
     pool, capacity 25 each. **`stoneCounts` is NOT the source pool** despite
     what some older notes say — it is another alias of the display player's pool.

3. **Win condition** = a player's `spellSystem.playerScrolls[i].activated` Set
   contains all five of `earth, water, fire, wind, void` AND their pawn stands on
   the centre of their own player tile (the "player shrine"). The shared gate is
   `checkWinCondition(playerIndex)` in game-core.js; movement paths call it on
   arrival. Bot support: snapshot tiles carry `playerIndex` for player tiles, and
   bot.js walks home via `WEIGHTS.moveReturnHome` once all five are activated.
   Casting a scroll of an element whose SOURCE pool is 0 should still fire the
   effect but NOT award the win-condition element (see `planning/current.md`
   task 2 — check whether that rule is implemented in `applyScrollEffects()`
   before relying on it).

4. **Scroll rules the bot must respect:**
   - `SCROLL_DEFINITIONS[name].level === 1` → response-only, never proactively castable.
   - Patterns are RELATIVE TO THE CASTER'S HEX: `def.patterns` is an array of
     variants; each variant is an array of `{q, r, type}` offsets from the
     player's hex (`pixelToHex(pos.x, pos.y, TILE_SIZE)`). The same stones can
     satisfy a pattern from one standing position and not another — so WHERE the
     pawn stands when casting matters.
   - Casting: `spellSystem.moveToActive(name)` (if in hand) then
     `spellSystem.castSpell()` (no args — it scans the active area).
   - Pattern check: `spellSystem.checkPattern(name)` → boolean, uses the
     current pawn position.

5. **Movement**: `canPlayerMoveToHex(x, y)` → `{canMove, cost}` evaluates the
   DESTINATION hex only (terrain/stone cost), not adjacency — safe to call for
   any hex during path search. Hex grid positions come from
   `getAllHexagonPositions()` (each has `.x .y .key`); two hexes are adjacent
   when their pixel distance is >5 and <40. Stone terrain changes costs, so use
   Dijkstra (cheapest), not BFS (fewest hops).

6. **Collection**: ending the turn while standing on a revealed elemental
   shrine CENTRE (tile.x/tile.y within ~5px) collects stones from the source
   pool. End turn = click `#end-turn` (never reimplement turn logic).

7. **Multiplayer**: only act when `!isMultiplayer || activePlayerIndex === myPlayerIndex`.
   Acting for a remote player desyncs the game. All mutating actions must go
   through `BotState.applyAction()` which uses the game's own broadcast paths.

8. **Hidden information discipline**: face-down tiles DO have `tile.shrineType`
   in memory, but `BotState.snapshot()` deliberately masks it (`shrineType: null`
   when `revealed: false`). Never let bot logic read `tile.shrineType` of a
   flipped tile directly — that is cheating, and it poisons any learned weights.

9. **Testing without an account**: open the game → "Play Tutorial" (no login) →
   the board auto-sets-up. `window.BotSystem.step()` / `.turn()` from the console
   drive the bot. `Shift+R` = one action, `Shift+B` = play out the whole turn.
   **This genuinely works now** (see the placement-phase bug below) — before
   that fix, driving the bot immediately after "Play Tutorial" did nothing
   at all, forever.

---

## STAGE 0 — Game-state API (DONE — contract reference)

`js/bot-state.js`, exposed as `window.BotState`. Loaded after lobby.js,
before bot.js. Contains NO strategy — only observation and actuation.

```js
BotState.snapshot()      // → pure-JSON state (see shape below). Cheap; call freely.
BotState.legalActions()  // → Action[] for the active player, canonical form
BotState.applyAction(a)  // → {ok:boolean, reason?:string}; executes via game functions
BotState.hexGrid()       // → cached list of {x,y,key} board hexes
BotState.findPath(sx,sy,tx,ty) // → Dijkstra cheapest path [{x,y,cost}] | null
```

Snapshot shape (version 1):

```js
{
  version: 1,
  turn: { activePlayerIndex, myPlayerIndex, isMultiplayer, ap },
  sourcePool: { earth, water, fire, wind, void },          // shared, cap 25
  tiles:  [{ id, x, y, revealed, isPlayerTile, shrineType }], // shrineType null when !revealed
  stones: [{ x, y, type }],
  players:[{ index, x, y, color,
             pool: {earth,water,fire,wind,void},           // cap 5 each
             hand: [names] | null,                         // null for opponents (name/pattern hidden)
             handElements: [elements],                     // public even for opponents — each hand
                                                             // scroll's ELEMENT only (matches the opponent
                                                             // panel UI: icon per card, no name/pattern)
             handCount, activeCount,
             active: [names],                              // public
             activated: [elements] }]                      // public, win progress
}
```

Action forms (the ONLY vocabulary later stages may use):

```js
{ type:'cast',       scroll:'EARTH_SCROLL_3' }
{ type:'placeStone', x, y, stoneType:'earth', scroll, progress } // progress = placed/total after this stone
{ type:'move',       x, y, cost }                                // one adjacent hex step
{ type:'breakStone', stoneId, x, y, stoneType, cost }             // cost = STONE_BREAK_COST[stoneType] (void 1..earth 5)
{ type:'discardScroll', scroll, from:'hand'|'active' }           // only legal while hand/active is over capacity
{ type:'endTurn' }
```

`legalActions()` gates on overflow: when hand/active is over
`spellSystem.MAX_HAND_SIZE`/`MAX_ACTIVE_SIZE`, it returns discard-only actions
(cast/placeStone/move/breakStone/endTurn are withheld) until the bot discards
back down. `bot.js`'s `botAct()` checks this before even consulting the
pattern-plan (which calls `applyAction()` directly and would otherwise bypass
the gate). This is what lets the bot resolve its own end-of-turn scroll
overflow instead of surfacing `showEndTurnOverflowModal()` — see the fixed
bug below.

**`breakStone` (added after a real playtest got a bot stuck in a movement
loop):** the bot didn't know `attemptBreakStone()` exists — the same
right-click/long-press action a human uses to clear a blocking stone (AP
cost by rank, `game-core.js`'s `STONE_RANK`). A bot boxed in by an earth
stone (movement-blocking, see `canPlayerMoveToHex`) with nothing else legal
had no way out and no reason to sit and wait — this is a genuine Stage-0
vocabulary gap, same class as the common-area-cast/voluntary-discard gaps
below, not a hand-authored "avoid earth stones" rule. `bot-state.js` now
enumerates it (adjacent stone, affordable AP) and `bot.js` scores it with
two new weights (`breakStoneBase`, `breakStoneApPenalty`) — evolution decides
when it's worth an earth stone's 5 AP, same as everything else in the table.
Not yet mirrored in `bot-sim.js`, so hybrid-brain lookahead search can't plan
around it yet — only the greedy scoreAction() path considers it.

Not yet enumerated (Stage 2+ work): scroll-effect sub-choices (target
selection inside effects), hand→common moves. Catacomb/Freedom teleports
were added later — see STAGE 5.

**FIXED bug — placement phase was dead code outside real multiplayer (found
via a fresh user report of the bot "immediately stuck" — traced with a
Playwright repro that drove the bot straight from "Play Tutorial", not the
arena):** both `legalActions()`'s placement branch and `applyAction()`'s
`placeTile` case gated on the `isPlacementPhase` global, which is **only
ever set `true` by the real multiplayer lobby flow**
(`startMultiplayerGame()` in lobby.js). The local single-page `startGame()`
never touches it. `BotArena` never noticed because its own
`placePlayerTilesSpread()` calls `placeTile()` directly, completely
bypassing `BotState` for placement — so this path was untested by every
prior Stage 3a arena run. Tutorial Mode has no equivalent bypass: its own
scripted "place tile" step doesn't set `isPlacementPhase` either, so a bot
driven from the console right after clicking "Play Tutorial" got
`isPlacementPhase === undefined`, `playerPositions[activePlayerIndex] ===
undefined`, and `legalActions()` returned `[]` — forever. From a human's
perspective this looks exactly like "the bot is stuck in a loop": every
`Shift+R`/`Shift+B` press (or `BotSystem.step()`/`.turn()` call) logs "No
legal actions found" and nothing ever happens. Fixed by deriving placement
need from observable state instead of the flag: `isPlacementPhase` when
it's meaningfully set (real multiplayer), else fall back to "this player
has no pawn placed yet" — safe everywhere else since a legitimately active
player's `playerPositions[i]` never goes back to null once placed.
Verified end-to-end (Playwright): the exact repro that previously logged
"No legal actions found" on all 40 steps now places its tile, walks to a
shrine, places stones, casts a scroll, and reaches 3/5 elements activated
over 15 real turns, no errors.

---

## STAGE 1 — Utility-scored bot (DONE — contract reference)

`js/bot.js`. Every legal action gets `score = Σ weight × feature`; argmax wins.
All weights live in the exported `BotSystem.WEIGHTS` object — **later stages
tune this table; they should not need to touch the scoring code.**

Feature summary (see `scoreAction()` in bot.js for the authoritative list):
- cast: flat bonus; + `castUnactivated` if the scroll's element is not yet in
  the caster's activated set AND `sourcePool[element] > 0`; − `castDeadElement`
  when the source pool for that element is 0 (fires the effect but no win credit).
- placeStone: `progress` toward completing the chosen variant; + unactivated-element
  bonus; − small AP-less panic factor.
- move: value of the best reachable target (shrine worth ÷ path cost);
  shrine worth grows with (capacity − pool) and unactivated-element need.
- endTurn: small floor value; + big bonus when standing on a collectible shrine
  centre (ending the turn IS the collect action).

**FIXED bugs found via direct play-testing (not code review — run the bot for
10+ turns and watch what it actually does):**
- **Infinite re-cast loop.** `cast` scored the same regardless of whether the
  element was already in `self.activated` — since a satisfied pattern usually
  stays satisfied on the board, the bot would recast an already-won scroll
  forever instead of exploring for elements it still needed (observed:
  plateaued at 2/5 elements, never progressed). Fixed with `castAlreadyWon`
  (-120), well below `endTurn`/`move`.
- **Cursed-cell placement loop.** In a 2-bot test, one bot got stuck placing
  the same stone at the same hex every action, forever (source pool cycling
  13→25 while nothing ever stuck). Root cause: an adjacent active fire stone
  (`processStoneInteractions` in game-core.js) destroyed the stone immediately
  after every placement, and the plan logic just saw "still missing" and
  retried the identical doomed cell. Rather than modeling fire-adjacency
  rules in bot.js (would duplicate game logic — see DO-NOT list), added a
  failure-counting blacklist: if the cell targeted last cycle is still
  missing on this cycle, count it; past `CELL_FAIL_LIMIT` (2), blacklist the
  cell and abandon the plan. `makePlan()` skips any variant using a
  blacklisted cell. This is a general "reality disagrees with the plan
  repeatedly, stop trusting it" safety net — it doesn't need to know *why*
  a cell won't hold a stone, just that it doesn't.
- **Movement oscillation.** Found via a real game's downloaded action log
  (`js/action-log.js` — see Runtime Track note below): the bot ping-ponged
  between two hexes every single turn from turn ~4 onward, never casting,
  placing, or exploring again for the rest of the game. Root cause: the two
  hexes were *exactly* equidistant (151px) from the only remaining reachable
  unrevealed tile, so `moveExploreGradient`'s distance-closed term scored
  both directions identically — a true tie with nothing to break it. Fixed
  (v1) with `moveRevisitPenalty`: a small rolling history (`_recentPositions`)
  that penalizes stepping back onto a recently visited hex.
- **Movement oscillation, round 2 (v1's fix was incomplete).** A second
  downloaded action log showed the SAME 2-hex ping-pong still happening —
  now 5 round-trips inside a single turn. v1's penalty was a flat "is this
  hex anywhere in the last N visited?" check; in a clean A↔B cycle, once
  the window fills, BOTH A and B are simultaneously "recently visited," so
  every candidate gets the identical penalty and the tie comes right back.
  Fixed by weighting the penalty by recency instead of applying it flat —
  `revisitPenalty()` divides `moveRevisitPenalty` by how many steps ago that
  exact hex was visited, so "undo the move I just made" (1 step ago, full
  penalty) is now punished far more than "revisit somewhere from 3+ steps
  back" (partial penalty). A strict 2-cycle only ever has one way to
  "continue the cycle" — reverse the immediately previous step — so this
  directly and specifically kills it, whereas v1's flat check could not.
  `_recentPositions` window widened 4 → 6 to also dampen slightly longer
  (3-hex) cycles, though only the recency-decay actually fixes 2-cycles.
- **Doomed piecemeal placeStone loop (found post-Stage-2, via BotArena batch
  runs — not a single-bot test).** `castAlreadyWon` (above) only guards the
  `cast` action; `scoreAction()`'s `placeStone` case never got the same
  treatment, and the anchored `_plan`/`makePlan()` system's own credit gate
  (skip planning a scroll whose element is already activated or whose source
  pool is empty) only protects placements made THROUGH a plan. Both the
  greedy fallback and the default hybrid-search path pull candidates
  straight from `BotState.legalActions()`, which enumerates a `placeStone`
  for every missing cell of every pattern variant with no win-credit
  awareness at all — so once `_plan` is null (the common case: only ~5 plan
  cycles happened in a 200-turn game), the bot can feed stones one at a time
  into a pattern that can never be cast for credit, forever, since no single
  isolated placement is penalized enough to lose to `move`/`endTurn`.
  Reproduced via `BotArena.run()`: a 200-turn game deadlocked as a draw with
  one side stuck at 0/5 elements the entire game, having taken 228
  `placeStone` actions and zero `cast` actions — 178 of them piling stones
  into an already-won `WIND_SCROLL_5` pattern that could never grant credit
  again. Fixed with `hasWinCredit(snap, scrollName)` (mirrors `makePlan()`'s
  credit calc: catacomb credits per unactivated component with no
  source-pool guard; single-element scrolls need the element unactivated AND
  a non-empty source pool) and a hard veto (`placeNoCredit: -500`, same
  magnitude/philosophy as `placeDoomed`) applied in BOTH `scoreAction()`'s
  `placeStone` case and `searchPick()`'s root + every recursive ply (via
  `creditFilter()`) — greedy and search shared the vocabulary
  (`BotState.legalActions()`/`BotSim.legalActions()`) but not, until now, the
  credit awareness. Confirmed on the exact reproducing seed: 200-turn draw →
  42-turn decisive win, 0 further placements toward the dead pattern.
- **Per-bot memory was shared across ALL bot players, not scoped per
  player — the actual "trapped in loops" bug (found from a real user's
  downloaded 2-bot-vs-2-bot action log, not a synthetic repro).** `_plan`,
  `_recentPositions`, `cellFailCount`, and `cursedCells` were single
  module-level variables in `bot.js`. That's fine for `bot-driver.js` (real
  multiplayer — one browser tab only ever drives ONE bot identity), but
  `bot-arena.js`'s local hot-seat and spectate modes drive MULTIPLE bot
  players through this SAME module instance, one turn at a time,
  alternating — exactly the setup behind the cheat panel's "watch bots
  play" feature that produced the user's log (two players, both
  `isBot:true`, single page). Every time turns switched, Player A's
  `_recentPositions` (etc.) got silently overwritten by Player B's moves
  and vice versa, so a player's own "don't reverse your last move"
  anti-oscillation signal was really "don't go where the OTHER player just
  was" — corrupting the recency-decay tie-breaker into effective noise.
  The user's log showed the visible symptom: an identical 6-hex
  hub-and-spoke movement path (always returning to one fully-explored
  central tile) repeated turn after turn, forever, for both bots
  independently — a stable N-hex cycle exactly at the anti-oscillation
  memory's own window size (`RECENT_POS_LIMIT = 6`), which a
  recency-decay penalty tuned for clean 2-hex ties cannot break (it rotates
  in lockstep with the cycle instead of creating the asymmetry needed to
  escape). Fixed by keying all four pieces of state behind a `mem(playerIndex)`
  accessor, threaded through every read/write site (`scoreAction`,
  `makePlan`/`planValid`/`planNextAction`, `searchPick`, `rankActions`,
  `botAct`, `botTurn`, `resetMemory`). Also added a second, coarser safety
  net: `botTurn()` now records each turn's exact move sequence and compares
  it to that SAME player's previous turn; if identical twice in a row,
  `botAct()` skips movement entirely for one turn (takes the best non-move
  action, or just ends the turn) — a circuit breaker for any future
  N-hex-cycle class of bug the recency-decay penalty still can't catch,
  self-clearing after firing once. Verified: the exact 6-hex repeat pattern
  is gone across two fresh 15-game arena batches (0 occurrences), and the
  circuit breaker itself fired 7 times in one batch, correctly picking
  `placeStone`/`breakStone`/`cast`/`endTurn` over continuing to wander.
  **No-backtrack rule (2026-09-29, owner's game 858).** Pacing was still
  6% of bot turns (4-bot trace: 43 of 695). Two causes: the blocked-shrine
  pull skipped only the shrine the bot already stood next to, so another
  blocked shrine pulled it away and the first pulled it back (now: next to
  one = stay and break it); and plan routes over free wind stones bouncing
  between equal-cost hexes. Hard rule in bot.js `noBacktrack()` /
  `turnSeen()`: within one turn a bot never moves back onto a hex it already
  stood on until the board changes (stones, pool, elements, hand); applied
  to greedy, search and MCTS roots and to plan steps. Not a weight, never
  trained. After: 2 pacing turns in the same games, 2-player set unchanged
  (23/24 wins).
  **Intentions (2026-09-29, owner: "weigh a choice, then commit").** The goal
  a bot's greedy move served (shrine, hidden tile, blocked shrine, home,
  camp or break spot) is kept in `mem.intent` across turns; scoreAction adds
  `moveCommit` (0.35, trainable) x that goal's pull, so a rival goal must beat
  it by about a third. Dropped when reached or after `INTENT_TURNS` (6) own
  turns. Bot Mind says "Sticking with my goal". 4-bot games 115 -> 94 turns
  on average (same seeds), 2-player 23/24 wins. Pattern plans (makePlan)
  already commit on their own.
  **Attack plans (2026-09-29).** `reviewPlan()` once per own turn: a
  building plan gives way to an attack plan (makePlan `{only: attackTools,
  near: 4}`, anchors up to 4 steps away, a step costing like a missing stone)
  only when it scores more than the current plan x (1 + moveCommit); an
  attack plan is dropped after 2 own turns with no target it would hurt.
  Attack build credit now grows with push squared (x4 against a leader who
  can win next turn). Audit (6 four-bot games): attack plans were already
  kept until cast or until the scroll was taken; the real gap is having the
  right attack scroll in reach (3 of 341 turn reviews). Level-1 counters
  are built only in guard mode (alertOn), so Iron Stance was almost never
  built; Psychic answered 12 of 12 chances. `BotSystem._review` = counters.
  **Wider plan search (2026-09-29, owner: "look further for built and
  partial patterns").** makePlan tries pattern centres up to `PLAN_REACH` (8)
  steps away, not only the pawn's hex. One pass builds a board table (can
  hold a stone? which stone is there?) so each check is O(cells); stones
  already on the board (anyone's) count 10 each, a step costs like a missing
  stone (planDeficitPenalty), the best 6 are re-scored with the real path
  cost. A finished pattern elsewhere is a plan with nothing missing: walk
  there and cast. Result (same seeds): 4-bot games 95 -> 75 turns, 6/6 won
  (was 5/6); of 114 plans 83 were away from the pawn, 110 stones reused, 16
  already finished; 2-player 23/24 wins, much shorter. `BotSystem._planStats`.
  **Side counter and guard post (2026-09-29, owner: "I set up a counter
  while I'm setting up something else").** With a leader at push 2+ and Iron
  Stance / Psychic in reach, a plan centre where the counter shape also fits
  (no clashing cell) gets SIDE_COUNTER_BONUS (8) + 3 per counter stone already
  there; `sideStep()` places counter stones the main shape does not need
  when they are in range. Guard post: when someone is one cast from winning
  (guardWanted) and no counter is ready, reviewPlan makes a counter-only plan
  (makePlan `extra` sources, 4 steps); a finished level-1 plan is not cast:
  the bot stands on its centre and ends the turn with the AP kept, at most
  GUARD_WAIT (3) own turns, then GUARD_REST (3) turns of own progress. Not
  when the bot is one cast from winning itself. The wider plan search had
  cut Psychic answers 12 -> 0 (bots always had a plan, so the old greedy
  guard placement never ran); now 3, and 2-player 24/24 wins, ~41 turns.
  **Travel shortcuts (2026-09-29, owner: "use Freedom, catacomb tiles and
  Take Flight to move to good locations").** Every plan walk (to a cell, a
  collect shrine, the anchor) goes through `travelStep()` -> `shortcut()`:
  teleport now (catacomb, or any shrine centre under Freedom; from
  legalActions), walk to a catacomb first then teleport, or cast Take Flight
  on itself (2 AP, BotSim.castChoices landings), taken when it saves at least
  2 AP. A plan's Take Flight cast does not end the plan. Greedy teleports score
  TELEPORT_AP_VALUE (12) per AP saved toward the intention or home. Makes
  plans reach far anchors. Test: 43 teleports in 6 four-bot games; Arson
  casts 6 -> 9, Plunder 1 -> 3, Iron Stance answers 0 -> 6. The game's own
  activate check (checkPatternForPlayer) is the same rule makePlan's board
  table applies; not called directly because it logs every cell.
  `BotSystem._shortcutStats`.
  **FIXED — the within-turn oscillation was a hybrid over-trigger.** A
  related but distinct *within-turn* oscillation surfaced in the same
  batches: hybrid search stayed engaged for an entire turn whenever ANY
  `placeStone` candidate was technically legal, and `searchPick()`'s
  movement choices don't share the plan/path discipline that keeps greedy
  exploration coherent — the same "FULL search LOST its series 1-3-4 —
  always-on lookahead's movement choices fight the plan/path logic" finding
  resurfacing via hybrid firing more broadly than intended. The trigger had
  already been narrowed once (excluding `scroll:null` tactical placements),
  but still fired on NO-WIN-CREDIT scroll placements — and `legalActions()`
  enumerates a placeStone for every missing cell of every pattern variant
  with no credit awareness, so a pattern for an already-activated element
  (or one whose source pool is empty) stays "legal" forever. `creditFilter()`
  already drops those INSIDE the search, so triggering on one just left
  search doing move-only lookahead — precisely the wandering. Fixed by
  gating the trigger's placeStone clause on the same `hasWinCredit(snap,
  a.scroll)` the filter/scorer already use (`bot.js` botAct hybrid branch):
  `useSearch = legal.some(a => a.type === 'cast' || (a.type === 'placeStone'
  && a.scroll && hasWinCredit(snap, a.scroll)))`. Now a state whose only
  "tactical" options are hopeless placements falls through to the disciplined
  greedy plan/path movement instead of engaging search. Strict narrowing —
  genuine cast/credit-bearing decisions still search exactly as before.
  Verified headless: 2 full 2p games stay decisive (46/34 turns) with zero
  page errors, and hybrid stays SELECTIVE — 17 search decisions vs 216 greedy
  across the two games (search neither disabled nor always-on). Still worth a
  larger A/B (search-narrowed vs prior) once R5 makes games cheap.

All six found by literally running the bot (single-bot loops via
`window.BotSystem.turn()`/`.step()`, bot-vs-bot batches via
`BotArena.run()`, or a real user's downloaded action log) and inspecting
`snapshot()`/`rank()`/action logs between turns — cheaper and more
revealing than reasoning about the scoring code in the abstract. Worth
repeating before investing further in Stage 2.5/3a: structural bugs like
these make weight-tuning or lookahead search pointless (a smarter search
over a broken scorer just finds the same bugs faster), and some (like the
per-player memory bug) only surface with MULTIPLE bots sharing one browser
tab, not single-bot or single-turn inspection.

**Opponent-threat evaluator (added later, same "run it and look" method).**
`evaluateSnapshot()` was purely self-referential — zero awareness of
opponent state. Added `opponentProgress()` (mirrors the bot's own
activated+home-distance terms for every OTHER player, MAX across opponents)
and `commonAreaThreat()` (flags a live common-area scroll any opponent's
CURRENT board could cast, via `BotSim.checkPattern(snap, scroll,
playerIndex)` — parameterized for any player already, just never used for
this). Surfaced a real bug while building it: `bot-sim.js`'s `simDiscard()`
never modeled common-area REPLACEMENT (one scroll per element, old one
bumped to deck bottom — see `discardToCommonArea()` in game-core.js) — it
just pushed onto an unbounded array, so a simulated denial discard could
never actually register as removing the threat. Fixed alongside. Verified
behaviorally, not just numerically: a constructed scenario (opponent's board
satisfies a common scroll; bot holds a dead-to-it scroll of the same
element) makes `searchPick()` choose the denial discard when the terms are
live, and a plain move when they're zeroed — confirming the term changes
real decisions. 30-game A/B arena batch (same seed, weights live vs.
zeroed): draws/avg-turns statistically identical (12-13-5 / 69.3 vs.
13-12-5 / 70.2) — no regression.

**Related finding, NOT fixed (separate from the above): response-only
(level-1) scrolls can permanently clog a common-area slot.** Neither bot can
ever cast (blocked by rule — level-1 is response-only) or respond (blocked
by `response-window.js`'s `isBotPlayer()` hard-exclusion) with one — the
existing `discardResponseOnly` nudge gets it out of hand, but the common
area it lands in then has nothing to ever displace it again. Confirmed via
log inspection of a real drawn arena game: two elements' common-area slots
each got stuck holding a level-1 scroll for the last ~30% of a 200-turn
game while every other element's slot kept churning normally — a real,
verified contributor to draws, independent of and pre-dating the
opponent-threat work above. Real fix is full response-scroll support (below,
step 3, not started).

---

## STAGE 1.5 — Multiplayer bot player (DONE — contract reference)

A bot is an ordinary `players` table row whose username starts with
`window.BOT_USERNAME_PREFIX` ('🤖'). Host-only lobby buttons "🤖 Add Bot" /
"➖ Remove Bot" (`addBotPlayer()`/`removeBotPlayer()` in lobby.js) insert/
remove rows (`is_ready: true`) — any number up to the room's 5-player cap,
each named `🤖 Bot N`. Because each is a real row it counts everywhere:
player count, Start-button condition, index/color assignment,
`totalPlayers`, turn order. `bot-driver.js`'s watcher drives whichever bot
is active off a live-queried index set, so multiple bots needed no driver
changes — all bots share whatever champion weights `WEIGHTS` currently
holds (see the Supabase persistence work in `js/bot.js`).

The HOST's browser is the bot's client (`js/bot-driver.js`): a 700ms watcher
notices bot turns and IMPERSONATES the bot — temporarily reassigning the
shared lexical bindings `myPlayerIndex` and `playerColor` — so every existing
`isMyTurn()` / `canTakeAction()` / broadcast path identifies as the bot. The
driver resets the bot's AP at turn start (the turn-change handler only resets
the local player's), places the bot's player tile during the placement phase,
and force-ends stuck turns as a safety net.

Keep-alive: the host heartbeats bot rows' `last_seen`; the disconnect sweep
skips `isBotUsername()` rows.

The bot does NOT need a separate Supabase login/session. Its `players` row IS
its identity; all in-game sync is broadcast-based and keyed by
`activePlayerIndex` (`syncPlayerState` → 'player-state-update'), which
impersonation satisfies. Anything actually keyed by `myPlayerId` (heartbeat,
ready flag) is lobby plumbing the host handles on the bot's behalf.

Async cast machinery: `BotSystem.waitForQuiescence()` runs between bot
actions. It (a) auto-resolves cascade prompts by clicking `#cascade-popup`
buttons (prefers "To Active"), (b) cancels scroll selection modes
(`scrollEffects.selectionMode`, `window.takeFlightState`) the bot can't
drive, and (c) waits out the multiplayer response window
(`spellSystem.responseWindow.isResponseWindowOpen`, ~15s) so the stack
resolves while the bot is still impersonated. Legality guards in
bot-state.js mirror the UI: casts need ≥2 AP, stone placements must pass
`isInPlacementRange()`.

v1 limits (acceptable, fix opportunistically): bots never play response
scrolls; selection-mode scrolls are cast but their optional targeted effect is
cancelled; the host's HUD mirrors the bot while it acts.

**FIXED (was a v1 limit):** bot hand/active overflow at end of turn used to
surface `showEndTurnOverflowModal()` on the host's screen. That modal is
fire-and-forget (not awaited), so `asBot()`'s `finally` restored the host's
real identity *before* the modal resolved — the host then saw their OWN
scrolls (not the bot's) in the Hand/Active panels, and discarding them never
reduced the bot's overflow (`getPlayerScrolls(false)` is keyed on
`activePlayerIndex`, still the bot), so the banner's End Turn button stayed
disabled forever and the game stalled. Fixed by giving the bot a
`discardScroll` action (Stage 0 vocabulary, above) and gating
`legalActions()`/`botAct()` so the bot discards down to capacity BEFORE ever
clicking End Turn — the modal now never appears for a bot turn.

---

## RUNTIME TRACK — moving bot execution off the host browser

Motivation: today the host's browser is both a human client and the bot's
runtime (impersonation swaps `myPlayerIndex`/`playerColor`). That's fine for
dev but means a bot game requires a human host tab to stay open, and any host
UI bug can leak into bot turns. The fix is layered, not a rewrite — Stage 0's
contract (`BotState.snapshot/legalActions/applyAction`) already IS the seam;
these stages move what sits on each side of that seam without touching
`bot.js` scoring logic.

### R1 — Audit the driver is a pure adapter (DONE)
Audited `js/bot-driver.js`. Turn-driving (`asBot`, `driveBotTurn`, the watcher)
was already clean — detect, snapshot, `BotSystem` decision,
`BotState.applyAction()`, restore identity, no leaked strategy.

One real leak found and fixed: the placement-phase path
(`pickBotTilePosition()` + `placeBotTile()`) implemented an actual heuristic
(place adjacent to the tile cluster, closest to centroid) directly in the
driver, and executed it by calling `placeTile()`/`broadcastGameAction()`
directly, bypassing `BotState.applyAction()` entirely — the only path in the
whole driver that did. Fixed by adding `placeTile` to the Stage 0 vocabulary:
`bot-state.js`'s `legalActions()` now enumerates candidate hexes during
placement phase (`placementCandidates()`), `bot.js` scores them
(`placeTileBase`/`placeTileCentroidPenalty` weights — same "closest to
centroid" preference, now tunable), and `applyAction()` executes the chosen
one. `bot-driver.js`'s `placeBotTile()` is now just `asBot(botIndex, () =>
window.BotSystem.step())`, identical in shape to `driveBotTurn()`.

### R2 — One backend path for move validation (DONE, shadow-mode)
Deployed a Supabase edge function (`validate-end-turn`, project
`lovybwpypkaarstnvkbz`) that accepts `{gameId, playerIndex}` and checks it
against `game_room.current_turn_index` — the first real server-held-state
check, scoped to one action type (`endTurn`) as the roadmap intended.

**Prerequisite discovered mid-implementation:** `game_room.current_turn_index`
existed as a column but was only ever written at game start/reset and at
game-end (winner display) — never during actual turn-to-turn play, which runs
entirely on the `broadcastGameAction` realtime channel and never touches the
DB. A validator checking a column nobody updates mid-game would be validating
against permanently stale data, so this had to be fixed first: added
`persistCurrentTurnIndex(playerIndex)` (`js/lobby.js`, next to
`broadcastGameAction`) and wired it into all four `turn-change` broadcast
sites (`js/game-ui.js` ×2 — the overflow-modal and non-overflow endTurn
paths — and `js/game-core.js` ×2 — placement-phase advance and the
turn-timeout kick handler). It's an additive fire-and-forget side write; if it
fails, only a console warning fires, nothing about turn-passing itself
changes.

**Current wiring is shadow-mode only, as the roadmap specified** ("proof of
path, not a full rewrite"): `js/game-ui.js`'s end-turn click handler calls
`supabase.functions.invoke('validate-end-turn', ...)` with the OLD
`activePlayerIndex` (the player who's ending their turn) right before
advancing state, and only logs the result (`console.log` on agreement,
`console.warn` on disagreement) — it never blocks or gates ending the turn.
Verified end-to-end in the browser: correct CORS handling (edge function
needs an explicit `OPTIONS` handler — Supabase functions don't add this for
you), correct `legal:true`/`legal:false` responses against a real
`game_room` row, and correct client-side logging for both cases.

**Not yet done, deliberately deferred to R3:** nothing actually enforces the
validator's answer, and only `endTurn` is covered. R3 extends this to real
enforcement across the full action vocabulary.

### R3 — Backend-authoritative validation (TODO)
Extend R2's edge function to cover all action types in the Stage 0 vocabulary
(`cast`, `placeStone`, `move`, `endTurn`). Once the backend can independently
recompute "is this action legal from this snapshot," the browser's role
shrinks to rendering + input capture; illegal actions get rejected
server-side instead of trusted client-side. Do this incrementally per action
type — ship each one behind the others still being client-trusted.

### R4 — Replace host-browser impersonation (TODO)
Once R3 is solid, bot turns no longer need a browser pretending to be the
bot: the backend can call the same validated action path directly using the
bot's `playerIndex`, driven by a scheduled/triggered function instead of
`bot-driver.js`'s 700ms watcher. At this point `bot-driver.js` can be
deleted — its job (impersonate, apply, restore) no longer exists once the
backend applies bot actions directly.

### R5 — Server-side bot execution + bot-vs-bot (TODO)
Run `bot.js`'s `scoreAction()`/pick logic inside the backend function/service
(same pure code, new host environment — Node or a Supabase edge function).
Once no human browser is required to drive a bot, two bot players can play
each other with zero open tabs. This unlocks self-play at scale for Stage 3a's
arena (`js/bot-arena.js`) to run server-side instead of in a suppressed page.

**Sequencing relative to the Strategy Track:** R1–R5 can run interleaved with
Stages 2/3 at any point — they don't depend on each other. Recommended order
if working both: do R1 (cheap audit) any time, R2 next real backend step,
then pick up whichever track has more immediate value (smarter bot vs. bot
independent of host browser).

**Do NOT** attempt R4/R5 before R2/R3 land — moving execution backend-side
before the backend can validate actions just relocates the trust problem
instead of fixing it.

---

## STAGE 2 — Forward model + lookahead (DONE except optional MCTS)

Goal: `simulate(snapshot, action) → snapshot'` as PURE functions (no DOM, no
globals), then search. Steps 1–4 below are DONE; step 5 (MCTS) is optional
and not started.

1. **`js/bot-sim.js` (DONE)** — `window.BotSim = { simulate, legalActions,
   isTerminal, winner, checkPattern, canMoveTo, grid, diffSnapshots, validate,
   SIMULATED_SCROLLS }`. Input/output is exclusively the Stage-0 snapshot
   JSON; the only globals read are static `SCROLL_DEFINITIONS` (and, inside
   `validate()` only, the live BotState/BotSystem). Includes a PURE
   `legalActions(snap)` mirror of BotState's (search needs to enumerate from
   SIMULATED states) and a pure movement-cost model (earth block, wind free,
   water chaining flood fill, void nullification, other-player occupancy).
2. **Simulated actions (DONE)**: `move` (incl. tile reveal as
   `shrineType:'unknown'` — never invents the element; reveal draw goes to
   HAND even past capacity, matching the real pending-cascade behaviour),
   `endTurn` (rank-based shrine collection capped by source/pool; turn
   advance in COLOR_RANK order; AP reset to 5 + void stones), `placeStone`
   (pool decrement + the fire-destruction interaction rules),
   `discardScroll`, and `cast` (AP, hand→active, win-condition activation
   incl. the empty-source-pool rule and catacomb component elements are
   EXACT; the effect itself is whitelist-gated: scrolls not in
   `SIMULATED_SCROLLS` — currently all of them — are recorded in
   `snap.sim.unsimulatedCasts` instead of pretended-simulated).
3. **Validation harness (DONE)** — `BotSim.validate({actions, seed, policy})`
   runs in a live game: picks seeded random (or ε-greedy 'builder') legal
   actions, predicts each with `simulate()`, applies it for real via
   `BotState.applyAction`, diffs predicted vs settled real snapshot.
   Measured (tutorial board, headless Chromium): move 0/550+, endTurn 0/120+,
   placeStone 0/60+, discard 0/9 — 0% divergence, target was <1%. Cast
   effect side-effects divert as designed and are counted "accepted".
   A second mode mirrors the REAL bot's own action stream (plan builds +
   casts included) by wrapping `BotState.applyAction` — see the Playwright
   driver pattern in the session notes below.
4. **Search, within one turn only (DONE)** — `searchPick()` in bot.js:
   depth-limited beam search (`WEIGHTS.searchDepth` plies,
   `WEIGHTS.searchBreadth` children per node) over own-turn actions; an
   endTurn edge is a leaf. Leaves valued by `evaluateSnapshot()` (bot.js),
   all knobs in `WEIGHTS.eval*`. Wired exactly as planned:
   `WEIGHTS.searchDepth > 0 ? searchPick() : greedyPick()` — **default is 0
   (greedy)** until the Stage-3a arena can measure the acceptance criterion.
   Enable from the console (`BotSystem.WEIGHTS.searchDepth = 3`, ≈10ms per
   decision on the tutorial board) or via the cheat panel (click the HUD
   "AP" label 5×): **Bot Brain** cycles Dumb (greedy) → Smart (search every
   action) → Hybrid (`WEIGHTS.searchHybrid`: search only when a cast or
   stone placement is among the legal actions; plain movement stays greedy).
   Persisted in `localStorage['godaigo_bot_brain']`, applied by bot.js at
   load — and it deliberately overrides evolved weights.
5. **Multi-turn MCTS (optional, not started)**: UCT over turns; unknown
   face-down tiles and opponent hands are DETERMINIZED — sample K plausible
   completions (uniform over the unseen tile-deck distribution), run the
   search per sample, majority-vote the root action. K=8 is plenty.
   Rollout policy = Stage-1 greedy.

Acceptance — MEASURED (BotArena, 2×10 games, seeds 11/23, alternating
sides): **HYBRID search beat greedy 12-3 with 5 draws** (80% of decided
games; 60% counting draws as non-wins) → default flipped to hybrid
(`searchDepth: 3, searchHybrid: 1`). **FULL search LOST its series 1-3-4**
— always-on lookahead's movement choices fight the plan/path logic; do NOT
enable `searchHybrid: 0` by default without new evidence. Caveat: 20 games,
not the spec's 100 — rerun at scale once R5 makes games cheap.

**Gotchas found while building Stage 2 (all fixed, don't re-break):**
- `getAllHexagonPositions()` also emits **trapezoid bridge hexes** at
  large-tile offsets `(±2,0),(0,±2),(-2,2),(2,-2)` wherever ≥2 tiles'
  trapezoids coincide — hidden tiles contribute too, and landing on one
  reveals them. A grid model without these misses real moves AND reveals.
- `castSpell()` opens a "Select Scroll to Cast" popup when several scrolls
  match at once, and previously `BotState.applyAction('cast')` returned
  `ok:true` while the cast silently no-opped — the bot then looped on it.
  applyAction now clicks the requested scroll's button (or reports failure).
- A state evaluator must NOT credit AP across a simulated endTurn
  (`snap.sim.turnsEnded`) — in single-player the activePlayerIndex doesn't
  change, so the AP reset otherwise makes passing the turn look like free
  value and the search ends every turn instantly.
- The flat heuristic for unsimulated cast effects must only count casts that
  granted a NEW activation (`unsimulatedCasts[].grantedNew`), or the search
  farms the flat value by re-casting an already-won scroll — the same
  infinite-recast loop Stage 1's `castAlreadyWon` fixed for greedy.
- Reveal-drawn scrolls go to the hand even when it's full (pending cascade);
  catacomb reveals also grant +1 AP, which is unknowable pre-reveal and is
  an accepted, documented divergence.

---

## STAGE 2.5 — Scroll-effect usage (TODO — sequenced AFTER 3a)

The bot casts scrolls but wastes their power: selection-mode effects are
cancelled (`waitForQuiescence` cancels any `selectionMode` /
`takeFlightState` it can't drive), response scrolls (level 1) are never
played, and the Stage-2 simulator treats all effects as unknown. Weight
evolution (3a) CANNOT fix any of this — a weight can't pick a Telekinesis
target. This stage adds the missing capability. Build 3a FIRST: every
increment below must be A/B-measured in the arena (with vs. without),
otherwise there is no way to tell whether effect-driving actually wins games.

Build order (each step independently commit-able and arena-measurable):

1. **Inventory the choice space (DONE — see § CHOICE-SPACE INVENTORY below).**

   **Two real gaps found while inventorying (fix opportunistically, not
   blocking step 2):**
   - `EFFECT_MODAL_IDS` (scroll-effects.js line ~87) is missing
     `'transmute-modal'`. `waitForQuiescence()`'s modal-detection and
     `cancelSelectionMode()`'s cleanup sweep both key off this list, so a
     Transmute modal opened by a bot cast is neither detected nor ever
     cleaned up — the same class of "modal lingers for the rest of the game"
     bug the `EFFECT_MODAL_IDS` mechanism was built to prevent for every
     *other* modal-only effect.
   - Two effects are **drag-based**, not click-based (Telekinesis,
     Take Flight's destination step): no `handleTileClick`/`handleHexClick`
     to call directly like the other nine. Driving these needs either a
     synthesized drag/drop sequence or a new programmatic entry point
     exposed by scroll-effects.js (mirroring how `BotState.applyAction()`
     already calls into game functions directly rather than faking DOM
     events) — decide which before starting these two; the other eleven can
     be driven by calling their `handleXClick`/modal-button `onclick`
     directly.

2. **`js/bot-effects.js` — `window.BotEffects.driveSelection()` (DONE, first
   increment) + `driveTransmute()` (DONE):** when a selection mode opens
   during a BOT cast, enumerate the valid choices via the game's own
   selection APIs (never reimplement validity — calls
   `selectionMode.handleTileClick(tile)` etc. directly, or clicks the real
   modal button/card a human would), score with a small independent
   `elementNeed()` heuristic (same shape as `bot.js`'s `shrineValue()`, kept
   separate since this file doesn't share bot.js's closure), and apply the
   best one. Wired into `waitForQuiescence`: checks for the Transmute modal
   first (`driveTransmute()` — no `selectionMode` object exists for it),
   then tries `BotEffects.driveSelection()` for everything else, falling
   back to today's cancel for scrolls neither one knows.

   **Driven so far:** tile-flip (Heavy Stomp EARTH_SCROLL_4, Call to
   Adventure CATACOMB_SCROLL_3 — prefers flipping a hidden tile over hiding
   a revealed one), scorched-earth (Combust CATACOMB_SCROLL_10 — targets the
   tile with the most stones), tile-swap (Shifting Sands EARTH_SCROLL_2 —
   picks the two closest eligible tiles), Create (VOID_SCROLL_5 — most-needed
   element), Scholar's Insight (VOID_SCROLL_2 — most-needed element's deck,
   then highest-level scroll in it), Transmute (FIRE_SCROLL_4 — discards its
   most-plentiful stone type for AP up to a target, then clicks Done),
   Quick Reflexes (CATACOMB_SCROLL_9 — most-needed element's level-1 scroll
   from the pooled list), Sacrificial Pyre (FIRE_SCROLL_3 — sacrifices a
   response-only hand scroll first, else the lowest-level one), Inspiring
   Draught (WATER_SCROLL_3 — draws from the most-needed element's deck,
   puts back the weaker of the 2 drawn scrolls using the same
   response-only/lowest-level rule as Sacrificial Pyre), Wandering River
   (WATER_SCROLL_4 — tile closest to the caster, then most-needed element),
   Arson (FIRE_SCROLL_5 — targets the opponent closest to winning, most
   activated elements tie-broken by pool size, then destroys the element
   they hold the most of), Plunder (CATACOMB_SCROLL_8 — same "biggest
   threat" opponent-targeting as Arson filtered to those with a plunderable
   active scroll, then takes their highest-level active scroll, opposite of
   Sacrificial Pyre/Inspiring Draught's "give up the weakest of MY OWN"
   logic). Arson/Plunder share a new `rankedOpponents(filterFn)` helper.
   Plunder's scroll-pick step shares `scroll-select-modal` with Sacrificial
   Pyre and Inspiring Draught's put-back step — routed by the exact heading
   text each effect's `showScrollSelectionModal()` call sets, verified not
   to cross-contaminate. Wandering River's tile-pick and element-pick steps
   are split across a `selectionMode.type` switch case and a separate
   `element-select-modal` DOM check — needed an explicit "is the element
   modal already open" guard in the tile-pick driver, since
   `selectionMode.type` stays `'tile-element-change'` through BOTH steps
   (only clears once the element is chosen) and the switch always runs
   before the modal-check chain, so without the guard it would re-click a
   tile (destroying and recreating a fresh element modal) every polling
   tick forever instead of ever reaching the element driver.
   Verified against a real running game (direct `enterX` invocation, not a
   full pattern-satisfied cast — same testing style used for the earlier
   3 effects): Wandering River completes both steps and applies the buff;
   Arson correctly targets the bigger threat and destroys their largest
   stockpiled element; Plunder correctly skips a target with nothing to
   plunder, targets the one with an active scroll, and moves it to the
   common area. 10-game arena regression shows no errors.

   **Control the Current (WATER_SCROLL_5) — DONE, but needed a
   `waitForQuiescence()` change, not just a driver.** A genuinely different
   SHAPE of problem from every other effect here — see the
   "architecturally different" note in `bot-effects.js`'s own header
   comment: it's a persistent whole-turn ability with no "Done" button
   (`selectionMode.type: 'water-transform'`), meant to coexist with the
   rest of the bot's turn (opportunistically transform an adjacent water
   stone while moving), not a one-shot pick. `waitForQuiescence()`
   previously cancelled ANY selectionMode `driveSelection()` couldn't act
   on — for this persistent mode that would have prematurely ended the
   effect's whole-turn duration the instant no water stone happened to be
   adjacent yet, discarding any benefit from moving toward one later.
   Fixed with a targeted exception in `bot.js`'s `waitForQuiescence()`:
   when `driveSelection()` returns false AND `selectionMode.type ===
   'water-transform'`, treat it as quiescent (just `return`) instead of
   calling `cancelSelectionMode()` — every other undriven selection still
   gets cancelled exactly as before. `driveWaterTransform()` itself
   recomputes eligible stones FRESH via `se.getAdjacentWaterStones()` on
   every call rather than trusting `selectionMode.highlightedStones` —
   that cache is only refreshed by `placePlayer()`'s move branch
   (game-core.js), which `bot-state.js`'s `move` action bypasses (it
   mutates position directly instead), so trusting the cached list would
   have silently missed stones that became adjacent after a bot move.
   Actual cleanup when the effect's duration ends is unchanged — the
   existing `clearTurnBuffs()` (`scroll-effects.js`, called on End Turn)
   already tears down the selectionMode, this fix just stops something
   ELSE from doing it prematurely.
   Verified against a real running game: casting it with no water stone
   adjacent — `waitForQuiescence()` returns in ~1ms (not the 25s timeout,
   not a cancel) and the selectionMode survives; placing a water stone
   adjacent afterward — the NEXT `waitForQuiescence()` call correctly
   drives the transform and the selectionMode stays active for further
   opportunistic use; simulating End Turn's `clearTurnBuffs()` correctly
   clears it. 10-game arena regression shows no errors.

   **Excavate, Take Flight, and Telekinesis — DONE. Stage 2.5's full
   choice-space inventory is now covered end to end.**

   Excavate (CATACOMB_SCROLL_4) turned out to be misfiled in earlier notes
   as "drag-based" — it never was. Its deferred teleport (fires at the
   start of the caster's next turn via `processExcavateTeleport()`) is a
   2-step flow identical in shape to everything else here:
   `excavate-teleport-modal` ("Teleport"/"Stay Here" — always take it,
   free repositioning with no downside) then a `handleHexClick(hexPos)`
   selectionMode exactly like tile-flip/tile-swap. Candidate hexes come
   from `BotState.hexGrid()`, filtered to the SAME rule
   `handleHexClick()` itself enforces (revealed non-player tile, no
   stone, no player); heuristic picks the candidate closest to whatever
   the bot's next objective already is (home if all 5 activated, else the
   nearest hidden tile). Can't land ON a player tile at all — excluded by
   the game's own check — so unlike catacomb/Freedom teleport this can
   never double as a direct win.

   Take Flight (WIND_SCROLL_4) and Telekinesis (VOID_SCROLL_4) genuinely
   ARE drag-only at the UI layer — no `selectionMode.handleXClick()` or
   `onComplete(x,y)`-style API covers the actual move, unlike every other
   effect here. Rather than simulating raw mouse drag events (fragile,
   timing-dependent, and the antithesis of "never reimplement game
   rules"), both drivers call the EXACT SAME functions the real drop
   handler calls, in the same order — just triggered directly instead of
   via a mouseup event:
   - **Take Flight**: `take-flight-player-modal` (pick a target — v1
     ALWAYS targets self; self-targeting is a downside-free "teleport
     anywhere unoccupied," since the scroll just stays in the caster's
     active area, while opponent-targeting has a real tradeoff — denial
     value vs. handing them a scroll — deliberately left unscoped rather
     than guessed at) then the drag completion:
     `window.takeFlightState.onComplete(x, y)` alone only finalizes
     scroll disposition/broadcast — it does NOT move the pawn. The real
     drop handler (`game-ui.js`) calls `placePlayer()` (self) or
     `movePlayerVisually()` (opponent) FIRST, then `onComplete()` —
     `driveTakeFlightDrag()` mirrors both calls. Any hex works as a
     destination (no revealed/tile-type restriction, unlike Excavate),
     so a direct teleport home is legal and correctly wins via
     `placePlayer()`'s own `checkWinCondition()` once all 5 elements are
     activated.
   - **Telekinesis**: no target-picker modal — goes straight into drag
     mode. The pickup/drop pair is `startTileDrag(tileId, event)` (removes
     the tile from `placedTiles` + DOM, exactly what a human's mousedown
     does) then `placeTile(x, y, rotation, flipped, shrineType, false,
     false, tileId)` with the SAME tile id (re-adds it at the new
     position) — `findNearestSnapPoint()` already enforces the "must
     touch 1 other tile" rule internally whenever
     `window.telekinesisState.active` is true, so no extra validation
     logic was needed there. The move-counter/broadcast bookkeeping the
     real mouseup handler does inline (no separate function exists for
     it) is mirrored explicitly. No clear strategic value model for WHICH
     tile to move or where (same reasoning `driveTileSwap` already uses
     for Shifting Sands) — v1 picks the least-disruptive relocation: an
     eligible tile moved to an empty slot immediately adjacent to its own
     current position. **Bug caught during testing, fixed before
     verifying:** the first eligible tile isn't a safe default — an
     interior tile deep in a compact cluster never has a free adjacent
     slot (that's what makes it interior), so trying only `eligible[0]`
     silently did nothing useful in a real board layout. Fixed by
     dry-running the destination check (`findNearestSnapPoint` is
     side-effect-free) across ALL eligible tiles first and only starting
     the real pickup once a tile+destination pair is confirmed to work.

   Verified against a real running game (direct `enterX`/`processX`
   invocation, same testing style as every other effect here): Excavate
   completes both steps and teleports to a valid revealed hex; Take
   Flight completes both steps, moves the pawn, and correctly keeps the
   scroll in the caster's active area (self-target disposition); Telekinesis
   correctly skips a boxed-in interior tile and moves a different eligible
   one instead, tile count unchanged before/after (no duplication/loss),
   all drag-state and telekinesis-state cleared afterward. 10-game arena
   regression shows no errors.

   **Bug found via arena testing (fixed):** the dispatcher originally
   chained the DOM-modal checks (Create, Scholar's Insight) as `else if`
   off the `selectionMode` switch. Scholar's Insight sets BOTH a
   selectionMode (`type:'scholars-insight'`, cleanup-only — the actual
   picking is modal-driven) AND the DOM modal at the same time, so the
   switch's `default: break` silently consumed the turn before the modal
   check ever ran — Scholar's Insight was always falling through to cancel
   despite `driveScholarsInsight()` existing. Fixed by making the modal
   checks independent `if`s, not `else if`s.

   **Measured (BotArena, 8 games, seed 500, turnCap 150, identical seeds
   both runs):** with `BotEffects` enabled, 0 draws became fewer (3→2,
   pre-existing turn-cap draws unrelated to this change — same two games
   drew in both runs) and `bFitness` rose 2.80→8.16 with `aFitness`
   similar (-8.32→-6.93) — driving effects is a net win, not a
   regression, on this small sample. Rerun at scale once more increments
   land.

3. **Response scrolls (DONE — real multiplayer, not just the arena).**
   `window.BotEffects.decideResponse(responderIndex, casterIndex)`: v1
   heuristic — counter (Iron Stance/Psychic) when the triggering cast would
   grant the caster an unactivated element, otherwise play the cheapest
   pure-response scroll (Reflect/Unbidden Lamplight/Sigh of Recollection)
   for free value, else pass. **Explicit scope decision: no bluffing.**
   `canPlayerBluff()`/the bluff path in `canAnyPlayerRespondOrBluff()` is a
   human meta-game mechanic (feign holding a response you don't have); bots
   should only ever pass-or-respond with what they actually hold — do not
   build bluff logic. Two call sites:
   - **Arena** (`js/bot.js` `waitForQuiescence`): gated on
     `BotArena.isRunning()`.
   - **Real multiplayer** (`js/bot-driver.js` `respondForBots()`, ticks
     alongside the existing 700ms turn watcher): removes the "bots never
     count as responders" carve-out in `response-window.js`
     (`canAnyPlayerRespondOrBluff` / `checkAllPlayersResponded`) and adds a
     `responderIndexOverride` param to `playerResponds()` so the host can
     submit on an explicit bot index instead of relying on
     `localResponderIndex()` (which only resolves to whichever identity is
     locally impersonated for a full TURN, not a one-off response).
   - **AP-accounting fix (both paths):** `getPlayerAP`/`spendPlayerAP` used
     to have no correct source of truth for a NON-active responder outside
     multiplayer (`playerAPs[]` was multiplayer-broadcast-only,
     `game-core.js`'s `syncPlayerState()` early-returned before recording it
     locally) — a responding bot's AP checks silently fell back to
     `currentAP`, i.e. **whichever player is currently active/displayed**,
     not the responder's own AP. Fixed by always recording
     `playerAPs[activePlayerIndex]` in `syncPlayerState()` (not gated on
     `isMultiplayer`), and by giving `spendPlayerAP()` a direct-to-`playerAPs[]`
     path for "a responder with no live client of their own on this browser"
     (any non-active player locally, or a bot specifically in real
     multiplayer — genuine remote human opponents keep the original
     `spendAP()` path, since on their own separate client `currentAP` is
     unambiguously theirs). Verified: a simulated bot-responder scenario
     (active/caster AP=9, bot AP=5) confirms `spendPlayerAP(botIndex, 2)`
     leaves the caster's AP untouched and correctly drains the bot's own
     tracked pool (void first, then base) to 3.
   - **Nested selections (e.g. Reflecting/Psychic-ing an interactive
     scroll):** SAFE as-is for the response case specifically — none of the
     five response-eligible scrolls (Iron Stance, Psychic, Reflect,
     Unbidden Lamplight, Sigh of Recollection) open a selection UI when
     cast AS A RESPONSE (Reflect's immediate-nested-execution path only
     fires in its main-phase use, which `decideResponse` never triggers).
     The QUEUED replay (`processReflectPending`/`processPsychicPending`,
     fired at the start of the Reflect/Psychic caster's own next turn) DOES
     already chain through the normal `requiresSelection` UI via
     `onComplete` callbacks for whatever scroll was queued — if that's an
     undriven selection scroll, it degrades gracefully to today's
     cancel-and-continue (same as any other selection the bot can't drive
     yet), it does not hang or corrupt state.
   - **Testability caveat:** real networked multiplayer (Supabase) is
     unreachable from this sandbox, so the cross-client broadcast round
     trip (`broadcastResponse`/`broadcastPass` → another client's
     `handleRemoteResponse`/`handleRemotePass`) is unverified beyond code
     review — everything above it (AP accounting, carve-out removal, the
     respond/pass decision itself) is verified. Worth a real multiplayer
     smoke test (host + bot vs. a human) before relying on this.
   - Known related bug this would help: response-only (level-1) scrolls can
     permanently clog a common-area element slot since neither bot can ever
     cast OR respond with one today — see the "Related finding" note above.
4. **Whitelist effects in the simulator (FIRST TRANCHE DONE — Create,
   Transmute, Arson).** For each scroll whose effect the bot can now drive,
   implement it in `BotSim` and add it to `SIMULATED_SCROLLS` — ONLY
   together with harness evidence (`BotSim.validate`) that the simulation
   matches reality. This is what lets `searchPick()` plan around effects
   instead of scoring them blind.

   **Tranche 1 (2026-07-19): VOID_SCROLL_5 (Create), FIRE_SCROLL_4
   (Transmute), FIRE_SCROLL_5 (Arson)** — chosen because all three are
   modal-only pure pool/AP effects with deterministic BotEffects drivers,
   so the sim can mirror BOTH the state change AND the exact choice the
   driver makes (a simulated cast must land where the real driven cast
   lands, or the whole exercise is self-deception). Implementation notes:
   - The sim mirrors bot-effects' `elementNeed()`/`rankedElements()`
     constants verbatim (`effectElementNeed` in bot-sim.js) — if either
     side's heuristic changes, the validation harness is the drift alarm.
   - **Transmute's `execute()` activates fire UNCONDITIONALLY** (an early
     `activated.add('fire')` in scroll-effects.js, deliberately ahead of
     the modal) — it BYPASSES the empty-source-pool gate every other
     scroll respects. Mirrored faithfully; flagged as a possible rules
     inconsistency worth a design decision someday.
   - `driveTransmute()` changed to never discard VOID stones: 2 AP for a
     stone that permanently raises the AP cap was a bad trade anyway
     (same reasoning as `placeVoidSpendPenalty`), and a void discard
     clamps voidAP through a current/void AP split the snapshot doesn't
     carry — skipping void is what makes the mirror provably exact.
   - Excavate-immunity (a buff, not in the snapshot) can skew Arson's
     target choice — accepted, rare divergence, same class as the other
     documented buff gaps.
   Harness evidence: 9/9 targeted scenarios, ZERO divergence (scenarios
   cover need-ranking, source caps, pool-room edges, the void AP cap,
   unconditional fire activation with a dead fire source, empty-opponent
   no-op, and 3-player biggest-threat targeting). A/B arena (greedy vs
   hybrid, 10 games, seed 500, whitelist ON vs OFF): identical 7-3 hybrid
   margin and near-identical fitness both conditions — no regression (the
   acceptance bar), no measurable gain at this sample size (expected:
   these scrolls decide few positions per game; value should compound as
   more scrolls join the whitelist — rerun at scale once R5 lands).

   **Tranche 2 (2026-07-19): WATER_SCROLL_2 (Refreshing Thought),
   EARTH_SCROLL_3 (Mason's Savvy), EARTH_SCROLL_4 (Heavy Stomp),
   CATACOMB_SCROLL_10 (Combust).** Draws + the first board-geometry
   effects (shared `TILE_RADIUS`=TILE_SIZE*4 rule mirrors
   tileHasStones/tileHasPlayers/destroyStonesOnTile). Notes:
   - **Call to Adventure (CATACOMB_SCROLL_3) evaluated and EXCLUDED**: its
     buff grants stones of the revealed element on the flip ITSELF
     (game-core revealTile's ctaBuff branch), and that element is hidden
     information — an honest simulation cannot predict the pool change.
     It stays an unsimulated cast on purpose.
   - Mason's placement buff / Heavy Stomp reveal's catacomb +1 AP / a
     pre-existing CTA buff affecting a Stomp reveal: all accepted
     divergences, same documented classes as before (buffs not in
     snapshot; hidden element unknowable).
   - **Real simulator bug found and fixed by the harness** (value beyond
     the 4 scrolls): simCast credited the element activation BEFORE
     applying the effect, but the real applyScrollEffects runs execute()
     FIRST and gates activation on the POST-effect source pool — so
     Mason's Savvy draining the last earth stones forfeits the earth
     activation in the real game, and the sim now agrees. simCast's
     activation block moved after the effect dispatch to mirror the real
     order for every cast, simulated or not.
   Harness evidence: 16/16 scenarios (9 tranche-1 regression + 7 new),
   ZERO unaccepted divergence, zero page errors. New scenarios cover:
   unknowable-identity draw (count-only hand compare), source-capped
   Mason's draw AND the activation-forfeit ordering case, forced-element
   Stomp reveal, deliberate catacomb reveal exercising the documented +1
   AP acceptance, the hide branch (all tiles revealed), and Combust
   destroying the most-stoned tile with stones NOT returned to the
   source pool (distinct from Transmute's return — diff-verified).
   A/B arena, 30 games per condition (greedy vs hybrid, seed 500,
   whitelist ON vs OFF, per-scroll cast tally via a chained
   logScrollEvent counter): OFF 20-10 hybrid, ON 19-11 hybrid —
   statistically indistinguishable, and the simulated scrolls' cast
   counts are near-identical across conditions (~4 casts/game total, so
   they're common, not rare) — no regression, behavior stable. An
   earlier 10-game sample showed a scary-looking 5-5 that the 30-game
   run reveals as pure noise — treat 10-game A/Bs as smoke tests only.
   Neutral-not-yet-positive is expected: the tallies show these scrolls
   were already being cast whenever available, so modeling their
   outcomes changes leaf VALUES more than decisions; the payoff route
   is deeper search / evaluator retuning over the modeled outcomes.

Acceptance per increment: arena win rate vs. the pre-increment bot improves
(same weights, same seeds); no increment may regress the Stage-1 fixed bugs
(recast loops, oscillation, overflow stalls).

### § CHOICE-SPACE INVENTORY (Stage 2.5 step 1 — DONE)

15 scrolls open an interactive selection when cast (`requiresSelection:true`
plus a `system.enter*Mode()`/`show*Modal()` call); 1 more (Excavate) defers
its choice to the start of the caster's NEXT turn instead of cast time.
Everything else either fires automatically or just sets a buff that changes
the legality of a later ordinary action (placement range, stone-move, AP
cost) — those don't need `BotEffects` at all, they need `bot-state.js`'s
legality checks to already account for the buff (Mason's Savvy did, once
the drag-and-drop bug above was fixed; Seed the Skies/Avalanche do too via
the same `isInPlacementRange` path). Grouped by interaction shape, since
that's the natural unit for shared `BotEffects` handlers:

**A — single/double tile click (board)**
| Scroll | Chooses | Validity | Outcome |
|---|---|---|---|
| Shifting Sands (EARTH_SCROLL_2) | 2 tiles, any distance | `getEligibleTilesForSwap()`: not a player tile, no stones, no players (re-checked at 2nd click) | Tiles swap x/y positions |
| Heavy Stomp (EARTH_SCROLL_4) | 1 tile | same eligible set as above | Hidden→revealed (draws a scroll, via `revealTile`); revealed→hidden (irreversible, clears undo, no scroll) |
| Call to Adventure (CATACOMB_SCROLL_3) | 1 tile | identical mechanic — reuses `enterTileFlipMode` | Same as Heavy Stomp, plus: reveals for the rest of this turn also grant shrine stones immediately (`activeBuffs.callToAdventure`) |
| Combust (CATACOMB_SCROLL_10) | 1 tile | `tileHasStones(tile)` true, not a player tile | Destroys every stone on that tile |
| Wandering River (WATER_SCROLL_4) | 1 tile, then 1 element (2 steps) | tile: `getEligibleTilesForWanderingRiver()` — any non-player tile, revealed OR hidden, **no stone/player exclusion**; element: unfiltered pick of all 5 | Tile counts as chosen element (reveal/collection effects + visual) until caster's next turn |

**B — modal only, no board interaction**
| Scroll | Chooses | Validity | Outcome |
|---|---|---|---|
| Create (VOID_SCROLL_5) | 1 element | button disabled if caster's own pool has no room for that element | Draws stones = that element's rank (earth 5, water 4, fire 3, wind 2, void 1) |
| Scholar's Insight (VOID_SCROLL_2) | 1 deck, then 1 scroll from it (2 steps) | deck disabled if empty; scroll is any card in that deck | Scroll added to hand, deck reshuffled |
| Quick Reflexes (CATACOMB_SCROLL_9) | 1 scroll | flat pooled list of every level-1 scroll across all 5 elemental decks (not deck-then-scroll) | Scroll added to hand + draws 2 stones of its element, deck reshuffled |
| Inspiring Draught (WATER_SCROLL_3) | 1 deck, then (if 2 drawn) 1 of the 2 to put back | deck disabled if empty; auto-draws top 2 (`deck.pop()` x2), only 1 drawn if deck had 1 left (auto-kept, no 2nd step) | Kept scroll(s) go to hand; returned one reshuffled back in |
| Sacrificial Pyre (FIRE_SCROLL_3) | 1 scroll from caster's OWN hand | any hand scroll, pattern ignored | Sent to common area; grants its stone reward; **if it has its own effect, that effect executes too** — can open a NESTED selection UI (e.g. sacrificing Shifting Sands opens tile-swap) |
| Transmute (FIRE_SCROLL_4) | any number of: personal-pool stones (by type) / hand scrolls / active scrolls, repeatable, then Done | stone buttons disabled at 0 count; discarding stops being useful once `currentAP >= 5 + voidPool` | Each discard = +2 AP (capped); **not a single choice — an open multi-select session ended by the bot clicking Done** |

**C — two-step targeting (player, then a thing of theirs)**
| Scroll | Chooses | Validity | Outcome |
|---|---|---|---|
| Arson (FIRE_SCROLL_5) | 1 opponent, then 1 element (2 steps) | opponent: excludes self + Excavate-immune players; element: only types that opponent's pool has >0 of | Destroys 1 stone of that type from their pool |
| Plunder (CATACOMB_SCROLL_8) | 1 target (self allowed), then 1 of their active scrolls (2 steps) | target: excludes Excavate-immune opponents, self always eligible; targets with 0 plunderable active scrolls shown disabled (self-target excludes the scroll currently being cast) | Chosen active scroll discarded to common area |
| Take Flight (WIND_SCROLL_4) | 1 target player (self allowed), then a board DRAG (not click) to a hex (2 steps) | target: excludes Excavate-immune opponents; hex: unoccupied | Pawn teleports; scroll goes to target's hand if targeting an opponent, stays in caster's active area if self |

**D — board drag, single actor**
| Scroll | Chooses | Validity | Outcome |
|---|---|---|---|
| Telekinesis (VOID_SCROLL_4) | DRAG 1 tile to a new spot | same eligible set as Shifting Sands, plus the drop handler enforces "must still touch ≥2 tiles, can't strand a neighbor" | Tile moves. **`MAX_MOVES` is hard-coded to 1** even though the status text says "(0/3)" — stale copy, only 1 move is ever allowed; don't build for 3 |

**E — repeatable board-click session (persists all turn)**
| Scroll | Chooses | Validity | Outcome |
|---|---|---|---|
| Control the Current (WATER_SCROLL_5) | click a water stone, then pick its new element, repeat freely | stone: water-typed AND currently adjacent to caster (re-evaluated live after every caster move — the click targets change as the pawn moves); element: earth/fire/wind/void filtered to only types with >0 in the SOURCE pool (stricter than Wandering River's unfiltered pick) | Stone converts type; caster may repeat for the rest of the turn |

**F — deferred to the start of caster's NEXT turn (not part of `execute()` at all)**
| Scroll | Chooses | Validity | Outcome |
|---|---|---|---|
| Excavate (CATACOMB_SCROLL_4) | Teleport-or-Stay prompt, then (if Teleport) 1 hex | hex: unoccupied, on a revealed non-player tile | Pawn teleports there. Casting itself has zero choices (just grants immunity/no-response buffs) — the prompt fires from `processExcavateTeleport()` at the caster's next turn start, so `BotEffects` can't drive it from `waitForQuiescence`; needs its own turn-start hook |

**Buff-only scrolls (no `BotEffects` needed — just correct legality checks elsewhere):** Mason's Savvy / Seed the Skies / Avalanche (placement range — `isInPlacementRange`, Mason's Savvy's drag-and-drop bug is now fixed), Burning Motivation / Simplify / Steam Vents / Mudslide / Freedom / Mine / Reflecting Pool (automatic on cast or on a later `endTurn`/move, no player choice), Breath of Power (grants a "move an adjacent stone to an adjacent empty space" action that **doesn't exist in the Stage-0 action vocabulary yet** — would need a new `BotState` action type before a bot could use it, separate from this stage's `driveSelection()` work).

## STAGE 3a — Self-play arena (DONE) — original plan below

`js/bot-arena.js`: `BotArena.run(weightsA, weightsB, nGames, seed, opts)`
plays local hot-seat 2-player games (no Supabase, no multiplayer), both
players bot-driven, per-player weight tables (swapped into
`BotSystem.WEIGHTS` each turn), seeded `Math.random` per game (deck
shuffles reproducible), alternating sides per game, turn cap → draw.
Winner via `BotSim.winner`. Mutes sound/music/`window.gami` (no arena XP
farming) and the win modal during runs; restores everything after.
`BotArena.evolve(generations, opts)` implements the evolution loop below
(configurable `gamesPerPair` — a full spec generation is hours in-browser;
serious evolution wants R5's server-side execution).

Support added for the arena: `BotSystem.speedScale` (delay scaling; arena
default 0.1 ≈ 35ms/action) and `BotSystem.resetMemory()` (per-game wipe of
plan/oscillation-history/cursed-cells — positions repeat across games).

**Cheat-panel UI (no console needed):** two "🧬 Train Weights" buttons
(`js/game-ui.js` cheat panel, opened via 5 clicks on the HUD AP label), both
built on a shared `runWeightTraining(preset, onProgress)` helper:
- **quick**: `{generations:3, gamesPerPair:1, popSize:6}` — 45 games, a few
  minutes. Noisy (1 game/pairing) — may correctly report no improvement often.
- **thorough**: `{generations:8, gamesPerPair:3, popSize:8}` — ~672 training
  games + 20 confirmation games, likely 1-2+ hours; closer to the roadmap's
  own spec scale (28 pairs × N games/generation).

Both share a live progress meter (bar + generation/fitness/games-done/ETA
text), driven by new `opts.onGame`/`opts.onGeneration` callbacks on
`run()`/`evolve()`. Leaves any online game first via a shared
`leaveOnlineGameIfAny()` helper (also used by the existing bot-match
buttons), and `evolve()` checks `BotArena.stop()`'s flag once per generation
so the panel's ⏹ button can cancel a training run in progress (previously
only `spectate()` was cancellable) — note this only interrupts the `evolve()`
phase; the confirmation match after it always runs to completion, since it's
short relative to either preset.

**On running training concurrently:** deliberately NOT built. `BotArena`
plays local (no-Supabase) games in one browser tab's single JS thread against
shared mutable global state (`placedTiles`, `activePlayerIndex`,
`window.spellSystem`, ...) — two `playGame()` calls can't run concurrently in
one tab, and real multiplayer rooms wouldn't help (network overhead, and a
bot still needs a browser tab to drive it via impersonation until R4/R5 land
— see Runtime Track above). The only available "parallelism" today is
manually opening multiple tabs, each running an independent `evolve()` call —
each tab has an isolated `window`, so that's genuinely concurrent, but
`localStorage['godaigo_bot_weights']` is shared across tabs of the same
origin (last write wins) and there's no cross-tab result comparison, so this
is a DIY console workaround, not something worth building UI around. Real
concurrent self-play at scale is Stage R5's job.

**Headless parallel runner (`tools/arena-headless.mjs`) — R5-lite, built.**
Runs the REAL game (full fidelity, zero game-code changes) in headless
Chromium via Playwright — no open tab, no background-tab timer throttling
(browsers clamp `setTimeout` to ≥1s in non-visible tabs, so foreground-only
was a real constraint). Three modes:
- `node tools/arena-headless.mjs --games 4 --seed 1` — smoke: one
  `BotArena.run()` series, prints results + s/game.
- `--evolve --shards 4 --generations 3 --pop 6 --games-per-pair 1` — N
  parallel storage-isolated pages each run an independent `evolve()` with a
  well-separated seed (solves the localStorage last-write-wins problem
  above); all shard champions land in one `tools/.cache/evolve-*.json`.
  Throughput scales ≈ linearly with shards up to core count.
- `--confirm [file]` — round-robin playoff among the shard champions, then a
  confirmation series vs the page's live baseline WEIGHTS (same gate as the
  Train Weights button); only endorses the champion if its fitness beats the
  baseline's. Baseline is captured EXPLICITLY because `playMatch` treats an
  undefined table as "leave WEIGHTS alone" — mixing an explicit table with
  undefined leaks one side's weights into the other's turns.
Needs `playwright` (local or global npm install) + Chromium. supabase-js is
served from a `tools/.cache/` copy when unpkg is unreachable (auto-cached on
first run with network). Measured while building it: same seed at different
`speedScale` values produces DIFFERENT game outcomes (timing races affect
decisions — noise, not corruption), and below ~0.05 the sleeps stop
dominating anyway (5× lower scale bought only ~1.5×) — so leave speed at
0.1 and get throughput from `--shards` instead.

**Confirmation gate (added after a v1 of this button silently made bots
worse):** a single game per `evolve()` pairing is noisy — the per-generation
winner can win by luck, not by being a better strategy — so v1 of the button
applied and persisted whatever evolve() returned unconditionally. That's
exactly the thing this roadmap's own Stage 3a acceptance criterion (below —
"champion beats the hand-tuned defaults ≥55%...") exists to prevent; the
button had just skipped the check for convenience. Fixed: after evolve()
returns, the button runs a 10-game confirmation match (`BotArena.run()`)
between the champion and whatever weights were live before training started,
via the new `BotArena.applyWeights()` export, and only keeps the result
(applies it live, leaves localStorage as evolve() wrote it) if the champion's
`aFitness` actually beat the baseline's in that match — otherwise it reverts
both the live `WEIGHTS` object and `localStorage['godaigo_bot_weights']` to
their pre-training snapshot. `evolve()`'s own per-generation auto-persist to
localStorage is unchanged (pre-existing, intentional — see below) since the
console/manual training workflow it was built for already expects a human to
judge the logged fitness before trusting a result; only the one-click UI path
needed the automated check.

**Tutorial interference (found via a real playtest — running from inside an
active tutorial got stuck in a loop, then the page reloaded on its own):**
`spectate()` already neutralized `window.isTutorialMode` before running local
games ("its hooks force tile elements... and its spotlight overlays obscure
the board"), but `playGame()` — the function `run()`/`evolve()` (and so the
Train Weights button) actually use — never did. Every `TutorialMode` hook
call site (`game-core.js`, `game-ui.js`, `scroll-panels.js`) is gated on
`window.isTutorialMode`, so leaving it `true` meant a bot racing through
moves/casts/end-turns across dozens of games could satisfy the tutorial's
remaining scripted steps in seconds — and `tutorial-mode.js`'s `finish()`
calls `window.location.reload()` once the step sequence runs out, which
would kill an in-progress training run outright. Fixed by factoring the
neutralization into a shared `neutralizeTutorialMode()` and calling it at
the top of `playGame()` (once per game, not just once per `run()`/`evolve()`
call, in case something re-triggers tutorial state mid-run) as well as
`spectate()`.

**Fitness shaping (added after the first evolution runs):** `evolve()`
originally used pure win-count as fitness — a bot that stalled into a
200-turn turn-cap draw scored identically to one that played sharply and
still drew, so evolution had zero selection pressure against stalling.
`run()`/`playGame()` now also track each side's win-condition progress
(elements activated at game end) and stuck-turn count (turns force-ended
because `botTurn()` never chose to end them itself), and `sideFitness()`
combines win/loss ±1 with a small progress reward and stuck-turn penalty
(`opts.progressWeight`/`opts.stuckPenalty`, defaults 0.3/0.15) into
`aFitness`/`bFitness`, which `evolve()` now selects on instead of raw wins.
This is reward SHAPING, not a hand-authored rule about any specific
trap (e.g. the earth-stone boxed-in case) — it mirrors the "win ±1, small
per-turn penalty" reward already specified below for Stage 3c, tested
cheaply in the arena before RL makes it expensive to iterate on.

**Six real bot/infra bugs found by the first arena runs** (all fixed —
games went from 100% frozen draws to ~50-turn completions):
1. `BotState.hexGrid()`'s TIME-based cache (1.5s) served pre-reveal grids;
   at bot speed whole games fit in one stale window and pawns froze on a
   board that no longer existed. Now invalidated by board change.
2. Euclidean-only exploration froze pawns in cul-de-sacs (every legal move
   "increased distance" even when it was the only way out). Now scored by
   real cheapest path (`ctx.explorePath`, `WEIGHTS.moveExplorePath`), with
   a multi-source path field for search leaf evaluation.
3. `makePlan()` was hand-only; games dead-ended when the only source of a
   needed element was a scroll parked in the ACTIVE area (casts leave it
   there) or the COMMON area. Plans now consider hand+active+common, gated
   on actual win credit — which also fixed a plan-level infinite recast
   loop (the plan had no `castAlreadyWon` equivalent) and made catacomb
   dual-credit count.
4. Stage-0 vocabulary gaps: casts from the common area and voluntary
   discards (cycle a jammed 2-slot hand to the common area) didn't exist,
   so bots plateaued at 2/5 elements with dead scrolls in hand forever.
5. The anti-freeze rule (clear stale revisit memory when endTurn wins with
   AP to spare) initially overrode SHRINE COLLECTION and caused a cost-0
   wind-stone ping-pong; now thresholded to fallback-scored endTurns only.
6. `ResponseWindowSystem.isBotPlayer()` (`js/scrolls/response-window.js`)
   identifies bots via multiplayer's `allPlayersData`, which is never
   populated in the arena's local hot-seat games — every seat there IS a
   bot, but isBotPlayer() silently returned false for all of them. Any cast
   whose response/counter happened to be formed for another bot opened a
   REAL response window with no one able to click Pass, stalling ~15s
   (`RESPONSE_TIMEOUT_MS`) per eligible cast. `run()`/`spectate()` now
   monkey-patch `isBotPlayer` to `() => true` for the duration of the local
   match (restored after), same save/restore pattern as the other muted
   systems.

**Unified core + visualized/N-player evolve (later addition):** `run()`,
`evolve()`, and `spectate()` were originally two separate code paths — a
muted/fast 2-player loop (`playGame`, used by `run`/`evolve`) and a
visualized 2–5-player loop (`spectate`'s own inline loop, no per-player
weight swapping). Unified into one shared `playMatch(weightsPerPlayer, opts)`
that all three now call: `weightsPerPlayer.length` sets the player count
(2–5), an `undefined` entry leaves `WEIGHTS` untouched (how `spectate()`
plays with whatever's currently loaded instead of a fixed table), and
`opts.visual` controls only pacing (muting/status/log-download stays the
caller's job). This unlocked two things without new game logic:
- `run()`/`evolve()` accept `opts.visual: true` to watch training games with
  normal pacing instead of muted-fast (same core as `spectate()`).
- `evolve()` accepts `opts.nPlayers` (2–5): 2 keeps the original exhaustive
  pairwise round-robin; >2 samples `opts.gamesPerGen` random N-player
  groupings per generation (seeded, reproducible) since exhaustive
  `C(popSize, nPlayers)` explodes — the winner's population slot gets +1
  fitness, draws get nothing.
- `stop()` (previously spectate-only) now interrupts `run()`/`evolve()`
  too — checked in every loop via a shared `_stopRequested` flag, reset
  only by the true top-level entry point so a mid-evolve stop isn't undone
  between an evolve run's internal pairwise/grouped games.
- **Population identity/lineage:** population members are `{id, w,
  parentIds}` objects (`newMember()`/`_nextPopId`), not bare weight tables.
  Elites carry their `id`/`parentIds` forward unchanged each generation;
  bred children get a fresh id and `parentIds:[idA,idB]` (`[idA]` for
  self-crossover). `onGeneration(gen, total, fitnessArr, members)` gained a
  4th argument (`members`, ranked best-first) exposing this — existing
  3-arg callers are unaffected. Powers the Bot Training modal's Population
  roster/lineage labels and Generations log in game-ui.js.

Cheat panel gained a "🧬 Evolve" row next to "🤖 Bot match" (same 2/3/4/5
player-count buttons, shared Stop), running a small visualized 3-generation
pop-6 evolve by default — tune further from the console with
`BotArena.evolve(generations, {nPlayers, visual, popSize, gamesPerPair,
gamesPerGen})`.

## STAGE 3a — original plan (for reference)

Goal: the "slowly evolving" learner, no ML infrastructure.

1. **`js/bot-arena.js`** exposing `window.BotArena.run(botA_weights, botB_weights, nGames, seed)`
   → `{aWins, bWins, draws, avgTurns}`. Requirements:
   - Headless-ish: run in the normal page but suppress rendering where cheap
     (skip animations; call the same startGame(2) local path the tutorial uses).
   - Seeded determinism: `initializeDeck(numPlayers, seed)` already accepts a
     seed; route ALL bot randomness through one seeded PRNG (mulberry32 — copy
     the one in `joytone/index.html`'s adapter).
   - Turn cap (e.g. 200) → draw, so degenerate weight sets can't hang the loop.
2. **Evolution loop** (`BotArena.evolve(generations)`):
   - population = 8 weight tables; gen 0 = current `BotSystem.WEIGHTS` + 7
     Gaussian mutations (σ = 20% of each weight's magnitude);
   - fitness = wins in round-robin (each pair plays 10 games, seeds 0–9);
   - next gen = top 2 elites + 6 fresh mutations of them;
   - persist the champion after every generation to
     `localStorage['godaigo_bot_weights']` AND log it to console as JSON so a
     human can paste it into bot.js as the new default.
3. bot.js already loads `localStorage['godaigo_bot_weights']` over its built-in
   defaults at startup — evolution results take effect on reload without code edits.

Acceptance: after ≥20 generations, champion beats the hand-tuned defaults ≥55%
over 100 fresh-seeded games.

## STAGE 3b — Human game logging (TODO)

- On every applied human action (hook the same UI paths `BotState.applyAction`
  wraps — pawn drop, stone drop, cast button, end turn), append
  `{ gameId, playerIndex, snapshot: BotState.snapshot(), action }` to a buffer;
  flush to a new Supabase table `bot_training_games` at end of turn.
- Mind privacy: no display names in the payload, just player indices.
- First use: an offline eval — "% of positions where the bot's argmax matches
  the human's choice" — report per feature-weight set. Second use (much later):
  behavioral cloning.

## STAGE 3c — Neural RL (OPTIONAL, do LAST)

Only worth starting once Stage 2's simulator can run ≥1000 self-play games/minute
in a worker or Node (jsdom). Then: featurize the snapshot (fixed-size vector:
per-element pools, activated flags, hand one-hots, pawn-to-shrine distances),
PPO or DQN via tensorflow.js, reward = win ±1 with small per-turn penalty.
If Stage 2 MCTS exists, prefer AlphaZero-style (policy prior + value net) over
model-free RL. Do not attempt without the arena (3a) as the evaluation gate.

## STAGE 4 — Elemental stone tactics (terrain control) (DONE)

Prompted by a user question: do stone-placement/breaking weights need to
differ per element, given each has a distinct ability (earth blocks
movement, water chains/mimics its neighbor, fire destroys adjacent
non-fire/non-void stones on placement, wind is free movement, void held in
pool grants standing bonus AP — `voidAP = pool.void` each turn,
`game-core.js`)? Investigated case by case:

- **Wind (traversal DONE earlier; placement DONE with earth/fire below)** —
  traversal was already correctly priced for free: its movement-cost effect
  feeds directly into `a.cost` in the `move` case of `scoreAction()`, so a
  single generic `moveApPenalty` already produces wind-preferring behavior
  with no new weight needed. What that did NOT cover (user request, added
  alongside the earth/fire work below): PLACING wind stones to build a free
  corridor along the bot's own route — `placeWindPath` rewards a wind stone
  dropped on a hex of the bot's own cached objective path (see
  `tacticalContext()` below). Emergent timing observed in verification: a
  useful move/cast still outscores the drop (+12 < typical move values), so
  the bot paves the road ahead mostly when AP is spent, right before ending
  the turn — exactly when it costs nothing.
- **Water** — its value is entirely borrowed from whatever it's chained to
  (mimics earth or wind depending on the adjacent stone via
  `getChainedAbility()`), so a static per-element weight can't represent it
  well. Deliberately left alone.
- **Void (DONE)** — holding void stones in pool grants ongoing AP, a
  persistent benefit no other element's pool has, that the evaluator
  previously priced identically to every other element (generic
  `evalStoneNeeded`/`evalStone`, need-based only). Added three new weights
  in `js/bot.js`:
  - `evalVoidHeld` (evaluator, `evaluateSnapshot()`): flat value per void
    pool stone, ADDITIVE on top of the existing generic per-element terms
    (they represent different value sources — generic material vs.
    standing AP — not a replacement). Since `BotSim.simulate()` already
    decrements pool on `placeStone`, this alone makes Hybrid-brain search
    naturally discount any simulated action that spends void stones — no
    extra scoring code needed for the search path.
  - `shrineVoidBonus` (`shrineValue()`, × need, void only): void shrines
    get extra pull during real movement/endTurn scoring (this path stays
    greedy even under Hybrid — "plain movement stays greedy" — so this is
    the one that actually matters for movement targeting).
  - `placeVoidSpendPenalty` (`scoreAction()`'s `placeStone` case): mirrors
    the opportunity cost directly, for the non-search "Dumb" brain
    fallback where `evaluateSnapshot()` never runs. Redundant with
    `evalVoidHeld` under Hybrid/search (which bypasses `scoreAction()` for
    tactical actions entirely — see below) but harmless and keeps the two
    brains consistent.
  Verified via `evaluateSnapshot()`/`score()` called directly with
  synthetic snapshots (exposed on `window.BotSystem`): isolated the exact
  weighted delta for higher void pool, a void vs. non-void placement, and
  a void vs. water shrine at equal need — all matched expected math
  exactly. 10-game self-play regression (`BotArena.run`, same weights both
  sides) confirms no errors/crashes with the new terms live.
- **Earth (blocking) / Fire (interference) — DONE (plus wind placement,
  above).** Built exactly on the scoped design below, with one deliberate
  extension: the "placement position is dictated by the bot's own pattern"
  constraint (point 1 below) turned out to be a Stage-0 VOCABULARY gap, not
  a game rule — a human can drag any held stone onto any valid in-range
  hex, bots just never had that action. `bot-state.js`'s `legalActions()`
  now also enumerates TACTICAL placeStone candidates (`scroll:null,
  tactical:true`): earth/wind/fire from the pool onto empty hexes ADJACENT
  to the pawn (default placement range; range buffs deliberately not
  exploited, keeps it ≤ ~18 candidates). So earth-blocking is a real
  placement choice now, not only a tie-break between pattern cells — though
  the tactical terms apply to pattern-dictated placements too.

  Implementation (`js/bot.js`): `tacticalContext(snap)` built ONCE per real
  decision (never per search leaf, per the design below) —
  `oppPathCount` (per-hex count of opponents whose cheapest path to their
  next objective crosses it; objective mirrors `opponentProgress()`:
  nearest needed shrine, or home once all 5 activated; `pathToOrNear()`
  falls back to the cheapest hex ADJACENT to a target our own
  `canPlayerMoveToHex` can't enter, e.g. an opponent's home centre),
  `ownPathHexes` (bot's own best shrine path + nearest hidden-tile route,
  or home path once complete), and `threatStones` (every stone inside a
  currently-satisfied pattern variant an opponent could cast RIGHT NOW —
  common-area + their PUBLIC active area, anchored at their standing hex;
  hand names stay hidden by design). `tacticalPlaceBonus()` folds these
  into BOTH brains at the root only: greedy `scoreAction()`'s placeStone
  case via `ctx.tac`, and `searchPick()`'s root scores the same way
  revisitPenalty is folded in (the "root-only heuristic" option below —
  evaluateSnapshot() never sees the sets, so leaves stay cheap). Weights:
  `placeTacticalBase` (−4: a tactical drop is never attractive on its own),
  `placeEarthBlock` (+45 × opponents blocked), `placeSelfBlockPenalty`
  (−40, earth on the bot's OWN path — don't wall yourself in),
  `placeWindPath` (+12), `placeFireThreatBreak` (+70 per threat stone an
  unguarded fire placement would destroy — mirrors
  `applyFireInteractions()`: no burn if the placed fire has an adjacent
  void), `placeTacticalStarvesPlan` (−500 veto when the spend would leave
  the pool short of what the active plan still needs of that type).

  **Guards that had to ship with it (all three observed, not theoretical):**
  - Hybrid's search trigger now ignores tactical candidates
    (`placeStone && a.scroll`) — they're near-always legal, so counting
    them would have made hybrid degenerate into always-on search, the
    configuration that LOST its acceptance series (Stage 2 measurements).
  - `botTurn()`'s `productive` bookkeeping likewise only counts pattern
    placements, or terrain drops would mask a stall from
    `unproductiveStreak`'s circuit breaker forever.
  - **Wind paving initially wedged ~30% of arena games as draws** (repro:
    seeds 17000/17006/17009): `ownPathHexes` included the path's
    DESTINATION — the target shrine's centre hex — so the bot paved the
    centre with wind, and its collect leg then looped forever: step onto
    the shrine (free), "end turn to collect" rejected (resting on a stone
    is transit-only), step off, replan, step back on… until the 30-action
    cap expired mid-loop standing on the stone, where the arena's forced
    endTurn is ALSO rejected → game aborted as a no-stall draw. Fixed
    three ways: `collectibleShrines()` excludes shrines whose centre holds
    a stone (collection = RESTING there, which a stone bans — this also
    fixes plan targeting and shrine-pull scoring against opponent-paved
    centres); `ownPathHexes` excludes revealed tile-centre hexes (wind
    pays on corridors, never on hexes the bot must eventually rest on);
    and `botTurn()` gained a safety net — never leave autopilot resting
    on a stone when an affordable step onto a stone-free hex exists.

  Verified headless (real game, exact weighted deltas): wind on-path 8 vs
  −4 off-path (= placeWindPath); earth on an opponent's modelled path 41
  vs −4 off it, and back to −4 with the opponent removed (= placeEarthBlock,
  negative control); fire adjacent to a staged loaded-gun stone 66 vs −4
  after the opponent's scroll is removed (= placeFireThreatBreak, negative
  control); searchPick() runs clean with tactical candidates present.
  Arena regression after the wedge fixes: 10 + 8 games, ALL decisive
  (5-5-0, 4-4-0), zero stalls/stuck games/page errors, ~10 terrain
  placements per game across both bots. Known limits: `bot-sim.js`'s pure
  `legalActions(snap)` doesn't generate tactical candidates for deeper
  plies (same accepted root-only gap as breakStone/teleport), and opponent
  paths are computed from the active player's movement perspective (slight
  approximation, documented in the code).

  Original scoping notes, kept for context:
  Both are real opponent-facing tactics (earth walls off a path, fire
  destroys a stone an opponent needs) that the bot doesn't currently
  reason about at all — `placeStone` scoring is 100% about the bot's OWN
  pattern progress. Two things make this harder than the void addition:
  1. **Placement position is dictated by the bot's own pattern, not free
     choice.** `bot-state.js`'s `legalActions()` generates `placeStone`
     candidates at `pHex.q+req.q, pHex.r+req.r` — offsets relative to the
     bot's OWN position, fixed by whichever scroll/variant/cell the
     candidate is for. There's no "place earth anywhere I want" action; the
     bonus can only ever tie-break BETWEEN pattern-dictated options that
     are already on the table (prefer a variant/cell that happens to also
     block/threaten, all else equal). Real, but narrower than it first
     sounds — it fires only when the bot's own building happens to
     coincide with an opponent's contested space.
  2. **The natural home for this (`evaluateSnapshot()`) can't afford real
     pathfinding per leaf.** Search evaluates many leaves per decision
     (root scores every legal action once, then expands `searchBreadth`
     children per node down to `searchDepth`) — running a fresh Dijkstra
     per opponent at every leaf (needed to know "is this hex on their
     cheapest path to their objective") would be far too expensive at that
     call volume. Fire interference against COMMON-AREA scrolls already
     works for free today, incidentally: `BotSim.simulate()` already
     models fire destroying adjacent non-fire/non-void stones on
     placement, and `evaluateSnapshot()`'s existing `commonAreaThreat()`
     re-checks every opponent's pattern satisfaction on the POST-simulated
     snapshot — so if a fire placement the bot was already making for its
     own plan happens to break an opponent's common-area "loaded gun," the
     search leaf already scores it correctly. What's NOT covered: fire
     breaking a stone that only helps an opponent's HAND/ACTIVE scrolls
     (not common-area) — infeasible to detect anyway, since opponent hand
     scroll NAMES are hidden by design (`BotState.snapshot()` only exposes
     `handElements`, never `hand`, for non-self players — see the
     "RULES CHANGE: opponent hand scrolls show element type" entry in
     planning/current.md).
  Proposed design for earth-blocking, when picked up: compute each
  opponent's cheapest path to their next objective (nearest needed shrine,
  or home if fully activated — mirrors `ctx.shrines`/`ctx.homePath`
  already built once per bot decision in `rankActions()`) a SINGLE time
  per real decision, not per search leaf, into a small cached hex set;
  `scoreAction()`'s `placeStone` case (which — unlike search's leaf
  evaluator — DOES still run once per candidate at the root, before
  `searchPick()`'s own root-scoring takes over) checks cheap set
  membership against it. Needs a real decision on whether the bonus should
  also feed into `evaluateSnapshot()` for search's deeper plies (harder;
  would need the cached set threaded through `simulate()`'s call chain) or
  stay a root-only heuristic (simpler, tie-breaks the immediate choice
  without pretending to model how the opponent reroutes around it).

## STAGE 5 — Catacomb/Freedom teleport action (DONE)

Prompted by a user question: why can't bots use catacomb tiles to teleport?
Answer at the time: they simply weren't in the bot's action vocabulary —
`legalActions()` never enumerated them, so no amount of scoring could make
a bot choose one. Root mechanic (`game-ui.js`, `updateCatacombIndicators()`
+ its click handler, ~line 3560-3720): standing on a revealed catacomb
shrine — or ANY revealed elemental shrine while the Freedom (Wind III)
buff is active — lets a player jump to any OTHER revealed catacomb-like
shrine centre with no stone/player on it, for free (0 AP), via
`placePlayer(x, y)` (which also fires `checkWinCondition()` as a side
effect, same as any other repositioning).

Added across the Stage-0/2 seam, same pattern as every other action:
- **`bot-state.js`** — new `{type:'teleport', x, y, shrineType}` in the
  canonical vocabulary. `legalActions()` mirrors
  `catacombEligibility()`/`updateCatacombIndicators()`'s exact rule
  (origin must be catacomb-like; destination must be a different, revealed,
  unoccupied catacomb-like shrine) — checks `t.flipped` before ever
  touching `t.shrineType`, per the DO-NOT-LIST rule, even though the
  real-game filter this mirrors doesn't bother with that ordering (harmless
  there since a human never sees the intermediate boolean). `applyAction()`
  re-validates the destination fresh and calls `placePlayer()` directly —
  never reimplements the teleport itself, same discipline as `breakStone`
  reusing `attemptBreakStone()`.
- **`bot-sim.js`** — new `simTeleport()` (pure position update, no AP cost,
  no reveal side effect since the destination is always already revealed)
  wired into `simulate()`'s switch. This is what makes the ROOT decision
  ("should I teleport right now") correctly valued under Hybrid-brain
  search: `searchPick()`'s root candidate list always comes from
  `BotState.legalActions()` (real DOM state, sees teleport including the
  Freedom case), and now `simulate()` knows how to apply one. **Known
  limitation, same category as `breakStone`:** `bot-sim.js`'s OWN pure
  `legalActions(snap)` — used for DEEPER search plies (2+), since those
  can't call the real `BotState.legalActions()` on a hypothetical snapshot
  — does NOT generate teleport candidates. Partly because the Freedom-buff
  state that gates elemental-shrine eligibility isn't carried in the
  snapshot schema at all. A multi-step plan that hops through a catacomb
  mid-sequence won't be discovered by lookahead; deciding whether to
  teleport as the immediate next action is unaffected.
- **`bot.js`** — two new weights: `teleportBase` (small flat nudge — it's
  free, so there's rarely a reason to decline one) and
  `teleportShrineValue` (× `shrineValue(snap, destination)` when the
  destination is elemental — the Freedom case only; plain catacomb
  destinations have no resource value, just repositioning value, so they
  score `teleportBase` alone). No path-cost division like
  `moveShrineValue` gets, since the hop is free — full value applies.

Verified headless against a real running game (not synthetic snapshots
alone): staged two injected catacomb tiles, confirmed `legalActions()`
offers exactly the one valid destination (not the origin shrine itself),
`scoreAction()`'s flat score matches `teleportBase` exactly for a plain
catacomb destination, `applyAction()` moves the pawn with zero AP spent,
and `BotSim.simulate()` mirrors the same position change. Negative control:
standing on a plain non-shrine hex yields zero teleport candidates even
with revealed catacombs elsewhere on the board. Freedom case: zero
candidates from an elemental shrine without the buff, one candidate with
it stubbed active, destination scored `teleportBase + teleportShrineValue
× shrineValue` exactly (not just the flat base — confirms the bonus term
actually fires). 10-game self-play regression (`BotArena.run`) shows no
errors and a normal win/draw mix with the new action type live.

---

## DO-NOT LIST (for every future stage)

- Do NOT reimplement game rules inside bot.js — actuate only via `BotState.applyAction`.
- Do NOT read `tile.shrineType` of unrevealed tiles (cheating; poisons learning).
- Do NOT act in multiplayer when it isn't this client's turn.
- Do NOT tune strategy by editing `scoreAction()` — tune `BotSystem.WEIGHTS`.
- Do NOT block the main thread with long loops — yield between arena games
  (`await new Promise(r => setTimeout(r))`).
- Do NOT trust `stoneCounts` to be the source pool (it isn't; use `window.stonePools`).
- Do NOT let Runtime Track code (R2+) reach into DOM state or bot-driver.js
  internals — it only knows the Stage-0 snapshot/action vocabulary, same as
  the strategy code.
- Do NOT skip straight to R4/R5 (removing impersonation, server-side bots)
  before R2/R3 (backend validation) exist — see Runtime Track sequencing note.
