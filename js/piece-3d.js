// 3D pieces: pawns drawn as real pucks (short cylinders), stones as half
// glass beads (a clear dome with the symbol inside). window.Piece3D
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
// Stones (beads): the stone's own circle is made see-through (still catches
// the mouse) and .puck-under draws the dome in its colours instead: body,
// round shading, a glow of the element colour on the side away from the light
// (light through glass). .puck-over goes on top of the symbol: the shine. The
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
            '<stop offset="0" stop-color="#fff" stop-opacity="0.16"/>' +
            '<stop offset="0.55" stop-color="#000" stop-opacity="0"/>' +
            '<stop offset="0.85" stop-color="#000" stop-opacity="0.32"/>' +
            '<stop offset="1" stop-color="#000" stop-opacity="0.6"/></radialGradient>' +
            '<radialGradient id="bead-spec" cx="0.5" cy="0.5" r="0.5">' +
            '<stop offset="0" stop-color="#fff" stop-opacity="0.95"/>' +
            '<stop offset="0.4" stop-color="#fff" stop-opacity="0.55"/>' +
            '<stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>' +
            '<radialGradient id="bead-glow" cx="0.5" cy="0.5" r="0.5">' +
            '<stop offset="0" stop-color="#fff" stop-opacity="0.75"/>' +
            '<stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>' +
            '<mask id="bead-glow-mask" maskContentUnits="objectBoundingBox"><rect width="1" height="1" fill="url(#bead-glow)"/></mask>' +
            '<radialGradient id="puck-shadow" cx="0.5" cy="0.5" r="0.5">' +
            '<stop offset="0.55" stop-color="#000" stop-opacity="0.45"/>' +
            '<stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>';
        svg.insertBefore(defs, svg.firstChild);
    }

    function mainDisc(g) { return g.querySelector(':scope > ' + DISC.split(', ').join(', :scope > ')); }

    const isBead = g => g.classList.contains('stone');

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
        under.appendChild(el('circle', { cx: r * 0.15, cy: 1.5, r: r * 1.3, fill: 'url(#puck-shadow)' }));
        under.appendChild(el('path', { class: 'puck-side', d, fill }));
        // light through the glass gathers low right, away from the light
        under.appendChild(el('ellipse', { cx: r * 0.2, cy: r * 0.38 - lift * 0.2, rx: r * 0.7, ry: r * 0.48, fill: edge, mask: 'url(#bead-glow-mask)' }));
        under.appendChild(el('path', { d, fill: 'url(#bead-body)' }));
        under.appendChild(el('path', { class: 'bead-edge', d, fill: 'none', stroke: '#000', 'stroke-opacity': 0.6, 'stroke-width': 1 }));
        under.appendChild(el('path', { d: `M ${-r * 0.92} ${-lift * 0.35} A ${r} ${r + lift} 0 0 1 ${r * 0.92} ${-lift * 0.35}`,
            fill: 'none', stroke: edge, 'stroke-opacity': 0.55, 'stroke-width': 0.8 }));
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
        if (isBead(g)) return buildBeadOver(g, over);
        const { r, lift } = dims(g);
        over.innerHTML = '';
        const face = { cx: 0, cy: -lift, r };
        over.appendChild(el('circle', { ...face, fill: 'url(#puck-rim)' }));
        over.appendChild(el('circle', { ...face, fill: 'url(#puck-shine)' }));
    }

    // Lift a piece's own parts (disc, symbol, rim cosmetics, ...) onto the top face.
    function liftOne(n, g) {
        if (n.nodeType !== 1 || n.classList.contains('puck-under') || n.classList.contains('puck-over')) return;
        if (n.classList.contains('pawn-cos-base') || n.tagName === 'title' || n.tagName === 'defs') return;
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
        n.style.fillOpacity = ''; n.style.strokeOpacity = '';
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
    }

    function undecorate(g) {
        g.querySelectorAll(':scope > .puck-under, :scope > .puck-over').forEach(n => n.remove());
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
                    // a water stone copying a neighbour changes colour (fill / stroke)
                    if (m.target.matches?.(DISC) && m.target.parentNode?.matches?.(PIECES)) redo.add(m.target.parentNode);
                    continue;
                }
                for (const n of m.addedNodes) {
                    if (n.nodeType !== 1) continue;
                    if (n.matches?.(PIECES)) redo.add(n);
                    else if (n.parentNode?.matches?.(PIECES)) {
                        // a part added to a piece later (symbol, rim cosmetic, water mark)
                        if (n.matches(DISC)) redo.add(n.parentNode);
                        else if (n.parentNode.querySelector(':scope > .puck-under')) liftOne(n, n.parentNode);
                    } else n.querySelectorAll?.(PIECES).forEach(p => redo.add(p));
                }
            }
            redo.forEach(decorate);
        }).observe(vp, { subtree: true, childList: true, attributes: true, attributeFilter: ['fill', 'stroke'] });
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
