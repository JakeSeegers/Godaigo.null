// 3D pieces: pawns and stones drawn as real pucks (short cylinders seen from
// a slight angle). window.Piece3D
//
// No game hooks: a MutationObserver on the board (#viewport) decorates every
// pawn (g.player) and stone (g.stone) when it appears. Each piece gets:
// - under it (.puck-under): a soft ground shadow and the puck's side, a band
//   with a bottom curve, shaded left to right so it reads as round;
// - its own disc, symbol and extras lifted to the top of the puck and pressed
//   into a flat oval (the top face), with a rim shade and a highlight
//   (.puck-over) over the face, still under the element symbol.
// Pawn bases (pawn-cosmetics.js .pawn-cos-base) stay on the ground.
// Everything is turned against the board rotation (window.getBoardRotation), so
// the side always shows at the bottom of the screen; the symbol keeps the
// board's turn. With the board tilt on, the oval is pressed less (the tilt
// already does part of it). All extras ignore the mouse.
// Setting: Settings > Display "3D Pieces" (localStorage godaigo_3d_pieces =
// 'off' turns it off).
(function () {
    'use strict';
    const NS = 'http://www.w3.org/2000/svg';
    const KEY = 'godaigo_3d_pieces';
    const PIECES = 'g.player, g.stone';
    const DISC = 'circle.player-marker, circle.stone-piece';
    const SQUASH = 0.68;   // top face height / width, board flat
    const SIDE = 0.5;      // side band height / radius
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
            '<radialGradient id="puck-shadow" cx="0.5" cy="0.5" r="0.5">' +
            '<stop offset="0.55" stop-color="#000" stop-opacity="0.45"/>' +
            '<stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>';
        svg.insertBefore(defs, svg.firstChild);
    }

    function mainDisc(g) { return g.querySelector(':scope > ' + DISC.split(', ').join(', :scope > ')); }

    function squash() {
        const c = Math.cos((tilt || 0) * Math.PI / 180);
        return Math.min(1, Math.max(SQUASH, SQUASH / (c || 1)));
    }

    // Size of the puck for this piece (screen units before zoom).
    function dims(g) {
        const disc = mainDisc(g);
        const r = parseFloat(disc?.getAttribute('r')) || 10;
        return { r, k: squash(), h: r * SIDE };
    }

    // Shapes under the piece, drawn in screen direction (rotate(-rot)).
    function buildUnder(g, under) {
        const { r, k, h } = dims(g);
        const fill = mainDisc(g)?.getAttribute('fill') || '#888';
        const top = -h / 2, bot = h / 2, ry = r * k;
        const band = `M ${-r} ${top} L ${-r} ${bot} A ${r} ${ry} 0 0 0 ${r} ${bot} L ${r} ${top} Z`;
        under.innerHTML = '';
        under.appendChild(el('ellipse', { cx: r * 0.12, cy: bot + 1.5, rx: r * 1.25, ry: ry * 1.2, fill: 'url(#puck-shadow)' }));
        under.appendChild(el('path', { class: 'puck-side', d: band, fill }));
        under.appendChild(el('path', { d: band, fill: 'url(#puck-band)' }));
        // thin dark line along the bottom edge
        under.appendChild(el('path', { d: `M ${-r} ${bot} A ${r} ${ry} 0 0 0 ${r} ${bot}`, fill: 'none', stroke: '#000', 'stroke-opacity': 0.55, 'stroke-width': 1 }));
    }

    function buildOver(g, over) {
        const { r, k, h } = dims(g);
        over.innerHTML = '';
        const face = { cx: 0, cy: -h / 2, rx: r, ry: r * k };
        over.appendChild(el('ellipse', { ...face, fill: 'url(#puck-rim)' }));
        over.appendChild(el('ellipse', { ...face, fill: 'url(#puck-shine)' }));
    }

    // Lift a piece's own parts (disc, symbol, rim cosmetics, ...) onto the top face.
    function liftOne(n, g) {
        if (n.nodeType !== 1 || n.classList.contains('puck-under') || n.classList.contains('puck-over')) return;
        if (n.classList.contains('pawn-cos-base') || n.tagName === 'title' || n.tagName === 'defs') return;
        if (!n.hasAttribute('data-p3d')) n.setAttribute('data-p3d', n.getAttribute('transform') || '');
        const { k, h } = dims(g);
        const orig = n.getAttribute('data-p3d');
        const t = `rotate(${-rot}) translate(0 ${-h / 2}) scale(1 ${k.toFixed(3)}) rotate(${rot})` + (orig ? ' ' + orig : '');
        n.setAttribute('transform', t);
        if (n.matches(DISC)) n.style.vectorEffect = 'non-scaling-stroke';
    }

    function unliftOne(n) {
        if (n.nodeType !== 1 || !n.hasAttribute('data-p3d')) return;
        const orig = n.getAttribute('data-p3d');
        if (orig) n.setAttribute('transform', orig); else n.removeAttribute('transform');
        n.removeAttribute('data-p3d');
        n.style.vectorEffect = '';
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
            mainDisc(g).after(over);
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
                    // a water stone copying a neighbour changes colour
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
        }).observe(vp, { subtree: true, childList: true, attributes: true, attributeFilter: ['fill'] });
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
