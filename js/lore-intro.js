(function () {
    'use strict';

    // ── Lore Intro ───────────────────────────────────────────────────────
    // Plays right after js/boot-splash.js's logo animation, before the login
    // screen appears. Nine hand-drawn (Remarkable tablet) sketch-plus-
    // typewriter-caption clips (LoreIntroClips/chunk*.mp4), each black ink on
    // near-white paper (~rgb(250,252,247), measured), 1080x1350 (4:5), 30fps,
    // silent audio track.
    //
    // Effect: instead of a plain chroma-keyed cutout, the frame is a
    // "porthole" into the SAME already-running parallax background
    // (js/parallax.js's #parallax-bg, which keeps animating underneath the
    // whole boot-splash/login sequence regardless of what's shown on top of
    // it — see css/boot-splash.css). #lore-intro itself has NO opaque
    // background (css/lore-intro.css) so that real parallax shows through
    // at full brightness everywhere OUTSIDE the frame too, exactly as it
    // does on the login screen either side of this sequence — only the
    // framed area is dimmed. Bare paper reads as a dim ambient wash of that
    // parallax; wherever the sketch/text ink is, the SAME parallax shows
    // through much brighter (lightness-floored so it's always legible over
    // a dark patch of the background) — the linework and caption read as
    // glowing windows onto the moving backdrop.
    //
    // Pacing: each clip plays once and then HOLDS on its last frame (video
    // 'ended' just stops it — drawFrame() keeps compositing whatever frame
    // the paused video is sitting on) with a "Press Space to continue"
    // prompt, giving the player time to actually read the caption instead
    // of racing to the next clip. Space OR a click anywhere (except Skip
    // All itself) always moves on immediately — whether the current clip
    // is still playing (skips the rest of it) or already ended and waiting
    // — through the same advance(), so there's exactly one "move forward"
    // behavior regardless of how or when it's triggered. No separate Next
    // button — Skip All is the only other control.
    //
    // Technical note (see conversation / commit): drawing the LIVE DOM
    // parallax onto a canvas via an SVG <foreignObject> snapshot was tried
    // and confirmed a dead end — canvases drawn from a foreignObject-bearing
    // SVG are permanently tainted (no getImageData/toDataURL) even with
    // every referenced image fully inlined as a data URI. Per-pixel access
    // is required here, so instead this reads the REAL live geometry
    // (getBoundingClientRect) and opacity of the actual running parallax
    // layers every frame, and draws its OWN preloaded copies of the exact
    // same six PNG assets at that exact live position — i.e. not a
    // reimplementation of the animation curves, just a pixel-readable
    // redraw of whatever the real parallax is doing at that instant. If
    // parallax.js's timing/positions are retuned later, this follows
    // automatically.

    const CLIP_NAMES = [
        'chunkone', 'chunktwo', 'chunkthree', 'chunkfour', 'chunkfive',
        'chunksix', 'chunkseven', 'chunkeight', 'chunknine'
    ];
    const CLIP_PATHS = CLIP_NAMES.map(n => `LoreIntroClips/${n}.mp4`);

    // Captions (owner 2026-10-09): the typed text baked into the clips was hard
    // to read and could not be translated. Everything from `cut` (fraction of the
    // frame height, measured per clip: the gap between the drawing and the
    // caption) down is drawn as bare paper, and the game types its own text
    // there (window.I18n; Spanish in js/i18n-es.js). chunkfour had TWO captions
    // one after the other (the second replaced the first at ~4.1 s), so it is
    // two pages: the clip stops at `until` and waits for Space / a click, then
    // plays on from there with the second caption.
    const PAGES = [
        { clip: 0, cut: 0.776, text: 'In a world where the disciplined can harness the mystic energy that flows through the natural world into raw crystallized materia...' },
        { clip: 1, cut: 0.813, text: 'There are those who overuse this ability and become consumed by the arcane properties that these fundamental forces embody.' },
        { clip: 2, cut: 0.748, text: 'To others, these mystics seem to vanish, never to be seen again.' },
        { clip: 3, cut: 0.763, until: 4.0, text: 'They find themselves trapped on a chaotic plane between the realms of reality, a floating purgatory that takes the form of a mystic island,' },
        { clip: 3, cut: 0.763, from: 4.0, text: 'beset by volcanic eruptions, floods, tornadoes, earthquakes, and temporal anomalies. A world out of time, whose inhabitants can neither find peace nor die.' },
        { clip: 4, cut: 0.748, text: 'This cataclysmic landscape is now the home of these outcasts, who, through eons of exploration and testing,' },
        { clip: 5, cut: 0.764, text: 'have unlocked the secrets of the Godaigo: a method of shaping the materia into arcane ritual patterns that release potent effects on the environment.' },
        { clip: 6, cut: 0.676, text: 'These tests have revealed that under the right conditions, the island periodically offers escape to one who manages to demonstrate balance in their spell construction.' },
        { clip: 7, cut: 0.659, text: 'This discovery brought ages of conflict and sparring, the mages training endlessly so that when the opportunity presents itself, they might be the one to break free from the curse of the mystic realm.' },
        { clip: 8, cut: 0.667, text: 'When you arrive, there are but two weeks to prepare, or you stay trapped in this ruthless realm with wizards who have forgotten all else but vigilance and strategy.' },
    ];
    const TYPE_DELAY = 0.15;   // s after a page starts before the text begins

    // Measured from the actual exported clips (see conversation) — paper
    // background averages ~rgb(250,252,247); ink strokes go down toward 0,
    // but H.264 compression on dark ink strokes rarely hits pure black, so
    // INK_FLOOR is not 0 — pixels this dark or darker count as "fully inked".
    const PAPER_LUM = 250;
    const INK_FLOOR = 60;

    // HSL lightness floor applied to the parallax's OWN color when it's
    // used as the "glow" fill under ink — guarantees legibility over a dark
    // patch of the (mostly dark, space-themed) parallax regardless of what
    // color happens to be there, while keeping that color's hue/saturation
    // so it still reads as "the parallax, but glowing" rather than flat white.
    const MIN_GLOW_LIGHTNESS = 0.60;

    // Bare-paper areas render as the parallax at this fraction of its own
    // brightness — the "dim ambient wash" the ink then glows out of.
    const AMBIENT_FACTOR = 0.20;

    // Internal compositing resolution — matches the clips' 4:5 aspect.
    // Kept modest (not the clips' native 1080x1350) since every pixel gets a
    // getImageData round trip plus an RGB<->HSL conversion every frame;
    // the result is upscaled to the display box, which is fine for soft
    // painterly content like this.
    const IW = 360, IH = 450;

    const PARALLAX_BASE_URL = 'images/Background/background/';
    const PARALLAX_ASSETS = {
        base:  PARALLAX_BASE_URL + 'Truebackground.webp',
        space: PARALLAX_BASE_URL + 'secondlayermuchbiggerthantrue.webp',
        clouds: [
            PARALLAX_BASE_URL + 'smallcloud.webp',
            PARALLAX_BASE_URL + 'smallcloud2.webp',
            PARALLAX_BASE_URL + 'smallcloud3.webp',
            PARALLAX_BASE_URL + 'smallcloud4.webp',
        ]
    };
    // Natural size shared by every parallax layer image (confirmed via ffprobe).
    const PARALLAX_NATURAL_W = 2500, PARALLAX_NATURAL_H = 1932;

    let overlay, frameEl, canvas, ctx, video, skipBtn, promptEl;
    let inkCanvas, inkCtx, paraCanvas, paraCtx, outCanvas, outCtx;
    let clipIndex = 0;          // index into PAGES
    let loadedClip = -1;        // which video file is loaded
    let captionEl = null, captionText = '', captionStart = 0, captionShown = -1;
    let onDone = null;
    let rafId = null;
    let started = false;
    let waiting = false; // true once a clip has ended and is holding for input

    // Preloaded copies of the parallax's own images — drawn ourselves (not
    // the live <img> elements) so the composite step can read their pixels.
    const parallaxImages = {}; // url -> Image
    let parallaxImagesReady = false;

    function preloadParallaxImages() {
        const urls = [PARALLAX_ASSETS.base, PARALLAX_ASSETS.space, ...PARALLAX_ASSETS.clouds];
        let remaining = urls.length;
        return new Promise(resolve => {
            urls.forEach(url => {
                const img = new Image();
                img.onload = img.onerror = () => {
                    remaining--;
                    if (remaining <= 0) { parallaxImagesReady = true; resolve(); }
                };
                img.src = url;
                parallaxImages[url] = img;
            });
        });
    }

    // Find the live parallax injected by js/parallax.js into #lobby-wrapper.
    // It keeps animating there continuously regardless of what's shown on
    // top (boot-splash, this lore intro, or the login screen itself).
    function getLiveParallax() {
        const bg = document.querySelector('#lobby-wrapper #parallax-bg');
        if (!bg) return null;
        const base = bg.querySelector('.parallax-base');
        const space = bg.querySelector('.parallax-space');
        const clouds = [...bg.querySelectorAll('.parallax-cloud')];
        return { bg, base, space, clouds };
    }

    // A fixed 4:5 crop window into the live parallax-bg's own box (in its
    // own coordinate space) — this is the "porthole". Centered, sized to
    // most of the container so there's real motion visible within it.
    function computeCropWindow(containerRect) {
        let h = containerRect.height * 0.92;
        let w = h * (IW / IH);
        if (w > containerRect.width * 0.92) {
            w = containerRect.width * 0.92;
            h = w * (IH / IW);
        }
        return {
            x: (containerRect.width - w) / 2,
            y: (containerRect.height - h) / 2,
            w, h
        };
    }

    // Render the current live parallax state (base + drifting space + 4
    // clouds), viewed through the crop window, into the given ctx at IWxIH.
    function renderParallaxPorthole(destCtx) {
        destCtx.clearRect(0, 0, IW, IH);
        const live = getLiveParallax();
        if (!live || !parallaxImagesReady) return;

        const containerRect = live.bg.getBoundingClientRect();
        if (!containerRect.width || !containerRect.height) return;
        const crop = computeCropWindow(containerRect);
        const sx = IW / crop.w, sy = IH / crop.h;
        const toCanvas = (relX, relY) => [(relX - crop.x) * sx, (relY - crop.y) * sy];

        // Base layer: static "cover" fit of the full container — no
        // animation, so plain cover-fit math against the known natural size.
        const coverScale = Math.max(containerRect.width / PARALLAX_NATURAL_W, containerRect.height / PARALLAX_NATURAL_H);
        const baseW = PARALLAX_NATURAL_W * coverScale, baseH = PARALLAX_NATURAL_H * coverScale;
        const baseX = (containerRect.width - baseW) / 2, baseY = (containerRect.height - baseH) / 2;
        drawLayerImage(destCtx, parallaxImages[PARALLAX_ASSETS.base], baseX, baseY, baseW, baseH, toCanvas, sx, sy, 1);

        // Space + clouds: live rect already bakes in their current CSS
        // transform (drift animation) — just read and redraw.
        if (live.space) {
            const r = live.space.getBoundingClientRect();
            const relX = r.left - containerRect.left, relY = r.top - containerRect.top;
            const op = parseFloat(getComputedStyle(live.space).opacity) || 0;
            drawLayerImage(destCtx, parallaxImages[PARALLAX_ASSETS.space], relX, relY, r.width, r.height, toCanvas, sx, sy, op);
        }
        live.clouds.forEach((cloudEl, i) => {
            const url = PARALLAX_ASSETS.clouds[i];
            const img = parallaxImages[url];
            if (!img) return;
            const r = cloudEl.getBoundingClientRect();
            const relX = r.left - containerRect.left, relY = r.top - containerRect.top;
            const op = parseFloat(getComputedStyle(cloudEl).opacity) || 0;
            drawLayerImage(destCtx, img, relX, relY, r.width, r.height, toCanvas, sx, sy, op);
        });
    }

    function drawLayerImage(destCtx, img, relX, relY, relW, relH, toCanvas, sx, sy, opacity) {
        if (!img || !img.complete || opacity <= 0) return;
        const [cx, cy] = toCanvas(relX, relY);
        const cw = relW * sx, ch = relH * sy;
        // Cheap reject — fully outside the crop window.
        if (cx + cw < 0 || cy + ch < 0 || cx > IW || cy > IH) return;
        const prevAlpha = destCtx.globalAlpha;
        destCtx.globalAlpha = opacity;
        destCtx.drawImage(img, cx, cy, cw, ch);
        destCtx.globalAlpha = prevAlpha;
    }

    // ── RGB <-> HSL (only used to floor lightness for the glow color) ────
    function rgbToHsl(r, g, b) {
        r /= 255; g /= 255; b /= 255;
        const max = Math.max(r, g, b), min = Math.min(r, g, b);
        let h = 0, s = 0; const l = (max + min) / 2;
        if (max !== min) {
            const d = max - min;
            s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
            switch (max) {
                case r: h = (g - b) / d + (g < b ? 6 : 0); break;
                case g: h = (b - r) / d + 2; break;
                default: h = (r - g) / d + 4; break;
            }
            h /= 6;
        }
        return [h, s, l];
    }
    function hue2rgb(p, q, t) {
        if (t < 0) t += 1;
        if (t > 1) t -= 1;
        if (t < 1 / 6) return p + (q - p) * 6 * t;
        if (t < 1 / 2) return q;
        if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
        return p;
    }
    function hslToRgb(h, s, l) {
        if (s === 0) { const v = l * 255; return [v, v, v]; }
        const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
        const p = 2 * l - q;
        return [
            hue2rgb(p, q, h + 1 / 3) * 255,
            hue2rgb(p, q, h) * 255,
            hue2rgb(p, q, h - 1 / 3) * 255
        ];
    }

    function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

    // Composite one frame: ink video -> luminance mask; parallax porthole ->
    // color source; blend dim-everywhere / bright-glow-under-ink.
    function drawFrame() {
        if (!video || video.readyState < video.HAVE_CURRENT_DATA) return;

        inkCtx.drawImage(video, 0, 0, IW, IH);
        const ink = inkCtx.getImageData(0, 0, IW, IH).data;

        renderParallaxPorthole(paraCtx);
        const para = paraCtx.getImageData(0, 0, IW, IH).data;

        const out = outCtx.createImageData(IW, IH);
        const od = out.data;
        const range = PAPER_LUM - INK_FLOOR;
        const page = PAGES[clipIndex];
        const cutAt = page ? Math.floor(page.cut * IH) * IW * 4 : ink.length;

        for (let i = 0; i < ink.length; i += 4) {
            const lum = (ink[i] + ink[i + 1] + ink[i + 2]) / 3;
            const inkAmount = i >= cutAt ? 0 : clamp01((PAPER_LUM - lum) / range);

            const pr = para[i], pg = para[i + 1], pb = para[i + 2];
            const dimR = pr * AMBIENT_FACTOR, dimG = pg * AMBIENT_FACTOR, dimB = pb * AMBIENT_FACTOR;

            if (inkAmount <= 0.002) {
                od[i] = dimR; od[i + 1] = dimG; od[i + 2] = dimB; od[i + 3] = 255;
                continue;
            }

            const [h, s, l] = rgbToHsl(pr, pg, pb);
            const [gr, gg, gb] = hslToRgb(h, s, Math.max(l, MIN_GLOW_LIGHTNESS));

            od[i]     = dimR + (gr - dimR) * inkAmount;
            od[i + 1] = dimG + (gg - dimG) * inkAmount;
            od[i + 2] = dimB + (gb - dimB) * inkAmount;
            od[i + 3] = 255;
        }

        outCtx.putImageData(out, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(outCanvas, 0, 0, IW, IH, 0, 0, canvas.width, canvas.height);
    }

    function loop() {
        const page = PAGES[clipIndex];
        if (page && page.until != null && !waiting && video.currentTime >= page.until) {
            video.pause();
            onClipEnded();
        }
        drawFrame();
        typeCaption();
        rafId = requestAnimationFrame(loop);
    }

    // ── caption text ──
    function placeCaption() {
        const page = PAGES[clipIndex];
        if (!captionEl || !page || !canvas) return;
        const top = canvas.offsetTop + page.cut * canvas.clientHeight;
        const bottom = canvas.offsetTop + canvas.clientHeight;
        captionEl.style.top = top + 'px';
        captionEl.style.height = Math.max(20, bottom - top - 6) + 'px';
        captionEl.style.left = (canvas.offsetLeft + canvas.clientWidth * 0.05) + 'px';
        captionEl.style.width = (canvas.clientWidth * 0.9) + 'px';
        // biggest size that fits the full text in the space
        let size = Math.max(12, canvas.clientWidth * 0.043);
        captionEl.innerHTML = '';
        const probe = document.createElement('div');
        probe.textContent = captionText;
        captionEl.appendChild(probe);
        captionEl.style.fontSize = size + 'px';
        while (size > 10 && captionEl.scrollHeight > captionEl.clientHeight + 1) {
            size -= 0.5;
            captionEl.style.fontSize = size + 'px';
        }
        captionShown = -1;
    }
    function setCaption() {
        const page = PAGES[clipIndex];
        let t = page ? page.text : '';
        try { if (window.I18n && window.I18n.lang !== 'en') t = (window.I18N_ES && window.I18N_ES[t]) || window.I18n.t(t); } catch (e) {}
        captionText = t;
        captionStart = performance.now() + TYPE_DELAY * 1000;
        placeCaption();
    }
    function typeCaption() {
        if (!captionEl) return;
        // the old captions typed in over ~1.8 s; long text a little longer
        const total = captionText.length;
        const dur = Math.min(2800, Math.max(1200, total * 16));
        const n = waiting ? total : Math.max(0, Math.min(total, Math.round(total * (performance.now() - captionStart) / dur)));
        if (n === captionShown) return;
        captionShown = n;
        // keep the full text in the layout (invisible rest) so lines never jump
        captionEl.innerHTML = '';
        const inner = document.createElement('div');
        const shown = document.createElement('span');
        shown.textContent = captionText.slice(0, n);
        const rest = document.createElement('span');
        rest.className = 'lore-intro-caption-rest';
        rest.textContent = captionText.slice(n);
        inner.append(shown, rest);
        captionEl.appendChild(inner);
    }

    function loadClip(i) {
        waiting = false;
        if (promptEl) promptEl.classList.remove('lore-intro-prompt-visible');
        const page = PAGES[i];
        const play = () => video.play().catch(() => {
            // Autoplay blocked (shouldn't happen — always called from a real
            // user gesture chain) — advance anyway rather than stall forever.
            advance();
        });
        if (page.clip === loadedClip) {
            // second page of the same clip: play on from where it stopped
            if (page.from != null && video.currentTime < page.from) video.currentTime = page.from;
            setCaption();
            play();
            return;
        }
        loadedClip = page.clip;
        video.src = CLIP_PATHS[page.clip];
        video.load();
        setCaption();
        play();
    }

    // A clip reached its natural end — hold on its last frame (drawFrame()
    // keeps compositing it every tick regardless of play state) and prompt,
    // rather than auto-advancing. Space (onKeyDown) or a click (onClick)
    // call advance() directly, so there's no separate "resume from waiting"
    // path to keep
    // in sync.
    function onClipEnded() {
        waiting = true;
        if (promptEl) promptEl.classList.add('lore-intro-prompt-visible');
    }

    // The single "move on" action — triggered by Space whether the current
    // clip is still playing (skips the rest of it) or already ended and
    // waiting (the normal path). Always the same result, so pressing Space
    // is never the "wrong" thing to do.
    function advance() {
        clipIndex++;
        if (clipIndex >= PAGES.length) { finish(); return; }
        loadClip(clipIndex);
    }

    function onKeyDown(e) {
        if (e.code !== 'Space' && e.key !== ' ') return;
        e.preventDefault();
        advance();
    }

    // Click anywhere to continue too (mirrors boot-splash.js's own
    // click-or-key dismiss) — except the Skip All button itself, which
    // already has its own handler and means something different (jump to
    // the end, not just one step).
    function onClick(e) {
        if (skipBtn && (e.target === skipBtn || skipBtn.contains(e.target))) return;
        advance();
    }

    function finish() {
        if (!started) return;
        started = false;
        waiting = false;
        video.removeEventListener('ended', onClipEnded);
        document.removeEventListener('keydown', onKeyDown);
        overlay.removeEventListener('click', onClick);
        if (rafId) cancelAnimationFrame(rafId);
        video.pause();
        if (promptEl) promptEl.classList.remove('lore-intro-prompt-visible');
        window.removeEventListener('resize', placeCaption);
        overlay.classList.add('lore-intro-hidden');
        const cb = onDone;
        onDone = null;
        setTimeout(() => {
            overlay.style.display = 'none';
            if (cb) cb();
        }, 1000); // matches #lore-intro's own fade-out transition
    }

    function start(onCompleteCallback) {
        overlay = document.getElementById('lore-intro');
        canvas = document.getElementById('lore-intro-canvas');
        video = document.getElementById('lore-intro-video');
        skipBtn = document.getElementById('lore-intro-skip-btn');
        promptEl = document.getElementById('lore-intro-prompt');
        if (!overlay || !canvas || !video) { if (onCompleteCallback) onCompleteCallback(); return; }

        onDone = onCompleteCallback;

        try {
            ctx = canvas.getContext('2d');
            inkCanvas = document.createElement('canvas');
            inkCanvas.width = IW; inkCanvas.height = IH;
            inkCtx = inkCanvas.getContext('2d', { willReadFrequently: true });

            paraCanvas = document.createElement('canvas');
            paraCanvas.width = IW; paraCanvas.height = IH;
            paraCtx = paraCanvas.getContext('2d', { willReadFrequently: true });

            outCanvas = document.createElement('canvas');
            outCanvas.width = IW; outCanvas.height = IH;
            outCtx = outCanvas.getContext('2d');
        } catch (e) {
            console.warn('Lore intro failed to initialize:', e);
            started = false;
            if (onCompleteCallback) onCompleteCallback();
            return;
        }

        started = true;
        clipIndex = 0;
        loadedClip = -1;
        overlay.style.display = 'flex';
        overlay.classList.remove('lore-intro-hidden');

        // Canvas backing resolution follows its actual displayed CSS size
        // (aspect-ratio: 4/5 in css/lore-intro.css) — MUST be read only
        // after the overlay is actually displayed (was display:none up to
        // the line above), or getBoundingClientRect() reports 0x0 and the
        // backing store clamps to 1x1: every draw call then lands on that
        // single pixel, which CSS then stretches to fill the whole box —
        // reads as one flat, slowly-changing color instead of the composite.
        const rect = canvas.getBoundingClientRect();
        canvas.width = Math.max(1, Math.round(rect.width));
        canvas.height = Math.max(1, Math.round(rect.height));

        // the game's own caption, over the blanked caption area of the clip
        captionEl = document.getElementById('lore-intro-caption');
        if (!captionEl) {
            captionEl = document.createElement('div');
            captionEl.id = 'lore-intro-caption';
            captionEl.className = 'lore-intro-caption no-i18n';
            captionEl.setAttribute('translate', 'no');
            canvas.parentNode.appendChild(captionEl);
        }
        window.addEventListener('resize', placeCaption);

        video.addEventListener('ended', onClipEnded);
        document.addEventListener('keydown', onKeyDown);
        overlay.addEventListener('click', onClick);
        if (skipBtn) skipBtn.onclick = finish;

        preloadParallaxImages().then(() => {
            if (!started) return; // skipped before images finished loading
            loadClip(0);
            rafId = requestAnimationFrame(loop);
        });
    }

    window.LoreIntro = { start };
})();
