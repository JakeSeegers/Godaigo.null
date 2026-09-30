// plinko-tune.mjs: checks and tunes the pot plinko board (js/plinko-sim.js).
//   node tools/plinko-tune.mjs [drops] [coinsPerDrop]      check the current board
//   node tools/plinko-tune.mjs sweep [drops] [coinsPerDrop] try other tube sizes
// Check: determinism (same seed, same result), per-coin treasure rate of the
// tube (target about 1%), drops that hit the frame cap (a stuck coin; want 0),
// win chance per drop for a few coin counts, and that the edge function's copy
// of plinko-sim.js is the same file.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const Matter = require(path.join(here, '../js/vendor/matter.min.js'));
require(path.join(here, '../js/plinko-sim.js'));
const S = globalThis.PlinkoSim;

const sweep = process.argv[2] === 'sweep';
const args = process.argv.slice(sweep ? 3 : 2);
const drops = Number(args[0] || 200);
const coins = Number(args[1] || 50);
const seedOf = (d) => (d * 2654435761 + 1) >>> 0;

function rate(tube) {
    let hits = 0, capped = 0;
    for (let d = 0; d < drops; d++) {
        const r = S.simulate({ seed: seedOf(d), coins, Matter, tube });
        hits += r.slots.filter(s => s === -1).length;
        if (r.frames >= coins * S.DROP_EVERY + 1800) capped++;
    }
    return { pct: 100 * hits / (drops * coins), capped };
}

if (sweep) {
    for (const x of (process.env.XS || "83,119").split(",").map(Number)) for (const w of (process.env.WS || "14").split(",").map(Number)) for (const h of (process.env.HS || "30,44").split(",").map(Number)) {
        const r = rate({ x, w, h });
        console.log(`x ${x} w ${w} h ${h}: ${r.pct.toFixed(2)}% per coin, ${r.capped} capped`);
    }
    process.exit(0);
}

const a = S.simulate({ seed: 12345, coins, Matter });
const b = S.simulate({ seed: 12345, coins, Matter });
console.log('deterministic:', JSON.stringify(a.landX) === JSON.stringify(b.landX) && JSON.stringify(a.slots) === JSON.stringify(b.slots));
const t0 = Date.now();
const r = rate();
console.log(`tube x ${S.TUBE.x} w ${S.TUBE.w} h ${S.TUBE.h}: ${r.pct.toFixed(2)}% per coin, ${r.capped} drops hit the frame cap, ${((Date.now() - t0) / drops).toFixed(0)} ms per drop of ${coins}`);
for (const n of [10, 30, 50, 70]) {
    let w = 0;
    for (let d = 0; d < drops; d++) if (S.simulate({ seed: (d * 2246822519 + 7) >>> 0, coins: n, Matter }).hit !== null) w++;
    console.log(`${n} coins: win ${(100 * w / drops).toFixed(1)}% (separate 1% tries: ${(100 * (1 - Math.pow(0.99, n))).toFixed(1)}%)`);
}
const same = fs.readFileSync(path.join(here, '../js/plinko-sim.js'), 'utf8') ===
    fs.readFileSync(path.join(here, '../supabase/functions/pot-drop/plinko-sim.js'), 'utf8');
console.log('edge function copy of plinko-sim.js is the same:', same, same ? '' : '(copy js/plinko-sim.js over it and redeploy pot-drop)');
