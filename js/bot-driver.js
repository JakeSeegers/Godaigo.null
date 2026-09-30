// ============================================================
// bot-driver.js — lets the HOST's browser drive bot players
// ============================================================
// A "bot player" is an ordinary `players` table row whose username starts
// with BOT_USERNAME_PREFIX (added from the lobby via the host-only
// "🤖 Add Bot" button — see addBotPlayer()/removeBotPlayer() in lobby.js).
// Any number of bots up to the room cap works unmodified: the watcher below
// drives whichever bot is active off a live-queried set of bot indices,
// not a single hardcoded one. Each counts as a
// player everywhere: player count, color/index assignment, turn order.
//
// Since the bot has no client, the host's browser acts as its client:
// a watcher notices when it's a bot's turn and briefly IMPERSONATES the bot
// (swaps the shared `myPlayerIndex` / `playerColor` lexical bindings) so
// every existing isMyTurn()/canTakeAction()/broadcast path treats this
// client as the bot. Actions run through window.BotSystem (strategy) and
// window.BotState (actuation) exactly like a human-driven game.
//
// KNOWN v1 LIMITS (fine to ship, documented for future agents):
//   - If the bot's hand overflows at end of turn, the resolve modal appears
//     on the host's screen — the host resolves it on the bot's behalf.
//   - While the bot is acting, the host's HUD temporarily reflects the bot.
//
// Response scrolls (Stage 2.5): a bot can now respond to a scroll cast by
// anyone (human or another bot) — respondForBots() below ticks alongside
// the turn watcher and calls window.BotEffects.decideResponse() on the
// bot's behalf whenever a response window is open. This does NOT require
// impersonation (no asBot()): response AP is spent via response-window.js's
// spendPlayerAP(), which for a bot writes directly to its tracked
// playerAPs[] entry instead of the shared currentAP global.
//
// LOAD ORDER: after bot.js (last game script).
// ============================================================

