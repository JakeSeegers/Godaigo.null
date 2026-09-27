#!/usr/bin/env node
// arena-headless.mjs — run BotArena self-play in headless Chromium, no open tab needed.
//
// Smoke mode (phase 1): a single A-vs-B series with the current default weights.
//   node tools/arena-headless.mjs --games 4 --seed 1
//
// Evolve mode (phase 2): weight evolution sharded across N parallel headless
// pages — each shard runs an independent BotArena.evolve() with its own seed
// and isolated storage, and all shard champions are written to one results file.
//   node tools/arena-headless.mjs --evolve --shards 4 --generations 3 --pop 6 --games-per-pair 1
//
// Confirm mode (phase 3): pick the best shard champion and prove it. Runs a
// round-robin playoff among the shard champions from an evolve results file,
// then a confirmation series of playoff-winner vs the CURRENT baseline weights
// (whatever the page loads: bot.js defaults, or the Supabase-served champion
// when reachable). Only endorses the champion if it beats the baseline —
// the same confirmation gate the cheat panel's Train Weights button applies.
//   node tools/arena-headless.mjs --confirm                     # newest evolve-*.json
//   node tools/arena-headless.mjs --confirm path/to/results.json
//
// HillClimb mode (the RELIABLE trainer): a champion-anchored (1+λ) climber,
// parallelized across the page pool. Unlike evolve (which scores bots by
// beating their near-identical siblings over 1 noisy game — a downhill random
// walk), this holds the champion FIXED and each round plays λ mutant
// challengers against it for N games each, promoting one ONLY if it clears a
// real win-rate margin. The champion is monotonic — it can only go up. The λ
// trials fan out across --shards pages, so this is where your cores earn their
// keep. Writes hillclimb-<ts>.json + apply-champion.txt (if improved), and
// checkpoints every round so a timeout/crash never loses progress.
// Phase 2 (hall-of-fame gauntlet, on by default): each challenger also plays a
// budget vs recently-RETIRED champions, and can only be promoted if it holds a
// non-losing record against that field — so a bot that hard-counters just the
// latest champion but is worse overall can't sneak in (--hc-hof 0 disables it).
//   node tools/arena-headless.mjs --hillclimb --shards 6 --hc-rounds 20
//   node tools/arena-headless.mjs --hillclimb path/to/champion.json   # seed from a file
//
// Options (all modes unless noted):
//   --hillclimb [file]  hillclimb mode; optional seed-champion json (else page weights)
//   --hc-rounds N       climbing rounds (default 20)
//   --hc-lambda N       challengers per round (default 6; trials fan across --shards)
//   --hc-games N        games each challenger plays vs the champion (default 30)
//   --hc-promote R      win-rate over decided games needed to promote (default 0.58)
//   --hc-sigma X        base mutation step (default 0.2; auto-widens on barren rounds)
//   --hc-confirm N      games in the final champion-vs-starting confirm (default 20)
//   --hc-confirm-margin R  win-rate margin to call the run IMPROVED (default 0.55;
//                       a 5-5 tie / fitness hair does NOT count — guards against noise)
//   --hc-hof N          hall-of-fame size: retired champions kept as extra opponents
//                       (default 4; 0 = Phase-1 single-champion, no gauntlet)
//   --hc-hof-games N    games each challenger plays vs the hall of fame (default 20)
//   --hc-hof-floor R    min win-rate vs the hall of fame to be promotable (default 0.5;
//                       stops a challenger that hard-counters only the latest champion)
//   --hc-allow-defaults  permit anchoring to DEFAULT weights when the online
//                       champion can't be fetched from Supabase. OFF by default:
//                       the runner ABORTS rather than silently train against the
//                       wrong opponent (a champion that beats defaults but loses
//                       online). A fresh (non-file, non-resumed) session always
//                       anchors its baseline + gauntlet to the current online
//                       champion (newest promoted row in bot_champion_weights).
//   --hc-session NAME   RESUMABLE session: run the SAME command in 20-40 min chunks
//                       and each one continues from where the last left off
//                       (champion, hall of fame, sigma, round history all persist to
//                       tools/.cache/hc-session-NAME.json). Ctrl-C anytime is safe.
//                       Each chunk writes apply-champion.txt (local-apply, pinned, +
//                       an optional "share online" Supabase snippet).
//   --seed N            base RNG seed (default 1)
//   --players N|all     players per game, 2-5, or 'all' (default 2). 'all' is
//                       GENERALIST mode: evolve samples a fresh player count
//                       per game, and --confirm swaps the 2p playoff+series
//                       for BotArena.confirmAcrossSizes (champion vs a field
//                       of baselines at every size, same seed per champion)
//   --games-per-size N  generalist confirm: games per table size (default 4)
//   --speed X           BotSystem.speedScale (default 0.1, arena normal)
//   --timeout M         watchdog: kill everything after M minutes (default 360 = 6h).
//                       hillclimb checkpoints every round to its output json, so a
//                       timeout/crash/Ctrl-C never loses the champion reached so far.
//   --headed            visible browser window(s) (debugging)
//   --verbose           stream the page's [Bot]/[BotArena] console lines
//   --games N           smoke mode: games in the series (default 4)
//   --shards N          evolve mode: parallel headless pages (default 4)
//   --generations N     evolve mode: generations per shard (default 3)
//   --pop N             evolve mode: population size per shard (default 6)
//   --games-per-pair N  evolve mode: games per round-robin pairing (default 1)
//   --out FILE          evolve/confirm mode: results JSON path (default tools/.cache/<mode>-<ts>.json)
//   --playoff-games N   confirm mode: games per champion pairing (default 2)
//   --confirm-games N   confirm mode: games in the final vs-baseline series (default 10)
//
// The game page needs supabase-js from unpkg; when that CDN is unreachable
// (offline, locked-down proxy) the script serves a cached copy from
// tools/.cache/ instead. On a machine with normal network the script caches
// it automatically on first run; to seed the cache by hand:
//   npm pack @supabase/supabase-js@2.39.3 && tar -xzf supabase-supabase-js-2.39.3.tgz \
//     package/dist/umd/supabase.js && mv package/dist/umd/supabase.js tools/.cache/supabase.js

