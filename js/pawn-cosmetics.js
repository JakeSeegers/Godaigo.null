// pawn-cosmetics.js: draws bought pawn decorations on the board.
//
// Three slots per player (sql/pawn-cosmetics.sql, shop items in
// js/cosmetics-system.js PAWN_ITEMS):
//   rim   - a ring just outside the pawn's black outline
//   base  - a shape under the pawn (drawn first, so it sits behind it)
//   trail - small particles that fade out behind a moving pawn
// House rule for all of them: never cover or tint the pawn's colour. The
// pawn is a circle of radius TILE_SIZE * 0.4 (8); the activated-element
// symbols sit around it at TILE_SIZE * 0.75 (15), so rims and bases stay
// inside that gap.
//
// No hooks in the game code: a light watcher looks at playerPositions.
// Every 500 ms it (re)decorates any pawn whose equipped items changed, and
// every 50 ms it compares each pawn's position with the last one; a move
// leaves a trail. That covers local moves, other players, bots and replays.
(function () {
    const NS = 'http://www.w3.org/2000/svg';
    const reduceMotion = () => {
        try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; }
    };

    function el(tag, attrs, parent) {
        const n = document.createElementNS(NS, tag);
        Object.entries(attrs || {}).forEach(([k, v]) => n.setAttribute(k, v));
        if (parent) parent.appendChild(n);
        return n;
    }

    function hexPoints(R, dy) {
        const pts = [];
        for (let i = 0; i < 6; i++) {
            const a = Math.PI / 180 * (60 * i - 30);
            pts.push(`${(R * Math.cos(a)).toFixed(2)},${(R * Math.sin(a) + (dy || 0)).toFixed(2)}`);
        }
        return pts.join(' ');
    }

    // ── Rims ─────────────────────────────────────────────────────
    function makeRim(id, r) {
        const g = el('g', { class: 'pawn-cos pawn-cos-rim', 'pointer-events': 'none' });
        const R = r + 1.6;
        if (id === 'pawn_rim_gold' || id === 'pawn_rim_silver') {
            const gold = id === 'pawn_rim_gold';
            el('circle', { cx: 0, cy: 0, r: R, fill: 'none', stroke: gold ? '#c9961a' : '#aeb7c0', 'stroke-width': 2 }, g);
            el('circle', { cx: 0, cy: 0, r: R, fill: 'none', stroke: gold ? '#fff0a8' : '#ffffff',
                'stroke-width': 0.7, 'stroke-dasharray': '3 5', opacity: 0.9 }, g);
        } else if (id === 'pawn_rim_plunger') {
            // Hermit reward (stream 2026-09-30): the plunger's red, #9d2c2e.
            el('circle', { cx: 0, cy: 0, r: R + 0.3, fill: 'none', stroke: '#1a0a0a', 'stroke-width': 3 }, g);
            el('circle', { cx: 0, cy: 0, r: R + 0.3, fill: 'none', stroke: '#9d2c2e', 'stroke-width': 2 }, g);
            el('path', { d: `M${(-R * 0.7).toFixed(2)},${(-R * 0.7).toFixed(2)} A${R + 0.3},${R + 0.3} 0 0 1 ${(R * 0.2).toFixed(2)},${(-R - 0.2).toFixed(2)}`,
                fill: 'none', stroke: '#d9686a', 'stroke-width': 0.7, 'stroke-linecap': 'round', opacity: 0.9 }, g);
        } else if (id === 'pawn_rim_runes') {
            el('circle', { cx: 0, cy: 0, r: R, fill: 'none', stroke: '#2b2233', 'stroke-width': 2.2 }, g);
            const ring = el('circle', { cx: 0, cy: 0, r: R, fill: 'none', stroke: '#e8d9a8',
                'stroke-width': 1.4, 'stroke-dasharray': '1.2 1.6 2.6 1.6' }, g);
            if (!reduceMotion()) {
                el('animateTransform', { attributeName: 'transform', type: 'rotate',
                    from: '0 0 0', to: '360 0 0', dur: '14s', repeatCount: 'indefinite' }, ring);
            }
        } else {
            return null;
        }
        return g;
    }

    // ── Bases ────────────────────────────────────────────────────
    function makeBase(id, r) {
        const g = el('g', { class: 'pawn-cos pawn-cos-base', 'pointer-events': 'none' });
        const R = r * (id === 'pawn_base_lotus' ? 1.7 : 1.5);
        if (id === 'pawn_base_lotus') {
            // Lily pad with a notch, slightly below the pawn like it floats on it.
            const a1 = -Math.PI / 2 + 0.3, a2 = -Math.PI / 2 - 0.3, dy = 3;
            const d = `M0,${dy} L${(R * Math.cos(a1)).toFixed(2)},${(R * Math.sin(a1) + dy).toFixed(2)} ` +
                      `A${R},${R} 0 1 1 ${(R * Math.cos(a2)).toFixed(2)},${(R * Math.sin(a2) + dy).toFixed(2)} Z`;
            el('path', { d, fill: '#3f8a4a', stroke: '#1d4a25', 'stroke-width': 0.8 }, g);
            [0.6, 1.4, 2.2, 3.0, 3.8, 4.6].forEach(a => {
                el('line', { x1: 0, y1: dy, x2: (R * 0.85 * Math.cos(a)).toFixed(2), y2: (R * 0.85 * Math.sin(a) + dy).toFixed(2),
                    stroke: '#6cbf6a', 'stroke-width': 0.4, opacity: 0.7 }, g);
            });
        } else if (id === 'pawn_base_plinth') {
            el('polygon', { points: hexPoints(R, 2.2), fill: '#4a4740' }, g);
            el('polygon', { points: hexPoints(R, 0.6), fill: '#9b978c', stroke: '#4a4740', 'stroke-width': 0.8 }, g);
            el('polygon', { points: hexPoints(R * 0.78, 0.6), fill: 'none', stroke: '#c4c0b4', 'stroke-width': 0.5 }, g);
        } else {
            return null;
        }
        return g;
    }

    // ── Decorate pawns ───────────────────────────────────────────
    function decorate(group, style) {
        group.querySelectorAll(':scope > .pawn-cos').forEach(n => n.remove());
        const marker = group.querySelector('.player-marker');
        if (!marker) return;
        const r = parseFloat(marker.getAttribute('r')) || 8;
        const base = style.base && makeBase(style.base, r);
        if (base) group.insertBefore(base, group.firstChild);
        const rim = style.rim && makeRim(style.rim, r);
        if (rim) marker.after(rim);
    }

    function pawns() {
        try { return (typeof playerPositions !== 'undefined' && Array.isArray(playerPositions)) ? playerPositions : []; }
        catch (e) { return []; }
    }

    function styleFor(i) {
        return window.cosmeticsSystem?.pawnStyleForSeat?.(i) || {};
    }

    function refresh() {
        pawns().forEach((p, i) => {
            const group = p?.element;
            if (!group || !group.isConnected) return;
            const st = styleFor(i);
            const key = `${st.rim || ''}|${st.base || ''}`;
            if (group.dataset.pawnCos === key) return;
            group.dataset.pawnCos = key;
            decorate(group, st);
        });
    }

    // ── Trails ───────────────────────────────────────────────────
    const TRAILS = {
        pawn_trail_ink:    { color: '#141418', shape: 'blot',  opacity: 0.8,  drift: 0, edge: 'rgba(225,225,255,0.45)' },
        pawn_trail_embers: { color: '#ffae42', shape: 'spark', opacity: 0.95, drift: -4, glow: '#ff5a00' },
        pawn_trail_drops:  { color: '#6fb6ff', shape: 'drop',  opacity: 0.85, drift: 2 },
        pawn_trail_leaves: { color: '#6cbf4a', shape: 'leaf',  opacity: 0.9,  drift: 3 },
        pawn_trail_void:   { color: '#b98cff', shape: 'spark', opacity: 0.9,  drift: 0, glow: '#6a34c0' },
        // Hermit reward: wet footprints, left and right in turn, facing the way
        // the pawn walks; they dry up slowly and do not drift.
        pawn_trail_wetfeet: { color: '#7fb8e8', shape: 'foot', opacity: 0.8, drift: 0, step: 6, life: 1800 },
    };
    const footSide = new Map(); // playerIndex -> 1 / -1 (next foot)
    const MAX_PARTICLES = 80;
    const last = new Map(); // playerIndex -> {x, y}
    let alive = 0;

    function trailLayer(group) {
        const parent = group.parentNode;
        if (!parent) return null;
        let layer = parent.querySelector(':scope > .pawn-trail-layer');
        if (!layer) {
            layer = el('g', { class: 'pawn-trail-layer', 'pointer-events': 'none' });
            const firstPawn = parent.querySelector(':scope > g.player');
            parent.insertBefore(layer, firstPawn || null);
        }
        return layer;
    }

    // One footprint: a sole and a heel, drawn pointing along +x.
    function footShape(color) {
        const f = el('g', {});
        el('ellipse', { cx: 0.7, cy: 0, rx: 1.5, ry: 0.85, fill: color }, f);
        el('ellipse', { cx: -1.35, cy: 0, rx: 0.75, ry: 0.65, fill: color }, f);
        return f;
    }

    // foot = { angle (degrees), side (1 / -1) } for footprints.
    function spawn(layer, t, x, y, delay, foot) {
        if (alive >= MAX_PARTICLES) return;
        if (t.shape === 'foot' && foot) {
            const a = foot.angle * Math.PI / 180, off = 1.4 * foot.side;
            const px = x - Math.sin(a) * off, py = y + Math.cos(a) * off;
            const outer = el('g', { transform: `translate(${px.toFixed(1)} ${py.toFixed(1)})` });
            const mover = el('g', {}, outer);
            const n = footShape(t.color);
            n.setAttribute('transform', `rotate(${foot.angle.toFixed(0)})`);
            mover.appendChild(n);
            mover.style.opacity = '0';
            layer.appendChild(outer);
            alive++;
            setTimeout(() => {
                let anim = null;
                try {
                    anim = mover.animate([{ opacity: t.opacity }, { opacity: t.opacity * 0.8, offset: 0.4 }, { opacity: 0 }],
                        { duration: t.life || 1500, easing: 'ease-in' });
                } catch (e) {}
                const done = () => { outer.remove(); alive--; };
                if (anim) anim.onfinish = done; else setTimeout(done, t.life || 1500);
            }, delay);
            return;
        }
        const jx = (Math.random() - 0.5) * 4, jy = (Math.random() - 0.5) * 4;
        let n;
        const s = 0.8 + Math.random() * 0.7;
        if (t.shape === 'blot') n = el('circle', { r: (1.6 * s).toFixed(2), fill: t.color, stroke: t.edge || 'none', 'stroke-width': 0.4 });
        else if (t.shape === 'spark') n = el('circle', { r: (0.9 * s).toFixed(2), fill: t.color });
        else if (t.shape === 'drop') n = el('ellipse', { rx: (1.1 * s).toFixed(2), ry: (1.6 * s).toFixed(2), fill: t.color });
        else n = el('ellipse', { rx: (2.2 * s).toFixed(2), ry: (0.9 * s).toFixed(2), fill: t.color });
        // outer: position (attribute), mover: animated with CSS transform
        // (which would override a transform attribute), n: the shape, rotated.
        n.setAttribute('transform', `rotate(${Math.round(Math.random() * 360)})`);
        if (t.glow) n.style.filter = `drop-shadow(0 0 1.5px ${t.glow})`;
        const outer = el('g', { transform: `translate(${(x + jx).toFixed(1)} ${(y + jy).toFixed(1)})` });
        const mover = el('g', {}, outer);
        mover.appendChild(n);
        mover.style.opacity = '0';
        layer.appendChild(outer);
        alive++;
        const dx = (Math.random() - 0.5) * 3, dy = t.drift + (Math.random() - 0.5) * 2;
        setTimeout(() => {
            let anim = null;
            try {
                anim = mover.animate([
                    { opacity: t.opacity, transform: 'translate(0px, 0px)' },
                    { opacity: 0, transform: `translate(${dx}px, ${dy}px)` },
                ], { duration: 750, easing: 'ease-out' });
            } catch (e) {}
            const done = () => { outer.remove(); alive--; };
            if (anim) anim.onfinish = done; else setTimeout(done, 750);
        }, delay);
    }

    function watchMoves() {
        let dragging = false;
        try { dragging = typeof isDraggingPlayer !== 'undefined' && isDraggingPlayer; } catch (e) {}
        pawns().forEach((p, i) => {
            if (!p || !p.element) { last.delete(i); return; }
            const m = /translate\(\s*([-\d.]+)[ ,]+([-\d.]+)/.exec(p.element.getAttribute('transform') || '');
            if (!m) return;
            const x = +m[1], y = +m[2];
            const prev = last.get(i);
            last.set(i, { x, y });
            if (!prev || dragging || reduceMotion()) return;
            const dist = Math.hypot(x - prev.x, y - prev.y);
            if (dist < 0.5 || dist > 400) return; // no move, or a jump (board reset / teleport)
            const t = TRAILS[styleFor(i).trail];
            if (!t) return;
            const layer = trailLayer(p.element);
            if (!layer) return;
            const count = Math.min(10, Math.max(1, Math.round(dist / (t.step || 7))));
            const angle = Math.atan2(y - prev.y, x - prev.x) * 180 / Math.PI;
            for (let k = 0; k < count; k++) {
                const f = (k + 0.5) / count;
                let foot = null;
                if (t.shape === 'foot') {
                    const side = footSide.get(i) || 1;
                    footSide.set(i, -side);
                    foot = { angle, side };
                }
                spawn(layer, t, prev.x + (x - prev.x) * f, prev.y + (y - prev.y) * f, Math.round(f * 120), foot);
            }
        });
    }

    // Paused while the tab is hidden (saves CPU for streamers running OBS).
    // Forget old positions then, so coming back does not spawn one big trail.
    setInterval(() => { if (!document.hidden) refresh(); }, 500);
    setInterval(() => {
        if (document.hidden) { last.clear(); return; }
        watchMoves();
    }, 50);

    // ── Shop preview: a small pawn with the item on it ───────────
    function previewSvg(id) {
        const slot = id.startsWith('pawn_rim_') ? 'rim' : id.startsWith('pawn_base_') ? 'base' : 'trail';
        const r = 8;
        const svg = el('svg', { viewBox: '-16 -16 32 32', width: 36, height: 36, style: 'overflow:visible;display:block;margin:auto;' });
        if (slot === 'base') { const b = makeBase(id, r); if (b) svg.appendChild(b); }
        if (slot === 'trail') {
            const t = TRAILS[id];
            if (t && t.shape === 'foot') [[-19, 3, 1], [-15, 3, -1], [-11, 3, 1]].forEach(([x, y, side], k) => {
                const n = footShape(t.color);
                n.setAttribute('transform', `translate(${x} ${y + side * 1.4}) scale(1.2)`);
                n.setAttribute('opacity', (0.45 + k * 0.2).toFixed(2));
                svg.appendChild(n);
            });
            else if (t) [[-13, 6], [-10, 3], [-7, 5], [-4, 2]].forEach(([x, y], k) => {
                const n = t.shape === 'leaf' ? el('ellipse', { cx: x, cy: y, rx: 2, ry: 0.9, fill: t.color, transform: `rotate(${k * 40} ${x} ${y})` })
                        : t.shape === 'drop' ? el('ellipse', { cx: x, cy: y, rx: 1.1, ry: 1.6, fill: t.color })
                        : el('circle', { cx: x, cy: y, r: t.shape === 'blot' ? 1.6 : 1, fill: t.color, stroke: t.edge || 'none', 'stroke-width': 0.4 });
                n.setAttribute('opacity', (0.35 + k * 0.18).toFixed(2));
                svg.appendChild(n);
            });
        }
        el('circle', { cx: 0, cy: 0, r, fill: '#9458f4', stroke: '#000', 'stroke-width': 2 }, svg);
        if (slot === 'rim') { const rim = makeRim(id, r); if (rim) svg.appendChild(rim); }
        return svg.outerHTML;
    }

    window.PawnCosmetics = { refresh, previewSvg };
})();
