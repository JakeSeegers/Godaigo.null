// social.js: friends list, online status, game invites and player cards.
//
// Server: sql/friends.sql (friend_links, friend_invites, RPCs
// send_friend_request / respond_friend_request / remove_friend / my_friends /
// touch_last_seen / set_hide_online / send_game_invite / my_game_invites /
// dismiss_game_invite / get_player_card).
//
// Online status: Supabase Realtime presence on channel "godaigo-online",
// keyed by user id, payload { status: 'lobby' | 'room' | 'game' }. Players
// who "appear offline" (user_profiles.hide_online) never join it.
// last_seen_at (touch_last_seen every 3 min) covers "last seen 2 h ago".
//
// Invites go through the database (never broadcast), polled every 10 s
// while signed in; a pop-up shows only when you are free in the lobby.
//
// Recent players (my_recent_players) in the panel; Play Again Together
// (game-over button, lobby.js) -> playAgain() saves who/bots, the page
// reloads, resumeIntents() makes a private room (window.playAgainRoom) and
// invites them. Invites also pop up on the game-over screen; Join there
// returns to the lobby and joins after the reload.
//
// Player cards: click any element with data-player-card="<user id>"
// (leaderboard, waiting room, in-game names, friends list).
(function () {
    'use strict';

    const PRESENCE_CHANNEL = 'godaigo-online';
    const INVITE_POLL_MS = 10000;
    const FRIENDS_POLL_MS = 60000;
    const SEEN_EVERY_MS = 3 * 60 * 1000;

    let myId = null;
    let presence = null;      // realtime channel
    let online = new Map();   // user id -> status
    let myStatus = null;
    let friends = [];         // rows from my_friends()
    let recent = [];          // rows from my_recent_players()
    const AGAIN_KEY = 'godaigo_play_again';       // sessionStorage: {users, bots, at}
    const JOIN_KEY = 'godaigo_join_after_reload'; // sessionStorage: {game, at}
    let shownInvites = new Set();
    let started = false;

    const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const nameStyle = (colorId) => (colorId && window.cosmeticsSystem?.getNameColorStyle?.(colorId)) || '';
    const hidden = () => !!window.gami?.profile?.hide_online;

    // Where am I right now: 'game' (board open: game, tutorial, replay),
    // 'room' (waiting room) or 'lobby'.
    function whereAmI() {
        try {
            if (document.getElementById('game-layout')?.classList.contains('active')) return 'game';
            if (typeof currentGameId !== 'undefined' && currentGameId) return 'room';
        } catch (e) {}
        return 'lobby';
    }

    function timeAgo(iso) {
        if (!iso) return '';
        const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
        if (s < 90) return 'just now';
        if (s < 3600) return `${Math.round(s / 60)} min ago`;
        if (s < 86400) return `${Math.round(s / 3600)} h ago`;
        const d = Math.round(s / 86400);
        return d === 1 ? '1 day ago' : `${d} days ago`;
    }

    // ── Presence ─────────────────────────────────────────────────
    function joinPresence() {
        if (presence || hidden() || !myId) return;
        try {
            presence = supabase.channel(PRESENCE_CHANNEL, { config: { presence: { key: myId } } });
            presence.on('presence', { event: 'sync' }, () => {
                const state = presence.presenceState();
                online = new Map();
                for (const [uid, metas] of Object.entries(state)) {
                    const st = metas?.[metas.length - 1]?.status || 'lobby';
                    online.set(uid, st);
                }
                renderPanel();
            });
            presence.subscribe((s) => {
                if (s === 'SUBSCRIBED') { myStatus = null; updateMyStatus(); }
            });
        } catch (e) { presence = null; }
    }

    function leavePresence() {
        if (!presence) return;
        try { presence.untrack(); supabase.removeChannel(presence); } catch (e) {}
        presence = null;
        online = new Map();
        myStatus = null;
    }

    function updateMyStatus() {
        if (!presence) return;
        const st = whereAmI();
        if (st === myStatus) return;
        myStatus = st;
        try { presence.track({ status: st }); } catch (e) {}
        renderPanel();
    }

    function statusOf(f) {
        if (f.hidden) return { cls: 'off', text: 'Offline' };
        const st = online.get(f.user_id);
        if (st === 'game') return { cls: 'game', text: 'In a game' };
        if (st === 'room') return { cls: 'on', text: 'In a waiting room' };
        if (st) return { cls: 'on', text: 'Online' };
        return { cls: 'off', text: f.last_seen_at ? `Last seen ${timeAgo(f.last_seen_at)}` : 'Offline' };
    }

    // ── Data ─────────────────────────────────────────────────────
    async function loadFriends() {
        try {
            const { data, error } = await supabase.rpc('my_friends');
            if (!error) friends = data || [];
        } catch (e) {}
        // Recent players only matter while the panel is open.
        if (document.getElementById('social-list')) {
            try {
                const { data, error } = await supabase.rpc('my_recent_players');
                if (!error) recent = data || [];
            } catch (e) {}
        }
        updateBadge();
        renderPanel();
    }

    function updateBadge() {
        const btn = document.getElementById('friends-btn');
        if (!btn) return;
        const n = friends.filter(f => f.state === 'incoming').length;
        btn.textContent = n ? `Friends (${n})` : 'Friends';
        btn.classList.toggle('has-requests', n > 0);
    }

    // ── Modal helpers ────────────────────────────────────────────
    function overlay(id) {
        document.getElementById(id)?.remove();
        const o = document.createElement('div');
        o.id = id;
        o.className = 'social-overlay';
        o.addEventListener('click', (e) => { if (e.target === o) o.remove(); });
        document.body.appendChild(o);
        return o;
    }

    // ── Friends panel ────────────────────────────────────────────
    function openFriends() {
        const o = overlay('social-friends');
        o.innerHTML = `
            <div class="social-modal" role="dialog" aria-label="Friends">
                <div class="social-title">Friends</div>
                <div class="social-add">
                    <input type="text" class="acct-input" id="social-add-name" placeholder="Add a friend by username" maxlength="40">
                    <button class="acct-btn" id="social-add-btn">Add</button>
                </div>
                <div class="social-msg" id="social-msg"></div>
                <div class="social-list" id="social-list"><div class="social-empty">Loading...</div></div>
                <label class="social-hide"><input type="checkbox" id="social-hide" ${hidden() ? 'checked' : ''}>
                    Appear offline (friends will not see when you are online)</label>
                <div class="acct-actions"><button class="acct-btn" data-close>Close</button></div>
            </div>`;
        o.querySelector('[data-close]').onclick = () => o.remove();
        const input = o.querySelector('#social-add-name');
        const add = async () => {
            const name = input.value.trim();
            if (!name) return;
            await sendRequest(null, name);
            input.value = '';
        };
        o.querySelector('#social-add-btn').onclick = add;
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter') add(); });
        o.querySelector('#social-hide').onchange = (e) => setHidden(e.target.checked);
        o.querySelector('#social-list').addEventListener('click', onListClick);
        loadFriends();
    }

    function msg(text) {
        const el = document.getElementById('social-msg');
        if (el) el.textContent = text || '';
    }

    const SEND_TEXT = {
        sent: 'Friend request sent.',
        accepted: 'You are now friends!',
        already: 'You are already friends.',
        pending: 'You already sent a request. Waiting for them to accept.',
        not_found: 'No player with that name.',
        self: 'That is you!',
        limit: 'You have too many open requests. Wait for some to be answered.',
    };

    async function sendRequest(userId, name) {
        const { data, error } = await supabase.rpc('send_friend_request', { p_user: userId, p_name: name });
        const text = error ? 'Could not send: ' + error.message : (SEND_TEXT[data] || 'Done.');
        msg(text);
        await loadFriends();
        return { result: data, text };
    }

    function friendRow(f) {
        const name = `<span class="social-name" data-player-card="${esc(f.user_id)}" style="${nameStyle(f.name_color)}">${esc(f.name)}</span>`;
        if (f.state === 'incoming') {
            return `<div class="social-row">${name}<span class="social-sub">wants to be friends</span>
                <span class="social-actions"><button class="acct-btn" data-act="accept" data-id="${esc(f.user_id)}">Accept</button>
                <button class="acct-btn acct-btn-secondary" data-act="decline" data-id="${esc(f.user_id)}">Decline</button></span></div>`;
        }
        if (f.state === 'outgoing') {
            return `<div class="social-row">${name}<span class="social-sub">request sent</span>
                <span class="social-actions"><button class="acct-btn acct-btn-secondary" data-act="cancel" data-id="${esc(f.user_id)}">Cancel</button></span></div>`;
        }
        const st = statusOf(f);
        const canInvite = whereAmI() === 'room' && st.cls === 'on';
        return `<div class="social-row"><span class="social-dot ${st.cls}"></span>${name}<span class="social-sub">${esc(st.text)}</span>
            <span class="social-actions">
                ${canInvite ? `<button class="acct-btn" data-act="invite" data-id="${esc(f.user_id)}">Invite</button>` : ''}
                ${window.GamePlans ? `<button class="acct-btn acct-btn-secondary" data-act="plan" data-id="${esc(f.user_id)}" title="Plan a game with ${esc(f.name)}: pick times, they vote">Plan</button>` : ''}
                <button class="acct-btn acct-btn-secondary social-remove" data-act="remove" data-id="${esc(f.user_id)}" data-name="${esc(f.name)}" title="Remove friend">&times;</button>
            </span></div>`;
    }

    // Someone you played with lately (not a friend yet).
    function recentRow(r) {
        const name = `<span class="social-name" data-player-card="${esc(r.user_id)}" style="${nameStyle(r.name_color)}">${esc(r.name)}</span>`;
        const on = online.has(r.user_id) && online.get(r.user_id) !== 'game';
        const sub = `played ${timeAgo(r.last_played)}${r.games > 1 ? ` · ${r.games} games` : ''}`;
        const btn = r.friend_state === 'outgoing' ? '<button class="acct-btn" disabled>Requested</button>'
            : r.friend_state === 'incoming' ? `<button class="acct-btn" data-act="accept" data-id="${esc(r.user_id)}">Accept</button>`
            : `<button class="acct-btn" data-act="add" data-id="${esc(r.user_id)}">Add friend</button>`;
        return `<div class="social-row"><span class="social-dot ${on ? 'on' : 'off'}"></span>${name}<span class="social-sub">${esc(sub)}</span>
            <span class="social-actions">${whereAmI() === 'room' && on ? `<button class="acct-btn" data-act="invite" data-id="${esc(r.user_id)}">Invite</button>` : ''}${btn}</span></div>`;
    }

    function renderPanel() {
        const list = document.getElementById('social-list');
        if (!list) return;
        const incoming = friends.filter(f => f.state === 'incoming');
        const outgoing = friends.filter(f => f.state === 'outgoing');
        const rank = (f) => ({ on: 0, game: 1, off: 2 }[statusOf(f).cls]); // free first: they can be invited
        const mine = friends.filter(f => f.state === 'friend')
            .sort((a, b) => rank(a) - rank(b) || String(a.name).localeCompare(String(b.name)));
        let html = '';
        if (incoming.length) html += `<div class="social-head">Requests</div>` + incoming.map(friendRow).join('');
        html += `<div class="social-head">Friends${mine.length ? ` (${mine.length})` : ''}</div>`;
        html += mine.length ? mine.map(friendRow).join('')
            : '<div class="social-empty">No friends yet. Add someone by their username, or click a name on the leaderboard.</div>';
        const others = recent.filter(r => r.friend_state !== 'friend');
        if (others.length) html += `<div class="social-head">Recent players</div>` + others.map(recentRow).join('');
        if (outgoing.length) html += `<div class="social-head">Sent requests</div>` + outgoing.map(friendRow).join('');
        if (whereAmI() !== 'room' && mine.length) html += '<div class="social-note">Tip: create a room first, then invite friends who are online.</div>';
        list.innerHTML = html;
    }

    async function onListClick(e) {
        const b = e.target.closest('button[data-act]');
        if (!b) return;
        const id = b.dataset.id;
        b.disabled = true;
        if (b.dataset.act === 'accept' || b.dataset.act === 'decline') {
            await supabase.rpc('respond_friend_request', { p_user: id, p_accept: b.dataset.act === 'accept' });
            msg(b.dataset.act === 'accept' ? 'You are now friends!' : '');
        } else if (b.dataset.act === 'add') {
            await sendRequest(id, null);
        } else if (b.dataset.act === 'cancel') {
            await supabase.rpc('remove_friend', { p_user: id });
        } else if (b.dataset.act === 'remove') {
            if (!confirm(`Remove ${b.dataset.name} from your friends?`)) { b.disabled = false; return; }
            await supabase.rpc('remove_friend', { p_user: id });
        } else if (b.dataset.act === 'plan') {
            b.disabled = false;
            planWith(id);
            return;
        } else if (b.dataset.act === 'invite') {
            const { data, error } = await supabase.rpc('send_game_invite', { p_user: id });
            msg(error ? 'Could not invite: ' + error.message
                : ({ sent: 'Invite sent!', no_room: 'Create or join a room first.', too_many: 'Wait a moment before inviting again.',
                     not_friends: 'You can invite friends, or players from a game you just finished.' }[data] || ''));
            b.disabled = false;
            return;
        }
        loadFriends();
    }

    // Plan a game with one friend (js/game-plans.js): close the Friends panel /
    // player card and open the plan form with that friend already ticked.
    function planWith(userId) {
        if (!window.GamePlans?.openCreate) return;
        document.querySelectorAll('.social-overlay').forEach(x => x.remove());
        window.GamePlans.openCreate({ with: [userId] });
    }

    async function setHidden(hide) {
        const { error } = await supabase.rpc('set_hide_online', { p_hide: hide });
        if (error) { msg('Could not save: ' + error.message); return; }
        if (window.gami?.profile) window.gami.profile.hide_online = hide;
        if (hide) leavePresence();
        else { joinPresence(); supabase.rpc('touch_last_seen').then(() => {}, () => {}); }
        msg(hide ? 'You now appear offline.' : 'Friends can see when you are online.');
    }

    // ── Game invites ─────────────────────────────────────────────
    const onGameOver = () => !!document.getElementById('game-over-notification') && !window.Replay?.state;

    async function pollInvites() {
        if (!myId || !(whereAmI() === 'lobby' || onGameOver())) return;
        let rows = [];
        try {
            const { data, error } = await supabase.rpc('my_game_invites');
            if (error) return;
            rows = data || [];
        } catch (e) { return; }
        const inv = rows.find(r => !shownInvites.has(r.id));
        if (inv) showInvite(inv);
    }

    function showInvite(inv) {
        shownInvites.add(inv.id);
        document.getElementById('social-invite')?.remove();
        const el = document.createElement('div');
        el.id = 'social-invite';
        el.innerHTML = `
            <div class="social-invite-text"><b>${esc(inv.from_name)}</b> invited you to their game!</div>
            <div class="social-invite-actions">
                <button class="acct-btn" data-act="join">Join</button>
                <button class="acct-btn acct-btn-secondary" data-act="no">No thanks</button>
            </div>`;
        document.body.appendChild(el);
        try { window.SoundSystem?.play?.('activatescroll', 0.6); } catch (e) {}
        const done = () => { el.remove(); supabase.rpc('dismiss_game_invite', { p_id: inv.id }).then(() => {}, () => {}); };
        el.querySelector('[data-act=no]').onclick = done;
        el.querySelector('[data-act=join]').onclick = async () => {
            done();
            // From the game-over screen: go back to the lobby (the normal
            // cleanup + reload), then join right after the reload.
            if (onGameOver()) {
                try { sessionStorage.setItem(JOIN_KEY, JSON.stringify({ game: inv.game_id, at: Date.now() })); } catch (e) {}
                const back = [...document.querySelectorAll('#game-over-notification button')].find(x => /Return to Lobby/i.test(window.srcText ? srcText(x) : x.textContent));
                if (back) { back.click(); return; }
            }
            if (whereAmI() !== 'lobby') { alert('Leave your current room or game first, then accept the invite.'); return; }
            document.getElementById('social-friends')?.remove();
            if (typeof window.joinPublicGame === 'function') await window.joinPublicGame(inv.game_id);
        };
        setTimeout(() => el.remove(), 60000);
    }

    // ── Player cards ─────────────────────────────────────────────
    async function openCard(userId) {
        if (!userId) return;
        const o = overlay('social-card');
        o.innerHTML = '<div class="social-modal"><div class="social-empty">Loading...</div></div>';
        const { data: c, error } = await supabase.rpc('get_player_card', { p_user: userId });
        if (!document.body.contains(o)) return;
        if (error || !c) { o.innerHTML = '<div class="social-modal"><div class="social-empty">Could not load this player.</div></div>'; return; }
        const f = { user_id: c.user_id, hidden: false, last_seen_at: c.last_seen_at };
        const status = c.friend_state === 'friend' ? statusOf(f).text : '';
        const winPct = c.games ? Math.round(100 * c.wins / c.games) : 0;
        const friendBtn = {
            none: '<button class="acct-btn" data-act="add">Add friend</button>',
            outgoing: '<button class="acct-btn" disabled>Request sent</button>',
            incoming: '<button class="acct-btn" data-act="accept">Accept friend request</button>',
            friend: (window.GamePlans ? '<button class="acct-btn" data-act="plan">Plan a game</button>' : '')
                + '<button class="acct-btn acct-btn-secondary" disabled>Friends</button>',
            self: '',
        }[c.friend_state] || '';
        const replays = (c.replays || []).map(r =>
            `<div class="social-replay"><span>${esc(new Date(r.started_at).toLocaleDateString())}${r.won ? ' · <b>won</b>' : ''}</span>
             <button class="acct-btn" data-act="watch" data-id="${r.id}">Watch</button></div>`).join('');
        o.innerHTML = `
            <div class="social-modal social-card" role="dialog" aria-label="Player card">
                <div class="social-card-name" style="${nameStyle(c.name_color)}">${esc(c.name)}</div>
                ${status ? `<div class="social-card-status">${esc(status)}</div>` : ''}
                <div class="social-stats">
                    <div><span>Level</span><b>${c.level ?? 1}</b></div>
                    <div><span>Ladder</span><b>${c.rank ? '#' + c.rank : '-'}</b></div>
                    <div><span>Games</span><b>${c.games}</b></div>
                    <div><span>Wins</span><b>${c.wins}${c.games ? ` (${winPct}%)` : ''}</b></div>
                    <div><span>Elements</span><b>${c.elements}</b></div>
                    <div><span>Joined</span><b>${esc(new Date(c.member_since).toLocaleDateString())}</b></div>
                </div>
                ${replays ? `<div class="social-head">Public replays</div>${replays}` : ''}
                <div class="social-msg" id="social-card-msg"></div>
                <div class="acct-actions">${friendBtn}<button class="acct-btn acct-btn-secondary" data-close>Close</button></div>
            </div>`;
        o.querySelector('[data-close]').onclick = () => o.remove();
        o.querySelector('.social-card').addEventListener('click', async (e) => {
            const b = e.target.closest('button[data-act]');
            if (!b) return;
            if (b.dataset.act === 'plan') { planWith(c.user_id); return; }
            if (b.dataset.act === 'watch') {
                if (whereAmI() !== 'lobby') { alert('Replays can be watched from the lobby.'); return; }
                document.querySelectorAll('.social-overlay').forEach(x => x.remove());
                window.Replay?.open(+b.dataset.id);
                return;
            }
            b.disabled = true;
            if (b.dataset.act === 'add') {
                const r = await sendRequest(c.user_id, null);
                const m = document.getElementById('social-card-msg');
                if (m) m.textContent = r.text;
                b.textContent = r.result === 'accepted' ? 'Friends' : 'Request sent';
            } else if (b.dataset.act === 'accept') {
                await supabase.rpc('respond_friend_request', { p_user: c.user_id, p_accept: true });
                b.textContent = 'Friends';
                loadFriends();
            }
        });
    }

    // Any element with data-player-card="<user id>" opens that player's card.
    document.addEventListener('click', (e) => {
        const el = e.target.closest?.('[data-player-card]');
        if (!el || !el.dataset.playerCard || !myId) return;
        e.preventDefault();
        e.stopPropagation();
        openCard(el.dataset.playerCard);
    }, true);

    // ── Play Again Together ──────────────────────────────────────
    // Called from the game-over screen (lobby.js) just before "Return to
    // Lobby" reloads the page: remember who to invite and how many bots.
    function playAgain(seats) {
        const users = [], seen = new Set();
        let bots = 0;
        for (const p of seats || []) {
            if (window.isBotUsername?.(p.username)) { bots++; continue; }
            if (p.user_id && p.user_id !== myId && !seen.has(p.user_id)) { seen.add(p.user_id); users.push(p.user_id); }
        }
        try { sessionStorage.setItem(AGAIN_KEY, JSON.stringify({ users, bots, at: Date.now() })); } catch (e) {}
    }

    function takeIntent(key) {
        try {
            const raw = sessionStorage.getItem(key);
            sessionStorage.removeItem(key);
            const v = raw ? JSON.parse(raw) : null;
            return v && Date.now() - v.at < 5 * 60 * 1000 ? v : null;
        } catch (e) { return null; }
    }

    // Resolves once the lobby is on screen and signed in (max 30 s).
    function lobbyReady() {
        return new Promise((resolve) => {
            const t0 = Date.now();
            const tick = () => {
                const lobby = document.getElementById('multiplayer-lobby');
                const ok = window.currentUsername && lobby && lobby.style.display !== 'none' && whereAmI() === 'lobby';
                if (ok) return resolve(true);
                if (Date.now() - t0 > 30000) return resolve(false);
                setTimeout(tick, 500);
            };
            tick();
        });
    }

    async function resumeIntents() {
        const again = takeIntent(AGAIN_KEY);
        const join = takeIntent(JOIN_KEY);
        if (!again && !join) return;
        if (!(await lobbyReady())) return;
        if (join && typeof window.joinPublicGame === 'function') { await window.joinPublicGame(join.game); return; }
        if (again && typeof window.playAgainRoom === 'function') {
            const ok = await window.playAgainRoom(again.bots, again.users.length === 0);
            if (!ok) return;
            let sent = 0;
            for (const uid of again.users) {
                try { const { data } = await supabase.rpc('send_game_invite', { p_user: uid }); if (data === 'sent') sent++; } catch (e) {}
            }
            if (again.users.length && typeof setBrowserStatus === 'function') {
                try { setBrowserStatus(sent ? `Invited ${sent} player${sent === 1 ? '' : 's'} from your last game.` : 'Could not invite the other players.'); } catch (e) {}
            }
        }
    }

    // ── Start once signed in ─────────────────────────────────────
    function start() {
        if (started) return;
        const id = window.gami?.userId;
        if (!id || !window.gami?.profile) return;
        started = true;
        myId = id;
        joinPresence();
        loadFriends();
        supabase.rpc('touch_last_seen').then(() => {}, () => {});
        setInterval(updateMyStatus, 3000);
        setInterval(pollInvites, INVITE_POLL_MS);
        setInterval(loadFriends, FRIENDS_POLL_MS);
        setInterval(() => { if (!hidden()) supabase.rpc('touch_last_seen').then(() => {}, () => {}); }, SEEN_EVERY_MS);
        resumeIntents();
    }
    const waitStart = setInterval(() => { start(); if (started) clearInterval(waitStart); }, 1000);

    window.Social = { openFriends, openCard, playAgain, whereAmI, isOnline: (id) => online.has(id) };
})();
