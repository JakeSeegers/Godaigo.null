// ============================================================
// bot-arena.js — Stage 3a of docs/bot-roadmap.md: self-play arena
// ============================================================
// Runs full LOCAL games (2–5 players) where every player is bot-driven,
// with a separate WEIGHTS table per player. Used to A/B bot brains (search
// vs greedy vs hybrid), measure Stage-2.5 effect-usage increments, watch
// bots play, and evolve weights.
//
//   await BotArena.run(weightsA, weightsB, nGames, seed, opts)
//       → { aWins, bWins, draws, avgTurns, aFitness, bFitness,
//           games:[{winner, turns, side}] }
//       aFitness/bFitness are the SELECTION SIGNAL evolve() uses (see
//       sideFitness() below) — win/loss ±1 plus a small reward for
//       win-condition progress and a small penalty per stuck turn, NOT a
//       plain win tally. opts.progressWeight (default 0.3) and
//       opts.stuckPenalty (default 0.15) tune those terms.
//       opts.onGame?(gameNumber, totalGames, gameResult) — optional per-game
//       progress callback (also fires once per game inside evolve(), since
//       evolve() forwards opts straight through to every run() call it makes).
//       opts.visual (default false): play every game with normal
//       pacing/visuals via the SAME playMatch() core spectate() uses,
//       instead of muted/fast.
//   await BotArena.evolve(generations, opts)
//       → champion weight table (also saved to
//         localStorage['godaigo_bot_weights'] + logged as JSON)
//       opts.onGeneration?(genNumber, totalGenerations, fitnessArray) — optional
//       progress callback. BotArena.stop() cancels between generations.
//       BotArena.applyWeights(table) applies a table to the LIVE WEIGHTS
//       object in place (no reload needed) — the cheat panel's "Train Weights"
//       button uses this on evolve()'s result.
//       opts.nPlayers (2–5, default 2): 2 stays the original exhaustive
//       pairwise round-robin (sideFitness-based, richer than plain win/loss);
//       >2 samples opts.gamesPerGen random N-player groupings per generation
//       instead (exhaustive C(popSize,N) explodes), crediting the winner's
//       population slot with +1 fitness.
//   await BotArena.spectate(nPlayers, opts)
//       → { winner, turns } — watch nPlayers bots play one full game with
//         normal visuals (win screen included), auto-downloads the action
//         log when it ends.
//   BotArena.stop() — interrupts run()/evolve()/spectate(), whichever is
//   active (shared _stopRequested flag, checked in every loop below).
//
// SHARED CORE: playMatch(weightsPerPlayer, opts) plays exactly one game for
// weightsPerPlayer.length players (2–5), swapping in each player's weight
// table on their turn (an `undefined` entry leaves WEIGHTS untouched — how
// spectate() gets "whatever's currently loaded" instead of a fixed table).
// opts.visual controls pacing (sleep durations, turnCap default) only —
// muting environment (sound/gami/win-modal) and any status/ActionLog UI
// bookkeeping is the CALLER's job (run/evolve mute+stay silent, spectate
// keeps everything on and drives the status bar + log download).
//
// STALL RESTART — two independent trap-loop detectors, one shared outcome
// (abort the game, result.stalled = true, playMatch() replays the round):
//   1. CAMPING: two (or more) bots each end STALL_TURNS (7) consecutive own
//      turns parked on one revealed elemental tile (each on its own tile —
//      they don't have to share one).
//   2. NO-CAST: opts.stallNoCastRounds (default 10, owner 2026-09-26) full rounds pass with
//      NO bot casting a single scroll. Catches the loops camping can't —
//      e.g. free catacomb-teleport ping-pong, where the tile alternates
//      every turn (resetting any per-tile streak) and catacombs aren't
//      elemental tiles anyway. A game where nobody has cast anything for
//      10 straight rounds is going nowhere regardless of the movement
//      shape. Reads deltas of BotSystem.castsApplied().
//   3. NO-PROGRESS: opts.stallNoProgressRounds (default below) full rounds
//      pass with NO bot activating a new element. Catches games where bots
//      keep casting or moving but get nowhere (a trap loop that shuffles
//      between tiles, so camping never fires, while casts that grant no
//      element keep the no-cast detector quiet). Every seat shares it.
//      result.maxQuietRounds = the longest such gap seen (for tuning).
// Either way the round is RESTARTED from scratch with a derived seed (same
// weights), instead of grinding on to the 200-turn cap just to record a
// meaningless draw. opts.maxStallRestarts (default 3) caps the retries; a
// game still stalled after the last retry is returned as-is (winner null,
// result.stalled true) so a pathological weight table can't loop forever.
// result.restarts reports how many restarts the returned game consumed.
// ATTRIBUTION: each attempt (including ones discarded by a restart) records
// result.stallers — the player index(es) whose behavior caused THAT stall
// (campers whose streak hit STALL_TURNS; every seat for a NO-CAST stall,
// since nobody progressing is a joint failure). playMatch() sums these
// across every attempt of one playMatch() call into result.stallCounts, so a
// weight table that keeps wasting restart budget on stalls is still visible
// to seatFitness()/sideFitness() even though only the FINAL attempt's game
// state (winner/turns/activated) survives into the returned result.
//
// HOW A GAME RUNS (local hot-seat — no Supabase, no multiplayer):
//   ensureLocalMode() + resetGameResources() + startGame(n) reset
//   everything; Math.random is temporarily seeded (mulberry32) so
//   tile/scroll deck shuffles are reproducible per game. Player tiles are
//   placed at the N mutually-farthest placement candidates (fair,
//   deterministic — placePlayerTilesSpread). Turns cycle through all N
//   players; each player's weights are swapped in right before their turn;
//   AP is refilled every turn (the local hot-seat path never auto-resets AP
//   for >1 players — that code is multiplayer-only). A stuck player (no
//   legal action ends their turn) gets a forced endTurn click, verified to
//   actually advance activePlayerIndex before trusting it — see the comment
//   in playMatch().
//
// SUPPRESSED DURING A MUTED (non-visual) RUN: win-screen modal
// (spellSystem.showLevelComplete), end-turn AP prompt, SoundSystem,
// gamification (window.gami — otherwise arena games would farm real XP onto
// the logged-in profile). spectate() (one continuous game) keeps sounds,
// music, animations, and the win screen — only gami is muted.
// JoytoneBridge is the one exception to "visual keeps everything": run(),
// evolve(), hillClimb(), and confirmAcrossSizes() suppress it UNCONDITIONALLY
// (see suppressJoytone()), regardless of opts.visual, because unlike
// spectate() they play many short games back to back — each one's own
// #lobby-wrapper hide/show cycle would otherwise reboot the music engine and
// restart playback from scratch every single game.
//
// LOAD ORDER: after bot.js.
// ============================================================

