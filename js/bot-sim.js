// ============================================================
// bot-sim.js — Stage 2 of docs/bot-roadmap.md: forward model
// ============================================================
// PURE simulation over the Stage-0 snapshot JSON: no DOM, no game
// globals, no hidden information. Everything a search needs to ask
// "what would the state look like after this action?" without
// touching the live game.
//
//   BotSim.simulate(snap, action) → snap'   (input never mutated)
//   BotSim.legalActions(snap)     → Action[] (pure mirror of BotState.legalActions)
//   BotSim.isTerminal(snap) / BotSim.winner(snap)
//   BotSim.evaluateFor(snap, i)   → heuristic value of snap for player i
//   BotSim.validate(opts)         → live-game harness (async, IMPURE by design):
//                                   mirrors random real actions and diffs
//                                   predicted vs real snapshots
//
// WHAT IS MODELLED EXACTLY (validated by BotSim.validate):
//   move        pawn xy, AP − cost, tile reveal (as shrineType:'unknown' —
//               never invents the hidden element), scroll draw on reveal
//   endTurn     shrine collection (rank-based, source/pool capped), turn
//               advance in COLOR_RANK order, AP reset to 5 + void stones
//   placeStone  pool decrement + the fire-destruction interaction rules
//   discard     hand/active removal
//   moveStone   Breath of Power only — relocate a board stone to a
//               different empty in-range hex; same fire-destruction check
//               placeStone gets (simMoveStone)
//
// WHAT IS ONLY PARTIALLY MODELLED:
//   cast        AP cost, hand→active, win-condition activation (incl. the
//               empty-source-pool rule and catacomb component elements) are
//               exact. The scroll EFFECT is simulated only for scrolls in
//               SIMULATED_SCROLLS: Create, Transmute, Arson, Refreshing
//               Thought, Mason's Savvy, Heavy Stomp, Combust (immediate
//               pool/pattern effects); Shifting Sands, Scholar's Insight,
//               Inspiring Draught, Call to Adventure (flip only — its
//               reveal-triggered stone bonus is NOT modelled, see below),
//               Plunder, Take Flight, Quick Reflexes (Tranche 5 —
//               deterministic Tier-2 target choices, mirroring each
//               BotEffects driver's exact pick — Take Flight's driver was
//               made deterministic specifically so this could be added,
//               see bot-effects.js's _bestTakeFlightDestination; Quick
//               Reflexes needed snap.level1Available from bot-state.js
//               first, since which element gets picked depends on deck
//               availability this snapshot didn't use to expose); Control
//               the Current, Breath of Power (Tranche 6 — repeatable
//               whole-turn stone manipulation, see "turn buffs" below and
//               the 'moveStone' action); Freedom, Wandering River (Tranche
//               7 — cross-turn buffs, see "cross-turn buffs" below);
//               Sacrificial Pyre (Tranche 8 — recursively runs its
//               sacrificed scroll's own effect via the same simCastEffect()
//               dispatch simCast() itself uses, mirroring the real chained
//               execute() call; the sacrificed scroll's OWN element never
//               activates win-condition, only Sacrificial Pyre's does);
//               Excavate, Telekinesis (Tranche 9 — see "cross-turn buffs"
//               below for Excavate's deferred teleport; Telekinesis gets a
//               brand new large-hex tile-position grid, see
//               simEffectTelekinesis); plus 9 persistent TURN BUFFS — see
//               "turn buffs" below. Each
//               mirrors its real effect exactly (validated — see
//               BotSim.validate()). Anything else is recorded in
//               snap.sim.unsimulatedCasts so a search can score it with a
//               flat heuristic instead of pretending to know the outcome.
//   turn buffs  snap.turn.buffs.*: set by simCast() when a buff scroll is
//               cast, consumed at the point each buff actually matters
//               (legalActions' cast-cost/placement-range gates, canMoveTo,
//               simMove, simEndTurn), reset EVERY simEndTurn — verified
//               against the real clearTurnBuffs(), which wipes every
//               `expiresThisTurn` buff on ANY end turn, not just the
//               caster's own next one (true even for the couple of these
//               whose flavor text says "until your next turn"):
//                 burningMotivationStacks  Burning Motivation (FIRE_2) — +2 AP
//                   per stack per stone placed (simPlaceStone)
//                 globalPlacement          Avalanche (EARTH_5) — any stone
//                   type placeable anywhere this turn (legalActions)
//                 waterWindGlobalPlacement Seed the Skies (CATACOMB_6) —
//                   water/wind only placeable anywhere this turn (legalActions)
//                 respirateWind            Respirate (WIND_3): ALL wind
//                   returns to source at this end-of-turn (simEndTurn)
//                 simplify                 Simplify (VOID_3) — casts cost 1
//                   AP instead of 2 (castCost(), read by simCast + legalActions)
//                 mineShrineType           Mine (CATACOMB_2) — that shrine
//                   type's collection doubles this end-of-turn (simEndTurn)
//                 steamVentsBanked         Steam Vents (CATACOMB_5) — paid/free
//                   move steps alternate, starting free (simMove + legalActions)
//                 mudslide                 Mudslide (CATACOMB_1) — earth/water
//                   act as wind for movement (canMoveTo)
//                 reflectingPool           Reflecting Pool (CATACOMB_7) — marks
//                   the once-per-turn AP payout already taken (legalActions)
//                 controlTheCurrent       Control the Current (WATER_5) — an
//                   adjacent water stone transforms into the caster's best-
//                   need element, opportunistically after every action
//                   (attemptControlTheCurrentTransform, called from both
//                   simEffectControlTheCurrent and simulate() itself)
//                 breathOfPower           Breath of Power (WIND_2): enables
//                   the 'moveStone' action (legalActions + simMoveStone)
//               This is what lets searchPick() plan sequences like "cast
//               Burning Motivation, then place stones" or "cast Simplify,
//               then cast twice more this turn" for real — WEIGHTS.evalAp
//               already values the resulting AP, no new heuristic needed
//               once a buff's consequence exists in the snapshot.
//   cross-turn  snap.crossTurnBuffs.*: set by simCast(), but NEVER touched
//   buffs       by simEndTurn()'s blanket snap.turn.buffs = {} wipe — each
//               clears individually, by owner, only when THAT owner's own
//               next turn starts (mirrors clearFreedomForPlayer(next)/
//               clearWanderingRiverForPlayer(next), called right as that
//               player's turn begins, real code never wires these off
//               clearTurnBuffs() at all):
//                 freedom          Freedom (WIND_5) — teleport gate only,
//                   read by bot-state.js's hasFreedomActive() (real
//                   legalActions() 'teleport'); the action itself stays
//                   unmodelled in THIS file's legalActions() (see "cast" above)
//                 wanderingRiver   Wandering River (WATER_4) — array of
//                   {tileId, newElement, playerIndex}; overrides a tile's
//                   effective element for shrine collection (simEndTurn) —
//                   first matching entry wins, mirrors getEffectiveTileElement()
//                 excavate         Excavate (CATACOMB_4) — {playerIndex}; the
//                   ONLY cross-turn buff whose clearing DOES something
//                   (resolveExcavateTeleport, called from simEndTurn right
//                   as the owner's turn starts) rather than just expiring —
//                   mirrors processExcavateTeleport() always accepting the
//                   free teleport prompt. Excavate's OTHER two real buffs
//                   (immunity, no-response) have no consumer anywhere in
//                   this simulator — nothing here models opponent-targeting
//                   eligibility — so they aren't tracked at all, same
//                   accepted gap as Quick Reflexes' unmodelled "level-1
//                   scrolls free" buff
//
// KNOWN ACCEPTED DIVERGENCES (deliberate, all rare and all logged):
//   - scroll-effect side effects of non-whitelisted casts
//   - catacomb reveal's +1 AP (element of a hidden tile is unknowable)
//   - Call to Adventure's reveal-triggered stone bonus (the flip itself IS
//     simulated — see simEffectCallToAdventure) and Mason's Savvy's 5-hex
//     placement range — both need the element of a possibly-still-hidden
//     tile, which this simulator refuses to invent
//   - Scholar's Insight / Inspiring Draught: drawn scroll identity, and
//     whether the chosen deck/level was actually available at all — deck
//     contents/order/size aren't in the snapshot (same class as Refreshing
//     Thought's already-accepted "exhausted deck" gap)
//   - fire-destruction re-check cascades beyond the placed stone's neighbors
//   - Wandering River's OTHER consumption site (game-core.js's reveal-time
//     draw uses getEffectiveTileElement() too — a River-covered hidden
//     tile draws the OVERRIDE element's scroll, not its true one): only the
//     shrine-collection site (simEndTurn) is mirrored; simMove()'s reveal
//     still always masks shrineType as 'unknown', same as any other hidden
//     tile. Rare (needs a still-hidden tile targeted, then revealed before
//     the buff clears) and — unlike the shrine-collection site — would also
//     require guessing which drawn card was in the pile's other slots
//   - Telekinesis' "cannot strand an adjacent tile" rule: the real game
//     enforces this as a SEPARATE check at drag-START time (bot-effects.js's
//     driveTelekinesis comment: "Bridge tiles still highlight but error on
//     pickup"), not inside getEligibleTilesForShiftingSands() or
//     findNearestSnapPoint() — so a tile this simulator treats as eligible
//     could still be rejected by a real stranding check. No board-
//     connectivity graph analysis here; rare in practice (needs a bridge
//     tile whose removal would disconnect another tile from the rest of
//     the board) and simEffectTelekinesis just no-ops on that tile exactly
//     like every other "boxed in" case, rather than inventing a result
//   - Freedom's own TELEPORT action stays unmodelled in legalActions() — an
//     existing root-only gap even for the ordinary catacomb-tile kind
//     (teleport was never in this file's action vocabulary at all), so
//     whitelisting just the cast (Tranche 7) gives correct real-snapshot
//     awareness of an already-active Freedom without unlocking
//     search-planned teleports
//
// The only globals read are STATIC data (window.SCROLL_DEFINITIONS) and,
// inside validate() only, the live BotState/BotSystem.
//
// LOAD ORDER: after bot-state.js, before bot.js.
// ============================================================

