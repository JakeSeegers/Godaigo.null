// js/bot-elements.js — the five system-owned elemental bots.
//
// Replaces the personal "Bot Tycoon" stable. Instead of players minting,
// naming, training, capturing, and retiring arbitrary bots, there is a
// fixed roster of FIVE bots — one per element — that always sit on the
// leaderboard and fill the bot seats in multiplayer games. All five share
// ONE trainable brain (the community champion in Supabase
// `bot_champion_weights`); each elemental bot is that brain plus a gentle,
// fixed per-element weight "lean".
//
// A bot seat rolls a colour at game start (lobby.js hostStartGame,
// colorRankOrder = ['purple','yellow','red','blue','green']); the rolled
// colour picks the element. So whichever colours the humans DON'T take
// decide which elemental bots show up — no separate "which bots" logic.
//
// Load order: immediately after game-core.js, BEFORE gamification-ui.js
// (which builds its petal view from BotElements.LEAN) and lobby.js (which
// stamps elemental identity onto bot seats at game start). MUST NOT touch
// window.BotSystem at load time — bot.js loads much later.
(function () {
    'use strict';

    // Rolled player colour -> element. Matches the petal colours below and
    // GAMI_PETAL_BUNDLES' historical element colours.
    const COLOR_ELEMENT = { purple: 'void', yellow: 'wind', red: 'fire', blue: 'water', green: 'earth' };
    const ELEMENT_COLOR = {};
    for (const c in COLOR_ELEMENT) ELEMENT_COLOR[COLOR_ELEMENT[c]] = c;

    const ELEMENTS = ['earth', 'water', 'fire', 'wind', 'void'];

    // Display names (no emoji — the 🤖 prefix is added by callers). "void"
    // MUST read as "The Void Knight": the Void Knight is now simply the
    // void-element member of the roster, and existing reserved-name checks
    // key off /void\s*knight/i. Keep each <= 24 chars (deployed_bots.nickname
    // CHECK constraint).
    const NAMES = {
        earth: 'Terran Sentinel',
        water: 'Tidewarden',
        fire:  'Emberkin',
        wind:  'Galewalker',
        void:  'The Void Knight',
    };

    const PETAL_COLORS = { earth: '#69d83a', water: '#5894f4', fire: '#ed1b43', wind: '#ffce00', void: '#9458f4' };

    // Per-element weight-key DIRECTIONS (+1 nudge up, -1 nudge down), lifted
    // verbatim from the pre-validated bundles in docs/bot-tycoon-proposal.md
    // § ELEMENTAL WEIGHT-BUNDLE ITEMS. This is now the single source — the
    // petal view (gamification-ui.js) reads it from here.
    const LEAN = {
        earth: { placeEarthBlock: 1, placeSelfBlockPenalty: 1, moveFixation: 1, moveExploreGradient: -1, moveExplore: -1, placeProgress: 1, castBase: 1 },
        water: { evalOpponentThreat: 1, evalCommonThreat: 1, discardResponseOnly: 1 },
        fire:  { placeFireThreatBreak: 1, evalActivated: -1, endTurnOnShrine: -1, moveReturnHome: 1 },
        wind:  { placeWindPath: 1, moveExplorePath: 1, placeEarthBlock: -1, placeFireThreatBreak: -1 },
        void:  { searchDepth: 1, searchBreadth: 1, evalVoidHeld: 1, shrineVoidBonus: 1 },
    };

    // How hard the lean pushes. Gentle on purpose: every overlay is a
    // RELATIVE nudge off the same champion base, so all five stay within a
    // few % of each other in strength. Tune after playtest.
    const GENTLE = 0.18;

    // Discrete "Bot Brain" knobs — never scaled as magnitudes (bot.js
    // applyBrainPreference() and bot-arena.js mutate() both treat these
    // specially). Void's lean lists them for flavour but the overlay skips
    // them; the local player's Bot Brain choice still wins.
    const DISCRETE = { searchDepth: 1, searchBreadth: 1, searchHybrid: 1 };

    function elementalOverlay(base, element) {
        const dirs = LEAN[element] || {};
        const out = Object.assign({}, base || {});
        for (const k in dirs) {
            if (DISCRETE[k]) continue;
            if (typeof out[k] !== 'number') continue;
            out[k] = out[k] * (1 + dirs[k] * GENTLE);
        }
        return out;
    }

    function baseBrain() {
        const bs = window.BotSystem;
        return (bs && (bs.WEIGHTS || bs.DEFAULT_WEIGHTS)) || {};
    }

    // ---- Runtime resolution of the five deployed_bots row ids ----
    // The rows are seeded once in Supabase (owner = NULL = system-owned).
    // We resolve their ids by nickname on demand and cache — no hardcoded
    // ids, so a fresh DB or a re-seed just works. idFor()/elementForId() are
    // best-effort: null until resolveIds() has resolved at least once.
    let _idByElement = null;   // { earth: <id>, ... } once resolved
    let _resolving = null;

    function resolveIds(force) {
        if (_idByElement && !force) return Promise.resolve(_idByElement);
        if (_resolving && !force) return _resolving;
        _resolving = (async function () {
            try {
                if (typeof supabase === 'undefined' || !supabase || !supabase.from) return _idByElement;
                const names = ELEMENTS.map(function (e) { return NAMES[e]; });
                const res = await supabase.from('deployed_bots').select('id, nickname, owner').in('nickname', names);
                if (res.error || !res.data) return _idByElement;
                const byName = {};
                res.data.forEach(function (row) {
                    // Prefer a system-owned (owner === null) row if duplicates exist.
                    if (byName[row.nickname] == null || row.owner == null) byName[row.nickname] = row.id;
                });
                const map = {};
                ELEMENTS.forEach(function (e) { if (byName[NAMES[e]] != null) map[e] = byName[NAMES[e]]; });
                if (Object.keys(map).length) _idByElement = map;
            } catch (e) { /* offline — keep whatever we had */ }
            return _idByElement;
        })();
        return _resolving;
    }

    function idFor(element) { return _idByElement && _idByElement[element] != null ? _idByElement[element] : null; }
    function elementForId(id) {
        if (!_idByElement) return null;
        for (const e in _idByElement) if (_idByElement[e] === id) return e;
        return null;
    }
    function isElementalId(id) { return elementForId(id) != null; }

    window.BotElements = {
        COLOR_ELEMENT: COLOR_ELEMENT,
        ELEMENT_COLOR: ELEMENT_COLOR,
        ELEMENTS: ELEMENTS,
        NAMES: NAMES,
        PETAL_COLORS: PETAL_COLORS,
        LEAN: LEAN,
        GENTLE: GENTLE,
        elementalOverlay: elementalOverlay,
        baseBrain: baseBrain,
        resolveIds: resolveIds,
        idFor: idFor,
        elementForId: elementForId,
        isElementalId: isElementalId,
        get idMap() { return _idByElement; },
    };

    // Kick off resolution early (non-blocking) so the leaderboard / lobby
    // paths usually have the ids by the time they need them.
    try { resolveIds(); } catch (e) {}
})();
