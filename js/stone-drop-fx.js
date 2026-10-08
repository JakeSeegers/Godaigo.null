// Stone drop effects (owner 2026-10-08): a short animation when a stone is
// placed, one per element.
//   earth: a heavy drop (falls a little, squashes, settles); pawns 1, 2 and
//          3 hexes away bounce, less the farther away they are. Other stones
//          hold firm unless a void stone next to them cancels them (those
//          bounce too). The board itself does not move.
//   water, fire and wind first drop lightly into place (softDrop), then:
//   water: a small droplet bob up and down. A water stone that takes another
//          stone's ability (next to it, or chained) plays THAT stone's drop.
//   fire:  flickers, crackles and gives off a few floating sparks.
//   wind:  expands slightly and contracts once, with a soft ring.
//   void:  fades in with a spectral glow, as if summoned.
//   Any other stone placed next to a void stone has its ability cancelled,
//   so it only gets the light drop (no ripple, bob, sparks or swell).
// window.StoneDropFx.play(x, y, type). Triggered by every 'placeStone' record
// in the ActionLog (own placements, bots on this screen, other players'
// 'stone-place' messages, replays). Undo restores do not record, so they do
// not animate. Looks only: never touches game state. Skipped in muted
// training (window.fxOn() false: muted and not Watchable), hidden tabs and with reduced motion.
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
        // (the centre is white, then the colour, then see-through)
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
    // Scale around the piece's own spot. The CSS scale is applied on top of
    // the piece's transform="translate(x, y)", so it must be centred on
    // (x, y) in the board's units; centring it on the piece's own box made it
    // slide towards / away from the board's middle instead of growing.
    function scaleAnim(node, frames, opts) {
        const m = /translate\(\s*([-\d.e]+)[ ,]+([-\d.e]+)/.exec(node.getAttribute('transform') || '');
        node.style.transformBox = 'view-box';
        node.style.transformOrigin = m ? `${m[1]}px ${m[2]}px` : '0px 0px';
        const a = animate(node, frames, opts);
        if (a) a.onfinish = () => { node.style.transformBox = ''; node.style.transformOrigin = ''; };
    }

    // ── earth ────────────────────────────────────────────────────
    const LAND = 210;                          // ms until the earth stone lands
    function earth(stone, svg, vp) {
        const up = upVec(1);
        // a heavy drop: falls from a little above, speeding up, then a short
        // squash and a tiny settle when it lands
        animate(stone.element, [
            { translate: `${(up.x * 10).toFixed(2)}px ${(up.y * 10).toFixed(2)}px`, opacity: 0.6 },
            { translate: '0px 0px', opacity: 1 },
        ], { duration: LAND, easing: 'cubic-bezier(0.55, 0, 1, 0.45)', composite: 'add' });
        animate(stone.element, [
            { translate: '0px 0px' }, { translate: `${(up.x * 1.2).toFixed(2)}px ${(up.y * 1.2).toFixed(2)}px`, offset: 0.45 },
            { translate: '0px 0px' },
        ], { duration: 200, delay: LAND, easing: 'ease-out', composite: 'add' });
        scaleAnim(stone.element, [{ scale: '1' }, { scale: '0.93', offset: 0.3 }, { scale: '1.02', offset: 0.7 }, { scale: '1' }],
            { duration: 260, delay: LAND - 20, easing: 'ease-out' });
        // ripple: stones and pawns 1-3 hexes away bounce, less with distance
        // (the board itself stays still)
        const things = [];
        // Stones hold firm; only stones a void stone cancels (one next to
        // them) bounce. Pawns always bounce.
        try { (placedStones || []).forEach(s => { if (s !== stone && s.element && s.type !== 'void' && nextToVoid(s)) things.push({ x: s.x, y: s.y, node: s.element }); }); } catch (e) {}
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
            ], { duration: 460, delay: LAND + d * 70, easing: 'ease-out', composite: 'add' });
        });
        // a puff of dust on landing
        const L = layer(vp, stone.x, stone.y, 1000);
        const ring = el('circle', { r: 12, fill: 'none', stroke: colorOf('earth'), 'stroke-width': 2.5, opacity: 0 }, L);
        animate(ring, [{ r: 11, opacity: 0.6 }, { r: 28, opacity: 0 }], { duration: 520, delay: LAND, easing: 'ease-out', fill: 'both' });
    }

    // ── water ────────────────────────────────────────────────────
    // a droplet: a small up-and-down bob that dies away, with a slight swell
    function water(stone) {
        const u = (k) => { const v = upVec(k); return `${v.x.toFixed(2)}px ${v.y.toFixed(2)}px`; };
        animate(stone.element, [
            { translate: '0px 0px' }, { translate: u(1.6), offset: 0.18 }, { translate: u(-0.6), offset: 0.38 },
            { translate: u(0.6), offset: 0.58 }, { translate: u(-0.2), offset: 0.78 }, { translate: '0px 0px' },
        ], { duration: 720, easing: 'ease-in-out', composite: 'add' });
        scaleAnim(stone.element, [
            { scale: '1' }, { scale: '1.025', offset: 0.18 }, { scale: '0.985', offset: 0.38 },
            { scale: '1.008', offset: 0.58 }, { scale: '1' },
        ], { duration: 720, easing: 'ease-in-out' });
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
            { scale: '1' }, { scale: '1.08', offset: 0.45 }, { scale: '0.97', offset: 0.78 }, { scale: '1' },
        ], { duration: 900, easing: 'ease-in-out' });
        const L = layer(vp, stone.x, stone.y, 1300);
        const ring = el('circle', { r: 12, fill: 'none', stroke: color, 'stroke-width': 1.5, opacity: 0 }, L);
        animate(ring, [{ r: 12, opacity: 0 }, { r: 18, opacity: 0.4, offset: 0.45 }, { r: 23, opacity: 0 }],
            { duration: 1000, easing: 'ease-out', fill: 'both' });
    }

    // ── light drop (water, fire, wind) ───────────────────────────
    // A short drop into place, lighter than earth's, before the element's
    // own effect starts.
    const SOFT = 170;
    function softDrop(stone) {
        const up = upVec(6);
        animate(stone.element, [
            { translate: `${up.x.toFixed(2)}px ${up.y.toFixed(2)}px`, opacity: 0.75 },
            { translate: '0px 0px', opacity: 1 },
        ], { duration: SOFT, easing: 'ease-in', composite: 'add' });
    }
    function nextToVoid(stone) {
        try { return (placedStones || []).some(s => s !== stone && s.type === 'void' && hexDist(s, stone) === 1); } catch (e) { return false; }
    }
    const SOFT_DROP = new Set(['water', 'fire', 'wind']);

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
            if (document.hidden || reduceMotion || !window.fxOn?.() || running >= 6) return;
            const stone = stoneAt(x, y);
            if (!stone || !stone.element || !stone.element.isConnected) return;
            const vp = document.getElementById('viewport'), svg = document.getElementById('boardSvg');
            if (!vp || !svg) return;
            // a water stone always plays the drop of the stone it takes its ability from
            let look = type || stone.type;
            // next to a void stone a stone's ability is cancelled, so it only
            // gets the plain light drop (void itself keeps its summoning)
            if (look !== 'void' && nextToVoid(stone)) {
                running++;
                setTimeout(() => { running--; }, 400);
                softDrop(stone);
                return;
            }
            if (look === 'water') look = window.stoneAbilityAt?.(stone.x, stone.y) || 'water';
            const fn = BY_TYPE[look];
            if (!fn) return;
            running++;
            setTimeout(() => { running--; }, 1400);
            if (SOFT_DROP.has(look)) {
                softDrop(stone);
                setTimeout(() => { if (stone.element.isConnected) fn(stone, svg, vp, colorOf(look)); }, SOFT);
            } else fn(stone, svg, vp, colorOf(look));
        } catch (e) { /* looks only */ }
    }

    // ── shrine collection (owner 2026-10-08) ─────────────────────
    // A pawn ends its turn on a shrine and takes stones from the source pool
    // (game-ui.js replenishShrineStones, only when at least one stone moved):
    // the shrine hex lights up in its element colour and one glowing mote per
    // stone (max 8) rises from the ground and spirals into the pawn, each
    // with a small flash. Other screens and replays: lobby.js 'turn-change'
    // payload.collected.
    // `at` = {x, y} of the shrine (the caller passes it; else the pawn's spot)
    function collect(playerIndex, type, n, at) {
        try {
            if (document.hidden || reduceMotion || !window.fxOn?.() || !(n > 0)) return;
            const pos = (at && Number.isFinite(at.x) && Number.isFinite(at.y)) ? at
                : (typeof playerPositions !== 'undefined') ? playerPositions[playerIndex] : null;
            const vp = document.getElementById('viewport'), svg = document.getElementById('boardSvg');
            if (!pos || !vp || !svg) return;
            const color = colorOf(type);
            const firstPawn = vp.querySelector(':scope > g.player');
            // behind the pawn: the shrine's hex lights up
            const back = el('g', { class: 'stone-drop-fx', transform: `translate(${pos.x} ${pos.y})` });
            if (firstPawn) vp.insertBefore(back, firstPawn); else vp.appendChild(back);
            setTimeout(() => back.remove(), 1800);
            const hex = [0, 1, 2, 3, 4, 5].map(i => {
                const a = Math.PI / 180 * (60 * i - 30);
                return `${(19 * Math.cos(a)).toFixed(1)},${(19 * Math.sin(a)).toFixed(1)}`;
            }).join(' ');
            // plain blending: 'screen' washed it out on the light tiles
            const fill = el('polygon', { points: hex, fill: glowFill(svg, color), opacity: 0 }, back);
            animate(fill, [{ opacity: 0 }, { opacity: 0.85, offset: 0.2 }, { opacity: 0.6, offset: 0.6 }, { opacity: 0 }],
                { duration: 1700, easing: 'ease-out', fill: 'both' });
            const edge = el('polygon', { points: hex, fill: 'none', stroke: '#ffffff', 'stroke-width': 2.4, opacity: 0 }, back);
            animate(edge, [{ opacity: 0 }, { opacity: 1, offset: 0.15 }, { opacity: 0.7, offset: 0.5 }, { opacity: 0 }],
                { duration: 1300, easing: 'ease-out', fill: 'both' });
            // a soft column of light rising through the pawn (screen upright)
            const rot = typeof window.getBoardRotation === 'function' ? window.getBoardRotation() : 0;
            const col = el('g', { transform: `rotate(${-rot})` }, back);
            const beam = el('ellipse', { cx: 0, cy: -20, rx: 12, ry: 32, fill: glowFill(svg, color), opacity: 0 }, col);
            animate(beam, [{ opacity: 0 }, { opacity: 0.75, offset: 0.3 }, { opacity: 0.5, offset: 0.65 }, { opacity: 0 }],
                { duration: 1600, easing: 'ease-out', fill: 'both' });
            // in front: a ring bursts out from the shrine, then motes spiral up
            // into the pawn. Pawns can be re-added on top during the turn
            // change, so keep this layer last for the length of the effect.
            const L = layer(vp, pos.x, pos.y, 2200);
            const keepTop = setInterval(() => { if (!L.isConnected) return clearInterval(keepTop); if (vp.lastElementChild !== L) vp.appendChild(L); }, 60);
            setTimeout(() => clearInterval(keepTop), 2200);
            const burst = el('circle', { r: 14, fill: 'none', stroke: color, 'stroke-width': 5, opacity: 0 }, L);
            animate(burst, [{ r: 14, opacity: 1 }, { r: 62, opacity: 0 }], { duration: 750, easing: 'ease-out', fill: 'both' });
            const burst2 = el('circle', { r: 12, fill: 'none', stroke: '#ffffff', 'stroke-width': 2.5, opacity: 0 }, L);
            animate(burst2, [{ r: 12, opacity: 1 }, { r: 50, opacity: 0 }], { duration: 650, delay: 90, easing: 'ease-out', fill: 'both' });
            const count = Math.min(8, n), top = upVec(16);
            for (let i = 0; i < count; i++) {
                const a0 = (i / count) * Math.PI * 2 + Math.random() * 0.4, delay = 120 + i * 100;
                const frames = [];
                for (let k = 0; k <= 8; k++) {
                    const f = k / 8, rad = 46 * (1 - f), a = a0 + f * Math.PI * 1.6;
                    const x = Math.cos(a) * rad + top.x * f, y = Math.sin(a) * rad * 0.85 + top.y * f;
                    frames.push({ transform: `translate(${x.toFixed(2)}px, ${y.toFixed(2)}px)`,
                        opacity: k === 0 ? 0 : k === 8 ? 0.2 : 1, offset: f });
                }
                const mote = el('circle', { r: 5, fill: '#ffffff', opacity: 0 }, L);
                const halo = el('circle', { r: 15, fill: glowFill(svg, color), opacity: 0 }, L);
                animate(halo, frames, { duration: 850, delay, easing: 'ease-in', fill: 'both' });
                animate(mote, frames, { duration: 850, delay, easing: 'ease-in', fill: 'both' });
                // a small flash at the pawn as it arrives
                const flash = el('circle', { r: 22, fill: glowFill(svg, color), opacity: 0,
                    transform: `translate(${top.x.toFixed(2)} ${top.y.toFixed(2)})` }, L);
                flash.style.mixBlendMode = 'screen';
                animate(flash, [{ opacity: 0 }, { opacity: 0.9, offset: 0.3 }, { opacity: 0 }],
                    { duration: 380, delay: delay + 800, fill: 'both' });
            }
        } catch (e) { /* looks only */ }
    }

    // ── fire burns a stone (owner 2026-10-08) ────────────────────
    // Replaces the old 1.7 s fire sprite (effects-system.js 'fire_effect').
    // game-core.js calls burn(x, y) just before it removes a stone that fire
    // destroyed. A copy of the stone stays for a moment: it flares, chars dark
    // and shrinks away while flame tongues lick up around it (screen upright),
    // with a crackle and rising embers. About 0.75 s.
    let burning = 0;
    function burn(x, y) {
        try {
            if (document.hidden || reduceMotion || !window.fxOn?.()) return false;
            const st = stoneAt(x, y);
            const vp = document.getElementById('viewport'), svg = document.getElementById('boardSvg');
            if (!vp || !svg) return false;
            burning++;
            setTimeout(() => { burning--; }, 760);
            const L = layer(vp, x, y, 1100);
            const rot = typeof window.getBoardRotation === 'function' ? window.getBoardRotation() : 0;
            // the stone itself chars and shrinks
            if (st && st.element && st.element.isConnected) {
                const copy = st.element.cloneNode(true);
                copy.setAttribute('class', 'stone-burn-copy');
                copy.style.pointerEvents = 'none';
                copy.querySelectorAll('.mimicry-indicator, .chain-indicator, .void-nullification-indicator').forEach(n => n.remove());
                vp.insertBefore(copy, L);
                setTimeout(() => copy.remove(), 800);
                animate(copy, [
                    { filter: 'brightness(1)', opacity: 1 },
                    { filter: 'brightness(1.6) saturate(1.3)', opacity: 1, offset: 0.12 },
                    { filter: 'brightness(0.3) saturate(0.5)', opacity: 1, offset: 0.45 },
                    { filter: 'brightness(0.15)', opacity: 0 },
                ], { duration: 720, easing: 'ease-in', fill: 'forwards' });
                scaleAnim(copy, [{ scale: '1' }, { scale: '1.05', offset: 0.15 }, { scale: '0.7' }],
                    { duration: 720, easing: 'ease-in', fill: 'forwards' });
            }
            // fiery glow under it all
            const glow = el('circle', { r: 24, fill: glowFill(svg, '#ff7a1a'), opacity: 0 }, L);
            glow.style.mixBlendMode = 'screen';
            animate(glow, [{ opacity: 0 }, { opacity: 0.95, offset: 0.15 }, { opacity: 0.6, offset: 0.5 }, { opacity: 0 }],
                { duration: 750, easing: 'ease-out', fill: 'both' });
            // flame tongues, pointing up the screen
            const up = el('g', { transform: `rotate(${-rot})` }, L);
            const outer = glowFill(svg, '#ff6a10'), inner = glowFill(svg, '#ffd36b');
            const tongue = (w, h) => `M ${-w} 0 Q ${-w} ${-h * 0.45} 0 ${-h} Q ${w} ${-h * 0.45} ${w} 0 Q 0 ${w * 0.7} ${-w} 0 Z`;
            for (let i = 0; i < 7; i++) {
                const bx = (i - 3) * 3.6 + (Math.random() - 0.5) * 2, by = 4 - Math.abs(i - 3) * 1.6;
                const h = 20 + Math.random() * 12 - Math.abs(i - 3) * 2.5, w = 4.5 + Math.random() * 2;
                // plain blending: 'screen' washed the flames out on the light tiles
                const f = el('path', { d: tongue(w, h), fill: i % 2 ? inner : outer, opacity: 0 }, up);
                const sway = (Math.random() - 0.5) * 6;
                animate(f, [
                    { transform: `translate(${bx}px, ${by}px) scale(0.6, 0.15)`, opacity: 0 },
                    { transform: `translate(${bx}px, ${by}px) scale(1, 1)`, opacity: 0.95, offset: 0.3 },
                    { transform: `translate(${bx + sway * 0.5}px, ${by - 2}px) scale(0.8, 1.2)`, opacity: 0.8, offset: 0.55 },
                    { transform: `translate(${bx + sway}px, ${by - 6}px) scale(0.3, 0.6)`, opacity: 0 },
                ], { duration: 560 + Math.random() * 150, delay: i * 25, easing: 'ease-out', fill: 'both' });
            }
            // crackle, like the fire drop
            for (let i = 0; i < 3; i++) {
                const a = Math.random() * Math.PI * 2;
                const pts = [0, 1, 2, 3].map(j => {
                    const rr = 8 + 3 * j, aa = a + (Math.random() - 0.5) * 0.6;
                    return `${(Math.cos(aa) * rr).toFixed(1)},${(Math.sin(aa) * rr).toFixed(1)}`;
                }).join(' ');
                const z = el('polyline', { points: pts, fill: 'none', stroke: '#ffe2a0', 'stroke-width': 1.2, 'stroke-linecap': 'round', opacity: 0 }, L);
                animate(z, [{ opacity: 0 }, { opacity: 1, offset: 0.2 }, { opacity: 0 }],
                    { duration: 150, delay: 40 + i * 110, fill: 'both' });
            }
            // embers rising
            for (let i = 0; i < 8; i++) {
                const sx = (Math.random() - 0.5) * 18, sy = (Math.random() - 0.5) * 8;
                const rise = 20 + Math.random() * 18, drift = (Math.random() - 0.5) * 12;
                const e = el('circle', { r: 0.8 + Math.random() * 0.9, fill: i % 3 ? '#ffb347' : '#fff1c4', opacity: 0 }, up);
                animate(e, [
                    { transform: `translate(${sx}px, ${sy}px)`, opacity: 0 },
                    { opacity: 1, offset: 0.2 },
                    { transform: `translate(${(sx + drift).toFixed(1)}px, ${(sy - rise).toFixed(1)}px)`, opacity: 0 },
                ], { duration: 550 + Math.random() * 250, delay: 80 + i * 40, easing: 'ease-out', fill: 'both' });
            }
            return true;
        } catch (e) { return false; }
    }

    window.StoneDropFx = { play, collect, burn, isBurning: () => burning > 0 };

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