(function () {
    'use strict';

    function log(...args) { console.log('🔮 [BotSim]', ...args); }

    const ELEMENTS = ['earth', 'water', 'fire', 'wind', 'void'];
    const TILE = 20;               // TILE_SIZE — small board hex size
    const HEX_NEAR = 5;            // px — "same hex"
    const HEX_STEP = 40;           // px — "adjacent hex" upper bound
    const STONE_NEIGHBOR_MAX = 50; // px — getNeighborStones() window (5..50)
    const POOL_CAP = 5;            // per-element player pool capacity
    const SOURCE_CAP = 25;         // per-element source pool capacity
    const CAST_COST = 2;           // SPELL_AP_COST — see castCost() for the Simplify discount
    const MAX_HAND = 2, MAX_ACTIVE = 2;
    const BASE_AP = 5;

    // Shrine collection amounts (replenishShrineStones in game-ui.js)
    const REPLENISH = { void: 1, wind: 2, fire: 3, water: 4, earth: 5 };

    // Turn order (end-turn handler in game-ui.js sorts players by this)
    const COLOR_RANK = {
        '#9458f4': 1, '#ffce00': 2, '#ed1b43': 3, '#5894f4': 4, '#69d83a': 5
    };

    // Placeholder for a scroll whose identity the simulator cannot know
    // (drawn from a face-down tile's deck during simulation)
    const UNKNOWN_SCROLL = '?unknown?';
    // A draw whose ELEMENT is known but identity is not (a face-down tile
    // under Wandering River reveals as the chosen element): '?unknown:water?'.
    // bot.js values these by scroll need for that element.
    const unknownScroll = el => el ? `?unknown:${el}?` : UNKNOWN_SCROLL;
    const isUnknownScroll = n => typeof n === 'string' && n.startsWith('?unknown');
    const unknownScrollElement = n => (isUnknownScroll(n) && n.length > 10) ? n.slice(9, -1) : null;

    // Scrolls whose EFFECT is simulated. Anything absent gets the universal
    // cast bookkeeping only + an entry in snap.sim.unsimulatedCasts. Add a
    // scroll here ONLY together with harness evidence that its simulation
    // matches the real effect.
    // Stage 2.5 step 4, tranche 1 (modal-only, pure pool/AP effects with
    // deterministic BotEffects drivers): Create, Transmute, Arson.
    // Tranche 2 (draws + board-geometry effects): Refreshing Thought,
    // Mason's Savvy, Heavy Stomp, Combust. Call to Adventure was evaluated
    // and deliberately EXCLUDED: its buff grants stones of the revealed
    // tile's element ON THE FLIP ITSELF (game-core revealTile ctaBuff
    // branch), and that element is hidden information — an honest
    // simulation cannot predict the pool change.
    const SIMULATED_SCROLLS = new Set([
        'VOID_SCROLL_5', 'FIRE_SCROLL_4', 'FIRE_SCROLL_5', 'FIRE_SCROLL_2',
        'WATER_SCROLL_2', 'EARTH_SCROLL_3', 'EARTH_SCROLL_4', 'CATACOMB_SCROLL_10',
        // Tranche 3/4 (turn buffs — see "Turn buffs" in the file header):
        // Avalanche, Seed the Skies, Respirate, Simplify, Mine, Steam Vents,
        // Mudslide, Reflecting Pool.
        'EARTH_SCROLL_5', 'CATACOMB_SCROLL_6', 'WIND_SCROLL_3', 'VOID_SCROLL_3',
        'CATACOMB_SCROLL_2', 'CATACOMB_SCROLL_5', 'CATACOMB_SCROLL_1', 'CATACOMB_SCROLL_7',
        // Tranche 5 (Tier-2 target-selection scrolls whose BotEffects driver
        // is fully deterministic — see the effect functions for each):
        // Shifting Sands, Scholar's Insight, Inspiring Draught, Call to
        // Adventure (flip only — see simEffectCallToAdventure), Plunder,
        // Take Flight (its driver's Math.random() pick was replaced with a
        // deterministic heuristic in bot-effects.js — see
        // _bestTakeFlightDestination — specifically so this could be added).
        'EARTH_SCROLL_2', 'VOID_SCROLL_4', 'WATER_SCROLL_3', 'CATACOMB_SCROLL_3', 'CATACOMB_SCROLL_8',
        'WIND_SCROLL_4', 'CATACOMB_SCROLL_9',
        // Tranche 6 (repeatable whole-turn stone-manipulation actions — new
        // action-vocabulary support, see simEffectControlTheCurrent/
        // simEffectBreathOfPower/simMoveStone): Control the Current,
        // Breath of Power.
        'WATER_SCROLL_5', 'WIND_SCROLL_2',
        // Tranche 7 (cross-turn buffs — new crossTurnBuffs state that
        // survives simEndTurn crossing OTHER players' turns, see
        // simEffectFreedom/simEffectWanderingRiver): Freedom, Wandering River.
        'WIND_SCROLL_5', 'WATER_SCROLL_4',
        // Tranche 8 (recursive effect dispatch — simCastEffect() factored
        // out of simCast() so the sacrificed scroll's own effect can be
        // simulated): Sacrificial Pyre.
        'FIRE_SCROLL_3',
        // Tranche 9 (the last two DELIBERATELY NOT WHITELISTED entries):
        // Excavate — a deferred-to-next-turn effect, using the same
        // crossTurnBuffs infrastructure Tranche 7 built, but one that DOES
        // something on clear (resolveExcavateTeleport), not just expires;
        // Telekinesis — free-form single-tile relocation on a NEW
        // large-hex tile-position grid this file didn't have before
        // (countTouchingTilesSim/LARGE_HEX), not just a Shifting-Sands-style
        // swap.
        'CATACOMB_SCROLL_4', 'VOID_SCROLL_2',
    ]);

    // Small-hex offsets making up one large tile (getAllHexagonPositions):
    // hidden non-player tiles expose only the outer ring; revealed/player
    // tiles expose all 13. Trapezoid offsets become walkable "bridge" hexes
    // only where the trapezoids of TWO OR MORE tiles coincide (hidden tiles
    // contribute too) — landing on one reveals the hidden neighbours.
    const RING_OFFSETS = [[2, -1], [1, 1], [-1, 2], [-2, 1], [-1, -1], [1, -2]];
    const ALL_OFFSETS = [
        [0, 0],
        [1, 0], [0, 1], [-1, 1], [-1, 0], [0, -1], [1, -1],
        ...RING_OFFSETS
    ];
    const TRAPEZOID_OFFSETS = [[2, 0], [0, 2], [-2, 2], [-2, 0], [0, -2], [2, -2]];

    // ----------------------------------------------------------------
    // Pure helpers
    // ----------------------------------------------------------------
    // Flat-top axial → pixel (matches game-core hexToPixel; linear in q,r so
    // relative offsets can be added straight to a pixel position)
    function hexToPixel(q, r, s) {
        return { x: s * Math.sqrt(3) * (q + r / 2), y: s * 1.5 * r };
    }
    // Inverse of hexToPixel — pure mirror of game-core.js's pixelToHex/hexRound,
    // needed for Reflecting Pool's "within 5 hexes" check (a true hex-grid
    // distance, not the euclidean px distance most of this file uses).
    function hexRound(q, r) {
        const s = -q - r;
        let rq = Math.round(q), rr = Math.round(r), rs = Math.round(s);
        const qDiff = Math.abs(rq - q), rDiff = Math.abs(rr - r), sDiff = Math.abs(rs - s);
        if (qDiff > rDiff && qDiff > sDiff) rq = -rr - rs;
        else if (rDiff > sDiff) rr = -rq - rs;
        return { q: rq, r: rr };
    }
    function pixelToHex(x, y, s) {
        return hexRound((x * Math.sqrt(3) / 3 - y / 3) / s, (y * 2 / 3) / s);
    }
    function hexDistance(ax, ay, bx, by, s) {
        const A = pixelToHex(ax, ay, s), B = pixelToHex(bx, by, s);
        return Math.max(Math.abs(A.q - B.q), Math.abs(A.r - B.r), Math.abs((-A.q - A.r) - (-B.q - B.r)));
    }
    const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
    // Deep copy with exactly the result of JSON.parse(JSON.stringify(v)) (the
    // old clone), but without building the text in between: it ran for every
    // simulated step and was the largest single cost of bot training
    // (2026-10-10). Same rules as JSON: non-finite numbers become null, -0
    // becomes 0, undefined / functions are dropped from objects and become
    // null in arrays, toJSON() is used (Dates), Sets / Maps become {}.
    function jsonCopy(v) {
        switch (typeof v) {
            case 'number': return Number.isFinite(v) ? (v === 0 ? 0 : v) : null;
            case 'string': case 'boolean': return v;
            case 'object': break;
            default: return undefined;                     // undefined, function, symbol
        }
        if (v === null) return null;
        if (typeof v.toJSON === 'function') return jsonCopy(v.toJSON());
        if (Array.isArray(v)) {
            const out = new Array(v.length);
            for (let i = 0; i < v.length; i++) { const c = jsonCopy(v[i]); out[i] = c === undefined ? null : c; }
            return out;
        }
        const out = {};
        for (const k of Object.keys(v)) {
            const c = jsonCopy(v[k]);
            if (c === undefined) continue;
            if (k === '__proto__') Object.defineProperty(out, k, { value: c, enumerable: true, writable: true, configurable: true });
            else out[k] = c;
        }
        return out;
    }
    const clone = snap => jsonCopy(snap);

    function simNotes(snap) {
        if (!snap.sim) snap.sim = { unsimulatedCasts: [], notes: [], turnsEnded: 0 };
        if (snap.sim.turnsEnded == null) snap.sim.turnsEnded = 0;
        return snap.sim;
    }

    function activePlayer(snap) { return snap.players[snap.turn.activePlayerIndex]; }

    // Simplify (VOID_SCROLL_3): 1 AP per cast instead of 2, for whoever holds
    // the buff — always the current active player, since turn.buffs is wiped
    // every simEndTurn and can only be set by simCast() during that player's
    // own turn (see the "Turn buffs" note in the file header).
    function castCost(snap) {
        return snap.turn.buffs?.simplify ? 1 : CAST_COST;
    }

    // Stones by area (cells of STONE_NEIGHBOR_MAX px, so every stone within
    // that distance is in the 3x3 cells around a point). stoneAt() and
    // neighborStones() used to scan every stone on every call; search asks
    // them thousands of times per decision, so late in a game (50+ stones)
    // a bot turn took seconds and games got slower as they went on.
    // Cached per stones array; rebuilt when its length changes, and
    // touchStones() must be called after changing a stone in place (type or
    // position). Results keep array order, exactly like find() / filter().
    const _stoneIdx = new WeakMap();
    function touchStones(snap) { _stoneIdx.delete(snap.stones); }
    const cellKey = (cx, cy) => (cx + 5000) * 10000 + (cy + 5000);
    function stoneCells(snap) {
        const arr = snap.stones;
        let idx = _stoneIdx.get(arr);
        if (idx && idx.n === arr.length) return idx.cells;
        const cells = new Map();
        arr.forEach((st, i) => {
            const k = cellKey(Math.floor(st.x / STONE_NEIGHBOR_MAX), Math.floor(st.y / STONE_NEIGHBOR_MAX));
            let list = cells.get(k);
            if (!list) cells.set(k, list = []);
            list.push(i);
        });
        _stoneIdx.set(arr, { n: arr.length, cells });
        return cells;
    }
    // stoneAt / neighborStones walk the 3x3 cells directly (no list to build
    // and sort on every call: they run thousands of times per decision).
    // Same results as before: the first match in array order (lowest index),
    // and neighbours in array order.
    function stoneAt(snap, x, y) {
        const cells = stoneCells(snap), arr = snap.stones;
        const cx = Math.floor(x / STONE_NEIGHBOR_MAX), cy = Math.floor(y / STONE_NEIGHBOR_MAX);
        let best = -1;
        for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
            const list = cells.get(cellKey(cx + dx, cy + dy));
            if (!list) continue;
            for (const i of list) {
                if (best !== -1 && i >= best) break;     // lists are in index order
                const s = arr[i];
                if (dist(s.x, s.y, x, y) < HEX_NEAR) { best = i; break; }
            }
        }
        return best === -1 ? null : arr[best];
    }
    function neighborStones(snap, x, y) {
        const cells = stoneCells(snap), arr = snap.stones;
        const cx = Math.floor(x / STONE_NEIGHBOR_MAX), cy = Math.floor(y / STONE_NEIGHBOR_MAX);
        const hit = [];
        for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
            const list = cells.get(cellKey(cx + dx, cy + dy));
            if (!list) continue;
            for (const i of list) {
                const s = arr[i];
                const d = dist(s.x, s.y, x, y);
                if (d > HEX_NEAR && d < STONE_NEIGHBOR_MAX) hit.push(i);
            }
        }
        if (hit.length > 1) hit.sort((a, b) => a - b);
        return hit.map(i => arr[i]);
    }
    function hasAdjacentVoid(snap, x, y) {
        return neighborStones(snap, x, y).some(s => s.type === 'void');
    }

    // ----------------------------------------------------------------
    // Walkable hex grid derived purely from the snapshot (memoized per
    // snapshot object). Entries: {x, y, key, tileIds:[…]}.
    // ----------------------------------------------------------------
    const _gridCache = new WeakMap();
    // Second level, by tile layout: simulate() clones the snapshot on every
    // step, so the per-object cache alone missed on nearly every search
    // node and rebuilt the same grid again and again (a big part of a bot's
    // think time). Entries are never mutated by callers, so sharing is safe.
    const _gridByLayout = new Map();
    // Neighbour lists per grid (grids are shared and never changed, see above).
    const _nbrCache = new WeakMap();
    function gridNeighbors(g) {
        let m = _nbrCache.get(g);
        if (m) return m;
        m = new Map();
        for (const h of g) m.set(h, g.filter(n => { const d = dist(n.x, n.y, h.x, h.y); return d > HEX_NEAR && d < HEX_STEP; }));
        _nbrCache.set(g, m);
        return m;
    }
    function grid(snap) {
        let g = _gridCache.get(snap);
        if (g) return g;
        let sig = '';
        for (const t of snap.tiles)
            sig += t.id + '@' + Math.round(t.x) + ',' + Math.round(t.y) + (t.revealed ? 'r' : 'h') + (t.isPlayerTile ? 'p' : '') + '|';
        g = _gridByLayout.get(sig);
        if (g) { _gridCache.set(snap, g); return g; }
        const byKey = new Map();
        const addHex = (t, q, r, map) => {
            const p = hexToPixel(q, r, TILE);
            const x = t.x + p.x, y = t.y + p.y;
            const key = `${Math.round(x)},${Math.round(y)}`;
            let entry = map.get(key);
            if (!entry) { entry = { x, y, key, tileIds: [] }; map.set(key, entry); }
            if (!entry.tileIds.includes(t.id)) entry.tileIds.push(t.id);
            return entry;
        };
        for (const t of snap.tiles) {
            const offsets = (!t.revealed && !t.isPlayerTile) ? RING_OFFSETS : ALL_OFFSETS;
            for (const [q, r] of offsets) addHex(t, q, r, byKey);
        }
        // Trapezoid bridges: walkable only where ≥2 tiles' trapezoids coincide
        const traps = new Map();
        for (const t of snap.tiles) {
            for (const [q, r] of TRAPEZOID_OFFSETS) addHex(t, q, r, traps);
        }
        for (const [key, entry] of traps) {
            if (entry.tileIds.length >= 2 && !byKey.has(key)) byKey.set(key, entry);
        }
        g = [...byKey.values()];
        _gridCache.set(snap, g);
        if (_gridByLayout.size > 64) _gridByLayout.clear();
        _gridByLayout.set(sig, g);
        return g;
    }

    // ----------------------------------------------------------------
    // Movement cost model — pure mirror of canPlayerMoveToHex()
    // ----------------------------------------------------------------
    // Water chaining (getChainedAbility): flood fill through connected,
    // non-voided water; adjacent non-voided wind ⇒ free, earth ⇒ blocked.
    function chainedAbility(snap, x, y) {
        const stone = stoneAt(snap, x, y);
        if (!stone || stone.type !== 'water') return null;
        if (hasAdjacentVoid(snap, x, y)) return null;

        const visited = new Set([`${stone.x.toFixed(1)},${stone.y.toFixed(1)}`]);
        const queue = [stone];
        let hasWind = false, hasEarth = false;
        while (queue.length) {
            const cur = queue.shift();
            for (const nb of neighborStones(snap, cur.x, cur.y)) {
                if (nb.type === 'wind' && !hasAdjacentVoid(snap, nb.x, nb.y)) hasWind = true;
                else if (nb.type === 'earth' && !hasAdjacentVoid(snap, nb.x, nb.y)) hasEarth = true;
                else if (nb.type === 'water') {
                    const key = `${nb.x.toFixed(1)},${nb.y.toFixed(1)}`;
                    if (!visited.has(key) && !hasAdjacentVoid(snap, nb.x, nb.y)) {
                        visited.add(key);
                        queue.push(nb);
                    }
                }
            }
        }
        if (hasWind) return 'wind'; // wind outranks earth
        if (hasEarth) return 'earth';
        return null;
    }

    // What would a water stone placed at (x, y) become? 'wind' (free to walk
    // on) if it touches a wind stone (not voided) or water already chained to
    // wind; else 'earth' (a wall) if it touches earth (not voided) or water
    // chained to earth; else null (plain water, cost 2). An adjacent void
    // cancels it all. Wind outranks earth, as in game-core.js. Water is much
    // cheaper than wind or earth, so chains are cheap roads and cheap walls.
    function waterChainResult(snap, x, y) {
        if (hasAdjacentVoid(snap, x, y)) return null;
        let earth = false;
        for (const nb of neighborStones(snap, x, y)) {
            if (hasAdjacentVoid(snap, nb.x, nb.y)) continue;
            if (nb.type === 'wind') return 'wind';
            if (nb.type === 'earth') earth = true;
            else if (nb.type === 'water') {
                const c = chainedAbility(snap, nb.x, nb.y);
                if (c === 'wind') return 'wind';
                if (c === 'earth') earth = true;
            }
        }
        return earth ? 'earth' : null;
    }
    function waterChainsToWind(snap, x, y) { return waterChainResult(snap, x, y) === 'wind'; }

    // Stones on the board that walk for free right now: wind with no
    // adjacent void, and water chained to wind.
    function isFreeStone(snap, s) {
        if (s.type === 'wind') return !hasAdjacentVoid(snap, s.x, s.y);
        if (s.type === 'water') return chainedAbility(snap, s.x, s.y) === 'wind';
        return false;
    }

    function canMoveTo(snap, x, y) {
        const ai = snap.turn.activePlayerIndex;
        const occupied = snap.players.some((p, i) =>
            p && i !== ai && dist(p.x, p.y, x, y) < HEX_NEAR);
        if (occupied) return { canMove: false, cost: Infinity };

        // Mirror of canPlayerMoveToHex()'s isOpponentTileCenter() block —
        // another player's tile centre is off-limits (your own stays
        // reachable, needed for the win condition).
        const onOpponentTileCenter = snap.tiles.some(t =>
            t.isPlayerTile && t.playerIndex !== null && t.playerIndex !== ai &&
            dist(t.x, t.y, x, y) < HEX_NEAR);
        if (onOpponentTileCenter) return { canMove: false, cost: Infinity };

        const stone = stoneAt(snap, x, y);
        if (!stone) return { canMove: true, cost: 1 };

        // Mudslide (CATACOMB_SCROLL_1): earth/water act as wind for the
        // caster this turn — checked FIRST and returns early, exactly like
        // game-core.js's getSteamVentsBuff-adjacent Mudslide check, which
        // returns before ever reaching the water-chaining logic below.
        if (snap.turn.buffs?.mudslide && (stone.type === 'earth' || stone.type === 'water')) {
            return hasAdjacentVoid(snap, x, y)
                ? { canMove: true, cost: 1 }
                : { canMove: true, cost: 0 };
        }

        if (stone.type === 'water') {
            const chained = chainedAbility(snap, x, y);
            if (chained === 'wind') return { canMove: true, cost: 0 };
            if (chained === 'earth') return { canMove: false, cost: Infinity };
            return { canMove: true, cost: 2 };
        }
        if (stone.type === 'earth') {
            return hasAdjacentVoid(snap, x, y)
                ? { canMove: true, cost: 1 }
                : { canMove: false, cost: Infinity };
        }
        if (stone.type === 'wind') {
            return hasAdjacentVoid(snap, x, y)
                ? { canMove: true, cost: 1 }
                : { canMove: true, cost: 0 };
        }
        return { canMove: true, cost: 1 }; // fire, void — baseline
    }

    // ----------------------------------------------------------------
    // Pattern check — pure mirror of spellSystem.checkPatternForPlayer()
    // ----------------------------------------------------------------
    function checkPattern(snap, scrollName, playerIndex = snap.turn.activePlayerIndex) {
        const def = window.SCROLL_DEFINITIONS?.[scrollName];
        const p = snap.players[playerIndex];
        if (!def || !Array.isArray(def.patterns) || !p) return false;
        return def.patterns.some(variant => variant.every(req => {
            const off = hexToPixel(req.q, req.r, TILE);
            const s = stoneAt(snap, p.x + off.x, p.y + off.y);
            return s && s.type === req.type;
        }));
    }

    // ----------------------------------------------------------------
    // Fire interaction rules (processStoneInteractions), applied to a
    // freshly placed stone. Net effect of the real code:
    //  - a placed non-fire/non-void stone adjacent to any fire that has no
    //    adjacent void is destroyed (covers the water-mimicry special case:
    //    every branch of it destroys the water too)
    //  - a placed fire with no adjacent void destroys all adjacent
    //    non-fire/non-void stones
    // Destroyed stones return to the SOURCE pool (returnStoneToPool).
    // Not modelled: re-check cascades beyond the placement neighborhood.
    // ----------------------------------------------------------------
    function destroyStone(snap, stone) {
        snap.stones = snap.stones.filter(s => s !== stone);
        if ((snap.sourcePool[stone.type] || 0) < SOURCE_CAP) {
            snap.sourcePool[stone.type]++;
        }
    }

    // Would a stone placed here survive the fire-interaction rules?
    // (fire and void are never destroyed on placement; anything else dies
    // next to a fire that has no adjacent void). Lets planners AVOID doomed
    // cells instead of discovering them by wasting stones.
    function stoneWouldSurvive(snap, x, y, type) {
        if (type === 'fire' || type === 'void') return true;
        return !neighborStones(snap, x, y).some(nb =>
            nb.type === 'fire' && !hasAdjacentVoid(snap, nb.x, nb.y));
    }

    function applyFireInteractions(snap, placed) {
        if (placed.type === 'fire') {
            if (!hasAdjacentVoid(snap, placed.x, placed.y)) {
                for (const nb of neighborStones(snap, placed.x, placed.y)) {
                    if (nb.type !== 'void' && nb.type !== 'fire') destroyStone(snap, nb);
                }
            }
            return;
        }
        if (placed.type === 'void') return;
        const killer = neighborStones(snap, placed.x, placed.y).some(nb =>
            nb.type === 'fire' && !hasAdjacentVoid(snap, nb.x, nb.y));
        if (killer) destroyStone(snap, placed);
    }

    // ----------------------------------------------------------------
    // Action simulators — each takes the CLONED snapshot and mutates it
    // ----------------------------------------------------------------
    function drawScrollOnReveal(snap, playerIndex, element) {
        // revealTile → onTileRevealed draws the tile element's top deck
        // scroll into the revealing player's hand — even past MAX_HAND
        // (overflow lingers as a pending cascade the player resolves later,
        // so the snapshot really does show handCount > capacity).
        const p = snap.players[playerIndex];
        if (!p) return;
        if (p.hand) p.hand.push(unknownScroll(element));
        p.handCount++;
    }

    // Wandering River override for a tile (getEffectiveTileElement()): a
    // revealed River tile draws the CHOSEN element's scroll.
    function riverElementFor(snap, tileId) {
        const list = snap.crossTurnBuffs?.wanderingRiver;
        if (!Array.isArray(list)) return null;
        const e = list.find(x => Number(x.tileId) === Number(tileId));
        return e ? e.newElement : null;
    }

    function simMove(snap, a) {
        const p = activePlayer(snap);
        p.x = a.x; p.y = a.y;
        let cost = a.cost ?? 1;
        // Steam Vents: every AP-costing step alternates paid/free, one
        // hex-step at a time (simMove()'s own granularity) — mirrors
        // game-core's calculatePathCost/commitSteamVentsState exactly.
        // Already-free steps (cost 0, e.g. wind) never touch the bank.
        const svBanked = snap.turn.buffs?.steamVentsBanked;
        if (svBanked !== undefined && cost > 0) {
            if (svBanked) { cost = 0; snap.turn.buffs.steamVentsBanked = false; }
            else { snap.turn.buffs.steamVentsBanked = true; }
        }
        snap.turn.ap -= cost;

        // Landing on any hex of a face-down tile reveals it (handlePlayerLanding)
        const here = grid(snap).find(h => dist(h.x, h.y, a.x, a.y) < HEX_NEAR);
        if (here) {
            for (const id of here.tileIds) {
                const t = snap.tiles.find(t => t.id === id);
                if (t && !t.revealed && !t.isPlayerTile) {
                    t.revealed = true;
                    t.shrineType = t.known || 'unknown'; // remembered, else NEVER invent the hidden element
                    drawScrollOnReveal(snap, snap.turn.activePlayerIndex, riverElementFor(snap, t.id));
                    simNotes(snap).notes.push(`revealed tile ${t.id} (element unknown; catacomb +1 AP not modelled)`);
                }
            }
        }
    }

    // Catacomb/Freedom shrine hop — free (no AP), destination is always
    // already-revealed (see bot-state.js's legalActions() candidate filter),
    // so unlike simMove() there's no tile-reveal side effect to model.
    function simTeleport(snap, a) {
        const p = activePlayer(snap);
        p.x = a.x; p.y = a.y;
    }

    function simEndTurn(snap) {
        const ai = snap.turn.activePlayerIndex;
        const p = snap.players[ai];

        // Shrine collection: standing on a revealed elemental shrine CENTRE
        if (p) {
            const shrine = snap.tiles.find(t =>
                !t.isPlayerTile && t.revealed && dist(t.x, t.y, p.x, p.y) < HEX_NEAR);
            // Wandering River (WATER_SCROLL_4): getEffectiveTileElement()'s
            // override, mirrored exactly — first matching entry (real code
            // never dedupes on push, so an earlier override on the same
            // tile always wins), applies unconditionally including over a
            // 'catacomb' or still-'unknown' original type (the override
            // value is the ACTING PLAYER's own choice, never invented hidden
            // info, so a Wandering-River-covered tile can be a known
            // collectible even while its own reveal is still masked).
            const wr = shrine && snap.crossTurnBuffs?.wanderingRiver;
            const wrEntry = Array.isArray(wr) ? wr.find(e => e.tileId === shrine.id) : null;
            const effEl = shrine ? (wrEntry ? wrEntry.newElement : shrine.shrineType) : null;
            if (effEl && effEl !== 'catacomb') {
                if (effEl === 'unknown') {
                    simNotes(snap).notes.push('endTurn on an unknown-element shrine - collection not modelled');
                } else if (ELEMENTS.includes(effEl)) {
                    const el = effEl;
                    // Mine (CATACOMB_SCROLL_2): double this specific shrine
                    // type's output this turn — POOL_CAP below still applies,
                    // matching the real "cannot exceed 5" text (it's just the
                    // natural pool-capacity consequence, not a separate clamp).
                    const mine = snap.turn.buffs?.mineShrineType === el;
                    const amount = Math.min(
                        REPLENISH[el] * (mine ? 2 : 1),
                        snap.sourcePool[el] || 0,
                        POOL_CAP - (p.pool[el] || 0)
                    );
                    if (amount > 0) {
                        snap.sourcePool[el] -= amount;
                        p.pool[el] = (p.pool[el] || 0) + amount;
                    }
                }
            }

            // Respirate (WIND_SCROLL_3): ALL of the caster's wind (not just
            // what was drawn) returns to source at end of turn — mirrors
            // clearTurnBuffs()'s respirateWind handler exactly.
            if (snap.turn.buffs?.respirateWind && (p.pool.wind || 0) > 0) {
                const amount = p.pool.wind;
                p.pool.wind = 0;
                snap.sourcePool.wind = Math.min(SOURCE_CAP, (snap.sourcePool.wind || 0) + amount);
            }
        }

        // Advance the turn in COLOR_RANK order (end-turn handler in game-ui.js)
        const order = snap.players
            .map((pl, i) => pl ? { i, rank: COLOR_RANK[pl.color] || 999 } : null)
            .filter(Boolean)
            .sort((a, b) => a.rank - b.rank);
        let next = ai;
        if (order.length > 1) {
            const cur = order.findIndex(o => o.i === ai);
            next = order[(cur === -1 ? order.length - 1 : cur + 1) % order.length].i;
        }
        snap.turn.activePlayerIndex = next;
        const nextPool = snap.players[next]?.pool || {};
        snap.turn.ap = BASE_AP + (nextPool.void || 0); // AP reset + refreshVoidAP
        snap.turn.buffs = {}; // "until end of turn" buffs (Burning Motivation) expire

        // Cross-turn buffs (Freedom, Wandering River): unlike turn.buffs
        // above, these persist through every OTHER player's turn and only
        // clear at their OWN OWNER's next turn start — mirrors
        // clearFreedomForPlayer(next)/clearWanderingRiverForPlayer(next)
        // being called right as that player's turn begins (game-ui.js/
        // lobby.js), never touched by clearTurnBuffs()'s blanket wipe.
        if (snap.crossTurnBuffs?.freedom?.playerIndex === next) {
            snap.crossTurnBuffs.freedom = null;
        }
        if (Array.isArray(snap.crossTurnBuffs?.wanderingRiver)) {
            snap.crossTurnBuffs.wanderingRiver =
                snap.crossTurnBuffs.wanderingRiver.filter(e => e.playerIndex !== next);
        }
        // Excavate (CATACOMB_SCROLL_4): unlike the two above, clearing this
        // one DOES something — mirrors processExcavateTeleport(next) firing
        // right as that player's turn begins and always accepting the
        // teleport prompt (driveExcavateTeleportModal — free, no downside).
        if (snap.crossTurnBuffs?.excavate?.playerIndex === next) {
            resolveExcavateTeleport(snap, next);
            snap.crossTurnBuffs.excavate = null;
        }

        // Search support: a state evaluator must know the turn boundary was
        // crossed — otherwise the AP reset makes endTurn look like free value
        // (especially in single-player, where activePlayerIndex doesn't change).
        simNotes(snap).turnsEnded++;
    }

    function simPlaceStone(snap, a) {
        const p = activePlayer(snap);
        if ((p.pool[a.stoneType] || 0) <= 0) return; // guard mirrors applyAction
        p.pool[a.stoneType]--;
        const placed = { x: +a.x.toFixed(1), y: +a.y.toFixed(1), type: a.stoneType };
        snap.stones.push(placed);
        // Burning Motivation (FIRE_SCROLL_2): +2 AP per stack, granted the
        // instant the stone is placed — BEFORE the fire-interaction check, so
        // a stone that gets destroyed the same instant still paid out (mirrors
        // game-core.js's placeStone handler, which calls addAP() ahead of
        // processStoneInteractions()). Capped the same way addAP() clamps
        // (base 5 + current void pool) — the simplified single `turn.ap`
        // number this simulator uses throughout already folds base+void into
        // one cap, same as simEndTurn()'s AP reset does.
        const stacks = snap.turn.buffs?.burningMotivationStacks || 0;
        if (stacks > 0) {
            const cap = BASE_AP + (p.pool.void || 0);
            snap.turn.ap = Math.min(cap, snap.turn.ap + stacks * 2);
        }
        applyFireInteractions(snap, placed);
    }

    // ----------------------------------------------------------------
    // Whitelisted scroll-effect simulations (Stage 2.5 step 4).
    // Each mirrors BOTH the real effect's state change AND the exact
    // deterministic choice its BotEffects driver would make — a simulated
    // cast must land on the same outcome the real cast (resolved by the
    // driver) produces, or validate() flags the divergence.
    // ----------------------------------------------------------------
    const CREATE_RANKS = { earth: 5, water: 4, fire: 3, wind: 2, void: 1 };

    // Mirror of bot-effects.js's elementNeed()/rankedElements() (same
    // constants, same stable-sort tie-break — validate() is the drift alarm
    // if the two ever diverge).
    function effectElementNeed(snap, p, element) {
        const room = Math.max(0, POOL_CAP - (p.pool[element] || 0));
        let v = 1.0 * room;
        if (!p.activated.includes(element)) v += 2.5 * room;
        if ((snap.sourcePool[element] || 0) <= 0) v += -3.0 * room;
        return v;
    }
    function effectRankedElements(snap, p) {
        return [...ELEMENTS].sort((a, b) =>
            effectElementNeed(snap, p, b) - effectElementNeed(snap, p, a));
    }

    // Create (VOID_SCROLL_5): the driver clicks the best-need element whose
    // pool still has room (full-pool buttons aren't clickable);
    // drawStonesToPool then grants min(rank, source available, pool room).
    function simEffectCreate(snap, p, choice) {
        const picked = choiceElement(choice);
        const el = (picked && (p.pool[picked] || 0) < POOL_CAP) ? picked
            : effectRankedElements(snap, p).find(e => (p.pool[e] || 0) < POOL_CAP);
        if (!el) return; // every pool full — nothing clickable, cast fizzles
        const drawn = Math.min(
            CREATE_RANKS[el],
            snap.sourcePool[el] || 0,
            POOL_CAP - (p.pool[el] || 0)
        );
        if (drawn > 0) {
            snap.sourcePool[el] -= drawn;
            p.pool[el] = (p.pool[el] || 0) + drawn;
        }
    }

    // Quick Reflexes (CATACOMB_SCROLL_9): the driver picks the most-needed
    // element (rankedElements()) whose level-1 scroll is still findable —
    // unlike Scholar's Insight/Inspiring Draught, this specific card's
    // NAME is deterministic (ELEMENT_SCROLL_1), so with snap.level1Available
    // (bot-state.js) telling us which elements still have theirs in the
    // deck, the exact drawn scroll is knowable, not just "an unknown card".
    // Also draws 2 of that element's stones (source/pool capped, same shape
    // as Mason's Savvy). The "level-1 scrolls cost 0 AP" buff is NOT
    // modelled: level-1 scrolls are response-only and never enumerated as a
    // legal PROACTIVE cast (see legalActions()'s `def.level === 1` skip), so
    // the buff has no consumer anywhere in this simulator to matter to.
    function simEffectQuickReflexes(snap, p, choice) {
        if (!snap.level1Available) return; // older/real snapshot missing this field — no info, bail like an empty search
        const picked = choiceElement(choice);
        const el = (picked && snap.level1Available[picked]) ? picked
            : effectRankedElements(snap, p).find(e => snap.level1Available[e]);
        if (!el) return; // real flow shows "no level 1 scrolls available" and bails
        const scrollName = `${el.toUpperCase()}_SCROLL_1`;
        if (p.hand) { p.hand.push(scrollName); p.handCount++; }
        snap.level1Available[el] = false; // drawn — no longer in that deck
        const drawn = Math.min(2, snap.sourcePool[el] || 0, POOL_CAP - (p.pool[el] || 0));
        if (drawn > 0) {
            snap.sourcePool[el] -= drawn;
            p.pool[el] = (p.pool[el] || 0) + drawn;
        }
    }

    // Transmute (FIRE_SCROLL_4): the driver discards the most-plentiful
    // NON-void stone (returned to the source pool, capped) for +2 AP each
    // (capped at 5 + void stones held), until total AP reaches
    // min(cap, WEIGHTS.transmuteTargetAP) or stones run out. Never scrolls,
    // never void — driveTransmute skips both (see its comment; skipping
    // void is also what makes this mirror exact, since a void discard
    // clamps voidAP through a current/void split the snapshot can't see).
    function simEffectTransmute(snap, p) {
        const maxTotal = BASE_AP + (p.pool.void || 0);
        const target = Math.min(maxTotal,
            window.BotSystem?.WEIGHTS?.transmuteTargetAP ?? 7);
        while (snap.turn.ap < target) {
            let best = null, bestCount = 0;
            for (const el of ELEMENTS) {
                if (el === 'void') continue;
                if ((p.pool[el] || 0) > bestCount) { bestCount = p.pool[el]; best = el; }
            }
            if (!best) break;
            p.pool[best]--;
            if ((snap.sourcePool[best] || 0) < SOURCE_CAP) snap.sourcePool[best]++;
            snap.turn.ap = Math.min(maxTotal, snap.turn.ap + 2);
        }
    }

    // Arson (FIRE_SCROLL_5): the driver targets the biggest threat
    // (rankedOpponents: most activated ×1000 + total pool, stable
    // tie-break = lowest index), then destroys 1 stone of that opponent's
    // most-plentiful type — returned to the source pool, same as any other
    // destroyed stone (see destroyStone() above) — and the scroll moves from
    // the caster's active area to the common area (replacing any same-element
    // scroll there, per discardToCommonArea). If the target has no stones the
    // real flow aborts before any of that — scroll stays in active.
    // Excavate immunity is a buff the snapshot doesn't carry — accepted
    // (rare) divergence in target choice.
    function simEffectArson(snap, p, scrollName, choice) {
        const meIdx = snap.turn.activePlayerIndex;
        let target = null, bestScore = -1;
        let el = null, count = 0;
        const chosen = choice ? snap.players[choice.target] : null;
        if (chosen && chosen.index !== meIdx && (chosen.pool[choice.element] || 0) > 0) {
            target = chosen; el = choice.element;
        } else {
            for (const op of snap.players) {
                if (!op || op.index === meIdx) continue;
                const score = op.activated.length * 1000 +
                    ELEMENTS.reduce((s, el) => s + (op.pool[el] || 0), 0);
                if (score > bestScore) { bestScore = score; target = op; }
            }
            if (!target) return;
            for (const e of ELEMENTS) {
                if ((target.pool[e] || 0) > count) { count = target.pool[e]; el = e; }
            }
        }
        if (!el) return; // target has no stones — real flow aborts, scroll stays put
        target.pool[el]--;
        if ((snap.sourcePool[el] || 0) < SOURCE_CAP) snap.sourcePool[el]++;
        // handleScrollDisposition(..., forceToCommonArea): active → common
        // area (a common-area cast isn't in active, and simply stays there)
        const ai = p.active.indexOf(scrollName);
        if (ai !== -1) { p.active.splice(ai, 1); p.activeCount--; }
        if (!snap.commonArea) snap.commonArea = [];
        snap.commonArea = snap.commonArea.filter(name =>
            window.SCROLL_DEFINITIONS?.[name]?.element !== 'fire');
        if (!snap.commonArea.includes(scrollName)) snap.commonArea.push(scrollName);
    }

    // Plunder (CATACOMB_SCROLL_8): same "biggest threat" opponent targeting
    // as Arson (rankedOpponents), filtered to opponents who actually have a
    // plunderable active scroll; takes their HIGHEST-level active scroll
    // (pickStrongestButton — opposite of Sacrificial Pyre/Inspiring
    // Draught's "give up the weakest") to the common area (element-keyed
    // replacement, same as discardToCommonArea/Arson above — note this
    // replaces by the PLUNDERED scroll's element, not always fire).
    // Excavate immunity: same accepted divergence as Arson.
    function simEffectPlunder(snap, p, scrollName, choice) {
        const meIdx = snap.turn.activePlayerIndex;
        let target = null, bestScore = -1;
        let best = null, bestLevel = -1;
        const chosen = choice ? snap.players[choice.target] : null;
        if (chosen && chosen.index !== meIdx && (chosen.active || []).includes(choice.scroll)) {
            target = chosen; best = choice.scroll;
        } else {
            for (const op of snap.players) {
                if (!op || op.index === meIdx || !op.active || !op.active.length) continue;
                const score = op.activated.length * 1000 +
                    ELEMENTS.reduce((s, el) => s + (op.pool[el] || 0), 0);
                if (score > bestScore) { bestScore = score; target = op; }
            }
            if (!target) return; // nobody has a plunderable active scroll
            for (const name of target.active) {
                const level = window.SCROLL_DEFINITIONS?.[name]?.level ?? 0;
                if (level > bestLevel) { bestLevel = level; best = name; }
            }
        }
        if (!best) return;
        const ti = target.active.indexOf(best);
        target.active.splice(ti, 1); target.activeCount--;
        const el = window.SCROLL_DEFINITIONS?.[best]?.element;
        if (!snap.commonArea) snap.commonArea = [];
        if (el) snap.commonArea = snap.commonArea.filter(name => window.SCROLL_DEFINITIONS?.[name]?.element !== el);
        if (!snap.commonArea.includes(best)) snap.commonArea.push(best);
    }

    // ── Tranche 2 ────────────────────────────────────────────────────
    // Tile-geometry rule shared by flip/combust eligibility: a stone or
    // pawn "on a tile" = within TILE_SIZE*4 of the tile centre (mirrors
    // tileHasStones/tileHasPlayers/destroyStonesOnTile in scroll-effects).
    const TILE_RADIUS = 80;
    function tileStoneCount(snap, t) {
        return snap.stones.filter(s => dist(s.x, s.y, t.x, t.y) < TILE_RADIUS).length;
    }
    function tileHasPawns(snap, t) {
        return snap.players.some(pl => pl && dist(pl.x, pl.y, t.x, t.y) < TILE_RADIUS);
    }
    // Indices of every player standing on this tile (mirrors getPlayersOnTile)
    function tilePlayerIndices(snap, t) {
        const out = [];
        snap.players.forEach((pl, i) => { if (pl && dist(pl.x, pl.y, t.x, t.y) < TILE_RADIUS) out.push(i); });
        return out;
    }

    // Shifting Sands (EARTH_SCROLL_2): eligible = non-player tiles, no
    // stones, AT MOST 1 player (looser than Heavy Stomp/Combust's "zero
    // players" — isTileEligibleForShiftingSands allows one lone occupant,
    // who then travels with their tile). The driver picks the GLOBALLY
    // closest eligible pair: a double loop over every ordered pair tracks
    // the single minimum distance found and keeps whichever tile ("a") was
    // on the winning side of it (mirrors driveTileSwap's exact loop, not
    // just "any tile with a close neighbor" — ties break on iteration
    // order = snap.tiles order, same convention as Combust/Arson). Only
    // positions swap; each tile's own stones/rotation/id stay put. A lone
    // occupant is recentred onto their tile's NEW position (mirrors
    // recenterPlayerOnTile) — never both tiles at once, since eligibility
    // caps each at one player.
    function simEffectShiftingSands(snap, choice) {
        const eligible = snap.tiles.filter(t =>
            !t.isPlayerTile && tileStoneCount(snap, t) === 0 && tilePlayerIndices(snap, t).length <= 1);
        if (eligible.length < 2) return; // real flow bails before any selection
        if (choice && choice.a != null) {
            const ca = eligible.find(t => Number(t.id) === Number(choice.a));
            const cb = eligible.find(t => Number(t.id) === Number(choice.b));
            if (ca && cb && ca !== cb) return swapTiles(snap, ca, cb);
        }
        let a = null, bestDist = Infinity;
        for (const x of eligible) {
            for (const y of eligible) {
                if (x.id === y.id) continue;
                const d = dist(x.x, x.y, y.x, y.y);
                if (d < bestDist) { bestDist = d; a = x; }
            }
        }
        if (!a) return;
        const rest = eligible.filter(t => t.id !== a.id);
        let b = null, bestB = Infinity;
        for (const t of rest) {
            const d = dist(a.x, a.y, t.x, t.y);
            if (d < bestB) { bestB = d; b = t; }
        }
        if (!b) return;
        swapTiles(snap, a, b);
    }

    function swapTiles(snap, a, b) {
        const aOccupant = tilePlayerIndices(snap, a)[0];
        const bOccupant = tilePlayerIndices(snap, b)[0];
        const ax = a.x, ay = a.y;
        a.x = b.x; a.y = b.y;
        b.x = ax; b.y = ay;
        if (aOccupant !== undefined) { snap.players[aOccupant].x = a.x; snap.players[aOccupant].y = a.y; }
        if (bOccupant !== undefined) { snap.players[bOccupant].x = b.x; snap.players[bOccupant].y = b.y; }
    }

    // Take Flight (WIND_SCROLL_4): self-target only — mirrors the real
    // driver's own v1 scope exactly (bot-effects.js's
    // driveTakeFlightPlayerModal always picks self; opponent-targeting is
    // deliberately out of scope there too). Candidate hexes are every walkable
    // hex on a tile currently occupied by ANOTHER player, excluding any
    // player-tile hex, any hex on a still-hidden tile, occupied hexes, and
    // stones — mirrors getValidTakeFlightDestinations() exactly (that
    // function's own isPositionOnPlayerTile check is why this can NEVER
    // double as a direct win, despite what an older roadmap note claimed).
    // Among those, picks the one closest to the caster's own next
    // objective — home if all 5 elements are activated, else the nearest
    // hidden tile — the same _bestTakeFlightDestination() heuristic
    // bot-effects.js's driver now uses (this used to roll a random valid
    // destination, which no snapshot-only simulation could ever honestly
    // claim to match).
    // Hexes Take Flight may land on: unoccupied, stone-free hexes of a
    // revealed, non-player tile that another pawn is standing on
    // (getValidTakeFlightDestinations).
    function takeFlightCandidates(snap, p) {
        const g = grid(snap);
        const occupiedTileIds = new Set();
        for (const pl of snap.players) {
            if (!pl || pl.index === p.index) continue;
            const hex = g.find(h => dist(h.x, h.y, pl.x, pl.y) < HEX_NEAR);
            if (hex) for (const id of hex.tileIds) occupiedTileIds.add(id);
        }
        if (!occupiedTileIds.size) return [];
        return g.filter(h => {
            if (!h.tileIds.some(id => occupiedTileIds.has(id))) return false;
            if (h.tileIds.some(id => {
                const t = snap.tiles.find(tt => tt.id === id);
                return t && (t.isPlayerTile || !t.revealed);
            })) return false;
            if (stoneAt(snap, h.x, h.y)) return false;
            if (snap.players.some(pl => pl && dist(pl.x, pl.y, h.x, h.y) < HEX_NEAR)) return false;
            return true;
        });
    }

    // Where player v lands when Take Flight moves them and THEY choose (the
    // rule for an opponent target, and the bot's own default): the landing
    // nearest their next objective, home with all 5 elements, else the
    // nearest face-down tile. Mirrors bot-effects.js _bestTakeFlightDestination.
    function takeFlightLandingFor(snap, v) {
        const candidates = takeFlightCandidates(snap, v);
        if (!candidates.length) return null;
        let goal = null;
        if (ELEMENTS.every(el => v.activated.includes(el))) {
            goal = snap.tiles.find(t => t.isPlayerTile && t.playerIndex === v.index);
        } else {
            const hidden = snap.tiles.filter(t => !t.revealed && !t.isPlayerTile);
            goal = hidden.length
                ? hidden.reduce((a, b) => (!a || dist(v.x, v.y, b.x, b.y) < dist(v.x, v.y, a.x, a.y)) ? b : a, null)
                : null;
        }
        return goal
            ? candidates.reduce((a, b) => (!a || dist(goal.x, goal.y, b.x, b.y) < dist(goal.x, goal.y, a.x, a.y)) ? b : a, null)
            : candidates[0];
    }

    function simEffectTakeFlight(snap, p, choice) {
        // Aimed at an opponent (owner, 2026-09-29: Take Flight is for moving
        // opponents): they are moved, and they pick where to land.
        if (choice && choice.target != null && choice.target !== p.index) {
            const v = snap.players[choice.target];
            const d = v ? takeFlightLandingFor(snap, v) : null;
            if (d) { v.x = d.x; v.y = d.y; }
            return;
        }
        if (choice && choice.x != null) {
            const hit = takeFlightCandidates(snap, p).find(h => dist(h.x, h.y, choice.x, choice.y) < HEX_NEAR);
            if (hit) { p.x = hit.x; p.y = hit.y; return; }
        }
        const dest = takeFlightLandingFor(snap, p);
        if (dest) { p.x = dest.x; p.y = dest.y; }
    }

    // Refreshing Thought (WATER_SCROLL_2): draw the top catacomb-deck
    // scroll to hand. Identity (and deck emptiness) aren't in the snapshot
    // — drawn as UNKNOWN_SCROLL; an exhausted deck's no-op is an accepted
    // rare divergence.
    function simEffectRefreshingThought(snap) {
        drawScrollOnReveal(snap, snap.turn.activePlayerIndex);
    }

    // Scholar's Insight (VOID_SCROLL_4): the driver picks the most-needed
    // element's deck (rankedElements()[0] whose button is actually
    // clickable — a deck-emptiness check this snapshot can't make, same
    // accepted-divergence class as Refreshing Thought above), then the
    // highest-level scroll IN that deck. Which scroll that specific level
    // turns out to be isn't knowable either (deck contents/order aren't in
    // the snapshot) — drawn as UNKNOWN_SCROLL, same convention as every
    // other "we know a draw happens, not which card" case in this file.
    function simEffectScholarsInsight(snap, choice) {
        // With a chosen deck the drawn scroll's element is known (the
        // driver then takes the best card of that deck).
        drawScrollOnReveal(snap, snap.turn.activePlayerIndex, choiceElement(choice));
    }
    const choiceElement = c => (c && ELEMENTS.includes(c.element)) ? c.element : null;

    // Inspiring Draught (WATER_SCROLL_3): draws 2 from the most-needed
    // element's deck, puts 1 back — net effect is always "keep exactly 1"
    // (even when only 1 was drawable, it's auto-kept), so this is a plain
    // +1 UNKNOWN_SCROLL from that deck, same shape as Scholar's Insight.
    // The put-back choice (response-only first, else lowest-level) only
    // affects the DECK, which isn't in the snapshot, so it has no visible
    // consequence here.
    function simEffectInspiringDraught(snap, choice) {
        drawScrollOnReveal(snap, snap.turn.activePlayerIndex, choiceElement(choice));
    }

    // Mason's Savvy (EARTH_SCROLL_3): draw up to 5 earth (source/room
    // capped). The 5-hex placement buff isn't in the snapshot — accepted
    // gap, same class as every activeBuffs omission.
    function simEffectMasonsSavvy(snap, p) {
        buffs(snap).earthRange = 5; // earth stones within 5 hexes this turn
        const drawn = Math.min(5, snap.sourcePool.earth || 0, POOL_CAP - (p.pool.earth || 0));
        if (drawn > 0) {
            snap.sourcePool.earth -= drawn;
            p.pool.earth = (p.pool.earth || 0) + drawn;
        }
    }

    // Heavy Stomp (EARTH_SCROLL_4): eligible = non-player tiles with no
    // stones/pawns on them. The driver strongly prefers REVEALING the
    // hidden eligible tile nearest the pawn (strict-closer, first wins
    // ties); only with zero hidden eligible tiles does it hide
    // eligible[0]. Reveal side effects mirror simMove's: element becomes
    // 'unknown', a scroll is drawn to hand, catacomb's +1 AP unmodelled.
    // Shared by Heavy Stomp (EARTH_SCROLL_4) and Call to Adventure
    // (CATACOMB_SCROLL_3) — both route through the SAME real function
    // (enterTileFlipMode/getEligibleTilesForFlip) and the SAME driver
    // (driveTileFlip: prefer revealing the nearest hidden eligible tile,
    // else hide eligible[0]).
    function flipNearestEligibleTile(snap, p, label, tileId) {
        const eligible = snap.tiles.filter(t =>
            !t.isPlayerTile && tileStoneCount(snap, t) === 0 && !tileHasPawns(snap, t));
        if (!eligible.length) return; // real flow bails before any selection
        const hidden = eligible.filter(t => !t.revealed);
        // A chosen tile (cast action's choice) wins when it is still a legal
        // hidden target; otherwise the driver's default, the nearest one.
        const chosen = tileId != null ? hidden.find(t => Number(t.id) === Number(tileId)) : null;
        if (chosen || hidden.length) {
            let pick = chosen, best = Infinity;
            if (!pick) for (const t of hidden) {
                const d = dist(t.x, t.y, p.x, p.y);
                if (d < best) { best = d; pick = t; }
            }
            pick.revealed = true;
            pick.shrineType = pick.known || 'unknown'; // remembered, else NEVER invent the hidden element
            drawScrollOnReveal(snap, snap.turn.activePlayerIndex, riverElementFor(snap, pick.id));
            simNotes(snap).notes.push(`${label} revealed tile ${pick.id} (element unknown; catacomb +1 AP not modelled)`);
        } else {
            const t = eligible[0];
            t.revealed = false;
            t.shrineType = null; // face-down tiles mask their element
        }
    }

    function simEffectHeavyStomp(snap, p, choice) {
        flipNearestEligibleTile(snap, p, 'Heavy Stomp', choice?.tileId);
    }

    // Call to Adventure (CATACOMB_SCROLL_3): the flip itself mirrors Heavy
    // Stomp exactly (same function, same driver). The buff's OWN extra
    // effect — future reveals this turn immediately granting shrine
    // stones — is NOT modelled: the element of a just-flipped or
    // not-yet-flipped tile is exactly the hidden information this
    // simulator refuses to invent (same reasoning that excludes it from
    // simEffectHeavyStomp's reveal above). Accepted divergence, flagged so
    // an evaluator could eventually credit "this turn's reveals are worth
    // more" once someone builds a value model that doesn't need to know
    // the element to do it.
    function simEffectCallToAdventure(snap, p, choice) {
        flipNearestEligibleTile(snap, p, 'Call to Adventure', choice?.tileId);
        buffs(snap).callToAdventure = true;
        simNotes(snap).notes.push('Call to Adventure buff active - future-reveal stone grants not modelled (element unknowable)');
    }

    // Combust (CATACOMB_SCROLL_10): destroy EVERY stone on the non-player
    // tile holding the most stones (driver argmax, first wins ties, tile
    // order = placedTiles order = snap.tiles order). Destroyed stones are
    // removed OUTRIGHT — unlike fire-interaction/Transmute destroys they
    // do NOT return to the source pool (destroyStonesOnTile just splices).
    function simEffectCombust(snap) {
        let pick = null, best = 0;
        for (const t of snap.tiles) {
            if (t.isPlayerTile) continue;
            const n = tileStoneCount(snap, t);
            if (n > best) { best = n; pick = t; }
        }
        if (!pick) return; // no tile with stones — real flow bails
        snap.stones = snap.stones.filter(s => dist(s.x, s.y, pick.x, pick.y) >= TILE_RADIUS);
    }

    // ── Tranche 3 (turn buffs) ──────────────────────────────────────
    // Burning Motivation (FIRE_SCROLL_2): no target choice — mirrors
    // scroll-effects.js's execute() exactly: re-casting by the SAME player
    // (the only caster a single-active-player simulation ever has) increments
    // stacks rather than resetting it. The AP payout itself lives in
    // simPlaceStone(), since that's when the real game grants it.
    function simEffectBurningMotivation(snap) {
        if (!snap.turn.buffs) snap.turn.buffs = {};
        snap.turn.buffs.burningMotivationStacks = (snap.turn.buffs.burningMotivationStacks || 0) + 1;
    }

    function buffs(snap) { return snap.turn.buffs || (snap.turn.buffs = {}); }

    // Cross-turn buffs (Freedom, Wandering River) live OUTSIDE snap.turn —
    // simEndTurn()'s blanket `snap.turn.buffs = {}` must never touch them;
    // they're cleared individually, by owner, at that owner's own next turn.
    function crossTurn(snap) { return snap.crossTurnBuffs || (snap.crossTurnBuffs = {}); }

    // ── Tranche 4 (more turn buffs) ──────────────────────────────────
    // Same shape as Burning Motivation: no target choice, a flag on
    // snap.turn.buffs, consumed elsewhere (legalActions, canMoveTo, simMove,
    // simEndTurn), cleared by simEndTurn's blanket `snap.turn.buffs = {}` —
    // verified to be the REAL clearing behavior too: scroll-effects.js's
    // clearTurnBuffs() wipes every `expiresThisTurn` buff on ANY end turn,
    // not just the caster's own next turn, despite what a couple of these
    // scrolls' flavor text says ("until your next turn") — mirrored as-is.

    // Avalanche (EARTH_SCROLL_5): place any stone type anywhere this turn.
    // Consumed in legalActions()'s placeStone range gate.
    function simEffectAvalanche(snap) {
        buffs(snap).globalPlacement = true;
    }

    // Seed the Skies (CATACOMB_SCROLL_6): draw up to 5 water (source/pool
    // capped, same shape as Mason's Savvy), then water/wind may be placed
    // anywhere this turn. Consumed in legalActions()'s placeStone range gate.
    function simEffectSeedTheSkies(snap, p) {
        const drawn = Math.min(5, snap.sourcePool.water || 0, POOL_CAP - (p.pool.water || 0));
        if (drawn > 0) {
            snap.sourcePool.water -= drawn;
            p.pool.water = (p.pool.water || 0) + drawn;
        }
        buffs(snap).waterWindGlobalPlacement = true;
    }

    // Respirate (WIND_SCROLL_3): draw up to 3 wind (source/pool capped) now;
    // ALL of the caster's wind returns to source at end of THIS turn (even
    // wind they already held before the cast — mirrors clearTurnBuffs()'s
    // respirateWind handler, which zeroes the whole pool, not just the draw).
    // The return itself is applied in simEndTurn().
    function simEffectRespirate(snap, p) {
        const drawn = Math.min(3, snap.sourcePool.wind || 0, POOL_CAP - (p.pool.wind || 0));
        if (drawn > 0) {
            snap.sourcePool.wind -= drawn;
            p.pool.wind = (p.pool.wind || 0) + drawn;
        }
        buffs(snap).respirateWind = true;
    }

    // Simplify (VOID_SCROLL_3): no immediate effect — castCost() and
    // legalActions()'s cast-affordability gate read this buff directly.
    function simEffectSimplify(snap) {
        buffs(snap).simplify = true;
    }

    // Mine (CATACOMB_SCROLL_2): if the caster is currently standing on the
    // CENTRE of an elemental (non-catacomb) shrine tile, that shrine's
    // collection amount doubles this turn. Consumed in simEndTurn().
    function simEffectMine(snap, p) {
        const shrine = snap.tiles.find(t =>
            !t.isPlayerTile && t.revealed && ELEMENTS.includes(t.shrineType) &&
            dist(t.x, t.y, p.x, p.y) < HEX_NEAR);
        if (shrine) buffs(snap).mineShrineType = shrine.shrineType;
    }

    // Steam Vents (CATACOMB_SCROLL_5): the first AP-costing move step this
    // turn is free; every AP-costing step after that alternates paid/free
    // (mirrors game-core's calculatePathCost/commitSteamVentsState banked-step
    // alternation exactly, one hex-step at a time since that's simMove()'s
    // granularity — already-free steps, e.g. wind, don't touch the bank).
    function simEffectSteamVents(snap) {
        buffs(snap).steamVentsBanked = true;
    }

    // Mudslide (CATACOMB_SCROLL_1): earth/water stones act as wind for the
    // caster's movement this turn (free unless void-adjacent). Consumed in
    // canMoveTo(), checked BEFORE the normal earth/water branches — mirrors
    // game-core.js, where the Mudslide check returns early and never reaches
    // the water-chaining logic below it.
    function simEffectMudslide(snap) {
        buffs(snap).mudslide = true;
    }

    // Reflecting Pool (CATACOMB_SCROLL_7): +2 AP per DISTINCT stone type
    // within true hex-distance 5 of the caster (cube-coordinate distance,
    // not euclidean px — mirrors game-core's pixelToHex-based check exactly).
    // Once per turn — legalActions() excludes a recast once the buff is set.
    function simEffectReflectingPool(snap, p) {
        const types = new Set();
        for (const s of snap.stones) {
            if (hexDistance(p.x, p.y, s.x, s.y, TILE) <= 5) types.add(s.type);
        }
        const apGain = types.size * 2;
        if (apGain > 0) {
            const cap = BASE_AP + (p.pool.void || 0);
            snap.turn.ap = Math.min(cap, snap.turn.ap + apGain);
        }
        buffs(snap).reflectingPool = true;
    }

    // Control the Current (WATER_SCROLL_5): this turn, whenever a water
    // stone is adjacent to the caster — right after the cast, or after any
    // later move — it's transformed into their most-needed non-water
    // element. Mirrors bot-effects.js's driveWaterTransform() exactly: it
    // always acts on the FIRST adjacent water stone (same array order as
    // placedStones/snap.stones), and clickBestElement(rankedElements())
    // always lands on the best-ranked element whose source pool isn't
    // empty (see attemptControlTheCurrentTransform below). No "Done"
    // button in the real effect — it's driven opportunistically for the
    // rest of the turn, not a one-shot choice at cast time, so this only
    // sets the buff and makes the one attempt that's possible immediately;
    // simulate() makes the same attempt again after every later action
    // while the buff is active (mirrors waitForQuiescence() polling
    // driveWaterTransform() after every bot action in a real game).
    function simEffectControlTheCurrent(snap, p) {
        buffs(snap).controlTheCurrent = { playerIndex: p.index };
        attemptControlTheCurrentTransform(snap);
    }

    // Shared by simEffectControlTheCurrent (right after the cast) and
    // simulate() (after every later action while the buff is active) —
    // mirrors scroll-effects.js's showWaterTransformPopup()/
    // transformWaterStone(): the transformed stone returns 1 to the water
    // source pool, the new element leaves its source pool, and the same
    // fire/void interaction check a freshly placed stone gets runs at its
    // (unchanged) position.
    function attemptControlTheCurrentTransform(snap) {
        const buff = snap.turn.buffs?.controlTheCurrent;
        if (!buff) return;
        const p = snap.players[buff.playerIndex];
        if (!p) return;
        const stone = neighborStones(snap, p.x, p.y).find(s => s.type === 'water');
        if (!stone) return;
        const el = effectRankedElements(snap, p)
            .find(e => e !== 'water' && (snap.sourcePool[e] || 0) > 0);
        if (!el) return; // every non-water source pool empty — real modal has nothing clickable
        snap.sourcePool.water = Math.min(SOURCE_CAP, (snap.sourcePool.water || 0) + 1);
        snap.sourcePool[el]--;
        stone.type = el;
        touchStones(snap);
        applyFireInteractions(snap, stone);
    }

    // Breath of Power (WIND_SCROLL_2): this turn, the caster may move any
    // stone adjacent to them onto another adjacent empty hex — free,
    // repeatable (see the 'moveStone' action in legalActions()/simulate()).
    // Unlike Control the Current, the real effect has NO selectionMode or
    // modal at all — hasWindStoneMove() just re-enables the ordinary
    // drag-and-drop mousedown handler on every placed stone (game-core.js)
    // — so there is no BotEffects driver to mirror a deterministic pick
    // from; 'moveStone' is a genuine elective search action instead, scored
    // like any other. game-core.js's moveStoneTo() + BotState's own
    // 'moveStone' case are what let a real bot actually use this now (it
    // never has before — waitForQuiescence() had nothing to drive).
    function simEffectBreathOfPower(snap, p) {
        buffs(snap).breathOfPower = { playerIndex: p.index };
    }

    // moveStone (Breath of Power only): relocate a stone already on the
    // board to a different, currently-empty hex — reuses the exact same
    // fire/void interaction check placeStone gets, since arriving at a new
    // position is the only thing that matters to that check.
    function simMoveStone(snap, a) {
        const stone = stoneAt(snap, a.fromX, a.fromY);
        if (!stone) return;
        stone.x = +a.toX.toFixed(1);
        stone.y = +a.toY.toFixed(1);
        touchStones(snap);
        applyFireInteractions(snap, stone);
    }

    // ── Tranche 7 (cross-turn buffs — see crossTurn() above) ──────────

    // Freedom (WIND_SCROLL_5): until the caster's own next turn, they may
    // teleport free between any revealed elemental shrine centre, same as
    // standing on a catacomb tile. Only the buff itself is simulated here —
    // the TELEPORT action it enables was already a root-only gap before
    // Freedom existed (bot-sim's legalActions() has never modelled
    // 'teleport', even the catacomb-tile kind — see the file header), so
    // whitelisting the cast doesn't need new action-vocabulary support: it
    // just makes hasFreedomActive()'s real-game teleport gate (bot-state.js)
    // correctly reflect a Freedom cast from an EARLIER turn, same as
    // activeTurnBuffs()/crossTurnBuffs() already do for every other buff.
    function simEffectFreedom(snap, p) {
        crossTurn(snap).freedom = { playerIndex: p.index };
    }

    // Wandering River (WATER_SCROLL_4): mirrors driveWanderingRiver() —
    // picks the non-player tile closest to the caster (revealed or not;
    // eligibility never depends on the hidden element, only geometry, so
    // this never invents hidden info), then the best-ranked element with
    // NO availability filter (showElementSelectionModal's 5 buttons are
    // always clickable, unlike Control the Current's — see
    // effectRankedElements()[0] used unfiltered here). Real code never
    // dedupes on push (see getEffectiveTileElement's own comment at its
    // simEndTurn call site for why lookup order matters), so this doesn't
    // either — just appends.
    function simEffectWanderingRiver(snap, p, choice) {
        const eligible = snap.tiles.filter(t => !t.isPlayerTile);
        if (!eligible.length) return; // real flow bails before any selection
        const picked = choice ? eligible.find(t => Number(t.id) === Number(choice.tileId)) : null;
        const tile = picked || eligible.reduce((a, b) =>
            (!a || dist(p.x, p.y, b.x, b.y) < dist(p.x, p.y, a.x, a.y)) ? b : a, null);
        const el = (picked && ELEMENTS.includes(choice.element)) ? choice.element : effectRankedElements(snap, p)[0];
        const ct = crossTurn(snap);
        ct.wanderingRiver = ct.wanderingRiver || [];
        ct.wanderingRiver.push({ tileId: tile.id, newElement: el, playerIndex: p.index });
    }

    // Excavate (CATACOMB_SCROLL_4): the cast itself sets THREE real buffs
    // (excavate immunity, excavateNoResponse, excavateTeleport), but only
    // the teleport has any consumer in this simulator — immunity/no-response
    // gate which scrolls can TARGET a player, and nothing here models
    // opponent-targeting eligibility at all (same accepted gap as Quick
    // Reflexes' unmodelled "level-1 scrolls free" buff). Only the deferred
    // teleport (crossTurnBuffs.excavate) is tracked; resolveExcavateTeleport
    // below is what actually moves the pawn, called from simEndTurn() right
    // as the OWNER's own turn starts — mirrors processExcavateTeleport()
    // firing at that exact moment in the real game.
    function simEffectExcavate(snap, p) {
        crossTurn(snap).excavate = { playerIndex: p.index };
    }

    // Resolves Excavate's deferred teleport — mirrors
    // driveExcavateTeleportModal() (always accepts; teleporting is free
    // with no downside) + driveExcavateTeleport()'s candidate filter
    // (revealed non-player tile hex, no stone, no player) and destination
    // heuristic (home if all 5 activated, else nearest hidden tile — same
    // goal simEffectTakeFlight already uses) exactly. Called from
    // simEndTurn(), never from simCastEffect() — this isn't part of the
    // cast itself, it fires one full turn cycle later.
    function resolveExcavateTeleport(snap, playerIndex) {
        const p = snap.players[playerIndex];
        if (!p) return;
        const g = grid(snap);
        const candidates = g.filter(h => {
            if (!h.tileIds.some(id => {
                const t = snap.tiles.find(tt => tt.id === id);
                return t && t.revealed && !t.isPlayerTile;
            })) return false;
            if (stoneAt(snap, h.x, h.y)) return false;
            if (snap.players.some(pl => pl && dist(pl.x, pl.y, h.x, h.y) < HEX_NEAR)) return false;
            return true;
        });
        if (!candidates.length) return; // real flow: prompt just does nothing useful
        let goal = null;
        if (ELEMENTS.every(el => p.activated.includes(el))) {
            goal = snap.tiles.find(t => t.isPlayerTile && t.playerIndex === playerIndex);
        } else {
            const hidden = snap.tiles.filter(t => !t.revealed && !t.isPlayerTile);
            goal = hidden.length
                ? hidden.reduce((a, b) => (!a || dist(p.x, p.y, b.x, b.y) < dist(p.x, p.y, a.x, a.y)) ? b : a, null)
                : null;
        }
        const dest = goal
            ? candidates.reduce((a, b) => (!a || dist(goal.x, goal.y, b.x, b.y) < dist(goal.x, goal.y, a.x, a.y)) ? b : a, null)
            : candidates[0];
        p.x = dest.x; p.y = dest.y;
    }

    // Telekinesis (VOID_SCROLL_2): mirrors driveTelekinesis() exactly —
    // same eligibility as Shifting Sands (no stones, at most 1 player — see
    // tileStoneCount/tilePlayerIndices above; hidden tiles ARE eligible,
    // same as Shifting Sands), but relocates ONE tile freely instead of
    // swapping two. For each eligible tile (snap.tiles order, matching
    // the driver's own iteration order), tries each of its 6 large-hex
    // neighbor offsets in the driver's exact fixed order and takes the
    // FIRST empty one that would still touch 2+ OTHER tiles after the move
    // (excludeTileId semantics — the moving tile never counts as its own
    // neighbor) — stops at the first tile/destination pair that works,
    // same early-exit shape as the driver's nested loop. A lone occupant
    // travels with their tile (mirrors simEffectShiftingSands).
    const LARGE_HEX = TILE * 4; // matches game-core's largeHexSize (TILE_SIZE * 4)
    const TILE_ADJACENT_OFFSETS = [[1, 0], [0, 1], [-1, 1], [-1, 0], [0, -1], [1, -1]];
    function countTouchingTilesSim(snap, x, y, excludeTileId) {
        const hex = pixelToHex(x, y, LARGE_HEX);
        let count = 0;
        for (const [dq, dr] of TILE_ADJACENT_OFFSETS) {
            const p = hexToPixel(hex.q + dq, hex.r + dr, LARGE_HEX);
            if (snap.tiles.some(t => t.id !== excludeTileId && dist(t.x, t.y, p.x, p.y) < TILE)) count++;
        }
        return count;
    }
    // Where can tile t go by Telekinesis? Empty slots next to where it is
    // now (the driver's default) or next to `near` (a choice list), that
    // touch at least 2 other tiles.
    function telekinesisSlots(snap, t, near) {
        const out = [];
        const base = pixelToHex((near || t).x, (near || t).y, LARGE_HEX);
        for (const [dq, dr] of TILE_ADJACENT_OFFSETS) {
            const cand = hexToPixel(base.q + dq, base.r + dr, LARGE_HEX);
            if (snap.tiles.some(tt => tt.id !== t.id && dist(tt.x, tt.y, cand.x, cand.y) < TILE)) continue;
            if (dist(t.x, t.y, cand.x, cand.y) < TILE) continue; // not a move
            if (countTouchingTilesSim(snap, cand.x, cand.y, t.id) < 2) continue;
            out.push(cand);
        }
        return out;
    }
    const telekinesisEligible = snap => snap.tiles.filter(t =>
        !t.isPlayerTile && tileStoneCount(snap, t) === 0 && tilePlayerIndices(snap, t).length <= 1);

    function simEffectTelekinesis(snap, p, choice) {
        const eligible = telekinesisEligible(snap);
        let tile = null, dest = null;
        if (choice && choice.tileId != null) {
            const t = eligible.find(x => Number(x.id) === Number(choice.tileId));
            if (t && !snap.tiles.some(tt => tt.id !== t.id && dist(tt.x, tt.y, choice.x, choice.y) < TILE) &&
                countTouchingTilesSim(snap, choice.x, choice.y, t.id) >= 2) {
                tile = t; dest = { x: choice.x, y: choice.y };
            }
        }
        if (!dest) for (const t of eligible) {
            const hex = pixelToHex(t.x, t.y, LARGE_HEX);
            for (const [dq, dr] of TILE_ADJACENT_OFFSETS) {
                const cand = hexToPixel(hex.q + dq, hex.r + dr, LARGE_HEX);
                if (snap.tiles.some(tt => dist(tt.x, tt.y, cand.x, cand.y) < TILE)) continue; // occupied
                if (countTouchingTilesSim(snap, cand.x, cand.y, t.id) < 2) continue;
                tile = t; dest = cand; break;
            }
            if (dest) break;
        }
        if (!dest) return; // every eligible tile boxed in — real flow no-ops the same way

        const occupant = tilePlayerIndices(snap, tile)[0];
        tile.x = dest.x; tile.y = dest.y;
        if (occupant !== undefined) {
            snap.players[occupant].x = dest.x;
            snap.players[occupant].y = dest.y;
        }
    }

    // ── Tranche 8 (recursive effect dispatch) ──────────────────────────

    // Sacrificial Pyre (FIRE_SCROLL_3): mirrors enterScrollSacrificeMode()
    // + driveSacrificialPyre() exactly.
    //   1. Choose the WEAKEST eligible hand scroll (real eligibility:
    //      excludes response/counter-only scrolls — they have nothing to
    //      respond to on your own turn; pickWeakestButton: a response-only
    //      one first — impossible here, already excluded — else lowest
    //      level).
    //   2. Hand → common area (element-keyed replacement, same as any
    //      discardToCommonArea).
    //   3. Grant stones: level-based for an elemental scroll, summed by
    //      component element for a catacomb one — capped at POOL_CAP but,
    //      mirroring the real code's own gap, NEVER deducted from the
    //      source pool (no `(snap.sourcePool[el]||0) > 0` guard exists in
    //      enterScrollSacrificeMode's stone-granting block at all).
    //   4. Recursively run the sacrificed scroll's own effect
    //      (simCastEffect — mirrors `self.execute(selectedScroll,
    //      casterIndex, {})`). Its element does NOT activate win-condition
    //      (real code's own comment: "the sacrificed scroll's elements do
    //      NOT count toward win condition" — only FIRE, from casting
    //      Sacrificial Pyre ITSELF, activates, via simCast's normal
    //      post-effect block using a.scroll = 'FIRE_SCROLL_3', unaffected
    //      by this function). No extra AP cost, no unsimulatedCasts entry
    //      for the chained scroll either — grantedNew would always be
    //      false for it (nothing here ever touches p.activated), so
    //      tracking it would never change a search's evaluation anyway.
    function simEffectSacrificialPyre(snap, p) {
        const hand = p.hand || [];
        // Hand or active area, no Level I on your own turn, never Pyre itself
        // (owner rules, mirrors ScrollEffects.sacrificeCandidates)
        const eligible = [...hand, ...(p.active || [])].filter(name => {
            const d = window.SCROLL_DEFINITIONS?.[name];
            return d && d.level !== 1 && name !== 'FIRE_SCROLL_3';
        });
        if (!eligible.length) return; // real flow bails: nothing sacrificeable

        let chosen = eligible[0];
        let chosenLevel = window.SCROLL_DEFINITIONS?.[chosen]?.level ?? Infinity;
        for (const name of eligible) {
            const level = window.SCROLL_DEFINITIONS?.[name]?.level ?? Infinity;
            if (level < chosenLevel) { chosenLevel = level; chosen = name; }
        }
        const def = window.SCROLL_DEFINITIONS[chosen];

        const hi = p.hand.indexOf(chosen);
        if (hi !== -1) { p.hand.splice(hi, 1); p.handCount--; }
        const ai = (p.active || []).indexOf(chosen);
        if (ai !== -1) { p.active.splice(ai, 1); p.activeCount--; }
        if (!snap.commonArea) snap.commonArea = [];
        snap.commonArea = snap.commonArea.filter(name =>
            window.SCROLL_DEFINITIONS?.[name]?.element !== def.element);
        if (!snap.commonArea.includes(chosen)) snap.commonArea.push(chosen);

        // No stone grant any more (the old test rule was removed 2026-10-01):
        // only the sacrificed scroll's own effect runs.
        simCastEffect(snap, p, chosen);
    }

    // The scroll-name-keyed effect dispatch, factored out of simCast() so
    // Sacrificial Pyre (which runs a SACRIFICED scroll's own effect via the
    // real code's `self.execute(selectedScroll, casterIndex, {})`) can
    // recurse into it directly — mirrors that chained call exactly, without
    // simCast()'s AP cost, hand→active move, or win-condition activation
    // (all scroll-cast-specific, not effect-specific; the real chain skips
    // them too — see enterScrollSacrificeMode's own "does NOT count toward
    // win condition" comment).
    function simCastEffect(snap, p, scrollName, choice) {
        if (scrollName === 'FIRE_SCROLL_4') {
            // Transmute's execute() activates fire with NO source-pool gate
            // (deliberate belt-and-suspenders in scroll-effects.js) — the
            // real cast activates fire even when the fire source is empty.
            if (!p.activated.includes('fire')) p.activated.push('fire');
            simEffectTransmute(snap, p);
        } else if (scrollName === 'VOID_SCROLL_5') {
            simEffectCreate(snap, p, choice);
        } else if (scrollName === 'FIRE_SCROLL_5') {
            simEffectArson(snap, p, scrollName, choice);
        } else if (scrollName === 'WATER_SCROLL_2') {
            simEffectRefreshingThought(snap);
        } else if (scrollName === 'EARTH_SCROLL_3') {
            simEffectMasonsSavvy(snap, p);
        } else if (scrollName === 'EARTH_SCROLL_4') {
            simEffectHeavyStomp(snap, p, choice);
        } else if (scrollName === 'CATACOMB_SCROLL_10') {
            simEffectCombust(snap);
        } else if (scrollName === 'FIRE_SCROLL_2') {
            simEffectBurningMotivation(snap);
        } else if (scrollName === 'EARTH_SCROLL_5') {
            simEffectAvalanche(snap);
        } else if (scrollName === 'CATACOMB_SCROLL_6') {
            simEffectSeedTheSkies(snap, p);
        } else if (scrollName === 'WIND_SCROLL_3') {
            simEffectRespirate(snap, p);
        } else if (scrollName === 'VOID_SCROLL_3') {
            simEffectSimplify(snap);
        } else if (scrollName === 'CATACOMB_SCROLL_2') {
            simEffectMine(snap, p);
        } else if (scrollName === 'CATACOMB_SCROLL_5') {
            simEffectSteamVents(snap);
        } else if (scrollName === 'CATACOMB_SCROLL_1') {
            simEffectMudslide(snap);
        } else if (scrollName === 'CATACOMB_SCROLL_7') {
            simEffectReflectingPool(snap, p);
        } else if (scrollName === 'EARTH_SCROLL_2') {
            simEffectShiftingSands(snap, choice);
        } else if (scrollName === 'VOID_SCROLL_4') {
            simEffectScholarsInsight(snap, choice);
        } else if (scrollName === 'WATER_SCROLL_3') {
            simEffectInspiringDraught(snap, choice);
        } else if (scrollName === 'CATACOMB_SCROLL_3') {
            simEffectCallToAdventure(snap, p, choice);
        } else if (scrollName === 'CATACOMB_SCROLL_8') {
            simEffectPlunder(snap, p, scrollName, choice);
        } else if (scrollName === 'WIND_SCROLL_4') {
            simEffectTakeFlight(snap, p, choice);
        } else if (scrollName === 'CATACOMB_SCROLL_9') {
            simEffectQuickReflexes(snap, p, choice);
        } else if (scrollName === 'WATER_SCROLL_5') {
            simEffectControlTheCurrent(snap, p);
        } else if (scrollName === 'WIND_SCROLL_2') {
            simEffectBreathOfPower(snap, p);
        } else if (scrollName === 'WIND_SCROLL_5') {
            simEffectFreedom(snap, p);
        } else if (scrollName === 'WATER_SCROLL_4') {
            simEffectWanderingRiver(snap, p, choice);
        } else if (scrollName === 'FIRE_SCROLL_3') {
            simEffectSacrificialPyre(snap, p);
        } else if (scrollName === 'CATACOMB_SCROLL_4') {
            simEffectExcavate(snap, p);
        } else if (scrollName === 'VOID_SCROLL_2') {
            simEffectTelekinesis(snap, p, choice);
        }
    }

    function simCast(snap, a) {
        const ai = snap.turn.activePlayerIndex;
        const p = snap.players[ai];
        const def = window.SCROLL_DEFINITIONS?.[a.scroll];
        const activatedBefore = p.activated.length;
        // castCost() reads any Simplify buff already on the snapshot — a cast
        // of Simplify itself still costs the normal 2 AP (its own buff isn't
        // set until the effect branch below runs), only LATER casts this turn
        // get the discount.
        snap.turn.ap -= castCost(snap);

        // moveToActive if cast from hand; the scroll STAYS in active after the
        // cast (handleScrollDisposition: no auto-discard)
        if (p.hand) {
            const hi = p.hand.indexOf(a.scroll);
            if (hi !== -1) {
                p.hand.splice(hi, 1); p.handCount--;
                p.active.push(a.scroll); p.activeCount++;
            }
        }

        // The EFFECT runs before win-condition tracking — mirrors
        // applyScrollEffects' real order (execute() at game-core ~1564,
        // activation gate at ~1605 reading the POST-effect source pool).
        // Order matters when an effect drains its own element's source:
        // Mason's Savvy taking the last earth stones correctly forfeits
        // the earth activation. (Caught by the harness as a genuine
        // divergence when this block ran before the effect.)
        simCastEffect(snap, p, a.scroll, a.choice);

        // Win-condition activation (applyScrollEffects, AFTER the effect):
        //  - catacomb scrolls credit each component element, no source guard
        //  - otherwise credit only while the element's SOURCE pool has stones
        if (def) {
            if (def.element === 'catacomb' && def.patterns?.[0]) {
                for (const el of new Set(def.patterns[0].map(c => c.type))) {
                    if (!p.activated.includes(el)) p.activated.push(el);
                }
            } else if (ELEMENTS.includes(def.element)) {
                if ((snap.sourcePool[def.element] || 0) > 0 &&
                    !p.activated.includes(def.element)) {
                    p.activated.push(def.element);
                }
            }
        }

        // Whitelist-gated honesty about what we can't model. grantedNew lets
        // an evaluator credit the flat stand-in value ONLY for casts that
        // advanced the win condition — otherwise a search farms the flat
        // value by re-casting an already-won scroll forever (the same
        // infinite-recast loop Stage 1's castAlreadyWon weight fixed).
        if (!SIMULATED_SCROLLS.has(a.scroll)) {
            simNotes(snap).unsimulatedCasts.push({
                scroll: a.scroll,
                grantedNew: p.activated.length > activatedBefore,
            });
        }
    }

    function simDiscard(snap, a) {
        const p = activePlayer(snap);
        if (a.from === 'hand' && p.hand) {
            const i = p.hand.indexOf(a.scroll);
            if (i !== -1) { p.hand.splice(i, 1); p.handCount--; }
        } else {
            const i = p.active.indexOf(a.scroll);
            if (i !== -1) { p.active.splice(i, 1); p.activeCount--; }
        }
        // Discards land in the shared common area (castable by anyone) — one
        // slot PER ELEMENT, same as discardToCommonArea() in game-core.js: a
        // new scroll REPLACES any existing scroll of the same element (which
        // leaves the common area entirely, sent to the bottom of its deck),
        // it doesn't just accumulate. Without this, commonArea grows
        // unbounded in simulation and a discard can never actually be seen
        // to deny an opponent's threat (see commonAreaThreat() in bot.js) —
        // the old scroll would still show up as "present" right alongside
        // the new one.
        if (!snap.commonArea) snap.commonArea = [];
        if (!isUnknownScroll(a.scroll)) {
            const element = window.SCROLL_DEFINITIONS?.[a.scroll]?.element;
            if (element) {
                snap.commonArea = snap.commonArea.filter(name =>
                    window.SCROLL_DEFINITIONS?.[name]?.element !== element);
            }
            if (!snap.commonArea.includes(a.scroll)) snap.commonArea.push(a.scroll);
        }
    }

    // Break an adjacent stone (mirror of attemptBreakStone() in game-core.js):
    // costs AP by rank, the stone goes back to the SOURCE pool. The pawn must
    // be at rest (not standing on a stone). Not modelled: the full-board
    // recheckAllStoneInteractions() pass after the removal (breaking a void
    // can leave a fire unguarded; the real game re-checks those neighbours).
    const STONE_BREAK_COST = { void: 1, wind: 2, fire: 3, water: 4, earth: 5 };
    function simBreakStone(snap, a) {
        const p = activePlayer(snap);
        if (!p || stoneAt(snap, p.x, p.y)) return;
        const stone = stoneAt(snap, a.x, a.y);
        if (!stone) return;
        const d = dist(stone.x, stone.y, p.x, p.y);
        if (d <= HEX_NEAR || d >= HEX_STEP) return;
        const cost = STONE_BREAK_COST[stone.type];
        if (cost == null || snap.turn.ap < cost) return;
        snap.turn.ap -= cost;
        destroyStone(snap, stone);
    }

    // ----------------------------------------------------------------
    // Cast choices (combo plan Phase 2): for scrolls whose effect asks the
    // caster to choose, list the sensible choices as separate cast actions
    // ({type:'cast', scroll, choice}), so the search can compare them and
    // plan around them. bot-state.js uses the same list for the real game,
    // and bot-effects.js carries out the chosen one. Kept small on purpose.
    //   WATER_SCROLL_4 Wandering River: {tileId, element}
    //     - a face-down tile near the pawn, as an element the bot needs a
    //       scroll of (revealing it this turn draws that element's scroll);
    //     - the revealed shrine tile the pawn stands on, as an element it
    //       needs stones of (ending the turn there collects those).
    //   EARTH_SCROLL_4 Heavy Stomp, CATACOMB_SCROLL_3 Call to Adventure:
    //     {tileId}, a face-down eligible tile, River-changed tiles first.
    //   VOID_SCROLL_4 Scholar's Insight, WATER_SCROLL_3 Inspiring Draught:
    //     {element}, the deck to draw from (top 3 by scroll need).
    //   CATACOMB_SCROLL_9 Quick Reflexes: {element}, whose level-1 scroll
    //     (and 2 stones) to take (top 3 by stone need, still in the deck).
    //   VOID_SCROLL_5 Create: {element} (top 3 by stone need, room in pool).
    //   FIRE_SCROLL_5 Arson: {target, element} (3 biggest threats x their
    //     2 largest piles). CATACOMB_SCROLL_8 Plunder: {target, scroll}.
    //   WIND_SCROLL_4 Take Flight: {x, y} landing hex (shrine centres of
    //     occupied tiles, nearest to a face-down tile / home).
    //   EARTH_SCROLL_2 Shifting Sands: {a, b} tile ids (a plain tile near
    //     the pawn swapped with a face-down or needed-shrine tile further
    //     away). VOID_SCROLL_2 Telekinesis: {tileId, x, y} (such a tile moved
    //     into a free slot next to the pawn's tile).
    // ----------------------------------------------------------------
    function castChoices(snap, name) {
        const base = castChoicesBase(snap, name);
        // Harm choices aimed at the leader (bot.js harmChoices, 2026-09-28).
        let harm = [];
        try { harm = window.BotSystem?.harmChoices?.(snap, name) || []; } catch (e) {}
        return harm.length ? [...base, ...harm] : base;
    }
    function castChoicesBase(snap, name) {
        const p = activePlayer(snap);
        if (!p) return [];
        const near = (a, b) => dist(a.x, a.y, p.x, p.y) - dist(b.x, b.y, p.x, p.y);
        const nearPawn = near;
        if (name === 'WATER_SCROLL_4') {
            const out = [];
            const need = window.BotSystem?.scrollNeed?.(snap, snap.turn.activePlayerIndex);
            const wanted = need ? ELEMENTS.filter(e => need[e] > 0).sort((a, b) => need[b] - need[a]) : [];
            const hidden = snap.tiles.filter(t => !t.isPlayerTile && !t.revealed).sort(near).slice(0, 3);
            for (const t of hidden) for (const el of wanted.slice(0, 2)) out.push({ tileId: t.id, element: el });
            const under = snap.tiles.find(t => !t.isPlayerTile && t.revealed && dist(t.x, t.y, p.x, p.y) < 60);
            if (under) {
                for (const el of effectRankedElements(snap, p).slice(0, 2)) {
                    if (el !== under.shrineType) out.push({ tileId: under.id, element: el });
                }
            }
            return out;
        }
        if (name === 'VOID_SCROLL_4' || name === 'WATER_SCROLL_3') {
            // Scholar's Insight / Inspiring Draught: which deck to draw from.
            const need = window.BotSystem?.scrollNeed?.(snap, snap.turn.activePlayerIndex);
            if (!need) return [];
            return ELEMENTS.filter(e => need[e] > 0).sort((a, b) => need[b] - need[a])
                .slice(0, 3).map(element => ({ element }));
        }
        const meIdx = snap.turn.activePlayerIndex;
        // Opponents, biggest threat first (the drivers' default ordering).
        const threat = op => op.activated.length * 1000 + ELEMENTS.reduce((a, e) => a + (op.pool[e] || 0), 0);
        const opponents = snap.players.filter(op => op && op.index !== meIdx).sort((a, b) => threat(b) - threat(a));
        if (name === 'VOID_SCROLL_5') {
            // Create: which element's stones to draw (rank-many).
            return effectRankedElements(snap, p).filter(e => (p.pool[e] || 0) < POOL_CAP && (snap.sourcePool[e] || 0) > 0)
                .slice(0, 3).map(element => ({ element }));
        }
        if (name === 'FIRE_SCROLL_5') {
            // Arson: whose stone, and which type (their largest piles).
            const out = [];
            for (const op of opponents.slice(0, 3)) {
                ELEMENTS.filter(e => (op.pool[e] || 0) > 0)
                    .sort((a, b) => (op.pool[b] || 0) - (op.pool[a] || 0)).slice(0, 2)
                    .forEach(element => out.push({ target: op.index, element }));
            }
            return out;
        }
        if (name === 'CATACOMB_SCROLL_8') {
            // Plunder: whose active scroll goes to the common area.
            const out = [];
            for (const op of opponents) {
                for (const scroll of op.active || []) {
                    if (isUnknownScroll(scroll) || !window.SCROLL_DEFINITIONS?.[scroll]) continue;
                    out.push({ target: op.index, scroll });
                }
            }
            return out.slice(0, 6);
        }
        if (name === 'WIND_SCROLL_4') {
            // Take Flight: where to land. Per tile with another pawn on it,
            // the hex nearest its centre (a shrine to collect from), plus
            // the hex nearest a face-down tile (explore) or home.
            const cands = takeFlightCandidates(snap, p);
            if (!cands.length) return [];
            const picks = [];
            const add = h => { if (h && !picks.some(x => dist(x.x, x.y, h.x, h.y) < HEX_NEAR)) picks.push(h); };
            const nearestTo = pt => cands.reduce((a, b) => (!a || dist(pt.x, pt.y, b.x, b.y) < dist(pt.x, pt.y, a.x, a.y)) ? b : a, null);
            const tileIds = new Set(cands.flatMap(h => h.tileIds));
            for (const t of snap.tiles.filter(t => tileIds.has(t.id))) add(nearestTo(t));
            const home = snap.tiles.find(t => t.isPlayerTile && t.playerIndex === p.index);
            if (ELEMENTS.every(el => p.activated.includes(el)) && home) add(nearestTo(home));
            const hidden = snap.tiles.filter(t => !t.revealed && !t.isPlayerTile);
            if (hidden.length) {
                const h = hidden.reduce((a, b) => (!a || dist(p.x, p.y, b.x, b.y) < dist(p.x, p.y, a.x, a.y)) ? b : a, null);
                add(nearestTo(h));
            }
            return picks.slice(0, 4).map(h => ({ x: h.x, y: h.y }));
        }
        // Tiles worth bringing closer: face-down tiles (a scroll on reveal)
        // and revealed shrines of an element the bot needs stones of.
        const stoneNeed = effectRankedElements(snap, p).slice(0, 2);
        const pawnHex = grid(snap).find(h => dist(h.x, h.y, p.x, p.y) < HEX_NEAR);
        const pawnTile = pawnHex ? snap.tiles.find(t => pawnHex.tileIds.includes(t.id)) : null;
        const worth = t => !t.isPlayerTile && (!t.revealed || stoneNeed.includes(t.shrineType));
        if (name === 'EARTH_SCROLL_2') {
            // Shifting Sands: swap a tile next to the pawn with a far tile worth having close.
            const elig = snap.tiles.filter(t =>
                !t.isPlayerTile && tileStoneCount(snap, t) === 0 && tilePlayerIndices(snap, t).length <= 1);
            const near = elig.filter(t => t !== pawnTile && !worth(t)).sort(nearPawn).slice(0, 2);
            const far = elig.filter(t => worth(t) && t !== pawnTile && !near.includes(t))
                .sort((a, b) => nearPawn(b, a)).slice(0, 3);
            const out = [];
            for (const a of near) for (const b of far) out.push({ a: a.id, b: b.id });
            return out.slice(0, 6);
        }
        if (name === 'VOID_SCROLL_2') {
            // Telekinesis: move a far tile worth having into a free slot next to the pawn's tile.
            if (!pawnTile) return [];
            const out = [];
            const far = telekinesisEligible(snap).filter(t => worth(t) && t !== pawnTile)
                .sort((a, b) => nearPawn(b, a)).slice(0, 3);
            for (const t of far) {
                const slot = telekinesisSlots(snap, t, pawnTile).sort(nearPawn)[0];
                if (slot) out.push({ tileId: t.id, x: +slot.x.toFixed(1), y: +slot.y.toFixed(1) });
            }
            return out;
        }
        if (name === 'CATACOMB_SCROLL_9') {
            // Quick Reflexes: which element's level-1 scroll (+2 of its stones).
            if (!snap.level1Available) return [];
            return effectRankedElements(snap, p).filter(e => snap.level1Available[e])
                .slice(0, 3).map(element => ({ element }));
        }
        if (name === 'EARTH_SCROLL_4' || name === 'CATACOMB_SCROLL_3') {
            const river = new Set((snap.crossTurnBuffs?.wanderingRiver || []).map(e => Number(e.tileId)));
            return snap.tiles
                .filter(t => !t.isPlayerTile && !t.revealed && tileStoneCount(snap, t) === 0 && !tileHasPawns(snap, t))
                .sort((a, b) => (river.has(Number(b.id)) - river.has(Number(a.id))) || near(a, b))
                .slice(0, 3)
                .map(t => ({ tileId: t.id }));
        }
        return [];
    }

    function simulate(snap, action) {
        const next = clone(snap);
        switch (action?.type) {
            case 'move':          simMove(next, action); break;
            case 'teleport':      simTeleport(next, action); break;
            case 'endTurn':       simEndTurn(next); break;
            case 'placeStone':    simPlaceStone(next, action); break;
            case 'cast':          simCast(next, action); break;
            case 'moveStone':     simMoveStone(next, action); break;
            case 'breakStone':    simBreakStone(next, action); break;
            case 'discardScroll': simDiscard(next, action); break;
            default:
                simNotes(next).notes.push(`unsupported action type: ${action?.type}`);
        }
        // Control the Current (WATER_SCROLL_5): opportunistic, no "Done"
        // button — mirrors waitForQuiescence() re-running driveWaterTransform()
        // after EVERY bot action for the rest of the turn, not just at cast
        // time. endTurn already wiped turn.buffs above, so this is a no-op
        // then; harmless to call unconditionally otherwise.
        if (action?.type !== 'endTurn') attemptControlTheCurrentTransform(next);
        return next;
    }

    // ----------------------------------------------------------------
    // Terminal test — win = all 5 elements activated AND pawn on the
    // centre of the player's own tile (checkWinCondition in game-core.js)
    // ----------------------------------------------------------------
    function winner(snap) {
        for (const p of snap.players) {
            if (!p) continue;
            if (!ELEMENTS.every(el => p.activated.includes(el))) continue;
            const home = snap.tiles.find(t => t.isPlayerTile && t.playerIndex === p.index);
            if (home && dist(home.x, home.y, p.x, p.y) < HEX_NEAR) return p.index;
        }
        return null;
    }
    const isTerminal = snap => winner(snap) !== null;

    // ----------------------------------------------------------------
    // Pure legal-action enumeration — mirror of BotState.legalActions()
    // reading only the snapshot. Placement phase is NOT handled (the
    // snapshot doesn't carry it; search isn't used there).
    // ----------------------------------------------------------------
    function legalActions(snap) {
        const actions = [];
        const p = activePlayer(snap);
        if (!p) return actions;
        const ap = snap.turn.ap;
        const hand = p.hand || [];

        // Overflow gate: over-capacity hand/active ⇒ discard-only
        if (p.handCount > MAX_HAND || p.activeCount > MAX_ACTIVE) {
            if (p.handCount > MAX_HAND) for (const name of hand)
                actions.push({ type: 'discardScroll', scroll: name, from: 'hand' });
            if (p.activeCount > MAX_ACTIVE) for (const name of p.active)
                actions.push({ type: 'discardScroll', scroll: name, from: 'active' });
            return actions;
        }

        // Rule (mirrors isPlayerRestingOnStone in game-core.js): a hex with a
        // stone on it is transit-only — cast/placeStone/endTurn all require
        // being at rest, so none of them are legal until the pawn moves to
        // an empty hex. 'move' and 'discardScroll' are unaffected.
        const pawnOnStone = !!stoneAt(snap, p.x, p.y);

        // Casts (2 AP, pattern satisfied, never level-1 response scrolls) —
        // hand, active, and the shared common area (castable by anyone)
        if (!pawnOnStone && ap >= castCost(snap)) {
            for (const name of new Set([...p.active, ...hand, ...(snap.commonArea || [])])) {
                const def = window.SCROLL_DEFINITIONS?.[name];
                if (!def || def.level === 1) continue; // also skips UNKNOWN_SCROLL
                // Reflecting Pool: real once-per-turn guard (its own execute()
                // returns success:false on a recast) — keep the search from
                // "successfully" farming a second AP payout that never happens.
                if (name === 'CATACOMB_SCROLL_7' && snap.turn.buffs?.reflectingPool) continue;
                if (!checkPattern(snap, name)) continue;
                const choices = castChoices(snap, name);
                if (choices.length) for (const choice of choices) actions.push({ type: 'cast', scroll: name, choice });
                else actions.push({ type: 'cast', scroll: name });
            }
        }

        // Stone placements toward viable pattern variants (adjacent-only range).
        const g = grid(snap);
        const seen = new Set();
        // Level 1 (response) scrolls too, for an element still needed and
        // alive: a response activates its element (mirrors bot-state.js).
        const activeArea = p.active || [];
        const commonL1 = (snap.commonArea || []).filter(n => window.SCROLL_DEFINITIONS?.[n]?.level === 1);
        for (const name of pawnOnStone ? [] : new Set([...hand, ...activeArea, ...commonL1])) {
            const def = window.SCROLL_DEFINITIONS?.[name];
            if (!def || !Array.isArray(def.patterns)) continue;
            if (def.level === 1) {
                const guard = def.canCounter === 'any' && !!window.BotDiplomacy?.enabled?.() &&
                    window.BotDiplomacy.alertOn?.(snap.turn.activePlayerIndex, snap) != null;
                if (!guard && (!ELEMENTS.includes(def.element) || p.activated.includes(def.element) || (snap.sourcePool[def.element] || 0) <= 0)) continue;
            } else if (!hand.includes(name)) continue;
            for (const variant of def.patterns) {
                const cells = variant.map(req => {
                    const off = hexToPixel(req.q, req.r, TILE);
                    return { x: p.x + off.x, y: p.y + off.y, type: req.type };
                });
                if (!cells.every(c => g.some(h => dist(h.x, h.y, c.x, c.y) < HEX_NEAR))) continue;
                let placed = 0, blocked = false;
                const missing = [];
                for (const c of cells) {
                    const here = stoneAt(snap, c.x, c.y);
                    if (here && here.type === c.type) placed++;
                    else if (here) { blocked = true; break; }
                    else missing.push(c);
                }
                if (blocked) continue;
                for (const c of missing) {
                    if ((p.pool[c.type] || 0) <= 0) continue;
                    const d = dist(p.x, p.y, c.x, c.y);
                    if (d <= HEX_NEAR) continue; // never the pawn's own hex
                    // Avalanche (any type) / Seed the Skies (water & wind
                    // only) lift the adjacency requirement this turn.
                    const globalOk = snap.turn.buffs?.globalPlacement ||
                        (snap.turn.buffs?.waterWindGlobalPlacement && (c.type === 'water' || c.type === 'wind')) ||
                        (c.type === 'earth' && snap.turn.buffs?.earthRange &&
                            hexDistance(p.x, p.y, c.x, c.y, TILE) <= snap.turn.buffs.earthRange);
                    if (!globalOk && d >= HEX_STEP) continue; // base placement range: adjacent to pawn
                    // Not on any face-down tile, no pawn standing there
                    // (mirrors findValidStonePosition)
                    const hex = g.find(h => dist(h.x, h.y, c.x, c.y) < HEX_NEAR);
                    if (hex && hex.tileIds.some(id => {
                        const t = snap.tiles.find(tt => tt.id === id);
                        return t && !t.revealed && !t.isPlayerTile;
                    })) continue;
                    if (snap.players.some(pl => pl && dist(pl.x, pl.y, c.x, c.y) < HEX_NEAR)) continue;
                    const key = `${c.x.toFixed(1)},${c.y.toFixed(1)},${c.type}`;
                    if (seen.has(key)) continue;
                    seen.add(key);
                    actions.push({
                        type: 'placeStone', x: c.x, y: c.y, stoneType: c.type,
                        scroll: name, progress: (placed + 1) / cells.length,
                    });
                }
            }
        }

        // Stone clearing, so the lookahead can plan "open the way, then walk"
        // (bot-state.js enumerates the same options for the real root):
        //   * breakStone: any adjacent stone the AP covers.
        //   * tactical fire: an adjacent empty hex where the fire would burn
        //     at least one adjacent earth/water stone (no void next to it).
        //   * tactical void: an adjacent empty hex next to an earth or water
        //     stone (a voided earth becomes walkable, a voided water costs 1).
        // Kept to these narrow cases so the tree stays small.
        if (!pawnOnStone) {
            for (const s of neighborStones(snap, p.x, p.y)) {
                if (dist(s.x, s.y, p.x, p.y) >= HEX_STEP) continue;
                const cost = STONE_BREAK_COST[s.type];
                if (cost == null || cost > ap) continue;
                actions.push({ type: 'breakStone', x: s.x, y: s.y, stoneType: s.type, cost });
            }
            for (const h of g) {
                const d = dist(h.x, h.y, p.x, p.y);
                if (d <= HEX_NEAR || d >= HEX_STEP) continue;
                if (stoneAt(snap, h.x, h.y)) continue;
                if (snap.players.some(pl => pl && dist(pl.x, pl.y, h.x, h.y) < HEX_NEAR)) continue;
                if (h.tileIds.some(id => {
                    const t = snap.tiles.find(tt => tt.id === id);
                    return t && !t.revealed && !t.isPlayerTile;
                })) continue;
                const nbs = neighborStones(snap, h.x, h.y);
                const blockers = nbs.filter(s => s.type === 'earth' || s.type === 'water');
                if (!blockers.length) continue;
                for (const type of ['fire', 'void']) {
                    if ((p.pool[type] || 0) <= 0) continue;
                    if (type === 'fire' && nbs.some(s => s.type === 'void')) continue; // guarded: burns nothing
                    const key = `${h.x.toFixed(1)},${h.y.toFixed(1)},${type}`;
                    if (seen.has(key)) continue;
                    seen.add(key);
                    actions.push({
                        type: 'placeStone', x: h.x, y: h.y, stoneType: type,
                        scroll: null, progress: 0, tactical: true,
                    });
                }
            }
        }

        // Burning Motivation (FIRE_SCROLL_2): every placed stone pays +2 AP
        // per stack, so a spare stone is worth placing just for the AP.
        // One adjacent hex per held type (where it survives) keeps the tree
        // small; the evaluator weighs the stone against the AP.
        if (!pawnOnStone && (snap.turn.buffs?.burningMotivationStacks || 0) > 0) {
            for (const type of ELEMENTS) {
                if ((p.pool[type] || 0) <= 0) continue;
                const h = g.find(h => {
                    const d = dist(h.x, h.y, p.x, p.y);
                    if (d <= HEX_NEAR || d >= HEX_STEP) return false;
                    if (stoneAt(snap, h.x, h.y)) return false;
                    if (snap.players.some(pl => pl && dist(pl.x, pl.y, h.x, h.y) < HEX_NEAR)) return false;
                    if (h.tileIds.some(id => {
                        const t = snap.tiles.find(tt => tt.id === id);
                        return t && !t.revealed && !t.isPlayerTile;
                    })) return false;
                    return stoneWouldSurvive(snap, h.x, h.y, type);
                });
                if (!h) continue;
                const key = `${h.x.toFixed(1)},${h.y.toFixed(1)},${type}`;
                if (seen.has(key)) continue;
                seen.add(key);
                actions.push({ type: 'placeStone', x: h.x, y: h.y, stoneType: type, scroll: null, progress: 0, tactical: true });
            }
        }

        // Ranged tactical placements while a range buff is live (same
        // targets as the real move list: bot.js rangedTargets()), so the
        // search can plan "cast Avalanche, then burn / wall / pave far away".
        const rb = snap.turn.buffs || {};
        const rangedOk = t => rb.globalPlacement || (rb.waterWindGlobalPlacement && (t === 'water' || t === 'wind')) ||
            (t === 'earth' && rb.earthRange);
        if (!pawnOnStone && window.BotSystem?.rangedTargets && ELEMENTS.some(t => rangedOk(t) && (p.pool[t] || 0) > 0)) {
            for (const target of window.BotSystem.rangedTargets(snap)) {
                const h = g.find(gh => dist(gh.x, gh.y, target.x, target.y) < HEX_NEAR);
                if (!h || stoneAt(snap, h.x, h.y)) continue;
                if (snap.players.some(pl => pl && dist(pl.x, pl.y, h.x, h.y) < HEX_NEAR)) continue;
                if (h.tileIds.some(id => {
                    const t = snap.tiles.find(tt => tt.id === id);
                    return t && !t.revealed && !t.isPlayerTile;
                })) continue;
                if (h.tileIds.some(id => snap.tiles.find(tt => tt.id === id)?.isPlayerTile)) continue;
                for (const type of target.types) {
                    if (!rangedOk(type) || (p.pool[type] || 0) <= 0) continue;
                    if (type === 'earth' && !rb.globalPlacement && hexDistance(p.x, p.y, h.x, h.y, TILE) > rb.earthRange) continue;
                    const key = `${h.x.toFixed(1)},${h.y.toFixed(1)},${type}`;
                    if (seen.has(key)) continue;
                    seen.add(key);
                    actions.push({ type: 'placeStone', x: h.x, y: h.y, stoneType: type, scroll: null, progress: 0, tactical: true, ranged: true });
                }
            }
        }

        // Breath of Power (WIND_SCROLL_2): move a stone adjacent to the pawn
        // onto a DIFFERENT, currently-empty hex within the same placement
        // range placeStone uses (honors Avalanche/Seed the Skies too, same
        // as a real placement would through isInPlacementRange) — free,
        // repeatable, no AP gate. Not restricted by pawnOnStone (mirrors
        // 'move', not 'cast'/'placeStone' — see BotState.legalActions()).
        if (snap.turn.buffs?.breathOfPower?.playerIndex === snap.turn.activePlayerIndex) {
            for (const stone of neighborStones(snap, p.x, p.y)) {
                for (const h of g) {
                    if (dist(h.x, h.y, stone.x, stone.y) < HEX_NEAR) continue; // must actually move
                    const d = dist(h.x, h.y, p.x, p.y);
                    const globalOk = snap.turn.buffs?.globalPlacement ||
                        (snap.turn.buffs?.waterWindGlobalPlacement && (stone.type === 'water' || stone.type === 'wind'));
                    if (!globalOk && d >= HEX_STEP) continue;
                    if (h.tileIds.some(id => {
                        const t = snap.tiles.find(tt => tt.id === id);
                        return t && !t.revealed && !t.isPlayerTile;
                    })) continue;
                    if (stoneAt(snap, h.x, h.y)) continue;
                    if (snap.players.some(pl => pl && dist(pl.x, pl.y, h.x, h.y) < HEX_NEAR)) continue;
                    actions.push({
                        type: 'moveStone', fromX: stone.x, fromY: stone.y,
                        toX: h.x, toY: h.y, stoneType: stone.type,
                    });
                }
            }
        }

        // Moves
        if (ap > 0) {
            // Steam Vents: a banked free step can make an otherwise-unaffordable
            // move legal — filter on the EFFECTIVE cost, but still store the RAW
            // terrain cost on the action; simMove() re-derives paid-vs-free from
            // the banked state itself at simulation time (same input either way
            // within one ply).
            const svBanked = snap.turn.buffs?.steamVentsBanked;
            // Mirrors bot-state.js: a step onto a non-void stone only when the
            // AP left still reaches a hex the turn may end on.
            const restStone = (x, y) => { const s = stoneAt(snap, x, y); return s && s.type !== 'void'; };
            const nbrs = gridNeighbors(g);
            const canRestFrom = (from, apLeft, depth) => (nbrs.get(from) || []).some(n => {
                const mv = canMoveTo(snap, n.x, n.y);
                if (!mv.canMove || mv.cost > apLeft) return false;
                if (!restStone(n.x, n.y)) return true;
                return depth > 0 && canRestFrom(n, apLeft - mv.cost, depth - 1);
            });
            for (const h of g) {
                const d = dist(h.x, h.y, p.x, p.y);
                if (d <= HEX_NEAR || d >= HEX_STEP) continue;
                const mv = canMoveTo(snap, h.x, h.y);
                const effCost = (svBanked && mv.cost > 0) ? 0 : mv.cost;
                if (!mv.canMove || effCost > ap) continue;
                if (restStone(h.x, h.y) && !canRestFrom(h, ap - effCost, 3)) continue;
                actions.push({ type: 'move', x: h.x, y: h.y, cost: mv.cost });
            }
        }

        // Voluntary discards (cycle a slot to the common area)
        for (const name of hand) {
            if (isUnknownScroll(name)) continue;
            actions.push({ type: 'discardScroll', scroll: name, from: 'hand', voluntary: true });
        }
        for (const name of p.active) {
            if (isUnknownScroll(name)) continue;
            actions.push({ type: 'discardScroll', scroll: name, from: 'active', voluntary: true });
        }

        // Stranded exception (mirrors isPlayerStrandedOnStone in
        // game-core.js): resting on a stone with zero moves enumerated above
        // must still allow ending the turn, or the search sees a dead end
        // with no legal action at all.
        // Another player's tile (mirrors isPlayerOnOpponentTile in game-core.js):
        // crossing is fine, ending the turn there is not, unless stranded.
        const onOppTile = snap.tiles.some(t =>
            t.isPlayerTile && t.playerIndex !== null && t.playerIndex !== undefined &&
            t.playerIndex !== snap.turn.activePlayerIndex && dist(t.x, t.y, p.x, p.y) < TILE * 4);
        const strandedOnStone = (pawnOnStone || onOppTile) && !actions.some(act => act.type === 'move');
        if (!(pawnOnStone || onOppTile) || strandedOnStone) actions.push({ type: 'endTurn' });
        return actions;
    }

    // ----------------------------------------------------------------
    // Snapshot diff — the validation currency. Returns [{path, pred, real}].
    // Wildcards: shrineType 'unknown' matches anything; hands containing
    // UNKNOWN_SCROLL compare by count only.
    // ----------------------------------------------------------------
    function diffSnapshots(pred, real) {
        const diffs = [];
        const push = (path, a, b) => diffs.push({ path, pred: a, real: b });

        if (pred.turn.activePlayerIndex !== real.turn.activePlayerIndex)
            push('turn.activePlayerIndex', pred.turn.activePlayerIndex, real.turn.activePlayerIndex);
        if (pred.turn.ap !== real.turn.ap)
            push('turn.ap', pred.turn.ap, real.turn.ap);

        for (const el of ELEMENTS) {
            if ((pred.sourcePool[el] || 0) !== (real.sourcePool[el] || 0))
                push(`sourcePool.${el}`, pred.sourcePool[el], real.sourcePool[el]);
        }

        // Tiles: revealed flags + shrineType (with 'unknown' wildcard)
        for (const rt of real.tiles) {
            const pt = pred.tiles.find(t => t.id === rt.id);
            if (!pt) { push(`tiles[${rt.id}]`, 'missing', 'present'); continue; }
            if (pt.revealed !== rt.revealed) push(`tiles[${rt.id}].revealed`, pt.revealed, rt.revealed);
            else if (rt.revealed && pt.shrineType !== 'unknown' && pt.shrineType !== rt.shrineType)
                push(`tiles[${rt.id}].shrineType`, pt.shrineType, rt.shrineType);
        }

        // Stones: greedy multiset match with positional tolerance
        const unmatched = [...pred.stones];
        for (const rs of real.stones) {
            const i = unmatched.findIndex(ps => ps.type === rs.type && dist(ps.x, ps.y, rs.x, rs.y) < 2);
            if (i === -1) push(`stones(${rs.type}@${rs.x},${rs.y})`, 'absent', 'present');
            else unmatched.splice(i, 1);
        }
        for (const ps of unmatched) push(`stones(${ps.type}@${ps.x},${ps.y})`, 'present', 'absent');

        // Players
        real.players.forEach((rp, i) => {
            const pp = pred.players[i];
            if (!rp || !pp) { if (!!rp !== !!pp) push(`players[${i}]`, !!pp, !!rp); return; }
            if (dist(pp.x, pp.y, rp.x, rp.y) >= 2) push(`players[${i}].pos`, `${pp.x},${pp.y}`, `${rp.x},${rp.y}`);
            for (const el of ELEMENTS) {
                if ((pp.pool[el] || 0) !== (rp.pool[el] || 0))
                    push(`players[${i}].pool.${el}`, pp.pool[el], rp.pool[el]);
            }
            if (pp.handCount !== rp.handCount) push(`players[${i}].handCount`, pp.handCount, rp.handCount);
            if (pp.activeCount !== rp.activeCount) push(`players[${i}].activeCount`, pp.activeCount, rp.activeCount);
            const predActivated = [...pp.activated].sort().join(',');
            const realActivated = [...rp.activated].sort().join(',');
            if (predActivated !== realActivated) push(`players[${i}].activated`, predActivated, realActivated);
            // Hand identity (self only) — count-only when a draw was unknowable
            if (pp.hand && rp.hand && !pp.hand.some(isUnknownScroll)) {
                const ph = [...pp.hand].sort().join(','), rh = [...rp.hand].sort().join(',');
                if (ph !== rh) push(`players[${i}].hand`, ph, rh);
            }
        });

        return diffs;
    }

    // ----------------------------------------------------------------
    // Validation harness (roadmap Stage 2 step 3) — IMPURE, live game only.
    // Plays seeded random legal actions; before applying each for real it
    // predicts the outcome with simulate(), then diffs prediction vs the
    // real post-action snapshot. Casts of non-whitelisted scrolls count as
    // "accepted" divergences (the whitelist gate is the design, not a bug).
    //
    // Usage (browser console, in a running local/tutorial game):
    //   await BotSim.validate({ actions: 300, seed: 1 })
    // ----------------------------------------------------------------
    function mulberry32(seed) {
        let a = seed >>> 0;
        return function () {
            a |= 0; a = (a + 0x6D2B79F5) | 0;
            let t = Math.imul(a ^ (a >>> 15), 1 | a);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }
    const sleep = ms => new Promise(r => setTimeout(r, ms));

    // policy 'random' = uniform over legal actions (unbiased state coverage);
    // policy 'greedy' = the Stage-1 bot's ranked choice with ε-random mixed in
    // (reaches casts/placeStones that random walks almost never produce).
    async function validate({ actions = 300, seed = 1, delay = 60, maxPerTurn = 25,
                              policy = 'random', epsilon = 0.2 } = {}) {
        if (!window.BotState || !window.BotSystem) {
            throw new Error('BotSim.validate needs a live game with BotState/BotSystem loaded');
        }
        const rng = mulberry32(seed);
        const stats = {};   // per action type: {steps, diverged, accepted}
        const details = []; // first N divergence reports
        const bump = (type, key) => {
            stats[type] = stats[type] || { steps: 0, diverged: 0, accepted: 0 };
            stats[type][key]++;
        };

        let sinceTurnEnd = 0;
        for (let n = 0; n < actions; n++) {
            await window.BotSystem.waitForQuiescence();
            const before = window.BotState.snapshot();
            let legal = window.BotState.legalActions();
            if (!legal.length) { log('validate: no legal actions - stopping'); break; }
            if (legal[0].type === 'placeTile') { log('validate: placement phase - stopping'); break; }

            // Random play never ends a turn on its own often enough; force it
            // occasionally so endTurn (collection + AP reset) gets coverage.
            let pick;
            if (sinceTurnEnd >= maxPerTurn) {
                pick = legal.find(a => a.type === 'endTurn') || legal[Math.floor(rng() * legal.length)];
            } else if (policy === 'greedy' && rng() >= epsilon) {
                // Prefer casts, then the most pattern-completing placement —
                // greedy ranking alone wanders off before patterns finish, so
                // cast coverage would stay at zero without this.
                const casts = legal.filter(a => a.type === 'cast');
                const places = legal.filter(a => a.type === 'placeStone')
                    .sort((a, b) => (b.progress || 0) - (a.progress || 0));
                if (casts.length) pick = casts[0];
                else if (places.length && rng() < 0.7) pick = places[0];
                else {
                    const ranked = window.BotSystem.rank();
                    pick = ranked.length ? ranked[0].action : legal[Math.floor(rng() * legal.length)];
                }
            } else {
                pick = legal[Math.floor(rng() * legal.length)];
            }

            const predicted = simulate(before, pick);
            const res = window.BotState.applyAction(pick);
            if (!res.ok) {
                bump(pick.type, 'steps'); bump(pick.type, 'diverged');
                details.push({ n, action: pick, error: `applyAction failed: ${res.reason}` });
                continue;
            }
            sinceTurnEnd = pick.type === 'endTurn' ? 0 : sinceTurnEnd + 1;

            await window.BotSystem.waitForQuiescence();
            await sleep(delay);
            const after = window.BotState.snapshot();
            let diffs = diffSnapshots(predicted, after);

            // Catacomb reveal: revealTile() grants +1 AP, but a hidden tile's
            // element is unknowable by design — that specific ±1 AP diff is an
            // accepted (documented) divergence, not a model bug.
            const revealedCatacombs = after.tiles.filter(t => {
                const b = before.tiles.find(bt => bt.id === t.id);
                return b && !b.revealed && t.revealed && t.shrineType === 'catacomb';
            }).length;
            let acceptedReveal = false;
            if (revealedCatacombs > 0) {
                const apDiff = diffs.find(d => d.path === 'turn.ap' && d.real - d.pred === revealedCatacombs);
                if (apDiff) { diffs = diffs.filter(d => d !== apDiff); acceptedReveal = true; }
            }

            const accepted = (pick.type === 'cast' && !SIMULATED_SCROLLS.has(pick.scroll)) ||
                             (acceptedReveal && diffs.length === 0);
            bump(pick.type, 'steps');
            if (diffs.length) {
                bump(pick.type, accepted ? 'accepted' : 'diverged');
                if (details.length < 60) details.push({ n, action: pick, accepted, diffs });
            }
        }

        const report = { stats, details };
        log('validate report:', JSON.stringify(stats, null, 2));
        for (const [type, s] of Object.entries(stats)) {
            const pct = s.steps ? (100 * s.diverged / s.steps).toFixed(1) : '0';
            log(`  ${type}: ${s.diverged}/${s.steps} diverged (${pct}%)${s.accepted ? `, ${s.accepted} accepted (whitelist-gated casts)` : ''}`);
        }
        return report;
    }

    // ----------------------------------------------------------------
    // Public API
    // ----------------------------------------------------------------
    window.BotSim = {
        simulate, legalActions, isTerminal, winner,
        checkPattern, canMoveTo, grid, diffSnapshots, validate,
        stoneWouldSurvive, chainedAbility, waterChainResult, waterChainsToWind, isFreeStone,
        SIMULATED_SCROLLS, UNKNOWN_SCROLL, castChoices, takeFlightLandingFor, isUnknownScroll, unknownScrollElement,
    };
    log('Loaded - window.BotSim ready (simulate / legalActions / isTerminal / validate)');
})();
