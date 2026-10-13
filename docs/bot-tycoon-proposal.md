# Bot Tycoon Proposal — player-facing bot ownership, breeding, and competition

> STATUS: REMOVED (Shop / Stable / capture taken out; tables dropped by sql/drop-bot-tycoon.sql, 2026-10-13). History below.
> Written for AI consumption. Old status: IN PROGRESS — build-order steps 1-4
> (below) have landed: `deployed_bots` table + "Deploy this bot" UI; the
> challenge flow (`record_deployed_bot_result` RPC + "Challenge other
> bots" UI, reward-crediting reusing the existing `award_gold`/
> `update_user_xp` RPCs); bots merged into the Leaderboard tab as a
> SEPARATE "Top Bots" section (not one interleaved list — confirmed with
> the user, since bots have no XP to sort against players with); and
> Capture Stones (`user_profiles.capture_stones` + `captured_bots` table,
> deliberately database-backed rather than following this project's
> existing localStorage-based shop-item convention — see TODO.md's
> "Economy / purchases" entry); and step 6, pulled forward out of order
> (real bots in multiplayer games now carry their own per-bot weights
> instead of sharing one global table), plus two things it unlocked: a
> win-screen "Capture a Bot" picker, and dedicated Shop/Stable tabs in the
> Profile modal (Capture Stones now sold in Shop, not the Bot Training
> panel). Stable's Train button — initially deferred, then built once the
> user asked directly — opens the Bot Training panel pre-loaded with a
> specific deployed bot's weights; Evolve writes improvements back to that
> bot quietly, Hill Climb ALSO keeps sharing to the community leaderboard
> and rewards dethroning the online champion (250 XP + 50 gold). Step 5 not
> started. Not
> scoped into `bot-roadmap.md`'s stages. Read this top to bottom before touching any
> part of it; several pieces below deliberately simplify or reject an earlier
> version of the idea for concrete technical/trust reasons — don't re-propose
> the rejected versions without re-reading § REJECTED ALTERNATIVES.

---

## CONCEPT

Players own, name, train, and deploy individual bots (weight tables) that
compete on the existing XP leaderboard alongside human players. Bots can be
"captured" (copied) from opponents encountered in play, bred from champion
files (already possible), trained via self-play or a lightweight in-browser
version of the hillclimb tool, and customized with elemental consumable
items. Framed as "training Pokémon," but every mechanic maps onto systems
that already exist in this codebase — see § WHAT ALREADY EXISTS below.

## CORE LOOP

1. Train/capture a bot → deploy it with a nickname.
2. Your deployed bot sits on the shared leaderboard as a challengeable entity.
3. Other players challenge bots within a rank window of their own position.
4. Challenger's own browser runs the match locally (see § CHALLENGE EXECUTION
   — this is the piece that makes the whole thing tractable without new
   backend infrastructure).
5. Win → challenger gets XP, bot owner gets gold (win or lose, owner gets
   something — small on a loss, more on a win). Reward scales with the
   target's leaderboard rank (bounty-style: punching up pays more).
6. Repeat — train harder, deploy higher, get challenged more, earn more.

---

## WHAT ALREADY EXISTS (reuse, don't rebuild)

| Need | Existing piece |
|------|-----------------|
| Purchasable items with gold | `shop_items` table (schema exists, 0 rows, unused) + `emoji-system.js`/`cosmetics-system.js` purchase/equip pattern |
| A place bot weight tables already live | `bot_champion_weights` (weights jsonb, win_rate generated column, confirm_wins/losses/draws, created_by) |
| Local bot-vs-bot execution, no server involved | `BotArena.playMatch(weightsPerPlayer, opts)` — already runs a full game client-side |
| Improving a SPECIFIC deployed bot | Stable's Train button (`gamification-ui.js`) — opens the training panel pre-loaded with that bot's weights, writes a successful run back into its own row |
| Shared leaderboard UI | `gamification-ui.js` Profile modal, Leaderboard tab (currently human-only) |
| XP/gold economy | `js/gamification.js` (`window.gami`), `user_profiles.total_xp/gold/stats` |
| Reliable, champion-anchored bot trainer | `BotArena.hillClimb()` — being wired into the training panel as a separate mode from `evolve()` (see `planning/current.md`, tracked independently of this proposal) |

---

## SYSTEM: DEPLOYED BOTS (new)

