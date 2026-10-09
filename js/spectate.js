// Spectate mode (owner 2026-10-09; sql/spectate.sql).
//
// Host side: "Allow spectators" in the waiting room (game_room.allow_spectators).
// Lobby: "Games you can watch" lists live games that allow it (list_watchable_games);
//   Watch -> Replay.openLive(room) (js/replay-viewer.js): the moves so far, then the
//   room's live messages. Spectators see public information only (hands hidden).
// Spectator screen: a LIVE bar (watcher count, follow camera, emotes, exit), a
//   scoreboard (elements, AP, pool, scrolls, steps home per player) and an emote
//   feed only spectators see.
// Players: a small "N watching" tag while spectators are in their game.
// Watcher count and emotes use their own Realtime channel 'spectate-room-<id>'
//   (presence = spectators only; players join without tracking, so they are not
//   counted and never see the emotes).
(function () {
    'use strict';
    const sb = () => { try { return supabase; } catch (e) { return null; } };
    // lobby.js / game-core.js keep their state in script-level bindings (not on window)
    const S = {
        get currentGameId() { try { return currentGameId; } catch (e) { return null; } },
        get isHost() { try { return isHost; } catch (e) { return false; } },
        get isMultiplayer() { try { return isMultiplayer; } catch (e) { return false; } },
        get myPlayerIndex() { try { return myPlayerIndex; } catch (e) { return null; } },
        get activePlayerIndex() { try { return activePlayerIndex; } catch (e) { return null; } },
        get currentTurnNumber() { try { return currentTurnNumber; } catch (e) { return 0; } },
        get currentAP() { try { return currentAP; } catch (e) { return 0; } },
        get voidAP() { try { return voidAP; } catch (e) { return 0; } },
        get playerPools() { try { return playerPools; } catch (e) { return []; } },
        get playerPositions() { try { return playerPositions; } catch (e) { return []; } },
    };
    const g = (name) => S[name];
    const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
    const T = (s) => { try { return window.I18n ? window.I18n.t(s) : s; } catch (e) { return s; } };
    const EMOTES = [0, 1, 2, 3, 4, 5, 6, 7];      // Pipoya sprite ids for spectator reactions
    const ELEMENTS = ['earth', 'water', 'fire', 'wind', 'void'];
    const EL_COLOR = { earth: '#69d83a', water: '#5894f4', fire: '#ed1b43', wind: '#ffce00', void: '#9458f4' };
    let watching = null;          // { roomId, match, specCh }

    // ── Waiting room: host switch ─────────────────────────────────
    let lastPoll = 0, roomAllows = false;
    async function waitingRoomTick() {
        const panel = document.getElementById('waiting-room-panel');
        const visible = panel && panel.style.display !== 'none' && panel.offsetParent !== null;
        const id = g('currentGameId');
        if (!visible || id == null || watching) return;
        if (Date.now() - lastPoll > 3000) {
            lastPoll = Date.now();
            try {
                const { data } = await sb().from('game_room').select('allow_spectators').eq('id', id).maybeSingle();
                roomAllows = !!data?.allow_spectators;
            } catch (e) {}
        }
        const hostBox = document.getElementById('host-settings');
        if (hostBox && g('isHost')) {
            let row = document.getElementById('spectate-row');
            if (!row) {
                row = document.createElement('div');
                row.id = 'spectate-row';
                row.className = 'test-mode-row';
                row.innerHTML = `<label><input type="checkbox" id="spectate-toggle"> 👁 Allow spectators: anyone signed in can watch from the lobby (they never see hands)</label>`;
                hostBox.appendChild(row);
                row.querySelector('input').addEventListener('change', async (e) => {
                    const on = e.target.checked;
                    const { error } = await sb().from('game_room').update({ allow_spectators: on }).eq('id', g('currentGameId'));
                    if (error) { e.target.checked = !on; alert('Could not change the spectator setting: ' + error.message); return; }
                    roomAllows = on; lastPoll = Date.now(); renderNote(panel);
                });
            }
            const box = row.querySelector('input');
            if (document.activeElement !== box) box.checked = roomAllows;
        }
        renderNote(panel);
    }
    function renderNote(panel) {
        let n = document.getElementById('spectate-room-note');
        if (!roomAllows || g('isHost')) { n?.remove(); return; }
        if (!n) {
            n = document.createElement('div');
            n.id = 'spectate-room-note';
            n.className = 'spectate-room-note';
            const info = document.getElementById('room-info-bar');
            if (info && info.parentNode) info.parentNode.insertBefore(n, info.nextSibling); else panel.appendChild(n);
        }
        n.textContent = '👁 Spectators can watch this game (they only see what every player sees).';
    }

    // ── Lobby: games you can watch ────────────────────────────────
    let lastList = 0;
    async function lobbyTick() {
        const wrap = document.getElementById('lobby-wrapper');
        const lobbyVisible = wrap && wrap.style.display !== 'none' && !document.getElementById('game-layout')?.classList.contains('active');
        const anchor = document.getElementById('public-games-section');
        if (!lobbyVisible || !anchor || watching || document.hidden) return;
        if (Date.now() - lastList < 10000) return;
        lastList = Date.now();
        let games = [];
        try {
            const { data } = await sb().rpc('list_watchable_games');
            games = Array.isArray(data) ? data : [];
        } catch (e) {}
        let sec = document.getElementById('watch-games-section');
        if (!games.length) { sec?.remove(); return; }
        if (!sec) {
            sec = document.createElement('div');
            sec.id = 'watch-games-section';
            anchor.parentNode.insertBefore(sec, anchor.nextSibling);
        }
        const colorHex = (c) => (typeof PLAYER_COLORS !== 'undefined' && PLAYER_COLORS[c]) || '#ccc';
        sec.innerHTML = `<h3 class="watch-games-title">👁 Games you can watch</h3>` + games.map(gm => {
            const who = (gm.players || []).map(p => `<span style="color:${colorHex(p.color)}">${esc(String(p.username || '').replace(/^🤖\s*/, ''))}</span>`).join(' · ');
            const mins = Math.max(1, Math.round((Date.now() - new Date(gm.started_at).getTime()) / 60000));
            return `<div class="game-room-card watch-game-card">
                <div class="game-room-host">${esc(gm.host_name || 'Game')} <span class="watch-live">LIVE</span></div>
                <div class="watch-game-players">${who}</div>
                <div class="game-room-count">${mins} min</div>
                <button class="game-room-join-btn" data-watch="${gm.room_id}">Watch</button>
            </div>`;
        }).join('');
        sec.querySelectorAll('[data-watch]').forEach(b => b.onclick = (e) => { e.stopPropagation(); watch(+b.dataset.watch); });
    }

    // ── Watching ──────────────────────────────────────────────────
    async function watch(roomId) {
        if (watching || !window.Replay?.openLive) return;
        const veil = document.createElement('div');
        veil.className = 'retro-dlg-overlay';
        veil.innerHTML = `<div class="retro-dlg-box"><div class="retro-dlg-title">Joining as a spectator</div><div class="retro-dlg-line" id="spec-loading">Connecting...</div></div>`;
        document.body.appendChild(veil);
        const setStatus = (t) => { const el = document.getElementById('spec-loading'); if (el && t) el.textContent = t; };
        let specCh = null;
        const res = await window.Replay.openLive(roomId, {
            onStatus: (t) => { setStatus(t); if (t === 'Catching up...') veil.querySelector('.retro-dlg-title').textContent = 'Catching up'; },
            beforeOffline: (realChannel) => { specCh = joinSpecChannel(realChannel, roomId, true); },
            onMove: (m) => { if (m.event === 'game-over') onGameOver(); },
        });
        veil.remove();
        if (!res) { try { specCh?.unsubscribe(); } catch (e) {} return; }
        watching = { roomId, match: res.match, specCh };
        document.body.classList.add('spectating');
        buildBar();
        buildScoreboard();
        setInterval(tickSpectator, 500);
    }

    function joinSpecChannel(realChannel, roomId, asSpectator) {
        const key = (window.gami?.userId || 'anon') + '-' + Math.random().toString(36).slice(2, 7);
        const ch = realChannel('spectate-room-' + roomId, { config: { presence: { key }, broadcast: { self: true } } });
        ch.on('presence', { event: 'sync' }, () => {
            const n = Object.keys(ch.presenceState() || {}).length;
            if (asSpectator) { const el = document.getElementById('spec-count'); if (el) el.textContent = `👁 ${n} watching`; }
            else setPlayerCount(n);
        });
        if (asSpectator) ch.on('broadcast', { event: 'spec-emote' }, ({ payload }) => showEmote(payload));
        ch.subscribe((st) => {
            if (st === 'SUBSCRIBED' && asSpectator) {
                const name = window.gami?.profile?.display_name || window.gami?.profile?.username || 'Spectator';
                ch.track({ name });
            }
        });
        return ch;
    }

    function buildBar() {
        const bar = document.createElement('div');
        bar.id = 'spectate-bar';
        const names = (watching.match.players || []).map(p => String(p.username || '').replace(/^🤖\s*/, '')).join(' vs ');
        const follow = (() => { try { return localStorage.getItem('godaigo_spec_follow') !== 'off'; } catch (e) { return true; } })();
        bar.innerHTML = `<span class="spec-live">● LIVE</span><span class="spec-title"></span>
            <span id="spec-count">👁 1 watching</span>
            <label class="spec-follow"><input type="checkbox" ${follow ? 'checked' : ''}> Follow camera</label>
            <button type="button" data-act="emote">Emotes</button>
            <button type="button" data-act="exit">Exit</button>
            <div class="spec-emote-picker" hidden>${EMOTES.map(i => `<button type="button" data-emote="${i}">${window.emojiSystem?.spriteHtml?.(i, 0.9) || i}</button>`).join('')}</div>`;
        bar.querySelector('.spec-title').textContent = names;
        document.body.appendChild(bar);
        bar.querySelector('.spec-follow input').onchange = (e) => {
            try { localStorage.setItem('godaigo_spec_follow', e.target.checked ? 'on' : 'off'); } catch (er) {}
            if (e.target.checked) followActive(true);
        };
        const picker = bar.querySelector('.spec-emote-picker');
        bar.querySelector('[data-act=emote]').onclick = () => { picker.hidden = !picker.hidden; };
        let lastSent = 0;
        picker.querySelectorAll('[data-emote]').forEach(b => b.onclick = () => {
            if (Date.now() - lastSent < 1200) return;
            lastSent = Date.now();
            const name = window.gami?.profile?.display_name || window.gami?.profile?.username || 'Spectator';
            watching?.specCh?.send({ type: 'broadcast', event: 'spec-emote', payload: { i: +b.dataset.emote, name } });
        });
        bar.querySelector('[data-act=exit]').onclick = () => {
            try { sessionStorage.setItem('godaigo_skip_intro_once', '1'); } catch (e) {}
            location.reload();
        };
        const feed = document.createElement('div');
        feed.id = 'spec-emote-feed';
        document.body.appendChild(feed);
    }

    function showEmote(p) {
        const feed = document.getElementById('spec-emote-feed');
        if (!feed || p == null) return;
        const row = document.createElement('div');
        row.className = 'spec-emote';
        row.innerHTML = `<span class="spec-emote-name"></span> ${window.emojiSystem?.spriteHtml?.(+p.i || 0, 1) || ''}`;
        row.querySelector('.spec-emote-name').textContent = String(p.name || 'Spectator').slice(0, 24);
        feed.appendChild(row);
        while (feed.children.length > 6) feed.firstElementChild.remove();
        setTimeout(() => row.classList.add('leaving'), 7000);
        setTimeout(() => row.remove(), 7600);
    }

    // ── Scoreboard ────────────────────────────────────────────────
    function buildScoreboard() {
        const box = document.createElement('div');
        box.id = 'spectate-scoreboard';
        document.body.appendChild(box);
    }
    let lastHomeAt = 0, homeCache = {};
    function renderScoreboard() {
        const box = document.getElementById('spectate-scoreboard');
        if (!box) return;
        const seats = (watching.match.seats || []).slice().sort((a, b) => a.index - b.index);
        if (Date.now() - lastHomeAt > 2000 && window.BotSystem?.homeCost && window.BotState?.snapshot) {
            lastHomeAt = Date.now();
            try { const snap = window.BotState.snapshot(); seats.forEach(s => { homeCache[s.index] = window.BotSystem.homeCost(snap, s.index); }); } catch (e) {}
        }
        const active = g('activePlayerIndex');
        const rows = seats.map(s => {
            const i = s.index;
            const ps = window.spellSystem?.playerScrolls?.[i] || {};
            const act = ps.activated || new Set();
            const pool = (g('playerPools') || [])[i] || {};
            const poolTotal = ELEMENTS.reduce((t, e) => t + (pool[e] || 0), 0);
            const els = ELEMENTS.map(e => `<span class="spec-el ${act.has?.(e) ? 'on' : ''}" style="--el:${EL_COLOR[e]}" title="${e}"></span>`).join('');
            const ap = i === active ? `${(g('currentAP') || 0) + (g('voidAP') || 0)} AP` : '';
            const home = homeCache[i];
            const homeTxt = Number.isFinite(home) && home < 99 ? `${home} to home` : '';
            const name = typeof getPlayerColorName === 'function' ? getPlayerColorName(i) : s.username;
            const hand = ps.hand ? ps.hand.size : 0, activeN = ps.active ? ps.active.size : 0;
            return `<div class="spec-row ${i === active ? 'turn' : ''}">
                <div class="spec-name" style="color:${(typeof PLAYER_COLORS !== 'undefined' && PLAYER_COLORS[s.color]) || '#ccc'}">${i === active ? '▶ ' : ''}${esc(name)}</div>
                <div class="spec-els" title="Elements activated (all 5, then reach your home shrine to win)">${els}<b>${act.size || 0}/5</b></div>
                <div class="spec-meta"><span title="Stones in pool">◆ ${poolTotal}</span><span title="Scrolls: hand / active">📜 ${hand}/${activeN}</span>${homeTxt ? `<span title="AP to walk home">${esc(homeTxt)}</span>` : ''}${ap ? `<span class="spec-ap">${ap}</span>` : ''}</div>
            </div>`;
        }).join('');
        const html = `<div class="spec-sb-title">Scoreboard · turn ${esc(g('currentTurnNumber') ?? '')}</div>${rows}`;
        if (box.__last !== html) { box.__last = html; box.innerHTML = html; }
    }

    let lastActive = null;
    function followActive(force) {
        let on = true;
        try { on = localStorage.getItem('godaigo_spec_follow') !== 'off'; } catch (e) {}
        if (!on) return;
        const i = g('activePlayerIndex');
        if (!force && i === lastActive) return;
        lastActive = i;
        const p = (g('playerPositions') || [])[i];
        if (p && typeof window.panBoardTo === 'function') window.panBoardTo(p.x, p.y);
    }

    function tickSpectator() {
        if (!watching) return;
        renderScoreboard();
        followActive(false);
    }
    function onGameOver() {
        const t = document.querySelector('#spectate-bar .spec-live');
        if (t) { t.textContent = '■ ENDED'; t.classList.add('ended'); }
    }

    // ── Players: "N watching" tag ─────────────────────────────────
    let playerCh = null, playerRoom = null, checkedRoom = null;
    function setPlayerCount(n) {
        let tag = document.getElementById('spectator-count-tag');
        if (!n) { tag?.remove(); return; }
        if (!tag) {
            tag = document.createElement('div');
            tag.id = 'spectator-count-tag';
            tag.title = 'People watching this game. They only see what every player sees.';
            document.body.appendChild(tag);
        }
        tag.textContent = `👁 ${n} watching`;
    }
    async function playerTick() {
        if (watching) return;
        const inGame = !!document.getElementById('game-layout')?.classList.contains('active');
        const room = g('currentGameId');
        const seat = g('myPlayerIndex');
        const online = !!g('isMultiplayer') && typeof room === 'number' && seat != null && seat >= 0;
        if (!inGame || !online) {
            if (playerCh) { try { sb().removeChannel(playerCh); } catch (e) {} playerCh = null; playerRoom = null; setPlayerCount(0); }
            checkedRoom = null;
            return;
        }
        if (playerRoom === room || checkedRoom === room) return;
        checkedRoom = room;
        try {
            const { data } = await sb().from('game_room').select('allow_spectators').eq('id', room).maybeSingle();
            if (!data?.allow_spectators) return;
        } catch (e) { return; }
        playerRoom = room;
        playerCh = joinSpecChannel(sb().channel.bind(sb()), room, false);
    }

    setInterval(() => { waitingRoomTick(); lobbyTick(); playerTick(); }, 1000);
    window.Spectate = { watch, isWatching: () => !!watching };
})();
