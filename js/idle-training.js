// Idle training screensaver (owner 2026-10-09; sql/idle-training.sql).
//
// When a signed-in player leaves the lobby alone for a few minutes, this browser
// plays watchable bot games (challenger vs champion, 2 players) for a COMMUNAL
// training run. Everyone idling works on the same shared list of challengers
// ("pooled climb"), so nobody has to finish a run alone:
//   idle_training_job()     -> the champion + an open challenger to test (or none)
//   idle_training_new()     -> a new challenger, 'explore' or 'formula' (random)
//   idle_training_report()  -> one finished game; the server adds up everyone's
//                              games and promotes or drops the challenger.
// Games run as an audience view: hands hidden, scoreboard, follow camera
// (Spectate.showLocal), sound off. Any key, click, wheel or real mouse move
// stops it and reloads back to the lobby (a game cut short is not reported).
// Settings > Display "Idle Training" (localStorage godaigo_idle_training = 'off').
(function () {
    'use strict';
    const KEY = 'godaigo_idle_training';
    const IDLE_MS = (() => {
        try { const m = +localStorage.getItem('godaigo_idle_minutes'); if (m > 0) return m * 60000; } catch (e) {}
        return 3 * 60000;
    })();
    const sb = () => { try { return supabase; } catch (e) { return null; } };
    const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

    const FAST_SPEED = 0.1;          // pause between bot actions, x of Watchable (1)
    let lastInput = Date.now(), lastX = null, lastY = null;
    let run = null;                 // { job, cand, champion, stopping }
    let backoffUntil = 0;

    function enabled() {
        try { return localStorage.getItem(KEY) !== 'off'; } catch (e) { return true; }
    }
    function setEnabled(on) {
        try { localStorage.setItem(KEY, on ? 'on' : 'off'); } catch (e) {}
        lastInput = Date.now();
    }

    // ── Input: any of it wakes the screen ─────────────────────────
    function onInput(e) {
        if (e.type === 'pointermove' || e.type === 'mousemove') {
            if (lastX === null) { lastX = e.clientX; lastY = e.clientY; return; }
            if (Math.hypot(e.clientX - lastX, e.clientY - lastY) < 12) return;   // hand on the desk, not a move
            lastX = e.clientX; lastY = e.clientY;
        }
        lastInput = Date.now();
        if (run && !run.stopping) wake();
        // back before the idle run started: straight back to the saved game
        else if (!run && flag(FLAG_RESUME) && !gameSaving && inLobby()) resumeSavedGame();
    }
    ['pointermove', 'pointerdown', 'keydown', 'wheel', 'touchstart'].forEach(t =>
        window.addEventListener(t, onInput, { capture: true, passive: true }));

    // ── When may it start ─────────────────────────────────────────
    function shown(id) {
        const el = document.getElementById(id);
        return !!el && el.style.display !== 'none' && getComputedStyle(el).display !== 'none';
    }
    function inLobby() {
        try {
            if (!shown('lobby-wrapper') || !shown('multiplayer-lobby') || shown('waiting-room-panel')) return false;
            if (document.getElementById('game-layout')?.classList.contains('active')) return false;
            if (typeof currentGameId !== 'undefined' && currentGameId != null) return false;
            if (window.isTutorialMode) return false;
            // a pop-up the player left open (profile, shop, replays, training...)
            if (document.querySelector('.retro-dlg-overlay, .gami-overlay, #training-popup, #stress-test-status')) return false;
            if (window.BotArena?.isRunning?.() || window.Spectate?.isWatching?.()) return false;
            return true;
        } catch (e) { return false; }
    }
    function signedIn() { return !!(window.gami?.userId); }

    // ── Idle in a game against bots (owner 2026-10-10) ────────────
    // Longer wait (10 min). Your turn, a game you could save (js/save-game.js):
    // save it quietly, leave, start idle training at once; waking up loads the
    // saved game again (sessionStorage flags survive the reloads).
    const IDLE_GAME_MS = (() => {
        try { const m = +localStorage.getItem('godaigo_idle_game_minutes'); if (m > 0) return m * 60000; } catch (e) {}
        return 10 * 60000;
    })();
    const FLAG_START = 'godaigo_idle_start_now', FLAG_RESUME = 'godaigo_idle_resume_game', FLAG_WAKE = 'godaigo_idle_woke';
    const flag = (k, v) => { try { if (v === undefined) return sessionStorage.getItem(k) === '1'; if (v) sessionStorage.setItem(k, '1'); else sessionStorage.removeItem(k); } catch (e) {} return false; };
    let gameSaving = false;
    setInterval(async () => {
        if (run || gameSaving || !enabled() || document.hidden || !signedIn() || Date.now() < backoffUntil) return;
        if (Date.now() - lastInput < IDLE_GAME_MS) return;
        if (!window.SaveGame?.canSave?.()) return;
        gameSaving = true;
        flag(FLAG_START, true); flag(FLAG_RESUME, true);
        try { sessionStorage.setItem('godaigo_skip_intro_once', '1'); } catch (e) {}
        let ok = false;
        try { ok = await window.SaveGame.saveAndQuit({ quiet: true }); } catch (e) {}
        if (!ok) { flag(FLAG_START, false); flag(FLAG_RESUME, false); backoffUntil = Date.now() + 10 * 60000; lastInput = Date.now(); }
        gameSaving = false;
    }, 5000);
    // Back in the lobby after an idle save: start right away.
    setInterval(() => {
        if (!flag(FLAG_START) || run || !signedIn() || !inLobby()) return;
        flag(FLAG_START, false);
        lastInput = 0;
    }, 1000);
    // Woke up from an idle run that saved a game (or before it started):
    // continue that game. One attempt, then the flags are gone.
    let resuming = false;
    async function resumeSavedGame() {
        if (resuming) return;
        resuming = true;
        flag(FLAG_RESUME, false); flag(FLAG_WAKE, false); flag(FLAG_START, false);
        for (let i = 0; i < 120; i++) {           // up to 2 min for sign-in and the lobby
            if (signedIn() && inLobby() && window.SaveGame?.resume) break;
            await new Promise(r => setTimeout(r, 1000));
        }
        if (!signedIn() || !inLobby()) { resuming = false; return; }
        lastInput = Date.now();
        try { await window.SaveGame.refreshCard?.(); await window.SaveGame.resume(); }
        catch (e) { console.warn('[idle] could not continue the saved game', e); }
        resuming = false;
    }
    if (flag(FLAG_WAKE)) resumeSavedGame();

    setInterval(() => {
        if (run || !enabled() || document.hidden || Date.now() < backoffUntil) return;
        if (Date.now() - lastInput < IDLE_MS) return;
        if (!signedIn() || !inLobby()) return;
        start().catch(err => { console.warn('[idle] could not start', err); backoffUntil = Date.now() + 10 * 60000; cleanupFailed(); });
    }, 5000);

    // ── The run ───────────────────────────────────────────────────
    async function getJob() {
        const { data, error } = await sb().rpc('idle_training_job');
        if (error) throw error;
        let cand = data.candidate;
        if (!cand) {
            // 'imitation': the champion plus "Learn from my play" adjustments
            // (js/bot-imitation.js), when this browser has any. The server keeps
            // one open per champion and never retests the same adjustments.
            const d = window.BotImitation?.getDeltas?.() || {};
            const hasDeltas = Object.values(d).some(v => typeof v === 'number' && Math.abs(v) > 1e-6);
            let kind = Math.random() < 0.5 ? 'formula' : 'explore';
            if (hasDeltas && Math.random() < 0.34) kind = 'imitation';
            const make = (k) => k === 'imitation'
                ? window.BotImitation.applyDeltas({ ...(window.BotSystem?.DEFAULT_WEIGHTS || {}), ...data.champion })
                : window.BotArena.makeChallenger(data.champion, k);
            let r = await sb().rpc('idle_training_new', { p_champion: data.champion_id, p_weights: make(kind), p_kind: kind });
            if (r.error && kind === 'imitation') {          // already tested: a normal challenger instead
                kind = 'explore';
                r = await sb().rpc('idle_training_new', { p_champion: data.champion_id, p_weights: make(kind), p_kind: kind });
            }
            if (r.error) throw r.error;
            cand = r.data;
        }
        return { job: data, cand };
    }

    async function start() {
        await window.LazyScripts?.load?.('bot-arena');
        if (!window.BotArena?.makeChallenger) throw new Error('bot arena not loaded');
        if (Date.now() - lastInput < IDLE_MS || !inLobby()) return;      // woke up while loading
        const first = await getJob();
        if (Date.now() - lastInput < IDLE_MS || !inLobby()) return;
        run = { ...first, stopping: false, games: 0, verdict: null };
        window.SoundSystem = null;                     // quiet screensaver (effects stay on at Watchable speed)
        buildBar();
        // no follow camera (owner 2026-10-10: jarring)
        window.Spectate?.showLocal?.({ seats: seatList, follow: false });
        let played = 0, slot = 0;
        while (run && !run.stopping) {
            await mineOne();
            if (!run || run.stopping) break;
            // Combo practice (2026-10-11): after the first three games, every
            // third slot tries a practice duel on a spot where a player pulled
            // off a taught combo. No taught combo yet = a normal game instead.
            slot++;
            if (played >= 3 && slot % 3 === 0 && window.Replay?.practiceDuel) {
                run.practice = true; renderBar();
                let duel = null;
                try { duel = await window.Replay.practiceDuel(run.cand.weights, { ...window.BotSystem.DEFAULT_WEIGHTS, ...run.job.champion }); }
                catch (e) { console.warn('[idle] practice failed', e); }
                run.practice = false;
                if (!run || run.stopping) break;
                if (duel?.result) {
                    run.lastPractice = duel;
                    await sendResult(duel.result, 0, 'practice');
                    if (run.games >= 2) {
                        try { Object.assign(run, await getJob(), { verdict: null, games: 0 }); }
                        catch (e) { console.warn('[idle] next job failed', e); await new Promise(r => setTimeout(r, 30000)); }
                    }
                    renderBar();
                    continue;
                }
                renderBar();
            }
            // One game per call, seats swapping (gameIndexOffset). After the first
            // three, every other game is fast: short pauses, effects still shown
            // and waited for (window.__arenaFx). Same moves at any speed.
            const fast = played >= 3 && played % 2 === 1;
            run.fast = fast; renderBar();
            window.__arenaFx = fast;
            const seed = (Date.now() % 1e6) >>> 0;
            try {
                await window.BotArena.run(run.cand.weights, run.job.champion, 1, seed, {
                    visual: true, speed: fast ? FAST_SPEED : 1, markChallenger: true, gameIndexOffset: played,
                    onGame: (n, total, g, side) => report(g, side),
                });
            } finally { window.__arenaFx = false; }
            played++;
            if (!run || run.stopping) break;
            if (run.games < 2) continue;          // two games per challenger, then a new job
            try { Object.assign(run, await getJob(), { verdict: null, games: 0 }); }
            catch (e) { console.warn('[idle] next job failed', e); await new Promise(r => setTimeout(r, 30000)); }
            renderBar();
        }
    }

    // Combo miner: between training games this browser mines one finished
    // game for combos. The hermit's browser (2026-10-10) uses its own trusted
    // path (Replay.mineMatches, sql/combo-miner.sql); everyone else (2026-10-11)
    // gets an anonymous game (Replay.minePooled, sql/combo-mine-pool.sql) whose
    // combos count once a second account found the same. Nothing left = wait.
    let mineIdleUntil = 0;
    async function mineOne() {
        if (!window.Replay || Date.now() < mineIdleUntil) return;
        const hermit = !!window.isHermit?.();
        if (hermit ? !window.Replay.mineMatches : !window.Replay.minePooled) return;
        run.mining = true; renderBar();
        try {
            const r = hermit
                ? await window.Replay.mineMatches(null, { limit: 1, stop: () => !run || run.stopping })
                : await window.Replay.minePooled();
            if (r) { run.mined = (run.mined || 0) + r.done; run.combos = (run.combos || 0) + r.found; }
            if (!r || !r.done) mineIdleUntil = Date.now() + 30 * 60000;   // all mined: look again later
        } catch (e) { console.warn('[idle] mining failed', e); mineIdleUntil = Date.now() + 30 * 60000; }
        if (run) { run.mining = false; renderBar(); }
    }

    async function report(g, side) {
        if (!run || run.stopping || window.BotArena.stopRequested?.()) return;
        if (g.endReason === 'stopped') return;
        const result = g.winner === null ? 'draw' : (side.aWon ? 'win' : 'loss');
        await sendResult(result, g.turns | 0, 'game');
    }
    // kind 'practice' = a combo practice duel (sql/combo-practice.sql adds
    // p_kind; an older server without it does not get practice results).
    async function sendResult(result, turns, kind) {
        if (!run || run.stopping) return;
        run.games++;
        try {
            const args = { p_candidate: run.cand.id, p_result: result, p_turns: turns };
            const { data, error } = await sb().rpc('idle_training_report', kind === 'game' ? args : { ...args, p_kind: kind });
            if (error) throw error;
            if (data?.candidate) run.cand = { ...run.cand, ...data.candidate, weights: run.cand.weights };
            if (data?.new_champion_id) run.verdict = 'promoted';
            else if (data?.candidate && data.candidate.status !== 'open') run.verdict = data.candidate.status;
        } catch (e) { console.warn('[idle] report failed', e); }
        renderBar();
    }

    function wake() {
        if (!run || run.stopping) return;
        run.stopping = true;
        try { window.BotArena?.stop?.(); } catch (e) {}
        const bar = document.getElementById('idle-training-bar');
        if (bar) bar.innerHTML = '<div class="idle-title">Back to the lobby...</div>';
        try { sessionStorage.setItem('godaigo_skip_intro_once', '1'); } catch (e) {}
        if (flag(FLAG_RESUME)) flag(FLAG_WAKE, true);
        setTimeout(() => location.reload(), 150);
    }
    function cleanupFailed() {
        if (!run) return;
        run = null;
        document.getElementById('idle-training-bar')?.remove();
        window.Spectate?.hideLocal?.();
    }

    // ── Audience view ─────────────────────────────────────────────
    const KIND = { explore: 'Explore', formula: 'Formula', imitation: 'Learned from a player' };
    function seatList() {
        const pos = (typeof playerPositions !== 'undefined' ? playerPositions : []) || [];
        const marked = window.BotArena?.markedSeat?.();
        const colorKey = (hex) => {
            try { return Object.keys(PLAYER_COLORS).find(k => PLAYER_COLORS[k] === hex) || null; } catch (e) { return null; }
        };
        return pos.map((p, i) => p && {
            index: i, color: colorKey(p.color),
            label: i === marked ? `Challenger (${KIND[run?.cand?.kind] || 'new'})` : 'Champion',
        }).filter(Boolean);
    }
    function buildBar() {
        document.getElementById('idle-training-bar')?.remove();
        const bar = document.createElement('div');
        bar.id = 'idle-training-bar';
        document.body.appendChild(bar);
        renderBar();
    }
    function renderBar() {
        const bar = document.getElementById('idle-training-bar');
        if (!bar || !run || run.stopping) return;
        const c = run.cand || {}, s = run.job?.summary || {};
        const dec = (c.wins || 0) + (c.losses || 0);
        const waiting = !run.verdict && c.status === 'open' && dec >= 40 && (c.players || 0) < 2 && c.wins / dec >= 0.58;
        const verdict = run.verdict === 'promoted' ? '<div class="idle-verdict win">This challenger beat the champion. It is the new champion!</div>'
            : run.verdict === 'dropped' ? '<div class="idle-verdict">This challenger was not good enough. On to the next one.</div>'
            : waiting ? '<div class="idle-verdict">It passed. Waiting for games from a second player.</div>' : '';
        // one text node per line, so js/i18n.js can translate each pattern
        bar.innerHTML = `<div class="idle-title"><span class="idle-tag">IDLE TRAINING</span> <span>Challenger #${esc(c.id)} (${esc(KIND[c.kind] || '')}) vs Champion</span></div>
            <div class="idle-line">This challenger so far (all players): ${c.wins || 0} won, ${c.losses || 0} lost, ${c.draws || 0} drawn.</div>
            <div class="idle-line">It needs 40 decided games at 58% or more, from at least 2 players, to become the champion.</div>
            <div class="idle-line">Last 24 hours: ${s.games_today || 0} games from ${s.players_today || 0} players. You: ${(s.my_games || 0) + run.games} games.</div>
            ${verdict}
            ${run.fast ? '<div class="idle-line">Fast game.</div>' : ''}
            ${run.practice ? '<div class="idle-line">Combo practice in the background: the challenger and the champion each play a spot where a player pulled off a combo.</div>' : ''}
            ${run.lastPractice ? `<div class="idle-line">Last combo practice: challenger ${run.lastPractice.challengerGain}, champion ${run.lastPractice.championGain} (${esc(run.lastPractice.result)}).</div>` : ''}
            ${run.mining ? '<div class="idle-line">Looking for combos in a past game...</div>' : ''}
            ${run.mined ? `<div class="idle-line">Past games checked for combos: ${run.mined}, combos found: ${run.combos || 0}.</div>` : ''}
            ${flag(FLAG_RESUME) ? '<div class="idle-hint">Your game is saved. Move the mouse or press a key to go back to it.</div>'
                : '<div class="idle-hint">Move the mouse or press a key to go back to the lobby.</div>'}`;
    }

    window.IdleTraining = { enabled, setEnabled, isRunning: () => !!run, startNow: () => { lastInput = 0; } };
})();
