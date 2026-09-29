// ============================================================
// bot-effects.js — Stage 2.5 of docs/bot-roadmap.md
// ============================================================
// Drives the interactive choice UIs scroll effects open, instead of the
// bot cancelling every one of them (see docs/bot-roadmap.md
// § CHOICE-SPACE INVENTORY for the full list of 15 scrolls + Excavate).
// window.BotEffects.driveSelection() is tried FIRST by bot.js's
// waitForQuiescence(); returning false lets the existing cancel path
// (cancelSelectionMode()) handle anything not covered here.
//
// Never reimplements game rules: every choice below calls straight into
// the game's own selection APIs — selectionMode.handleXClick(...), or
// clicking the real modal <button>/<div> elements a human would click —
// exactly the BotState.applyAction() philosophy applied to scroll effects.
//
// Coverage so far:
//   - driveSelection(): tile-flip (Heavy Stomp / Call to Adventure),
//     scorched-earth (Combust), tile-swap (Shifting Sands), Create,
//     Scholar's Insight, Quick Reflexes, Sacrificial Pyre, Inspiring
//     Draught, Wandering River, Arson, Plunder, Control the Current.
//     Control the Current is architecturally different from everything
//     else here: a persistent "this turn, no Done button" mode
//     (selectionMode.type 'water-transform') meant to coexist with the
//     rest of the bot's turn (transform an adjacent water stone
//     opportunistically while moving), not a one-shot pick-then-done
//     choice. driveWaterTransform() only acts when a stone is adjacent
//     RIGHT NOW (recomputed fresh, never trusting the selectionMode's own
//     cached highlight list — see its own comment for why); bot.js's
//     waitForQuiescence() treats a false return from THIS mode specifically
//     as "quiescent, not stuck" instead of cancelling like every other
//     undriven selection would be, so the effect survives for the bot's
//     whole turn instead of getting force-cancelled the instant no water
//     stone happens to be adjacent yet.
//     Excavate's deferred teleport, Take Flight, and Telekinesis are ALSO
//     driven now: Excavate is a clean handleHexClick() like tile-flip/
//     tile-swap (its "drag-based" label in earlier notes was simply
//     wrong — it was never actually drag-based). Take Flight and
//     Telekinesis genuinely ARE drag-only at the UI layer (no
//     selectionMode.handleXClick()/onComplete(x,y)-style API for the
//     drop itself) — driveTakeFlightDrag()/driveTelekinesis() mirror the
//     real drop handler's call sequence exactly (placePlayer()/
//     movePlayerVisually() + takeFlightState.onComplete() for Take
//     Flight; startTileDrag() + placeTile() + the move-counter bookkeeping
//     for Telekinesis) instead of reimplementing the underlying game
//     rules — see each driver's own comment for the full reasoning.
//   - driveTransmute(): the only scroll with an open-ended discard-for-AP
//     modal and NO selectionMode object (detected via DOM id directly,
//     same as scroll-effects.js's EFFECT_MODAL_IDS safety net).
//   - decideResponse(): response-scroll respond/pass — both the arena
//     (gated on window.BotArena.isRunning(), called from bot.js) and real
//     multiplayer (js/bot-driver.js's respondForBots(), ticking alongside
//     its turn watcher).
// Stage 2.5's full choice-space inventory (docs/bot-roadmap.md §
// CHOICE-SPACE INVENTORY) is now covered end to end.
//
// LOAD ORDER: after bot-sim.js, before bot.js (bot.js calls into this) —
// but this file must not reach into bot.js's closure; it reads game state
// via window.BotState.snapshot() only, same as bot.js does, so load order
// relative to bot.js doesn't actually matter as long as both are loaded
// before any bot action runs.
// ============================================================

