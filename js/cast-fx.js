// Cast effects: when a scroll is activated, crackling magic lines briefly join
// the caster's pawn and the stones of the scroll's pattern, in the scroll's
// colour (a catacomb scroll uses both of its element colours), the stones
// flare up and sparks drift off, then the lines break apart and fade
// (owner 2026-10-08). window.CastFX.play(playerIndex, scrollName)
//
// Triggered from the cast log (game-core.js logScrollEvent 'cast_execute',
// through ActionLog.onRecord) for casts on this screen, and from lobby.js's
// 'scroll-used' handler for other players' casts. Looks only: never touches
// game state. Skipped in muted training (SoundSystem null), hidden tabs and
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
    function play(playerIndex, scrollName) {
        try {
            if (document.hidden || reduceMotion || !window.SoundSystem || running >= 3) return;
            const vp = document.getElementById('viewport'), svg = document.getElementById('boardSvg');
            if (!vp || !svg) return;
            const pawn = (typeof playerPositions !== 'undefined') ? playerPositions[playerIndex] : null;
            if (!pawn) return;
            ensureDefs(svg);
            const cols = colorsOf(scrollName);
            const P = { x: pawn.x, y: pawn.y };
            const stones = patternPoints(scrollName, P);
            const nodes = [P, ...stones];
            // Lines: caster to every stone, and stone to stone around the caster.
            const links = stones.map((s, i) => [P, s, cols[i % cols.length]]);
            const ring = stones.slice().sort((a, b) => Math.atan2(a.y - P.y, a.x - P.x) - Math.atan2(b.y - P.y, b.x - P.x));
            if (ring.length >= 3) ring.forEach((s, i) => links.push([s, ring[(i + 1) % ring.length], cols[(i + 1) % cols.length]]));
            else if (ring.length === 2) links.push([ring[0], ring[1], cols[cols.length - 1]]);

            const layer = el('g', { class: 'cast-fx' }, vp);
            const flares = el('g', {}, layer), lines = el('g', {}, layer), sparks = el('g', {}, layer);
            // Flares on the caster and the stones (light, so screen blend)
            const flareEls = nodes.map((n, i) => {
                const c = i === 0 ? cols[0] : (window.STONE_TYPES?.[n.type]?.color || cols[0]);
                const f = el('circle', { cx: n.x, cy: n.y, r: i === 0 ? 22 : 18, fill: c, mask: 'url(#cast-fx-flare-mask)', opacity: 0 }, flares);
                f.style.mixBlendMode = 'screen';
                return f;
            });
            // Rune ring under the caster
            const rune = el('circle', { cx: P.x, cy: P.y, r: 10, fill: 'none', stroke: cols[0], 'stroke-width': 1.4, 'stroke-dasharray': '3 4', opacity: 0 }, flares);
            // Lines: wide soft glow + thin bright core, re-jagged every frame
            const linkEls = links.map(([a, b, c]) => ({
                a, b,
                glow: el('polyline', { fill: 'none', stroke: c, 'stroke-width': 4.5, 'stroke-opacity': 0, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, lines),
                core: el('polyline', { fill: 'none', stroke: '#ffffff', 'stroke-width': 1.1, 'stroke-opacity': 0, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, lines),
            }));
            linkEls.forEach(l => { l.glow.style.mixBlendMode = 'screen'; l.glow.style.filter = 'blur(1.2px)'; });
            // Sparks drifting up and out from each node
            const sparkEls = [];
            nodes.forEach((n, i) => {
                for (let k = 0; k < (i === 0 ? 6 : 4); k++) {
                    const a = Math.random() * Math.PI * 2, sp = 8 + Math.random() * 16;
                    const s = el('circle', { r: (0.6 + Math.random() * 0.9).toFixed(2), fill: k % 2 ? '#ffffff' : cols[k % cols.length], opacity: 0 }, sparks);
                    sparkEls.push({ s, x: n.x, y: n.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 10, t0: Math.random() * 300 });
                }
            });

            running++;
            let done = false;
            const finish = () => { if (done) return; done = true; layer.remove(); running--; };
            const t0 = performance.now(), TOTAL = T_GROW + T_HOLD + T_FADE;
            const step = (now) => {
                if (done) return;
                const t = now - t0;
                if (t >= TOTAL) { finish(); return; }
                // line strength: grow, flicker, then break up and fade
                const grow = Math.min(1, t / T_GROW);
                const fade = t > T_GROW + T_HOLD ? 1 - (t - T_GROW - T_HOLD) / T_FADE : 1;
                const flick = 0.75 + 0.25 * Math.sin(t / 23) * Math.sin(t / 61);
                const breaking = t > T_GROW + T_HOLD;
                linkEls.forEach((l, i) => {
                    // grow out from the caster: draw only part of the way
                    const g = Math.max(0, Math.min(1, grow * 1.3 - i * 0.06));
                    const end = { x: l.a.x + (l.b.x - l.a.x) * g, y: l.a.y + (l.b.y - l.a.y) * g };
                    const amp = breaking ? 6 + 10 * (1 - fade) : 3.5;
                    const pts = bolt(l.a, end, amp);
                    // while breaking, lines drop out one by one
                    const on = !breaking || Math.random() < fade + 0.15;
                    l.glow.setAttribute('points', pts); l.core.setAttribute('points', pts);
                    l.glow.setAttribute('stroke-opacity', on ? (0.75 * fade * flick).toFixed(3) : 0);
                    l.core.setAttribute('stroke-opacity', on ? (0.95 * fade * flick).toFixed(3) : 0);
                });
                const pulse = grow * fade * (0.8 + 0.2 * Math.sin(t / 40));
                flareEls.forEach((f, i) => {
                    f.setAttribute('opacity', (pulse * (i === 0 ? 0.8 : 0.95)).toFixed(3));
                    f.setAttribute('r', ((i === 0 ? 22 : 18) * (0.85 + 0.25 * grow)).toFixed(1));
                });
                rune.setAttribute('opacity', (0.8 * grow * fade).toFixed(3));
                rune.setAttribute('r', (10 + 8 * (t / TOTAL)).toFixed(1));
                rune.setAttribute('transform', `rotate(${(t / 6).toFixed(1)} ${P.x} ${P.y})`);
                sparkEls.forEach(p => {
                    const u = Math.max(0, (t - p.t0) / 1000);
                    if (u <= 0) return;
                    p.s.setAttribute('cx', (p.x + p.vx * u).toFixed(1));
                    p.s.setAttribute('cy', (p.y + p.vy * u - 12 * u * u).toFixed(1));
                    p.s.setAttribute('opacity', Math.max(0, 0.9 * (1 - u * 1.4)).toFixed(3));
                });
                requestAnimationFrame(step);
            };
            requestAnimationFrame(step);
            setTimeout(finish, TOTAL + 1500); // safety: hidden tabs pause frames
        } catch (e) { console.warn('[CastFX] failed', e); }
    }

    window.CastFX = { play };

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
