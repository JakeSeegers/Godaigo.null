// Scroll move animation (owner 2026-10-15): when a scroll changes area, a chip
// with its name in its colors floats from where it was to where it went:
// hand -> active, hand -> common, active -> common (and back again, e.g. an
// undo or a scroll taken from the common area). Works the same for every
// player: your own scrolls fly between the Hand / Active / Common panels,
// other players' between their rows in the Opponent Status panel and the
// Common panel.
//
// No game hooks: every 50 ms it reads where each scroll is
// (spellSystem.playerScrolls[i].hand / .active and the common area) and
// compares with the last read. So it covers buttons, keys, bots, other
// players' messages and replays alike. A scroll that appears from nowhere
// (drawn) or disappears (cast and gone) is not a move and does not fly.
//
// Privacy: the chip shows the scroll's name when it comes from or goes to a
// public area (active, common) or the hand on this screen; another player's
// hand-to-hand move would show a face-down chip (element color only).
//
// Looks only, never touches game state. Skipped when window.fxOn() is false
// (muted training, quiet test games), hidden tabs, reduced motion and while a
// saved game is being rebuilt.
(function () {
    'use strict';
    const TICK = 50, MAX_FLIGHTS = 5, MAX_MOVES = 4;
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
    let prev = null;            // name -> 'seat:area' or 'common'
    let flights = 0;
    const rectCache = new Map(); // anchor key -> DOMRect (last seen place of a scroll / an area)

    function gameOn() {
        const sp = window.spellSystem;
        return !!(sp && sp.playerScrolls && document.getElementById('game-layout')?.classList.contains('active'));
    }
    function fxOk() {
        if (document.hidden || reduceMotion) return false;
        if (typeof window.fxOn === 'function' && !window.fxOn()) return false;
        if (window.SaveGame?.isRebuilding?.()) return false;
        return true;
    }

    // Which seat the main Hand / Active panels show (game-core.js getPlayerScrolls(true)).
    function panelSeat() {
        let real = (typeof myPlayerIndex !== 'undefined') ? myPlayerIndex : null;
        const dri = window.BotDriver?.driverRealIndex?.();
        if (dri != null) real = dri;
        const mp = typeof isMultiplayer !== 'undefined' && isMultiplayer;
        return (mp && real != null && real >= 0) ? real : (typeof activePlayerIndex !== 'undefined' ? activePlayerIndex : 0);
    }

    function readPlaces() {
        const sp = window.spellSystem, out = new Map();
        (sp.playerScrolls || []).forEach((ps, i) => {
            if (!ps) return;
            ps.hand?.forEach(n => out.set(n, i + ':hand'));
            ps.active?.forEach(n => out.set(n, i + ':active'));
        });
        try { (sp.getCommonAreaScrolls?.() || []).forEach(n => out.set(n, 'common')); } catch (e) {}
        return out;
    }
    const parse = loc => loc === 'common' ? { area: 'common' } : { seat: +loc.split(':')[0], area: loc.split(':')[1] };

    // ---- where a scroll / an area is on screen ----
    const visible = el => {
        if (!el || !el.isConnected) return null;
        const r = el.getBoundingClientRect();
        if (r.width < 2 || r.height < 2) return null;
        if (r.bottom < 0 || r.right < 0 || r.top > innerHeight || r.left > innerWidth) return null;
        return r;
    };
    const byName = (root, name) => {
        if (!root || !name) return null;
        for (const el of root.querySelectorAll('[data-scroll-name]')) {
            if (el.dataset.scrollName !== name) continue;
            const r = visible(el);
            if (r) return { el, r };
        }
        return null;
    };
    const panelOpen = id => !!window.ScrollPanelSystem?.isOpen?.(id);
    // {el, r} for a place; the scroll's own card / row when it is there,
    // else the area (panel, row list) or its dock button.
    function anchor(loc, name) {
        const L = parse(loc);
        if (L.area === 'common' || L.seat === panelSeat()) {
            const id = L.area;
            if (panelOpen(id)) {
                const panel = document.getElementById('fsp-' + id);
                const hit = byName(panel, name);
                if (hit) return hit;
                const r = visible(panel);
                if (r) return { el: panel, r };
            }
            const btn = document.getElementById('panel-btn-' + id);
            const r = visible(btn);
            return r ? { el: btn, r } : null;
        }
        // another player: their rows in Opponent Status
        const card = document.querySelector(`#new-opponent-cards .opponent-card[data-player-index="${L.seat}"]`);
        const list = card?.querySelector(`.opp-scroll-list[data-area="${L.area}"]`);
        const hit = byName(list, name);
        if (hit) return hit;
        let r = visible(list);
        if (r) return { el: list, r };
        r = visible(card);
        if (r) return { el: card, r };
        const btn = document.getElementById('panel-btn-opponents');
        r = visible(btn);
        return r ? { el: btn, r } : null;
    }
    // Remember where every scroll is now, so a move can start from where it
    // WAS even when its panel has already been redrawn without it.
    function cachePlaces(places) {
        rectCache.clear();
        places.forEach((loc, name) => {
            const a = anchor(loc, name);
            if (a) rectCache.set(loc + '|' + name, a.r);
        });
    }

    // ---- keep the scroll hidden at its new place until the chip lands ----
    // (owner 2026-10-15: the panel redraws with the card already there, so it
    // showed in the new area first and then the chip flew to it). A style rule,
    // not the element itself, so it also hides a card the panel draws again
    // while the chip is in the air.
    const hides = new Map();     // rule text -> count
    function destSelectors(loc) {
        const L = parse(loc);
        if (L.area === 'common') return ['#fsp-common'];
        const opp = `#new-opponent-cards .opponent-card[data-player-index="${L.seat}"] .opp-scroll-list[data-area="${L.area}"]`;
        return L.seat === panelSeat() ? ['#fsp-' + L.area, opp] : [opp];
    }
    function renderHides() {
        let st = document.getElementById('smf-hide');
        if (!hides.size) { st?.remove(); return; }
        if (!st) { st = document.createElement('style'); st.id = 'smf-hide'; document.head.appendChild(st); }
        st.textContent = [...hides.keys()].join('\n');
    }
    function hide(loc, name) {
        const safe = String(name).replace(/["\\]/g, '');
        const rule = destSelectors(loc).map(sel => `${sel} [data-scroll-name="${safe}"]`).join(', ') + ' { visibility: hidden !important; }';
        hides.set(rule, (hides.get(rule) || 0) + 1);
        renderHides();
        let undone = false;
        return () => {
            if (undone) return; undone = true;
            const n = (hides.get(rule) || 1) - 1;
            if (n > 0) hides.set(rule, n); else hides.delete(rule);
            renderHides();
        };
    }

    // ---- the flying chip ----
    function chipFor(name, showName) {
        const look = window.ScrollLook;
        const meta = window.ScrollPanelSystem?.scrollMeta?.(name);
        const el = window.spellSystem?.getScrollElement?.(name);
        const shownKey = showName ? name : (el === 'catacomb' ? 'catacomb' : name);
        const cols = look ? look.colors(shownKey) : ['#ccc'];
        const bg = look ? look.gradient(cols) : cols[0];
        const chip = document.createElement('div');
        chip.className = 'smf-chip';
        chip.style.setProperty('--smf-color', cols[0]);
        chip.style.setProperty('--smf-grad', bg);
        const dot = document.createElement('span');
        dot.className = 'smf-dot';
        dot.style.background = bg;
        const txt = document.createElement('span');
        txt.className = 'smf-name';
        txt.textContent = showName ? (meta?.name || name) : 'Scroll';
        if (showName && cols.length > 1 && look) txt.style.cssText = look.textStyle(name);
        else if (showName) txt.style.color = '#fff';
        const sub = document.createElement('span');
        sub.className = 'smf-meta';
        sub.textContent = showName ? [meta?.elLabel, meta?.lvLabel].filter(Boolean).join(' · ') : (look ? look.label(shownKey) : '');
        chip.append(dot, txt, sub);
        return { chip, color: cols[0] };
    }

    function fly(name, from, to, startRect) {
        if (flights >= MAX_FLIGHTS) return;
        const F = parse(from), T = parse(to);
        const seat = panelSeat();
        const spectating = !!window.__liveSpectate;
        const isPublic = a => a.area === 'active' || a.area === 'common';
        const mine = a => a.area === 'hand' && a.seat === seat && !spectating;
        const showName = isPublic(F) || isPublic(T) || mine(F) || mine(T);
        flights++;
        const unhide = hide(to, name);
        let done = false;
        const finish = () => { if (!done) { done = true; flights--; unhide(); } };
        setTimeout(unhide, 4000); // never leave a scroll hidden
        // fly as soon as the destination panel has drawn the scroll (or 150 ms)
        const t0 = performance.now();
        const ready = () => {
            const a = anchor(to, name);
            return a && a.el?.dataset?.scrollName === name ? a : null;
        };
        const wait = () => {
            if (ready() || performance.now() - t0 > 150) start(); else requestAnimationFrame(wait);
        };
        requestAnimationFrame(wait);
        function start() {
            try {
                const dest = anchor(to, name);
                const s = startRect || anchor(from, name)?.r;
                if (!dest || !s) { finish(); return; }
                const d = dest.r;
                const { chip, color } = chipFor(name, showName);
                document.body.appendChild(chip);
                const cw = chip.offsetWidth || 120, ch = chip.offsetHeight || 24;
                const sx = s.left + s.width / 2, sy = s.top + s.height / 2;
                const ex = d.left + d.width / 2, ey = d.top + d.height / 2;
                chip.style.left = (sx - cw / 2) + 'px';
                chip.style.top = (sy - ch / 2) + 'px';
                const dx = ex - sx, dy = ey - sy, dist = Math.hypot(dx, dy);
                // an arc that bows up the screen (more for a longer trip)
                const lift = Math.min(140, 40 + dist * 0.25);
                const cx = dx / 2, cy = dy / 2 - lift;
                const s0 = Math.max(0.6, Math.min(1.3, s.height / ch));
                const s1 = Math.max(0.6, Math.min(1.3, d.height / ch));
                const T_MS = Math.max(560, Math.min(1000, 480 + dist * 0.45));
                const frames = [];
                const N = 16;
                for (let k = 0; k <= N; k++) {
                    const u = k / N, e = u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2; // ease in-out
                    const x = 2 * (1 - e) * e * cx + e * e * dx;
                    const y = 2 * (1 - e) * e * cy + e * e * dy;
                    const sc = s0 + (s1 - s0) * e + Math.sin(Math.PI * e) * 0.18;
                    const rot = Math.sin(Math.PI * e) * (dx >= 0 ? 4 : -4);
                    frames.push({
                        offset: u,
                        transform: `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) scale(${sc.toFixed(3)}) rotate(${rot.toFixed(1)}deg)`,
                        opacity: u < 0.1 ? u / 0.1 : (u > 0.88 ? (1 - u) / 0.12 : 1),
                    });
                }
                // two faint copies a step behind: a short motion trail
                const trail = [0.35, 0.18].map((op, i) => {
                    const g = chip.cloneNode(true);
                    g.classList.add('smf-trail');
                    g.style.left = chip.style.left; g.style.top = chip.style.top;
                    document.body.insertBefore(g, chip);
                    const a = g.animate(frames.map(f => ({ ...f, opacity: f.opacity * op })),
                        { duration: T_MS, delay: 45 * (i + 1), easing: 'linear', fill: 'both' });
                    a.onfinish = a.oncancel = () => g.remove();
                    setTimeout(() => g.remove(), T_MS * 2 + 1500);
                    return g;
                });
                void trail;
                const a = chip.animate(frames, { duration: T_MS, easing: 'linear', fill: 'both' });
                const land = () => {
                    chip.remove();
                    finish(); // shows the scroll at its new place again
                    // glow on the scroll (or area) it landed on
                    const now = anchor(to, name);
                    const el = now?.el;
                    if (el && el.classList) {
                        el.style.setProperty('--smf-color', color);
                        el.classList.remove('smf-landed');
                        void el.offsetWidth;
                        el.classList.add('smf-landed');
                        setTimeout(() => el.classList.remove('smf-landed'), 650);
                    }
                };
                a.onfinish = land;
                a.oncancel = () => { chip.remove(); finish(); };
                setTimeout(() => { if (chip.isConnected) land(); }, T_MS * 2 + 1500); // only if the animation never ends (busy page)
            } catch (e) { finish(); }
        }
    }

    // Other players' moves can arrive as two messages: first "gone from hand /
    // active" (scroll-discard), then "added to the common area"
    // (common-area-update). In between the scroll is nowhere, so a scroll that
    // vanishes is remembered for GONE_MS with where it was; if it shows up
    // somewhere else in that time, that is the move (owner 2026-10-15: other
    // players' scrolls never flew).
    const GONE_MS = 2000;
    const gone = new Map();      // name -> { loc, rect, t }
    function tick() {
        if (!gameOn()) { prev = null; rectCache.clear(); gone.clear(); return; }
        const places = readPlaces();
        const now = performance.now();
        if (prev) {
            prev.forEach((loc, name) => {
                if (!places.has(name)) gone.set(name, { loc, rect: rectCache.get(loc + '|' + name) || null, t: now });
            });
        }
        gone.forEach((g, name) => { if (now - g.t > GONE_MS) gone.delete(name); });
        if (prev && fxOk()) {
            const moves = [];
            places.forEach((loc, name) => {
                const was = prev.get(name);
                if (was && was !== loc) { moves.push({ name, from: was, to: loc, rect: rectCache.get(was + '|' + name) || null }); return; }
                if (!was) {
                    const g = gone.get(name);
                    if (g && g.loc !== loc) moves.push({ name, from: g.loc, to: loc, rect: g.rect });
                }
            });
            moves.forEach(m => gone.delete(m.name));
            // many at once = a resync / rebuild, not someone playing: no show
            if (moves.length && moves.length <= MAX_MOVES) {
                moves.forEach(m => fly(m.name, m.from, m.to, m.rect));
            }
        }
        prev = places;
        if (fxOk()) cachePlaces(places);
    }
    setInterval(() => { try { tick(); } catch (e) {} }, TICK);

    window.ScrollMoveFx = { fly: (name, from, to) => fly(name, from, to, null), _tick: tick, _anchor: anchor, _flights: () => flights };
})();
