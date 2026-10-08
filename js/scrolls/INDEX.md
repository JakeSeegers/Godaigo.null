# js/scrolls/ — Scroll System Index

> See parent: [js/INDEX.md](../INDEX.md) → [CLAUDE.md](../../CLAUDE.md)

---

## FILE MAP

| File | Responsibility |
|------|---------------|
| `scroll-definitions.js` | Static data: all 31 scroll names, levels, elements, stone patterns, and effect descriptions. Exposes `window.SCROLL_DEFINITIONS` and `window.SCROLL_DECKS`. |
| `response-window.js` | `ResponseWindowSystem` class: detects which players can respond to a cast, manages 15s countdown, validates counter/reaction scrolls, resolves the stack. |
| `effects/scroll-effects.js` | `ScrollEffects` namespace: `execute(scrollId, playerIndex, spellSystem)` for all 31 scrolls, active buff tracking, selection modes (sacrifice, tile-flip, etc.). |

---

## SCROLL SYSTEM FLOW

```
Player clicks "Cast Spell"
    │
    ▼
spellSystem.activateScroll(scrollId, playerIndex)   [game-core.js]
    │  validates: pattern on board, 2 AP, scroll in active/common area
    │
    ▼
applyScrollEffects(scrollId, playerIndex, result)   [game-core.js]
    │  calls ScrollEffects.execute()
    │  checks result.cancelled before tracking win condition
    │
    ▼
ScrollEffects.execute(scrollId, playerIndex, ss)    [scroll-effects.js]
    │  returns { success, requiresSelection, cancelled, message }
    │
    ▼
ResponseWindowSystem.openWindow(castData)           [response-window.js]
    │  15s for other players to respond
    │  on response: re-enters execute() for the counter scroll
    │
    ▼
Win condition tracked in spellSystem.activated Set
(win = all 5 elements activated + pawn returned to own player-tile centre;
 gate: checkWinCondition() in game-core.js)
```

---

## scroll-definitions.js — Deep Notes

### Data structures
```js
SCROLL_DEFINITIONS = {
  EARTH_SCROLL_1: {
    id: 'EARTH_SCROLL_1',
    name: 'Tremor',
    element: 'earth',
    level: 1,
    isResponse: true,       // level 1 scrolls are always response-only
    patterns: [[...], [...]], // array of rotation variants
    description: '...'
  },
  ...
}

SCROLL_DECKS = {
  earth: ['EARTH_SCROLL_1', ..., 'EARTH_SCROLL_5'],
  water: [...],
  fire:  [...],
  wind:  [...],
  void:  [...],
  catacomb: ['CATACOMB_SCROLL_1', ..., 'CATACOMB_SCROLL_6']
}
```

### Patterns
- Each pattern is a list of `{q, r, type}` relative offsets from the player's hex
- Multiple variants per scroll = rotation equivalents (the system checks all)
- `type` matches stone type strings: `'earth'`, `'water'`, `'fire'`, `'wind'`, `'void'`

### Catacomb scrolls
- 6 scrolls, dual-type (count toward 2 win conditions)
- Drawn when revealing a catacomb tile
- Stored in `SCROLL_DECKS.catacomb`

---

## scroll-effects.js — Deep Notes

### execute() return contract
```js
{
  success: bool,            // did the effect fire?
  requiresSelection: bool,  // is the system waiting for player input?
  cancelled: bool,          // if true, applyScrollEffects() skips win tracking
  message: string           // status bar text
}
```

### Win-condition elements: one rule everywhere (2026-10-01, match 43)
- An element only counts while its shared source pool (`stonePools`) is above 0. Normal casts
  (`applyScrollEffects`), responses (lobby.js `response-resolved`) and counters
  (multiplayer-state.js) all apply it; responses/counters use `spellSystem.grantElements(idx, els)`,
  which returns the elements really granted.
- `scroll-effect` / `spell-cast` broadcasts carry ONLY the granted elements (`activatedElements`,
  `granted`); receivers add exactly those. Before, the full list was sent and added without the rule.