**Gap this fills:** today every bot in a lobby shares ONE global `WEIGHTS`
table (`bot-driver.js`: "all bots share whatever champion weights WEIGHTS
currently holds"). There is no concept of an individually-owned, individually
ranked bot. This is the one genuinely new data-model piece everything else
depends on.

New table, e.g. `deployed_bots`:
```
id, owner (uuid → auth.users), nickname (text), weights (jsonb),
elo_or_xp (int), wins (int), losses (int), deployed_at, updated_at
```
- Player names their bot (trivial text field, no design questions).
- A player may deploy their currently-trained `WEIGHTS`, a bred champion
  file, or a captured bot (see below) — same jsonb shape as
  `bot_champion_weights.weights` throughout, so no conversion needed anywhere.
- **Also fixes the "wild bot" identity problem for free:** lobby bots
  (`🤖 Add Bot`) currently all share one weight table. Once `deployed_bots`
  exists, each lobby bot slot could draw a DIFFERENT random deployed bot
  (rarity-weighted by its ladder rank) instead of the single shared `WEIGHTS`
  — makes multi-bot lobbies varied AND makes "which bot did I just fight"
  meaningful, which the capture mechanic below needs to make sense.

---

## SYSTEM: CAPTURE STONES

- A `shop_items` row, cost in gold, consumed on use.
- Used after/during an encounter with a bot opponent (real lobby bot, or a
  challenged leaderboard bot) to attempt a **copy** — not a removal. The
  original owner keeps their bot; a successful capture just inserts a new
  `deployed_bots`-shaped row (or an unranked "collection" variant) owned by
  the capturer, containing a snapshot of the target's weights at that moment.
- Capture chance should scale with performance against that bot (closer
  game = better odds — Pokémon's low-HP-easier-catch, mapped onto e.g. win
  margin or how many of the bot's 5 elements it activated) — ties into stats
  already tracked (`user_profiles.stats.games_won`, `elements_activated`).
- Rarity tiers plausible (regular stone = only catches "wild"/lobby bots;
  rarer tier needed to copy an actual ranked leaderboard bot) — mirrors
  `emoji-system.js`'s existing 6-tier structure.
- Needs a growth cap per player (a `deployed_bots`-style personal collection
  table, not an unbounded jsonb array) — this codebase is consistently
  disciplined about bounding growth elsewhere (hall-of-fame FIFO cap in
  `bot-arena.js`, `action-log.js`'s 3000-entry cap) — follow the same pattern.

---

## SYSTEM: CHALLENGE EXECUTION (the piece that makes "passive defense" tractable)

**The trap to avoid:** a bot "defending the ladder while its owner is
offline" sounds like it needs the bot to run somewhere without a browser
open — i.e. the Runtime Track's R4/R5 (server-side bot execution), which
`bot-roadmap.md` scopes as a real, currently-unstarted lift (no persisted
game state server-side, would need real backend rule-porting — see that
doc's R3 section for why that's expensive).

**The actual answer: the challenger's browser runs the whole match.**
`BotArena.playMatch([challengerWeights, targetWeights], opts)` already runs
an entire game locally, client-side, using only two weight tables passed in
— no server execution needed for either side. So:
1. Challenger picks a target within their rank window.
2. Challenger's client fetches the target's `deployed_bots.weights`.
3. Challenger's client runs the match locally (against their own bot, or
   plays it themselves as a normal single-player-vs-bot game).
4. Challenger's client reports the result, crediting XP to themselves and
   gold to the (possibly offline) target's `deployed_bots`/`user_profiles`
   row via a normal DB write — no execution problem, it's just a write to a
   different user's row, same as e.g. `bot_champion_weights` submission
   already does today.

The defending bot never executes anywhere while its owner is offline — the
"defense" is simulated on demand, exactly once, inside whoever initiates the
challenge. This is more efficient than true passive execution would be
(zero cost when nobody's challenging) and needs zero new execution
infrastructure — only the `deployed_bots` table and a challenge/reward UI
flow.

**Residual, honest, non-blocking trust note:** the challenger's client is
self-reporting the outcome that credits both their own reward and the
target's. This is the same trust level the rest of the game's economy
already runs on (client-computed XP/gold awards, client-submitted
`bot_champion_weights` confirm records) — not a new category of risk, just
worth knowing it's there.

---

## SYSTEM: REWARD ECONOMY

- Rank-window matchmaking: a bot/player may only challenge targets in
  `[R_current, R_current + Δ]` — prevents farming far-below opponents.
- XP scales down toward the bottom of the window (beating a near-peer pays
  more than beating someone barely above the floor) — pushes toward
  challenging upward.
- Reward split: winner gets XP; the TARGET's owner gets gold regardless of
  outcome (small on a loss, more on a win) — the "why deploy a bot at all"
  incentive, since a deployed bot earns its owner something just by existing
  on the ladder and getting challenged.
- Reward magnitude scales with the target's rank (bounty-style) — matches
  the existing badge/leaderboard framing of "higher rank = more prestigious."

---

## SYSTEM: ELEMENTAL WEIGHT-BUNDLE ITEMS

One-time-use consumables (another `shop_items` type) that nudge a
**pre-validated, correlated bundle** of weights toward a personality —
never a single raw weight in isolation. This constraint is not aesthetic:
we directly tested pushing a single correlated cluster (movement-efficiency
weights) toward the online champion's values in isolation and it made the
bot measurably WORSE (37% vs. plain-default's 47% against the same
opponent, 30-game series — see `planning/current.md`'s "Hypothesis test —
FALSIFIED" entry). These weights interact; bundles must move together.

| Element | Theme | Candidate bundle (nudge up unless noted) |
|---------|-------|-------------------------------------------|
| Earth | Stable, confident, straightforward | `placeEarthBlock`, `placeSelfBlockPenalty` (careful terrain control); `moveFixation` up, `moveExploreGradient`/`moveExplore` down (commits to a direct path); steady `placeProgress`/`castBase` |
| Water | Flexible, adapts to opponents | `evalOpponentThreat`, `evalCommonThreat` up; reactive `discardResponseOnly`. (This pair is the single largest real gap measured between `DEFAULT_WEIGHTS` and the actual online champion — +73%/+36% — so this bundle is pushing a *validated* real advantage, not a guess.) |
| Fire | Aggressive | `placeFireThreatBreak` up; `evalActivated`/`endTurnOnShrine` down + `moveReturnHome` up — less hoarding, more urgency once win-eligible (also matches the real champion's actual tuning direction vs. defaults) |
| Wind | Prosocial, movement efficiency | `placeWindPath` up; efficient `moveExplorePath`/`moveApPenalty`; `placeEarthBlock`/`placeFireThreatBreak` DOWN — races its own path, doesn't fight |
| Void | Smart / creative | Mechanically distinct from the other four — bump `searchDepth`/`searchBreadth` (deeper lookahead) and/or `evalVoidHeld`/`shrineVoidBonus`, rather than a personality-weight nudge. Matches Void's in-game identity (Create, Scholar's Insight, Transmute — the utility/cleverness element) and gives Void a genuinely different lever instead of a fifth flavor of the same trick. |

Bundle values themselves should be derived from real online-champion deltas
(the diff methodology already used once — see `planning/current.md`'s
weight-diff findings) or from targeted future hillclimb-style experiments,
not hand-guessed numbers.

---

## TRAINING TOOL INTEGRATION

- **Self-play against your own deployed bot** — already possible via
  `BotArena.spectate()`/local arena; no new work.
- **Training a SPECIFIC deployed bot** — DONE. Stable's Train button
  (`gamification-ui.js`) loads that bot's weights and opens the panel; a
  successful Evolve run writes back to that bot's own row, a successful
  Hill Climb ALSO shares to the community leaderboard and rewards
  dethroning the online champion (250 XP + 50 gold). See
  `planning/current.md`'s "STABLE: Train button" entry. The panel's
  "Breed from champion files" upload flow was removed per explicit user
  request — it never had a bot-ownership concept anyway (produced a
  downloadable file, not a deployed/captured bot).
- **Lightweight in-browser hillclimb** — this is the separately-tracked
  "Hill Climb as a training-panel option" work (see `planning/current.md`);
  this proposal assumes it lands and deployed bots become a natural
  source/destination for that flow (train → deploy → get challenged →
  earn → train further).
- **"Programmatic neural improvements"** — maps to `bot-roadmap.md` Stage
  3c (Neural RL), explicitly scoped there as optional and LAST, gated on
  self-play throughput this proposal doesn't change. Not assumed here.
- **PRIVATE TRAINING HISTORY (backlog — user-specified 2026-07-19, not
  built).** Log each Train-button run against the specific deployed bot:
  date, method (Evolve / Hill Climb), Players mode (2 = duelist, 3-5 =
  size specialist, All = generalist), and outcome (improved-and-applied
  vs no improvement). Three binding design decisions from the user:
  (1) **Owner-only visibility** — the history is the trainer's private
  notebook, shown in the Stable only, never on the leaderboard/challenge
  list. ARCHITECTURAL CONSEQUENCE: it CANNOT be a column on
  `deployed_bots` — that table is public-SELECT by design (leaderboard/
  matchmaking browse it) and Postgres RLS is row-level, not column-level,
  so a history column would leak to everyone. It needs its own table
  (e.g. `bot_training_log`: bot_id FK → deployed_bots on delete cascade,
  owner, method, players_mode, improved, created_at) with owner-only
  SELECT/INSERT RLS — the same pattern `captured_bots` already uses.
  (2) **NOT carried over on capture** — capturing a bot copies its
  weights (the abilities) but never its training history (the previous
  trainer's records); a bot deployed from a capture starts a fresh,
  empty log. The separate-table design enforces this for free: capture
  inserts no log rows, and the log's owner-only RLS means even a leak
  path would show the capturer nothing.
  (3) No public "Duelist/Generalist" tag for now — the earlier idea of a
  visible lineage badge was explicitly narrowed to owner-private history.

---

## REJECTED ALTERNATIVES (don't re-propose without addressing these)

**Server-side "always-on" passive bot defense.** Rejected because it
re-imports the Runtime Track's R4/R5 problem (needs execution without a
browser open — no persisted server-side game state, would need real
backend rule-porting). Replaced by challenger-side on-demand execution
(§ CHALLENGE EXECUTION above), which needs none of that.

**"Decentralized verification" — other players' idle browser tabs silently
cross-verify community champion submissions.** Rejected for two reasons:
(1) browsers throttle/suspend JS in inactive/background tabs — there's no
reliable way to run games in a tab the player isn't actively using; (2) it
would make the mechanism that crowns the GLOBAL default bot (auto-applied
to everyone's games) depend entirely on aggregated, unverified client
self-reports — a real cheating surface, not just a cost. Champion promotion
should stay an explicit, single confirmation run (as it already is today,
and as the Hill Climb panel work already does), not a crowd-sourced
consensus.

---

## OPEN QUESTIONS (not yet decided)

- Exact capture-chance formula and rarity tiers for capture stones.
- Exact XP/gold numbers for the rank-window falloff and win/loss split —
  needs balancing against the existing XP economy (`gamification.js`).
- Whether a captured/deployed bot's *nickname* and *lineage* (bred-from
  history, à la the training panel's existing "bred #X×#Y" labels) should
  be visible to other players, and whether that's cosmetic-only or affects
  anything mechanically.
- Cooldown / one-attempt-per-encounter to prevent capture-stone farming.

## SUGGESTED BUILD ORDER

1. **DONE.** `deployed_bots` table + naming + "deploy my current bot" UI
   action. See `planning/current.md`'s "BOT TYCOON step 1" entry for the
   exact schema/RLS and the one deliberately-deferred gap (recording a
   challenge result needs a `SECURITY DEFINER` RPC, not a loosened UPDATE
   policy — scoped for step 2, not built yet).
2. **DONE (simplified).** Challenge flow: local match execution + reward
   write via `record_deployed_bot_result` +the existing `award_gold`/
   `update_user_xp` RPCs. Simplified from the original spec: bot-vs-bot
   (not interactive human-vs-bot), and target list is "top 10 by win
   rate" rather than real rank-window matchmaking — that needs step 3's
   unified leaderboard to mean anything. See `planning/current.md`'s "BOT
   TYCOON step 2" entry for exact reward amounts and a status-clobbering
   bug caught during verification.
3. **DONE (as two sections, not one interleaved list).** Leaderboard UI:
   bots now show in the existing Leaderboard tab under their own "Top
   Bots" section, sorted by win rate — see `planning/current.md`'s "BOT
   TYCOON step 3" entry.
4. **DONE — as a real `user_profiles.capture_stones` column + `captured_bots`
   table, NOT the `shop_items` row originally envisioned here.** `shop_items`
   turned out to be unused/vestigial — this project's actual existing shops
   (emoji/cosmetics) hardcode items in JS and persist ownership to
   localStorage, a real gap now flagged in `TODO.md`. Capture stones were
   built database-backed from the start instead of copying that pattern.
   See `planning/current.md`'s "BOT TYCOON step 4" entry for the exact
   capture-chance formula and cost.
5. Elemental weight-bundle items (needs validated bundle values, ideally
   derived the same way the Water/Fire bundles above already were).
6. **DONE — pulled forward out of order**, once the user explicitly asked
   for it while discussing win-screen capture ("I think we should be able
   to pick the bot we're capturing, as, ideally, the bots in the game are
   actually different and pulled from different uploaded bots on the
   leaderboard"). Real multiplayer bots now draw from `deployed_bots`
   (`players.bot_weights`/`bot_source_id`) instead of sharing one global
   `WEIGHTS` table — see `planning/current.md`'s "BOT TYCOON step 6" entry
   for the schema, the `bot-driver.js` save/swap/restore mechanics, and the
   win-screen capture picker + Shop/Stable tabs it unlocked.
