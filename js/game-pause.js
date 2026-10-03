// game-pause.js: pause an online game while a player's connection is down.
//
// Plan and reasons: docs/network-resilience.md ("Pause on drop").
//
// The game pauses for everyone when:
//   * another player's connection drops (presence leave),
//   * my own connection drops (game channel error / closed),
//   * the host presses "Pause game" (HUD button, host only).
// While paused nobody can act (a clear overlay takes clicks and keys), bots
// wait (bot.js waitForQuiescence, bot-driver.js watcher), the host's turn
// timeout waits (game-core.js checkTurnTimeout), and every client gives the
// active player the paused time back on its turn clock.
//
// Short drops stay hidden: the overlay only shows text after NOTICE_MS
// (SELF_NOTICE_MS for my own drop). A host pause shows at once.
//
// Catch-up: every game message carries `_mid` (lobby.js
// broadcastGameAction). Each client keeps the last BUFFER_SIZE messages it
// sent or received. A player who comes back sends gp-resync-request with the
// ids it has seen; one other player (lowest present seat) sends back the
// messages it missed plus its board fingerprint (match-witness.js). The
// player applies them through the channel's own handlers, compares
// fingerprints and sends gp-resync-done. The others unpause on gp-resync-done
// (fallback: RESYNC_FALLBACK_MS after the player is back).
//
// After GRACE_MS without the player, a panel asks what to do:
//   host (player gone is not the host): Wait / Kick
//   player gone is the host:            Wait / Continue without them
//   I am the only human left:           Wait / Claim win (host: Wait / Kick)
// Wait asks again after WAIT_AGAIN_MS.
//
// Control messages start with "gp-" and are sent straight on the channel
// (not through broadcastGameAction), so they are never recorded in replays.
(function () {
    'use strict';

    const NOTICE_MS = 5 * 1000;
    const SELF_NOTICE_MS = 2 * 1000;
    const GRACE_MS = 60 * 1000;
    const WAIT_AGAIN_MS = 2 * 60 * 1000;
    const RESYNC_FALLBACK_MS = 10 * 1000;
    const RESYNC_REPLY_MS = 8 * 1000;
    const BUFFER_SIZE = 150;
    const SEEN_SIZE = 400;
    // Never re-sent in a catch-up: periodic state syncs (a newer one follows
    // anyway) and emotes.
    const SKIP_BUFFER = new Set(['scroll-state-sync', 'scroll-state-sync-request', 'emoji', 'stream-vote']);

    const drops = new Map();   // seat -> { since, back, graceTimer, fallbackTimer, askTimer }
    let selfDownSince = 0;     // my own connection is down since (0 = up)
    let hostPaused = false;
    let pausedSince = 0;       // 0 = not paused
    const seen = [];           // recent _mid values, oldest first
    const seenSet = new Set();
    const buffer = [];         // { event, payload } recent game messages
    let handlers = [];         // broadcast handlers of the current channel
    let midCounter = 0;
    const midSession = Math.random().toString(36).slice(2, 7);
    let resyncTimer = null;
    let resyncTries = 0;

    // lobby.js / game-core.js keep their state in script-level bindings
    // (not on window); read them safely.
    const S = {
        get isMultiplayer() { try { return isMultiplayer; } catch (e) { return false; } },
        get currentGameId() { try { return currentGameId; } catch (e) { return null; } },
        get myPlayerIndex() { try { return myPlayerIndex; } catch (e) { return null; } },
        get isHost() { try { return isHost; } catch (e) { return false; } },
        get gameChannel() { try { return gameChannel; } catch (e) { return null; } },
        get allPlayersData() { try { return allPlayersData; } catch (e) { return []; } },
    };
    function g(name) { return S[name]; }

    function inOnlineGame() {
        try {
            if (window.Replay?.state) return false;
            return !!(g('isMultiplayer') && g('currentGameId') &&
                document.getElementById('game-layout')?.classList.contains('active'));
        } catch (e) { return false; }
    }

    function me() { const i = g('myPlayerIndex'); return typeof i === 'number' ? i : null; }
    function colorName(i) { try { return getPlayerColorName(i); } catch (e) { return 'A player'; } }
    function status(text) { try { updateStatus(text); } catch (e) {} }

    function send(event, payload) {
        const ch = g('gameChannel');
        if (!ch) return;
        try { ch.send({ type: 'broadcast', event, payload }); } catch (e) {}
    }

    function presentSeats() {
        try {
            return Object.values(g('gameChannel')?.presenceState() || {}).flat()
                .map(s => s.playerIndex).filter(i => typeof i === 'number');
        } catch (e) { return []; }
    }

    // ── Message ids, history, handlers ──────────────────────────
    function newMid() { return `${me()}:${midSession}:${++midCounter}`; }
    // "seat:session" of a message id ("seat:session:counter"): who sent it, from which page load.
    function midSource(mid) { const p = String(mid).split(':'); return p.length >= 3 ? p[0] + ':' + p[1] : null; }

    function markSeen(mid) {
        if (!mid || seenSet.has(mid)) return;
        seen.push(mid); seenSet.add(mid);
        while (seen.length > SEEN_SIZE) seenSet.delete(seen.shift());
    }

    // Every game message this client sends or receives. Skipped events are
    // never buffered or re-sent, so they are not remembered either: in match
    // 43 the scroll-sync flood (4-5 a second) pushed real messages out of
    // `seen` within a minute or two, and a catch-up re-applied old moves.
    function note(event, payload) {
        if (!event || event.startsWith('gp-')) return;
        if (SKIP_BUFFER.has(event)) return;
        markSeen(payload?._mid);
        if (!payload?._mid) return;
        buffer.push({ event, payload });
        while (buffer.length > BUFFER_SIZE) buffer.shift();
    }

    // Stamp an outgoing game message (lobby.js broadcastGameAction).
    function stamp(event, payload) {
        if (!payload || typeof payload !== 'object' || event.startsWith('gp-')) return;
        if (!payload._mid) payload._mid = newMid();
        note(event, payload);
    }

    // Wrap the channel's on() so we know its broadcast handlers (catch-up
    // messages go through the same handlers as live ones).
    function attach(channel) {
        handlers = [];
        if (!channel || channel.__gpAttached) return;
        channel.__gpAttached = true;
        const on = channel.on.bind(channel);
        channel.on = function (type, filter, cb) {
            if (type === 'broadcast' && filter?.event && !String(filter.event).startsWith('gp-')) {
                handlers.push({ event: filter.event, cb });
            }
            return on(type, filter, cb);
        };
        on('broadcast', { event: 'gp-pause' }, ({ payload }) => onHostPause(payload));
        on('broadcast', { event: 'gp-resync-request' }, ({ payload }) => onResyncRequest(payload));
        on('broadcast', { event: 'gp-resync-moves' }, ({ payload }) => onResyncMoves(payload));
        on('broadcast', { event: 'gp-resync-done' }, ({ payload }) => onResyncDone(payload));
        on('broadcast', { event: 'gp-drop-clear' }, ({ payload }) => clearDrop(payload?.seat, false));
    }

    function dispatch(event, payload) {
        const msg = { type: 'broadcast', event, payload };
        for (const h of handlers) {
            if (h.event !== event && h.event !== '*') continue;
            try { h.cb(msg); } catch (e) { console.warn('[pause] catch-up handler failed:', event, e); }
        }
    }

    // ── Pause state ─────────────────────────────────────────────
    function reasonsActive() {
        return drops.size > 0 || selfDownSince > 0 || hostPaused;
    }

    function isPaused() { return inOnlineGame() && reasonsActive(); }

    // Called whenever a reason changes: tracks paused time and gives it
    // back to the active player's turn clock when play goes on.
    function refresh() {
        const paused = reasonsActive();
        if (paused && !pausedSince) pausedSince = Date.now();
        if (!paused && pausedSince) {
            const away = Date.now() - pausedSince;
            pausedSince = 0;
            try { if (turnStartedAtMs) turnStartedAtMs += away; } catch (e) {}
        }
        render();
    }

    // ── Overlay and host button ─────────────────────────────────
    let overlay = null;
    function ensureOverlay() {
        if (overlay) return overlay;
        const style = document.createElement('style');
        style.textContent = `
#game-pause-overlay { display: none; position: fixed; inset: 0; z-index: 9000; }
#game-pause-overlay.gp-on { display: block; }
#game-pause-overlay.gp-show { display: flex; align-items: center; justify-content: center; background: rgba(0, 0, 0, 0.45); }
#game-pause-overlay .gp-box { display: none; max-width: min(420px, calc(100vw - 32px)); padding: 18px 22px;
  background: #1e2430; color: #eee; border: 2px solid #6a8ab5; border-radius: 8px; text-align: center;
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.6); font-size: 15px; line-height: 1.4; }
#game-pause-overlay.gp-show .gp-box { display: block; }
#game-pause-overlay .gp-title { font-size: 20px; font-weight: bold; margin-bottom: 8px; }
#game-pause-overlay .gp-q { margin: 12px 0 8px; }
#game-pause-overlay .gp-actions button { margin: 4px; padding: 7px 14px; cursor: pointer; }
#gp-host-pause-btn { margin-left: 6px; }`;
        document.head.appendChild(style);
        overlay = document.createElement('div');
        overlay.id = 'game-pause-overlay';
        overlay.innerHTML = '<div class="gp-box"><div class="gp-title"></div><div class="gp-text"></div><div class="gp-actions"></div></div>';
        document.body.appendChild(overlay);
        return overlay;
    }

    function panelText() {
        if (selfDownSince) return { title: 'Reconnecting...', text: 'Your connection to the game dropped. The game waits for you.' };
        const lines = [];
        let decide = null;
        for (const [seat, d] of drops) {
            const name = colorName(seat);
            lines.push(d.back ? `${name} is back, catching up...` : `${name} lost connection. Waiting for them to reconnect...`);
            if (d.ask && !d.back) decide = decide ?? seat;
        }
        if (hostPaused) lines.unshift('The host paused the game.');
        return { title: 'Game paused', text: lines.join('<br>'), decide };
    }

    function visibleNow() {
        const now = Date.now();
        if (hostPaused) return true;
        if (selfDownSince && now - selfDownSince >= SELF_NOTICE_MS) return true;
        for (const d of drops.values()) if (now - d.since >= NOTICE_MS) return true;
        return false;
    }

    function render() {
        const el = ensureOverlay();
        const paused = isPaused();
        el.classList.toggle('gp-on', paused);
        el.classList.toggle('gp-show', paused && visibleNow());
        if (paused) {
            const p = panelText();
            el.querySelector('.gp-title').textContent = p.title;
            el.querySelector('.gp-text').innerHTML = p.text;
            renderActions(el.querySelector('.gp-actions'), p.decide);
        }
        renderHostButton();
    }

    function renderActions(box, decideSeat) {
        box.innerHTML = '';
        const add = (label, fn, cls) => {
            const b = document.createElement('button');
            b.textContent = label;
            if (cls) b.className = cls;
            b.onclick = fn;
            box.appendChild(b);
        };
        if (decideSeat != null) {
            const d = drops.get(decideSeat);
            const name = colorName(decideSeat);
            const mins = d ? Math.max(1, Math.round((Date.now() - d.since) / 60000)) : 1;
            const q = document.createElement('div');
            q.className = 'gp-q';
            q.textContent = `${name} has been gone for about ${mins} min. What now?`;
            box.appendChild(q);
            add('Wait', () => waitMore(decideSeat));
            const hostIdx = hostSeat();
            if (g('isHost') && decideSeat !== me()) {
                add(`Kick ${name}`, () => kick(decideSeat), 'danger');
            } else if (decideSeat === hostIdx && onlyHumanLeft()) {
                add('Claim win', () => claimWin(), 'danger');
            } else {
                add('Continue without them', () => { send('gp-drop-clear', { seat: decideSeat }); clearDrop(decideSeat, false); });
            }
        }
        if (hostPaused && g('isHost')) add('Resume game', () => setHostPause(false));
    }

    let hostBtn = null;
    function renderHostButton() {
        if (!hostBtn) {
            const anchor = document.getElementById('hud-timer');
            if (!anchor || !anchor.parentNode) return;
            hostBtn = document.createElement('button');
            hostBtn.id = 'gp-host-pause-btn';
            hostBtn.title = 'Pause the game for everyone (host only)';
            hostBtn.onclick = () => setHostPause(!hostPaused);
            anchor.parentNode.insertBefore(hostBtn, anchor.nextSibling);
        }
        // Only with other humans: a game against bots has nobody to pause for.
        const show = inOnlineGame() && !!g('isHost') && (hostPaused || otherHumansSeated());
        hostBtn.style.display = show ? '' : 'none';
        hostBtn.textContent = hostPaused ? 'Resume' : 'Pause';
    }

    // Keys do nothing while paused (Escape still closes things).
    document.addEventListener('keydown', (e) => {
        if (!isPaused() || e.key === 'Escape') return;
        const t = e.target;
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
        e.stopPropagation();
        e.preventDefault();
    }, true);

    // ── Host pause ──────────────────────────────────────────────
    function setHostPause(on) {
        if (!g('isHost')) return;
        hostPaused = !!on;
        send('gp-pause', { paused: hostPaused });
        status(hostPaused ? 'You paused the game.' : 'Game resumed.');
        refresh();
    }

    function onHostPause(payload) {
        if (!inOnlineGame()) return;
        const on = !!payload?.paused;
        if (on === hostPaused) return;
        hostPaused = on;
        status(on ? 'The host paused the game.' : 'The host resumed the game.');
        refresh();
    }

    // ── Other players' drops ────────────────────────────────────
    function hostSeat() {
        // Host = oldest non-bot seat (sql is_room_host). allPlayersData keeps
        // seats in join order.
        try {
            const rows = (g('allPlayersData') || []).slice()
                .sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')));
            const h = determineHostRow(rows);
            return h ? h.player_index : null;
        } catch (e) { return null; }
    }

    function onlyHumanLeft() {
        return presentSeats().filter(i => i !== me()).length === 0;
    }

    function peerLeft(seat) {
        if (!inOnlineGame() || seat === me() || seat == null) return;
        const known = (g('allPlayersData') || []).some(p => p.player_index === seat);
        if (!known) return;
        let d = drops.get(seat);
        if (d) { d.back = false; clearTimeout(d.fallbackTimer); }
        else {
            d = { since: Date.now(), back: false, ask: false };
            drops.set(seat, d);
            setTimeout(() => { if (drops.get(seat) === d) { status(`${colorName(seat)} lost connection - the game is paused.`); render(); } }, NOTICE_MS);
        }
        clearTimeout(d.askTimer);
        d.askTimer = setTimeout(() => { if (drops.get(seat) === d && !d.back) { d.ask = true; render(); } }, GRACE_MS);
        refresh();
    }

    function peerJoined(seat) {
        const d = drops.get(seat);
        if (!d) return;
        d.back = true;
        d.ask = false;
        clearTimeout(d.askTimer);
        clearTimeout(d.fallbackTimer);
        // They send gp-resync-done after catching up; do not wait forever.
        d.fallbackTimer = setTimeout(() => { if (drops.get(seat) === d) clearDrop(seat, true); }, RESYNC_FALLBACK_MS);
        render();
    }

    function clearDrop(seat, back) {
        const d = drops.get(seat);
        if (!d) return;
        clearTimeout(d.askTimer);
        clearTimeout(d.fallbackTimer);
        drops.delete(seat);
        if (back && Date.now() - d.since >= NOTICE_MS) status(`${colorName(seat)} is back.`);
        refresh();
    }

    function waitMore(seat) {
        const d = drops.get(seat);
        if (!d) return;
        d.ask = false;
        clearTimeout(d.askTimer);
        d.askTimer = setTimeout(() => { if (drops.get(seat) === d && !d.back) { d.ask = true; render(); } }, WAIT_AGAIN_MS);
        render();
    }

    async function kick(seat) {
        const row = (g('allPlayersData') || []).find(p => p.player_index === seat);
        if (!row) return;
        if (!window.confirm(`Remove ${colorName(seat)} from the game? They cannot come back.`)) return;
        send('gp-drop-clear', { seat });
        clearDrop(seat, false);
        try {
            const { error } = await supabase.rpc('remove_player', { p_player_id: row.id });
            if (error) throw error;
            status(`${colorName(seat)} was removed from the game.`);
        } catch (e) {
            console.warn('[pause] kick failed:', e);
            status('Could not remove the player. Try again.');
        }
    }

    function claimWin() {
        const i = me();
        if (i == null) return;
        drops.clear();
        refresh();
        try { handleGameOver(i, 'last_standing'); } catch (e) { console.warn('[pause] claim win failed:', e); }
    }

    // ── My own connection ───────────────────────────────────────
    function selfDown() {
        if (!inOnlineGame() || selfDownSince) return;
        selfDownSince = Date.now();
        setTimeout(render, SELF_NOTICE_MS + 50);
        refresh();
    }

    // Channel is subscribed. again = true when this is not the first
    // subscribe of the game (a reconnect, even one we did not see drop):
    // the others paused when we vanished, so catch up and tell them.
    function selfUp(again) {
        if (!inOnlineGame()) return;
        if (!selfDownSince) {
            if (!again) return;
            selfDownSince = Date.now();
        }
        resyncTries = 0;
        requestResync();
    }

    function otherHumansSeated() {
        return (g('allPlayersData') || []).some(p => p.player_index !== me() && !window.isBotUsername?.(p.username));
    }

    function requestResync() {
        clearTimeout(resyncTimer);
        const others = presentSeats().filter(i => i !== me());
        if (!others.length) {
            // Presence may not have synced yet; try a few times before
            // deciding nobody else is here.
            if (otherHumansSeated() && resyncTries < 4) {
                resyncTries++;
                resyncTimer = setTimeout(requestResync, 1000);
                return;
            }
            finishResync(true);
            return;
        }
        resyncTries++;
        send('gp-resync-request', { seat: me(), source: `${me()}:${midSession}`, seen: seen.slice() });
        // Nobody answered (old client, or they dropped too): go on and let
        // the per-turn fingerprint check catch a difference.
        resyncTimer = setTimeout(() => finishResync(true), RESYNC_REPLY_MS);
    }

    function finishResync(ok) {
        clearTimeout(resyncTimer);
        selfDownSince = 0;
        send('gp-resync-done', { seat: me(), ok: !!ok });
        if (!ok) status('Your board may be out of sync with the others. If things look wrong, reload the page.');
        refresh();
    }

    // Another player asks for what they missed. The lowest present seat
    // (not them) answers, so exactly one player replies.
    function onResyncRequest(payload) {
        if (!inOnlineGame()) return;
        const from = payload?.seat;
        const responder = presentSeats().filter(i => i !== from).sort((a, b) => a - b)[0];
        if (responder !== me()) return;
        const had = new Set(payload?.seen || []);
        // Only what came after the oldest message they still remember (older
        // ones they applied long ago, even if they no longer remember them),
        // and never their own messages from this page load back (match 43: a
        // returning player re-applied its own old turn change and stones).
        const anchor = buffer.findIndex(m => had.has(m.payload._mid));
        const recent = anchor >= 0 ? buffer.slice(anchor) : buffer;
        const own = payload?.source || null; // this page load's own messages (a reloaded page gets its old ones)
        const moves = recent.filter(m => !had.has(m.payload._mid) && (!own || midSource(m.payload._mid) !== own));
        let fp = null;
        try { fp = window.MatchWitness?.fingerprint?.() || null; } catch (e) {}
        send('gp-resync-moves', { to: from, moves, fp, hostPaused: g('isHost') ? hostPaused : undefined });
    }

    function onResyncMoves(payload) {
        if (!inOnlineGame() || payload?.to !== me() || !selfDownSince) return;
        clearTimeout(resyncTimer);
        let applied = 0;
        for (const m of payload.moves || []) {
            if (!m?.payload?._mid || seenSet.has(m.payload._mid)) continue;
            if (midSource(m.payload._mid) === `${me()}:${midSession}`) continue; // my own: applied when I sent it
            dispatch(m.event, m.payload); // the '*' handler marks it seen via note()
            markSeen(m.payload._mid);
            applied++;
        }
        if (typeof payload.hostPaused === 'boolean') hostPaused = payload.hostPaused;
        if (applied) console.log(`[pause] caught up on ${applied} missed message(s)`);
        // Let effects of the applied moves settle, then compare boards.
        setTimeout(() => {
            let mine = null;
            try { mine = window.MatchWitness?.fingerprint?.() || null; } catch (e) {}
            const ok = !payload.fp || !mine || payload.fp === mine;
            if (!ok && resyncTries < 6) { requestResync(); return; }
            finishResync(ok);
        }, 600);
    }

    function onResyncDone(payload) {
        const seat = payload?.seat;
        if (seat == null) return;
        if (payload.ok === false) status(`${colorName(seat)} is back, but their board may be out of sync.`);
        clearDrop(seat, true);
        // A player who was away may not know the host paused meanwhile.
        if (hostPaused && g('isHost')) send('gp-pause', { paused: true });
    }

    // ── Reset between games ─────────────────────────────────────
    function reset() {
        for (const d of drops.values()) { clearTimeout(d.askTimer); clearTimeout(d.fallbackTimer); }
        drops.clear();
        selfDownSince = 0;
        hostPaused = false;
        pausedSince = 0;
        clearTimeout(resyncTimer);
        render();
    }

    // Leaving the game screen (game over, back to lobby): nothing is paused.
    setInterval(() => {
        if (!inOnlineGame() && (drops.size || selfDownSince || hostPaused)) reset();
        else if (isPaused()) render(); // update "gone for N min" and notice timing
        else renderHostButton();
    }, 1000);

    window.GamePause = {
        attach, stamp, note, isPaused,
        dispatch,                 // feed a message through the game channel's own handlers (save-game.js resume)
        peerLeft, peerJoined, selfDown, selfUp,
        setHostPause, reset,
        forget: (seat) => clearDrop(seat, false),
        isReconnecting: (seat) => drops.has(seat),
    };
    window.isGamePaused = isPaused;
})();
