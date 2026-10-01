# docs/ — Documentation Index

> See parent: [CLAUDE.md](../CLAUDE.md)

---

## FILE MAP

| File | Purpose |
|------|---------|
| `game-design-document.md` | Canonical game rules: tile mechanics, shrine system, scroll patterns, win conditions, stone abilities, elemental hierarchy, balance notes |
| `bot-roadmap.md` | Bot improvement pathway (Stages 0–3, written for AI executors). Stage status, API contracts for `BotState`/`BotSystem`, gotchas (globals not on window, pool aliases), and step-by-step specs for the forward model, self-play arena, and learning stages |
| `network-resilience.md` | Plan for network drops, refreshes and rejoining a live game: what exists (refresh guard, reconnect grace, recorder, replay engine, fingerprints), Phase 1 catch-up after a short drop, Phase 2 rejoin after refresh + host Wait / Kick, Phase 3 host drops, owner decisions D1-D5, Playwright test plan |
| `twitch-votes.md` | PLAN (not built): Twitch chat votes on bot moods and casts in "Stream games" (anonymous chat read, vote box, no rewards in stream games) |
| `bot-tycoon-proposal.md` | IN PROGRESS, steps 1-4 + 6 done: player-owned/named/deployed bots on a shared leaderboard, challenge-and-earn economy, capture stones (now sold in a Shop tab, used via Challenge/win-screen), real per-bot variety in multiplayer games (no more one-shared-WEIGHTS-table), a Stable tab for managing your bots. Step 5 (elemental weight-bundle items) not started. Explicitly rejects server-side "always-on" bot defense and decentralized client-verification in favor of on-demand challenger-side execution — read before re-proposing either |

---

## game-design-document.md — Key Rules Summary

> Read the full GDD for balance decisions. This is a quick-reference extract.

### Win condition
Activate one scroll of each element type (Earth, Water, Fire, Wind, Void), then
return your pawn to the centre of your own player tile (the "player shrine").
Both parts are required — the win fires the moment the pawn stands on the shrine
centre with all five elements activated (gate: `checkWinCondition()` in game-core.js).
Catacomb scrolls are dual-type and count toward two conditions simultaneously.

### Elemental rank (high to low)
`Void > Wind > Fire > Water > Earth`
Used for: stone conflict resolution, response scroll priority, stone break AP cost.

### Stone abilities
| Element | Effect |
|---------|--------|
| Earth | Blocks movement (impassable) |
| Water | 2 AP to pass; adapts to adjacent Earth (block) or Wind (free) |
| Fire | Destroys adjacent stones on placement (not Void, not Fire) |
| Wind | 0 AP to pass through |
| Void | Raises player's AP maximum; nullifies adjacent stones' effects |

### Stone break cost
Right-click a stone to remove it. AP cost = stone's rank number:
`Earth=5, Water=4, Fire=3, Wind=2, Void=1`

### Shrine stone yield (end-of-turn)
`Earth=5, Water=4, Fire=3, Wind=2, Void=1`
Max 25 of each type across all players (shared pool).

### Catacomb tiles
- Flipping one: `+1 AP` refund + draw a catacomb scroll
- Ending turn on center: no stones (non-elemental)
- Catacomb scroll: dual-type, counts 2 win conditions

### Response scrolls
- Level 1 scroll of any element
- Can only be played during another player's action
- Requires 2 AP + player in center of pattern
- If two players respond: higher rank element resolves first

### Player tiles
- Stones can never be placed on a player tile, including its bridge hexes (own or opponent's).
- Movement onto the **centre** hex of another player's tile is blocked; your own centre stays
  reachable (required to win). Gates: `isPositionOnPlayerTile()` (placement) and
  `isOpponentTileCenter()` (movement, called from `canPlayerMoveToHex()`) in game-core.js.