(function () {
    'use strict';

    function log(...args) { console.log('🎯 [BotEffects]', ...args); }

    const ELEMENTS = ['earth', 'water', 'fire', 'wind', 'void'];
    const POOL_CAP = 5;

    // Small, independent tuning surface for effect *choices* (which tile,
    // which element, ...) — separate from bot.js's WEIGHTS because these are
    // one-off picks, not scored against move/cast/endTurn alternatives.
    const WEIGHTS = {
        needUnactivated: 2.5,
        needPoolRoom: 1.0,
        needDeadSource: -3.0,
    };

    function snap() { return window.BotState.snapshot(); }
    function self(s) { return s.players[s.turn.activePlayerIndex]; }

    // Value of gaining a stone/scroll of this element right now — same shape
    // as bot.js's shrineValue(), kept independent since this file must stand
    // alone from bot.js's closure.
    function elementNeed(s, me, element) {
        const room = Math.max(0, POOL_CAP - (me.pool[element] || 0));
        let v = WEIGHTS.needPoolRoom * room;
        if (!me.activated.includes(element)) v += WEIGHTS.needUnactivated * room;
        if ((s.sourcePool[element] || 0) <= 0) v += WEIGHTS.needDeadSource * room;
        return v;
    }

    // Elements ranked by SCROLL need (bot.js scrollNeed: elements the bot
    // still has to activate and holds no easy scroll for), stone need as the
    // tie-break. For effects that hand the bot a scroll (Scholar's Insight,
    // Inspiring Draught). Falls back to stone need when bot.js is missing.
    function rankedScrollElements() {
        const s = snap();
        const me = self(s);
        const need = window.BotSystem?.scrollNeed?.(s, s.turn.activePlayerIndex);
        if (!me || !need) return rankedElements();
        return [...ELEMENTS].sort((a, b) =>
            (need[b] - need[a]) || (elementNeed(s, me, b) - elementNeed(s, me, a)));
    }

    // Scroll id for a card / button label (display name), preferring the
    // given element's deck when two decks share a name.
    function scrollIdByDisplayName(label, element) {
        const defs = window.SCROLL_DEFINITIONS || {};
        const ids = Object.keys(defs).filter(id => defs[id].name === label);
        return ids.find(id => defs[id].element === element) || ids[0] || null;
    }
    function pickScore(id) {
        if (!id) return 0;
        const f = window.BotSystem?.scrollPickScore;
        return f ? f(snap(), id) : (window.SCROLL_DEFINITIONS?.[id]?.level || 0);
    }

    // Elements ranked best-need-first for the active player right now.
    function rankedElements() {
        const s = snap();
        const me = self(s);
        if (!me) return [...ELEMENTS];
        return [...ELEMENTS].sort((a, b) => elementNeed(s, me, b) - elementNeed(s, me, a));
    }

    // ----------------------------------------------------------------
    // DOM helpers — click the real button/div a human would click. Only
    // elements with a live onclick handler are considered "clickable"
    // (disabled/empty-deck buttons never get one — see scroll-effects.js
    // showDeckSelectionModal/showCreateStoneModal), so this naturally skips
    // choices the game itself has ruled out.
    // ----------------------------------------------------------------
    function clickableDescendants(root) {
        return [...root.querySelectorAll('*')].filter(el => typeof el.onclick === 'function');
    }

    function clickMatching(root, predicate) {
        for (const el of clickableDescendants(root)) {
            if (predicate(el.textContent || '')) { el.click(); return true; }
        }
        return false;
    }

    // Try each element in priority order; click the first whose button/card
    // is actually present and clickable. Returns the element clicked, or null.
    function clickBestElement(root, priorityElements) {
        for (const el of priorityElements) {
            const label = el.charAt(0).toUpperCase() + el.slice(1);
            if (clickMatching(root, t => t.includes(label))) return el;
        }
        return null;
    }

    function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

    // ----------------------------------------------------------------
    // Chosen options (combo plan Phase 2). bot-state.js applyAction('cast')
    // hands over the choice the bot picked (scroll id + choice) right
    // before casting; the matching driver uses it instead of its default
    // rule. Set fresh (or cleared) on every cast, so a choice never leaks
    // into a later, different effect. A choice that is no longer legal
    // falls back to the default rule.
    // ----------------------------------------------------------------
    let pendingChoice = null;
    let pendingRiverElement = null;
    let pendingStep2 = null; // second step of a two-step choice (Arson element, Plunder scroll, swap tile b)
    // (scroll id, choice) are kept apart: a choice can have its own `scroll`
    // field (Plunder's target scroll).
    function setPendingChoice(scrollId, choice) {
        pendingChoice = (scrollId && choice) ? { scrollId, choice } : null;
        pendingRiverElement = null; pendingStep2 = null;
    }
    const seatLabel = idx => (typeof getPlayerColorName === 'function') ? getPlayerColorName(idx) : null;
    // Put the chosen element first in a ranked list (default order after it,
    // so an unavailable deck still falls back sensibly).
    function withChoice(scroll, ranked) {
        const c = takeChoice(scroll);
        return (c && c.element) ? [c.element, ...ranked.filter(e => e !== c.element)] : ranked;
    }
    function takeChoice(scroll) {
        if (!pendingChoice || pendingChoice.scrollId !== scroll) return null;
        const c = pendingChoice.choice;
        pendingChoice = null;
        return c;
    }

    // ----------------------------------------------------------------
    // tile-flip (Heavy Stomp EARTH_SCROLL_4, Call to Adventure CATACOMB_SCROLL_3)
    // Choice: one eligible tile (no stones/players, not a player tile).
    // Heuristic: strongly prefer flipping a HIDDEN tile (reveals it — a
    // scroll draw, same value the bot already places on exploration via
    // WEIGHTS.moveExplore in bot.js) over hiding a revealed one, which only
    // ever removes board information/access.
    // ----------------------------------------------------------------
    function driveTileFlip(se, sm) {
        const tiles = sm.eligibleTiles || [];
        if (!tiles.length) return false;
        const chosen = takeChoice('EARTH_SCROLL_4') || takeChoice('CATACOMB_SCROLL_3');
        const chosenTile = chosen && tiles.find(t => Number(t.id) === Number(chosen.tileId));
        if (chosenTile) { sm.handleTileClick(chosenTile); return true; }
        const me = self(snap());
        const hidden = tiles.filter(t => t.flipped);
        const pick = hidden.length
            ? hidden.reduce((a, b) => (!a || dist(me, b) < dist(me, a)) ? b : a, null)
            : tiles[0]; // no hidden tiles available — arbitrary pick among a genuinely bad option set
        sm.handleTileClick(pick);
        return true;
    }

    // ----------------------------------------------------------------
    // scorched-earth (Combust CATACOMB_SCROLL_10)
    // Choice: one tile with stones on it (destroys ALL stones there).
    // Heuristic v1: maximize stones destroyed. Does NOT yet protect the
    // bot's own in-progress plan cells (plan state lives in bot.js's
    // closure, not exposed here) — a known limitation, not a correctness
    // bug: worst case the bot burns its own half-built pattern.
    // ----------------------------------------------------------------
    function driveScorchedEarth(se, sm) {
        const tiles = sm.eligibleTiles || [];
        if (!tiles.length) return false;
        // A stuck bot casts Combust to clear a shrine it needs (bot.js
        // stuckTools): burn that tile first.
        const st = window.BotSystem?.stuckTools?.();
        const clear = st?.blockedTiles ? tiles.find(t => st.blockedTiles.has(t.id)) : null;
        if (clear) { sm.handleTileClick(clear); return true; }
        let best = tiles[0], bestCount = -1;
        for (const t of tiles) {
            const count = (typeof placedStones !== 'undefined' ? placedStones : [])
                .filter(st => Math.hypot(st.x - t.x, st.y - t.y) < (typeof TILE_SIZE !== 'undefined' ? TILE_SIZE * 4 : 80)).length;
            if (count > bestCount) { bestCount = count; best = t; }
        }
        sm.handleTileClick(best);
        return true;
    }

    // ----------------------------------------------------------------
    // tile-swap (Shifting Sands EARTH_SCROLL_2)
    // Choice: 2 eligible tiles to swap positions. No clear strategic value
    // model without deeper board reasoning (swapping revealed shrines
    // relocates them, which can help or hurt either player) — v1 just picks
    // the two eligible tiles closest to each other (least disruptive,
    // avoids randomly relocating a shrine to the far side of the board).
    // ----------------------------------------------------------------
    function driveTileSwap(se, sm) {
        const tiles = (sm.eligibleTiles || []).filter(t =>
            !(sm.selectedTiles || []).some(s => s.id === t.id));
        if (!tiles.length) return false;
        const byId = id => tiles.find(t => Number(t.id) === Number(id));
        if (!(sm.selectedTiles || []).length) {
            const c = takeChoice('EARTH_SCROLL_2');
            if (c && byId(c.a) && byId(c.b)) {
                pendingStep2 = { kind: 'swap', b: c.b };
                sm.handleTileClick(byId(c.a));
                return true;
            }
        } else if (pendingStep2?.kind === 'swap') {
            const b = byId(pendingStep2.b);
            pendingStep2 = null;
            if (b) { sm.handleTileClick(b); return true; }
        }
        if (!(sm.selectedTiles || []).length) {
            // First click: pick a tile, prefer one with a partner nearby
            let bestPair = null, bestDist = Infinity;
            for (const a of tiles) {
                for (const b of tiles) {
                    if (a.id === b.id) continue;
                    const d = dist(a, b);
                    if (d < bestDist) { bestDist = d; bestPair = a; }
                }
            }
            sm.handleTileClick(bestPair || tiles[0]);
        } else {
            // Second click: nearest remaining eligible tile to the first pick
            const first = sm.selectedTiles[0];
            const nearest = tiles.reduce((a, b) => (!a || dist(first, b) < dist(first, a)) ? b : a, null);
            sm.handleTileClick(nearest);
        }
        return true;
    }

    // ----------------------------------------------------------------
    // Control the Current (WATER_SCROLL_5) — persistent whole-turn mode,
    // NOT a one-shot pick (no "Done" button — see the file header's
    // "architecturally different" note). Only acts when a water stone is
    // adjacent RIGHT NOW: recomputed fresh via se.getAdjacentWaterStones(),
    // never via sm.highlightedStones — that cache is only refreshed by
    // placePlayer()'s move branch (game-core.js), which bot-state.js's
    // 'move' action bypasses (it mutates position directly), so trusting
    // it here would silently miss stones that became adjacent after a bot
    // move. Returning false when nothing is adjacent is expected and
    // normal, not "stuck" — see bot.js's waitForQuiescence() for the
    // matching non-blocking treatment this mode needs.
    // ----------------------------------------------------------------
    function driveWaterTransform(se, sm) {
        const pos = (typeof playerPositions !== 'undefined') ? playerPositions[sm.casterIndex] : null;
        if (!pos) return false;
        const stones = se.getAdjacentWaterStones(pos, sm.casterIndex);
        if (!stones.length) return false;
        // Every target element's source pool empty: nothing can be made, so
        // do not open the picker at all (owner report 2026-09-28: the bot
        // clicked a disabled button forever and the turn never ended).
        const pools = (typeof stonePools !== 'undefined') ? stonePools : {};
        const targets = ['earth', 'fire', 'wind', 'void'].filter(el => (pools[el] || 0) > 0);
        if (!targets.length) return false;
        // The leader's fresh water stones first (harm, owner 2026-09-28).
        let pick = stones[0];
        try {
            const sn = snap(), me = sn.players[sm.casterIndex];
            const h = me && window.BotSystem?._harmContext?.(sn, me);
            const k = st => `${Math.round(st.x)},${Math.round(st.y)}`;
            const hk = h ? new Set([...h.stones].map(x => x.split(',').slice(0, 2).map(v => Math.round(+v)).join(','))) : null;
            const theirs = hk && stones.find(st => hk.has(k(st)));
            if (theirs) {
                pick = theirs;
                window.BotDiplomacy?.intend?.(sm.casterIndex, 'current', h.L);
            }
        } catch (e) {}
        sm.handleStoneClick(pick); // opens water-transform-modal synchronously
        const modal = document.getElementById('water-transform-modal');
        if (modal) {
            const order = [...rankedElements().filter(el => targets.includes(el)), ...targets];
            if (!clickBestElement(modal, order)) {
                // Nothing clickable after all: close it instead of looping.
                [...modal.querySelectorAll('button')].find(b => b.textContent === 'Cancel')?.click();
                return false;
            }
        }
        return true;
    }

    // ----------------------------------------------------------------
    // Wandering River (WATER_SCROLL_4) — two steps:
    //   1. tile-element-change selectionMode: pick any eligible (non-player)
    //      tile. Heuristic: closest to the bot's own position — makes an
    //      immediate end-turn-here collection this turn plausible, the
    //      most likely way to actually benefit before the effect expires
    //      next turn.
    //   2. element-select-modal: pick which element the tile counts as.
    //      Generic "Earth"/"Water"/... buttons, same shape as Create's —
    //      reuse clickBestElement(rankedElements()).
    // GOTCHA: selectionMode.type stays 'tile-element-change' even after
    // step 1 opens the element modal (only cleared once step 2 resolves),
    // so without the modal-open guard below this would re-click a tile
    // (and re-open a fresh element-select-modal) every polling tick
    // instead of ever reaching step 2's driver.
    // ----------------------------------------------------------------
    function driveWanderingRiver(se, sm) {
        if (document.getElementById('element-select-modal')) return false; // step 2 already open
        const tiles = sm.eligibleTiles || [];
        if (!tiles.length) return false;
        const chosen = takeChoice('WATER_SCROLL_4');
        const chosenTile = chosen && tiles.find(t => Number(t.id) === Number(chosen.tileId));
        if (chosenTile) {
            pendingRiverElement = chosen.element || null; // used by the element modal next
            sm.handleTileClick(chosenTile);
            return true;
        }
        const me = self(snap());
        const nearest = tiles.reduce((a, b) => (!a || dist(me, b) < dist(me, a)) ? b : a, null);
        sm.handleTileClick(nearest);
        return true;
    }

    function driveElementSelectModal() {
        const modal = document.getElementById('element-select-modal');
        if (!modal) return false;
        if (pendingRiverElement) {
            const el = pendingRiverElement;
            pendingRiverElement = null;
            if (clickBestElement(modal, [el])) return true;
        }
        return !!clickBestElement(modal, rankedElements());
    }

    // ----------------------------------------------------------------
    // Arson (FIRE_SCROLL_5) — two steps:
    //   1. opponent-select-modal: pick a target opponent. Heuristic: the
    //      biggest threat (rankedOpponents() — most activated elements,
    //      tie-broken by total pool size).
    //   2. arson-element-modal: pick which stone type to destroy from
    //      their pool. Only lists elements they actually have; buttons
    //      show the count, e.g. "Earth (3 in pool)" — pick the highest
    //      count for the single biggest denial hit.
    // ----------------------------------------------------------------
    function driveOpponentSelectModal() {
        const modal = document.getElementById('opponent-select-modal');
        if (!modal) return false;
        const buttons = [...modal.querySelectorAll('button')];
        const c = takeChoice('FIRE_SCROLL_5');
        if (c) {
            const btn = buttons.find(b => b.textContent === seatLabel(c.target));
            if (btn) { pendingStep2 = { kind: 'arson', element: c.element }; btn.click(); return true; }
        }
        for (const idx of rankedOpponents()) {
            const name = (typeof getPlayerColorName === 'function') ? getPlayerColorName(idx) : null;
            const btn = name ? buttons.find(b => b.textContent === name) : null;
            if (btn) { btn.click(); return true; }
        }
        return false;
    }

    function driveArsonElementModal() {
        const modal = document.getElementById('arson-element-modal');
        if (!modal) return false;
        const buttons = [...modal.querySelectorAll('button')];
        if (!buttons.length) return false;
        if (pendingStep2?.kind === 'arson') {
            const el = pendingStep2.element;
            pendingStep2 = null;
            const label = el.charAt(0).toUpperCase() + el.slice(1);
            const btn = buttons.find(b => b.textContent.startsWith(label + ' ('));
            if (btn) { btn.click(); return true; }
        }
        let best = buttons[0], bestCount = -1;
        for (const b of buttons) {
            const m = b.textContent.match(/\((\d+) in pool\)/);
            const count = m ? parseInt(m[1], 10) : 0;
            if (count > bestCount) { bestCount = count; best = b; }
        }
        best.click();
        return true;
    }

    // ----------------------------------------------------------------
    // Plunder (CATACOMB_SCROLL_8) — two steps:
    //   1. plunder-player-modal: pick a target player (self allowed by the
    //      game, but never worth it here — a plain voluntary discardScroll
    //      already covers what self-targeting would do, with no wasted
    //      cast). Buttons are only clickable when the target actually has
    //      a plunderable active scroll — rankedOpponents(hasActive) mirrors
    //      that filter using the snapshot's public `active` list, so the
    //      bot never tries a target the modal itself would refuse.
    //   2. scroll-select-modal (SHARED with Sacrificial Pyre / Inspiring
    //      Draught's put-back step — routed by heading text in
    //      driveScrollSelectModal() below): pick which of the target's
    //      active scrolls to send to the common area. Opposite of
    //      pickWeakestButton — take their BEST scroll, not our worst.
    // ----------------------------------------------------------------
    function drivePlunderPlayerModal() {
        const modal = document.getElementById('plunder-player-modal');
        if (!modal) return false;
        const buttons = [...modal.querySelectorAll('button')];
        const c = takeChoice('CATACOMB_SCROLL_8');
        if (c) {
            const name = seatLabel(c.target);
            const btn = name && buttons.find(b => b.textContent.startsWith(name + ' -') && typeof b.onclick === 'function');
            if (btn) { pendingStep2 = { kind: 'plunder', scroll: c.scroll }; btn.click(); return true; }
        }
        for (const idx of rankedOpponents(p => p.active && p.active.length > 0)) {
            const name = (typeof getPlayerColorName === 'function') ? getPlayerColorName(idx) : null;
            const btn = name ? buttons.find(b => b.textContent.startsWith(name) && b.textContent.includes('active')) : null;
            if (btn) { btn.click(); return true; }
        }
        return false;
    }

    function drivePlunderScrollPick(modal) {
        const buttons = [...modal.querySelectorAll('button')].filter(b => b.textContent !== 'Cancel');
        if (!buttons.length) return false;
        if (pendingStep2?.kind === 'plunder') {
            const want = window.SCROLL_DEFINITIONS?.[pendingStep2.scroll]?.name;
            pendingStep2 = null;
            const btn = want && buttons.find(b => b.textContent === want);
            if (btn) { btn.click(); return true; }
        }
        pickStrongestButton(buttons).click();
        return true;
    }

    // ----------------------------------------------------------------
    // Create (VOID_SCROLL_5) — modal, single click.
    // Choice: element type to draw rank-many stones of.
    // ----------------------------------------------------------------
    function driveCreateModal() {
        const modal = document.getElementById('create-stone-modal');
        if (!modal) return false;
        return !!clickBestElement(modal, withChoice('VOID_SCROLL_5', rankedElements()));
    }

    // ----------------------------------------------------------------
    // Scholar's Insight (VOID_SCROLL_4) — modal, two steps: pick a deck,
    // then pick a scroll card from it. Disambiguated from the deck picker
    // by the modal's own heading text (only Scholar's Insight uses this ID).
    // ----------------------------------------------------------------
    function driveScholarsInsight() {
        const modal = document.getElementById('scholars-insight-modal');
        if (!modal) return false;
        const heading = modal.querySelector('h3')?.textContent || '';
        const guard = !!(window.BotSystem?.fetchWanted?.() || window.BotSystem?.guardWanted?.());
        if (heading.includes('Choose a Deck')) {
            if (guard) {
                takeChoice('VOID_SCROLL_4');
                return !!clickBestElement(modal, ['void', 'earth', ...rankedScrollElements().filter(e => e !== 'void' && e !== 'earth')]);
            }
            return !!clickBestElement(modal, withChoice('VOID_SCROLL_4', rankedScrollElements()));
        }
        // Deck browser: cards are <div>s whose first child is the scroll name.
        // Take the scroll that best covers an element the bot still needs,
        // easiest to build with its stones (bot.js scrollPickScore; level is
        // only the tie-break). Before 2026-09-25 it always took the highest
        // level, even for an element it had already activated.
        const deckEl = (heading.split(' ')[0] || '').toLowerCase();
        const cards = clickableDescendants(modal).filter(c => c.tagName === 'DIV');
        let best = null, bestScore = -Infinity;
        for (const card of cards) {
            const name = card.firstElementChild?.textContent || '';
            if (guard && (name === 'Psychic' || name === 'Iron Stance')) { best = card; break; }
            const score = pickScore(scrollIdByDisplayName(name, deckEl));
            if (score > bestScore) { bestScore = score; best = card; }
        }
        if (!best) return false;
        best.click();
        return true;
    }

    // ----------------------------------------------------------------
    // Shared helper for Sacrificial Pyre / Inspiring Draught's "put back"
    // step: both are "give up one of these scrolls" choices. Prefer giving
    // up a response-only scroll first — dead weight in the main phase
    // regardless (same reasoning as bot.js's discardResponseOnly weight for
    // voluntary discards) — otherwise give up the lowest-level one (least
    // lost value; mirrors driveScholarsInsight's "prefer the strongest
    // when GAINING", inverted for what to give away).
    // ----------------------------------------------------------------
    function scrollDefByDisplayName(label) {
        const defs = window.SCROLL_DEFINITIONS || {};
        return Object.values(defs).find(d => d.name === label);
    }

    function pickWeakestButton(buttons) {
        const responseOnly = buttons.find(b => scrollDefByDisplayName(b.textContent)?.isResponse);
        if (responseOnly) return responseOnly;
        let worst = buttons[0], worstLevel = Infinity;
        for (const b of buttons) {
            const level = scrollDefByDisplayName(b.textContent)?.level ?? 0;
            if (level < worstLevel) { worstLevel = level; worst = b; }
        }
        return worst;
    }

    // Inverse of pickWeakestButton — for choosing what to TAKE/DENY from an
    // opponent (Plunder) rather than what to give up of our own.
    function pickStrongestButton(buttons) {
        let best = buttons[0], bestLevel = -1;
        for (const b of buttons) {
            const level = scrollDefByDisplayName(b.textContent)?.level ?? 0;
            if (level > bestLevel) { bestLevel = level; best = b; }
        }
        return best;
    }

    // Shared opponent-targeting heuristic for Arson (destroy a stone) and
    // Plunder (discard an active scroll) — "hit the biggest threat": most
    // activated elements first, tie-broken by total pool stones. Returns
    // opponent indices ranked best-target-first; optional filterFn narrows
    // to opponents who are actually a valid target (e.g. Plunder needs at
    // least one active scroll to plunder). Never includes self — targeting
    // yourself is never useful here (a plain voluntary discardScroll already
    // covers what self-targeted Plunder would do, with no wasted cast).
    function rankedOpponents(filterFn) {
        const s = snap();
        const meIdx = s.turn.activePlayerIndex;
        return s.players
            .map((p, i) => ({ i, p }))
            .filter(({ i, p }) => i !== meIdx && p && (!filterFn || filterFn(p)))
            .sort((a, b) => {
                // Alliances Phase 2: weighted by how hard this bot pushes
                // against each player (the clear leader first; less for
                // players who helped it). 1 everywhere when the system is off.
                const press = window.BotDiplomacy?.pressures?.(meIdx) || null;
                const score = x => (x.p.activated.length * 1000 +
                    Object.values(x.p.pool || {}).reduce((sum, n) => sum + n, 0)) * (press ? press[x.i] : 1);
                return score(b) - score(a);
            })
            .map(({ i }) => i);
    }

    // ----------------------------------------------------------------
    // Sacrificial Pyre (FIRE_SCROLL_3) — modal, single click.
    // Choice: one scroll from the caster's OWN hand to sacrifice (sent to
    // the common area, but grants stones + runs its own effect too).
    // Modal id (scroll-select-modal) is shared with Inspiring Draught's
    // put-back step and Plunder (not yet driven) — disambiguated by the
    // heading text set by showScrollSelectionModal()'s title param.
    // ----------------------------------------------------------------
    function driveSacrificialPyre(modal) {
        const buttons = [...modal.querySelectorAll('button')].filter(b => b.textContent !== 'Cancel');
        if (!buttons.length) return false;
        pickWeakestButton(buttons).click();
        return true;
    }

    // ----------------------------------------------------------------
    // Inspiring Draught (WATER_SCROLL_3) — two steps:
    //   1. deck-select-modal: toggle ONE element button, then Confirm.
    //   2. (only if that deck had >=2 scrolls left) scroll-select-modal:
    //      pick which of the 2 drawn scrolls to put back — the other is
    //      kept. If only 1 scroll was available it's auto-kept and this
    //      step never opens; driveSelection()'s polling just sees no more
    //      modal and moves on, same as any other multi-step flow here.
    // ----------------------------------------------------------------
    function driveInspiringDraughtDeck(modal) {
        const ranked = withChoice('WATER_SCROLL_3', rankedScrollElements());
        for (const el of ranked) {
            const label = el.charAt(0).toUpperCase() + el.slice(1);
            const btn = [...modal.querySelectorAll('button')].find(b => !b.disabled && b.textContent.startsWith(label));
            if (btn) {
                btn.click(); // toggles this deck into the (max 1) selection
                const confirmBtn = [...modal.querySelectorAll('button')].find(b => b.textContent === 'Confirm');
                confirmBtn?.click();
                return true;
            }
        }
        return false; // every deck empty — genuinely nothing to pick
    }

    // Put back the drawn scroll that helps least (bot.js scrollPickScore).
    function driveInspiringDraughtPutBack(modal) {
        const buttons = [...modal.querySelectorAll('button')].filter(b => b.textContent !== 'Cancel');
        if (!buttons.length) return false;
        if (!window.BotSystem?.scrollPickScore) { pickWeakestButton(buttons).click(); return true; }
        let worst = buttons[0], worstScore = Infinity;
        for (const b of buttons) {
            const score = pickScore(scrollIdByDisplayName(b.textContent, null));
            if (score < worstScore) { worstScore = score; worst = b; }
        }
        worst.click();
        return true;
    }

    // scroll-select-modal is shared by 3 different effects — route by the
    // exact heading text each one's showScrollSelectionModal() call sets.
    function driveScrollSelectModal() {
        const modal = document.getElementById('scroll-select-modal');
        if (!modal) return false;
        const heading = modal.querySelector('h3')?.textContent || '';
        if (heading.startsWith('Select a scroll to sacrifice')) return driveSacrificialPyre(modal);
        if (heading.startsWith('Choose one ') && heading.includes('scroll to put back')) {
            return driveInspiringDraughtPutBack(modal);
        }
        if (heading.startsWith('Select an active scroll to plunder')) return drivePlunderScrollPick(modal);
        return false;
    }

    function driveDeckSelectModal() {
        const modal = document.getElementById('deck-select-modal');
        if (!modal) return false;
        const heading = modal.querySelector('h3')?.textContent || '';
        if (heading.startsWith('Select 1 deck')) return driveInspiringDraughtDeck(modal);
        return false; // enterDeckDrawMode's N>1 variant exists but is unused by any live scroll
    }

    // ----------------------------------------------------------------
    // Quick Reflexes (CATACOMB_SCROLL_9) — modal, single click.
    // Choice: 1 level-1 scroll from a flat pooled list across all 5
    // elemental decks (not deck-then-scroll like Scholar's Insight).
    // ----------------------------------------------------------------
    function driveQuickReflexes() {
        const modal = document.getElementById('quick-reflexes-modal');
        if (!modal) return false;
        // Guard mode (bot.js guardWanted): fetch a counter, Psychic (void)
        // first, then Iron Stance (earth).
        if (window.BotSystem?.fetchWanted?.() || window.BotSystem?.guardWanted?.()) {
            const order = ['void', 'earth', ...rankedElements().filter(e => e !== 'void' && e !== 'earth')];
            takeChoice('CATACOMB_SCROLL_9');
            return !!clickBestElement(modal, order);
        }
        return !!clickBestElement(modal, withChoice('CATACOMB_SCROLL_9', rankedElements()));
    }

    // ----------------------------------------------------------------
    // TRANSMUTE (Fire IV) — open-ended "discard for +2 AP each" modal.
    // No selectionMode object exists for this one; it's a raw DOM overlay
    // built by enterTransmuteMode(). Detect + drive via its buttons.
    // ----------------------------------------------------------------
    function driveTransmute() {
        const modal = document.getElementById('transmute-modal');
        if (!modal) return false;

        const casterIndex = typeof activePlayerIndex !== 'undefined' ? activePlayerIndex : 0;
        const pool = (typeof window.playerPools !== 'undefined' ? window.playerPools : null)?.[casterIndex];
        const maxTotalAP = 5 + (pool?.void || 0);
        const currentTotalAP = (typeof currentAP !== 'undefined' ? currentAP : 0)
            + (typeof voidAP !== 'undefined' ? voidAP : 0);

        const target = Math.min(maxTotalAP, window.BotSystem?.WEIGHTS?.transmuteTargetAP ?? 7);
        const buttons = [...modal.querySelectorAll('button')];
        const doneBtn = buttons.find(b => b.textContent === 'Done');

        if (currentTotalAP >= target) {
            doneBtn?.click();
            return true;
        }

        // Discard the stone type the bot is holding the MOST of first —
        // least likely to be needed for a specific pattern. Never touch
        // scrolls: Transmute's AP gain isn't worth a hand/active slot.
        // Never void either: 2 AP is a bad trade for a stone that permanently
        // raises the AP cap (same reasoning as bot.js's placeVoidSpendPenalty)
        // — and skipping it is what keeps BotSim's Transmute mirror exact,
        // since a void discard clamps voidAP through a current/void AP split
        // the snapshot doesn't carry.
        const stoneButtons = buttons.filter(b => /^Discard 1 /.test(b.textContent) &&
            !/^Discard 1 void/.test(b.textContent) && !b.disabled);
        let best = null, bestCount = -1;
        stoneButtons.forEach(b => {
            const m = b.textContent.match(/\((\d+)\)$/);
            const count = m ? parseInt(m[1], 10) : 0;
            if (count > bestCount) { bestCount = count; best = b; }
        });

        if (best && bestCount > 0) {
            best.click();
            return true;
        }

        // Nothing left worth discarding for AP this pass — close out.
        doneBtn?.click();
        return true;
    }

    // ----------------------------------------------------------------
    // RESPONSE SCROLLS — arena-only respond/pass decision.
    //
    // In a local hot-seat game (no multiplayer, no BotDriver), response-
    // window.js's localResponderIndex() always resolves to the CASTER
    // (there's only one "local" identity for the single browser tab), so
    // openResponseWindow() always takes its "wait for others" branch and
    // the window silently times out — no responder is ever actually
    // asked. This drives the decision directly for an explicit opponent
    // index instead of relying on that local-identity assumption.
    //
    // v1 heuristic (not weight-scored — same spirit as the roadmap's
    // "v1 heuristic" language for this step):
    //   - A counter (Iron Stance / Psychic) is worth playing when the
    //     triggering cast would activate an element the CASTER hasn't
    //     activated yet (deny their win progress).
    //   - A pure response (Reflect / Unbidden Lamplight / Sigh of
    //     Recollection) is free value with no meaningful downside when
    //     used as a response (none of the three open further UI in the
    //     response path — see roadmap table), so play the cheapest one.
    //   - Otherwise pass.
    // ----------------------------------------------------------------
    function wouldGrantUnactivatedElement(rw, casterIndex) {
        const scrollData = rw.pendingScrollData;
        const def = scrollData?.spell || scrollData?.definition;
        if (!def) return false;
        const activated = window.spellSystem?.playerScrolls?.[casterIndex]?.activated;
        if (!activated) return false;
        if (def.element === 'catacomb' && def.patterns?.[0]) {
            return def.patterns[0].some(pos => !activated.has(pos.type));
        }
        return def.element ? !activated.has(def.element) : false;
    }

    function decideResponse(responderIndex, casterIndex) {
        const rw = window.spellSystem?.responseWindow;
        if (!rw || !rw.isResponseWindowOpen) return false;
        if (rw.respondingPlayers?.has(responderIndex)) return false;

        const check = rw.canPlayerRespond(responderIndex);
        if (!check.canRespond || check.validScrolls.length === 0) {
            log(`Player ${responderIndex}: passing (${check.reason || 'nothing to play'})`);
            rw.playerPasses(responderIndex);
            return true;
        }

        const counters = check.validScrolls.filter(s => s.isCounter);
        const responses = check.validScrolls.filter(s => !s.isCounter && s.isResponse);

        let choice = null;
        // A response or counter of an element this bot still needs activates
        // it (multiplayer-state.js scroll-resolved): take that first.
        let needed = [];
        try {
            const ps = window.spellSystem?.playerScrolls?.[responderIndex];
            const won = ps?.activated ? [...ps.activated] : [];
            needed = check.validScrolls.filter(sc => {
                const el = window.SCROLL_DEFINITIONS?.[sc.name]?.element;
                return el && !won.includes(el) && ((window.stonePools?.[el] ?? 0) > 0);
            });
        } catch (e) { needed = []; }
        // Counters against the leader (owner, 2026-09-28). Psychic first: it
        // also steals the scroll for this bot's own turn.
        const pickCounter = () => counters.find(c => c.name === 'VOID_SCROLL_1') ||
            counters.reduce((a, b) => (a.cost <= b.cost ? a : b));
        const grantsNew = counters.length > 0 && wouldGrantUnactivatedElement(rw, casterIndex);
        const D = window.BotDiplomacy;
        const smart = !!D?.enabled?.();
        let finalBlow = false, isTarget = false;
        if (grantsNew) {
            try {
                // Would this cast give the caster their LAST missing element?
                const def = rw.pendingScrollData?.spell || rw.pendingScrollData?.definition;
                const won = [...(window.spellSystem?.playerScrolls?.[casterIndex]?.activated || [])];
                const miss = ['earth', 'water', 'fire', 'wind', 'void'].filter(el => !won.includes(el));
                const gives = def?.element === 'catacomb' ? new Set((def.patterns?.[0] || []).map(c => c.type)) : new Set([def?.element]);
                finalBlow = miss.length > 0 && miss.every(el => gives.has(el));
                const seats = (typeof playerPositions !== 'undefined' ? playerPositions : []).filter(Boolean).length;
                isTarget = seats === 2 || (smart && (D.coalitionTarget(responderIndex) === casterIndex || D.alertOn(responderIndex) === casterIndex));
            } catch (e) {}
        }
        if (grantsNew && finalBlow) {
            choice = pickCounter();                              // stop the winning cast
        } else if (needed.length > 0) {
            choice = needed.reduce((a, b) => (a.cost <= b.cost ? a : b));
        } else if (grantsNew && (isTarget || !smart)) {
            choice = pickCounter();                              // the leader / the only opponent
        } else if (responses.length > 0) {
            choice = responses.reduce((a, b) => (a.cost <= b.cost ? a : b));
        }

        if (choice) {
            log(`Player ${responderIndex}: responding with ${choice.name}`);
            if (choice.name === 'VOID_SCROLL_1' || choice.name === 'EARTH_SCROLL_1') {
                try { window.BotDiplomacy?.intend?.(responderIndex, 'counter', casterIndex); } catch (e) {}
            }
            rw.playerResponds(choice, responderIndex);
        } else {
            log(`Player ${responderIndex}: passing (nothing worth playing)`);
            rw.playerPasses(responderIndex);
        }
        return true;
    }

    // ----------------------------------------------------------------
    // Excavate (CATACOMB_SCROLL_4) — deferred to the start of the caster's
    // NEXT turn, two steps:
    //   1. excavate-teleport-modal: "Teleport" or "Stay Here" prompt.
    //      Teleporting is free with no real downside (repositioning to
    //      anywhere already-revealed), so always take it.
    //   2. excavate-teleport selectionMode: handleHexClick(hexPos) — same
    //      shape as tile-flip/tile-swap. Candidate hexes come from
    //      BotState.hexGrid(), filtered to the same rule
    //      handleHexClick() itself enforces (revealed non-player tile, no
    //      stone, no player) so nothing gets offered that would just be
    //      rejected. Heuristic: closest candidate to whatever the bot
    //      would already be aiming for — home if all 5 elements are
    //      activated, else the nearest hidden tile to keep exploring.
    //      (Can't land ON a player tile at all — handleHexClick excludes
    //      them — so this can't double as an instant win the way walking
    //      home can; it's pure repositioning.)
    // ----------------------------------------------------------------
    function driveExcavateTeleportModal() {
        const modal = document.getElementById('excavate-teleport-modal');
        if (!modal) return false;
        const btn = [...modal.querySelectorAll('button')].find(b => b.textContent === 'Teleport');
        if (!btn) return false;
        btn.click();
        return true;
    }

    function driveExcavateTeleport(se, sm) {
        const s = snap();
        const me = self(s);
        if (!me) return false;
        const grid = window.BotState?.hexGrid?.() || [];
        const candidates = grid.filter(h => {
            if (!h.tiles || !h.tiles.some(t => !t.flipped && !t.isPlayerTile)) return false;
            if (typeof placedStones !== 'undefined' && placedStones.some(st => dist(st, h) < 5)) return false;
            if (typeof playerPositions !== 'undefined' && playerPositions.some(p => p && dist(p, h) < 5)) return false;
            return true;
        });
        if (!candidates.length) return false;

        let goal = null;
        if (ELEMENTS.every(el => me.activated.includes(el))) {
            goal = s.tiles.find(t => t.isPlayerTile && t.playerIndex === s.turn.activePlayerIndex);
        } else {
            const hidden = s.tiles.filter(t => !t.revealed && !t.isPlayerTile);
            goal = hidden.length ? hidden.reduce((a, b) => (!a || dist(me, b) < dist(me, a)) ? b : a, null) : null;
        }
        const best = goal
            ? candidates.reduce((a, b) => (!a || dist(goal, b) < dist(goal, a)) ? b : a, null)
            : candidates[0];
        sm.handleHexClick(best);
        return true;
    }

    // ----------------------------------------------------------------
    // Take Flight (WIND_SCROLL_4) — two steps:
    //   1. take-flight-player-modal: pick a target. v1 ALWAYS targets
    //      SELF — the scroll always stays in the caster's active area
    //      regardless of target (no hand-vs-active tradeoff to weigh), but
    //      opponent-targeting is still skipped in v1: modeling "is it worth
    //      spending this to reposition an opponent" is out of scope for v1.
    //   2. Drag-drop: NOT a selectionMode.handleXClick() — the real drop
    //      handler (game-ui.js) does double duty: it moves the pawn itself
    //      (placePlayer() for self, movePlayerVisually() for an opponent)
    //      AND THEN calls window.takeFlightState.onComplete(x, y), which
    //      only finalizes the broadcast. Mirror BOTH calls exactly —
    //      onComplete alone would leave the pawn never actually moved.
    //      Destination must be an unoccupied hex on a tile currently
    //      occupied by ANOTHER player (not a player tile) — the same rule
    //      ScrollEffects.getValidTakeFlightDestinations() enforces for
    //      humans, reused here so the bot never proposes a drop the handler
    //      would reject. driveTakeFlightDrag() resolves ANY open
    //      take-flight-drag selection, not just self-targeted ones — in
    //      local/arena play (isMultiplayer false) an opponent-target cast
    //      still drives the drag on the SAME page, so this also stands in
    //      for a bot-controlled opponent's choice (see the roll below). Real
    //      multiplayer opponent-targeting a bot-controlled remote seat is
    //      NOT covered: bots here aren't separate network clients, so
    //      nothing answers a 'take-flight-choose-request' sent to one.
    // ----------------------------------------------------------------
    function driveTakeFlightPlayerModal() {
        const modal = document.getElementById('take-flight-player-modal');
        if (!modal) return false;
        // A stuck bot casts Take Flight to move an opponent off a shrine it
        // needs (bot.js stuckTools); otherwise it moves itself.
        const st = window.BotSystem?.stuckTools?.();
        const buttons = [...modal.querySelectorAll('button')];
        const off = st?.stuck && st.occupiers?.length
            ? buttons.find(b => b.dataset.playerIndex != null && st.occupiers.includes(Number(b.dataset.playerIndex)))
            : null;
        const btn = off || buttons.find(b => b.textContent.includes('(you)'));
        if (!btn) return false;
        btn.click();
        return true;
    }

    // Shared with bot-sim.js's simEffectTakeFlight (mirrored there, not
    // called directly — bot-sim is DOM/globals-free by design). Picks the
    // candidate hex closest to the mover's own next objective: their home
    // tile once all 5 elements are activated, else the nearest hidden tile.
    function _bestTakeFlightDestination(candidates, mover) {
        const s = snap();
        let goal = null;
        if (ELEMENTS.every(el => mover.activated.includes(el))) {
            goal = s.tiles.find(t => t.isPlayerTile && t.playerIndex === mover.index);
        } else {
            const hidden = s.tiles.filter(t => !t.revealed && !t.isPlayerTile);
            goal = hidden.length ? hidden.reduce((a, b) => (!a || dist(mover, b) < dist(mover, a)) ? b : a, null) : null;
        }
        return goal
            ? candidates.reduce((a, b) => (!a || dist(goal, b) < dist(goal, a)) ? b : a, null)
            : candidates[0];
    }

    function driveTakeFlightDrag() {
        const tf = window.takeFlightState;
        if (!tf || !tf.active) return false;

        const s = snap();
        const target = s.players[tf.targetPlayerIndex];
        if (!target) return false;
        const se = window.spellSystem?.scrollEffects;
        const candidates = se?.getValidTakeFlightDestinations
            ? se.getValidTakeFlightDestinations(tf.targetPlayerIndex)
            : [];
        if (!candidates.length) return false;

        // Same "closest to whatever the bot is already aiming for" heuristic
        // driveExcavateTeleport uses: home if all 5 elements are activated,
        // else the nearest hidden tile to keep exploring. This can NEVER
        // double as an instant win the way Excavate's own note once implied
        // — getValidTakeFlightDestinations() excludes every player-tile hex
        // outright (isPositionOnPlayerTile), matching the scroll's own rule
        // text ("Cannot target player tiles"); pure repositioning, same as
        // Excavate. (docs/bot-roadmap.md has a stale line claiming otherwise
        // — worth fixing separately.) Previously rolled a random valid
        // destination — no snapshot-only simulation could ever honestly
        // claim to match a nondeterministic pick, so this was also blocking
        // bot-sim.js from simulating the cast at all.
        const c = takeChoice('WIND_SCROLL_4');
        const chosen = (c && c.x != null && tf.targetPlayerIndex === activePlayerIndex)
            ? candidates.find(h => Math.hypot(h.x - c.x, h.y - c.y) < 5) : null;
        const dest = chosen || _bestTakeFlightDestination(candidates, target);

        if (tf.targetPlayerIndex === activePlayerIndex) {
            placePlayer(dest.x, dest.y);
        } else if (typeof movePlayerVisually === 'function') {
            movePlayerVisually(tf.targetPlayerIndex, dest.x, dest.y, 0);
        }
        tf.onComplete(dest.x, dest.y);
        return true;
    }

    // ----------------------------------------------------------------
    // Telekinesis (VOID_SCROLL_2) — drag-only with no handleXClick()/
    // onComplete() API like everything else here; the real move logic
    // lives inline in game-ui.js's mouseup handler, coupled to raw
    // drag-state module variables (draggedTileId/Rotation/Flipped/
    // ShrineType/OriginalPos, ghostTile, isDraggingTile) instead of one
    // callable function. Mirrors that exact sequence instead of
    // reimplementing it: startTileDrag() (pickup — removes the tile from
    // placedTiles + DOM, same as a human's mousedown) then placeTile()
    // with the SAME tile id (drop — re-adds it at the new position via
    // findNearestSnapPoint(), which already enforces Telekinesis's
    // "must touch 2+ other tiles" rule internally whenever
    // window.telekinesisState.active is true — see game-core.js), plus
    // the move-counter/broadcast bookkeeping the real mouseup handler
    // does inline since there's no separate function for it.
    // No clear strategic value model for WHICH tile to move or where —
    // same reasoning driveTileSwap already uses for Shifting Sands — so
    // v1 picks the least-disruptive relocation: an eligible tile (not
    // stoned, not occupied by a player, not a bridge — the same
    // eligibility the real drag-start handler enforces) moved to an empty
    // slot immediately adjacent to its OWN current position. An interior
    // tile deep in the cluster never HAS a free adjacent slot (that's
    // what makes it interior) — dry-run the destination check for every
    // eligible tile first (findNearestSnapPoint is side-effect-free, safe
    // to call before committing to a real pickup) and only start the
    // actual drag once a tile+destination pair is found; the first
    // eligible tile alone is not a safe assumption in a compact cluster.
    // MAX_MOVES is always 1 today, but this reads movesLeft generically
    // (like the real handler) rather than assuming that.
    // ----------------------------------------------------------------
    function driveTelekinesis(se, sm) {
        if (!window.telekinesisState?.active) return false;

        const eligible = (se.getEligibleTilesForSwap() || []).filter(t =>
            !tileHasStones(t.id) && !tileHasPlayersById(t.id) && !tileIsBridge(t.id));
        if (!eligible.length) { window.finishTelekinesis?.(); return true; }

        const largeHexSize = TILE_SIZE * 4;
        const offsets = [[1, 0], [0, 1], [-1, 1], [-1, 0], [0, -1], [1, -1]];
        let tile = null, destination = null;
        // A chosen move (tile + slot next to the pawn's tile) wins when the
        // real snap check accepts that exact slot.
        const c = takeChoice('VOID_SCROLL_2');
        const ct = c && eligible.find(t => Number(t.id) === Number(c.tileId));
        if (ct) {
            const snapResult = findNearestSnapPoint(c.x, c.y, false, ct.id);
            if (snapResult.snapped && Math.hypot(snapResult.x - c.x, snapResult.y - c.y) < 5) {
                tile = ct; destination = { x: snapResult.x, y: snapResult.y };
            }
        }
        if (!destination) for (const t of eligible) {
            const hex = pixelToHex(t.x, t.y, largeHexSize);
            for (const [dq, dr] of offsets) {
                const p = hexToPixel(hex.q + dq, hex.r + dr, largeHexSize);
                // excludeTileId=t.id: t hasn't been picked up yet at this point, so
                // without this it would count itself as a neighbor of its own
                // about-to-be-vacated position and pass the touch-count check
                // regardless of whether the destination has any OTHER real neighbor.
                const snapResult = findNearestSnapPoint(p.x, p.y, false, t.id);
                if (snapResult.snapped) { tile = t; destination = { x: snapResult.x, y: snapResult.y }; break; }
            }
            if (destination) break;
        }
        if (!destination) return false; // every eligible tile is boxed in — genuinely nothing to do

        startTileDrag(tile.id, { clientX: 0, clientY: 0 });
        const originalPos = draggedTileOriginalPos; // capture before it's nulled below
        placeTile(destination.x, destination.y, draggedTileRotation, draggedTileFlipped, draggedTileShrineType, false, false, draggedTileId);

        if (ghostTile) { ghostTile.remove(); ghostTile = null; }
        isDraggingTile = false;
        draggedTileId = null;
        draggedTileOriginalPos = null;

        if (window.telekinesisState) {
            window.telekinesisState.movesLeft--;
            window.telekinesisState.movedTiles.push(tile.id);
            const doneBtn = document.getElementById('telekinesis-done-btn');
            if (doneBtn) {
                const movesDone = window.telekinesisState.maxMoves - window.telekinesisState.movesLeft;
                doneBtn.textContent = `Done (${movesDone}/${window.telekinesisState.maxMoves})`;
            }
            if (typeof isMultiplayer !== 'undefined' && isMultiplayer && typeof broadcastGameAction === 'function') {
                broadcastGameAction('telekinesis-move', {
                    tileId: tile.id, newPos: destination, oldPos: originalPos, movedPlayers: []
                });
            }
            if (window.telekinesisState.movesLeft <= 0) window.finishTelekinesis?.();
        }
        return true;
    }

    // ----------------------------------------------------------------
    // Public entry point (selection modes / Create / Scholar's Insight).
    // Inspects whatever selection UI is CURRENTLY open and drives exactly
    // one step of it; the caller (bot.js waitForQuiescence) polls, so a
    // multi-step flow (Scholar's Insight, tile-swap's two clicks) resolves
    // across a couple of ticks naturally. Returns true if it acted, false
    // if nothing here recognizes the open UI (caller falls back to
    // cancelSelectionMode()). Transmute and response scrolls are driven
    // separately (driveTransmute/decideResponse) since they're detected and
    // called from different points in waitForQuiescence().
    // ----------------------------------------------------------------
    function driveSelection() {
        const se = window.spellSystem?.scrollEffects;
        if (!se) return false;

        const sm = se.selectionMode;
        let acted = false, kind = null;
        // NOTE: modal checks are independent of the selectionMode switch, not
        // "else" branches — Scholar's Insight (and others) set BOTH a
        // selectionMode (cleanup-only, type:'scholars-insight') AND a DOM
        // modal at the same time, so chaining these as else-if would let the
        // switch's default:break silently swallow it before the modal check
        // ever ran (found via arena testing: Scholar's Insight was always
        // falling through to cancel despite driveScholarsInsight() existing).
        switch (sm?.type) {
            case 'tile-flip':          acted = driveTileFlip(se, sm); kind = 'tile-flip'; break;
            case 'scorched-earth':     acted = driveScorchedEarth(se, sm); kind = 'scorched-earth'; break;
            case 'tile-swap':          acted = driveTileSwap(se, sm); kind = 'tile-swap'; break;
            case 'tile-element-change': acted = driveWanderingRiver(se, sm); kind = 'wandering-river'; break;
            case 'water-transform':    acted = driveWaterTransform(se, sm); kind = 'water-transform'; break;
            case 'excavate-teleport':  acted = driveExcavateTeleport(se, sm); kind = 'excavate-teleport'; break;
            case 'take-flight-drag':   acted = driveTakeFlightDrag(); kind = 'take-flight'; break;
            case 'telekinesis':        acted = driveTelekinesis(se, sm); kind = 'telekinesis'; break;
            default: break;
        }
        if (!acted && document.getElementById('create-stone-modal')) {
            acted = driveCreateModal(); kind = 'create';
        }
        if (!acted && document.getElementById('scholars-insight-modal')) {
            acted = driveScholarsInsight(); kind = 'scholars-insight';
        }
        if (!acted && document.getElementById('quick-reflexes-modal')) {
            acted = driveQuickReflexes(); kind = 'quick-reflexes';
        }
        if (!acted && document.getElementById('deck-select-modal')) {
            acted = driveDeckSelectModal(); kind = 'inspiring-draught-deck';
        }
        if (!acted && document.getElementById('scroll-select-modal')) {
            acted = driveScrollSelectModal(); kind = 'sacrificial-pyre-or-inspiring-draught-putback-or-plunder-pick';
        }
        if (!acted && document.getElementById('element-select-modal')) {
            acted = driveElementSelectModal(); kind = 'wandering-river-element';
        }
        if (!acted && document.getElementById('opponent-select-modal')) {
            acted = driveOpponentSelectModal(); kind = 'arson-opponent';
        }
        if (!acted && document.getElementById('arson-element-modal')) {
            acted = driveArsonElementModal(); kind = 'arson-element';
        }
        if (!acted && document.getElementById('plunder-player-modal')) {
            acted = drivePlunderPlayerModal(); kind = 'plunder-player';
        }
        if (!acted && document.getElementById('excavate-teleport-modal')) {
            acted = driveExcavateTeleportModal(); kind = 'excavate-prompt';
        }
        if (!acted && document.getElementById('take-flight-player-modal')) {
            acted = driveTakeFlightPlayerModal(); kind = 'take-flight-player';
        }

        if (acted) log(`Drove a ${kind} choice`);
        return acted;
    }

    window.BotEffects = { driveSelection, rankedElements, driveTransmute, decideResponse, setPendingChoice };
    log('Loaded - window.BotEffects ready (tile-flip, scorched-earth, tile-swap, Create, Scholar\'s Insight, Quick Reflexes, Sacrificial Pyre, Inspiring Draught, Wandering River, Arson, Plunder, Control the Current, Excavate, Take Flight, Telekinesis, Transmute, response scrolls)');
})();
