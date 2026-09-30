// plinko-sim.js: the pot drop, one deterministic physics simulation shared by
// the browser (js/pot-plinko.js draws it) and the server (Supabase Edge Function
// supabase/functions/pot-drop, which decides the pot). Same code, same seed,
// same Matter.js version (0.19.0, js/vendor/matter.min.js) = same result.
//
// Rule: each 10g in the pot is a coin (at most 70). The coins fall through a
// board of fixed pegs, with a scattered layer of random pegs on top that the
// seed places. Under the pegs stands the treasure tube: two walls, just wider
// than a coin. A coin has to come in at the right angle to drop in; a coin that
// hits the rim bounces away. A coin that reaches the bottom of the tube is a
// hit (it falls onto the chest); one hit and the pot pays out. (VERSION 1 used
// a thin gap in the floor instead, which was hard to see.)
//
// Kept deterministic across JavaScript engines on purpose:
//   * no Math.random: all randomness comes from mulberry32(seed);
//   * coins never spin (inertia Infinity), so Matter never calls sin/cos while
//     stepping; round shapes are built from the fixed table UNIT_12 below, not
//     Bodies.circle (which uses cos/sin);
//   * fixed time step and fixed iteration counts.
// The server's recorded landing slots are the truth; the browser replays the
// same simulation and pot-plinko.js only nudges a coin if a slot ever differs.
//
// The tube was tuned with tools/plinko-tune.mjs so one coin gets in about 1
// time in 100 (see TUNING below). Coins bump into each other, which keeps each
// coin close to its own separate try. Measured (VERSION 2, 500 drops each):
// 0.96% per coin, no stuck coins; a drop of 10 coins wins 7%, 30 coins 26%,
// 50 coins 44%, 70 coins 54%.
// Changing the board changes the odds: bump VERSION and re-run the tuning.
(function (root) {
    'use strict';

    const VERSION = 2;

    // Board, in world units (the canvas scales it).
    const W = 360, H = 560;
    const PEG_R = 4, RAND_PEG_R = 5, COIN_R = 6;
    const ROWS = 9, ROW_Y0 = 170, ROW_DY = 36, COL_DX = 36;
    const FLOOR_Y = ROW_Y0 + (ROWS - 1) * ROW_DY + 60;   // 518
    const SLOT_W = 30;                                   // 12 normal slots
    // TUNING (tools/plinko-tune.mjs, VERSION 2): the treasure tube. x = left
    // inner edge, w = inside width (a coin is 12), h = wall height above the
    // floor, t = wall thickness. Its top sits just under a peg, so a coin must
    // come in at an angle around that peg.
    const TUBE = { x: 83.5, w: 13, h: 47, t: 3 };   // under the last-row peg at x 90
    const RAND_PEGS = 7;
    const DROP_EVERY = 5;          // frames between coins
    const MAX_COINS = 70;
    const DT = 1000 / 60;

    // cos/sin of k * 30 degrees, written out so every engine uses the same numbers.
    const UNIT_12 = [
        [1, 0], [0.8660254037844387, 0.5], [0.5, 0.8660254037844386], [0, 1],
        [-0.5, 0.8660254037844387], [-0.8660254037844385, 0.5], [-1, 0],
        [-0.8660254037844387, -0.5], [-0.5, -0.8660254037844385], [0, -1],
        [0.5, -0.8660254037844387], [0.8660254037844387, -0.5],
    ];

    function mulberry32(seed) {
        let a = seed >>> 0;
        return function () {
            a = (a + 0x6D2B79F5) >>> 0;
            let t = a;
            t = Math.imul(t ^ (t >>> 15), t | 1);
            t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }

    function roundBody(M, x, y, r, options) {
        const verts = UNIT_12.map(([c, s]) => ({ x: x + c * r, y: y + s * r }));
        return M.Body.create(Object.assign({ position: { x, y }, vertices: verts }, options));
    }

    // Normal slot (0..11) for a floor crossing at x. The treasure (-1) is only
    // ever a coin that reached the floor inside the tube (see step()).
    function slotAt(x) {
        return Math.max(0, Math.min(Math.floor(W / SLOT_W) - 1, Math.floor(x / SLOT_W)));
    }

    function inTube(x, tube) {
        return x > tube.x && x < tube.x + tube.w;
    }

    // The board layout for a seed (also used by the browser to draw it).
    function layout(seed) {
        const rnd = mulberry32(seed);
        const pegs = [];
        for (let r = 0; r < ROWS; r++) {
            const off = (r % 2) ? COL_DX / 2 : 0;
            for (let x = COL_DX / 2 + off; x < W - 8; x += COL_DX) {
                pegs.push({ x, y: ROW_Y0 + r * ROW_DY, r: PEG_R, random: false });
            }
        }
        // Random pegs stay at least 28 apart, so no two of them form a cradle a coin can rest in.
        const placed = [];
        for (let tries = 0; placed.length < RAND_PEGS && tries < 200; tries++) {
            const x = 30 + Math.floor(rnd() * 300), y = 70 + Math.floor(rnd() * 70);
            if (placed.every(p => (p.x - x) * (p.x - x) + (p.y - y) * (p.y - y) >= 28 * 28)) placed.push({ x, y });
        }
        for (const p of placed) pegs.push({ x: p.x, y: p.y, r: RAND_PEG_R, random: true });
        return { pegs, rnd };
    }

    // Build a stepping simulation. opts: { seed, coins, Matter, tube? } (tube:
    // only tools/plinko-tune.mjs passes one, to try other sizes).
    function create(opts) {
        const M = opts.Matter;
        const tube = Object.assign({}, TUBE, opts.tube || {});
        const seed = (opts.seed >>> 0);
        const total = Math.max(0, Math.min(MAX_COINS, opts.coins | 0));
        const { pegs, rnd } = layout(seed);
        const engine = M.Engine.create({ positionIterations: 6, velocityIterations: 4, enableSleeping: false });
        engine.gravity.y = 1;
        const world = engine.world;
        const statics = pegs.map(p => roundBody(M, p.x, p.y, p.r, { isStatic: true, restitution: 0.5, friction: 0 }));
        statics.push(M.Bodies.rectangle(-10, H / 2, 20, H * 2, { isStatic: true }));
        statics.push(M.Bodies.rectangle(W + 10, H / 2, 20, H * 2, { isStatic: true }));
        // The tube walls (Bodies.rectangle uses no sin/cos). They reach a little
        // below the floor line so a coin inside cannot slip out at the bottom.
        const wallY = FLOOR_Y - tube.h / 2 + 10, wallH = tube.h + 20;
        statics.push(M.Bodies.rectangle(tube.x - tube.t / 2, wallY, tube.t, wallH, { isStatic: true, restitution: 0.5, friction: 0 }));
        statics.push(M.Bodies.rectangle(tube.x + tube.w + tube.t / 2, wallY, tube.t, wallH, { isStatic: true, restitution: 0.5, friction: 0 }));
        M.Composite.add(world, statics);

        // Drop positions, from the seed.
        const drops = [];
        for (let i = 0; i < total; i++) drops.push(W / 2 - 60 + Math.floor(rnd() * 120) + rnd());

        const coins = [];          // { body, i, lx, ly, stuck }
        const slots = new Array(total).fill(null);
        const landX = new Array(total).fill(null);
        let frame = 0, dropped = 0, landed = 0;
        const maxFrames = total * DROP_EVERY + 1800;

        function land(c, x) {
            slots[c.i] = (c.body.position.y >= FLOOR_Y && inTube(x, tube)) ? -1 : slotAt(x);
            landX[c.i] = x;
            landed++;
            M.Composite.remove(world, c.body);
            c.body = null;
        }

        function step() {
            if (landed >= total) return false;
            if (dropped < total && frame % DROP_EVERY === 0) {
                const body = roundBody(M, drops[dropped], 18, COIN_R, {
                    restitution: 0.5, friction: 0.02, frictionAir: 0.01, inertia: Infinity,
                });
                M.Composite.add(world, body);
                coins.push({ body, i: dropped });
                dropped++;
            }
            M.Engine.update(engine, DT);
            frame++;
            for (const c of coins) {
                if (!c.body) continue;
                const b = c.body;
                if (b.position.y >= FLOOR_Y) { land(c, b.position.x); continue; }
                // A coin balanced on a peg or wedged at the tube rim (moved less than
                // 1 unit in 30 frames) gets a push: up and sideways, the side switching
                // each time (starting side by coin index), a bit harder each time.
                if (frame % 30 === 0) {
                    if (c.lx !== undefined) {
                        const dx = b.position.x - c.lx, dy = b.position.y - c.ly;
                        if (dx * dx + dy * dy < 1) {
                            c.stuck = (c.stuck || 0) + 1;
                            const side = ((c.i + c.stuck) % 2) ? 1 : -1;
                            const k = Math.min(3, c.stuck);
                            M.Body.setVelocity(b, { x: side * (1.2 + 0.6 * k), y: -0.5 - 0.5 * k });
                        }
                    }
                    c.lx = b.position.x; c.ly = b.position.y;
                }
            }
            if (frame >= maxFrames) {
                for (const c of coins) if (c.body) land(c, c.body.position.x);
                while (dropped < total) { landX[dropped] = drops[dropped]; slots[dropped] = slotAt(drops[dropped]); dropped++; landed++; }
                return false;
            }
            return landed < total;
        }

        function result() {
            const hit = slots.indexOf(-1);
            return { version: VERSION, slots: slots.slice(), hit: hit >= 0 ? hit : null, frames: frame, landX: landX.slice() };
        }

        return { engine, pegs, coins, slots, step, result, tube, get frame() { return frame; }, total };
    }

    // Run to the end. Returns { version, slots, hit, frames, landX }.
    function simulate(opts) {
        const sim = create(opts);
        while (sim.step()) { /* keep going */ }
        return sim.result();
    }

    const api = {
        VERSION, W, H, FLOOR_Y, SLOT_W, TUBE, COIN_R, MAX_COINS, DROP_EVERY,
        layout, slotAt, inTube, create, simulate, mulberry32,
    };
    root.PlinkoSim = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
