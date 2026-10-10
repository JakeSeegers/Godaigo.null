// ============================================================
// bot-state.js — Stage 0 of docs/bot-roadmap.md
// ============================================================
// Observation + actuation layer for the bot. Contains NO strategy.
//   BotState.snapshot()      → pure-JSON game state (hidden info masked)
//   BotState.legalActions()  → canonical action list for the active player
//   BotState.applyAction(a)  → execute one action via the game's own functions
//   BotState.hexGrid()       → cached board hex positions
//   BotState.findPath(...)   → Dijkstra cheapest path between two hexes
//
// GOTCHA (see roadmap § KEY FACTS): game-core state (placedTiles,
// activePlayerIndex, getTotalAP, …) lives in the shared global LEXICAL scope,
// not on window — reference it as bare identifiers only.
//
// LOAD ORDER: after lobby.js, before bot.js.
// ============================================================

(function () {
    const ELEMENT_TYPES_L1 = ['earth', 'water', 'fire', 'wind', 'void'];
    'use strict';
    // English text of a button even when the player plays in Spanish (js/i18n.js).
    const srcText = el => (!el ? '' : window.I18n ? window.I18n.src(el) : el.textContent);

    const ELEMENTS = ['earth', 'water', 'fire', 'wind', 'void'];
    const HEX_NEAR = 5;   // px — "same hex" threshold (matches game-core usage)
    const HEX_STEP = 40;  // px — "adjacent hex" threshold

    function log(...args) { console.log('🧠 [BotState]', ...args); }

    // Turn-long scroll-effect buffs (Burning Motivation, Simplify, Avalanche,
    // …) the REAL game currently has active for the active player, translated
    // into bot-sim.js's snap.turn.buffs shape. Without this, a bot decision
    // taken on a FRESH snapshot after the buff-granting cast already
    // happened (a separate botAct()/searchPick() call, not a hypothetical
    // ply inside one search tree) would have no way to know the buff is
    // live — bot-sim.js's own simEndTurn()/clearTurnBuffs() parity guarantees
    // any buff still present here belongs to the CURRENTLY active player (any
    // OTHER player's buff was already wiped when their turn ended), but each
    // mapped buff still checks playerIndex, matching every real consumption
    // site (getSpellCost, replenishShrineStones, canPlayerMoveToHex, …).
    function activeTurnBuffs(activePlayerIndex) {
        const raw = window.spellSystem?.scrollEffects?.activeBuffs;
        if (!raw) return undefined;
        const mine = b => b && b.playerIndex === activePlayerIndex;
        const out = {};
        if (mine(raw.burningMotivation)) out.burningMotivationStacks = raw.burningMotivation.stacks || 1;
        if (mine(raw.globalPlacement)) out.globalPlacement = true;
        if (mine(raw.waterWindGlobalPlacement)) out.waterWindGlobalPlacement = true;
        // Mason's Savvy: earth stones within `range` hexes (bot-sim earthRange).
        if (mine(raw.earthExtendedPlacement)) out.earthRange = raw.earthExtendedPlacement.range || 5;
        if (mine(raw.respirateWind)) out.respirateWind = true;
        if (mine(raw.simplify)) out.simplify = true;
        if (mine(raw.mine)) out.mineShrineType = raw.mine.shrineType;
        if (mine(raw.steamVents)) out.steamVentsBanked = !!raw.steamVents.freeStepBanked;
        if (mine(raw.mudslide)) out.mudslide = true;
        if (mine(raw.reflectingPool)) out.reflectingPool = true;
        return Object.keys(out).length ? out : undefined;
    }

    // Cross-turn buffs (Freedom, Wandering River): unlike activeTurnBuffs()
    // above, these are NOT filtered to the active player's own — Wandering
    // River's tile override affects shrine collection/reveal for WHOEVER
    // stands there, not just its caster, and a multi-ply search needs to
    // see every player's still-active entry, not only whoever is about to
    // act right now. Never cleared by clearTurnBuffs(); only by
    // clearFreedomForPlayer()/clearWanderingRiverForPlayer() at that
    // buff's own OWNER's next turn start — see bot-sim.js's simEndTurn().
    function crossTurnBuffs() {
        const raw = window.spellSystem?.scrollEffects?.activeBuffs;
        if (!raw) return undefined;
        const out = {};
        if (raw.freedom) out.freedom = { playerIndex: raw.freedom.playerIndex };
        if (Array.isArray(raw.wanderingRiver) && raw.wanderingRiver.length) {
            out.wanderingRiver = raw.wanderingRiver.map(e => ({
                tileId: e.tileId, newElement: e.newElement, playerIndex: e.playerIndex,
            }));
        }
        // Excavate: only the real activeBuffs.excavateTeleport (the pending
        // deferred teleport) maps to bot-sim's crossTurnBuffs.excavate — the
        // separate activeBuffs.excavate (immunity) and excavateNoResponse
        // buffs have no consumer in bot-sim.js at all (see its own
        // "cross-turn buffs" header comment), so they're not seeded here.
        if (raw.excavateTeleport) out.excavate = { playerIndex: raw.excavateTeleport.playerIndex };
        return Object.keys(out).length ? out : undefined;
    }

    // Which elements' level-1 scroll (ELEMENT_SCROLL_1 — a deterministic
    // name, not hidden information) is still sitting in that element's
    // draw deck. Quick Reflexes (CATACOMB_SCROLL_9) searches exactly this
    // set — a level-1 scroll already drawn earlier by anyone isn't offered
    // — and without exposing it, a search has no way to tell "the
    // most-needed element" apart from "the most-needed element whose
    // level-1 is actually still findable," risking the WRONG element
    // getting simulated as picked (not just an unknown-card-identity gap).
    function level1DeckAvailability() {
        const decks = window.spellSystem?.scrollDecks;
        if (!decks) return undefined;
        const out = {};
        for (const el of ['earth', 'water', 'fire', 'wind', 'void']) {
            out[el] = !!decks[el]?.includes(`${el.toUpperCase()}_SCROLL_1`);
        }
        return out;
    }

    // ----------------------------------------------------------------
    // Snapshot — pure JSON, safe to serialize / diff / feed to a learner.
    // Hidden information is masked: unrevealed tiles report shrineType null,
    // and opponents' hands are reported as counts only.
    // ----------------------------------------------------------------
    // Tile memory: the element of every tile seen face-up this game, by
    // tile id. Public information (everyone saw it), so bots may use it.
    // A new game builds a new placedTiles array: the memory starts over.
    const seenTiles = new Map();
    let seenFor = null;
    function rememberTiles(tiles) {
        if (tiles !== seenFor) { seenTiles.clear(); seenFor = tiles; }
        for (const t of tiles) if (!t.flipped && !t.isPlayerTile && t.shrineType) seenTiles.set(t.id, t.shrineType);
        return tiles;
    }

    function snapshot() {
        const my = (typeof isMultiplayer !== 'undefined' && isMultiplayer &&
                    typeof myPlayerIndex !== 'undefined' && myPlayerIndex !== null)
                   ? myPlayerIndex : activePlayerIndex;

        const players = playerPositions.map((p, i) => {
            if (!p) return null;
            const scrolls = window.spellSystem?.playerScrolls?.[i];
            const isSelf  = (i === activePlayerIndex);
            return {
                index: i,
                x: +p.x.toFixed(1), y: +p.y.toFixed(1),
                color: p.color,
                pool: { ...(playerPools[i] || { earth:0, water:0, fire:0, wind:0, void:0 }) },
                hand:       isSelf && scrolls ? [...scrolls.hand]   : null, // opponents' hand SCROLLS hidden...
                handElements: scrolls          // ...but each hand scroll's ELEMENT is public (matches the
                    ? [...scrolls.hand].map(name => window.spellSystem.getScrollElement(name))
                    : [],                       // opponent panel — see game-ui.js updateOpponentPanel())
                handCount:  scrolls ? scrolls.hand.size   : 0,
                active:     scrolls ? [...scrolls.active] : [],             // active area is public
                activeCount: scrolls ? scrolls.active.size : 0,
                activated:  scrolls ? [...scrolls.activated] : [],
            };
        });

        return {
            version: 1,
            turn: {
                activePlayerIndex,
                myPlayerIndex: my,
                isMultiplayer: (typeof isMultiplayer !== 'undefined') ? !!isMultiplayer : false,
                ap: getTotalAP(),
                buffs: activeTurnBuffs(activePlayerIndex),
            },
            sourcePool: { ...window.stonePools },
            commonArea: window.spellSystem?.getCommonAreaScrolls?.() || [], // shared, public, castable by anyone
            tiles: rememberTiles(placedTiles).map(t => ({
                id: t.id,
                x: +t.x.toFixed(1), y: +t.y.toFixed(1),
                revealed: !t.flipped,
                isPlayerTile: !!t.isPlayerTile,
                playerIndex: t.isPlayerTile ? (t.playerIndex ?? null) : null, // public — whose shrine
                // MASKED when face-down — reading it would be cheating
                shrineType: t.flipped ? null : t.shrineType,
                // A face-down tile seen face-up earlier this game (owner,
                // 2026-09-29: a human remembers a shrine flipped back over).
                known: t.flipped && !t.isPlayerTile ? (seenTiles.get(t.id) ?? null) : null,
            })),
            stones: placedStones.map(s => ({ x: +s.x.toFixed(1), y: +s.y.toFixed(1), type: s.type })),
            players,
            level1Available: level1DeckAvailability(),
            crossTurnBuffs: crossTurnBuffs(),
        };
    }

    // ----------------------------------------------------------------
    // Hex grid + Dijkstra cheapest path (stone terrain changes step costs).
    // ----------------------------------------------------------------
    let _grid = null, _gridKey = '';
    // A step onto a non-void stone is only allowed when the AP left after it
    // still reaches a hex the turn may end on (owner 2026-10-10: a bot walked
    // onto an earth stone with its last AP, and the stranded rule then let it
    // end the turn there; a human's move can never end on such a stone).
    // Looks up to 3 more steps ahead (wind stones are free to cross).
    // Uses the path finder's cached neighbour lists and step costs, so it is
    // cheap enough to run for every move the bot considers.
    function stepStrands(h, apLeft) {
        const restStone = (x, y) => placedStones.some(s => s.type !== 'void' && Math.hypot(s.x - x, s.y - y) < HEX_NEAR);
        if (!restStone(h.x, h.y)) return false;
        const start = nearestHex(h.x, h.y);
        if (!start) return false;
        const key = moveStateKey();
        if (key !== _pathKey) { _pathKey = key; _costs = new Map(); _trees = new Map(); }
        const adj = adjacency();
        const canRestFrom = (from, left, depth) => (adj.get(from.key) || []).some(n => {
            const mv = stepCost(n);
            if (!mv.canMove || mv.cost > left) return false;
            if (!restStone(n.x, n.y)) return true;
            return depth > 0 && canRestFrom(n, left - mv.cost, depth - 1);
        });
        return !canRestFrom(start, apLeft, 3);
    }

    function hexGrid() {
        // getAllHexagonPositions() is moderately expensive — cache it, but
        // invalidate on BOARD CHANGE, never on time. A time-based cache
        // (formerly 1.5s) served pre-reveal grids to every caller right
        // after a tile flip; at bot/arena speed whole games fit inside one
        // stale window and the bot "froze" on hexes that no longer matched
        // the board. Key covers: tile count, reveal count, and positions
        // (tiles can move via Telekinesis / Shifting Sands).
        let key = placedTiles.length + ':';
        let revealed = 0, posHash = 0;
        for (const t of placedTiles) {
            if (!t.flipped) revealed++;
            posHash = (posHash + Math.round(t.x * 10) * 31 + Math.round(t.y * 10)) | 0;
        }
        key += revealed + ':' + posHash;
        if (!_grid || key !== _gridKey) { _grid = getAllHexagonPositions(); _gridKey = key; }
        return _grid;
    }

    function nearestHex(x, y) {
        let best = null, bd = Infinity;
        for (const h of hexGrid()) {
            const d = Math.hypot(h.x - x, h.y - y);
            if (d < bd) { bd = d; best = h; }
        }
        return bd < HEX_NEAR ? best : null;
    }

    // Neighbour lists for the current grid (rebuilt when hexGrid() changes).
    let _adj = null, _adjKey = null;
    function adjacency() {
        const grid = hexGrid();
        if (_adj && _adjKey === _gridKey) return _adj;
        _adj = new Map();
        for (const h of grid) {
            const list = [];
            for (const nb of grid) {
                const d = Math.hypot(nb.x - h.x, nb.y - h.y);
                if (d > HEX_NEAR && d < HEX_STEP) list.push(nb); // grid order kept
            }
            _adj.set(h.key, list);
        }
        _adjKey = _gridKey;
        return _adj;
    }

    // Everything canPlayerMoveToHex() reads: grid, whose turn, Mudslide,
    // stones (place + type) and pawns. While this is unchanged, step costs
    // and the path trees below stay valid.
    function moveStateKey() {
        const mud = spellSystem?.scrollEffects?.activeBuffs?.mudslide;
        let k = _gridKey + '|' + activePlayerIndex + '|' + (mud ? mud.playerIndex : '-') + '|';
        for (const st of placedStones) k += Math.round(st.x) + ',' + Math.round(st.y) + st.type[0] + ';';
        k += '|';
        if (Array.isArray(playerPositions))
            for (const p of playerPositions) k += p ? Math.round(p.x) + ',' + Math.round(p.y) + ';' : '_;';
        return k;
    }

    // Caches for findPath: step cost per hex, and one full Dijkstra tree per
    // start hex. Bots ask for many paths from the same spot per decision
    // (every tile, shrine and goal), and each used to rescan the whole grid
    // for neighbours and re-run canPlayerMoveToHex on every step. That was
    // the biggest part of a bot's think time (host lag in bot games).
    let _pathKey = null, _costs = new Map(), _trees = new Map();
    function stepCost(h) {
        let c = _costs.get(h.key);
        if (!c) {
            const mv = canPlayerMoveToHex(h.x, h.y, false);
            c = { canMove: mv.canMove, cost: mv.cost ?? 1 };
            _costs.set(h.key, c);
        }
        return c;
    }
    function pathTree(start) {
        let tree = _trees.get(start.key);
        if (tree) return tree;
        const adj = adjacency();
        const dist = { [start.key]: 0 };
        const prev = {};
        const done = new Set();
        // board is small (a few hundred hexes at most): array scan beats a heap here
        const frontier = [start];
        while (frontier.length) {
            let bi = 0;
            for (let i = 1; i < frontier.length; i++)
                if (dist[frontier[i].key] < dist[frontier[bi].key]) bi = i;
            const cur = frontier.splice(bi, 1)[0];
            if (done.has(cur.key)) continue;
            done.add(cur.key);
            for (const nb of adj.get(cur.key) || []) {
                if (done.has(nb.key)) continue;
                const mv = stepCost(nb);
                if (!mv.canMove) continue;
                const nd = dist[cur.key] + mv.cost;
                if (nd < (dist[nb.key] ?? Infinity)) {
                    dist[nb.key] = nd;
                    prev[nb.key] = cur;
                    frontier.push(nb);
                }
            }
        }
        tree = { dist, prev };
        if (_trees.size > 64) _trees.clear();
        _trees.set(start.key, tree);
        return tree;
    }

    // Dijkstra from (sx,sy) to (tx,ty). Step cost = canPlayerMoveToHex(dest).cost.
    // Returns [{x, y, cost}] (excluding start) or null when unreachable.
    // Same paths as the old per-call search (same visit order), just cached.
    function findPath(sx, sy, tx, ty) {
        const start = nearestHex(sx, sy), end = nearestHex(tx, ty);
        if (!start || !end) return null;
        if (start.key === end.key) return [];

        const key = moveStateKey();
        if (key !== _pathKey) { _pathKey = key; _costs = new Map(); _trees = new Map(); }
        const { dist, prev } = pathTree(start);

        if (!(end.key in dist)) return null;
        const path = [];
        let cur = end;
        while (cur.key !== start.key) {
            path.unshift({ x: cur.x, y: cur.y, cost: stepCost(cur).cost });
            cur = prev[cur.key];
        }
        return path;
    }

    // ----------------------------------------------------------------
    // Legal action enumeration for the ACTIVE player.
    // Canonical forms — the only vocabulary bot strategy may use:
    //   {type:'placeTile', x, y, distToCentroid}                    // placement phase only
    //   {type:'cast', scroll, choice?}  // choice: {tileId, element} River / {tileId} Stomp, Call to Adventure /
    //                                   // {element} Scholar's Insight, Inspiring Draught, Quick Reflexes, Create /
    //                                   // {target, element} Arson / {target, scroll} Plunder / {x, y} Take Flight /
    //                                   // {a, b} Shifting Sands / {tileId, x, y} Telekinesis (BotSim.castChoices)
    //   {type:'placeStone', x, y, stoneType, scroll, progress}
    //   {type:'move', x, y, cost}
    //   {type:'breakStone', stoneId, x, y, stoneType, cost}
    //   {type:'discardScroll', scroll, from:'hand'|'active'}
    //   {type:'endTurn'}
    //   {type:'teleport', x, y, shrineType}   // catacomb/Freedom shrine hop, free (0 AP)
    // NOT yet enumerated (Stage 2+): scroll-effect sub-choices (those go
    // through BotEffects, a separate driver — see bot-effects.js).
    // breakStone is mirrored in bot-sim.js (simulate + legalActions), so
    // search can plan "break, then walk". teleport is not: bot-sim.js's
    // simulate() knows how to APPLY one (so search correctly values
    // teleporting as the immediate/root decision, since the root's own
    // candidate list always comes from THIS function, not the pure
    // mirror), but bot-sim.js's legalActions() doesn't yet GENERATE
    // teleport candidates for deeper simulated plies — partly because the
    // Freedom-buff state that gates elemental-shrine hops isn't carried in
    // the snapshot schema at all yet. A multi-step plan that hops through a
    // catacomb mid-sequence won't be discovered by lookahead; a bot
    // deciding whether to teleport RIGHT NOW is unaffected.
    // ----------------------------------------------------------------

    // Same rank→AP-cost table `attemptBreakStone()` uses in game-core.js
    // (duplicated there in several closures too — it's a fixed small game
    // constant, not logic worth threading through as a dependency).
    const STONE_BREAK_COST = { void: 1, wind: 2, fire: 3, water: 4, earth: 5 };
    // Scrolls whose cast carries a choice ({type:'cast', scroll, choice}).
    const CHOICE_SCROLLS = new Set(['WATER_SCROLL_4', 'EARTH_SCROLL_4', 'CATACOMB_SCROLL_3',
        'VOID_SCROLL_4', 'WATER_SCROLL_3', 'CATACOMB_SCROLL_9',
        'VOID_SCROLL_5', 'FIRE_SCROLL_5', 'CATACOMB_SCROLL_8', 'WIND_SCROLL_4', 'EARTH_SCROLL_2', 'VOID_SCROLL_2']);

    // Free hexes adjacent to the existing placed-tile cluster, on the LARGE
    // player-tile hex grid (TILE_SIZE * 4) — distinct from hexGrid()'s small
    // board grid used for in-turn movement. Player tiles have no pawn/AP yet,
    // so this is enumerated separately from the mid-turn actions below.
    function placementCandidates() {
        const S = TILE_SIZE * 4;
        if (!placedTiles.length) return [];
        const cx = placedTiles.reduce((s, t) => s + t.x, 0) / placedTiles.length;
        const cy = placedTiles.reduce((s, t) => s + t.y, 0) / placedTiles.length;
        const candidates = [];
        for (const t of placedTiles) {
            const h = pixelToHex(t.x, t.y, S);
            for (const [dq, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, -1], [-1, 1]]) {
                const p = hexToPixel(h.q + dq, h.r + dr, S);
                if (placedTiles.some(o => Math.hypot(o.x - p.x, o.y - p.y) < 40)) continue; // occupied
                if (candidates.some(c => Math.hypot(c.x - p.x, c.y - p.y) < 40)) continue;  // dupe
                // Same rule the drag-drop path enforces: a player tile must
                // touch at least 2 unrevealed tiles at placement time
                if (typeof countTouchingUnrevealedTiles === 'function' &&
                    countTouchingUnrevealedTiles(p.x, p.y) < 2) continue;
                candidates.push({ x: p.x, y: p.y, distToCentroid: Math.hypot(p.x - cx, p.y - cy) });
            }
        }
        return candidates;
    }

    function legalActions() {
        // ── placement phase: this player hasn't placed their tile yet ──
        // isPlacementPhase is only ever set true by the real multiplayer
        // lobby flow (startMultiplayerGame() in lobby.js) — the local
        // single-page startGame() never touches it, and BotArena's own
        // placePlayerTilesSpread() bypasses it entirely, so it happens to
        // work there anyway. Tutorial Mode has NEITHER: its own scripted
        // "place tile" step never sets the flag either. Without the
        // fallback below, a bot driven from the console right after
        // clicking "Play Tutorial" gets isPlacementPhase===undefined,
        // playerPositions[activePlayerIndex]===undefined, and returns []
        // forever — legalActions() never enumerates a placeTile action, so
        // the bot does nothing from turn zero (observed: "No legal actions
        // found" logged on every step). The fallback triggers off the
        // actual observable state (no pawn placed yet) instead of the flag.
        const needsPlacement = (typeof isPlacementPhase !== 'undefined' && isPlacementPhase)
            ? (typeof playerTilesPlaced !== 'undefined' && !playerTilesPlaced.has(activePlayerIndex))
            : !playerPositions[activePlayerIndex];
        if (needsPlacement) {
            return placementCandidates().map(c => ({ type: 'placeTile', x: c.x, y: c.y, distToCentroid: c.distToCentroid }));
        }

        const actions = [];
        const player = playerPositions[activePlayerIndex];
        if (!player) return actions;
        const ap = getTotalAP();
        const pool = playerPools[activePlayerIndex] || {};
        const scrolls = window.spellSystem?.getPlayerScrolls?.(false);

        // ── overflow gate: hand/active over capacity blocks everything else ──
        // The end-of-turn overflow modal only resolves through discards; if we
        // let cast/move/endTurn stay legal here the caller could act (or end
        // the turn) while still over capacity, which either wedges the UI
        // modal or clicks End Turn into a no-op. Discard-only until resolved.
        if (scrolls) {
            const maxHand = window.spellSystem.MAX_HAND_SIZE;
            const maxActive = window.spellSystem.MAX_ACTIVE_SIZE;
            const handOver = scrolls.hand.size > maxHand;
            const activeOver = scrolls.active.size > maxActive;
            if (handOver || activeOver) {
                if (handOver) for (const name of scrolls.hand) {
                    actions.push({ type: 'discardScroll', scroll: name, from: 'hand' });
                }
                if (activeOver) for (const name of scrolls.active) {
                    actions.push({ type: 'discardScroll', scroll: name, from: 'active' });
                }
                return actions;
            }
        }

        // ── resting-on-stone gate: a hex with a stone on it is transit-only
        // (see isPlayerRestingOnStone in game-core.js) — cast/placeStone/
        // breakStone/endTurn all require being at rest, so none of them get
        // enumerated until the pawn moves to an empty hex. 'move' and
        // 'discardScroll' (position-independent) are unaffected.
        const onStone = typeof isPlayerRestingOnStone === 'function' && isPlayerRestingOnStone(activePlayerIndex);

        // ── cast: any hand/active/COMMON-AREA scroll whose pattern is
        // satisfied now. Common-area scrolls are shared and castable by
        // anyone (castSpell scans them natively); without them a bot whose
        // hand jams up with already-won scrolls can never progress again.
        // Casting costs 2 AP (activateScroll validates it — don't offer casts
        // the game will reject).
        if (!onStone && scrolls && ap >= 2) {
            const common = window.spellSystem.getCommonAreaScrolls?.() || [];
            for (const name of new Set([...scrolls.active, ...scrolls.hand, ...common])) {
                const def = window.SCROLL_DEFINITIONS?.[name];
                if (!def || def.level === 1) continue; // level 1 = response-only
                if (window.spellSystem.checkPattern(name)) {
                    // Scrolls with a choice inside (Wandering River, Heavy
                    // Stomp) become one cast per sensible choice, from the
                    // same list the simulator uses (BotSim.castChoices).
                    const choices = CHOICE_SCROLLS.has(name) && window.BotSim?.castChoices
                        ? window.BotSim.castChoices(snapshot(), name) : [];
                    if (choices.length) for (const choice of choices) actions.push({ type: 'cast', scroll: name, choice });
                    else actions.push({ type: 'cast', scroll: name });
                }
            }
        }

        // ── placeStone: every missing stone of every VIABLE pattern variant ──
        // A variant is viable when each of its cells is on the board and either
        // empty or already holding the right-type stone.
        if (!onStone && scrolls) {
            const pHex = pixelToHex(player.x, player.y, TILE_SIZE);
            const grid = hexGrid();
            const seen = new Set(); // dedupe identical placements across scrolls
            // Level 1 scrolls are cast only as a response to someone else's
            // cast, and a response DOES activate its element (multiplayer-
            // state.js scroll-resolved). Their 2-stone pattern is built too
            // when the bot still needs that element (owner 2026-09-27: bots
            // stalled holding only a level 1 for a missing element).
            const myActivated = [...(scrolls.activated || [])];
            // Guard mode (bot.js): counters too, even of a won element.
            const guard = !!window.BotSystem?.guardWanted?.();
            const neededL1 = (def) => def.level === 1 && ELEMENT_TYPES_L1.includes(def.element)
                && ((guard && def.canCounter === 'any') ||
                    (!myActivated.includes(def.element) && ((window.stonePools?.[def.element] ?? 0) > 0)));
            const handNames = [...scrolls.hand];
            // A response can also be cast from the common area
            // (response-window.js canPlayerRespond), so a needed level 1
            // lying there counts too.
            const commonL1 = (window.spellSystem.getCommonAreaScrolls?.() || [])
                .filter(n => window.SCROLL_DEFINITIONS?.[n]?.level === 1);
            for (const name of new Set([...handNames, ...scrolls.active, ...commonL1])) {
                const def = window.SCROLL_DEFINITIONS?.[name];
                if (!def || !Array.isArray(def.patterns)) continue;
                if (def.level === 1 && !neededL1(def)) continue;
                if (def.level !== 1 && !handNames.includes(name)) continue; // unchanged: hand only for the rest
                for (const variant of def.patterns) {
                    const cells = variant.map(req => {
                        const px = hexToPixel(pHex.q + req.q, pHex.r + req.r, TILE_SIZE);
                        return { x: px.x, y: px.y, type: req.type };
                    });
                    if (!cells.every(c => grid.some(h => Math.hypot(h.x - c.x, h.y - c.y) < HEX_NEAR))) continue;

                    let placed = 0, blocked = false;
                    const missing = [];
                    for (const c of cells) {
                        const here = placedStones.find(s => Math.hypot(s.x - c.x, s.y - c.y) < HEX_NEAR);
                        if (here && here.type === c.type) placed++;
                        else if (here) { blocked = true; break; } // wrong stone occupies the cell
                        else missing.push(c);
                    }
                    if (blocked) continue;
                    for (const c of missing) {
                        if ((pool[c.type] || 0) <= 0) continue;
                        // Mirror the FULL validity the drag-drop path enforces
                        // (findValidStonePosition): in range, not on any
                        // face-down tile, no pawn standing there. applyAction
                        // re-checks these; enumerating illegal cells would
                        // desync other clients.
                        if (typeof isInPlacementRange === 'function' &&
                            !isInPlacementRange(c.x, c.y, c.type)) continue;
                        if (typeof isPositionOnFlippedTile === 'function' &&
                            isPositionOnFlippedTile(c.x, c.y, grid)) continue;
                        if (playerPositions.some(p => p && Math.hypot(p.x - c.x, p.y - c.y) < HEX_NEAR)) continue;
                        const key = `${c.x.toFixed(1)},${c.y.toFixed(1)},${c.type}`;
                        if (seen.has(key)) continue;
                        seen.add(key);
                        actions.push({
                            type: 'placeStone', x: c.x, y: c.y, stoneType: c.type,
                            scroll: name,
                            progress: (placed + 1) / cells.length,
                        });
                    }
                }
            }

            // ── tactical placeStone (Stage 4): non-pattern placements ──
            // A human can drag ANY held stone onto ANY valid in-range hex —
            // the pattern-cell enumeration above is a pragmatic narrowing of
            // the candidate space, not a game rule. Terrain-control tactics
            // (earth walls off an opponent's path, wind paves the bot's own
            // route with free movement, fire burns a stone an opponent's
            // satisfied pattern needs) require exactly the placements that
            // narrowing excludes, so enumerate them too — but only for the
            // three types bot.js has a tactical scoring term for, and only
            // on hexes ADJACENT to the pawn (the default placement range;
            // range buffs like Avalanche / Mason's Savvy are deliberately
            // not exploited here to keep the candidate count bounded).
            // scroll:null + tactical:true mark them — bot.js scores these
            // purely on tactical value (placeTacticalBase is slightly
            // negative, so absent a live tactical term they are never
            // taken). bot-sim.js's own legalActions() mirrors only the
            // stone-clearing ones (fire/void next to earth or water), so
            // lookahead can plan "clear, then walk" but not walls or paving.
            // Void joins them only next to an earth/water stone: voiding an
            // earth wall makes it walkable (bot.js unblockBonus scores that).
            // While Burning Motivation is active every placed stone pays AP,
            // so every held type (water too) is offered anywhere adjacent.
            const burning = (activeTurnBuffs(activePlayerIndex)?.burningMotivationStacks || 0) > 0;
            // Water joins too, but (outside Burning Motivation) only where it
            // would chain: next to wind it copies free movement (a cheap road),
            // next to earth it becomes a wall (a cheap block). Much cheaper
            // than wind or earth (owner, 2026-09-27). bot.js scores it.
            const tacticalTypes = ['earth', 'wind', 'fire', 'void', 'water'];
            const chainSnap = { stones: placedStones.map(s => ({ x: s.x, y: s.y, type: s.type })) };
            for (const stoneType of tacticalTypes) {
                if ((pool[stoneType] || 0) <= 0) continue;
                for (const h of grid) {
                    const d = Math.hypot(h.x - player.x, h.y - player.y);
                    if (d <= HEX_NEAR || d >= HEX_STEP) continue;
                    if (stoneType === 'water' && !burning &&
                        !window.BotSim?.waterChainResult?.(chainSnap, h.x, h.y)) continue;
                    if (stoneType === 'void' && !burning && !placedStones.some(s =>
                        (s.type === 'earth' || s.type === 'water') &&
                        Math.hypot(s.x - h.x, s.y - h.y) > HEX_NEAR &&
                        Math.hypot(s.x - h.x, s.y - h.y) < 50)) continue;
                    const key = `${h.x.toFixed(1)},${h.y.toFixed(1)},${stoneType}`;
                    if (seen.has(key)) continue;
                    if (placedStones.some(s => Math.hypot(s.x - h.x, s.y - h.y) < HEX_NEAR)) continue;
                    if (playerPositions.some(p => p && Math.hypot(p.x - h.x, p.y - h.y) < HEX_NEAR)) continue;
                    // Same validity chain the pattern candidates above use
                    if (typeof isInPlacementRange === 'function' &&
                        !isInPlacementRange(h.x, h.y, stoneType)) continue;
                    if (typeof isPositionOnFlippedTile === 'function' &&
                        isPositionOnFlippedTile(h.x, h.y, grid)) continue;
                    seen.add(key);
                    actions.push({
                        type: 'placeStone', x: h.x, y: h.y, stoneType,
                        scroll: null, progress: 0, tactical: true,
                    });
                }
            }

            // ── ranged tactical placeStone: while a range buff is live
            // (Avalanche any type, Seed the Skies water/wind, Mason's Savvy
            // earth within 5), the same tactical uses reach the whole board.
            // Targets come from bot.js rangedTargets() (opponent paths, own
            // route, threat stones, walls, shrines opponents head for);
            // isInPlacementRange() is the real range check for each type.
            const tb = activeTurnBuffs(activePlayerIndex) || {};
            const rangedOk = t => tb.globalPlacement || (tb.waterWindGlobalPlacement && (t === 'water' || t === 'wind')) ||
                (t === 'earth' && tb.earthRange);
            if (window.BotSystem?.rangedTargets && ['earth', 'water', 'fire', 'wind', 'void'].some(t => rangedOk(t) && (pool[t] || 0) > 0)) {
                for (const target of window.BotSystem.rangedTargets(snapshot())) {
                    const h = grid.find(g => Math.hypot(g.x - target.x, g.y - target.y) < HEX_NEAR);
                    if (!h) continue;
                    if (placedStones.some(s => Math.hypot(s.x - h.x, s.y - h.y) < HEX_NEAR)) continue;
                    if (playerPositions.some(p => p && Math.hypot(p.x - h.x, p.y - h.y) < HEX_NEAR)) continue;
                    if (typeof isPositionOnFlippedTile === 'function' && isPositionOnFlippedTile(h.x, h.y, grid)) continue;
                    for (const stoneType of target.types) {
                        if (!rangedOk(stoneType) || (pool[stoneType] || 0) <= 0) continue;
                        const key = `${h.x.toFixed(1)},${h.y.toFixed(1)},${stoneType}`;
                        if (seen.has(key)) continue;
                        if (typeof isInPlacementRange === 'function' && !isInPlacementRange(h.x, h.y, stoneType)) continue;
                        seen.add(key);
                        actions.push({
                            type: 'placeStone', x: h.x, y: h.y, stoneType,
                            scroll: null, progress: 0, tactical: true, ranged: true,
                        });
                    }
                }
            }
        }

        // ── move: each affordable adjacent hex ──
        // (no step onto a stone the bot could not walk off again: stepStrands)
        if (ap > 0) {
            for (const h of hexGrid()) {
                const d = Math.hypot(h.x - player.x, h.y - player.y);
                if (d <= HEX_NEAR || d >= HEX_STEP) continue;
                const mv = canPlayerMoveToHex(h.x, h.y, false);
                if (!mv.canMove) continue;
                const cost = mv.cost ?? 1;
                if (cost > ap || stepStrands(h, ap - cost)) continue;
                actions.push({ type: 'move', x: h.x, y: h.y, cost });
            }
        }

        // ── moveStone: Breath of Power (WIND_SCROLL_2): move any stone
        // adjacent to the pawn onto a DIFFERENT, currently-empty in-range
        // hex, free, repeatable all turn. hasWindStoneMove() is the exact
        // same gate game-core.js's stone mousedown handlers check before
        // allowing a drag; there is no selectionMode/modal here (unlike
        // Control the Current), so this is a genuine elective action rather
        // than something driven automatically — see game-core.js's
        // moveStoneTo() (added alongside this) for the completion. Not
        // gated by `onStone`: startStoneDrag() itself never checks
        // isPlayerRestingOnStone, only stone adjacency.
        if (window.spellSystem?.scrollEffects?.hasWindStoneMove?.(activePlayerIndex)) {
            const grid = hexGrid();
            for (const s of placedStones) {
                const dFromPlayer = Math.hypot(s.x - player.x, s.y - player.y);
                if (dFromPlayer <= HEX_NEAR || dFromPlayer >= HEX_STEP) continue;
                for (const h of grid) {
                    if (Math.hypot(h.x - s.x, h.y - s.y) < HEX_NEAR) continue; // must actually move
                    if (typeof isInPlacementRange === 'function' && !isInPlacementRange(h.x, h.y, s.type)) continue;
                    if (typeof isPositionOnFlippedTile === 'function' && isPositionOnFlippedTile(h.x, h.y, grid)) continue;
                    if (placedStones.some(o => o !== s && Math.hypot(o.x - h.x, o.y - h.y) < HEX_NEAR)) continue;
                    if (playerPositions.some(p => p && Math.hypot(p.x - h.x, p.y - h.y) < HEX_NEAR)) continue;
                    actions.push({ type: 'moveStone', fromX: s.x, fromY: s.y, toX: h.x, toY: h.y, stoneType: s.type });
                }
            }
        }

        // ── teleport: standing on a revealed catacomb shrine (or ANY
        // elemental shrine while Freedom is active) lets the player jump to
        // any revealed ELEMENTAL shrine centre, free (0 AP). EXPLORATION:
        // catacomb tiles no longer link to each other — the destination is
        // always an elemental shrine, never another catacomb tile.
        // Mirrors game-ui.js's catacombEligibility()/updateCatacombIndicators()
        // exactly — same eligibility rule, same destination filter — just
        // enumerated as a candidate list instead of clickable DOM circles.
        if (!onStone) {
            const currentShrine = placedTiles.find(t =>
                t.shrineType !== 'player' && Math.hypot(t.x - player.x, t.y - player.y) < HEX_NEAR);
            const freedomActive = !!(window.spellSystem?.scrollEffects?.hasFreedomActive?.(activePlayerIndex));
            const elementalTypes = ['earth', 'water', 'fire', 'wind', 'void'];
            // Never read shrineType of an unrevealed tile — check t.flipped
            // FIRST, same DO-NOT-LIST rule move/placeStone candidates follow.
            const isCatacombLike = (t) => !!t && !t.flipped &&
                (t.shrineType === 'catacomb' || (freedomActive && elementalTypes.includes(t.shrineType)));
            const isElementalCenter = (t) => !!t && !t.flipped && elementalTypes.includes(t.shrineType);
            if (currentShrine && isCatacombLike(currentShrine)) {
                for (const t of placedTiles) {
                    if (!isElementalCenter(t)) continue;
                    if (Math.hypot(t.x - currentShrine.x, t.y - currentShrine.y) < HEX_NEAR) continue; // same shrine
                    if (placedStones.some(s => Math.hypot(s.x - t.x, s.y - t.y) < HEX_NEAR)) continue; // stone blocks it
                    if (playerPositions.some(p => p && Math.hypot(p.x - t.x, p.y - t.y) < HEX_NEAR)) continue; // occupied
                    actions.push({ type: 'teleport', x: t.x, y: t.y, shrineType: t.shrineType });
                }
            }
        }

        // ── breakStone: any adjacent stone the player can afford to break ──
        // Mirrors attemptBreakStone()'s own adjacency test (isAdjacentToPlayer,
        // same HEX_STEP radius) rather than calling it, since that helper reads
        // the singular `playerPosition` getter — which does resolve to
        // playerPositions[activePlayerIndex] (see game-core.js), but the move
        // block above already computes distance from `player` directly, so
        // reuse that instead of a second code path to the same fact.
        if (!onStone) for (const s of placedStones) {
            const d = Math.hypot(s.x - player.x, s.y - player.y);
            if (d <= HEX_NEAR || d >= HEX_STEP) continue;
            const cost = STONE_BREAK_COST[s.type];
            if (cost == null || cost > ap) continue;
            actions.push({ type: 'breakStone', stoneId: s.id, x: s.x, y: s.y, stoneType: s.type, cost });
        }

        // ── voluntary discard: cycle a hand/active scroll to the common area
        // (legal any time via spellSystem.discardScroll — the same move the
        // overflow flow uses). This is how a bot frees a hand slot jammed
        // with an already-won or dead-source scroll; scoring's
        // discardVoluntary penalty keeps it rare.
        if (scrolls) {
            for (const name of scrolls.hand) {
                actions.push({ type: 'discardScroll', scroll: name, from: 'hand', voluntary: true });
            }
            for (const name of scrolls.active) {
                actions.push({ type: 'discardScroll', scroll: name, from: 'active', voluntary: true });
            }
        }

        // ── endTurn: always available while the button is live ──
        // Exempt from the resting-on-stone ban when stranded (no legal move
        // to escape it) — see isPlayerStrandedOnStone in game-core.js. Without
        // this a bot that lands on a stone with 0 AP and nothing affordable
        // adjacent has zero legal actions at all: onStone excludes
        // cast/placeStone/breakStone/endTurn, and no move exists either.
        // Same for another player's tile (isPlayerOnOpponentTile): crossing is
        // fine, ending the turn there is not, unless stranded.
        const onOppTile = typeof isPlayerOnOpponentTile === 'function' && isPlayerOnOpponentTile(activePlayerIndex);
        const strandedOnStone = (onStone || onOppTile) &&
            typeof isPlayerStrandedOnStone === 'function' && isPlayerStrandedOnStone(activePlayerIndex);
        const btn = document.getElementById('end-turn');
        if ((!(onStone || onOppTile) || strandedOnStone) && btn && !btn.disabled) actions.push({ type: 'endTurn' });

        return actions;
    }

    // ----------------------------------------------------------------
    // Apply one canonical action through the game's own code paths.
    // Returns {ok, reason?}. NEVER add rules knowledge here.
    // ----------------------------------------------------------------
    function applyAction(a) {
        if (typeof isMultiplayer !== 'undefined' && isMultiplayer &&
            typeof myPlayerIndex !== 'undefined' && activePlayerIndex !== myPlayerIndex) {
            return { ok: false, reason: 'not this client\'s turn (multiplayer guard)' };
        }

        // Re-check the resting-on-stone gate (see legalActions() above) —
        // callers may hold a stale action from a snapshot taken before the
        // pawn's last move landed it on a stone. endTurn is exempt when
        // stranded (no legal move to escape it) — the one case where it has
        // to stay legal, or the game hard-deadlocks (see
        // isPlayerStrandedOnStone in game-core.js).
        const positionalTypes = ['cast', 'placeStone', 'breakStone', 'endTurn'];
        if (positionalTypes.includes(a?.type) &&
            typeof isPlayerRestingOnStone === 'function' && isPlayerRestingOnStone(activePlayerIndex) &&
            !(a.type === 'endTurn' && typeof isPlayerStrandedOnStone === 'function' && isPlayerStrandedOnStone(activePlayerIndex))) {
            return { ok: false, reason: 'standing on a stone - must move to an empty hex first' };
        }
        if (a?.type === 'endTurn' &&
            typeof isPlayerOnOpponentTile === 'function' && isPlayerOnOpponentTile(activePlayerIndex) &&
            !(typeof isPlayerStrandedOnStone === 'function' && isPlayerStrandedOnStone(activePlayerIndex))) {
            return { ok: false, reason: "on another player's tile - must move off it before ending the turn" };
        }

        switch (a?.type) {
            case 'placeTile': {
                // Same robust check as legalActions() above — isPlacementPhase
                // is only meaningful in real multiplayer; fall back to "this
                // player has no pawn yet" everywhere else (local hot-seat,
                // Tutorial Mode) so the action this function itself offered
                // isn't immediately rejected as illegal.
                const inPlacement = (typeof isPlacementPhase !== 'undefined' && isPlacementPhase)
                    ? (typeof playerTilesPlaced !== 'undefined' && !playerTilesPlaced.has(activePlayerIndex))
                    : !playerPositions[activePlayerIndex];
                if (!inPlacement) {
                    return { ok: false, reason: 'not placement phase' };
                }
                if (typeof countTouchingUnrevealedTiles === 'function' &&
                    countTouchingUnrevealedTiles(a.x, a.y) < 2) {
                    return { ok: false, reason: 'player tiles must touch 2+ unrevealed tiles' };
                }
                // Capture BEFORE calling placeTile() — its own multiplayer
                // branch (game-core.js) synchronously advances
                // activePlayerIndex to the NEXT player as part of processing
                // THIS placement (turn-tracking broadcast + local turn
                // advance both happen inside that one call). Reading
                // activePlayerIndex after the call — as this code used to —
                // picks up the wrong (next) player's index for the VISUAL
                // placement broadcast every other client renders from, even
                // though `color` (read from the still-correct playerColor
                // global) is right. Only the host's own screen was ever
                // correct, since it renders the placement directly rather
                // than through this broadcast — every other client saw the
                // tile/pawn/color placed one index off.
                const placingIndex = activePlayerIndex;
                placeTile(a.x, a.y, 0, false, 'player');
                if (typeof broadcastGameAction === 'function') {
                    broadcastGameAction('player-tile-place', {
                        x: a.x, y: a.y,
                        playerIndex: placingIndex,
                        color: playerColor,
                        cosmetics: null
                    });
                }
                return { ok: true };
            }
            case 'cast': {
                // Hand the chosen option to the scroll-effect driver first; it
                // uses it instead of its own default rule (bot-effects.js).
                window.BotEffects?.setPendingChoice?.(a.scroll, a.choice || null);
                const scrolls = window.spellSystem.getPlayerScrolls(false);
                if (scrolls.hand.has(a.scroll)) {
                    // A full active area (2) blocks moving a hand scroll in, and
                    // castSpell() only looks at active + common: the cast then
                    // failed every turn (two 300-turn deadlocks, 2026-09-28).
                    // Make room first: discard the least useful active scroll
                    // to the common area (its element already won, else the
                    // lowest level).
                    const max = window.spellSystem.MAX_ACTIVE_SIZE ?? 2;
                    if (scrolls.active.size >= max) {
                        const won = scrolls.activated || new Set();
                        const rank = n => {
                            const d = window.SCROLL_DEFINITIONS?.[n];
                            const el = d?.element;
                            const dead = el && el !== 'catacomb' && won.has(el);
                            return (dead ? 0 : 100) + (d?.level || 0);
                        };
                        const out = [...scrolls.active].filter(n => n !== a.scroll).sort((x, y) => rank(x) - rank(y))[0];
                        if (out) window.spellSystem.discardScroll(out);
                    }
                    if (!window.spellSystem.moveToActive(a.scroll)) {
                        return { ok: false, reason: `could not move ${a.scroll} to the active area` };
                    }
                }
                const ok = window.spellSystem.castSpell();
                // When several scrolls match at once castSpell() opens a
                // "Select Scroll to Cast" popup instead of executing — pick
                // the scroll this action asked for (otherwise the cast
                // silently no-ops and the caller loops on it forever).
                const title = [...document.querySelectorAll('h3')]
                    .find(h => srcText(h) === 'Select Scroll to Activate');
                const popup = title?.parentElement?.parentElement;
                if (popup) {
                    const displayName = window.spellSystem.patterns?.[a.scroll]?.name ||
                                        window.SCROLL_DEFINITIONS?.[a.scroll]?.name || a.scroll;
                    const btn = [...popup.querySelectorAll('button')]
                        .find(b => srcText(b).startsWith(displayName));
                    if (btn) { btn.click(); return { ok: true }; }
                    popup.querySelector('button[title="Close"]')?.click();
                    return { ok: false, reason: `selection popup had no option for ${a.scroll}` };
                }
                return ok === false
                    ? { ok: false, reason: 'castSpell() reported failure' }
                    : { ok: true };
            }
            case 'placeStone': {
                const pool = playerPools[activePlayerIndex] || {};
                if ((pool[a.stoneType] || 0) <= 0) return { ok: false, reason: `no ${a.stoneType} stones` };
                // Enforce the same validity the drag-drop path does — callers
                // (plans, effects, harnesses) may request cells legalActions
                // never offered. Placing on a face-down tile is illegal.
                if (placedStones.some(s => Math.hypot(s.x - a.x, s.y - a.y) < HEX_NEAR)) {
                    return { ok: false, reason: 'cell already holds a stone' };
                }
                if (playerPositions.some(p => p && Math.hypot(p.x - a.x, p.y - a.y) < HEX_NEAR)) {
                    return { ok: false, reason: 'a pawn occupies that hex' };
                }
                // Must be a real board hex. The human drag-drop path gets this
                // implicitly (findValidStonePosition snaps to the hex grid),
                // but bot callers pass raw coordinates — and a PLAN's cells
                // are only validated against the board when the plan is MADE.
                // If Telekinesis/Shifting Sands moves the tile out from under
                // an in-flight plan, nothing else here would stop the bot
                // placing stones onto the empty space where the tile used to
                // be (isInPlacementRange is pure distance/buffs, and
                // isPositionOnFlippedTile returns false when there's no hex
                // at all). Observed on a real board as stones floating on the
                // black gap left behind by a telekinesis'd tile.
                if (!hexGrid().some(h => Math.hypot(h.x - a.x, h.y - a.y) < HEX_NEAR)) {
                    return { ok: false, reason: 'not on the board (tile moved away?)' };
                }
                if (typeof isPositionOnFlippedTile === 'function' &&
                    isPositionOnFlippedTile(a.x, a.y, hexGrid())) {
                    return { ok: false, reason: 'cannot place a stone on a face-down tile' };
                }
                if (typeof isInPlacementRange === 'function' &&
                    !isInPlacementRange(a.x, a.y, a.stoneType)) {
                    return { ok: false, reason: 'out of placement range' };
                }
                placeStone(a.x, a.y, a.stoneType);
                pool[a.stoneType]--;
                if (typeof updateStoneCount === 'function') updateStoneCount(a.stoneType);
                if (typeof syncPlayerState === 'function') syncPlayerState();
                return { ok: true };
            }
            case 'move': {
                const player = playerPositions[activePlayerIndex];
                if (!player) return { ok: false, reason: 'pawn not found' };
                if (getTotalAP() < a.cost) return { ok: false, reason: 'not enough AP' };
                // plan-based steps (bot.js) come here without legalActions()
                if (stepStrands(a, getTotalAP() - a.cost)) return { ok: false, reason: 'would end up stuck on a stone' };
                player.x = a.x;
                player.y = a.y;
                player.element.setAttribute('transform', `translate(${a.x}, ${a.y})`);
                spendAP(a.cost);
                if (typeof handlePlayerLanding === 'function') handlePlayerLanding(a.x, a.y);
                if (typeof broadcastPlayerMovement === 'function') {
                    broadcastPlayerMovement(activePlayerIndex, a.x, a.y, a.cost);
                }
                return { ok: true };
            }
            case 'teleport': {
                const teleportPlayer = playerPositions[activePlayerIndex];
                if (!teleportPlayer) return { ok: false, reason: 'pawn not found' };
                // Re-validate the destination fresh — the board may have
                // changed since legalActions() was computed. Mirrors the UI
                // click handler's own re-validation in game-ui.js.
                if (placedStones.some(s => Math.hypot(s.x - a.x, s.y - a.y) < HEX_NEAR)) {
                    return { ok: false, reason: 'destination blocked by stone' };
                }
                if (playerPositions.some(p => p && Math.hypot(p.x - a.x, p.y - a.y) < HEX_NEAR)) {
                    return { ok: false, reason: 'destination occupied' };
                }
                const teleportingIndex = activePlayerIndex; // same capture-before-call
                                                              // discipline as placeTile above
                // placePlayer() is the exact function the UI's teleport-indicator
                // click handler calls — never reimplement the teleport itself
                // (it also fires checkWinCondition() as a side effect, letting
                // a home-adjacent teleport register a win the same way walking
                // there would).
                window.PawnFx?.hint('catacomb', a.x, a.y); // teleport animation (js/piece-3d.js)
                placePlayer(a.x, a.y);
                if (typeof isMultiplayer !== 'undefined' && isMultiplayer &&
                    typeof broadcastGameAction === 'function') {
                    broadcastGameAction('catacomb-teleport', {
                        playerIndex: teleportingIndex, x: a.x, y: a.y
                    });
                }
                return { ok: true };
            }
            case 'breakStone': {
                const stone = placedStones.find(s => s.id === a.stoneId);
                if (!stone) return { ok: false, reason: 'stone not found' };
                const player = playerPositions[activePlayerIndex];
                if (!player) return { ok: false, reason: 'pawn not found' };
                const d = Math.hypot(stone.x - player.x, stone.y - player.y);
                if (d <= HEX_NEAR || d >= HEX_STEP) return { ok: false, reason: 'stone not adjacent' };
                const cost = STONE_BREAK_COST[stone.type];
                if (cost == null || getTotalAP() < cost) return { ok: false, reason: 'not enough AP' };
                // attemptBreakStone() is the same function the UI's right-click/
                // long-press handlers call — never reimplement the break itself.
                attemptBreakStone(a.stoneId);
                return { ok: true };
            }
            case 'moveStone': {
                const stone = placedStones.find(s => Math.hypot(s.x - a.fromX, s.y - a.fromY) < HEX_NEAR);
                if (!stone) return { ok: false, reason: 'stone not found at source' };
                const player = playerPositions[activePlayerIndex];
                if (!player) return { ok: false, reason: 'pawn not found' };
                const d = Math.hypot(stone.x - player.x, stone.y - player.y);
                if (d <= HEX_NEAR || d >= HEX_STEP) return { ok: false, reason: 'stone not adjacent to pawn' };
                if (!window.spellSystem?.scrollEffects?.hasWindStoneMove?.(activePlayerIndex)) {
                    return { ok: false, reason: 'Breath of Power not active' };
                }
                // Re-validate the destination fresh, same discipline as
                // placeStone/teleport above — the board may have changed
                // since legalActions() was computed.
                if (placedStones.some(s => s !== stone && Math.hypot(s.x - a.toX, s.y - a.toY) < HEX_NEAR)) {
                    return { ok: false, reason: 'destination occupied by a stone' };
                }
                if (playerPositions.some(p => p && Math.hypot(p.x - a.toX, p.y - a.toY) < HEX_NEAR)) {
                    return { ok: false, reason: 'destination occupied by a pawn' };
                }
                if (typeof isInPlacementRange === 'function' && !isInPlacementRange(a.toX, a.toY, stone.type)) {
                    return { ok: false, reason: 'out of placement range' };
                }
                if (typeof isPositionOnFlippedTile === 'function' && isPositionOnFlippedTile(a.toX, a.toY, hexGrid())) {
                    return { ok: false, reason: 'cannot move onto a face-down tile' };
                }
                if (typeof window.moveStoneTo !== 'function') return { ok: false, reason: 'moveStoneTo not available' };
                window.moveStoneTo(stone.id, a.toX, a.toY);
                return { ok: true };
            }
            case 'discardScroll': {
                const ok = window.spellSystem.discardScroll(a.scroll);
                return ok ? { ok: true } : { ok: false, reason: `${a.scroll} not in hand/active` };
            }
            case 'endTurn': {
                const btn = document.getElementById('end-turn');
                if (!btn || btn.disabled) return { ok: false, reason: 'end-turn button unavailable' };
                // The button would refuse this click: say so instead of
                // clicking (the bot clicked 7 times in a row in game 951,
                // each click looked like a success).
                const blocked = window.endTurnBlockReason?.();
                if (blocked) return { ok: false, reason: 'end turn refused: ' + blocked };
                btn.click();
                return { ok: true };
            }
            default:
                return { ok: false, reason: `unknown action type: ${a?.type}` };
        }
    }

    window.BotState = { snapshot, legalActions, applyAction, hexGrid, findPath };
    log('Loaded - window.BotState ready (snapshot / legalActions / applyAction)');
})();
