// hermit-rewards.js: Hermit-only "Rewards" panel (Hermit menu > Rewards, and
// the Gift emote button on lobby room cards). Server: sql/hermit-rewards.sql.
//
// One reward form (title, message, gold, badge, items) is used for:
//   * Sign-up event: "the first N people to make a real (non-guest)
//     account from now on get this reward" (hermit_start_signup_event).
//     Players claim it at sign-in (js/rewards.js claim_signup_events).
//   * Game reward (bounty): put it on a room; whoever wins that game gets it
//     (hermit_set_bounty; paid by the server with the win).
// Badges come from images/badges/badges.json; choosing one creates or
// updates that special badge on the server first (hermit_upsert_badge).
(function () {
    'use strict';

    const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const isHermit = () => typeof window.isHermit === 'function' && window.isHermit();
    const toast = (m) => window.gami?.notify?.(m, 0, 'gold');
    const gift = (s) => window.emojiSystem?.spriteHtml?.(76, s) || '';   // Pipoya Gift emote

    let manifest = null;
    async function loadManifest() {
        if (manifest) return manifest;
        try {
            const res = await fetch('images/badges/badges.json', { cache: 'no-cache' });
            manifest = (await res.json()).badges || [];
        } catch (e) { manifest = []; }
        return manifest;
    }

    function allItems() {
        const items = window.cosmeticsSystem?.getItems?.() || [];
        // Hidden (reward-only) items first.
        return items.slice().sort((a, b) => (b.hidden ? 1 : 0) - (a.hidden ? 1 : 0));
    }

    let panel = null;
    let roomTarget = null; // { id, label } when opened from a room card

    function close() { panel?.remove(); panel = null; }

    async function open(room) {
        if (!isHermit()) return;
        roomTarget = room || null;
        close();
        const badges = await loadManifest();
        panel = document.createElement('div');
        panel.id = 'hermit-rewards-panel';
        const itemBoxes = allItems().map(it => `
            <label class="hr-item" title="${esc(it.id)}">
                <input type="checkbox" value="${esc(it.id)}"> ${esc(it.name)}${it.hidden ? ' <span class="hr-secret">secret</span>' : ''}
            </label>`).join('');
        panel.innerHTML = `
            <div class="hr-head">
                <b>Rewards</b>
                <button class="hr-x" title="Close">✕</button>
            </div>
            <div class="hr-body">
                <div class="hr-section">
                    <div class="hr-label">The reward</div>
                    <input class="hr-title" placeholder="Title, e.g. The Great Plunge" maxlength="80">
                    <textarea class="hr-message" rows="3" placeholder="Message the winner sees" maxlength="500"></textarea>
                    <div class="hr-row"><span>Gold</span><input class="hr-gold" type="number" min="0" max="100000" value="300"></div>
                    <div class="hr-row"><span>Badge</span><select class="hr-badge">
                        <option value="">(none)</option>
                        ${badges.map(b => `<option value="${esc(b.id)}">${esc(b.name)}</option>`).join('')}
                    </select><img class="hr-badge-prev" alt=""></div>
                    <details class="hr-items"><summary>Items (<span class="hr-item-count">0</span> chosen)</summary>${itemBoxes}</details>
                </div>

                <div class="hr-section hr-room" style="${roomTarget ? '' : 'display:none'}">
                    <div class="hr-label">Put it on this game</div>
                    <div class="hr-room-name"></div>
                    <button class="hr-bounty-btn">Put reward on this game</button>
                </div>

                <div class="hr-section">
                    <div class="hr-label">Sign-up event</div>
                    <div class="hr-hint">The first people to make a real (not guest) account from now on get the reward.</div>
                    <div class="hr-row"><span>Winners</span><input class="hr-max" type="number" min="1" max="1000" value="1"></div>
                    <button class="hr-event-btn">Start sign-up event</button>
                    <div class="hr-events"></div>
                </div>

                <div class="hr-section">
                    <div class="hr-label">The pot: <span class="hr-pot-amt">...</span></div>
                    <div class="hr-hint">Add gold to the pot (new gold, not taken from you). It pays out at the end of a human game (see Shop > Features).</div>
                    <div class="hr-row"><span>Gold</span><input class="hr-pot-add" type="number" min="1" max="100000" value="200"></div>
                    <button class="hr-pot-btn">Add to pot</button>
                </div>

                <div class="hr-section">
                    <div class="hr-label">Games now <button class="hr-refresh" title="Refresh">↻</button></div>
                    <div class="hr-rooms">Loading...</div>
                </div>
            </div>`;
        document.body.appendChild(panel);

        const q = (sel) => panel.querySelector(sel);
        q('.hr-x').onclick = close;
        q('.hr-badge').onchange = () => {
            const b = badges.find(x => x.id === q('.hr-badge').value);
            const img = q('.hr-badge-prev');
            if (b) { img.src = `images/badges/${b.file}`; img.style.display = ''; } else img.style.display = 'none';
        };
        q('.hr-badge').onchange();
        panel.querySelectorAll('.hr-item input').forEach(cb => cb.onchange = () => {
            q('.hr-item-count').textContent = panel.querySelectorAll('.hr-item input:checked').length;
        });
        q('.hr-event-btn').onclick = startEvent;
        q('.hr-bounty-btn').onclick = () => roomTarget && setBounty(roomTarget.id);
        q('.hr-refresh').onclick = () => { renderRooms(); renderEvents(); renderPot(); };
        q('.hr-pot-btn').onclick = addToPot;
        if (roomTarget) q('.hr-room-name').textContent = roomTarget.label || `Room ${roomTarget.id}`;
        renderEvents();
        renderRooms();
        renderPot();
    }

    async function renderPot() {
        const el = panel?.querySelector('.hr-pot-amt');
        const pot = await window.Rewards?.getPot?.();
        if (el && pot) el.textContent = `${pot.amount}g${pot.paid_today ? ' (paid out today)' : ''}, ${pot.coins} coins, about ${Math.round((pot.chance || 0) * 100)}% per game (a coin per 10g, max 70)`;
    }

    async function addToPot() {
        const amt = Math.max(1, Math.min(100000, parseInt(panel.querySelector('.hr-pot-add').value, 10) || 0));
        if (!window.confirm(`Add ${amt}g to the pot?`)) return;
        const { error } = await supabase.rpc('hermit_add_to_pot', { p_amount: amt });
        if (error) { toast('Could not add: ' + error.message); return; }
        toast(`Added ${amt}g to the pot.`);
        renderPot();
    }

    // Read the form. Creates / updates the chosen special badge on the server.
    async function readReward() {
        const q = (sel) => panel.querySelector(sel);
        const r = {
            title: q('.hr-title').value.trim(),
            message: q('.hr-message').value.trim(),
            gold: Math.max(0, Math.min(100000, parseInt(q('.hr-gold').value, 10) || 0)),
            badge: q('.hr-badge').value || null,
            items: [...panel.querySelectorAll('.hr-item input:checked')].map(cb => cb.value),
        };
        if (!r.gold && !r.badge && !r.items.length) { toast('Pick gold, a badge or an item first.'); return null; }
        if (r.badge) {
            const b = (await loadManifest()).find(x => x.id === r.badge);
            const { error } = await supabase.rpc('hermit_upsert_badge', {
                p_id: b.id, p_name: b.name, p_description: b.description || '', p_image: b.file,
            });
            if (error) { toast('Badge problem: ' + error.message); return null; }
            window.Rewards?.loadCatalog?.(true);
        }
        return r;
    }

    async function startEvent() {
        const r = await readReward();
        if (!r) return;
        const max = Math.max(1, parseInt(panel.querySelector('.hr-max').value, 10) || 1);
        if (!window.confirm(`Start a sign-up event? The first ${max} new real account(s) get: ${describe(r)}.`)) return;
        const { error } = await supabase.rpc('hermit_start_signup_event', {
            p_title: r.title, p_message: r.message, p_gold: r.gold, p_items: r.items, p_badge: r.badge, p_max: max,
        });
        if (error) { toast('Could not start: ' + error.message); return; }
        toast('Sign-up event started!');
        renderEvents();
    }

    async function setBounty(roomId) {
        const r = await readReward();
        if (!r) return;
        const { error } = await supabase.rpc('hermit_set_bounty', {
            p_room: roomId, p_title: r.title, p_message: r.message, p_gold: r.gold, p_items: r.items, p_badge: r.badge,
        });
        if (error) { toast('Could not set the reward: ' + error.message); return; }
        toast(`Reward put on game ${roomId}.`);
        renderRooms();
        window.Rewards?.refreshBounties?.();
    }

    async function clearBounty(roomId) {
        const { error } = await supabase.rpc('hermit_clear_bounty', { p_room: roomId });
        if (error) { toast('Could not remove: ' + error.message); return; }
        renderRooms();
        window.Rewards?.refreshBounties?.();
    }

    function describe(r) {
        const names = r.items.map(id => allItems().find(i => i.id === id)?.name || id);
        return [r.gold ? `${r.gold}g` : '', r.badge ? `badge "${r.badge}"` : '', ...names].filter(Boolean).join(', ') || 'nothing';
    }

    async function renderEvents() {
        const box = panel?.querySelector('.hr-events');
        if (!box) return;
        const { data, error } = await supabase.rpc('hermit_list_events');
        if (error) { box.textContent = 'Could not load events.'; return; }
        box.innerHTML = (data || []).slice(0, 6).map(e => `
            <div class="hr-event ${e.active ? 'on' : ''}">
                <div><b>${esc(e.title || 'Event ' + e.id)}</b> ${e.active ? '<span class="hr-live">LIVE</span>' : '<span class="hr-done">ended</span>'}
                    ${e.gold ? `${e.gold}g` : ''} ${e.badge_id ? `badge ${esc(e.badge_id)}` : ''} ${e.items?.length ? `+${e.items.length} item(s)` : ''}</div>
                <div class="hr-winners">Winners (${e.winners.length}/${e.max_winners}): ${e.winners.length ? e.winners.map(esc).join(', ') : 'none yet'}</div>
                ${e.active ? `<button data-stop="${e.id}">Stop</button>` : ''}
            </div>`).join('') || '<div class="hr-hint">No events yet.</div>';
        box.querySelectorAll('[data-stop]').forEach(b => b.onclick = async () => {
            await supabase.rpc('hermit_stop_event', { p_id: Number(b.dataset.stop) });
            renderEvents();
        });
    }

    async function renderRooms() {
        const box = panel?.querySelector('.hr-rooms');
        if (!box) return;
        const { data, error } = await supabase.rpc('hermit_list_rooms');
        if (error) { box.textContent = 'Could not load games.'; return; }
        box.innerHTML = (data || []).map(r => `
            <div class="hr-roomrow">
                <div><b>#${r.id}</b> ${esc(r.host_name || '')} <span class="hr-status">${esc(r.status)}${r.is_private ? ', private' : ''}</span></div>
                <div class="hr-players">${(r.players || []).map(esc).join(', ')}</div>
                ${r.bounty_winner ? `<div class="hr-paid">Reward won by ${esc(r.bounty_winner)}</div>`
                  : r.bounty_title !== null ? `<div class="hr-bounty">${gift(0.6)}${esc(r.bounty_title || 'Reward')} ${r.bounty_gold ? r.bounty_gold + 'g' : ''} ${esc(r.bounty_badge || '')}</div>` : ''}
                <button data-set="${r.id}">${gift(0.6)}Put reward</button>
                ${r.bounty_title !== null && !r.bounty_winner ? `<button data-clear="${r.id}">Remove</button>` : ''}
            </div>`).join('') || '<div class="hr-hint">No games right now.</div>';
        box.querySelectorAll('[data-set]').forEach(b => b.onclick = () => setBounty(Number(b.dataset.set)));
        box.querySelectorAll('[data-clear]').forEach(b => b.onclick = () => clearBounty(Number(b.dataset.clear)));
    }

    window.HermitRewards = { open, openForRoom: (id, label) => open({ id, label }), close };
})();
