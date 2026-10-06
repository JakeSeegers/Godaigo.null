// 3D pieces: pawns and stones drawn like thick pucks. window.Piece3D
//
// No game hooks: a MutationObserver on the board (#viewport) decorates every
// pawn (g.player) and stone (g.stone) when it appears. Each piece gets, under
// its disc: a soft shadow and a darker copy of the disc moved down a little
// (the puck's side); over its face: a darker rim and a highlight, but still
// under the element symbol. The extras turn against the board rotation
// (window.getBoardRotation), so the side always shows at the bottom of the
// screen and the light comes from the top left. All extras ignore the mouse.
// Setting: Settings > Display "3D pieces" (localStorage godaigo_3d_pieces =
// 'off' turns it off).
(function () {
    'use strict';
    const NS = 'http://www.w3.org/2000/svg';
    const KEY = 'godaigo_3d_pieces';
    const PIECES = 'g.player, g.stone';
    let on = (() => { try { return localStorage.getItem(KEY) !== 'off'; } catch (e) { return true; } })();
    let rot = 0;

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
            '<radialGradient id="puck-shine" cx="0.36" cy="0.3" r="0.62">' +
            '<stop offset="0" stop-color="#fff" stop-opacity="0.55"/>' +
            '<stop offset="0.45" stop-color="#fff" stop-opacity="0.12"/>' +
            '<stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>' +
            '<radialGradient id="puck-rim" cx="0.5" cy="0.5" r="0.5">' +
            '<stop offset="0.68" stop-color="#000" stop-opacity="0"/>' +
            '<stop offset="1" stop-color="#000" stop-opacity="0.38"/></radialGradient>';
        svg.insertBefore(defs, svg.firstChild);
    }

    function mainDisc(g) {
        return g.querySelector(':scope > circle.player-marker, :scope > circle.stone-piece');
    }

    function decorate(g) {
        if (!on || g.querySelector(':scope > .puck-under')) return;
        const disc = mainDisc(g);
        if (!disc) return;
        ensureDefs();
        const r = parseFloat(disc.getAttribute('r')) || 10;
        const depth = Math.max(2, r * 0.3);
        const fill = disc.getAttribute('fill') || '#888';
        const under = el('g', { class: 'puck-under' });
        under.appendChild(el('ellipse', { cx: 0, cy: depth + 1.5, rx: r * 1.02, ry: r * 0.92, fill: '#000', 'fill-opacity': 0.32 }));
        under.appendChild(el('circle', { class: 'puck-side', cx: 0, cy: depth, r, fill }));
        under.appendChild(el('circle', { cx: 0, cy: depth, r, fill: '#000', 'fill-opacity': 0.42 }));
        const over = el('g', { class: 'puck-over' });
        over.appendChild(el('circle', { cx: 0, cy: 0, r, fill: 'url(#puck-rim)' }));
        over.appendChild(el('circle', { cx: 0, cy: 0, r, fill: 'url(#puck-shine)' }));
        g.insertBefore(under, disc);
        disc.after(over);
        turn(g);
    }

    function undecorate(g) {
        g.querySelectorAll(':scope > .puck-under, :scope > .puck-over').forEach(n => n.remove());
    }

    function turn(g) {
        const t = rot ? `rotate(${-rot})` : null;
        g.querySelectorAll(':scope > .puck-under, :scope > .puck-over').forEach(n => {
            if (t) n.setAttribute('transform', t); else n.removeAttribute('transform');
        });
    }

    function all(fn) { document.querySelectorAll('#viewport ' + PIECES.split(', ').join(', #viewport ')).forEach(fn); }

    // The side takes the disc's colour (a water stone that copies its neighbour
    // changes colour, a pawn cosmetic may too).
    function syncFill(disc) {
        const g = disc.parentNode;
        const side = g && g.querySelector(':scope > .puck-under > .puck-side');
        if (side) side.setAttribute('fill', disc.getAttribute('fill') || '#888');
    }

    function watch() {
        const vp = document.getElementById('viewport');
        if (!vp) { setTimeout(watch, 500); return; }
        new MutationObserver(list => {
            if (!on) return;
            for (const m of list) {
                if (m.type === 'attributes') {
                    if (m.target.matches?.('circle.player-marker, circle.stone-piece')) syncFill(m.target);
                    continue;
                }
                for (const n of m.addedNodes) {
                    if (n.nodeType !== 1) continue;
                    if (n.matches?.(PIECES)) decorate(n);
                    else if (n.matches?.('circle.player-marker, circle.stone-piece') && n.parentNode?.matches?.(PIECES)) decorate(n.parentNode);
                    else n.querySelectorAll?.(PIECES).forEach(decorate);
                }
            }
        }).observe(vp, { subtree: true, childList: true, attributes: true, attributeFilter: ['fill'] });
        all(decorate);
        // Board rotation: cheap check, only touches pieces when the angle changed.
        setInterval(() => {
            const now = typeof window.getBoardRotation === 'function' ? window.getBoardRotation() : 0;
            if (now === rot) return;
            rot = now;
            if (on) all(turn);
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