- The source pools are synced: `syncPlayerState()` sends `source` (the active player's `sourcePool`)
  with `player-state-update`; receivers copy it. Before, shrine collections only changed the
  collector's own board.

### Common area and duplicates (2026-10-01, match 43)
- `common-area-update` receivers remove that scroll from every hand / active area / deck: going
  to the common area is always the latest move (Sacrificial Pyre, Psychic sent no other message).
- `validateScrollState()` repairs duplicates the same way on every board (common beats a player,
  active beats the same player's hand, anything held or common leaves the decks) and asks the host
  only for a real conflict (two players), at most every 5 s; the host answers at most every 2 s.
  Before, every board asked every 3 s while the host's snapshot carried the same duplicate.

### cancelled: true
Used when an execute() call cannot proceed (e.g., Sacrificial Pyre with empty hand).
`applyScrollEffects()` in game-core.js checks `result.cancelled` and returns before
tracking the element in the win condition set. Critical: the element tracking block
runs even if `success=false`, so `cancelled` is the only safe escape hatch.

### Active buffs
Stored in `ScrollEffects.activeBuffs{}`. Keyed by effect name. Cleared on turn end.
Examples: `callToAdventure` (draw stones on tile flip), `respirate` (wind return on turn end).

### Selection modes
Some scrolls pause normal gameplay to collect player input:
- `enterScrollSacrificeMode()` — player picks a scroll from hand to discard (Sacrificial Pyre)
- Tile pick marks (2026-10-07): `window.TileMark` (scroll-effects.js top) `mark(el, {color})` puts a pulsing tint + white outline on every hex of a tile (`.tile-select-mark`), `unmark`, `fromMark(x, y)` / `clearFrom()` (dashed ring where a moved tile came from). Shifting Sands marks the picked tile; Telekinesis marks the drag ghost (opacity 0.85) and its starting spot (game-core.js startTileDrag; game-ui.js clears it on drop). `unhighlightTile` also unmarks.
- Scroll pickers (2026-10-07): `_scrollRefCard(scrollName, nameTag)` builds a Scroll Reference style card (name, element + level + Response/Counter, full description, `.scroll-ref-row` + `data-scroll-name` so scroll-panels.js shows the pattern on hover; the preview's z-index is 3100, above the pickers). `showScrollSelectionModal` (Inspiring Draught put-back, Sacrificial Pyre, Plunder) uses it with the name as a `<button>`; Scholar's Insight's deck browser uses it (name `<div>` first) with element tabs to switch decks and only scrolls still in the deck. bot-effects.js reads the name button / first child text, so keep the name alone in that element. The pickers stay non-dimming and movable (`styleDecisionOverlay` + `makeDecisionModalMovable`).
- `tileMoveMode` on `window` — player picks tiles to move (Telekinesis)
- `takeFlightState` on `window` — the CHOOSER drags the target pawn to a hex. Set up by `_enterTakeFlightDrag()`, called either directly (self-target, or opponent-target outside real multiplayer — the caster drives it) or from `enterTakeFlightChoiceAsTarget()` (real-multiplayer opponent-target — the TARGET's own client drives it instead). `window.pendingTakeFlightCompletion` on the CASTER's client (`{casterIndex, targetPlayerIndex, completionPayload}`) is how the caster's `onSelectionEffectComplete` gets resolved once the target's choice comes back over the `take-flight` broadcast — see lobby.js § Take Flight below.

### Scroll-specific gotchas
- **Sacrificial Pyre (FIRE_SCROLL_3)**: `executeSpell()` refuses it before spending AP when the hand has no usable scroll (Level I responses don't count on your own turn), with a message. The effect's own empty-hand `cancelled:true` stays as a fallback (no fire win-con).
- **Heavy Stomp (EARTH_SCROLL_3)**: calls `performTileFlip()` in scroll-effects.js (NOT `revealTile()`). Remote flips use `flipTileVisually()`. Only `revealTile()` grants +1 AP for catacomb tiles and fires tutorial hooks.
- **Wandering River (WATER_SCROLL_X)**: uses `getEffectiveTileElement(tile)` to override shrine type for scroll drawing. Check this before assuming `tile.shrineType` is canonical.
- **Shifting Sands (EARTH_SCROLL_2)** & **Telekinesis (VOID_SCROLL_2)**: both use the "no stones, at most ONE player (carried along + recentered)" rule now. Shifting Sands checks `isTileEligibleForShiftingSands()`/`getEligibleTilesForShiftingSands()`; Telekinesis reuses `getEligibleTilesForShiftingSands()` for its drag-highlight and enforces `playerCountOnTileById(id) >= 2` blocks at drag-start (game-core.js), PLUS its own strand check (`tileIsBridge`) that swap doesn't need. The single carried player is recentered by `carryPlayersOnTelekinesisMove(oldPos,newPos)` in game-ui.js's tile-drop handlers (mouse + touch), which fills `movedPlayers` for the `telekinesis-move` broadcast. **Heavy Stomp (`getEligibleTilesForFlip()` → `getEligibleTilesForSwap()`) still keeps the stricter no-players-at-all rule — don't "fix" it to match.**
- **Take Flight (WIND_SCROLL_4)**: destination must be an unoccupied hex on a tile CURRENTLY OCCUPIED BY ANOTHER PLAYER (not a player tile) — `getValidTakeFlightDestinations()`/`isValidTakeFlightDestination()`, shared by the human drop-handler (game-ui.js) and the bot's `driveTakeFlightDrag()` (bot-effects.js, now a uniform-random pick, no strategic model). Cancels with no drag UI at all if no valid destination exists. Self-target: caster chooses. Opponent-target: the TARGET chooses — see the `takeFlightState` entry above and lobby.js § Take Flight for the multiplayer hand-off and the bot-driver same-client special case. The scroll always stays in the caster's active area now — the old "opponent target → scroll moves to their hand" disposition rule was dropped.

---

## response-window.js — Deep Notes

### Response eligibility
A player can respond if:
1. They have a response/counter scroll castable: in active area, common area, or hand + open active slot
2. The scroll's stone pattern is formed around their current position
3. They have enough AP (normally 2)
4. The response window is open (15s after cast)

### Window gating (canAnyPlayerRespondOrBluff)
The window only opens when a non-caster, non-bot player either meets the full
response eligibility above, OR qualifies for a bluff (canPlayerBluff): a hand
scroll whose ELEMENT matches a response/counter scroll whose formation is
currently up for them, plus an open active slot and ≥ 2 AP, and only when another
HUMAN seat is in the game (`hasOtherHuman`; against bots only there is nobody to fool,
owner report 2026-10-07). Bluffers see a
window with no scroll cards so opponents can't tell they have nothing to play.
If nobody qualifies, the cast resolves instantly with no waiting screen.
Bots DO respond (BotEffects.decideResponse(), driven by bot.js in the arena
and bot-driver.js's respondForBots() in real multiplayer) and count as
expected submitters during arbitration — they're only excluded from the
bluff branch (they decide deterministically, not performatively).

### Bot submissions never tear down the host's own window
playerPasses()/playerResponds() close THIS screen's modal + countdown only (playerResponds also logs a local human's response as a scroll cast via gami.onScrollCast, for the Scroll Master badge)
when the submitter is the local human (localResponderIndex()), and
checkAllPlayersResponded() only swaps in the "waiting for others" spinner
once the local human has submitted. Without these gates, the host's client
— the one that submits passes/responses on behalf of every bot via
respondForBots(), and arbitrates when a host-driven bot is the caster —
had its own still-open response window auto-cleared the moment any bot
(or, while arbitrating, any remote player) submitted first.

### Conflict resolution
If two players respond simultaneously, higher-rank element wins:
`Void > Wind > Fire > Water > Earth`
Same rule applies to stone conflict on the board.

### Telling everyone what happened (2026-10-01, match 43)
- `announceOutcome()` first calls `window.CastFX?.resolve?.(results)` (countered cast shatters, counter scroll gets its own cast effect, js/cast-fx.js), then shows a banner (`.response-outcome-banner`) + status on every client: "X's Psychic
  countered Y's Pyre!", ransom paid, responses, and lost ties. The resolving client calls it in
  `finishResponseResolution`; the others via lobby.js `response-resolved` -> `afterRemoteResolved()`
  (they also get a Game Log line, type `responseOutcome`; the resolver already logs its own).
- Psychic ransom: before the prompt the resolver broadcasts `psychic-ransom-pending`; the others show
  "Waiting for Y to decide whether to pay 2 AP" (`showRansomPending`) until the result arrives.
- Ties: `_arbitrateAndResolve` keeps the losers (`lostTies`, sent in `response-resolved`). A losing
  response has no effect and its AP is refunded on the client that paid it (`_paidResponses`,
  `refundPlayerAP`); the owner agreed (2026-10-01). Before, the loser's AP was spent silently.

### Stack resolution
- Response resolves BEFORE the original cast takes effect
- A response cannot itself be responded to (no counter-counter)

### One response scroll per turn
- Every response/counter scroll definition carries `oncePerTurn: true`
  (set in `scroll-definitions.js` effect maps, propagated in `generateElementalScrolls`).
- Only ONE such scroll may actually resolve per turn — total, across all players.
- Guard flag: `ScrollEffects.responseScrollUsedThisTurn`. Set when a `oncePerTurn`
  scroll resolves (`resolveResponseStack()` on the arbitrator; the `response-resolved`
  broadcast handler in `lobby.js` for other clients). Reset in `clearTurnBuffs()`,
  which fires on every client at each turn transition.
- Enforced in `canPlayerRespond()`/`canPlayerBluff()`: once the flag is set, flagged
  scrolls are excluded, so later response windows in the same turn auto-pass.
