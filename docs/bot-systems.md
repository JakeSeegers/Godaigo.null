# Bot Systems: One Plan

> Status: PLAN for owner review (2026-10-14). Nothing here is built yet unless marked "exists".
> Goal: draw the bot's many separate parts into one brain, one exam, one queue of
> challengers, one game record and one hermit dashboard.

---

## 1. Why

The bots grew one feature at a time. Each new idea brought its own way to train, its own
data and its own pass / fail test. Problems found on 2026-10-14:

- **Five different tests.** A new brain is judged differently depending on which path made it.
- **Responses almost never happen in 2-player training.** Training is mostly 2-player (the
  challenger series and idle training); Train Bot's Explore step and confirmAcrossSizes also play
  3-5 player games (about 1 in 5 recent training games). Measured 2026-10-14 with diplomacy on:
  2 players: 389 turns, guard mode wanted on 104, 0 guard plans, 0 response chances (70 of the 104
  the bot was one cast from winning itself and raced, 22 had no counter in reach, 12 wanted a
  Psychic guard but no plan could be made). 3 players: pacts on 59 turns, 0 responses. 4 players:
  pacts on 91 turns, guard role 14, 3 response chances, 2 responses in 3 games (real games: 22 bot
  responses in 126). Reflect, Unbidden Lamplight and Sigh have no guard behaviour at all: bots only
  respond when they happen to stand in the pattern with AP left.
