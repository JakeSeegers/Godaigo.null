// js/player-tile-art.js
// Player tile art (owner 2026-10-19): the look of every player tile and its
// win-progress display. Looks only: the five "stones" here are not stones,
// they do exactly what the old row of rings did (show which elements the
// player has activated). game-core.js updatePlayerElementSymbols() calls
// render() with the tile's symbols group every time the activated set may
// have changed.
//
// Drawn like real stones (owner: "not flat"): piece-3d.js turns each g.pt-bead
// into a glass bead.
// Layout (owner's picture): water top-left, fire top-right, earth left,
// wind right, void bottom-right of the centre hex. Not won = a faint inlay;
// first activation = it turns solid with a burst. All five won = every stone
// pulses brighter and the line art lights up.
// Line art in a darker shade of the player's colour (ring through the stone
// hexes, six-point star through the outer hexes, knots on them), a black-line
// rosette on the centre hex. Short effects: a light runs around the tile when
// its player's turn starts, and one big burst when the fifth element is won.
// Only the all-five pulse runs all the time (a never-ending animation makes
// the whole board redraw every frame), and only while window.fxOn().
(function () {
    'use strict';
    const NS = 'http://www.w3.org/2000/svg';
    const S = 20;                                  // TILE_SIZE in game-core.js
    const SQ3 = Math.sqrt(3);
    const SPOTS = { water: [0, -1], fire: [1, -1], earth: [-1, 0], wind: [1, 0], void: [0, 1] };
    const ORDER = ['earth', 'water', 'fire', 'wind', 'void'];
    const R_STONE = 10;
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
    const hexPoints = (cx, cy, r, rot = -Math.PI / 6) => {
        const p = [];
        for (let i = 0; i < 6; i++) { const a = rot + i * Math.PI / 3; p.push(`${(cx + r * Math.cos(a)).toFixed(2)},${(cy + r * Math.sin(a)).toFixed(2)}`); }
        return p.join(' ');
    };
    const fxOk = () => !reduceMotion() && !document.hidden && !!window.fxOn?.() && !window.SaveGame?.isRebuilding?.();
    const types = () => window.STONE_TYPES || {};

    // Shared glow gradients, one per element, in the board's own <defs>.
    function ensureDefs() {
        const svg = document.getElementById('boardSvg');
        if (!svg || document.getElementById('pt-glow-earth')) return;
        let defs = svg.querySelector(':scope > defs');
        if (!defs) defs = el('defs', {}, null), svg.insertBefore(defs, svg.firstChild);
        const T = types();
        ORDER.forEach(e => {
            const c = T[e]?.color || '#ffffff';
            const g = el('radialGradient', { id: `pt-glow-${e}` }, defs);
            el('stop', { offset: '0%', 'stop-color': mix(c, 0.6, 255), 'stop-opacity': '0.95' }, g);
            el('stop', { offset: '45%', 'stop-color': c, 'stop-opacity': '0.6' }, g);
            el('stop', { offset: '100%', 'stop-color': c, 'stop-opacity': '0' }, g);
        });
    }

    // Built once per tile: line art, centre rosette, five stones.
    function build(group, color) {
        group.textContent = '';
        group.setAttribute('pointer-events', 'none');
        const line = mix(color, 0.5);
        group.style.setProperty('--pt-line', line);
        group.style.setProperty('--pt-lit', mix(color, 0.75, 255));

        // line art (under the stones)
        const art = el('g', { class: 'pt-art' }, group);
        const ring1 = 2 * S * SQ3 / 2 * 1;          // distance to the stone hexes (34.6)
        el('polygon', { class: 'pt-line pt-trace', points: hexPoints(0, 0, ring1, 0) }, art);
        el('polygon', { class: 'pt-line pt-thin', points: hexPoints(0, 0, ring1 + 4, 0) }, art);
        // six-point star through the outer hexes (60 from the centre, at -30 + 60k degrees)
        const R2 = 60, star = (off) => [0, 1, 2].map(i => { const a = (off + i * 120 - 30) * Math.PI / 180; return `${(R2 * Math.cos(a)).toFixed(2)},${(R2 * Math.sin(a)).toFixed(2)}`; }).join(' ');
        el('polygon', { class: 'pt-line pt-trace', points: star(0) }, art);
        el('polygon', { class: 'pt-line pt-trace', points: star(60) }, art);
        // a small knot on each outer hex
        for (let i = 0; i < 6; i++) {
            const a = (i * 60 - 30) * Math.PI / 180, x = R2 * Math.cos(a), y = R2 * Math.sin(a);
            el('circle', { class: 'pt-line', cx: x.toFixed(2), cy: y.toFixed(2), r: 5.2 }, art);
            el('polygon', { class: 'pt-line pt-thin', points: hexPoints(x, y, 3.2, a) }, art);
        }

        // centre rosette: black lines on the centre hex
        const c = el('g', { class: 'pt-centre' }, group);
        el('polygon', { class: 'pt-ink', points: hexPoints(0, 0, S - 2.5) }, c);
        const tri = (off, r) => [0, 1, 2].map(i => { const a = (off + i * 120) * Math.PI / 180; return `${(r * Math.cos(a)).toFixed(2)},${(r * Math.sin(a)).toFixed(2)}`; }).join(' ');
        el('polygon', { class: 'pt-ink', points: tri(-90, 15) }, c);
        el('polygon', { class: 'pt-ink', points: tri(90, 15) }, c);
        el('circle', { class: 'pt-ink', r: 9.6 }, c);
        for (let i = 0; i < 6; i++) {           // six petals
            const a = (i * 60 - 90) * Math.PI / 180;
            el('circle', { class: 'pt-ink pt-fine', cx: (4.8 * Math.cos(a)).toFixed(2), cy: (4.8 * Math.sin(a)).toFixed(2), r: 4.8 }, c);
        }
        el('circle', { class: 'pt-ink', r: 2.2 }, c);
        el('circle', { class: 'pt-ink pt-fine pt-dash', r: 12.6 }, c);

        // the five stones
        const T = types();
        ORDER.forEach(e => {
            const p = px(...SPOTS[e]);
            const o = el('g', { class: `pt-stone pt-${e}`, 'data-el': e, 'data-x': p.x.toFixed(2), 'data-y': p.y.toFixed(2),
                transform: `translate(${p.x.toFixed(2)}, ${p.y.toFixed(2)})` }, group);
            const st = el('g', { class: 'pt-body' }, o);
            el('circle', { class: 'pt-glow', r: 22, fill: `url(#pt-glow-${e})` }, st);
            el('circle', { class: 'pt-socket', r: R_STONE + 1.6, stroke: line }, st);
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
    function burst(group, e) {
        const o = group.querySelector(`.pt-stone.pt-${e}`);
        if (!o) return;
        const body = o.querySelector('.pt-body');
        const col = types()[e]?.color || '#fff';
        body.style.transformBox = 'view-box'; body.style.transformOrigin = '0px 0px';
        body.animate([{ scale: '1.9', opacity: 0 }, { scale: '0.85', opacity: 1, offset: 0.55 }, { scale: '1.08', offset: 0.8 }, { scale: '1', opacity: 1 }],
            { duration: 700, easing: 'ease-out' });
        o.querySelector('.pt-flash')?.animate([{ opacity: 0.95 }, { opacity: 0 }], { duration: 650, delay: 300, easing: 'ease-out', fill: 'backwards' });
        const fx = el('g', { class: 'pt-fx' }, o);
        const ring = el('circle', { r: R_STONE, fill: 'none', stroke: col, 'stroke-width': 1.6 }, fx);
        ring.style.transformBox = 'view-box'; ring.style.transformOrigin = '0px 0px';
        ring.animate([{ scale: '1', opacity: 1 }, { scale: '3.2', opacity: 0 }], { duration: 750, delay: 250, easing: 'ease-out', fill: 'backwards' });
        for (let i = 0; i < 8; i++) {               // sparks
            const a = i * Math.PI / 4 + 0.2;
            const s = el('line', { x1: 0, y1: 0, x2: (4 * Math.cos(a)).toFixed(2), y2: (4 * Math.sin(a)).toFixed(2), stroke: mix(col, 0.6, 255), 'stroke-width': 1.1, 'stroke-linecap': 'round' }, fx);
            s.animate([{ translate: `${(9 * Math.cos(a)).toFixed(1)}px ${(9 * Math.sin(a)).toFixed(1)}px`, opacity: 1 },
                { translate: `${(22 * Math.cos(a)).toFixed(1)}px ${(22 * Math.sin(a)).toFixed(1)}px`, opacity: 0 }],
                { duration: 600, delay: 300, easing: 'ease-out', fill: 'backwards' });
        }
        // a mote of light runs from the stone into the centre
        const x = +o.dataset.x, y = +o.dataset.y;
        const mote = el('circle', { r: 2.4, fill: mix(col, 0.5, 255) }, group);
        mote.animate([{ translate: `${x}px ${y}px`, opacity: 0 }, { translate: `${x * 0.6}px ${y * 0.6}px`, opacity: 1, offset: 0.3 }, { translate: '0px 0px', opacity: 0 }],
            { duration: 700, delay: 650, easing: 'ease-in', fill: 'backwards' });
        const centre = group.querySelector('.pt-centre');
        centre?.animate([{ opacity: 1 }, { opacity: 0.35, offset: 0.4 }, { opacity: 1 }], { duration: 600, delay: 1250 });
        setTimeout(() => { fx.remove(); mote.remove(); }, 1500);
    }

    function completeBurst(group) {
        ORDER.forEach((e, i) => {
            group.querySelector(`.pt-stone.pt-${e} .pt-flash`)?.animate([{ opacity: 0 }, { opacity: 1 }, { opacity: 0 }],
                { duration: 700, delay: 900 + i * 140 });
        });
        const fx = el('g', { class: 'pt-fx' }, group);
        const col = group.style.getPropertyValue('--pt-lit') || '#fff';
        for (let k = 0; k < 2; k++) {
            const w = el('circle', { r: 10, fill: 'none', stroke: col, 'stroke-width': 2.2 - k }, fx);
            w.style.transformBox = 'view-box'; w.style.transformOrigin = '0px 0px';
            w.animate([{ scale: '1', opacity: 0.9 }, { scale: '7.5', opacity: 0 }], { duration: 1200, delay: 1600 + k * 260, easing: 'ease-out', fill: 'backwards' });
        }
        group.querySelectorAll('.pt-art .pt-trace').forEach(t => {
            const len = (t.getTotalLength?.() || 300);
            t.animate([{ strokeDasharray: `0 ${len}`, stroke: col, opacity: 1 }, { strokeDasharray: `${len} 0`, stroke: col, opacity: 1 }],
                { duration: 1100, delay: 1500, easing: 'ease-in-out' });
        });
        setTimeout(() => fx.remove(), 3200);
    }

    // a short dash of light runs once around the stone ring and the star
    function sweep(group) {
        const col = group.style.getPropertyValue('--pt-lit') || '#fff';
        group.querySelectorAll('.pt-art .pt-trace').forEach((t, i) => {
            const len = (t.getTotalLength?.() || 300), dash = 22;
            t.animate([{ stroke: col, strokeDasharray: `${dash} ${len}`, strokeDashoffset: dash, opacity: 1, strokeWidth: 1.4 },
                { stroke: col, strokeDasharray: `${dash} ${len}`, strokeDashoffset: -len, opacity: 1, strokeWidth: 1.4 }],
                { duration: 1500, delay: i * 120, easing: 'ease-in-out' });
        });
    }

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
        now.filter(e => !before.has(e)).forEach((e, i) => setTimeout(() => { try { burst(group, e); } catch (_) {} }, i * 200));
        if (complete && before.size < ORDER.length) setTimeout(() => { try { completeBurst(group); } catch (_) {} }, 200);
    }

    // Map turned: nothing to do. The stones turn with the board like real
    // stones (piece-3d.js keeps each bead's shading facing the screen).
    function level() {}

    // Turn start: the light sweep on the active player's tile.
    let lastTurnKey = null;
    setInterval(() => {
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

    window.PlayerTileArt = { render, level, _burst: burst, _complete: completeBurst, _sweep: sweep };
})();
