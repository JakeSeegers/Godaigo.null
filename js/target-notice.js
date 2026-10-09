// "You were targeted" notices (owner 2026-10-09). A small card slides in at the
// top right when another player's scroll hits you: Plunder took one of your
// scrolls, Arson burned a stone from your pool, Take Flight moved your pawn (or
// asks you where to land), a tile swap / Telekinesis carried your pawn, or your
// scroll was countered. Click to close; it also goes after 6 s.
//
// No hooks in the scroll code: it reads the game messages. Incoming ones via
// GamePause.note (lobby.js hands every received message to it), outgoing ones by
// wrapping broadcastGameAction, so a bot driven by THIS browser (the host)
// targeting the host is caught too (a client never receives its own broadcast).
// Online games only; not in replays (myPlayerIndex -1) or while a saved game is
// rebuilt.
(function () {
    'use strict';
    const SHOW_MS = 6000, MAX = 3;
    const seen = new Map();          // event+payload key -> time (a message can be seen twice)

    function mySeat() {
        const d = window.BotDriver?.driverRealIndex?.();
        if (d != null) return d;
        return (typeof myPlayerIndex !== 'undefined') ? myPlayerIndex : null;
    }
    function active() {
        try {
            if (typeof isMultiplayer === 'undefined' || !isMultiplayer) return false;
            if (window.SaveGame?.isRebuilding?.()) return false;
            const me = mySeat();
            return me != null && me >= 0;
        } catch (e) { return false; }
    }
    const nameOf = (i) => {
        try { if (typeof getPlayerColorName === 'function') return getPlayerColorName(i); } catch (e) {}
        return `Player ${i + 1}`;
    };
    const colorOf = (i) => {
        try {
            const p = (typeof allPlayersData !== 'undefined' ? allPlayersData : []).find(q => q.player_index === i);
            if (p && typeof PLAYER_COLORS !== 'undefined' && PLAYER_COLORS[p.color]) return PLAYER_COLORS[p.color];
            const pos = (typeof playerPositions !== 'undefined') ? playerPositions[i] : null;
            if (pos?.color) return pos.color;
        } catch (e) {}
        return '#d9b08c';
    };
    const scrollName = (id) => {
        const d = window.spellSystem?.patterns?.[id] || window.SCROLL_DEFINITIONS?.[id];
        return d?.name || id || 'a scroll';
    };
    const movedMe = (list, me) => Array.isArray(list) && list.some(m => m && (m.playerIndex === me || m.index === me));

    // event -> { target, actor (null = unknown), text } or null
    function read(event, p, me) {
        if (!p || typeof p !== 'object') return null;
        const now = (typeof activePlayerIndex !== 'undefined') ? activePlayerIndex : null;
        switch (event) {
            case 'scroll-plundered':
                return { target: p.targetIndex, actor: p.casterIndex, icon: '🏴‍☠️',
                         text: `${nameOf(p.casterIndex)} used Plunder: your ${scrollName(p.scrollName)} went to the Common Area.` };
            case 'opponent-stone-destroyed':
                return { target: p.opponentIndex, actor: now, icon: '🔥',
                         text: `${nameOf(now)} used Arson: 1 ${p.stoneType} stone burned from your pool.` };
            case 'take-flight':
                if (p.targetPlayerIndex === p.casterIndex) return null;
                return { target: p.targetPlayerIndex, actor: p.casterIndex, icon: '🌬️',
                         text: `${nameOf(p.casterIndex)} used Take Flight: your pawn was moved.` };
            case 'take-flight-choose-request':
                if (p.targetPlayerIndex === p.casterIndex) return null;
                return { target: p.targetPlayerIndex, actor: p.casterIndex, icon: '🌬️',
                         text: `${nameOf(p.casterIndex)} cast Take Flight on you: pick where you land.` };
            case 'tile-swap':
                if (!movedMe(p.movedPlayers, me)) return null;
                return { target: me, actor: now, icon: '🧱', text: `${nameOf(now)} swapped your tile: your pawn moved with it.` };
            case 'telekinesis-move':
                if (!movedMe(p.movedPlayers, me)) return null;
                return { target: me, actor: now, icon: '🧱', text: `${nameOf(now)} used Telekinesis: your pawn moved with the tile.` };
            case 'scroll-countered':
                return { target: p.casterIndex, actor: null, icon: '🛡️', text: `Your ${scrollName(p.scrollName)} was countered.` };
        }
        return null;
    }

    function consider(event, payload) {
        try {
            if (!active()) return;
            const me = mySeat();
            const hit = read(event, payload, me);
            if (!hit || hit.target !== me) return;
            if (hit.actor != null && hit.actor === me) return;     // your own scroll
            const key = event + JSON.stringify(payload);
            const t = Date.now();
            for (const [k, at] of seen) if (t - at > 10000) seen.delete(k);
            if (seen.has(key)) return;
            seen.set(key, t);
            show(hit);
        } catch (e) {}
    }

    let stack = null;
    function show(hit) {
        if (!stack) {
            stack = document.createElement('div');
            stack.id = 'target-notices';
            document.body.appendChild(stack);
        }
        while (stack.children.length >= MAX) stack.firstElementChild.remove();
        const card = document.createElement('div');
        card.className = 'target-notice';
        card.style.setProperty('--tn-color', hit.actor != null ? colorOf(hit.actor) : '#ed1b43');
        const icon = document.createElement('div');
        icon.className = 'target-notice-icon';
        icon.textContent = hit.icon;
        const body = document.createElement('div');
        const title = document.createElement('div');
        title.className = 'target-notice-title';
        title.textContent = 'You were targeted!';
        const text = document.createElement('div');
        text.className = 'target-notice-text';
        text.textContent = hit.text;
        body.append(title, text);
        card.append(icon, body);
        stack.appendChild(card);
        try { window.SoundSystem?.play('zipclick', 0.7); } catch (e) {}
        const close = () => {
            if (!card.isConnected) return;
            card.classList.add('leaving');
            setTimeout(() => card.remove(), 260);
        };
        card.addEventListener('click', close);
        setTimeout(close, SHOW_MS);
    }

    // ── hook the message flow (same way js/lag-recorder.js does) ──
    function patchSend() {
        const orig = window.broadcastGameAction;
        if (typeof orig !== 'function') return false;
        if (orig.__targetNotice) return true;
        const wrapped = function (event, payload) {
            consider(event, payload);
            return orig.apply(this, arguments);
        };
        wrapped.__targetNotice = true;
        // keep the lag recorder's mark so it does not wrap twice
        if (orig.__lagRec) wrapped.__lagRec = true;
        window.broadcastGameAction = wrapped;
        return true;
    }
    function patchReceive() {
        const gp = window.GamePause;
        if (!gp || typeof gp.note !== 'function') return false;
        if (gp.__targetNotice) return true;
        gp.__targetNotice = true;
        const orig = gp.note;
        gp.note = function (event, p) {
            consider(event, p);
            return orig.apply(this, arguments);
        };
        return true;
    }
    let tries = 0;
    const timer = setInterval(() => {
        const a = patchSend(), b = patchReceive();
        if ((a && b) || ++tries > 120) clearInterval(timer);
    }, 500);

    window.TargetNotice = { show: (text, icon) => show({ actor: null, icon: icon || '⚠️', text }) };
})();
