// 3D pieces: pawns drawn as classic board game pawns (base, narrowing body,
// collar, ball head), stones as half glass beads (a clear dome with the
// symbol inside). window.Piece3D
//
// No game hooks: a MutationObserver on the board (#viewport) decorates every
// pawn (g.player) and stone (g.stone) when it appears. Each piece gets:
// - under it (.puck-under): a soft ground shadow and the puck's side, a band
//   with a bottom curve, shaded left to right so it reads as round;
// - its own disc, symbol and extras lifted to the top of the puck (the top
//   face), with a rim shade and a highlight (.puck-over) over the face, still
//   under the element symbol.
// The camera is the board's own: the board tilt (window._boardTiltDegrees, a
// CSS rotateX on the board, default 20) already flattens the top face, so the
// puck only adds the side. A puck HEIGHT tall seen at tilt t shows a side of
// HEIGHT * sin(t) on screen; the board squashes y by cos(t), so in board units
// the side is HEIGHT * tan(t). Tilt 0 = straight down = no side.
// Pawn bases (pawn-cosmetics.js .pawn-cos-base) stay on the ground.
// Pawns: a solid of revolution built from thin slices (circles), each one
// higher up the screen by its height x tan(tilt), drawn bottom to top so the
// higher parts cover the lower ones like a turned wooden pawn. First every
// slice a little bigger in black (the outline, white on hover), then the
// slices in the player colour with round side shading, then the ball head.
// The pawn's own circle is made see-through (still catches the mouse); rim
// cosmetics are moved under the pawn so they stay a ring on the ground.
// Stones (beads): the stone's own circle is made see-through (still catches
// the mouse) and .puck-under draws the dome in its colours instead: body,
// round shading, a glow of the element colour on the side away from the light
// (light through glass): magic light inside the glass. A bright core
// (.bead-core) and the symbol (a glow filter) shine through it, light pools at
// the lower edge, and a little spills onto the board (.bead-halo). .puck-over goes on top of the symbol: the shine. The
// symbol sits part way up the dome.
// Everything is turned against the board rotation (window.getBoardRotation), so
// the side always shows at the bottom of the screen; the symbol keeps the
// board's turn. All extras ignore the mouse.
// Setting: Settings > Display "3D Pieces" (localStorage godaigo_3d_pieces =
// 'off' turns it off).
(function () {
    'use strict';
    const NS = 'http://www.w3.org/2000/svg';
    const KEY = 'godaigo_3d_pieces';
    const PIECES = 'g.player, g.stone';
    const DISC = 'circle.player-marker, circle.stone-piece';
    const HEIGHT = 0.6;    // puck height / radius (a hockey puck is about 0.67)
    const BEAD = 0.75;     // bead dome height / radius
    let on = (() => { try { return localStorage.getItem(KEY) !== 'off'; } catch (e) { return true; } })();
    let rot = 0, tilt = 0;

    function el(tag, attrs) {
        const e = document.createElementNS(NS, tag);
        for (const k in attrs) e.setAttribute(k, attrs[k]);
        e.style.pointerEvents = 'none';
        return e;
    }

    function ensureDefs() {
        const svg = document.getElementById('boardSvg');
        if (!svg || document.getElementById('puck-defs')) return;
        const defs = el('defs', { id: 'puck-defs' });
        defs.innerHTML =
            // top face: light from the top left
            '<radialGradient id="puck-shine" cx="0.35" cy="0.28" r="0.65">' +
            '<stop offset="0" stop-color="#fff" stop-opacity="0.5"/>' +
            '<stop offset="0.5" stop-color="#fff" stop-opacity="0.1"/>' +
            '<stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>' +
            '<radialGradient id="puck-rim" cx="0.5" cy="0.5" r="0.5">' +
            '<stop offset="0.72" stop-color="#000" stop-opacity="0"/>' +
            '<stop offset="1" stop-color="#000" stop-opacity="0.3"/></radialGradient>' +
            // side band: dark at both edges, a bright stripe left of centre
            '<linearGradient id="puck-band" x1="0" y1="0" x2="1" y2="0">' +
            '<stop offset="0" stop-color="#000" stop-opacity="0.7"/>' +
            '<stop offset="0.3" stop-color="#fff" stop-opacity="0.18"/>' +
            '<stop offset="0.45" stop-color="#000" stop-opacity="0.12"/>' +
            '<stop offset="1" stop-color="#000" stop-opacity="0.75"/></linearGradient>' +
            // bead: clear in the middle, darker toward the edge, darkest at the bottom
            '<radialGradient id="bead-body" cx="0.42" cy="0.36" r="0.68">' +
            '<stop offset="0.5" stop-color="#000" stop-opacity="0"/>' +
            '<stop offset="0.85" stop-color="#000" stop-opacity="0.35"/>' +
            '<stop offset="1" stop-color="#000" stop-opacity="0.6"/></radialGradient>' +
            // light inside the glass: bright middle, soft fade, nothing at the rim
            '<radialGradient id="bead-core-grad" cx="0.5" cy="0.55" r="0.5">' +
            '<stop offset="0" stop-color="#fff" stop-opacity="0.9"/>' +
            '<stop offset="0.3" stop-color="#fff" stop-opacity="0.45"/>' +
            '<stop offset="0.7" stop-color="#fff" stop-opacity="0.08"/>' +
            '<stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>' +
            '<mask id="bead-core-mask" maskContentUnits="objectBoundingBox"><rect width="1" height="1" fill="url(#bead-core-grad)"/></mask>' +
            '<radialGradient id="bead-spec" cx="0.5" cy="0.5" r="0.5">' +
            '<stop offset="0" stop-color="#fff" stop-opacity="0.95"/>' +
            '<stop offset="0.4" stop-color="#fff" stop-opacity="0.55"/>' +
            '<stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>' +
            '<radialGradient id="bead-glow" cx="0.5" cy="0.5" r="0.5">' +
            '<stop offset="0" stop-color="#fff" stop-opacity="0.75"/>' +
            '<stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>' +
            '<mask id="bead-glow-mask" maskContentUnits="objectBoundingBox"><rect width="1" height="1" fill="url(#bead-glow)"/></mask>' +
            // halo around a stone: strong next to the bead, fading out
            '<radialGradient id="bead-halo-grad" cx="0.5" cy="0.5" r="0.5">' +
            '<stop offset="0.5" stop-color="#fff" stop-opacity="1"/>' +
            '<stop offset="0.72" stop-color="#fff" stop-opacity="0.45"/>' +
            '<stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>' +
            '<mask id="bead-halo-mask" maskContentUnits="objectBoundingBox"><rect width="1" height="1" fill="url(#bead-halo-grad)"/></mask>' +
            '<radialGradient id="puck-shadow" cx="0.5" cy="0.5" r="0.5">' +
            '<stop offset="0.55" stop-color="#000" stop-opacity="0.45"/>' +
            '<stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>';
        svg.insertBefore(defs, svg.firstChild);
    }

    function mainDisc(g) { return g.querySelector(':scope > ' + DISC.split(', ').join(', :scope > ')); }

    const isBead = g => g.classList.contains('stone');
    const isPawn = g => g.classList.contains('player');

    // Pawn profile, in pawn radii (r = the marker radius): [height, radius,
    // cap]. cap = a flat top facing up there (drawn lighter).
    const PAWN_PROFILE = [
        [0, 1.0], [0.18, 1.0], [0.3, 0.92, true],     // base disc with a soft edge
        [0.36, 0.72], [0.9, 0.56], [1.5, 0.46], [2.0, 0.41], [2.4, 0.38], // body
        [2.46, 0.58], [2.6, 0.58, true],                // collar
        [2.68, 0.36],                                   // neck
    ];
    const HEAD_Z = 3.06, HEAD_R = 0.52;
    const PAWN_SCALE = 1.27; // the 3D pawn is about 27% bigger than the flat marker (owner 2026-10-07: +15%, then +10% more)

    function hexRgb(c) {
        const m = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(String(c || '').trim());
        if (!m) return [136, 136, 136];
        let h = m[1]; if (h.length === 3) h = h.split('').map(x => x + x).join('');
        return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16));
    }
    function mix(c, to, a) {
        const [r, g, b] = hexRgb(c), t = to === 'white' ? 255 : 0;
        return '#' + [r, g, b].map(v => Math.round(v + (t - v) * a).toString(16).padStart(2, '0')).join('');
    }

    // Per colour gradients for pawns (side shading and the ball head).
    function pawnGrads(color) {
        const key = hexRgb(color).join('-');
        const side = 'pawn-side-' + key, ball = 'pawn-ball-' + key;
        const defs = document.getElementById('puck-defs');
        if (defs && !document.getElementById(side)) {
            defs.insertAdjacentHTML('beforeend',
                `<linearGradient id="${side}" x1="0" y1="0" x2="1" y2="0">` +
                `<stop offset="0" stop-color="${mix(color, 'black', 0.6)}"/>` +
                `<stop offset="0.28" stop-color="${mix(color, 'white', 0.3)}"/>` +
                `<stop offset="0.5" stop-color="${color}"/>` +
                `<stop offset="1" stop-color="${mix(color, 'black', 0.65)}"/></linearGradient>` +
                `<radialGradient id="${ball}" cx="0.36" cy="0.32" r="0.72">` +
                `<stop offset="0" stop-color="${mix(color, 'white', 0.55)}"/>` +
                `<stop offset="0.45" stop-color="${color}"/>` +
                `<stop offset="1" stop-color="${mix(color, 'black', 0.6)}"/></radialGradient>`);
        }
        return { side: `url(#${side})`, ball: `url(#${ball})` };
    }

    // Slices from the profile, smooth enough for the current angle.
    function pawnSlices(r, tan) {
        const out = [];
        for (let i = 0; i < PAWN_PROFILE.length - 1; i++) {
            const [z0, a0] = PAWN_PROFILE[i], [z1, a1] = PAWN_PROFILE[i + 1];
            const n = Math.max(1, Math.ceil((z1 - z0) * r * Math.max(tan, 0.05) / 0.35));
            for (let k = (i ? 1 : 0); k <= n; k++) {
                const f = k / n;
                out.push({ y: -(z0 + (z1 - z0) * f) * r * tan, rad: (a0 + (a1 - a0) * f) * r, cap: k === n && !!PAWN_PROFILE[i + 1][2] });
            }
        }
        return out;
    }

    function buildPawn(g, under) {
        const disc = mainDisc(g);
        const r = (parseFloat(disc?.getAttribute('r')) || 8) * PAWN_SCALE;
        const color = disc?.getAttribute('fill') || '#888';
        const tan = Math.tan(Math.min(80, tilt || 0) * Math.PI / 180);
        const grads = pawnGrads(color);
        const slices = pawnSlices(r, tan);
        const head = { cy: -HEAD_Z * r * tan, r: HEAD_R * r };
        under.innerHTML = '';
        under.appendChild(el('ellipse', { cx: r * 0.25, cy: 1.5, rx: r * 1.35, ry: r * 1.25, fill: 'url(#puck-shadow)' }));
        const outline = el('g', { class: 'pawn3d-outline', fill: '#000' });
        slices.forEach(sl => outline.appendChild(el('circle', { cx: 0, cy: sl.y, r: sl.rad + 0.9 })));
        outline.appendChild(el('circle', { cx: 0, cy: head.cy, r: head.r + 0.9 }));
        under.appendChild(outline);
        slices.forEach(sl => {
            under.appendChild(el('circle', { cx: 0, cy: sl.y, r: sl.rad, fill: grads.side }));
            // flat tops (base, collar) catch the light; the parts above cover their middle
            if (sl.cap) under.appendChild(el('circle', { cx: -sl.rad * 0.04, cy: sl.y, r: sl.rad * 0.93, fill: mix(color, 'white', 0.22) }));
        });
        under.appendChild(el('circle', { cx: 0, cy: head.cy, r: head.r, fill: grads.ball }));
        under.appendChild(el('ellipse', { cx: -head.r * 0.35, cy: head.cy - head.r * 0.4, rx: head.r * 0.32, ry: head.r * 0.2,
            fill: '#fff', 'fill-opacity': 0.75, transform: `rotate(-35 ${-head.r * 0.35} ${head.cy - head.r * 0.4})` }));
    }

    // Size of the piece, in board units: radius and how far the top (puck face
    // or bead dome top) sits above the ground spot on screen (before the tilt
    // squash). up = how far the piece's own parts move up.
    function dims(g) {
        const disc = mainDisc(g);
        const r = parseFloat(disc?.getAttribute('r')) || 10;
        const tan = Math.tan(Math.min(80, tilt || 0) * Math.PI / 180);
        if (isBead(g)) { const lift = r * BEAD * tan; return { r, lift, up: lift * 0.6 }; }
        const lift = r * HEIGHT * tan;
        return { r, lift, up: lift };
    }

    // Outline of the dome: lower half = the base circle, upper half reaches up
    // to the dome top.
    function domePath(r, lift) {
        return `M ${-r} 0 A ${r} ${r} 0 0 0 ${r} 0 A ${r} ${r + lift} 0 0 0 ${-r} 0 Z`;
    }

    // Per-element tweaks for the glass stones, keyed by the symbol picture:
    // size = symbol size, light = strength of the inner light, spill, lit
    // edge and symbol glow. Earth: symbol 10% smaller, 20% dimmer (owner
    // 2026-10-07).
    const STONE_LOOK = { mountainsymbol: { size: 0.9, light: 0.8 } };
    // A stone using its ability glows 15% brighter (owner 2026-10-07): a water
    // stone copying a neighbour (its .mimicry-indicator / .chain-indicator
    // ring) or a void stone cancelling one (class stone-active, game-core.js).
    const ACTIVE_LIGHT = 1.15;
    const ACTIVE_RING = '.mimicry-indicator, .chain-indicator';
    function isActiveStone(g) {
        return g.classList.contains('stone-active') || !!g.querySelector(':scope > .mimicry-indicator, :scope > .chain-indicator');
    }
    function stoneLook(g) {
        const href = g.querySelector(':scope > image')?.getAttribute('href') || '';
        let look = { size: 1, light: 1 };
        for (const key in STONE_LOOK) if (href.indexOf(key) >= 0) { look = STONE_LOOK[key]; break; }
        return isActiveStone(g) ? { size: look.size, light: look.light * ACTIVE_LIGHT } : look;
    }

    // A stone's colours come from its SYMBOL (the element it is), so the glass
    // can never show one element's colour with another's symbol (owner
    // 2026-10-07: Control the Current left stones blue with a wind symbol).
    // Falls back to the stone circle's own colours.
    function beadColors(g) {
        const disc = mainDisc(g);
        const href = g.querySelector(':scope > image')?.getAttribute('href') || '';
        const types = window.STONE_TYPES || null;
        if (types) for (const k in types) {
            const img = (types[k].img || '').split('?')[0];
            if (img && href.split('?')[0] === img) {
                const c = types[k].color;
                const [r, gg, b] = hexRgb(c).map(v => Math.round(v * 0.55));
                return { fill: `rgb(${r},${gg},${b})`, edge: c };
            }
        }
        return { fill: disc?.getAttribute('fill') || '#888', edge: disc?.getAttribute('stroke') || '#ccc' };
    }

    function buildBeadUnder(g, under) {
        const { r, lift } = dims(g);
        const disc = mainDisc(g);
        const { fill, edge } = beadColors(g);
        const L = stoneLook(g).light;
        const d = domePath(r, lift);
        under.innerHTML = '';
        const lit = mix(edge, 'white', 0.45);
        under.appendChild(el('circle', { cx: r * 0.15, cy: 1.5, r: r * 1.3, fill: 'url(#puck-shadow)' }));
        // a little of the inner light spills onto the board, low right
        const spill = el('ellipse', { class: 'bead-halo', cx: r * 0.35, cy: r * 0.45, rx: r * 1.5, ry: r * 1.3, fill: edge, 'fill-opacity': 0.35 * L, mask: 'url(#bead-halo-mask)' });
        spill.style.mixBlendMode = 'screen'; // light, not paint
        under.appendChild(spill);
        under.appendChild(el('path', { class: 'puck-side', d, fill }));
        // the light inside: a bright core of the element colour
        const core = el('ellipse', { class: 'bead-core', cx: 0, cy: -lift * 0.45, rx: r * 0.8, ry: r * 0.8 + lift * 0.3, fill: edge, 'fill-opacity': 0.65 * L, mask: 'url(#bead-core-mask)' });
        core.style.mixBlendMode = 'screen';
        under.appendChild(core);
        // light through the glass gathers at the lower edge, away from the light
        const pool = el('ellipse', { cx: r * 0.18, cy: r * 0.55 - lift * 0.1, rx: r * 0.7, ry: r * 0.32, fill: edge, 'fill-opacity': 0.55 * L, mask: 'url(#bead-glow-mask)' });
        pool.style.mixBlendMode = 'screen';
        under.appendChild(pool);
        under.appendChild(el('path', { d, fill: 'url(#bead-body)' }));
        under.appendChild(el('path', { class: 'bead-edge', d, fill: 'none', stroke: '#000', 'stroke-opacity': 0.6, 'stroke-width': 1 }));
        under.appendChild(el('path', { d: `M ${-r * 0.92} ${-lift * 0.35} A ${r} ${r + lift} 0 0 1 ${r * 0.92} ${-lift * 0.35}`,
            fill: 'none', stroke: edge, 'stroke-opacity': 0.55, 'stroke-width': 0.8 }));
        // the lit glass edge, low right
        under.appendChild(el('path', { d: `M ${r * 0.98} ${-r * 0.05} A ${r} ${r} 0 0 1 ${-r * 0.3} ${r * 0.95}`,
            fill: 'none', stroke: lit, 'stroke-opacity': 0.5 * L, 'stroke-width': 1, 'stroke-linecap': 'round' }));
    }

    // The symbol as light: the symbol's shape (its image used as an alpha mask)
    // filled with a bright tint of the element colour, so the art's own colours
    // and dark outline drop out and every element glows the same way. Two
    // slightly bigger, fainter copies make a soft glow, and a dark border (the
    // shape stamped 8 times, nudged outward) keeps the lines readable. The void
    // art uses its brightness instead of its shape. Masks, not an SVG
    // filter: browsers keep a filter's picture from an older zoom (blurry until
    // something repaints it, e.g. hover); masks are drawn fresh every time.
    // The real image is hidden (opacity 0) while this is shown.
    let symSeq = 0;
    function buildSym(g) {
        let sym = g.querySelector(':scope > .bead-sym');
        const img = g.querySelector(':scope > image');
        if (!img) { if (sym) sym.remove(); return; }
        if (!sym) { sym = el('g', { class: 'bead-sym' }); img.after(sym); }
        const color = beadColors(g).edge;
        const x = +img.getAttribute('x') || 0, y = +img.getAttribute('y') || 0;
        const w = +img.getAttribute('width') || 0, h = +img.getAttribute('height') || 0;
        const cx = x + w / 2, cy = y + h / 2;
        const href = img.getAttribute('href') || img.getAttribute('xlink:href') || '';
        const t = img.getAttribute('transform');
        if (t) sym.setAttribute('transform', t); else sym.removeAttribute('transform');
        sym.innerHTML = '';
        // layer: [scale, fill, opacity, border offset]. The border layer is the
        // symbol shape stamped 8 times, each nudged a little outward (a fatter
        // copy), in a dark tint: a thin dark line around every light line.
        const B = Math.max(0.45, w * 0.028);
        // The void art is light dots on a dark disc: its shape is the whole disc,
        // so it uses its brightness instead (only the dots light up).
        const lumMask = /voidsymbol/i.test(href);
        const { size: S, light: L } = stoneLook(g);
        [[1.22, mix(color, 'white', 0.2), 0.15 * L, 0], [1.1, mix(color, 'white', 0.3), 0.28 * L, 0],
         [1, mix(color, 'black', 0.72), 0.95, B], [1, mix(color, 'white', 0.45 * L), L, 0]].forEach(([k0, fill, op, off]) => {
            const k = k0 * S;
            const id = 'bead-sym-' + (++symSeq);
            const m = el('mask', { id, maskUnits: 'userSpaceOnUse', x: cx - w, y: cy - h, width: w * 2, height: h * 2 });
            m.style.maskType = lumMask ? 'luminance' : 'alpha';
            const shifts = off ? [[1, 0], [-1, 0], [0, 1], [0, -1], [0.71, 0.71], [-0.71, 0.71], [0.71, -0.71], [-0.71, -0.71]] : [[0, 0]];
            shifts.forEach(([dx, dy]) => m.appendChild(el('image', { href, x: cx - w * k / 2 + dx * off, y: cy - h * k / 2 + dy * off,
                width: w * k, height: h * k, preserveAspectRatio: 'xMidYMid meet' })));
            sym.appendChild(m);
            sym.appendChild(el('rect', { x: cx - w, y: cy - h, width: w * 2, height: h * 2, fill, 'fill-opacity': op, mask: `url(#${id})` }));
        });
        img.style.opacity = '0';
    }

    function buildBeadOver(g, over) {
        const { r, lift } = dims(g);
        over.innerHTML = '';
        const top = -lift * 0.75;
        // big soft shine and a small sharp one, top left
        over.appendChild(el('ellipse', { cx: -r * 0.32, cy: top - r * 0.3, rx: r * 0.42, ry: r * 0.26,
            fill: 'url(#bead-spec)', 'fill-opacity': 0.6, transform: `rotate(-35 ${-r * 0.32} ${top - r * 0.3})` }));
        over.appendChild(el('ellipse', { cx: -r * 0.4, cy: top - r * 0.38, rx: r * 0.14, ry: r * 0.09,
            fill: '#fff', 'fill-opacity': 0.9, transform: `rotate(-35 ${-r * 0.4} ${top - r * 0.38})` }));
        // thin reflected rim, bottom right
        over.appendChild(el('path', { d: `M ${r * 0.85} ${-r * 0.1} A ${r * 0.95} ${r * 0.95} 0 0 1 ${r * 0.1} ${r * 0.9}`,
            fill: 'none', stroke: '#fff', 'stroke-opacity': 0.3, 'stroke-width': 0.8, 'stroke-linecap': 'round' }));
    }

    // Shapes under the piece, drawn in screen direction (rotate(-rot)).
    function buildUnder(g, under) {
        if (isPawn(g)) return buildPawn(g, under);
        if (isBead(g)) return buildBeadUnder(g, under);
        const { r, lift } = dims(g);
        const fill = mainDisc(g)?.getAttribute('fill') || '#888';
        under.innerHTML = '';
        // the shadow lies on the board, around the ground spot
        under.appendChild(el('circle', { cx: r * 0.12, cy: 1, r: r * 1.25, fill: 'url(#puck-shadow)' }));
        if (lift < 0.3) return; // straight down: no side to see
        const band = `M ${-r} ${-lift} L ${-r} 0 A ${r} ${r} 0 0 0 ${r} 0 L ${r} ${-lift} Z`;
        under.appendChild(el('path', { class: 'puck-side', d: band, fill }));
        under.appendChild(el('path', { d: band, fill: 'url(#puck-band)' }));
        // thin dark line along the bottom edge
        under.appendChild(el('path', { d: `M ${-r} 0 A ${r} ${r} 0 0 0 ${r} 0`, fill: 'none', stroke: '#000', 'stroke-opacity': 0.55, 'stroke-width': 1 }));
    }

    function buildOver(g, over) {
        if (isPawn(g)) { over.innerHTML = ''; return; }
        if (isBead(g)) return buildBeadOver(g, over);
        const { r, lift } = dims(g);
        over.innerHTML = '';
        const face = { cx: 0, cy: -lift, r };
        over.appendChild(el('circle', { ...face, fill: 'url(#puck-rim)' }));
        over.appendChild(el('circle', { ...face, fill: 'url(#puck-shine)' }));
    }

    // Lift a piece's own parts (disc, symbol, rim cosmetics, ...) onto the top face.
    function liftOne(n, g) {
        if (n.nodeType !== 1 || n.classList.contains('puck-under') || n.classList.contains('puck-over') || n.classList.contains('bead-sym')) return;
        if (n.classList.contains('pawn-cos-base') || n.tagName === 'title' || n.tagName === 'defs') return;
        if (isPawn(g)) {
            // the pawn shape is ours: its circle goes see-through, a rim stays on the ground under it
            if (n.matches(DISC)) { n.setAttribute('data-p3d', n.getAttribute('transform') || ''); n.style.fillOpacity = '0'; n.style.strokeOpacity = '0'; }
            else if (n.classList.contains('pawn-cos')) {
                const under = g.querySelector(':scope > .puck-under');
                const kids = [...g.children];
                if (under && kids.indexOf(n) > kids.indexOf(under)) g.insertBefore(n, under);
            }
            return;
        }
        if (!n.hasAttribute('data-p3d')) n.setAttribute('data-p3d', n.getAttribute('transform') || '');
        const { up: lift } = dims(g);
        const orig = n.getAttribute('data-p3d');
        // "up" on screen, whatever the board rotation
        const a = rot * Math.PI / 180;
        const dx = (-lift * Math.sin(a)).toFixed(2), dy = (-lift * Math.cos(a)).toFixed(2);
        n.setAttribute('transform', `translate(${dx} ${dy})` + (orig ? ' ' + orig : ''));
        // a bead's own circle: see-through, the dome is drawn under it
        if (isBead(g) && n.matches(DISC)) { n.style.fillOpacity = '0'; n.style.strokeOpacity = '0'; }
    }

    function unliftOne(n) {
        if (n.nodeType !== 1 || !n.hasAttribute('data-p3d')) return;
        const orig = n.getAttribute('data-p3d');
        if (orig) n.setAttribute('transform', orig); else n.removeAttribute('transform');
        n.removeAttribute('data-p3d');
        n.style.fillOpacity = ''; n.style.strokeOpacity = ''; n.style.opacity = '';
    }

    function decorate(g) {
        if (!on || !mainDisc(g)) return;
        ensureDefs();
        let under = g.querySelector(':scope > .puck-under');
        let over = g.querySelector(':scope > .puck-over');
        if (!under) {
            under = el('g', { class: 'puck-under' });
            const base = g.querySelector(':scope > .pawn-cos-base');
            if (base) base.after(under); else g.insertBefore(under, g.firstChild);
        }
        if (!over) {
            over = el('g', { class: 'puck-over' });
            // bead shine goes over the symbol (it is on the glass)
            if (isBead(g)) g.appendChild(over); else mainDisc(g).after(over);
        }
        refresh(g);
    }

    // (Re)draw a decorated piece for the current rotation / tilt / colour.
    function refresh(g) {
        const under = g.querySelector(':scope > .puck-under');
        const over = g.querySelector(':scope > .puck-over');
        if (!under || !over) return;
        buildUnder(g, under);
        buildOver(g, over);
        const t = rot ? `rotate(${-rot})` : null;
        [under, over].forEach(n => { if (t) n.setAttribute('transform', t); else n.removeAttribute('transform'); });
        Array.from(g.children).forEach(n => liftOne(n, g));
        if (isBead(g)) buildSym(g);
    }

    function undecorate(g) {
        g.querySelectorAll(':scope > .puck-under, :scope > .puck-over, :scope > .bead-sym').forEach(n => n.remove());
        Array.from(g.children).forEach(unliftOne);
    }

    function all(fn) { document.querySelectorAll('#viewport ' + PIECES.split(', ').join(', #viewport ')).forEach(fn); }

    function watch() {
        const vp = document.getElementById('viewport');
        if (!vp) { setTimeout(watch, 500); return; }
        new MutationObserver(list => {
            if (!on) return;
            const redo = new Set();
            for (const m of list) {
                if (m.type === 'attributes') {
                    // a water stone copying a neighbour changes colour (fill / stroke) or symbol (href)
                    if (m.target.matches?.(DISC + ', image') && m.target.parentNode?.matches?.(PIECES)) redo.add(m.target.parentNode);
                    // a void stone starts / stops cancelling a neighbour
                    else if (m.attributeName === 'class' && m.target.matches?.('g.stone') && m.target.querySelector(':scope > .puck-under')
                        && m.target.classList.contains('stone-active') !== (m.oldValue || '').split(/\s+/).includes('stone-active')) redo.add(m.target);
                    continue;
                }
                // an ability ring taken off a stone
                if (m.target.matches?.('g.stone')) for (const n of m.removedNodes) if (n.nodeType === 1 && n.matches(ACTIVE_RING)) redo.add(m.target);
                for (const n of m.addedNodes) {
                    if (n.nodeType !== 1) continue;
                    if (n.matches?.(PIECES)) redo.add(n);
                    else if (n.parentNode?.matches?.(PIECES)) {
                        // a part added to a piece later (symbol, rim cosmetic, water mark)
                        if (n.matches(DISC) || (n.tagName === 'image' && isBead(n.parentNode)) || n.matches(ACTIVE_RING)) redo.add(n.parentNode);
                        else if (n.parentNode.querySelector(':scope > .puck-under')) liftOne(n, n.parentNode);
                    } else n.querySelectorAll?.(PIECES).forEach(p => redo.add(p));
                }
            }
            redo.forEach(decorate);
        }).observe(vp, { subtree: true, childList: true, attributes: true, attributeFilter: ['fill', 'stroke', 'href', 'class'], attributeOldValue: true });
        all(decorate);
        // ── Thick tiles (owner 2026-10-07) ────────────────────────────────
        // Every placed tile gets a side: the tile's outline pushed "down" the
        // screen by its thickness (TILE_THICK x tan(tilt), same camera as the
        // pieces), the hull of both filled dark, plus a soft shadow. All sides
        // live in one layer (#tile-sides) under every tile, so a side only
        // shows where no tile covers it: the board's outer edges and gaps.
        const TILE_THICK = 30;
        let sidesTimer = 0;
        const hull = (pts) => {
            pts = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
            const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
            const lo = [], up = [];
            for (const p of pts) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
            for (let i = pts.length - 1; i >= 0; i--) { const p = pts[i]; while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
            return lo.slice(0, -1).concat(up.slice(0, -1));
        };
        const tileOutline = (t) => {
            const base = t.getCTM(); if (!base) return null;
            const inv = base.inverse(), out = [];
            const svg = document.getElementById('boardSvg');
            const pt = svg.createSVGPoint();
            t.querySelectorAll('.hex-tile').forEach(h => {
                if (h.closest('.tile-select-mark, .shrine-marker')) return;
                const m = inv.multiply(h.getCTM());
                for (let i = 0; i < h.points.numberOfItems; i++) {
                    const q = h.points.getItem(i); pt.x = q.x; pt.y = q.y;
                    const r = pt.matrixTransform(m); out.push([r.x, r.y]);
                }
            });
            return out.length ? out : null;
        };
        const buildSides = () => {
            let layer = document.getElementById('tile-sides');
            const tiles = [...vp.querySelectorAll(':scope > g.placed-tile')];
            if (!on || !tiles.length) { layer?.remove(); return; }
            if (!layer) { layer = el('g', { id: 'tile-sides' }); }
            if (layer !== vp.firstChild) vp.insertBefore(layer, vp.firstChild);
            const depth = TILE_THICK * Math.tan(Math.min(80, tilt || 0) * Math.PI / 180);
            if (depth < 0.5) { layer.innerHTML = ''; return; }
            const a = rot * Math.PI / 180;
            const dx = depth * Math.sin(a), dy = depth * Math.cos(a);   // "down" on screen, in board units
            const shadow = [], side = [], edge = [];
            tiles.forEach(t => {
                const m = /translate\(\s*([-\d.e]+)[ ,]+([-\d.e]+)/.exec(t.getAttribute('transform') || '');
                if (!m) return;
                const tx = +m[1], ty = +m[2];
                const pts = tileOutline(t); if (!pts) return;
                const top = pts.map(p => [p[0] + tx, p[1] + ty]);
                const fmt = ps => ps.map(p => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ');
                const h = hull(top.concat(top.map(p => [p[0] + dx, p[1] + dy])));
                side.push(fmt(h));
                shadow.push(fmt(hull(top.concat(top.map(p => [p[0] + dx * 1.9 + 2, p[1] + dy * 1.9 + 2])))));
                edge.push(fmt(hull(top.map(p => [p[0] + dx, p[1] + dy]))));
            });
            layer.innerHTML = '';
            shadow.forEach(ps => layer.appendChild(el('polygon', { points: ps, fill: '#000', 'fill-opacity': 0.28 })));
            side.forEach(ps => layer.appendChild(el('polygon', { points: ps, fill: '#4a3a2c', stroke: '#1a130d', 'stroke-width': 1, 'stroke-linejoin': 'round' })));
            // a darker line along the bottom edge of each slab
            edge.forEach(ps => layer.appendChild(el('polygon', { points: ps, fill: 'none', stroke: '#120d09', 'stroke-width': 1.2, 'stroke-opacity': 0.8, 'stroke-linejoin': 'round' })));
        };
        const sidesSoon = () => { clearTimeout(sidesTimer); sidesTimer = setTimeout(buildSides, 60); };
        new MutationObserver(list => {
            if (list.some(m => [...m.addedNodes, ...m.removedNodes].some(n => n.nodeType === 1 && n.matches('g.placed-tile')))) sidesSoon();
        }).observe(vp, { childList: true });
        window.Piece3D_rebuildTileSides = sidesSoon;
        sidesSoon();
        // ── Smooth pawn steps (owner 2026-10-07) ────────────────────────────
        // A pawn move (bots step one hex at a time) removes the pawn and adds a
        // new one at the new hex. When a pawn of the same colour comes back
        // 1-2 hexes away, it slides there with a small hop (CSS translate,
        // which adds to the SVG transform; the game's position is already
        // final). Off in muted training, hidden tabs and reduced motion.
        const posOf = (g) => {
            const m = /translate\(\s*([-\d.e]+)[ ,]+([-\d.e]+)/.exec(g.getAttribute('transform') || '');
            return m ? { x: +m[1], y: +m[2] } : null;
        };
        const pawnKey = (g) => g.querySelector('circle.player-marker')?.getAttribute('fill') || '';
        const lastPawnPos = new Map();
        const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
        // Wind steps (owner 2026-10-08): stepping from or onto a wind stone, or
        // a water stone using wind's ability, glides twice as fast with a lower
        // hop and leaves fading after-images along the way.
        const afterImages = (n, from, to, ms) => {
            const parent = n.parentNode; if (!parent) return;
            for (let i = 1; i <= 3; i++) {
                const f = i / 4;
                const g = el('g', { class: 'pawn-afterimage',
                    transform: `translate(${(from.x + (to.x - from.x) * f).toFixed(2)}, ${(from.y + (to.y - from.y) * f).toFixed(2)})` });
                Array.from(n.childNodes).forEach(c => { if (c.nodeType === 1) g.appendChild(c.cloneNode(true)); });
                g.querySelector('.puck-under > ellipse')?.remove();             // no ground shadow on a ghost
                g.querySelectorAll('*').forEach(c => { c.removeAttribute('id'); c.style.pointerEvents = 'none'; });
                g.style.filter = 'blur(0.8px)';                                 // a little motion blur
                parent.insertBefore(g, n);
                // shows up as the pawn passes this spot, then fades
                const delay = ms * f;
                g.style.opacity = '0';
                g.animate([{ opacity: 0.6 - i * 0.1 }, { opacity: 0 }],
                    { duration: 320, delay, easing: 'ease-out', fill: 'both' }).onfinish = () => g.remove();
                setTimeout(() => g.remove(), ms + delay + 600); // safety
            }
        };
        const glide = (n, from, to) => {
            const dx = from.x - to.x, dy = from.y - to.y, d = Math.hypot(dx, dy);
            if (d < 5 || d > 80 || reduceMotion || document.hidden || !window.SoundSystem || !n.animate) return;
            const windy = !!(window.windStoneAt?.(to.x, to.y) || window.windStoneAt?.(from.x, from.y));
            const a = rot * Math.PI / 180, hop = windy ? 2 : 5;
            const ux = -hop * Math.sin(a), uy = -hop * Math.cos(a);   // "up" on screen
            const ms = Math.min(320, 160 + d * 2.5) / (windy ? 2 : 1);
            try {
                n.getAnimations?.().forEach(an => an.cancel());
                n.animate([
                    { translate: `${dx}px ${dy}px` },
                    { translate: `${(dx / 2 + ux).toFixed(2)}px ${(dy / 2 + uy).toFixed(2)}px`, offset: 0.5 },
                    { translate: '0px 0px' }
                ], { duration: ms, easing: windy ? 'ease-out' : 'ease-in-out' });
                if (windy) afterImages(n, from, to, ms);
            } catch (e) {}
        };
        // the same pawn moved (its transform changed)
        new MutationObserver(list => {
            for (const m of list) {
                if (!m.target.matches?.('#viewport > g.player') || !m.oldValue) continue;
                const fake = { getAttribute: () => m.oldValue };
                const from = posOf(fake), to = posOf(m.target);
                if (from && to) glide(m.target, from, to);
            }
        }).observe(vp, { subtree: true, attributes: true, attributeFilter: ['transform'], attributeOldValue: true });
        // a pawn re-created at its new hex
        new MutationObserver(list => {
            for (const m of list) for (const n of m.removedNodes) {
                if (n.nodeType === 1 && n.matches('g.player')) { const p = posOf(n); if (p) lastPawnPos.set(pawnKey(n), { p, t: performance.now() }); }
            }
            for (const m of list) for (const n of m.addedNodes) {
                if (n.nodeType !== 1 || !n.matches('g.player')) continue;
                const k = pawnKey(n), old = lastPawnPos.get(k), now = posOf(n);
                if (!old || !now || performance.now() - old.t > 400) continue;
                lastPawnPos.delete(k);
                glide(n, old.p, now);
            }
        }).observe(vp, { childList: true });
        // Pawns always draw over stones (owner 2026-10-07: bot pawns went under
        // stones while moving). Pawns and stones are both children of #viewport
        // and stones are usually added later, so they ended up on top. When a
        // stone is added after a pawn, it is moved to just before the first pawn
        // (the stone moves, never the pawn, so a pawn drag is never disturbed).
        const stonesUnderPawns = () => {
            const firstPawn = vp.querySelector(':scope > g.player');
            if (!firstPawn) return;
            vp.querySelectorAll(':scope > g.player ~ g.stone').forEach(st => vp.insertBefore(st, firstPawn));
        };
        new MutationObserver(list => {
            if (list.some(m => [...m.addedNodes].some(n => n.nodeType === 1 && (n.matches('g.stone') || n.matches('g.player'))))) stonesUnderPawns();
        }).observe(vp, { childList: true });
        stonesUnderPawns();
        // Sharpness: the board is its own cached layer (#boardSvg will-change),
        // and after a zoom Chrome kept showing the stone symbols (images inside
        // masks) at the size they had when they were made: a repaint (hover,
        // an opacity nudge) was not enough, but turning the map, which rebuilds
        // every piece, fixed it (owner report 2026-10-07). So once a zoom
        // settles, rebuild the 3D stones the same way, and give each shrine
        // marker fresh copies of its mask images. Shrines run with 3D pieces off
        // too (they use masks either way).
        let nudgeTimer = 0;
        const nudge = () => {
            if (on) document.querySelectorAll('#viewport g.stone').forEach(g => { if (g.querySelector(':scope > .puck-under')) refresh(g); });
            document.querySelectorAll('#viewport .shrine-marker mask image').forEach(img => img.replaceWith(img.cloneNode(true)));
        };
        const soon = () => { clearTimeout(nudgeTimer); nudgeTimer = setTimeout(nudge, 200); };
        new MutationObserver(soon).observe(vp, { attributes: true, attributeFilter: ['transform'] });
        window.addEventListener('resize', soon);
        // Board rotation / tilt: cheap check, only touches pieces when they changed.
        setInterval(() => {
            const r = typeof window.getBoardRotation === 'function' ? window.getBoardRotation() : 0;
            const t = window._boardTiltDegrees || 0;
            if (r === rot && t === tilt) return;
            rot = r; tilt = t;
            if (on) all(refresh);
            sidesSoon();
            // shrine carving is lit from the screen's top left too (game-core.js)
            if (typeof window.refreshShrineMarkers === 'function') window.refreshShrineMarkers();
        }, 150);
    }

    function set(value) {
        on = !!value;
        try { localStorage.setItem(KEY, on ? 'on' : 'off'); } catch (e) {}
        all(on ? decorate : undecorate);
        window.Piece3D_rebuildTileSides?.();
    }

    // ── Stone break animation (owner 2026-10-07) ─────────────────────────────
    // game-core.js calls window.playStoneBreak(el) just before it removes a
    // broken stone's element (attemptBreakStone for players and bots,
    // breakStoneVisually on other screens). A copy of the stone stays on the
    // board for a moment: cracks run out from near the middle (0.28 s), then the
    // stone splits along those cracks into shards that fly apart, turn and
    // fade, with a little dust (0.5 s). Game logic never waits on it. Works with
    // 3D pieces on or off. Skipped while the tab is hidden or sound is off
    // (muted bot training, quiet test games), at most 6 at once.
    let breaking = 0, fxSeq = 0;
    function playStoneBreak(el) {
        try {
            if (!el || !el.parentNode || document.hidden || !window.SoundSystem || breaking >= 6) return;
            const disc = el.querySelector(':scope > circle.stone-piece');
            const color = disc?.getAttribute('stroke') || '#cccccc';
            const decorated = !!el.querySelector(':scope > .puck-under');
            const { r, lift } = decorated ? dims(el) : { r: parseFloat(disc?.getAttribute('r')) || 12, lift: 0 };
            const cy = -lift * 0.5;                  // the middle of the dome
            const fxg = el.ownerDocument.createElementNS(NS, 'g');
            fxg.setAttribute('class', 'stone-break-fx');
            fxg.setAttribute('transform', el.getAttribute('transform') || '');
            fxg.style.pointerEvents = 'none';
            const inner = () => {                    // a fresh copy of the stone's look
                const g = el.ownerDocument.createElementNS(NS, 'g');
                Array.from(el.childNodes).forEach(n => {
                    // ability rings just go away; they do not shatter with the stone
                    if (n.nodeType === 1 && n.matches('.mimicry-indicator, .chain-indicator, .void-nullification-indicator')) return;
                    g.appendChild(n.cloneNode(true));
                });
                g.querySelectorAll('*').forEach(n => { n.removeAttribute('id'); });
                return g;
            };
            // masks inside the copy need their own ids
            const reid = (g) => {
                g.querySelectorAll('mask').forEach(m => m.remove());
                const src = el.querySelectorAll('mask');
                const map = {};
                src.forEach(m => { const id = 'brk-' + (++fxSeq); map[m.id] = id; const c = m.cloneNode(true); c.id = id; g.insertBefore(c, g.firstChild); });
                g.querySelectorAll('[mask]').forEach(n => { const k = (n.getAttribute('mask') || '').replace(/^url\(#|\)$/g, ''); if (map[k]) n.setAttribute('mask', `url(#${map[k]})`); });
                return g;
            };
            // crack lines: N jagged paths from a point near the middle to past the edge
            const N = 5, rnd = Math.random;
            const c0 = { x: (rnd() - 0.5) * r * 0.3, y: cy + (rnd() - 0.5) * r * 0.3 };
            const start = rnd() * Math.PI * 2;
            const cracks = [];
            for (let i = 0; i < N; i++) {
                const a = start + (i + (rnd() - 0.5) * 0.5) * (Math.PI * 2 / N);
                const pts = [c0];
                for (let k = 1; k <= 4; k++) {
                    const d = (r * 1.25) * k / 4, wob = (rnd() - 0.5) * 0.5;
                    pts.push({ x: c0.x + Math.cos(a + wob) * d, y: c0.y + Math.sin(a + wob) * d });
                }
                cracks.push({ a, pts });
            }
            const ptsStr = pts => pts.map(p => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ');
            const len = pts => pts.slice(1).reduce((t, p, i) => t + Math.hypot(p.x - pts[i].x, p.y - pts[i].y), 0);
            // stage 1: the whole stone with growing cracks
            const whole = reid(inner());
            const crackG = el.ownerDocument.createElementNS(NS, 'g');
            const crackEls = cracks.map(c => {
                const L = len(c.pts);
                const dark = el.ownerDocument.createElementNS(NS, 'polyline');
                dark.setAttribute('points', ptsStr(c.pts));
                dark.setAttribute('fill', 'none'); dark.setAttribute('stroke', '#0b0b0b'); dark.setAttribute('stroke-width', '1.2');
                dark.setAttribute('stroke-linejoin', 'round'); dark.setAttribute('stroke-linecap', 'round');
                dark.setAttribute('stroke-dasharray', L.toFixed(2)); dark.setAttribute('stroke-dashoffset', L.toFixed(2));
                const lightLine = dark.cloneNode();
                lightLine.setAttribute('stroke', mix(color, 'white', 0.7)); lightLine.setAttribute('stroke-width', '0.5');
                lightLine.setAttribute('transform', 'translate(0.5 0.5)'); lightLine.setAttribute('stroke-opacity', '0.8');
                crackG.appendChild(dark); crackG.appendChild(lightLine);
                return { els: [dark, lightLine], L };
            });
            whole.appendChild(crackG);
            fxg.appendChild(whole);
            // stage 2 pieces: one shard per gap between two cracks, clipped along them
            const FAR = r * 3;
            const shards = cracks.map((c, i) => {
                const n = cracks[(i + 1) % N];
                let a1 = n.a; while (a1 < c.a) a1 += Math.PI * 2;
                const arc = [];
                for (let k = 0; k <= 6; k++) { const a = c.a + (a1 - c.a) * k / 6; arc.push({ x: c0.x + Math.cos(a) * FAR, y: c0.y + Math.sin(a) * FAR }); }
                const poly = [...c.pts, ...arc, ...n.pts.slice().reverse()];
                const id = 'brk-' + (++fxSeq);
                const cp = el.ownerDocument.createElementNS(NS, 'clipPath'); cp.id = id;
                const pg = el.ownerDocument.createElementNS(NS, 'polygon'); pg.setAttribute('points', ptsStr(poly)); cp.appendChild(pg);
                const holder = el.ownerDocument.createElementNS(NS, 'g');
                const body = reid(inner()); body.setAttribute('clip-path', `url(#${id})`);
                holder.appendChild(cp); holder.appendChild(body);
                holder.style.display = 'none';
                fxg.appendChild(holder);
                const mid = (c.a + a1) / 2;
                return { holder, dx: Math.cos(mid), dy: Math.sin(mid), spin: (rnd() - 0.5) * 70, dist: r * (0.55 + rnd() * 0.45),
                    cx: c0.x + Math.cos(mid) * r * 0.5, cy: c0.y + Math.sin(mid) * r * 0.5 };
            });
            // dust
            const dust = [];
            for (let i = 0; i < 10; i++) {
                const d = el.ownerDocument.createElementNS(NS, 'circle');
                const a = rnd() * Math.PI * 2;
                d.setAttribute('r', (0.6 + rnd() * 0.9).toFixed(2));
                d.setAttribute('fill', i % 2 ? mix(color, 'white', 0.4) : '#8a8070');
                d.style.display = 'none';
                fxg.appendChild(d);
                dust.push({ d, a, sp: r * (1 + rnd() * 0.9) });
            }
            el.parentNode.insertBefore(fxg, el.nextSibling);
            breaking++;
            let done = false;
            const finish = () => { if (done) return; done = true; fxg.remove(); breaking--; };
            const T1 = 280, T2 = 520, t0 = performance.now();
            const ease = p => 1 - Math.pow(1 - p, 3);
            const step = (now) => {
                const t = now - t0;
                if (t < T1) {
                    const p = t / T1;
                    crackEls.forEach(c => c.els.forEach(e => e.setAttribute('stroke-dashoffset', (c.L * (1 - ease(p))).toFixed(2))));
                    const sh = Math.sin(t * 0.09) * 0.6 * p;
                    whole.setAttribute('transform', `translate(${sh.toFixed(2)} 0)`);
                } else if (t < T1 + T2) {
                    if (whole.parentNode) { whole.remove(); shards.forEach(s => { s.holder.style.display = ''; }); dust.forEach(d => { d.d.style.display = ''; }); }
                    const p = (t - T1) / T2, e = ease(p), fade = Math.max(0, 1 - Math.pow(p, 1.6));
                    shards.forEach(s => {
                        const x = s.dx * s.dist * e, y = s.dy * s.dist * e + 5 * p * p; // a little fall
                        s.holder.setAttribute('transform', `translate(${x.toFixed(2)} ${y.toFixed(2)}) rotate(${(s.spin * e).toFixed(1)} ${s.cx.toFixed(2)} ${s.cy.toFixed(2)})`);
                        s.holder.setAttribute('opacity', fade.toFixed(3));
                    });
                    dust.forEach(d => {
                        d.d.setAttribute('cx', (c0.x + Math.cos(d.a) * d.sp * e).toFixed(2));
                        d.d.setAttribute('cy', (c0.y + Math.sin(d.a) * d.sp * e + 4 * p).toFixed(2));
                        d.d.setAttribute('opacity', (fade * 0.85).toFixed(3));
                    });
                } else { finish(); return; }
                requestAnimationFrame(step);
            };
            requestAnimationFrame(step);
            // safety: never leave the effect behind (a hidden tab pauses frames)
            setTimeout(finish, T1 + T2 + 1500);
        } catch (e) { console.warn('[Piece3D] stone break effect failed', e); }
    }
    window.playStoneBreak = playStoneBreak;

    window.Piece3D = {
        isOn: () => on,
        set,
        // Settings > Display toggle button
        toggle(btn) {
            set(!on);
            if (btn) { btn.textContent = on ? 'ON' : 'OFF'; btn.className = `gami-toggle ${on ? 'on' : 'off'}`; }
        },
    };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watch);
    else watch();
})();
