window.effectsSystem = (() => {
    const EFFECTS = {
        fire_effect: {
            frames: 30,
            fps: 18,
            filter: 'none',
            svgDiameter: 70,
            baseFrameSize: 128,
        },
        ring_fire: {
            frames: 30,
            fps: 13,
            srcId: 'fire_effect',
            filter: 'hue-rotate(342deg) brightness(0.95) saturate(1.75)',
            svgDiameter: 70,
            baseFrameSize: 128,
        }
    };

    const loaded = {};
    const active = [];
    let lastSig = '';   // see loop()
    let dirty = [];

    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:500;';
    const ctx = canvas.getContext('2d');

    function resize() {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
        lastSig = ''; // resizing wipes the canvas: draw again on the next tick
        dirty = [];
    }
    window.addEventListener('resize', resize);

    function attachCanvas() {
        if (document.body) { document.body.appendChild(canvas); resize(); }
        else requestAnimationFrame(attachCanvas);
    }
    attachCanvas();

    // Frames are decoded up front (ImageBitmap) so the first time a frame is
    // shown it does not stall the animation while the browser decodes it.
    // Until a bitmap is ready the plain <img> is drawn instead.
    const bitmaps = {};
    function preload(effectId) {
        const cfg = EFFECTS[effectId];
        if (!cfg || loaded[effectId]) return;
        loaded[effectId] = [];
        bitmaps[effectId] = [];
        for (let i = 1; i <= cfg.frames; i++) {
            const img = new Image();
            const idx = i - 1;
            img.onload = () => {
                if (typeof createImageBitmap !== 'function') return;
                createImageBitmap(img).then(bm => { bitmaps[effectId][idx] = bm; }).catch(() => {});
            };
            img.src = `images/effects/${cfg.srcId || effectId}/${String(i).padStart(4, '0')}.webp`;
            loaded[effectId].push(img);
        }
    }

    function tileToScreen(svgX, svgY) {
        const boardSvg = document.getElementById('boardSvg');
        const viewport = document.getElementById('viewport');
        if (!boardSvg || !viewport) return null;
        const pt = boardSvg.createSVGPoint();
        pt.x = svgX;
        pt.y = svgY;
        const ctm = viewport.getCTM();
        const screenPt = pt.matrixTransform(ctm);
        // Mid-pan the board is shifted by a CSS translate on top of the CTM
        // (game-core.js beginFastPan); follow it.
        const shift = window.getBoardPanShift ? window.getBoardPanShift() : null;
        if (shift) { screenPt.x += shift.x; screenPt.y += shift.y; }
        const ctmScale = Math.sqrt(ctm.a * ctm.a + ctm.b * ctm.b);
        // screenPt is relative to boardSvg's own untransformed box, which by
        // design matches .board-area's rect exactly at 0deg tilt (see
        // syncBoardViewport in js/game-core.js) — the same flat local-pixel
        // space getScreenFromBoardXY expects. Previously this just added
        // boardSvg.getBoundingClientRect() directly, which is wrong once a
        // board tilt is active (that rect becomes the foreshortened,
        // trapezoidal projected box — same issue getBoardScreenXY's own
        // comment describes for hit-testing). getScreenFromBoardXY
        // forward-projects through the tilt instead, so the fire-destroy
        // effect (and anything else using this) lands on the actual tile
        // position instead of drifting once tilted.
        const pos = window.getScreenFromBoardXY(screenPt.x, screenPt.y);
        if (!pos) return null;
        return {
            x: pos.x,
            y: pos.y,
            boardScale: ctmScale * pos.scale,
        };
    }

    let rafRunning = false;
    // What was drawn last frame: its signature (skip identical frames) and
    // the rectangles to clear (never the whole screen). The animations run
    // at 13-18 fps while requestAnimationFrame fires at the screen rate
    // (60-144 Hz), so most ticks now draw nothing.
    function loop() {
        const now = Date.now();
        const draws = [];
        for (let i = active.length - 1; i >= 0; i--) {
            const anim = active[i];
            const cfg = EFFECTS[anim.effectId];
            const frames = loaded[anim.effectId];
            if (!frames) continue;
            const frameIdx = Math.floor((now - anim.startTime) / (1000 / cfg.fps));
            if (frameIdx >= cfg.frames) { active.splice(i, 1); continue; }
            const img = bitmaps[anim.effectId]?.[frameIdx] || frames[frameIdx];
            if (img instanceof HTMLImageElement && !img.complete) continue;
            const pos = tileToScreen(anim.svgX, anim.svgY);
            if (!pos) continue;
            const size = cfg.svgDiameter * pos.boardScale;
            draws.push({ img, cfg, x: pos.x - size / 2, y: pos.y - size / 2, size, frameIdx });
        }
        const sig = draws.map(d => d.frameIdx + '@' + Math.round(d.x) + ',' + Math.round(d.y) + ',' + Math.round(d.size)).join(';');
        if (sig !== lastSig) {
            lastSig = sig;
            for (const r of dirty) ctx.clearRect(r[0], r[1], r[2], r[3]);
            dirty = [];
            for (const d of draws) {
                if (d.cfg.filter && d.cfg.filter !== 'none') {
                    ctx.save();
                    ctx.filter = d.cfg.filter;
                    ctx.drawImage(d.img, d.x, d.y, d.size, d.size);
                    ctx.restore();
                } else {
                    ctx.drawImage(d.img, d.x, d.y, d.size, d.size);
                }
                dirty.push([Math.floor(d.x) - 2, Math.floor(d.y) - 2, Math.ceil(d.size) + 4, Math.ceil(d.size) + 4]);
            }
        }
        if (active.length > 0) requestAnimationFrame(loop);
        else {
            for (const r of dirty) ctx.clearRect(r[0], r[1], r[2], r[3]);
            dirty = [];
            lastSig = '';
            rafRunning = false;
        }
    }

    Object.keys(EFFECTS).forEach(preload);

    return {
        // True while any effect is still animating (bot.js waits for this
        // before thinking, so a long bot decision cannot freeze the fire).
        isPlaying() { return active.length > 0; },
        play(effectId, svgX, svgY) {
            if (!EFFECTS[effectId]) return;
            active.push({ effectId, svgX, svgY, startTime: Date.now() });
            if (!rafRunning) { rafRunning = true; requestAnimationFrame(loop); }
        }
    };
})();
