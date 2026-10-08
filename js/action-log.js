// ============================================================
// action-log.js — lightweight, in-memory record of every player's
// meaningful actions (bot AND human), downloadable from the cheat panel
// for bot diagnostics. Nothing here is persisted to Supabase — it lives
// only in this tab's memory for the current session, capped so a long
// game can't leak memory.
//
// Hooks the FUNCTIONS shared by both human and bot code paths (placeStone,
// broadcastPlayerMovement, spellSystem's cast/discard via the existing
// logScrollEvent hook) rather than any one caller's code, so it captures
// both without touching bot.js / bot-state.js / game-ui.js's own logic.
//
// IMPORTANT for multiplayer: those hooks only fire on the client that
// actually PERFORMS the action. Casts/effects/responses are still captured
// correctly on every client because spellSystem.scrollEffects.execute()
// genuinely reruns on receipt of a scroll-resolution broadcast (lobby.js) —
// but movement and stone placement are applied on receipt through separate,
// purely-visual functions (movePlayerVisually/placeStoneVisually) that
// never touch broadcastPlayerMovement/placeStone. Real remote players'
// moves and stone placements would silently never appear in another
// client's Game Log without lobby.js's 'player-move'/'stone-place'
// broadcast handlers calling record() directly, which they now do — this
// went unnoticed for a while because a lobby-added bot's turns are driven
// by the HOST'S OWN browser impersonating it (bot-driver.js's asBot()), so
// a bot's moves/stones already ran through the normal local hooks and
// never exposed the gap the way a second real human client does.
//
// LOAD ORDER: last (after bot-driver.js) so everything it wraps already
// exists as a global by the time this file runs.
// ============================================================

