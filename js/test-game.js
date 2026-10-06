// test-game.js: online test games (window.TestGame).
//
// A test room (game_room.test_mode, sql/test-games.sql) is a normal online
// game in which bots play every seat. Human seats are played by a bot in that
// player's own browser ("autopilot"), bot seats by the host as usual
// (bot-driver.js). So the game runs over the real network, Supabase Realtime,
// presence, the pause / catch-up code (game-pause.js) and real browsers.
//
// In a test game every browser also:
//   * keeps the screen on (Screen Wake Lock; also used in every online game),
//   * now and then causes mild trouble on purpose ("chaos"): a short fake drop
//     (the Realtime socket is closed and kept down for 5-20 s, so the real
//     drop, pause and catch-up code runs) or a slow link (outgoing messages
//     held 0.5-3 s for one turn, order kept). Only one browser at a time.
//   * counts what happens (pauses, drops, messages, lag, errors, hidden tab)
//     and sends a report at the end: report_test_run. When 2+ signed-in
//     players of the game have reported, each gets the test reward (gold).
//
// The game ends at a win or after TURN_CAP turns. "Stop test" leaves early
// (the report is still sent). tools/online-test.mjs runs test games from a
// PC with several browser windows, no players needed.
(function () {
    'use strict';

    const TURN_CAP = 80;
    const CHAOS_PERIOD = 8;            // turns between chaos slots
    const DROP_MS = [5000, 20000];
    const SLOW_MS = [500, 3000];
    const TICK_MS = 700;

    // lobby.js / game-core.js / multiplayer-state.js keep their state in
    // script-level bindings (not on window); read them safely (as game-pause.js).
    const S = {
        get isMultiplayer() { try { return isMultiplayer; } catch (e) { return false; } },
        get currentGameId() { try { return currentGameId; } catch (e) { return null; } },
        get myPlayerIndex() { try { return myPlayerIndex; } catch (e) { return null; } },
        get activePlayerIndex() { try { return activePlayerIndex; } catch (e) { return null; } },
        get isHost() { try { return isHost; } catch (e) { return false; } },
        get allPlayersData() { try { return allPlayersData; } catch (e) { return []; } },
        get currentTurnNumber() { try { return currentTurnNumber; } catch (e) { return 0; } },
        get isPlacementPhase() { try { return isPlacementPhase; } catch (e) { return false; } },
        get playerTilesPlaced() { try { return playerTilesPlaced; } catch (e) { return null; } },
        get supabase() { try { return supabase; } catch (e) { return null; } },
    };
    const g = (name) => S[name];
    const rand = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
    // Pixel emote (Hammer, sheet cell 70) used as the test game icon.
    const icon = (scale) => window.emojiSystem?.spriteHtml?.(70, scale) || '';
    const log = (...a) => console.log('[TestGame]', ...a);

    let settings = null;               // get_test_settings()
    let active = false;                // this browser is in a running test game
    let roomId = null;
    let checkedKey = null;             // game we already looked up test_mode for
    let stats = null;
    let reported = false;
    let busy = false;
    let lastTurnKey = null;
    let placedTile = false;
    let lastTurnSeen = -1;
    let chaosNow = null;               // { type, until }
    let slowUntil = 0, slowDelay = 0, sendChain = Promise.resolve(), pendingSlow = 0;
    let pausedSince = 0;
    let hiddenSince = 0;
    let wakeLock = null, wakeState = 'off';
    let stopForced = false;

    // ---------------------------------------------------------------- helpers
    const inGame = () => document.getElementById('game-layout')?.classList.contains('active');
    const online = () => !!g('isMultiplayer') && g('currentGameId') != null;
    // While the host drives a bot seat, bot-driver.js swaps myPlayerIndex to the
    // bot's seat; the real seat is BotDriver.driverRealIndex() then (without
    // this the autopilot took bot turns for its own and pressed End Turn).
    const me = () => { const r = window.BotDriver?.driverRealIndex?.(); return r != null ? r : g('myPlayerIndex'); };
    const turnNo = () => g('currentTurnNumber') || 0;
    const sb = () => g('supabase');
    const humanSeats = () => (g('allPlayersData') || [])
        .filter(p => !(window.isBotUsername?.(p.username)))
        .map(p => p.player_index).filter(i => typeof i === 'number').sort((a, b) => a - b);

    function newStats() {
        return {
            v: 1, game_version: window.GAME_VERSION || null, ua: navigator.userAgent.slice(0, 200),
            seat: me(), players: (g('allPlayersData') || []).length, humans: humanSeats().length,
            started_at: new Date().toISOString(), result: null, winner: null, turns: 0,
            chaos: [], pauses: 0, paused_ms: 0, self_drops: 0, self_back: 0, peer_drops: 0, peer_back: 0,
            sent: 0, received: 0, sent_by_event: {}, lag: { n: 0, sum: 0, max: 0, over2s: 0 },
            errors: 0, error_texts: [], hidden_ms: 0, hidden_count: 0, wake_lock: wakeState,
            quality: {}, turns_played: 0, forced_end_turns: 0, autopilot_errors: 0,
        };
    }
    function note(field, n = 1) { if (stats) stats[field] = (stats[field] || 0) + n; }
    function noteError(text) {
        if (!stats) return;
        stats.errors++;
        if (stats.error_texts.length < 20) stats.error_texts.push(String(text).slice(0, 300));
    }

    async function loadSettings() {
        try {
            const { data } = await sb().rpc('get_test_settings');
            if (data) settings = data;
        } catch (e) { /* offline: keep the last value */ }
        return settings;
    }

    // --------------------------------------------------------------- wake lock
    // Every online game: keep the screen from dimming (phones and laptops
    // suspend the page when the screen sleeps, which drops the connection).
    async function wantWake(on) {
        if (!('wakeLock' in navigator)) { wakeState = 'unsupported'; return; }
        if (on && !wakeLock && document.visibilityState === 'visible') {
            try {
                wakeLock = await navigator.wakeLock.request('screen');
                wakeState = 'on';
                wakeLock.addEventListener('release', () => { wakeLock = null; if (wakeState === 'on') wakeState = 'released'; });
            } catch (e) { wakeState = 'denied'; }
        } else if (!on && wakeLock) {
            try { await wakeLock.release(); } catch (e) {}
            wakeLock = null; wakeState = 'off';
        }
    }

    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            hiddenSince = Date.now();
            if (stats) stats.hidden_count++;
        } else {
            if (hiddenSince && stats) stats.hidden_ms += Date.now() - hiddenSince;
            hiddenSince = 0;
            if (inGame() && online()) wantWake(true);
            if (active) toast('Test game: welcome back. Please keep this tab in front while the test runs.');
        }
    });

    // ------------------------------------------------------------- hooks
    // Count and (during "slow link" chaos) delay outgoing game messages.
    // broadcastGameAction is a top-level function of lobby.js, so replacing
    // window.broadcastGameAction changes what every caller gets.
    function patchBroadcast() {
        const orig = window.broadcastGameAction;
        if (typeof orig !== 'function' || orig.__testGame) return;
        const wrapped = function (event, payload) {
            if (active && payload && typeof payload === 'object') {
                if (typeof window.serverNow === 'function') payload._st = window.serverNow();
                if (stats) { stats.sent++; stats.sent_by_event[event] = (stats.sent_by_event[event] || 0) + 1; }
            }
            if (active && (Date.now() < slowUntil || pendingSlow > 0)) {
                // Each message leaves `slowDelay` after it was sent, never before an
                // earlier one (order kept, delays do not pile up).
                const args = arguments;
                const due = Date.now() + (Date.now() < slowUntil ? slowDelay : 0);
                pendingSlow++;
                sendChain = sendChain.then(() => new Promise(r => setTimeout(r, Math.max(0, due - Date.now()))))
                    .then(() => orig.apply(null, args)).finally(() => { pendingSlow--; });
                return;
            }
            return orig.apply(this, arguments);
        };
        wrapped.__testGame = true;
        window.broadcastGameAction = wrapped;
    }

    // Incoming messages (lobby.js calls window.GamePause.note for each one)
    // and the pause system's drop / back events.
    function patchPause() {
        const gp = window.GamePause;
        if (!gp || gp.__testGame) return;
        gp.__testGame = true;
        const wrap = (name, fn) => {
            const orig = gp[name];
            if (typeof orig !== 'function') return;
            gp[name] = function () { try { if (active) fn.apply(null, arguments); } catch (e) {} return orig.apply(this, arguments); };
        };
        wrap('note', (event, p) => {
            note('received');
            if (p && typeof p._st === 'number' && typeof window.serverNow === 'function') {
                const lag = Math.max(0, window.serverNow() - p._st);
                const L = stats.lag; L.n++; L.sum += lag; if (lag > L.max) L.max = lag; if (lag > 2000) L.over2s++;
            }
        });
        wrap('selfDown', () => note('self_drops'));
        wrap('selfUp', () => note('self_back'));
        wrap('peerLeft', () => note('peer_drops'));
        wrap('peerJoined', () => note('peer_back'));
    }

    // Take Flight aimed at my seat: the target picks the landing hex. On
    // autopilot pick one at random (bot-driver.js does the same for bots).
    function patchTakeFlight() {
        const se = window.spellSystem?.scrollEffects;
        if (!se || se.__testGame || typeof se.enterTakeFlightChoiceAsTarget !== 'function') return;
        se.__testGame = true;
        const orig = se.enterTakeFlightChoiceAsTarget;
        se.enterTakeFlightChoiceAsTarget = function (casterIndex, targetIndex, scrollName) {
            if (active && targetIndex === me()) {
                const c = this.getValidTakeFlightDestinations(targetIndex) || [];
                if (!c.length) {
                    window.broadcastGameAction?.('take-flight-cancel-request', { casterIndex, targetPlayerIndex: targetIndex });
                    return;
                }
                const d = c[Math.floor(Math.random() * c.length)];
                return this.finalizeTakeFlightChoice(casterIndex, targetIndex, scrollName, d.x, d.y);
            }
            return orig.apply(this, arguments);
        };
    }

    window.addEventListener('error', (e) => { if (active) noteError(e.message || e.error); });
    window.addEventListener('unhandledrejection', (e) => { if (active) noteError('promise: ' + (e.reason?.message || e.reason)); });
    const origConsoleError = console.error;
    console.error = function () {
        try { if (active) noteError(Array.from(arguments).map(a => (a && a.message) || String(a)).join(' ')); } catch (e) {}
        return origConsoleError.apply(console, arguments);
    };

    // ------------------------------------------------------------- chaos
    // One browser at a time: chaos slot k (every CHAOS_PERIOD turns) belongs
    // to the k-th human seat in turn, so two browsers never misbehave at once.
    function chaosOff() { try { return localStorage.getItem('godaigo_test_chaos') === 'off'; } catch (e) { return false; } }
    function maybeChaos(turn) {
        if (!active || chaosNow || chaosOff() || turn < 4 || turn % CHAOS_PERIOD !== 3) return;
        const humans = humanSeats();
        if (!humans.length) return;
        const slot = Math.floor(turn / CHAOS_PERIOD) % humans.length;
        if (humans[slot] !== me()) return;
        if (Math.random() < 0.5) fakeDrop(rand(DROP_MS[0], DROP_MS[1]), turn);
        else slowLink(rand(SLOW_MS[0], SLOW_MS[1]), turn);
    }

    // Close the Realtime socket the way a real network drop does (its close
    // handler runs: channels error, lobby.js reconnects, game-pause.js pauses
    // and later catches up) and keep it down for `ms`.
    function fakeDrop(ms, turn) {
        const rt = sb()?.realtime;
        if (!rt || !rt.conn || typeof rt.connect !== 'function') { slowLink(rand(SLOW_MS[0], SLOW_MS[1]), turn); return; }
        log(`chaos: fake drop for ${ms} ms (turn ${turn})`);
        stats.chaos.push({ type: 'drop', turn, ms });
        chaosNow = { type: 'drop', until: Date.now() + ms };
        const origConnect = rt.connect;
        rt.connect = function () { /* kept down by the test */ };
        try { rt.conn.close(); } catch (e) {}
        setTimeout(() => {
            rt.connect = origConnect;
            try { rt.connect(); } catch (e) {}
            chaosNow = null;
            log('chaos: drop over');
        }, ms);
    }

    function slowLink(ms, turn) {
        log(`chaos: slow link ${ms} ms for one turn (turn ${turn})`);
        stats.chaos.push({ type: 'slow', turn, ms });
        slowDelay = ms;
        slowUntil = Date.now() + 25000;   // about one turn
        chaosNow = { type: 'slow', until: slowUntil };
        setTimeout(() => { chaosNow = null; }, 25000);
    }

    // ------------------------------------------------------------- autopilot
    function respond() {
        const rw = window.spellSystem?.responseWindow;
        const i = me();
        if (!rw || !rw.isResponseWindowOpen || typeof i !== 'number') return;
        if (rw.currentCaster === i || rw.respondingPlayers?.has(i)) return;
        try { window.BotEffects?.decideResponse?.(i, rw.currentCaster); }
        catch (e) { note('autopilot_errors'); noteError('respond: ' + e.message); }
    }

    async function playTurn() {
        const i = me();
        const key = turnNo() + ':' + i;
        if (lastTurnKey === key) return;
        lastTurnKey = key;
        busy = true;
        try {
            await new Promise(r => setTimeout(r, 900));      // let turn-change effects settle
            if (!active || g('activePlayerIndex') !== i) return;
            await window.BotSystem.turn();
            note('turns_played');
            if (active && g('activePlayerIndex') === i && turnNo() + ':' + i === key && !window.isGamePaused?.()) {
                const btn = document.getElementById('end-turn');
                if (btn && !btn.disabled) { note('forced_end_turns'); btn.click(); }
            }
        } catch (e) {
            note('autopilot_errors'); noteError('turn: ' + e.message);
        } finally { busy = false; }
    }

    function tick() {
        const playing = inGame() && online();
        wantWake(playing);

        // a new game: is it a test room?
        if (playing) {
            const key = g('currentGameId') + ':' + (window.MatchRecorder?.matchId?.() || '') + ':' + humanSeats().join(',');
            if (key !== checkedKey) {
                checkedKey = key;
                const id = g('currentGameId');
                sb().from('game_room').select('test_mode').eq('id', id).maybeSingle().then(({ data }) => {
                    if (data?.test_mode && !active && inGame()) start(id);
                }).catch(() => {});
            }
        } else if (active) {
            finish('left');
        } else if (!inGame()) {
            checkedKey = null;
        }
        if (!active) return;

        // stats that need sampling
        const paused = !!window.isGamePaused?.();
        if (paused && !pausedSince) { pausedSince = Date.now(); stats.pauses++; }
        if (!paused && pausedSince) { stats.paused_ms += Date.now() - pausedSince; pausedSince = 0; }
        const q = window.ConnectionMonitor?.getStatus?.().quality || 'unknown';
        stats.quality[q] = (stats.quality[q] || 0) + 1;

        const turn = turnNo();
        if (turn !== lastTurnSeen) { lastTurnSeen = turn; stats.turns = turn; maybeChaos(turn); }
        if (turn >= TURN_CAP) { finish('turn cap'); return; }
        if (paused || stopForced) return;

        respond();
        if (busy) return;
        const i = me();
        if (typeof i !== 'number' || g('activePlayerIndex') !== i) return;
        if (g('isPlacementPhase')) {
            const placed = g('playerTilesPlaced');
            if (placedTile || (placed && placed.has && placed.has(i))) return;
            placedTile = true;
            setTimeout(() => { try { window.BotSystem.step(); } catch (e) { noteError('place: ' + e.message); } }, 800);
            return;
        }
        playTurn();
    }

    // ------------------------------------------------------------- quiet mode
    // While a test game runs in this browser it plays like the training tools:
    // no "Out of AP, end your turn?" prompt (it blocked the autopilot), no sound,
    // music or CRT effects, and faster bots (BotSystem.speedScale, which also
    // drives the host's bot seats). Everything comes back when the test ends.
    // localStorage godaigo_test_speed: 'normal' keeps the usual pace, a number
    // sets the scale (default 0.25).
    let restoreQuiet = null;
    function quietOn() {
        if (restoreQuiet) return;
        const saved = {
            prompt: window.showEndTurnPrompt,
            sound: window.SoundSystem,
            speed: window.BotSystem?.speedScale,
            crt: window.crtOverlay?.getOptions?.() || null,
        };
        window.showEndTurnPrompt = () => {};
        document.getElementById('end-turn-empty-ap-modal')?.remove();
        window.SoundSystem = null;
        try { window.JoytoneBridge?.setSuppressed?.(true); } catch (e) {}
        if (saved.crt) Object.keys(saved.crt).forEach(k => window.crtOverlay.setOption(k, false));
        let speed = 0.25;
        try {
            const v = localStorage.getItem('godaigo_test_speed');
            if (v === 'normal') speed = null; else if (v && isFinite(+v)) speed = Math.max(0.05, Math.min(1, +v));
        } catch (e) {}
        if (speed != null && window.BotSystem) window.BotSystem.speedScale = speed;
        restoreQuiet = () => {
            if (window.showEndTurnPrompt !== saved.prompt) window.showEndTurnPrompt = saved.prompt;
            window.SoundSystem = saved.sound;
            try { window.JoytoneBridge?.setSuppressed?.(false); } catch (e) {}
            if (saved.crt) Object.keys(saved.crt).forEach(k => window.crtOverlay.setOption(k, saved.crt[k]));
            if (window.BotSystem && saved.speed != null) window.BotSystem.speedScale = saved.speed;
        };
    }
    function quietOff() {
        const r = restoreQuiet;
        restoreQuiet = null;
        if (r) { try { r(); } catch (e) { log('restore failed', e); } }
    }

    // ------------------------------------------------------------- lifecycle
    function start(id) {
        active = true; reported = false; roomId = id; stopForced = false;
        busy = false; lastTurnKey = null; placedTile = false; lastTurnSeen = -1;
        chaosNow = null; slowUntil = 0; pausedSince = 0;
        stats = newStats();
        stats.wake_lock = wakeState;
        patchBroadcast(); patchPause(); patchTakeFlight();
        quietOn();
        log('test game started in room', id);
        showBar();
        toast('Test game: bots play every seat. Keep this tab open and in front until it ends.');
    }

    async function finish(result, winner) {
        if (!active) return;
        active = false;
        quietOff();
        if (pausedSince) { stats.paused_ms += Date.now() - pausedSince; pausedSince = 0; }
        if (hiddenSince) { stats.hidden_ms += Date.now() - hiddenSince; hiddenSince = Date.now(); }
        stats.result = result;
        stats.winner = (typeof winner === 'number') ? winner : null;
        stats.turns = Math.max(stats.turns, turnNo());
        stats.ended_at = new Date().toISOString();
        stats.wake_lock = wakeState;
        hideBar();
        log('test game finished:', result, stats);
        if (reported) return;
        reported = true;
        let res = null;
        try {
            const r = await sb().rpc('report_test_run', { p_room: roomId, p_stats: stats });
            if (r.error) throw r.error;
            res = r.data;
        } catch (e) {
            res = { error: e.message || String(e) };
        }
        window.TestGame.lastResult = res;
        window.TestGame.lastStats = stats;
        if (res?.error) toast('Test game report could not be sent: ' + res.error);
        else if (res?.my_gold > 0) toast(`Test game report sent. Thank you! +${res.my_gold} gold.`);
        else toast('Test game report sent. Thank you!' + (res?.reason ? ' (' + res.reason + ')' : ''));
        if (result === 'turn cap') {
            // Mark the recorded match finished (no winner), so it can be watched
            // and checked (match-recorder.js; only the recording host sends it).
            try { window.MatchRecorder?.finish?.(null, 'test_cap'); } catch (e) {}
            showDone();
        }
    }

    // ------------------------------------------------------------- UI
    function toast(text) {
        let t = document.getElementById('test-game-toast');
        if (!t) { t = document.createElement('div'); t.id = 'test-game-toast'; t.className = 'test-game-toast'; document.body.appendChild(t); }
        t.textContent = text;
        t.classList.add('show');
        clearTimeout(t._h);
        t._h = setTimeout(() => t.classList.remove('show'), 6000);
    }

    function showBar() {
        hideBar();
        const bar = document.createElement('div');
        bar.id = 'test-game-bar';
        bar.className = 'test-game-bar';
        bar.innerHTML = `<span>${icon(0.6)} Test game: bots are playing for everyone. Keep this tab open and in front.</span>
            <button type="button" id="test-game-stop">Stop test</button>`;
        document.body.appendChild(bar);
        bar.querySelector('#test-game-stop').onclick = async () => {
            if (!confirm('Stop the test and leave the game? Your report is sent now.')) return;
            stopForced = true;
            await finish('stopped');
            if (typeof window.leaveGame === 'function') window.leaveGame();
        };
    }
    function hideBar() { document.getElementById('test-game-bar')?.remove(); }

    function showDone() {
        const box = document.createElement('div');
        box.className = 'retro-dlg-overlay';
        box.innerHTML = `<div class="retro-dlg-box"><div class="retro-dlg-title">Test complete</div>
            <div class="retro-dlg-line">The test game reached ${TURN_CAP} turns. Thanks for helping!</div>
            <div class="retro-dlg-btns"><button type="button">Back to lobby</button></div></div>`;
        document.body.appendChild(box);
        box.querySelector('button').onclick = () => { box.remove(); window.leaveGame?.(); };
    }

    // Waiting room: host switch + banner for everyone.
    let lastRoomPoll = 0, roomTestMode = false;
    async function waitingRoomTick() {
        const panel = document.getElementById('waiting-room-panel');
        const visible = panel && panel.style.display !== 'none' && panel.offsetParent !== null;
        if (!visible || g('currentGameId') == null) return;
        if (!settings) await loadSettings();
        const id = g('currentGameId');
        if (Date.now() - lastRoomPoll > 3000) {
            lastRoomPoll = Date.now();
            try {
                const { data } = await sb().from('game_room').select('test_mode').eq('id', id).maybeSingle();
                roomTestMode = !!data?.test_mode;
            } catch (e) {}
        }
        // host switch
        const hostBox = document.getElementById('host-settings');
        if (hostBox && g('isHost') && settings?.enabled !== false) {
            let row = document.getElementById('test-mode-row');
            if (!row) {
                row = document.createElement('div');
                row.id = 'test-mode-row';
                row.className = 'test-mode-row';
                row.innerHTML = `<label><input type="checkbox" id="test-mode-toggle"> ${icon(0.6)} Test game: bots play every seat to find online bugs</label>`;
                hostBox.insertBefore(row, hostBox.firstChild);
                row.querySelector('input').addEventListener('change', async (e) => {
                    const on = e.target.checked;
                    const { error } = await sb().from('game_room').update({ test_mode: on }).eq('id', g('currentGameId'));
                    if (error) { e.target.checked = !on; alert('Could not change the test setting: ' + error.message); return; }
                    roomTestMode = on; lastRoomPoll = Date.now(); renderBanner(panel);
                });
            }
            const box = row.querySelector('input');
            if (document.activeElement !== box) box.checked = roomTestMode;
        }
        renderBanner(panel);
    }
    function renderBanner(panel) {
        let b = document.getElementById('test-game-room-banner');
        if (!roomTestMode) { b?.remove(); return; }
        if (!b) {
            b = document.createElement('div');
            b.id = 'test-game-room-banner';
            b.className = 'test-game-room-banner';
            const info = document.getElementById('room-info-bar');
            if (info && info.parentNode) info.parentNode.insertBefore(b, info.nextSibling); else panel.appendChild(b);
        }
        const gold = settings?.gold ?? 150, cap = settings?.max_per_day ?? 2;
        b.innerHTML = `${icon(0.6)} <b>Test game</b>: bots play every seat (yours too) over the real network to find online bugs. ` +
            `Keep this tab open and in front until it ends. When 2 signed-in players finish a test game, each gets <b>+${gold} gold</b> (up to ${cap} a day).`;
    }

    // ------------------------------------------------------------- hermit panel
    // Hermit menu "Test games": reward settings and the reports, problems first.
    const esc = (t) => String(t ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    let hermitPanel = null;
    function closeHermit() { hermitPanel?.remove(); hermitPanel = null; }

    function summarize(row) {
        const reps = row.reports || [];
        const sum = (k) => reps.reduce((a, r) => a + (Number(r.stats?.[k]) || 0), 0);
        const lagMax = Math.max(0, ...reps.map(r => Number(r.stats?.lag?.max) || 0));
        const chaos = reps.reduce((a, r) => a + ((r.stats?.chaos || []).length), 0);
        const results = [...new Set(reps.map(r => r.stats?.result).filter(Boolean))];
        const problems = [];
        if (row.desync_count > 0) problems.push(`${row.desync_count} board mismatch${row.desync_count > 1 ? 'es' : ''}`);
        if (row.check_status && row.check_status !== 'ok') problems.push('replay check: ' + row.check_status);
        if (sum('errors') > 0) problems.push(`${sum('errors')} page error(s)`);
        if (sum('autopilot_errors') > 0) problems.push(`${sum('autopilot_errors')} autopilot error(s)`);
        if (results.includes('stopped') || results.includes('left')) problems.push('stopped early');
        if (reps.length < 2) problems.push('only ' + reps.length + ' report');
        if (lagMax > 10000) problems.push(`lag up to ${(lagMax / 1000).toFixed(0)} s`);
        return { reps, chaos, lagMax, results, problems, pauses: sum('pauses'), drops: sum('self_drops'), hidden: sum('hidden_ms') };
    }

    async function openHermit() {
        if (typeof window.isHermit !== 'function' || !window.isHermit()) return;
        closeHermit();
        await loadSettings();
        hermitPanel = document.createElement('div');
        hermitPanel.id = 'hermit-tests-panel';
        const s0 = settings || { enabled: true, gold: 150, max_per_day: 2, min_turns: 20 };
        hermitPanel.innerHTML = `
            <div class="hr-head"><b>Test games</b><button class="hr-x" title="Close">✕</button></div>
            <div class="hr-body">
                <div class="hr-section">
                    <div class="hr-label">Reward</div>
                    <label class="hr-row"><input type="checkbox" class="tg-enabled" ${s0.enabled ? 'checked' : ''}> Test rooms on, reward paid</label>
                    <div class="hr-row"><span>Gold each</span><input class="tg-gold" type="number" min="0" max="2000" value="${s0.gold}"></div>
                    <div class="hr-row"><span>Max a day</span><input class="tg-max" type="number" min="0" max="20" value="${s0.max_per_day}"></div>
                    <div class="hr-row"><span>Min turns</span><input class="tg-min" type="number" min="1" max="500" value="${s0.min_turns}"></div>
                    <button class="tg-save">Save</button> <span class="tg-saved"></span>
                </div>
                <div class="hr-section">
                    <div class="hr-label">Reports (last 14 days, problems first)</div>
                    <div class="tg-list">Loading...</div>
                </div>
            </div>`;
        document.body.appendChild(hermitPanel);
        hermitPanel.querySelector('.hr-x').onclick = closeHermit;
        hermitPanel.querySelector('.tg-save').onclick = async () => {
            const v = (c) => parseInt(hermitPanel.querySelector(c).value, 10);
            const { data, error } = await sb().rpc('hermit_set_test_settings', {
                p_enabled: hermitPanel.querySelector('.tg-enabled').checked,
                p_gold: v('.tg-gold'), p_max_per_day: v('.tg-max'), p_min_turns: v('.tg-min'),
            });
            hermitPanel.querySelector('.tg-saved').textContent = error ? 'Error: ' + error.message : 'Saved';
            if (data) settings = data;
        };
        renderReports();
    }

    async function renderReports() {
        const list = hermitPanel?.querySelector('.tg-list');
        if (!list) return;
        const { data, error } = await sb().rpc('hermit_test_reports', { p_days: 14 });
        if (error) { list.textContent = 'Error: ' + error.message; return; }
        const rows = (data || []).map(r => ({ r, s: summarize(r) }))
            .sort((a, b) => (b.s.problems.length > 0) - (a.s.problems.length > 0) || new Date(b.r.started_at) - new Date(a.r.started_at));
        if (!rows.length) { list.textContent = 'No test games yet.'; return; }
        list.innerHTML = rows.map(({ r, s }) => `
            <div class="tg-report ${s.problems.length ? 'tg-bad' : 'tg-ok'}">
                <div><b>Match ${r.match_id}</b> · ${new Date(r.started_at).toLocaleString()} · ${r.turns ?? 0} turns · ${esc(r.status)}</div>
                <div>${esc(s.reps.map(x => x.name || 'player').join(', '))} · paid ${r.paid}</div>
                <div>Chaos ${s.chaos} · pauses ${s.pauses} · own drops ${s.drops} · lag max ${(s.lagMax / 1000).toFixed(1)} s · hidden ${(s.hidden / 1000).toFixed(0)} s</div>
                <div class="tg-problems">${s.problems.length ? (window.emojiSystem?.spriteHtml?.(0, 0.5) || '') + ' ' + esc(s.problems.join('; ')) : (window.emojiSystem?.spriteHtml?.(96, 0.5) || '') + ' no problems seen'}</div>
                <div class="tg-btns">
                    <button data-watch="${r.match_id}">Watch</button>
                    <button data-check="${r.match_id}">Check replay</button>
                    <button data-more="${r.match_id}">Details</button>
                </div>
                <pre class="tg-more" data-for="${r.match_id}" hidden>${esc(JSON.stringify(s.reps.map(x => ({ name: x.name, stats: x.stats })), null, 1))}</pre>
            </div>`).join('');
        list.querySelectorAll('[data-watch]').forEach(b => b.onclick = () => { closeHermit(); window.Replay?.open?.(Number(b.dataset.watch)); });
        list.querySelectorAll('[data-check]').forEach(b => b.onclick = async () => {
            b.disabled = true; b.textContent = 'Checking...';
            try { await window.Replay?.checkMatch?.(Number(b.dataset.check)); } catch (e) {}
            renderReports();
        });
        list.querySelectorAll('[data-more]').forEach(b => b.onclick = () => {
            const pre = list.querySelector(`.tg-more[data-for="${b.dataset.more}"]`);
            if (pre) pre.hidden = !pre.hidden;
        });
    }

    setInterval(() => { try { tick(); } catch (e) { console.warn('TestGame tick:', e); } }, TICK_MS);
    setInterval(() => { waitingRoomTick().catch(() => {}); }, 1000);
    setTimeout(loadSettings, 3000);

    window.TestGame = {
        isActive: () => active,
        openHermit,
        onGameOver(winner, winType) { if (active) finish('win:' + (winType || 'scrolls'), winner); },
        settings: () => settings,
        loadSettings,
        stats: () => stats,
        lastResult: null,
        lastStats: null,
        // for tools/online-test.mjs and the local harness
        _fakeDrop: (ms) => fakeDrop(ms, turnNo()),
        _slowLink: (ms) => slowLink(ms, turnNo()),
        TURN_CAP,
    };
})();
