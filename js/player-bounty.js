// player-bounty.js: player bounties, "Beat me and win this" (window.PlayerBounty).
//
// Server: sql/player-bounties.sql. Starting a bounty needs the 300g unlock
// (Shop > Features or the waiting-room box); then any signed-in (not guest)
// player in the waiting room can add 100 to 500 gold; adds stack. The host is the
// one to beat:
//   * another signed-in human wins (6+ turns, win confirmed): they get it all,
//   * the host wins (or a guest wins, or the game was too short): refunds,
//   * a bot wins or nobody wins: the gold goes into the pot.
// The server settles lazily: this file calls settle_player_bounty(room) after
// game over (and again while the win is waiting for a witness) and
// settle_my_player_bounties() after sign-in. Results come as reward pop-ups
// (reward_notices kind 'bounty', js/rewards.js).
(function () {
    'use strict';

    const MIN = 100, MAX = 500;
    const COIN = 73; // Gold Coin pixel emote
    const S = {
        get currentGameId() { try { return currentGameId; } catch (e) { return null; } },
        get isMultiplayer() { try { return isMultiplayer; } catch (e) { return false; } },
        get supabase() { try { return supabase; } catch (e) { return null; } },
    };
    const esc = (t) => String(t ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const coin = (s) => window.emojiSystem?.spriteHtml?.(COIN, s) || '';
    const gami = () => window.gami;
    const isGuest = () => /^Guest[A-Z0-9]{6}$/.test(gami()?.profile?.display_name || '');

    // Starting a bounty is a Shop feature (300g, buy_bounty_feature ->
    // 'feature_bounty' in cosmetics_owned). Adding to one already up is free.
    // The Hermit has it free.
    const PRICE = 300;
    function owned() {
        try { if (typeof window.isHermit === 'function' && window.isHermit()) return true; } catch (e) {}
        const own = gami()?.profile?.cosmetics_owned;
        return Array.isArray(own) && own.includes('feature_bounty');
    }
    async function buy() {
        const prof = gami()?.profile;
        if (!prof || !gami()?.userId) return { ok: false, msg: 'Log in first' };
        if (owned()) return { ok: true };
        if ((prof.gold || 0) < PRICE) return { ok: false, msg: `Need ${PRICE}g (you have ${prof.gold || 0}g)` };
        const { data, error } = await S.supabase.rpc('buy_bounty_feature');
        if (error) return { ok: false, msg: /enough gold/.test(error.message) ? 'Not enough gold' : /already/.test(error.message) ? 'Already unlocked' : 'Could not unlock bounties' };
        prof.gold = typeof data === 'number' ? data : prof.gold - PRICE;
        prof.cosmetics_owned = (prof.cosmetics_owned || []).concat(['feature_bounty']);
        return { ok: true };
    }

    // ------------------------------------------------------------ lobby room cards
    let cards = new Map();
    async function refreshList() {
        try {
            const { data } = await S.supabase.rpc('list_player_bounties');
            cards = new Map((data || []).map(b => [b.room_id, b]));
        } catch (e) {}
        return cards;
    }
    function cardBadge(roomId) {
        const b = cards.get(roomId);
        if (!b || !b.total) return '';
        return ` <span class="game-room-pbounty" title="Beat ${esc(b.host_name || 'the host')} and win ${b.total} gold">${coin(0.6)} ${b.total}g bounty</span>`;
    }

    // ------------------------------------------------------------ waiting room box
    let current = null, lastPoll = 0, polling = false, posting = false;
    async function poll(room) {
        if (polling) return;
        polling = true;
        try {
            const { data } = await S.supabase.rpc('get_player_bounty', { p_room: room });
            current = data && data.room_id === room ? data : null;
        } catch (e) {}
        polling = false;
    }
    function waitingRoomTick() {
        const panel = document.getElementById('waiting-room-panel');
        const visible = panel && panel.style.display !== 'none' && panel.offsetParent !== null;
        let box = document.getElementById('pbounty-box');
        const room = S.currentGameId;
        if (!visible || room == null || !gami()?.userId) { box?.remove(); current = null; return; }
        if (Date.now() - lastPoll > 3000) { lastPoll = Date.now(); poll(room); }
        if (!box) {
            box = document.createElement('div');
            box.id = 'pbounty-box';
            box.className = 'pbounty-box';
            const anchor = document.getElementById('test-game-room-banner') || document.getElementById('room-info-bar');
            if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(box, anchor.nextSibling); else panel.appendChild(box);
        }
        render(box);
    }
    function render(box) {
        const b = current && current.room_id === S.currentGameId && current.status === 'open' ? current : null;
        const host = b?.host_name || 'the host';
        const stakes = (b?.stakes || []).map(s => `${esc(s.name || 'someone')} ${s.gold}g`).join(', ');
        const head = b
            ? `${coin(0.7)} <b>Bounty: ${b.total}g.</b> Beat ${esc(host)} and win it all. <span class="pbounty-who">(${stakes})</span>`
            : `${coin(0.7)} <b>No bounty yet.</b> Put up gold: whoever beats the host wins it.`;
        const rules = 'If the host wins, everyone gets their gold back. If a bot wins, it goes into the pot. Needs 6+ turns; guests cannot win it.';
        const canAdd = !isGuest();
        const locked = canAdd && !b && !owned();      // starting one needs the unlock
        const sig = `${head}|${canAdd}|${locked}`;
        if (box.dataset.sig === sig) return;          // keep the input box while typing
        box.dataset.sig = sig;
        box.innerHTML = `<div class="pbounty-head">${head}</div>
            <div class="pbounty-rules">${rules}</div>
            ${locked ? `<div class="pbounty-add">
                <button type="button" id="pbounty-unlock">Unlock bounties (${PRICE}g)</button>
                <span class="pbounty-rules">Unlock once to start bounties. Anyone can add to a bounty that is already up.</span>
                <span id="pbounty-msg"></span></div>`
            : canAdd ? `<div class="pbounty-add">
                <input type="number" id="pbounty-amount" min="${MIN}" max="${MAX}" step="50" value="${MIN}">
                <button type="button" id="pbounty-post">Add to bounty</button>
                <span id="pbounty-msg"></span></div>` : '<div class="pbounty-rules">Sign in with an account (not a guest) to add gold.</div>'}`;
        box.querySelector('#pbounty-post')?.addEventListener('click', post);
        box.querySelector('#pbounty-unlock')?.addEventListener('click', async () => {
            if (!window.confirm(`Unlock bounties for ${PRICE}g? You can then start bounties in any room.`)) return;
            const res = await buy();
            const m = box.querySelector('#pbounty-msg');
            if (!res.ok) { if (m) m.textContent = res.msg; return; }
            gami()?.notify?.('Bounties unlocked!', 0, 'gold');
            box.dataset.sig = '';
            render(box);
        });
    }
    async function post() {
        if (posting) return;
        const box = document.getElementById('pbounty-box');
        const msg = box?.querySelector('#pbounty-msg');
        const n = Math.round(Number(box?.querySelector('#pbounty-amount')?.value) || 0);
        const say = (t) => { if (msg) msg.textContent = t; };
        if (n < MIN || n > MAX) { say(`Choose ${MIN} to ${MAX} gold.`); return; }
        const gold = gami()?.profile?.gold ?? 0;
        if (gold < n) { say(`Not enough gold (you have ${gold}g).`); return; }
        if (!window.confirm(`Add ${n} gold to the bounty? You get it back if the host wins. If a bot wins, it goes into the pot.`)) return;
        posting = true;
        try {
            const { data, error } = await S.supabase.rpc('post_player_bounty', { p_room: S.currentGameId, p_gold: n });
            if (error) {
                const m = error.message || '';
                say(/enough gold/.test(m) ? 'Not enough gold.' : /before the game/.test(m) ? 'The game already started.'
                    : /guest/.test(m) ? 'Guests cannot add gold.' : /unlock/.test(m) ? `Unlock bounties (${PRICE}g) to start one.` : 'Could not add to the bounty.');
                return;
            }
            if (gami()?.profile) gami().profile.gold = Math.max(0, gold - n);
            gami()?.notify?.(`Bounty is now ${data}g`, 0, 'gold');
            lastPoll = 0;
            await poll(S.currentGameId);
            const b = document.getElementById('pbounty-box');
            if (b) { b.dataset.sig = ''; render(b); }
        } finally { posting = false; }
    }

    // ------------------------------------------------------------ in game: one status line
    let toldRoom = null;
    async function gameTick() {
        const room = S.currentGameId;
        const inGame = S.isMultiplayer && document.getElementById('game-layout')?.classList.contains('active') && !window.Replay?.state;
        if (!inGame || room == null) { toldRoom = null; return; }
        if (toldRoom === room) return;
        toldRoom = room;
        await poll(room);
        if (!current || current.status !== 'open' || !current.total) return;
        const msg = `Bounty on this game: ${current.total}g. Beat ${current.host_name || 'the host'} to win it!`;
        try { updateStatus(msg); } catch (e) {}
        gami()?.notify?.(coin(0.8) + esc(msg), 0, 'gold');
    }

    // ------------------------------------------------------------ settling
    // Game over (lobby.js showGameOverToAll): the win is paid a few seconds
    // later and may wait for a witness, so try a few times.
    function onGameOver() {
        const room = S.currentGameId;
        if (room == null || !gami()?.userId) return;
        const tries = [6000, 15000, 35000, 70000];
        let done = false;
        tries.forEach(ms => setTimeout(async () => {
            if (done) return;
            try {
                const { data } = await S.supabase.rpc('settle_player_bounty', { p_room: room });
                if (!data || (data.status && data.status !== 'open')) {
                    done = true;
                    if (data) window.Rewards?.checkNotices?.();
                }
            } catch (e) {}
        }, ms));
    }
    let settledFor = null;
    async function settleMine() {
        const uid = gami()?.userId;
        if (!uid || !gami()?.profile || settledFor === uid) return;
        settledFor = uid;
        try {
            const { data } = await S.supabase.rpc('settle_my_player_bounties');
            if (data > 0) window.Rewards?.checkNotices?.();
        } catch (e) {}
    }

    setInterval(() => {
        try { waitingRoomTick(); } catch (e) {}
        try { gameTick(); } catch (e) {}
        try { settleMine(); } catch (e) {}
    }, 1000);

    window.PlayerBounty = { refreshList, cardBadge, onGameOver, MIN, MAX, PRICE, owned, buy, current: () => current };
})();