(function () {
    'use strict';

    // 20000 (2026-09-29): training runs overflowed 3000 within one game.
    const MAX_ENTRIES = 20000;
    const log = [];

    // Subscribers notified with each entry as it's recorded — js/game-log-ui.js
    // uses this to render the player-facing readable log live, instead of
    // polling entries() or duplicating any of the hooks below. A listener
    // throwing must never break recording itself.
    const listeners = [];
    function onRecord(fn) { if (typeof fn === 'function') listeners.push(fn); }

    // Optional roster override for LOCAL games (multiplayer games derive the
    // roster from allPlayersData). BotArena.spectate sets this so bot-vs-bot
    // spectator logs label every actor correctly.
    let rosterOverride = null; // [{index, username, isBot}] | null
    function setRoster(players) { rosterOverride = Array.isArray(players) ? players : null; }

    function actorLabel(playerIndex) {
        if (rosterOverride) {
            const p = rosterOverride.find(p => p.index === playerIndex);
            if (p) return p.isBot ? 'bot' : 'human';
        }
        try {
            if (typeof allPlayersData !== 'undefined' && Array.isArray(allPlayersData)) {
                const p = allPlayersData.find(p => p.player_index === playerIndex);
                if (p) return (window.isBotUsername && window.isBotUsername(p.username)) ? 'bot' : 'human';
            }
        } catch (e) { /* solo/tutorial mode has no allPlayersData — default below */ }
        return 'human';
    }

    // playerIndexOverride: use the payload's own playerIndex instead of the
    // ambient activePlayerIndex — needed by lobby.js's broadcast RECEIVE
    // handlers (see below), where activePlayerIndex could theoretically lag
    // one turn-change behind the actor the payload actually names.
    function record(type, extra, playerIndexOverride) {
        try {
            const player = (playerIndexOverride != null) ? playerIndexOverride
                : (typeof activePlayerIndex !== 'undefined') ? activePlayerIndex : null;
            const entry = Object.assign({
                turn: (typeof currentTurnNumber !== 'undefined') ? currentTurnNumber : null,
                player,
                actor: player != null ? actorLabel(player) : null,
                type,
            }, extra);
            log.push(entry);
            // Drop the oldest 1000 at once (shifting one per action moved the
            // whole array every time once the log was full).
            if (log.length > MAX_ENTRIES + 1000) log.splice(0, log.length - MAX_ENTRIES);
            for (const fn of listeners) {
                try { fn(entry); } catch (e) { console.warn('⚠️ [ActionLog] onRecord listener failed:', e); }
            }
        } catch (e) {
            console.warn('⚠️ [ActionLog] record failed:', e);
        }
    }

    // ── placeStone: shared by human drag-drop and BotState.applyAction ──
    if (typeof window.placeStone === 'function') {
        const origPlaceStone = window.placeStone;
        window.placeStone = function (x, y, type) {
            const id = origPlaceStone.apply(this, arguments);
            record('placeStone', { x: +x.toFixed(1), y: +y.toFixed(1), stoneType: type });
            return id;
        };
        // Classic-script bare identifiers and window.X are the same binding for
        // function declarations, but keep both in sync defensively.
        try { placeStone = window.placeStone; } catch (e) { /* ignore */ }
    }

    // ── movement: shared by human tile-move and BotState.applyAction ──
    if (typeof broadcastPlayerMovement === 'function') {
        const origMove = broadcastPlayerMovement;
        broadcastPlayerMovement = function (playerIndex, x, y, apSpent) {
            record('move', { x: +x.toFixed(1), y: +y.toFixed(1), apSpent });
            return origMove.apply(this, arguments);
        };
    }

    // ── casts/effects: chain onto the existing logScrollEvent hook (already
    // fired by game-core.js/response-window.js for every scroll event) —
    // whitelist to the highest-signal types so the download stays succinct ──
    const WHITELISTED_SCROLL_EVENTS = new Set([
        'cast_execute', 'effect_execute', 'response_resolved', 'original_countered', 'original_resolved',
        'response_counter', 'counter_negated', 'sacrificial_pyre_response_opened', 'sacrificial_pyre_response_submitted',
        'reflect_triggered', 'psychic_triggered', 'excavate_triggered', 'excavate_teleport_used',
    ]);
    const prevLogScrollEvent = window.logScrollEvent;
    window.logScrollEvent = function (type, details) {
        if (typeof prevLogScrollEvent === 'function') {
            try { prevLogScrollEvent(type, details); } catch (e) { /* don't let another hook's error break logging */ }
        }
        if (WHITELISTED_SCROLL_EVENTS.has(type)) {
            record(type, details);
        }
    };

    // ── discard: no existing shared hook — wrap spellSystem's method once it
    // exists (it's constructed after this script may have already run) ──
    function hookSpellSystemDiscard() {
        if (!window.spellSystem || window.spellSystem.__actionLogDiscardHooked || typeof window.spellSystem.discardScroll !== 'function') return false;
        window.spellSystem.__actionLogDiscardHooked = true;
        const origDiscard = window.spellSystem.discardScroll.bind(window.spellSystem);
        window.spellSystem.discardScroll = function (scrollName) {
            const ok = origDiscard(scrollName);
            if (ok) record('discardScroll', { scroll: scrollName });
            return ok;
        };
        return true;
    }
    let discardHookAttempts = 0;
    const discardHookTimer = setInterval(() => {
        if (hookSpellSystemDiscard() || ++discardHookAttempts > 40) clearInterval(discardHookTimer);
    }, 250);

    // ── endTurn: listen on document during the CAPTURE phase so this fires
    // BEFORE the button's own onclick advances activePlayerIndex — ancestor
    // capturing listeners always run before the target's own listeners,
    // regardless of script load order (unlike a second listener on the
    // button itself, which would fire after and see the NEW active player) ──
    // A click the button turns down (same checks as game-ui.js's end-turn
    // onclick, run here first) is logged as 'endTurnRefused' with the reason,
    // not as an end of turn: game 951 logged eight 'endTurn' entries for one
    // bot turn and it was not clear why (owner 2026-10-08). Each entry also
    // carries the source pools and the player's own pool, so a log shows
    // where a pool count went wrong.
    window.endTurnBlockReason = function () {
        try {
            if (typeof canTakeAction === 'function' && !canTakeAction()) return 'not this player\'s turn, or a scroll cascade / overflow is open';
            const idx = (typeof isMultiplayer !== 'undefined' && isMultiplayer) ? myPlayerIndex : activePlayerIndex;
            if (spellSystem?.hasPendingCascade?.(idx)) return 'scroll cascade open';
            const stranded = typeof isPlayerStrandedOnStone === 'function' && isPlayerStrandedOnStone(idx);
            if (typeof isPlayerRestingOnStone === 'function' && isPlayerRestingOnStone(idx) && !stranded) return 'standing on a stone';
            if (typeof isPlayerOnOpponentTile === 'function' && isPlayerOnOpponentTile(idx) && !stranded) return "on another player's tile";
        } catch (e) { /* unknown: let the button decide */ }
        return null;
    };
    function poolsNow() {
        try {
            const p = (typeof playerPools !== 'undefined' && playerPools[activePlayerIndex]) || null;
            return {
                src: (typeof sourcePool !== 'undefined') ? { ...sourcePool } : undefined,
                pool: p ? { ...p } : undefined,
            };
        } catch (e) { return {}; }
    }
    document.addEventListener('click', (e) => {
        if (!(e.target && e.target.id === 'end-turn')) return;
        const why = window.endTurnBlockReason();
        if (why) record('endTurnRefused', { reason: why, ...poolsNow() });
        else record('endTurn', poolsNow());
    }, true);

    // ── Download as JSON: a header with game/player context, then entries ──
    function download() {
        const meta = {
            exportedAt: new Date().toISOString(),
            isMultiplayer: (typeof isMultiplayer !== 'undefined') ? isMultiplayer : null,
            currentGameId: (typeof currentGameId !== 'undefined') ? currentGameId : null,
            players: rosterOverride ||
                ((typeof allPlayersData !== 'undefined' && Array.isArray(allPlayersData))
                ? allPlayersData.map(p => ({
                    index: p.player_index,
                    username: p.username,
                    isBot: !!(window.isBotUsername && window.isBotUsername(p.username)),
                  }))
                : null),
            entryCount: log.length,
        };
        const blob = new Blob([JSON.stringify({ meta, entries: log }, null, 1)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `godaigo-action-log-${Date.now()}.json`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
    }

    function clear() { log.length = 0; }

    window.ActionLog = { record, download, clear, setRoster, onRecord, entries: () => log.slice() };
    console.log('📋 [ActionLog] Loaded - window.ActionLog.download() or the cheat panel button');
})();
