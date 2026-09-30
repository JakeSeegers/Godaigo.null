(function () {
    'use strict';

    // ── Asset Preloader ──────────────────────────────────────────────────
    // In-game art and sounds were loaded on first use: a tile's art the
    // first time one was placed, each sound the first time it played —
    // small pop-ins and delays early in a match. This downloads them all
    // in the background while the player is on the login/lobby screen
    // (started only once the boot splash + lore intro are gone, so it
    // never competes with their own loading), and, if a match starts
    // before it's done, covers the board with a loading bar until it is.
    //
    // Fire-effect frames are left out: js/effects-system.js already
    // preloads those itself at page load.
    //
    // Everything here is additive — if this file fails to load, or any
    // asset fails, the game behaves exactly as before (loads on use).
    // Also home of window.LazyScripts (see § Lazy scripts below).

    const GATE_MAX_MS = 8000;     // never hold a match longer than this
    const GATE_SHOW_DELAY_MS = 150; // nearly-done loads finish without flashing the bar
    const BAR_SEGMENTS = 24;

    const IMAGES = [
        // Tile art (game-core.js), unflipped tile back, element symbols,
        // catacomb icon, scroll-deck icons (index.html).
        'images/Tiles/pixelearth.webp',
        'images/Tiles/pixelfire.webp',
        'images/Tiles/pixelwater.webp',
        'images/Tiles/pixelwind.webp',
        'images/Tiles/pixelvoid.webp',
        'images/Tiles/pixelcatacomb.webp',
        'images/Tiles/unflippedtile.webp',
        'images/mountainsymbol.webp',
        'images/watersymbol.webp',
        'images/firesymbol.webp',
        'images/windsymbol.webp',
        'images/voidsymbol.webp',
        'images/Catacomb.webp',
        'assets/earthscroll.webp',
        'assets/waterscroll.webp',
        'assets/firescroll.webp',
        'assets/windscroll.webp',
        'assets/voidscroll.webp',
        'assets/catacombscroll.webp',
    ];

    const assets = [];   // { label, url, kind, done }
    const keep = [];     // hold decoded Image()s so they stay in memory cache
    let started = false;
    let allDone = null;  // Promise, set by start()

    function loadImage(a) {
        return new Promise((resolve) => {
            const img = new Image();
            img.onload = () => {
                keep.push(img);
                (img.decode ? img.decode() : Promise.resolve()).then(resolve, resolve);
            };
            img.onerror = resolve;
            img.src = a.url;
        });
    }

    // fetch() (not new Audio()) to warm the HTTP cache: a preload="auto"
    // <audio> may stop after the metadata. SoundSystem's later
    // new Audio(url) is then served from that cache.
    function loadSound(a) {
        return fetch(a.url).then(r => r.blob()).catch(() => {});
    }

    function start() {
        if (started) return;
        started = true;
        IMAGES.forEach(url => assets.push({ label: 'Artwork', url, kind: 'image' }));
        const sounds = (window.SoundSystem && window.SoundSystem.urls) || [];
        sounds.forEach(url => assets.push({ label: 'Sounds', url, kind: 'sound' }));
        allDone = Promise.all(assets.map((a) =>
            (a.kind === 'image' ? loadImage(a) : loadSound(a)).then(() => {
                a.done = true;
                if (gate) gate.render();
            })
        ));
    }

    // ── Loading overlay (only shown if a match starts before we're done) ──
    // Same look as js/boot-splash.js's boot screen. Styled inline so it
    // doesn't depend on a CSS file that could be cached out of step.
    let gate = null;

    function showGate() {
        if (gate || !allDone) return;
        const overlay = document.createElement('div');
        overlay.style.cssText =
            'position:fixed;inset:0;z-index:99990;background:#000;' +
            'display:flex;align-items:center;justify-content:center;' +
            'opacity:0;transition:opacity 0.3s ease;';
        const box = document.createElement('div');
        box.style.cssText =
            'width:min(420px,80vw);display:flex;flex-direction:column;gap:12px;' +
            "font-family:var(--font-pixel,'Press Start 2P',monospace);color:#e8e4d8;";
        const top = document.createElement('div');
        top.style.cssText = 'display:flex;justify-content:space-between;font-size:11px;letter-spacing:1px;';
        const title = document.createElement('span');
        title.textContent = 'LOADING';
        const pct = document.createElement('span');
        top.append(title, pct);
        const bar = document.createElement('div');
        bar.style.cssText =
            'display:flex;gap:3px;padding:4px;border:2px solid #e8e4d8;' +
            'box-shadow:0 0 12px rgba(255,240,200,0.25);';
        const segs = [];
        for (let i = 0; i < BAR_SEGMENTS; i++) {
            const seg = document.createElement('div');
            seg.style.cssText = 'flex:1;height:14px;background:#222;';
            bar.appendChild(seg);
            segs.push(seg);
        }
        const item = document.createElement('div');
        item.style.cssText = 'font-size:9px;letter-spacing:1px;opacity:0.7;';
        box.append(top, bar, item);
        overlay.appendChild(box);
        document.body.appendChild(overlay);

        let blinkOn = false;
        let shownFrac = 0;
        function render() {
            const frac = assets.length ? assets.filter(a => a.done).length / assets.length : 1;
            shownFrac = Math.max(shownFrac, frac);
            pct.textContent = Math.floor(shownFrac * 100) + '%';
            const filled = Math.floor(shownFrac * BAR_SEGMENTS);
            segs.forEach((seg, i) => {
                const on = i < filled || (i === filled && blinkOn && shownFrac < 1);
                seg.style.background = on ? '#f4e9c8' : '#222';
                seg.style.boxShadow = on ? '0 0 6px rgba(255,240,200,0.6)' : 'none';
            });
            const current = assets.find(a => !a.done);
            item.textContent = current ? 'Loading ' + current.label.toLowerCase() + '…' : 'Ready';
        }
        const blinkTimer = setInterval(() => { blinkOn = !blinkOn; render(); }, 300);
        const showTimer = setTimeout(() => { overlay.style.opacity = '1'; }, GATE_SHOW_DELAY_MS);
        render();

        gate = { render };
        const timedOut = new Promise((resolve) => setTimeout(resolve, GATE_MAX_MS));
        Promise.race([allDone, timedOut]).then(() => {
            clearInterval(blinkTimer);
            clearTimeout(showTimer);
            overlay.style.opacity = '0';
            setTimeout(() => { overlay.remove(); gate = null; }, 350);
        });
    }

    // Every way into a match (lobby.js startGame(), multiplayer start,
    // tutorial, bot arena) ends by adding .active to #game-layout —
    // watching that one class catches them all without wrapping each.
    function watchGameStart() {
        const layout = document.getElementById('game-layout');
        if (!layout) return;
        let wasActive = layout.classList.contains('active');
        new MutationObserver(() => {
            const isActive = layout.classList.contains('active');
            if (isActive && !wasActive) {
                start(); // in case the player got here before the intro ended
                if (assets.some(a => !a.done)) showGate();
            }
            wasActive = isActive;
        }).observe(layout, { attributes: true, attributeFilter: ['class'] });
    }

    // Start once the boot splash / lore intro is gone (js/boot-splash.js
    // removes body.boot-splash-active at that point), so this never
    // competes with their own loading.
    function startAfterIntro() {
        if (!document.body.classList.contains('boot-splash-active')) { start(); return; }
        const obs = new MutationObserver(() => {
            if (!document.body.classList.contains('boot-splash-active')) {
                obs.disconnect();
                start();
            }
        });
        obs.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    }

    // ── Lazy scripts ─────────────────────────────────────────────────────
    // Code most sessions never run (the tutorial, bot-arena training) is no
    // longer a <script> tag in index.html. It loads once the page is idle
    // after the intro + asset preload, so it's off the startup path but
    // still normally in place a few seconds later (console use included).
    // Every entry point that needs it earlier awaits load(name) first: the
    // auth-screen Tutorial button (index.html), Train Bot
    // (gamification-ui.js), the cheat / bot-training panels (game-ui.js),
    // and per-bot weights in bot-driver.js.
    const LAZY = {
        'tutorial':  { src: 'js/tutorial-mode.js', global: 'TutorialMode' },
        'bot-arena': { src: 'js/bot-arena.js',     global: 'BotArena' },
        // The pot drop at game over (js/pot-plinko.js). Only loaded when a drop happens.
        'matter':     { src: 'js/vendor/matter.min.js', global: 'Matter',    onDemand: true },
        'plinko-sim': { src: 'js/plinko-sim.js',        global: 'PlinkoSim', onDemand: true },
    };

    function load(name) {
        const e = LAZY[name];
        if (!e) return Promise.reject(new Error('LazyScripts: unknown script "' + name + '"'));
        if (window[e.global]) return Promise.resolve(); // already loaded (e.g. an older cached index.html still has the tag)
        if (!e.promise) {
            e.promise = new Promise((resolve, reject) => {
                const s = document.createElement('script');
                s.src = e.src;
                s.charset = 'UTF-8';
                s.onload = resolve;
                s.onerror = () => {
                    e.promise = null; // allow a retry
                    reject(new Error('LazyScripts: failed to load ' + e.src));
                };
                document.body.appendChild(s);
            });
        }
        return e.promise;
    }

    function loadAllWhenIdle() {
        const go = () => Object.keys(LAZY).filter(n => !LAZY[n].onDemand).forEach(n => load(n).catch(err => console.warn(err.message)));
        if (window.requestIdleCallback) requestIdleCallback(go, { timeout: 3000 });
        else setTimeout(go, 1000);
    }

    watchGameStart();
    startAfterIntro();
    // After the intro and the art/sound preload, never competing with them.
    (function whenPreloaded() {
        if (allDone) allDone.then(loadAllWhenIdle);
        else setTimeout(whenPreloaded, 500);
    })();

    window.AssetPreloader = {
        start,
        isDone: () => started && assets.every(a => a.done),
    };
    window.LazyScripts = { load };
})();