(function () {
    'use strict';

    function log(...args) { console.log('🏟️ [BotArena]', ...args); }
    const sleep = ms => new Promise(r => setTimeout(r, ms));

    function mulberry32(seed) {
        let a = seed >>> 0;
        return function () {
            a |= 0; a = (a + 0x6D2B79F5) | 0;
            let t = Math.imul(a ^ (a >>> 15), 1 | a);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }

    // Pick k distinct indices from [0, poolSize) via a seeded partial
    // Fisher-Yates shuffle (deterministic given the same rng stream).
    function sampleDistinct(poolSize, k, rng) {
        const idx = Array.from({ length: poolSize }, (_, i) => i);
        const n = Math.min(k, poolSize);
        for (let i = 0; i < n; i++) {
            const j = i + Math.floor(rng() * (idx.length - i));
            [idx[i], idx[j]] = [idx[j], idx[i]];
        }
        return idx.slice(0, n);
    }

    // Force local-mode identity before any local bot match. isMultiplayer/
    // myPlayerIndex are only ever reset by a CLEAN online-game leave
    // (lobby.js's _doLeaveGame()) — if that leave never fully completes (e.g.
    // its remove_player RPC throws), a bot match started right after inherits
    // a STALE isMultiplayer=true with a stale myPlayerIndex. startGame() does
    // not touch either. With isMultiplayer stuck true,
    // updateEndTurnButtonVisibility() (multiplayer-state.js) then gates the
    // end-turn button on real-multiplayer turn ownership (myPlayerIndex ===
    // activePlayerIndex) instead of "always enabled locally" — silently
    // disabling it for whichever bot doesn't match the stale identity, which
    // kills the match the instant a bot falls back to force-ending its turn.
    // Observed: a real 3-bot spectator match ending after turn 1, logged as
    // "stuck on turn 0 (end-turn button unavailable)". Called from
    // playMatch() itself (not just spectate()) so run()/evolve() are covered
    // too, regardless of which top-level entry point started the match.
    //
    // Resetting the JS variables alone isn't enough, though: the end-turn
    // BUTTON's actual DOM `disabled` attribute is only ever refreshed by
    // updateEndTurnButtonVisibility() itself — nothing calls that as a side
    // effect of an assignment to isMultiplayer. If the button was left
    // disabled by whatever real state the tab was in right before this
    // match started (e.g. a real multiplayer game where it wasn't this
    // client's turn), it stays disabled — applyAction('endTurn')
    // (bot-state.js) checks the raw DOM property, not isMultiplayer —
    // and the very first forced end-turn fails, which playMatch() treats
    // as "stuck" and ends the WHOLE match after just one turn. This is
    // specifically why "🔁 Restart bot game without player" (the only
    // caller that ever starts a match from an EXISTING session rather than
    // a fresh page load) could still die after turn 1 even with
    // isMultiplayer/myPlayerIndex correctly reset — headless testing never
    // catches it because a freshly loaded page never has a stale-disabled
    // button to begin with. Force a DOM refresh right here instead of
    // relying on some other code path to do it eventually.
    function ensureLocalMode() {
        if (typeof isMultiplayer !== 'undefined') isMultiplayer = false;
        if (typeof myPlayerIndex !== 'undefined') myPlayerIndex = null;
        if (typeof updateEndTurnButtonVisibility === 'function') updateEndTurnButtonVisibility();
    }

    // ----------------------------------------------------------------
    // Environment guard: everything a MUTED (non-visual) run mutes, saved
    // and restored even if a game throws.
    // ----------------------------------------------------------------
    function muteEnvironment() {
        const rw = window.spellSystem?.responseWindow;
        const saved = {
            random: Math.random,
            sound: window.SoundSystem,
            gami: window.gami,
            endTurnPrompt: window.showEndTurnPrompt,
            levelComplete: window.spellSystem?.showLevelComplete,
            speedScale: window.BotSystem.speedScale,
            isBotPlayer: rw?.isBotPlayer,
        };
        window.SoundSystem = null;
        // Joytone is handled separately (see suppressJoytone() / run() /
        // evolve()) — nulling window.JoytoneBridge here only stopped OTHER
        // code from calling into it, it never actually silenced audio
        // already playing or stopped the internal lobby-wrapper watcher
        // from booting a fresh engine on every simulated game.
        window.gami = null; // never grant real XP/gold for arena games
        window.showEndTurnPrompt = () => {};
        if (window.spellSystem) {
            window.spellSystem.showLevelComplete = function (playerIndex) {
                log(`(win screen suppressed for player ${playerIndex})`);
            };
        }
        // ResponseWindowSystem.isBotPlayer() identifies bots via multiplayer's
        // `allPlayersData` (lobby.js), which doesn't exist in the arena's local
        // hot-seat games — every seat here IS a bot, but isBotPlayer() silently
        // returns false for all of them, so the "skip window — bots can't
        // respond" gate never fires. Any cast whose response/counter happens to
        // be formed for another bot then opens a REAL window that sits out the
        // full 15s timeout with no one able to click Pass. Tell it the truth
        // for the duration of the run.
        if (rw) rw.isBotPlayer = () => true;
        return function restore() {
            Math.random = saved.random;
            window.SoundSystem = saved.sound;
            window.gami = saved.gami;
            window.showEndTurnPrompt = saved.endTurnPrompt;
            if (window.spellSystem && saved.levelComplete) {
                window.spellSystem.showLevelComplete = saved.levelComplete;
            }
            window.BotSystem.speedScale = saved.speedScale;
            if (rw && saved.isBotPlayer) rw.isBotPlayer = saved.isBotPlayer;
        };
    }

    // Silence Joytone for the WHOLE run() / evolve() job, regardless of
    // opts.visual — unlike spectate() (one continuous game, keeps the
    // soundtrack on purpose), run()/evolve() play many short simulated
    // games back to back, each triggering its own #lobby-wrapper hide/show
    // cycle that would otherwise reboot the engine and restart playback
    // from scratch every single game. See joytone-bridge.js's
    // setSuppressed()/startForGame().
    function suppressJoytone() {
        window.JoytoneBridge?.setSuppressed(true);
        return () => window.JoytoneBridge?.setSuppressed(false);
    }

    function setWeights(table) {
        const W = window.BotSystem.WEIGHTS;
        for (const k of Object.keys(W)) delete W[k];
        Object.assign(W, window.BotSystem.DEFAULT_WEIGHTS, table);
    }

    // Neutralize an in-progress tutorial before running ANY local bot game
    // (playMatch() calls this unconditionally, visual or muted — NOT just
    // for visual runs). Every TutorialMode hook call site
    // (game-core.js/game-ui.js/scroll-panels.js) is gated on
    // `window.isTutorialMode`, so clearing it fully stops the tutorial's own
    // step-advance machinery from reacting to bot actions. This matters even
    // muted: a bot racing through moves/casts/end-turns across dozens of
    // background games can satisfy the tutorial's remaining scripted steps
    // in seconds, and tutorial-mode.js's finish() calls
    // window.location.reload() once its step sequence runs out, killing the
    // run outright regardless of whether anyone's watching.
    function neutralizeTutorial() {
        if (!window.isTutorialMode) return;
        window.isTutorialMode = false;
        window.tutorialAllowedHexes = null;
        document.querySelectorAll('[class^="tmode"], [class*=" tmode"]').forEach(el => el.remove());
    }

    // ----------------------------------------------------------------
    // Player-tile placement: N mutually-farthest free hexes adjacent to the
    // tile cluster (large-tile grid), greedy max–min. Deterministic and
    // symmetric — no bot gets a positional edge from placement luck.
    // ----------------------------------------------------------------
    function placementCandidates() {
        const S = TILE_SIZE * 4;
        const candidates = [];
        for (const t of placedTiles) {
            const h = pixelToHex(t.x, t.y, S);
            for (const [dq, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, -1], [-1, 1]]) {
                const p = hexToPixel(h.q + dq, h.r + dr, S);
                if (placedTiles.some(o => Math.hypot(o.x - p.x, o.y - p.y) < 40)) continue;
                if (candidates.some(c => Math.hypot(c.x - p.x, c.y - p.y) < 40)) continue;
                // Game rule (same as the drag-drop path): player tiles must
                // touch at least 2 unrevealed tiles at placement time
                if (typeof countTouchingUnrevealedTiles === 'function' &&
                    countTouchingUnrevealedTiles(p.x, p.y) < 2) continue;
                candidates.push(p);
            }
        }
        return candidates;
    }

    // Spread n player tiles as far apart as possible (greedy max–min):
    // start from the farthest pair, then repeatedly add the candidate whose
    // minimum distance to the already-chosen spots is largest.
    function placePlayerTilesSpread(n) {
        const cands = placementCandidates();
        if (cands.length < n) throw new Error(`arena: only ${cands.length} placement candidates for ${n} players`);
        let pair = null;
        for (let i = 0; i < cands.length; i++) {
            for (let j = i + 1; j < cands.length; j++) {
                const d = Math.hypot(cands[i].x - cands[j].x, cands[i].y - cands[j].y);
                if (!pair || d > pair.d) pair = { d, a: cands[i], b: cands[j] };
            }
        }
        const chosen = [pair.a, pair.b];
        while (chosen.length < n) {
            let best = null;
            for (const c of cands) {
                if (chosen.includes(c)) continue;
                const minD = Math.min(...chosen.map(p => Math.hypot(p.x - c.x, p.y - c.y)));
                if (!best || minD > best.minD) best = { minD, c };
            }
            chosen.push(best.c);
        }
        for (const p of chosen.slice(0, n)) placeTile(p.x, p.y, 0, false, 'player');
    }

    // The local hot-seat path never auto-resets AP when playerPositions
    // has >1 entries (that branch is gated on multiplayer's myPlayerIndex),
    // so the arena refills at the start of every turn. addAP caps regular
    // AP at 5 and tops void AP up to the active player's void-stone count —
    // equivalent to the real per-turn reset + refreshVoidAP.
    function refillAP() {
        const missing = 15; // > max possible (5 + 5 void) — addAP clamps
        if (typeof addAP === 'function') addAP(missing);
    }

    // Shared "should we stop early" flag — set by stop(), checked by every
    // loop in run()/evolve()/spectate() so one Stop button covers all three.
    // This is a HARD abort: callers (runWeightTraining()) treat it as
    // "discard everything, revert to whatever was live before this run."
    let _stopRequested = false;
    function stop() { _stopRequested = true; }

    // Separate SOFT-stop flag, evolve()-only: cuts the generation loop
    // short but still returns a genuinely usable champion (the last FULLY
    // completed generation's winner — evolve() only advances `champion`
    // after a generation finishes ranking, so an early exit mid-generation
    // never returns a half-computed result). Deliberately distinct from
    // stop()/_stopRequested: callers that gate on "did the user hard-abort"
    // (e.g. runWeightTraining()'s discard-and-revert branch) must NOT treat
    // an early-end the same way, since the whole point is to still run the
    // confirmation match (or, for breeding, still download the file) with
    // whatever evolve() reached — the training itself is cut short, the
    // RESULT is not discarded.
    let _endEarlyRequested = false;
    function endEarly() { _endEarlyRequested = true; }
    function endEarlyRequested() { return _endEarlyRequested; }

    // ----------------------------------------------------------------
    // Challenger marker: in Hill Climb series the challenger's pawn, and in
    // confirmAcrossSizes the bot being tested, gets a red X so it is always
    // easy to tell apart from the champion (owner request 2026-09-26). The
    // seat changes game to game (sides alternate), so a light ticker keeps
    // the X on the right pawn while a job runs.
    let _markedSeat = null, _markTicker = null;
    function syncChallengerMark() {
        const seat = isRunning() ? _markedSeat : null;
        const positions = (typeof playerPositions !== 'undefined' && Array.isArray(playerPositions)) ? playerPositions : [];
        positions.forEach((pp, i) => {
            const g = pp && pp.element;
            if (!g || typeof g.querySelector !== 'function') return;
            const mark = g.querySelector(':scope > .challenger-x');
            if (i === seat && !mark) {
                const ns = 'http://www.w3.org/2000/svg';
                const x = document.createElementNS(ns, 'g');
                x.setAttribute('class', 'challenger-x');
                x.setAttribute('pointer-events', 'none');
                for (const [w, c] of [[4.6, '#111'], [2.6, '#ff3b30']]) {
                    for (const [x1, y1, x2, y2] of [[-6, -6, 6, 6], [6, -6, -6, 6]]) {
                        const l = document.createElementNS(ns, 'line');
                        l.setAttribute('x1', x1); l.setAttribute('y1', y1); l.setAttribute('x2', x2); l.setAttribute('y2', y2);
                        l.setAttribute('stroke', c); l.setAttribute('stroke-width', w); l.setAttribute('stroke-linecap', 'round');
                        x.appendChild(l);
                    }
                }
                g.appendChild(x);
            } else if (i !== seat && mark) {
                mark.remove();
            }
        });
        if (seat === null && _markTicker && !isRunning()) { clearInterval(_markTicker); _markTicker = null; }
    }
    function setMarkedSeat(seat) {
        _markedSeat = seat;
        if (seat !== null && !_markTicker) _markTicker = setInterval(syncChallengerMark, 250);
        syncChallengerMark();
    }
    function markedSeat() { return _markedSeat; }

    // ----------------------------------------------------------------
    // Trap-loop stall detection: bots sometimes wedge each other into a
    // stable non-position (e.g. both camped on a shrine with full pools,
    // neither willing to move first) that takes the full 200-turn cap to
    // "resolve" as a draw. If STALL_MIN_BOTS players each end STALL_TURNS
    // consecutive own turns standing on the SAME revealed elemental tile
    // (each has their own tile — they needn't share one), the round is
    // restarted instead (see playMatch()).
    // ----------------------------------------------------------------
    const STALL_TURNS = 7;
    const STALL_MIN_BOTS = 2;
    // Detector 3 default (see STALL RESTART header). Measured 2026-09-26: a
    // healthy 2-bot game (seed 4, won on turn 83) went 16.5 rounds without a
    // new element, so the limit sits above that.
    const NO_PROGRESS_ROUNDS = 20;
    const ELEMENTAL_SHRINES = ['earth', 'water', 'fire', 'wind', 'void'];

    // The revealed elemental tile the position stands on, else null.
    // Same closest-center-within-radius rule as game-core's
    // findTileAtPosition() (a tile covers 19 hexes; TILE_SIZE*5.5 spans the
    // whole tile including edges), which isn't exported — plus the
    // revealed + elemental filters this check needs. Never reads shrineType
    // off an unrevealed tile (t.flipped = face-down).
    function elementalTileAt(x, y) {
        const tileRadius = TILE_SIZE * 5.5;
        let closest = null, closestDist = Infinity;
        for (const t of placedTiles) {
            if (t.isPlayerTile) continue;
            const d = Math.hypot(t.x - x, t.y - y);
            if (d < tileRadius && d < closestDist) { closest = t; closestDist = d; }
        }
        if (!closest || closest.flipped) return null;
        return ELEMENTAL_SHRINES.includes(closest.shrineType) ? closest : null;
    }

    // ----------------------------------------------------------------
    // SHARED CORE: one full game for weightsPerPlayer.length players (2–5).
    // weightsPerPlayer[i] is that player's weight table; an `undefined`
    // entry means "don't touch WEIGHTS for this player's turn" (how
    // spectate() plays with whatever's currently loaded/toggled instead of
    // a fixed table). opts.visual only affects PACING (sleep durations,
    // turnCap default) — muting the environment and any status/log UI is
    // the caller's job.
    // Returns { winner: 0..n-1 | null, turns, activated: [n0..], stuckTurns:
    // {0: n, 1: n, ...}, stalled, stallers }. `activated` = each player's
    // elements-activated count at game end (win progress, 0-5) and
    // `stuckTurns` = how many times each player's turn had to be
    // force-ended because botTurn() never chose to end it itself (stuck/no
    // productive action). Both feed sideFitness() so a bot that stalls
    // scores worse than one that plays actively, even when neither wins
    // outright — see docs/bot-roadmap.md Stage 3a fitness note. `stalled` =
    // the game was aborted by a trap-loop detector (see STALL_TURNS above);
    // playMatch() (the public wrapper below) restarts stalled rounds rather
    // than returning them, so callers only ever see stalled:true when the
    // restart budget ran out. `stallers` = which player index(es) caused
    // THIS attempt's stall (only meaningful when stalled is true) — see the
    // ATTRIBUTION note at the top of the file.
    // ----------------------------------------------------------------
    async function _playMatchOnce(weightsPerPlayer, opts = {}) {
        const nPlayers = weightsPerPlayer.length;
        const visual = !!opts.visual;
        const turnCap = opts.turnCap ?? (visual ? 300 : 200);
        const seed = opts.seed ?? Math.floor(Math.random() * 1e9);
        const stuckTurns = {};
        for (let i = 0; i < nPlayers; i++) stuckTurns[i] = 0;
        // Per-player camping streak for the trap-loop detector: which
        // elemental tile this player ended their last turn on, and for how
        // many consecutive own turns they've stayed on that same tile.
        const camp = {};
        for (let i = 0; i < nPlayers; i++) camp[i] = { tileId: null, count: 0 };
        // No-cast stall cap (detector 2 — see the STALL RESTART header note):
        // this many consecutive player-turns with zero casts by ANYONE ends
        // the game as stalled. Expressed in rounds so it means the same
        // thing at every player count. Skipped gracefully on an older
        // bot.js without the castsApplied() counter.
        const noCastTurnCap = Math.max(1, opts.stallNoCastRounds ?? 10) * nPlayers;
        // No-progress stall cap (detector 3): rounds with no new element
        // activated by anyone. Owner request 2026-09-26.
        const noProgressTurnCap = Math.max(1, opts.stallNoProgressRounds ?? NO_PROGRESS_ROUNDS) * nPlayers;
        let lastProgressTurn = -1, activatedSeen = 0, maxQuietTurns = 0;
        const castCounter = window.BotSystem.castsApplied;
        let castsSeen = castCounter ? castCounter() : null;
        let lastCastTurn = -1; // -1 = no cast yet this game

        // Seed ALL shuffle randomness (tile deck, scroll decks) for this game
        Math.random = mulberry32(seed);

        neutralizeTutorial();
        ensureLocalMode();
        // A real "out of AP, end turn?" modal from whatever game the human
        // was just in doesn't get cleared by muting/stubbing
        // showEndTurnPrompt() (that only stops NEW popups) — any instance
        // already in the DOM sits there, unclicked, for the whole bot job.
        document.getElementById('end-turn-empty-ap-modal')?.remove();
        if (typeof resetGameResources === 'function') resetGameResources();
        window.BotSystem.resetMemory();
        startGame(nPlayers);
        await sleep(visual ? 300 : 30);
        placePlayerTilesSpread(nPlayers);
        await sleep(visual ? 300 : 30);
        activePlayerIndex = 0;
        if (visual) { try { currentTurnNumber = 1; } catch (e) {} } // local games never advance it — the log needs it

        // Every seat in a bot-arena game is a bot, so the "you're out of AP,
        // end turn?" modal (a human-click nudge — see showEndTurnPrompt's own
        // comment) can never be answered here. muteEnvironment() already
        // stubs it, but only for MUTED runs — a visual run (Watchable
        // training, spectate) left the real one live, popping up and sitting
        // there unclicked every time a bot emptied its AP. Suppress it
        // unconditionally for the lifetime of this one game, regardless of
        // visual/muted (spectate() also stubs it for its own longer-lived
        // reasons — this nests safely underneath that).
        const savedShowEndTurnPrompt = window.showEndTurnPrompt;
        window.showEndTurnPrompt = () => {};

        const result = { winner: null, turns: 0, activated: new Array(nPlayers).fill(0), stuckTurns, stalled: false, stallers: [] };
        try {
            // Also break on _endEarlyRequested so "End Early → Test Now" aborts
            // the in-progress game immediately rather than waiting for it to
            // reach a winner or the turn cap (near-identical hillClimb bots can
            // run a single game to the cap, ~15-20s). The current game's result
            // is discarded either way — endEarly ends the round and confirms the
            // best champion SO FAR. evolve()/hillClimb() clear the flag before
            // their confirmation run(), and spectate() resets it on entry, so no
            // other playMatch caller is cut short by a stale request.
            for (let turn = 0; turn < turnCap && !_stopRequested && !_endEarlyRequested; turn++) {
                if (visual) { try { currentTurnNumber = turn + 1; } catch (e) {} }
                const idx = activePlayerIndex;
                if (weightsPerPlayer[idx] !== undefined) setWeights(weightsPerPlayer[idx]);
                refillAP();
                await window.BotSystem.turn();
                result.turns = turn + 1;

                const snap = window.BotState.snapshot();
                result.activated = snap.players.map(p => p.activated.length);
                const w = window.BotSim.winner(snap);
                if (w !== null) { result.winner = w; break; }

                // Trap-loop detector: extend/reset this player's camping
                // streak based on where they ended this turn, then stall out
                // if enough players are camped simultaneously.
                const pos = playerPositions[idx];
                const campTile = pos ? elementalTileAt(pos.x, pos.y) : null;
                const streak = camp[idx];
                if (campTile && streak.tileId === campTile.id) {
                    streak.count++;
                } else {
                    streak.tileId = campTile ? campTile.id : null;
                    streak.count = campTile ? 1 : 0;
                }
                const campers = Object.keys(camp).filter(i => camp[i].count >= STALL_TURNS).map(Number);
                if (campers.length >= STALL_MIN_BOTS) {
                    result.stalled = true;
                    result.stallReason = 'camping';
                    result.stallers = campers;
                    log(`match seed ${seed}: ${campers.length} bots each parked on an elemental tile for ${STALL_TURNS} straight turns - trap loop, aborting round on turn ${turn + 1}`);
                    break;
                }

                // No-cast stall: nobody has cast anything for too many rounds
                // (free-teleport ping-pong and other zero-progress loops).
                if (castsSeen !== null) {
                    const c = castCounter();
                    if (c !== castsSeen) { castsSeen = c; lastCastTurn = turn; }
                    else if (turn - lastCastTurn >= noCastTurnCap) {
                        result.stalled = true;
                        result.stallReason = 'no_cast';
                        // Nobody cast — a joint failure, not one player's doing (unlike
                        // camping's per-tile streak), so every seat shares attribution.
                        result.stallers = Array.from({ length: nPlayers }, (_, i) => i);
                        log(`match seed ${seed}: no scroll cast by anyone for ${Math.round(noCastTurnCap / nPlayers)} straight rounds (${noCastTurnCap} turns) - stalled, aborting round on turn ${turn + 1}`);
                        break;
                    }
                }

                // No-progress stall: no new element activated by anyone for
                // too many rounds (detector 3).
                const activatedNow = result.activated.reduce((a, b) => a + b, 0);
                if (activatedNow !== activatedSeen) { activatedSeen = activatedNow; lastProgressTurn = turn; }
                maxQuietTurns = Math.max(maxQuietTurns, turn - lastProgressTurn);
                result.maxQuietRounds = +(maxQuietTurns / nPlayers).toFixed(1);
                if (turn - lastProgressTurn >= noProgressTurnCap) {
                    result.stalled = true;
                    result.stallReason = 'no_progress';
                    result.stallers = Array.from({ length: nPlayers }, (_, i) => i);
                    log(`match seed ${seed}: no new element activated by anyone for ${Math.round(noProgressTurnCap / nPlayers)} straight rounds (${noProgressTurnCap} turns) - stalled, aborting round on turn ${turn + 1}`);
                    break;
                }

                if (activePlayerIndex === idx) {
                    // Bot didn't end its own turn (stuck/no actions), force it.
                    // applyAction({type:'endTurn'}) reports ok:true just from
                    // clicking the button, NOT from activePlayerIndex actually
                    // advancing — a click that gets swallowed (e.g. an unresolved
                    // scroll-overflow banner, or some other gate) would otherwise
                    // look like success and this loop would silently re-run the
                    // SAME stuck player for the rest of turnCap.
                    stuckTurns[idx]++;
                    const r = window.BotState.applyAction({ type: 'endTurn' });
                    await sleep(200);
                    if (!r.ok || activePlayerIndex === idx) {
                        result.endReason = 'stuck';
                        log(`match seed ${seed}: stuck on turn ${turn} (${r.reason || 'endTurn did not advance activePlayerIndex'})`);
                        break;
                    }
                    await sleep(visual ? 50 : 20);
                }
            }
        } finally {
            window.showEndTurnPrompt = savedShowEndTurnPrompt;
        }
        // Why this attempt ended, for training UIs: 'win', a stall reason
        // ('camping' / 'no_cast' / 'no_progress'), 'stuck', 'turn_cap' or
        // 'stopped'.
        if (!result.endReason) {
            result.endReason = result.winner !== null ? 'win'
                : result.stalled ? result.stallReason
                : (_stopRequested || _endEarlyRequested) ? 'stopped'
                : result.turns >= turnCap ? 'turn_cap' : 'stopped';
        }
        return result;
    }

    // ----------------------------------------------------------------
    // Public playMatch(): _playMatchOnce() plus the stall-restart loop.
    // A round aborted by the trap-loop detector is replayed from scratch
    // with a DERIVED seed — replaying the identical seed would just walk
    // the same deterministic decisions back into the same trap. Capped by
    // opts.maxStallRestarts (default 3): a round still stalled after the
    // last retry is returned as-is (winner null → counts as a draw) so a
    // pathological weight table can't spin restarts forever. Restarted
    // attempts' GAME STATE (turns/activated/winner) is discarded entirely —
    // only the final attempt's reaches the caller (with result.restarts =
    // how many restarts it took), so run()/evolve()/spectate() stats never
    // double-count a restarted round. Their STALL ATTRIBUTION is NOT
    // discarded — result.stallCounts sums every attempt's stallers so
    // seatFitness() still notices a weight table that stalls repeatedly.
    // ----------------------------------------------------------------
    async function playMatch(weightsPerPlayer, opts = {}) {
        const baseSeed = opts.seed ?? Math.floor(Math.random() * 1e9);
        const maxStallRestarts = opts.maxStallRestarts ?? 3;
        // Per-player count of stalled attempts (including ones discarded by a
        // restart) this call consumed — see the ATTRIBUTION note near the top
        // of the file. Accumulated across the whole retry loop so a weight
        // table that keeps stalling doesn't get a free pass just because the
        // FINAL attempt happened to resolve normally.
        const stallCounts = {};
        const stallReasons = {}; // e.g. {camping: 1, no_cast: 2}: every stalled attempt, restarts included
        let result;
        for (let attempt = 0; ; attempt++) {
            const seed = (baseSeed + attempt * 1000003) >>> 0; // deterministic per-restart reshuffle
            result = await _playMatchOnce(weightsPerPlayer, { ...opts, seed });
            result.restarts = attempt;
            if (result.stalled) for (const idx of result.stallers) stallCounts[idx] = (stallCounts[idx] || 0) + 1;
            if (result.stalled) stallReasons[result.stallReason] = (stallReasons[result.stallReason] || 0) + 1;
            if (!result.stalled || _stopRequested || _endEarlyRequested || attempt >= maxStallRestarts) break;
            log(`restarting stalled round (restart ${attempt + 1}/${maxStallRestarts}, next seed ${(baseSeed + (attempt + 1) * 1000003) >>> 0})`);
        }
        if (result.stalled) log(`round still stalled after ${result.restarts} restart(s) - returning it as a draw`);
        result.stallCounts = stallCounts;
        result.stallReasons = stallReasons;
        return result;
    }

    // Backward-compat 2-player wrapper (console/roadmap scripts reference
    // this signature directly).
    async function playGame(weights0, weights1, gameSeed, opts = {}) {
        return playMatch([weights0, weights1], { ...opts, seed: gameSeed });
    }

    // ----------------------------------------------------------------
    // Per-side fitness for one game: +1 win / -1 loss / 0 draw, plus a small
    // reward for win-condition progress (elements activated, 0-5), a small
    // penalty per turn the side got stuck with nothing productive to do,
    // and a penalty per trap-loop stall the side caused (including ones
    // playMatch() discarded via a restart — see result.stallCounts). This is
    // reward SHAPING, not a hand-authored rule about any specific trap — it
    // makes evolution's selection pressure notice stalling/passivity at all,
    // which pure win/loss fitness could not (a 200-turn stalled draw scored
    // identically to a sharp, decisive draw, and — before stallCounts
    // existed — a weight table that stalled 3 times then happened to win
    // the 4th attempt scored as a plain win, with the stalling invisible).
    // Mirrors the "win ±1, small per-turn penalty" reward the roadmap
    // specifies for the eventual Stage 3c RL reward.
    // ----------------------------------------------------------------
    // seatFitness generalizes this to ANY seat index in a 2–5-player game
    // (win ±1 vs everyone else, same progress/stuck/stall terms) — used by
    // the N-player confirmAcrossSizes() gate below. sideFitness is the
    // 2-player special case _playSeries()/run() still call by name.
    function seatFitness(result, idx, opts = {}) {
        const progressWeight = opts.progressWeight ?? 0.3;
        const stuckPenalty = opts.stuckPenalty ?? 0.15;
        const stallPenalty = opts.stallPenalty ?? 0.25;
        const win = result.winner === null ? 0 : (result.winner === idx ? 1 : -1);
        const progress = (result.activated?.[idx] ?? 0) / 5;
        const stuck = result.stuckTurns?.[idx] ?? 0;
        const stalls = result.stallCounts?.[idx] ?? 0;
        return win + progressWeight * progress - stuckPenalty * stuck - stallPenalty * stalls;
    }
    function sideFitness(result, sideIsPlayer0, opts = {}) {
        return seatFitness(result, sideIsPlayer0 ? 0 : 1, opts);
    }

    // ----------------------------------------------------------------
    // Internal: play an A-vs-B series, checking _stopRequested each game.
    // No _running guard or flag resets — that's the caller's job (run() as
    // a top-level entry point; evolve()'s 2-player path calls this directly
    // so a mid-evolve stop() isn't undone between pairwise matchups).
    // Computes aFitness/bFitness via sideFitness() (not just win tallies)
    // and fires opts.onGame per game, same as before the N-player refactor.
    // ----------------------------------------------------------------
    // MIRROR-PAIRED seeds (variance reduction): consecutive games (0,1),
    // (2,3), ... share ONE deck seed with the sides swapped — the whole
    // pipeline is seeded/deterministic, so a lucky shuffle helps each side
    // exactly once per pair and deck luck cancels out of the win tally.
    // (Self-play sanity property: A-vs-A must split every decided pair
    // exactly 1-1 — the mirrored game IS the first game with seats
    // swapped.) opts.gameIndexOffset lets staged callers (hillClimb's
    // successive halving) CONTINUE a challenger's seed sequence across
    // blocks instead of replaying the same decks.
    async function _playSeries(weightsA, weightsB, nGames, seed, opts) {
        const result = { aWins: 0, bWins: 0, draws: 0, avgTurns: 0, aFitness: 0, bFitness: 0, games: [] };
        const offset = opts.gameIndexOffset || 0;
        // Honor endEarly() at the GAME boundary so "End Early → Test Now" stops
        // within one game, not one full challenger block (~10 games) or round
        // (~100). Safe because evolve()/hillClimb() clear _endEarlyRequested in
        // their finally blocks before the confirmation run() is issued — so the
        // confirm series, which also flows through here, always plays in full.
        for (let i = 0; i < nGames && !_stopRequested && !_endEarlyRequested; i++) {
            const gi = offset + i;
            const aIsPlayer0 = gi % 2 === 0;
            if (opts.markChallenger) setMarkedSeat(aIsPlayer0 ? 0 : 1);
            const g = await playGame(
                aIsPlayer0 ? weightsA : weightsB,
                aIsPlayer0 ? weightsB : weightsA,
                seed * 1000 + (gi >> 1),
                opts
            );
            if (opts.markChallenger) setMarkedSeat(null);
            const aWon = g.winner !== null && ((g.winner === 0) === aIsPlayer0);
            if (g.winner === null) result.draws++;
            else if (aWon) result.aWins++;
            else result.bWins++;
            result.aFitness += sideFitness(g, aIsPlayer0, opts);
            result.bFitness += sideFitness(g, !aIsPlayer0, opts);
            result.games.push({ winner: g.winner, turns: g.turns, aIsPlayer0 });
            result.avgTurns += g.turns / nGames;
            log(`game ${i + 1}/${nGames}: ${g.winner === null ? 'draw' : (aWon ? 'A' : 'B') + ' wins'} in ${g.turns} turns  (A=${result.aWins} B=${result.bWins} D=${result.draws})`);
            if (typeof opts.onGame === 'function') {
                try { opts.onGame(i + 1, nGames, g, { aIsPlayer0, aWon }); } catch (e) { /* UI callback errors never abort a run */ }
            }
            await sleep(0); // yield between games — keep the tab responsive
        }
        return result;
    }

    // ----------------------------------------------------------------
    // Public: run an A-vs-B series. Sides alternate each game (game i even:
    // A = player 0; odd: A = player 1) to cancel first-mover advantage.
    // opts.visual: play every game with normal pacing/visuals (muted by
    // default, like before).
    // ----------------------------------------------------------------
    let _running = false;
    async function run(weightsA, weightsB, nGames = 10, seed = 0, opts = {}) {
        if (_running || _spectating || _evolving || _climbing) throw new Error('BotArena already running');
        if (!window.BotSim || !window.BotState || !window.BotSystem) {
            throw new Error('BotArena needs BotState/BotSim/BotSystem loaded');
        }
        _running = true;
        _stopRequested = false;
        const visual = !!opts.visual;
        const restore = visual ? null : muteEnvironment();
        const unsuppressJoytone = suppressJoytone();
        window.BotSystem.speedScale = opts.speed ?? (visual ? 1 : 0.1);
        try {
            const result = await _playSeries(weightsA, weightsB, nGames, seed, { ...opts, visual });
            log('run complete:', JSON.stringify({
                aWins: result.aWins, bWins: result.bWins, draws: result.draws,
                avgTurns: +result.avgTurns.toFixed(1),
                aFitness: +result.aFitness.toFixed(2), bFitness: +result.bFitness.toFixed(2),
            }));
            return result;
        } finally {
            if (restore) restore();
            unsuppressJoytone();
            _running = false;
        }
    }

    // ----------------------------------------------------------------
    // Evolution loop (roadmap Stage 3a step 2).
    // population = opts.seedWeights (0-2 tables; defaults to current WEIGHTS
    // when omitted) + (popSize-1) more filled by breeding those seeds (see
    // above); next gen = top-2 elites carried over unchanged, rest bred via
    // uniform crossover across the top-3 pool (see crossover()) then
    // mutated. Champion persisted to localStorage['godaigo_bot_weights']
    // after every generation — callers that don't want this run's result to
    // affect the browser's LIVE bot weights must save/restore around the
    // call themselves (see the Bot Training panel's "breed" flow).
    //
    // opts.nPlayers (2–5, 'all', default 2):
    //   2 → the ORIGINAL exhaustive pairwise round-robin (every population
    //   pair plays opts.gamesPerPair games, sideFitness-based — unchanged
    //   from before).
    //   >2 → exhaustive C(popSize, nPlayers) explodes fast, so each
    //   generation instead samples opts.gamesPerGen (default popSize*3)
    //   random N-player groupings (seeded, reproducible) and credits the
    //   winner's population slot with +1 fitness.
    //   'all' → GENERALIST training: same per-game sampling as the >2 path,
    //   but each sampled game also draws a fresh player count 2..min(5,
    //   popSize), so one run evolves weights across arenas of every size at
    //   once. Pair with confirmAcrossSizes() for a matching multi-size gate.
    // opts.visual: play every training game with normal pacing/visuals via
    // playMatch() — same core spectate() uses — instead of muted/fast.
    // opts.onGeneration?(genNumber, totalGenerations, fitnessArray) —
    // optional progress hook so a caller (e.g. the cheat-panel UI) can
    // report progress without polling; purely observational, never gates
    // the loop.
    //
    // NOTE: a full roadmap-spec generation (28 pairs × 10 games) takes
    // hours in-browser even muted, and MUCH longer visualized — gamesPerPair
    // /gamesPerGen are configurable; server-side execution is Stage R5's job.
    // ----------------------------------------------------------------
    // opts.structural: also let formula terms be added / removed / changed
    // (js/bot-terms.js). Term weights are always nudged like any weight.
    function mutate(table, rng, sigma = 0.2, opts = {}) {
        const out = { ...table };
        for (const k of Object.keys(out)) {
            if (typeof out[k] !== 'number') continue;
            if (k === 'searchDepth' || k === 'searchBreadth' || k === 'searchHybrid' || k === 'searchKeepCasts' || k === 'searchCastExtraDepth') continue; // brain shape, not tuning
            if (k === 'mctsSamples' || k === 'mctsIterations' || k === 'mctsHorizon' || k === 'mctsExploration' || k === 'mctsRootBreadth' || k === 'mctsRolloutDepth' || k === 'mctsRolloutBreadth') continue; // brain shape, not tuning
            // Box-Muller gaussian × 20% of the weight's magnitude (min 1 so
            // zero-weights can still move off zero)
            const u1 = Math.max(rng(), 1e-9), u2 = rng();
            const gauss = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
            out[k] = +(out[k] + gauss * sigma * Math.max(1, Math.abs(out[k]))).toFixed(3);
        }
        if (window.BotTerms && (out.terms || opts.structural)) {
            const terms = window.BotTerms.mutateTerms(out.terms, rng, sigma, { structural: !!opts.structural });
            if (terms.length) out.terms = terms; else delete out.terms;
        }
        return out;
    }

    // Uniform crossover: each weight independently inherited from parent a or
    // b (a real-valued weight vector has no meaningful "gene order" to cut a
    // single split point on, unlike a bitstring/chromosome GA). Lets two
    // different good strategies combine instead of only drifting apart via
    // mutation of a single elite — e.g. one elite good at pattern-building,
    // another good at collecting, can now produce a child that inherits both.
    function crossover(a, b, rng) {
        const out = { ...a };
        for (const k of Object.keys(out)) {
            if (typeof out[k] !== 'number') continue;
            if (k === 'searchDepth' || k === 'searchBreadth' || k === 'searchHybrid' || k === 'searchKeepCasts' || k === 'searchCastExtraDepth') continue; // brain shape, not tuning
            if (k === 'mctsSamples' || k === 'mctsIterations' || k === 'mctsHorizon' || k === 'mctsExploration' || k === 'mctsRootBreadth' || k === 'mctsRolloutDepth' || k === 'mctsRolloutBreadth') continue; // brain shape, not tuning
            out[k] = rng() < 0.5 ? a[k] : b[k];
        }
        if (window.BotTerms && (a.terms || b.terms)) {
            const terms = window.BotTerms.crossTerms(a.terms, b.terms, rng);
            if (terms.length) out.terms = terms; else delete out.terms;
        }
        return out;
    }

    let _evolving = false;
    function isEvolving() { return _evolving; }

    async function evolve(generations = 5, opts = {}) {
        if (_running || _spectating || _evolving || _climbing) throw new Error('BotArena already running');
        if (!window.BotSim || !window.BotState || !window.BotSystem) {
            throw new Error('BotArena needs BotState/BotSim/BotSystem loaded');
        }
        const gamesPerPair = opts.gamesPerPair ?? 2;
        const popSize = opts.popSize ?? 8;
        const seed = opts.seed ?? 1;
        // opts.nPlayers === 'all' → GENERALIST mode: every sampled game picks a
        // random player count 2..min(5,popSize), so one training run spans
        // arenas of every size instead of a fixed one. Otherwise a fixed 2–5.
        const allSizes = opts.nPlayers === 'all';
        const nPlayers = allSizes ? null : Math.max(2, Math.min(5, opts.nPlayers ?? 2));
        const visual = !!opts.visual;
        const rng = mulberry32(seed);
        // opts.termMutations: children may also gain / lose / change formula terms
        const termOpts = { structural: !!opts.termMutations };

        _evolving = true;
        _stopRequested = false; // same stop() flag spectate() uses — shared "cancel a local bot job" signal
        _endEarlyRequested = false; // soft-stop for THIS run only — see its own comment above
        const restore = visual ? null : muteEnvironment();
        const unsuppressJoytone = suppressJoytone();
        window.BotSystem.speedScale = opts.speed ?? (visual ? 1 : 0.1);

        // Every population member is tracked as {id, w, parentIds} so a UI
        // can show a stable roster across generations, not just a bare
        // fitness-number array: id is assigned once when a table is first
        // created (seed, mutation, or crossover child) and an ELITE keeps
        // its id when carried over unchanged into the next generation — a
        // fresh mutation/crossover child always gets a NEW id and records
        // parentIds (empty for a seed/pure mutation-of-one, [idA, idB] for
        // a crossover child) so lineage can be shown. Purely a display
        // concern — ids never affect selection/breeding logic itself.
        let _nextPopId = 1;
        function newMember(w, parentIds) { return { id: _nextPopId++, w, parentIds: parentIds || [] }; }

        // opts.seedWeights (0-2 uploaded/carried-over weight tables) seeds
        // the initial population instead of the live WEIGHTS. With exactly
        // 2 seeds, the rest of the population is bred via crossover between
        // them (then mutated) — same reasoning as the elite breeding pool
        // below, just applied to externally-supplied parents instead of a
        // generation's own winners. With 0 or 1, behaves exactly as before
        // (mutations of the single available table).
        const seeds = (opts.seedWeights && opts.seedWeights.length) ? opts.seedWeights : [{ ...window.BotSystem.WEIGHTS }];
        let population = seeds.map(w => newMember(w));
        while (population.length < popSize) {
            if (seeds.length >= 2) {
                const pa = seeds[Math.floor(rng() * seeds.length)];
                const pb = seeds[Math.floor(rng() * seeds.length)];
                population.push(newMember(mutate(pa === pb ? pa : crossover(pa, pb, rng), rng, 0.2, termOpts)));
            } else {
                population.push(newMember(mutate(seeds[0], rng, 0.2, termOpts)));
            }
        }
        let champion = population[0].w;

        try {
            // NOTE on _endEarlyRequested granularity: like _stopRequested,
            // this is checked inside the CURRENT generation's game loops too
            // — clicking "End Early" mid-generation still finishes ranking
            // that (now partial) generation and returns its winner, same as
            // a hard stop() does today. Population slots 0/1 are always the
            // previous generation's elites (carried over unchanged), so
            // even an early interruption has real fitness signal for the
            // two strongest known tables — but other slots may show 0
            // (untested) fitness if their matchups never ran. In practice
            // this mostly matters if end-early is clicked mid-generation
            // rather than between them; not worth the extra complexity of
            // discarding a partial generation outright for a v1.
            for (let gen = 0; gen < generations && !_stopRequested && !_endEarlyRequested; gen++) {
                const fitness = new Array(population.length).fill(0);

                if (!allSizes && nPlayers === 2) {
                    for (let i = 0; i < population.length && !_stopRequested && !_endEarlyRequested; i++) {
                        for (let j = i + 1; j < population.length && !_stopRequested && !_endEarlyRequested; j++) {
                            if (visual && typeof updateStatus === 'function') {
                                updateStatus(`🧬 Evolve gen ${gen + 1}/${generations}: pop#${i} vs pop#${j}`);
                            }
                            const r = await _playSeries(population[i].w, population[j].w, gamesPerPair, seed * 100 + gen * 10 + i + j, { ...opts, visual });
                            fitness[i] += r.aFitness;
                            fitness[j] += r.bFitness;
                        }
                    }
                } else {
                    const gamesPerGen = opts.gamesPerGen ?? popSize * 3;
                    const maxN = Math.min(5, population.length);
                    for (let g = 0; g < gamesPerGen && !_stopRequested && !_endEarlyRequested; g++) {
                        // Generalist mode picks a fresh player count per game so
                        // one generation spans arenas of every size; a fixed
                        // mode always uses the same nPlayers.
                        const nP = allSizes ? (2 + Math.floor(rng() * (maxN - 1))) : nPlayers;
                        const idxs = sampleDistinct(population.length, nP, rng);
                        const weightsPerPlayer = idxs.map(i => population[i].w);
                        const gameSeed = seed * 100000 + gen * 1000 + g;
                        if (visual && typeof updateStatus === 'function') {
                            updateStatus(`🧬 Evolve gen ${gen + 1}/${generations}, game ${g + 1}/${gamesPerGen}: ${nP}p pop ${idxs.join(',')}`);
                        }
                        const result = await playMatch(weightsPerPlayer, { ...opts, seed: gameSeed, visual });
                        if (result.winner !== null) fitness[idxs[result.winner]]++;
                        log(`gen ${gen + 1} game ${g + 1}/${gamesPerGen} (${nP}p pop ${idxs.join(',')}): ${result.winner === null ? 'draw' : 'pop#' + idxs[result.winner] + ' wins'} in ${result.turns} turns`);
                        if (typeof opts.onGame === 'function') {
                            try { opts.onGame(g + 1, gamesPerGen, result); } catch (e) { /* UI callback errors never abort training */ }
                        }
                        await sleep(0);
                    }
                }

                const ranked = population
                    .map((p, i) => ({ id: p.id, w: p.w, parentIds: p.parentIds, f: fitness[i] }))
                    .sort((a, b) => b.f - a.f);
                log(`generation ${gen + 1}/${generations} fitness:`, ranked.map(r => r.f).join(', '));
                if (typeof opts.onGeneration === 'function') {
                    // 3rd arg (bare fitness numbers) kept exactly as before for
                    // existing callers; 4th arg is the richer per-member roster
                    // (id/fitness/lineage/weights, already best-first) for a UI
                    // that wants to show more than just numbers.
                    try {
                        opts.onGeneration(gen + 1, generations, ranked.map(r => r.f),
                            ranked.map(r => ({ id: r.id, fitness: r.f, parentIds: r.parentIds, w: r.w })));
                    } catch (e) { /* UI callback errors never abort training */ }
                }

                champion = ranked[0].w;
                try { localStorage.setItem('godaigo_bot_weights', JSON.stringify(champion)); } catch (e) {}
                log('champion weights (paste into bot.js DEFAULT_WEIGHTS to make permanent):\n' + JSON.stringify(champion));

                // Pure elitism: the top 2 survive completely unchanged (same
                // id — they ARE the same table), so a generation can never
                // lose the best table found so far. The rest of the
                // population is bred from a slightly wider pool (top 3) via
                // crossover + mutation — a fresh id each, with parentIds set
                // — so two different good strategies can combine instead of
                // only mutating apart from a single elite each.
                const elites = [ranked[0], ranked[1]];
                const breedingPool = ranked.slice(0, Math.min(3, ranked.length));
                population = elites.map(r => ({ id: r.id, w: r.w, parentIds: r.parentIds }));
                while (population.length < popSize) {
                    const pa = breedingPool[Math.floor(rng() * breedingPool.length)];
                    const pb = breedingPool[Math.floor(rng() * breedingPool.length)];
                    const child = pa.id === pb.id ? pa.w : crossover(pa.w, pb.w, rng);
                    population.push(newMember(mutate(child, rng, 0.2, termOpts), pa.id === pb.id ? [pa.id] : [pa.id, pb.id]));
                }
            }
        } finally {
            if (restore) restore();
            unsuppressJoytone();
            _evolving = false;
            // Clear so the caller's confirmation run() (shared _playSeries)
            // isn't itself cut short by a still-set endEarly request.
            _endEarlyRequested = false;
        }
        return champion;
    }

    // ----------------------------------------------------------------
    // hillClimb(opts) — champion-anchored (1+λ)-style climber. THE fix for
    // evolve()'s co-evolution weakness: evolve() scores population members by
    // beating EACH OTHER (their near-identical mutated siblings) over just 1
    // game per pairing, so the ranking is noise-dominated and there is almost
    // no selection pressure toward "better than the reigning champion" — a
    // random walk that drifts DOWNHILL from a well-tuned seed (see
    // docs/bot-roadmap.md). hillClimb() instead:
    //   1. holds the champion FIXED as the reference opponent;
    //   2. spawns opts.lambda mutant challengers of it;
    //   3. plays EACH challenger head-to-head against the champion for
    //      opts.gamesPerChallenge games (alternating sides, via _playSeries —
    //      the exact same A/B machinery run() uses), so every game measures
    //      the thing we actually care about;
    //   4. promotes the best challenger to champion ONLY if it beats the
    //      champion by a real MARGIN (opts.promoteWinRate over the decided
    //      games, with a floor on how many were decisive) — luck alone can't
    //      promote a fragile bot;
    //   5. on a barren round (nothing clears the bar) widens the mutation step
    //      (adaptive sigma, capped) so the search can escape a plateau; resets
    //      it on any promotion.
    // The champion is MONOTONIC by construction — only ever replaced by
    // something that demonstrably beat it over gamesPerChallenge games — so it
    // cannot drift downhill. gamesPerChallenge (default 30) is the dial that
    // drowns out the per-game tile/scroll-draw noise that dominates a single
    // game between near-identical bots.
    //
    // Phase-1 scope: the "gauntlet" is just the current champion. A later
    // phase adds a hall-of-fame gauntlet (retired champions) to guard against
    // non-transitive "rock-paper-scissors" exploits — a challenger that hard-
    // counters THIS champion but is worse against the field. Parallelism lives
    // in the headless runner (fan λ challenger-trials across pages), not here:
    // one browser page is single-threaded, so this in-page core stays
    // sequential and also runs inside the 🧬 Bot Training panel unchanged.
    //
    //   opts.champion            starting weights (default {...WEIGHTS})
    //   opts.rounds        (30)  climbing rounds
    //   opts.lambda        (6)   challengers spawned per round
    //   opts.gamesPerChallenge (30) games each challenger plays vs the champion
    //   opts.promoteWinRate (0.58) win rate over DECIDED games needed to promote
    //   opts.minDecided    (ceil(gamesPerChallenge/2)) min decisive games for a
    //                            promotion to count (guards a 1-0 + all-draws fluke)
    //   opts.sigma0/sigmaGrowth/sigmaCap (0.2 / 1.5 / 0.8) adaptive mutation step
    //   opts.seed (1), opts.visual (false), opts.speed
    //   opts.onRound?(roundNumber, totalRounds, info) progress callback
    //   opts.onChallenger?(challengerNumber, lambda, roundNumber, totalRounds, originalChallengerNumber)
    //                            fired once per challenger, before its trial
    //                            series starts (distinguishes "which challenger"
    //                            from onGame's per-series game count, which
    //                            resets to 1/N for every challenger)
    //   opts.onGame? forwarded to every trial series (per-game progress)
    //   opts.seedChallengers? [weights] - fill the first round-1 challenger
    //                            slots (e.g. an Evolve explore phase's champion)
    //   opts.termMutations?      challengers may also gain / lose / change
    //                            formula terms (js/bot-terms.js), not just
    //                            nudge numbers (Formula Lab, hermit)
    //   opts.puzzleCheck? async (weights) => score | null (Phase 4b, e.g.
    //                            Replay.puzzleScore): a challenger that wins
    //                            enough games is promoted only if its puzzle
    //                            score is not worse than the champion's by more
    //                            than opts.puzzleTolerance (0.05). Only run for
    //                            would-be promotions, so it costs little.
    // Returns { champion, promotions, rounds:[…], gamesPlayed }. stop() hard-
    // aborts; endEarly() finishes the current round then returns the champion
    // reached so far (always usable — it only advances on a real promotion).
    // ----------------------------------------------------------------
    let _climbing = false;
    function isClimbing() { return _climbing; }

    async function hillClimb(opts = {}) {
        if (_running || _spectating || _evolving || _climbing) throw new Error('BotArena already running');
        if (!window.BotSim || !window.BotState || !window.BotSystem) {
            throw new Error('BotArena needs BotState/BotSim/BotSystem loaded');
        }
        const rounds = Math.max(1, opts.rounds ?? 30);
        const lambda = Math.max(1, opts.lambda ?? 6);
        const gamesPerChallenge = Math.max(2, opts.gamesPerChallenge ?? 30);
        const promoteWinRate = opts.promoteWinRate ?? 0.58;
        const minDecided = Math.max(2, opts.minDecided ?? Math.ceil(gamesPerChallenge / 2));
        const sigma0 = opts.sigma0 ?? 0.2;
        const sigmaGrowth = opts.sigmaGrowth ?? 1.5;
        const sigmaCap = opts.sigmaCap ?? 0.8;
        const seed = opts.seed ?? 1;
        const visual = !!opts.visual;
        const rng = mulberry32(seed);

        _climbing = true;
        _stopRequested = false;
        _endEarlyRequested = false;
        const restore = visual ? null : muteEnvironment();
        const unsuppressJoytone = suppressJoytone();
        window.BotSystem.speedScale = opts.speed ?? (visual ? 1 : 0.1);

        let champion = opts.champion ? { ...opts.champion } : { ...window.BotSystem.WEIGHTS };
        let championPuzzle; // puzzle score of the current champion (opts.puzzleCheck), computed on first use
        let sigma = sigma0;
        let promotions = 0, gamesPlayed = 0;
        const roundLog = [];

        try {
            for (let round = 0; round < rounds && !_stopRequested && !_endEarlyRequested; round++) {
                // Spawn λ mutant challengers of the (fixed) champion.
                const challengers = [];
                for (let c = 0; c < lambda; c++) challengers.push(mutate(champion, rng, sigma, { structural: !!opts.termMutations }));
                // opts.seedChallengers: bots found elsewhere (e.g. an Evolve
                // "explore" phase) take the first round-1 slots instead of
                // mutants. Same rules: they must beat the champion to count.
                if (round === 0 && Array.isArray(opts.seedChallengers)) {
                    opts.seedChallengers.slice(0, lambda).forEach((w, i) => { if (w) challengers[i] = { ...w }; });
                }

                // COMMON RANDOM NUMBERS: every challenger in this round faces
                // the champion on the SAME seed sequence (no per-challenger
                // seed term, unlike before) — combined with _playSeries'
                // mirror-pairing, ranking differences between challengers come
                // from their weights, not from who drew the luckier decks.
                const trialSeed = (seed * 1000003 + round * 1009) >>> 0;

                // SUCCESSIVE HALVING (opts.halving !== false): every
                // challenger gets a short paired audition on the same decks,
                // only the leaders advance to longer blocks, and the single
                // finalist finishes out the full gamesPerChallenge budget.
                // The promotion bar below is judged on the finalist's FULL
                // cumulative record — rigor unchanged, only the games wasted
                // on obvious losers are saved (λ=6, G=30: 180 → 100 games).
                const halving = opts.halving !== false && lambda > 1;
                let stages;
                if (halving) {
                    let b = Math.ceil(gamesPerChallenge / 3);
                    if (b % 2) b++; // even blocks keep mirror pairs whole
                    const b1 = Math.min(b, gamesPerChallenge);
                    const b2 = Math.min(b, gamesPerChallenge - b1);
                    const b3 = gamesPerChallenge - b1 - b2;
                    stages = [{ games: b1, keep: Math.ceil(lambda / 2) },
                              { games: b2, keep: 1 },
                              { games: b3, keep: 1 }].filter(s => s.games > 0);
                } else {
                    stages = [{ games: gamesPerChallenge, keep: 1 }];
                }

                // Cumulative per-challenger records across stages; rank by net
                // wins, then the sideFitness margin — same ordering as before.
                let survivors = challengers.map((w, c) => ({
                    w, c, played: 0, aWins: 0, bWins: 0, draws: 0, aFitness: 0, bFitness: 0 }));
                // endEarly() must cut the round short at a challenger boundary,
                // not only between whole rounds — a full round is ~100 games
                // (successive halving), so without this check "End Early → Test
                // Now" appears dead for minutes while the current round grinds
                // on. Breaking here leaves partial challenger records, which is
                // safe: the promotion gate below needs minDecided decisive
                // games, so an interrupted round simply may not promote and the
                // best champion SO FAR is what gets confirmed — exactly the
                // button's promise. NOT added to _playSeries itself: that is
                // shared with the confirmation run(), which must always play in
                // full even after endEarly.
                for (let s = 0; s < stages.length && !_stopRequested && !_endEarlyRequested; s++) {
                    const st = stages[s];
                    for (let k = 0; k < survivors.length && !_stopRequested && !_endEarlyRequested; k++) {
                        const cand = survivors[k];
                        // Fired per challenger before its series — lets the UI
                        // say which challenger (of the current stage's
                        // survivors) is playing; onGame's own count resets per
                        // series so it can't distinguish them alone.
                        if (typeof opts.onChallenger === 'function') {
                            try { opts.onChallenger(k + 1, survivors.length, round + 1, rounds, cand.c + 1); } catch (e) { /* UI callback errors never abort a run */ }
                        }
                        // gameIndexOffset continues this challenger's seed
                        // sequence — later stages play NEW decks (identical
                        // across survivors), never replays of stage 1.
                        const r = await _playSeries(cand.w, champion, st.games, trialSeed,
                            { ...opts, visual, gameIndexOffset: cand.played, markChallenger: true });
                        cand.played += st.games;
                        cand.aWins += r.aWins; cand.bWins += r.bWins; cand.draws += r.draws;
                        cand.aFitness += r.aFitness; cand.bFitness += r.bFitness;
                        gamesPlayed += r.aWins + r.bWins + r.draws;
                        log(`round ${round + 1} stage ${s + 1}/${stages.length} challenger #${cand.c + 1}` +
                            ` (trial seed ${trialSeed}): ${cand.aWins}-${cand.bWins}` +
                            `${cand.draws ? ' (' + cand.draws + 'd)' : ''} over ${cand.played} games`);
                    }
                    survivors.sort((x, y) => ((y.aWins - y.bWins) - (x.aWins - x.bWins)) ||
                        ((y.aFitness - y.bFitness) - (x.aFitness - x.bFitness)));
                    if (survivors.length > st.keep) {
                        log(`round ${round + 1} stage ${s + 1}: cutting ${survivors.length} → ${st.keep}` +
                            ` (dropped: ${survivors.slice(st.keep).map(x => '#' + (x.c + 1) + ' at ' + x.aWins + '-' + x.bWins).join(', ')})`);
                        survivors = survivors.slice(0, st.keep);
                    }
                }
                const finalist = survivors[0] || null;
                const decidedF = finalist ? finalist.aWins + finalist.bWins : 0;
                const best = finalist ? {
                    w: finalist.w, c: finalist.c, decided: decidedF,
                    winRate: decidedF > 0 ? finalist.aWins / decidedF : 0,
                    netWins: finalist.aWins - finalist.bWins,
                    fitMargin: finalist.aFitness - finalist.bFitness,
                    aWins: finalist.aWins, bWins: finalist.bWins, draws: finalist.draws,
                } : null;

                // Promote ONLY on a real margin over enough decisive games.
                let promoted = !!best && best.decided >= minDecided && best.winRate >= promoteWinRate;
                let puzzleNote = null;
                if (promoted && typeof opts.puzzleCheck === 'function') {
                    try {
                        if (championPuzzle === undefined) championPuzzle = await opts.puzzleCheck(champion);
                        const challengerPuzzle = await opts.puzzleCheck(best.w);
                        if (championPuzzle != null && challengerPuzzle != null) {
                            puzzleNote = { champion: championPuzzle, challenger: challengerPuzzle };
                            if (challengerPuzzle < championPuzzle - (opts.puzzleTolerance ?? 0.05)) {
                                promoted = false;
                                puzzleNote.blocked = true;
                                log(`round ${round + 1}: challenger won ${best.aWins}-${best.bWins} but failed the puzzle check ` +
                                    `(${challengerPuzzle} vs champion ${championPuzzle}) - champion holds`);
                            } else if (promoted) {
                                championPuzzle = challengerPuzzle; // the new champion's score
                            }
                        }
                    } catch (e) {
                        log('puzzle check failed (ignored):', e?.message || e);
                    }
                }
                if (promoted) {
                    champion = best.w;
                    promotions++;
                    sigma = sigma0; // found a step up — reset the search radius
                    try { localStorage.setItem('godaigo_bot_weights', JSON.stringify(champion)); } catch (e) {}
                    log(`round ${round + 1}: PROMOTED (${best.aWins}-${best.bWins}, ${(best.winRate * 100).toFixed(0)}% ` +
                        `of ${best.decided} decided) - new champion. Total promotions: ${promotions}`);
                    log('champion weights (paste into bot.js DEFAULT_WEIGHTS to make permanent):\n' + JSON.stringify(champion));
                } else {
                    const prevSigma = sigma;
                    sigma = Math.min(sigmaCap, sigma * sigmaGrowth); // barren round — widen the search
                    if (!puzzleNote?.blocked) log(`round ${round + 1}: no challenger cleared ${(promoteWinRate * 100).toFixed(0)}% ` +
                        `(best ${best ? best.aWins + '-' + best.bWins : 'n/a'}) - champion holds; sigma ${prevSigma.toFixed(2)} → ${sigma.toFixed(2)}`);
                }

                const info = { round: round + 1, promoted, puzzle: puzzleNote,
                    bestWinRate: best ? +best.winRate.toFixed(3) : 0,
                    bestNetWins: best ? best.netWins : 0,
                    bestDecided: best ? best.decided : 0,
                    bestChallenger: best ? best.c + 1 : null, // 1-based, matches onChallenger's numbering
                    sigma: +sigma.toFixed(3), promotions, gamesPlayed };
                roundLog.push(info);
                if (typeof opts.onRound === 'function') {
                    try { opts.onRound(round + 1, rounds, info); } catch (e) { /* UI callback errors never abort a run */ }
                }
                await sleep(0);
            }
        } finally {
            if (restore) restore();
            unsuppressJoytone();
            _climbing = false;
            // Clear so the caller's confirmation run() (shared _playSeries)
            // isn't itself cut short by a still-set endEarly request.
            _endEarlyRequested = false;
        }
        log(`hillClimb complete: ${promotions} promotion(s) over ${roundLog.length} round(s), ${gamesPlayed} games.`);
        return { champion, promotions, rounds: roundLog, gamesPlayed };
    }

    // ----------------------------------------------------------------
    // Spectator mode: watch nPlayers (2–5) bots play a full LOCAL game with
    // all the normal visuals (win screen included), then auto-download the
    // action log. Unlike run(), nothing visual is muted and pacing is
    // watchable. All players share whatever weights are currently loaded
    // (an evolved localStorage table, or the Bot Brain toggle) — playMatch()
    // is given an array of `undefined` entries so it never overwrites that.
    // Start from the cheat panel (AP label 5×) or the console:
    //   BotArena.spectate(3)            — 3 bots, normal pacing
    //   BotArena.spectate(4, {speed:2}) — 4 bots, double-time delays
    //   BotArena.stop()                 — end the match early (also cancels
    //                                      an in-progress run()/evolve(),
    //                                      which check the same flag)
    // ----------------------------------------------------------------
    let _spectating = false;
    function isSpectating() { return _spectating; }
    function isRunning() { return _running || _spectating || _evolving || _climbing; }

    async function spectate(nPlayers = 2, opts = {}) {
        if (_running || _spectating || _evolving || _climbing) throw new Error('BotArena already running');
        nPlayers = Math.max(2, Math.min(5, nPlayers | 0)); // 5 player colors exist
        if (!window.BotSim || !window.BotState || !window.BotSystem) {
            throw new Error('BotArena needs BotState/BotSim/BotSystem loaded');
        }
        _spectating = true;
        _stopRequested = false;
        _endEarlyRequested = false; // a stale endEarly from a prior training run must not abort spectate's first game

        // Keep sounds, music, animations, and the WIN SCREEN — only mute
        // gamification so bot games can't farm XP onto a logged-in profile.
        const savedGami = window.gami;
        const savedPrompt = window.showEndTurnPrompt;
        const savedSpeed = window.BotSystem.speedScale;
        const rw = window.spellSystem?.responseWindow;
        const savedIsBotPlayer = rw?.isBotPlayer;
        window.gami = null;
        window.showEndTurnPrompt = () => {};
        window.BotSystem.speedScale = opts.speed ?? 1;
        // Same fix as run()'s muteEnvironment(): isBotPlayer() only knows about
        // multiplayer's allPlayersData, so in this local all-bot match it thinks
        // every seat is human and lets real response windows open — 15s of dead
        // air per eligible cast with no one to click Pass.
        if (rw) rw.isBotPlayer = () => true;

        const roster = Array.from({ length: nPlayers }, (_, i) =>
            ({ index: i, username: `Bot ${i + 1}`, isBot: true }));
        window.ActionLog?.clear?.();
        window.ActionLog?.setRoster?.(roster);

        let result;
        try {
            if (typeof updateStatus === 'function') {
                updateStatus(`Bot match: ${nPlayers} bots playing. Open the cheat panel to stop or download the log.`);
            }
            result = await playMatch(Array(nPlayers).fill(undefined), { ...opts, visual: true, turnCap: opts.turnCap ?? 300 });
        } finally {
            window.gami = savedGami;
            window.showEndTurnPrompt = savedPrompt;
            window.BotSystem.speedScale = savedSpeed;
            if (rw && savedIsBotPlayer) rw.isBotPlayer = savedIsBotPlayer;
            _spectating = false;
        }

        const label = result.winner !== null ? `🏆 Bot ${result.winner + 1} wins in ${result.turns} turns!`
                    : _stopRequested ? `⏹ Bot match stopped after ${result.turns} turns`
                    : `🤝 Draw - turn cap (${result.turns}) reached`;
        log(label);
        if (typeof updateStatus === 'function') updateStatus(`${label} Downloading action log…`);
        try { window.ActionLog?.download?.(); } catch (e) { log('log download failed:', e); }
        return result;
    }

    // ----------------------------------------------------------------
    // Multi-size confirmation gate (roadmap Stage 3a). run() only ever
    // compared a champion to a baseline in a 2-player duel — so a champion
    // evolved in 4-/5-player arenas (bigger map, more resources, different
    // tactics) was kept-or-discarded purely on 2-player play, biasing the
    // whole pipeline (and the community champion table it feeds) toward
    // 2-player-friendly weights. confirmAcrossSizes() instead pits the
    // champion against a FIELD of baseline bots at every size in opts.sizes
    // (default [2,3,4,5]): each size plays opts.gamesPerSize (default 4)
    // games, rotating which seat the champion occupies for positional
    // fairness (the other seats are all baseline). "Improved" = the
    // champion's total seat-fitness across every size beats the mean
    // baseline seat-fitness — i.e. it must be a better GENERALIST, not just
    // a better duelist. Returns per-size records for transparency plus
    // aggregate champWins/baseWins/draws (with aWins/bWins aliases so callers
    // shaped for run()'s result still read). stop() aborts it (shared
    // _stopRequested); opts.onGame(gameNo, totalGames, result) reports
    // progress. Muting/pacing mirror run() exactly.
    // ----------------------------------------------------------------
    async function confirmAcrossSizes(champion, baseline, opts = {}) {
        if (_running || _spectating || _evolving || _climbing) throw new Error('BotArena already running');
        if (!window.BotSim || !window.BotState || !window.BotSystem) {
            throw new Error('BotArena needs BotState/BotSim/BotSystem loaded');
        }
        const sizes = (opts.sizes && opts.sizes.length) ? opts.sizes : [2, 3, 4, 5];
        const gamesPerSize = Math.max(1, opts.gamesPerSize ?? 4);
        const visual = !!opts.visual;
        const baseSeed = opts.seed ?? (Date.now() % 100000);
        const totalGames = sizes.length * gamesPerSize;

        _running = true;
        _stopRequested = false;
        const restore = visual ? null : muteEnvironment();
        const unsuppressJoytone = suppressJoytone();
        window.BotSystem.speedScale = opts.speed ?? (visual ? 1 : 0.1);

        const perSize = [];
        let champFitness = 0, baseFitness = 0, champWins = 0, baseWins = 0, draws = 0, gameNo = 0;
        try {
            for (const n of sizes) {
                if (_stopRequested) break;
                let sChampF = 0, sBaseF = 0, sChampW = 0, sBaseW = 0, sDraws = 0;
                for (let g = 0; g < gamesPerSize && !_stopRequested; g++) {
                    const champSeat = g % n; // rotate the champion's seat each game (positional fairness)
                    const weightsPerPlayer = new Array(n).fill(baseline);
                    weightsPerPlayer[champSeat] = champion;
                    const seed = (baseSeed * 100003 + n * 1009 + g) >>> 0;
                    setMarkedSeat(champSeat); // X on the bot being tested
                    const r = await playMatch(weightsPerPlayer, { ...opts, seed, visual });
                    setMarkedSeat(null);
                    const cf = seatFitness(r, champSeat, opts);
                    // Mean baseline-seat fitness this game (the n-1 non-champion
                    // seats) — the champion must beat the AVERAGE baseline, so
                    // one bot of each type is compared apples-to-apples.
                    let bf = 0;
                    for (let s = 0; s < n; s++) if (s !== champSeat) bf += seatFitness(r, s, opts);
                    bf /= (n - 1);
                    sChampF += cf; sBaseF += bf;
                    champFitness += cf; baseFitness += bf;
                    if (r.winner === null) { sDraws++; draws++; }
                    else if (r.winner === champSeat) { sChampW++; champWins++; }
                    else { sBaseW++; baseWins++; }
                    gameNo++;
                    if (typeof opts.onGame === 'function') {
                        try { opts.onGame(gameNo, totalGames, r); } catch (e) { /* UI callback errors never abort */ }
                    }
                    log(`confirm ${n}p game ${g + 1}/${gamesPerSize}: ${r.winner === null ? 'draw' : (r.winner === champSeat ? 'champion' : 'baseline') + ' wins'} in ${r.turns} turns`);
                    await sleep(0);
                }
                perSize.push({ n, champWins: sChampW, baseWins: sBaseW, draws: sDraws, champFitness: +sChampF.toFixed(2), baseFitness: +sBaseF.toFixed(2) });
            }
        } finally {
            if (restore) restore();
            unsuppressJoytone();
            _running = false;
        }
        const improved = champFitness > baseFitness;
        const record = perSize.map(p => `${p.n}p ${p.champWins}-${p.baseWins}${p.draws ? 'd' + p.draws : ''}`).join(', ');
        log(`confirmAcrossSizes: champion ${improved ? 'BEAT' : 'did not beat'} baseline - champF ${champFitness.toFixed(2)} vs baseF ${baseFitness.toFixed(2)} (${record})`);
        return { improved, record, perSize, champFitness, baseFitness, champWins, baseWins, draws, aWins: champWins, bWins: baseWins };
    }

    // Return a gaussian-perturbed COPY of a weight table (a fresh random draw
    // each call, so successive calls differ). Reuses mutate() so the same
    // brain-shape keys (searchDepth/searchBreadth/searchHybrid) are left alone.
    // Used by the "Noisy anchor" training toggle: train against a displaced
    // opponent so the result is robust to a DISTRIBUTION near the anchor, not
    // overfit to one exact table — then confirm against the TRUE anchor.
    // sigma default 0.15 (gentler than mutate's 0.2 breeding default).
    function perturbWeights(table, sigma = 0.15) {
        const rng = mulberry32(((Date.now() >>> 0) ^ Math.floor(Math.random() * 0xffffffff)) >>> 0);
        return mutate({ ...table }, rng, sigma);
    }

    window.BotArena = {
        run, evolve, playGame, playMatch, spectate, stop,
        hillClimb, // champion-anchored monotonic climber (the reliable trainer)
        confirmAcrossSizes, // N-player champion-vs-field confirmation gate
        endEarly, // soft-stop: cuts evolve()'s / hillClimb()'s loop short but keeps its result usable
        perturbWeights, // gaussian-perturbed copy of a weight table (Noisy anchor toggle)
        isSpectating, isEvolving, isClimbing, isRunning, markedSeat,
        stopRequested: () => _stopRequested, // was stop() called for the run in progress (or the one that just ended)?
        endEarlyRequested,
        applyWeights: setWeights, // apply an {…} weight table to the LIVE WEIGHTS object in place
        seatFitness, sideFitness, // exposed for direct scoring verification, same as bot.js's evaluator
    };
    log('Loaded - window.BotArena ready (run / evolve / spectate)');
})();
