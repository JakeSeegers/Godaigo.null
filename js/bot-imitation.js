// js/bot-imitation.js — window.BotImitation — HERMIT-ONLY "learn from my
// play" imitation learning.
//
// CONCEPT (docs/void-knight.md's deferred "Practice vs my bot" idea, built
// against real online games instead of a new local mode — see
// planning/current.md for the session that scoped this down): while a real
// online game with a bot in it is running, watch the HUMAN's own decisions.
// At each of the two decision types below, compare what the bot would have
// picked to what the human actually did; when they disagree, nudge a small
// step toward the human's choice, perceptron-style.
//
// Idle training (2026-10-10): js/idle-training.js turns these deltas into an
// 'imitation' challenger (champion + deltas) for the shared pooled climb; it
// becomes the champion only by winning there like any other challenger.
//
// DELTA, not a snapshot: what accumulates here is a small additive DELTA per
// weight key (localStorage, `godaigo_bot_weight_deltas`), never a copy of the
// base weights themselves. The base (shared community champion + each bot's
// elemental lean — js/bot-elements.js) stays exactly what it would normally
// be and keeps tracking live community training; this file only ever adds
// `applyDeltas(base)` on top of it at the moment a bot's weights are stamped
// (lobby.js's hostStartGame(), gated on the HOST being the hermit with this
// toggle on). That's also how it reaches an actual opponent: there's no
// separate "my bot" seat — every bot already in the room gets the delta
// layered onto its own normal base whenever the toggle is on, and plays with
// the normal, un-nudged base the moment it's off (or someone else hosts).
//
// "What the bot would have picked" is deliberately PLAN-AWARE (searchPick(),
// several actions of lookahead within the turn), not a single frozen
// snapshot — a raw one-step comparison flagged "disagreement" on nearly
// every turn a human kept playing toward a multi-step goal the snapshot
// can't see, which would just teach a systematic bias ("never value ending
// the turn") rather than a real instinct mismatch. The feature-level trace
// used for the actual weight nudge still comes from the immediate scoring
// of that position (scoreAction()'s contrib()) — only the "was the human's
// choice actually the best type of move" verdict is plan-aware.
//
// SCOPE - decision types compared:
//   - endTurn (should I have stopped here, or kept playing?)
//   - discardScroll (which scroll was actually worth keeping?)
//   - cast (Phase 5, 2026-09-26): which ready scroll you cast vs the bot's
//     best cast (ActionLog 'cast_execute')
//   - move (Phase 5): the first step toward where you moved vs the bot's
//     best step (ActionLog 'move'), at a lower learning rate
//   Every delta is capped at half its weight's default (deltaCap).
// Original v1 notes (two types only) follow.
// These are the two branches of bot.js's scoreAction() that were given an
// optional trace channel (see scoreAction()'s contrib() helper) — a cast/
// move/placeStone comparison would need the same treatment, deliberately
// left for a later increment so this first slice touches the least amount
// of the heavily-tuned scoring code. A move/cast/placeStone decision still
// COUNTS toward "did the human agree with the bot's overall top pick"
// (used to detect "the bot wanted to end the turn but the human kept
// playing" and vice versa), it just never contributes a feature-level nudge
// of its own.
//
// GATING: window.isHermit() (lobby.js) — same developer-only convention as
// the rest of the hermit tooling — AND an explicit opt-in toggle (off by
// default even for that account), surfaced in the hermit menu
// (game-ui.js's initHermitMenu). Never runs during BotArena self-play
// (there's no human to learn from), and only watches the LOCAL player's own
// turns in a REAL multiplayer game that actually contains a bot.
//
// TESTABILITY CAVEAT (same honesty standard as the response-scroll broadcast
// note in bot-roadmap.md): this can only be exercised against a REAL online
// game with a real bot seat, which this sandbox cannot reach (no Supabase
// egress). The scoreAction()/rankActions() instrumentation it depends on
// WAS verified here (headless, BotArena self-play, same-seed regression —
// see the branch's commit) to change nothing about existing bot behavior.
// The ActionLog-comparison/nudge logic itself needs a real online smoke
// test (a hermit account, a real room with "🤖 Add Bot", toggle on, play a
// few turns, confirm the stats badge counts sane numbers) before trusting it.
//
// Load order: after bot.js, bot-state.js, action-log.js, lobby.js (needs
// window.BotSystem/BotState, window.ActionLog, window.isHermit/
// isBotUsername) — see index.html.
(function () {
    'use strict';

    const ENABLED_KEY = 'godaigo_imitation_learning_enabled';
    const DELTAS_KEY = 'godaigo_bot_weight_deltas';
    const LEARNING_RATE = 0.05;
    // Moves happen many times a turn, so each one nudges less (Phase 5).
    const MOVE_LEARNING_RATE = 0.02;
    // A learned delta never moves a weight by more than half its default
    // (at least 0.05): enough to shift a habit, never enough to break the bot.
    function deltaCap(key) {
        const dv = window.BotSystem?.DEFAULT_WEIGHTS?.[key];
        return Math.max(0.05, 0.5 * Math.abs(typeof dv === 'number' ? dv : 0));
    }
    const clampDelta = (key, v) => Math.max(-deltaCap(key), Math.min(deltaCap(key), v));
    const POLL_MS = 300;

    function isHermitUser() {
        return typeof window.isHermit === 'function' && window.isHermit();
    }

    let enabled = false;
    try { enabled = localStorage.getItem(ENABLED_KEY) === '1'; } catch (e) { /* ignore */ }

    function setEnabled(v) {
        enabled = !!v && isHermitUser(); // never persists ON for a non-hermit account
        try { localStorage.setItem(ENABLED_KEY, enabled ? '1' : '0'); } catch (e) { /* ignore */ }
        console.log(`🧠 [Imitation] ${enabled ? 'ON - watching your play' : 'OFF'}`);
        renderBadge();
    }
    function isEnabled() { return enabled && isHermitUser(); }

    // ── the learned delta — a sparse {weightKey: additiveShift} map, NOT a
    // full weight table. Starts empty; grows one small nudge at a time. ──
    function loadDeltas() {
        try {
            const raw = localStorage.getItem(DELTAS_KEY);
            if (raw) return JSON.parse(raw);
        } catch (e) { /* ignore */ }
        return {};
    }
    function saveDeltas(d) {
        try { localStorage.setItem(DELTAS_KEY, JSON.stringify(d)); } catch (e) { /* ignore */ }
    }
    // Only accumulate a delta for a key that's actually a real, numeric
    // weight — defends against a future trace shape carrying an unexpected
    // key and quietly polluting the delta table with garbage.
    function isRealWeightKey(key) {
        const dw = window.BotSystem?.DEFAULT_WEIGHTS;
        return !!dw && typeof dw[key] === 'number';
    }
    // The actual point of this file: base (whatever a bot would normally
    // play with — the live community champion, a specific bot's elemental
    // lean, anything) PLUS the learned delta on top. Called from
    // lobby.js's hostStartGame() when the host is the hermit with the
    // toggle on; the base itself is never modified or stored here.
    function applyDeltas(base) {
        const d = loadDeltas();
        const out = { ...(base || {}) };
        for (const key of Object.keys(d)) {
            if (typeof out[key] !== 'number') continue; // base doesn't have this key — skip rather than invent it
            out[key] = +(out[key] + d[key]).toFixed(4);
        }
        return out;
    }

    // ── session tally, reset each new game — drives the tiny badge ──
    let stats = { watched: 0, agreed: 0, nudged: 0 };
    function resetStats() { stats = { watched: 0, agreed: 0, nudged: 0 }; renderBadge(); }

    // ── eligibility: real online game, a bot is actually present, it's my turn ──
    // Returns {ok, reason} rather than a bare boolean so debugEligibility()
    // (and the throttled console log below) can say WHICH check failed —
    // needed because this can't be exercised from this sandbox at all (no
    // Supabase egress — see file header), so a real online test is the only
    // way to find a wrong assumption here, and a bare true/false gives no
    // way to tell one failing gate from another.
    function checkEligibility() {
        if (!isEnabled()) return { ok: false, reason: 'not enabled (toggle is off, or not a hermit account)' };
        if (typeof window.BotArena?.isRunning === 'function' && window.BotArena.isRunning())
            return { ok: false, reason: 'BotArena self-play is running' };
        if (typeof isMultiplayer === 'undefined' || !isMultiplayer)
            return { ok: false, reason: `isMultiplayer is ${typeof isMultiplayer === 'undefined' ? 'undefined' : isMultiplayer}` };
        if (typeof myPlayerIndex === 'undefined' || myPlayerIndex == null)
            return { ok: false, reason: `myPlayerIndex is ${typeof myPlayerIndex === 'undefined' ? 'undefined' : myPlayerIndex}` };
        if (typeof activePlayerIndex === 'undefined' || activePlayerIndex !== myPlayerIndex)
            return { ok: false, reason: `not my turn (activePlayerIndex=${typeof activePlayerIndex === 'undefined' ? 'undefined' : activePlayerIndex}, myPlayerIndex=${myPlayerIndex})` };
        if (typeof allPlayersData === 'undefined' || !Array.isArray(allPlayersData))
            return { ok: false, reason: `allPlayersData is ${typeof allPlayersData === 'undefined' ? 'undefined' : typeof allPlayersData}` };
        const hasBot = allPlayersData.some(p => window.isBotUsername && window.isBotUsername(p.username));
        if (!hasBot) return { ok: false, reason: `no bot username among allPlayersData (${allPlayersData.map(p => p.username).join(', ')})` };
        return { ok: true, reason: 'eligible' };
    }
    function eligibleNow() { return checkEligibility().ok; }

    // Throttled diagnostic — logs at most once every 3s, and only when the
    // reason CHANGES, so it's informative without flooding the console over
    // a whole game.
    let lastLoggedReason = null, lastLogAt = 0;
    function logEligibilityChange() {
        const { reason } = checkEligibility();
        const now = Date.now();
        if (reason !== lastLoggedReason && (now - lastLogAt) > 500) {
            console.log(`🧠 [Imitation] eligibility: ${reason}`);
            lastLoggedReason = reason;
            lastLogAt = now;
        }
    }

    // ── cached "what would the bot do right now", refreshed on a short poll
    // while it's my turn — by the time the human's action lands in
    // ActionLog we still have the position it was decided from. Same
    // poll-while-my-turn idiom bot-driver.js's watcher already uses.
    let pending = null; // { bestType, endTurnTrace, topDiscardScroll, discardTraceByScroll }
    let stateVersion = 0, pendingVersion = -1, nextRankAt = 0;
    try { window.ActionLog?.onRecord?.(() => { stateVersion++; }); } catch (e) { /* no log: rank per poll as before */ }
    let lastSeenGameId = undefined;
    function refreshPending() {
        // A fresh game means a fresh set of decisions to reason about — a
        // stale `pending`/tally from the previous game's final position must
        // never bleed into this game's first comparison. No dedicated
        // "game started" event exists in this codebase, so detect it the
        // same way the rest of this poll loop observes state: by watching
        // the one global that actually changes on join (multiplayer-state.js).
        const gid = (typeof currentGameId !== 'undefined') ? currentGameId : null;
        if (gid !== lastSeenGameId) { lastSeenGameId = gid; pending = null; resetStats(); }
        logEligibilityChange();
        if (!eligibleNow()) { pending = null; return; }
        const bs = window.BotSystem;
        if (!bs || typeof bs.rank !== 'function') { pending = null; return; }
        // A full ranking can take a second or more late in a game, and this
        // used to rerun every 300 ms for the whole turn: the hermit's own
        // turn froze (owner 2026-10-08: five minutes to move a pawn). Now it
        // ranks once per board change (any ActionLog entry), and after a slow
        // ranking it waits 4x that long before the next one.
        if (pending && pendingVersion === stateVersion) return;
        if (Date.now() < nextRankAt) return;
        const t0 = performance.now();
        try {
            const ranked = bs.rank(null, { withTrace: true });
            const took = performance.now() - t0;
            window.LagRecorder?.learnThink?.(took);
            pendingVersion = stateVersion;
            nextRankAt = took > 150 ? Date.now() + took * 4 : 0;
            if (!ranked || !ranked.length) {
                console.log('🧠 [Imitation] eligible but rank() returned no candidates this tick');
                pending = null; return;
            }
            const endTurnEntry = ranked.find(r => r.action.type === 'endTurn');
            const discardEntries = ranked.filter(r => r.action.type === 'discardScroll');

            // "Should I have ended my turn here?" needs a PLAN-AWARE opinion,
            // not a single frozen snapshot — a human rarely decides that
            // turn-by-turn in isolation, they're usually mid-plan (see the
            // 2026-09 session note this file was built in: comparing against
            // the raw one-step ranking flagged "disagreement" on almost
            // every turn a player kept playing toward a multi-step goal,
            // which just teaches a systematic bias, not a real instinct
            // mismatch). searchPick() already exists for exactly this — it
            // looks several actions ahead within the turn (minimum 1 ply,
            // deeper if the live Bot Brain search depth is turned up) instead
            // of judging one position cold. Falls back to the plain greedy
            // top pick if search is unavailable for any reason — better a
            // cruder signal than none.
            let bestType = ranked[0].action.type;
            if (typeof bs.searchPick === 'function') {
                try {
                    const searched = bs.searchPick();
                    if (searched && searched.action) bestType = searched.action.type;
                } catch (e) {
                    console.warn('⚠️ [Imitation] searchPick() failed, falling back to greedy top pick:', e);
                }
            }

            // Casts: best-scored candidate per scroll (a scroll with choices
            // has several). Moves: every adjacent step with its trace.
            const castEntries = ranked.filter(r => r.action.type === 'cast');
            const castTraceByScroll = {};
            for (const r of castEntries) if (!castTraceByScroll[r.action.scroll]) castTraceByScroll[r.action.scroll] = r.trace;
            const moveEntries = ranked.filter(r => r.action.type === 'move')
                .map(r => ({ x: r.action.x, y: r.action.y, trace: r.trace }));

            pending = {
                bestType,
                endTurnTrace: endTurnEntry ? endTurnEntry.trace : null,
                topDiscardScroll: discardEntries.length ? discardEntries[0].action.scroll : null,
                discardTraceByScroll: Object.fromEntries(discardEntries.map(r => [r.action.scroll, r.trace])),
                topCastScroll: castEntries.length ? castEntries[0].action.scroll : null,
                castTraceByScroll,
                moveEntries, // ranked best first
                from: (() => { try { const p = playerPositions[activePlayerIndex]; return p ? { x: p.x, y: p.y } : null; } catch (e) { return null; } })(),
            };
        } catch (e) {
            console.warn('⚠️ [Imitation] refreshPending failed (non-fatal):', e);
            pending = null;
        }
    }
    let pollTimer = null;
    function ensurePolling() {
        if (pollTimer) return;
        pollTimer = setInterval(refreshPending, POLL_MS);
    }
    ensurePolling(); // harmless no-op every tick unless eligibleNow()

    // ── the perceptron-style nudge: push each traced weight's DELTA a small
    // step toward whatever made the human's choice look better / the bot's
    // rejected pick look worse. Never touches any base weight table.
    function nudge(direction, trace) {
        if (!trace) return false;
        const d = loadDeltas();
        let touched = false;
        for (const key of Object.keys(trace)) {
            if (!isRealWeightKey(key)) continue;
            d[key] = +clampDelta(key, (d[key] || 0) + direction * LEARNING_RATE * trace[key]).toFixed(4);
            touched = true;
        }
        if (touched) { saveDeltas(d); stats.nudged++; renderBadge(); }
        return touched;
    }
    // Perceptron difference update between two traced candidates: nudge
    // every key present in EITHER trace's delta by lr*(human[k]-bot[k]).
    function nudgeDiff(humanTrace, botTrace, rate = LEARNING_RATE) {
        const d = loadDeltas();
        const keys = new Set([...Object.keys(humanTrace || {}), ...Object.keys(botTrace || {})]);
        let touched = false;
        for (const key of keys) {
            if (!isRealWeightKey(key)) continue;
            const h = (humanTrace && humanTrace[key]) || 0;
            const b = (botTrace && botTrace[key]) || 0;
            if (h === b) continue;
            d[key] = +clampDelta(key, (d[key] || 0) + rate * (h - b)).toFixed(4);
            touched = true;
        }
        if (touched) { saveDeltas(d); stats.nudged++; renderBadge(); }
        return touched;
    }

    // ── the actual comparison, fired on every one of the human's own recorded
    // actions (ActionLog.onRecord) ──
    function onHumanAction(entry) {
        if (!isEnabled()) return;
        if (typeof myPlayerIndex === 'undefined' || entry.player !== myPlayerIndex) return;
        console.log(`🧠 [Imitation] your action: ${entry.type}${entry.scroll ? ' (' + entry.scroll + ')' : ''} - had a cached bot pick? ${!!pending}${pending ? ` (bot wanted: ${pending.bestType})` : ''}`);
        if (!pending) return; // nothing cached to compare against — skip, don't guess
        const snapshot = pending;
        pending = null; // this decision is spent; next poll tick builds a fresh one

        // Signal A — "should I have ended my turn here?" — meaningful for
        // EVERY action type, not just endTurn itself, since declining to end
        // when the bot wanted to is just as real a signal as ending when it
        // didn't.
        const botWantedEnd = snapshot.bestType === 'endTurn';
        const humanEnded = entry.type === 'endTurn';
        if (snapshot.endTurnTrace && botWantedEnd !== humanEnded) {
            stats.watched++;
            nudge(humanEnded ? +1 : -1, snapshot.endTurnTrace);
        } else if (snapshot.endTurnTrace && botWantedEnd === humanEnded) {
            stats.watched++; stats.agreed++; renderBadge();
        }

        // Signal B — "which scroll was actually worth discarding?" — only
        // meaningful when the human's action WAS a discard (forced-overflow
        // turns are discard-only, so this naturally only fires then).
        if (entry.type === 'discardScroll' && snapshot.topDiscardScroll) {
            const matched = entry.scroll === snapshot.topDiscardScroll;
            if (!matched) {
                nudgeDiff(snapshot.discardTraceByScroll[entry.scroll], snapshot.discardTraceByScroll[snapshot.topDiscardScroll]);
            }
        }

        // Signal C - "which ready scroll was worth casting?" Only when the
        // bot also had your scroll as a candidate and preferred another one.
        if (entry.type === 'cast_execute' && entry.scrollName && snapshot.topCastScroll) {
            const mine = snapshot.castTraceByScroll[entry.scrollName];
            if (mine) {
                stats.watched++;
                if (entry.scrollName === snapshot.topCastScroll) { stats.agreed++; renderBadge(); }
                else nudgeDiff(mine, snapshot.castTraceByScroll[snapshot.topCastScroll]);
            }
        }

        // Signal D - "which way was worth walking?" Your move may cover
        // several hexes; compare its FIRST step (the bot's adjacent candidate
        // closest to where you went) with the bot's best step.
        if (entry.type === 'move' && snapshot.moveEntries?.length && Number.isFinite(entry.x)) {
            const moves = snapshot.moveEntries;
            const mine = moves.reduce((a, b) =>
                Math.hypot(b.x - entry.x, b.y - entry.y) < Math.hypot(a.x - entry.x, a.y - entry.y) ? b : a);
            stats.watched++;
            if (Math.hypot(mine.x - moves[0].x, mine.y - moves[0].y) < 5) { stats.agreed++; renderBadge(); }
            else nudgeDiff(mine.trace, moves[0].trace, MOVE_LEARNING_RATE);
        }
    }

    if (typeof window.ActionLog?.onRecord === 'function') {
        window.ActionLog.onRecord(onHumanAction);
    } else {
        console.warn('⚠️ [Imitation] ActionLog not loaded yet - load order issue, see file header');
    }

    // ── tiny hermit-only readout — never intrusive, just proof it's alive ──
    let badge = null;
    function renderBadge() {
        if (!isEnabled()) { if (badge) badge.style.display = 'none'; return; }
        if (!badge) {
            badge = document.createElement('div');
            badge.id = 'imitation-learning-badge';
            Object.assign(badge.style, {
                position: 'fixed', bottom: '10px', left: '10px', zIndex: '10000',
                background: '#1a1a2e', color: '#9fd9a0', border: '1px solid #444',
                borderRadius: '6px', padding: '4px 9px', fontSize: '11px',
                fontFamily: 'monospace', pointerEvents: 'none', opacity: '0.85',
            });
            document.body.appendChild(badge);
        }
        badge.style.display = 'block';
        badge.textContent = `🧠 learning - ${stats.watched} watched, ${stats.agreed} agreed, ${stats.nudged} nudged`;
    }

    window.BotImitation = {
        isHermitUser,
        setEnabled,
        isEnabled,
        resetStats,
        getStats: () => ({ ...stats }),
        getDeltas: loadDeltas,
        applyDeltas, // (base) => base + learned delta — lobby.js calls this per bot seat
        resetDeltas: () => { saveDeltas({}); console.log('🧠 [Imitation] deltas cleared'); },
        _refreshPending: refreshPending, // exposed for console/testing only
        debugEligibility: () => { const r = checkEligibility(); console.log('🧠 [Imitation]', r); return r; },
        debugPending: () => { console.log('🧠 [Imitation] pending:', pending); return pending; },
    };
    renderBadge();
    console.log('🧠 [Imitation] Loaded - hermit-only, off by default (see hermit menu)');
})();
