# GODAIGO — AI Navigation Index

> Written for AI consumption. Lean and precise. No prose padding.
> Do NOT read source files until you have drilled down through the relevant INDEX.md first.

---

## HOUSE RULES (read every session)
These apply to all work on this repo. `tools/claude-hooks/` enforces rules 1 and 2
(see "How the rules are enforced" below).

1. **No em dashes, ever.** Not in code, comments, docs, commit messages, PR text, or
   game text. Use a comma, colon, period, parentheses, or " - " instead. Older text
   still has some; when you edit a line that has one, fix it.
2. **Release notes: one short summary per day** in `changelog.json` (shown by the lobby
   "Change Log" button, `js/changelog-ui.js`). Players read this, so keep it small.
   - **At most one entry per day.** `id` and `date` = today (`YYYY-MM-DD`). Newest first.
   - **Same day, more changes:** rewrite today's entry so it sums up the whole day. Merge,
     reword, or drop lines. Never add a second entry for the same day.
   - **At most 5 lines per entry.** Only list what players will notice (new features, rule
     or balance changes, visible fixes). Put small fixes into one "Small fixes and polish"
     line. Leave out refactors, dev tools, bot training internals, and docs.
   - Entry shape: `{ id, date, title, changes[] }`. Title = a few words for the day.
   - Simple English, short lines, how it affects the player. No file names or code terms.
   - When you skip a note because players cannot notice the change, tell the user.
3. **Start from `planning/current.md`** and drill down through the INDEX.md files before
   reading source (see below).
4. **Bump the game version** when you change files the browser loads (js/, css/, index.html,
   assets, changelog.json): run `node tools/bump-version.js` and commit `js/version.js` with
   the change. Open browsers see the new version and reload (see `js/version.js`). The Stop
   hook checks this.
5. **Keep docs in sync** after changes: follow the `/sync-docs` skill
   (`.claude/skills/sync-docs/SKILL.md`).

