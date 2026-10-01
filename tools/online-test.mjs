// tools/online-test.mjs: run online test games from your own computer.
//
// Opens several browser windows on the live game (or any URL), signs each one
// in, makes a test room in window 1, the others join, starts the game, and the
// test-game autopilot (js/test-game.js) plays every seat over the real network
// and Supabase. Prints each window's test report at the end and whether the
// boards matched. Exit code 1 when something looked wrong.
//
// One-time setup (in the repo folder):
//   npm i -D playwright
//   npx playwright install chromium
//
// Run:
//   node tools/online-test.mjs                      2 guest windows, 1 game, mild chaos
//   node tools/online-test.mjs --windows 3 --games 2
//   node tools/online-test.mjs --chaos off          no fake drops / slow links
//   node tools/online-test.mjs --freeze 45          freezes window 2 for 45 s once (like a phone
//                                                   screen going to sleep), then wakes it
//   node tools/online-test.mjs --headful            show the windows
//   node tools/online-test.mjs --url https://godaigo.aikijake.workers.dev/
//
// Guests get no gold (server rule), so this can run any time. To use real
// accounts, set GODAIGO_USER_1 / GODAIGO_PASS_1, GODAIGO_USER_2 / GODAIGO_PASS_2, ...
// (signed-in reports count toward the daily test reward, max 2 a day).
import { chromium } from 'playwright';

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf('--' + name); return i >= 0 ? (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true) : def; };
const URL_ = opt('url', 'https://playgodaigo.com/');
const WINDOWS = Math.max(2, Math.min(5, Number(opt('windows', 2))));
const GAMES = Math.max(1, Number(opt('games', 1)));
const CHAOS = opt('chaos', 'mild');
const FREEZE_S = Number(opt('freeze', 0));
const HEADFUL = !!opt('headful', false);
const GAME_MINUTES = Number(opt('minutes', 25));

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const say = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

async function openWindow(browser, k) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await ctx.addInitScript((chaos) => {
        try { sessionStorage.setItem('godaigo_skip_intro_once', '1'); } catch (e) {}
        try { localStorage.setItem('godaigo_test_chaos', chaos === 'off' ? 'off' : 'on'); } catch (e) {}
    }, CHAOS);
    const page = await ctx.newPage();
    page.errors = [];
    page.on('pageerror', e => page.errors.push(e.message));
    await page.goto(URL_, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#auth-screen, #auth-bar', { timeout: 60000 });
    await sleep(2500);
    const user = process.env['GODAIGO_USER_' + (k + 1)], pass = process.env['GODAIGO_PASS_' + (k + 1)];
    if (user && pass) {
        await page.fill('#auth-username', user);
        await page.fill('#auth-password', pass);
        await page.click('#auth-login-btn');
    } else {
        await page.evaluate(() => window.authGuestLogin?.());
    }
    await page.waitForFunction(() => {
        const bar = document.getElementById('auth-bar');
        return bar && getComputedStyle(bar).display !== 'none';
    }, null, { timeout: 60000 });
    say(`window ${k + 1} signed in as ${user || 'guest'}`);
    return page;
}

async function freezeFor(page, seconds) {
    const cdp = await page.context().newCDPSession(page);
    say(`freezing window 2 for ${seconds} s`);
    await cdp.send('Page.setWebLifecycleState', { state: 'frozen' });
    await sleep(seconds * 1000);
    await cdp.send('Page.setWebLifecycleState', { state: 'active' });
    say('window 2 woken up');
}

const view = (p) => p.evaluate(() => {
    let turn = null, active = null;
    try { turn = currentTurnNumber; active = activePlayerIndex; } catch (e) {}
    const s = window.TestGame?.stats?.();
    return {
        turn, active, test: !!window.TestGame?.isActive?.(), paused: !!window.isGamePaused?.(),
        over: !!document.getElementById('game-over-notification'),
        fp: window.MatchWitness?.fingerprint?.() || null,
        result: window.TestGame?.lastResult || null,
        stats: s ? { chaos: s.chaos.length, pauses: s.pauses, drops: s.self_drops, errors: s.errors, lagMax: s.lag.max } : null,
    };
});

async function playOne(pages, n) {
    const [host, ...rest] = pages;
    // fresh lobby for everyone
    for (const p of pages) await p.evaluate(() => { try { window.TestGame.lastResult = null; } catch (e) {} });
    await host.evaluate(() => createRoom(false));
    await host.waitForFunction(() => { try { return currentGameId != null; } catch (e) { return false; } }, null, { timeout: 30000 });
    const roomId = await host.evaluate(() => currentGameId);
    // test switch (js/test-game.js adds it to the host settings)
    await host.waitForSelector('#test-mode-toggle', { timeout: 30000 });
    await host.evaluate(() => { const b = document.getElementById('test-mode-toggle'); if (!b.checked) b.click(); });
    say(`game ${n}: test room ${roomId}`);
    for (const p of rest) {
        await p.evaluate((id) => joinPublicGame(id), roomId);
        await sleep(1500);
    }
    await sleep(3000);
    await host.evaluate(() => hostStartGame());
    say(`game ${n}: started`);

    const t0 = Date.now();
    let froze = false;
    while (Date.now() - t0 < GAME_MINUTES * 60000) {
        await sleep(20000);
        const v = [];
        for (const p of pages) v.push(await view(p).catch(e => ({ error: e.message })));
        say(v.map((x, i) => `w${i + 1}: turn ${x.turn} active ${x.active}${x.paused ? ' PAUSED' : ''}${x.over ? ' OVER' : ''} ${x.stats ? JSON.stringify(x.stats) : ''}`).join(' | '));
        if (FREEZE_S && !froze && v[0].turn >= 8 && pages[1]) { froze = true; await freezeFor(pages[1], FREEZE_S); }
        if (v.every(x => x.result)) break;
    }
    const final = [];
    for (const p of pages) final.push(await view(p).catch(e => ({ error: e.message })));
    const fps = [...new Set(final.map(x => x.fp))];
    let bad = false;
    final.forEach((x, i) => {
        const r = x.result;
        say(`w${i + 1} report: ${r ? JSON.stringify({ gold: r.my_gold, reason: r.reason, error: r.error }) : 'NOT SENT'}`);
        if (!r || r.error) bad = true;
    });
    say(`boards at the end: ${fps.length === 1 ? 'all the same' : 'DIFFERENT ' + JSON.stringify(fps)}`);
    if (fps.length !== 1) bad = true;
    pages.forEach((p, i) => { if (p.errors.length) { bad = true; say(`w${i + 1} page errors:`, p.errors.slice(0, 5)); } });
    // back to the lobby for the next game
    for (const p of pages) await p.evaluate(() => { document.querySelector('.retro-dlg-overlay button')?.click(); }).catch(() => {});
    await sleep(3000);
    return !bad;
}

const browser = await chromium.launch({ headless: !HEADFUL });
const pages = [];
for (let k = 0; k < WINDOWS; k++) pages.push(await openWindow(browser, k));
let ok = true;
for (let n = 1; n <= GAMES; n++) {
    try { ok = (await playOne(pages, n)) && ok; }
    catch (e) { ok = false; say(`game ${n} failed:`, e.message); }
    if (n < GAMES) for (const p of pages) { await p.goto(URL_, { waitUntil: 'domcontentloaded' }); await sleep(4000); }
}
await browser.close();
say(ok ? 'All test games looked fine.' : 'Something looked wrong, see above. Also check the Hermit menu: Test games.');
process.exit(ok ? 0 : 1);
