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
            const kind = Math.random() < 0.5 ? 'formula' : 'explore';
            const w = window.BotArena.makeChallenger(data.champion, kind);
            const r = await sb().rpc('idle_training_new', { p_champion: data.champion_id, p_weights: w, p_kind: kind });
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
        window.Spectate?.showLocal?.({ seats: seatList });
        while (run && !run.stopping) {
            const seed = (Date.now() % 1e6) >>> 0;
            await window.BotArena.run(run.cand.weights, run.job.champion, 2, seed, {
                visual: true, speed: 1, markChallenger: true,
                onGame: (n, total, g, side) => report(g, side),
            });
            if (!run || run.stopping) break;
            try { Object.assign(run, await getJob(), { verdict: null, games: 0 }); }
            catch (e) { console.warn('[idle] next job failed', e); await new Promise(r => setTimeout(r, 30000)); }
            renderBar();
        }
    }

    async function report(g, side) {
        if (!run || run.stopping || window.BotArena.stopRequested?.()) return;
        if (g.endReason === 'stopped') return;
        const result = g.winner === null ? 'draw' : (side.aWon ? 'win' : 'loss');
        run.games++;
        try {
            const { data, error } = await sb().rpc('idle_training_report', { p_candidate: run.cand.id, p_result: result, p_turns: g.turns | 0 });
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
        setTimeout(() => location.reload(), 150);
    }
    function cleanupFailed() {
        if (!run) return;
        run = null;
        document.getElementById('idle-training-bar')?.remove();
        window.Spectate?.hideLocal?.();
    }

    // ── Audience view ─────────────────────────────────────────────
    const KIND = { explore: 'Explore', formula: 'Formula' };
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
            <div class="idle-hint">Move the mouse or press a key to go back to the lobby.</div>`;
    }

    window.IdleTraining = { enabled, setEnabled, isRunning: () => !!run, startNow: () => { lastInput = 0; } };
})();