- **Rare scrolls get no training signal.** In 24 bot games most scrolls were cast in only 2 to 8
  games, and 9 were never cast. A setting for one scroll (for example Simplify's) cannot move the
  win rate enough for training to notice.
- **New settings are rarely tested.** Simplify, owner strategies, combo settings and others start
  at a hand-picked value and mostly stay there.
- **Data is scattered.** Some on the server, some only in one browser (scroll report).
- **Two climbs.** Train Bot climbs alone in one browser; idle training climbs on the server. Their
  games never add up.

---

## 2. Map of today

### 2.1 The brain (how a bot picks a move)

| Part | Where | Status |
|------|-------|--------|
| Weighted scoring of every legal action | bot.js scoreAction, evaluateSnapshot, WEIGHTS | exists, core |
| Look-ahead search (default depth 3) | bot.js searchPick, bot-sim.js forward model | exists, core |
| Build plans (make a scroll's pattern) | bot.js makePlan | exists |
| Taught combos + trial combos | bot.js mem.combo, activeCombos, WEIGHTS.extraCombos | exists |
| Owner strategies (Sands travel, Mason trap, burn loop, adventure) | bot.js strategyParts, stratX weights | exists, weights 0 until trained |
| Pacts, guard, harm, help, kingmaker filter | bot-diplomacy.js + bot.js harmContext / helpContext / guardWanted | exists; pacts need 3+ players; guard mode rarely seen in training |
| Formula terms (extra senses) | bot-terms.js, WEIGHTS.terms | exists |
| Network correction | bot-net.js, WEIGHTS.net + netWeight | exists, off by default (netWeight 0) |
| Scroll-specific rules (Simplify discard, Pyre target, stuck tools...) | bot.js, bot-effects.js | exists, scattered |
| MCTS + episode memory | bot.js mctsPick, bot-memory.js | exists, OFF (mctsEnabled false); memory only feeds MCTS |
| Elemental leans, Twitch moods | bot-elements.js, stream-votes.js | exists, personality, not trained |

### 2.2 Ways to improve the brain

| Path | Where | What it makes |
|------|-------|---------------|
| Train Bot (one-click hill climb) | game-ui.js runHillClimbTraining, bot-arena.js hillClimb, confirmAcrossSizes | random weight changes, formula ideas, imitation and trial-combo seeds; challenger series 2-player, confirm across sizes 2-5; promotes a champion row itself |
| Idle training (shared climb) | idle-training.js, sql/idle-training.sql | challengers kind explore / formula / combo / imitation / net; 2-player; server decides |
| Formula Lab | formula-lab.js | hand-written formula ideas, queued for Train Bot |
| Bot Network training | bot-net.js (hermit) | a trained network, sent to idle training as kind 'net' |
| Learn from my play | bot-imitation.js | weight nudges from the hermit's own choices |
| Combo mining (real games) | replay-viewer.js mineMatches / minePooled | combo candidates, taught by trust |
| Bot combo finds (training games) | bot-arena.js combo watcher | combo finds, screened, tried as trial combos |
| Explore step (evolution) | game-ui.js Explore, bot-arena.js evolve | a population over 2-5 player games |

### 2.3 Tests a new brain must pass

| Test | Used by | Rule |
|------|---------|------|
| Idle verdict | idle training | drop under 35% at 12 decided games or 45% at 24; promote at 58%+ of 40 decided |
| Hill climb challenge | Train Bot | 58% over 30 games per challenger, then a confirm run |
| Puzzle check | Train Bot (hermit) | average score on mined combo puzzles must not drop |
| Practice duels | Train Bot, idle training | challenger vs champion on the same taught-combo spot |
| Combo screening | Train Bot, idle training | 8 games champion+combo vs champion, wins >= losses |

### 2.4 Data

| Data | Where | Shared? |
|------|-------|---------|
| Position samples (network) | position_samples table | yes |
| Combo candidates (real games) | combo_candidates, mine_jobs | yes |
| Bot combo finds | bot_combo_finds, combo_screens, combo_train_trials | yes |
| Idle challengers and results | idle_candidates, idle_games | yes |
| Champion | bot_champion_weights | yes |
| Scroll report | localStorage godaigo_scroll_report | NO, one browser |
| Strategy stats, Bot Mind, lag recorder | memory only | no |
| Real games | matches, match_moves | yes |

---

## 3. The target: five pieces

### 3.1 One brain file

The champion's weight table already carries weights, formula terms, the network and extra
combos. Rule: **every improvement path edits only this table.** No path keeps its own hidden
settings (Learn from my play deltas become a challenger, as they already do in idle training).

Housekeeping:
- Every weight gets a short entry in a settings list: what it does, which part reads it,
  allowed range, and whether training may change it. Personality settings (social, leans)
  stay locked, as pinSocial already does.
- Decide MCTS + episode memory: remove, or keep as an experiment behind one switch.

### 3.2 One exam

One scorecard every challenger takes, no matter which path made it. Sections:

| Section | What | Why |
|---------|------|-----|
| A. Normal games | challenger vs champion, mix of 2-, 3- and 4-player games, sides swapped | overall strength; 3-4 players bring pacts, guard mode and responses in |
| B. Scroll drills | a seat starts with a chosen scroll (opts.startScrolls exists), weakest scrolls first (from the scroll report) | rare scrolls get practiced |
| C. Response drills | a seat starts with a counter in reach, an opponent close to winning | guard mode and responses get judged |
| D. Combo practice | the existing practice duels | taught combos |
| E. Puzzles | the existing mined puzzles | real-game skill |

Verdict:
- **Section A decides promotion**, with a Fishtest-style early-stopping rule (SPRT) instead of a
  fixed game count, so clear winners and losers stop early.
- **Sections B to E are guard rails**: a challenger may not get clearly worse there. They never
  mix into A's win rate (chess testers found that mixing forced positions into the main result
  distorts it).
- The exam is one function (`BotExam`), used by Train Bot and idle training alike. The five
  tests in 2.3 become its sections.

### 3.3 One queue of challengers

Every improvement path only **submits a challenger** to one shared queue (today's
idle_candidates table, extended). Kinds: explore, formula, net, combo, imitation, strategy,
hand-made (owner or Claude ideas).

- Idle training plays exam games for the queue (as now).
- **Train Bot also plays exam games for the queue** instead of its own private climb, so every
  browser's games add up. Train Bot keeps making new challengers (it is good at search), but
  sends them to the queue.
- The server (one SQL function) gives the verdict and promotes; nobody promotes alone.
- Gold for training stays: paid per finished exam game, plus a bonus when "your" challenger is
  promoted.

### 3.4 One game record

Every finished game (training or real) produces one record: seats, player count, winner, each
seat's held scrolls, casts, responses, guard turns, and position samples. Everything else is
computed from it:
- the scroll report (shared on the server instead of one browser)
- combo finds
- network data
- "how often does X happen" questions like the response count above

Real games already have this through match_moves; training games would send a short summary
row (no move list) to a new table.

### 3.5 One hermit dashboard

One hermit panel instead of today's separate menus (Bot Network, Formula Lab, Combos tab,
Scroll report, Test games):
- current champion and what changed since the last one
- the queue: each challenger, its kind, exam progress per section
- weak scrolls (scroll report), response and guard rates
- data counts (games, positions, combos)
- buttons for the existing tools

### 3.6 Skills and dials (owner, 2026-10-14)

Hand-written skills (diplomacy, guarding, responses) give bots a structure they could never find
by random weight changes. Training should still learn **how much** to use them, without
"unlearning" a skill that helps. Using response scrolls is easy for players and fits into many
strategies at once, so bots must keep it.

- **Skill = how.** Hand-written, always available, never removed by training:
  - build a counter's pattern and stand on it with AP kept (bot.js reviewPlan guard post,
    guardReady, guardReserve)
  - block a player about to win (bot.js reviewBlockWin)
  - pacts, harm and help (bot-diplomacy.js, bot.js harmContext / helpContext)
  - decide to respond or pass (bot-effects.js decideResponse)
- **Dial = when and how much.** A weight training may tune. The response dials that exist today
  (bot.js DEFAULT_WEIGHTS): `guardKeepAp` -150, `leaveResponseReady` -40, `l1WaitVoid` 30,
  `evalScrollResponse` 15, `castGuardFetch` 120.
- **Diplomacy is on in every bot game** (arena through run / evolve / spectate, online on the
  host). In a 1-on-1 game no pact can form (pacts need 3+ players); only guarding against a player
  one cast from winning runs.

Five protections against unlearning:

