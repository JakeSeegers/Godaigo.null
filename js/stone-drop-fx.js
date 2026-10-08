// Stone drop effects (owner 2026-10-08): a short animation when a stone is
// placed, one per element.
//   earth: a small board shake; stones and pawns 1, 2 and 3 hexes away
//          bounce, less the farther away they are.
//   water: jiggles. A water stone that takes another stone's ability (next
//          to it, or chained) plays THAT stone's drop instead (earth = shake).
//   fire:  flickers, crackles and gives off a few floating sparks.
//   wind:  "breathes" once, growing and shrinking, with a soft ring.
//   void:  fades in with a spectral glow, as if summoned.
// window.StoneDropFx.play(x, y, type). Triggered by every 'placeStone' record
// in the ActionLog (own placements, bots on this screen, other players'
// 'stone-place' messages, replays). Undo restores do not record, so they do
// not animate. Looks only: never touches game state. Skipped in muted
// training (SoundSystem null), hidden tabs and with reduced motion.
(function () {
    'use strict';
    const NS = 'http://www.w3.org/2000/svg';
    const TILE = 20;                           // game-core.js TILE_SIZE
    const BOUNCE = [0, 6, 3.5, 1.8];           // earth ripple height by hex distance
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
    let running = 0;

    function el(tag, attrs, parent) {
        const e = document.createElementNS(NS, tag);
        for (const k in attrs) e.setAttribute(k, attrs[k]);
        e.style.pointerEvents = 'none';
        if (parent) parent.appendChild(e);
        return e;
    }
    function hexOf(x, y) {
        return { q: (x * Math.sqrt(3) / 3 - y / 3) / TILE, r: (y * 2 / 3) / TILE };
    }
    function hexDist(a, b) {
        const A = hexOf(a.x, a.y), B = hexOf(b.x, b.y);
        const dq = A.q - B.q, dr = A.r - B.r;
        return Math.round((Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2);
    }
    // "up" on the screen, in board units (the board can be turned)
    function upVec(len) {
        const r = typeof window.getBoardRotation === 'function' ? window.getBoardRotation() : 0;
        const a = r * Math.PI / 180;
        return { x: -len * Math.sin(a), y: -len * Math.cos(a) };
    }
    function colorOf(type) {
        try { return STONE_TYPES[type].color; } catch (e) { return '#cccccc'; }
    }
    function stoneAt(x, y) {
        try { return (placedStones || []).find(s => Math.hypot(s.x - x, s.y - y) < 5) || null; } catch (e) { return null; }
    }

    // A soft round glow in one colour (one gradient per colour, made once)
    function glowFill(svg, color) {
        const id = 'sdfx-glow-' + color.replace(/[^0-9a-z]/gi, '');
        if (!document.getElementById(id)) {
            let defs = document.getElementById('sdfx-defs');
            if (!defs) { defs = el('defs', { id: 'sdfx-defs' }); svg.insertBefore(defs, svg.firstChild); }
            const g = el('radialGradient', { id, cx: '0.5', cy: '0.5', r: '0.5' }, defs);
            el('stop', { offset: '0', 'stop-color': '#ffffff', 'stop-opacity': '0.9' }, g);
            el('stop', { offset: '0.3', 'stop-color': color, 'stop-opacity': '0.7' }, g);
            el('stop', { offset: '1', 'stop-color': color, 'stop-opacity': '0' }, g);
        }
        return `url(#${id})`;
    }

    // a layer for the extra pieces of one effect, removed after `ms`
    function layer(vp, x, y, ms) {
        const g = el('g', { class: 'stone-drop-fx', transform: `translate(${x} ${y})` }, vp);
        setTimeout(() => g.remove(), ms);
        return g;
    }

    function animate(node, frames, opts) {
        try { return node.animate(frames, opts); } catch (e) { return null; }
    }
    // scale around the piece's own middle
    function scaleAnim(node, frames, opts) {
        node.style.transformBox = 'fill-box';
        node.style.transformOrigin = 'center';
        const a = animate(node, frames, opts);
        if (a) a.onfinish = () => { node.style.transformBox = ''; node.style.transformOrigin = ''; };
    }

    // ── earth ────────────────────────────────────────────────────
    function earth(stone, svg, vp) {
        const up = upVec(1);
        // the stone lands with a thud
        animate(stone.element, [
            { translate: `${up.x * 9}px ${up.y * 9}px` }, { translate: '0px 0px', offset: 0.55 },
            { translate: `${up.x * 1.5}px ${up.y * 1.5}px`, offset: 0.75 }, { translate: '0px 0px' },
        ], { duration: 260, easing: 'ease-in', composite: 'add' });
        // board shake, right when it lands
        const k = [];
        for (let i = 0; i <= 6; i++) {
            const f = 1 - i / 6, a = 2.6 * f;
            k.push({ translate: i === 6 ? '0px 0px' : `${((Math.random() * 2 - 1) * a).toFixed(2)}px ${((Math.random() * 2 - 1) * a).toFixed(2)}px` });
        }
        animate(svg, k, { duration: 340, delay: 140, composite: 'add' });
        // ripple: stones and pawns 1-3 hexes away bounce, less with distance
        const things = [];
        try { (placedStones || []).forEach(s => { if (s !== stone && s.element) things.push({ x: s.x, y: s.y, node: s.element }); }); } catch (e) {}
        try { (playerPositions || []).forEach(p => { if (p && p.element) things.push({ x: p.x, y: p.y, node: p.element }); }); } catch (e) {}
        things.forEach(t => {
            const d = hexDist(stone, t);
            if (d < 1 || d > 3) return;
            const h = BOUNCE[d], u = upVec(h);
            animate(t.node, [
                { translate: '0px 0px' },
                { translate: `${u.x.toFixed(2)}px ${u.y.toFixed(2)}px`, offset: 0.3 },
                { translate: '0px 0px', offset: 0.62 },
                { translate: `${(u.x * 0.25).toFixed(2)}px ${(u.y * 0.25).toFixed(2)}px`, offset: 0.8 },
                { translate: '0px 0px' },
            ], { duration: 460, delay: 140 + d * 70, easing: 'ease-out', composite: 'add' });
        });
        // a puff of dust on landing
        const L = layer(vp, stone.x, stone.y, 900);
        const ring = el('circle', { r: 12, fill: 'none', stroke: colorOf('earth'), 'stroke-width': 2.5, opacity: 0 }, L);
        animate(ring, [{ r: 11, opacity: 0.7 }, { r: 30, opacity: 0 }], { duration: 520, delay: 140, easing: 'ease-out', fill: 'both' });
    }

    // ── water ────────────────────────────────────────────────────
    function water(stone) {
        scaleAnim(stone.element, [
            { scale: '1 1' }, { scale: '1.14 0.86', offset: 0.22 }, { scale: '0.9 1.1', offset: 0.45 },
            { scale: '1.06 0.95', offset: 0.68 }, { scale: '0.98 1.02', offset: 0.85 }, { scale: '1 1' },
        ], { duration: 560, easing: 'ease-out' });
    }

    // ── fire ─────────────────────────────────────────────────────
    function fire(stone, svg, vp, color) {
        animate(stone.element, [
            { opacity: 1 }, { opacity: 0.7, offset: 0.12 }, { opacity: 1, offset: 0.22 }, { opacity: 0.82, offset: 0.36 },
            { opacity: 1, offset: 0.5 }, { opacity: 0.88, offset: 0.7 }, { opacity: 1 },
        ], { duration: 760 });
        const L = layer(vp, stone.x, stone.y, 1500);
        // flickering glow behind the sparks
        const glow = el('circle', { r: 22, fill: glowFill(svg, color), opacity: 0 }, L);
        glow.style.mixBlendMode = 'screen';
        animate(glow, [
            { opacity: 0 }, { opacity: 0.8, offset: 0.1 }, { opacity: 0.45, offset: 0.25 }, { opacity: 0.75, offset: 0.4 },
            { opacity: 0.35, offset: 0.6 }, { opacity: 0.55, offset: 0.75 }, { opacity: 0 },
        ], { duration: 900, fill: 'both' });
        // crackle: tiny bright zigzags that flash once
        for (let i = 0; i < 3; i++) {
            const a = Math.random() * Math.PI * 2, r0 = 7, r1 = 15;
            const p = [0, 1, 2, 3].map(j => {
                const rr = r0 + (r1 - r0) * j / 3, aa = a + (Math.random() - 0.5) * 0.5;
                return `${(Math.cos(aa) * rr).toFixed(1)},${(Math.sin(aa) * rr).toFixed(1)}`;
            }).join(' ');
            const z = el('polyline', { points: p, fill: 'none', stroke: '#ffe2a0', 'stroke-width': 1.2, 'stroke-linecap': 'round', opacity: 0 }, L);
            animate(z, [{ opacity: 0 }, { opacity: 1, offset: 0.2 }, { opacity: 0 }],
                { duration: 160, delay: 60 + i * 140 + Math.random() * 80, fill: 'both' });
        }
        // a few floating sparks, rising up the screen
        for (let i = 0; i < 6; i++) {
            const sx = (Math.random() - 0.5) * 16, sy = (Math.random() - 0.5) * 10;
            const up = upVec(22 + Math.random() * 16), side = upVec(1);
            const drift = (Math.random() - 0.5) * 10;
            const ex = sx + up.x - side.y * drift, ey = sy + up.y + side.x * drift;
            const s = el('circle', { r: 0.9 + Math.random() * 0.8, fill: i % 2 ? '#ffd27a' : '#ffffff', opacity: 0 }, L);
            animate(s, [
                { transform: `translate(${sx}px, ${sy}px)`, opacity: 0 },
                { opacity: 1, offset: 0.15 },
                { transform: `translate(${ex.toFixed(1)}px, ${ey.toFixed(1)}px)`, opacity: 0 },
            ], { duration: 800 + Math.random() * 400, delay: i * 70, easing: 'ease-out', fill: 'both' });
        }
    }

    // ── wind ─────────────────────────────────────────────────────
    function wind(stone, svg, vp, color) {
        scaleAnim(stone.element, [
            { scale: '1' }, { scale: '1.17', offset: 0.45 }, { scale: '0.95', offset: 0.78 }, { scale: '1' },
        ], { duration: 950, easing: 'ease-in-out' });
        const L = layer(vp, stone.x, stone.y, 1300);
        const ring = el('circle', { r: 12, fill: 'none', stroke: color, 'stroke-width': 1.5, opacity: 0 }, L);
        animate(ring, [{ r: 12, opacity: 0 }, { r: 20, opacity: 0.55, offset: 0.45 }, { r: 26, opacity: 0 }],
            { duration: 1000, easing: 'ease-out', fill: 'both' });
    }

    // ── void ─────────────────────────────────────────────────────
    function voidFx(stone, svg, vp, color) {
        animate(stone.element, [{ opacity: 0 }, { opacity: 0.35, offset: 0.4 }, { opacity: 1 }],
            { duration: 750, easing: 'ease-in' });
        scaleAnim(stone.element, [{ scale: '0.75' }, { scale: '1.04', offset: 0.75 }, { scale: '1' }],
            { duration: 750, easing: 'ease-out' });
        const L = layer(vp, stone.x, stone.y, 1500);
        const glow = el('circle', { r: 26, fill: glowFill(svg, '#b78cff'), opacity: 0 }, L);
        glow.style.mixBlendMode = 'screen';
        animate(glow, [{ opacity: 0, r: 14 }, { opacity: 0.85, r: 26, offset: 0.45 }, { opacity: 0, r: 30 }],
            { duration: 1200, easing: 'ease-out', fill: 'both' });
        // a summoning circle that closes in on the stone
        const ring = el('circle', { r: 34, fill: 'none', stroke: '#d9c2ff', 'stroke-width': 1, 'stroke-dasharray': '3 4', opacity: 0 }, L);
        animate(ring, [{ r: 34, opacity: 0 }, { opacity: 0.8, offset: 0.3 }, { r: 12, opacity: 0 }],
            { duration: 800, easing: 'ease-in', fill: 'both' });
        // faint wisps drifting up
        for (let i = 0; i < 4; i++) {
            const sx = (Math.random() - 0.5) * 18, up = upVec(14 + Math.random() * 10);
            const w = el('circle', { r: 1.6, fill: '#e6d8ff', opacity: 0 }, L);
            animate(w, [
                { transform: `translate(${sx}px, 4px)`, opacity: 0 },
                { opacity: 0.7, offset: 0.3 },
                { transform: `translate(${(sx + up.x).toFixed(1)}px, ${(4 + up.y).toFixed(1)}px)`, opacity: 0 },
            ], { duration: 1000, delay: 200 + i * 120, easing: 'ease-out', fill: 'both' });
        }
        void color;
    }

    const BY_TYPE = { earth, water, fire, wind, void: voidFx };

    function play(x, y, type) {
        try {
            if (document.hidden || reduceMotion || !window.SoundSystem || running >= 6) return;
            const stone = stoneAt(x, y);
            if (!stone || !stone.element || !stone.element.isConnected) return;
            const vp = document.getElementById('viewport'), svg = document.getElementById('boardSvg');
            if (!vp || !svg) return;
            // a water stone always plays the drop of the stone it takes its ability from
            let look = type || stone.type;
            if (look === 'water') look = window.stoneAbilityAt?.(stone.x, stone.y) || 'water';
            const fn = BY_TYPE[look];
            if (!fn) return;
            running++;
            setTimeout(() => { running--; }, 1200);
            fn(stone, svg, vp, colorOf(look));
        } catch (e) { /* looks only */ }
    }

    window.StoneDropFx = { play };

    function hook() {
        if (!window.ActionLog?.onRecord) return false;
        window.ActionLog.onRecord(e => {
            if (e.type !== 'placeStone') return;
            const x = e.x ?? e.data?.x, y = e.y ?? e.data?.y, t = e.stoneType ?? e.data?.stoneType;
            if (typeof x !== 'number' || typeof y !== 'number') return;
            // next frame: 3D pieces have decorated the new stone by then
            requestAnimationFrame(() => play(x, y, t));
        });
        return true;
    }
    if (!hook()) {
        let tries = 0;
        const t = setInterval(() => { if (hook() || ++tries > 40) clearInterval(t); }, 250);
    }
})();
