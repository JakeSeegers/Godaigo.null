# Current Active Work

> This file is the session start point. Update it at the end of every work session.
> Claude: read this first, then drill into the relevant INDEX.md before touching source.

---

## Active Branch
**Update 2026-09-27:** the game repo is now `JakeSeegers/Godaigo.null` (private). The name
`JakeSeegers/Godaigo.Elements` now belongs to the tiny public redirect repo (tools/old-address-redirect/).
Push game work only to Godaigo.null, branch `fixes/all-consolidated`.
**Update 2026-09-24:** the live branch is now `fixes/all-consolidated` (confirmed by
the owner). The notes below about `claude/missing-video-filename-sc1ajm` are history.

`claude/missing-video-filename-sc1ajm` → remote: `JakeSeegers/Godaigo.Elements`
— confirmed as the single canonical branch (2026-08-09): this is what GitHub
Pages actually deploys (Settings → Pages), and it's a superset of every other
branch's real work. `claude/game-starting-tiles-mode-aabsrh` (this file's
previous pointer) was checked and is dead: its only 2 commits beyond the
shared ancestor with sc1ajm are trivial manual asset uploads (an image, a
video rename) already superseded by sc1ajm's own later fix for the same
thing; everything substantive it ever had (Scarce Tiles Mode) is already
included in sc1ajm via that shared ancestor — verified present in
`js/game-core.js`/`js/lobby.js` on sc1ajm. No session is currently running
against aabsrh (checked via `list_sessions` — the two that touched it,
01LB18X and 01AzhV69, are both idle/disconnected; 01AzhV69 is in fact the
session that forked aabsrh into sc1ajm in the first place and pushed all the
boot-splash work). Treat any other `claude/*` branch on this repo as either
merged, superseded, or a genuinely separate feature with its own open PR —
not a silent fork of current work — until checked the same way.

