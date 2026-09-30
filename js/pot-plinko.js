// pot-plinko.js: window.PotPlinko, the pot drop shown at game over.
//
// When a finished online game qualifies for the pot, the server records a
// drop (sql/pot-plinko.sql, pot_drops: seed + coins = pot / 10, at most 70).
// The edge function supabase/functions/pot-drop runs the physics
// (js/plinko-sim.js + Matter.js) and pays the pot if a coin falls into the
// treasure. Here, every player of that game replays the same drop: same seed,
// same code, so the coins fall the same way. The server's landing slots are
// the truth: this file first runs the drop once without drawing, and any coin
// that would land somewhere else is steered to the server's slot in its last
// moments (only ever needed on a browser whose maths differ slightly).
//
// Coins are the Pipoya Gold Coin emote (P73), the treasure is the Treasure
// Chest emote (P75). Click Skip to jump to the end; reduced motion shows the
// end at once. Rewards.checkNotices waits while busy() so the pot pop-up comes
// after the drop.
(function () {
    'use strict';

    const SHEET = 'images/emotes/pipoya-emotes.png';
    const COIN = 73, CHEST = 75;
    const WAIT_MS = 12000;        // how long to look for a drop after game over

    let busyUntil = 0;
    let shownDrop = null;
    let sheet = null;

    function busy() { return Date.now() < busyUntil; }

    function loadSheet() {
        if (sheet) return sheet;
        sheet = new Promise((resolve) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = () => resolve(null);
            img.src = SHEET;
        });
        return sheet;
    }

    const sleep = (ms) => new Promise(r => setTimeout(r, ms));

    async function getDrop(room) {
        try {
            const { data, error } = await supabase.rpc('get_pot_drop', { p_room: room });
            return error ? null : data;
        } catch (e) { return null; }
    }

    async function runServer(room) {
        try { await supabase.functions.invoke('pot-drop', { body: { room } }); } catch (e) { /* retried */ }
    }

    // Called from lobby.js showGameOverToAll.
    async function onGameOver() {
        let room = null;
        try {
            if (typeof isMultiplayer === 'undefined' || !isMultiplayer || window.Replay?.state) return;
            room = typeof currentGameId !== 'undefined' ? currentGameId : null;
        } catch (e) { return; }
        if (!room || !window.gami?.userId) return;
        busyUntil = Date.now() + WAIT_MS + 2000;

        const start = Date.now();
        let drop = null, invoked = 0;
        await sleep(1500);   // the host records the end of the game first
        while (Date.now() - start < WAIT_MS + 30000) {
            drop = await getDrop(room);
            if (drop?.status === 'done') break;
            if (!drop && Date.now() - start > WAIT_MS) break;   // no drop for this game
            if (drop && invoked < 3 && Date.now() - start > 1500 + invoked * 4000) {
                invoked++;
                busyUntil = Date.now() + 20000;
                runServer(room);
            }
            await sleep(2000);
        }
        if (!drop || drop.status !== 'done' || shownDrop === drop.id) { busyUntil = 0; return; }
        shownDrop = drop.id;
        busyUntil = Date.now() + 120000;
        try {
            await Promise.all([window.LazyScripts.load('matter'), window.LazyScripts.load('plinko-sim')]);
            await show(drop);
        } catch (e) {
            console.warn('[pot-plinko]', e);
        }
        busyUntil = 0;
        window.Rewards?.checkNotices?.();
    }

    // Draw one emote frame (32x32) from the sheet, centred at (x, y).
    // bare: only the middle 12x12 (the coin without its speech bubble).
    function drawEmote(ctx, img, n, x, y, size, frame, bare) {
        if (!img) {
            ctx.fillStyle = n === COIN ? '#f5c542' : '#8b5a2b';
            ctx.beginPath(); ctx.arc(x, y, size / 2.4, 0, Math.PI * 2); ctx.fill();
            return;
        }
        const sx = (n % 10) * 96 + (frame % 3) * 32, sy = Math.floor(n / 10) * 32;
        if (bare) ctx.drawImage(img, sx + 10, sy + 8, 12, 12, x - size / 2, y - size / 2, size, size);
        else ctx.drawImage(img, sx, sy, 32, 32, x - size / 2, y - size / 2, size, size);
    }

    // Replay a settled drop. Resolves when the player closes it.
    async function show(drop) {
        const S = window.PlinkoSim, M = window.Matter;
        const img = await loadSheet();
        const slots = drop.slots || [];
        const coins = Math.min(drop.coins, slots.length);

        // Dry run: where would each coin land here? Steer the ones that differ.
        const local = S.simulate({ seed: Number(drop.seed), coins, Matter: M });
        const T = S.TUBE, tubeMid = T.x + T.w / 2, tubeTop = S.FLOOR_Y - T.h;
        const targetX = slots.map((s, i) => {
            if (local.slots[i] === s) return null;
            return s === -1 ? tubeMid : s * S.SLOT_W + S.SLOT_W / 2;
        });
        const steered = targetX.filter(x => x !== null).length;
        if (steered) console.info(`[pot-plinko] steering ${steered} coin(s) to the server's slots`);

        const sim = S.create({ seed: Number(drop.seed), coins, Matter: M });
        const pegs = sim.pegs;
        const chestX = tubeMid, chestY = S.FLOOR_Y + 30;
        const hitCoin = drop.hit_coin;

        const box = document.createElement('div');
        box.id = 'pot-plinko';
        box.innerHTML = `
            <div class="pp-panel">
                <div class="pp-head">
                    <span class="pp-icon">${window.emojiSystem?.spriteHtml?.(COIN, 0.9) || ''}</span>
                    <b>The pot: ${drop.pot_amount}g = ${coins} coin${coins === 1 ? '' : 's'}</b>
                </div>
                <div class="pp-sub">One coin in the treasure and the pot pays out to everyone in the game.</div>
                <canvas class="pp-canvas"></canvas>
                <div class="pp-status">Dropping...</div>
                <div class="pp-buttons"><button class="pp-skip">Skip</button><button class="pp-close" style="display:none">Close</button></div>
            </div>`;
        document.body.appendChild(box);
        const canvas = box.querySelector('.pp-canvas');
        const status = box.querySelector('.pp-status');
        const ctx = canvas.getContext('2d');
        const VIEW_H = S.FLOOR_Y + 70;
        const scale = Math.max(0.5, Math.min(1.4, (window.innerHeight * 0.62) / VIEW_H, (window.innerWidth - 48) / S.W));
        const dpr = window.devicePixelRatio || 1;
        canvas.width = Math.round(S.W * scale * dpr);
        canvas.height = Math.round(VIEW_H * scale * dpr);
        canvas.style.width = Math.round(S.W * scale) + 'px';
        canvas.style.height = Math.round(VIEW_H * scale) + 'px';
        ctx.imageSmoothingEnabled = false;

        const drawn = new Map();       // coin index -> last drawn x (for steering)
        const landedAt = [];           // { x, t, treasure }
        const sparks = [];
        let landedCount = 0, chestBump = 0, t = 0, finished = false;

        function coinX(c) {
            const b = c.body, tx = targetX[c.i];
            if (tx === null || tx === undefined) return b.position.x;
            // Steer in the 80 units above the tube's top, so a coin enters (or misses)
            // the tube from above and never passes through a wall.
            const k = Math.max(0, Math.min(1, (b.position.y - (tubeTop - 80)) / 80));
            return b.position.x + (tx - b.position.x) * k;
        }

        function draw() {
            ctx.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0);
            ctx.clearRect(0, 0, S.W, VIEW_H);
            ctx.fillStyle = '#15121f';
            ctx.fillRect(0, 0, S.W, VIEW_H);
            for (const p of pegs) {
                ctx.fillStyle = p.random ? '#b388ff' : '#8a8fa3';
                ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
            }
            // Floor with slot marks and the golden treasure mouth.
            ctx.fillStyle = '#2b2540';
            ctx.fillRect(0, S.FLOOR_Y, S.W, 4);
            ctx.fillStyle = '#3b3456';
            for (let x = S.SLOT_W; x < S.W; x += S.SLOT_W) ctx.fillRect(x - 0.5, S.FLOOR_Y - 10, 1, 10);
            // The treasure tube: dark inside, gold walls, open at the bottom onto the chest.
            ctx.fillStyle = '#15121f';
            ctx.fillRect(T.x, S.FLOOR_Y - 1, T.w, 6);
            ctx.fillStyle = 'rgba(255, 213, 74, 0.08)';
            ctx.fillRect(T.x, tubeTop, T.w, T.h);
            ctx.fillStyle = '#ffd54a';
            ctx.fillRect(T.x - T.t, tubeTop, T.t, T.h + 4);
            ctx.fillRect(T.x + T.w, tubeTop, T.t, T.h + 4);
            const bump = chestBump > 0 ? Math.sin(chestBump * 0.4) * 4 : 0;
            drawEmote(ctx, img, CHEST, chestX, chestY - Math.abs(bump), 44, Math.floor(t / 12));
            for (const c of sim.coins) {
                if (!c.body) continue;
                drawEmote(ctx, img, COIN, coinX(c), c.body.position.y, 14, Math.floor((t + c.i * 7) / 10), true);
            }
            for (const s of sparks) {
                ctx.globalAlpha = Math.max(0, s.life / 60);
                drawEmote(ctx, img, COIN, s.x, s.y, 12, 0, true);
            }
            ctx.globalAlpha = 1;
        }

        function burst() {
            for (let i = 0; i < 26; i++) {
                const a = (i / 26) * Math.PI * 2;
                sparks.push({ x: chestX, y: chestY - 10, vx: Math.cos(a) * (1.5 + (i % 3)), vy: Math.sin(a) * 2 - 3, life: 80 });
            }
        }

        function tickSparks() {
            for (const s of sparks) { s.x += s.vx; s.y += s.vy; s.vy += 0.12; s.life--; }
            for (let i = sparks.length - 1; i >= 0; i--) if (sparks[i].life <= 0) sparks.splice(i, 1);
        }

        function stepOnce() {
            const before = new Set(sim.coins.filter(c => c.body).map(c => c.i));
            const more = sim.step();
            for (const c of sim.coins) {
                if (c.body || !before.has(c.i)) continue;
                landedCount++;
                if (slots[c.i] === -1) { chestBump = 30; burst(); }
            }
            return more;
        }

        function resultText() {
            if (drop.won) return `${window.emojiSystem?.spriteHtml?.(CHEST, 0.8) || ''} Treasure! Coin ${hitCoin + 1} fell in. The pot pays ${drop.share}g to each player!`;
            if (hitCoin !== null && hitCoin !== undefined) return 'Treasure! But the pot was already won today.';
            return `No coin fell in. The pot stays at ${drop.pot_now ?? drop.pot_amount}g. So close!`;
        }

        function finish() {
            if (finished) return;
            finished = true;
            status.innerHTML = resultText();
            status.classList.toggle('pp-win', !!drop.won);
            box.querySelector('.pp-skip').style.display = 'none';
            box.querySelector('.pp-close').style.display = '';
            if (drop.won) { burst(); window.SoundSystem?.play?.('wincondition'); }
        }

        return new Promise((resolve) => {
            let raf = 0, stop = false;
            const close = () => { stop = true; cancelAnimationFrame(raf); box.remove(); resolve(); };
            box.querySelector('.pp-close').onclick = close;
            box.querySelector('.pp-skip').onclick = () => {
                while (stepOnce()) { /* jump to the end */ }
                finish();
            };
            const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
            if (reduced) { while (stepOnce()) { /* no animation */ } sparks.length = 0; finish(); }

            let last = performance.now(), acc = 0;
            const frameMs = coins > 40 ? 1000 / 90 : 1000 / 60;   // big pots fall a bit faster
            function loop(now) {
                if (stop) return;
                acc = Math.min(acc + (now - last), 200);
                last = now;
                while (acc >= frameMs && !finished) {
                    acc -= frameMs;
                    if (!stepOnce()) finish();
                }
                if (finished) acc = 0;
                t++;
                if (chestBump > 0) chestBump--;
                tickSparks();
                draw();
                if (!finished) status.textContent = `Coins down: ${landedCount} / ${coins}`;
                raf = requestAnimationFrame(loop);
            }
            raf = requestAnimationFrame(loop);
            // Leave the result up for a while, then close on its own.
            let finishedFor = 0;
            const auto = setInterval(() => {
                if (stop) { clearInterval(auto); return; }
                if (finished && !box.matches(':hover') && ++finishedFor > 8) { clearInterval(auto); close(); }
            }, 1000);
        });
    }

    // Hermit test: replay any seed without the server (console:
    // PotPlinko.preview(123, 34)).
    async function preview(seed, coins, won) {
        await Promise.all([window.LazyScripts.load('matter'), window.LazyScripts.load('plinko-sim')]);
        const r = window.PlinkoSim.simulate({ seed, coins, Matter: window.Matter });
        console.info(`[pot-plinko] preview seed ${seed}, ${coins} coins`);
        return show({ id: -1, seed, coins, pot_amount: coins * 10, slots: r.slots, hit_coin: r.hit,
                      won: won ?? r.hit !== null, share: coins * 5, pot_now: coins * 10 });
    }

    window.PotPlinko = { onGameOver, busy, show, preview };
})();