import http from 'node:http';
import { createReadStream, existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { join, extname, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';

const ROOT = normalize(join(dirname(fileURLToPath(import.meta.url)), '..'));
const CACHE_DIR = join(ROOT, 'tools', '.cache');
const SUPABASE_CACHE = join(CACHE_DIR, 'supabase.js');

// ---------------------------------------------------------------- args
function arg(name, fallback) {
    const i = process.argv.indexOf(`--${name}`);
    if (i === -1) return fallback;
    const v = process.argv[i + 1];
    return v === undefined || v.startsWith('--') ? true : v;
}
const OPTS = {
    evolve: !!arg('evolve', false),
    confirm: arg('confirm', false), // false | true (newest results) | path
    playoffGames: +arg('playoff-games', 2),
    confirmGames: +arg('confirm-games', 10),
    games: +arg('games', 4),
    seed: +arg('seed', 1),
    // 2-5, or 'all' (GENERALIST mode): evolve samples a fresh player count
    // per game and confirm uses the across-sizes gate instead of a 2p series
    players: (v => v === 'all' ? 'all' : +v)(arg('players', 2)),
    gamesPerSize: +arg('games-per-size', 4), // generalist confirm: games per table size
    speed: +arg('speed', 0.1),
    timeoutMs: +arg('timeout', 360) * 60_000, // watchdog cap in MINUTES (default 6h; hillclimb runs are multi-hour)
    headed: !!arg('headed', false),
    verbose: !!arg('verbose', false),
    shards: +arg('shards', 4),
    generations: +arg('generations', 3),
    pop: +arg('pop', 6),
    gamesPerPair: +arg('games-per-pair', 1),
    out: arg('out', null),
    // hillClimb mode (champion-anchored monotonic climber, parallelized)
    hillclimb: arg('hillclimb', false), // false | true (seed from page weights) | path to a seed champion json
    hcRounds: +arg('hc-rounds', 20),
    hcLambda: +arg('hc-lambda', 6),
    hcGames: +arg('hc-games', 30),
    hcPromote: +arg('hc-promote', 0.58),
    hcSigma: +arg('hc-sigma', 0.2),
    hcConfirm: +arg('hc-confirm', 20),          // games in the final champion-vs-starting confirm
    hcConfirmMargin: +arg('hc-confirm-margin', 0.55), // win rate over decided games needed to call it IMPROVED
    // Phase 2 — hall-of-fame gauntlet (guards against rock-paper-scissors exploits)
    hcHof: +arg('hc-hof', 4),                   // retired champions kept as extra opponents (0 = Phase-1 single-champion)
    hcHofGames: +arg('hc-hof-games', 20),       // games each challenger plays vs the hall of fame (split across it)
    hcHofFloor: +arg('hc-hof-floor', 0.5),      // min win rate vs the hall of fame to be promotable
    hcSession: arg('hc-session', null),         // named resumable session: same command each chunk continues it
    hcAllowDefaults: !!arg('hc-allow-defaults', false), // permit anchoring to DEFAULTS when the online champion can't be fetched (off = abort loudly)
};

// ---------------------------------------------------------------- hillclimb helpers
// Node-side mirrors of bot-arena.js's mulberry32 + mutate, so the parallel
// runner can generate challengers in Node (each trial is then dispatched to a
// page as a plain BotArena.run(challenger, champion) A/B series). Kept in exact
// sync with bot-arena.js: same brain-shape exclusions, same per-weight Gaussian.
function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
function mutate(table, rng, sigma = 0.2) {
    const out = { ...table };
    for (const k of Object.keys(out)) {
        if (typeof out[k] !== 'number') continue;
        if (k === 'searchDepth' || k === 'searchBreadth' || k === 'searchHybrid') continue; // brain shape, not tuning
        const u1 = Math.max(rng(), 1e-9), u2 = rng();
        const gauss = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
        out[k] = +(out[k] + gauss * sigma * Math.max(1, Math.abs(out[k]))).toFixed(3);
    }
    return out;
}

// ---------------------------------------------------------------- playwright
// Resolve the playwright package whether it's installed locally or globally.
async function loadPlaywright() {
    const localRequire = createRequire(import.meta.url);
    try { return localRequire('playwright'); } catch {}
    const globalRoot = execSync('npm root -g').toString().trim();
    return createRequire(join(globalRoot, 'noop.js'))('playwright');
}

// ---------------------------------------------------------------- static server
const MIME = {
    '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
    '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml',
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.gif': 'image/gif', '.ico': 'image/x-icon', '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.woff': 'font/woff',
    '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.map': 'application/json',
};
function startServer() {
    const server = http.createServer(async (req, res) => {
        const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
        let filePath = normalize(join(ROOT, urlPath === '/' ? 'index.html' : urlPath));
        if (!filePath.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
        try {
            const s = await stat(filePath);
            if (s.isDirectory()) filePath = join(filePath, 'index.html');
            res.writeHead(200, { 'Content-Type': MIME[extname(filePath).toLowerCase()] || 'application/octet-stream' });
            createReadStream(filePath).pipe(res);
        } catch {
            res.writeHead(404); res.end('not found');
        }
    });
    return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

// ---------------------------------------------------------------- page boot
// Open one game page in its own (storage-isolated) context and wait until the
// bot stack is loaded. `tag` prefixes its console/error lines.
async function bootGamePage(browser, url, tag) {
    const context = await browser.newContext();
    const page = await context.newPage();

    // Third-party routes: fonts are cosmetic — kill them fast. supabase-js is
    // load-bearing — serve the cached copy, else fetch-and-cache from unpkg.
    await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
    await page.route(/unpkg\.com\/@supabase\/supabase-js/, async route => {
        if (existsSync(SUPABASE_CACHE)) {
            return route.fulfill({ path: SUPABASE_CACHE, contentType: 'text/javascript' });
        }
        try {
            const resp = await route.fetch();
            const body = await resp.body();
            mkdirSync(CACHE_DIR, { recursive: true });
            writeFileSync(SUPABASE_CACHE, body);
            console.log(`[runner] cached supabase-js to ${SUPABASE_CACHE}`);
            return route.fulfill({ response: resp, body });
        } catch {
            console.error(`[runner] FATAL: supabase-js unreachable and no cache at ${SUPABASE_CACHE}`);
            console.error('[runner] seed the cache per the header comment, then rerun.');
            return route.abort();
        }
    });

    page.on('pageerror', e => console.error(`[${tag} error] ${e.message}`));
    page.on('console', msg => {
        const t = msg.text();
        const arena = t.includes('[BotArena]');
        if ((arena && (OPTS.verbose || !OPTS.evolve)) ||
            (OPTS.verbose && (t.includes('[Bot]') || msg.type() === 'error'))) {
            console.log(`[${tag}] ${t}`);
        }
    });

    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(
        () => window.BotArena && window.BotSystem && window.BotState && window.BotSim,
        null, { timeout: 30_000 },
    );
    return page;
}

// ---------------------------------------------------------------- smoke mode
async function runSmoke(browser, url) {
    const page = await bootGamePage(browser, url, 'page');
    console.log(`[runner] game loaded; ${OPTS.games} game(s), seed ${OPTS.seed}, ${OPTS.players} players, speed ${OPTS.speed}`);

    const t0 = Date.now();
    const result = await page.evaluate(async ({ games, seed, players, speed }) => {
        // undefined weight tables = play with whatever WEIGHTS is currently
        // loaded (defaults, since a fresh context has no localStorage history).
        if (players === 2) {
            return await window.BotArena.run(undefined, undefined, games, seed, { speed });
        }
        // >2 players (or 'all' — cycle 2..5): no A/B series concept — play
        // N playMatch games directly.
        const out = { games: [], turns: 0 };
        for (let g = 0; g < games; g++) {
            const n = players === 'all' ? 2 + (g % 4) : players;
            const r = await window.BotArena.playMatch(Array(n).fill(undefined), { seed: seed + g, speed });
            out.games.push({ winner: r.winner, turns: r.turns, activated: r.activated });
            out.turns += r.turns;
        }
        return out;
    }, OPTS);
    const elapsed = (Date.now() - t0) / 1000;

    console.log('[runner] --- result ---');
    console.log(JSON.stringify(result, (k, v) => (k === 'games' && Array.isArray(v) && v.length > 20 ? `${v.length} games` : v), 2));
    console.log(`[runner] ${OPTS.games} game(s) in ${elapsed.toFixed(1)}s (${(elapsed / OPTS.games).toFixed(1)}s/game)`);
}

// ---------------------------------------------------------------- evolve mode
async function runEvolveShard(browser, url, shardIndex) {
    const tag = `shard ${shardIndex}`;
    const page = await bootGamePage(browser, url, tag);
    // Each shard gets a well-separated seed: evolve() derives per-game seeds
    // as seed*100 + gen*10 + i + j, so consecutive base seeds would replay
    // overlapping game seeds across shards — space them out instead.
    const shardSeed = OPTS.seed + shardIndex * 7919;

    let lastFitness = null;
    await page.exposeFunction('__onGeneration', (gen, total, fitness) => {
        lastFitness = fitness;
        console.log(`[${tag}] generation ${gen}/${total} fitness: ${fitness.map(f => +f.toFixed(2)).join(', ')}`);
    });

    const t0 = Date.now();
    const champion = await page.evaluate(async ({ generations, pop, gamesPerPair, players, speed, shardSeed }) => {
        return await window.BotArena.evolve(generations, {
            popSize: pop,
            gamesPerPair,
            nPlayers: players,
            speed,
            seed: shardSeed,
            onGeneration: (gen, total, fitness) => window.__onGeneration(gen, total, fitness),
        });
    }, { ...OPTS, shardSeed });
    const elapsed = (Date.now() - t0) / 1000;

    console.log(`[${tag}] done in ${(elapsed / 60).toFixed(1)} min`);
    await page.context().close();
    return { shard: shardIndex, seed: shardSeed, elapsedSec: +elapsed.toFixed(1), championFitness: lastFitness?.[0] ?? null, champion };
}

async function runEvolve(browser, url) {
    const perShardGames = OPTS.players === 2
        ? OPTS.generations * (OPTS.pop * (OPTS.pop - 1) / 2) * OPTS.gamesPerPair
        : OPTS.generations * OPTS.pop * 3; // >2 or 'all': evolve's default gamesPerGen = popSize*3
    console.log(`[runner] evolve: ${OPTS.shards} shard(s) × ${OPTS.generations} gen × pop ${OPTS.pop} × ${OPTS.gamesPerPair} game(s)/pair ≈ ${perShardGames} games per shard, in parallel`);

    const t0 = Date.now();
    const shards = await Promise.all(
        Array.from({ length: OPTS.shards }, (_, i) => runEvolveShard(browser, url, i)),
    );
    const elapsed = (Date.now() - t0) / 1000;

    const results = {
        when: new Date().toISOString(),
        opts: {
            shards: OPTS.shards, generations: OPTS.generations, pop: OPTS.pop,
            gamesPerPair: OPTS.gamesPerPair, players: OPTS.players, speed: OPTS.speed, seed: OPTS.seed,
        },
        totalMinutes: +(elapsed / 60).toFixed(1),
        shards,
    };
    mkdirSync(CACHE_DIR, { recursive: true });
    const outPath = OPTS.out || join(CACHE_DIR, `evolve-${Date.now()}.json`);
    writeFileSync(outPath, JSON.stringify(results, null, 2));

    console.log('[runner] --- evolve summary ---');
    for (const s of shards) {
        console.log(`[runner] shard ${s.shard}: champion fitness ${s.championFitness ?? '?'} (${(s.elapsedSec / 60).toFixed(1)} min)`);
    }
    console.log(`[runner] ${OPTS.shards} shards × ~${perShardGames} games in ${(elapsed / 60).toFixed(1)} min total`);
    console.log(`[runner] shard champions written to ${outPath}`);
    console.log('[runner] next: pick/confirm a champion against the baseline (phase 3) before trusting any of these.');
}

// ---------------------------------------------------------------- confirm mode
// Run a list of A-vs-B series tasks across a pool of pages, in parallel.
async function runSeriesPool(browser, url, tasks) {
    const poolSize = Math.min(OPTS.shards, tasks.length);
    const queue = tasks.map((t, i) => ({ ...t, index: i }));
    const results = new Array(tasks.length);
    await Promise.all(Array.from({ length: poolSize }, async (_, w) => {
        const page = await bootGamePage(browser, url, `worker ${w}`);
        let task;
        while ((task = queue.shift())) {
            console.log(`[runner] ${task.label} (${task.games} games) starting on worker ${w}`);
            const r = await page.evaluate(async ({ a, b, games, seed, speed }) => {
                const res = await window.BotArena.run(a, b, games, seed, { speed });
                return {
                    aWins: res.aWins, bWins: res.bWins, draws: res.draws,
                    avgTurns: res.avgTurns, aFitness: res.aFitness, bFitness: res.bFitness,
                };
            }, { a: task.a, b: task.b, games: task.games, seed: task.seed, speed: OPTS.speed });
            console.log(`[runner] ${task.label}: A ${r.aWins} — B ${r.bWins} (draws ${r.draws}, fitness ${r.aFitness.toFixed(2)} vs ${r.bFitness.toFixed(2)})`);
            results[task.index] = { label: task.label, ...r };
        }
        await page.context().close();
    }));
    return results;
}

function newestEvolveResults() {
    const files = readdirSync(CACHE_DIR).filter(f => /^evolve-.*\.json$/.test(f)).sort();
    if (!files.length) throw new Error(`no evolve-*.json results in ${CACHE_DIR} — run --evolve first`);
    return join(CACHE_DIR, files[files.length - 1]);
}

async function runConfirm(browser, url) {
    const resultsPath = typeof OPTS.confirm === 'string' ? OPTS.confirm : newestEvolveResults();
    const evolveResults = JSON.parse(readFileSync(resultsPath, 'utf8'));
    const champions = evolveResults.shards.map(s => ({ shard: s.shard, w: s.champion }));
    console.log(`[runner] confirm: ${champions.length} shard champion(s) from ${resultsPath}`);

    // Baseline = whatever WEIGHTS the page actually plays with today. Captured
    // explicitly because playMatch treats an undefined table as "leave WEIGHTS
    // alone" — mixing an explicit champion with undefined would leak the
    // champion's weights into the baseline's turns. The short settle wait gives
    // bot.js's async Supabase champion-load a chance to apply first (no-op offline).
    const basePage = await bootGamePage(browser, url, 'baseline');
    const baseline = await basePage.evaluate(async () => {
        await new Promise(r => setTimeout(r, 1500));
        return { ...window.BotSystem.WEIGHTS };
    });
    await basePage.context().close();

    // GENERALIST confirm (evolve ran with --players all, or a fixed count >2):
    // a 2-player playoff + 2-player series would endorse the best DUELIST, the
    // exact mistake the across-sizes gate exists to prevent. Instead every
    // shard champion runs confirmAcrossSizes vs the baseline — champion in one
    // (rotating) seat against a field of baselines at each size — in parallel
    // across the page pool, ON THE SAME SEED (common random numbers: all
    // champions face identical decks, so ranking measures weights, not luck).
    const playersMode = evolveResults.opts?.players ?? OPTS.players;
    if (playersMode === 'all' || (typeof playersMode === 'number' && playersMode > 2)) {
        const sizes = playersMode === 'all' ? [2, 3, 4, 5] : [playersMode];
        const confirmSeed = OPTS.seed + 900_001;
        console.log(`[runner] generalist confirm: sizes [${sizes.join(',')}] × ${OPTS.gamesPerSize} game(s)/size per champion, shared seed ${confirmSeed}`);

        const confirms = new Array(champions.length);
        const queue = champions.map((c, i) => ({ ...c, index: i }));
        const poolSize = Math.min(OPTS.shards, queue.length);
        await Promise.all(Array.from({ length: poolSize }, async (_, w) => {
            const page = await bootGamePage(browser, url, `confirm worker ${w}`);
            let task;
            while ((task = queue.shift())) {
                console.log(`[runner] confirm-across-sizes: shard ${task.shard} champion starting on worker ${w}`);
                const r = await page.evaluate(async ({ champion, baseline, sizes, gamesPerSize, seed, speed }) => {
                    const res = await window.BotArena.confirmAcrossSizes(champion, baseline, { sizes, gamesPerSize, seed, speed });
                    return JSON.parse(JSON.stringify(res));
                }, { champion: task.w, baseline, sizes, gamesPerSize: OPTS.gamesPerSize, seed: confirmSeed, speed: OPTS.speed });
                console.log(`[runner] shard ${task.shard}: ${r.improved ? 'BEAT' : 'did not beat'} baseline — ` +
                    `champF ${r.champFitness.toFixed(2)} vs baseF ${r.baseFitness.toFixed(2)} (${r.record})`);
                confirms[task.index] = r;
            }
            await page.context().close();
        }));

        const ranked = champions.map((c, i) => ({ ...c, conf: confirms[i], margin: confirms[i].champFitness - confirms[i].baseFitness }))
            .sort((a, b) => (b.conf.improved - a.conf.improved) || (b.margin - a.margin));
        const winner = ranked[0];
        const confirmed = !!winner.conf.improved;

        const outPath = OPTS.out || join(CACHE_DIR, `champion-${Date.now()}.json`);
        writeFileSync(outPath, JSON.stringify({
            when: new Date().toISOString(),
            source: resultsPath,
            mode: 'generalist',
            sizes, gamesPerSize: OPTS.gamesPerSize,
            confirms: champions.map((c, i) => ({ shard: c.shard, ...confirms[i] })),
            confirmed,
            championShard: winner.shard,
            champion: winner.w,
        }, null, 2));

        console.log('[runner] --- generalist confirm verdict ---');
        if (confirmed) {
            const applyPath = join(CACHE_DIR, 'apply-champion.txt');
            writeFileSync(applyPath,
                `// Paste this whole line into the game's browser console, then reload the page:\n` +
                `localStorage.setItem('godaigo_bot_weights', ${JSON.stringify(JSON.stringify(winner.w))});\n`);
            console.log(`[runner] CONFIRMED: shard ${winner.shard}'s champion beat the baseline field across sizes ` +
                `(${winner.conf.record}; fitness ${winner.conf.champFitness.toFixed(2)} vs ${winner.conf.baseFitness.toFixed(2)}).`);
            console.log(`[runner] full details written to ${outPath}; apply line in ${applyPath}`);
        } else {
            console.log(`[runner] NOT confirmed: no shard champion beat the baseline field ` +
                `(best: shard ${winner.shard}, ${winner.conf.record}). Keep the current weights.`);
            console.log(`[runner] details written to ${outPath}`);
        }
        return;
    }

    // Playoff: round-robin among shard champions, evolve-style summed fitness.
    let playoff = null;
    let winner = champions[0];
    if (champions.length > 1) {
        const tasks = [];
        for (let i = 0; i < champions.length; i++) {
            for (let j = i + 1; j < champions.length; j++) {
                tasks.push({
                    label: `playoff: shard ${champions[i].shard} vs shard ${champions[j].shard}`,
                    a: champions[i].w, b: champions[j].w, i, j,
                    games: OPTS.playoffGames, seed: OPTS.seed + 500_000 + tasks.length * 101,
                });
            }
        }
        const results = await runSeriesPool(browser, url, tasks);
        const fitness = new Array(champions.length).fill(0);
        results.forEach((r, k) => { fitness[tasks[k].i] += r.aFitness; fitness[tasks[k].j] += r.bFitness; });
        const ranked = champions.map((c, i) => ({ ...c, fitness: +fitness[i].toFixed(2) })).sort((a, b) => b.fitness - a.fitness);
        console.log(`[runner] playoff ranking: ${ranked.map(r => `shard ${r.shard} (${r.fitness})`).join(' > ')}`);
        winner = ranked[0];
        playoff = { games: results, ranking: ranked.map(r => ({ shard: r.shard, fitness: r.fitness })) };
    }

    // Confirmation gate: playoff winner vs baseline.
    const [conf] = await runSeriesPool(browser, url, [{
        label: `confirmation: shard ${winner.shard} champion vs baseline`,
        a: winner.w, b: baseline, games: OPTS.confirmGames, seed: OPTS.seed + 900_000,
    }]);
    const confirmed = conf.aFitness > conf.bFitness;

    const outPath = OPTS.out || join(CACHE_DIR, `champion-${Date.now()}.json`);
    writeFileSync(outPath, JSON.stringify({
        when: new Date().toISOString(),
        source: resultsPath,
        playoff,
        confirmation: conf,
        confirmed,
        championShard: winner.shard,
        champion: winner.w,
    }, null, 2));

    console.log('[runner] --- confirm verdict ---');
    if (confirmed) {
        // A ready-to-paste browser-console line, so applying the champion is
        // copy file → paste in console → reload, nothing to hand-assemble.
        const applyPath = join(CACHE_DIR, 'apply-champion.txt');
        writeFileSync(applyPath,
            `// Paste this whole line into the game's browser console, then reload the page:\n` +
            `localStorage.setItem('godaigo_bot_weights', ${JSON.stringify(JSON.stringify(winner.w))});\n`);
        console.log(`[runner] CONFIRMED: shard ${winner.shard}'s champion beat the baseline ` +
            `(${conf.aWins}-${conf.bWins}, ${conf.draws} draws; fitness ${conf.aFitness.toFixed(2)} vs ${conf.bFitness.toFixed(2)}).`);
        console.log(`[runner] full details written to ${outPath}`);
        console.log('[runner] TO APPLY IT:');
        console.log(`[runner]   1. open ${applyPath}`);
        console.log('[runner]   2. copy the localStorage line, paste it into the game\'s browser console (F12), press Enter');
        console.log('[runner]   3. reload the game — bot.js loads the new weights automatically');
    } else {
        console.log(`[runner] NOT confirmed: baseline held (${conf.aWins}-${conf.bWins}, ${conf.draws} draws; ` +
            `fitness ${conf.aFitness.toFixed(2)} vs ${conf.bFitness.toFixed(2)}). Keep the current weights.`);
        console.log(`[runner] details written to ${outPath}`);
    }
}

// ---------------------------------------------------------------- hillclimb mode
// Champion-anchored (1+λ) monotonic climber, parallelized across the page pool.
// Node holds the champion; each round it spawns λ mutant challengers, dispatches
// their N-game trials-vs-champion across pages (runSeriesPool), then promotes the
// best ONLY if it clears the win-rate margin — so the champion can only go up.
// This mirrors BotArena.hillClimb() (in-page) but fans the trials across cores;
// the per-page trial is just the existing BotArena.run(challenger, champion).
async function runHillClimb(browser, url) {
    const N = OPTS.hcGames, lambda = OPTS.hcLambda, minDecided = Math.ceil(N / 2);
    const pool = Math.min(OPTS.shards, lambda);
    const seedPath = typeof OPTS.hillclimb === 'string' ? OPTS.hillclimb : null;
    const sessionName = OPTS.hcSession;
    mkdirSync(CACHE_DIR, { recursive: true });
    // Resumable sessions write/read a STABLE file so the same command continues
    // the run; a one-off run writes a timestamped file.
    const statePath = sessionName ? join(CACHE_DIR, `hc-session-${sessionName}.json`)
                                  : (OPTS.out || join(CACHE_DIR, `hillclimb-${Date.now()}.json`));
    const applyPath = join(CACHE_DIR, 'apply-champion.txt');

    // Full climbing state — loaded from the session file when resuming, so a
    // 20-40 min chunk picks up exactly where the last one left off (champion,
    // hall of fame, sigma, promotion count, round history, original baseline).
    let champion, baseline, hof, sigma, promotions, gamesPlayed, roundLog;
    if (sessionName && existsSync(statePath)) {
        const s = JSON.parse(readFileSync(statePath, 'utf8'));
        champion = s.champion; baseline = s.baseline || { ...s.champion };
        hof = s.hof || []; sigma = s.sigma ?? OPTS.hcSigma;
        promotions = s.promotions || 0; gamesPlayed = s.gamesPlayed || 0; roundLog = s.roundLog || [];
        console.log(`[runner] hillclimb: RESUMING session "${sessionName}" — ${roundLog.length} rounds done, ` +
            `${promotions} promotion(s), HoF ${hof.length}, sigma ${sigma.toFixed(2)}`);
    } else {
        if (seedPath) {
            const j = JSON.parse(readFileSync(seedPath, 'utf8'));
            champion = j.champion || j; // champion-*.json has .champion; a bare weights file is itself
            console.log(`[runner] hillclimb: seeding champion from ${seedPath}`);
        } else {
            // Anchor to the ACTUAL online opponent: explicitly query Supabase
            // for the current community champion (newest promoted row), so the
            // local gauntlet fights the bot people really face. The old path
            // just waited 1.5s for bot.js's background fetch and read WEIGHTS —
            // if that was slow/blocked it SILENTLY fell back to defaults, which
            // trains a bot that beats defaults but loses online (the bug hit).
            const p = await bootGamePage(browser, url, 'baseline');
            const seedRes = await p.evaluate(async () => {
                const defaults = { ...window.BotSystem.DEFAULT_WEIGHTS };
                try {
                    if (typeof supabase === 'undefined' || !supabase?.from)
                        return { source: 'defaults', reason: 'no Supabase client on the page', weights: defaults };
                    const { data, error } = await supabase.from('bot_champion_weights')
                        .select('weights, win_rate').order('promoted', { ascending: false }).order('created_at', { ascending: false }).limit(1); // current champion (newest promoted row)
                    if (error) return { source: 'defaults', reason: 'Supabase error: ' + error.message, weights: defaults };
                    if (!data || !data.length || !data[0].weights || typeof data[0].weights !== 'object')
                        return { source: 'defaults', reason: 'no champion rows in bot_champion_weights', weights: defaults };
                    return { source: 'supabase', winRate: data[0].win_rate, weights: data[0].weights };
                } catch (e) { return { source: 'defaults', reason: String((e && e.message) || e), weights: defaults }; }
            });
            await p.context().close();
            if (seedRes.source === 'supabase') {
                champion = seedRes.weights;
                console.log(`[runner] hillclimb: baseline = ONLINE CHAMPION from Supabase (win_rate ${seedRes.winRate}) — training against the real opponent.`);
            } else if (OPTS.hcAllowDefaults) {
                champion = seedRes.weights;
                console.log(`[runner] WARNING: could NOT load the online champion (${seedRes.reason}) — baseline is DEFAULTS (--hc-allow-defaults set).`);
            } else {
                console.log(`[runner] ABORT: could NOT load the online champion from Supabase (${seedRes.reason}).`);
                console.log('[runner] Refusing to anchor to DEFAULTS — that produces a champion that beats defaults but loses online (the exact bug you hit).');
                console.log('[runner] Fix the connection and retry, seed from a file (--hillclimb <champion.json>), or explicitly override with --hc-allow-defaults.');
                return;
            }
        }
        baseline = { ...champion }; sigma = OPTS.hcSigma;
        // Seed the gauntlet with the anchor champion (Supabase-seeded sessions
        // only) so challengers must keep beating the REAL online opponent across
        // the whole session, not just the latest session champion.
        hof = (OPTS.hcHof > 0 && !seedPath) ? [{ ...champion }] : [];
        promotions = 0; gamesPlayed = 0; roundLog = [];
        if (sessionName) console.log(`[runner] hillclimb: new session "${sessionName}"`);
    }

    // Advance the mutation stream past rounds already done so a resumed chunk
    // doesn't just replay the same challengers.
    const rng = mulberry32(OPTS.seed + roundLog.length * 100003);
    const t0 = Date.now();
    console.log(`[runner] hillclimb: +${OPTS.hcRounds} round(s) this chunk × ${lambda} challengers × ${N} games ` +
        `(pool ${pool}), promote ≥ ${Math.round(OPTS.hcPromote * 100)}%${OPTS.hcHof > 0 ? `, gauntlet HoF≤${OPTS.hcHof}` : ''}`);

    function writeState(status, extra = {}) {
        writeFileSync(statePath, JSON.stringify({
            when: new Date().toISOString(), status, session: sessionName || null,
            roundsDone: roundLog.length, roundsThisChunk: OPTS.hcRounds,
            lambda, gamesPerChallenge: N, promoteWinRate: OPTS.hcPromote,
            confirmGames: OPTS.hcConfirm, confirmMargin: OPTS.hcConfirmMargin, hcHof: OPTS.hcHof,
            promotions, gamesPlayed, sigma, minutesThisChunk: +((Date.now() - t0) / 60000).toFixed(1),
            baseline, hof, roundLog, champion, ...extra,
        }, null, 2));
    }

    // apply-champion.txt: local-apply lines (PINNED so the online community
    // champion can't overwrite yours — the Supabase fetch in bot.js honors
    // godaigo_bot_weights_pin) plus, once there's a confirm record, an optional
    // "share online" snippet to submit it to the community champion table.
    function writeApplyFile(conf) {
        const w = JSON.stringify(champion);
        let txt =
            `// ==== Godaigo bot champion ====\n` +
            `// (1) SEE IT LOCALLY — paste both lines into the game console (F12), then reload:\n` +
            `localStorage.setItem('godaigo_bot_weights', ${JSON.stringify(w)});\n` +
            `localStorage.setItem('godaigo_bot_weights_pin', '1'); // pin: keeps the online champion from overwriting yours\n` +
            `// (revert to the community champion later: localStorage.removeItem('godaigo_bot_weights_pin'); then reload)\n`;
        if (conf) {
            txt +=
                `\n// (2) REPLACE THE ONLINE CHAMPION (share with everyone) — while LOGGED IN to the live game, paste this:\n` +
                `(async () => {\n` +
                `  const { data: { session } } = await supabase.auth.getSession();\n` +
                `  if (!session) return console.warn('Log in first, then re-run this.');\n` +
                `  const { error } = await supabase.from('bot_champion_weights').insert({\n` +
                `    weights: ${w}, confirm_wins: ${conf.aWins}, confirm_losses: ${conf.bWins}, confirm_draws: ${conf.draws}, created_by: session.user.id });\n` +
                `  console.log(error ? 'Submit failed: ' + error.message : 'Submitted — it becomes THE bot once its win-rate ranks highest.');\n` +
                `})();\n`;
        }
        writeFileSync(applyPath, txt);
    }

    // Ctrl-C: state is already checkpointed every round, so just write the
    // apply file for the best champion so far and exit cleanly.
    let cancelled = false;
    function onCancel() {
        if (cancelled) return; cancelled = true;
        try { writeState('cancelled'); writeApplyFile(null); } catch (e) {}
        console.log(`\n[runner] cancelled — progress saved to ${statePath}.`);
        console.log(`[runner] apply the champion so far: open ${applyPath}. Resume anytime with the same command.`);
        process.exit(0);
    }
    process.on('SIGINT', onCancel);

    for (let i = 0; i < OPTS.hcRounds && !cancelled; i++) {
        const gRound = roundLog.length; // cumulative index — round numbers continue across chunks
        const challengers = Array.from({ length: lambda }, () => mutate(champion, rng, sigma));
        // Each challenger plays the current champion (N games — the promotion
        // gate) plus, once a hall of fame exists, a smaller budget split across
        // the retired champions (the rock-paper-scissors generalization guard).
        const hofPer = hof.length ? Math.max(2, Math.round(OPTS.hcHofGames / hof.length)) : 0;
        const tasks = [];
        challengers.forEach((w, idx) => {
            // COMMON RANDOM NUMBERS: no per-challenger term in the seed — all
            // challengers this round face the champion (and each HoF member)
            // on the SAME decks, so ranking differences come from weights,
            // not deck luck. (BotArena._playSeries additionally mirror-pairs
            // consecutive games onto one seed with sides swapped.)
            tasks.push({ label: `round ${gRound + 1} ch ${idx + 1} vs champion`,
                a: w, b: champion, games: N, seed: (OPTS.seed * 1000003 + gRound * 1009) >>> 0, ci: idx, kind: 'champ' });
            hof.forEach((hw, hi) => tasks.push({ label: `round ${gRound + 1} ch ${idx + 1} vs HoF#${hi + 1}`,
                a: w, b: hw, games: hofPer, seed: (OPTS.seed * 7919 + gRound * 101 + hi) >>> 0, ci: idx, kind: 'hof' }));
        });
        const results = await runSeriesPool(browser, url, tasks);
        const agg = challengers.map(() => ({ cA: 0, cB: 0, cFit: 0, hA: 0, hB: 0 }));
        results.forEach((r, k) => {
            const t = tasks[k];
            gamesPlayed += r.aWins + r.bWins + r.draws;
            if (t.kind === 'champ') { agg[t.ci].cA = r.aWins; agg[t.ci].cB = r.bWins; agg[t.ci].cFit = r.aFitness - r.bFitness; }
            else { agg[t.ci].hA += r.aWins; agg[t.ci].hB += r.bWins; }
        });
        let best = null, bestChampOnly = null, blockedByField = 0;
        agg.forEach((p, idx) => {
            const cd = p.cA + p.cB, cwr = cd ? p.cA / cd : 0;
            const hd = p.hA + p.hB, hwr = hd ? p.hA / hd : 1; // empty HoF ⇒ auto-pass
            const net = p.cA - p.cB;
            if (!bestChampOnly || net > bestChampOnly.net) bestChampOnly = { cA: p.cA, cB: p.cB, net };
            const beatsChamp = cd >= minDecided && cwr >= OPTS.hcPromote;
            const holdsField = hof.length === 0 || (hd > 0 && hwr >= OPTS.hcHofFloor);
            if (beatsChamp && !holdsField) blockedByField++;
            if (beatsChamp && holdsField && (!best || net > best.net || (net === best.net && hwr > best.hwr))) {
                best = { w: challengers[idx], cA: p.cA, cB: p.cB, cwr, hA: p.hA, hB: p.hB, hwr, net };
            }
        });
        let promoted = false;
        if (best) {
            const old = champion;
            champion = best.w; promotions++; promoted = true; sigma = OPTS.hcSigma; // found a step up — reset the radius
            if (OPTS.hcHof > 0) { hof.push(old); while (hof.length > OPTS.hcHof) hof.shift(); }
            const fieldNote = (best.hA + best.hB) > 0 ? `, ${Math.round(best.hwr * 100)}% vs field` : '';
            console.log(`[runner] round ${gRound + 1}: PROMOTED (${best.cA}-${best.cB} vs champion${fieldNote}) — new champion #${promotions} (HoF ${hof.length})`);
        } else {
            const prev = sigma; sigma = Math.min(0.8, sigma * 1.5); // barren — widen the search
            const note = blockedByField ? ` — ${blockedByField} beat the champion but lost to the field (gauntlet held)` : '';
            console.log(`[runner] round ${gRound + 1}: held (best vs champion ${bestChampOnly.cA}-${bestChampOnly.cB})${note} — sigma ${prev.toFixed(2)}→${sigma.toFixed(2)}`);
        }
        roundLog.push({ round: gRound + 1, promoted, promotions, hof: hof.length, blockedByField,
            bestVsChampion: `${bestChampOnly.cA}-${bestChampOnly.cB}`, sigma: +sigma.toFixed(3) });
        writeState('in-progress'); // every round is checkpointed — a timeout/crash/Ctrl-C never loses it
    }
    if (cancelled) return;
    const minutes = ((Date.now() - t0) / 60000).toFixed(1);

    // Cumulative confirm: current champion vs the session's ORIGINAL baseline,
    // with the same real-margin gate the one-off run uses (a 5-5 tie does not
    // count as IMPROVED).
    let conf = null, improved = false, winRate = 0, decided = 0;
    if (promotions === 0) {
        console.log('[runner] hillclimb: no promotion yet — champion unchanged from the session baseline.');
    } else {
        console.log(`[runner] hillclimb: confirmation vs the session's starting champion (${OPTS.hcConfirm} games)…`);
        [conf] = await runSeriesPool(browser, url, [{
            label: 'confirm vs session baseline', a: champion, b: baseline, games: OPTS.hcConfirm, seed: OPTS.seed + 900_001 + roundLog.length,
        }]);
        decided = conf.aWins + conf.bWins;
        winRate = decided ? conf.aWins / decided : 0;
        improved = decided >= Math.ceil(OPTS.hcConfirm / 2) && winRate >= OPTS.hcConfirmMargin;
    }
    process.removeListener('SIGINT', onCancel);
    writeState('idle', { finalConfirm: conf, finalWinRate: +winRate.toFixed(3), improved });
    if (promotions > 0) writeApplyFile(conf); // always give an apply file once a champion exists

    const marginPct = Math.round(OPTS.hcConfirmMargin * 100);
    console.log('[runner] --- hillclimb chunk done ---');
    console.log(`[runner] session total: ${roundLog.length} rounds, ${promotions} promotion(s). This chunk: ${gamesPlayed} games, ${minutes} min.`);
    if (promotions === 0) {
        console.log('[runner] nothing to apply yet — resume with the SAME command to keep climbing.');
    } else if (improved) {
        console.log(`[runner] IMPROVED over the session baseline: ${conf.aWins}-${conf.bWins} ` +
            `(${Math.round(winRate * 100)}% of ${decided} ≥ ${marginPct}%). Apply/share: open ${applyPath}`);
    } else {
        console.log(`[runner] champion advanced but only ${conf.aWins}-${conf.bWins} ` +
            `(${Math.round(winRate * 100)}%, want ≥ ${marginPct}%) vs the session baseline — keep going.`);
        console.log(`[runner] (an apply file is still written at ${applyPath}, but the edge over baseline isn't confirmed yet.)`);
    }
    if (sessionName) {
        console.log(`[runner] RESUME: node tools/arena-headless.mjs --hillclimb --hc-session ${sessionName} --hc-rounds ${OPTS.hcRounds} --shards ${OPTS.shards} --hc-games ${N}`);
    }
}

// ---------------------------------------------------------------- main
async function main() {
    const { chromium } = await loadPlaywright();
    const server = await startServer();
    const port = server.address().port;
    const url = `http://127.0.0.1:${port}/index.html`;
    console.log(`[runner] serving ${ROOT} at ${url}`);

    const browser = await chromium.launch({ headless: !OPTS.headed });
    const watchdog = setTimeout(() => {
        console.error(`[runner] watchdog: exceeded ${OPTS.timeoutMs / 60000} min — aborting.`);
        browser.close().finally(() => process.exit(1));
    }, OPTS.timeoutMs);

    try {
        if (OPTS.hillclimb) await runHillClimb(browser, url);
        else if (OPTS.confirm) await runConfirm(browser, url);
        else if (OPTS.evolve) await runEvolve(browser, url);
        else await runSmoke(browser, url);
    } finally {
        clearTimeout(watchdog);
        await browser.close();
        server.close();
    }
}

main().catch(e => { console.error(e); process.exit(1); });