## Open question — SUPERSEDED, needs re-anchoring if resumed: weight-tuning
## ceiling vs. missing feature (HANDOFF.md §3)
Investigated on the now-dead `aabsrh` branch, before sc1ajm's subsequent
boot-splash and scroll-ability work existed. Not known to be invalidated by
that work (Take Flight/Shifting Sands don't touch the bot evaluator), but
the investigation itself (hillclimb session state, `tools/.cache/hc-session-
anchored1.json`) lives against aabsrh's code, not sc1ajm's — re-verify
against sc1ajm before trusting the session-resume command below if this
gets picked back up. Kept here as read-only research context, not live work.
No code changes were made — investigation only, picking up HANDOFF's "are we
at the ceiling, or does the bot need a new sense" question.

**anchored1 hillclimb session, 4 rounds so far (720 games):** 3 promotions
(rounds 1, 3, 4), one round with no challenger clearing the bar (round 2).
Confirm-vs-original-online-baseline results per chunk: 50%, 80% (same
champion as the 50%, different 20-game sample — same champion scored
wildly differently twice), 55%, 25%. No sustained upward trend — bouncing
around the 55% promotion threshold rather than pulling away from it.
`tools/.cache/hc-session-anchored1.json` holds full state; resume with
`node tools/arena-headless.mjs --hillclimb --hc-session anchored1 --hc-rounds 1 --shards 6 --hc-games 30 --hc-hof 0`.

**Weight diff (online champion's Supabase row vs. `DEFAULT_WEIGHTS`):** two
findings. (1) The stored champion row is **missing all 6 Stage-4 tactical
weights** (`placeEarthBlock`, `placeFireThreatBreak`, `placeWindPath`,
`placeSelfBlockPenalty`, `placeTacticalBase`, `placeTacticalStarvesPlan`) —
it predates Stage 4 and nobody has resubmitted since, so it's running that
whole layer on code defaults. Not necessarily a search blocker (`mutate()`
perturbs these same keys, since it only excludes the 3 brain-shape keys),
but worth knowing. (2) Several LARGE, coherent weight deltas, not noise:
`evalOpponentThreat` +73%, `evalCommonThreat` +36% (more opponent-aware);
`evalActivated` −52%, `endTurnOnShrine` −39%, `moveReturnHome` +31% (less
inclined to over-collect, more eager to just walk home once win-eligible);
`discardResponseOnly` +99% (dumps response-only scrolls much faster,
matching the known common-area-clog issue). Every one of these terms
already exists in our evaluator — this is a different, better-tuned POINT
in the same weight space, not evidence of a missing feature.

**Visual + logged confirmation (online champion vs. `DEFAULT_WEIGHTS`,
seeded replay, real headless capture of `window.ActionLog.entries()` — not
a manually downloaded file, which turned out to be a stale unrelated log
from an earlier session):** champion won decisively both times watched
(5v3 activated in 59 turns visually; 5v4 in 73 turns in the logged replay).
User's live-watch impression ("pretty derpy") was specifically about
wandering/backtracking, confirmed in the data: `DEFAULT_WEIGHTS` took 643
move actions to `ONLINE CHAMPION`'s 384 across a similar number of turns
(~7.7 moves/turn vs ~4.5) — default wanders far more before committing,
consistent with the `moveExploreGradient`/`moveRevisitPenalty`/shrine-value
deltas above. Immediate-backtrack rate was similar for both sides (5-8%),
so this isn't a NEW oscillation bug — existing movement weights are just
tuned worse by default.

**Read so far: this argues AGAINST needing a new evaluator feature.**
Every behavioral gap observed traces to existing terms being weighted
differently, not to something the bot structurally can't perceive. The
4-round hillclimb's noisy, non-trending confirms look more like a search
problem (the (1+λ) climb drifts round-to-round vs. its immediate
predecessor only, never re-anchored to the ORIGINAL online baseline until
the end-of-chunk confirm — so it can wander away from a good region just
as easily as toward one) than a ceiling problem.

**Hypothesis test — FALSIFIED: isolated movement-weight nudge, worth NOT
repeating.** Tried the cheap version of "confirm the diff's story directly"
before going back to more hillclimb rounds: built `nudged` = 
`DEFAULT_WEIGHTS` with ONLY the 9 movement-related keys
(`moveExploreGradient`, `moveRevisitPenalty`, `moveShrineValue`,
`moveFixation`, `moveExplore`, `moveExplorePath`, `moveBase`,
`moveApPenalty`, `moveReturnHome`) overridden to the online champion's
actual values, leaving everything else (including the non-movement deltas
like `evalOpponentThreat`/`discardResponseOnly`) at plain defaults. 30-game
series vs the online champion, same seed as the plain-DEFAULT-vs-champion
control: **nudged went 11-19 (37%) — WORSE than plain DEFAULT_WEIGHTS'
14-16 (47%) in the identical matchup.** A single mechanistic replay
(moves-per-turn) was inconclusive on its own (seat/seed interactions make
one game's move-count hard to compare across different pairings), but the
30-game win-rate is the real signal and it's unambiguous: pulling movement
weights toward the champion's values IN ISOLATION, without the other
correlated shifts, made the bot play worse, not better.

**Conclusion: the champion's weight table is a co-adapted PACKAGE, not a
sum of independently-swappable terms.** Don't retry single-axis or
small-subset manual nudges — they backfired here and likely will again
for the same reason (these weights interact; moving one without its
correlated partners breaks whatever balance existed). The path forward is
either (a) more hillclimb rounds, since it searches the full joint space
rather than a hand-picked subset, or (b) as a sanity check, confirm that
applying the online champion's FULL weight table (not a subset) reliably
beats defaults at the expected ~60% clip — already informally confirmed
via the two watched games (5v3, 5v4 activated, decisive both times), so
the champion-as-a-whole is not in question, only whether OUR SEARCH can
reach/beat it from here.

## Last Committed Work
- **2026-10-01: Opponent Status panel + catacomb look (player feedback).** (1) The panel was hard to
  read: cards are now labelled rows (Won n/5 with the 5 element symbols lit, Stones, Hand n with each
  scroll's element, Active chips with icon + name, hover = preview). (2) Your own Hand count stayed at 0:
  the panel only refreshed on network messages, stone changes and turn changes; updateScrollCount() now
  calls window.scheduleOpponentPanelRefresh(). (3) The catacomb symbol was invisible: Catacomb.webp is
  black and .element-icon-sm uses mix-blend-mode: screen. window.ScrollLook (game-core.js) draws it as a
  CSS mask filled with the scroll's two element colors, and catacomb scrolls use both colors everywhere
  (opponent panel, Hand/Active/Common cards and previews, scroll popup, response window, Game Log)
  instead of void-like purple (#9b59b6; --catacomb-color is now the tan stone color). (4) New
  window.PlayerFlash: click a pawn, player shrine or Opponent Status card -> all three glow in that
  player's color for 1.3 s. css/components.css also has old .opponent-* rules but is not loaded anywhere.
  Owner follow-up: the Opponent Status hand row must NOT show a catacomb's two colors (like a face-down
  Magic card, others only know it is a catacomb scroll): it uses ScrollLook.iconHtml('catacomb') = plain
  light tan #eadfc8. Your own Hand panel still shows the colors. ScrollLook.elementOf now accepts a bare
  lowercase element ('catacomb', 'earth'); it returned nothing before, which also blanked the inventory
  group label icons.
  Player shrine (owner): tint circle opacity 0.15 -> 0.38; .player-tile-border path in the player's
  color (playerTileOutlinePath: unshared edges of createTileGroup's polygons); element symbols are one row
  below the center hex, always earth, water, fire, wind, void left to right, empty faint rings for elements
  not won yet (drawn as soon as the tile is placed); levelPlayerTileSymbols() keeps the row level when the
  map is turned (called from updateViewport when viewportRotation changed).
  Black bars / flat cuts through tiles on the tilted board (owner screenshots): the tilted board is one
  big 3D layer Chrome paints in wide strips; every drag-pan frame rewrote the viewport transform and
  repainted all of it, and strips that fell behind (or were wrongly judged off screen under the
  perspective) showed as flat cuts with the background through them. Stones with pulsing rings are
  separate compositor layers (CDP LayerTree), so they stayed visible over the gaps. Fix: game-core.js
  beginFastPan()/endFastPan() (called where game-ui.js sets isPanning): during a pan updateViewport()
  only sets a CSS translate on #boardSvg (will-change: transform) equal to the rotated pan delta;
  release writes the real transform once. effects-system.js tileToScreen adds getBoardPanShift().
  Verified identical placement (drift 0 at 0 and 50 deg). Not verified on a real GPU: owner to retest.
  Owner: panning fix works.
- **2026-10-01: Undo fuzz test + fixes.** Bots play real local games (BotArena.playMatch); the test wraps
  window.BotState.applyAction, makes the same undo records the UI does, clicks the real Undo button at
  random and checks: the state before the undone action comes back exactly, or nothing changes when undo
  must be refused; stone totals (board + pools + source) and pawn / stone DOM counts stay right; no
  duplicate scrolls (scratchpad undo-fuzz.mjs; scripted UI cases in undo-test.mjs). Found and fixed:
  (1) executeSpell no longer cleared undo (the 2026-08-13 fix 10bbac5 was lost): Undo after a cast
  reversed the move/stone before it for free; (2) catacomb/Freedom teleport did not clear undo (same
  refund); (3) Undo of a move / stone break called refreshVoidAP(), refilling void AP from the pool
  (spent void stones came back): now updateVoidAP(); (4) scroll-panels.js set `window.lastMove = null`,
  which never reached the script-scope `let lastMove`, so Undo after a scroll move reversed the earlier
  pawn/stone action: now window.clearPawnUndo() (also on hand -> active); (5) stone-place undo record
  used nextStoneId - 1, which can be another stone after a moved stone bumped the counter: now the id
  placeStone() returns, and undo falls back to type + position; (6) Undo is refused when it is not your
  turn or mid-drag; (7) undoing a void stone placement gives back the void AP it took (prevVoidAP).
  New helpers in game-core.js: window.clearUndo(), window.clearPawnUndo(). Seen, not changed: a scroll's
  default effect adds stones to the pool without taking them from the source (looks intended).
  (5) Void AP: updateApPips(ap, void) adds one purple .ap-pip.void per void AP after the five pips;
  pawn-drag step numbers (updatePathLabels) show AP left INCLUDING void AP (purple while paid by void,
  which spendAP uses first) and are counter-rotated by viewportRotation so they stay upright. Owner also
  reported pawn/stone drag-and-drop being hard after rotating the map: could not reproduce (scratchpad
  rot.mjs / rot2.mjs: screen->world is exact at 0/37/45/90/180 deg with the 20 deg tilt, and a real mouse
  drag lands on the hex under the cursor). Waiting on details (browser, mouse or touch).
- **2026-10-01: Match 43 review (4 humans, room 871) and fixes.** Found: (1) source pools were never
  synced (shrine collection only changed the collector's board), and casts sent their full element list
  even when the caster's empty-source rule refused it; responses/counters had no rule at all -> earth
  counted after the earth source was empty. Fix: `source` in player-state-update, granted-only element
  broadcasts, `spellSystem.grantElements()`. (2) Scrolls copied when moved to the common area by
  Sacrificial Pyre / Psychic (common-area-update never removed it from the holder) -> receivers remove
  it everywhere; validateScrollState repairs and throttles (the game sent 4,415 sync requests and
  4,902 snapshots). (3) Board stones out of sync from turn 42: Undo of a stone placement returned it to
  the source AND the pool and removed it on other boards by local stone id; stone-break / stone-move now
  carry the position (receivers find the stone by position), undo gives the stone to the pool only;
  touch-moving a board stone placed a NEW stone; dropping a board stone on the Elemental Stones panel
  put it in your pool unbroadcast (owner: not a rule; now it goes back to its spot). (4) Sacrificial
  Pyre with no usable hand scroll is refused before AP is spent. Owner rules: recasting a countered
  scroll from the active area is allowed (if you have the AP).
  (5) The turn-42 split: CaptainConfuzion's connection dropped at the end of turn 40; on return the
  catch-up (game-pause.js) re-sent buffered messages they had already applied, including their own (old
  turn change: their turn came back with AP 5 at 01:48:45; old stones). Cause: every message, including
  the scroll-sync flood, was remembered in `seen` (400), pushing real ones out, while the 150-message
  buffer reached further back. Fix: sync/emoji not remembered; answer = only buffered messages after the
  oldest one the returner remembers, minus its own from the same page load. Scratchpad test reproduces
  it (old: 41 re-applied, new: only the 2 missed).
  (6) Plunge87's computer clock was 106.7 s slow (recording: server time minus his message timestamps;
  others within 0.5 s). The lobby hides a public room whose newest human heartbeat (players.last_seen,
  written with the client's clock) is over 90 s old, so his room was invisible; every turn after his also
  started 107 s short (turnStartedAt comes from whoever ended the turn). Fix: sql/server-clock.sql
  (server_now_ms(), trigger stamps last_seen = now()), window.serverNow() for turn starts, timer, lobby
  liveness and the host's 45 s lobby sweep. Note: the dropped connection at turn 40 was CaptainConfuzion,
  not Plunge87.
  (7) Counter feedback: at 01:56 squid's Psychic took 12 s to resolve because only the countered player
  (CaptainConfuzion) saw the ransom prompt; everyone else saw "waiting" ("I didn't counter it"). At 01:40
  CaptainConfuzion's Wind response lost the tie to TheHermit's Psychic silently, AP spent. Now: outcome
  banner + Game Log line for everyone, ransom-pending notice, lost ties told and refunded (owner agreed).
- **2026-10-01: Pot drop, show the gap** (owner: the tube looked blocked by the board). Drawing only, no physics or
  server change: coins drawn at true size (12, was 14), guard peg over the tube gold + mouth glow, slow motion
  (1/3) and a 3x close-up of the mouth while a hit or near-miss coin is there, walls flash on a hit.
- **2026-09-30: Pot drop v2, the treasure tube** (owner's idea, after the Hermit demo showed hits were hard to
  see). js/plinko-sim.js VERSION 2: the thin floor gap is gone; a tube (x 83.5, inner width 13 = coin + 1,
  height 47, walls 3) stands under the last-row peg at x 90, so a coin must come in at an angle around that peg.
  Hit = a coin reaches the floor inside the tube (slot -1); it falls onto the chest. Stuck push is now up and
  sideways, alternating and stronger each time (coins wedged between the peg and the rim at taller tubes).
  Measured over 500 drops: 0.96% per coin, 0 stuck drops; 10 coins win 7%, 30 = 26%, 50 = 44%, 70 = 54%.
  Tuning notes: a plain tube anywhere is 3-5% per coin; under the peg, height is the knob (46 = 2%, 48 = 0.95%
  but wedges, 51 = 0.2%). tools/plinko-tune.mjs has a sweep mode (XS / WS / HS env). Node, Chromium and Deno
  give the same slots; edge function pot-drop redeployed (version 2). pot-plinko.js draws the tube and steers
  coins from 80 units above the tube top.
- **2026-09-30: The pot drop (plinko)** (owner idea: "use the actual physics code to calculate if there's a win").
  The pot is no longer a hidden random() roll: sql/pot-plinko.sql (migration pot_plinko) records a pot_drops row
  (seed, coins = pot / 10, max 70) from finish_match; edge fn supabase/functions/pot-drop runs js/plinko-sim.js
  (Matter.js 0.19.0, vendored in js/vendor/) and settles/pays; js/pot-plinko.js replays it for every player at
  game over. Checked: same slots in Node, Chromium and Deno; odds measured (tools/plinko-tune.mjs) 10 coins 10.5%,
  30 = 29%, 50 = 43%, 70 = 55%. Coins bump into each other, which keeps each coin close to a separate 1% try (with
  coins passing through each other the coins followed the same lanes and 100 coins only won 15%). Also: the 🎁
  emojis are now the Pipoya Gift emote (sprite 76; Gold Coin 73, Treasure Chest 75). Not yet seen in a real online
  game: check the edge function logs after the first real pot drop.
- **2026-09-30: Gifts and the pot** (owner). sql/gifts-pot.sql (migrations gifts_pot, pot_fill_chance, pot_fill_chance_cap50): send_gift
  (100g, receiver 25-100g, rest to the pot, 1 gift received per UTC day, no guests), pot paid from finish_match (real
  human game, >= 100g, once per UTC day, chance 1% per 10g in the pot, max 50%; an earlier login-based chance was replaced), Hermit add-to-pot, badges Generous
  and Jackpot, animated gift / pot pop-ups, Shop > Features gift form. Also fixed my own backfill bug from the 9-badge
  update (31 wrong First Victory badges + 25g removed; sql/undo-wrong-first-victory.sql).
- **2026-09-30: 9 new badges** (owner). sql/more-badges.sql (migration more_badges, backfilled: TheHermit got Bot
  Breaker): Scroll Master (all 35 scrolls; response scrolls now logged from response-window.js playerResponds), Bot
  Breaker/Slayer/Bane/Machine's End (10/20/50/100 bots in paid wins, not last_standing), People's Champion (10 wins
  with another human), Lightning Win (real win in < 10 own turns), Emote Collector, Fashionista. Icons px-*.png (sheet
  positions: scroll_master 18,7; bots 13,14 / 53,14 / 53,15 / 72,12; peoples_champion 65,1; emote_collector 59,5;
  fashionista 130,11; lightning_win 64,0). Note: scroll_cast rows are client-written, so Scroll Master (like the old
  scroll badges) trusts the client.
- **2026-09-30: Pixel-art achievement badges** (owner). 8 icons from Raven Fantasy Icons (Clockwork Raven, open license;
  full sheet 32x32.png on branch main) cut to images/badges/px-*.png, badges.image set on the server (migration
  badge_pixel_icons), drawn pixelated (css), Credits line added. Sheet positions (row, col): first_steps 135,3;
  first_victory 2,8; scroll_apprentice 18,8; scroll_adept 6,1; veteran 45,0; champion 8,2; master 65,2; dedicated 62,0.
- **2026-09-30: Old test + guest accounts merged into TheHermit** (owner). 7 accounts deleted (jake2, JakeS, JakeS1,
  JakeS2, Jakeon, Guest58TA7A, GuestLXNE3T); TheHermit got +7325 XP, +2440 gold, ladder rank 1. sql/merge-test-accounts.sql.
- **2026-09-30: Lotus Leaf pawn base removed** (owner). Nobody owned it. Out of PAWN_ITEMS, pawn-cosmetics.js makeBase and
  cosmetic_price (sql/remove-lotus.sql, migration remove_lotus).
- **2026-09-30: Hermit rewards** (owner, for the stream). sql/hermit-rewards.sql (applied as migration hermit_rewards,
  tested in rolled-back transactions), js/rewards.js, js/hermit-rewards.js, images/badges/ (plunge.png + badges.json).
  Sign-up events (first N real accounts), game bounties (paid with the win in _pay_game_win), reward pop-ups, special
  image badges, badge slots (1 free, 700g each, max 3, Shop > Features), hidden reward-only pawn items
  pawn_rim_plunger (#9d2c2e) and pawn_trail_wetfeet (footprints). UI tested with a fake Supabase in Playwright; not yet
  tested signed in on the live site.
- **2026-09-30: Pause on drop + host Pause button** (owner). js/game-pause.js (see js/INDEX.md,
  docs/network-resilience.md). Built on `feature/pause-on-drop`, merged live the same day on the owner's call
  (no preview available to test first). Needs a real 2-browser online test; if broken, roll back in Cloudflare
  (godaigo > Deployments / Version History) to the 2026-09-30.1414 version.
- **2026-09-30: Cloudflare build repo fixed** (owner). Workers Builds still pointed at `JakeSeegers/Godaigo.Elements`
  (now the redirect repo, branch `main`) after the rename, so the site stopped at version 2026-09-30.1347.
  Reconnected to `Godaigo.null` / `fixes/all-consolidated`. This docs commit starts the first build from it.
- **2026-09-30: Refresh guard + reconnect grace** (owner, before a stream). Part A: "Leave site?" during a live
  online game. Part B: presence drops are hidden for 5 s, no last-player-standing win until 60 s, host turn timeout
  paused for a reconnecting active player, scroll sync requested on reconnect. NOT done (Part C, after the stream):
  keep the seat on refresh and rebuild the board from match_moves (replay engine) + fingerprint check, host
  Wait / Kick dialog, re-sending board moves missed during a drop.
  Full plan: docs/network-resilience.md (phases, owner decisions D1-D5, test plan).
- **2026-09-30: Background-tab savings for stream night** (owner). Lobby game list skips its 5 s refresh while
  the tab is hidden and runs the two cleanup RPCs (`cleanup_inactive_players`, `cleanup_ghost_rooms`) at most every
  30 s instead of every 5 s. Pawn cosmetics timers, the placement-tile overlay poll and the Game Log buffs /
  Alliances polls also pause while the tab is hidden. Network traffic was already small (turn-based broadcasts,
  batched match recording).
- **2026-09-27 (11): Bot alliances Phase 3: talk + pacts** (owner). See docs/bot-alliances.md "Phases". Tested in
  3-player games: warnings, offers, accepts, withdrawals, pact ends, thanks; player symbols (hex colours mapped);
  Game Log lines on time; screenshot shows emotes over pawns. Not yet seen in a test: Commit (strike), betrayal,
  decline, grudge (all rarer). Next: Phase 4 personalities.
- **2026-09-27 (10): Bot alliances Phase 2** (owner). Pressure per opponent (docs/bot-alliances.md "Phases") weights
  opponent progress in search, blocking, and Arson/Plunder targets; kingmakerFilter safeguard. Phase 1 blame fixes
  (own elements / stone gains never credited to others, camping only on scarce shrines). Next: Phase 3 (pacts, emote
  sentences, Game Log lines), Phase 4 (personalities).
- **2026-09-27 (9): Bot alliances Phase 1 (memory only)** (owner; docs/bot-alliances.md has the design, decisions and
  the emote vocabulary). js/bot-diplomacy.js: favor / trust per bot seat per player, threat + ally computed live, fed by
  ActionLog entries and turn ends (progress change blamed on the active player). Bot Mind shows "How it sees the others"
  + the last 3 notable events. No behaviour change yet. Next: Phase 2 (target choice, leader response, no-kingmaker
  safeguard, mild human bias), then Phase 3 (pacts + emote sentences + Game Log lines), Phase 4 (personalities).
- **2026-09-27 (8): If-then formulas, trigger inputs, 5 emotes retired** (owner). bot-terms.js grammar: if/between,
  comparisons, and/or/not; toText/describe/compile updated; mutation can wrap in if() and swaps operators by family.
  Triggers: oppCanWinNextTurn, iCanWinThisTurn, neededShrineBlocked, oppRespondReady. bot.js homeCost: for a player who
  is not active, the path field counts their own pawn hex as occupied, so it now starts from the neighbouring hexes
  (+1). Tested: 11 parse/round-trip/value cases; 2 games: iCanWinThisTurn 20, oppCanWinNextTurn 3, shrine blocked
  common (a stone sat on the earth shrine all game), oppRespondReady 0 (responses need their pattern formed: rare).
  Emotes P10/P11/P84/P94/P95 retired (owner): filtered in emoji-system.js, unpriced on the server (migration
  emoji_retire_five; nobody owned one). Next: the bot alliance system (docs/bot-alliances.md).
- **2026-09-27 (7): Formulas gold + readable training window** (owner). runHillClimbTraining: with termMutations and a
  finished run, claim_training_reward FORMULA_BONUS_GOLD (10), +FORMULA_DISCOVERY_GOLD (20) when the submitted champion
  keeps a formula not in the anchor (formulaGold / formulaKept in the result and the end message). Panel label
  "Invent (+10 gold)". Training popup: base 13px, all text 12-14px and brighter; formulas box reworded; formulas shown
  in plain words (bot-terms.js describe(), raw formula in the hover title), Likes green / Avoids red, NEW badge.
- **2026-09-27 (6): Train Bot "Formulas: Invent" option + fresh seeds** (owner). Panel row Formulas Off / Invent (Hill
  Climb only) -> termMutations; popup box explains formulas and lists the current challenger's (new ones marked);
  "What happened" says whether the climbed bot carries new formulas. Found: runHillClimbTraining never passed a seed, so
  hillClimb used seed 1 and every run from the same champion tried the SAME challengers on the same decks (repeat runs
  redid each other's work); same for runWeightTraining's evolve. Both now get a fresh random seed. Empty brains invent a
  formula more often (0.6). Tested headless: panel row, popup box + challenger formula shown, no errors.
- **2026-09-27 (5): Water chains (owner's strategy)** Water touching wind (or water chained to it) copies free
  movement and is much cheaper than wind; touching earth it becomes a wall; void cancels. bot-sim.js already modeled
  this (chainedAbility / canMoveTo); new: waterChainResult / waterChainsToWind / isFreeStone. Gaps fixed: (1) bot-state.js
  tactical candidates never offered water (outside Burning Motivation): now offered where it would chain (wind or earth);
  (2) bot.js tacticalPlaceBonus treated water on its own path as a slow wall: chained-to-wind water now scores new weight
  placeWaterChain (12, like placeWindPath), chained-to-earth water blocks like earth; (3) blockedSig (search field cache
  key) held only blocked hexes, so paving (wind or chained water) never reached the search's home / explore distances
  until the next real turn: it now includes each stone hex's cost class. Formula inputs: homeCost, freeStones,
  freeWater, freeNearHome, adjacent(a,b), stonesOf, myPool, oppNeeds, commonFor. Formula Lab starter ideas replaced
  (road home, water chains, scarcity, threat). Tested: chain rules on hand-built boards (wind, earth, both, void on
  either, 2- and 3-long chains, broken chain); 4 games: water chains offered 2021x, placed 25 (18 chained to wind).
- **2026-09-27 (4): Formula terms + Formula Lab (Option C)** (owner). js/bot-terms.js: bots can carry extra "senses" as
  safe formulas (WEIGHTS.terms), scored at the end of evaluateSnapshot (search). bot-arena.js mutate/crossover carry and
  nudge terms; opts.termMutations (hillClimb, evolve) also adds / removes / changes formulas. js/formula-lab.js: hermit
  menu Formula Lab with 5 starter ideas written by Claude, Check, Quick test, queue for the next Train Bot run. Champion
  loading drops stale terms (bot.js). Tested headless: 2 games with 5 terms (240k term scores, no errors, no leftover
  terms after), Lab check + 2-game quick test, queue used once, 1-round hill climb with termMutations. Not yet: Bot Mind
  display of terms, an in-game "Ask Claude" button (would need an API key in a Supabase edge function).
- **2026-09-27 (3): Champion = newest promoted row** (owner). The owner's Explore + Hill Climb run beat the champion
  (row 14, confirm 5-4-3), but every reader took the highest win_rate, and row 12 (0.40) outranked row 14 (0.08):
  win_rate is only comparable inside one row's own confirm. sql/champion-promoted.sql (applied): column `promoted`,
  rows 12 + 14 set. Readers (bot.js loadCommunityChampion, game-ui.js runHillClimbTraining anchor, lobby.js elemental
  base, tools/arena-headless.mjs) now order by promoted desc, created_at desc; a winning climb inserts promoted: true.
- **2026-09-27 (2): Classic emojis retired, lobby Shop** (owner). Only the Pipoya pixel emotes are sold now (emoji-system.js;
  migration emoji_classic_retired drops the emoji_E prices; nobody owned one). Profile > Emojis showed "undefined" (it
  printed item.display); now uses emojiSystem.displayHtml(). gamification-ui.js: Profile window = Stats / Badges /
  Board / Settings; new lobby Shop button (#shop-btn, gami_openShop) = Names and Pawns / Emojis, tabs by data-tab.
  css .gami-tabs flex-shrink 0 (a tall tab squashed the row). Tested headless: both windows, switching, no "undefined".
- **2026-09-27: Emojis on the server, Pipoya pixel emotes, Credits button** (owner). sql/emoji-server.sql (applied,
  migration emoji_server): cosmetic_price() also prices 'emoji_E01'..'E83' (old tier prices) and 'emoji_P00'..'P99'
  (50g); emoji-system.js buys with buy_cosmetic('emoji_<id>') and reads cosmetics_owned (localStorage store removed;
  the server had no emoji purchase on record, so nothing to carry over). Pixel emotes: 100 speech-bubble emotes cut
  from the Pipoya Popup Emotes Pack sheet (zip on the repo's main branch) into images/emotes/pipoya-emotes.png
  (rows 0-9, 960x320); css .px-emote animates the 3 frames. Broadcast payload gains `sprite`. js/credits-ui.js:
  lobby Credits button; entries known so far: Pipoya, Humble Pixel (Paper UI, License.pdf), Google fonts. Still
  to fill in (owner): Paper UI Menus pack, Immortal + BlowBrush fonts, sound effects, login music, soundfont,
  intro/lore videos. Tested headless: shop + buy (buy_cosmetic emoji_P00), inventory, pawn float, credits modal.
- **2026-09-26 (13): Leave training area button** (owner). game-ui.js showLeaveTrainingButton(): when a Train Bot /
  training-panel run ends (the run's finally) and the training board (#game-layout.active) is still on screen, a
  fixed "Leave training area" button appears under the status line; click = stop any job, sessionStorage
  godaigo_skip_intro_once, reload (same exit as the replay viewer). Hidden again when a new run starts. Tested
  headless: hidden during a run, shown after Stop, click returns to the lobby; not shown when the run failed before
  a board appeared.
- **2026-09-26 (12): Train Bot Explore step, Evolve no longer shares, challenger X** (owner). game-ui.js:
  runHillClimbTraining opts.explore = short BotArena.evolve (2 gens, pop 6, 12 games/gen, 2-5 players, seeded from the
  anchor) whose champion is hillClimb opts.seedChallengers[0]; +EXPLORE_BONUS_GOLD (10) only for a finished run; End
  Early during explore returns 'ended early' (no gold). Panel row "Explore: Off / First (+10 gold)". runWeightTraining
  (Evolve) applies locally only, no bot_champion_weights insert. Popup: explore phase line, explored-bot labels,
  X swatch. bot-arena.js: challenger X marker (see js/INDEX.md). Tested headless: explore phase + End Early (no gold
  claim), X on exactly the challenger seat, removed after Stop. A full explore+climb run was not completed headless.
- **2026-09-26 (11): Training gold only for finished runs** (owner). game-ui.js runHillClimbTraining: Stop pressed
  during the confirmation was not caught (paid the run bonus and could apply/submit a half-checked champion); now
  reverts, returns 'stopped', no gold. Same stop check added to runWeightTraining (evolve, no gold there).
  End Early (result.rounds.length < rounds) pays no run bonus; a real confirmed win still pays the tier gold.
  End Early button tooltip + result message say so. Not run end-to-end (a full run takes too long headless).
- **2026-09-26 (10): Bot Training popup shows what happened.** bot-arena.js: result.endReason, stallReasons,
  onGame side info. game-ui.js: makeTrainingStats() (hill climb + evolve), popup rows #bt-popup-stats
  (challenger W-L-D, last game, run totals, stalls by reason) + #bt-popup-events (round outcomes incl.
  puzzle-blocked, stalls, generations), time left, 3 s redraw ticker. Tested with a real Depth-1 public
  run in headless Chromium (first game: no-cast stall, restart, challenger won in 59 turns).
- **2026-09-26 (9): Arena detector 3, no progress** (owner). js/bot-arena.js: no new element activated by
  anyone for `opts.stallNoProgressRounds` (default NO_PROGRESS_ROUNDS = 20) rounds -> stalled + restart,
  all seats share it; result.maxQuietRounds. Measured with it off (seeds 1-4 2p/3p, 1-2 4p): healthy games
  2.3-9.5 rounds, one won 2p game 16.5, stalled games 9-12.3 (those were caught by camping/no-cast first).
  So 20 is a safety net for long hopeless stretches, not a faster catch. Forced 3 -> fires on turn 12.
- **2026-09-26 (8): Arena no-cast stall detector 15 -> 10 rounds** (owner). js/bot-arena.js
  `opts.stallNoCastRounds ?? 10`. Training only; checked live earlier the same day: camping and no-cast
  detectors both fire and restart rounds.
- **2026-09-26 (7): Recent players + Play Again Together.** sql/recent-players.sql (applied, tested):
  my_recent_players, _played_recently (3 h), send_game_invite also allows recent co-players. lobby.js:
  window.playAgainRoom(bots, startNow) next to Quick Play; game-over "Play Again Together" button (online games,
  not replays/tutorial). social.js: Recent players section, playAgain() + resumeIntents() across the reload,
  invites on the game-over screen (Join -> Return to Lobby reload -> joinPublicGame).
- **2026-09-26 (6): Friends, online status, invites, player cards.** sql/friends.sql (applied, tested in
  rolled-back transactions: requests by name/id, accept, remove, invites from a waiting room, limits).
  js/social.js (new, after pawn-cosmetics.js), Friends button in the auth bar, styles in
  css/paper-ui-lobby.css (.social-*, #social-invite). Clickable names: gamification-ui.js leaderboard rows
  (userId added), lobby.js waiting room rows, cosmetics-system.js seatNameHtml. Ideas not done yet:
  recent players / play again together, quick chat, watch a friend's live game, Discord.
- **2026-09-26 (5): Featured replay + no brain emojis in replays.** sql/featured-replay.sql (applied:
  featured_replay one-row table, hermit_set_featured_match, get_featured_match, get_match_replay also
  allows the featured match). Lobby "Watch Featured Replay" button next to Quick Play (index.html
  .quick-play-row, css/paper-ui-lobby.css) -> Replay.openFeatured() at 4x. Hermit "Feature"/"Featured"
  button on My games / Public / Check rows. replay-viewer.js dispatch() skips recorded 🧠/🎲 bot emojis
  (10 recorded in old games; the live signal is already off).
- **2026-09-26 (4): Cloudflare Pages prep.** tools/build-site.js copies only game files to
  dist/ (git-ignored); tested: dist loads intro, lobby, bot game, fire effect with the same 404s as
  the full repo (only the old /midi-manifest.json). Owner still has to: create the Pages project
  (Connect to Git, branch fixes/all-consolidated, build `node tools/build-site.js`, output
  `dist`), add the custom domain, add the new URL to Supabase Auth (Site URL + Redirect URLs)
  and the account-recovery SITE_URLS secret, then decide on the old github.io address / private repo.
  Update: the owner used the Workers flow (Cloudflare's default for new projects), not Pages:
  wrangler.jsonc (name `godaigo`, assets ./dist) + deploy command `npx wrangler deploy`. The repo's
  default branch is `main` (old), so Workers Builds must use Settings > Build > Branch control =
  fixes/all-consolidated; a Retry of a failed build reuses its old commit, a new push is needed.
  Live 2026-09-26: https://playgodaigo.com/ and https://godaigo.aikijake.workers.dev/. Both added
  to account-recovery DEFAULT_SITES (playgodaigo.com first = fallback), edge function v3 deployed,
  so the SITE_URLS secret is not needed. Supabase Auth URL Configuration done by the owner
  (2026-09-27). Moved notice done (js/moved-notice.js). Private repo plan (2026-09-27): a private
  repo turns Pages off on the free plan, so rename the game repo + make it private, then a new
  public repo named Godaigo.Elements holds only tools/old-address-redirect/ (index.html + 404.html
  redirect to playgodaigo.com, query + hash kept). After the rename: check a Cloudflare build and
  add the renamed repo to the Claude environment. DONE 2026-09-27: repo renamed to Godaigo.null
  and made private; redirect repo live (owner checked it).
  Reset fix: "Forgot password?" silently sent nothing when the recovery EMAIL was typed (the
  username check rejects '@'). request_reset now accepts username or email (new service-only RPC
  recovery_lookup_by_email in sql/account-recovery.sql, applied; one link per account, max 3),
  edge function v4. "Link not valid" = a confirm link opened a second time (single use).
  Cache rules: tools/site-headers -> dist/_headers (build-site.js). Media (images, assets, sounds,
  video, LoreIntroClips, logo SVG) max-age 1 day; page, js, css, changelog.json, joytone no-cache
  (version.js only refreshes code, so changed media reaches players within a day; rename for instant).
  Move: js/moved-notice.js (first script in <head>) redirects the old github.io address to the same
  path on playgodaigo.com (query + hash kept). Next: owner makes the repo private in a few weeks.
- **2026-09-26 (3): Fire animation smoother.** js/effects-system.js: frames pre-decoded
  (createImageBitmap), loop draws only when a frame index or position changes (anims run at
  13-18 fps, rAF at 60-144 Hz), clears only last frame's rects instead of the whole screen,
  skips ctx.filter when 'none'; `isPlaying()` export. js/bot.js waitForQuiescence waits while
  an effect plays (real games only: speedScale >= 0.5 and not BotArena.isRunning()): the fire usually plays on a bot turn and the bot's
  next decision (up to ~0.5 s on the host) froze it mid-way.
- **2026-09-26 (2): Late-game slowdown fixed ("games get slower as they go on").** Profiled a
  3-bot arena game early vs late: a bot turn went from ~85 ms (20 stones) to ~8 s (60 stones),
  almost all in search leaves -> leafField -> blockedSig -> BotSim.canMoveTo -> stoneAt /
  neighborStones (linear stone scans, water-chain floods). Fixes: bot-sim.js stone index per
  stones array (`stoneCells` / `nearStoneIdx`, cells of STONE_NEIGHBOR_MAX px, same order as
  find/filter; `touchStones(snap)` after an in-place type/position change: Control the Current,
  Breath of Power); bot.js `blockedSig` memoized per snapshot and per board key. Late windows
  now show no heavy bot work. Also: bot.js trackCastCredit ran right after a cast, before a
  response window resolved, so any cast that opened a window read as "no credit" and was
  blacklisted for the game; now deferred (`_pendingCredit`, `flushCastCredit()` after
  waitForQuiescence in botTurn). game-log-ui.js keeps the newest 500 lines and scrolls/refits once per frame
  (`_scrollSoon`), not per line. game-core.js getAllHexagonPositions() is cached while
  placedTiles holds the same tile objects at the same x/y/flipped (callers get an array copy).
  Whole seed-3 game, speed-ups only: bot CPU 22.3 s -> 16.7 s; seeds 1, 2, 4 identical results. Note: BotArena.playMatch called directly (test scripts) leaves
  isRunning() false, so arena bots never answer response windows and every such cast waits the
  full 15 s timer; run/evolve/hillClimb/spectate set the flag, Quick Play uses bot-driver.js.
- **2026-09-26: Lag fixes (bots think about 2x faster, a timer leak).** Measured a 4-bot game
  headless (CPU profile + timer counts). (1) js/game-core.js createPatternVisual(): every scroll
  card's pattern preview started a 2.5 s setInterval that was never cleared, one per panel
  re-render (53 after ~30 s), keeping old cards alive; it now clears itself once the card is off
  the page for 2 ticks. (2) js/bot-state.js findPath(): neighbour lists cached per grid
  (adjacency()), step costs + one full Dijkstra tree per start hex cached while moveStateKey()
  (grid, active player, Mudslide, stones, pawns) is unchanged; same visit order, so identical
  paths (524 random old-vs-new checks, 0 differences). (3) js/bot-sim.js grid(): second cache by
  tile layout (search clones the snapshot every step, so the WeakMap missed). 3-player seeded
  arena games 1-3: identical results, 304 s -> 138 s. Timers were cheap (all under ~3 ms/s).
  Left: searchPick look-ahead still blocks ~0.5 s per decision on the host (idea: time budget or
  yield between beam levels); JSON clone in simulate.
- **2026-09-26: Combo plan Phase 4b: puzzle training.** sql/combo-puzzles.sql (applied):
  `hermit_list_puzzles` = human combo candidates with a positive gain. replay-viewer.js:
  `runPuzzle()` replays the match in a hidden frame up to the combo's start turn for that
  seat, then bots play every seat (myPlayerIndex = active seat; the replay hides/disables
  End Turn, so it is re-enabled) until the seat has played the same number of turns; score
  = bot gain / player gain (evaluator), solved >= 0.9. Every 4th puzzle is test-only.
  Hermit "Puzzles" tab: "Test current bot", per-puzzle result, training vs test solve rate
  (last run in localStorage godaigo_puzzle_results). `puzzleScore(w)` (up to 6 training
  puzzles) gates promotions in `BotArena.hillClimb` via `opts.puzzleCheck` (tolerance
  0.05); the hermit's Train Bot passes it. Tested on match 5: bot 766 vs player 1024
  (0.748) in 7 s. Needs more mined human games to be meaningful.
- **2026-09-26: Combo plan Phase 5: learn-from-player widened to casts and moves.**
  bot.js: cast and move scoring now go through `contrib()` (traced; same scores: 4 same-seed
  arena games identical, action counts included). bot-imitation.js: Signal C (cast_execute:
  your scroll vs the bot's best cast; nudgeDiff) and Signal D (move: the bot's adjacent step
  closest to where you went vs its best step; MOVE_LEARNING_RATE 0.02); every delta clamped
  to half its default (min 0.05). Tested with a faked online seat: casting the scroll the
  bot did not prefer nudged castLevel, a disagreeing move nudged move weights, an agreeing
  move changed nothing, 200 repeats stopped at the cap. Still hermit-only; not yet done:
  stone placements / breaks / scroll choices, and rank-weighted nudges if opened to others.
- **2026-09-26: Combo plan Phase 4: bots follow mined combos.** sql/combo-teach.sql
  (applied, migration combo_teach): `combo_flags` (hermit on/off per signature; no row =
  auto), `hermit_set_combo_state`, `hermit_combo_summary` now returns state + taught, public
  `get_bot_combos()` (auto = seen >= 2 times in >= 2 games, or forced on). bot.js: loads the
  list at start, `updateCombo()` starts a combo when the bot holds its first two cast
  scrolls, next cast gets `comboStep` (60) + `comboChoiceMatch` (20) in greedy and at the
  search root, makePlan builds the next combo scroll's pattern even without win credit,
  dropped when too slow (`comboExtraTurns`) or the scroll is gone, 3-turn rest after.
  Combos tab: Auto / On / Off per combo and "Bots use it". Bot Mind: combo + step. Live
  test: with "Create > Burning Motivation" taught (both elements already activated) the bot
  cast Create then Burning Motivation in order and completed it; without it, it cast Create
  twice and never Burning Motivation. No combos loaded = unchanged play (same seeds, same
  games). There are no real combos yet: mine more games (Replays > Combos) or switch one On.
  NEXT (plan): Phase 5, widen learn-from-player (casts and moves first).
- **2026-09-26: Combo plan Phase 3: replay miner (hermit "Combos" tab in Replays).**
  sql/combo-miner.sql (applied, migration combo_miner): `combo_candidates` table,
  `matches.mined_at`, `start_match` saves each human's ladder rank in `matches.players`,
  hermit RPCs `list_matches_for_mining`, `save_combo_candidates` (server sets trust:
  rank factor max(0.2, 1 - (rank-1)/ladder size), 0.3 without rank, x experience
  min(1, 0.2 + games/10); bots 0), `hermit_combo_summary`, `hermit_reset_mining`.
  js/replay-viewer.js: `runMine()` replays a match at full speed in a hidden frame
  (?replaymine=ID), evaluates every seat at each turn change, records casts (`scroll-used`)
  with their choices (river tile hidden/revealed + element, create / scholar / quick
  reflexes element, arson, plunder, flight, swap, telekinesis) plus reveals and breaks;
  `findCombos()` keeps windows of 1-3 own turns with >= 2 casts and gain >= max(300, 75th
  percentile of that match), non-overlapping; signature = scroll ids with choice tags, turns
  separated by " / ". Tested on recorded match 5 (8 s, 2 candidates) and the save/summary
  RPCs in a rolled-back transaction. Only 7 finished games exist so far; press "Mine new
  games" after playing more. NEXT: Phase 4 (bots follow mined combos) once combos repeat.
- **2026-09-25: Range buffs reach the whole board (owner: "Avalanche has many purposes, not
  just casting").** bot.js `rangedTargets()` lists tactical targets across the board while
  Avalanche / Seed the Skies / Mason's Savvy is live (opponent paths: earth/water; own
  route: wind; next to threat stones: fire; next to walls on the route: fire/void; the
  shrine centre an opponent is heading for: any). Real and sim move lists offer them within
  each buff's range (`ranged: true`). New `placeShrineDeny` (40 x opponents heading there,
  self-block penalty if the bot wants that shrine); water on an opponent path counts half
  an earth wall. Live check: 13 ranged placements up to 393px away, far earth wall placed.
  Also fixed a real game crash: `onSelectionEffectComplete()` read `spell.element` when a
  cast path passed no spell (Take Flight run by another effect) -> now looked up by name.
  Arena vs previous commit: 2p 11 -> 11 wins, 9 -> 9 stalls; 3p 10 -> 10, 1 -> 1; ranged
  placements 65 (2p) / 36 (3p), mostly earth walls; elements per player down (3.83 / 3.64
  vs 4.00 / 3.89) since every seat walls the others. placeEarthBlock is trainable.
- **2026-09-25: Combo plan Phase 2 done (third batch).** Choices as moves for Create
  ({element}), Arson ({target, element}), Plunder ({target, scroll}), Take Flight ({x, y}),
  Shifting Sands ({a, b}) and Telekinesis ({tileId, x, y}); Mason's Savvy's 5-hex earth
  range is now in the snapshot (`earthRange`) and the sim move list. Drivers carry two-step
  choices (`pendingStep2`); `setPendingChoice(scrollId, choice)` keeps the scroll id apart
  from a choice's own fields (Plunder's `scroll` field clobbered it at first, caught by the
  live test). Search leaf path fields are now also keyed by the tile layout (tile moves).
  Live headless check on two boards: every choice carried out exactly, sim matched real.
  Arena vs previous commit: 2p 11 -> 11 wins, 8 -> 9 stalls; 3p 9 -> 10 wins, 3 -> 1
  stalls; elements per player up in both. Not done (by design): Avalanche patterns
  anchored away from the pawn (needs multi-turn plans, Phase 4).
  NEXT: Phase 3, the replay miner.
- **2026-09-25: Combo plan Phase 2, second batch.** Choices as moves for Scholar's Insight
  and Inspiring Draught ({element} deck, top 3 by scroll need, sim draws
  '?unknown:<element>?'), Quick Reflexes ({element}, top 3 by stone need) and Call to
  Adventure ({tileId}, same list as Heavy Stomp). Burning Motivation: real and sim move
  lists offer spare-stone placements of every held type (sim: one hex per type), and hybrid
  search now runs while Burning Motivation or Avalanche is live. New `evalHandOverflow` (40
  per scroll over the hand limit): without it bots re-cast Scholar's Insight into a full
  hand every turn (3p: 7 wins vs 9, discards 137 -> 194). Live headless check: each choice
  was carried out exactly (Scholar's fire deck -> fire scroll, Draught wind -> wind scroll,
  Quick Reflexes water -> WATER_SCROLL_1, Call to Adventure flipped the chosen tile,
  Burning Motivation spare wind stone +2 AP as simulated). Arena vs previous commit:
  2p 11 -> 11 wins, 9 -> 8 stalls; 3p 9 -> 9 wins, 3 -> 3 stalls (neutral).
  Still to do in Phase 2: Avalanche placements anchored away from the pawn, other
  choice scrolls (Create, Arson, Plunder, Take Flight, Telekinesis, Shifting Sands).
- **2026-09-25: Combo plan Phase 2, first batch: Wandering River + Heavy Stomp.** Their
  choices are real moves now: `BotSim.castChoices()` lists them (River {tileId, element},
  Stomp {tileId}), BotState and BotSim legalActions emit one cast per choice, the sim
  applies the chosen one, and bot-effects.js `setPendingChoice()` makes the drivers carry it
  out. A revealed River tile draws `'?unknown:<element>?'` in the sim; bot.js values it by
  scroll need (`evalScrollUnknownEase`). Verified in a live headless game: River set the
  chosen tile and element, Stomp flipped that tile, the bot drew a scroll of the chosen
  element (tile was really catacomb), sim matched real except the known catacomb +1 AP.
  Arena vs Phase 1: 2p 12 -> 11 wins, 8 -> 9 stalls; 3p 9 -> 9 wins, 3 -> 3 stalls
  (neutral). River used a planned choice in 11 of 24 casts; Heavy Stomp casts fell from 51
  to 9 in 2p (no more flipping revealed tiles back face down for nothing).
  Next batch: Scholar's Insight / Inspiring Draught / Quick Reflexes choices as moves,
  Avalanche + Burning Motivation placements in the sim, Call to Adventure flip choice.
- **2026-09-25: Combo plan Phase 1 done (bot.js, bot-effects.js).** Scroll need:
  `handValue()` replaces the flat evalScrollHeld in evaluateSnapshot (a held scroll is
  worth `evalScrollCredit` x ease per needed element it is the best cover for; spares and
  already-won scrolls `evalScrollNoCredit`; level 1 `evalScrollResponse`). Exported
  `scrollNeed()` / `scrollPickScore()`; Scholar's Insight and Inspiring Draught now pick
  deck, card and put-back by them. Search keeps `searchKeepCasts` (2) casts outside the
  beam and goes `searchCastExtraDepth` (1) deeper when a cast is legal.
  Arena, default weights, maxStallRestarts 0: 2 players seeds 1-20: wins 9 -> 12, stalls
  11 -> 8, elements 3.65 -> 3.80; 3 players seeds 101-112: wins 10 -> 9, stalls 2 -> 3,
  elements 3.58 -> 3.92. Split test (2p): scroll values alone 12 wins / 8 stalls, search
  changes alone 10 / 9, so the gain is mostly the scroll values; the search changes
  cost ~25% more think time and are for combos (need Phase 2 to pay off). Turn counts per
  seed swing both ways (chaotic games), no steady slowdown.
- **2026-09-25: Bot Mind viewer (js/bot-mind.js, hermit only).** Owner asked to see the
  bots' plans and choices. Hermit menu "Bot Mind" or Shift+M. Per decision: how it decided
  (quick / look-ahead / play-out / following plan / getting unstuck), what it is doing and
  why, its goal (path drawn on the board), its build plan (ghost stones), the look-ahead's
  planned line ("Sees ahead", numbered stops on the board), stuck counters, top 6 options
  with scores. Built only while the viewer is on. Tested headless in a visual 3-bot game.
  Next: show mined combos and scroll choices here once Phases 2-4 exist.
- **2026-09-25: Bots clear blocking stones.** Owner report: bot games stall because
  bots can't tell when to break a stone to reach a shrine. Before: breakStone scored a
  flat `breakStoneBase - cost` (earth = -2), and search could not plan a break at all.
  Now (js/bot.js, js/bot-sim.js, js/bot-state.js):
  (a) `unblockBonus()`: breakStone and fire/void placements score the change in the
  bot's best goal value (collectible shrine / hidden tile / home when all 5 are
  activated; move-score scale) on the hypothetical board (`BotSim.simulate`), path
  costs by `pathField()` Dijkstra; a break's AP counts as path cost; negative when it
  closes the way. Fire that burns own plan stones pays `placeFireOwnPlanLoss`.
  bot-state.js now also offers tactical void placements next to earth/water.
  (b) bot-sim.js simulates `breakStone` and generates it plus stone-clearing fire/void
  placements, and search leaves use real path costs (`leafField`, cached by the set
  of impassable stones) with `evalUnreachableSteps` for an unreachable home/hidden tile.
  Arena test (tools: headless playMatch, default weights, 2 players, seeds 1-20,
  maxStallRestarts 0): wins 5 -> 9, stalls 14 -> 11 (2 players, seeds 1-20);
  wins 7 -> 10, stalls 5 -> 2 (3 players, seeds 101-112). Breaks that close the way
  now score negative, which halved the void flip-flopping (66 -> 38 voids placed).
  Still open: many games still stall (no-cast detector); bots sometimes flip a void
  between two spots as their goal changes (void opens earth but slows wind).
  New weights are untrained (hillclimb can tune them).
- **2026-09-24: Match recording (Phase 1 of 4).** Plan agreed with the owner:
  (1) record every online game (done: js/match-recorder.js, sql/match-recording.sql),
  (2) board fingerprints + witnesses so a win only pays out when other humans'
  browsers agree (claim_game_win to be tightened), (3) replay viewer that feeds
  recorded match_moves back into the normal gameChannel receive handlers (no
  bot-sim dependency; owner: bot code is still in development), plus hermit review of
  flagged games, (4) stats + a hermit "suspicious players" screen. Open questions
  for later phases: replay retention (30 days now), who may watch replays (hands
  are secret), whether to record games vs bots only (recorded now).
  Phase 2 DONE same day (js/match-witness.js, sql/match-witness.sql, migrations
  match_witness_reports + match_witness_claim): turn fingerprints -> desync_count,
  game-over witness reports -> disputed flag, claim_game_win waits for a confirming
  witness when other humans are present (pending claims paid by report_game_result).
  Tested in rolled-back transactions: claim-then-witness, witness-then-claim,
  disagreeing witness. Not yet seen in a real 2-human game.
  Phase 3 step 1 DONE (sql/replay-access.sql, migration replay_access): owner's
  rule = players watch their own games; any player of a game can "post publicly";
  public games watchable by anyone signed in. Tested rolled back on match 2.
  Step 2 next: replay engine = fake channel handed to setupGameBroadcast() (lobby.js,
  56 handlers) + recorded moves dispatched in order. Open problem:
  startMultiplayerGame() needs "my player" (spectator seat) and some handlers skip
  "own" moves by myPlayerIndex.
  Step 2 prototype DONE (js/replay-viewer.js): solved by starting from seat 0 then
  switching myPlayerIndex to -1; getPlayerScrolls falls back to the active player for
  a negative seat. Tested headless on match 2 moves 1-159 (placement, tile flips,
  pawns, stones, turns, Wind activation): 0 handler errors. Full-game run + live
  check by the owner still to do. Step 3 (My games / Public replays screens) next.
- **Phase 2 live test (match 4, room 824, JakeS1 vs GuestLXNE3T, 24 min):** witness
  flow worked end to end (both browsers confirmed, 100 XP paid the moment the
  witness report landed). Fingerprints agreed turns 1-16, then disagreed on EVERY
  turn 17-23 and at game over. Turn 16 = guest cast Quick Reflexes (CATACOMB_SCROLL_9),
  JakeS1 responded with Reflect (WATER_SCROLL_1): likely a real response-scroll sync
  bug. Fingerprint now split into 4 x 8 hex parts (tiles|stones|pawns|activated) so
  the next mismatch shows which part differs. Investigate Reflect vs Quick Reflexes.
  ROOT CAUSE FOUND + FIXED (same day): (1) Quick Reflexes selectScroll never signalled
  completion: no onSelectionEffectComplete -> no 'scroll-effect' broadcast, so other
  clients never marked its activated elements (void+wind); via Reflect/Psychic the
  chain's onComplete was never called either. (2) A ReferenceError introduced in the
  cascade-popup removal (scrollInfo moved into an if block, still used later) crashed
  selectScroll before its 'quick-reflexes-search' broadcast and left selectionMode
  set. Both fixed (finishQuickReflexes); browser-tested normal + Reflect paths.
- **Match 5 (room 825, JakeS1 vs GuestLXNE3T, 12 min, guest won):** desync_count 22
  was a FALSE alarm: the guest tab still ran the old match-witness.js (16-char
  fingerprint) vs the new 32-char one. Also the host's witness report was dropped: the
  winner hit "Return to Lobby" ~1 s after winning, which removes every player row, and
  report_game_result ignored reporters with no row, so the win stayed 'pending'.
  Fixed in `sql/match-witness-v2.sql` (applied): `_witness_seat()` falls back to the
  matches.players snapshot; fingerprints of a different length are not compared.
  match 5 desync_count reset to 0. win_type was null because the host got the room
  'finished' update before the game-over broadcast: handleGameOver now broadcasts
  game-over FIRST. The guest's 100 XP win in room 825 is still 'pending' (its
  confirming report was lost before the fix).
- **Auto update (js/version.js, 2026-09-24):** match 5's guest tab had been open since
  20:36 (before the 20:41 deploy), so it ran old code. New js/version.js checks the server's
  newest version on load / every 2 min / tab focus and reloads with fresh files when not in a
  room or game (banner in a waiting room). HOUSE RULES #4: bump with tools/bump-version.js;
  Stop hook checks it. Tested headless with a max-age=600 server: reload picked up new files,
  typing blocks the reload, no loop. Next: splash + lore intro lag, and the loading screen
  (owner says it is not fully working).
- **Phase 3 step 3 DONE (2026-09-24): Replays screen.** Lobby "Replays" button ->
  Replay.openBrowser() (js/replay-viewer.js): My games (Watch, Post publicly / Remove from
  public) + Public (Watch). End screen says END OF REPLAY (no XP). Headless-tested on the full
  match 5 recording: replay fingerprints == seat 0's real fingerprints on turns 2-22 (turn 1
  differs: real snapshot taken mid-placement). This is the Phase 2 "replay verification"
  check working by hand.
- **Create (VOID_SCROLL_5) desync, found by that replay check:** selection scrolls only
  broadcast 'scroll-effect' (activated elements) from onSelectionEffectComplete, and Create,
  Scholar's Insight, Transmute, Scorched Earth, Tile Element Change and Scroll Sacrifice never
  call it on some or all paths. Fix in game-core applyScrollEffects: broadcast 'scroll-effect'
  at cast time for selection scrolls too (element is already activated locally there). Later
  completion repeats it (harmless). Tested: Create pick + cancel both broadcast void.
- **Replay verification DONE (2026-09-24, sql/match-check.sql):** hermit "Check" tab in the
  Replays window. Replay.checkMatch(id) loads `./?replaycheck=ID` in a hidden iframe (folder
  URL: `npx serve` redirects index.html and drops the query), runCheck() replays at full speed
  (25 ms per message), fingerprints each turn change, reads the winner's final board, posts it
  back; the parent compares with get_match_fingerprints (32-char only, turn > 1) and saves
  matches.check_status/check_detail. Headless on match 5 (14 s): 21 turns match, winner NOT
  confirmed (the Create bug); with one reported fingerprint changed: "differs from turn 12
  (stones)". Not yet run on the live server data (needs the hermit's browser).
- **Next:** Phase 4 stats + hermit suspicious-player screen (can use check_status,
  desync_count, disputed, pending rewards).
- **Name colours on the server (2026-09-24, sql/cosmetics.sql):** owned/equipped name colours
  were localStorage-only (invisible to others, fakeable). Now user_profiles.cosmetics_owned /
  name_color via buy_cosmetic / equip_cosmetic; js/cosmetics-system.js reads gami.profile.
  Leaderboard (gamification-ui _gami_fetchLadder/_gami_ladderRowsHTML) colours names. Only one
  purchase (a Rainbow) was on record server-side and was carried over; colours bought before
  that exist only in old localStorage and are not migrated (can be re-granted by hand).
  2026-09-25: leaderboard showed no colours because nobody had name_color set on the server
  (equip was local). cosmetics-system.js now carries the old local equipped colour over once
  per account (equip_cosmetic still checks ownership) and refreshes the leaderboard on equip.
  Then: everyone's colour in the waiting room, opponent panel, HUD turn display and Game Log.
  cosmeticsSystem.loadNameColors(userIds) caches user_profiles.name_color per room (lobby
  updatePlayerList + startMultiplayerGame), styleForUser(uid), seatNameHtml(i) = escaped
  "Username (Colour)" with the username coloured. Bots (no user_id) stay plain.
  2026-09-25: 13 more styles (NAME_COLORS now carries group + full inline `style`; keyframes
  nameShine/nameTide/nameEmber/nameVoidPulse/nameGlitch in css/styles.css, off under
  prefers-reduced-motion). Prices: elements 100, Silver/Bronze 75, Obsidian 100, Shimmer 150,
  Ember/Tide/Void Pulse 175, CRT Glitch 250 (cosmetic_price, migration cosmetics_more_styles).
- **Pawn decorations (2026-09-25, sql/pawn-cosmetics.sql, js/pawn-cosmetics.js):** slots rim /
  base / trail (user_profiles.pawn_rim/pawn_base/pawn_trail, equip_pawn, bought with
  buy_cosmetic). Rims Gold/Silver 100, Rune Ring 150; bases Lotus Leaf/Stone Plinth 125; trails
  Ink/Embers/Water Drops/Leaves/Void Sparks 150. Shop: both cosmetics screens (profile tab now
  "Cosmetics"). Headless-tested on a real board (decorations + trail particles, no errors).
- **Tests 2026-09-25 (matches 7, 8):** match 8 (TheHermit vs JakeS, scroll win): browsers agree
  turns 2-7, both witnesses confirmed, 100 XP paid at once. Match 7 (3 seats, last standing):
  turn 5 differed only because JakeS's tab snapshot came 6.6 s late (4-minute turn, background
  tab); turn-5 fingerprint == its turn-6 one. The 125 XP last-standing win stuck 'pending' (no
  witness possible). Fixed by sql/match-witness-v3.sql: retry_pending_wins() (pending >= 60 s, no
  other fresh human in the room, no non-confirming report -> pay), called after the game and at
  sign-in; report_fingerprint no longer counts turn 1; match-witness.js skips late/hidden
  snapshots. Tested retry on room 827 (rolled back).
- **Phase 4 part 1 DONE (2026-09-25): hermit "Players" tab** in the Replays window.
  sql/hermit-players.sql: hermit_player_overview(days) aggregates matches + game_rewards per
  human seat: games, wins, abandoned, fast scroll wins (< 4 min), last-standing wins, disputed
  wins, replay-unconfirmed wins (check_detail.winnerOk = false), mismatch games, desync games,
  checked games, pending rewards, top human opponent share. Score = unconfirmed*4 + disputed*4
  + fast*2 + pending + other mismatches + 3 if >= 60% of >= 5 wins vs one player + 1 if any
  desync. hermit_player_matches(user) feeds the per-player game list (Watch / Check).
  Tested on live data as hermit (rolled-back DO block) and headless UI with sample data.
- **Anti-cheat "simplest protections" 1 + 2 (2026-09-25, sql/ladder-secure.sql):** found that
  ladder_game_result() took winner + losers from the browser (one console call = rank 1, no game).
  Now the server moves the ladder: _pay_game_win applies the recorded game (matches.players via
  game_rewards.match_id) when a human win is paid; report_game_result applies a bot win on a
  human's confirmation (not only matches.created_by when other humans played); once per match
  (ladder_applied; all older matches pre-marked). ladder_game_result is a no-op; lobby.js no
  longer calls it. Wins paid with no other human present need >= 6 recorded turns
  (_match_turns; 10 min if unrecorded) in claim_game_win and retry_pending_wins; client shows
  "too short" notice. Tested rolled back: fake claim -> null; turns m8=7 m7=9 m6=4; bot win of
  match 6 moved The Void Knight above TheHermit once, second apply ignored.
- **Known gap noted:** game_rewards is keyed (room_id, user_id) and rooms are reused, so a
  second win by the same player in the same room gets "already_claimed". Consider keying on
  match_id.
- **Register extras (2026-09-25):** Register opens a separate Create Account screen
  (setAuthMode('register'): title, optional email + news-email checkbox, Create Account, "Back
  to sign in"; Log In / Forgot / Guest / Tutorial hidden). Create Account signs up, then
  AccountRecovery.setEmailAfterRegister(email) (confirmation link) and set_mailing_list(true).
  Settings > Account has a News Emails checkbox. Mailing list = sql/mailing-list.sql; export via
  hermit_mailing_list() (opted in + confirmed email). TODO before the first send: an unsubscribe
  link in each email (legal requirement in most places).
- **Quick Play (2026-09-25):** lobby button #quick-play-btn -> lobby.js quickPlay(): createRoom(true)
  (private), addBotPlayer() x 2-4 (random), hostStartGame(). Normal online path, so the game is
  recorded; XP needs the usual 3-minute room age and 6 recorded turns (bot-only, no witness).
  Headless: signed-out path safe; full flow needs a live test.
- **Room name moved to the waiting room (2026-09-25):** lobby no longer has #room-name-input;
  rooms start as "<user>'s Game"; the host renames in the waiting room (#room-name-edit, saved
  on Enter/blur via rename_room RPC, host-only, 30 chars, sql/rename-room.sql); other players get
  the new name from the game_room subscription (payload.new.host_name). Quick Play now sits at
  the top of the lobby's left column. Note: game_room UPDATE is open to any signed-in user (RLS
  "auth can update"); claim_game_win relies on witnesses for that reason. Worth locking down.
- **Next (discussed, not started):** protections 3-6 (repeat-opponent limit, smaller bot-only
  rewards, hermit "reverse win", report button); player stats; automatic replay checks.
- **2026-09-24 (branch fixes/all-consolidated): house rules + change log.**
  Removed the separate "Hand Full / All Slots Full" cascade popup
  (`showCascadePrompt`); Unbidden Lamplight and Quick Reflexes now use the
  end-of-turn Scroll Overflow banner like shrine pickups. Leaderboard reloads in
  `showGameBrowser()`. New lobby "Change Log" button (`js/changelog-ui.js`,
  data in `changelog.json`). New HOUSE RULES section in CLAUDE.md (no em dashes;
  release note for every player-facing change), enforced by
  `.claude/settings.json` SessionStart + Stop hooks in `tools/claude-hooks/`.
  `/sync-docs` moved to `.claude/skills/sync-docs/SKILL.md` so it actually loads.
  Follow-up: replaced every em dash inside JS string literals (234 strings, 23
  files, found with an acorn AST scan so comments were untouched) and the room
  code placeholder in index.html with " - ". joytone/ (hidden dev music tool) not
  touched. Changelog rule tightened: one entry per day, max 5 lines, rewrite the
  day's summary instead of adding; stop-check.js now validates changelog.json.
- **CONNECTIVITY & PERFORMANCE, REAL PLAYTEST FINDING: currentTurnNumber
  never updated on receiving clients (turn-change/turn-sync handlers)** —
  `js/lobby.js`. Found from actual `godaigoTest.diag()` output during a real
  4-player (2 human + 2 bot) game: host's console showed
  `currentTurnNumber: 10`, the guest's showed `currentTurnNumber: 4` —
  inverted against `lastReceivedTurnNumber` on each side (4 vs 10). Traced
  to a real, pre-existing gap unrelated to anything else in this session's
  work: both the `turn-change` and `turn-sync` broadcast receivers correct
  `lastReceivedTurnNumber` on a mismatch (that's the desync-detection math)
  but never wrote the same correction into `currentTurnNumber` — the
  variable `action-log.js` actually tags every logged action with. Grepped
  every use of `currentTurnNumber` to confirm impact before fixing: all 4
  increment sites are on the client CAUSING a turn advance (host enforcing
  timeout, or the active player's own End Turn), never on a receiver: so a
  non-host client's `currentTurnNumber` silently freezes at whatever it was
  last set to directly (0 at join, or wherever it stopped being the one
  advancing turns, e.g. after a host handoff) while `lastReceivedTurnNumber`
  keeps correctly climbing via broadcasts. Confirmed NOT gameplay-affecting
  — nothing in win-condition/AP/placement logic reads `currentTurnNumber`,
  only `action-log.js` (silently mistags that client's own Game Log turn
  headers) and `bot-driver.js`'s host-only turn-number logging (unaffected,
  host's own value is always correct). Fix: both handlers now also set
  `currentTurnNumber = payload.turnNumber` / `= turnNumber` alongside the
  existing `lastReceivedTurnNumber` correction. `node --check` clean.
  **The other two things that surfaced in this same real-playtest session,
  both already resolved without a code change:** (1) the scroll-state/
  tile-board/players comparison hashes from `godaigoTest.diag()` matched
  EXACTLY between both clients, 13 minutes apart during real play — the
  actual positive confirmation this whole body of work was aiming for. (2)
  the connection-monitor 401 (previous entry) was STILL showing on one of
  the two consoles — but the OTHER console's `diag()` output showed
  `lastError: null`, same live game, same live Supabase project, proving
  it's a stale-code/stale-cache issue on that one browser specifically
  (confirmed the apikey-header fix is genuinely present at the current
  commit), not a real regression — told the user to hard-refresh/re-pull
  rather than chasing a ghost.
- **CONNECTIVITY & PERFORMANCE, HOTFIX: connection-monitor's own health-check
  ping was 401'ing** — `js/connection-monitor.js`, `js/INDEX.md`. User pasted
  a real page-load console (the fastest possible feedback loop — caught same
  session as ship). Root cause: `runPing()`'s `fetch('{SUPABASE_URL}/auth/v1/health')`
  sent no headers at all — Supabase's API gateway (Kong) requires the
  project's `apikey` header on every endpoint under that domain, including
  this one, even though the endpoint itself needs no user session/RLS
  context. Result: every ping (page load + every ~12s after) 401'd — a
  scary-looking, recurring auth-failure line in the console, and "Health
  check returned HTTP 401" would have shown in the badge's own error detail
  if anyone clicked it — directly undercutting the whole point of this
  feature (clear, non-confusing connection signal), on the very first real
  page load. The monitor still worked correctly through this (any HTTP
  response, even non-2xx, still counts as "reachable" by design), so it
  wasn't a functional break, but it was exactly the kind of noise this
  session exists to eliminate. Fix: added the `apikey` header (reads
  `SUPABASE_ANON_KEY`, already declared by `multiplayer-state.js`, same
  shared-script-scope pattern as `SUPABASE_URL`). `node --check` clean.
  Not independently re-verified against the live endpoint (still no
  outbound access from this sandbox) — reasoning: this is the exact same
  header shape every other Supabase call in this codebase already sends
  successfully (e.g. the `beforeunload` handler's raw `fetch` in lobby.js),
  so there's no new uncertainty being introduced, just the one header this
  file was missing.
- **CONNECTIVITY & PERFORMANCE, FOLLOW-UP: found and fixed the actual root
  cause of the reported playtest breakage via live Supabase log analysis**
  — `js/lobby.js`. Same branch/task as the entry directly below; a second
  pass after the user asked "you can access the supabase project though,
  right?" — they were right to ask, and it unlocked real evidence instead
  of code-reading inference. Confirmed via `mcp__Supabase__*` tools (a
  separate access channel from raw HTTP, which IS blocked in this sandbox —
  same pattern as using the GitHub MCP server instead of the `gh` CLI here).
  **User supplied the playtest time (8/20 ~5:10)** with no timezone given;
  found the actual session by querying `edge_logs` hourly request counts
  across 8/19-8/21 UTC rather than guessing an offset — zero traffic 8/19,
  a small login/lobby ramp 8/20 18:00-21:00 UTC, then a massive spike
  (4165 req/hr) at 8/20 22:00 UTC tapering off by 8/21 00:00 — consistent
  with US Eastern (5:10pm EDT ≈ 21:10 UTC, matching the ramp-in before the
  real game traffic explosion at 22:00 UTC/6pm EDT).
  **Root cause, confirmed from raw log evidence (not inferred):** one
  specific burst — 16 near-identical `GET .../players?select=*&game_id=eq.693&order=created_at.asc`
  requests, ALL from the same browser (identical user-agent), spanning only
  ~600ms — immediately followed a `PATCH .../players?game_id=eq.693&username=like.%F0%9F%A4%96%25`
  (URL-decoded: `username=like.🤖%`) at 22:25:38.955 — the exact shape of
  `updateHeartbeat()`'s host-only bot-last_seen sweep
  (`.update({last_seen}).eq('game_id',...).like('username', BOT_PREFIX+'%')`).
  Supabase Realtime's `postgres_changes` fires once PER ROW a SQL statement
  touches (Postgres logical replication semantics), not once per statement —
  so one heartbeat tick's multi-row bot sweep fans out into that many
  separate change events on `subscribeToLobby()`'s `players` subscription,
  and its handler's tail (an inline "am I now host" `select *` query,
  followed by `updatePlayerList()`'s own near-identical `select *` query)
  ran in full for EVERY one of them — 2 duplicate full-table-shape queries
  × N bot rows, all within milliseconds, repeating every ~15s heartbeat
  tick for the ENTIRE session (observed continuously from 22:23 to 23:12
  UTC — ~49 minutes — across FOUR different `game_id`s: 692, 693, 695, 696,
  consistent with the user having to repeatedly recreate the room, i.e.
  "many things broken"). Entirely independent of connection quality — this
  would happen identically on a perfect connection, just adds more requests
  for a flaky one to fail on top of. Status codes for the whole session were
  overwhelmingly 200/204/201/202 (no error storm) — the bug is pure volume/
  amplification, not failed requests.
  **Fix:** debounce the handler's reactive tail (`scheduleHostAndListRefresh()`,
  300ms trailing debounce) instead of running it inline per-event — collapses
  ANY burst of near-simultaneous `players` change events, regardless of what
  caused it (the observed bot-sweep case, or any other future multi-row
  write), into exactly one refresh ~300ms after the burst quiets down.
  Deliberately scoped to ONLY the tail (host-check + `updatePlayerList()`) —
  the two DELETE-event branches (kicked / another player left) keep running
  immediately and unchanged, since those are rare, meaningful, discrete
  events where a coalescing delay isn't needed and isn't worth the risk of
  touching. 300ms was chosen from the actual observed burst timing (16
  events spread across ~600ms, largest single gap ~87ms — comfortably under
  300ms, so a trailing debounce reliably coalesces the whole burst into one
  fire rather than firing partway through it).
  **Also found via `get_advisors` (not yet fixed — flagged for the user,
  live production DB change, asked before touching it):** 15 RLS policies
  across `players`/`game_room`/`user_activities`/`bot_champion_weights`/
  `deployed_bots`/`captured_bots`/`void_knight` call `auth.<fn>()` directly
  in the policy instead of `(select auth.<fn>())` — a documented Postgres
  RLS performance anti-pattern (re-evaluates the auth check per ROW instead
  of once per query). Compounds directly with the query-volume problem
  above and the one already fixed in the prior entry — every one of those
  hot-path `players`/`game_room` queries pays this extra tax. Standard,
  low-risk, semantics-preserving fix (Supabase's own recommended migration
  pattern). **UPDATE — user confirmed via AskUserQuestion ("Apply it now"):
  applied as migration `fix_auth_rls_initplan_performance`** (all 13 flagged
  policies, exact `pg_policies` definitions read first so every rewrite
  preserves the original condition byte-for-byte, just wrapping the auth
  call). Verified two ways: `get_advisors` re-run shows zero
  `auth_rls_initplan` warnings remaining (only the pre-existing, deliberately
  untouched `unindexed_foreign_keys` INFO items are left); a `pg_policies`
  re-read confirms every policy's `qual`/`with_check` now reads
  `(( SELECT auth.uid() AS uid) = ...)`/`(( SELECT auth.role() AS role) = ...)`
  — identical logic to before (same columns, same roles, same command),
  matching the pattern of `user_activities`'s "Users can view own activities"
  policy, which turned out to already be correctly wrapped from an earlier,
  unrelated session — confirming this is the established correct pattern for
  this project, not a new convention being introduced.
  Also flagged separately, still unapplied: `admin_delete_user`/`admin_list_users`
  are callable by any `authenticated` user, not just admins — a genuine
  security question, explicitly called out as OUT OF SCOPE for this
  connectivity/performance pass rather than touched unprompted.
  **Verification:** same limits as the entry below (no live browser this
  session) — but THIS fix's root cause, unlike the rest of that entry, is
  confirmed from actual production log evidence of the exact failure
  happening, not just static-code inference. `node --check` clean.
- **CONNECTIVITY & PERFORMANCE: connection-health monitor + reduced network
  chatter** — new `js/connection-monitor.js`, plus `js/lobby.js`,
  `js/game-core.js`, `css/components.css`, `index.html`, `js/INDEX.md`,
  `CLAUDE.md`, `js/config.js`, on branch `claude/game-connectivity-performance-8r1zml`
  (not yet merged into the canonical deploy branch above). User report: a
  playtest with a friend broke in confusing ways; theory was poor-connection
  handling plus "feature creep" (too many inefficient background processes).
  Both held up under investigation.
  **Root causes found (not hypothetical — read/traced in the actual code):**
  (1) Zero connectivity awareness anywhere: no `navigator.onLine` checks, no
  `online`/`offline` listeners, and `gameChannel.subscribe()`'s status
  callback only ever handled `'SUBSCRIBED'` — `CHANNEL_ERROR`/`TIMED_OUT`/
  `CLOSED` did nothing at all (no log, no UI, no retry), so a dropped
  realtime connection just went silently dead mid-game. (2) Every
  network call across lobby.js/game-core.js's ~10 background intervals
  (heartbeat, disconnect sweep, last-man-standing poll, turn timer,
  scroll-state sync) swallowed failures into `console.log`/`catch{}` only —
  invisible to a player without devtools open, exactly the "confusing
  failures" reported. (3) Real inefficiency: the host's turn-timer loop
  (`checkTurnTimeout`) did a full `supabase.from('game_room').select('status')`
  round trip on a plain 1-second `setInterval`, for the ENTIRE duration of
  every hosted game, just to re-check something that changes rarely — the
  single biggest chatter source found. (4) `scrollStateSyncInterval`
  unconditionally broadcast the full scroll-state snapshot to every client
  every 3 seconds regardless of whether anything had changed. (5)
  Last-man-standing poll ran every 5s **per connected player** querying the
  `players` table, despite its own comment calling it an explicitly
  secondary fallback to Presence's near-instant 'leave' event. (6) `js/config.js`
  — the file CLAUDE.md's own Script Load Order and js/INDEX.md confidently
  described as script #1 (Supabase client + game constants) — is not
  loaded by `index.html` at all (verified: no matching `<script src>`
  anywhere in the repo); every constant it defines is independently
  duplicated in `multiplayer-state.js`/`game-core.js`, which ARE loaded.
  Purely a documentation/dead-code hazard (the game works fine off the
  duplicates), not a functional bug, but exactly the kind of accumulated
  drift that makes future debugging harder — flagged and fixed rather than
  left for someone to trust the stale docs and edit the wrong file.
  CLAUDE.md's Script Load Order had also drifted for unrelated reasons
  (`tutorial.js` listed but the file no longer exists; `scroll-panels.js`/
  `boot-splash.js`/`effects-system.js` real and loaded but undocumented) —
  resynced against index.html's actual `<script>` tags while in there.
  **What was built:** `js/connection-monitor.js` (`window.ConnectionMonitor`,
  loads right after `multiplayer-state.js` since it only needs
  `SUPABASE_URL`) — browser online/offline listeners, a 12s unauthenticated
  ping against Supabase Auth's dedicated `/auth/v1/health` endpoint
  (latency + reachability, sidesteps any RLS/auth-state question since
  literally any HTTP response proves the round trip works), and
  `reportChannelStatus()`/`reportSendFailure()`/`reportSendSuccess()` for
  lobby.js to feed in realtime/broadcast outcomes. Produces one debounced
  `quality` state (`good`/`fair`/`poor`/`offline`, 2 consistent samples to
  move except instant on a real browser offline event) shown via an
  always-on bottom-left HUD badge (click to expand latency/last-error
  detail) and `isWorkable()` (false when offline, or poor for >8s).
  Deliberately kept game-state-ignorant — pure observe+report, no reach-into
  lobby/game logic — since the rest of this codebase's multiplayer sync is
  already large and fragile (see this file's own scroll-state-desync
  history below); other files opt into calling it rather than it reaching
  into them.
  **Wired into lobby.js:** `hostStartGame()` now gates on
  `ConnectionMonitor.isWorkable()` — hard-blocks (alert) if genuinely
  offline, otherwise a `showRetroConfirm()` "start anyway?" warning (the
  host is the worst-case single point of failure: every enforcement loop
  is host-only, so a bad HOST connection breaks the game for the whole
  room, not just themselves) — this is the concrete "prevent the game from
  running when connection is completely unworkable" ask.
  `gameChannel.subscribe()`'s status callback now handles all four statuses:
  reports each to ConnectionMonitor, and on an unexpected `CHANNEL_ERROR`/
  `TIMED_OUT`/`CLOSED` retries `setupGameBroadcast(true)` with exponential
  backoff (2s→30s cap, 5 attempts) before giving up with a visible status
  message — guarded by channel-object identity (`gameChannel !== thisChannel`)
  so the function's OWN deliberate unsubscribe-and-rebuild (both on a fresh
  join and on its own retry) can never be mistaken for an unexpected drop
  and double-schedule a redundant reconnect. `broadcastGameAction()` now
  reads `.send()`'s resolved result (`'ok'|'timed out'|'error'`, previously
  ignored everywhere) and feeds failures to the monitor, non-blocking —
  every existing fire-and-forget call site is unchanged.
  **Wired into game-core.js:** `checkTurnTimeout()` no longer queries the DB
  every second — reads a new `hostTrackedRoomStatus` local (seeded
  `'playing'` in `startTurnTimerMonitoring()`, kept fresh by lobby.js's
  existing `gameRoomSubscription` postgres_changes handler on every real
  status change) instead, and skips enforcement entirely while
  `!ConnectionMonitor.isWorkable()` — a host with a temporarily bad
  connection no longer kicks/resets players off possibly-stale local
  timing, which is itself a plausible root cause for "friend got kicked/
  reset for no visible reason" during the reported playtest.
  **Reduced chatter (kept the same eventual-consistency guarantees,
  changed only frequency/redundancy):** scroll-state-sync now diffs the
  snapshot's JSON against the last one actually broadcast and skips sending
  when unchanged, with a forced resend every 5th tick (~15s) kept as a
  heartbeat safety net for a client that missed the change-triggered
  broadcast. Last-man-standing poll lengthened 5s → 20s (still just the
  fallback path — Presence's 'leave' event is the fast path it backs up).
  Turn-sync (5s)/common-area-sync (10s) broadcasts and the 15s heartbeat/
  disconnect-sweep intervals were reviewed and deliberately left alone —
  reasonable as-is, not part of this pass.
  **Verification — scope, stated plainly:** this sandbox has no outbound
  network access to unpkg.com or the live Supabase project (confirmed via
  curl — proxy 403, matching an earlier session's identical finding on a
  different sandbox), and no `node_modules`/Playwright installed, so no
  live-browser or headless run was possible this session, unlike most
  other entries in this file. Verified instead by: `node --check` syntax
  validation on every changed/new JS file; full re-reads of every changed
  function tracing control flow by hand (including a real bug caught this
  way before it shipped — the first draft of the reconnect guard compared
  `currentGameId` instead of channel-object identity, which would have
  double-scheduled a reconnect against `setupGameBroadcast()`'s own
  deliberate unsubscribe-and-rebuild; fixed to compare `gameChannel !==
  thisChannel` instead); and confirming every new/duplicated global
  (`SUPABASE_URL`, `hostTrackedRoomStatus`, `_esc`, `showRetroConfirm`) is
  actually in scope at its use site given this codebase's shared-top-level-
  script-scope model (classic, non-module `<script>` tags loaded in order —
  see Script Load Order). **Not done this session, flagged rather than
  silently skipped:** an actual live playtest confirming the fixes hold up
  under real degraded-network conditions — recommended as the next step
  before considering this closed.
- **SHIFTING SANDS (Earth II): allow single-player tiles, recenter the
  carried player** — `js/scrolls/effects/scroll-effects.js`,
  `js/scrolls/scroll-definitions.js`, `js/lobby.js`, `TODO.md`, on branch
  `claude/missing-video-filename-sc1ajm` (the branch GitHub Pages actually
  deploys from — see CLAUDE.md's PROJECT SNAPSHOT, which had drifted to a
  stale `4.10.progresscheck` and is now corrected). User request: a tile
  with stones is still ineligible for the tile-swap, but a tile with
  exactly ONE player is now a valid swap target instead of being blocked
  outright — the player is carried along with their tile and recentered on
  it after the swap; a tile with 2+ players remains ineligible. New
  `isTileEligibleForShiftingSands()` / `getEligibleTilesForShiftingSands()`
  deliberately kept SEPARATE from the shared `getEligibleTilesForSwap()`,
  which Telekinesis (drag highlighting) and Heavy Stomp
  (`getEligibleTilesForFlip()`) still use with the old, stricter no-players
  rule — this change is scoped to Shifting Sands only. The multiplayer
  `tile-swap` receiver in lobby.js now also recenters the carried player on
  other clients (same `movedPlayers` shape the existing `telekinesis-move`
  handler already used).
- **TAKE FLIGHT (Wind IV): full redesign — destination rule, who chooses,
  dropped the hand-disposition rule** —
  `js/scrolls/effects/scroll-effects.js`, `js/scrolls/scroll-definitions.js`,
  `js/game-ui.js`, `js/lobby.js`, `js/bot-effects.js`, `js/bot-driver.js`,
  `TODO.md`, same branch as above, several iterations across one session
  as the design got refined through user feedback:
  1. New destination rule: must be an unoccupied hex on a tile CURRENTLY
     OCCUPIED BY ANOTHER PLAYER (not a player tile) — replaces the old
     "anywhere unoccupied, but not another player's tile centre" rule.
     Cancels with no drag UI shown at all if no valid destination exists
     for the chosen target. Shared eligibility lives in
     `getValidTakeFlightDestinations()` / `isValidTakeFlightDestination()`
     (scroll-effects.js) — used by the human drop-handler (game-ui.js) AND
     the bot's `driveTakeFlightDrag()` (bot-effects.js), so neither can
     propose an illegal drop.
  2. Who chooses the destination changed: self-target still lets the
     CASTER choose (as before). Opponent-target now hands the choice to
     the TARGET instead. In real multiplayer where the target is a
     genuinely different client, that's an actual hand-off: caster
     broadcasts `take-flight-choose-request`, the target's own client runs
     the drag UI (`enterTakeFlightChoiceAsTarget`) and broadcasts the
     result back (`take-flight`, existing event/receiver reused), which
     the caster's client resolves via a stashed
     `window.pendingTakeFlightCompletion` → `onSelectionEffectComplete`;
     either side can cancel via `take-flight-cancel-request`.
  3. Bots added via the lobby's "Add Bot" button (bot-driver.js — a real
     `players` row, host's browser drives it via `asBot()` impersonation)
     are a COMPLETELY DIFFERENT system from bot.js/BotArena's Shift+B /
     arena-sim tools and initially fell through the cracks entirely — took
     two follow-up fixes to actually close: (a)
     `BotDriver.resolveTakeFlightChoice()` (bot-driver.js) resolves a
     request when a DIFFERENT client drives the targeted bot; but (b) the
     ACTUAL real-world repro turned out to be the common single-browser
     case (host = caster = bot-driving client, all one browser) — the
     broadcast round-trip can NEVER work there no matter what, because
     lobby.js's `gameChannel` is `broadcast:{self:false}` (a client never
     receives its own sends). Fixed by having `enterTakeFlightMode()`
     detect `isHost && isMultiplayer && BotDriver.isBot(targetPlayerIndex)`
     up front and skip the broadcast entirely for that case, resolving
     synchronously via `BotEffects.driveSelection()` right after opening
     the local selection — no network round-trip involved. Lesson: don't
     assume the fix that makes conceptual sense (cross-client hand-off) is
     the one covering the actual test setup — ask, or check for a
     same-client short-circuit, before declaring it fixed.
  4. `driveTakeFlightDrag()` (bot-effects.js) now rolls a uniform-random
     valid destination instead of its old goal-seeking-toward-hidden-tiles
     heuristic, so it always responds instead of only working for
     self-targeting.
  5. Dropped the "opponent target → scroll moves to their hand"
     disposition rule entirely (separate follow-up user request) — the
     scroll now always stays in the caster's active area regardless of
     who's targeted (removed from `finalizeTakeFlightChoice()` and the
     matching `lobby.js` sync block).
  See `TODO.md`'s Take Flight entries for the same breakdown in narrower,
  file-by-file form.
- **SCARCE TILES MODE: host-configurable N-1 tiles per element instead of N**
  — `js/game-core.js`, `js/lobby.js`, `index.html`, `js/INDEX.md`, Supabase
  migration `add_scarce_tiles_to_game_room`. User request: the tile deck
  normally holds `numPlayers` copies of each of the 6 shrine types (1 of
  every element per player — `initializeDeck()`'s `tilesPerType`); this adds
  an opt-in mode where it's `numPlayers-1` per type instead (clamped to a
  minimum of 1 so a 1-player game never gets an empty deck), so not every
  player can end up collecting one of every element.
  `initializeDeck(numPlayers, seed, scarceTiles)` gained the third param
  (default `false`, so every existing caller — including bot-arena's
  `startGame()`-based self-play/training, which never passes it — is
  unaffected). Both callers now read `tileDeck.length` for the spiral-tile
  count instead of recomputing `numPlayers*6`, so board layout always
  matches actual deck size in both modes.
  Local `startGame(numPlayers, scarceTiles)` threads straight through.
  Multiplayer needed a real per-room setting since every client must
  independently build an IDENTICAL deck (no seed round-trip for this flag):
  a new `game_room.scarce_tiles` boolean column, set by the host from a new
  "Scarce Tiles Mode" checkbox in `#host-settings` (`hostStartGame()`,
  same fallback-write pattern as the existing turn-timer fields), read back
  by every client in `handleGameStart()` and passed through
  `startMultiplayerGame(allPlayers, gameDeckSeed, scarceTiles)` →
  `initializeDeck()`.
  Verified headless (Playwright, real page, cached `supabase.js` UMD bundle
  via `npm pack` since this sandbox can't reach the unpkg CDN — same
  workaround `tools/arena-headless.mjs` already documents for this exact
  situation): `startGame(3)` → 18 tiles, 3 of each of the 6 types;
  `startGame(3, true)` → 12 tiles, exactly 2 of each type;
  `startGame(1, true)` → 6 tiles, exactly 1 of each type (clamp confirmed,
  never zero); placed board-tile count matches `tileDeck.length` exactly in
  scarce mode; the seeded branch (`initializeDeck(4, seed, true)`, what
  multiplayer actually calls) independently confirmed at 18 tiles / 3 each.
  Zero page errors relevant to this feature (the only console errors seen
  were this sandbox's own network restrictions — no font CDN, no live
  Supabase REST — unrelated to the change).
- **HEADLESS GENERALIST TRAINING: `--players all` wired through
  arena-headless evolve + a confirmAcrossSizes-based confirm phase** —
  `tools/arena-headless.mjs`. Option B from the training discussion: make
  serious multi-size training runs cheap before launching one. `--players`
  now accepts `all` (evolve's nPlayers plumbing already existed — the CLI
  just couldn't express it; smoke mode cycles sizes 2-5). The confirm
  phase, when the evolve results were generalist (players 'all' or a fixed
  count >2), REPLACES the 2p playoff + 2p series — which would endorse the
  best DUELIST, the exact mistake the gate exists to prevent — with
  parallel `confirmAcrossSizes` runs: every shard champion vs a field of
  baselines at each size (champion seat rotating), ALL champions on the
  SAME confirm seed (common random numbers), ranked by improved-then-
  fitness-margin, endorsed only if it beat the field. Writes the same
  champion-*.json + apply-champion.txt outputs. DESIGN NOTE (user-raised):
  duelist training is a deliberate player choice in Bot Tycoon, not a
  legacy mode — the Stable panel's Players row (2 = duelist, All =
  generalist) is untouched, headless default stays 2, and the Challenge
  flow is literally a 2p duel so duelist builds have real economy value.
  Possible future: show a bot's training lineage as a Stable tag.
  Verified end-to-end (real run, 2 shards, mixed-size games, ~13 min):
  generalist evolve produced 2 shard champions; confirm ran both through
  2/3/4/5p fields in parallel on the shared seed, correctly split the
  verdicts (shard 0 not improved, shard 1 improved), endorsed shard 1,
  wrote outputs; a mid-confirm trap-loop stall restarted cleanly.
  Smoke-scale settings — the endorsed champion itself is statistically
  meaningless; the REAL run is:
  `node tools/arena-headless.mjs --evolve --shards 6 --generations 8 --pop 6 --players all`
  then `node tools/arena-headless.mjs --confirm --players all --games-per-size 6`.
- **TRAINER STATISTICS: mirror-paired seeds + CRN + successive halving;
  CRT overlay was breaking seeded-game determinism (fixed)** —
  `js/bot-arena.js`, `js/crt-overlay.js`, `tools/arena-headless.mjs`,
  `js/INDEX.md`. Prep for the generalist training run: squeeze more signal
  from the same game budget. (1) `_playSeries` MIRROR-PAIRS games:
  consecutive games share one deck seed with sides swapped (`gi >> 1`), so
  deck luck helps each side exactly once per pair and cancels out of the
  tally; `opts.gameIndexOffset` lets staged callers continue a seed
  sequence. (2) hillClimb COMMON RANDOM NUMBERS: all challengers in a
  round face the champion on the SAME seed sequence (dropped the
  per-challenger seed term) — ranking differences now come from weights,
  not decks; same fix in the CLI's task seeds (champ + HoF gauntlet).
  (3) hillClimb SUCCESSIVE HALVING (opts.halving !== false, default on):
  all λ challengers play a short block on shared decks, top half advances,
  single finalist completes the full gamesPerChallenge — promotion bar
  unchanged, judged on the finalist's full cumulative record; λ=6 G=30
  drops 180 → 100 games/round. CLI's own sharded round loop NOT halved yet
  (parallel restructure — deferred; it gets pairing+CRN for free since its
  trials call BotArena.run).
  **Determinism bug found by the mirror test, fixed:** crt-overlay's
  flicker consumed `Math.random()` EVERY FRAME from the same stream the
  arena seeds per game — mid-game deck reshuffles (scroll-effects
  `shuffleDeck`, e.g. after Scholar's Insight) landed at a
  frame-count-dependent stream position, so "seeded" games weren't
  reproducible (start-of-game shuffles were safe — synchronous before any
  frame). crt-overlay now uses a private LCG for flicker + grain; game
  RNG untouched by cosmetics. Verified (6/6): A-vs-A self-play 10 games →
  EXACTLY 5-5 with all 5 pairs true mirrors (same seat wins, same turn
  counts) — held even through 2 stall-restarts (restart seeds derive
  deterministically, so a pair stalls+restarts in mirror too); halving
  budget exact (14 games for λ=4 G=6, vs 24 legacy); one shared trial
  seed in logs; two stage-cuts; `halving:false` reproduces legacy budget.
- **BOT Stage 2.5 step 4 tranche 2: Refreshing Thought / Mason's Savvy /
  Heavy Stomp / Combust simulated; simCast ordering bug fixed** —
  `js/bot-sim.js`, `docs/bot-roadmap.md`, `js/INDEX.md`. SIMULATED_SCROLLS
  now holds 7. Tranche adds draws + the first board-geometry effects
  (shared TILE_RADIUS=80 rule mirrors tileHasStones/tileHasPlayers/
  destroyStonesOnTile). **Call to Adventure evaluated and EXCLUDED** — its
  buff grants stones of the revealed element on the flip ITSELF
  (game-core revealTile ctaBuff branch); element is hidden info, an honest
  sim can't predict the pool change. **Real sim bug found by the harness,
  fixed for ALL casts:** simCast credited element activation BEFORE the
  effect, but applyScrollEffects runs execute() first and gates activation
  on the POST-effect source pool — Mason's Savvy draining the last earth
  forfeits the earth activation in the real game; sim now agrees (its
  activation block moved after effect dispatch). Verified: 16/16 harness
  scenarios (9 tranche-1 regression + 7 new) zero unaccepted divergence;
  A/B arena 30 games/condition: OFF 20-10 hybrid, ON 19-11 —
  indistinguishable, cast tallies near-identical (no regression; an
  earlier 10-game 5-5 was noise — 10-game A/Bs are smoke tests only).
- **BOT Stage 2.5 step 4 tranche 1: BotSim simulates Create/Transmute/Arson**
  — `js/bot-sim.js`, `js/bot-effects.js`, `docs/bot-roadmap.md`,
  `js/INDEX.md`. First real progress on the intelligence track's designated
  next step: `SIMULATED_SCROLLS` is no longer empty. Each simulation mirrors
  BOTH the effect's state change AND the exact deterministic choice its
  BotEffects driver makes (need-ranked element for Create; most-plentiful
  NON-void discard loop up to `transmuteTargetAP` for Transmute; biggest-
  threat targeting + scroll-to-common-area for Arson) so a simulated cast
  lands where the real driven cast lands. Two notable discoveries recorded
  in the roadmap: Transmute's `execute()` activates fire UNCONDITIONALLY
  (bypasses the empty-source-pool gate every other scroll respects —
  mirrored faithfully, flagged as a possible rules inconsistency), and
  `driveTransmute()` now never discards void stones (bad trade per the
  `placeVoidSpendPenalty` reasoning; also what makes the mirror provably
  exact, since a void discard clamps voidAP through a current/void split
  the snapshot can't see). Verified: 9/9 targeted harness scenarios at ZERO
  divergence (need-ranking, source caps, pool-room edges, void AP cap,
  unconditional fire activation with dead fire source, empty-opponent
  no-op, 3-player threat targeting). A/B arena (greedy vs hybrid, 10 games,
  seed 500, whitelist ON vs OFF): identical 7-3 hybrid margin both ways —
  no regression, no measurable gain at this sample (expected; rerun at
  scale as the whitelist grows). Natural next increment: tranche 2
  (Combust + tile-flip scrolls — board-geometry effects).
- **LOGGING: win-skip warn→log + plan-fallback NOTE** — `js/game-core.js`,
  `js/bot.js`. From a glitch-hunt session (8 seeded arena games, 2-5
  players, full instrumentation — all clean: legitimate winners, zero
  errors, zero invariant violations, no DOM accumulation across games).
  IMPORTANT negative result preserved in bot.js: a planNextAction pre-gate
  ("step off stone first" / "skip pawn-occupied cells") to avoid the
  "Plan action failed" fallback was TRIED and REVERTED — it made bots
  pathologically passive (7/8 seeded games stalled out vs 7/8 clean wins).
  The rejection+replan path is load-bearing recovery; do not re-try.
  Separate latent lead: one `TypeError: reading 'element'` seen during a
  stall-restart teardown (1 in 24 restarts) — worth chasing if stalls spike.
- **PERF: three memory fixes** — `js/lobby.js` (scroll-state sync interval
  stacked one permanent 3s validator + duplicate broadcast per game joined;
  now tracked/cleared), `js/crt-overlay.js` (grain regenerated a 256KB
  ImageData ~30×/s forever → pool of 8 pre-rendered tiles, zero per-frame
  allocation), `js/joytone-bridge.js` (full DAW iframe loaded at page load
  even muted → lazy-created on first actual need; muted players and
  suppressed training runs never load it). 15/15 headless assertions.
  NOTE: the working tree still carries an UNCOMMITTED pre-existing
  cast→activate wording sweep (game-core, game-ui, lobby, scroll files,
  index.html, others) that predates these sessions — deliberately left
  out of these commits for the user to review/commit themselves.
- **BOT TYCOON polish: owner names, deploy-once, Breed removed** —
  `js/gamification.js`, `js/gamification-ui.js`, `js/game-ui.js`, migration
  `add_captured_bot_source_to_deployed_bots`. Three explicit user requests
  in one message.
  **See who deployed a bot**: `deployed_bots.owner` has no FK to
  `user_profiles` (only to `auth.users`), so PostgREST can't embed the
  join — `getBotLeaderboard()` (`gamification.js`) and `renderChallengeList()`
  (`game-ui.js`) each now run one extra batch query
  (`user_profiles.select('user_id, display_name').in('user_id', ownerIds)`)
  and attach `owner_name`/resolve it inline. Shown as a small "by X" label
  next to the nickname in both the Leaderboard's Top Bots section and the
  Challenge list.
  **Deploy each source only once**: new nullable `deployed_bots.captured_bot_id`
  (→ `captured_bots.id`, `on delete set null`; NULL = deployed straight from
  live WEIGHTS) — deliberately NO database-level unique constraint, because
  the 3 pre-existing real rows already have one owner with two NULL-source
  deploys (both from live WEIGHTS, predating this feature) — adding a
  partial-unique index would have failed to apply without touching real
  player data. Enforced app-side instead, in two places that do the same
  check: (1) the Deploy panel's Source `<select>` now filters OUT
  already-used sources entirely (no "Current live bot" option once used
  once; each captured bot vanishes from the list once deployed) — queries
  the owner's own `deployed_bots.captured_bot_id`s before rendering
  options; (2) both deploy paths (`game-ui.js`'s Deploy button,
  `gamification-ui.js`'s `_gami_stableDeployCaptured()`) run a
  check-before-insert query as a safety net against a stale dropdown (e.g.
  two tabs open), returning a clear message rather than silently
  succeeding or throwing a raw DB error. Stable's "My Captured Bots" list
  marks already-deployed captures "Deployed" with no Deploy button instead
  of a dead-end click. Nickname-uniqueness (existing `unique(owner,
  nickname)`) is untouched — deploying a second bot still just needs any
  new name, exactly as before.
  **Breed from champion files removed**: the whole upload-two-`.json`-
  files-and-crossover flow (title/desc/file-input/seed-list/Start Breeding
  button + its handler) is gone from the Bot Training panel per explicit
  request — it produced a downloadable file with no bot-ownership concept,
  disconnected from the rest of Bot Tycoon. `evolve()`'s own internal
  genetic crossover (bot-arena.js, used by Start Training's Evolve method)
  is a completely separate mechanism and is untouched. Cleaned up every
  now-stale comment/doc reference to "Start Breeding" alongside the code
  (`js/INDEX.md`, `docs/bot-tycoon-proposal.md`) rather than leaving them
  describing a feature that no longer exists.
  Verified headless (12 assertions): Breed section text/button confirmed
  absent from the panel; Source select correctly starts with live-WEIGHTS
  + both test captures, then live-WEIGHTS disappears after one deploy from
  it, then each captured bot disappears from the list right after IT gets
  deployed (three sequential real deploys through the actual UI, not just
  unit-testing the filter function); `getBotLeaderboard()` resolves
  `owner_name` correctly for a bot owned by someone else.
- **STABLE: Train button — deferred "training mechanism" now built** —
  `js/gamification-ui.js`, `js/game-ui.js`. User asked directly ("I should
  be able to access the training environments in the stable in order to
  make my bots stronger"), after this was explicitly deferred during the
  Shop/Stable build. Real design fork before building: Hill Climb is
  hard-anchored to the current #1 online champion by design (a deliberate,
  hard-won earlier fix — anchoring it to anything else produced unreliable
  results), so it can't literally "train YOUR bot" the way Evolve can
  (which starts from whatever weights are currently loaded). Presented
  both options to the user; they reframed it themselves — Hill Climb from
  a Stable bot is "try to dethrone the champion with this bot," reward it
  if it works, rather than a mismatch to avoid. Confirmed as final design:
  BOTH methods available from Train, with different write-back semantics.
  Each deployed bot row in Stable gets a **Train** button (next to
  Active/Retired — captured bots need deploying first, since only
  `deployed_bots` has an owner-UPDATE RLS policy, `captured_bots` is
  select/insert/delete-only by design, an immutable capture record).
  Clicking it applies that bot's OWN weights via
  `window.BotArena.applyWeights()`, sets a one-shot signal
  (`window._botTrainingSource = {id, nickname}`), and opens the Bot
  Training panel (`window._openBotTrainingPanel()`). The panel's outer
  `state` object (already persists Method/Players/Speed across reopens)
  gained `sourceBotId`/`sourceBotNickname`, consumed from that one-shot
  signal at open-time so a LATER unrelated open (the secret 5-click
  Profile-title trigger) never inherits a stale bot; a "Training: X" banner
  shows when set. `runWeightTraining()`/`runHillClimbTraining()` both
  gained `opts.sourceBotId`/`opts.sourceBotNickname`, read only in their
  existing `if (improved)` branch: **Evolve** with a source bot writes the
  champion weights straight into that bot's `deployed_bots.weights` and
  SKIPS the existing best-effort share to `bot_champion_weights` (self-play
  improvement over the bot's own prior weights isn't a claim about the
  online champion, so it shouldn't enter the shared pool); **Hill Climb**
  with a source bot KEEPS the existing community-table share (it really
  did just beat the online champion) AND writes the same champion weights
  into that bot's row AND grants a reward via `update_user_xp`/
  `award_gold` — **250 XP + 50 gold**, new/ungrounded-in-precedent numbers
  like the capture-chance formula was (bigger than the 100 XP for beating
  a regular player's deployed bot, since dethroning the actual #1
  community champion is far rarer) — tunable later. Training launched
  normally (no source bot, the existing secret-trigger path) is completely
  unchanged: no bot-row writes, no reward, same community-share behavior
  as before this existed. `state.sourceBotId`/`sourceBotNickname` are
  cleared in the Start button's `finally` block once the run completes.
  Verified headless (18 assertions): ambient (no source) Evolve/Hill Climb
  runs behave EXACTLY as before (community share, no bot-row touch, no
  reward) — regression check; sourced Evolve writes to the bot's row and
  skips the community share; sourced Hill Climb does both the community
  share AND the bot-row write AND grants exactly 250 XP/50 gold; the Train
  button itself applies the right bot's weights immediately and opens the
  panel with the correct "Training: ..." banner.
- **BUGFIX: win-screen capture picker was flashing then getting covered** —
  `js/game-core.js`, `js/lobby.js`. User report after the entry below
  shipped: "It didn't prompt me to capture the bot after I won... I saw a
  brief window right after." Root cause: multiplayer wins fire TWO
  independent full-screen `.game-over-overlay`s from the SAME client one
  after another — `checkWinCondition()` calls `spellSystem.showLevelComplete()`
  (game-core.js, where the capture picker had been added) synchronously,
  THEN unconditionally calls `handleGameOver()` → `showGameOverToAll()`
  (lobby.js — a separate, pre-existing overlay with its own "GAME OVER"
  title/XP line/Return-to-Lobby-with-room-cleanup button, broadcast to
  every player). Both use `position:fixed;inset:0`, so whichever renders
  SECOND (`showGameOverToAll`, after an `await` on the XP-award RPC) covers
  the first completely — the capture UI was real and correctly built, just
  visible for under a second before being buried. Also would have let a
  fast click hit `showLevelComplete`'s multiplayer "Return to Lobby"
  button, which only does `window.location.reload()` with NONE of
  `showGameOverToAll`'s room cleanup (remove_players / game_room status
  reset) — a separate latent bug fixed for free by this change.
  Fix: `showLevelComplete()` now returns immediately (builds nothing) when
  `isMultiplayer` — `showGameOverToAll()` is the one overlay that actually
  persists for multiplayer, so it's now the sole authority; the capture
  section (`buildCaptureSection()`, still defined on `spellSystem` so
  lobby.js can call `window.spellSystem.buildCaptureSection(bots)`) moved
  there, gated on the SAME `isWinner` flag `showGameOverToAll` already
  computes, with the same winnerIsBot host-impersonation guard as before.
  Single-player/arena `showLevelComplete()` behavior is unchanged (early
  return only fires when `isMultiplayer`; bot-arena.js's muted-run
  monkeypatch of this same function is unaffected either way).
  Verified headless (7 assertions): `showLevelComplete()` now builds zero
  DOM in multiplayer; `showGameOverToAll()`'s overlay carries the capture
  UI with real per-bot names for a genuine human win; a bot's win via host
  impersonation, a losing human's own client, and a bot-less game all
  correctly show no capture UI.
  **Adjacent bug found and fixed while in there, user opted to fix now
  rather than defer:** `handleGameOver()`'s real XP-crediting call had the
  EXACT SAME host-impersonation flaw as an unguarded `isWinner`, but for
  real stakes — `onGameComplete(isWinner, totalPlayers)` decides how much
  XP THIS account banks, and its `isWinner` was just
  `winnerPlayerIndex === myPlayerIndex`, so a host whose own bot won could
  get personally credited victory-tier XP for a game they didn't play.
  Extracted the shared guard into one function,
  `isGenuineLocalWinner(winnerPlayerIndex)` (returns false outright if the
  winning row's username is a bot, only THEN checks the index match) —
  used by both `handleGameOver`'s XP call and `showGameOverToAll`'s
  `isWinner` (which now needs no separate winnerIsBot check for its own
  capture-gating, since `isGenuineLocalWinner` already excludes bot wins).
  Verified headless (5 assertions): direct unit checks on the three
  `isGenuineLocalWinner` cases (genuine win / bot win via impersonation /
  not-my-win), plus an end-to-end run of the real `handleGameOver()` with
  `window.gami.onGameComplete` stubbed — confirms a bot's own win now
  calls it with `isWinner: false`, called exactly once.
- **BOT TYCOON step 6 (pulled forward) + win-screen capture + Shop/Stable
  tabs** — `js/lobby.js`, `js/bot-driver.js`, `js/game-core.js`,
  `js/game-ui.js`, `js/gamification-ui.js`, `index.html`, `css/styles.css`,
  migration `add_bot_source_to_players`. Follow-up to step 4 after the user
  asked three things in one message: (1) real per-bot variety instead of
  every bot sharing one global weight table ("I think we should be able to
  pick the bot we're capturing, as, ideally, the bots in the game are
  actually different and pulled from different uploaded bots on the
  leaderboard"); (2) Capture Stones moved to a real Shop tab, plus a Stable
  tab for managing bots, plus auth-bar buttons for both — explicitly
  DEFERRING any "Train" button/mechanism to a later discussion; (3) using a
  capture stone at the win-screen popup, bot-game-only.
  **Per-bot variety (the riskiest piece — touches core multiplayer bot
  code):** `players` gained `bot_weights jsonb` / `bot_source_id bigint →
  deployed_bots(id) on delete set null`. `addBotPlayer()` now randomly
  picks one of up to 50 active `deployed_bots` and stamps the new player's
  username as `🤖 {nickname}` (falls back to the old generic `🤖 Bot N` /
  null weights if none exist or the query fails). `bot-driver.js`'s
  `asBot()` snapshots the FULL live `window.BotSystem.WEIGHTS` table,
  swaps in the bot's own `bot_weights` for its impersonated turn, restores
  in `finally` — so a legacy bot with no `bot_weights` leaves WEIGHTS
  untouched, and one bot's table never leaks into the next bot's turn in a
  multi-bot room. Found and fixed a real regression risk while wiring this
  up: a narrower `players` SELECT fired on player-removal/disconnect
  events (mid-game) didn't include the two new columns, which would have
  silently stripped per-bot identity out of `allPlayersData` for the rest
  of any game after a disconnect — added them to that query too.
  Verified headless: a dedicated Playwright pass drove the REAL
  `BotDriver._driveBotTurn()` through three simulated turns (two distinct
  `bot_weights`, one legacy bot with none) with `BotSystem.turn` stubbed to
  observe `WEIGHTS.castBase` mid-turn — correct per-bot application, full
  restoration after each turn, no cross-bot leakage, correct no-op
  fallback. Script deleted after passing.
  **Win-screen capture picker:** `showLevelComplete()` now offers a
  "Capture a Bot" widget when (a) real multiplayer, (b) the winner is a
  genuine human, (c) at least one real (non-legacy) bot was in the game.
  Guards the host-impersonation edge case explicitly: while `asBot()`
  impersonates a bot, `myPlayerIndex` briefly equals that bot's own index,
  so `checkWinCondition`'s `isLocalWinner` check (and thus this call) can
  fire on the HOST's client for a BOT's win — checked the winning row's
  username against `isBotUsername()` so that case never offers a capture.
  Picker lists bots by their REAL per-bot names (derived by stripping the
  `🤖 ` prefix off `username`); chance formula deliberately mirrors the
  existing challenge-flow one (`min(80, 20 + botActivated×12)`, using the
  bot's own activated-element count as the "how close was the fight"
  signal, since the human just hit 5 by definition). Consumed regardless of
  outcome, inserts into `captured_bots` with the SELECTED bot's actual
  `bot_source_id`/`bot_weights` — real lineage, not a "wild" placeholder.
  Verified headless (14 assertions): bot-win-during-impersonation correctly
  shows no capture UI; genuine human win with 2 real bots shows both by
  name with independently-correct per-bot chances; capturing the
  second-listed bot inserts the right source/weights and decrements
  stones; no-bots-in-game shows nothing. First pass caught a real bug —
  the click handler's `finally` block called the full `refresh()`, which
  clobbered the just-set "Captured X!" outcome message with a stale
  chance/stone-count line milliseconds later — fixed by only touching the
  button's own state in `finally`, never `info.textContent`, after a
  result has been set.
  **Shop + Stable tabs:** two new tabs in the Profile modal
  (`js/gamification-ui.js`), between Badges and Board. Shop currently holds
  only the Capture Stones purchase (moved out of the in-game Bot Training
  panel per explicit request — buying is now Shop-only; USING a stone
  stays contextual to wherever the capture opportunity happens: the
  Challenge flow's post-match prompt, or the new win-screen picker).
  Stable shows "My Deployed Bots" (nickname, win-loss-draw record, an
  Active/Retired toggle that flips `is_active` via a direct client update —
  `deployed_bots` already had an owner-only UPDATE policy, no new RPC
  needed) and "My Captured Bots" (source nickname, capture date, a Deploy
  button that inserts a new `deployed_bots` row from that capture's stored
  weights, retrying under a different name via `prompt()` on the rare
  `unique(owner,nickname)` collision). Deliberately NO training entry
  point in Stable — explicitly deferred per the user's own words ("we'll
  talk about the training mechanism"). New `gami_openPanelOnTab(tab)`
  generalizes the existing `gami_openSettings()` toggle-or-switch logic;
  wired to new "Shop"/"Stable" buttons next to Profile in the auth bar
  (`index.html`). Verified headless (19 assertions): Shop's buy button
  spends real gold via `award_gold` and increments `capture_stones`,
  repaints with the fresh count; the Shop auth-bar button toggles the
  panel closed on a second click (matching Profile's own behavior); Stable
  lists both sections correctly, the Active/Retired toggle flips the real
  DB row and repaints, and deploying a captured bot inserts a row carrying
  that bot's actual weights.
- **BOT TYCOON step 4: Capture Stones** — new Supabase migrations
  `add_capture_stones_to_user_profiles` (int column on `user_profiles`) +
  `create_captured_bots_table` (project `lovybwpypkaarstnvkbz`),
  `js/game-ui.js`. Fourth build-order step. **Deliberately diverges from
  this project's EXISTING purchase convention** — `js/emoji-system.js`'s
  shop persists owned items to `localStorage`, not the database (real gap,
  now flagged in `TODO.md`'s new "Economy / purchases" entry, per explicit
  user request to mark it rather than silently note it only here). A
  capture stone is bought with real gold and produces a real collectible
  (another bot's weights) — both `user_profiles.capture_stones` (a plain
  int column, same style as `gold`/`total_xp`, not jsonb) and the new
  `captured_bots` table (owner, source_nickname, source_bot_id → FK to
  `deployed_bots` on delete set null, weights, captured_at) are properly
  database-backed from the start. `captured_bots` RLS is OWNER-ONLY for
  select/insert/delete (unlike `deployed_bots`' public-read) — this is a
  personal collection, not a public listing. No new RPC needed for
  buying: `user_profiles` already has an owner-only UPDATE policy
  (confirmed via `pg_policies` before building, matching the existing
  `_patchStats()` pattern in `gamification.js`), and gold deduction reuses
  `award_gold` with a NEGATIVE amount — the exact same trick
  `emoji-system.js`'s `purchaseEmoji()` already uses.
  Three UI pieces, all in the Bot Training panel: (1) a Capture Stones
  section — stone count, "Buy Stone (30g)" button; (2) a capture-attempt
  prompt offered as a FOLLOW-UP right after any Challenge (not a
  standalone button — the odds are specific to that one match), win or
  lose, since Pokemon's "lower HP = easier catch" is about how close the
  fight was, not who won: `chance% = min(80, 20 + closeness×12)` where
  `closeness = max(0, 5 - |elementsActivatedGap|)` — 20% floor for a
  lopsided game, 80% cap for a dead-even one. Stone is consumed on
  attempt regardless of outcome. This formula and the 30g cost are
  genuinely new, ungrounded-in-precedent numbers (unlike step 2's reward
  amounts) — flagged explicitly to the user before building, tunable
  later. (3) Extended "Deploy this bot" with a Source picker — your
  current live `WEIGHTS` (default, unchanged) or any bot from your
  captured collection — reusing the EXACT SAME `deployed_bots` insert
  logic, just swapping which weights object it reads from.
  Verified against the live Supabase project (`get_advisors` — zero new
  warnings; no new RPC this time so no new anon/authenticated function
  warnings either) and headless against the real page across three
  passes: (a) buy flow — real not-logged-in refusals (both the disabled-
  button state and the handler's own login check), then stubbed:
  `award_gold` called with exactly `-30`, `capture_stones` incremented by
  exactly 1; (b) the chance FORMULA driven through a REAL challenge
  (`playMatch()` stubbed to return specific `activated` pairs) — tied
  activation correctly offers 80%, max gap offers 20%, a mid gap offers
  the exact predicted 56%; then both capture-attempt outcomes with
  `Math.random()` forced: success inserts into `captured_bots` with the
  correct owner/source/weights and decrements the stone, failure
  decrements the stone identically but makes NO insert; (c) the Deploy
  Source picker — real unstubbed default state (only the live-WEIGHTS
  option, no login), stubbed population from `captured_bots`, deploying
  with a captured source selected uses THAT weights object (verified via
  a marker value), and — regression check — leaving the default selected
  still deploys genuine live `WEIGHTS`, not a leftover captured value
  from an earlier test. Zero uncaught page errors across all three
  passes.
- **BOT TYCOON step 3: bots merged into the Leaderboard tab** —
  `js/gamification.js`, `js/gamification-ui.js`. Third build-order step.
  Real design fork surfaced before building: bots have no XP (only a
  win/loss/draw record), so a literal single list sorted by one shared
  number would need an invented XP-per-win-rate conversion factor — asked
  the user directly rather than guessing; confirmed **two separate
  sections** ("Top Players" by XP, unchanged; "Top Bots" by win rate, new)
  over one interleaved list. New `window.gami.getBotLeaderboard(limit)`
  mirrors `getLeaderboard()`'s existing shape exactly (same query
  style/limit default) but reads `deployed_bots` or by `win_rate` instead
  of `user_profiles` by `total_xp`. `_renderLeaderboard()` now fetches
  both lists in parallel and renders two `.gami-leaderboard` blocks under
  `.section-label` headers, reusing the EXISTING `.gami-lb-row`/
  `.gami-lb-me`/`.gami-lb-rank`/`.gami-lb-name`/`.gami-lb-xp`/
  `.gami-lb-level` classes for bots too (win% takes the `-xp` slot's
  "big highlighted number" visual role, W-L-D record takes `-level`'s
  "small secondary detail" role) — no new CSS needed. Bots owned by the
  viewer get the same `.gami-lb-me` highlight class as their own player
  row.
  Verified headless (Playwright): stubbed data confirms both sections
  render with correct win-percentage math, correct W-L-D formatting
  (draw segment shown only when non-zero), and independent empty-states
  (an empty bot list doesn't affect a populated player list or vice
  versa); a REAL, unstubbed call against the live project confirms no
  crash and correctly shows the genuine "No deployed bots yet" empty
  state (the table has zero real rows right now). One thing this
  sandbox genuinely cannot exercise: `window.gami.userId` is a
  **getter-only** property ("read-only intent" per its own comment), so
  the "highlight MY row" case can't be stubbed without calling the real,
  side-effecting `init()` — verified by code inspection instead (the bot
  highlight is the identical `owner === window.gami.userId` pattern the
  existing, already-working player highlight already uses); what WAS
  verified is the negative case — with userId genuinely null, no row is
  spuriously highlighted.
- **BOT TYCOON step 2: challenge flow — `record_deployed_bot_result` RPC +
  "Challenge other bots" UI, reward-crediting** — new Supabase migrations
  `create_record_deployed_bot_result_rpc` +
  `restrict_record_deployed_bot_result_to_authenticated` (project
  `lovybwpypkaarstnvkbz`), `js/game-ui.js`. Second build-order step from
  `docs/bot-tycoon-proposal.md` — "the whole loop is inert without this."
  Two agreed v1 simplifications: the challenge is bot-vs-bot (your current
  `WEIGHTS` auto-plays one local match against the target's stored
  weights via the same `BotArena.playMatch()` every other feature already
  uses — no interactive human-vs-bot game yet), and the target list is
  "top 10 by win rate" rather than the proposal's full rank-window
  matchmaking (needs the unified leaderboard, step 3, not built).
  New RPC `record_deployed_bot_result(p_bot_id, p_result)`: `SECURITY
  DEFINER`, increments the DEFENDING bot's wins/losses/draws — needed
  because the CHALLENGER (not the bot's owner) reports the outcome, which
  the owner-only UPDATE policy from step 1 would otherwise block (the
  exact gap flagged and deferred in that entry). Explicitly sets
  `search_path = public` (several pre-existing functions in this project
  are flagged by the security advisor for NOT doing this —
  `function_search_path_mutable` — deliberately didn't repeat that gap in
  new code) and revokes EXECUTE from `public`/`anon` explicitly, granting
  only to `authenticated` — tighter than the pre-existing RPCs
  (`award_gold` etc., which this project's default privileges apparently
  grant to `anon` automatically regardless of a bare `revoke ... from
  public`, confirmed via `get_advisors` before and after the fix).
  Reward-crediting REUSES existing RPCs rather than inventing new
  plumbing: `award_gold`/`update_user_xp` (found via the advisor scan
  during step 1). Amounts deliberately matched to the EXISTING economy,
  not invented: challenger win → exactly 100 XP (identical to
  `gamification.js`'s `onGameComplete` 2-player-win amount) + 8 gold to
  the bot's owner (small — their bot lost); challenger loss → 0 XP
  (matches the existing "only winners earn XP" rule exactly) + 20 gold to
  the owner (matches the daily-login baseline — their bot defended
  successfully, the biggest reward here); draw → 10 gold, 0 XP.
  UI: a "Challenge other bots" section below Deploy — auto-loads on panel
  open, a Refresh button, one row per challengeable bot (nickname +
  win/loss/draw record) with its own Challenge button.
  **Real bug caught and fixed during verification, not just a test
  artifact:** the list auto-refreshes after a challenge completes (to
  show updated records), and its own error-handling called the GLOBAL
  `updateStatus()` — meaning a failure in that unrelated background
  refresh could silently overwrite and hide a just-shown challenge
  win/loss message, making a successful challenge look like it failed.
  Fixed by scoping list-load errors to the list widget itself (inline
  text) instead of ever touching the global status bar.
  Verified headless (Playwright): the real query against the live
  (currently empty) `deployed_bots` table correctly shows the empty-state
  message; the real (this sandbox has no login credentials) not-logged-in
  path is a genuine, unstubbed exercise of that refusal; with
  `playMatch()`/`rpc()` stubbed, all three outcomes (challenger win/loss/
  draw) produce the exact right RPC calls and amounts, and the fixed
  status-clobbering bug is confirmed fixed (success message survives the
  automatic list refresh). Zero uncaught page errors. (Two more race-
  condition bugs caught and fixed IN THE TEST SCRIPT ITSELF before
  trusting results — same "button text starts and ends the same, must
  wait for it to change away before waiting for it to change back" lesson
  as the Hill Climb panel tests, recurring in a new spot.)
- **BOT TYCOON step 1: `deployed_bots` table (Supabase) + "Deploy this bot"
  UI action** — new Supabase migration `create_deployed_bots_table`
  (project `lovybwpypkaarstnvkbz`), `js/game-ui.js`. First concrete build
  step from `docs/bot-tycoon-proposal.md`'s SUGGESTED BUILD ORDER — "the
  whole loop is inert without this." Schema: `id, owner (→auth.users,
  cascade), nickname (1-24 chars, checked), weights jsonb, wins, losses,
  draws, win_rate (generated, SAME formula/shape as
  bot_champion_weights.win_rate for consistent ranking later), is_active,
  created_at, updated_at`, `unique(owner, nickname)`. RLS: public SELECT
  (leaderboard/matchmaking will need to browse everyone's bots, same as
  `bot_champion_weights` already allows), owner-only INSERT/UPDATE/DELETE.
  **Deliberate, flagged gap, not solved yet:** recording a challenge result
  (build-order step 2) needs to update the DEFENDING bot's win/loss
  counters — someone else's row — which this owner-only UPDATE policy
  would block. Scoped for a `SECURITY DEFINER` RPC (this project already
  uses that pattern — `remove_player` etc.) scoped to just incrementing
  those counters, NOT a loosened UPDATE policy; deliberately not built
  until step 2 actually needs it, to avoid designing it speculatively.
  Verified via `list_tables` (correct shape, RLS enabled, FK present) and
  `get_advisors` (zero NEW warnings introduced — the flagged items are all
  pre-existing and unrelated: old functions missing `search_path`,
  `game_state`'s permissive policy, leaked-password-protection off).
  UI: a "Deploy this bot" section at the bottom of the Bot Training modal
  (below Breeding) — nickname input (maxlength 24, matching the DB check)
  + Deploy button. Publishes whatever is CURRENTLY in
  `window.BotSystem.WEIGHTS` (freshly trained/bred or just whatever's
  loaded) under that nickname for the logged-in user. Deliberately
  separate from Start Training/Start Breeding — an explicit publish step,
  not an automatic side effect of a good result — and always available
  regardless of run state (it never touches `BotArena`). Handles: empty/
  whitespace-only nickname (client-side, no network call), not logged in
  (clear prompt, no attempt to insert), and duplicate nickname
  (`unique(owner, nickname)` → error code 23505 → friendly "you already
  have a bot named X" instead of a raw DB error).
  Verified headless (Playwright, real page): controls exist with the
  right maxlength; empty/whitespace nickname never calls `supabase.from`
  at all; the REAL (unstubbed, no test credentials in this sandbox)
  not-logged-in path correctly refuses with the login prompt — an honest
  end-to-end exercise of that branch, not a mock; with auth +
  `deployed_bots.insert` stubbed (no real login available here), the
  exact insert payload is verified — nickname trimmed, `owner` set to the
  session's user id, `weights` is a real populated snapshot (>20 keys) of
  current WEIGHTS, success message names the bot, input clears after
  success; a stubbed 23505 response produces the friendly duplicate-name
  message rather than a raw error. Zero uncaught page errors.
- **BOT TRAINING UI: popup redesign — round-history chips, color swatches,
  a real progress bar, no emoji** — `js/game-ui.js`. Direct follow-up to
  the live-progress entry just below: user tried the functionally-correct
  popup and said it was "kind of small and boring" for something
  player-facing that's "supposed to be engaging," specifically wanted a
  concise summary of how ROUNDS have gone (not just the current instant),
  and said not to use emoji for design elements. Rebuilt
  `ensureTrainingPopup()`'s markup into distinct elements (scenario/phase/
  matchup/progress-bar/history/summary) instead of one joined text blob,
  and widened it (250-320px → 280-360px) to give the new pieces room.
  Added: a real CSS progress bar (gold gradient fill) instead of a bare
  percentage number; a compact chip strip — one small square per completed
  round, gold-filled if promoted, dark-outlined if held, dashed-outline for
  whichever round is currently in progress, each with a hover tooltip
  giving the exact win-rate/record — this IS the "concise round-by-round
  summary" ask, sized to stay glanceable even across many rounds (wraps
  rather than growing tall); actual color SWATCHES (small filled squares
  using the real hex values from `runHillClimbTraining`'s `sideAHex`/
  `sideBHex`, added alongside the existing color-name strings) next to
  "Challenger"/"Champion"/"Climbed champion"/"Online champion" in the
  matchup line, instead of plain color-name text only. Removed the "🧬"
  emoji from both the popup title and the full modal's title (`js/game-ui.js`
  — this was the only emoji anywhere in the actual PLAYER-facing training
  UI; the hidden developer cheat panel elsewhere in the file still uses
  emoji on its own buttons, deliberately left alone as out of scope — it's
  not player-facing). Reused `.panel-header`/`.panel-title`/`.hud-toggle-btn`
  classes already introduced in the prior entry — no new visual system,
  same HUD language, just genuinely used now with real content instead of
  a single gray text block.
  Verified headless (Playwright, real page, `hillClimb()`/`run()` stubbed to
  simulate 2 rounds — one held, one promoted — plus a confirm game):
  history chips accumulate correctly (1 after round 1, 2 after round 2, an
  extra DASHED chip appears mid-round for the round still in progress and
  disappears once that round resolves); chip fill style genuinely differs
  between held (dark) and promoted (gold) rounds; matchup swatches render
  the real configured hex values and the challenger number updates
  correctly across challengers within a round; confirm phase correctly
  swaps to "Climbed champion"/"Online champion" labels; the progress bar's
  width strictly increases across the simulated run; a DOM-wide regex scan
  confirms zero emoji anywhere in the popup, and the title text is exactly
  "Bot Training". Zero uncaught page errors.
- **BOT TRAINING UI: Hill Climb progress popup — live per-game updates +
  explicit "who's playing as which color" — fixing a popup that looked
  frozen and had never actually worked as asked before** — `js/bot-arena.js`,
  `js/game-ui.js`. Follow-up to the Hill Climb panel entry just below: user
  reported the panel "has no indicator for how it's doing and how long it
  will take," then asked for an explicit live description of which bot
  generation is playing as which color, noting they'd asked for this before
  and it never worked. Root cause of the frozen-looking popup: `hillClimb()`
  already supports a per-game `opts.onGame` callback (forwarded to every
  challenger's trial series — same mechanism `run()`/`evolve()` already use),
  but `runHillClimbTraining()` never passed one, only `onRound` — which
  fires once per ROUND, and a round is `lambda × gamesPerChallenge` (180 by
  default) games played SEQUENTIALLY in one tab (no `--shards` parallelism
  like the CLI has), so the popup could sit showing identical numbers for
  45–90+ minutes before ever updating — indistinguishable from broken.
  Fixed by wiring `onGame` too. Then, for the "which color" ask: added a new
  `opts.onChallenger(challengerNumber, lambda, roundNumber, totalRounds)`
  callback to `hillClimb()` itself (fires once per challenger, before its
  trial series starts) — `onGame`'s own game-number/total resets to 1/N for
  every challenger, so it alone can't say WHICH of the λ challengers is
  currently up; `onChallenger` is what makes that explicit. Colors: local
  (arena) games assign player index 0/1 to Purple/Yellow via game-core.js's
  `colorRankOrder`, and `_playSeries` alternates which side is player 0
  each game (`i % 2 === 0`) — so `runHillClimbTraining()` recomputes
  Purple-vs-Yellow FRESH from the current game number every progress report
  (`sideColors()`), never a fixed assignment, correctly for both the
  training rounds (Challenger vs. Champion) and the separate confirm phase
  (Climbed Champion vs. Online Champion — same alternation, different
  labels). Also restyled the popup's header to reuse the game's real HUD
  panel classes (`.panel-header`/`.panel-title`/`.hud-toggle-btn` — the
  SAME classes the opponent "Players" panel's header uses) instead of its
  own one-off inline styles, per the user's own pasted reference markup —
  same visual language as the rest of the HUD, not a bespoke popup look.
  Verified headless (Playwright, real page, `hillClimb()`/`run()` stubbed to
  fire `onChallenger`/`onGame` on a fast simulated schedule so this exercises
  the actual update cadence without waiting for 180 real games): the popup
  body updates on every single `onGame` tick (not just at round/challenger
  boundaries); explicitly names the current challenger number and total
  (`Challenger 1/6`, `Challenger 2/6`, ...) and resets its own game count to
  1/N when a new challenger starts rather than continuing the previous
  challenger's count; the two colors shown for consecutive games are
  genuinely different (alternation confirmed, not a static label); the
  confirm phase correctly switches to "Climbed champion"/"Online champion"
  labels (not "Challenger"/"Champion") and its own game total independently
  reflects the real `confirmGames` (20), not bleeding over from the training
  phase's `gamesPerChallenge` (30); the popup header DOM genuinely contains
  `.panel-header`/`.panel-title`/`.hud-toggle-btn`. Zero uncaught page
  errors. (Caught and fixed two mistakes in the verification script itself
  before trusting these results, not in the feature: an assertion checking
  the popup's classes before the popup had ever been created — it's only
  built lazily on first progress report — and a hardcoded expected total
  that didn't match the real `confirmGames` preset value.)
- **BOT TRAINING UI: Hill Climb added as a separate Method alongside Evolve
  (GA)** — `js/game-ui.js`. User wanted the reliable, champion-anchored
  hillclimb trainer (previously CLI-only, driving `tools/arena-headless.mjs
  --hillclimb`) available from the actual "🧬 Bot Training" panel, as its
  own selectable method rather than replacing Evolve. Added a `Method:`
  choice row (`Evolve (GA)` / `Hill Climb`) — selecting Hill Climb forces
  and visually disables Players at 2 (`hillClimb()` has no nPlayers concept,
  unlike `evolve()`). New `runHillClimbTraining()` mirrors
  `runWeightTraining()`'s shape but wraps `BotArena.hillClimb()`: explicitly
  and robustly fetches the ONLINE champion from `bot_champion_weights` via
  an awaited direct query before starting — same discipline as the CLI's
  own anchoring fix (this file's "hillclimb: anchor training to the ONLINE
  champion" entry, further down) — and **aborts with a clear error rather
  than silently falling back to whatever `WEIGHTS` currently holds** if
  that fetch fails, since `bot.js`'s own background `loadCommunityChampion()`
  fetch is async/racy and could still be in-flight. After climbing, runs a
  separate confirm series (`BotArena.run`, 20 games, ≥55% margin) against
  that same online baseline before ever applying/submitting — a
  round-level promotion inside `hillClimb()` is NOT trusted on its own
  (30-game trials are noisy), matching the CLI's two-step discipline
  exactly. On a confirmed improvement: applies the weights and best-effort
  submits to `bot_champion_weights` if logged in (identical to the
  existing Evolve path) — a real in-browser win becomes the new community
  champion. On failure/stop: reverts to whatever was loaded before, same
  as Evolve. Progress popup (`showTrainingPopup`) and the panel's own
  progress line gained a `mode:'hillclimb'` branch (round X/Y, promotions
  so far, best challenger win-rate this round) instead of
  generation/fitness; the roster/lineage panel is left showing its
  empty-state placeholder for this mode (no population concept to show).
  Breeding is untouched — it's an evolve()-specific population/crossover
  concept.
  Verified headless (Playwright, real page, `hillClimb()`/`run()` stubbed
  to fast controllable fakes so this tests the NEW wrapper/glue, not
  `hillClimb()`/`run()` themselves — those were already extensively
  verified earlier this session against the real online champion via the
  CLI and direct scripts): selecting Hill Climb visually disables Players
  (and clicking a disabled option is a no-op); the abort path genuinely
  never calls `BotArena.hillClimb()` when the champion fetch is stubbed to
  fail (negative control); a full stubbed run confirms `hillClimb()` is
  called with the real fetched champion (>20 weight keys) and
  rounds/lambda/gamesPerChallenge = 1/6/30, the progress callback fires,
  the confirm `run()` call uses the climbed champion + 20 games, and an
  IMPROVED result applies those weights live; a second stubbed run with a
  losing confirm record correctly reverts live `WEIGHTS` to its exact
  pre-run state (not the losing champion) instead of leaving it changed.
  Zero uncaught page errors across the whole suite. (One real bug caught
  and fixed IN THE TEST SCRIPT, not the feature, before trusting these
  results: a race condition where "wait for the Start Training button
  text to return to its idle label" could pass instantly before the async
  click handler ever ran, since the label starts AND ends the same —
  fixed with a two-phase wait for "changed away" then "changed back.")
- **BOT ARENA: stall-attribution fitness penalty (the deferred item from the
  "hillclimb Phase 2" entry below, now built)** — `js/bot-arena.js`,
  `js/INDEX.md`. User question, while reviewing the HANDOFF'd anchored-
  hillclimb experiment: "sometimes the bots will get stuck in a loop running
  around in circles... this doesn't affect the weights and discourage the
  behavior — has this been accounted for?" Confirmed by reading the code: no
  — `playMatch()`'s stall-restart discards a stalled attempt's game state
  entirely and replays with a derived seed, so a weight table that wedges
  games into repeated camping/no-cast stalls before finally producing a
  normal game was scored purely on that last normal game, with the stalling
  invisible to `sideFitness`/`seatFitness` (and, as a tie-break, to
  `hillClimb()`'s challenger ranking and `confirmAcrossSizes()`'s
  champion-vs-baseline gate — both already read fitness, not just win-rate).
  Fixed by attributing blame per attempt instead of discarding it: each
  `_playMatchOnce()` stall now records `result.stallers` — for a CAMPING
  stall, exactly the player index(es) whose streak hit `STALL_TURNS` (mirrors
  the existing `camped` count computation, just keeping the indices instead
  of only the count); for a NO-CAST stall, every seat (nobody progressing is
  a joint failure, unlike camping's per-tile streak, so there's no single
  culprit to isolate). `playMatch()` sums `stallers` across EVERY attempt of
  one call — including ones a restart discards — into `result.stallCounts`,
  a per-player-index count of stalled attempts. `seatFitness()`/
  `sideFitness()` gained a `stallPenalty` term (default 0.25, tunable via
  `opts.stallPenalty`) subtracted per stall a seat caused; absent
  `stallCounts` (e.g. a synthetic result with none) it's a no-op, so old
  callers are unaffected. `seatFitness`/`sideFitness` also newly exported on
  `window.BotArena` for direct scoring verification, matching how `bot.js`
  already exposes its evaluator for the same reason.
  Verified headless (Playwright, real page): direct `seatFitness()` calls
  with synthetic results confirm the penalty term's exact weighted
  contribution, and that a result with no `stallCounts` field scores
  identically to the pre-fix formula (no regression). End-to-end via the
  real `playMatch()`: stubbed `BotSystem.turn()` to end-turn without ever
  casting, forcing a genuine no-cast stall — `maxStallRestarts:2` produced 3
  total attempts (1 final + 2 discarded), each correctly attributing BOTH
  seats, so `stallCounts` reads `{0:3, 1:3}` and `seatFitness()` for each
  seat is exactly `0.3×progress − 0.15×stuck − 0.25×3` (matched to the
  penny). Negative control: a normal 8-turn unstubbed game never stalls and
  returns an empty `stallCounts`. The camping branch's attribution wasn't
  separately exercised end-to-end (would need forcing a revealed elemental
  tile + sustained position for `STALL_TURNS`=7 turns) — its `stallers`
  computation is a one-line variant of the already-verified `camped` count
  and feeds the same, already-verified `playMatch()`/`seatFitness()` path, so
  confidence is high by inspection, but call this out if a camping-specific
  regression ever shows up.
- **hillclimb: anchor training to the ONLINE champion (was silently using defaults)**
  — `tools/arena-headless.mjs`. User trained a 40-min champion that passed the
  local gate 13-7 but lost online. Root cause: a fresh hillclimb session seeded
  its baseline IMPLICITLY — boot the page, wait a fixed 1.5s for bot.js's
  BACKGROUND Supabase fetch, read `WEIGHTS`. If that fetch was slow/blocked it
  SILENTLY fell back to `DEFAULT_WEIGHTS` and still printed "seeding from the
  page's current weights" — so the session trained a bot that beats defaults but
  loses to the real online champion, with no indication it used the wrong
  opponent. Fixed: a new (non-file, non-resumed) session now EXPLICITLY queries
  `bot_champion_weights` (highest `win_rate`) via the page's own supabase client
  and reports the baseline out loud — `baseline = ONLINE CHAMPION (win_rate X)`
  vs a loud failure. It REFUSES to anchor to defaults by default: if the
  champion can't be fetched it ABORTS with an explanation (no more silent wrong
  opponent); `--hc-allow-defaults` is an explicit opt-in for offline runs. The
  gauntlet (`hof`) is also seeded with the online champion (when `--hc-hof>0`)
  so challengers must keep beating the real opponent across the session, not
  just the latest session champion. Verified headless: with Supabase unreachable
  (sandbox) and no override it aborts loudly ("Failed to fetch" → ABORT,
  instant, no session written); with `--hc-allow-defaults` it proceeds and runs
  games. The SUCCESS path (baseline = online champion) needs a machine that can
  reach Supabase — verify on the user's box (it will print the win_rate).
  OPERATIONAL NOTE: existing sessions (e.g. `day_run`) already froze
  baseline=defaults at creation — a FRESH session name is required to pick up
  the anchoring.
- **BOT/RULE FIX: Take Flight could land a pawn on a face-down tile (illegal)** —
  `js/bot-effects.js`, `js/game-ui.js`. User report (real MP action log, game
  468): a lobby bot cast Take Flight (WIND_SCROLL_4) and teleported onto an
  unflipped tile. Root cause: neither the bot driver nor the human drop handler
  ever checked for face-down tiles. `driveTakeFlightDrag()`'s candidate filter
  only excluded stones + other players, and when the bot still needed elements
  it DELIBERATELY aimed for the hex nearest a HIDDEN tile — so it steered onto
  face-down tiles; the human drop handler (`game-ui.js`, both the mouse and
  touch paths) validated stone/player/valid-hex but never "is this a face-down
  tile," and calls `placePlayer()` without revealing. Teleports don't reveal,
  so ending on a face-down tile is illegal (user confirmed: forbid, not
  reveal — matches Excavate's revealed-only rule; catacomb/Freedom teleport
  already required a revealed destination, so this was Take-Flight-specific).
  Fixed both layers with the existing `isPositionOnFlippedTile(x,y,grid)` helper
  (same one `bot-state.js` uses to keep placeStone off flipped tiles; it also
  catches shared bridge hexes touching any unflipped tile): the bot filters
  those hexes out of Take Flight candidates (so `dest` is legal by
  construction), and both human handlers reject an on-flipped destination with
  "Take Flight: cannot teleport onto a face-down tile." Verified headless in a
  real started 2-player game (12 hidden tiles): the driver moves the pawn to a
  revealed/empty hex (onFlipped false), with a negative control proving the
  pre-fix candidate logic WOULD have landed on a face-down tile (onFlipped
  true), zero page errors.
- **BOT ARENA hillclimb: resumable chunked sessions + Ctrl-C safety + apply/pin/share**
  — `tools/arena-headless.mjs`, `js/bot.js`. User needs to train in 20-40 min
  chunks (shared computer) and actually watch the resulting bot. Added:
  (1) `--hc-session NAME` — a RESUMABLE session persisted to
  `tools/.cache/hc-session-NAME.json`; the SAME command each chunk continues
  the run (champion, hall of fame, sigma, promotion count, and round history all
  reload; round numbers stay contiguous across chunks; the mutation RNG advances
  past completed rounds so a resumed chunk doesn't replay). Each chunk ends with
  a cumulative confirm vs the session's ORIGINAL baseline and writes the apply
  file. (2) A SIGINT (Ctrl-C) handler — state is already checkpointed every
  round, so cancel just writes the apply file for the best champion so far and
  exits 0; resume anytime. (3) `apply-champion.txt` rewritten: local-apply lines
  now also set `godaigo_bot_weights_pin='1'`, PLUS (once a confirm record
  exists) an optional "share online" snippet that inserts into
  `bot_champion_weights` while logged into the live game. (4) `js/bot.js`
  `loadCommunityChampion()` now early-returns when `godaigo_bot_weights_pin`
  is set — otherwise the async Supabase community-champion fetch OVERWRITES a
  locally-applied champion the moment it resolves (`Object.assign(WEIGHTS,…)`),
  so a player could never reliably watch their own trained weights. Default
  (unset) behavior unchanged. Verified headless: two 2-round chunks of one
  session continue contiguously ([1,2,3,4], baseline/champion/HoF persisted,
  status idle, apply file pinned) — RESUME PASS; a run SIGINT'd mid-round-2
  exits 0, saves status `cancelled` with round 1 preserved, and writes the
  pinned apply file — SIGINT PASS. bot.js pin guard is a one-line guarded
  early-return (syntax-checked; the sandbox has no reachable Supabase to
  exercise the override-skip end to end). Camping-attribution fitness penalty
  still queued (deferred — changes the fitness yardstick, best landed before a
  serious multi-chunk session; a session should use one code version).
- **BOT ARENA: hillclimb Phase 2 — hall-of-fame gauntlet (CLI)** —
  `tools/arena-headless.mjs`. Guards against non-transitive rock-paper-scissors
  exploits: each challenger now also plays a budget vs recently-RETIRED
  champions (a bounded hall of fame), and can only be promoted if it beats the
  current champion by the margin AND holds a non-losing record vs that field —
  so a bot that hard-counters only the LATEST champion but is worse overall
  can't sneak in. On promotion the old champion is pushed onto the HoF
  (FIFO-capped at `--hc-hof` 4). New flags: `--hc-hof` (4; 0 = Phase-1
  single-champion), `--hc-hof-games` (20, split across the HoF), `--hc-hof-floor`
  (0.5 min win-rate vs the field). Held rounds log when a challenger beat the
  champion but was blocked by the field ("gauntlet held"). In-page
  `BotArena.hillClimb()` deliberately stays Phase-1 single-champion for now
  (the gauntlet lives in the CLI runner where real training happens); unifying
  waits until the in-app panel is wired. **Behavioral verification INTERRUPTED
  (user was mid-run): syntax-checked + reuses the already-verified
  `runSeriesPool`, but the "gauntlet engages once the HoF populates / blocks a
  hard-counter" run did not complete — re-verify before relying on it.** Also
  scoped, NOT built (at the time): a stall-attribution fitness penalty —
  the arena's stall-restart DISCARDS camping/no-cast games and replays them,
  so a bot's stall-causing tendency was invisible to `sideFitness`. Deferred
  then to avoid changing the fitness yardstick mid-run. **Since built — see
  the "stall-attribution fitness penalty" entry at the top of this file.**
- **BOT ARENA: `hillClimb()` — champion-anchored monotonic trainer (Phase 1)**
  — `js/bot-arena.js`, `js/INDEX.md`. Diagnosis (from a user training run that
  produced a champion which LOST the confirmation 3-7 despite "6.5 fitness"):
  `evolve()` scores population members by beating their near-identical mutated
  SIBLINGS over just 1 game/pair, so the ranking is noise-dominated and there's
  almost no selection pressure toward "better than the reigning champion" — a
  random walk that drifts DOWNHILL from a well-tuned seed. The 6.5 was the
  in-population ceiling (sweep your 5 cousins), not a win vs baseline; the only
  baseline comparison is the leaky 10-game confirm. New `BotArena.hillClimb(opts)`
  is the (1+λ) fix the user themselves reasoned toward: hold the champion FIXED,
  spawn `lambda` (6) mutant challengers, play EACH vs the champion for
  `gamesPerChallenge` (30) games via the existing `_playSeries` A/B machinery
  (alternating sides), and promote the best ONLY if it clears `promoteWinRate`
  (0.58) over the decided games (`minDecided` floor) — champion is MONOTONIC by
  construction (only ever replaced by something that demonstrably beat it), and
  N drowns the per-game tile/scroll-draw noise. Adaptive σ (`sigma0`/`sigmaGrowth`/
  `sigmaCap` 0.2/1.5/0.8) widens the mutation step on a barren round, resets on
  promotion (escapes plateaus without forcing a bad promotion). Reuses
  `mutate`/`_playSeries`/`sideFitness`; `evolve()` untouched. Shares the
  stop()/endEarly()/mute/suppress plumbing; guards + `isRunning()`/`isClimbing()`
  updated so it can't overlap other arena jobs. Verified headless (tiny params
  4×2×2 to exercise the mechanism): correct return shape, exactly 16 games,
  full 64-key table with brain-shape keys (`searchDepth`/`searchHybrid`)
  preserved, BOTH promote + hold branches hit, adaptive-σ invariants hold
  (promoted round → σ=0.2; barren round → σ grew 0.20→0.30), not left running,
  zero page errors. **Deliberately Phase 1 — follow-ups scoped, NOT built:**
  Phase 2 = hall-of-fame gauntlet (evaluate challengers vs a pool of retired
  champions, not just the latest, to guard non-transitive rock-paper-scissors
  exploits — the margin alone only fixes noise, not generalization). Still NOT
  wired into the game-ui 🧬 panel (console/CLI only for now).
- **BOT ARENA: parallel `--hillclimb` headless runner (Phase 3)** —
  `tools/arena-headless.mjs`. Makes hillClimb() practical at scale by fanning
  the λ challenger-trials across Chromium pages (reusing the existing
  `runSeriesPool` multi-page pool that `--shards` already uses) — one browser
  page is single-threaded, so the parallelism lives in the Node runner, not the
  in-page core. Node holds the champion, generates λ mutant challengers per
  round via Node-side `mulberry32`/`mutate` mirrors (kept in exact sync with
  bot-arena.js: same brain-shape exclusions, same per-weight Gaussian),
  dispatches each challenger's N-game trial-vs-champion across the page pool,
  then promotes the best only if it clears `--hc-promote` (0.58) over the
  decided games — same monotonic rule as the in-page core. Flags:
  `--hillclimb [seedfile]` (seed from a champion json or the page's current
  weights), `--hc-rounds` (20), `--hc-lambda` (6), `--hc-games` (30),
  `--hc-promote` (0.58), `--hc-sigma` (0.2); trials fan across `--shards`.
  Ends with an honest final confirm of the climbed champion vs the round-0
  starting champion and writes `hillclimb-<ts>.json` + `apply-champion.txt`
  (only when it genuinely improved). The final verdict requires a real MARGIN
  (`--hc-confirm-margin` 0.55 win-rate over `--hc-confirm` 20 decided games,
  with a min-decided floor) — NOT a bare `aFitness > bFitness`, which would
  stamp "IMPROVED" on a 5-5 / 2.64-vs-2.58 coin flip (the same leaky-gate
  problem hillClimb exists to avoid; caught from a real user run that did
  exactly that). "Too close to call" is reported distinctly from "no change".
  Robustness (from a real user run the 120-min watchdog killed at round 10/20,
  losing all 9 completed rounds): the runner now CHECKPOINTS the current
  champion + roundLog to its output json after EVERY round, so a
  timeout/crash/Ctrl-C leaves a recoverable champion on disk (status
  `in-progress` vs `complete`); the watchdog default was also raised 120→360
  min (hillclimb runs are inherently multi-hour). Verified: a run killed by a
  2-min watchdog left a checkpoint with 2 completed rounds + a full 64-key
  champion. The `--timeout` flag (minutes) already existed — no `--watchdog`. Rough cost on 6 cores: a real
  `20×6×30 = 3600`-game run ≈ ~4h wall (vs ~25h single-threaded). Verified in
  the sandbox with tiny params (1 round × 2 challengers × 2 games across 2
  workers): parallel dispatch, Node mutation, promotion, and the final confirm
  all work; the run promoted a 2-0 challenger and then honestly reported "no
  net gain" when it went 0-2 in the confirm — a live demonstration that N must
  be large (the whole point of `--hc-games 30`). Next: Phase 2 gauntlet, and
  wiring hillClimb into the in-app 🧬 panel.
- **BOT: fixed the hybrid-search-vs-plan within-turn oscillation (over-trigger)**
  — `js/bot.js`, `docs/bot-roadmap.md`. The roadmap's flagged-for-follow-up
  within-turn oscillation: hybrid search engaged whenever ANY scroll
  placeStone was legal, but `searchPick()`'s movement choices don't share the
  greedy plan/path discipline, so on turns with nothing productive to build it
  wandered (the "FULL search LOST 1-3 — lookahead movement fights plan/path"
  finding, resurfacing via hybrid firing too broadly). The trigger already
  excluded `scroll:null` tactical placements but still fired on NO-WIN-CREDIT
  scroll placements — and `legalActions()` enumerates a placeStone for every
  missing cell of every pattern variant with no credit awareness, so a pattern
  for an already-activated / empty-source-pool element stays "legal" forever;
  `creditFilter()` drops those inside the search, so triggering on one just
  left search doing move-only lookahead. Fixed by gating the trigger's
  placeStone clause on the same `hasWinCredit(snap, a.scroll)` the
  filter/scorer already use (`botAct()` hybrid branch, line ~1672). Now a
  hopeless-placement-only state falls through to disciplined greedy plan/path
  movement; genuine cast / credit-bearing placement decisions still search
  exactly as before (strict narrowing). Verified headless: 2 full 2p games
  stay decisive (46/34 turns), zero page errors, hybrid stays SELECTIVE (17
  search vs 216 greedy decisions — neither disabled nor always-on). Next
  intelligence lever per the roadmap: run a large sharded evolution via
  `tools/arena-headless.mjs` across the new mixed-size arena (needs R5 /
  cheaper self-play to be fast at scale).
- **BOT ARENA: "All sizes" generalist training + multi-size confirmation gate,
  and a bot win-condition halt fix** — `js/bot-arena.js`, `js/game-ui.js`,
  `js/bot.js`, `js/INDEX.md`. User report: the end-of-training confirmation
  was ALWAYS a 2-player duel regardless of the player count trained at, so a
  champion evolved in 4-/5-player arenas (bigger map, more resources,
  different tactics) was kept-or-discarded purely on 2-player play —
  biasing training and the `bot_champion_weights` community table it feeds
  (auto-applied to real 2-5-player lobbies) toward 2-player-friendly weights.
  User chose: train in arenas of each size AND confirm across each size.
  Built: `evolve(gen, {nPlayers:'all'})` (generalist — each sampled game also
  draws a fresh player count 2..min(5,popSize), so one run spans every size);
  `confirmAcrossSizes(champion, baseline, {sizes,gamesPerSize})` (champion vs
  a FIELD of baselines at every size 2-5, rotating the champion's seat for
  fairness; "improved" = champion total seat-fitness beats mean baseline
  across ALL sizes — a better generalist, not just a better duelist);
  `seatFitness()` generalizes the old 2-player-only `sideFitness()` to any
  seat. game-ui: "All" option in the Bot Training Players selector routes
  through the new mode + gate, records the multi-size record to Supabase;
  fixed 2-5 counts keep the run() gate; breeding rejects "All". Verified
  headless against the real game: confirmAcrossSizes correct per-size
  records/shape across [2,3]; evolve('all') samples mixed sizes in one
  generation (observed 5p + 3p games) and returns a full weight table;
  2-player run() unregressed. Separately (user report same session): the
  game "isn't recognizing when a bot has achieved the win condition every
  time — bots step onto the home shrine centre multiple times before the win
  registers." Root cause: `botTurn()` ran up to 30 actions and never stopped
  on a met win condition; in arena/spectate the win is only detected at
  end-of-turn via `BotSim.winner(snapshot())`, so a bot reaching home
  mid-turn with leftover AP could take another action that steps it off the
  shrine before the check ran, silently missing the win. Fixed: break the
  action loop the instant `BotSim.winner()` reports the active player won,
  leaving the pawn on its shrine (safe by construction — winner() only fires
  on an actual win). Verified headless: full 2p games log "Win condition met
  — halting the turn" and end with a clean detected win, zero page errors.
- **BOT STAGE 4 COMPLETE: earth-blocking / fire-interference tactics +
  wind-for-movement placement** — `js/bot-state.js`, `js/bot.js`,
  `docs/bot-roadmap.md`, `js/INDEX.md`. User request: build the roadmap's
  § STAGE 4 scoped design, plus "placing wind stones for movement is an
  important strategy." The roadmap's premise that placement is dictated by
  the bot's own pattern turned out to be a Stage-0 VOCABULARY gap, not a
  game rule — humans can drag any held stone onto any valid in-range hex —
  so `legalActions()` now also enumerates TACTICAL placeStone candidates
  (`scroll:null, tactical:true`: held earth/wind/fire onto empty hexes
  adjacent to the pawn; ≤ ~18 candidates, range buffs deliberately not
  exploited). `bot.js`: `tacticalContext(snap)` built once per real
  decision, root-only per the scoped design (never per search leaf) —
  opponents' cheapest-path hex sets toward their next objective (nearest
  needed shrine / home when complete; `pathToOrNear()` falls back to a hex
  adjacent to targets our `canPlayerMoveToHex` can't enter), the bot's own
  objective-path hexes, and "loaded gun" threat stones (stones inside a
  currently-satisfied pattern an opponent could cast NOW — common area +
  their PUBLIC active area only, hand names stay hidden). Fed through
  `tacticalPlaceBonus()` into BOTH brains at the root: greedy
  `scoreAction()` via `ctx.tac`, and `searchPick()` root scores (same
  pattern as revisitPenalty). New weights: `placeTacticalBase` (−4),
  `placeEarthBlock` (+45/opponent blocked), `placeSelfBlockPenalty` (−40),
  `placeWindPath` (+12), `placeFireThreatBreak` (+70/threat stone,
  mirrors the fire-burn void-guard rule), `placeTacticalStarvesPlan`
  (−500). Guards shipped with it: hybrid's search trigger and botTurn's
  `productive` bookkeeping both ignore tactical candidates (near-always
  legal — would degenerate hybrid into always-on search / mask stalls).
  **Wedge found via arena regression and fixed before committing:** wind
  paving initially turned ~30% of arena games into bogus draws — the own
  path's DESTINATION (target shrine centre) got paved, and the collect leg
  looped "step on (free) → endTurn rejected (resting on a stone is
  transit-only) → step off → replan" until the 30-action cap expired with
  the pawn on the stone, where the arena's forced endTurn is also
  rejected. Fixed: `collectibleShrines()` excludes stone-occupied centres
  (collection = resting there), `ownPathHexes` excludes revealed
  tile-centre hexes (wind pays on corridors, never on hexes the bot must
  rest on), and `botTurn()` steps off a stone before finishing when a
  stone-free hex is affordable. Verified headless with exact weighted
  deltas + negative controls (wind 8 vs −4 on/off path; earth 41 vs −4,
  back to −4 with the opponent gone; fire 66 vs −4 once the opponent's
  scroll is removed); arena regression 10 + 8 games ALL decisive (5-5-0,
  4-4-0), zero stalls/stuck/page errors, ~10 terrain placements per game.
- **BOT FIX: stones placed on the void left behind by a moved tile
  (Telekinesis / Shifting Sands)** — `js/bot-state.js`, `js/bot.js`,
  `js/INDEX.md`. User screenshot: a tile was Telekinesis'd away and bots
  kept placing stones onto the black empty space where it used to be.
  Root cause chain: a bot's build plan validates its cells against the
  board grid only when the plan is MADE (`viablePatternAt`); Telekinesis
  eligibility requires the tile to be stone-free, so the move is legal
  mid-plan; `planValid()` re-checks holding/corruption/fire-survival every
  turn but never board membership; and `applyAction('placeStone')` checked
  stones/pawns/face-down/range but not "is this a real hex" —
  `isInPlacementRange()` is pure distance+buffs, and
  `isPositionOnFlippedTile()` returns false when there's NO hex at all.
  Humans were never affected because drag-drop snaps to
  `getAllHexagonPositions()` — the bot plan path passes raw coordinates
  straight through. Fixed at both layers: `applyAction('placeStone')` now
  rejects any target not on a board hex (authoritative gate for every bot
  path — plans, arena, effects, console), and `planValid()` re-checks all
  plan cells against the live grid so a plan whose tile moved away dies
  immediately and the bot replans instead of burning an attempt. Verified
  headless: staged pawn on a revealed tile, moved the tile 5000px away →
  placement rejected ('not on the board'), zero stones created; moved the
  tile back → the IDENTICAL placement succeeds; negative control (fixes
  stashed) reproduces the bug exactly — the void placement succeeds and a
  floating stone appears; 2-game arena regression clean (plans still
  work).
- **BOT: catacomb teleport ping-pong fix + arena no-cast stall cap** —
  `js/bot.js`, `js/bot-arena.js`, `js/INDEX.md`. User report: bots get
  stuck teleporting back and forth between catacomb tiles (it's free
  movement), and the arena never restarts those games — the camping
  detector above can't see it (catacombs aren't elemental tiles, and
  alternating tiles resets the per-tile streak every turn). Two fixes:
  (1) WEIGHTS-level: new `teleportRevisitPenalty` (-60) applies the SAME
  recency-decayed `revisitPenalty()` movement already uses to teleport
  destinations, in both greedy `scoreAction()` and `searchPick()`'s root.
  Teleports previously had NO anti-oscillation memory at all — applied
  hops now record BOTH ends into `recentPositions` (origin first, so "hop
  straight back" always draws the strongest k=1 penalty). `teleportBase`
  is only +5, so a return hop scores -55 (firmly vetoed) while a hop
  somewhere NEW keeps the full +5 nudge — teleporting for movement stays
  encouraged, per the user's constraint. (2) ARENA-level: second stall
  detector sharing the existing restart machinery — if
  `opts.stallNoCastRounds` (default 15) full rounds pass with NO bot
  casting a single scroll, the round aborts and restarts with a derived
  seed, exactly like the camping stall. Cast detection via a new
  monotonic `BotSystem.castsApplied()` counter (incremented at both
  apply sites in bot.js — plan-driven and scored casts; the arena reads
  deltas, so no reset is needed). Verified headless: score of a
  return-hop = base + full penalty (-55) vs. +5 for a fresh destination
  with identical history; a castless stubbed game stalls at exactly
  3 rounds with `stallNoCastRounds:3` and consumes its restart budget;
  a high cap (50 rounds) never false-fires inside a 12-turn cap; the
  camping-detector tests and a real 2-game batch still pass (the
  camping tests now pin `stallNoCastRounds:999` to isolate detectors,
  since their stub bots never cast).
- **BOT FIX: host's response window auto-cleared when a bot submitted first
  (real multiplayer with lobby bots)** — `js/scrolls/response-window.js`,
  `js/scrolls/INDEX.md`. User report: with a bot in the game, the host's
  own response window got auto-cleared as if the host were a bot. Two
  related causes, both "UI teardown not gated on WHO submitted": (1)
  `playerPasses()`/`playerResponds()` on a non-arbitrator client
  unconditionally ran `closeResponseModal()`/`clearResponseTimeout()` —
  but the host's client is the one that submits passes/responses ON BEHALF
  OF every bot (`bot-driver.js`'s `respondForBots()` →
  `BotEffects.decideResponse()` → `rw.playerPasses(botIndex)`), so a bot's
  pass within 700ms of the window opening wiped the host's own still-open
  modal and its countdown. Only the host runs `respondForBots()`, matching
  the "maybe only the host" in the report exactly. (2) The arbitrator-side
  variant: when a host-driven bot is the CASTER, the host client
  arbitrates, so any other player's pass/response lands in
  `checkAllPlayersResponded()` → `showWaitingForOthers()`, which replaced
  the host's open response options with the waiting spinner mid-decision.
  Fixed by gating all three teardown paths on the local human
  (`localResponderIndex()`): modal close + timer clear only when the
  submitter IS the human at this screen; the waiting spinner only once
  that human has themselves submitted. Human-vs-human play is unchanged
  (`BotDriver.driverRealIndex()` is null outside impersonation, so
  `localResponderIndex()` = plain `myPlayerIndex`). Arena/local games are
  unchanged too (their teardown runs through `resolveResponseStack()`,
  which still closes everything at resolution). Verified headless
  (Playwright, real `ResponseWindowSystem` against a staged 3-player
  multiplayer identity): bot pass leaves the host's modal + countdown
  intact and the host's own pass still closes both; while arbitrating for
  a bot caster, a remote pass no longer clobbers the host's response UI;
  negative control (fix stashed) reproduces all 4 failures.
- **BOT ARENA: trap-loop stall restart** — `js/bot-arena.js`, `js/INDEX.md`.
  User request: arena/evolution games where bots wedge into a stable camp
  (each parked on an elemental tile, neither moving) previously ground on to
  the full 200-turn cap before registering as a draw. `playMatch()` is now a
  wrapper around `_playMatchOnce()`: after each player's turn, a per-player
  streak counter tracks consecutive own turns ended on the SAME revealed
  elemental tile (closest-center-within-`TILE_SIZE*5.5` rule mirroring
  game-core's unexported `findTileAtPosition()`, filtered to
  revealed + earth/water/fire/wind/void — never reads `shrineType` off a
  face-down tile). When ≥2 players' streaks hit 7 (`STALL_TURNS`/
  `STALL_MIN_BOTS`), the round aborts (`result.stalled:true`) and playMatch
  restarts it from scratch with a DERIVED seed (`baseSeed + attempt*1000003`
  — replaying the identical seed would deterministically walk back into the
  same trap). `opts.maxStallRestarts` (default 3) caps retries so a
  pathological weight table can't spin forever; a round still stalled after
  the budget is returned as-is (winner null → draw, `result.restarts` =
  restarts consumed). Discarded attempts never reach
  run()/evolve()/spectate() stats, so nothing double-counts. Applies to ALL
  playMatch callers (run/evolve/spectate/playGame) uniformly. Verified
  headless (Playwright, stubbed Supabase CDN): stubbed bot turns parking
  both bots on two different elemental tiles trigger the abort exactly on
  turn 14 (7 own turns each) and consume the full restart budget
  (`stalled:true, restarts:1` with `maxStallRestarts:1`, 2 abort logs +
  1 restart log); negative control with only ONE bot parked runs to its
  turnCap untouched (`stalled:false, restarts:0`); a real 2-game
  `BotArena.run()` batch completes clean with zero page errors.
- **DOC CLEANUP: Track B was already done, just never marked as such** —
  `planning/current.md`. User asked "what's next" in the bot plan; while
  answering, re-checked the stale "Track B (generalize
  playGame()/run()/evolve() past 2 players) remains unscoped/unbuilt" note
  against the actual code rather than trusting the doc. Confirmed directly
  in `bot-arena.js`: `playMatch(weightsPerPlayer, opts)` is genuinely
  N-player (2-5) generic (derives player count from
  `weightsPerPlayer.length`); `evolve()` takes `opts.nPlayers` and samples
  N-player groupings when >2; `playGame()` is now just a thin 2-player
  backward-compat wrapper around `playMatch()`. `run()` intentionally
  stays 2-player-only — not a gap, since the confirmation gate is always a
  pairwise champion-vs-baseline comparison regardless of training player
  count. This work happened earlier (the N-player `playMatch()`
  unification, already in "Last Committed Work" further below) — the
  Track B note just never got updated to reflect it. Corrected both the
  detailed note and the item's own stale "Track A DONE, Tracks B/C not
  started" summary line.
- **BOT TRAINING UI: persistent progress popup + "End Early" control** —
  `js/bot-arena.js`, `js/game-ui.js`, `js/INDEX.md`. User request: the
  "🧬 Bot Training" panel should show info about the current run and stay
  visible like a popup (comparing it to the always-visible Hand panel),
  plus let the user end training early and force the confirmation match
  against the starting weights rather than just aborting. Clarified via
  AskUserQuestion: the popup should appear automatically whenever ANY
  training/breeding run is active (not just while the big modal happens
  to be open), and "End Early" should live in the popup itself.
  `bot-arena.js` gained a SEPARATE soft-stop flag, `endEarly()`/
  `_endEarlyRequested`, checked in `evolve()`'s generation and per-game
  loops alongside the existing `_stopRequested`. Deliberately distinct
  from `stop()`: the existing Stop button is a hard abort that
  `runWeightTraining()` treats as "discard everything, revert to the
  starting weights" — End Early needs the opposite semantics, cutting the
  generation loop short while still returning a genuinely usable
  champion (`evolve()` only advances `champion` after a generation
  finishes ranking, so an early exit never returns a half-computed
  result), so the caller's normal confirm-or-download flow runs on
  whatever was reached so far.
  `game-ui.js` gained a new persistent corner popup
  (`ensureTrainingPopup()`/`showTrainingPopup()`/`hideTrainingPopup()`),
  deliberately defined at the OUTER scope (same level as
  `runWeightTraining()`/`stopAnyRunningBotJob()`, not inside
  `openBotTrainingPanel()`) so it survives the main modal being closed
  and reopened — everything inside the modal itself (including its own
  progress text) is rebuilt fresh every time it opens, so a
  closed-and-reopened modal can't show a run that's already in flight;
  this popup is attached directly to `document.body` and referenced by a
  stable outer variable instead, so the SAME onProgress callback a
  running job captured at start time keeps reaching it regardless.
  Shows: training vs. breeding, player count, population size,
  generation/confirming phase, games done, elapsed time, and best
  fitness so far. "End Early → Test Now" hides itself once the confirming
  phase starts (nothing left to skip ahead to); for breeding, which has
  no confirmation phase at all, it just means "stop generating more
  generations and download the current best now." An "⤢" button
  reopens the full modal via a small `window._openBotTrainingPanel`
  bridge. Deliberately NOT done: hoisting the modal's own roster/
  generation-log state to the same outer-scope persistence — reopening
  the modal mid-run still shows an empty roster until the next
  generation tick populates it fresh; scoped as a pre-existing, secondary
  rough edge rather than risking a bigger refactor of the lineage-tracking
  display built earlier this session.
  Verified against the real running game: a fast breeding run
  (population 2) confirms the popup shows correct scenario/progress
  info, survives the modal being closed, End Early genuinely cuts the
  run short (1 of 20 requested generations completed) without breaking
  the file download, and the popup hides on completion. A direct
  `runWeightTraining()` call with a small preset (population 2, to avoid
  the sandbox's slow per-generation cost at the UI's hardcoded
  population-6 preset) confirms the training-path mechanism specifically:
  End Early stops the generation loop early (1 of 10 requested) AND
  correctly transitions into the confirming phase, producing a real
  confirmation record (`"0-2"`) rather than a discarded `"stopped"`
  result. 10-game arena regression shows no errors.
- **BOT STAGE 2.5 FULLY COMPLETE: drive Excavate, Take Flight, and
  Telekinesis — the entire choice-space inventory is now covered** —
  `js/bot-effects.js`, `docs/bot-roadmap.md`, `js/INDEX.md`. User request:
  "let's move forward with the take flight - telekinesis - excavate
  system." Excavate (CATACOMB_SCROLL_4) turned out to be misfiled in
  earlier notes as "drag-based" — it never was. Its deferred teleport
  (fires at the start of the caster's NEXT turn via
  `processExcavateTeleport()`) is a clean 2-step flow identical in shape
  to everything else: a Teleport/Stay Here prompt (always take it — free
  repositioning, no downside) then a `handleHexClick(hexPos)`
  selectionMode exactly like tile-flip/tile-swap. Candidate hexes come
  from `BotState.hexGrid()`, filtered to the SAME rule `handleHexClick()`
  itself enforces (revealed non-player tile, no stone, no player);
  heuristic picks whichever candidate is closest to the bot's current
  objective (home if all 5 activated, else nearest hidden tile). Can't
  land ON a player tile at all, so unlike catacomb/Freedom teleport this
  never doubles as a direct win.
  Take Flight (WIND_SCROLL_4) and Telekinesis (VOID_SCROLL_4) genuinely
  ARE drag-only at the UI layer — no `handleXClick()`/`onComplete(x,y)`
  API covers the actual move, unlike every other effect driven so far.
  Rather than simulating raw mouse drag events (fragile, timing-dependent,
  and against the "never reimplement game rules" philosophy this whole
  file follows), both drivers call the EXACT SAME functions the real drop
  handler calls, in the same order, just triggered directly:
  - **Take Flight**: v1 ALWAYS targets self — a downside-free "teleport
    anywhere unoccupied" (the scroll stays in the caster's active area
    for self-targeting), while opponent-targeting has a real strategic
    tradeoff (denial value vs. handing them a scroll for their hand)
    deliberately left unscoped rather than guessed at.
    `window.takeFlightState.onComplete(x,y)` only finalizes scroll
    disposition/broadcast — it does NOT move the pawn itself. The real
    drop handler (`game-ui.js`) calls `placePlayer()` (self-target) or
    `movePlayerVisually()` (opponent-target) FIRST, then `onComplete()` —
    the driver mirrors both calls exactly. Any hex works as a destination
    (no revealed/tile-type restriction, unlike Excavate), so a direct
    teleport home is legal and correctly wins via `placePlayer()`'s own
    `checkWinCondition()` once all 5 elements are activated.
  - **Telekinesis**: no target-picker — goes straight into drag mode.
    Mirrors `startTileDrag(tileId, event)` (pickup — removes the tile
    from `placedTiles` + DOM, exactly what a human mousedown does) then
    `placeTile(x, y, rotation, flipped, shrineType, false, false,
    tileId)` with the SAME tile id (drop — re-adds it at the new
    position). `findNearestSnapPoint()` already enforces the "must touch
    1 other tile" rule internally whenever
    `window.telekinesisState.active` is true, so no extra validation
    logic was needed. The move-counter/broadcast bookkeeping the real
    mouseup handler does inline (no separate function exists for it) is
    mirrored explicitly. No clear strategic value model for which tile to
    move or where (same reasoning `driveTileSwap` already uses for
    Shifting Sands) — v1 picks the least-disruptive relocation: an
    eligible tile moved to an empty slot immediately adjacent to its own
    current position. **Bug caught during testing, fixed before
    verifying:** the first eligible tile isn't a safe default — an
    interior tile deep in a compact cluster never has a free adjacent
    slot (that's what makes it interior), so trying only `eligible[0]`
    silently did nothing useful against a real board layout (11 eligible
    tiles, 0 moved). Fixed by dry-running the destination check
    (`findNearestSnapPoint` is side-effect-free) across ALL eligible
    tiles first and only starting the real pickup once a tile+destination
    pair is confirmed to work.
  Verified against a real running game (direct `enterX`/`processX`
  invocation, same testing style as every other effect here): Excavate
  completes both steps and teleports to a valid revealed hex; Take Flight
  completes both steps, moves the pawn, and correctly keeps the scroll in
  the caster's active area; Telekinesis correctly skips the boxed-in tile
  and moves a different eligible one instead, tile count unchanged
  before/after (no duplication/loss), all drag-state cleared afterward.
  10-game arena regression shows no errors.
- **BOT STAGE 2.5 COMPLETE: drive Control the Current, the last selection
  effect** — `js/bot-effects.js`, `js/bot.js`, `docs/bot-roadmap.md`.
  Different SHAPE of problem from every other scroll effect driven so
  far: Control the Current (WATER_SCROLL_5) is a persistent whole-turn
  ability with no "Done" button (`selectionMode.type: 'water-transform'`),
  meant to coexist with the rest of the bot's turn (opportunistically
  transform an adjacent water stone while moving) rather than resolve
  once. `bot.js`'s `waitForQuiescence()` previously cancelled ANY
  selectionMode `driveSelection()` couldn't act on — for this persistent
  mode that would have prematurely ended the effect's whole-turn duration
  the instant no water stone happened to be adjacent yet, discarding any
  benefit from moving toward one later. Fixed with a targeted exception:
  when `driveSelection()` returns false AND `selectionMode.type ===
  'water-transform'`, treat it as quiescent (just `return`) instead of
  cancelling — every other undriven selection is still cancelled exactly
  as before. New `driveWaterTransform()` recomputes eligible stones FRESH
  via `se.getAdjacentWaterStones()` on every call rather than trusting
  `selectionMode.highlightedStones` — that cache is only refreshed by
  `placePlayer()`'s move branch (game-core.js), which `bot-state.js`'s
  `move` action bypasses (mutates position directly instead), so trusting
  the cached list would have silently missed stones that became adjacent
  after a bot move. The actual end-of-effect cleanup is unchanged —
  `clearTurnBuffs()` (`scroll-effects.js`, called on End Turn) already
  tears the selectionMode down correctly; this fix only stops something
  ELSE from doing it prematurely. Verified against a real running game:
  casting with no water stone adjacent — `waitForQuiescence()` returns in
  ~1ms (not the 25s timeout, not a cancel) and the selectionMode
  survives; placing a stone adjacent afterward — the next call correctly
  drives the transform and the mode stays active for further use;
  simulating End Turn's `clearTurnBuffs()` correctly clears it. 10-game
  arena regression shows no errors. **Stage 2.5 is now 12/12 selection
  effects driven** — only the 2 drag-based scrolls (Telekinesis, Take
  Flight) and Excavate's deferred teleport remain, needing a programmatic
  drag hook before they can even be scoped.
- **BOT STAGE 2.5: drive 3 more scroll effects (Wandering River, Arson,
  Plunder)** — `js/bot-effects.js`, `docs/bot-roadmap.md`. Continuation of
  the Stage 2.5 remainder after fixing the two stale doc entries below
  (which had wrongly reported this stage's status). Wandering River
  (WATER_SCROLL_4): picks the eligible tile closest to the bot, then the
  most-needed element via the existing `clickBestElement()` helper. Needed
  a guard against re-clicking the tile every polling tick, since
  `selectionMode.type` stays `'tile-element-change'` through BOTH the
  tile-pick and element-pick steps (only clears once the element modal
  resolves), and the dispatcher's `switch(sm?.type)` always runs before
  the modal-check chain — without the guard the switch would keep firing
  first, destroying and recreating a fresh `element-select-modal` forever
  instead of the modal driver ever getting a turn. Arson (FIRE_SCROLL_5)
  and Plunder (CATACOMB_SCROLL_8) share a new `rankedOpponents(filterFn)`
  helper: "hit the biggest threat" — most activated elements, tie-broken
  by total pool size, never self (a plain voluntary discard already covers
  what self-targeted Plunder would do). Arson destroys the target's
  largest stockpiled available element; Plunder takes their highest-level
  active scroll — the inverse of `pickWeakestButton`'s existing "give up
  MY OWN weakest" logic already used for Sacrificial Pyre/Inspiring
  Draught. Plunder's scroll-pick step shares `scroll-select-modal` with
  those two, routed by heading text via the existing dispatcher. Verified
  against a real running game (direct `enterX` invocation, same style
  used for the earlier 3 effects): all three complete both steps and
  produce the expected board/state changes (buff applied, stone
  destroyed, scroll moved to common area). 10-game arena regression shows
  no errors. **Deliberately NOT included: Control the Current**
  (WATER_SCROLL_5) — architecturally different from every effect driven so
  far: a persistent whole-turn ability with no "Done" button, meant to
  coexist with the rest of the bot's turn (opportunistically transform an
  adjacent water stone while moving) rather than a one-shot pick.
  `waitForQuiescence()` cancels any selectionMode `driveSelection()` can't
  act on — for this persistent mode that would prematurely end the
  effect's whole-turn duration the instant no water stone happens to be
  adjacent yet. Needs a `waitForQuiescence()` change (treat it as
  non-blocking), not just a driver function — scoped precisely in
  `bot-roadmap.md` rather than rushed in alongside the other 3.
- **DOC CLEANUP: corrected two stale bot-response entries + the "elemental
  lockout" bug's root-cause diagnosis** — `docs/bot-roadmap.md`,
  `js/scrolls/response-window.js`, `planning/current.md`. Found while
  answering "what other bot work needs progressing": `bot-roadmap.md`'s
  STAGE STATUS table and `response-window.js`'s own header comment both
  still claimed response scrolls were unstarted / bots couldn't respond,
  though that shipped in an earlier session
  (`BotEffects.decideResponse()`, wired into both the arena and
  `bot-driver.js`'s `respondForBots()`). While correcting the "elemental
  lockout" task-list entry (which cited bot response support as the fix),
  traced the actual mechanic in `game-core.js`'s
  `handleScrollDisposition()`/`discardToCommonArea()`: casting a
  common-area scroll never clears its slot for anyone, bot or human — only
  a LATER discard of another scroll of that same element does, which
  always unconditionally overwrites regardless of what's currently there.
  So bot response support, already shipped, never touched this gap at
  all; the real cause is ordinary draw variance in how often a
  matching-element scroll gets discarded again, not a fixable exclusion
  bug. Corrected the entry's diagnosis accordingly rather than leaving a
  stale "not started" fix plan pointing at something already done.
- **BOT STAGE 5: catacomb/Freedom teleport action** — `js/bot-state.js`,
  `js/bot-sim.js`, `js/bot.js`, `docs/bot-roadmap.md`. User question: why
  can't bots use catacomb tiles to teleport? Answer: they weren't in the
  bot's action vocabulary at all — `legalActions()` never enumerated them
  (explicitly flagged as a gap in the file's own comment), so no scoring
  could ever make a bot choose one. This is the Track C item flagged
  unscoped/unbuilt in the opponent-awareness entry below. Added
  `{type:'teleport', x, y, shrineType}`: `bot-state.js`'s `legalActions()`
  mirrors `game-ui.js`'s `catacombEligibility()`/`updateCatacombIndicators()`
  exactly (origin must be a revealed catacomb shrine, or ANY revealed
  elemental shrine while Freedom is active; destination must be a
  different revealed, unoccupied catacomb-like shrine) — checks
  `t.flipped` before ever touching `t.shrineType`, per the DO-NOT-LIST
  rule. `applyAction()` re-validates fresh and calls `placePlayer()`
  directly, never reimplementing the teleport (same discipline as
  `breakStone` reusing `attemptBreakStone()`) — this also means a
  home-adjacent teleport can register a win via `placePlayer()`'s own
  `checkWinCondition()` call, same as walking there would.
  `bot-sim.js` gained `simTeleport()` (pure position update, free, wired
  into `simulate()`'s switch) so Hybrid-brain search correctly values
  teleporting as the immediate root decision — root's candidate list
  always comes from the real `BotState.legalActions()`, which does see
  teleport. Known limitation, same category as `breakStone`: `bot-sim.js`'s
  own pure `legalActions(snap)` — used for deeper search plies, since
  those can't call the real DOM-reading function on a hypothetical
  snapshot — doesn't generate teleport candidates yet, partly because the
  Freedom-buff state isn't carried in the snapshot schema at all. A
  multi-step plan that hops through a catacomb mid-sequence won't be
  discovered by lookahead; the immediate "should I teleport now" decision
  is unaffected. `bot.js` gained `teleportBase` (small flat nudge — it's
  free, rarely worth declining) and `teleportShrineValue` (× shrineValue of
  the destination, Freedom-elemental case only — plain catacomb
  destinations have no resource value). Verified against a real running
  game: staged two injected catacomb tiles — `legalActions()` offers
  exactly the one valid destination, `scoreAction()`'s score matches
  `teleportBase` exactly for a plain destination, `applyAction()` moves
  the pawn with zero AP spent, `BotSim.simulate()` mirrors the same
  position change. Negative control: zero candidates from a plain non-shrine
  hex even with catacombs revealed elsewhere. Freedom case: zero candidates
  from an elemental shrine without the buff, one with it stubbed active,
  score correctly includes the shrineValue bonus (not just the flat base).
  10-game self-play regression shows no errors, normal win/draw mix.
- **BOT WEIGHTS: value held void stones for their standing AP bonus; scoped
  earth/fire tactics as follow-up** — `js/bot.js`, `docs/bot-roadmap.md`.
  User question: should place/break weights differ per stone type, since
  each element has a distinct ability? Investigated per-element: wind's
  free movement already prices correctly for free (feeds into `a.cost` in
  the existing generic `moveApPenalty` term); water's value is entirely
  borrowed from whatever it's chained to (mimics earth/wind depending on
  the adjacent stone), so a static weight can't represent it and was
  deliberately left alone. Void's standing AP bonus (`voidAP = pool.void`
  each turn, game-core.js) WAS a real gap — the evaluator priced void pool
  stones identically to every other element's (generic need-based terms
  only). Added 3 weights: `evalVoidHeld` (`evaluateSnapshot()`, additive on
  top of the existing per-element terms — different value source, not a
  replacement) so Hybrid-brain search naturally discounts spending void
  stones (BotSim.simulate() already decrements pool on placeStone);
  `shrineVoidBonus` (`shrineValue()`, void only) so real movement/endTurn
  scoring — which stays greedy even under Hybrid ("plain movement stays
  greedy") — pulls toward void shrines harder; `placeVoidSpendPenalty`
  (`scoreAction()`'s placeStone case) mirrors the same cost for the
  non-search "Dumb" brain fallback. Verified: `evaluateSnapshot()`/`score()`
  called directly with synthetic snapshots via `window.BotSystem` — each
  new term's contribution matched the exact expected weighted delta;
  10-game self-play regression (`BotArena.run`) shows no errors, normal
  win/draw mix. Earth (path-blocking) and fire (destroying an opponent's
  stones) are real opponent-facing tactics the bot doesn't reason about at
  all today, but need more than a quick weight: placement position is
  dictated by the bot's own pattern (`legalActions()` generates candidates
  relative to the bot's own hex, not free placement anywhere), and the
  natural home for a leaf-level bonus (`evaluateSnapshot()`) can't afford
  fresh per-opponent Dijkstra pathfinding at search-leaf call volume (root
  scores every legal action, then expands `searchBreadth` children per ply
  down to `searchDepth`). Fire-vs-common-area-scrolls already works for
  free today, incidentally — `BotSim.simulate()` already models fire
  destroying adjacent non-fire/non-void stones, and `evaluateSnapshot()`'s
  existing `commonAreaThreat()` re-checks opponent pattern satisfaction on
  the post-simulated snapshot. Fire-vs-opponent-hand-scrolls is infeasible
  regardless — opponent hand scroll NAMES are hidden by design (only
  `handElements` is public). Full scoped design (cache each opponent's
  cheapest-path hex set once per decision, not per search leaf; check
  membership cheaply in `scoreAction()`'s root-level placeStone scoring):
  docs/bot-roadmap.md § STAGE 4.
- **BOT ARENA UX: population lineage tracking + Bot Training panel rebuilt as
  a full modal** — `js/bot-arena.js`, `js/game-ui.js`. Follow-up to a user
  Q&A about exactly how `evolve()`/N-player training works (population size
  vs. player-count selector, "Repeat" = generations not total games,
  confirmation is always a 2-player gate regardless of training player-
  count) — the user then asked to surface this mechanism in the UI: "build
  out the bot training window to show more of these metrics... a roster
  list with names... click on a 'player' and see a diagram of its weights."
  `evolve()`'s population members are now `{id, w, parentIds}` objects
  (`newMember()`/`_nextPopId` counter) instead of bare weight tables — the
  top-2 elites literally keep the same object/id across generations, bred
  children get a fresh id and `parentIds:[idA,idB]` (or `[idA]` for
  self-crossover). `onGeneration()` gained a 4th argument (`members`,
  ranked best-first) carrying this; existing 3-arg callers (dev cheat
  panel) untouched. The player-facing "🧬 Bot Training" panel (`.gami-title`
  ×5 trigger, unchanged) is now a full-screen modal instead of a small
  floating panel: Players/Speed/Repeat controls gained explainer tooltips,
  plus a new Population roster (clickable rows: id, fitness bar, lineage
  label) and Generations log fed by a shared `handleGeneration()` callback,
  and a click-through weight-diagram detail view (`weightBar()`) grouping
  `WEIGHT_CATEGORIES` and comparing the selected member's weights against
  `BotSystem.DEFAULT_WEIGHTS`. Caught on self-review before testing: the
  lineage label must check "is this id already seen" BEFORE falling back to
  its birth-parentage text, or a long-surviving elite re-shows its original
  "bred #X×#Y" forever instead of "elite (surviving)". Verified: a headless
  data-layer test confirms elites keep their id/empty-parentIds across
  generations while bred children get correct `parentIds`
  (`repro_population_ids.js`); a headless UI test running the real "Start
  Breeding" flow (population tied to the Players selector, fast at
  population 2) confirms the modal renders 2 roster rows, a generation-log
  entry, and — after clicking a row — the weight-diagram detail view with
  category headers, a `castBase` row, and a valid lineage label, zero page
  errors (`repro_modal_ui_breed.js`). The slower "Start Training" path
  (hardcoded `popSize:6`, ~25 games) was not separately re-verified after
  the rewrite — it shares the identical `handleGeneration` code path as the
  now-verified breeding path, just with a bigger/slower population.
- **BOT FIX: non-host clients rendered bots' tiles at the wrong position
  with the wrong player's color** — `js/bot-state.js`. User report,
  distinct from the placement-freeze entry below (same general area, real
  3-bot 4-5-player game): two human players in the SAME game disagreed on
  which color a given bot was. `BotState.applyAction('placeTile')` read
  `activePlayerIndex` AFTER calling `placeTile()` to build the visual
  `player-tile-place` broadcast every OTHER client renders the tile/pawn/
  color from — but `placeTile()`'s own multiplayer branch (game-core.js)
  already synchronously advances `activePlayerIndex` to the NEXT player as
  part of processing THIS placement (turn-tracking broadcast + local
  advance both happen inside that one call). So the broadcast went out
  under the WRONG index — whoever's turn is next, not the bot that
  actually placed — while `color` (read from the still-correct
  `playerColor` global) was right. Effect: the HOST's own screen was
  always correct (renders its own/its bots' placements directly, not
  through this broadcast); every OTHER client received a tile positioned
  under the wrong index carrying the RIGHT color — bot 2's tile shows up
  as player 3's, in bot 2's color — compounding per bot with 3 host-driven
  bots placing back to back. Only non-host humans were affected, and each
  has independently-corrupted local state, matching the report exactly.
  Fixed: capture `activePlayerIndex` into `placingIndex` BEFORE calling
  `placeTile()`. Verified both directions (fix reports the correct index
  despite `activePlayerIndex` genuinely having advanced by the time of the
  broadcast; negative control via `git stash` reproduces the wrong-index
  broadcast). Also checked: the other 3 human-placement broadcast call
  sites (game-ui.js, mouse/touch/keyboard paths) already correctly use the
  stable `myPlayerIndex` instead of `activePlayerIndex` — this was a
  bot-only bug.
- **BOT FIX: real multiplayer placement phase could freeze forever on one
  player (surfaced by the new multi-bot lobby feature)** — `js/game-core.js`.
  User report: a real 4-player game (2 bots + 2 humans, using the new
  multi-bot lobby) got permanently stuck waiting for one bot's tile
  placement. `placeTile()`'s own existing comment already documented the
  exact race: "if another player's broadcast arrived first, [captured
  playerPositions.length] is wrong" — and correctly corrected
  `playerPositions[]` and the placed tile's own `ownTile.playerIndex` to
  use `myPlayerIndex` instead. It missed that `tilePlayerIndex` itself
  (the SAME stale snapshot) is what's actually used for
  `playerTilesPlaced.add()` and the `player-tile-placed` broadcast
  everyone else receives. When the race hits, a placement gets silently
  attributed to the WRONG (usually already-placed) index, so the true
  placer's index never reaches `playerTilesPlaced`, and every client waits
  forever for a player who already placed — a permanent freeze, not a
  delay. Likely made much easier to hit by this session's earlier
  multi-bot change: host-driven bots place off a fixed 800ms timer tied
  only to `activePlayerIndex`, with no check that this client's own
  `playerPositions` has caught up with prior remote placements yet (unlike
  humans, naturally paced by noticing the UI update) — more players in a
  room means more chances for a remote placement broadcast to still be in
  flight when a bot's turn comes up. Fixed: `tilePlayerIndex = myPlayerIndex`
  alongside the two existing corrections. Verified: staged the exact race
  (stale empty `playerPositions`, correct `activePlayerIndex`/
  `myPlayerIndex`=2) and confirmed `playerTilesPlaced`/tile ownership now
  correctly record player 2; negative control (`git stash`) reproduces the
  bug without the fix — `playerTilesPlaced` incorrectly records the
  already-placed player 0 instead of 2, matching the reported symptom.
  Separately investigated and ruled out (verified empirically, not just
  reasoned): a "board runs out of valid 2-unrevealed-neighbor placement
  spots by the 3rd/4th player" theory — a real 4-player placement sequence
  left 11+ valid candidates for the last player, no exhaustion.
- **BOT STAGE 2.5: drive 3 more scroll effects (Sacrificial Pyre,
  Inspiring Draught, Quick Reflexes)** — `js/bot-effects.js`. All three
  modal ids were already in scroll-effects.js's `EFFECT_MODAL_IDS`, so
  `waitForQuiescence()` already detected them as open — only needed the
  driver functions + `driveSelection()` dispatch wiring, no `bot.js`
  changes. Sacrificial Pyre and Inspiring Draught's put-back step share
  `scroll-select-modal` with Plunder (not yet driven) — routed by the
  exact heading text each effect's `showScrollSelectionModal()` call
  sets. Shared "give up one of these scrolls" heuristic: prefer a
  response-only scroll first (dead weight in the main phase regardless —
  same reasoning as `bot.js`'s `discardResponseOnly` weight), else the
  lowest-level one. Quick Reflexes reuses the existing `rankedElements()`
  need heuristic. Also cleaned up a stray duplicate `bot-effects.js` row
  in `js/INDEX.md` left over from the earlier branch merge, and fixed a
  stale claim there/in `bot-effects.js`'s own header that response
  scrolls were still arena-only (they were extended to real multiplayer
  in an earlier session; the comment just never got updated).
  Verified headless against a real local game (not mocked): Sacrificial
  Pyre correctly sacrifices a staged response-only scroll over a
  non-response one; Quick Reflexes correctly picks the scroll matching
  the pool's most-drained element; Inspiring Draught completes both
  steps end to end, keeping the higher-level of the two drawn scrolls;
  confirmed Plunder's differently-titled `scroll-select-modal` is
  correctly left undriven (no cross-contamination).
- **JOYTONE: silence during bot training runs + connect power button to
  Settings toggle** — `joytone/index.html`, `js/joytone-bridge.js`,
  `js/bot-arena.js`, `js/gamification-ui.js`. Train Weights/Evolve/Breed
  play many short simulated games back to back, each hiding/showing
  `#lobby-wrapper` same as a real game — previously this rebooted the
  Joytone engine and restarted playback from scratch on every single
  simulated game regardless of watch speed; the old "mute" approach
  (nulling `window.JoytoneBridge` inside `muteEnvironment()`, muted runs
  only) never actually worked since it only stopped OTHER code calling
  in, not the internal watcher or already-playing audio. Added real
  `setSuppressed()`/`isSuppressed()`: `startForGame()`/`onTileRevealed()`
  no-op while suppressed (immediately powering off anything already
  playing); `run()`/`evolve()` suppress unconditionally for their whole
  duration regardless of `opts.visual`. `spectate()` (one continuous game,
  the "watch bots for fun" flow) deliberately untouched. Separately: the
  Joytone popup's own ⏻ power button and Settings' "Adaptive Music" ON/OFF
  toggle were previously independent and could disagree — unified so
  muting via Settings also powers the real engine off/on (actual audio-cut
  + CPU savings, not just gain), and the popup's button notifies the
  parent (`_onChildPowerChanged`) so Settings reflects it if open;
  programmatic suppression-driven power changes are explicitly excluded
  from that sync so a training run never corrupts the player's real saved
  preference. Verified headless: mute↔power drive each other both
  directions, suppression powers off an active session immediately and
  guards against the mute-toggle corrupting state while suppressed, and a
  real `evolve()` run stays suppressed for its whole duration.
- **MULTIPLAYER: allow more than one bot player in a real lobby** —
  `index.html`, `js/lobby.js`, `js/bot-driver.js` (comments only),
  `js/INDEX.md`, `docs/bot-roadmap.md`. The lobby's "🤖 Add Bot" button was
  a 0/1 toggle (`toggleBotPlayer()`) — once a bot existed, the same button
  became "Remove Bot" with no way to add a second. Split into
  `addBotPlayer()`/`removeBotPlayer()`, two separate buttons: Add always
  inserts another distinct `🤖 Bot N` row up to the room's existing
  5-player cap; Remove drops the most recently added one (unchanged RPC
  call from before). `bot-driver.js` needed zero logic changes — its
  watcher already recomputes the live bot-index set every tick and drives
  whichever one is active rather than assuming a single hardcoded bot; all
  bots already share whatever `window.BotSystem.WEIGHTS` currently holds
  (the Supabase community champion from the entry above, or local
  training) — this was correctly wired already, just never exercised with
  more than one bot. Verified with a stateful mock of the `players` table:
  4 sequential `addBotPlayer()` calls produce `🤖 Bot 1`-`4`, a 5th is
  rejected with "Room is full!", `removeBotPlayer()` removes the most
  recent, and the Add/Remove button visibility + `(N)` count label update
  correctly across empty/partial/full room states.
- **BOT ARENA: Supabase-backed champion persistence ("Start Training" now
  actually improves the deployed game, not just one browser)** —
  `js/bot.js`, `js/game-ui.js`, new Supabase table on the live `Godaigo`
  project. Correction to a claim made earlier in the same work: this
  app's Supabase RLS is NOT wide open (an earlier read of a stale repo SQL
  file was wrong) — every table already gates writes behind
  `auth.role()='authenticated'` or `auth.uid()=owner`. New
  `bot_champion_weights(weights jsonb, confirm_wins/losses/draws int,
  win_rate generated column, created_by uuid, created_at)` follows the
  same pattern: anyone can `SELECT`, `INSERT` requires
  `auth.uid() = created_by`, no `UPDATE`/`DELETE` policy — an append-only
  log, "best" picked by `win_rate`, nobody can overwrite another entry.
  **Write** (`runWeightTraining`'s `improved` branch): when Start Training
  beats the local baseline in a real confirmation match AND the player is
  logged in, also submits the champion + confirmation record — best-effort,
  never blocks/fails the local result if logged out or offline. **Read**
  (`bot.js`, async/non-blocking): fetches the highest-`win_rate` champion
  on load and merges it over `WEIGHTS` once resolved (Bot Brain preference
  re-applied after, so it still always wins over any submitted table's
  `searchDepth`/`searchHybrid`). Explicit design choice per user
  direction: **always** prefer the community champion, not just as a
  fallback when local storage is empty — a fresh device benefits
  immediately, and a device's own local training can be superseded by a
  better community submission on the next load. Found + fixed during
  testing: the fetch initially used `window.supabase`, which stays the raw
  `createClient` factory forever (`config.js`'s
  `const supabase = window.supabase.createClient(...)` never attaches the
  initialized client to `window` — a top-level `const` doesn't). Every
  other Supabase call site in this codebase already correctly used the
  bare `supabase` global; this one silently no-opped until fixed. Verified:
  migration applied + schema/RLS confirmed live, `win_rate` math sanity-
  checked via a throwaway insert/select/delete, `get_advisors` shows no
  new findings, and a targeted-mock headless test confirms the fetch
  actually overwrites live `WEIGHTS` + `localStorage`. Deliberately left
  alone per explicit user request: the file-based "Breed from champion
  files" section (see entry below) still does NOT touch Supabase or live
  weights — that flow is staying local/manual for now.
- **BOT ARENA: file-based champion breeding (Supabase alternative) +
  visual-run modal fix** — `js/bot-arena.js`, `js/game-ui.js`. Follow-up to
  the Supabase discussion below: rather than a shared backend (no server
  code path exists for this static-hosted game, and the existing Supabase
  schema has no RLS at all), the Bot Training panel gained a "Breed from
  champion files" section — upload up to 2 previously-downloaded champion
  `.json` files as parents, pick a repeat count (1/5/10/20/50
  generations), Start Breeding: population size = the panel's Players
  selector (2-5) per explicit design (a 5-player breed = population of 5,
  2 uploaded + 3 crossover-bred — every generation is one real game with
  the whole population, which `evolve()`'s existing group-sampling already
  reduces to correctly when popSize===nPlayers, no core loop change
  needed). `evolve()` gained `opts.seedWeights` (0-2 tables) to seed the
  population instead of always starting from live WEIGHTS; with 2 seeds,
  remaining slots are bred via the existing `crossover()` between them.
  Breeding explicitly does NOT touch this browser's live bot weights
  (saves/restores around the call, since `evolve()` itself unconditionally
  writes `localStorage` every generation) — the downloaded file is the
  entire deliverable, no confirm-vs-baseline gate needed since nothing
  gets kept live. Also fixed, found while testing: the earlier stray-modal
  sweep only cleared a LEFTOVER modal from before a bot job started —
  `muteEnvironment()` (which stubs `showEndTurnPrompt`) is only called for
  MUTED runs, so any VISUAL/Watchable run (new panel's Watchable speed,
  and the pre-existing "Evolve" cheat-panel button) left the real modal
  live, popping up fresh every time any bot emptied its AP. `playMatch()`
  now stubs it unconditionally for every game's duration regardless of
  visual/muted. Verified: headless watch-loop confirms the modal never
  appears during a Watchable evolve() run; full breed-flow test (upload 2
  synthetic champions, breed 1 generation, confirm download fires and live
  weights/localStorage revert to the pre-breed baseline, not the bred
  result).
- **BOT ARENA UX + EVOLUTION: stray modal sweep, crossover, player-facing
  training panel, un-stoppable confirm phase** — `js/bot-arena.js`,
  `js/game-ui.js`. Four related fixes from a user Q&A session:
  (1) `playMatch()` now removes any stray `#end-turn-empty-ap-modal` at
  startup — `showEndTurnPrompt()` being stubbed during a bot job only
  blocks NEW popups, so a real "out of AP?" modal left up from whatever
  game the human was just in sat unclicked for the whole run (reported as
  "menus that would remain unclicked" during Train Weights, regression
  from an earlier version that apparently swept this).
  (2) `evolve()`'s `mutate()`-only reproduction (top-2 elites, rest =
  mutate(single elite)) replaced with uniform crossover across the top-3
  pool + mutation — two different good strategies can now combine instead
  of only drifting apart independently; top-2 still carry over unchanged
  (pure elitism preserved). New `crossover(a, b, rng)`.
  (3) New player-facing "🧬 Bot Training" panel — click the Profile
  modal's header (`.gami-title`, always literal text "Profile" regardless
  of active tab) 5× within 3s, same debounce as the dev cheat panel's
  AP-label trigger. Lets a player pick 2-5 players and Watchable/Extreme
  speed, then Start/Stop — reuses the same confirmation-gated
  `runWeightTraining()` the existing "Train Weights" buttons use ("Extreme"
  = muted + minimal delay, same mechanism Train Weights already used; a
  true no-DOM headless mode isn't possible in the tab the live static site
  runs in, so it's labeled honestly instead of promised). Hoisted
  `stopAnyRunningBotJob`/`leaveOnlineGameIfAny`/`runWeightTraining` out of
  the dev cheat panel's per-open closure so both panels share one instance
  instead of drifting copies of this correctness-sensitive cleanup;
  `runWeightTraining` gained optional `{nPlayers, visual}`, defaulting to
  prior behavior for existing callers.
  (4) Fixed: clicking Stop during the evolve() phase of Train Weights only
  cut that phase short — `run()` resets the same shared `_stopRequested`
  flag the instant it starts, so the confirmation series behind it ran to
  completion regardless, un-stoppable (could be 10-20+ un-cancellable
  games). Exposed `BotArena.stopRequested()`; `runWeightTraining` now
  checks it before starting confirmation and reverts to the pre-training
  weights instead. Fixes both the new panel and the pre-existing cheat-panel
  buttons. Also discussed but NOT built (deferred pending user direction):
  Supabase persistence for champion weights (currently `localStorage` only
  — the only way evolved weights currently reach every player is the
  existing manual "copy champion JSON from console → paste into
  `DEFAULT_WEIGHTS` → commit → GitHub Pages redeploy" path; this app's
  Supabase schema has no RLS at all today, so an auto-apply-from-Supabase
  design needs a fitness-must-improve gate before any open anon-write table
  could safely drive live gameplay for every visitor).
  Verified: 4 targeted headless Playwright repros (stray-modal sweep,
  crossover-enabled evolve() at popSize 4, new panel's full click-through
  including Start/Stop, existing cheat panel + its own Train Weights/Stop
  still work unchanged after the hoist).
- **BOT FIX: spectator match dying after turn 1 (stale isMultiplayer identity)** —
  `js/bot-arena.js`. `BotArena.spectate()`/`playGame()` never reset
  `isMultiplayer`/`myPlayerIndex` before starting a LOCAL match — they relied
  entirely on a prior online game having been left cleanly. If that leave
  didn't fully complete (its `remove_player` RPC can throw), a local bot
  match inherited a stale `isMultiplayer=true` with a mismatched
  `myPlayerIndex`, which made `updateEndTurnButtonVisibility()` gate the
  end-turn button on real-multiplayer turn ownership instead of "always
  enabled locally" — silently disabling it and killing the match the instant
  a bot force-ended its turn. Reported symptom: a real 3-bot spectator match
  ending after turn 1 ("stuck on turn 0 (end-turn button unavailable)").
  Fixed with `ensureLocalMode()`, called at the start of `playGame()` and
  `spectate()` (covers `run()`/`evolve()` too). Verified by staging the
  exact stale state and confirming the match dies at turn 1 without the fix,
  runs the full turn cap with it.
- **RULES CHANGE: opponent hand scrolls show element type, not just count** —
  `js/game-ui.js` (`updateOpponentPanel()`), `js/bot-state.js` (`snapshot()`),
  `css/styles.css`. Previously the opponent panel showed "Hand: N scrolls
  (hidden)" with zero breakdown; now each hand scroll renders as an element
  icon (name/pattern still hidden) — same idea as a card game showing suit
  but not rank. `BotState.snapshot()` now exposes `players[i].handElements`
  (public for all players) alongside the existing `hand` (still `null` for
  opponents) and `handCount`. Not yet consumed by any scoring logic — this
  is the observability half of the "bot should react to opponent threats"
  discussion (see bot-roadmap.md), the evaluator half is unscoped/unbuilt.
  Verified: snapshot correctly reports `handElements` without leaking scroll
  names, UI renders one icon per opponent hand scroll.
- **RULES CHANGE: player tiles are off-limits for stones/opponent movement** —
  `js/game-core.js`, `js/game-ui.js`, `js/bot.js`, `js/bot-sim.js`. Two new
  rules: (1) stones can never be placed on a player tile or its bridge hexes
  (own or opponent's) — gated once in `isInPlacementRange()` via the new
  `isPositionOnPlayerTile()`, so all 6 call sites (drag-drop, keyboard
  cycling, bot legalActions/applyAction, plan-building) inherit it
  automatically; (2) a player may not move onto the CENTRE hex of another
  player's tile (their own centre stays reachable, required to win) — gated
  in `canPlayerMoveToHex()` via the new `isOpponentTileCenter()`, inherited
  by every caller (bot pathfinding/Dijkstra, drag movement, keyboard
  movement). `bot-sim.js`'s pure movement-cost mirror updated to match, so
  search/lookahead stays accurate. Considered and rejected an end-turn-based
  version of rule 2 first (blocked ending turn while standing on an
  opponent's tile) — abandoned after finding it could soft-lock a bot with
  0 AP on an opponent's tile in the local arena (no turn-timer safety net
  there, unlike real multiplayer); the user simplified to a movement
  restriction instead, which has no such risk since the tile is simply
  never enterable. Verified: direct function tests (own-centre movable,
  opponent-centre blocked, own/opponent placement blocked, bridge hex
  blocked, normal hexes unaffected) all pass; 15-game arena regression
  batch shows 14 decisive wins, 0 errors, 0 stuck turns, win rates
  comparable to pre-change baselines. Documented in
  docs/game-design-document.md and docs/INDEX.md.
- **BOT FIX: per-bot memory was shared across bot players (the actual
  "trapped in loops" bug)** — `js/bot.js`. Found from a real user's
  downloaded 2-bot-vs-2-bot action log showing an identical 6-hex
  hub-and-spoke movement path repeated turn after turn forever. Root cause:
  `_plan`/`_recentPositions`/`cellFailCount`/`cursedCells` were single
  shared module variables — fine for real multiplayer (one bot identity
  per tab) but broken for the cheat panel's local hot-seat/spectate modes,
  where ONE bot.js instance drives multiple bot players alternately, so
  each player's anti-oscillation memory got overwritten by the OTHER
  player's moves every turn switch. Fixed by keying all per-bot state
  behind `mem(playerIndex)`. Also added a coarser safety net: `botTurn()`
  detects when a player repeats last turn's exact move sequence and
  `botAct()` skips movement for one turn when that happens. Verified: 0
  exact-repeat occurrences across two fresh 15-game arena batches (previously
  reproducible every batch); circuit breaker fired 7x in one batch,
  correctly picking productive alternatives. **Follow-up flagged, not yet
  fixed:** a related within-turn oscillation from hybrid search staying
  engaged too broadly during exploration — see bot-roadmap.md § STAGE 1.
- **BOT FIX: placement phase was dead code outside real multiplayer** —
  `js/bot-state.js`. Root cause of a fresh "bots get stuck immediately"
  report: `legalActions()`/`applyAction()`'s `placeTile` handling both
  gated on `isPlacementPhase`, a flag ONLY set by the real multiplayer
  lobby flow — the local `startGame()` never touches it, and BotArena
  never caught this because its own placement helper bypasses BotState
  entirely for placement. Tutorial Mode has no such bypass, so a bot
  driven from the console right after "Play Tutorial" got zero legal
  actions forever ("No legal actions found" on every step — indistinguishable
  from a stuck loop to a human tester). Fixed by falling back to "this
  player has no pawn placed yet" (observable state) when the flag isn't
  meaningfully set. Verified: the same repro now plays 15 real turns,
  3/5 elements activated, no errors. Full writeup: bot-roadmap.md § STAGE 0.
- **BOT STAGE 2.5 (first increment): scroll-effect selection driving** —
  `js/bot-effects.js` (new), wired into `js/bot.js`'s `waitForQuiescence()`.
  Drives 5 of 12 selection-mode effects instead of cancelling them:
  tile-flip (Heavy Stomp / Call to Adventure), scorched-earth (Combust),
  tile-swap (Shifting Sands), Create, Scholar's Insight — all by calling
  the game's own `selectionMode.handleXClick()`/modal buttons directly,
  same philosophy as `BotState.applyAction()`. Found + fixed a real
  dispatch bug via arena testing (Scholar's Insight's cleanup-only
  selectionMode was silently swallowing the modal check before it ran).
  Measured on 8 arena games (same seeds, with/without `BotEffects`): fewer
  draws, higher fitness for the side benefiting from driven effects — no
  regressions. Remaining 7 selection scrolls + response-scroll playing are
  scoped in bot-roadmap.md § STAGE 2.5 but not yet built.
- **BOT FIX: doomed piecemeal placeStone loop** — `js/bot.js`. Reported
  symptom: bots in testing "easily get stuck doing nothing or going around
  in circles." Reproduced via `BotArena.run()` bot-vs-bot batches (not
  reachable from single-turn console testing): a 200-turn game deadlocked
  as a draw with one side stuck at 0/5 elements for the ENTIRE game — 228
  `placeStone` actions, 0 `cast` actions, 178 of them feeding stones into an
  already-won `WIND_SCROLL_5` pattern that could never grant win credit
  again. Root cause: `castAlreadyWon` only guards the `cast` action; the
  anchored `_plan` system's credit gate only protects plan-driven
  placements; the greedy fallback and default hybrid-search path both pull
  raw candidates from `BotState.legalActions()`, which has no win-credit
  awareness. Fixed with a shared `hasWinCredit()` check + hard veto
  (`placeNoCredit: -500`) applied in both `scoreAction()` and
  `searchPick()` (root + every recursive ply). Confirmed on the exact
  reproducing seed: 200-turn draw → 42-turn decisive win. Full writeup:
  docs/bot-roadmap.md § Stage 1 fixed-bugs list (5th entry).
- **MASON'S SAVVY PLACEMENT RANGE FIX** — `js/game-core.js`, `js/game-ui.js`:
  `findValidStonePosition()` read the stone type off the module-global
  `draggedStoneType`, but both the mouse and touch drop handlers nulled
  that global *before* calling it, so `isInPlacementRange()` always saw
  `stoneType = null` and silently skipped the earth-only extended-range
  check (Mason's Savvy) and the water/wind one (Seed the Skies), falling
  back to plain adjacency. The keyboard placement-preview path passed the
  type explicitly and worked fine — hence the "inconsistent" symptom.
  Fix: `findValidStonePosition(x, y, stoneTypeOverride)` now takes an
  explicit override; both drop handlers pass the captured type before
  nulling the global. Verified headless via Playwright (stubbed Supabase
  client, tutorial board): same distance-3 earth-stone drop with the buff
  active went from `valid: false` → `valid: true`.
- **BOT STAGE 2.5 (later increments): Transmute driving + response scrolls in
  real multiplayer** — `js/bot-effects.js`, `js/bot-driver.js`,
  `js/response-window.js`(-adjacent), `js/game-core.js`. Added
  `driveTransmute()` (open-ended discard-for-AP modal, no `selectionMode`
  object) and `decideResponse(responderIndex, casterIndex)` (v1 respond/pass
  heuristic, no bluffing). Wired into both the arena (`bot.js`
  `waitForQuiescence`, gated on `BotArena.isRunning()`) and real multiplayer
  (`bot-driver.js`'s new `respondForBots()`), which required removing the
  "bots never count as responders" carve-out in response-window.js and fixing
  an AP-accounting gap for non-active responders (`syncPlayerState()`/
  `spendPlayerAP()`). Full writeup: bot-roadmap.md § STAGE 2.5.
- **BOT ARENA: N-player playMatch() unification** — `js/bot-arena.js`,
  `js/game-ui.js`. Extracted `playMatch(weightsPerPlayer, opts)` as the
  single game-runner both `run()`/`evolve()` (previously 2-player only) and
  `spectate()` (previously its own separate loop) call, so `run()`/`evolve()`
  gained `opts.visual` (watch training games live) and `evolve()` gained
  `opts.nPlayers` (2–5; >2 samples random N-player groupings per generation
  instead of exhaustive pairwise). New "🧬 Evolve" cheat-panel row alongside
  "🤖 Bot match". **Merge note:** this rewrite was built on a fork of
  bot-arena.js that predated `ensureLocalMode()` (the stale-isMultiplayer fix
  above) and the `sideFitness()`/`stuckTurns`/progress-callback machinery
  from later commits on this branch — the merge re-added all three to the
  unified `playMatch()`/`run()`/`evolve()` rather than losing them.
- **BOT STAGE 2 (forward model + lookahead)** — `js/bot-sim.js` (new):
  pure `simulate(snap, action)` over the Stage-0 snapshot (move incl.
  tile-reveal-as-unknown, endTurn incl. shrine collection + COLOR_RANK turn
  order, placeStone incl. fire-destruction rules, cast with whitelist-gated
  effects), pure `legalActions(snap)`, `isTerminal/winner`, and a
  `validate()` mirror-and-diff harness. Validated headless (Playwright +
  tutorial board): 0% divergence for move/endTurn/placeStone/discard
  (~750 mirrored actions) — roadmap target was <1%. Lookahead in `bot.js`:
  `searchPick()` beam search + `evaluateSnapshot()`, enabled by
  `WEIGHTS.searchDepth > 0` (**default 0 = greedy unchanged**; flip only on
  Stage-3a arena evidence). Also fixed `BotState.applyAction('cast')`
  silently no-opping when castSpell's multi-match selection popup appears.
  Full details + new gotchas: docs/bot-roadmap.md § STAGE 2.

## Previously Committed Work
- **NEW WIN CONDITION (rules change):** winning now requires activating all 5 elements
  AND returning the pawn to the centre of your own player tile (the "player shrine").
  Single gate: `checkWinCondition(playerIndex, {announce})` in `game-core.js` (also on
  `window`). All former `activated.size === 5` checks route through it; movement paths
  (placePlayer move branch, broadcastPlayerMovement, movePlayerVisually) call it on
  arrival. Includes: shrine beacon (pulsing ring on the player tile), "return to your
  shrine" status prompt, bot support (`WEIGHTS.moveReturnHome`, snapshot tiles carry
  `playerIndex`), tutorial + docs text updates.
  This also fixes the original bug where a `requiresSelection` scroll (e.g. Control the
  Current) as the 5th element never triggered the win screen — the win check now runs
  before the early return in `applyScrollEffects()`.
- Joytone adaptive music integration: `joytone/` (embedded music app + MIDI/sf2 assets),
  `js/joytone-bridge.js` (hidden iframe, Shift+J+T popup, tile-reveal → seeded riff,
  per-player mute/volume in Settings). Details: js/INDEX.md § joytone-bridge.js.
- Tutorial system: player places own tile, explores freely, first flip forced to Earth
- Distributed docs system: CLAUDE.md, js/INDEX.md, js/scrolls/INDEX.md, css/INDEX.md,
  docs/INDEX.md, planning/current.md, .claude/skills/sync-docs.md

## Current Status
Tutorial functional through step 4 (Earth tile reveal + scroll drawn). Steps 5–14
exist in code but are untested end-to-end. Docs system fully in place.

---

## NEXT SESSION TASK LIST (priority order)

### 0. Bot track (see docs/bot-roadmap.md)

**PLAN AGREED WITH OWNER 2026-09-25: bots that use scroll combos.** Goal: bots find
combos (Wandering River on a face-down tile + Heavy Stomp, Burning Motivation +
Avalanche, multi-turn setups) by search and by learning from recorded games, not by
hand-written rules. Owner: no manual combo recording.
- **Phase 1 (small): the look-ahead sees scroll value.** Shared "scroll need" per
  element (not activated, source not empty, no buildable scroll held; buildability
  = pattern stones vs pool). evaluateSnapshot values hand scrolls by it instead of
  the flat evalScrollHeld. Search always keeps a few setup casts (buff-setting
  scrolls) in the beam and goes deeper on turns with a castable scroll. Arena A/B.
- **Phase 2 (big, one scroll at a time): choices become moves.** A cast carries its
  choices (e.g. {cast WATER_SCROLL_4, tileId, element}); BotState and BotSim
  legalActions list sensible choices; bot-effects drivers carry out the chosen
  ones (current heuristics stay as fallback). Sim: River on a hidden tile gives an
  element-known scroll on reveal; buffs unlock placements (Avalanche, Seed the
  Skies, Mason's Savvy; Burning Motivation stones-for-AP). validate() per scroll.
  First batch: Wandering River, Heavy Stomp, Scholar's Insight, Inspiring Draught,
  Quick Reflexes, Avalanche + Burning Motivation.
- **Phase 3: replay miner.** Check that recorded moves carry each scroll's choices.
  Store each human's ladder rank at match start in matches.players. Replay finished
  games at full speed in the background (reuse replay-viewer runInFrame), score
  each player after every move with evaluateSnapshot, find big jumps, look back a
  few turns for that player's casts + choices = candidate combo. Weight = gain x
  rank trust (floor for low ranks) x experience (games played); bots excluded.
  Shared table; a combo is promoted only after it repeats and pays on average.
  First output: hermit tab listing found combos (also a balance tool).
- **Phase 4: bots follow mined combos.** Match a combo's start conditions, keep
  "step N of this plan" across turns (like the build plan), look-ahead checks each
  step against the real board and drops the plan if it does not fit. Arena A/B.
- **Phase 5: widen learn-from-player (bot-imitation.js).** Today it learns only from
  endTurn and discardScroll. Add casts and moves first, then stone placements and
  breaks, then scroll choices (after Phase 2). Small nudges, arena regression
  check. If opened beyond the hermit, weight nudges by ladder rank.
- Open questions: where the miner runs (hermit browser batch or headless tool),
  whether arena games should be recorded too.

1. ~~Stage 3a — self-play arena~~ **DONE** (`js/bot-arena.js`). First
   measurements: HYBRID search beat greedy **12-3-5** over 20 games →
   hybrid is now the default bot brain (searchDepth 3 + searchHybrid 1).
   Full always-on search LOST 1-3-4 — don't enable without new evidence.
   Arena runs also flushed out + fixed 5 real bot bugs (stale hex-grid
   cache, cul-de-sac freezes, hand-only planning, missing common-area
   casts/voluntary discards, anti-freeze vs shrine collection) — details
   in bot-roadmap § STAGE 3a.
2. **Stage 2.5 — scroll-effect usage: FULLY DONE.** Step 1 (inventory) is
   **DONE** — full table of all 17 selection-mode/response scrolls in
   bot-roadmap.md § STAGE 2.5. Step 2 (`js/bot-effects.js`) is **DONE**:
   every selection effect is driven (tile-flip, scorched-earth, tile-swap,
   Create, Scholar's Insight, Quick Reflexes, Sacrificial Pyre, Inspiring
   Draught, Wandering River, Arson, Plunder, Control the Current, Excavate,
   Take Flight, Telekinesis), A/B-measured in the arena (fewer draws, no
   regressions vs. baseline on identical seeds). Step 3 (response scrolls)
   is **DONE** — arena AND real multiplayer, via `bot-driver.js`'s
   `respondForBots()`. Nothing left in Stage 2.5's original scope. Full
   plan + writeups: bot-roadmap § STAGE 2.5.
3. Later: rerun hybrid-vs-greedy at 100 games + run BotArena.evolve()
   at scale (wants R5 server-side execution to be practical).
4. **Opponent-awareness — Tracks A, B, and C all DONE.** Track A:
   `evaluateSnapshot()` now scores opponent threat —
   `opponentProgress(snap, oppIndex)` mirrors the bot's own
   activated+home-distance terms for every opponent (MAX across opponents,
   not sum, so it doesn't dilute in 3-5p); `commonAreaThreat(snap, forIndex)`
   flags any live common-area scroll an opponent's CURRENT board could cast
   right now, via `BotSim.checkPattern(snap, scroll, playerIndex)` (already
   parameterized for any player, just unused before). New weights
   `evalOpponentThreat: 0.3`, `evalCommonThreat: 80`. Found and fixed a real
   bug along the way: `bot-sim.js`'s `simDiscard()` didn't model common-area
   REPLACEMENT (one scroll per element, old one bumped to deck bottom) — it
   just pushed onto an unbounded array, so the denial mechanic could never
   register in simulation. Verified: `evaluateSnapshot()` delta exactly
   matches each new weight in isolation; a constructed scenario (opponent's
   board satisfies a common scroll, bot holds a dead-to-it same-element
   scroll) makes `searchPick()` correctly choose the denial discard
   (score 436) vs. ignoring it entirely with the terms zeroed (picks a plain
   move instead, 464) — a real behavior change, not just a score delta. A/B
   arena batch (30 games, same seed, weights on vs. zeroed): 12-13-5 vs.
   13-12-5, avg turns 69.3 vs. 70.2 — statistically identical, **no
   regression**. Not yet reachable from hybrid search's non-search branch
   (greedy `scoreAction()` has no opponent awareness) — flagged, not closed.
   Track B (generalize `playGame()`/`run()`/`evolve()` past 2 players) is
   **DONE** — this note just never got updated when it happened. Confirmed
   directly in `bot-arena.js`: `playMatch(weightsPerPlayer, opts)` derives
   player count from `weightsPerPlayer.length` and is genuinely N-player
   (2-5) generic; `evolve()` takes `opts.nPlayers` and samples N-player
   groupings when >2; `playGame()` is now just a thin 2-player backward-
   compat wrapper around `playMatch()` (kept for console/roadmap scripts
   that reference its old signature directly). `run()` deliberately stays
   2-player-only — not a gap, a design choice, since the confirmation gate
   (champion vs. baseline) is always a pairwise comparison regardless of
   how many players a training run itself uses. Track C (catacomb/Freedom
   teleport action) is **DONE** — see the BOT STAGE 5 entry above. Neither
   track has open work remaining.
5. **KNOWN ISSUE, still open, DIAGNOSIS CORRECTED: response-only (level-1)
   scrolls can sit stuck in a common-area element slot for a long stretch
   ("elemental lockout").** Original theory (now stale): the fix was "give
   bots response-scroll support" (`response-window.js`'s `isBotPlayer()`
   hard-exclusion). That support shipped (STAGE 2.5 step 3,
   `BotEffects.decideResponse()`, arena + real multiplayer) — but it does
   **NOT** close this gap, because casting a common-area scroll (main-phase
   by anyone, or as a response) was never what clears its slot. Confirmed
   directly in `game-core.js`'s `handleScrollDisposition()`: *"Common area
   scrolls are permanent shared resources — casting them does NOT remove
   them from the common area. They only leave when replaced by a new
   scroll of the same element type."* — an explicit, unconditional game
   rule, true for humans and bots alike, unrelated to who's allowed to
   respond. The ACTUAL mechanic (`discardToCommonArea()`): any discard of a
   scroll of that element, by anyone, ALWAYS unconditionally overwrites the
   slot (old occupant goes to the bottom of its deck) — a same-element
   discard is never wasted. So the real bottleneck isn't casting/responding
   at all, it's simply whether anyone ever draws-then-discards another
   scroll of that specific element again — ordinary draw variance, not a
   bot-specific exclusion bug. Confirmed on real data: in a 200-turn drawn
   arena game (seed 40000, game 6 of a 30-game batch), `EARTH_SCROLL_1` and
   `FIRE_SCROLL_1` each landed in their element's common-area slot around
   the 65-70% mark and were never replaced for the rest of the game, while
   every other element's slot kept churning normally. A real bot-side
   mitigation would mean specifically valuing "does discarding this scroll
   displace a bad common-area occupant" as its own signal (separate from
   the existing per-scroll dead/activated discard checks, which only look
   at the scroll being discarded, never at what's currently sitting in that
   element's slot) — not yet scoped, and it's unclear this is worth scoping
   given the underlying cause is draw variance rather than a fixable logic
   gap.

### 1. Tutorial — Earth Shrine Step (MEDIUM, tutorial-mode.js)
After step 4 (scroll found), the tutorial should:
- Guide player to walk to the **center hex of the earth tile** (the shrine center)
- Tell them to **End Turn** there to collect 5 earth stones
- The `#end-turn` button spotlight already exists in step 8 (`getting-stones`) — but
  the flow needs an explicit "now go stand on the shrine center and end your turn" step
  BEFORE the stone-abilities explanation.
- Hook to use: `onPlayerMoved(x,y)` is currently a no-op — wire it up to detect when
  the pawn is within ~20px of `EARTH_POS` (the revealed earth tile center) and set a
  flag. Then detect end-turn from `onEndTurn` hook (doesn't exist yet — needs adding
  in `game-core.js` where `endTurn()` is called).
- Alternatively: advance automatically when `stoneCounts.earth` increases (check after
  end-turn resolves).

### 2. Source Pool Win Condition Bug (HIGH, game-core.js)
**Rule (from game design doc):** If the source pool for an element has 0 stones remaining,
casting a scroll of that element still works (effect fires) but does NOT count toward
the player's win condition. The win condition only registers if ≥1 stone of that type
exists in the source pool at cast time.

**Where to fix:** `applyScrollEffects()` in `game-core.js`, specifically the block that
calls `spellSystem.activated.add(element)` (the win-condition tracking). Before that
add call, check `stoneCounts[element] > 0` (stoneCounts = source pool). If 0, skip
the add but still run the scroll effect. Show a status message like:
"Scroll cast! (No [element] stones in the source pool — win condition not awarded.)"

**Relevant variables:**
- `stoneCounts` = source pool (global, 0–25 per element)
- `spellSystem.activated` = Set of elements the active player has won
- The `cancelled` flag already exists for a different case (empty hand on Sacrificial
  Pyre) — do NOT reuse it here; add a separate `noWinCondition` flag or inline check.

### 3. Tutorial — Clarify Stone/Scroll Limits
The tutorial text is vague. Make these explicit at the appropriate steps:
- **Player stone pool**: max **5** of each element type (shown as `X/5` in left panel)
- **Source pool**: max **25** of each element type (shared across all players)
- **Hand size**: max **2** scrolls
- **Active area**: max **2** scrolls
- **Source pool + win condition**: if source pool for an element hits 0, casting a
  scroll of that element won't count toward your win — acknowledge this in the
  "getting stones" step of the tutorial.

---

## Known Open Issues
- `onPlayerMoved` hook in game-ui.js exists but tutorial-mode.js treats it as no-op
- Steps 5–14 of tutorial untested in full sequence

(`TRANS-WIN-CON` and `TRANS-DOUBLE-DISP` confirmed cleared — removed from this list.)

## Files Currently In Flight
None — all changes committed and pushed.

## How To Resume
1. `git log --oneline -5` to confirm last commits
2. `npx serve -p 3333` → open `http://localhost:3333`
3. Click "Play Tutorial" on auth screen (do not log in)
4. Play through to step 4 to confirm baseline, then work on task list above

---

*Last updated: 2026-08-09 (latest: Shifting Sands now allows swapping a tile with one player on it — carried along + recentered, 2+ players still blocks it — and Take Flight was redesigned: destination must be an unoccupied hex on a tile occupied by another player, opponent-targets now choose their own landing hex instead of the caster picking for them (real-multiplayer client hand-off, plus a same-client short-circuit for bots added via the lobby's Add Bot button, since that broadcast round-trip can never complete when broadcast:{self:false} and the caster IS the bot's driving host), and the old hand-vs-active-area scroll disposition rule was dropped entirely — full breakdown in "Last Committed Work" above, branch `claude/missing-video-filename-sc1ajm`; before that: 2026-07-14, bots can no longer place stones on the empty space left by a Telekinesis/Shifting-Sands-moved tile — applyAction('placeStone') now requires a real board hex and planValid() re-checks plan cells against the live grid; before that: catacomb teleport ping-pong is now penalized in the weights (teleportRevisitPenalty — return hops score -55, fresh hops keep +5) and the arena gained a second stall detector — 15 rounds with no one casting anything restarts the round, catching the free-teleport loops the elemental-tile camping detector can't see; before that: fixed the host's response window being auto-cleared when a lobby bot submitted its pass/response first — UI teardown in response-window.js is now gated on the local human, not whoever's submission this client happened to process; before that: arena trap-loop stall restart — two bots each camped on an elemental tile for 7 straight turns now aborts and replays the round with a derived seed instead of grinding to the 200-turn cap; corrected a stale planning note — opponent-awareness Track B, generalizing playGame()/run()/evolve() past 2 players, was actually already done via the earlier N-player playMatch() unification, just never marked as such; also merged: the Bot Training panel now has a persistent corner popup showing live scenario/progress that survives the main modal being closed, plus a new "End Early" control (BotArena.endEarly(), distinct from the existing hard Stop) that cuts a training/breeding run short while still running the confirmation match or downloading the champion with whatever was reached so far; Stage 2.5 scroll-effect driving is now FULLY COMPLETE — Excavate, Take Flight, and Telekinesis were the last 3, all genuinely drag-only or previously misfiled as such, driven by calling the exact same functions the real UI drop handlers call rather than simulating drag events; earlier this session: Control the Current (needed a waitForQuiescence() architecture change for its persistent whole-turn nature), 3 more selection effects (Wandering River, Arson, Plunder), a stale-doc cleanup that corrected the "elemental lockout" bug's root-cause diagnosis, the catacomb/Freedom teleport bot action (closing Track C), void-stone-value weights, and the Bot Training modal rebuild with population lineage tracking — see "Last Committed Work" above for full details on each)*