### How the rules are enforced
- This file is loaded into every Claude session automatically.
- `.claude/settings.json` runs two hooks:
  - **SessionStart** `tools/claude-hooks/session-start.js`: saves the starting commit to
    `.git/claude-session-base` and prints a short rules reminder into context.
  - **Stop** `tools/claude-hooks/stop-check.js`: before Claude finishes, checks this
    session's own commits plus uncommitted work for (1) em dashes in added lines that are
    still in the file, (2) game files changed without a `changelog.json` change (a
    reminder: Claude either updates today's summary or tells the user why not), and
    (3) `changelog.json` shape: valid JSON, one entry per date, newest first, at most 5
    lines per entry, (4) client files changed without a `js/version.js` bump. If any fails, Claude is told to fix it. It blocks once per stop, so it cannot loop.
    Skips work that came in through a merge.

---

## CURRENT ACTIVE WORK
→ **[planning/current.md](planning/current.md)**
Start every session here. It contains the live task, branch, and files in flight.

---

## PROJECT SNAPSHOT

| Key | Value |
|-----|-------|
| Type | Browser-based multiplayer hex-tile strategy game |
| Stack | Vanilla JS, SVG board, Supabase (auth + realtime DB) |
| Entry point | `index.html` — loads all scripts in order (see Script Load Order below) |
| Dev server | `npx serve -p 3333` (see `.claude/launch.json`) |
| Repo branch | `fixes/all-consolidated` in `JakeSeegers/Godaigo.null` is the live branch: Cloudflare builds playgodaigo.com from it (see Live URL). Push finished work there. GitHub Pages no longer serves the game (the repo is private). `claude/missing-video-filename-sc1ajm` is an old branch. |
| Live URL | https://playgodaigo.com/ (Cloudflare Workers static assets, project `godaigo`, test address https://godaigo.aikijake.workers.dev/). Builds on every push to `fixes/all-consolidated`: build command `node tools/build-site.js` (copies only game files to `dist/`), deploy `npx wrangler deploy` (`wrangler.jsonc`). Repo: `JakeSeegers/Godaigo.null` (private since 2026-09-27; was `Godaigo.Elements`). The old address https://jakeseegers.github.io/Godaigo.Elements/ is now a separate tiny public repo `JakeSeegers/Godaigo.Elements` (files from `tools/old-address-redirect/`) that redirects to the same path on playgodaigo.com. Never push game code to that repo. Cloudflare's Git connection must point at `JakeSeegers/Godaigo.null`, branch `fixes/all-consolidated` (2026-09-30: after the rename it still pointed at the new redirect repo `Godaigo.Elements` / `main`, so pushes stopped deploying; reconnected in Settings > Build). |

---

## ARCHITECTURE MAP
Drill down for details — do not read source files until the relevant INDEX is consulted.

```
CLAUDE.md  (you are here)
├── js/INDEX.md              ← All game JS modules, window globals, load order
│   └── js/scrolls/INDEX.md  ← Scroll system: definitions, effects, response window
├── css/INDEX.md             ← Stylesheet responsibilities and token locations
├── joytone/                 ← Embedded Joytone music app (iframe; driven by js/joytone-bridge.js)
├── docs/INDEX.md            ← Game design doc pointer, design decisions
└── planning/current.md      ← Live task state (branch, files, next steps)
```

---

## SCRIPT LOAD ORDER (index.html)
Order matters — later scripts depend on earlier ones.

> Resynced 2026-08 against the actual `<script>` tags in index.html (a
> connectivity/performance audit found this list had drifted: `config.js`
> is listed below as script #1 but is dead — never actually loaded, see its
> own file-header comment and js/INDEX.md; `tutorial.js` was listed as #2
> but the file no longer exists on disk; `scroll-panels.js`, `boot-splash.js`
> and `effects-system.js` are real, loaded scripts that were simply missing
> from this list entirely). If this list and index.html ever disagree again,
> index.html is the source of truth — verify with it before trusting this.

```
-1. moved-notice.js        ← first, in <head>: on the old github.io address, redirects to the same path on
                             playgodaigo.com (query + hash kept). No-op elsewhere. Remove once the old address is off.
0. version.js             ← window.GAME_VERSION + update check: asks the server for the newest js/version.js
                             (no-store) on load, every 2 min and on tab focus. Newer and not in a room/game
                             (and not typing): re-fetch every own file with cache:'reload', then reload
                             (once per version). In a waiting room: banner with a Reload button. In a game,
                             tutorial or replay: waits. Bump with tools/bump-version.js (HOUSE RULES #4).
1. boot-splash.js          ← Studio/logo intro video (chroma-keyed canvas), plays once per page load. No game deps — loads first.
2. scroll-definitions.js   ← SCROLL_DECKS, SCROLL_DEFINITIONS globals
3. scroll-effects.js       ← ScrollEffects namespace (depends on scroll-definitions)
4. response-window.js      ← ResponseWindowSystem (depends on scroll-effects)
5. multiplayer-state.js    ← Shared MP state (myPlayerId, currentGameId, etc.) + the REAL Supabase client/URL/key (config.js is dead — see above)
6. connection-monitor.js   ← window.ConnectionMonitor — network health badge + isWorkable() gate (depends only on multiplayer-state.js's SUPABASE_URL)
7. sounds.js               ← window.SoundSystem — SFX + login music
8. joytone-bridge.js       ← window.JoytoneBridge — adaptive music via hidden joytone/ iframe (Shift+J+T popup)
9. game-core.js            ← SpellSystem, placeTile, revealTile, addAP, movement. Also the REAL home of TILE_SIZE/STONE_TYPES/PLAYER_COLORS/etc. (config.js is dead — see above)
9b. bot-elements.js        ← window.BotElements — the five fixed elemental bots: colour→element map, names, per-element weight "lean" overlays, runtime id resolution. No BotSystem dep at load. Must precede gamification-ui.js + lobby.js.
10. effects-system.js      ← window.effectsSystem — sprite/particle visual effect definitions (fire, etc.), no game logic
11. game-ui.js             ← HUD, drag-drop handlers, panel toggles, scroll deck UI
12. scroll-panels.js       ← window.ScrollPanelSystem — shared floating-panel chrome (Hand/Active/Common/Game Log/Opponent Status/Elemental Stones)
13. parallax.js            ← Animated background (no game deps)
13b. lore-intro.js         ← window.LoreIntro — hand-drawn sketch/typewriter lore sequence
                             (LoreIntroClips/chunk*.mp4), played by boot-splash.js's
                             revealLogin() right after the logo, before login. Reads
                             parallax.js's LIVE DOM output at runtime (getBoundingClientRect
                             + computed transform/opacity on the real #parallax-bg layers,
                             re-drawn into its own canvas so it can read pixels — a
                             foreignObject-snapshot approach was tried and confirmed to
                             permanently taint the canvas, even with every image inlined as
                             a data URI) — placed after parallax.js for clarity only, no
                             actual parse-order dependency.
14. gamification.js        ← window.gami — XP/gold/profiles (depends on Supabase)
15. crt-overlay.js         ← CRT canvas effects (no game deps)
16. gamification-ui.js     ← Profile modal UI (depends on gamification.js)
16b. changelog-ui.js       ← window.Changelog: lobby "Change Log" button + release-notes modal.
                             Reads /changelog.json (see HOUSE RULES #2). "New" dot on the button
                             until the newest entry is opened (localStorage godaigo_changelog_seen).
                             No game deps.
16b2. credits-ui.js       ← window.Credits: lobby "Credits" button + modal listing asset creators (CREDITS array at
                             the top of the file; add a line for every new outside art/font/sound asset).
16c. account-recovery.js   ← window.AccountRecovery: optional recovery email (Profile > Settings > Account, and the
                             Create Account screen: lobby.js setAuthMode('register'|'login') toggles #auth-screen.mode-register,
                             .auth-register-only / .auth-login-only; then setEmailAfterRegister())
                             + News Emails opt-in checkbox (sql/mailing-list.sql)
                             and sign-in "Forgot password?". Talks to the account-recovery edge function
                             (supabase/functions/account-recovery, sends via Resend, 2 emails/account/hour).
                             Handles ?recovery_verify=TOKEN and the #type=recovery reset link on load
                             (multiplayer-state.js sets window.__godaigoRecoveryLink before the client
                             consumes the hash).
17. lobby.js               ← Auth, room management, startGame() (depends on game-core)
17a. game-pause.js         ← window.GamePause / isGamePaused(): pauses an online game for everyone while a player's
                             connection is down or the host pressed the HUD Pause button. Overlay blocks input,
                             bots + turn timeout wait, paused time given back. Catch-up after a drop: `_mid` on
                             every game message, gp-resync-request / -moves / -done + fingerprint check. The answer holds
                             only messages after the oldest one the returner still remembers, never its own (same page
                             load); sync/emoji events are not remembered (match 43 replayed old moves). After 60 s:
                             Wait / Kick (host), Continue without them (host gone), Claim win (last human).
                             docs/network-resilience.md.
17b. match-recorder.js     ← window.MatchRecorder: HOST-only recording of every online game's broadcast
                             messages to Supabase (`matches` + `match_moves`, sql/match-recording.sql).
                             Hooks in lobby.js: broadcastGameAction (own/bot sends; channel is self:false),
                             a catch-all gameChannel.on('broadcast', {event:'*'}) (everyone else),
                             handleGameStart (start), host re-election (adopt), game-over paths (finish),
                             resetToLobby (stop). Foundation for replays, cheat checks, stats (phases 2-4).
17c. match-witness.js      ← window.MatchWitness: every human browser in an online game (1) hashes the PUBLIC
                             board the instant currentTurnNumber changes (100 ms watcher) -> report_fingerprint,
                             (2) at game over (hook in showGameOverToAll) checks the winner vs its own board
                             (5 activated + isPlayerAtOwnShrine) -> report_game_result. claim_game_win needs a
                             confirming report from another fresh human seat, else the claim waits as 'pending'
                             and is paid when the report lands; retry_pending_wins() pays a pending win once no other human is
                             left in the room and nobody disputed it (after the game + at sign-in). A snapshot is
                             skipped when the tab was hidden or the timer ran late; turn 1 never counts as desync.
                             sql/match-witness.sql + -v2.sql + -v3.sql.
17d. replay-viewer.js      ← window.Replay: plays a finished match back (Phase 3). get_match_replay -> Supabase
                             switched "offline" (fake channel, empty from()/rpc()) -> startMultiplayerGame()
                             from recorded seats + deck seed -> myPlayerIndex = -1 (spectator; game-core
                             getPlayerScrolls shows the ACTIVE player's hand for a negative seat) -> recorded
                             messages dispatched into setupGameBroadcast()'s own handlers, timed, with
                             play/pause/step/speed. Restart rewinds in place (startBoard: clears handlers, turn 0,
                             startMultiplayerGame again); Exit reloads with sessionStorage godaigo_skip_intro_once,
                             which boot-splash.js honours once (no logo / lore intro). Players: lobby "Replays"
                             button -> Replay.openBrowser(): "My games" (Watch, Post publicly / Remove from
                             public) and "Public" (Watch). Featured replay: lobby "Watch Featured Replay" button
                             (next to Quick Play) -> Replay.openFeatured() -> get_featured_match -> open(id, {speed: 4});
                             the hermit sets it with a Feature button on replay rows (hermit_set_featured_match,
                             sql/featured-replay.sql; also sets keep; get_match_replay lets anyone signed in watch it).
                             Playback skips recorded bot brain-mode emojis (🧠 / 🎲, BOT_SIGNAL_EMOJIS).
                             Hermit-only "Check" tab = replay verification:
                             Replay.checkMatch(id) runs index.html?replaycheck=ID in a hidden iframe
                             (runCheck: full-speed replay, fingerprint per turn change, winner's final
                             board), compares with get_match_fingerprints (32-char, turn > 1), stores
                             matches.check_status ok/mismatch/no_data/error + check_detail
                             (save_match_check, sql/match-check.sql).
                             Hermit-only "Players" tab (Phase 4): hermit_player_overview(days) = one row per
                             human with games/wins/fast wins/last-standing/disputed/replay-unconfirmed wins/
                             pending/desync games/top-opponent share + a warning score and flag texts;
                             "Games" -> hermit_player_matches(user) rows with Watch/Check (sql/hermit-players.sql).
                             Hermit-only "Combos" tab (bot combo plan Phase 3): Replay.mineMatches() replays every
                             unmined finished match in a hidden frame (index.html?replaymine=ID, runMine): scores
                             each seat with BotSystem.evaluateSnapshot at every turn change, records casts
                             (scroll-used) with their choices (wandering-river-apply, create-stones, ...) and
                             reveals; findCombos() keeps windows of 1-3 own turns with >= 2 casts and a gain
                             >= max(300, 75th percentile) -> save_combo_candidates (server sets trust from ladder
                             rank + games played, bots 0) -> hermit_combo_summary (sql/combo-miner.sql).
                             Per combo Auto / On / Off (hermit_set_combo_state, sql/combo-teach.sql): Auto = bots
                             use it once seen in 2 different games; bots load get_bot_combos() (public, no player
                             data) in bot.js (Phase 4, see bot.js row).
                             Hermit-only "Puzzles" tab (Phase 4b): hermit_list_puzzles (sql/combo-puzzles.sql) =
                             mined combo moments; Replay.solvePuzzles() runs each in a hidden frame
                             (?replaypuzzle=MATCH&seat&turn&turns&gain&pid[&wkey]; runPuzzle: replay to that turn,
                             then bots play every seat, the End Turn button re-enabled) -> bot gain / player gain,
                             solved >= 0.9; every 4th puzzle (id % 4 == 0) is test-only. Replay.puzzleScore(w) =
                             avg score on up to 6 training puzzles; BotArena.hillClimb opts.puzzleCheck gates a
                             would-be promotion on it (hermit Train Bot passes it).
18. tutorial-mode.js       ← LAZY-LOADED (no <script> tag — see #30 asset-preloader.js / window.LazyScripts). Interactive tutorial (depends on lobby.js + game-core.js). The old 7-step modal tutorial this superseded (formerly js/tutorial.js) has since been fully removed — no dead script tag remains.
19. emoji-system.js        ← Emoji reactions (depends on gamification.js). Only the 95 animated Pipoya pixel emotes
                             (P00-P99 minus RETIRED_EMOJIS P10/P11/P84/P94/P95, images/emotes/pipoya-emotes.png;
                             classic emojis retired 2026-09-27). Owned on
                             the server: 'emoji_<id>' in user_profiles.cosmetics_owned via buy_cosmetic
                             (sql/emoji-server.sql). Bought in the lobby Shop (gamification-ui.js gami_openShop) or
                             the in-game E panel.
20. cosmetics-system.js    ← Name colour cosmetics (depends on gamification.js). Server-backed (sql/cosmetics.sql).
                             loadNameColors/styleForUser/seatNameHtml colour every player's name in the waiting
                             room, opponent panel, HUD turn display, Game Log and leaderboard.
20b. pawn-cosmetics.js     ← window.PawnCosmetics: draws bought pawn rims / bases / trails (sql/pawn-cosmetics.sql,
                             items = cosmetics-system.js PAWN_ITEMS, equip_pawn). No game hooks: every 500 ms (paused while the tab is hidden) it
                             (re)decorates pawns in playerPositions whose items changed, every 50 ms it turns
                             pawn position changes into fading trail particles (layer .pawn-trail-layer). Never
                             covers the pawn fill; fits between the pawn (r 8) and element symbols (r 15).
                             Seat -> account: allPlayersData user_id (online), own profile on seat 0 (local).
20c. social.js            ← window.Social: friends list (lobby "Friends" button, request badge), online status
                             (Realtime presence channel godaigo-online, key = user id, {status: lobby|room|game};
                             "appear offline" = user_profiles.hide_online, never joins), last seen (touch_last_seen
                             every 3 min), game invites (send_game_invite, polled my_game_invites every 10 s, pop-up
                             only in the lobby, Join -> joinPublicGame) and player cards (any [data-player-card=uid]
                             opens get_player_card: leaderboard, waiting room, seatNameHtml in-game names).
                             Recent players (my_recent_players) in the panel. Play Again Together (game-over button,
                             lobby.js) -> Social.playAgain(allPlayersData) saves {users, bots} in sessionStorage, the
                             normal Return to Lobby reload runs, then resumeIntents() -> window.playAgainRoom(bots,
                             startNow = no humans) + send_game_invite to each. Invites also pop up on the game-over
                             screen (Join -> reload -> joinPublicGame). sql/friends.sql + sql/recent-players.sql.
20d. rewards.js           ← window.Rewards: Hermit rewards, player side (sql/hermit-rewards.sql). Badge catalog (special badges:
                             criteria.type "special", picture images/badges/<badges.image>), badgesHtml() icons next to names
                             (cosmetics-system seatNameHtml, lobby waiting room, leaderboard; user_profiles.shown_badges),
                             claim_signup_events() after sign-in, reward pop-ups (my_reward_notices every 30 s + after game over),
                             badge slots (set_shown_badges, buy_badge_slot 700g, max 3; Profile > Badges, Shop > Features),
                             "reward on this game" status line + 🎁 on lobby room cards (list_bounties).
20e. hermit-rewards.js    ← window.HermitRewards: Hermit menu "Rewards" panel + 🎁 button on lobby room cards. One reward form
                             (title, message, gold, badge from images/badges/badges.json, items incl. hidden ones) for a sign-up
                             event (first N real accounts, hermit_start_signup_event) or a game bounty (hermit_set_bounty).
                             Lists events (winners, Stop) and all current games (hermit_list_rooms).
20f. pot-plinko.js        ← window.PotPlinko: the pot drop at game over (lobby.js showGameOverToAll -> onGameOver). Polls
                             get_pot_drop(room); pending -> calls edge fn pot-drop; done -> lazy-loads 'matter'
                             (js/vendor/matter.min.js) + 'plinko-sim' (js/plinko-sim.js, shared with the edge function)
                             and replays the drop on a canvas (Gold Coin P73 coins, Treasure Chest P75). A dry run first;
                             coins that would land elsewhere are steered to the server's slots. Rewards.checkNotices waits
                             while busy(). preview(seed, coins) for testing. tools/plinko-tune.mjs = odds + determinism.
21. bot-state.js           ← window.BotState — game-state snapshot / legal actions / apply (no strategy)
22. bot-sim.js             ← window.BotSim — pure forward model (simulate / legalActions / isTerminal) + validate() harness
22b. bot-terms.js         ← window.BotTerms: formula terms = extra bot senses as plain data (WEIGHTS.terms:
                             [{text, w, note, src}]). Safe mini language: public-info INPUTS (myActivated,
                             leaderActivated, distHome, myAP, ...) and + - * / min max gt lt abs; parse/compile
                             (cached), score() added at the end of bot.js evaluateSnapshot, mutateTerms/crossTerms
                             used by bot-arena.js mutate/crossover (structural add/remove/change only with
                             opts.termMutations). Limits: 8 terms, 25 nodes, 200 chars, value clamped +-10000.
                             Road inputs: homeCost (BotSystem.homeCost, real path cost), freeStones, freeWater,
                             freeNearHome. Element inputs: adjacent(a, b), stonesOf(el), myPool(el), oppNeeds(el),
                             commonFor(el). Formulas that read no input are dropped by evolution.
                             Rules (2026-09-27): if(c, a, b), between(x, lo, hi), > < >= <= ==, and / or / not
                             (true = 1); evolution can wrap a formula in if(). Triggers: oppCanWinNextTurn,
                             iCanWinThisTurn, neededShrineBlocked, oppRespondReady. describe() = plain words.
23. bot-effects.js         ← window.BotEffects — Stage 2.5 scroll-effect usage: driveSelection() (tile-flip,
                             scorched-earth, tile-swap, Create, Scholar's Insight, Quick Reflexes, Sacrificial
                             Pyre, Inspiring Draught), driveTransmute() (open-ended discard-for-AP modal),
                             decideResponse() (response-scroll respond/pass — both arena and real multiplayer,
                             wired from bot.js and bot-driver.js respectively)
24. bot.js                 ← window.BotSystem — utility-scored bot + optional lookahead (WEIGHTS.searchDepth, default 0);
                             No pacing: noBacktrack() (never back onto a hex left this turn until the board changes);
                             intentions: mem.intent keeps the goal a move served, moveCommit makes it sticky.
                             Shift+R = one step, Shift+B = full turn; waitForQuiescence() tries BotEffects
                             before cancelling a selection it can't drive. Also owns mctsPick() (Stage 2 step
                             5 — determinized root-level UCT, WEIGHTS.mctsEnabled) and signalBrainMode()
                             (emoji over the acting pawn, 🧠 search / 🎲 MCTS, when a bot's brain mode
                             switches, broadcast in multiplayer via broadcastGameAction('emoji', ...); OFF for now:
                             BRAIN_SIGNAL_ENABLED = false in bot.js, owner 2026-09-25). Combos (Phase 4): loads
                             get_bot_combos() at start (cache localStorage godaigo_bot_combos, setCombos()); a bot
                             holding a combo's first two cast scrolls follows it (mem.combo, step kept across
                             turns; comboStep / comboChoiceMatch bonus on the next cast in greedy + search root;
                             makePlan builds the next combo scroll's pattern; dropped when too slow or the next
                             scroll is gone; 3 own turns rest before the same combo again).
24b. bot-memory.js         ← window.BotMemory — episodic "what happened after decisions like this" memory.
                             Captures a fingerprint+action+outcome row whenever a bot decision's immediate
                             evaluateSnapshot() swing is extreme; retrieveSimilar() feeds mctsPick()'s root
                             UCB1 arms bonus pseudo-visits as a PRIOR (never an override). Shared via the
                             Supabase `bot_episodes` table (same RLS shape as bot_champion_weights: public
                             SELECT, authenticated insert with created_by = auth.uid()) — local
                             (localStorage godaigo_bot_episodes) is only the fallback/offline cache. Must
                             follow bot.js (needs window.BotSystem.evaluateSnapshot).
24c. bot-mind.js           ← window.BotMind: hermit-only "Bot Mind" viewer (hermit menu or Shift+M). bot.js botAct()
                             builds one record per decision only while BotMind.wants() (beginThought/finishThought:
                             mode quick/lookahead/playout/plan/unstuck, chosen action + reason, top 6 options with
                             scores + reasons, goal path, build plan cells, searchPick's planned line). Draws
                             .bot-mind-layer in #viewport (ghost plan stones, goal path, look-ahead line, break/place
                             mark) and #bot-mind-panel. Off during muted arena training.
24d. formula-lab.js       ← window.FormulaLab: hermit menu "Formula Lab". Ideas as lines `weight: formula # note`
                             (starter set suggested by Claude), Check (values on the live board), Quick test (champion
                             + one term vs champion, BotArena.run), queue for the next Train Bot run (takeQueued() in
                             game-ui.js runHillClimbTraining: each idea = a round-1 challenger; "invent" = hillClimb
                             opts.termMutations). localStorage godaigo_formula_lab.
25. bot-driver.js          ← window.BotDriver — host-only multiplayer bot player ("🤖 Add Bot" lobby button);
                             host's client impersonates the bot's index to drive its turns
26. bot-arena.js           ← LAZY-LOADED (no <script> tag — see #30 asset-preloader.js / window.LazyScripts). window.BotArena — self-play arena (bot-vs-bot local games, weight evolution).
                             Shared playMatch() core for 2-5 players (calls ensureLocalMode() so a stale
                             isMultiplayer identity from an incomplete online-game leave never kills a local
                             match); run/evolve/spectate all support opts.visual (watch instead of muted-fast)
                             and evolve supports opts.nPlayers (2-5). Roadmap for smarter stages: docs/bot-roadmap.md
27. action-log.js          ← window.ActionLog — in-memory record of every meaningful action this session
                             (human AND bot); record()/onRecord() feed both the hidden dev cheat-panel's
                             "Download Action Log" button and game-log-ui.js's player-facing panel
27a. bot-diplomacy.js     ← window.BotDiplomacy: bot alliances Phase 1 (docs/bot-alliances.md), memory only. Each bot
                             seat keeps favor (help/harm to ITS progress, decays 0.9/round) and trust (pacts, phase 3)
                             toward every player; threat (tracker diff + mild human bias 0.5, 1 = can win next turn)
                             and ally = favor + 0.5 trust - threat are computed live. Fed by ActionLog.onRecord +
                             end-turn entries: the change in each bot's own progress() since the last look is blamed
                             on the active player (half if it mostly served the actor, extra for hostile scrolls).
                             Runs in the arena and on the online host, not in replays; resets per game. Bot Mind
                             shows "How it sees the others" (+ Push, coalition target). Loads right after action-log.js.
                             Phase 2: pressures(o) (elements weighted by difficulty, void most; clear leader 1.5 / 3 el or 2+ ahead 2 / 5 el or 3+ ahead 2.5 / can win 4, x favor) weight
                             opponentProgress in evaluateSnapshot, tacticalContext blocking, Arson/Plunder targets;
                             bot.js kingmakerFilter never lets an opponent with 5 elements get within 5 AP of home.
                             Phase 3: emote sentences (say(): Game Log 'botTalk' line at once, emotes queued; online
                             the emoji broadcast carries `talk`), one-round pacts against the leader or (grudge pacts) against whoever hurt a bot, trust from
                             kept / withdrawn / broken pacts, thanks and grudges. Silent in muted training.
                             Pacts hold while the leader stays a danger. Harm (bot.js harmContext): break the
                             leader's fresh pattern stones (recentStones), camp scarce shrines it needs.
                             Help (helpContext): scroll gifts to the common area, wind on a partner's road home.
27b. bot-imitation.js      ← window.BotImitation — HERMIT-ONLY, opt-in "learn from my play" imitation
                             learning (docs/void-knight.md). Watches ActionLog.onRecord() during the
                             hermit's own turns in a real online game that has a bot in it; compares
                             endTurn/discardScroll decisions, and (Phase 5, 2026-09-26) casts (cast_execute:
                             your scroll vs the bot's best cast) and moves (first step toward where you went vs
                             the bot's best step, lower rate), to bot.js's own ranking (rankActions()'s
                             opts.withTrace; cast + move scoring now traced) and nudges a small additive DELTA
                             table, each key capped at half its default (localStorage
                             godaigo_bot_weight_deltas), never a weight snapshot. lobby.js's
                             hostStartGame() layers that delta onto every bot's normal (elemental-lean)
                             base whenever the HOST is the hermit with the toggle on — same bots
                             already in the room, not a separate one; toggle off = plain base,
                             unchanged. Never touches the shared community champion itself.
28. game-log-ui.js         ← Player-facing readable "Game Log" panel (#game-log-panel, left side), built
                             from ActionLog.onRecord() — colour-coded, collapses movement, never shows
                             discardScroll or anything else that would reveal another player's hand
29. thehermit.js           ← window.TheHermit — dev tool, drag-to-reorder editor for the dock-bar/hud-bar
                             buttons and indicators (Shift+H, or the cheat-panel button); persists the
                             chosen order to localStorage and exports it as JSON for hardcoding back in
30. asset-preloader.js     ← window.AssetPreloader — background-loads in-game art + sounds after the intro;
                             shows a loading bar over the board if a match starts before it's done
                             Also window.LazyScripts.load('tutorial'|'bot-arena'|'matter'|'plinko-sim'): loads #18/#26 on idle after
                             the preload ('matter' / 'plinko-sim' only on demand, onDemand), or on demand from their entry points (Tutorial button, Train Bot,
                             cheat/bot-training panels, bot-driver.js per-bot weights) — await it before
                             touching window.TutorialMode / window.BotArena from any NEW entry point.
```

---

## NAMING CONVENTIONS

| Thing | Convention | Example |
|-------|-----------|---------|
| Scroll IDs | `ELEMENT_SCROLL_N` | `EARTH_SCROLL_5`, `CATACOMB_SCROLL_2` |
| Stone types | lowercase string | `'earth'`, `'void'`, `'catacomb'` |
| Player colors | lowercase name → hex via `PLAYER_COLORS` | `'purple'` → `'#9b59b6'` |
| Hex coords | world pixel coords from `hexToPixel(q, r, size)` | `{x: 138.6, y: 0}` |
| Tile IDs | auto-increment integer from `nextTileId` | `1`, `2`, `3` |
| Supabase tables | snake_case | `game_room`, `user_profiles` |
| CSS classes (tutorial) | `tmode-` prefix | `tmode-exit`, `tmode-next` |
| CSS classes (game) | semantic kebab | `placed-tile`, `player-marker` |

---

## KEY CROSS-MODULE GLOBALS
Full list: see `js/INDEX.md § Window Globals`.

| Global | Set in | Used by |
|--------|--------|---------|
| `window.spellSystem` | game-core.js | scroll-effects, game-ui, tutorial-mode |
| `window.startGame` | lobby.js | tutorial-mode |
| `window.placeTile` | game-core.js | game-ui, tutorial-mode, lobby |
| `window.isTutorialMode` | tutorial-mode.js | game-core, game-ui |
| `window.TutorialMode` | tutorial-mode.js | game-core (hooks), index.html (button) |
| `window.SCROLL_DEFINITIONS` | scroll-definitions.js | game-core, scroll-effects |
| `window.gami` | gamification.js | lobby, gamification-ui |

---

## SUPABASE TABLES

| Table | Owner module | Purpose |
|-------|-------------|---------|
| `game_room` | lobby.js | Active game sessions |
| `players` | lobby.js | Player slots in a session |
| `matches` | match-recorder.js | One row per online game: players snapshot, deck seed, settings, winner, status (playing/finished/abandoned), move_count, `keep`. Written ONLY via RPCs `start_match` / `finish_match` (room host or hermit). Read ONLY via RPCs (sql/replay-access.sql): `list_my_matches`, `list_public_matches`, `get_match_replay` (finished + (player of it OR `is_public` OR hermit)), `set_match_public` (players of it). Posting sets `keep`. Finished matches older than 30 days are deleted unless `keep`. `game_room.match_id` points at the live one. |
| `matches` (check) | replay-viewer.js | `check_status` / `check_detail` / `checked_at`: replay verification result. Hermit-only RPCs `list_matches_for_check`, `get_match_fingerprints`, `save_match_check` (sql/match-check.sql). |
| `combo_candidates` | replay-viewer.js (miner) | Combo candidates mined from finished matches (seat, user, rank, games, trust, gain, turns, signature, steps). RLS on, no client policies; hermit-only RPCs `list_matches_for_mining`, `save_combo_candidates`, `hermit_combo_summary`, `hermit_reset_mining` (sql/combo-miner.sql). `matches.mined_at` marks mined games; `start_match` now saves each human's ladder `rank` in `matches.players`. |
| `combo_flags` | replay-viewer.js (Combos tab) | Hermit override per combo signature: `on` / `off` (no row = auto). RLS on, no client policies; `hermit_set_combo_state`, public `get_bot_combos()` (taught combos: signature, times, score) (sql/combo-teach.sql). |
| `featured_replay` | replay-viewer.js | One row: the hermit's featured match for the lobby button. RLS on, no client policies: `hermit_set_featured_match(id or null)`, `get_featured_match()` (sql/featured-replay.sql). |
| `friend_links` / `friend_invites` | social.js | Friends (requester, addressee, pending/accepted) and room invites. RLS on, no client policies; RPCs `send_friend_request(p_user or p_name)`, `respond_friend_request`, `remove_friend`, `my_friends`, `send_game_invite` (friends, or anyone you shared a game with in the last 3 h; from your waiting room, 1 per friend per 20 s, 5/min), `my_recent_players` (sql/recent-players.sql), `my_game_invites`, `dismiss_game_invite`, `get_player_card(uid)`; `user_profiles.last_seen_at` / `hide_online` via `touch_last_seen` / `set_hide_online` (sql/friends.sql). |
| `match_moves` | match-recorder.js | Every broadcast message of a match in order (`seq` assigned by the server), with event name, sender seat, payload. Written ONLY via `append_match_moves` (room host or hermit, batches of 200 max, 32 KB per payload). |
| `user_profiles` | gamification.js | XP, gold, level, stats. Clients may only UPDATE `stats`, `updated_at`, `skip_intro`; gold/XP/level/badges change ONLY through server functions: `claim_daily_login()`, `claim_game_win(room)`, `claim_training_reward(amount)` (60/claim, 300/day), `spend_gold(amount)`. Name colours: `cosmetics_owned` / `name_color` (public read, changed only by `buy_cosmetic(id)` / `equip_cosmetic(id or null)`, prices in `cosmetic_price()`, sql/cosmetics.sql; the leaderboard colours names from `name_color`). Pawn items: `pawn_rim` / `pawn_base` / `pawn_trail` (public read, `equip_pawn(slot, id)`, sql/pawn-cosmetics.sql). Emojis: `emoji_<id>` entries in `cosmetics_owned`, bought with `buy_cosmetic` (sql/emoji-server.sql). `award_gold` / `update_user_xp` / `award_badge` are server-internal (not client-callable). See `sql/secure-rewards.sql`. |
| `user_activities` | gamification.js | Activity log for rewards. Clients may only insert `scroll_cast` / `element_activated` with no rewards; everything else is written by the server functions above. Inserts fire `check_badges_trigger` (badges). |
| `ladder` / `ladder_applied` | server only | Ladder moves ONLY on the server (sql/ladder-secure.sql): `_pay_game_win` applies a paid human win from the recorded game (`matches.players`), `report_game_result` applies a confirmed bot win (confirmation not only from the host, unless alone). Once per match (`ladder_applied`). `ladder_game_result` is a no-op kept for old clients. Wins paid without a witness (quit / bot-only) need >= 6 recorded turns (`_match_turns`, else 10 min). Clients: SELECT only. |
| `game_rewards` | claim_game_win() | One XP claim per (room, player), `status` paid/pending (pending = waiting for a witness); also the 4-per-hour win-claim limit. Server only. |
| `match_reports` | match-witness.js | Game-over witness report per (room, reporter): winner seen, confirms, activated, at_shrine, fingerprint. A non-confirming witness sets `matches.disputed`. Written only via `report_game_result`. |
| `match_fingerprints` | match-witness.js | Board fingerprint per (room, turn, reporter). A mismatch bumps `matches.desync_count`. Written only via `report_fingerprint`. 30-day cleanup. |
| `badges` | gamification-ui.js, rewards.js | Badge definitions; ownership = `user_profiles.badges_earned`. Awarded by `check_badge_criteria` (trigger on user_activities); criteria types incl. all_scrolls, bots_defeated, human_wins, fast_win, all_emojis, all_cosmetics (sql/more-badges.sql: win ones read paid `game_rewards` + `matches` + `match_moves`, rechecked on game_win / game_complete / daily_login). Pictures `images/badges/px-*.png`. `image` = file in images/badges/ for special badges (criteria `{"type":"special"}`, only given by Hermit rewards, `hermit_upsert_badge`). `user_profiles.badge_slots` (1-3) / `shown_badges` via `buy_badge_slot` (700g) / `set_shown_badges` (sql/hermit-rewards.sql). |
| `hermit_events` / `hermit_event_winners` | hermit-rewards.js, rewards.js | Sign-up events: the first `max_winners` real (not `Guest` + 6 chars) accounts made after `started_at` get the reward via `claim_signup_events()`. RLS on, no client policies; hermit RPCs `hermit_start_signup_event`, `hermit_stop_event`, `hermit_list_events` (sql/hermit-rewards.sql). |
| `game_bounties` | hermit-rewards.js, rewards.js | Hermit reward on a room (`room_id` pk): paid once to the winner by `_pay_game_win` -> `_pay_bounty`. `hermit_set_bounty` / `hermit_clear_bounty` / `hermit_list_rooms`; public `list_bounties()` (unpaid only). |
| `reward_notices` | rewards.js | One row per reward given, shown as a pop-up: `my_reward_notices()`, `mark_reward_notice_seen(id)`. `kind` = hermit (`_grant_reward`) / gift / pot, picks the pop-up animation. |
| `pot_drops` | pot-plinko.js, edge fn pot-drop | The pot drop (sql/pot-plinko.sql): one row per qualifying match (seed, coins = `_pot_coins(pot)` = pot / 10 max 70, users to pay, status pending/done, slots per coin (-1 = treasure: the coin fell down the treasure tube, js/plinko-sim.js VERSION 2), hit_coin, won, share, sim_version). Edge function `pot-drop` (service role; POST {room}) runs js/plinko-sim.js (copy in the function folder) with Matter.js 0.19.0 and calls `_settle_pot_drop(id, slots, version)` (service role only) which pays like before; it also settles up to 5 stale pending drops. Players read it with `get_pot_drop(room)` (players of that match, last 10 min). `_pot_chance()` = 1 - 0.99^coins (display only). RLS on, no client policies. |
| `gifts` / `game_pot` / `pot_payouts` | rewards.js, gamification-ui.js (Shop > Features), hermit-rewards.js | Gifts: `send_gift(name, phrase 1-7)` costs 100g, receiver gets random 25-100g, rest to `game_pot` (one row); one gift received per UTC day (unique index), no guests, not yourself, set phrases only (`_gift_phrases()`). Pot: `finish_match` -> `_maybe_pay_pot` (real finished game, not last_standing, >= 2 non-guest humans, >= 6 turns, pot >= 100g, pot not paid today) records a `pot_drops` row (see next row); a win splits it evenly, once per UTC day via `pot_payouts.paid_on` unique. Public `get_pot()`, hermit `hermit_add_to_pot(n)`. Badges generous (10 `gift_sent`) and jackpot (`pot_won`). sql/gifts-pot.sql. |
| `account_recovery` | edge fn account-recovery | Optional recovery email per account (+ verified flag, confirm token hash). RLS on, NO client policies; client only uses RPCs `my_recovery_email()` / `remove_my_recovery_email()`. `sql/account-recovery.sql` |
| `mailing_list` | lobby.js register form, account-recovery.js settings | Opt-in for human-written news emails (max once a month, sent by hand). RLS on, no client policies: `set_mailing_list(bool)`, `my_mailing_list()`, hermit-only `hermit_mailing_list()` (opted in AND confirmed recovery email; address from `account_recovery`). sql/mailing-list.sql |
| `recovery_email_log` | edge fn account-recovery | One row per email sent, for rate limits (2/account/hour, 3/address/day, 90/day total). Server only. |
| `bot_champion_weights` | bot.js, game-ui.js, lobby.js | THE single shared bot brain - append-only submission log. The CURRENT champion is the newest row with `promoted = true` (`order by promoted desc, created_at desc`, sql/champion-promoted.sql, 2026-09-27); `win_rate` is only that row's own confirm record and is NOT comparable between rows. Auto-applied on load (bot.js); the auth-bar "Train Bot" button (hillclimb) inserts a promoted row + pays gold on a confirmed win (game-ui.js `runHillClimbTraining`). |
| `deployed_bots` | bot-elements.js, lobby.js, gamification-ui.js | Now holds exactly FIVE system-owned rows (`owner IS NULL`) = the elemental bots (`sql/elemental-bots-seed.sql`). Nicknames = Terran Sentinel / Tidewarden / Emberkin / Galewalker / The Void Knight. Client READ-only (public SELECT); ids resolved by nickname at runtime. `ladder.bot_id` FKs here. **Dormant / unused now:** `captured_bots`, `void_knight`, `user_profiles.capture_stones` — the personal Bot Tycoon economy (Shop/Stable/capture) was removed. |

---

## KNOWN ACTIVE BUGS
See `TODO.md` for full list. `TRANS-WIN-CON` and `TRANS-DOUBLE-DISP` (Transmute
fire-symbol stamp / stale inventory display) are confirmed cleared. No other
top-level items as of last update.
