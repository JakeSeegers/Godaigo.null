// plinko-tune.mjs: checks and tunes the pot plinko board (js/plinko-sim.js).
//   node tools/plinko-tune.mjs [drops] [coinsPerDrop]
// 1. Determinism: the same seed gives the same slots twice.
// 2. Per-coin treasure rate of the current TREASURE_X / TREASURE_W (target about 1%).
// 3. Landing x histogram, and the width at a few positions that would give 1%.
// 4. Win chance per drop (at least one coin in the treasure) for a few coin counts.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const Matter = require(path.join(here, '../js/vendor/matter.min.js'));
require(path.join(here, '../js/plinko-sim.js'));
const S = globalThis.PlinkoSim;

const drops = Number(process.argv[2] || 200);
const coins = Number(process.argv[3] || 50);

const a = S.simulate({ seed: 12345, coins, Matter });
const b = S.simulate({ seed: 12345, coins, Matter });
console.log('deterministic:', JSON.stringify(a.landX) === JSON.stringify(b.landX));

const xs = [];
let hits = 0, capped = 0;
const t0 = Date.now();
for (let d = 0; d < drops; d++) {
    const r = S.simulate({ seed: (d * 2654435761 + 1) >>> 0, coins, Matter });
    for (const x of r.landX) xs.push(x);
    hits += r.slots.filter(s => s === -1).length;
    if (r.frames >= coins * S.DROP_EVERY + 1800) capped++;
}
const total = xs.length;
console.log(`treasure ${S.TREASURE_X}..${S.TREASURE_X + S.TREASURE_W}: ${hits}/${total} = ${(100 * hits / total).toFixed(2)}% per coin`);
console.log(`${((Date.now() - t0) / drops).toFixed(0)} ms per drop of ${coins} coins, ${capped} drops hit the frame cap`);

const bin = 10, hist = new Array(Math.ceil(S.W / bin)).fill(0);
for (const x of xs) hist[Math.max(0, Math.min(hist.length - 1, Math.floor(x / bin)))]++;
console.log('landing % per 10 units:', hist.map(h => (100 * h / total).toFixed(1)).join(' '));

// For start positions, the narrowest width that reaches 1%.
const sorted = xs.slice().sort((p, q) => p - q);
const countIn = (lo, hi) => { let n = 0; for (const x of sorted) if (x >= lo && x < hi) n++; return n; };
for (const x0 of [30, 60, 84, 120, 240, 300]) {
    let w = 1;
    while (w < 60 && countIn(x0, x0 + w) / total < 0.01) w++;
    console.log(`x=${x0}: width ${w} -> ${(100 * countIn(x0, x0 + w) / total).toFixed(2)}%`);
}

for (const n of [10, 30, 50, 70]) {
    let w = 0;
    for (let d = 0; d < drops; d++) if (S.simulate({ seed: (d * 2246822519 + 7) >>> 0, coins: n, Matter }).hit !== null) w++;
    console.log(`${n} coins: win ${(100 * w / drops).toFixed(1)}% (separate 1% tries: ${(100 * (1 - Math.pow(0.99, n))).toFixed(1)}%)`);
}

import fs from 'node:fs';
const same = fs.readFileSync(path.join(here, '../js/plinko-sim.js'), 'utf8') ===
    fs.readFileSync(path.join(here, '../supabase/functions/pot-drop/plinko-sim.js'), 'utf8');
console.log('edge function copy of plinko-sim.js is the same:', same, same ? '' : '(copy js/plinko-sim.js over it and redeploy pot-drop)');
