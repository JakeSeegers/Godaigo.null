// Cast effects: when a scroll is activated, crackling magic lines briefly join
// the caster's pawn and the stones of the scroll's pattern, in the scroll's
// colour (a catacomb scroll uses both of its element colours), the stones
// flare up and sparks drift off, then the lines break apart and fade
// (owner 2026-10-08). window.CastFX.play(playerIndex, scrollName)
//
// Triggered from the cast log (game-core.js logScrollEvent 'cast_execute',
// through ActionLog.onRecord) for casts on this screen, and from lobby.js's
// 'scroll-used' handler for other players' casts. Looks only: never touches
// game state. Skipped when window.fxOn() is false (muted training not set to Watchable), hidden tabs and
// with reduced motion.
(function () {
    'use strict';
    const NS = 'http://www.w3.org/2000/svg';
    const TILE = 20;                       // game-core.js TILE_SIZE
    const T_GROW = 220, T_HOLD = 520, T_FADE = 380;
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;

    function el(tag, attrs, parent) {
        const e = document.createElementNS(NS, tag);
        for (const k in attrs) e.setAttribute(k, attrs[k]);
        e.style.pointerEvents = 'none';
        if (parent) parent.appendChild(e);
        return e;
    }
    // Same maths as game-core.js hexToPixel / pixelToHex (pointy-top axial).
    function hexToPixel(q, r) { return { x: TILE * Math.sqrt(3) * (q + r / 2), y: TILE * 1.5 * r }; }
    function pixelToHex(x, y) {
        let q = (x * Math.sqrt(3) / 3 - y / 3) / TILE, r = (y * 2 / 3) / TILE, s = -q - r;
        let rq = Math.round(q), rr = Math.round(r), rs = Math.round(s);
        const dq = Math.abs(rq - q), dr = Math.abs(rr - r), ds = Math.abs(rs - s);
        if (dq > dr && dq > ds) rq = -rr - rs; else if (dr > ds) rr = -rq - rs;
        return { q: rq, r: rr };
    }

    // The pattern stones around the caster (the first variant that is fully
    // on the board), or [] when none is (Sacrificial Pyre ignores patterns).
    function patternPoints(scrollName, pos) {
        const def = window.spellSystem?.patterns?.[scrollName] || window.SCROLL_DEFINITIONS?.[scrollName];
        if (!def?.patterns || !pos) return [];
        let stones = [];
        try { stones = window.BotState.snapshot().stones || []; } catch (e) { return []; }
        const h = pixelToHex(pos.x, pos.y);
        for (const variant of def.patterns) {
            const pts = [];
            for (const req of variant) {
                const c = hexToPixel(h.q + req.q, h.r + req.r);
                const st = stones.find(s => Math.hypot(s.x - c.x, s.y - c.y) < 5);
                if (!st) { pts.length = 0; break; }
                pts.push({ x: c.x, y: c.y, type: req.type });
            }
            if (pts.length) return pts;
        }
        return [];
    }

    function colorsOf(scrollName) {
        try { const c = window.ScrollLook?.colors?.(scrollName); if (c && c.length) return c; } catch (e) {}
        return ['#c9a2ff'];
    }

    // A jagged line from a to b: points nudged sideways, more in the middle.
    function bolt(a, b, amp) {
        const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
        const nx = -dy / len, ny = dx / len, n = Math.max(4, Math.round(len / 7));
        const pts = [];
        for (let i = 0; i <= n; i++) {
            const t = i / n, w = (i === 0 || i === n) ? 0 : Math.sin(Math.PI * t) * amp * (Math.random() * 2 - 1);
            pts.push(`${(a.x + dx * t + nx * w).toFixed(1)},${(a.y + dy * t + ny * w).toFixed(1)}`);
        }
        return pts.join(' ');
    }

    function ensureDefs(svg) {
        if (document.getElementById('cast-fx-defs')) return;
        const d = el('defs', { id: 'cast-fx-defs' });
        d.innerHTML = '<radialGradient id="cast-fx-flare" cx="0.5" cy="0.5" r="0.5">'
            + '<stop offset="0" stop-color="#fff" stop-opacity="1"/><stop offset="0.35" stop-color="#fff" stop-opacity="0.55"/>'
            + '<stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>'
            + '<mask id="cast-fx-flare-mask" maskContentUnits="objectBoundingBox"><rect width="1" height="1" fill="url(#cast-fx-flare)"/></mask>';
        svg.insertBefore(d, svg.firstChild);
    }

    let running = 0;
    const live = [];          // effects waiting on a response window
    const screenGroup = (parent, at) => {
        // a group in screen direction around `at` (counter-turns the board rotation)
        const r = typeof window.getBoardRotation === 'function' ? window.getBoardRotation() : 0;
        return el('g', { transform: `translate(${at.x} ${at.y}) rotate(${-r})` }, parent);
    };
    function waitingOnWindow(playerIndex, scrollName) {
        const rw = window.spellSystem?.responseWindow;
        return !!(rw && rw.isResponseWindowOpen && rw.currentCaster === playerIndex
            && (!rw.pendingScrollData || rw.pendingScrollData.name === scrollName));
    }

    function play(playerIndex, scrollName) {
        try {
            if (document.hidden || reduceMotion || !window.fxOn?.() || running >= 3) return;
            const vp = document.getElementById('viewport'), svg = document.getElementById('boardSvg');
            if (!vp || !svg) return;
            const pawn = (typeof playerPositions !== 'undefined') ? playerPositions[playerIndex] : null;
            if (!pawn) return;
            ensureDefs(svg);
            const cols = colorsOf(scrollName);
            const P = { x: pawn.x, y: pawn.y };
            const stones = patternPoints(scrollName, P);
            const links = stones.map((s, i) => [P, s, cols[i % cols.length]]);
            const ring = stones.slice().sort((a, b) => Math.atan2(a.y - P.y, a.x - P.x) - Math.atan2(b.y - P.y, b.x - P.x));
            if (ring.length >= 3) ring.forEach((s, i) => links.push([s, ring[(i + 1) % ring.length], cols[(i + 1) % cols.length]]));
            else if (ring.length === 2) links.push([ring[0], ring[1], cols[cols.length - 1]]);

            // Two layers: BACK (under the pawns: lines, the caster's aura, rune,
            // the far half of the energy around the pawn) and FRONT (over
            // everything: stone flares, sparks, the near half of the energy).
            const back = el('g', { class: 'cast-fx' });
            const firstPawn = vp.querySelector(':scope > g.player');
            vp.insertBefore(back, firstPawn || null);
            const front = el('g', { class: 'cast-fx' }, vp);
            const lines = el('g', {}, back);
            const aura = el('circle', { cx: P.x, cy: P.y, r: 22, fill: cols[0], mask: 'url(#cast-fx-flare-mask)', opacity: 0 }, back);
            aura.style.mixBlendMode = 'screen';
            const rune = el('circle', { cx: P.x, cy: P.y, r: 10, fill: 'none', stroke: cols[0], 'stroke-width': 1.4, 'stroke-dasharray': '3 4', opacity: 0 }, back);
            const flareEls = stones.map(n => {
                const f = el('circle', { cx: n.x, cy: n.y, r: 18, fill: window.STONE_TYPES?.[n.type]?.color || cols[0], mask: 'url(#cast-fx-flare-mask)', opacity: 0 }, front);
                f.style.mixBlendMode = 'screen';
                return f;
            });
            const sparks = el('g', {}, front);
            const mkBolt = (parent, c, w = 4.5) => {
                const glow = el('polyline', { fill: 'none', stroke: c, 'stroke-width': w, 'stroke-opacity': 0, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, parent);
                const core = el('polyline', { fill: 'none', stroke: '#ffffff', 'stroke-width': 1.1, 'stroke-opacity': 0, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, parent);
                glow.style.mixBlendMode = 'screen'; glow.style.filter = 'blur(1.2px)';
                return { glow, core, set(pts, op, grey) {
                    glow.setAttribute('points', pts); core.setAttribute('points', pts);
                    glow.setAttribute('stroke-opacity', (0.75 * op).toFixed(3)); core.setAttribute('stroke-opacity', (0.95 * op).toFixed(3));
                    if (grey) { glow.setAttribute('stroke', '#777'); core.setAttribute('stroke', '#bbb'); }
                } };
            };
            const linkEls = links.map(([a, b, c]) => ({ a, b, ...mkBolt(lines, c) }));
            // Energy wrapping the caster: arcs on an ellipse around the pawn at
            // different heights; the near half draws in front, the far half behind.
            const wrapBack = screenGroup(back, P), wrapFront = screenGroup(front, P);
            const arcs = [0, 1, 2].map(i => ({ h: 3 + i * 5, a0: Math.random() * 6.28, speed: (i % 2 ? -1 : 1) * (0.008 + i * 0.002),
                c: cols[i % cols.length], backB: mkBolt(wrapBack, cols[i % cols.length], 3), frontB: mkBolt(wrapFront, cols[i % cols.length], 3) }));
            const sparkEls = [];
            [P, ...stones].forEach((n, i) => {
                for (let k = 0; k < (i === 0 ? 6 : 4); k++) {
                    const a = Math.random() * Math.PI * 2, sp = 8 + Math.random() * 16;
                    const s = el('circle', { r: (0.6 + Math.random() * 0.9).toFixed(2), fill: k % 2 ? '#ffffff' : cols[k % cols.length], opacity: 0 }, sparks);
                    sparkEls.push({ s, x: n.x, y: n.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 10, t0: Math.random() * 300 });
                }
            });

            running++;
            const fx = { playerIndex, scrollName, state: 'grow', tEnd: null, counter: null };
            live.push(fx);
            let done = false;
            const finish = () => {
                if (done) return; done = true; back.remove(); front.remove(); running--;
                const i = live.indexOf(fx); if (i >= 0) live.splice(i, 1);
            };
            const t0 = performance.now();
            let counterBolt = null;
            const step = (now) => {
                if (done) return;
                const t = now - t0;
                // phases: grow, then hold while a response window is open (max
                // 20 s), then end: 'release' (normal) or 'shatter' (countered)
                if (fx.state === 'grow' && t >= T_GROW) fx.state = 'hold';
                if (fx.state === 'hold' && t >= T_GROW + T_HOLD && !(waitingOnWindow(playerIndex, scrollName) && t < 20000)) {
                    fx.state = 'release'; fx.tEnd = t;
                }
                if (fx.state === 'shatter' && fx.tEnd == null) fx.tEnd = t;
                const endT = fx.tEnd == null ? 0 : t - fx.tEnd;
                const shatter = fx.state === 'shatter';
                const FADE = shatter ? 520 : T_FADE;
                if (fx.tEnd != null && endT >= FADE) { finish(); return; }
                const grow = Math.min(1, t / T_GROW);
                const fade = fx.tEnd == null ? 1 : 1 - endT / FADE;
                const waiting = fx.state === 'hold' && t > T_GROW + T_HOLD;   // charged, waiting on a response
                const flick = 0.75 + 0.25 * Math.sin(t / 23) * Math.sin(t / 61);
                const ending = fx.tEnd != null;
                linkEls.forEach((l, i) => {
                    const g = Math.max(0, Math.min(1, grow * 1.3 - i * 0.06));
                    const end = { x: l.a.x + (l.b.x - l.a.x) * g, y: l.a.y + (l.b.y - l.a.y) * g };
                    const amp = shatter ? 4 + 18 * (1 - fade) : ending ? 6 + 10 * (1 - fade) : waiting ? 4.5 : 3.5;
                    const on = !ending || Math.random() < fade + (shatter ? 0 : 0.15);
                    l.set(bolt(l.a, end, amp), on ? fade * flick * (waiting ? 0.8 : 1) : 0, shatter && endT > 60);
                });
                // the energy around the caster
                arcs.forEach(a => {
                    const ang = a.a0 + t * a.speed, fr = [], bk = [];
                    for (let k = 0; k <= 14; k++) {
                        const th = ang + k * 0.17, rr = 11 + (Math.random() - 0.5) * 3;
                        const x = Math.cos(th) * rr, y = Math.sin(th) * rr * 0.42 - a.h + (Math.random() - 0.5) * 1.5;
                        (Math.sin(th) > 0 ? fr : bk).push(`${x.toFixed(1)},${y.toFixed(1)}`);
                    }
                    const op = grow * fade * flick;
                    a.frontB.set(fr.join(' '), fr.length > 1 ? op : 0, shatter);
                    a.backB.set(bk.join(' '), bk.length > 1 ? op : 0, shatter);
                });
                const pulse = grow * fade * (0.8 + 0.2 * Math.sin(t / 40));
                aura.setAttribute('opacity', (pulse * 0.8).toFixed(3));
                flareEls.forEach(f => {
                    f.setAttribute('opacity', (pulse * 0.95).toFixed(3));
                    f.setAttribute('r', (18 * (0.85 + 0.25 * grow)).toFixed(1));
                });
                rune.setAttribute('opacity', (0.8 * grow * fade).toFixed(3));
                rune.setAttribute('r', (10 + Math.min(8, t / 120)).toFixed(1));
                rune.setAttribute('transform', `rotate(${(t / 6).toFixed(1)} ${P.x} ${P.y})`);
                sparkEls.forEach(p => {
                    const u = Math.max(0, ((t - p.t0) % 1100) / 1000);   // keep sparking while charged
                    if (t < p.t0 || (ending && u < endT / 1000)) { if (ending) p.s.setAttribute('opacity', 0); return; }
                    p.s.setAttribute('cx', (p.x + p.vx * u * (shatter ? 2.5 : 1)).toFixed(1));
                    p.s.setAttribute('cy', (p.y + p.vy * u * (shatter ? 2.5 : 1) - 12 * u * u).toFixed(1));
                    p.s.setAttribute('opacity', (Math.max(0, 0.9 * (1 - u * 1.4)) * fade).toFixed(3));
                });
                // countered: a bolt in the counter's colour from the countering pawn
                if (shatter && fx.counter) {
                    if (!counterBolt) counterBolt = mkBolt(front, fx.counter.color, 5.5);
                    const k = Math.min(1, endT / 140), C = fx.counter.from;
                    const tip = { x: C.x + (P.x - C.x) * k, y: C.y + (P.y - C.y) * k };
                    counterBolt.set(bolt(C, tip, 6), Math.max(0, 1 - Math.max(0, endT - 260) / 260));
                }
                requestAnimationFrame(step);
            };
            requestAnimationFrame(step);
            setTimeout(finish, 22000); // safety: hidden tabs pause frames
        } catch (e) { console.warn('[CastFX] failed', e); }
    }

    // Called by response-window.js announceOutcome on every screen: response /
    // counter scrolls get their own effect, a countered cast shatters (grey
    // lines, a bolt from the countering player);
    // anything else just ends normally once the window has closed.
    function resolve(results) {
        try {
            // Response and counter scrolls are not in the cast log: give them
            // their own cast effect around their caster (owner 2026-10-08).
            (results || []).filter(r => r.result === 'countered-original' || r.result === 'response-resolved')
                .forEach(r => { if (r.casterIndex != null && r.scrollName) play(r.casterIndex, r.scrollName); });
            const countered = (results || []).find(r => r.result === 'countered');
            const counter = (results || []).find(r => r.result === 'countered-original');
            if (!countered) return;
            const fx = live.find(f => f.playerIndex === countered.casterIndex && f.scrollName === countered.scrollName && f.tEnd == null);
            if (!fx) return;
            fx.state = 'shatter';
            const from = counter && (typeof playerPositions !== 'undefined') ? playerPositions[counter.casterIndex] : null;
            if (from) fx.counter = { from: { x: from.x, y: from.y }, color: colorsOf(counter.scrollName)[0] };
        } catch (e) {}
    }

    window.CastFX = { play, resolve };

    // Casts on this screen (players, bots driven here, the arena)
    function hook() {
        if (!window.ActionLog?.onRecord) return false;
        window.ActionLog.onRecord(e => {
            if (e.type !== 'cast_execute') return;
            const who = e.playerIndex ?? e.player;
            if (who != null && e.scrollName) play(who, e.scrollName);
        });
        return true;
    }
    if (!hook()) {
        let tries = 0;
        const t = setInterval(() => { if (hook() || ++tries > 40) clearInterval(t); }, 250);
    }
})();
