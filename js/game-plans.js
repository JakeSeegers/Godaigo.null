// game-plans.js: plan a game with friends, Doodle style (window.GamePlans).
//
// Server: sql/game-plans.sql. Lobby "Plans" button -> openList(). "Plan a game":
// pick up to 5 friends or recent players, propose up to 8 times (the browser's
// own time zone; saved as UTC, everyone sees their own local time). Everyone
// answers every time Yes / If need be / No and sees all answers; the best time
// gets a star (most Yes, then most If need be). The creator picks the final
// time. Then: "Add to Google Calendar" and a calendar file (.ics), a reminder
// pop-up 10 minutes before, the creator's "Open the room" (private room +
// open_game_plan_room + normal game invites) and a Join button for everyone.
// New plans pop up in the lobby ("Jake invites you to play"). Polled every
// 30 s while signed in. Step 2 (emails) and step 3 (busy times from a
// linked calendar) are planned in docs/game-plans.md.
(function () {
    'use strict';

    const POLL_MS = 30000;
    const MAX_PEOPLE = 5, MAX_TIMES = 8;
    const STAR = 6;                     // Star pixel emote
    const SEEN_KEY = 'godaigo_plans_seen';
    const REMIND_KEY = 'godaigo_plans_reminded';
    const ANSWERS = [
        { v: 2, label: 'Yes', cls: 'gp-yes' },
        { v: 1, label: 'If need be', cls: 'gp-maybe' },
        { v: 0, label: 'No', cls: 'gp-no' },
    ];

    const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const sb = () => { try { return supabase; } catch (e) { return null; } };
    const me = () => window.gami?.userId || null;
    const sprite = (i, s) => window.emojiSystem?.spriteHtml?.(i, s) || '';
    const nameStyle = (c) => (c && window.cosmeticsSystem?.getNameColorStyle?.(c)) || '';
    const whereAmI = () => window.Social?.whereAmI?.() || 'lobby';
    const readSet = (k) => { try { return new Set(JSON.parse(localStorage.getItem(k) || '[]')); } catch (e) { return new Set(); } };
    const writeSet = (k, s) => { try { localStorage.setItem(k, JSON.stringify([...s].slice(-200))); } catch (e) {} };

    let plans = [];
    let started = false;

    // ------------------------------------------------------------ time helpers
    const fmt = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    const tzName = (() => {
        try { return new Intl.DateTimeFormat(undefined, { timeZoneName: 'short' }).formatToParts(new Date()).find(p => p.type === 'timeZoneName')?.value || ''; }
        catch (e) { return ''; }
    })();
    const when = (iso) => fmt.format(new Date(iso));
    const finalAt = (p) => (p.slots || []).find(s => s.slot === p.final_slot)?.at || null;

    // ------------------------------------------------------------ data
    async function load() {
        if (!me() || !sb()) return plans;
        try {
            const { data, error } = await sb().rpc('my_game_plans');
            if (!error) plans = Array.isArray(data) ? data : [];
        } catch (e) {}
        updateButton();
        return plans;
    }
    const myVotes = (p) => {
        const m = {};
        for (const v of p.votes || []) if (v.user_id === me()) m[v.slot] = v.answer;
        return m;
    };
    const needsMe = (p) => p.status === 'open' && !(p.members || []).find(m => m.user_id === me())?.answered;
    function bestSlot(p) {
        let best = null, bestKey = -1;
        for (const s of p.slots || []) {
            const vs = (p.votes || []).filter(v => v.slot === s.slot);
            const yes = vs.filter(v => v.answer === 2).length, maybe = vs.filter(v => v.answer === 1).length;
            const key = yes * 100 + maybe;
            if (yes + maybe > 0 && key > bestKey) { bestKey = key; best = s.slot; }
        }
        return best;
    }

    function updateButton() {
        const b = document.getElementById('plans-btn');
        if (!b) return;
        const n = plans.filter(needsMe).length;
        b.textContent = n ? `Plans (${n})` : 'Plans';
        b.classList.toggle('has-requests', n > 0);
    }

    // ------------------------------------------------------------ modal helpers
    function overlay(id) {
        document.getElementById(id)?.remove();
        const o = document.createElement('div');
        o.id = id;
        o.className = 'social-overlay';
        o.addEventListener('click', (e) => { if (e.target === o) o.remove(); });
        document.body.appendChild(o);
        return o;
    }

    // ------------------------------------------------------------ list
    async function openList() {
        if (!me()) { window.gami?.notify?.('Log in to plan games.', 0, 'gold'); return; }
        const o = overlay('gp-list');
        o.innerHTML = `<div class="social-modal gp-modal" role="dialog" aria-label="Game plans">
            <div class="social-title">Game Plans</div>
            <div class="gp-intro">Pick some times, invite up to ${MAX_PEOPLE} friends, and everyone says when they can play.</div>
            <div class="gp-rows"><div class="social-empty">Loading...</div></div>
            <div class="acct-actions"><button class="acct-btn" data-new>Plan a game</button><button class="acct-btn acct-btn-secondary" data-close>Close</button></div>
        </div>`;
        o.querySelector('[data-close]').onclick = () => o.remove();
        o.querySelector('[data-new]').onclick = () => { o.remove(); openCreate(); };
        await load();
        const rows = o.querySelector('.gp-rows');
        if (!rows) return;
        if (!plans.length) { rows.innerHTML = '<div class="social-empty">No plans yet.</div>'; return; }
        rows.innerHTML = plans.map(p => {
            const fa = finalAt(p);
            const sub = p.status === 'set' ? `Set: ${esc(when(fa))}` : needsMe(p) ? '<b>Pick your times</b>' : `${(p.members || []).filter(m => m.answered).length} of ${(p.members || []).length} answered`;
            return `<div class="social-row gp-row" data-id="${p.id}"><span class="social-name">${esc(p.title)}</span>
                <span class="social-sub">by ${esc(p.creator_name || '?')} · ${sub}</span>
                <span class="social-actions"><button class="acct-btn" data-open="${p.id}">Open</button></span></div>`;
        }).join('');
        rows.addEventListener('click', (e) => {
            const b = e.target.closest('[data-open]');
            if (!b) return;
            o.remove();
            openPlan(Number(b.dataset.open));
        });
    }

    // ------------------------------------------------------------ create
    // opts.with: user ids to tick at the start (Friends list "Plan" button /
    // player card "Plan a game", js/social.js, owner 2026-10-09).
    async function openCreate(opts) {
        const preset = new Set((opts && opts.with) || []);
        const o = overlay('gp-create');
        o.innerHTML = `<div class="social-modal gp-modal" role="dialog" aria-label="Plan a game">
            <div class="social-title">Plan a game</div>
            <label class="gp-label">Name (optional)<input type="text" class="acct-input" id="gp-title" maxlength="60" placeholder="Godaigo night"></label>
            <div class="social-head">Who? (up to ${MAX_PEOPLE})</div>
            <div class="gp-people"><div class="social-empty">Loading friends...</div></div>
            <div class="social-head">When? (your time${tzName ? `, ${esc(tzName)}` : ''}, up to ${MAX_TIMES})</div>
            <div class="gp-times"></div>
            <button class="acct-btn acct-btn-secondary" data-addtime>Add a time</button>
            <div class="social-msg" id="gp-msg"></div>
            <div class="acct-actions"><button class="acct-btn" data-send>Send invites</button><button class="acct-btn acct-btn-secondary" data-close>Cancel</button></div>
        </div>`;
        o.querySelector('[data-close]').onclick = () => o.remove();
        const times = o.querySelector('.gp-times');
        const addTime = (d) => {
            if (times.children.length >= MAX_TIMES) return;
            const row = document.createElement('div');
            row.className = 'gp-time-row';
            const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
            row.innerHTML = `<input type="datetime-local" class="acct-input gp-time" value="${local}"><button class="acct-btn acct-btn-secondary" title="Remove">&times;</button>`;
            row.querySelector('button').onclick = () => row.remove();
            times.appendChild(row);
        };
        // Start with tomorrow 7 pm and the day after, same time.
        const t = new Date(); t.setDate(t.getDate() + 1); t.setHours(19, 0, 0, 0);
        addTime(t); addTime(new Date(t.getTime() + 86400000));
        o.querySelector('[data-addtime]').onclick = () => {
            const last = [...times.querySelectorAll('.gp-time')].pop();
            const base = last?.value ? new Date(last.value) : t;
            addTime(new Date(base.getTime() + 86400000));
        };

        // People: friends first, then recent players.
        let people = [];
        try {
            const [f, r] = await Promise.all([sb().rpc('my_friends'), sb().rpc('my_recent_players')]);
            const seen = new Set();
            for (const x of (f.data || []).filter(x => x.state === 'friend')) { seen.add(x.user_id); people.push({ id: x.user_id, name: x.name, color: x.name_color, tag: 'friend' }); }
            for (const x of r.data || []) if (!seen.has(x.user_id)) { seen.add(x.user_id); people.push({ id: x.user_id, name: x.name, color: x.name_color, tag: 'played with you' }); }
        } catch (e) {}
        people = people.filter(p => !/^Guest[A-Z0-9]{6}$/.test(p.name || ''));
        const box = o.querySelector('.gp-people');
        box.innerHTML = people.length ? people.map(p => `<label class="gp-person"><input type="checkbox" value="${esc(p.id)}"${preset.has(p.id) ? ' checked' : ''}>
                <span class="social-name" style="${nameStyle(p.color)}">${esc(p.name)}</span><span class="social-sub">${esc(p.tag)}</span></label>`).join('')
            : '<div class="social-empty">No friends or recent players yet. Add friends in the Friends panel first.</div>';
        box.addEventListener('change', () => {
            const on = box.querySelectorAll('input:checked').length;
            box.querySelectorAll('input:not(:checked)').forEach(i => { i.disabled = on >= MAX_PEOPLE; });
        });

        o.querySelector('[data-send]').onclick = async (ev) => {
            const msg = o.querySelector('#gp-msg');
            const users = [...box.querySelectorAll('input:checked')].map(i => i.value);
            const slots = [...times.querySelectorAll('.gp-time')].map(i => i.value).filter(Boolean)
                .map(v => new Date(v)).filter(d => !isNaN(d) && d > new Date()).map(d => d.toISOString());
            if (!users.length) { msg.textContent = 'Pick at least one person.'; return; }
            if (!slots.length) { msg.textContent = 'Add at least one time in the future.'; return; }
            ev.target.disabled = true;
            const { data, error } = await sb().rpc('create_game_plan', { p_title: o.querySelector('#gp-title').value, p_users: users, p_slots: slots });
            ev.target.disabled = false;
            if (error) {
                const m = error.message || '';
                msg.textContent = /5 plans a day/.test(m) ? 'You can make 5 plans a day.' : /guests/.test(m) ? 'Guests cannot plan games.'
                    : /friends or recent/.test(m) ? 'You can only invite friends or people you played with.' : 'Could not send: ' + m;
                return;
            }
            o.remove();
            window.gami?.notify?.('Invites sent! Now mark your own times.', 0, 'gold');
            await load();
            openPlan(data);
        };
    }

    // ------------------------------------------------------------ one plan (the Doodle table)
    async function openPlan(id) {
        const p = plans.find(x => x.id === id) || (await load(), plans.find(x => x.id === id));
        if (!p) { window.gami?.notify?.('That plan is gone.', 0, 'gold'); return; }
        const o = overlay('gp-plan');
        const mine = myVotes(p);
        const edit = { ...mine };
        const best = bestSlot(p);
        const slots = p.slots || [];
        const members = p.members || [];
        const ans = (uid, slot) => (p.votes || []).find(v => v.user_id === uid && v.slot === slot)?.answer;
        const cellFor = (a) => a == null ? '<span class="gp-cell gp-none">-</span>' : `<span class="gp-cell ${ANSWERS.find(x => x.v === a).cls}">${ANSWERS.find(x => x.v === a).label}</span>`;
        const counts = (slot) => {
            const vs = (p.votes || []).filter(v => v.slot === slot);
            return { yes: vs.filter(v => v.answer === 2).length, maybe: vs.filter(v => v.answer === 1).length };
        };
        const fa = finalAt(p);
        const head = slots.map(s => {
            const c = counts(s.slot);
            const isFinal = p.status === 'set' && s.slot === p.final_slot;
            return `<th class="${isFinal ? 'gp-final' : ''}">${s.slot === best ? sprite(STAR, 0.5) : ''}<div>${esc(when(s.at))}</div>
                <div class="gp-count">${c.yes} yes${c.maybe ? `, ${c.maybe} maybe` : ''}</div>
                ${p.mine && p.status !== 'cancelled' && new Date(s.at) > new Date(Date.now() - 3600000) ? `<button class="acct-btn gp-pick" data-pick="${s.slot}">${isFinal ? 'Picked' : 'Pick'}</button>` : ''}</th>`;
        }).join('');
        const rows = members.map(m => {
            const isMe = m.user_id === me();
            const cells = slots.map(s => isMe
                ? `<td><button class="gp-cell gp-edit ${edit[s.slot] != null ? ANSWERS.find(x => x.v === edit[s.slot]).cls : 'gp-none'}" data-slot="${s.slot}">${edit[s.slot] != null ? ANSWERS.find(x => x.v === edit[s.slot]).label : 'Tap'}</button></td>`
                : `<td>${cellFor(ans(m.user_id, s.slot))}</td>`).join('');
            return `<tr class="${isMe ? 'gp-me' : ''}"><th><span style="${nameStyle(m.name_color)}">${esc(m.name || '?')}</span>${m.user_id === p.creator ? ' <span class="social-sub">(host)</span>' : ''}</th>${cells}</tr>`;
        }).join('');
        let footer = '';
        if (p.status === 'set' && fa) {
            const soon = new Date(fa) - Date.now() < 30 * 60000;
            footer = `<div class="gp-set">${sprite(STAR, 0.6)} <b>It's set: ${esc(when(fa))}</b></div>
                <div class="gp-cal"><a class="acct-btn acct-btn-secondary" target="_blank" rel="noopener" href="${esc(googleLink(p, fa))}">Add to Google Calendar</a>
                <button class="acct-btn acct-btn-secondary" data-ics>Calendar file (.ics)</button></div>
                ${p.mine && soon ? '<button class="acct-btn" data-room>Open the room</button>' : ''}
                ${!p.mine && p.room_id ? '<button class="acct-btn" data-join>Join the game</button>' : ''}
                ${p.mine && !soon ? '<div class="social-note">An "Open the room" button shows here 30 minutes before.</div>' : ''}
                ${!p.mine && !p.room_id ? `<div class="social-note">A Join button shows when ${esc(p.creator_name || 'the host')} opens the room.</div>` : ''}`;
        } else if (p.mine) {
            footer = '<div class="social-note">When enough people have answered, press Pick under the best time (the star).</div>';
        }
        o.innerHTML = `<div class="social-modal gp-modal gp-wide" role="dialog" aria-label="${esc(p.title)}">
            <div class="social-title">${esc(p.title)}</div>
            <div class="gp-intro">Invited by ${esc(p.creator_name || '?')}. Times are in your time${tzName ? ` (${esc(tzName)})` : ''}. Tap your row to answer: Yes, If need be, No.</div>
            <div class="gp-table-wrap"><table class="gp-table"><thead><tr><th></th>${head}</tr></thead><tbody>${rows}</tbody></table></div>
            ${footer}
            <div class="social-msg" id="gp-msg"></div>
            <div class="acct-actions">
                <button class="acct-btn" data-save>Save my answers</button>
                ${p.mine ? '<button class="acct-btn acct-btn-secondary" data-cancel>Cancel plan</button>' : ''}
                <button class="acct-btn acct-btn-secondary" data-close>Close</button></div>
        </div>`;
        const msg = (t) => { const el = o.querySelector('#gp-msg'); if (el) el.textContent = t; };
        o.querySelector('[data-close]').onclick = () => o.remove();
        o.querySelectorAll('.gp-edit').forEach(b => b.onclick = () => {
            const s = Number(b.dataset.slot);
            const order = [2, 1, 0];
            const next = edit[s] == null ? 2 : order[(order.indexOf(edit[s]) + 1) % 3];
            edit[s] = next;
            const a = ANSWERS.find(x => x.v === next);
            b.className = `gp-cell gp-edit ${a.cls}`;
            b.textContent = a.label;
        });
        o.querySelector('[data-save]').onclick = async () => {
            const answers = {};
            for (const s of slots) answers[s.slot] = edit[s.slot] ?? 0;   // untouched = No
            const { error } = await sb().rpc('vote_game_plan', { p_plan: p.id, p_answers: answers });
            if (error) { msg('Could not save: ' + error.message); return; }
            await load();
            openPlan(p.id);
            window.gami?.notify?.('Answers saved.', 0, 'gold');
        };
        o.querySelectorAll('[data-pick]').forEach(b => b.onclick = async () => {
            const s = Number(b.dataset.pick);
            const again = p.status === 'set' && p.final_slot === s;
            const { error } = await sb().rpc('set_game_plan_time', { p_plan: p.id, p_slot: again ? null : s });
            if (error) { msg('Could not pick: ' + error.message); return; }
            await load();
            openPlan(p.id);
        });
        o.querySelector('[data-cancel]')?.addEventListener('click', async () => {
            if (!confirm('Cancel this plan for everyone?')) return;
            await sb().rpc('cancel_game_plan', { p_plan: p.id });
            o.remove();
            await load();
        });
        o.querySelector('[data-ics]')?.addEventListener('click', () => downloadIcs(p, fa));
        o.querySelector('[data-room]')?.addEventListener('click', () => { o.remove(); openRoom(p); });
        o.querySelector('[data-join]')?.addEventListener('click', () => { o.remove(); join(p); });
    }

    // ------------------------------------------------------------ calendar
    const icsTime = (iso) => new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    function details(p) {
        const who = (p.members || []).map(m => m.name).filter(Boolean).join(', ');
        return `Godaigo game with ${who}. Play at https://playgodaigo.com/`;
    }
    function googleLink(p, at) {
        const end = new Date(new Date(at).getTime() + 3600000).toISOString();
        const q = new URLSearchParams({ action: 'TEMPLATE', text: p.title, dates: `${icsTime(at)}/${icsTime(end)}`,
            details: details(p), location: 'https://playgodaigo.com/' });
        return 'https://calendar.google.com/calendar/render?' + q.toString();
    }
    function downloadIcs(p, at) {
        const end = new Date(new Date(at).getTime() + 3600000).toISOString();
        const clean = (t) => String(t).replace(/[\\;,]/g, m => '\\' + m).replace(/\n/g, '\\n');
        const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Godaigo//Game Plans//EN', 'BEGIN:VEVENT',
            `UID:godaigo-plan-${p.id}@playgodaigo.com`, `DTSTAMP:${icsTime(new Date().toISOString())}`,
            `DTSTART:${icsTime(at)}`, `DTEND:${icsTime(end)}`, `SUMMARY:${clean(p.title)}`,
            `DESCRIPTION:${clean(details(p))}`, 'URL:https://playgodaigo.com/', 'LOCATION:https://playgodaigo.com/',
            'BEGIN:VALARM', 'TRIGGER:-PT10M', 'ACTION:DISPLAY', 'DESCRIPTION:Godaigo starts in 10 minutes', 'END:VALARM',
            'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([ics], { type: 'text/calendar' }));
        a.download = 'godaigo-game.ics';
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    }

    // ------------------------------------------------------------ open room / join
    async function openRoom(p) {
        if (whereAmI() !== 'lobby') { alert('Leave your current room or game first.'); return; }
        try {
            if (typeof window.createPrivateRoom === 'function') await window.createPrivateRoom();
            else if (typeof createRoom === 'function') await createRoom(true);
        } catch (e) { alert('Could not open a room: ' + (e?.message || e)); return; }
        let room = null;
        try { room = currentGameId; } catch (e) {}
        if (!room) return;
        const { error } = await sb().rpc('open_game_plan_room', { p_plan: p.id, p_room: room });
        if (error) { window.gami?.notify?.('Room opened, but the plan could not be linked: ' + error.message, 0, 'gold'); return; }
        // Also the normal invite pop-up for everyone who said Yes or If need be.
        const coming = new Set((p.votes || []).filter(v => v.slot === p.final_slot && v.answer > 0).map(v => v.user_id));
        for (const m of p.members || []) {
            if (m.user_id === me() || !coming.has(m.user_id)) continue;
            try { await sb().rpc('send_game_invite', { p_user: m.user_id }); } catch (e) {}
        }
        window.gami?.notify?.('Room open! Everyone in the plan can join from their Plans.', 0, 'gold');
    }
    async function join(p) {
        if (whereAmI() !== 'lobby') { alert('Leave your current room or game first.'); return; }
        if (!p.room_id) return;
        if (typeof window.joinPublicGame === 'function') await window.joinPublicGame(p.room_id);
    }

    // ------------------------------------------------------------ pop-ups
    function popup(html, buttons) {
        if (document.getElementById('social-invite') || document.getElementById('gp-pop')) return false;
        const el = document.createElement('div');
        el.id = 'gp-pop';
        el.className = 'gp-pop';
        el.innerHTML = `<div class="social-invite-text">${html}</div><div class="social-invite-actions">${buttons.map((b, i) =>
            `<button class="acct-btn ${i ? 'acct-btn-secondary' : ''}" data-i="${i}">${esc(b.label)}</button>`).join('')}</div>`;
        document.body.appendChild(el);
        try { window.SoundSystem?.play?.('activatescroll', 0.6); } catch (e) {}
        el.querySelectorAll('button').forEach(b => b.onclick = () => { el.remove(); buttons[Number(b.dataset.i)].act?.(); });
        setTimeout(() => el.remove(), 60000);
        return true;
    }
    function checkPopups() {
        if (whereAmI() !== 'lobby') return;
        const seen = readSet(SEEN_KEY), reminded = readSet(REMIND_KEY);
        // New invitation
        const fresh = plans.find(p => !p.mine && needsMe(p) && !seen.has(p.id));
        if (fresh) {
            if (popup(`${sprite(STAR, 0.6)} <b>${esc(fresh.creator_name || 'A friend')}</b> invites you to play! Pick the times you are free.`,
                [{ label: 'Pick times', act: () => openPlan(fresh.id) }, { label: 'Later' }])) { seen.add(fresh.id); writeSet(SEEN_KEY, seen); }
            return;
        }
        // Reminder 10 minutes before (and the room is open: Join)
        for (const p of plans) {
            if (p.status !== 'set') continue;
            const at = finalAt(p);
            if (!at) continue;
            const left = new Date(at) - Date.now();
            const key = `${p.id}@${at}${p.room_id ? '#' + p.room_id : ''}`;
            if (left > 10 * 60000 || left < -60 * 60000 || reminded.has(key)) continue;
            const btns = p.mine && !p.room_id ? [{ label: 'Open the room', act: () => openRoom(p) }, { label: 'Later' }]
                : !p.mine && p.room_id ? [{ label: 'Join', act: () => join(p) }, { label: 'Later' }]
                : [{ label: 'Open plan', act: () => openPlan(p.id) }, { label: 'OK' }];
            const text = p.room_id && !p.mine ? `<b>${esc(p.creator_name)}</b> opened the room for "${esc(p.title)}". Join now!`
                : `"${esc(p.title)}" starts ${left > 0 ? `in ${Math.max(1, Math.round(left / 60000))} minutes` : 'now'}.`;
            if (popup(text, btns)) { reminded.add(key); writeSet(REMIND_KEY, reminded); }
            return;
        }
    }

    // ------------------------------------------------------------ start
    function start() {
        if (started || !me() || !window.gami?.profile) return;
        started = true;
        const tick = async () => { await load(); checkPopups(); };
        tick();
        setInterval(tick, POLL_MS);
        setInterval(checkPopups, 5000);
    }
    const waitStart = setInterval(() => { start(); if (started) clearInterval(waitStart); }, 1000);

    window.GamePlans = { openList, openCreate, openPlan, load, plans: () => plans, _googleLink: googleLink };
})();
