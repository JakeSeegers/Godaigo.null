// version.js: makes sure every player runs the newest game files.
//
// GAME_VERSION below is bumped on every push that changes game files
// (node tools/bump-version.js; the Claude Stop hook reminds). The browser
// may keep old copies of the game files for a while (GitHub Pages lets it
// cache them for 10 minutes), and a tab left open keeps its old code for as
// long as it stays open. Two players on different versions can go out of
// sync (match 5, 2026-09-24: one tab was 14 minutes old).
//
// So this file asks the server for the newest version.js (never cached):
//   * when the page loads (usually during the intro),
//   * every 2 minutes, and when the tab comes back into view.
// If the server has a newer version:
//   * not in a room or game (and not typing): re-download every game file (so the browser
//     cache holds the new ones) and reload, like a hard refresh. Only once
//     per version, so a slow server can never cause a reload loop.
//   * in a waiting room: a banner with a Reload button (reloading on its own
//     would pull the player out of the room).
//   * in a game, tutorial or replay: nothing until the game is over.
window.GAME_VERSION = '2026-10-01.0325';

(function () {
    const CHECK_MS = 2 * 60 * 1000;
    const RELOAD_KEY = 'godaigo_update_reload';
    // Loaded on demand (asset-preloader.js LazyScripts); refresh them too.
    const EXTRA_FILES = ['index.html', 'js/tutorial-mode.js', 'js/bot-arena.js', 'js/plinko-sim.js', 'changelog.json'];

    let checking = false;
    let latest = null;   // newer version seen on the server, if any
    let updating = false;

    function log(...a) { console.log('[update]', ...a); }

    async function fetchLatest() {
        const res = await fetch('js/version.js?t=' + Date.now(), { cache: 'no-store' });
        if (!res.ok) return null;
        const m = (await res.text()).match(/GAME_VERSION\s*=\s*'([^']+)'/);
        return m ? m[1] : null;
    }

    function where() {
        try {
            if (window.Replay?.state) return 'busy';
            if (window.isTutorialMode) return 'busy';
            if (document.getElementById('game-layout')?.classList.contains('active')) return 'busy';
            if (typeof currentGameId !== 'undefined' && currentGameId) return 'room';
        } catch (e) {}
        return 'free';
    }

    // Every file this page loaded from our own site, plus the lazy ones.
    function ownFiles() {
        const urls = new Set();
        const add = (u) => {
            try {
                const url = new URL(u, location.href);
                if (url.origin === location.origin) urls.add(url.pathname + url.search);
            } catch (e) {}
        };
        document.querySelectorAll('script[src]').forEach(s => add(s.getAttribute('src')));
        document.querySelectorAll('link[rel=stylesheet][href]').forEach(l => add(l.getAttribute('href')));
        EXTRA_FILES.forEach(add);
        add(location.pathname);
        return [...urls];
    }

    async function updateNow(version) {
        if (updating) return;
        let tried = null;
        try { tried = sessionStorage.getItem(RELOAD_KEY); } catch (e) {}
        if (tried === version) {
            log(`already reloaded once for ${version}; the server may still be catching up`);
            return;
        }
        updating = true;
        try { sessionStorage.setItem(RELOAD_KEY, version); } catch (e) {}
        log(`new version ${version} (running ${window.GAME_VERSION}), updating`);
        showNote('Updating to the newest version...', false);
        // cache: 'reload' downloads each file fresh AND stores it in the
        // browser cache, so the reload below uses the new copies.
        const files = ownFiles();
        const timeout = new Promise(r => setTimeout(r, 8000));
        await Promise.race([
            Promise.allSettled(files.map(u => fetch(u, { cache: 'reload' }))),
            timeout,
        ]);
        location.reload();
    }

    function showNote(text, withButton) {
        let el = document.getElementById('update-note');
        if (!el) {
            el = document.createElement('div');
            el.id = 'update-note';
            el.style.cssText = [
                'position:fixed', 'left:50%', 'top:12px', 'transform:translateX(-50%)',
                'z-index:100000', 'background:#1d1a14', 'color:#f3e6c4',
                'border:2px solid #c9a24a', 'padding:8px 14px', 'border-radius:6px',
                'font:14px/1.3 "Space Grotesk",sans-serif', 'box-shadow:0 4px 14px rgba(0,0,0,.4)',
                'display:flex', 'gap:10px', 'align-items:center', 'max-width:calc(100vw - 32px)',
            ].join(';');
            document.body.appendChild(el);
        }
        el.textContent = text;
        if (withButton) {
            const b = document.createElement('button');
            b.textContent = 'Reload';
            b.style.cssText = 'background:#c9a24a;color:#1d1a14;border:0;padding:4px 10px;border-radius:4px;cursor:pointer;font:inherit;font-weight:600';
            b.onclick = () => updateNow(latest);
            el.appendChild(b);
        }
    }

    function hideNote() { document.getElementById('update-note')?.remove(); }

    // Act on a known newer version, depending on what the player is doing.
    function typing() {
        const el = document.activeElement;
        return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
    }

    function apply() {
        if (!latest || updating) return;
        const w = where();
        if (w === 'free' && !typing()) updateNow(latest);
        else if (w === 'free') showNote('A new version of the game is out.', true);
        else if (w === 'room') showNote('A new version of the game is out. Reload to get it (you will leave this room).', true);
        else hideNote(); // in a game: wait until it is over
    }

    async function check() {
        if (checking || updating) return;
        checking = true;
        try {
            const v = await fetchLatest();
            if (v && v !== window.GAME_VERSION) latest = v;
            else if (v === window.GAME_VERSION) { latest = null; hideNote(); }
        } catch (e) {
            // offline or blocked: try again next time
        } finally {
            checking = false;
        }
        apply();
    }

    check();
    setInterval(check, CHECK_MS);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
    // Leaving a room or finishing a game changes where(): re-apply often,
    // without asking the server again.
    setInterval(apply, 5000);

    window.GameVersion = { check, get latest() { return latest; } };
})();