1. **Floors.** A new `DIAL_FLOORS` table in bot.js, next to `SOCIAL_KEYS` / `pinSocial`: a minimum
   strength for each skill dial, applied wherever weights are set or changed (bot-arena.js
   setWeights, perturbWeights / mutate, makeChallenger; the champion load in bot.js). Social keys
   stay locked at their default; dials stay trainable above their floor.
2. **"Response ready" value in the position score.** A new term in bot.js evaluateSnapshot, worth
   about (chance an opponent casts before my next turn) x (value of the response), when the seat
   stands in the pattern of a response or counter it holds or can use from the common area, with
   the AP to pay. New weight `evalResponseReady`, with a floor. Look-ahead search then weighs
   "keep 2 AP and stand here" against other moves, and can combine it with other plans. Guard mode
   stays as the strong special case (a player one cast from winning).
3. **Exam guard rail.** Exam section C (response drills) blocks a promotion that gets clearly worse
   at responding, even if it wins a few more normal games.
4. **Real situations in training.** 4-player games in every exam (only they bring pacts, the guard
   role and responses: measured 0 / 0 / 2 responses in 3 games each at 2 / 3 / 4 players), plus
   response drills. A dial that never gets a signal only drifts; this gives it a signal.
5. **The owner as teacher.** Learn from my play (bot-imitation.js) also compares "kept AP for a
   response" and "responded / passed" with what the bot would do.

The same split holds for **diplomacy strength**: joining pacts and guard eagerness become dials
with floors, judged in multi-player exam games. Personality (social keys) stays locked.

---

## 4. Keep, merge, retire

| Part | Plan |
|------|------|
| Weighted scoring, search, plans, combos, strategies, diplomacy | keep (the brain) |
| Formula terms | keep; formula ideas become queue challengers |
| Network | keep, off until it beats the champion in the exam |
| MCTS + episode memory | owner decides: retire, or one experiment switch |
| Guard, block and response skills | keep as skills; their weights become dials with floors (3.6) |
| Diplomacy | always on; its strength becomes dials with floors, social personality stays locked |
| Train Bot private climb + confirm run | merge into the queue + exam |
| Idle verdict, puzzle check, practice duels, combo screening | merge into exam sections |
| Combo mining, combo finds, trial combos | keep as challenger makers; screening becomes exam section D |
| Scroll report (browser) | move into the game record (shared) |
| Explore step (2-5 players) | becomes a challenger maker; its multi-player games move into exam section A |

---

## 5. Phases

Each phase ships on its own and is checked before the next starts. Server changes come as
re-runnable sql/ files for the owner to run in the SQL editor (HOUSE RULE 6).

| Phase | What | Server? | Check |
|-------|------|---------|-------|
| 1 | **4-player games in every exam**, including idle training (2-player only today), **`DIAL_FLOORS`** and the **`evalResponseReady`** term (3.6). Also: why 12 Psychic guard plans failed to start. | maybe a small change to idle_training_report (store player count) | response and guard counts in training games above 0; seeded 2-player games unchanged while the new weight is 0 |
| 2 | **BotExam function** wrapping sections A to E; existing checks call it | none | same verdicts as before on recorded test runs |
| 3 | **Drills** (sections B, C) using startScrolls, weakest scrolls first | none (local first) | drill counts per scroll; no change to normal games |
| 4 | **Shared queue**: Train Bot submits challengers and plays queue games; server-only promotion | yes (queue kinds, Train Bot reports, SPRT verdict) | two browsers' games add up on one challenger |
| 5 | **Game record** table + shared scroll report | yes (new table + report function) | scroll report the same from any browser |
| 6 | **Hermit dashboard** | none | owner review |
| 7 | **Settings list + retire** unused parts; the list marks each weight as skill dial (floor), personality (locked) or free | none | seeded games unchanged |

---

## 6. Questions for the owner

1. **Player-count mix for training**: Train Bot already mixes 2-5 players in Explore and its
   confirm step; idle training is 2-player only. What share of 3- and 4-player games should every
   path play? (They take longer.) Suggestion: 1 in 3.
2. **MCTS and episode memory**: retire, or keep behind one switch?
3. **Train Bot gold**: pay per exam game (like test games) or keep paying only on promotion?
4. **Who may promote**: server only (suggested), or keep Train Bot's local promotion as a fallback?
5. **Drill share**: drills are extra games; how many per challenger? Suggestion: 4 scroll drills +
   2 response drills.
6. **Floors**: how strong should a skill dial's minimum be? Suggestion: half its current default.

---

## 7. Notes found while mapping

- CLAUDE.md said WEIGHTS.searchDepth defaults to 0; bot.js DEFAULT_WEIGHTS has 3 (CLAUDE.md fixed 2026-10-14).
- Scroll report finding: 2-player training never opens a response window; 4-player training does
  (diplomacy on). See section 1 and planning/current.md 2026-10-14.
- Test trap: calling BotArena.playMatch directly (not run / evolve / spectate) leaves
  BotDiplomacy.enabled() false (arenaRunning() reads isRunning / isEvolving / ...), so pacts and
  guard mode are off. A test of multi-player behaviour must go through run / evolve or set it.
