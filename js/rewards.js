// rewards.js: Hermit rewards on the player side (sql/hermit-rewards.sql).
//
//   * Badge catalog: every badge row (normal + special). Special badges
//     (criteria.type "special") have a picture in images/badges/ (badge.image)
//     and are only given by the Hermit.
//   * badgesHtml(ids): small badge icons for next to a player's name
//     (cosmetics-system.js seatNameHtml, lobby waiting room, leaderboard).
//   * Sign-up events: after sign-in, once the profile exists,
//     claim_signup_events() (the server decides if this account wins).
//   * Reward pop-ups: my_reward_notices() at sign-in, after a game ends and
//     every 30 s; each shows the Hermit's message and what was given, then
//     mark_reward_notice_seen().
//   * Badge slots: showBadge / hideBadge (set_shown_badges, max
//     profile.badge_slots) and buySlot (buy_badge_slot, 700g, max 3).
//   * Bounty notice: when an online game starts in a room with a Hermit
//     reward on it, a status line says so.
(function () {
    'use strict';

    const SLOT_PRICE = 700;   // must match badge_slot_price() on the server
    const MAX_SLOTS = 3;
    const IMG_OK = /^[A-Za-z0-9_\-]{1,60}\.(png|webp|gif)$/;

    const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const gami = () => window.gami;
    const signedIn = () => !!(gami()?.userId && gami()?.profile);

    // ── Badge catalog ───────────────────────────────────────────
    let catalog = new Map();   // id -> badge row
    let catalogLoaded = null;
    function loadCatalog(force) {
        if (catalogLoaded && !force) return catalogLoaded;
        catalogLoaded = (async () => {
            try {
                const { data } = await supabase.from('badges').select('id, name, description, icon, image, criteria');
                catalog = new Map((data || []).map(b => [b.id, b]));
            } catch (e) {}
            return catalog;
        })();
        return catalogLoaded;
    }

    function isSpecial(b) { return b?.criteria?.type === 'special'; }

    function iconHtml(id, cls) {
        const b = catalog.get(id);
        if (!b) return '';
        const title = esc(b.name || id);
        if (b.image && IMG_OK.test(b.image)) {
            return `<img class="${cls || 'name-badge'}" src="images/badges/${b.image}" alt="${title}" title="${title}" draggable="false">`;
        }
        return `<span class="${cls || 'name-badge'} name-badge-emoji" title="${title}">${esc(b.icon || '🏅')}</span>`;
    }

    // Icons for next to a name (at most MAX_SLOTS).
    function badgesHtml(ids) {
        if (!Array.isArray(ids) || !ids.length) return '';
        const html = ids.slice(0, MAX_SLOTS).map(id => iconHtml(id)).join('');
        return html ? `<span class="name-badges">${html}</span>` : '';
    }

    // Shown badges of an account: own from the live profile, others from
    // the cosmetics cache (loaded with the name colours).
    function shownFor(userId) {
        if (!userId) return [];
        if (userId === gami()?.userId) return gami()?.profile?.shown_badges || [];
        return window.cosmeticsSystem?.shownBadgesFor?.(userId) || [];
    }

    // ── Badge slots ─────────────────────────────────────────────
    function slots() { return Math.min(MAX_SLOTS, gami()?.profile?.badge_slots || 1); }

    async function setShown(ids) {
        const { data, error } = await supabase.rpc('set_shown_badges', { p_ids: ids });
        if (error) {
            gami()?.notify?.(/slots/.test(error.message) ? 'No free badge slot. Buy one in Shop > Features.' : 'Could not change badges', 0, 'gold');
            return false;
        }
        gami().profile.shown_badges = Array.isArray(data) ? data : ids;
        window.loadMainLeaderboard?.();
        return true;
    }

    function showBadge(id) {
        const cur = shownFor(gami()?.userId);
        if (cur.includes(id)) return Promise.resolve(true);
        if (cur.length >= slots()) {
            gami()?.notify?.('All your badge slots are full. Hide one first, or buy a slot in Shop > Features.', 0, 'gold');
            return Promise.resolve(false);
        }
        return setShown([...cur, id]);
    }

    function hideBadge(id) {
        return setShown(shownFor(gami()?.userId).filter(x => x !== id));
    }

    async function buySlot() {
        const prof = gami()?.profile;
        if (!prof) return { ok: false, msg: 'Not logged in' };
        if ((prof.badge_slots || 1) >= MAX_SLOTS) return { ok: false, msg: 'You have all 3 badge slots' };
        if ((prof.gold || 0) < SLOT_PRICE) return { ok: false, msg: `Need ${SLOT_PRICE}g (you have ${prof.gold || 0}g)` };
        const { data, error } = await supabase.rpc('buy_badge_slot');
        if (error) return { ok: false, msg: /enough gold/.test(error.message) ? 'Not enough gold' : 'Could not buy the slot' };
        prof.gold = typeof data === 'number' ? data : prof.gold - SLOT_PRICE;
        prof.badge_slots = (prof.badge_slots || 1) + 1;
        return { ok: true };
    }

    // ── Reward pop-ups ──────────────────────────────────────────
    let showing = false;
    async function checkNotices() {
        if (!signedIn() || showing) return;
        // The pot drop is on screen: its pop-up comes after (pot-plinko.js calls this when done).
        if (window.PotPlinko?.busy?.()) return;
        let rows = [];
        try {
            const { data, error } = await supabase.rpc('my_reward_notices');
            if (error) return;
            rows = data || [];
        } catch (e) { return; }
        if (!rows.length) return;
        await loadCatalog(true);
        showing = true;
        for (const n of rows) {
            await showNotice(n);
            try { await supabase.rpc('mark_reward_notice_seen', { p_id: n.id }); } catch (e) {}
        }
        showing = false;
        // Gold, items and badges changed on the server: reload the profile.
        try { await gami()?.getProfile?.(); } catch (e) {}
        window.loadMainLeaderboard?.();
    }

    function itemName(id) {
        const it = window.cosmeticsSystem?.getItems?.().find(i => i.id === id);
        return it ? it.name : id;
    }

    // Count a number up from 0 in an element ("12g" ... "90g").
    function countUp(el, to, ms) {
        if (!el) return;
        const t0 = performance.now();
        const step = (t) => {
            const f = Math.min(1, (t - t0) / ms);
            el.textContent = `${Math.round(to * (1 - Math.pow(1 - f, 3)))}g`;
            if (f < 1) requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
    }

    // kind: 'hermit' (Hermit reward), 'gift' (from a player), 'pot' (pot share).
    const KIND = {
        hermit: { from: 'A gift from The Hermit', icon: null, cls: '' },
        gift:   { from: 'A gift!', icon: 'px-generous.png', cls: 'rn-kind-gift' },
        pot:    { from: 'The pot paid out!', icon: 'px-jackpot.png', cls: 'rn-kind-pot' },
    };

    function showNotice(n) {
        return new Promise(resolve => {
            const k = KIND[n.kind] || KIND.hermit;
            const wrap = document.createElement('div');
            wrap.className = 'reward-notice-overlay';
            const parts = [];
            if (n.gold > 0) {
                const label = n.kind === 'pot' ? 'your share' : 'gold';
                parts.push(`<div class="rn-line rn-gold"><b class="rn-count">0g</b> ${label}</div>`);
            }
            if (n.badge_id) {
                const b = catalog.get(n.badge_id);
                parts.push(`<div class="rn-line rn-badge">${iconHtml(n.badge_id, 'rn-badge-img')}<div><b>${esc(b?.name || n.badge_id)}</b> badge<br><small>Show it next to your name: Profile > Badges.</small></div></div>`);
            }
            (n.items || []).forEach(id => {
                const it = window.cosmeticsSystem?.getItems?.().find(i => i.id === id);
                const prev = it ? (window.cosmeticsSystem?.previewHtml?.(it, 15) || '') : '';
                parts.push(`<div class="rn-line rn-item">${prev}<div><b>${esc(itemName(id))}</b><br><small>Equip it with the C button in a game.</small></div></div>`);
            });
            const anim = k.icon ? `<div class="rn-anim"><img class="rn-anim-icon" src="images/badges/${k.icon}" alt="">${n.kind === 'pot' ? '<div class="rn-coins"><i></i><i></i><i></i><i></i><i></i><i></i></div>' : '<div class="rn-sparks"><i></i><i></i><i></i><i></i></div>'}</div>` : '';
            wrap.innerHTML = `
                <div class="reward-notice ${k.cls}" role="dialog" aria-label="Reward">
                    ${anim}
                    <div class="rn-from">${esc(k.from)}</div>
                    <div class="rn-title">${esc(n.title || 'You got a reward!')}</div>
                    ${n.message ? `<div class="rn-message">${esc(n.message).replace(/\n/g, '<br>')}</div>` : ''}
                    ${n.kind === 'pot' ? '<div class="rn-splitting">Splitting the pot...</div>' : ''}
                    <div class="rn-rewards">${parts.join('')}</div>
                    <button class="rn-ok">Nice!</button>
                </div>`;
            document.body.appendChild(wrap);
            try { window.SoundSystem?.play?.('wincondition', 0.6); } catch (e) {}
            // The icon plays first (gift bounces open, chest shakes and bursts), then the gold counts up.
            const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
            const delay = k.icon && !reduce ? (n.kind === 'pot' ? 1300 : 800) : 0;
            setTimeout(() => {
                wrap.querySelector('.rn-splitting')?.classList.add('done');
                const c = wrap.querySelector('.rn-count');
                if (c) reduce ? (c.textContent = `${n.gold}g`) : countUp(c, n.gold, 900);
            }, delay);
            wrap.querySelector('.rn-ok').onclick = () => { wrap.remove(); resolve(); };
        });
    }

    // ── Gifts and the pot (sql/gifts-pot.sql) ───────────────────
    // Must match _gift_phrases() on the server (1-based index there).
    const GIFT_PHRASES = ['For you!', 'Good game!', 'Thanks!', 'Well played!', 'Have fun!', 'You earned it!', 'Welcome!'];
    const GIFT_COST = 100;

    async function getPot() {
        try { const { data } = await supabase.rpc('get_pot'); return data || null; } catch (e) { return null; }
    }

    async function sendGift(name, phraseIndex) {
        const prof = gami()?.profile;
        if (!prof) return { ok: false, msg: 'Not logged in' };
        if ((prof.gold || 0) < GIFT_COST) return { ok: false, msg: `A gift costs ${GIFT_COST}g (you have ${prof.gold || 0}g)` };
        const { data, error } = await supabase.rpc('send_gift', { p_to: String(name || '').trim(), p_phrase: phraseIndex + 1 });
        if (error) {
            const m = error.message || '';
            const msg = /no such player/.test(m) ? 'No player with that name.'
                : /yourself/.test(m) ? 'You cannot send a gift to yourself.'
                : /guests/.test(m) ? 'Guest accounts cannot get gifts.'
                : /already got a gift/.test(m) ? 'That player already got a gift today. Try again tomorrow.'
                : /enough gold/.test(m) ? 'Not enough gold.'
                : 'Could not send the gift.';
            return { ok: false, msg };
        }
        if (typeof data?.gold === 'number') prof.gold = data.gold;
        return { ok: true, to: data.to, received: data.received, toPot: data.to_pot };
    }

    // ── Sign-up events ──────────────────────────────────────────
    let claimedFor = null;
    async function claimSignup() {
        const uid = gami()?.userId;
        if (!uid || !gami()?.profile || claimedFor === uid) return;
        claimedFor = uid;
        try {
            const { data } = await supabase.rpc('claim_signup_events');
            if (Array.isArray(data) && data.length) await checkNotices();
        } catch (e) {}
    }

    // ── Bounty notice when a game starts ────────────────────────
    let bountyCheckedRoom = null;
    async function checkBountyForGame() {
        let room = null, inGame = false;
        try {
            room = typeof currentGameId !== 'undefined' ? currentGameId : null;
            inGame = !!(typeof isMultiplayer !== 'undefined' && isMultiplayer &&
                document.getElementById('game-layout')?.classList.contains('active')) && !window.Replay?.state;
        } catch (e) {}
        if (!inGame || !room) { bountyCheckedRoom = null; return; }
        if (bountyCheckedRoom === room) return;
        bountyCheckedRoom = room;
        try {
            const { data } = await supabase.rpc('list_bounties');
            const b = (data || []).find(x => x.room_id === room);
            if (!b) return;
            await loadCatalog();
            const what = [b.gold ? `${b.gold}g` : '', b.badge_id ? `the ${catalog.get(b.badge_id)?.name || 'special'} badge` : '',
                          b.has_items ? 'secret items' : ''].filter(Boolean).join(', ');
            const msg = `The Hermit put a reward on this game${b.title ? ` ("${b.title}")` : ''}${what ? `: ${what}` : ''}. Win it!`;
            try { updateStatus(msg); } catch (e) {}
            gami()?.notify?.((window.emojiSystem?.spriteHtml?.(76, 0.8) || '') + esc(msg), 0, 'gold');
        } catch (e) {}
    }

    // Public bounty list for the lobby room cards (refreshed with the list).
    let bountyRooms = new Map();
    async function refreshBounties() {
        try {
            const { data } = await supabase.rpc('list_bounties');
            bountyRooms = new Map((data || []).map(b => [b.room_id, b]));
        } catch (e) {}
        return bountyRooms;
    }

    // ── Timers ──────────────────────────────────────────────────
    let lastNoticeCheck = 0;
    setInterval(() => {
        if (!signedIn()) return;
        loadCatalog();
        claimSignup();
        checkBountyForGame();
        const now = Date.now();
        if (!document.hidden && now - lastNoticeCheck > 30000) {
            lastNoticeCheck = now;
            checkNotices();
        }
    }, 2000);

    // A win (and its bounty) is paid a few seconds after the game ends.
    function afterGameOver() {
        setTimeout(checkNotices, 4000);
        setTimeout(checkNotices, 12000);
    }

    window.Rewards = {
        loadCatalog, catalog: () => catalog, isSpecial, iconHtml, badgesHtml, shownFor,
        slots, SLOT_PRICE, MAX_SLOTS, showBadge, hideBadge, buySlot,
        checkNotices, afterGameOver, refreshBounties, bountyFor: (room) => bountyRooms.get(room) || null,
        GIFT_PHRASES, GIFT_COST, getPot, sendGift, showNotice,
    };
})();
