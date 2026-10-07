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
        const r = parseFloat(disc?.getAttribute('r')) || 8;
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

    function buildBeadUnder(g, under) {
        const { r, lift } = dims(g);
        const disc = mainDisc(g);
        const fill = disc?.getAttribute('fill') || '#888';
        const edge = disc?.getAttribute('stroke') || '#ccc';
        const d = domePath(r, lift);
        under.innerHTML = '';
        const lit = mix(edge, 'white', 0.45);
        under.appendChild(el('circle', { cx: r * 0.15, cy: 1.5, r: r * 1.3, fill: 'url(#puck-shadow)' }));
        // a little of the inner light spills onto the board, low right
        const spill = el('ellipse', { class: 'bead-halo', cx: r * 0.35, cy: r * 0.45, rx: r * 1.5, ry: r * 1.3, fill: edge, 'fill-opacity': 0.5, mask: 'url(#bead-halo-mask)' });
        spill.style.mixBlendMode = 'screen'; // light, not paint
        under.appendChild(spill);
        under.appendChild(el('path', { class: 'puck-side', d, fill }));
        // the light inside: a bright core of the element colour
        const core = el('ellipse', { class: 'bead-core', cx: 0, cy: -lift * 0.45, rx: r * 0.8, ry: r * 0.8 + lift * 0.3, fill: edge, mask: 'url(#bead-core-mask)' });
        core.style.mixBlendMode = 'screen';
        under.appendChild(core);
        // light through the glass gathers at the lower edge, away from the light
        const pool = el('ellipse', { cx: r * 0.18, cy: r * 0.55 - lift * 0.1, rx: r * 0.7, ry: r * 0.32, fill: edge, 'fill-opacity': 0.8, mask: 'url(#bead-glow-mask)' });
        pool.style.mixBlendMode = 'screen';
        under.appendChild(pool);
        under.appendChild(el('path', { d, fill: 'url(#bead-body)' }));
        under.appendChild(el('path', { class: 'bead-edge', d, fill: 'none', stroke: '#000', 'stroke-opacity': 0.6, 'stroke-width': 1 }));
        under.appendChild(el('path', { d: `M ${-r * 0.92} ${-lift * 0.35} A ${r} ${r + lift} 0 0 1 ${r * 0.92} ${-lift * 0.35}`,
            fill: 'none', stroke: edge, 'stroke-opacity': 0.55, 'stroke-width': 0.8 }));
        // the lit glass edge, low right
        under.appendChild(el('path', { d: `M ${r * 0.98} ${-r * 0.05} A ${r} ${r} 0 0 1 ${-r * 0.3} ${r * 0.95}`,
            fill: 'none', stroke: lit, 'stroke-opacity': 0.7, 'stroke-width': 1, 'stroke-linecap': 'round' }));
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
        const color = mainDisc(g)?.getAttribute('stroke') || '#ccc';
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
        [[1.22, mix(color, 'white', 0.25), 0.22, 0], [1.1, mix(color, 'white', 0.35), 0.4, 0],
         [1, mix(color, 'black', 0.72), 0.95, B], [1, mix(color, 'white', 0.62), 1, 0]].forEach(([k, fill, op, off]) => {
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
                    continue;
                }
                for (const n of m.addedNodes) {
                    if (n.nodeType !== 1) continue;
                    if (n.matches?.(PIECES)) redo.add(n);
                    else if (n.parentNode?.matches?.(PIECES)) {
                        // a part added to a piece later (symbol, rim cosmetic, water mark)
                        if (n.matches(DISC) || (n.tagName === 'image' && isBead(n.parentNode))) redo.add(n.parentNode);
                        else if (n.parentNode.querySelector(':scope > .puck-under')) liftOne(n, n.parentNode);
                    } else n.querySelectorAll?.(PIECES).forEach(p => redo.add(p));
                }
            }
            redo.forEach(decorate);
        }).observe(vp, { subtree: true, childList: true, attributes: true, attributeFilter: ['fill', 'stroke', 'href'] });
        all(decorate);
        // Board rotation / tilt: cheap check, only touches pieces when they changed.
        setInterval(() => {
            const r = typeof window.getBoardRotation === 'function' ? window.getBoardRotation() : 0;
            const t = window._boardTiltDegrees || 0;
            if (r === rot && t === tilt) return;
            rot = r; tilt = t;
            if (on) all(refresh);
        }, 150);
    }

    function set(value) {
        on = !!value;
        try { localStorage.setItem(KEY, on ? 'on' : 'off'); } catch (e) {}
        all(on ? decorate : undecorate);
    }

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
