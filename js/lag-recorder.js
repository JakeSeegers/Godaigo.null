// Lag recorder (owner 2026-10-08): find out WHY a game felt slow.
// Every 5 s, while a game is on screen, one sample is kept (last 30 min):
//   fps, long tasks (main thread blocked, ms), bot thinking time (ms, from
//   bot.js botAct), network ping (ConnectionMonitor), Realtime channel
//   state, messages sent / received and how late the received ones were
//   (every outgoing game message carries _st = serverNow(); the receiver
//   compares), board effects playing, board element count, memory, hidden tab.
// A sample that looks bad (fps under 10 with the tab in front, 2 s+ of long
// tasks, ping over 2 s or messages 2 s+ late) saves a "moment" with what was
// going on (whose turn, bot driving, effects, the last actions and messages).
// Shift+L saves a moment by hand ("it feels slow now"). Everything goes into
// the Download Action Log file (ActionLog.download adds LagRecorder.export()).
// How to read it: slow network = high ping / late messages, fps fine;
// slow computer = low fps and long tasks, ping fine; bots = long tasks while
// botMs is high (the host's browser thinks for every bot).
(function () {
    'use strict';
    const SAMPLE_MS = 5000, KEEP = 360, MOMENTS = 40;
    const samples = [], moments = [];
    let cur = null, lastAuto = 0;
    const recentIn = [];                       // last received messages (event, lag)

    function fresh() {
        return { frames: 0, longMs: 0, longN: 0, longWorst: 0, longWhileBot: 0, botMs: 0, botN: 0,
                 sent: 0, recv: 0, lagN: 0, lagSum: 0, lagMax: 0, late2s: 0, hiddenMs: 0, t0: Date.now() };
    }
    cur = fresh();

    function inGame() {
        return !!document.getElementById('game-layout')?.classList.contains('active');
    }
    function botTurnNow() {
        try {
            if (window.BotDriver?.driverRealIndex?.() != null) return true;
            if (window.BotArena?.isRunning?.()) return true;
            return !!window.BotDriver?.isBot?.(activePlayerIndex);
        } catch (e) { return false; }
    }

    // ── frames ────────────────────────────────────────────────────
    const tick = () => { cur.frames++; requestAnimationFrame(tick); };
    requestAnimationFrame(tick);

    // ── long tasks (Chrome / Edge) ────────────────────────────────
    try {
        new PerformanceObserver(list => {
            const bot = botTurnNow();
            for (const e of list.getEntries()) {
                cur.longMs += e.duration; cur.longN++;
                if (e.duration > cur.longWorst) cur.longWorst = e.duration;
                if (bot) cur.longWhileBot += e.duration;
            }
        }).observe({ entryTypes: ['longtask'] });
    } catch (e) { /* not supported: longMs stays 0 */ }

    // ── hidden tab time ───────────────────────────────────────────
    let hiddenSince = document.hidden ? Date.now() : null;
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) hiddenSince = Date.now();
        else if (hiddenSince) { cur.hiddenMs += Date.now() - hiddenSince; hiddenSince = null; }
    });

    // ── bot thinking (bot.js botAct calls this with its own time) ──
    function botThink(ms) { cur.botMs += ms; cur.botN++; }

    // ── outgoing messages: stamp the send time ────────────────────
    function patchBroadcast() {
        const orig = window.broadcastGameAction;
        if (typeof orig !== 'function') return false;
        if (orig.__lagRec) return true;
        const wrapped = function (event, payload) {
            try {
                if (payload && typeof payload === 'object' && typeof payload._st !== 'number' && typeof window.serverNow === 'function') {
                    payload._st = window.serverNow();
                }
                cur.sent++;
            } catch (e) {}
            return orig.apply(this, arguments);
        };
        wrapped.__lagRec = true;
        window.broadcastGameAction = wrapped;
        return true;
    }
    // ── incoming messages: lobby.js passes each one to GamePause.note ──
    function patchReceive() {
        const gp = window.GamePause;
        if (!gp || typeof gp.note !== 'function') return false;
        if (gp.__lagRec) return true;
        gp.__lagRec = true;
        const orig = gp.note;
        gp.note = function (event, p) {
            try {
                cur.recv++;
                let lag = null;
                if (p && typeof p._st === 'number' && typeof window.serverNow === 'function') {
                    lag = Math.max(0, window.serverNow() - p._st);
                    cur.lagN++; cur.lagSum += lag;
                    if (lag > cur.lagMax) cur.lagMax = lag;
                    if (lag > 2000) cur.late2s++;
                }
                recentIn.push({ e: event, lag: lag == null ? null : Math.round(lag), at: Date.now() });
                if (recentIn.length > 15) recentIn.shift();
            } catch (e) {}
            return orig.apply(this, arguments);
        };
        return true;
    }
    let tries = 0;
    const patchTimer = setInterval(() => {
        const a = patchBroadcast(), b = patchReceive();
        if ((a && b) || ++tries > 120) clearInterval(patchTimer);
    }, 500);

    // ── context for a sample / moment ─────────────────────────────
    function context() {
        const vp = document.getElementById('viewport');
        const c = {};
        try {
            const cm = window.ConnectionMonitor?.getStatus?.();
            if (cm) { c.net = cm.quality; c.ping = cm.lastLatencyMs; c.chan = cm.channelStatuses?.game || Object.values(cm.channelStatuses || {})[0] || null; }
        } catch (e) {}
        try {
            c.turn = currentTurnNumber; c.active = activePlayerIndex;
            c.me = (typeof myPlayerIndex !== 'undefined') ? myPlayerIndex : null;
            c.botTurn = botTurnNow();
            c.paused = !!window.isGamePaused?.();
        } catch (e) {}
        if (vp) {
            c.nodes = vp.getElementsByTagName('*').length;
            c.fx = vp.querySelectorAll('.cast-fx, .stone-drop-fx, .tile-flip-fx, .pawn-teleport-fx, .stone-burn-copy, .pawn-afterimage').length;
        }
        try { c.anims = document.getAnimations().length; } catch (e) {}
        try { if (performance.memory) c.memMB = Math.round(performance.memory.usedJSHeapSize / 1048576); } catch (e) {}
        c.hidden = document.hidden;
        return c;
    }

    function sample() {
        const s = cur;
        cur = fresh();
        if (!inGame()) return;
        if (hiddenSince) { s.hiddenMs += Date.now() - hiddenSince; hiddenSince = Date.now(); }
        const secs = Math.max(0.5, (Date.now() - s.t0) / 1000);
        const row = {
            t: new Date().toISOString().slice(11, 19),
            fps: Math.round(s.frames / secs),
            longMs: Math.round(s.longMs), longN: s.longN, longWorst: Math.round(s.longWorst), longWhileBot: Math.round(s.longWhileBot),
            botMs: Math.round(s.botMs), botN: s.botN,
            sent: s.sent, recv: s.recv,
            lagAvg: s.lagN ? Math.round(s.lagSum / s.lagN) : null, lagMax: s.lagN ? Math.round(s.lagMax) : null, late2s: s.late2s,
            hiddenMs: Math.round(s.hiddenMs),
            ...context(),
        };
        samples.push(row);
        if (samples.length > KEEP) samples.shift();
        // a bad sample saves a moment (at most one every 30 s)
        const why = [];
        if (!row.hidden && row.hiddenMs < 1000 && row.fps < 10) why.push(`fps ${row.fps}`);
        if (row.longMs >= 2000) why.push(`blocked ${row.longMs} ms`);
        if (row.ping != null && row.ping > 2000) why.push(`ping ${row.ping} ms`);
        if (row.lagMax != null && row.lagMax > 2000) why.push(`messages ${row.lagMax} ms late`);
        if (why.length && Date.now() - lastAuto > 30000) { lastAuto = Date.now(); mark('auto: ' + why.join(', '), row); }
    }
    setInterval(sample, SAMPLE_MS);

    // ── moments ───────────────────────────────────────────────────
    function mark(reason, row) {
        const m = {
            at: new Date().toISOString(),
            reason,
            sample: row || { ...context(), fpsSoFar: cur.frames, longMsSoFar: Math.round(cur.longMs), botMsSoFar: Math.round(cur.botMs) },
            lastActions: (window.ActionLog?.entries?.() || []).slice(-8),
            lastMessages: recentIn.slice(-10),
            prevSamples: samples.slice(-3),
        };
        moments.push(m);
        if (moments.length > MOMENTS) moments.shift();
        return m;
    }
    function toast(text) {
        const d = document.createElement('div');
        d.textContent = text;
        d.style.cssText = 'position:fixed;left:50%;top:70px;transform:translateX(-50%);z-index:9999;background:#222c;color:#fff;padding:8px 14px;border-radius:6px;font:14px sans-serif;pointer-events:none';
        document.body.appendChild(d);
        setTimeout(() => d.remove(), 2200);
    }
    // Shift+L: "it feels slow right now"
    document.addEventListener('keydown', (e) => {
        if (!e.shiftKey || e.ctrlKey || e.metaKey || e.altKey || (e.key !== 'L' && e.key !== 'l')) return;
        const t = e.target;
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
        mark('marked by player');
        toast('Lag moment saved. Download the Action Log to send it.');
    });

    function exportData() {
        return { sampleEveryMs: SAMPLE_MS, samples: samples.slice(), moments: moments.slice() };
    }

    window.LagRecorder = { botThink, mark, export: exportData, samples: () => samples.slice(), moments: () => moments.slice() };
})();