(function () {
    'use strict';

    function log(...args) { console.log('🕹️ [BotDriver]', ...args); }

    // Shared with lobby.js (bot row creation, heartbeat, disconnect sweep)
    const PREFIX = '🤖';
    window.BOT_USERNAME_PREFIX = PREFIX;
    window.isBotUsername = (u) => typeof u === 'string' && u.startsWith(PREFIX);

    // ----------------------------------------------------------------
    // Which player indices are bots (from the DB rows all clients hold)
    // ----------------------------------------------------------------
    function botIndexSet() {
        const set = new Set();
        if (typeof allPlayersData !== 'undefined' && Array.isArray(allPlayersData)) {
            for (const p of allPlayersData) {
                if (window.isBotUsername(p.username) && p.player_index != null) set.add(p.player_index);
            }
        }
        return set;
    }

    function gameActive() {
        return document.getElementById('game-layout')?.classList.contains('active');
    }

    function iAmDriver() {
        return typeof isMultiplayer !== 'undefined' && isMultiplayer &&
               typeof isHost !== 'undefined' && isHost;
    }

    // ----------------------------------------------------------------
    // Impersonation: temporarily become the bot so every existing
    // myPlayerIndex-based gate and broadcast identifies as the bot.
    // ----------------------------------------------------------------
    // While impersonating a bot, the host's own player index + response AP are
    // preserved here so the response window can still let the host react to the
    // bot's spells AS THEMSELVES (see response-window.js localResponderIndex /
    // getPlayerAP). driverRealIndex is null whenever no bot is being driven.
    //
    // hostAP is the host's true spendable response AP. It must survive ACROSS
    // consecutive bot turns, not just a single asBot() call: when bot A's turn
    // ends and bot B's starts next (no human turn in between), driveBotTurn()
    // resets the shared `currentAP` to 5 for bot B and lets bot B spend it
    // down — so if we re-snapshotted from `currentAP` at the start of EVERY
    // asBot() call, bot B's turn would inherit bot A's post-spend leftover AP
    // as if it were the host's own, instead of the host's real AP. That
    // silently starved the host of response AP (e.g. couldn't afford a 2-AP
    // Iron Stance counter) any time two bot turns ran back-to-back. Instead,
    // hostAP is captured ONCE when the host stops being the active player and
    // reused (only decremented via spendDriverAP) through however many bot
    // turns follow, until it's the host's own turn again (see driveBotTurn's
    // post-turn fixup below, which clears it).
    let driverRealIndex = null;
    let hostAP = null; // { currentAP, voidAP } — persists across consecutive bot turns
    let driverAP = null; // alias of hostAP while a bot is being driven; null otherwise

    async function asBot(botIndex, fn) {
        const realIndex = myPlayerIndex;
        const realColor = playerColor;
        driverRealIndex = realIndex;
        // Only capture a fresh snapshot the FIRST time we leave the host's own
        // turn — reuse the running total for any further consecutive bot turns.
        if (!hostAP) {
            hostAP = {
                currentAP: (typeof currentAP === 'number') ? currentAP : 0,
                voidAP:    (typeof voidAP === 'number') ? voidAP : 0,
            };
        }
        driverAP = hostAP;
        myPlayerIndex = botIndex;
        const row = (typeof allPlayersData !== 'undefined')
            ? allPlayersData.find(p => p.player_index === botIndex) : null;
        if (row && row.color) playerColor = row.color;

        // docs/bot-tycoon-proposal.md build-order step 6: this bot may carry
        // its own distinct weights (players.bot_weights, set when it was
        // added — see lobby.js addBotPlayer()) instead of sharing whatever
        // window.BotSystem.WEIGHTS currently holds. Same save-and-restore
        // discipline as myPlayerIndex/playerColor above: snapshot the FULL
        // live table before swapping, put it back in the finally block no
        // matter what happens in fn(), so a bot with no bot_weights
        // (fallback / pre-existing rows) leaves WEIGHTS completely
        // untouched, and a multi-bot room's NEXT bot never inherits this
        // one's table.
        let savedWeights = null;
        // applyWeights lives in bot-arena.js, which is lazy-loaded
        // (js/asset-preloader.js § Lazy scripts) — make sure it's in.
        if (row?.bot_weights && !window.BotArena && window.LazyScripts) {
            try { await window.LazyScripts.load('bot-arena'); } catch (e) { console.warn(e.message); }
        }
        if (row?.bot_weights && window.BotArena?.applyWeights) {
            savedWeights = { ...window.BotSystem.WEIGHTS };
            window.BotArena.applyWeights(row.bot_weights);
        }

        if (typeof updateEndTurnButtonVisibility === 'function') updateEndTurnButtonVisibility();
        try {
            await fn();
        } finally {
            myPlayerIndex = realIndex;
            playerColor = realColor;
            if (savedWeights) window.BotArena.applyWeights(savedWeights);
            driverRealIndex = null;
            driverAP = null; // not hostAP — the running total survives until it's the host's own turn again
            if (typeof updateEndTurnButtonVisibility === 'function') updateEndTurnButtonVisibility();
            if (typeof updateTurnDisplay === 'function') updateTurnDisplay();
        }
    }

    // Spend from the host's preserved response AP (void first, mirroring spendAP).
    function spendDriverAP(cost) {
        if (!driverAP) return;
        let remaining = cost;
        if (driverAP.voidAP >= remaining) {
            driverAP.voidAP -= remaining;
        } else {
            remaining -= driverAP.voidAP;
            driverAP.voidAP = 0;
            driverAP.currentAP = Math.max(0, driverAP.currentAP - remaining);
        }
    }

    // ----------------------------------------------------------------
    // Placement phase: choice of where to put the bot's player tile is
    // BotSystem's decision (bot-state.js enumerates candidates as
    // {type:'placeTile', ...}, bot.js scores them) — this driver only
    // impersonates and lets BotSystem.step() pick + apply one.
    // ----------------------------------------------------------------
    async function placeBotTile(botIndex) {
        log(`Placing bot ${botIndex}'s player tile via BotSystem`);
        await asBot(botIndex, async () => {
            const applied = window.BotSystem.step();
            if (!applied) log(`No legal placement action found for bot ${botIndex}`);
        });
    }

    // ----------------------------------------------------------------
    // Normal turns: reset the bot's AP (the turn-change handler only does
    // this for the local player), then let BotSystem play out the turn.
    // ----------------------------------------------------------------
    let lastDrivenTurnKey = null;

    async function driveBotTurn(botIndex) {
        const turnNo = (typeof currentTurnNumber !== 'undefined') ? currentTurnNumber : 0;
        const key = `${turnNo}:${botIndex}`;
        if (lastDrivenTurnKey === key) return;
        lastDrivenTurnKey = key;

        log(`Driving turn for bot player ${botIndex} (turn #${turnNo})`);
        if (typeof updateStatus === 'function') updateStatus('Bot is thinking...');
        await new Promise(r => setTimeout(r, 900)); // let turn-change effects settle

        await asBot(botIndex, async () => {
            currentAP = 5;
            const apEl = document.getElementById('ap-count');
            if (apEl) apEl.textContent = currentAP;
            if (typeof refreshVoidAP === 'function') refreshVoidAP();
            if (typeof syncPlayerState === 'function') syncPlayerState();

            await window.BotSystem.turn();

            // Safety net: never leave the game hanging on a stuck bot turn
            if (activePlayerIndex === botIndex) {
                log('Bot turn did not end on its own - forcing end turn');
                const btn = document.getElementById('end-turn');
                if (btn && !btn.disabled) btn.click();
            }
        });

        // The bot spent from this client's shared currentAP counter, and the
        // end-turn flow's local AP reset is gated on
        // activePlayerIndex === myPlayerIndex — which compared against the
        // BOT's index while impersonated. So when the bot hands the turn to
        // THIS player, redo what the turn-change handler would have done:
        // full AP, pips, and void AP recomputed from MY pool (not the bot's).
        if (typeof activePlayerIndex !== 'undefined' && activePlayerIndex === myPlayerIndex) {
            currentAP = 5;
            const apEl = document.getElementById('ap-count');
            if (apEl) apEl.textContent = currentAP;
            if (typeof updateApPips === 'function') updateApPips(currentAP);
            if (typeof refreshVoidAP === 'function') refreshVoidAP();
            if (typeof syncPlayerState === 'function') syncPlayerState();
            if (typeof updateStatus === 'function') updateStatus('Your turn!');
            // It's genuinely my own turn now — currentAP/voidAP are live and
            // authoritative again, so drop the carried-over response-AP
            // snapshot. The next bot-driving stretch (after my turn ends)
            // will recapture it fresh in asBot().
            hostAP = null;
        } else if (typeof refreshVoidAP === 'function') {
            // Not my turn next — still restore void AP to MY pool's baseline
            refreshVoidAP();
        }

        // While impersonated, the stone panel and scroll counts rendered the
        // BOT's resources — re-render them for the local player now.
        try {
            if (typeof playerPool !== 'undefined' && typeof updateStoneCount === 'function') {
                Object.keys(playerPool).forEach(updateStoneCount);
            }
            window.spellSystem?.updateScrollCount?.();
        } catch (e) { /* cosmetic only */ }
    }

    // ----------------------------------------------------------------
    // Response scrolls: unlike a bot's own turn, a response window can open
    // while ANY player is active (including another bot or a human other
    // than the host). This runs independently of the turn-driving branch
    // below — it's fast, and BotEffects.decideResponse() is idempotent per
    // player (guarded by responseWindow.respondingPlayers), so ticking it
    // every 700ms alongside the turn watcher is safe.
    // ----------------------------------------------------------------
    function respondForBots() {
        if (!iAmDriver() || !gameActive()) return;
        const rw = window.spellSystem?.responseWindow;
        if (!rw || !rw.isResponseWindowOpen) return;
        if (typeof window.BotEffects?.decideResponse !== 'function') return;

        const bots = botIndexSet();
        const casterIdx = rw.currentCaster;
        for (const botIndex of bots) {
            if (botIndex === casterIdx) continue;
            if (rw.respondingPlayers?.has(botIndex)) continue;
            window.BotEffects.decideResponse(botIndex, casterIdx);
        }
    }

    // ----------------------------------------------------------------
    // Take Flight: a caster targeted a bot-controlled player for the
    // "opponent chooses their own destination" flow (see
    // ScrollEffects.enterTakeFlightChoiceAsTarget / the
    // 'take-flight-choose-request' broadcast in lobby.js). Unlike a bot's
    // own turn or a response window, this arrives as a one-shot broadcast
    // rather than something the 700ms watcher below would ever notice on
    // its own — lobby.js's listener calls this directly the moment the
    // request comes in, the same way it hands off to
    // enterTakeFlightChoiceAsTarget when the target is the LOCAL human
    // player instead of a bot. Same impersonation discipline as
    // driveBotTurn(): briefly become the bot so any myPlayerIndex-based
    // logic downstream (broadcasts, status text) reads correctly, then roll
    // a random valid destination — no strategic model, same reasoning
    // bot-effects.js's driveTakeFlightDrag() uses for its own v1 pick.
    // ----------------------------------------------------------------
    async function resolveTakeFlightChoice(casterIndex, targetPlayerIndex, scrollName) {
        if (!iAmDriver() || !botIndexSet().has(targetPlayerIndex)) return;
        const se = window.spellSystem?.scrollEffects;
        if (typeof se?.getValidTakeFlightDestinations !== 'function' ||
            typeof se?.finalizeTakeFlightChoice !== 'function') return;

        await asBot(targetPlayerIndex, async () => {
            const candidates = se.getValidTakeFlightDestinations(targetPlayerIndex);
            if (!candidates.length) {
                log(`Bot ${targetPlayerIndex}: no valid Take Flight destination - cancelling`);
                if (typeof broadcastGameAction === 'function') {
                    broadcastGameAction('take-flight-cancel-request', { casterIndex, targetPlayerIndex });
                }
                return;
            }
            const dest = candidates[Math.floor(Math.random() * candidates.length)];
            log(`Bot ${targetPlayerIndex}: rolling a Take Flight destination (${candidates.length} candidates)`);
            se.finalizeTakeFlightChoice(casterIndex, targetPlayerIndex, scrollName, dest.x, dest.y);
        });
    }

    // ----------------------------------------------------------------
    // Watcher: fires the right driver action whenever a bot is the
    // active player on the host's client.
    // ----------------------------------------------------------------
    let busy = false;
    const handledPlacement = new Set();

    setInterval(() => {
        respondForBots();
        if (busy) return;
        if (!gameActive()) { handledPlacement.clear(); lastDrivenTurnKey = null; return; }
        if (!iAmDriver()) return;
        if (window.isGamePaused?.()) return; // game-pause.js: wait with the others

        const bots = botIndexSet();
        if (!bots.size || !bots.has(activePlayerIndex)) return;

        if (typeof isPlacementPhase !== 'undefined' && isPlacementPhase) {
            if (playerTilesPlaced.has(activePlayerIndex) || handledPlacement.has(activePlayerIndex)) return;
            handledPlacement.add(activePlayerIndex);
            busy = true;
            setTimeout(() => {
                placeBotTile(activePlayerIndex)
                    .catch(e => log('Bot tile placement failed:', e))
                    .finally(() => { busy = false; });
            }, 800);
        } else {
            busy = true;
            driveBotTurn(activePlayerIndex)
                .catch(e => log('Bot turn failed:', e))
                .finally(() => { busy = false; });
        }
    }, 700);

    // ----------------------------------------------------------------
    // Public API (console debugging + other modules)
    // ----------------------------------------------------------------
    window.BotDriver = {
        isBot: (i) => botIndexSet().has(i),
        botIndices: botIndexSet,
        controlsActivePlayer: () => iAmDriver() && botIndexSet().has(activePlayerIndex),
        // Response-window integration: identity + AP of the host behind a bot.
        driverRealIndex: () => driverRealIndex,
        getDriverAP: () => driverAP ? (driverAP.currentAP + driverAP.voidAP) : 0,
        spendDriverAP,
        resolveTakeFlightChoice,
        _placeBotTile: placeBotTile,
        _driveBotTurn: driveBotTurn,
    };

    log('Loaded - host lobbies get a 🤖 Add Bot button; host client drives bot turns');
})();
