// "Your Turn" banner (owner 2026-10-09): when your turn starts in an online game,
// three thick diagonal stripes in your colour sweep across the screen (a wind
// whoosh each), with YOUR TURN cut out of them. Once all three are drawn, black
// outlines snap on around the stripes and the letters. It stays until the mouse
// moves (or a key, click, wheel or touch), then plays backwards and goes. It also
// goes when the turn ends or the game is left.
// Never takes the mouse (pointer-events none). Watches the turn every 150 ms, no
// game hooks. Skipped in replays (myPlayerIndex -1), while a saved game is being
// rebuilt, during placement, and when window.fxOn() is false (quiet test games,
// muted training). A hidden tab waits: the banner plays when you come back, if it
// is still your turn.
(function () {
    'use strict';
    const NS = 'http://www.w3.org/2000/svg';
    const TILT = -12;                // degrees
    const SWEEP = 190, STAGGER = 120, OUTLINE_AT = 520, REVERSE_RATE = 1.4;
    let lastShownTurn = null, playing = false, dismiss = null;

    function myRealIndex() {
        const d = window.BotDriver?.driverRealIndex?.();
        if (d != null) return d;
        return (typeof myPlayerIndex !== 'undefined') ? myPlayerIndex : null;
    }
    function isMyTurnNow() {
        try {
            if (!document.getElementById('game-layout')?.classList.contains('active')) return false;
            if (typeof isMultiplayer === 'undefined' || !isMultiplayer) return false;
            if (typeof isPlacementPhase !== 'undefined' && isPlacementPhase) return false;
            if (window.SaveGame?.isRebuilding?.()) return false;
            const me = myRealIndex();
            return me != null && me >= 0 && me === activePlayerIndex;
        } catch (e) { return false; }
    }
    function myColor() {
        try {
            const me = myRealIndex();
            const p = (typeof allPlayersData !== 'undefined' ? allPlayersData : []).find(q => q.player_index === me);
            if (p && typeof PLAYER_COLORS !== 'undefined' && PLAYER_COLORS[p.color]) return PLAYER_COLORS[p.color];
        } catch (e) {}
        return '#d9b08c';
    }
    function whoosh(delay) {
        setTimeout(() => {
            try {
                if (window.gameSoundEnabled === false) return;
                const a = new Audio('sounds/windactivates.mp3');
                a.volume = 0.55;
                a.playbackRate = 1.15;
                a.play().catch(() => {});
            } catch (e) {}
        }, delay);
    }

    function el(tag, attrs, parent) {
        const e = document.createElementNS(NS, tag);
        for (const k in attrs) e.setAttribute(k, attrs[k]);
        if (parent) parent.appendChild(e);
        return e;
    }

    function play() {
        if (playing) return;
        playing = true;
        const W = window.innerWidth, H = window.innerHeight;
        const color = myColor();
        const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

        const svg = el('svg', { id: 'turn-banner', class: 'no-i18n', translate: 'no', width: W, height: H, viewBox: `0 0 ${W} ${H}`, 'aria-hidden': 'true' });
        svg.style.cssText = 'position:fixed;inset:0;z-index:9000;pointer-events:none;overflow:visible';
        const defs = el('defs', {}, svg);

        // stripe geometry, in a group turned around the screen centre
        const band = Math.max(54, Math.min(H * 0.12, W * 0.09));
        const gap = band * 0.2;
        const len = Math.hypot(W, H) * 1.3;
        const ys = [-band * 1.5 - gap, -band / 2, band / 2 + gap];
        const text = window.I18n?.lang === 'es' ? 'TU TURNO' : 'YOUR TURN';
        const fontSize = band * 1.25;

        // the cut-out letters: a mask (white = stripe shows, black text = hole)
        const mask = el('mask', { id: 'tb-mask', maskUnits: 'userSpaceOnUse', x: -len, y: -len, width: len * 2, height: len * 2 }, defs);
        el('rect', { x: -len, y: -len, width: len * 2, height: len * 2, fill: '#fff' }, mask);
        const textAttrs = {
            x: 0, y: 0, 'text-anchor': 'middle', 'dominant-baseline': 'central',
            'font-family': "'BoldBrush', Impact, 'Arial Black', sans-serif", 'font-size': fontSize,
            'letter-spacing': fontSize * 0.04,
        };
        const maskText = el('text', { ...textAttrs, fill: '#000' }, mask);
        maskText.textContent = text;
        // the letters' outline only shows on the stripes
        const clip = el('clipPath', { id: 'tb-clip' }, defs);
        ys.forEach(y => el('rect', { x: -len / 2, y, width: len, height: band }, clip));

        const g = el('g', { transform: `translate(${W / 2} ${H / 2}) rotate(${TILT})` }, svg);
        const inner = el('g', {}, g);           // punch + exit move this one
        const outlines = el('g', { opacity: 0 }, inner);
        ys.forEach(y => el('rect', { x: -len / 2, y, width: len, height: band, fill: 'none', stroke: '#000', 'stroke-width': 7 }, outlines));
        const fills = el('g', { mask: 'url(#tb-mask)' }, inner);
        const stripes = ys.map((y, i) => el('rect', { x: -len / 2, y, width: len, height: band, fill: color }, fills));
        // a light edge along the top of each stripe
        const shine = el('g', { mask: 'url(#tb-mask)', opacity: 0.35 }, inner);
        const shines = ys.map(y => el('rect', { x: -len / 2, y, width: len, height: band * 0.18, fill: '#fff' }, shine));
        const letterLine = el('text', { ...textAttrs, fill: 'none', stroke: '#000', 'stroke-width': Math.max(4, fontSize * 0.03), 'clip-path': 'url(#tb-clip)', opacity: 0 }, inner);
        letterLine.textContent = text;
        document.body.appendChild(svg);

        // the words must fit the screen
        try {
            const tw = maskText.getComputedTextLength();
            if (tw > W * 0.86) {
                const s = (W * 0.86) / tw;
                [maskText, letterLine].forEach(t => t.setAttribute('font-size', fontSize * s));
            }
        } catch (e) {}

        const done = () => { svg.remove(); playing = false; dismiss = null; };
        // after the intro the banner stays until the mouse moves (or a key / click / wheel / touch);
        // then the whole intro plays backwards (outlines off, stripes pull back, last one first)
        let leaving = false;
        function waitForInput(onGo) {
            let x0 = null, y0 = null;
            const off = () => EVENTS.forEach(([t, f]) => window.removeEventListener(t, f, true));
            let gone = false;
            const go = () => { if (gone) return; gone = true; off(); onGo(); };
            const move = (e) => {
                if (x0 == null) { x0 = e.clientX; y0 = e.clientY; return; }
                if (Math.hypot(e.clientX - x0, e.clientY - y0) > 6) go();
            };
            const EVENTS = [['pointermove', move], ['pointerdown', go], ['keydown', go], ['wheel', go], ['touchstart', go]];
            EVENTS.forEach(([t, f]) => window.addEventListener(t, f, { capture: true, passive: true }));
            dismiss = go;
        }
        if (reduce) {
            outlines.setAttribute('opacity', 1); letterLine.setAttribute('opacity', 1);
            svg.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 250 }).onfinish = () => waitForInput(() => {
                svg.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 250, fill: 'forwards' }).onfinish = done;
            });
            return;
        }

        // every intro animation ends at TOTAL (endDelay), so reverse() mirrors the whole intro
        const TOTAL = OUTLINE_AT + 260;
        const intro = [];
        const anim = (target, frames, o) => {
            const a = target.animate(frames, { ...o, endDelay: TOTAL - (o.delay || 0) - o.duration });
            intro.push(a);
            return a;
        };
        // 1) stripes sweep in, alternating sides, each with a whoosh
        stripes.forEach((r, i) => {
            const fromLeft = i % 2 === 0;
            const parts = [r, shines[i]];
            parts.forEach(p => {
                p.style.transformBox = 'fill-box';
                p.style.transformOrigin = fromLeft ? 'left center' : 'right center';
                anim(p, [
                    { transform: 'scaleX(0)' },
                    { transform: 'scaleX(1.02)', offset: 0.8 },
                    { transform: 'scaleX(1)' },
                ], { duration: SWEEP, delay: i * STAGGER, easing: 'cubic-bezier(.2,.9,.25,1)', fill: 'both' });
            });
            whoosh(i * STAGGER);
        });
        // 2) outlines snap on with a punch
        [outlines, letterLine].forEach(o => anim(o, [{ opacity: 0 }, { opacity: 1 }], { duration: 70, delay: OUTLINE_AT, fill: 'both' }));
        anim(inner, [
            { transform: 'scale(1)' },
            { transform: 'scale(1.07)', offset: 0.3 },
            { transform: 'scale(0.985)', offset: 0.7 },
            { transform: 'scale(1)' },
        ], { duration: 260, delay: OUTLINE_AT, easing: 'ease-out' });
        // 3) hold, then reverse on the first input
        intro[0].finished.then(() => waitForInput(() => {
            if (leaving) return;
            leaving = true;
            intro.forEach(a => { a.reverse(); a.updatePlaybackRate(-REVERSE_RATE); });
            stripes.forEach((r, i) => whoosh((TOTAL - i * STAGGER - SWEEP) / REVERSE_RATE));
            setTimeout(done, TOTAL / REVERSE_RATE + 60);
        })).catch(() => {});
    }

    setInterval(() => {
        if (!isMyTurnNow()) { if (dismiss) dismiss(); return; }   // turn over or game left: pull it back
        const turn = (typeof currentTurnNumber !== 'undefined') ? currentTurnNumber : null;
        if (turn === lastShownTurn) return;
        if (document.hidden) return;            // play it when the player comes back
        lastShownTurn = turn;
        if (window.fxOn && !window.fxOn()) return;
        play();
    }, 150);

    window.TurnBanner = { play, dismiss: () => dismiss && dismiss() };
})();
