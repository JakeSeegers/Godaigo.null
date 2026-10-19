// js/player-tile-art.js
// Player tile art (owner 2026-10-19): the look of every player tile and its
// win-progress display. Looks only: the five "stones" here are not stones,
// they do exactly what the old row of rings did (show which elements the
// player has activated). game-core.js updatePlayerElementSymbols() calls
// render() with the tile's symbols group every time the activated set may
// have changed.
//
// Tile: a deep shade of the player's colour (grid lines darker still, the
// centre hex a little lighter), dark line art in the player's colour (stone
// ring, six-point star, spokes, arcs, frames, knots), a black rosette on the
// centre hex.
// Stones: drawn like real stones (owner: "not flat"): piece-3d.js turns each
// g.pt-bead into a glass bead. Layout (owner's picture): water top-left, fire
// top-right, earth left, wind right, void bottom-right of the centre hex.
// Not won = faint; won = it beams down from above on a column of its colour;
// all five = every stone pulses brighter and the line art lights up.
// Return home: while a player has all five and is not home yet, a soft white
// beam rises from the centre of their tile, fed by coloured light from each
// stone. When the pawn gets there, white crackling energy shoots up the beam
// and carries the pawn up and off screen (ascend(); the win screen waits for
// it, holdMs()). Also a light sweep around the tile at each turn start.
// Only the all-five pulse and the return beam run all the time (a
// never-ending animation makes the whole board redraw every frame), and the
// effects only while window.fxOn().
(function () {
    'use strict';
    const NS = 'http://www.w3.org/2000/svg';
    const S = 20;                                  // TILE_SIZE in game-core.js
    const SQ3 = Math.sqrt(3);
    const SPOTS = { water: [0, -1], fire: [1, -1], earth: [-1, 0], wind: [1, 0], void: [0, 1] };
    const ORDER = ['earth', 'water', 'fire', 'wind', 'void'];
    const R_STONE = 10;
    const BEAM_H = 300;                            // beam height, board units up the screen
    const reduceMotion = () => !!window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;

    const px = (q, r) => ({ x: S * SQ3 * (q + r / 2), y: S * 1.5 * r });
    const el = (tag, attrs, parent) => {
        const n = document.createElementNS(NS, tag);
        for (const k in attrs) n.setAttribute(k, attrs[k]);
        if (parent) parent.appendChild(n);
        return n;
    };
    const rgb = (hex) => {
        const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
        const v = m ? parseInt(m[1], 16) : 0x888888;
        return [v >> 16 & 255, v >> 8 & 255, v & 255];
    };
    const mix = (hex, k, to = 0) => {           // k = share of the colour, rest = black (to 0) or white (to 255)
        const c = rgb(hex).map(v => Math.round(v * k + to * (1 - k)));
        return '#' + c.map(v => v.toString(16).padStart(2, '0')).join('');
    };
    const pt = (r, deg) => { const a = deg * Math.PI / 180; return [r * Math.cos(a), r * Math.sin(a)]; };
    const fmt = (p) => `${p[0].toFixed(2)},${p[1].toFixed(2)}`;
    const hexPoints = (cx, cy, r, rot = -Math.PI / 6) => {
        const p = [];
        for (let i = 0; i < 6; i++) { const a = rot + i * Math.PI / 3; p.push(`${(cx + r * Math.cos(a)).toFixed(2)},${(cy + r * Math.sin(a)).toFixed(2)}`); }
        return p.join(' ');
    };
    const fxOk = () => !reduceMotion() && !document.hidden && !!window.fxOn?.() && !window.SaveGame?.isRebuilding?.();
    const types = () => window.STONE_TYPES || {};
    const boardRot = () => (typeof window.getBoardRotation === 'function' ? window.getBoardRotation() : 0);
    // "up" on screen in board units, whatever the map rotation (as piece-3d.js)
    const upVec = (len) => { const r = boardRot() * Math.PI / 180; return { x: -len * Math.sin(r), y: -len * Math.cos(r) }; };
    // a board-space offset seen in the screen-upright frame rotate(-rot)
    const toUpright = (x, y) => { const r = boardRot() * Math.PI / 180, c = Math.cos(r), s = Math.sin(r); return { x: x * c - y * s, y: x * s + y * c }; };

    function ensureDefs() {
        const svg = document.getElementById('boardSvg');
        if (!svg || document.getElementById('pt-glow-earth')) return;
        let defs = svg.querySelector(':scope > defs');
        if (!defs) { defs = el('defs', {}); svg.insertBefore(defs, svg.firstChild); }
        const T = types();
        ORDER.forEach(e => {
            const c = T[e]?.color || '#ffffff';
            const g = el('radialGradient', { id: `pt-glow-${e}` }, defs);
            el('stop', { offset: '0%', 'stop-color': mix(c, 0.6, 255), 'stop-opacity': '0.95' }, g);
            el('stop', { offset: '45%', 'stop-color': c, 'stop-opacity': '0.6' }, g);
            el('stop', { offset: '100%', 'stop-color': c, 'stop-opacity': '0' }, g);
            // the column a stone beams down on: clear at the top, its colour at the bottom
            const v = el('linearGradient', { id: `pt-col-${e}`, x1: 0, y1: 0, x2: 0, y2: 1 }, defs);
            el('stop', { offset: '0%', 'stop-color': c, 'stop-opacity': '0' }, v);
            el('stop', { offset: '70%', 'stop-color': mix(c, 0.7, 255), 'stop-opacity': '0.55' }, v);
            el('stop', { offset: '100%', 'stop-color': '#ffffff', 'stop-opacity': '0.8' }, v);
        });
        const b = el('linearGradient', { id: 'pt-beam', x1: 0, y1: 0, x2: 0, y2: 1 }, defs);
        el('stop', { offset: '0%', 'stop-color': '#ffffff', 'stop-opacity': '0' }, b);
        el('stop', { offset: '35%', 'stop-color': '#f4f8ff', 'stop-opacity': '0.3' }, b);
        el('stop', { offset: '100%', 'stop-color': '#ffffff', 'stop-opacity': '0.75' }, b);
        const base = el('radialGradient', { id: 'pt-beam-base' }, defs);
        el('stop', { offset: '0%', 'stop-color': '#ffffff', 'stop-opacity': '0.8' }, base);
        el('stop', { offset: '100%', 'stop-color': '#ffffff', 'stop-opacity': '0' }, base);
    }

    // Top layer for effects that reach past their own tile (columns, beams).
    function fxLayer() {
        const vp = document.getElementById('viewport');
        if (!vp) return null;
        let L = vp.querySelector(':scope > g.pt-fx-layer');
        if (!L) L = el('g', { class: 'pt-fx-layer', 'pointer-events': 'none' });
        // over every tile and stone, under the pawns (tiles revealed later are
        // added at the end, so the place is checked every time)
        const pawn = vp.querySelector(':scope > g.player');
        if (pawn) { if (L.nextSibling !== pawn) vp.insertBefore(L, pawn); }
        else if (L.parentNode !== vp || vp.lastChild !== L) vp.appendChild(L);
        return L;
    }
    const tileOf = (group) => group.closest('g.placed-tile');
    const tilePos = (tileEl) => {
        const m = /translate\(\s*([-\d.e]+)[ ,]+([-\d.e]+)/.exec(tileEl?.getAttribute('transform') || '');
        return m ? { x: +m[1], y: +m[2] } : { x: 0, y: 0 };
    };

    // Built once per tile: tile colours, line art, centre rosette, five stones.
    function build(group, color) {
        group.textContent = '';
        group.setAttribute('pointer-events', 'none');
        const line = mix(color, 0.17);
        group.style.setProperty('--pt-line', line);
        group.style.setProperty('--pt-lit', mix(color, 0.75, 255));
        const tile = tileOf(group);
        if (tile) {
            tile.style.setProperty('--pt-bg', mix(color, 0.36));
            tile.style.setProperty('--pt-bg2', mix(color, 0.5));
            tile.style.setProperty('--pt-grid', mix(color, 0.12));
        }

        const art = el('g', { class: 'pt-art' }, group);
        const R1 = S * SQ3, R2 = 60;               // stone hexes (34.6), outer hexes (60)
        const L = (cls, tag, a) => el(tag, Object.assign({ class: 'pt-line ' + cls }, a), art);
        // circles and the stone ring
        L('pt-thin', 'circle', { r: 24.5 });
        L('pt-trace', 'polygon', { points: hexPoints(0, 0, R1, 0) });
        L('pt-thin', 'polygon', { points: hexPoints(0, 0, R1 + 4, 0) });
        L('pt-thin pt-dots', 'circle', { r: 47 });
        L('pt-thin pt-dash', 'circle', { r: 66 });
        // two stars: through the outer hexes, and a smaller one turned between them
        const tri = (r, off) => [0, 1, 2].map(i => fmt(pt(r, off + i * 120))).join(' ');
        L('pt-trace', 'polygon', { points: tri(R2, -30) });
        L('pt-trace', 'polygon', { points: tri(R2, 30) });
        L('pt-thin', 'polygon', { points: tri(50, 0) });
        L('pt-thin', 'polygon', { points: tri(50, 60) });
        // spokes: between the stones toward the outer knots, and past each stone to the edge
        for (let i = 0; i < 6; i++) {
            const a = i * 60 - 30;
            L('pt-thin', 'line', { x1: pt(22, a)[0], y1: pt(22, a)[1], x2: pt(R2 - 6, a)[0], y2: pt(R2 - 6, a)[1] });
            const b = i * 60;
            L('pt-thin', 'line', { x1: pt(R1 + 12, b)[0], y1: pt(R1 + 12, b)[1], x2: pt(64, b)[0], y2: pt(64, b)[1] });
            // a small diamond near the edge past each stone
            const d = pt(58, b), dn = pt(3.4, b + 90), dl = pt(4.6, b);
            L('', 'polygon', { points: [fmt([d[0] - dl[0], d[1] - dl[1]]), fmt([d[0] + dn[0], d[1] + dn[1]]), fmt([d[0] + dl[0], d[1] + dl[1]]), fmt([d[0] - dn[0], d[1] - dn[1]])].join(' ') });
            // an arc between two neighbouring stone hexes, bowed outward
            const p1 = pt(R1, b), p2 = pt(R1, b + 60), c = pt(R1 * 1.35, b + 30);
            L('pt-thin', 'path', { d: `M ${fmt(p1)} Q ${fmt(c)} ${fmt(p2)}` });
            // the outer knot: ring, little hexagon, three petals
            const k = pt(R2, a);
            L('', 'circle', { cx: k[0].toFixed(2), cy: k[1].toFixed(2), r: 5.4 });
            L('pt-thin', 'polygon', { points: hexPoints(k[0], k[1], 3.3, a * Math.PI / 180) });
            for (let j = 0; j < 3; j++) {
                const q = pt(8.4, a + j * 120);
                L('pt-thin', 'circle', { cx: (k[0] + q[0]).toFixed(2), cy: (k[1] + q[1]).toFixed(2), r: 2.6 });
            }
        }

        // centre rosette: black lines on the centre hex
        const c = el('g', { class: 'pt-centre' }, group);
        const ink = (cls, tag, a) => el(tag, Object.assign({ class: 'pt-ink ' + cls }, a), c);
        ink('', 'polygon', { points: hexPoints(0, 0, S - 2.5) });
        ink('pt-fine', 'polygon', { points: hexPoints(0, 0, S - 4.2) });
        ink('', 'polygon', { points: tri(15, -90) });
        ink('', 'polygon', { points: tri(15, 90) });
        ink('', 'circle', { r: 9.6 });
        for (let i = 0; i < 6; i++) {               // six petals and the rays between them
            const p = pt(4.8, i * 60 - 90);
            ink('pt-fine', 'circle', { cx: p[0].toFixed(2), cy: p[1].toFixed(2), r: 4.8 });
            const r0 = pt(9.6, i * 60 - 60), r1 = pt(15.5, i * 60 - 60);
            ink('pt-fine', 'line', { x1: r0[0], y1: r0[1], x2: r1[0], y2: r1[1] });
        }
        ink('', 'circle', { r: 2.2 });
        ink('pt-fine pt-dash', 'circle', { r: 12.6 });

        // the five stones
        const T = types();
        ORDER.forEach(e => {
            const p = px(...SPOTS[e]);
            const o = el('g', { class: `pt-stone pt-${e}`, 'data-el': e, 'data-x': p.x.toFixed(2), 'data-y': p.y.toFixed(2),
                transform: `translate(${p.x.toFixed(2)}, ${p.y.toFixed(2)})` }, group);
            // a frame around the stone hex
            el('polygon', { class: 'pt-line pt-thin', points: hexPoints(0, 0, 15.5) }, o);
            const st = el('g', { class: 'pt-body' }, o);
            el('circle', { class: 'pt-glow', r: 22, fill: `url(#pt-glow-${e})` }, st);
            el('circle', { class: 'pt-socket', r: R_STONE + 1.6, stroke: mix(color, 0.5) }, st);
            // drawn like a real stone (circle.stone-piece + image), so piece-3d.js
            // makes it a glass bead (g.pt-bead); flat when 3D pieces are off
            const col = T[e]?.color || '#888';
            const bead = el('g', { class: 'pt-bead' }, st);
            el('circle', { class: 'stone-piece', r: R_STONE, fill: mix(col, 0.55), stroke: col, 'stroke-width': 1.5 }, bead);
            if (T[e]?.img) el('image', { href: T[e].img, x: -R_STONE, y: -R_STONE, width: R_STONE * 2, height: R_STONE * 2 }, bead);
            el('circle', { class: 'pt-flash', r: R_STONE }, st);
        });
        group.dataset.ptBuilt = color;
    }

    // ---- one-off effects (Web Animations) ----
    // A newly won stone beams down: a copy falls from above the tile on a
    // column of its colour (in the top layer, so no other tile covers it),
    // then lands with a flash, a ring and sparks.
    function beamDown(group, e) {
        const o = group.querySelector(`.pt-stone.pt-${e}`);
        const tile = tileOf(group), layer = fxLayer();
        if (!o || !tile || !layer) return;
        const col = types()[e]?.color || '#fff';
        const tp = tilePos(tile), x = +o.dataset.x, y = +o.dataset.y;
        const wx = tp.x + x, wy = tp.y + y;
        const H = 90, FALL = 520, up = upVec(H);
        const bead = o.querySelector('.pt-bead');
        // the column, upright on screen
        const colG = el('g', { transform: `translate(${wx.toFixed(2)}, ${wy.toFixed(2)}) rotate(${-boardRot()})` }, layer);
        const rect = el('rect', { x: -R_STONE * 0.95, y: -H - 20, width: R_STONE * 1.9, height: H + 20, rx: R_STONE * 0.9, fill: `url(#pt-col-${e})` }, colG);
        rect.style.transformBox = 'view-box'; rect.style.transformOrigin = '0px 0px';
        rect.animate([{ opacity: 0, scale: '0.3 1' }, { opacity: 1, scale: '1 1', offset: 0.3 }, { opacity: 0.9, scale: '1 1', offset: 0.75 }, { opacity: 0, scale: '0.2 1' }],
            { duration: FALL + 420, easing: 'ease-out', fill: 'forwards' });
        // the falling copy
        if (bead) {
            const fall = el('g', { transform: `translate(${wx.toFixed(2)}, ${wy.toFixed(2)})` }, layer);
            const copy = bead.cloneNode(true);
            fall.appendChild(copy);
            bead.style.opacity = '0';
            copy.animate([{ translate: `${up.x.toFixed(1)}px ${up.y.toFixed(1)}px`, opacity: 0 }, { opacity: 1, offset: 0.25 },
                { translate: '0px 0px', opacity: 1 }], { duration: FALL, easing: 'cubic-bezier(0.5, 0, 0.9, 0.6)', fill: 'forwards' });
            setTimeout(() => { bead.style.opacity = ''; fall.remove(); }, FALL);
        }
        setTimeout(() => colG.remove(), FALL + 500);
        // landing
        o.querySelector('.pt-flash')?.animate([{ opacity: 0.95 }, { opacity: 0 }], { duration: 600, delay: FALL - 20, easing: 'ease-out', fill: 'backwards' });
        const body = o.querySelector('.pt-body');
        body.style.transformBox = 'view-box'; body.style.transformOrigin = '0px 0px';
        body.animate([{ scale: '1' }, { scale: '1.18', offset: 0.35 }, { scale: '1' }], { duration: 380, delay: FALL - 20, easing: 'ease-out' });
        const fx = el('g', { class: 'pt-fx' }, o);
        const ring = el('circle', { r: R_STONE, fill: 'none', stroke: col, 'stroke-width': 1.6 }, fx);
        ring.style.transformBox = 'view-box'; ring.style.transformOrigin = '0px 0px';
        ring.animate([{ scale: '1', opacity: 1 }, { scale: '3.2', opacity: 0 }], { duration: 700, delay: FALL, easing: 'ease-out', fill: 'backwards' });
        for (let i = 0; i < 8; i++) {               // sparks
            const a = i * Math.PI / 4 + 0.2;
            const s = el('line', { x1: 0, y1: 0, x2: (4 * Math.cos(a)).toFixed(2), y2: (4 * Math.sin(a)).toFixed(2), stroke: mix(col, 0.6, 255), 'stroke-width': 1.1, 'stroke-linecap': 'round' }, fx);
            s.animate([{ translate: `${(9 * Math.cos(a)).toFixed(1)}px ${(9 * Math.sin(a)).toFixed(1)}px`, opacity: 1 },
                { translate: `${(22 * Math.cos(a)).toFixed(1)}px ${(22 * Math.sin(a)).toFixed(1)}px`, opacity: 0 }],
                { duration: 600, delay: FALL + 40, easing: 'ease-out', fill: 'backwards' });
        }
        // a mote of light runs from the stone into the centre
        const mote = el('circle', { r: 2.4, fill: mix(col, 0.5, 255) }, group);
        mote.animate([{ translate: `${x}px ${y}px`, opacity: 0 }, { translate: `${x * 0.6}px ${y * 0.6}px`, opacity: 1, offset: 0.3 }, { translate: '0px 0px', opacity: 0 }],
            { duration: 700, delay: FALL + 350, easing: 'ease-in', fill: 'backwards' });
        group.querySelector('.pt-centre')?.animate([{ opacity: 1 }, { opacity: 0.35, offset: 0.4 }, { opacity: 1 }], { duration: 600, delay: FALL + 950 });
        setTimeout(() => { fx.remove(); mote.remove(); }, FALL + 1700);
    }

    function completeBurst(group) {
        ORDER.forEach((e, i) => {
            group.querySelector(`.pt-stone.pt-${e} .pt-flash`)?.animate([{ opacity: 0 }, { opacity: 1 }, { opacity: 0 }],
                { duration: 700, delay: 1100 + i * 140 });
        });
        const fx = el('g', { class: 'pt-fx' }, group);
        const col = group.style.getPropertyValue('--pt-lit') || '#fff';
        for (let k = 0; k < 2; k++) {
            const w = el('circle', { r: 10, fill: 'none', stroke: col, 'stroke-width': 2.2 - k }, fx);
            w.style.transformBox = 'view-box'; w.style.transformOrigin = '0px 0px';
            w.animate([{ scale: '1', opacity: 0.9 }, { scale: '7.5', opacity: 0 }], { duration: 1200, delay: 1800 + k * 260, easing: 'ease-out', fill: 'backwards' });
        }
        group.querySelectorAll('.pt-art .pt-trace').forEach(t => {
            const len = (t.getTotalLength?.() || 300);
            t.animate([{ strokeDasharray: `0 ${len}`, stroke: col, opacity: 1 }, { strokeDasharray: `${len} 0`, stroke: col, opacity: 1 }],
                { duration: 1100, delay: 1700, easing: 'ease-in-out' });
        });
        setTimeout(() => fx.remove(), 3400);
    }

    // a short dash of light runs once around the stone ring and the stars
    function sweep(group) {
        const col = group.style.getPropertyValue('--pt-lit') || '#fff';
        group.querySelectorAll('.pt-art .pt-trace').forEach((t, i) => {
            const len = (t.getTotalLength?.() || 300), dash = 22;
            t.animate([{ stroke: col, strokeDasharray: `${dash} ${len}`, strokeDashoffset: dash, opacity: 1, strokeWidth: 1.4 },
                { stroke: col, strokeDasharray: `${dash} ${len}`, strokeDashoffset: -len, opacity: 1, strokeWidth: 1.4 }],
                { duration: 1500, delay: i * 120, easing: 'ease-in-out' });
        });
    }

    // ---- the return beam ----
    const beams = new Map();                       // seat -> { g, tile, rot }
    function placeBeam(b) {
        const tp = tilePos(b.tile);
        b.g.setAttribute('transform', `translate(${tp.x.toFixed(2)}, ${tp.y.toFixed(2)}) rotate(${-boardRot()})`);
        b.rot = boardRot();
    }
    function makeBeam(seat, tile) {
        const layer = fxLayer();
        if (!layer) return null;
        const g = el('g', { class: 'pt-beam', 'data-seat': seat }, layer);
        el('ellipse', { class: 'pt-beam-base', rx: 26, ry: 11, fill: 'url(#pt-beam-base)' }, g);
        el('rect', { class: 'pt-beam-soft', x: -15, y: -BEAM_H, width: 30, height: BEAM_H, rx: 15, fill: 'url(#pt-beam)' }, g);
        el('rect', { class: 'pt-beam-core', x: -4.5, y: -BEAM_H, width: 9, height: BEAM_H, rx: 4.5, fill: 'url(#pt-beam)' }, g);
        const motes = el('g', { class: 'pt-beam-motes' }, g);
        const b = { g, tile, motes, rot: null };
        placeBeam(b);
        addMotes(b);
        return b;
    }
    // coloured light from each won stone flows into the centre and up the beam
    function addMotes(b) {
        b.motes.textContent = '';
        if (!fxOk()) return;
        const T = types();
        ORDER.forEach((e, i) => {
            const p = px(...SPOTS[e]), u = toUpright(p.x, p.y);
            for (let k = 0; k < 2; k++) {
                const m = el('circle', { r: 1.9, fill: mix(T[e]?.color || '#fff', 0.7, 255) }, b.motes);
                m.animate([{ translate: `${u.x.toFixed(1)}px ${u.y.toFixed(1)}px`, opacity: 0 },
                    { translate: `${(u.x * 0.5).toFixed(1)}px ${(u.y * 0.5).toFixed(1)}px`, opacity: 0.9, offset: 0.25 },
                    { translate: '0px 0px', opacity: 1, offset: 0.5 },
                    { translate: `0px ${-BEAM_H * 0.45}px`, opacity: 0 }],
                    { duration: 2800, delay: i * 560 + k * 1400, iterations: Infinity, easing: 'linear' });
            }
        });
    }
    function dropBeam(seat) {
        const b = beams.get(seat);
        if (!b || b.ascending) return;
        b.g.remove();
        beams.delete(seat);
    }
    function gameOverShown() { return !!document.querySelector('.game-over-overlay'); }
    function tickBeams() {
        if (typeof placedTiles === 'undefined' || !Array.isArray(placedTiles)) return;
        const show = !!window.fxOn?.() || !window.BotArena?.isRunning?.();
        const want = new Map();
        if (show && !gameOverShown()) {
            for (const t of placedTiles) {
                if (!t || !t.isPlayerTile || !t.element?.isConnected) continue;
                const won = t.element.querySelector('.player-tile-element-symbols')?.dataset.ptWon || '';
                if (won.split(',').filter(Boolean).length === ORDER.length) want.set(t.playerIndex, t.element);
            }
        }
        if (beams.size || want.size) fxLayer();
        for (const seat of [...beams.keys()]) {
            const b = beams.get(seat);
            if (!b.ascending && (want.get(seat) !== b.tile || !b.g.isConnected)) dropBeam(seat);
        }
        want.forEach((tile, seat) => {
            if (!beams.has(seat)) { const b = makeBeam(seat, tile); if (b) beams.set(seat, b); return; }
            const b = beams.get(seat);
            if (b.rot !== boardRot()) { placeBeam(b); if (!b.ascending) addMotes(b); }
        });
    }

    // ---- the win: white crackling energy carries the pawn up and away ----
    let holdUntil = 0;
    const ascended = new WeakSet();
    function ascend(seat) {
        try {
            if (!fxOk() || typeof placedTiles === 'undefined') return;
            const t = placedTiles.find(t => t && t.isPlayerTile && t.playerIndex === seat);
            if (!t?.element || ascended.has(t.element)) return;
            ascended.add(t.element);
            ensureDefs();
            let b = beams.get(seat);
            if (!b || !b.g.isConnected) { b = makeBeam(seat, t.element); if (!b) return; beams.set(seat, b); }
            b.ascending = true;
            const START = 350, BOLTS = 1500, RISE = 1300, END = START + 2000;
            holdUntil = performance.now() + END + 250;
            const g = b.g;
            // the beam flares
            g.querySelectorAll('.pt-beam-soft, .pt-beam-core, .pt-beam-base').forEach(n => {
                n.style.transformBox = 'view-box'; n.style.transformOrigin = '0px 0px';
                n.animate([{ scale: '1 1', opacity: 1 }, { scale: '2.4 1', opacity: 1, offset: 0.2 }, { scale: '2 1', opacity: 1, offset: 0.75 }, { scale: '0.2 1', opacity: 0 }],
                    { duration: END - START, delay: START, fill: 'forwards', easing: 'ease-out' });
            });
            // a flash ring at the base
            const ring = el('circle', { r: 10, fill: 'none', stroke: '#fff', 'stroke-width': 2.4 }, g);
            ring.style.transformBox = 'view-box'; ring.style.transformOrigin = '0px 0px';
            ring.animate([{ scale: '0.6 0.3', opacity: 1 }, { scale: '5 2.2', opacity: 0 }], { duration: 800, delay: START + 150, easing: 'ease-out', fill: 'backwards' });
            // crackling bolts, re-jagged every frame (as the cast effect)
            const bolts = [];
            for (let i = 0; i < 5; i++) {
                const glow = el('polyline', { fill: 'none', stroke: '#fff', 'stroke-width': 4.5, 'stroke-opacity': 0.22, 'stroke-linejoin': 'round' }, g);
                const core = el('polyline', { fill: 'none', stroke: '#fff', 'stroke-width': i ? 1 : 1.6, 'stroke-linejoin': 'round' }, g);
                bolts.push({ glow, core, side: (i - 2) * 3 });
            }
            const t0 = performance.now() + START;
            const jag = (side, k) => {
                const n = 18, pts = [];
                for (let j = 0; j <= n; j++) {
                    const f = j / n, yy = -BEAM_H * f * Math.min(1, k * 1.6);
                    const amp = (3 + 9 * Math.sin(Math.PI * f)) * (0.6 + 0.4 * Math.random());
                    pts.push(`${(side * (1 - f) + (Math.random() * 2 - 1) * amp).toFixed(1)},${yy.toFixed(1)}`);
                }
                return pts.join(' ');
            };
            const frame = (now) => {
                const k = (now - t0) / BOLTS;
                if (k < 0) { requestAnimationFrame(frame); return; }
                if (k >= 1 || !g.isConnected) { bolts.forEach(x => { x.glow.remove(); x.core.remove(); }); return; }
                const fade = k < 0.8 ? 1 : (1 - k) / 0.2;
                bolts.forEach((x, i) => {
                    const on = Math.random() < 0.85;
                    const p = jag(x.side, k + i * 0.05);
                    x.glow.setAttribute('points', p); x.core.setAttribute('points', p);
                    x.core.setAttribute('stroke-opacity', on ? (0.9 * fade).toFixed(2) : '0.15');
                    x.glow.setAttribute('stroke-opacity', on ? (0.25 * fade).toFixed(2) : '0.05');
                });
                requestAnimationFrame(frame);
            };
            requestAnimationFrame(frame);
            // the pawn is carried up and off screen
            const pawn = (typeof playerPositions !== 'undefined' ? playerPositions[seat] : null)?.element;
            if (pawn?.animate) {
                const m = /translate\(\s*([-\d.e]+)[ ,]+([-\d.e]+)/.exec(pawn.getAttribute('transform') || '');
                pawn.style.transformBox = 'view-box';
                if (m) pawn.style.transformOrigin = `${m[1]}px ${m[2]}px`;
                const u1 = upVec(18), u2 = upVec(520);
                pawn.animate([{ translate: '0px 0px', scale: '1', opacity: 1 },
                    { translate: `${u1.x.toFixed(1)}px ${u1.y.toFixed(1)}px`, scale: '1.08', opacity: 1, offset: 0.25 },
                    { translate: `${(u2.x * 0.55).toFixed(1)}px ${(u2.y * 0.55).toFixed(1)}px`, scale: '1.25', opacity: 1, offset: 0.75 },
                    { translate: `${u2.x.toFixed(1)}px ${u2.y.toFixed(1)}px`, scale: '1.35', opacity: 0 }],
                    { duration: RISE, delay: START + 300, easing: 'ease-in', fill: 'forwards' });
            }
            setTimeout(() => { b.ascending = false; dropBeam(seat); }, END + 200);
        } catch (e) { console.warn('[PlayerTileArt] ascend failed', e); }
    }
    // how long the win screen should wait so the lift-off can be seen
    const holdMs = () => Math.max(0, holdUntil - performance.now());

    // render(group, activatedSet, color): called by game-core.js
    function render(group, activated, color) {
        if (!group) return;
        ensureDefs();
        if (group.dataset.ptBuilt !== color) build(group, color);
        const had = group.dataset.ptWon;           // undefined on the first draw: no effects then
        const before = new Set(had ? had.split(',').filter(Boolean) : []);
        const now = ORDER.filter(e => activated && activated.has(e));
        ORDER.forEach(e => group.querySelector(`.pt-stone.pt-${e}`)?.classList.toggle('on', now.includes(e)));
        const complete = now.length === ORDER.length;
        group.classList.toggle('pt-complete', complete);
        group.classList.toggle('pt-anim', complete && !!window.fxOn?.() && !reduceMotion());
        group.dataset.ptWon = now.join(',');
        if (had === undefined || !fxOk()) return;
        now.filter(e => !before.has(e)).forEach((e, i) => setTimeout(() => { try { beamDown(group, e); } catch (_) {} }, i * 200));
        if (complete && before.size < ORDER.length) setTimeout(() => { try { completeBurst(group); } catch (_) {} }, 200);
    }

    // Map turned: the stones turn with the board like real stones
    // (piece-3d.js keeps each bead's shading facing the screen); beams follow
    // on the next tick.
    function level() {}

    // Turn start sweep + return beams.
    let lastTurnKey = null;
    setInterval(() => {
        try { tickBeams(); } catch (_) {}
        if (typeof activePlayerIndex === 'undefined' || typeof placedTiles === 'undefined') return;
        const key = (typeof currentTurnNumber !== 'undefined' ? currentTurnNumber : '') + ':' + activePlayerIndex;
        if (key === lastTurnKey) return;
        const first = lastTurnKey === null;
        lastTurnKey = key;
        if (first || !fxOk()) return;
        const t = placedTiles.find(t => t && t.isPlayerTile && t.playerIndex === activePlayerIndex);
        const g = t?.element?.querySelector('.player-tile-element-symbols');
        if (g && g.dataset.ptBuilt) { try { sweep(g); } catch (_) {} }
    }, 300);

    window.PlayerTileArt = { render, level, ascend, holdMs, _beamDown: beamDown, _complete: completeBurst, _sweep: sweep };
})();
