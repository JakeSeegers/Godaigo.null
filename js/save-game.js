// save-game.js: save a game against bots, close the tab, resume later (window.SaveGame).
//
// Design: docs/saved-games.md. Server: sql/saved-games.sql.
// Only for online games where you are the only human (Quick Play, rooms of bots).
// Every move of an online game is already on the server (match-recorder.js), so a
// save just points at the match and keeps the seats (with each bot's weights) and
// a board fingerprint.
//   Leave reads "Save / Leave" in these games and asks: Save & quit (your turn,
//     before you act: send the last moves, save_game(), leave as usual), Leave
//     without saving, or Cancel. Other games keep the plain Leave button.
//   Continue (lobby card): load_saved_game() -> a new private room with the same
//     bots -> hostStartGame({resume}) puts every seat back and uses the saved deck
//     -> the saved moves are fed through the game's own message handlers (as
//     replays do) while you watch as a spectator and the host loops / bots wait
//     (isRebuilding) -> your seat back, full AP, bot memory reset -> the board
//     fingerprint must match the save -> resume_saved_game_started(room) copies the
//     old moves into the new match and uses the save up (no retries).
// Rewards stay normal: the new match holds the whole game.
(function () {
    'use strict';

    const SKIP_EVENTS = new Set(['response-window-opened', 'scroll-state-sync-request', 'take-flight-choose-request',
        'take-flight-cancel-request', 'game-reset', 'stream-vote']);
    const BRAIN_EMOJIS = new Set(['🧠', '🎲']);
    const S = {
        get isMultiplayer() { try { return isMultiplayer; } catch (e) { return false; } },
        get isHost() { try { return isHost; } catch (e) { return false; } },
        get currentGameId() { try { return currentGameId; } catch (e) { return null; } },
        get myPlayerIndex() { try { return myPlayerIndex; } catch (e) { return null; } },
        get activePlayerIndex() { try { return activePlayerIndex; } catch (e) { return null; } },
        get currentTurnNumber() { try { return currentTurnNumber; } catch (e) { return 0; } },
        get isPlacementPhase() { try { return isPlacementPhase; } catch (e) { return false; } },
        get allPlayersData() { try { return allPlayersData; } catch (e) { return []; } },
        get currentAP() { try { return currentAP; } catch (e) { return 0; } },
        get supabase() { try { return supabase; } catch (e) { return null; } },
    };
    const log = (...a) => console.log('[SaveGame]', ...a);
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const inGame = () => !!document.getElementById('game-layout')?.classList.contains('active');
    const isBotName = (u) => !!window.isBotUsername?.(u);

    let rebuilding = false;
    let saving = false;
    // The server part (sql/saved-games.sql) may not be installed yet: the Save
    // button only shows once my_saved_game() answered without "no such function".
    let serverReady = false;

    // ------------------------------------------------------------ can I save now?
    function whyNot() {
        if (!inGame() || !S.isMultiplayer || S.currentGameId == null || window.Replay?.state) return 'not in an online game';
        if (!S.isHost) return 'only the host can save';
        const seats = S.allPlayersData || [];
        if (seats.filter(p => !isBotName(p.username)).length !== 1) return 'only games against bots can be saved';
        if (S.isPlacementPhase) return 'place your home tile first';
        // Any time in your own turn (owner 2026-10-10: also mid-turn): the save
        // keeps the AP you have left. Not while a scroll is half done.
        // While a bot acts, js/bot-driver.js borrows its seat (myPlayerIndex = the bot).
        if (window.BotDriver?.driverRealIndex?.() != null) return 'wait for the bots to finish';
        if (S.activePlayerIndex !== S.myPlayerIndex) return 'you can save during your turn';
        if (window.spellSystem?.responseWindow?.isResponseWindowOpen) return 'wait for the response window to close';
        if (busyScroll()) return 'finish the scroll you are casting first';
        if (window.isGamePaused?.()) return 'the game is paused';
        const b = window.PlayerBounty?.current?.();
        if (b && b.status === 'open' && b.total > 0) return 'games with a bounty cannot be saved';
        return null;
    }

    function actedThisTurn() {
        const turn = S.currentTurnNumber, me = S.myPlayerIndex;
        return (window.ActionLog?.entries?.() || []).some(e => e.turn === turn && e.player === me && e.type !== 'botTalk');
    }
    // A scroll waiting for a choice (same checks as bot.js waitForQuiescence).
    function busyScroll() {
        try {
            const se = window.spellSystem?.scrollEffects;
            if (se?.selectionMode || window.takeFlightState) return true;
            if ((se?.EFFECT_MODAL_IDS || []).some(id => document.getElementById(id))) return true;
            if (document.getElementById('transmute-modal') || document.getElementById('cascade-popup')) return true;
            if (window.spellSystem?.hasPendingCascade?.(S.myPlayerIndex)) return true;
        } catch (e) {}
        return false;
    }

    // ------------------------------------------------------------ the Leave button
    // In a game where you are the only human, Leave reads "Save / Leave" and asks:
    // Save & quit (when allowed), Leave without saving, or Cancel. In games with
    // other humans (or before the server part is installed) Leave is unchanged.
    const soloVsBots = () => serverReady && inGame() && S.isMultiplayer && !window.Replay?.state && !rebuilding &&
        S.isHost && (S.allPlayersData || []).filter(p => !isBotName(p.username)).length === 1;
    function updateButton() {
        const leave = document.getElementById('leave-game');
        if (!leave) return;
        const solo = soloVsBots();
        const want = solo ? 'Save / Leave' : 'Leave';
        if ((window.srcText ? srcText(leave) : leave.textContent) !== want) leave.textContent = want;
        leave.title = solo ? 'Save this game to finish later, or leave it' : '';
        document.getElementById('save-game-btn')?.remove();   // older builds had a separate button
    }
    // Capture phase: runs before the button's own onclick (game-ui.js -> leaveGame()).
    document.addEventListener('click', (e) => {
        const btn = e.target?.closest?.('#leave-game');
        if (!btn || !soloVsBots()) return;
        e.stopImmediatePropagation();
        e.preventDefault();
        openLeaveChoice();
    }, true);
    function openLeaveChoice() {
        document.getElementById('save-leave-overlay')?.remove();
        const why = whyNot();
        const o = document.createElement('div');
        o.id = 'save-leave-overlay';
        o.className = 'retro-dlg-overlay';
        o.innerHTML = `<div class="retro-dlg-box">
            <div class="retro-dlg-title">Leave this game?</div>
            <div class="retro-dlg-line">Save it to finish later (from the lobby, on any device), or leave without saving.</div>
            ${why ? `<div class="retro-dlg-line save-leave-why">Saving: ${esc(why)}.</div>` : ''}
            <div class="retro-dlg-btns">
                <button type="button" data-act="save" ${why ? 'disabled' : ''}>Save &amp; quit</button>
                <button type="button" data-act="leave">Leave without saving</button>
                <button type="button" data-act="cancel">Cancel</button>
            </div></div>`;
        document.body.appendChild(o);
        const close = () => o.remove();
        o.querySelector('[data-act=cancel]').onclick = close;
        o.querySelector('[data-act=save]').onclick = () => { close(); saveAndQuit(); };
        o.querySelector('[data-act=leave]').onclick = async () => {
            close();
            if (typeof _doLeaveGame === 'function') await _doLeaveGame();
        };
    }

    // opts.quiet (idle training, js/idle-training.js): no questions or alerts;
    // returns true when saved.
    async function saveAndQuit(opts = {}) {
        const quiet = !!opts.quiet;
        const why = whyNot();
        if (why) { if (!quiet) alert('You cannot save right now: ' + why + '.'); return false; }
        if (!quiet && saved && !confirm('You already have a saved game. Saving this one replaces it. Continue?')) return false;
        saving = true;
        updateButton();
        try {
            if (typeof updateStatus === 'function') updateStatus('Saving...');
            const sent = await window.MatchRecorder?.flushAll?.();
            if (sent === false) throw new Error('could not send the last moves, check your connection');
            const seats = (S.allPlayersData || []).map(p => ({
                index: p.player_index, color: p.color, username: p.username, user_id: p.user_id || null,
                is_bot: isBotName(p.username), bot_weights: p.bot_weights || null, bot_source_id: p.bot_source_id ?? null,
            })).sort((a, b) => a.index - b.index);
            const fp = window.MatchWitness?.fingerprint?.() || null;
            // AP left this turn (mid-turn saves); resume() puts it back.
            let state = null;
            try { state = { ap: currentAP, void_ap: voidAP }; } catch (e) {}
            const args = { p_room: S.currentGameId, p_seats: seats, p_turn: S.currentTurnNumber, p_fingerprint: fp };
            let { error } = await S.supabase.rpc('save_game', { ...args, p_state: state });
            // Server without p_state yet (sql/saved-games.sql): only a turn-start save is safe.
            if (error && /p_state|could not find|PGRST202/i.test(error.message || error.code || '')) {
                if (!state || state.ap < 5 || actedThisTurn()) throw new Error('you can save before you act this turn');
                ({ error } = await S.supabase.rpc('save_game', args));
            }
            if (error) throw new Error(/bots can be saved/.test(error.message) ? 'only games against bots can be saved'
                : /bounty/.test(error.message) ? 'games with a bounty cannot be saved' : error.message);
            window.gami?.notify?.('Game saved. Continue it from the lobby.', 0, 'gold');
            if (typeof _doLeaveGame === 'function') await _doLeaveGame();
            else if (typeof window.leaveGame === 'function') window.leaveGame();
            setTimeout(refreshCard, 1500);
            return true;
        } catch (e) {
            if (quiet) { log('idle save failed', e?.message || e); return false; }
            alert('Could not save: ' + (e?.message || e));
            return false;
        } finally {
            saving = false;
            updateButton();
        }
    }

    // ------------------------------------------------------------ lobby card
    let saved = null, lastCardPoll = 0;
    async function refreshCard() {
        if (!window.gami?.userId || !S.supabase) return;
        lastCardPoll = Date.now();
        try {
            const { data, error } = await S.supabase.rpc('my_saved_game');
            if (!error) { saved = data || null; serverReady = true; }
            else if (/PGRST202|could not find|does not exist/i.test(error.message || error.code || '')) serverReady = false;
        } catch (e) {}
        renderCard();
    }
    function renderCard() {
        let card = document.getElementById('saved-game-card');
        const lobbyVisible = !inGame() && document.getElementById('multiplayer-lobby')?.style.display !== 'none'
            && !(S.currentGameId != null);
        if (!saved || !lobbyVisible) { card?.remove(); return; }
        if (!card) {
            const anchor = document.getElementById('quick-play-btn');
            if (!anchor || !anchor.parentNode) return;
            card = document.createElement('div');
            card.id = 'saved-game-card';
            card.className = 'saved-game-card';
            anchor.parentNode.insertBefore(card, anchor.nextSibling);
        }
        const others = (saved.seats || []).filter(s => s.is_bot).map(s => String(s.username || '').replace(/^🤖\s*/u, '')).join(', ');
        const when = saved.saved_at ? new Date(saved.saved_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
        const html = `<div class="saved-game-text"><b>Saved game</b>: turn ${esc(saved.turn ?? '?')} vs ${esc(others || 'bots')}
                <span class="saved-game-when">${esc(when)}</span></div>
            <div class="saved-game-actions"><button type="button" data-act="continue">Continue</button>
                <button type="button" data-act="discard">Discard</button></div>`;
        if (card.dataset.html === html) return;
        card.dataset.html = html;
        card.innerHTML = html;
        card.querySelector('[data-act=continue]').onclick = () => resume();
        card.querySelector('[data-act=discard]').onclick = async () => {
            if (!confirm('Discard your saved game? It cannot be continued after this.')) return;
            await S.supabase.rpc('delete_saved_game');
            saved = null;
            renderCard();
        };
    }

    // ------------------------------------------------------------ resume
    function overlay(text) {
        let o = document.getElementById('save-game-overlay');
        if (!text) { o?.remove(); return; }
        if (!o) {
            o = document.createElement('div');
            o.id = 'save-game-overlay';
            document.body.appendChild(o);
        }
        o.innerHTML = `<div class="save-game-overlay-box">${esc(text)}</div>`;
    }

    async function resume() {
        if (rebuilding) return;
        if (S.currentGameId != null || inGame()) { alert('Leave your current room or game first.'); return; }
        overlay('Loading your saved game...');
        let data;
        try {
            const res = await S.supabase.rpc('load_saved_game');
            if (res.error) throw new Error(res.error.message);
            data = res.data;
        } catch (e) { overlay(null); alert('Could not load the saved game: ' + (e?.message || e)); return; }
        if (!data || !Array.isArray(data.seats) || !Array.isArray(data.moves)) {
            overlay(null); alert('That saved game is gone (saves last 30 days).'); saved = null; renderCard(); return;
        }
        const mySeat = data.seats.find(s => !s.is_bot);
        rebuilding = true;
        let realIndex = null;
        try {
            // 1. New private room with the same bots.
            overlay('Setting up the room...');
            if (typeof createPrivateRoom === 'function') await createPrivateRoom();
            else if (typeof createRoom === 'function') await createRoom(true);
            if (S.currentGameId == null || !S.isHost) throw new Error('could not open a room');
            for (const s of data.seats.filter(x => x.is_bot)) {
                const { error } = await S.supabase.from('players').insert([{
                    username: s.username, is_ready: true, game_id: S.currentGameId,
                    bot_weights: s.bot_weights || null, bot_source_id: s.bot_source_id ?? null,
                }]);
                if (error) throw new Error('could not add ' + s.username + ': ' + error.message);
            }
            // 2. Start with the saved seats and deck.
            overlay('Rebuilding the board...');
            await hostStartGame({ resume: data });
            for (let i = 0; i < 40 && !inGame(); i++) await sleep(250);
            if (!inGame()) throw new Error('the game did not start');
            await sleep(600);
            // 3. Feed the saved moves through the game's own handlers, as a spectator,
            //    with the host loops and bots quiet. A bot action the host started
            //    before the rebuild (js/bot-driver.js plays a bot AS that seat: it
            //    swaps myPlayerIndex and resets AP when it ends) must finish first,
            //    or it puts the wrong seat and AP back afterwards (2026-10-10 test).
            for (let i = 0; i < 120 && window.BotDriver?.driverRealIndex?.() != null; i++) await sleep(250);
            realIndex = Number.isInteger(mySeat?.index) ? mySeat.index : S.myPlayerIndex;
            myPlayerIndex = -1;
            isHost = false;
            let n = 0;
            for (const mv of data.moves) {
                n++;
                if (SKIP_EVENTS.has(mv.event)) continue;
                if (mv.event === 'emoji' && BRAIN_EMOJIS.has(mv.payload?.display)) continue;
                const before = S.currentTurnNumber;
                window.GamePause?.dispatch?.(mv.event, mv.payload || {});
                // Some handlers finish on a short timer (as the replay checker waits).
                await sleep(S.currentTurnNumber !== before ? 40 : 4);
                if (n % 50 === 0) overlay(`Rebuilding the board... ${Math.round(100 * n / data.moves.length)}%`);
            }
            await sleep(800);
            // 4. Your seat back.
            myPlayerIndex = realIndex;
            isHost = true;
            try { window.BotSystem?.resetMemory?.(); } catch (e) {}
            try { window.BotDiplomacy?.reset?.(); } catch (e) {}
            if (S.activePlayerIndex === realIndex) {
                const st = data.state || {};
                currentAP = Number.isFinite(st.ap) ? st.ap : 5;
                try { if (typeof refreshVoidAP === 'function') refreshVoidAP(); } catch (e) {}
                try {
                    if (Number.isFinite(st.void_ap) && st.void_ap < voidAP) {
                        voidAP = st.void_ap;
                        const vd = document.getElementById('void-ap-display');
                        if (vd) { vd.textContent = `(+${voidAP} Void AP)`; vd.style.display = voidAP > 0 ? 'inline' : 'none'; }
                    }
                } catch (e) {}
                const apEl = document.getElementById('ap-count');
                if (apEl) apEl.textContent = currentAP;
            }
            // The screen was drawn for the spectator seat (-1) while rebuilding:
            // the stone counters showed that empty seat's pool (all 0) and stayed
            // that way. Drop that pool and redraw everything for your seat.
            try { if (typeof playerPools !== 'undefined') delete playerPools[-1]; } catch (e) {}
            try {
                if (typeof window.updateStoneCount === 'function') ['earth', 'water', 'fire', 'wind', 'void'].forEach(t => window.updateStoneCount(t));
                if (typeof updateHUD === 'function') updateHUD();
                window.ScrollPanelSystem?.refresh?.();
                if (typeof updateOpponentPanel === 'function') updateOpponentPanel();
            } catch (e) { log('redraw after rebuild failed', e); }
            try { turnStartedAtMs = window.serverNow(); } catch (e) {}
            try { if (typeof updateEndTurnButtonVisibility === 'function') updateEndTurnButtonVisibility(); } catch (e) {}
            try { if (typeof persistCurrentTurnIndex === 'function') persistCurrentTurnIndex(S.activePlayerIndex); } catch (e) {}
            // 5. Same board as when saved?
            const fp = window.MatchWitness?.fingerprint?.() || null;
            if (data.fingerprint && fp && fp !== data.fingerprint) {
                log('fingerprint mismatch', fp, data.fingerprint);
                throw new Error('the rebuilt board does not match the save');
            }
            // 6. The new match takes over the old moves; the save is used up.
            for (let i = 0; i < 40 && !window.MatchRecorder?.matchId?.(); i++) await sleep(250);
            const { error } = await S.supabase.rpc('resume_saved_game_started', { p_new_room: S.currentGameId });
            if (error) log('resume_saved_game_started failed:', error.message);
            saved = null;
            rebuilding = false;
            overlay(null);
            if (typeof updateStatus === 'function') updateStatus(S.activePlayerIndex === realIndex ? 'Welcome back! It is your turn.' : 'Welcome back!');
            window.gami?.notify?.('Welcome back! Your saved game continues.', 0, 'gold');
        } catch (e) {
            rebuilding = false;
            if (realIndex != null) { try { myPlayerIndex = realIndex; isHost = true; } catch (err) {} }
            overlay(null);
            alert('Could not continue the saved game: ' + (e?.message || e) + '. Your save is kept.');
            try { if (typeof _doLeaveGame === 'function') await _doLeaveGame(); } catch (err) {}
        }
    }

    // ------------------------------------------------------------ timers
    setInterval(() => {
        try { updateButton(); } catch (e) {}
        try {
            if (Date.now() - lastCardPoll > 20000 && (!inGame() || !serverReady) && window.gami?.userId) refreshCard();
            else renderCard();
        } catch (e) {}
    }, 1000);

    window.SaveGame = { isRebuilding: () => rebuilding, canSave: () => !whyNot(), whyNot, saveAndQuit, resume, refreshCard };
})();
