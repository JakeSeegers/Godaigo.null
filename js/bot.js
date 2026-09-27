// ============================================================
// bot.js — Stage 1 utility bot for Godaigo (docs/bot-roadmap.md)
// ============================================================
// HOW TO USE:
//   Shift+R  → execute ONE bot action for the active player
//   Shift+B  → play out the WHOLE turn (loops actions until end of turn)
//   Console  → window.BotSystem.step() / .turn() / .rank() / .WEIGHTS
//
// HOW IT DECIDES (Stage 1 of the roadmap — no lookahead yet):
//   1. BotState.legalActions() enumerates every legal action
//   2. scoreAction() gives each a utility: Σ weight × feature
//   3. argmax wins. All strategy knobs live in WEIGHTS — tune the table,
//      not the code. Stage 3a evolution writes better weights to
//      localStorage['godaigo_bot_weights'], loaded over defaults at startup.
//
// Observation/actuation is bot-state.js (window.BotState). This file must
// never touch game internals directly except through BotState + snapshot.
//
// LOAD ORDER: after bot-state.js (which is after lobby.js)
// ============================================================

(function () {
    'use strict';

    function log(...args) { console.log('🤖 [Bot]', ...args); }

    const ELEMENTS = ['earth', 'water', 'fire', 'wind', 'void'];
    const POOL_CAP = 5;

    // ----------------------------------------------------------------
    // WEIGHTS — the single tuning surface. Stage 3a evolves this table.
    // Positive = more attractive. Rough scale: 100 ≈ "clearly best action".
    // ----------------------------------------------------------------
    const DEFAULT_WEIGHTS = {
        // casting
        castBase:          100,  // any satisfied pattern is usually worth firing
        castUnactivated:    80,  // scroll element not yet activated (win progress!)
        castDeadElement:   -60,  // source pool empty → effect fires but NO win credit
        castAlreadyWon:    -120, // element already activated — no win-condition value left;
                                 // without this the bot loops forever re-casting a satisfied
                                 // pattern instead of exploring for the elements it still needs
        castNoCredit:     -500,  // this exact scroll was cast before and its special effect
                                 // cancelled without granting win credit (e.g. Sacrificial
                                 // Pyre with an empty hand) — hard veto, same magnitude as
                                 // placeNoCredit, so a still-"unactivated" element can't lure
                                 // the bot into recasting a known no-op (see trackCastCredit())
        castLevel:           2,  // per scroll level — mild preference for big scrolls

        // stone placement toward a pattern
        placeBase:          20,
        placeProgress:      45,  // × fraction of the variant complete AFTER this stone
        placeUnactivated:   25,  // building toward an unactivated element
        placeNoCredit:    -500,  // this scroll can never grant win credit again (element
                                 // already activated, or its source pool is empty) — hard
                                 // veto, same magnitude/philosophy as placeDoomed below,
                                 // so it reliably beats out move/endTurn regardless of
                                 // weight evolution drift (see hasWinCredit())
        placeDoomed:      -500,  // the stone would be destroyed on placement (non-fire/
                                 // non-void next to an unvoided fire) — pure stone waste
        placeVoidSpendPenalty: -8, // placing a void stone spends it out of the pool,
                                 // forfeiting its standing AP bonus (voidAP = pool.void
                                 // at turn start, game-core.js) — only bites in greedy/
                                 // Dumb-brain mode; under Hybrid/search this same
                                 // opportunity cost falls naturally out of evalVoidHeld
                                 // scoring the resulting simulated snapshot lower (see
                                 // evaluateSnapshot() below), so this is a redundant but
                                 // harmless mirror for the non-search fallback path.
        // ── Stage 4: elemental stone tactics (terrain control) ──
        // bot-state.js also enumerates TACTICAL (scroll:null) placeStone
        // candidates — earth/wind/fire on empty hexes adjacent to the pawn,
        // the same freedom a human's drag-drop has. They score
        // placeTacticalBase (slightly negative: never attractive on their
        // own) plus whichever terms below fire; the same terms ALSO apply
        // to pattern-dictated placements (the roadmap's "tie-break between
        // options already on the table"). All membership checks hit sets
        // cached ONCE per decision in tacticalContext() — never per search
        // leaf (the roadmap's scoped design: root-only heuristic).
        placeTacticalBase:   -4,
        placeEarthBlock:     45, // × opponents whose cached cheapest path to their
                                 // next objective (needed shrine, or home when all
                                 // 5 are activated) crosses this hex — earth blocks
                                 // movement outright (canPlayerMoveToHex)
        placeSelfBlockPenalty: -40, // earth on the bot's OWN objective path — don't
                                 // wall yourself in while building or blocking
        placeShrineDeny:     40, // × opponents heading for a shrine centre this stone covers
                                 // (they can't collect there until it's broken)
        placeWaterChain:     12, // water on the bot's OWN objective path that would
                                 // chain to wind: it copies wind (free movement)
                                 // and is much cheaper than wind (owner, 2026-09-27)
        placeWindPath:       12, // wind on the bot's OWN objective path — moving
                                 // over wind is free (cost 0), so a corridor stone
                                 // dropped ahead pays back AP on every traversal;
                                 // low enough that a directly useful move/cast
                                 // still wins, high enough to beat a do-nothing
                                 // endTurn with leftover stones (the "pave the
                                 // road before ending the turn" behavior)
        placeFireThreatBreak: 70, // × opponent-threat stones this fire placement
                                 // destroys on landing (threat = a stone inside a
                                 // currently-satisfied pattern an opponent could
                                 // cast RIGHT NOW: common-area scrolls or their
                                 // public active area, anchored at their standing
                                 // position). Complements evalCommonThreat: that
                                 // term only sees common-area scrolls and only
                                 // under search — this one also covers opponents'
                                 // active scrolls and the greedy/Dumb brain.
        placeTacticalStarvesPlan: -500, // hard veto (same magnitude as placeNoCredit):
                                 // a tactical spend that would leave the pool short
                                 // of what the active build plan still needs of
                                 // that stone type

        planDeficitPenalty:  -3, // × total stones still missing from pool when makePlan()/
                                 // findFixationTarget() pick a COLLECT-THEN-BUILD plan (one
                                 // whose pattern isn't fully in-pool yet, but every missing
                                 // type has a shrine somewhere reachable — see
                                 // deficitIsCollectible()). Small discount, not a veto: a
                                 // plan that needs a detour to collect is slower/riskier
                                 // than one buildable right now, but still far better than
                                 // no plan at all (the entire point of collect-then-build).

        // movement
        moveBase:            2,
        moveShrineValue:    30,  // × (target shrine value ÷ (1 + remaining path cost))
        moveApPenalty:      -1,  // × step cost — cheap steps preferred
        moveExplore:        18,  // step lands on an unrevealed tile (reveals it — draws a scroll)
        moveExploreGradient: 0.15, // × px closed toward the nearest unrevealed tile (euclidean fallback)
        moveExplorePath:    60,  // ÷ (1 + remaining path cost) when the step is the first hop of the
                                 // actual cheapest PATH to a hidden tile. The euclidean gradient alone
                                 // freezes the bot in cul-de-sacs: every legal move increases
                                 // straight-line distance even when it's the only way out (observed:
                                 // 100% draws in 2-player arena games — both bots parked forever)
        moveRevisitPenalty: -60,  // ÷ steps-since-visited (see revisitPenalty()) — breaks
                                  // ties that would otherwise oscillate forever (e.g. two
                                  // hexes exactly equidistant from the only remaining
                                  // unrevealed tile have IDENTICAL scores with nothing
                                  // else to prefer one over the other); weighted by
                                  // recency so undoing your immediately previous move is
                                  // penalized far more than a revisit from several steps back
        moveFixation:      150,  // ÷ (1 + remaining path cost) when the step is the first hop
                                 // toward a findFixationTarget() hex — a REVEALED tile
                                 // elsewhere on the board where an uncast-element pattern is
                                 // buildable. Only computed when the turn-repeat circuit
                                 // breaker is armed (see turnRepeatStreak) — stronger than
                                 // moveExplorePath so it reliably wins over a stale local
                                 // loop, but still just one term in normal scoring (not a
                                 // scripted override): a genuinely better action found by the
                                 // same scoring pass — a cast, a richer shrine — can still win.

        // catacomb/Freedom teleport — free (0 AP) hop from a catacomb tile
        // (or, under Freedom, any elemental shrine) to an ELEMENTAL shrine
        // centre (see bot-state.js's legalActions()). EXPLORATION: catacomb
        // tiles no longer link to each other, so every teleport destination
        // is now an elemental shrine.
        teleportBase:        5,  // small flat nudge so an otherwise-neutral hop still
                                 // gets picked over doing nothing when nothing else applies —
                                 // it's free, so there's rarely a reason to decline one
        teleportShrineValue: 1.0, // × shrineValue(destination) — every teleport destination
                                 // is now an elemental shrine, so this always applies. No
                                 // path-cost division like moveShrineValue gets — the hop is
                                 // free, so the full value applies, not a discounted one
        teleportRevisitPenalty: -60, // ÷ steps-since-visited (same recency decay as
                                 // moveRevisitPenalty) on the teleport DESTINATION. Teleports
                                 // are free, so with no memory of them a bot can ping-pong
                                 // between two shrines forever at zero cost — and
                                 // teleportBase is only +5, so even the decayed penalty makes
                                 // "hop straight back to where I just was" strongly negative
                                 // while a hop somewhere NEW keeps the full base nudge.
                                 // Both ends of an applied hop are recorded (see botAct) so
                                 // the immediate reversal always draws the k=1 penalty

        // breaking a stone (attemptBreakStone) — costs AP by stone rank
        // (void 1 .. earth 5). Mostly matters for clearing a path an earth
        // stone would otherwise block outright (canPlayerMoveToHex treats
        // earth as impassable without an adjacent void) — a bot with no
        // other legal move but plenty of AP should take this over stalling
        // on endTurn every turn.
        breakStoneBase:      3,
        // Alliances (docs/bot-alliances.md, owner's harm list): against the
        // coalition target (push 2+), all × push.
        breakLeaderPattern: 25,  // break a stone the leader placed last round (element it still needs)
        moveToBreak:        25,  // ÷ (1 + path cost) toward such a stone, 3 AP away at most
        moveCamp:           60,  // ÷ (1 + path cost) toward a scarce shrine the leader needs
        campLeave:         -40,  // stepping off that shrine while camping it
        endTurnCamp:        20,  // ending the turn on it
        // Helping pact partners (bots in the same pact only):
        discardForAlly:     30,  // a scroll a partner needs to the common area (the leader already has that element, I do too)
        placeAllyRoad:      15,  // × push: wind on a partner's way home once it has all five
        breakStoneApPenalty: -1,  // × AP cost — cheap breaks (void, wind) preferred over earth
        breakUnblock:        1.0, // × gain in best-goal value (shrine / hidden tile / home,
                                  // move-score scale) when the break opens or shortens the
                                  // way there; the break's AP counts as path cost (unblockBonus)
        placeUnblock:        1.0, // same, for a fire that burns a blocking stone or a void
                                  // that makes an earth wall walkable (no AP, costs the stone)
        placeFireOwnPlanLoss: -60, // × build-plan stones that fire would burn too

        // Breath of Power's moveStone action (free, repeatable) — a small,
        // rarely-decisive nudge (mostly useful for clearing a hex the pawn
        // wants to step onto, or dodging a stone about to be destroyed) so
        // it isn't hard-vetoed like an unhandled action type, but doesn't
        // compete with anything that has real pattern/AP value either.
        moveStoneBase:          1,
        moveStoneDoomedPenalty: -5, // moving a stone somewhere it'd just be fire-destroyed

        // returning home — with all 5 elements activated the win now requires
        // standing on the centre of the bot's own player tile (player shrine),
        // so walking home dominates everything else once the set is complete
        moveReturnHome:    400,  // × 1/(1 + remaining path cost to own shrine)

        // ending the turn
        endTurnBase:         1,  // always a legal fallback, never attractive by itself
        endTurnOnShrine:    55,  // standing on a collectible shrine centre: end = collect
        endTurnLowAp:        6,  // + when AP ≤ 1 — nothing useful left to do

        // discarding — offered forced (hand/active overflow) or voluntarily
        // (cycle a jammed slot to the common area)
        discardBase:        10,
        discardActivated:   40,  // element already won — this copy has less value
        discardDeadElement: 30,  // source pool empty — no win credit ever again
        discardLevel:       -5,  // × scroll level — prefer to KEEP higher-level scrolls
        discardVoluntary:  -20,  // extra penalty when NOT forced by overflow — only a
                                 // clearly dead scroll (already-won/dead-source) is worth
                                 // giving up a slot for; note the discard lands in the
                                 // COMMON area where opponents can cast it too
        discardResponseOnly: 25, // level-1 scrolls are response-only and the bot can't
                                 // play responses yet (Stage 2.5) — dead weight in a
                                 // 2-slot hand, cycle it out

        // Stage 2.5: Transmute (Fire IV) target — discard stones for AP
        // until currentTotalAP reaches this (capped at the real max, 5 +
        // void pool), preferring the stone type held in greatest excess.
        transmuteTargetAP:   7,

        // placement phase: where to put the bot's starting player tile
        placeTileBase:            10,
        placeTileCentroidPenalty: -0.05, // × distance to cluster centroid — prefer compact placement

        // shrine valuation (used inside move/endTurn features)
        shrineNeed:          1.0, // × (capacity − pool[element])
        shrineUnactivated:   2.5, // element not yet activated
        shrineDeadSource:  -3.0,  // source pool empty — collection yields nothing
        shrineVoidBonus:     1.5, // × need, void shrines only — void pool stones also
                                  // grant standing AP (voidAP = pool.void each turn,
                                  // game-core.js), a benefit no other element's pool
                                  // gives, on top of the generic material value every
                                  // element already gets from shrineNeed/shrineUnactivated

        // ── Stage 2: lookahead search (BotSim forward model) ──
        // searchDepth 0 = greedy Stage-1 argmax (no BotSim needed);
        // searchDepth N ≥ 1 = depth-N beam search over own-turn actions,
        // leaves valued by evaluateSnapshot() below.
        // DEFAULT = HYBRID, per arena evidence (BotArena, 2×10 games, seeds
        // 11/23): Hybrid beat greedy 12-3 with 5 draws (80% of decided),
        // while FULL search (searchHybrid 0) LOST its series 1-3 — lookahead
        // helps at tactical decision points but its movement choices fight
        // the plan/path logic. Cheat-panel "Bot Brain" still overrides.
        searchDepth:         3,
        searchBreadth:       5,   // children expanded per node (beam width)
        searchKeepCasts:     2,   // extra cast children kept per node even when outside the
                                  // beam: a combo's first cast usually looks bad on its own
                                  // (2 AP, no gain yet), so a plain beam drops it early
        searchCastExtraDepth: 1,  // extra plies when a cast is legal at the root
        searchHybrid:        1,   // 1 = only search when a tactical choice exists
                                  // (cast/placeStone among the legal actions);
                                  // plain movement stays greedy.

        // ── Stage 2 step 5: multi-turn MCTS (docs/bot-roadmap.md — "optional,
        // not started" until mctsPick() below). searchPick() above stops the
        // instant the active player would change; mctsPick() instead rolls
        // real games forward THROUGH opponent turns via a fixed rollout
        // policy, so opponent responses actually shape which of our current
        // options looks best. OFF by default: unlike searchDepth/searchHybrid
        // this has not yet been measured at arena scale. Enable via the cheat
        // panel's Bot Brain cycle (4th step, "MCTS") or WEIGHTS.mctsEnabled =
        // true from the console; takes priority over searchDepth when on.
        // Budget: measured ~560ms/decision on a mid-game 2-tile-hand board
        // (headless Chromium) at these settings — mctsIterations/mctsHorizon
        // were cut down from an initial 60/40 guess (~4.5s/decision, far too
        // slow for real play) by timing a sweep from cheap to expensive and
        // picking the cheapest budget that still keeps the full mctsSamples=8
        // the roadmap calls "plenty" for hidden-info determinization.
        mctsEnabled:      false,
        mctsSamples:      8,     // K determinized hidden-info completions, root action majority-voted across them
        mctsIterations:   20,    // UCB1 simulations per sample
        mctsHorizon:      15,    // max actions per rollout before falling back to evaluateSnapshot()
        mctsExploration:  1.4,   // UCB1 C (exploration term)
        // Root candidates are pruned to the top mctsRootBreadth by one-ply
        // evaluateSnapshot() BEFORE UCB1 spends any iterations — see
        // mctsPick()'s own comment for why: a real position routinely offers
        // 20-40+ legal actions (every hand scroll is also a voluntary-discard
        // option, plus placeStone/cast/move), which used to silently outrun
        // mctsIterations and turn "UCB1" into "whichever action
        // legalActions() happened to enumerate first."
        mctsRootBreadth:  10,
        // rolloutStep()'s own lookahead, applied at every step of every
        // rollout (not just the root) — see the "Stage 2 step 5" block
        // comment above mulberry32() for why plain one-ply greedy here was
        // losing every decided arena game to hybrid search even after the
        // mctsRootBreadth fix. depth=2/breadth=3 costs roughly the same
        // simulate() calls per step as the old one-ply full scan did on a
        // typical branching factor (~12 vs ~20-40), so this isn't expected
        // to meaningfully slow decisions down — needs its own arena
        // confirmation once shipped, same as mctsRootBreadth did.
        mctsRolloutDepth:    2,
        mctsRolloutBreadth:  3,

        // evaluateSnapshot() — STATE value, only used when searchDepth > 0.
        // Rough scale: one activated element (400) ≫ anything else per turn.
        evalWin:        100000,   // terminal win (loss = −evalWin)
        evalActivated:     400,   // per element in the activated set
        evalStoneNeeded:    12,   // per pool stone of an unactivated, live-source element
        evalStone:           3,   // per other pool stone
        evalScrollHeld:     30,   // per held scroll whose identity is unknown (a fresh
                                  // reveal draw in the sim); known scrolls use the three below
        evalScrollCredit:   60,   // per element a held scroll is the BEST cover for (not yet
                                  // activated, stones still in the source), × how easy its
                                  // pattern is with the current pool (scrollEase, 0.2..1)
        evalScrollNoCredit: 10,   // a held scroll that can't add an element any more (already
                                  // activated, dead source, or a second scroll for the same element)
        evalScrollResponse: 15,   // a level-1 (response-only) scroll
        evalScrollUnknownEase: 0.6, // assumed ease of a drawn scroll whose identity the sim can't
                                  // know: an element-known draw (Wandering River tile) is worth
                                  // evalScrollCredit x this if that element is needed; a fully
                                  // unknown draw is the average over the five elements
        evalHandOverflow:   40,   // per scroll over the hand limit (2): it will have to be
                                  // discarded, so drawing into a full hand is not free value
                                  // (without this, bots re-cast Scholar's Insight every turn)
        comboStep:          60,   // cast that is the next step of the combo the bot is following
                                  // (Phase 4: combos mined from players' games, sql/combo-teach.sql)
        comboChoiceMatch:   20,   // + when that cast's choice matches the combo (e.g. River on a hidden tile)
        comboExtraTurns:     1,   // own turns allowed beyond the combo's length before it is dropped
        castChoiceNeed:     20,   // greedy tie-break between a scroll's choices (River / Stomp):
                                  // x scroll need of the element the choice would draw
        evalAp:              2,   // per remaining AP (own turn only)
        evalUnsimCast:      90,   // flat value per unsimulated cast in the sim trace —
                                  // the whitelist-gated stand-in for effects the
                                  // forward model honestly doesn't know (≈ castBase)
        evalHiddenDist:  -0.08,   // × px to nearest hidden tile (exploration shaping)
        evalHomeDist:     -0.6,   // × px to own shrine once all 5 elements are activated
        evalUnreachableSteps: 12, // search leaves: an unreachable home / hidden tile counts as
                                  // this many extra steps (35px each) past the straight line
        evalVoidHeld:        8,   // per void stone in pool, ON TOP of evalStoneNeeded/
                                  // evalStone above — void pool stones grant standing
                                  // AP (voidAP = pool.void each turn, game-core.js),
                                  // a persistent multi-turn benefit no other element's
                                  // pool has, regardless of whether void is activated
                                  // yet. Makes search naturally discount any simulated
                                  // action that spends void stones (BotSim.simulate()
                                  // decrements pool on placeStone) without needing a
                                  // dedicated per-action penalty.

        // Opponent-threat terms — this game has exactly one winner, so an
        // opponent's progress toward THEIR win is symmetric danger to us.
        // Deliberately scaled well below our OWN equivalent terms (0.3× and
        // 0.2× evalActivated respectively) — threat-AWARE, not
        // threat-obsessed; our own progress should still dominate. See
        // opponentProgress()/commonAreaThreat() below.
        evalOpponentThreat: 0.3,  // × the MOST-advanced opponent's own progress
                                  // score (mirrors evalActivated + evalHomeDist)
        evalCommonThreat:   80,   // flat, per live common-area scroll ANY opponent's
                                  // current board could cast right now — a "loaded
                                  // gun" distinct from their activated count, since
                                  // a scroll they haven't gotten to yet doesn't show
                                  // up there
    };

    // Evolved weights (Stage 3a) override defaults without code edits
    let WEIGHTS = { ...DEFAULT_WEIGHTS };
    try {
        const saved = JSON.parse(localStorage.getItem('godaigo_bot_weights') || 'null');
        if (saved && typeof saved === 'object') {
            WEIGHTS = { ...DEFAULT_WEIGHTS, ...saved };
            log('Loaded evolved weights from localStorage');
        }
    } catch (e) { /* corrupt save — keep defaults */ }

    // Bot Brain preference (cheat panel: click the HUD "AP" label 5×) —
    // applied LAST so it wins over both defaults and evolved/community
    // weights. Factored into a function so the async community-champion
    // fetch below can re-apply it after overwriting WEIGHTS — otherwise a
    // fetched table's own searchDepth/searchHybrid (always equal to
    // whatever the trainer's Bot Brain happened to be set to, per
    // mutate()/crossover() excluding those keys) could silently override
    // the LOCAL player's own Bot Brain choice.
    //   'dumb'   → greedy Stage-1 scoring (searchDepth 0)
    //   'smart'  → 3-ply lookahead on every action
    //   'hybrid' → lookahead only at tactical decision points
    //   'mcts'   → Stage 2 step 5 multi-turn MCTS (see mctsPick()); falls
    //              back to hybrid search underneath for anything it can't
    //              handle itself (placement phase, etc.), so searchDepth/
    //              searchHybrid are set the same as 'hybrid' here too.
    function applyBrainPreference() {
        try {
            const brain = localStorage.getItem('godaigo_bot_brain');
            if (brain === 'smart')       { WEIGHTS.searchDepth = 3; WEIGHTS.searchHybrid = 0; WEIGHTS.mctsEnabled = false; }
            else if (brain === 'hybrid') { WEIGHTS.searchDepth = 3; WEIGHTS.searchHybrid = 1; WEIGHTS.mctsEnabled = false; }
            else if (brain === 'dumb')   { WEIGHTS.searchDepth = 0; WEIGHTS.searchHybrid = 0; WEIGHTS.mctsEnabled = false; }
            else if (brain === 'mcts')   { WEIGHTS.searchDepth = 3; WEIGHTS.searchHybrid = 1; WEIGHTS.mctsEnabled = true; }
            if (brain) log(`Bot brain: ${brain}`);
        } catch (e) { /* keep whatever the weights said */ }
    }
    applyBrainPreference();

    // Best-known community champion (Supabase `bot_champion_weights`):
    // async and non-blocking — bots can act immediately with whatever
    // loaded synchronously above; if/when this resolves, it overwrites
    // WEIGHTS in place with the current champion (newest promoted row) and
    // caches it to localStorage, so a later offline load still has it.
    // Deliberately "always prefer community" (explicit design choice, see
    // planning/current.md) — this can supersede a LOCAL Start Training
    // result the moment the fetch resolves, including on the very run that
    // just produced it (which is fine: that run's own submission is very
    // likely the new best, so this just reflects it back). Silent no-op on
    // any failure (offline, RLS hiccup, table not reachable) — never blocks
    // or errors the bot on account of a background fetch.
    (async function loadCommunityChampion() {
        try {
            // Testing pin: when the player has pinned a local champion
            // (localStorage 'godaigo_bot_weights_pin' === '1', e.g. from a
            // hillclimb apply-champion.txt), do NOT let the community champion
            // overwrite it — otherwise the pinned weights they want to watch
            // get clobbered the moment this fetch resolves. Cleared by removing
            // the flag; default (unset) behavior is unchanged.
            try { if (localStorage.getItem('godaigo_bot_weights_pin') === '1') return; } catch (e) {}
            // The initialized client lives in the bare global `supabase`
            // (config.js: `const supabase = window.supabase.createClient(...)`)
            // — a top-level const does NOT attach itself to `window`, so
            // `window.supabase` stays the raw createClient factory forever.
            if (typeof supabase === 'undefined' || !supabase?.from) return;
            const { data, error } = await supabase
                .from('bot_champion_weights')
                .select('weights')
                // Current champion = newest promoted row (sql/champion-promoted.sql);
                // win_rate is only comparable within one row's own confirm.
                .order('promoted', { ascending: false })
                .order('created_at', { ascending: false })
                .limit(1);
            if (error || !data?.length || !data[0].weights || typeof data[0].weights !== 'object') return;
            Object.assign(WEIGHTS, data[0].weights);
            // A champion without formula terms must not keep stale ones
            // from an older cached table.
            if (!('terms' in data[0].weights)) delete WEIGHTS.terms;
            applyBrainPreference();
            try { localStorage.setItem('godaigo_bot_weights', JSON.stringify(WEIGHTS)); } catch (e) {}
            log('Loaded best community champion from Supabase');
        } catch (e) { /* offline / RLS / network hiccup — keep whatever loaded synchronously */ }
    })();

    // ----------------------------------------------------------------
    // Derived state helpers (read ONLY from the snapshot — never from
    // game internals, and never from hidden information)
    // ----------------------------------------------------------------
    function me(snap) { return snap.players[snap.turn.activePlayerIndex]; }

    function scrollElement(name) {
        return window.SCROLL_DEFINITIONS?.[name]?.element || null;
    }

    // Worth of collecting at a shrine of this element right now
    function shrineValue(snap, element) {
        const self = me(snap);
        if (!self) return 0;
        const need = Math.max(0, POOL_CAP - (self.pool[element] || 0));
        if (need === 0) return 0;                       // pool already full
        let v = WEIGHTS.shrineNeed * need;
        if (!self.activated.includes(element)) v += WEIGHTS.shrineUnactivated * need;
        if ((snap.sourcePool[element] || 0) <= 0) v += WEIGHTS.shrineDeadSource * need;
        if (element === 'void') v += WEIGHTS.shrineVoidBonus * need;
        return Math.max(0, v);
    }

    // Collectible shrine tiles: revealed, elemental, worth something — and
    // with a stone-free centre hex. Collection = ENDING the turn on the
    // centre, and resting on a stone is banned (isPlayerRestingOnStone), so
    // a paved centre cannot be collected from at all until the stone is
    // broken. Without this exclusion a plan's collect leg walks onto the
    // stone (transit is legal) and then retries the banned endTurn forever
    // — observed wedging arena games once Stage-4 wind paving made
    // stones-on-centres common.
    function collectibleShrines(snap) {
        return snap.tiles.filter(t =>
            t.revealed && !t.isPlayerTile &&
            ELEMENTS.includes(t.shrineType) &&
            shrineValue(snap, t.shrineType) > 0 &&
            !snap.stones.some(s => Math.hypot(s.x - t.x, s.y - t.y) < 5));
    }

    function shrineUnderfoot(snap) {
        const self = me(snap);
        if (!self) return null;
        return collectibleShrines(snap).find(t => Math.hypot(t.x - self.x, t.y - self.y) < 5) || null;
    }

    // Would casting this scroll grant NEW win credit right now? Mirrors the
    // credit calc in makePlan() (catacomb credits each unactivated COMPONENT
    // element, no source-pool guard; a single-element scroll needs its
    // element unactivated AND its source pool non-empty). Used to VETO
    // placeStone actions that can never pay off — without this, piecemeal
    // placement (outside the anchored _plan system, which already skips
    // these via its own credit check) has no way to notice a pattern is
    // pointless and loops forever feeding it stones. Observed in a BotArena
    // game: 178 placeStone actions toward an already-won WIND_SCROLL_5 in a
    // single game, the exact same class of bug castAlreadyWon fixes for the
    // cast action — that fix just never covered placeStone.
    function hasWinCredit(snap, scrollName) {
        const self = me(snap);
        if (!self) return true;
        const el = scrollElement(scrollName);
        if (el === 'catacomb') {
            const def = window.SCROLL_DEFINITIONS?.[scrollName];
            const components = [...new Set((def?.patterns?.[0] || []).map(c => c.type))];
            return components.some(c => !self.activated.includes(c));
        }
        if (!el || !ELEMENTS.includes(el)) return true; // unknown/non-elemental — don't veto
        if (mem(snap.turn.activePlayerIndex).noCreditScrolls.has(scrollName)) return false;
        return !self.activated.includes(el) && (snap.sourcePool[el] || 0) > 0;
    }

    // Verify a cast actually earned win credit — some scrolls' special
    // effects can self-cancel on an unmet precondition (e.g. Sacrificial
    // Pyre needs scrolls in hand) without erroring, so applyAction() reports
    // success while self.activated never gains the element. The plan/scoring
    // credit model only checks activated+sourcePool (see hasWinCredit,
    // makePlan) so undetected this looks identical to "still worth casting"
    // and the bot recasts the same no-op forever. Observed in a BotArena
    // game: a player stuck at 0/5 elements for 200 turns, endlessly
    // recasting FIRE_SCROLL_3 (Sacrificial Pyre) with an empty hand.
    // preSnap must be taken BEFORE the cast so "expected" reflects what the
    // scroll could still credit; called right after a successful cast apply.
    // A cast that opens a response window only resolves (and grants its
    // credit) when the window closes, so checking right away always saw "no
    // credit" and blacklisted good scrolls for the rest of the game. Such
    // checks wait here until the window is closed (flushCastCredit(), called
    // from botTurn after waitForQuiescence). A countered cast can still read
    // as no credit; bots only counter a cast that would grant an element, so
    // that stays rare.
    let _pendingCredit = null;
    function flushCastCredit() {
        if (!_pendingCredit || window.spellSystem?.responseWindow?.isResponseWindowOpen) return;
        const p = _pendingCredit;
        _pendingCredit = null;
        checkCastCredit(p.idx, p.preSnap, p.scrollName);
    }
    function trackCastCredit(idx, preSnap, scrollName) {
        flushCastCredit();
        if (window.spellSystem?.responseWindow?.isResponseWindowOpen) {
            _pendingCredit = { idx, preSnap, scrollName };
            return;
        }
        checkCastCredit(idx, preSnap, scrollName);
    }
    function checkCastCredit(idx, preSnap, scrollName) {
        const preSelf = me(preSnap);
        if (!preSelf) return;
        const def = window.SCROLL_DEFINITIONS?.[scrollName];
        const el = def?.element;
        const expected = el === 'catacomb'
            ? [...new Set((def.patterns?.[0] || []).map(c => c.type))].filter(c => !preSelf.activated.includes(c))
            : (el && ELEMENTS.includes(el) && !preSelf.activated.includes(el)) ? [el] : [];
        if (!expected.length) return; // no credit was possible anyway — nothing to learn
        const postSelf = me(window.BotState.snapshot());
        if (!postSelf) return;
        if (!expected.some(e => postSelf.activated.includes(e))) {
            mem(idx).noCreditScrolls.add(scrollName);
            log(`Cast ${scrollName} granted no win credit (effect cancelled?) - blacklisting for this game`);
        }
    }

    // ----------------------------------------------------------------
    // Stage 4 — elemental stone tactics (terrain control).
    // tacticalContext() is built ONCE per real decision (rankActions /
    // searchPick root) and NEVER per search leaf — the roadmap's scoped
    // design: leaf call volume can't afford per-opponent Dijkstra, and a
    // root tie-break doesn't pretend to model how an opponent reroutes
    // around a wall afterwards. Returns:
    //   oppPathCount: Map<hexKey, n> — how many opponents' cheapest paths
    //     to their next objective cross this hex (earth-block targeting)
    //   ownPathHexes: Set<hexKey> — the bot's own objective paths (wind
    //     corridor value; earth self-block penalty)
    //   threatStones: Set<hexKey> — stones inside a currently-satisfied
    //     pattern an opponent could cast right now (fire-interference).
    //     Only PUBLIC information: common-area scrolls + opponents' active
    //     areas — hand scroll names are hidden by design and stay that way.
    // Documented approximation: findPath's step costs come from
    // canPlayerMoveToHex, which evaluates blocking (opponent tile centres,
    // pawn occupancy) from the ACTIVE player's perspective — an opponent's
    // modelled path can differ slightly from the one they'd really take.
    // ----------------------------------------------------------------
    const hexKey = (x, y) => `${x.toFixed(1)},${y.toFixed(1)}`;

    // Cheapest path to (tx,ty), or — when the target hex itself is
    // unreachable for the active player (an opponent's home centre is
    // blocked by isOpponentTileCenter) — to the cheapest reachable hex
    // adjacent to it. For blocking purposes the approach corridor is what
    // matters, and stones can't land on a player tile anyway.
    function pathToOrNear(sx, sy, tx, ty) {
        const direct = window.BotState.findPath(sx, sy, tx, ty);
        if (direct && direct.length) return direct;
        let best = null;
        for (const h of window.BotState.hexGrid()) {
            const d = Math.hypot(h.x - tx, h.y - ty);
            if (d <= 5 || d >= 40) continue;
            const p = window.BotState.findPath(sx, sy, h.x, h.y);
            if (!p || !p.length) continue;
            const cost = p.reduce((c, s) => c + s.cost, 0);
            if (!best || cost < best.cost) best = { p, cost };
        }
        return best ? best.p : null;
    }

    function tacticalContext(snap) {
        const ai = snap.turn.activePlayerIndex;
        const self = me(snap);
        if (!self) return null;

        // Each opponent's cheapest path to their next objective: the
        // nearest shrine of an element they still need (unactivated, live
        // source, room in their pool — all public), or their home tile once
        // all 5 are activated (mirrors opponentProgress()'s model).
        const oppPathCount = new Map();
        const oppShrineTargets = new Map(); // shrine centre hexKey -> opponents heading there
        const press = window.BotDiplomacy?.pressures?.(ai) || null; // alliances Phase 2
        for (const opp of snap.players) {
            if (!opp || opp.index === ai) continue;
            const w = press ? press[opp.index] : 1; // block the leader's way harder
            let target = null;
            if (ELEMENTS.every(el => opp.activated.includes(el))) {
                target = snap.tiles.find(t => t.isPlayerTile && t.playerIndex === opp.index) || null;
            } else {
                let best = null;
                for (const t of snap.tiles) {
                    if (!t.revealed || t.isPlayerTile) continue;
                    if (!ELEMENTS.includes(t.shrineType)) continue;         // masked/catacomb — skip
                    if (opp.activated.includes(t.shrineType)) continue;
                    if ((snap.sourcePool[t.shrineType] || 0) <= 0) continue;
                    if ((opp.pool[t.shrineType] || 0) >= POOL_CAP) continue;
                    const d = Math.hypot(t.x - opp.x, t.y - opp.y);
                    if (!best || d < best.d) best = { t, d };
                }
                target = best ? best.t : null;
            }
            if (!target) continue;
            if (!target.isPlayerTile) {
                const tk = hexKey(target.x, target.y);
                oppShrineTargets.set(tk, (oppShrineTargets.get(tk) || 0) + w);
            }
            const path = pathToOrNear(opp.x, opp.y, target.x, target.y);
            if (!path) continue;
            const seenHexes = new Set();
            for (const step of path) {
                const k = hexKey(step.x, step.y);
                if (seenHexes.has(k)) continue;
                seenHexes.add(k);
                oppPathCount.set(k, (oppPathCount.get(k) || 0) + w);
            }
        }

        // The bot's OWN objective paths: home once all 5 are activated;
        // otherwise the best-value collectible shrine (same worth-÷-cost
        // shape move scoring uses) plus the nearest hidden-tile route.
        const ownPathHexes = new Set();
        // Never include a revealed TILE CENTRE hex: those are hexes the bot
        // must eventually REST on (shrine collection, catacomb teleports,
        // the home win condition) and resting on a stone is banned — paving
        // one sabotages the very objective the path leads to (observed: a
        // wind stone on the target shrine's centre wedged the collect loop).
        // Corridor hexes are where wind pays; destinations never are.
        const isTileCentre = (x, y) => snap.tiles.some(t =>
            t.revealed && Math.hypot(t.x - x, t.y - y) < 5);
        const addPath = (path) => {
            if (!path) return;
            for (const s of path) {
                if (isTileCentre(s.x, s.y)) continue;
                ownPathHexes.add(hexKey(s.x, s.y));
            }
        };
        if (ELEMENTS.every(el => self.activated.includes(el))) {
            const home = snap.tiles.find(t => t.isPlayerTile && t.playerIndex === ai);
            if (home) addPath(pathToOrNear(self.x, self.y, home.x, home.y));
        } else {
            let best = null;
            for (const t of collectibleShrines(snap)) {
                const path = window.BotState.findPath(self.x, self.y, t.x, t.y);
                if (!path || !path.length) continue;
                const cost = path.reduce((c, s) => c + s.cost, 0);
                const v = shrineValue(snap, t.shrineType) / (1 + cost);
                if (!best || v > best.v) best = { v, path };
            }
            if (best) addPath(best.path);
            // Nearest hidden-tile ring hex (their outer rings are walkable —
            // same targeting rankActions' explorePath uses)
            const rings = window.BotState.hexGrid()
                .filter(h => h.tiles?.some(t => t.flipped && !t.isPlayerTile))
                .sort((a, b) => Math.hypot(a.x - self.x, a.y - self.y) - Math.hypot(b.x - self.x, b.y - self.y));
            for (const h of rings.slice(0, 3)) {
                const path = window.BotState.findPath(self.x, self.y, h.x, h.y);
                if (path && path.length) { addPath(path); break; }
            }
        }

        // Opponent "loaded guns": every stone participating in a pattern
        // variant an opponent could cast right now, anchored at their
        // current position (patterns are relative to the caster's hex).
        // Mirrors BotSim.checkPattern()'s math, but keeps the matched cells
        // instead of collapsing to a boolean.
        const threatStones = new Set();
        for (const opp of snap.players) {
            if (!opp || opp.index === ai) continue;
            const castable = new Set([...(opp.active || []), ...(snap.commonArea || [])]);
            for (const name of castable) {
                const def = window.SCROLL_DEFINITIONS?.[name];
                if (!def || def.level === 1 || !Array.isArray(def.patterns)) continue;
                for (const variant of def.patterns) {
                    const matched = [];
                    let ok = true;
                    for (const req of variant) {
                        const off = hexToPixel(req.q, req.r, TILE_SIZE);
                        const s = snap.stones.find(st =>
                            st.type === req.type &&
                            Math.hypot(st.x - (opp.x + off.x), st.y - (opp.y + off.y)) < 5);
                        if (!s) { ok = false; break; }
                        matched.push(s);
                    }
                    if (ok) for (const s of matched) threatStones.add(hexKey(s.x, s.y));
                }
            }
        }

        return { oppPathCount, ownPathHexes, threatStones, oppShrineTargets };
    }

    // ----------------------------------------------------------------
    // Ranged placement targets. While a range buff is live (Avalanche: any
    // stone anywhere; Seed the Skies: water/wind anywhere; Mason's Savvy:
    // earth within 5 hexes) the tactical uses of a stone reach the whole
    // board, not just the hexes next to the pawn. Returns candidate hexes
    // with the stone types that make sense there; bot-state.js and bot-sim.js
    // filter them by range, validity and the stones actually held, and
    // tacticalPlaceBonus()/unblockBonus() score them like any placement.
    //   opponent path hexes      earth (wall), water (slow)
    //   own route hexes          wind (free movement)
    //   next to a threat stone   fire (burn a pattern an opponent could cast)
    //   next to an earth/water   fire, void (clear the way)
    //   shrine centre an opponent is heading to   earth, water, wind, fire (deny)
    // Cached for the current board (pawn position + stones).
    // ----------------------------------------------------------------
    let _rangedCache = { key: null, list: null };
    function rangedTargets(snap) {
        const self = me(snap);
        if (!self) return [];
        const key = `${snap.turn.activePlayerIndex}|${self.x},${self.y}|` + snap.stones.map(s => s.type[0] + Math.round(s.x) + ',' + Math.round(s.y)).join(';');
        if (_rangedCache.key === key) return _rangedCache.list;
        const tac = tacticalContext(snap);
        const out = new Map();
        const add = (x, y, types) => {
            const k = hexKey(x, y);
            const e = out.get(k) || { x, y, types: new Set() };
            types.forEach(t => e.types.add(t));
            out.set(k, e);
        };
        const fromKey = k => { const [x, y] = k.split(',').map(Number); return { x, y }; };
        if (tac) {
            [...tac.oppPathCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)
                .forEach(([k]) => { const h = fromKey(k); add(h.x, h.y, ['earth', 'water']); });
            [...tac.ownPathHexes].slice(0, 8).forEach(k => { const h = fromKey(k); add(h.x, h.y, ['wind']); });
            for (const k of tac.oppShrineTargets.keys()) { const h = fromKey(k); add(h.x, h.y, ['earth', 'water', 'wind', 'fire']); }
            const around = (x, y, types) => {
                for (const h of window.BotSim.grid(snap)) {
                    const d = Math.hypot(h.x - x, h.y - y);
                    if (d > 5 && d < 40) add(h.x, h.y, types);
                }
            };
            for (const k of tac.threatStones) { const h = fromKey(k); around(h.x, h.y, ['fire']); }
            // Walls on the bot's own route: stones on or next to it.
            for (const st of snap.stones) {
                if (st.type !== 'earth' && st.type !== 'water') continue;
                const near = [...tac.ownPathHexes].some(k => { const h = fromKey(k); return Math.hypot(h.x - st.x, h.y - st.y) < 40; });
                if (near) around(st.x, st.y, ['fire', 'void']);
            }
        }
        const list = [...out.values()]
            .filter(e => !snap.stones.some(s => Math.hypot(s.x - e.x, s.y - e.y) < 5))
            .filter(e => !snap.players.some(p => p && Math.hypot(p.x - e.x, p.y - e.y) < 5))
            .map(e => ({ x: e.x, y: e.y, types: [...e.types] }))
            .slice(0, 30);
        _rangedCache = { key, list };
        return list;
    }

    // Tactical value of a placeStone — pattern-dictated OR tactical
    // (scroll:null) alike. Root-only, both brains: greedy scoreAction()
    // reads it via ctx.tac; searchPick() adds it to its root scores the
    // same way it folds in revisitPenalty.
    function tacticalPlaceBonus(a, snap, tac) {
        if (!tac || a.type !== 'placeStone') return 0;
        let b = 0;
        const k = hexKey(a.x, a.y);
        // A stone on a shrine centre stops anyone collecting there (resting
        // on a stone is banned): worth it on a shrine an opponent is heading
        // for, costly on one the bot wants itself.
        if (a.stoneType !== 'void' && tac.oppShrineTargets?.has(k)) {
            b += WEIGHTS.placeShrineDeny * tac.oppShrineTargets.get(k);
            if (collectibleShrines(snap).some(t => Math.hypot(t.x - a.x, t.y - a.y) < 5)) b += WEIGHTS.placeSelfBlockPenalty;
        }
        if (a.stoneType === 'water') {
            // Water copies what it chains to (bot-sim.js waterChainResult):
            // next to wind it is free to walk on, for everyone, so it paves
            // the bot's own route like wind and blocks nobody; next to earth
            // it is a wall, so it blocks like earth (ours too).
            const chain = window.BotSim?.waterChainResult?.(snap, a.x, a.y) || null;
            if (chain === 'wind') {
                if (tac.ownPathHexes.has(k)) b += WEIGHTS.placeWaterChain;
            } else if (chain === 'earth') {
                const blocked = tac.oppPathCount.get(k) || 0;
                if (blocked) b += WEIGHTS.placeEarthBlock * blocked;
                if (tac.ownPathHexes.has(k)) b += WEIGHTS.placeSelfBlockPenalty;
            } else {
                // Water slows (cost 2) rather than walls: half the earth value.
                const slowed = tac.oppPathCount.get(k) || 0;
                if (slowed) b += 0.5 * WEIGHTS.placeEarthBlock * slowed;
                if (tac.ownPathHexes.has(k)) b += 0.5 * WEIGHTS.placeSelfBlockPenalty;
            }
        }
        if (a.stoneType === 'earth') {
            const blocked = tac.oppPathCount.get(k) || 0;
            if (blocked) b += WEIGHTS.placeEarthBlock * blocked;
            if (tac.ownPathHexes.has(k)) b += WEIGHTS.placeSelfBlockPenalty;
        } else if (a.stoneType === 'wind') {
            if (tac.ownPathHexes.has(k)) b += WEIGHTS.placeWindPath;
        } else if (a.stoneType === 'fire') {
            // Mirrors BotSim's applyFireInteractions(): a placed fire only
            // burns when IT has no adjacent void; victims are adjacent
            // non-fire/non-void stones (5..50px stone-neighbor window).
            const guarded = snap.stones.some(s => {
                if (s.type !== 'void') return false;
                const d = Math.hypot(s.x - a.x, s.y - a.y);
                return d > 5 && d < 50;
            });
            if (!guarded) {
                for (const s of snap.stones) {
                    if (s.type === 'fire' || s.type === 'void') continue;
                    const d = Math.hypot(s.x - a.x, s.y - a.y);
                    if (d <= 5 || d >= 50) continue;
                    if (tac.threatStones.has(hexKey(s.x, s.y))) b += WEIGHTS.placeFireThreatBreak;
                }
            }
        }
        // Never spend a stone the active build plan still needs of this
        // type — a wall/corridor isn't worth stalling the win-credit plan.
        if (a.tactical) {
            const plan = mem(snap.turn.activePlayerIndex).plan;
            const self = me(snap);
            if (plan && self) {
                const stillNeeded = plan.cells.filter(c => c.type === a.stoneType &&
                    !snap.stones.some(st => st.type === c.type && Math.hypot(st.x - c.x, st.y - c.y) < 5)).length;
                if (stillNeeded > 0 && ((self.pool[a.stoneType] || 0) - 1) < stillNeeded) {
                    b += WEIGHTS.placeTacticalStarvesPlan;
                }
            }
        }
        return b;
    }

    // Which scroll element would this cast choice draw? River on a face-down
    // tile draws its chosen element on reveal; Stomp on a River tile draws
    // that tile's River element; Stomp on a plain face-down tile is unknown.
    function choiceDrawElement(a, snap) {
        const c = a.choice;
        if (!c) return null;
        // Scholar's Insight / Inspiring Draught: the chosen deck's element.
        if (a.scroll === 'VOID_SCROLL_4' || a.scroll === 'WATER_SCROLL_3') return c.element || null;
        if (c.tileId == null) return null;
        const t = snap.tiles.find(x => Number(x.id) === Number(c.tileId));
        if (!t || t.revealed) return null;
        if (a.scroll === 'WATER_SCROLL_4') return c.element || null;
        const r = (snap.crossTurnBuffs?.wanderingRiver || []).find(e => Number(e.tileId) === Number(c.tileId));
        return r ? r.newElement : null;
    }

    // Greedy tie-break between the choices of one scroll (search compares
    // them properly through the simulator).
    function castChoiceBonus(a, snap) {
        // Arson / Plunder: hit whoever is closest to winning (activated elements).
        if ((a.scroll === 'FIRE_SCROLL_5' || a.scroll === 'CATACOMB_SCROLL_8') && a.choice) {
            const op = snap.players[a.choice.target];
            return op ? op.activated.length : 0;
        }
        const el = choiceDrawElement(a, snap);
        if (!el) return 0;
        const need = scrollNeed(snap, snap.turn.activePlayerIndex);
        return WEIGHTS.castChoiceNeed * (need[el] || 0);
    }


    // ----------------------------------------------------------------
    // Combos learned from players (bot combo plan, Phase 4).
    // The replay miner (js/replay-viewer.js) finds cast sequences that paid
    // off in players' recorded games; get_bot_combos() (sql/combo-teach.sql)
    // returns the ones seen at least twice in different games, or switched
    // on by the hermit. A bot that holds the scrolls for a combo's first two
    // casts takes it on as a plan (mem.combo) and remembers the step across
    // turns. The next cast gets comboStep (+ comboChoiceMatch when its choice
    // matches), in greedy scoring and at the search root. It is a nudge, not
    // a script: the look-ahead can still prefer something better. The combo
    // is dropped when it runs long or the next scroll is gone.
    // Signature format: "WATER_SCROLL_4[hidden tile] > reveal / EARTH_SCROLL_4"
    // (turns separated by " / ", steps by " > ").
    // ----------------------------------------------------------------
    let COMBOS = [];
    function parseCombo(signature, score) {
        const turns = String(signature).split(' / ');
        const casts = [];
        turns.forEach((turn, t) => {
            for (const tok of turn.split(' > ')) {
                const m = /^([A-Z]+_SCROLL_\d+)(?:\[(.*)\])?$/.exec(tok.trim());
                if (m) casts.push({ scroll: m[1], tag: m[2] || null, turn: t });
            }
        });
        return { signature, score: score || 0, turns: turns.length, casts };
    }
    function setCombos(rows) {
        COMBOS = (rows || []).map(r => parseCombo(r.signature, r.score)).filter(c => c.casts.length >= 2);
        log(`Combos loaded: ${COMBOS.length}`);
    }
    try { setCombos(JSON.parse(localStorage.getItem('godaigo_bot_combos') || '[]')); } catch (e) {}
    (async function loadCombos() {
        try {
            if (typeof supabase === 'undefined' || !supabase?.rpc) return;
            const { data, error } = await supabase.rpc('get_bot_combos');
            if (error || !Array.isArray(data)) return;
            setCombos(data);
            try { localStorage.setItem('godaigo_bot_combos', JSON.stringify(data)); } catch (e) {}
        } catch (e) { /* offline: keep the cached list */ }
    })();

    function heldScrolls(snap, self) {
        return new Set([...(self.hand || []), ...(self.active || []), ...(snap.commonArea || [])]);
    }

    // Start, keep or drop the combo for this bot.
    function updateCombo(snap, idx) {
        const m = mem(idx);
        const self = snap.players[idx];
        if (!self || !self.hand) return;
        const held = heldScrolls(snap, self);
        if (m.combo) {
            const c = m.combo;
            const next = c.casts[c.next];
            const late = (m.ownTurns || 0) - c.startTurn > c.turns + (WEIGHTS.comboExtraTurns | 0);
            if (!next || late || !held.has(next.scroll)) {
                log(`Combo dropped (${!next ? 'done' : late ? 'too slow' : 'next scroll gone'}): ${c.signature}`);
                restCombo(m, c.signature);
                m.combo = null;
            }
            return;
        }
        for (const combo of COMBOS) {
            if ((m.comboRest?.[combo.signature] || 0) > (m.ownTurns || 0)) continue; // just finished or dropped
            if (held.has(combo.casts[0].scroll) && held.has(combo.casts[1].scroll)) {
                m.combo = { ...combo, next: 0, startTurn: m.ownTurns || 0 };
                log(`Combo started: ${combo.signature}`);
                return;
            }
        }
    }

    function comboTagMatches(a, tag, snap) {
        if (!tag) return true;
        if (!a.choice) return false;
        if (tag === 'hidden tile' || tag === 'revealed tile') {
            const t = snap.tiles.find(x => Number(x.id) === Number(a.choice.tileId));
            return !!t && (tag === 'hidden tile' ? !t.revealed : t.revealed);
        }
        return true; // flight / swap / move tile: any choice of that scroll
    }

    function comboBonus(a, snap) {
        if (a.type !== 'cast') return 0;
        const c = mem(snap.turn.activePlayerIndex).combo;
        const next = c?.casts[c.next];
        if (!next || next.scroll !== a.scroll) return 0;
        return WEIGHTS.comboStep + (comboTagMatches(a, next.tag, snap) ? WEIGHTS.comboChoiceMatch : 0);
    }

    function advanceCombo(idx, action) {
        const m = mem(idx);
        const c = m.combo;
        if (!c || c.casts[c.next]?.scroll !== action.scroll) return;
        c.next++;
        if (c.next >= c.casts.length) {
            _combosCompleted++;
            log(`Combo completed: ${c.signature}`);
            restCombo(m, c.signature);
            m.combo = null;
        }
    }
    let _combosCompleted = 0;
    // A finished or dropped combo waits a few own turns before it can start
    // again (otherwise a bot still holding both scrolls restarts it at once).
    const COMBO_REST_TURNS = 3;
    function restCombo(m, signature) {
        m.comboRest = m.comboRest || {};
        m.comboRest[signature] = (m.ownTurns || 0) + COMBO_REST_TURNS;
    }

    // ----------------------------------------------------------------
    // scoreAction — the Stage-1 utility function. Tune WEIGHTS, not this.
    // ----------------------------------------------------------------
    function scoreAction(a, snap, ctx) {
        const self = me(snap);
        // Optional feature-trace channel (js/bot-imitation.js's hermit-only
        // learn-from-my-play feature): when ctx.trace is an object, contrib()
        // ALSO records the raw feature value under its weight's key, on top
        // of returning the normal weighted contribution. This can never
        // change the returned score — contrib(k, f) === WEIGHTS[k] * f
        // exactly, tracing or not — so every existing caller (greedy pick,
        // search, arena) is unaffected. Wired into the branches
        // bot-imitation.js compares: endTurn, discardScroll, and (Phase 5,
        // 2026-09-26) cast and move. The cast/move bonuses that are not
        // plain weight x feature (castChoiceBonus, comboBonus) stay untraced.
        const trace = ctx && ctx.trace;
        function contrib(key, feature) {
            if (trace) trace[key] = (trace[key] || 0) + feature;
            return WEIGHTS[key] * feature;
        }
        switch (a.type) {

            case 'placeTile': {
                return WEIGHTS.placeTileBase + WEIGHTS.placeTileCentroidPenalty * (a.distToCentroid || 0);
            }

            case 'cast': {
                const el = scrollElement(a.scroll);
                const def = window.SCROLL_DEFINITIONS?.[a.scroll];
                // Traced (contrib) for learn-from-player (bot-imitation.js).
                let s = contrib('castBase', 1) + contrib('castLevel', def?.level || 0);
                if (a.choice) s += castChoiceBonus(a, snap);
                s += comboBonus(a, snap);
                if (mem(snap.turn.activePlayerIndex).noCreditScrolls.has(a.scroll)) {
                    s += contrib('castNoCredit', 1); // effect cancelled before - hard veto, don't recast
                } else if (el && ELEMENTS.includes(el)) {
                    const dead = (snap.sourcePool[el] || 0) <= 0;
                    if (self.activated.includes(el)) s += contrib('castAlreadyWon', 1); // no more win credit here
                    else if (dead) s += contrib('castDeadElement', 1);                  // no win credit
                    else s += contrib('castUnactivated', 1);
                }
                return s;
            }

            case 'placeStone': {
                let s;
                if (a.scroll) {
                    s = WEIGHTS.placeBase + WEIGHTS.placeProgress * (a.progress || 0);
                    s += hasWinCredit(snap, a.scroll) ? WEIGHTS.placeUnactivated : WEIGHTS.placeNoCredit;
                } else {
                    // Tactical placement (Stage 4, scroll:null — see
                    // bot-state.js): no pattern value at all; only worth
                    // taking when a tacticalPlaceBonus() term fires.
                    s = WEIGHTS.placeTacticalBase;
                }
                // The bot KNOWS the fire rule — don't pay stones to relearn it
                if (window.BotSim && !window.BotSim.stoneWouldSurvive(snap, a.x, a.y, a.stoneType)) {
                    s += WEIGHTS.placeDoomed;
                }
                if (a.stoneType === 'void') s += WEIGHTS.placeVoidSpendPenalty;
                s += tacticalPlaceBonus(a, snap, ctx.tac);
                if (ctx.help?.road.has(hexKey(a.x, a.y)) && a.stoneType === 'wind') s += WEIGHTS.placeAllyRoad * ctx.help.push;
                s += unblockBonus(a, snap, ctx.unblock);
                return s;
            }

            case 'move': {
                // Value = best shrine reachable via this step: worth ÷ remaining cost.
                // ctx.paths caches Dijkstra results per target for this decision.
                let best = 0;
                for (const t of ctx.shrines) {
                    const path = ctx.paths.get(t.id);
                    if (!path || !path.length) continue;
                    const first = path[0];
                    if (Math.hypot(first.x - a.x, first.y - a.y) >= 5) continue; // step isn't on this path
                    const remaining = path.reduce((c, p) => c + p.cost, 0);
                    const v = shrineValue(snap, t.shrineType) / (1 + remaining);
                    if (v > best) best = v;
                }
                // Exploration: landing on an unrevealed tile flips it (scroll draw!).
                // Primary signal is the real cheapest PATH to a hidden tile
                // (ctx.explorePath) — the euclidean gradient is only a fallback,
                // because it freezes the bot whenever escaping a cul-de-sac
                // requires temporarily increasing straight-line distance.
                let explore = 0;
                if (ctx.hiddenTiles.length) {
                    const onHidden = ctx.hiddenTiles.some(t => Math.hypot(t.x - a.x, t.y - a.y) < 70);
                    if (onHidden) explore += contrib('moveExplore', 1);
                    if (ctx.explorePath && ctx.explorePath.length) {
                        const first = ctx.explorePath[0];
                        if (Math.hypot(first.x - a.x, first.y - a.y) < 5) {
                            const remaining = ctx.explorePath.reduce((c, p) => c + p.cost, 0);
                            explore += contrib('moveExplorePath', 1 / (1 + remaining));
                        }
                    } else if (!onHidden) {
                        const distFrom = p => Math.min(...ctx.hiddenTiles.map(t => Math.hypot(t.x - p.x, t.y - p.y)));
                        explore += contrib('moveExploreGradient', distFrom(self) - distFrom(a));
                    }
                }
                // Going home: all 5 elements activated → the only thing that
                // still wins is standing on the bot's own shrine centre.
                let home = 0;
                if (ctx.homePath && ctx.homePath.length) {
                    const first = ctx.homePath[0];
                    if (Math.hypot(first.x - a.x, first.y - a.y) < 5) {
                        const remaining = ctx.homePath.reduce((c, p) => c + p.cost, 0);
                        home = contrib('moveReturnHome', 1 / (1 + remaining));
                    }
                }
                // Fixation: only set (see findFixationTarget()) when the
                // turn-repeat circuit breaker is armed — pulls toward a
                // REVEALED hex elsewhere on the board that still has an
                // uncast-element pattern buildable, instead of just
                // suppressing movement on a stuck turn.
                let fixation = 0;
                if (ctx.fixationPath && ctx.fixationPath.length) {
                    const first = ctx.fixationPath[0];
                    if (Math.hypot(first.x - a.x, first.y - a.y) < 5) {
                        const remaining = ctx.fixationPath.reduce((c, p) => c + p.cost, 0);
                        fixation = contrib('moveFixation', 1 / (1 + remaining));
                    }
                }
                let harm = 0;
                if (ctx.harm) {
                    const push = ctx.harm.push;
                    if (firstHop(ctx.campPath, a)) harm += contrib('moveCamp', push / (1 + pathCost(ctx.campPath)));
                    if (firstHop(ctx.breakPath, a)) harm += contrib('moveToBreak', push / (1 + pathCost(ctx.breakPath)));
                    if (ctx.harm.campHere) harm += contrib('campLeave', push);
                }
                const revisit = contrib('moveRevisitPenalty', revisitPenalty(ctx.recentPositions || [], a, 1));
                return contrib('moveBase', 1) + contrib('moveShrineValue', best)
                     + contrib('moveApPenalty', a.cost) + explore + revisit + home + fixation + harm;
            }

            case 'teleport': {
                let s = WEIGHTS.teleportBase;
                if (ELEMENTS.includes(a.shrineType)) {
                    s += WEIGHTS.teleportShrineValue * shrineValue(snap, a.shrineType);
                }
                // Same anti-oscillation memory movement uses — without it,
                // free hops between two shrines ping-pong forever.
                s += revisitPenalty(ctx.recentPositions || [], a, WEIGHTS.teleportRevisitPenalty);
                if (ctx.harm?.campHere) s += WEIGHTS.campLeave * ctx.harm.push;
                return s;
            }

            case 'breakStone': {
                return WEIGHTS.breakStoneBase + WEIGHTS.breakStoneApPenalty * a.cost
                     + unblockBonus(a, snap, ctx.unblock)
                     + (ctx.harm?.stones.has(hexKey(a.x, a.y)) ? WEIGHTS.breakLeaderPattern * ctx.harm.push : 0);
            }

            case 'moveStone': {
                let s = WEIGHTS.moveStoneBase;
                if (window.BotSim && !window.BotSim.stoneWouldSurvive(snap, a.toX, a.toY, a.stoneType)) {
                    s += WEIGHTS.moveStoneDoomedPenalty;
                }
                return s;
            }

            case 'endTurn': {
                let s = contrib('endTurnBase', 1);
                if (ctx.onShrine) {
                    s += contrib('endTurnOnShrine', 1)
                       + shrineValue(snap, ctx.onShrine.shrineType);
                }
                if (snap.turn.ap <= 1) s += contrib('endTurnLowAp', 1);
                if (ctx.harm?.campHere) s += contrib('endTurnCamp', ctx.harm.push);
                return s;
            }

            case 'discardScroll': {
                const el = scrollElement(a.scroll);
                const def = window.SCROLL_DEFINITIONS?.[a.scroll];
                let s = contrib('discardBase', 1) + contrib('discardLevel', def?.level || 0);
                if (ctx.help?.gift.has(el) && def?.level > 1) s += contrib('discardForAlly', 1);
                if (a.voluntary) s += contrib('discardVoluntary', 1);
                if (def?.level === 1) s += contrib('discardResponseOnly', 1);
                if (el && ELEMENTS.includes(el)) {
                    if (self.activated.includes(el)) s += contrib('discardActivated', 1);
                    if ((snap.sourcePool[el] || 0) <= 0) s += contrib('discardDeadElement', 1);
                }
                // Never discard the scroll the current build plan needs
                const activePlan = mem(snap.turn.activePlayerIndex).plan;
                if (activePlan && a.scroll === activePlan.scroll) s -= 1000;
                return s;
            }

            default: return -Infinity;
        }
    }

    // ----------------------------------------------------------------
    // Per-bot memory, keyed by player index.
    //
    // Why keyed at all: bot-arena.js's local hot-seat and spectate matches
    // drive MULTIPLE bot players through this SAME module instance, one
    // turn at a time, alternating. Every piece of state below used to be a
    // single shared module-level variable — so Player A's plan, recent
    // positions, and cursed-cell blacklist silently bled into Player B's
    // decisions the moment turns alternated, and vice versa. Found via a
    // real bot-vs-bot game log: an identical 6-hex movement cycle repeated
    // turn after turn forever, immune to the anti-oscillation fix below —
    // traced to _recentPositions being one ring buffer BOTH bots wrote
    // into, so a player's own "don't reverse your last move" signal was
    // getting overwritten by the OTHER player's positions every time turns
    // switched, corrupting the tie-breaker into noise. bot-driver.js (real
    // multiplayer) only ever drives one bot identity per browser tab, so
    // this bug never surfaced there — only in same-page multi-bot modes.
    // ----------------------------------------------------------------
    const _mem = {};
    function mem(idx) {
        if (!_mem[idx]) {
            _mem[idx] = {
                plan: null,             // { scroll, anchor:{q,r}, cells:[{q,r,x,y,type}] }
                recentPositions: [],    // ring buffer of {x,y}, oldest first
                cellFailCount: new Map(),
                cursedCells: new Set(),
                lastTurnMoveKey: null,
                turnRepeatStreak: 0,
                unproductiveStreak: 0,  // consecutive own turns with no cast/placeStone — see botTurn()
                noCreditScrolls: new Set(), // scrolls whose special effect cancelled without granting win credit — see trackCastCredit()
                lastBrainSignalAt: 0,   // throttle for signalBrainMode()'s emoji — see its own comment
            };
        }
        return _mem[idx];
    }

    // Decision-transparency emoji: floats a small icon over the bot's own
    // pawn whenever a non-greedy brain mode actually decided the current
    // action (not on the greedy fallback — that's the ordinary case and
    // would just be visual noise every turn). Reuses window.emojiSystem's
    // existing display mechanism directly (showEmojiOverPawn has no
    // purchase/ownership gate of its own — that's only in useEmoji(), the
    // human "spend gold" path this deliberately bypasses) and broadcasts
    // it in multiplayer the same way a real player's emoji does, so every
    // client watching sees it, not just whichever browser is driving the
    // bot. Throttled per player (mem().lastBrainSignalAt) so a burst of
    // several tactical decisions within one turn doesn't spam duplicate
    // floats.
    const BRAIN_SIGNAL_EMOJI = { mcts: '🎲', search: '🧠' };
    const BRAIN_SIGNAL_COOLDOWN_MS = 2000;
    // Off for now (owner, 2026-09-25): the brain-mode emoji is a work in
    // progress and looks unfinished. The bots' search / MCTS still run; set
    // BRAIN_SIGNAL_ENABLED = true to show the emoji again.
    const BRAIN_SIGNAL_ENABLED = false;
    function signalBrainMode(playerIndex, mode) {
        if (!BRAIN_SIGNAL_ENABLED) return;
        const es = window.emojiSystem;
        if (!es || typeof es.showEmojiOverPawn !== 'function') return;
        const display = BRAIN_SIGNAL_EMOJI[mode];
        if (!display) return;
        const m = mem(playerIndex);
        const now = Date.now();
        if (now - m.lastBrainSignalAt < BRAIN_SIGNAL_COOLDOWN_MS) return;
        m.lastBrainSignalAt = now;
        es.showEmojiOverPawn(playerIndex, display, false);
        if (typeof isMultiplayer !== 'undefined' && isMultiplayer && typeof broadcastGameAction === 'function') {
            broadcastGameAction('emoji', { playerIndex, display, isText: false });
        }
    }
    function resetAllMemory() {
        for (const k of Object.keys(_mem)) delete _mem[k];
    }

    // Recent-move history — anti-oscillation tie-breaker. Two hexes can be
    // EXACTLY equidistant from the only reachable unrevealed tile (or shrine),
    // giving move-there and move-back identical scores with nothing else to
    // prefer one over the other; without this the bot alternates between them
    // forever, even across turn boundaries. Persists across turns deliberately
    // (that's exactly where the oscillation was observed in practice).
    //
    // v1 used a flat penalty for "anywhere in the last N positions," which
    // fails for a clean 2-hex cycle: once both A and B are simultaneously
    // inside the window, EVERY candidate move gets the same penalty, so the
    // tie comes right back and the bot still oscillates (observed: 5 A<->B
    // round-trips burning a whole turn's AP). Fixed by weighting the penalty
    // by recency instead of applying it flat — "undo the move I just made"
    // (1 step ago) is penalized far more than "revisit somewhere from 3+
    // steps ago," so a 2-cycle can no longer look equally bad in both
    // directions and the tie actually breaks.
    // Monotonic count of successfully APPLIED main-phase casts, any player.
    // Never reset — consumers (bot-arena.js's no-cast stall cap) read deltas,
    // so a fresh game just remembers its own starting value.
    let _castsApplied = 0;

    const RECENT_POS_LIMIT = 6;
    function recordVisited(idx, x, y) {
        const rp = mem(idx).recentPositions;
        rp.push({ x, y });
        if (rp.length > RECENT_POS_LIMIT) rp.shift();
    }

    // Whole-turn repeat detector — a second, coarser safety net above.
    // recentPositions/revisitPenalty only ever break a clean 2-hex tie; a
    // larger stable N-hex cycle (N <= RECENT_POS_LIMIT) can rotate in
    // lockstep with the recency-decay penalty and never actually create the
    // asymmetry needed to escape. botTurn() records each turn's move
    // sequence and compares it to that SAME PLAYER's previous turn; botAct()
    // consults turnRepeatStreak to short-circuit movement for one turn once
    // a repeat is detected — see both sites.
    // Recency-weighted revisit penalty for a candidate move target `a`.
    // k=1 means "this is exactly where I was one move ago" (an immediate
    // reversal); k=2 means two moves ago, etc. — penalty decays as 1/k.
    function revisitPenalty(recent, a, weight) {
        for (let k = 1; k < recent.length; k++) {
            const p = recent[recent.length - 1 - k]; // skip the last entry (current position)
            if (Math.hypot(p.x - a.x, p.y - a.y) < 5) return weight / k;
        }
        return 0;
    }

    // Some cells never accept a stone no matter how many times we place one —
    // e.g. an adjacent active fire stone destroys whatever non-fire/non-void
    // stone lands next to it (game-core.js processStoneInteractions). The bot
    // doesn't model that rule directly (DO-NOT: no game-rules duplication in
    // bot.js) — instead it notices the cell stays empty after repeated
    // attempts and blacklists it, both for the current plan and future ones.
    // Without this the bot loops forever: place → destroyed → still missing →
    // place again, burning its whole pool and every turn's AP for zero progress.
    const cellKey = c => `${c.x.toFixed(1)},${c.y.toFixed(1)},${c.type}`;
    const CELL_FAIL_LIMIT = 2;
    // How many consecutive own turns with no cast/placeStone before botAct()
    // tries findFixationTarget() unconditionally (not just on an exact move
    // repeat) — see unproductiveStreak in mem()/botTurn().
    const UNPRODUCTIVE_LIMIT = 3;

    // Scrolls worth planning around right now: hand + ACTIVE AREA + COMMON
    // AREA (hand-only planning dead-ends games — a catacomb scroll parked in
    // the active area, or an opponent's discard in the common area, is often
    // the ONLY remaining source of an unactivated element), each paired with
    // the win credit casting it would actually grant. Zero credit ⇒ excluded
    // — an already-won scroll with its pattern still on the board would
    // otherwise become an infinite recast loop (the plan-level twin of the
    // castAlreadyWon bug). Catacomb scrolls credit each unactivated
    // COMPONENT element (no source-pool guard, matching applyScrollEffects).
    // Shared by makePlan() (anchored at the bot's current hex) and
    // findFixationTarget() (anchored at candidate hexes elsewhere).
    function creditableSources(snap, self, noCreditScrolls) {
        const sources = new Set([...self.hand, ...self.active, ...(snap.commonArea || [])]);
        const out = [];
        // The combo being followed: its next scroll is worth building even
        // without win credit (that is the point of a combo).
        const combo = mem(snap.turn.activePlayerIndex).combo;
        const comboNext = combo?.casts[combo.next]?.scroll;
        if (comboNext && sources.has(comboNext)) {
            const def = window.SCROLL_DEFINITIONS?.[comboNext];
            if (def && def.level !== 1 && Array.isArray(def.patterns)) out.push({ name: comboNext, def, credit: 1 });
        }
        for (const name of sources) {
            if (name === comboNext && out.length) continue;
            if (noCreditScrolls.has(name)) continue; // cast before, effect cancelled — don't replan it
            const def = window.SCROLL_DEFINITIONS?.[name];
            if (!def || def.level === 1 || !Array.isArray(def.patterns)) continue;
            const el = def.element;
            let credit = 0;
            if (el === 'catacomb') {
                for (const c of new Set((def.patterns[0] || []).map(cell => cell.type))) {
                    if (!self.activated.includes(c)) credit++;
                }
            } else if (!self.activated.includes(el) && (snap.sourcePool[el] || 0) > 0) {
                credit = 1;
            }
            if (credit > 0) out.push({ name, def, credit });
        }
        return out;
    }

    // Is `variant` (one pattern shape from a scroll's def.patterns) buildable
    // anchored at `anchorHex`? Cells on face-down tiles or any player tile
    // (incl. bridge hexes) are illegal to place on, and a non-fire/non-void
    // stone next to an unvoided fire dies on placement — don't plan shapes
    // that can't exist. Returns null if not viable at all; otherwise
    // {cells, placed, deficit} — placed = how many cells already hold the
    // right stone, deficit = {type: shortfall} for any type the pool
    // doesn't yet cover (empty object when the shape is buildable RIGHT
    // NOW). Callers decide what a non-empty deficit means: makePlan() and
    // findFixationTarget() only accept it as a collect-then-build plan when
    // every short type has a shrine to collect it from somewhere on the
    // board (see collectibleShrines() below) — otherwise it's just a shape
    // that will never be finishable, not a real plan. Shared by makePlan()
    // and findFixationTarget() — the only difference between them is which
    // hex `anchorHex` is.
    function viablePatternAt(snap, self, variant, anchorHex, grid, cursedCells) {
        const cells = variant.map(req => {
            const px = hexToPixel(anchorHex.q + req.q, anchorHex.r + req.r, TILE_SIZE);
            return { q: anchorHex.q + req.q, r: anchorHex.r + req.r, x: px.x, y: px.y, type: req.type };
        });
        if (!cells.every(c => grid.some(h => Math.hypot(h.x - c.x, h.y - c.y) < 5))) return null;
        if (cells.some(c => cursedCells.has(cellKey(c)))) return null; // known-doomed cell — skip this variant
        if (typeof isPositionOnFlippedTile === 'function' &&
            cells.some(c => isPositionOnFlippedTile(c.x, c.y, grid))) return null;
        if (typeof isPositionOnPlayerTile === 'function' &&
            cells.some(c => isPositionOnPlayerTile(c.x, c.y, grid))) return null;
        if (window.BotSim &&
            cells.some(c => !window.BotSim.stoneWouldSurvive(snap, c.x, c.y, c.type))) return null;
        let placed = 0, blocked = false;
        const need = {};
        for (const c of cells) {
            const s = placedStones.find(st => Math.hypot(st.x - c.x, st.y - c.y) < 5);
            if (s && s.type === c.type) placed++;
            else if (s) { blocked = true; break; }
            else need[c.type] = (need[c.type] || 0) + 1;
        }
        if (blocked) return null;
        const deficit = {};
        for (const [t, n] of Object.entries(need)) {
            const short = n - (self.pool[t] || 0);
            if (short > 0) deficit[t] = short;
        }
        return { cells, placed, deficit };
    }

    // Every deficit type must have a shrine somewhere on the revealed board
    // (collectibleShrines() — value>0 already factors in pool room/dead
    // source), or this is a shape that can never be finished, not a real
    // collect-then-build plan.
    function deficitIsCollectible(deficit, collectible) {
        return Object.keys(deficit).every(t => collectible.some(s => s.shrineType === t));
    }

    function makePlan(snap) {
        const self = me(snap);
        if (!self || !self.hand) return null;
        const { cursedCells, noCreditScrolls } = mem(snap.turn.activePlayerIndex);
        // All 5 elements activated — no cast adds win credit anymore; don't
        // start new builds, let move-scoring's homePath term walk the bot home
        if (ELEMENTS.every(el => self.activated.includes(el))) return null;
        const pHex = pixelToHex(self.x, self.y, TILE_SIZE);
        const grid = window.BotState.hexGrid();
        const collectible = collectibleShrines(snap);
        let best = null;
        for (const { name, def, credit } of creditableSources(snap, self, noCreditScrolls)) {
            for (const variant of def.patterns) {
                const v = viablePatternAt(snap, self, variant, pHex, grid, cursedCells);
                if (!v) continue;
                const totalDeficit = Object.values(v.deficit).reduce((a, b) => a + b, 0);
                // Missing stone types are fine — planNextAction() routes
                // through a collect leg (see stepTowardCollect()) — as long
                // as every missing type is actually obtainable somewhere on
                // the revealed board. Otherwise this shape can never finish;
                // it's not a real plan, just a dream.
                if (totalDeficit && !deficitIsCollectible(v.deficit, collectible)) continue;
                // catacombs can be worth 2 elements; a plan that still needs
                // collecting is discounted (slower, riskier) but still far
                // better than no plan at all — WEIGHTS.planDeficitPenalty is
                // negative, same sign convention as moveApPenalty etc.
                const score = v.placed * 10 + credit * 20 + WEIGHTS.planDeficitPenalty * totalDeficit;
                if (!best || score > best.score) best = { score, scroll: name, anchor: pHex, cells: v.cells };
            }
        }
        return best ? { scroll: best.scroll, anchor: best.anchor, cells: best.cells } : null;
    }

    // ----------------------------------------------------------------
    // Fixation target: when the turn-repeat circuit breaker fires (a stable
    // N-hex movement loop was detected — see turnRepeatStreak below), look
    // for a REVEALED hex ANYWHERE ELSE on the board where an uncast-element
    // pattern is buildable, and hand back its position. Deliberately NOT
    // anchored at the bot's current position like makePlan() — if the
    // current position had a viable pattern, makePlan() would already have
    // found it and the circuit breaker would never run (planAction takes
    // priority in botAct()). The point is finding an objective the bot's
    // purely-local plan search never considers.
    //
    // Only ever consulted by scoreAction() through ctx.fixationPath (a real
    // path, set in rankActions() only when turnRepeatStreak >= 1) via a
    // strong WEIGHTS.moveFixation term — NOT a scripted forced move. A
    // genuinely better action the same scoring pass finds (a cast, a
    // richer shrine) can still outscore walking there.
    // ----------------------------------------------------------------
    function findFixationTarget(snap) {
        const self = me(snap);
        if (!self || !self.hand) return null;
        const { cursedCells, noCreditScrolls } = mem(snap.turn.activePlayerIndex);
        if (ELEMENTS.every(el => self.activated.includes(el))) return null; // homePath covers this
        const grid = window.BotState.hexGrid();
        const sources = creditableSources(snap, self, noCreditScrolls);
        if (!sources.length) return null;
        const collectible = collectibleShrines(snap);

        let best = null;
        for (const h of grid) {
            // Only revealed ground, never a player tile (own or opponent's)
            if (typeof isPositionOnFlippedTile === 'function' && isPositionOnFlippedTile(h.x, h.y, grid)) continue;
            if (typeof isPositionOnPlayerTile === 'function' && isPositionOnPlayerTile(h.x, h.y, grid)) continue;
            const anchor = pixelToHex(h.x, h.y, TILE_SIZE);
            for (const { name, def, credit } of sources) {
                for (const variant of def.patterns) {
                    const v = viablePatternAt(snap, self, variant, anchor, grid, cursedCells);
                    if (!v) continue;
                    const totalDeficit = Object.values(v.deficit).reduce((a, b) => a + b, 0);
                    if (totalDeficit && !deficitIsCollectible(v.deficit, collectible)) continue;
                    const dist = Math.hypot(h.x - self.x, h.y - self.y);
                    // Same value shape as makePlan()'s score, lightly
                    // tie-broken toward the nearest viable option — the goal
                    // is escaping the local trap quickly, not finding the
                    // single best pattern on the whole board.
                    const score = v.placed * 10 + credit * 20 + WEIGHTS.planDeficitPenalty * totalDeficit - dist * 0.02;
                    if (!best || score > best.score) best = { score, x: h.x, y: h.y, scroll: name };
                }
            }
        }
        return best;
    }

    function planValid(snap) {
        const plan = mem(snap.turn.activePlayerIndex).plan;
        if (!plan) return false;
        const self = me(snap);
        if (!self) return false;
        const holding = (self.hand || []).includes(plan.scroll) || self.active.includes(plan.scroll) ||
                        (snap.commonArea || []).includes(plan.scroll); // common-area scrolls are castable too
        if (!holding) return false;
        // Cells were on the board when the plan was MADE (viablePatternAt
        // checks the grid) — but Telekinesis / Shifting Sands can move the
        // tile out from under an in-flight plan, leaving its cells floating
        // over empty space. Re-check every turn so the plan dies and the bot
        // replans, instead of trying to build a pattern in the void.
        const grid = window.BotState.hexGrid();
        for (const c of plan.cells) {
            if (!grid.some(h => Math.hypot(h.x - c.x, h.y - c.y) < 5)) return false;
        }
        for (const c of plan.cells) {
            const s = placedStones.find(st => Math.hypot(st.x - c.x, st.y - c.y) < 5);
            if (s && s.type !== c.type) return false;                       // cell corrupted
            // NOTE: deliberately no "pool[c.type] > 0" check here — a plan
            // may legitimately still be in its COLLECT leg for this cell's
            // type (see makePlan()'s deficit handling and
            // planNextAction()'s stepTowardCollect()). Rejecting a plan for
            // not yet having every stone in hand would defeat the entire
            // point of collect-then-build.
            // A fire stone may have appeared next to a still-missing cell
            // since the plan was made — the stone would die on placement
            if (!s && window.BotSim &&
                !window.BotSim.stoneWouldSurvive(snap, c.x, c.y, c.type)) return false;
        }
        return true;
    }

    // One walkable step toward any hex adjacent to `cell` (avoiding standing
    // on cells the plan still needs to fill). Returns a move action or null.
    function stepTowardCell(self, cell, missing, ap) {
        const grid = window.BotState.hexGrid();
        let bestPath = null;
        for (const h of grid) {
            const d = Math.hypot(h.x - cell.x, h.y - cell.y);
            if (d <= 5 || d >= 40) continue;                                 // must be adjacent to the cell
            if (missing.some(m => Math.hypot(m.x - h.x, m.y - h.y) < 5)) continue; // don't stand on an unfilled cell
            // Rule: placement requires the pawn on an UNOCCUPIED hex — don't
            // walk onto a stone to place from there, it would be blocked
            if (placedStones.some(s => Math.hypot(s.x - h.x, s.y - h.y) < 5)) continue;
            const path = window.BotState.findPath(self.x, self.y, h.x, h.y);
            if (!path || !path.length) continue;
            const cost = path.reduce((c, p) => c + p.cost, 0);
            if (!bestPath || cost < bestPath.cost) bestPath = { cost, step: path[0] };
        }
        if (bestPath && bestPath.step.cost <= ap) {
            return { type: 'move', x: bestPath.step.x, y: bestPath.step.y, cost: bestPath.step.cost };
        }
        return null;
    }

    // Collect leg of a plan: route toward a shrine that supplies a type the
    // plan is still short on. Shrine collection isn't a distinct action —
    // it's a side effect of ENDING YOUR TURN on the shrine's centre hex
    // (game-ui.js replenishShrineStones(), amount = stone rank, capped by
    // source pool + player pool room) — so once standing on a shrine that
    // covers a needed type, the right move IS to end the turn right there,
    // not linger. Returns a move/endTurn action, or null if nothing needed
    // is currently collectible (caller falls through to generic scoring).
    function stepTowardCollect(self, missing, snap) {
        const neededTypes = new Set(missing
            .filter(c => (self.pool[c.type] || 0) <= 0)
            .map(c => c.type));
        if (!neededTypes.size) return null;
        const onShrine = shrineUnderfoot(snap);
        if (onShrine && neededTypes.has(onShrine.shrineType)) return { type: 'endTurn' };
        const shrines = collectibleShrines(snap).filter(t => neededTypes.has(t.shrineType));
        if (!shrines.length) return null;
        let best = null;
        for (const t of shrines) {
            const path = window.BotState.findPath(self.x, self.y, t.x, t.y);
            if (!path || !path.length) continue;
            const cost = path.reduce((c, p) => c + p.cost, 0);
            if (!best || cost < best.cost) best = { path, cost };
        }
        if (!best) return null;
        if (snap.turn.ap > 0 && best.path[0].cost <= snap.turn.ap) {
            return { type: 'move', x: best.path[0].x, y: best.path[0].y, cost: best.path[0].cost };
        }
        return null;
    }

    // The next concrete action the plan dictates, or null (fall back to scoring)
    function planNextAction(snap) {
        const m = mem(snap.turn.activePlayerIndex);
        if (!m.plan || !planValid(snap)) { m.plan = null; return null; }
        const plan = m.plan;
        const self = me(snap);
        const missing = plan.cells.filter(c =>
            !placedStones.some(st => st.type === c.type && Math.hypot(st.x - c.x, st.y - c.y) < 5));

        // Did our last attempt actually stick? If the cell we just tried to
        // fill is still missing, something (e.g. an adjacent fire stone)
        // destroyed it on placement. Count the failure; past the limit,
        // blacklist the cell and abandon this plan rather than loop forever.
        if (plan._lastTargetKey) {
            const stillMissing = missing.some(c => cellKey(c) === plan._lastTargetKey);
            if (stillMissing) {
                const fails = (m.cellFailCount.get(plan._lastTargetKey) || 0) + 1;
                m.cellFailCount.set(plan._lastTargetKey, fails);
                if (fails >= CELL_FAIL_LIMIT) {
                    log(`Cell ${plan._lastTargetKey} failed to hold a stone ${fails}x - blacklisting and abandoning plan`);
                    m.cursedCells.add(plan._lastTargetKey);
                    m.plan = null;
                    return null;
                }
            } else {
                m.cellFailCount.delete(plan._lastTargetKey);
            }
            plan._lastTargetKey = null;
        }

        // NOTE: do NOT add a "step off the stone first" / "skip pawn-occupied
        // cells" pre-gate here to avoid the applyAction rejections botAct()
        // logs as "Plan action failed". That was tried (2026-07-19) and made
        // the bots pathologically passive: 7/8 seeded arena games wedged into
        // full stall-outs (vs 7/8 clean wins before). The rejection path is
        // the CHEAP, EFFECTIVE recovery — the plan is wiped, scoring takes
        // over, and the bot stays active. The log line is noise, not a bug.

        if (missing.length) {
            // Only ever attempt/target a cell whose type is ALREADY in pool —
            // applyAction('placeStone') rejects one that isn't (no stones of
            // that type), and a failed plan action wipes the WHOLE plan (see
            // botAct()), which would defeat collect-then-build the instant a
            // still-collecting cell got attempted early. Cells still short a
            // type fall through to stepTowardCollect() below instead.
            const fillableMissing = missing.filter(c => (self.pool[c.type] || 0) > 0);
            for (const c of fillableMissing) {
                if (m.cursedCells.has(cellKey(c))) continue;
                if (typeof isInPlacementRange === 'function' && isInPlacementRange(c.x, c.y, c.type)) {
                    plan._lastTargetKey = cellKey(c);
                    return { type: 'placeStone', x: c.x, y: c.y, stoneType: c.type, scroll: plan.scroll,
                             progress: (plan.cells.length - missing.length + 1) / plan.cells.length };
                }
            }
            if (snap.turn.ap > 0) {
                const fillableOrdered = fillableMissing.filter(c => !m.cursedCells.has(cellKey(c)));
                if (fillableOrdered.length) {
                    // fill the farthest-from-anchor cells first so placed stones
                    // (earth blocks movement!) don't wall off the rest of the shape
                    const aPx = hexToPixel(plan.anchor.q, plan.anchor.r, TILE_SIZE);
                    const ordered = [...fillableOrdered].sort((a, b) =>
                        Math.hypot(b.x - aPx.x, b.y - aPx.y) - Math.hypot(a.x - aPx.x, a.y - aPx.y));
                    for (const c of ordered) {
                        const mv = stepTowardCell(self, c, missing, snap.turn.ap);
                        if (mv) return mv;
                    }
                }
                // Nothing fillable with CURRENT pool — collect leg: route
                // toward (or end turn on) a shrine for a still-short type.
                const collect = stepTowardCollect(self, missing, snap);
                if (collect) return collect;
            }
            return null; // out of AP / unreachable / uncollectible — generic scoring takes over
        }

        // Shape complete → return to the anchor and cast
        const aPx = hexToPixel(plan.anchor.q, plan.anchor.r, TILE_SIZE);
        if (Math.hypot(self.x - aPx.x, self.y - aPx.y) >= 5) {
            if (snap.turn.ap > 0) {
                const path = window.BotState.findPath(self.x, self.y, aPx.x, aPx.y);
                if (path && path.length && path[0].cost <= snap.turn.ap) {
                    return { type: 'move', x: path[0].x, y: path[0].y, cost: path[0].cost };
                }
            }
            return null;
        }
        if (snap.turn.ap >= 2 && window.spellSystem.checkPattern(plan.scroll)) {
            return { type: 'cast', scroll: plan.scroll };
        }
        return null;
    }

    // ----------------------------------------------------------------
    // Stage 2 — depth-limited lookahead over BotSim's forward model.
    // Enabled via WEIGHTS.searchDepth > 0. Search stays WITHIN the bot's
    // own turn: an endTurn edge is a leaf (roadmap: multi-turn MCTS is a
    // separate, optional step).
    // ----------------------------------------------------------------

    // ----------------------------------------------------------------
    // Path fields (shared by greedy unblock scoring and search leaves).
    // All run over the SIM grid with BotSim.canMoveTo, so they work on
    // hypothetical boards ("what if this stone were gone?") too.
    // ----------------------------------------------------------------

    // Neighbour lists for the sim grid. The grid only depends on the tiles
    // (and which are still face down), so it is cached by a tile signature
    // and shared by every hypothetical board of the same turn.
    const _adjCache = new Map(); // tileSig -> { grid, byKey, adj }
    function gridInfo(snap) {
        const sig = snap.tiles.map(t => `${t.id}@${Math.round(t.x)},${Math.round(t.y)}${t.revealed ? 'r' : 'h'}`).join('|');
        let info = _adjCache.get(sig);
        if (info) return info;
        const grid = window.BotSim.grid(snap);
        const byKey = new Map(grid.map(h => [h.key, h]));
        const buckets = new Map();
        const bk = (x, y) => `${Math.floor(x / 40)},${Math.floor(y / 40)}`;
        for (const h of grid) {
            const k = bk(h.x, h.y);
            if (!buckets.has(k)) buckets.set(k, []);
            buckets.get(k).push(h);
        }
        const adj = new Map();
        for (const h of grid) {
            const list = [];
            const cx = Math.floor(h.x / 40), cy = Math.floor(h.y / 40);
            for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
                for (const nb of buckets.get(`${cx + dx},${cy + dy}`) || []) {
                    const d = Math.hypot(nb.x - h.x, nb.y - h.y);
                    if (d > 5 && d < 40) list.push(nb);
                }
            }
            adj.set(h.key, list);
        }
        info = { grid, byKey, adj };
        if (_adjCache.size > 20) _adjCache.clear();
        _adjCache.set(sig, info);
        return info;
    }
    const gridKey = (x, y) => `${Math.round(x)},${Math.round(y)}`;

    // Dijkstra from a set of source hexes. `minStep` > 0 makes free (wind)
    // steps still count a little, which keeps a field pointing somewhere.
    // Edge cost = canMoveTo() of the hex being entered.
    function pathField(snap, sourceKeys, minStep) {
        const { byKey, adj } = gridInfo(snap);
        const dist = new Map();
        const frontier = [];
        for (const k of sourceKeys) {
            if (!byKey.has(k) || dist.has(k)) continue;
            dist.set(k, 0);
            frontier.push(k);
        }
        while (frontier.length) {
            let bi = 0;
            for (let i = 1; i < frontier.length; i++)
                if (dist.get(frontier[i]) < dist.get(frontier[bi])) bi = i;
            const curKey = frontier[bi];
            frontier[bi] = frontier[frontier.length - 1];
            frontier.pop();
            const base = dist.get(curKey);
            for (const nb of adj.get(curKey) || []) {
                const mv = window.BotSim.canMoveTo(snap, nb.x, nb.y);
                if (!mv.canMove) continue;
                const nd = base + Math.max(minStep, mv.cost);
                if (nd < (dist.get(nb.key) ?? Infinity)) {
                    if (!dist.has(nb.key)) frontier.push(nb.key);
                    dist.set(nb.key, nd);
                }
            }
        }
        return dist;
    }

    // Explore field: cost-to-nearest-hidden-tile for every hex (multi-source
    // Dijkstra). Leaf evaluation uses it instead of euclidean distance,
    // which freezes the search in cul-de-sacs exactly like it froze the
    // greedy scorer.
    function buildExploreField(snap) {
        const hiddenIds = new Set(snap.tiles.filter(t => !t.revealed && !t.isPlayerTile).map(t => t.id));
        if (!hiddenIds.size) return null;
        const { grid } = gridInfo(snap);
        const sources = grid.filter(h => h.tileIds.some(id => hiddenIds.has(id))).map(h => h.key);
        return { dist: pathField(snap, sources, 0.5) }; // 0-cost wind still advances the field
    }

    // Home field: cost to the player's own shrine centre (only needed once
    // all 5 elements are activated).
    function buildHomeField(snap, forIndex) {
        const home = snap.tiles.find(t => t.isPlayerTile && t.playerIndex === forIndex);
        if (!home) return null;
        return { dist: pathField(snap, [gridKey(home.x, home.y)], 0.5) };
    }

    // Which stone hexes cost something other than a plain step right now:
    // blocked (earth wall, water chained to earth), slow (water, 2) or free
    // (wind, water chained to wind, 0)? Fields only change when this set
    // changes (a break, a void, a burn, a new wall, a paved road), so it is
    // the cache key for search-leaf fields. (Until 2026-09-27 it held only
    // blocked hexes, so paving a road never reached the search's distances.)
    // Memoized: search asks this for every leaf (several times per leaf) and
    // each answer walks every stone through canMoveTo (water chains too), so
    // late in a game it was most of a bot's think time. Per snapshot object,
    // then per board key (everything canMoveTo reads for a stone hex: stones,
    // the other pawns, whose turn, Mudslide).
    const _blockedBySnap = new WeakMap();
    const _blockedByKey = new Map();
    function blockedSig(snap) {
        let sig = _blockedBySnap.get(snap);
        if (sig !== undefined) return sig;
        const ai = snap.turn.activePlayerIndex;
        let key = ai + '|' + (snap.turn.buffs?.mudslide ? 1 : 0) + '|';
        for (const s of snap.stones) key += s.x + ',' + s.y + s.type[0] + ';';
        key += '|';
        snap.players.forEach((p, i) => { if (p && i !== ai) key += p.x + ',' + p.y + ';'; });
        key += '|';
        for (const t of snap.tiles) if (t.isPlayerTile) key += t.playerIndex + '@' + t.x + ',' + t.y + ';';
        sig = _blockedByKey.get(key);
        if (sig === undefined) {
            const out = [];
            for (const s of snap.stones) {
                const mv = window.BotSim.canMoveTo(snap, s.x, s.y);
                if (!mv.canMove) out.push(gridKey(s.x, s.y) + 'x');
                else if (mv.cost !== 1) out.push(gridKey(s.x, s.y) + mv.cost);
            }
            sig = out.sort().join(';');
            if (_blockedByKey.size > 2000) _blockedByKey.clear();
            _blockedByKey.set(key, sig);
        }
        _blockedBySnap.set(snap, sig);
        return sig;
    }

    // Search-time field cache: set by searchPick() for one decision.
    // { cache: Map<'explore'|'home:i' + sig, field|null> }
    let _fieldCtx = null;
    function leafField(snap, kind, forIndex) {
        if (!_fieldCtx) return undefined;
        // Tile layout too: Shifting Sands / Telekinesis move whole tiles.
        const tiles = snap.tiles.map(t => `${t.id}@${Math.round(t.x)},${Math.round(t.y)}${t.revealed ? 'r' : 'h'}`).join('|');
        const key = `${kind}:${forIndex}:${blockedSig(snap)}#${tiles}`;
        if (_fieldCtx.cache.has(key)) return _fieldCtx.cache.get(key);
        const f = kind === 'home' ? buildHomeField(snap, forIndex) : buildExploreField(snap);
        _fieldCtx.cache.set(key, f);
        return f;
    }

    // ----------------------------------------------------------------
    // Unblock bonus: breaking a stone, burning it with a fire placement or
    // voiding an earth wall is worth what it opens up. Compares the bot's
    // best goal (collectible shrine, hidden tile, or home once all 5 are
    // activated) before and after, on the same scale as the move scores
    // (moveShrineValue, moveExplorePath, moveReturnHome ÷ (1 + path cost)).
    // Before this, a break scored a flat breakStoneBase - cost, so an
    // earth wall between the bot and its last shrine was never cleared and
    // the game stalled.
    // ----------------------------------------------------------------
    function goalValue(snap, extraCost) {
        const self = me(snap);
        if (!self) return 0;
        const costs = pathField(snap, [gridKey(self.x, self.y)], 0);
        const val = (key, w) => {
            const c = costs.get(key);
            return c === undefined ? 0 : w / (1 + c + extraCost);
        };
        let best = 0;
        if (ELEMENTS.every(el => self.activated.includes(el))) {
            const home = snap.tiles.find(t => t.isPlayerTile && t.playerIndex === snap.turn.activePlayerIndex);
            if (home) best = Math.max(best, val(gridKey(home.x, home.y), WEIGHTS.moveReturnHome));
            return best;
        }
        for (const t of collectibleShrines(snap)) {
            best = Math.max(best, val(gridKey(t.x, t.y), WEIGHTS.moveShrineValue * shrineValue(snap, t.shrineType)));
        }
        const hiddenIds = new Set(snap.tiles.filter(t => !t.revealed && !t.isPlayerTile).map(t => t.id));
        if (hiddenIds.size) {
            let minC = Infinity;
            for (const h of gridInfo(snap).grid) {
                if (!h.tileIds.some(id => hiddenIds.has(id))) continue;
                const c = costs.get(h.key);
                if (c !== undefined && c < minC) minC = c;
            }
            if (minC < Infinity) best = Math.max(best, WEIGHTS.moveExplorePath / (1 + minC + extraCost));
        }
        return best;
    }

    // Per-decision cache for the "before" value.
    function makeUnblockCtx(snap) { return { snap, before: null }; }

    function unblockBonus(a, snap, uctx) {
        if (!uctx || !window.BotSim) return 0;
        const isBreak = a.type === 'breakStone';
        const isClearPlace = a.type === 'placeStone' && (a.stoneType === 'fire' || a.stoneType === 'void');
        if (!isBreak && !isClearPlace) return 0;
        const after = window.BotSim.simulate(snap, a);
        // Nothing changed about who can walk where: no bonus, no Dijkstra.
        const sigBefore = uctx.sigBefore ?? (uctx.sigBefore = blockedSig(snap));
        const removed = after.stones.length < snap.stones.length + (isBreak ? 0 : 1);
        if (!removed && blockedSig(after) === sigBefore) return 0;
        if (uctx.before === null) uctx.before = goalValue(snap, 0);
        // A break's AP is spent before the first step: count it as path cost.
        const gain = goalValue(after, isBreak ? (a.cost || 0) : 0) - uctx.before;
        // Negative too: breaking the void that holds an earth wall open (or
        // burning our own wind road) makes the way worse, and without the
        // penalty the bot looped "place void, break void" for the flat
        // breakStoneBase.
        let b = (isBreak ? WEIGHTS.breakUnblock : WEIGHTS.placeUnblock) * gain;
        // A fire burns every adjacent non-void, non-fire stone, ours too:
        // charge for stones the current build plan is standing on.
        if (a.type === 'placeStone' && a.stoneType === 'fire') {
            const plan = mem(snap.turn.activePlayerIndex).plan;
            if (plan) {
                const lost = plan.cells.filter(c =>
                    snap.stones.some(s => s.type === c.type && Math.hypot(s.x - c.x, s.y - c.y) < 5) &&
                    !after.stones.some(s => s.type === c.type && Math.hypot(s.x - c.x, s.y - c.y) < 5)).length;
                b += WEIGHTS.placeFireOwnPlanLoss * lost;
            }
        }
        return b;
    }

    // How close is `oppIndex` to winning, in the SAME currency evaluateSnapshot()
    // uses for our own progress — deliberately mirrors its activated+home-distance
    // terms so "how close are they" is directly comparable to "how close am I."
    function opponentProgress(snap, oppIndex) {
        const opp = snap.players[oppIndex];
        if (!opp) return 0;
        let v = opp.activated.length * WEIGHTS.evalActivated;
        if (ELEMENTS.every(el => opp.activated.includes(el))) {
            const home = snap.tiles.find(t => t.isPlayerTile && t.playerIndex === oppIndex);
            if (home) {
                let d = Math.hypot(home.x - opp.x, home.y - opp.y);
                // Inside a search: the real path cost home (35 px a step), so
                // a wall or a pawn in their way counts as slowing them down
                // (2026-09-27: bots never tried to stop a runner going home).
                const field = leafField(snap, 'home', oppIndex);
                if (field && field.dist) {
                    const pk = `${Math.round(opp.x)},${Math.round(opp.y)}`;
                    let c = field.dist.get(pk);
                    if (c === undefined) {
                        let best = Infinity;
                        for (const nb of gridInfo(snap).adj.get(pk) || []) {
                            const dn = field.dist.get(nb.key);
                            if (dn !== undefined && dn < best) best = dn;
                        }
                        if (best < Infinity) c = best + 1;
                    }
                    d = c !== undefined ? c * 35 : d + (WEIGHTS.evalUnreachableSteps || 0) * 35;
                }
                v += WEIGHTS.evalHomeDist * d;
            }
        }
        return v;
    }

    // Common-area scrolls are castable by ANYONE — if an opponent's CURRENT
    // board already satisfies one, that's a "loaded gun" distinct from their
    // activated count (a scroll they haven't gotten around to yet doesn't
    // show up there). Uses BotSim.checkPattern(snap, scroll, playerIndex) —
    // a pure function of the snapshot, safe to call on hypothetical/simulated
    // states, not the live board (unlike spellSystem.checkPatternForPlayer).
    // Discarding OUR OWN scroll of the threatened element replaces it
    // (discardToCommonArea sends the old one to the bottom of its deck — a
    // real denial, not just a swap) — search discovers this on its own: the
    // resulting snapshot's commonArea differs, so this term scores lower for
    // whichever opponent was threatening it. No special-casing needed.
    function commonAreaThreat(snap, forIndex) {
        let threat = 0;
        for (const name of snap.commonArea || []) {
            const def = window.SCROLL_DEFINITIONS?.[name];
            if (!def || def.level === 1) continue; // response-only scrolls aren't a main-phase threat
            for (let i = 0; i < snap.players.length; i++) {
                if (i === forIndex || !snap.players[i]) continue;
                if (window.BotSim.checkPattern(snap, name, i)) { threat += WEIGHTS.evalCommonThreat; break; }
            }
        }
        return threat;
    }

    // State value of a snapshot from player `forIndex`'s perspective.
    // This is the search leaf evaluator — tune via WEIGHTS.eval*, not here.

    // ----------------------------------------------------------------
    // Scroll need (Phase 1 of the combo plan, planning/current.md).
    // To win, a player casts one scroll of each element, so a held scroll
    // is worth a lot only when it is the best way to an element the player
    // still needs. handValue() replaces the old flat "30 per scroll" in
    // evaluateSnapshot(), and scrollNeed() tells scroll-effect choices
    // (bot-effects.js) which elements the bot is missing a scroll for.
    // ----------------------------------------------------------------

    // Elements this scroll would activate for player p if cast now.
    function scrollCreditElements(snap, p, def, idx) {
        if (!def || def.level === 1 || !Array.isArray(def.patterns)) return [];
        if (mem(idx).noCreditScrolls.has(def.id)) return [];
        if (def.element === 'catacomb') {
            return [...new Set((def.patterns[0] || []).map(c => c.type))]
                .filter(el => !p.activated.includes(el));
        }
        if (!ELEMENTS.includes(def.element)) return [];
        if (p.activated.includes(def.element) || (snap.sourcePool[def.element] || 0) <= 0) return [];
        return [def.element];
    }

    // How easy is this scroll to build with the stones in the pool?
    // 1 = the pool already covers some variant; lower per missing stone.
    function scrollEase(p, def) {
        let best = Infinity;
        for (const variant of def.patterns || []) {
            const need = {};
            for (const c of variant) need[c.type] = (need[c.type] || 0) + 1;
            let short = 0;
            for (const t in need) short += Math.max(0, need[t] - (p.pool[t] || 0));
            if (short < best) best = short;
        }
        if (best === Infinity) return 0.2;
        return Math.max(0.2, 1 / (1 + best / 2));
    }

    // Value of player idx's held scrolls, plus per-element cover (0..1).
    function handValue(snap, idx) {
        const p = snap.players[idx];
        const cover = {};
        for (const el of ELEMENTS) cover[el] = 0;
        if (!p) return { value: 0, cover };
        if (!p.hand) return { value: (p.handCount + p.activeCount) * WEIGHTS.evalScrollHeld, cover };
        const held = [...p.hand, ...(p.active || [])];
        let value = 0;
        const known = [];
        const unknownEls = []; // element-known draws ('?unknown:water?')
        let unknownAny = 0;    // fully unknown draws
        for (const name of held) {
            const def = window.SCROLL_DEFINITIONS?.[name];
            if (!def) {
                const el = window.BotSim?.unknownScrollElement?.(name);
                if (el) unknownEls.push(el);
                else if (window.BotSim?.isUnknownScroll?.(name)) unknownAny++;
                else value += WEIGHTS.evalScrollHeld;
                continue;
            }
            if (def.level === 1) { value += WEIGHTS.evalScrollResponse; continue; }
            const els = scrollCreditElements(snap, p, { ...def, id: name }, idx);
            if (!els.length) { value += WEIGHTS.evalScrollNoCredit; continue; }
            known.push({ els, ease: scrollEase(p, def) });
        }
        // Easiest scrolls claim their elements first; a later scroll for an
        // element that is already covered only counts as a spare.
        known.sort((a, b) => b.ease - a.ease);
        for (const k of known) {
            let v = 0;
            for (const el of k.els) {
                if (cover[el] > 0) continue;
                cover[el] = k.ease;
                v += WEIGHTS.evalScrollCredit * k.ease;
            }
            value += Math.max(v, WEIGHTS.evalScrollNoCredit);
        }
        // Draws the sim can't name: valued by what the element is worth now.
        const ue = WEIGHTS.evalScrollUnknownEase;
        const open = el => !p.activated.includes(el) && (snap.sourcePool[el] || 0) > 0;
        for (const el of unknownEls) {
            if (open(el) && cover[el] < ue) {
                value += WEIGHTS.evalScrollCredit * (ue - cover[el]);
                cover[el] = ue;
            } else value += WEIGHTS.evalScrollNoCredit;
        }
        if (unknownAny) {
            let avg = 0;
            for (const el of ELEMENTS) {
                avg += (open(el) && cover[el] < ue)
                    ? Math.max(WEIGHTS.evalScrollCredit * (ue - cover[el]), WEIGHTS.evalScrollNoCredit)
                    : WEIGHTS.evalScrollNoCredit;
            }
            value += unknownAny * avg / ELEMENTS.length;
        }
        const over = p.hand.length - (window.spellSystem?.MAX_HAND_SIZE ?? 2);
        if (over > 0) value -= over * WEIGHTS.evalHandOverflow;
        return { value, cover };
    }

    // How much does player idx still need a scroll of each element?
    // 0 = not needed (activated, or no stones left to earn it) or already
    // covered by an easy held scroll; 1 = needed and nothing held for it.
    function scrollNeed(snap, idx) {
        const p = snap.players[idx ?? snap.turn.activePlayerIndex];
        const out = {};
        if (!p) return out;
        const { cover } = handValue(snap, idx ?? snap.turn.activePlayerIndex);
        for (const el of ELEMENTS) {
            const open = !p.activated.includes(el) && (snap.sourcePool[el] || 0) > 0;
            out[el] = open ? Math.max(0, 1 - cover[el]) : 0;
        }
        return out;
    }

    // How good would it be to GAIN this scroll right now? Used by scroll
    // effects that let the bot pick a scroll (Scholar's Insight card,
    // Inspiring Draught keep / put back). Needed elements it would activate,
    // weighted by how easy it is to build, then level as a tie-break.
    function scrollPickScore(snap, name, idx) {
        idx = idx ?? snap.turn.activePlayerIndex;
        const p = snap.players[idx];
        const def = window.SCROLL_DEFINITIONS?.[name];
        if (!p || !def) return 0;
        if (def.level === 1) return 1;
        const need = scrollNeed(snap, idx);
        const els = scrollCreditElements(snap, p, { ...def, id: name }, idx);
        const ease = scrollEase(p, def);
        return els.reduce((a, el) => a + 100 * need[el] * ease, 0) + (def.level || 0);
    }

    // Real cost for player i to walk home from where they stand (steps; a
    // free wind or chained-water hex counts 0.5), for formula terms
    // (bot-terms.js homeCost). Uses the search's cached field when one is
    // live, else builds it. Unreachable = straight line + the unreachable
    // penalty, like evaluateSnapshot.
    function homeCost(snap, i) {
        const p = snap.players[i];
        const home = p && snap.tiles.find(t => t.isPlayerTile && t.playerIndex === i);
        if (!home) return 0;
        let field = leafField(snap, 'home', i);
        if (field === undefined) field = buildHomeField(snap, i);
        const pk = `${Math.round(p.x)},${Math.round(p.y)}`;
        const c = field?.dist?.get(pk);
        if (c !== undefined) return c;
        // Not the player whose turn it is: the path search counts their own
        // pawn's hex as occupied, so start from the hexes around it (+1 step).
        if (field?.dist) {
            let best = Infinity;
            for (const nb of gridInfo(snap).adj.get(pk) || []) {
                const d = field.dist.get(nb.key);
                if (d !== undefined && d < best) best = d;
            }
            if (best < Infinity) return best + 1;
        }
        return Math.hypot(home.x - p.x, home.y - p.y) / 35 + (WEIGHTS.evalUnreachableSteps || 0);
    }

    function evaluateSnapshot(snap, forIndex) {
        const p = snap.players[forIndex];
        if (!p) return -Infinity;
        const win = window.BotSim.winner(snap);
        if (win === forIndex) return WEIGHTS.evalWin;
        if (win !== null) return -WEIGHTS.evalWin;

        let v = 0;
        v += p.activated.length * WEIGHTS.evalActivated;
        for (const el of ELEMENTS) {
            const n = p.pool[el] || 0;
            const useful = !p.activated.includes(el) && (snap.sourcePool[el] || 0) > 0;
            v += n * (useful ? WEIGHTS.evalStoneNeeded : WEIGHTS.evalStone);
        }
        v += (p.pool.void || 0) * WEIGHTS.evalVoidHeld;
        v += handValue(snap, forIndex).value;
        // AP only counts while still inside the original turn — after a
        // simulated endTurn the reset would otherwise make passing the turn
        // look like free value (single-player keeps the same activePlayerIndex)
        if (snap.turn.activePlayerIndex === forIndex && !(snap.sim?.turnsEnded > 0)) {
            v += snap.turn.ap * WEIGHTS.evalAp;
        }
        // Flat credit for effects the simulator honestly didn't model — but
        // only for casts that granted a new activation, or the search farms
        // the flat value by re-casting an already-won scroll forever
        for (const c of snap.sim?.unsimulatedCasts || []) {
            if (c.grantedNew) v += WEIGHTS.evalUnsimCast;
        }

        // Home / explore distance. Inside a search decision these use real
        // path costs (leafField, recomputed when a break or a void changes
        // which stones block), ~35px per step so the weights keep their
        // euclidean scale. An unreachable goal costs evalUnreachableSteps
        // extra steps, so the search can SEE that clearing a wall helps.
        const STEP_PX = 35;
        const unreachablePx = WEIGHTS.evalUnreachableSteps * STEP_PX;
        const pk = `${Math.round(p.x)},${Math.round(p.y)}`;
        const allActivated = ELEMENTS.every(el => p.activated.includes(el));
        if (allActivated) {
            const home = snap.tiles.find(t => t.isPlayerTile && t.playerIndex === forIndex);
            if (home) {
                let d = Math.hypot(home.x - p.x, home.y - p.y);
                const field = leafField(snap, 'home', forIndex);
                if (field) {
                    const c = field.dist.get(pk);
                    d = c !== undefined ? c * STEP_PX : d + unreachablePx;
                }
                v += WEIGHTS.evalHomeDist * d;
            }
        } else {
            const hidden = snap.tiles.filter(t => !t.revealed && !t.isPlayerTile);
            if (hidden.length) {
                let d = null;
                const field = leafField(snap, 'explore', forIndex);
                if (field) {
                    const c = field.dist.get(pk);
                    if (c !== undefined) d = c * STEP_PX;
                    else d = Math.min(...hidden.map(t => Math.hypot(t.x - p.x, t.y - p.y))) + unreachablePx;
                }
                if (d === null) d = Math.min(...hidden.map(t => Math.hypot(t.x - p.x, t.y - p.y)));
                v += WEIGHTS.evalHiddenDist * d;
            }
        }

        // Opponent threat — zero-sum: their progress toward winning is danger
        // to us. MAX across opponents (not sum) so this reacts to whoever is
        // most advanced without being diluted by player count in 3-5p games.
        // Alliances Phase 2 (js/bot-diplomacy.js): each opponent's progress is
        // weighted by how hard this bot pushes against them (1 = normal; the
        // clear leader up to 4 when they could win next turn).
        const press = window.BotDiplomacy?.pressures?.(forIndex) || null;
        let maxOppProgress = 0;
        for (let i = 0; i < snap.players.length; i++) {
            if (i === forIndex || !snap.players[i]) continue;
            maxOppProgress = Math.max(maxOppProgress, opponentProgress(snap, i) * (press ? press[i] : 1));
        }
        v -= maxOppProgress * WEIGHTS.evalOpponentThreat;
        v -= commonAreaThreat(snap, forIndex);

        // Formula terms (js/bot-terms.js): extra measurements the brain can
        // carry as plain data (WEIGHTS.terms), added by training or the
        // hermit's Formula Lab. None on a table = no change at all.
        if (WEIGHTS.terms && WEIGHTS.terms.length && window.BotTerms) {
            v += window.BotTerms.score(WEIGHTS.terms, snap, forIndex);
        }

        return v;
    }

    // Drop placeStone/cast actions that can never grant win credit (see
    // hasWinCredit()) — search has no other way to notice a pattern is
    // pointless, since evaluateSnapshot() only sees pool/activated counts,
    // not "is this scroll's pattern even completable." Applied at every
    // ply, not just the root, so the search tree never expands through one.
    // cast needs its own check (not hasWinCredit's element/pool logic):
    // BotSim's simCast() unconditionally activates the element on cast (it
    // doesn't model per-scroll special-effect preconditions like Sacrificial
    // Pyre cancelling on an empty hand — see trackCastCredit()), so a
    // blacklisted scroll would otherwise look like a guaranteed win-credit
    // step to the search and get picked every time despite really being a
    // no-op in the real game.
    function creditFilter(snap, acts) {
        const noCredit = mem(snap.turn.activePlayerIndex).noCreditScrolls;
        return acts.filter(a =>
            (a.type !== 'placeStone' || hasWinCredit(snap, a.scroll)) &&
            (a.type !== 'cast' || !noCredit.has(a.scroll)));
    }

    // Beam search: at every node, 1-ply-evaluate all children, expand only
    // the top `searchBreadth`. Root actions come from the REAL legalActions()
    // (game-validated); deeper plies use BotSim.legalActions (pure mirror).
    // Returns {action, score} or null when search can't run here.
    // Alliances safeguard (docs/bot-alliances.md): never take an action that
    // lets another player win on their next turn (they have all 5 elements
    // and could walk home) unless the same action wins for this bot. Only
    // runs while some opponent has all five, so it costs nothing earlier.
    // If every action would do it, keep them all (never leave the bot stuck).
    function kingmakerFilter(snap, acts) {
        const D = window.BotDiplomacy, sim = window.BotSim;
        if (!D?.enabled?.() || !sim || !acts.length || acts[0].type === 'placeTile') return acts;
        const self = snap.turn.activePlayerIndex;
        const danger = snap.players.map((p, j) => (j !== self && p && p.activated.length >= 5) ? j : -1).filter(j => j >= 0);
        if (!danger.length) return acts;
        const can = (s, j) => { try { return homeCost(s, j) <= 5; } catch (e) { return false; } };
        const before = new Set(danger.filter(j => can(snap, j)));
        const risky = danger.filter(j => !before.has(j));
        if (!risky.length) return acts;
        const keep = acts.filter(a => {
            if (!['placeStone', 'breakStone', 'cast', 'move'].includes(a.type)) return true;
            let after;
            try { after = sim.simulate(snap, a); } catch (e) { return true; }
            if (sim.winner(after) === self) return true;
            return !risky.some(j => can(after, j));
        });
        if (keep.length < acts.length) { kingmakerStats.checks++; kingmakerStats.blocked += acts.length - keep.length; }
        return keep.length ? keep : acts;
    }
    const kingmakerStats = { checks: 0, blocked: 0 };

    function searchPick() {
        const sim = window.BotSim;
        if (!sim) return null;
        const snap0 = window.BotState.snapshot();
        const meIdx = snap0.turn.activePlayerIndex;
        const legal = kingmakerFilter(snap0, window.BotState.legalActions());
        if (!legal.length || legal[0].type === 'placeTile') return null;

        const castable = legal.some(a => a.type === 'cast');
        const depth = Math.max(1, WEIGHTS.searchDepth | 0) + (castable ? Math.max(0, WEIGHTS.searchCastExtraDepth | 0) : 0);
        const breadth = Math.max(2, WEIGHTS.searchBreadth | 0);
        const keepN = Math.max(0, WEIGHTS.searchKeepCasts | 0);
        // Top `n` by one-ply value, plus up to keepN casts that fell outside.
        function keepCasts(sorted, n) {
            const top = sorted.slice(0, n);
            let extra = 0;
            for (let i = n; i < sorted.length && extra < keepN; i++) {
                if (sorted[i].a.type === 'cast') { top.push(sorted[i]); extra++; }
            }
            return top;
        }
        _fieldCtx = { cache: new Map() }; // path-aware leaf evaluation (leafField)
        const uctx = makeUnblockCtx(snap0);
        // Stage 4 terrain-control sets — root-only by design (see
        // tacticalContext): evaluateSnapshot() never sees them, so leaves
        // stay cheap; the bonus is folded into the root scores below the
        // same way revisitPenalty already is.
        const tac = legal.some(a => a.type === 'placeStone') ? tacticalContext(snap0) : null;

        // `pv` (optional array) receives the best line found below this node,
        // so the Bot Mind viewer can show what the search expects to play.
        function value(snap, d, pv) {
            // Leaf: depth exhausted, game over, or the turn passed (endTurn)
            if (d <= 0 || snap.turn.activePlayerIndex !== meIdx || sim.isTerminal(snap)) {
                return evaluateSnapshot(snap, meIdx);
            }
            const acts = creditFilter(snap, sim.legalActions(snap));
            if (!acts.length) return evaluateSnapshot(snap, meIdx);
            const children = keepCasts(acts
                .map(a => { const s1 = sim.simulate(snap, a); return { a, s1, v1: evaluateSnapshot(s1, meIdx) }; })
                .sort((x, y) => y.v1 - x.v1), breadth);
            let best = -Infinity;
            for (const c of children) {
                const line = pv ? [] : null;
                const v = value(c.s1, d - 1, line);
                if (v > best) {
                    best = v;
                    if (pv) { pv.length = 0; pv.push(c.a, ...line); }
                }
            }
            return best;
        }

        // Root: beam over the real legal actions, but move the bot's
        // anti-oscillation penalty into the root scores so search ties
        // break the same way greedy's do.
        const scored = creditFilter(snap0, legal)
            .map(a => { const s1 = sim.simulate(snap0, a); return { a, s1, v1: evaluateSnapshot(s1, meIdx) }; })
            .sort((x, y) => y.v1 - x.v1);
        const rootChildren = keepCasts(scored, Math.max(breadth, 8)); // keep the root a little wider
        // Alliances: harming the leader is root-only too (the leaf eval does
        // not see it), and a break of its fresh stone always gets a look.
        const harm = me(snap0) ? harmContext(snap0, me(snap0)) : null;
        const harmRoot = (a) => {
            if (!harm) return 0;
            if (a.type === 'breakStone' && harm.stones.has(hexKey(a.x, a.y))) return WEIGHTS.breakLeaderPattern * harm.push;
            if (harm.campHere && (a.type === 'move' || a.type === 'teleport')) return WEIGHTS.campLeave * harm.push;
            if (harm.campHere && a.type === 'endTurn') return WEIGHTS.endTurnCamp * harm.push;
            return 0;
        };
        const help = me(snap0) ? helpContext(snap0, me(snap0)) : null;
        const helpRoot = (a) => {
            if (!help) return 0;
            if (a.type === 'discardScroll' && help.gift.has(scrollElement(a.scroll)) && window.SCROLL_DEFINITIONS?.[a.scroll]?.level > 1) return WEIGHTS.discardForAlly;
            if (a.type === 'placeStone' && a.stoneType === 'wind' && help.road.has(hexKey(a.x, a.y))) return WEIGHTS.placeAllyRoad * help.push;
            return 0;
        };
        if (harm) for (const c of scored) if (harmRoot(c.a) > 0 && !rootChildren.includes(c)) rootChildren.push(c);
        let best = null;
        for (const c of rootChildren) {
            const line = [];
            let v = value(c.s1, depth - 1, line) + harmRoot(c.a) + helpRoot(c.a);
            if (c.a.type === 'move') v += revisitPenalty(mem(meIdx).recentPositions, c.a, WEIGHTS.moveRevisitPenalty);
            if (c.a.type === 'teleport') v += revisitPenalty(mem(meIdx).recentPositions, c.a, WEIGHTS.teleportRevisitPenalty);
            if (c.a.type === 'breakStone' || c.a.type === 'placeStone') v += unblockBonus(c.a, snap0, uctx);
            if (c.a.type === 'cast') v += comboBonus(c.a, snap0);
            if (c.a.type === 'placeStone') {
                v += tacticalPlaceBonus(c.a, snap0, tac);
                // Tactical placements have no pattern value the eval could
                // see — keep the same idle-drop bias greedy scoring has.
                if (!c.a.scroll) v += WEIGHTS.placeTacticalBase;
            }
            if (!best || v > best.score) best = { action: c.a, score: v, line: [c.a, ...line], depth };
        }
        _fieldCtx = null; // valid only for this decision
        return best;
    }

    // ----------------------------------------------------------------
    // Stage 2 step 5: multi-turn MCTS. searchPick() above treats a would-be
    // opponent turn as a leaf (evaluateSnapshot() the instant
    // activePlayerIndex would change) — it never actually sees how an
    // opponent might respond. mctsPick() instead rolls real games forward
    // THROUGH opponent turns (and our own later turns) via a fixed rollout
    // policy, so opponent responses genuinely shape which current option
    // looks best — the "UCT over turns" the roadmap describes, plus the
    // opponent-awareness a single-turn search structurally can't have.
    //
    // Root-level UCT: one bandit arm per legal action available RIGHT NOW.
    // Each simulation plays that arm, then rolls the WHOLE REST OF THE GAME
    // forward — every player's turn, including ours, via rolloutStep() below
    // — until a terminal win or mctsHorizon actions elapse, then values the
    // leaf from OUR OWN perspective. Not full adversarial minimax; "how
    // would a reasonable opponent actually respond" via the same
    // evaluateSnapshot()-driven policy every player uses for themselves.
    //
    // Hidden information: DETERMINIZED (see determinize() below) — mctsPick
    // samples mctsSamples plausible completions, runs one full UCT search
    // per sample, and majority-votes the root action across them.
    //
    // rolloutStep()'s policy strength matters more than it first looks:
    // arena testing (see mctsRootBreadth's own comment for the sibling root-
    // arm bug this doesn't cover) showed MCTS losing every decided game to
    // the existing depth-3/breadth-5 hybrid searchPick() even after that fix
    // — because a rollout's OWN future turns, including the acting player's,
    // were being played by plain one-ply Stage-1 greedy, far weaker than the
    // real depth-3 search that bot would actually use later. That mismatch
    // makes a good root move look worse than it is, since the rollout can't
    // capitalize on it as well as real play would. rolloutStep() replaces
    // the one-ply scan with a small WEIGHTS.mctsRolloutDepth-ply,
    // WEIGHTS.mctsRolloutBreadth-wide beam per step — still self-interested/
    // greedy in spirit (every ply keeps optimizing the SAME acting player,
    // no adversarial minimax), just less myopic. Applied uniformly to every
    // player, same as before, so this doesn't make opponents any more or
    // less "AI" than the acting player's own future turns — only deeper.
    // ----------------------------------------------------------------

    // Same algorithm as bot-sim.js's mulberry32 (used by BotSim.validate()),
    // duplicated here rather than reached into — bot-sim.js keeps it
    // module-private and it's a 5-line pure function.
    function mulberry32(seed) {
        let a = seed >>> 0;
        return function () {
            a |= 0; a = (a + 0x6D2B79F5) | 0;
            let t = Math.imul(a ^ (a >>> 15), 1 | a);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }

    // Samples one plausible "fully known" completion of the real snapshot's
    // hidden information: each still-hidden tile gets a uniformly-random
    // element (never invented for real decisions — bot-sim.js's own reveal
    // logic is untouched; this is a throwaway hypothetical copy used only
    // for this rollout) and gets marked revealed in the RETURNED copy —
    // within this one hypothetical it isn't meaningfully hidden anymore, so
    // evaluateSnapshot()'s explore-toward-hidden-tiles shaping correctly
    // doesn't fire during the rollout (nothing left to "explore" in a world
    // we've already decided the contents of). Each opponent's hidden hand
    // gets a plausible CONCRETE scroll per card, matching its already-public
    // element (bot-state.js's handElements) — drawn from that element's
    // deck, excluding any scroll name already visible anywhere in the
    // snapshot (own hand, any active area, common area) so the guess is at
    // least not an obvious duplicate.
    function determinize(realSnap, rng) {
        const snap = JSON.parse(JSON.stringify(realSnap));
        for (const t of snap.tiles) {
            if (t.isPlayerTile || t.revealed) continue;
            t.shrineType = ELEMENTS[Math.floor(rng() * ELEMENTS.length)];
            t.revealed = true;
        }
        const seen = new Set();
        for (const p of snap.players) {
            if (!p) continue;
            for (const s of p.hand || []) seen.add(s);
            for (const s of p.active || []) seen.add(s);
        }
        for (const s of snap.commonArea || []) seen.add(s);

        for (const p of snap.players) {
            if (!p || p.hand) continue; // already known (our own hand) — leave alone
            const guessed = [];
            for (const el of p.handElements || []) {
                const deck = window.SCROLL_DECKS?.[el] || [];
                const pool = deck.filter(name => !seen.has(name));
                const pick = pool.length ? pool[Math.floor(rng() * pool.length)] : (deck[0] || null);
                if (pick) { guessed.push(pick); seen.add(pick); }
            }
            p.hand = guessed;
        }
        return snap;
    }

    // Whoever's turn snap.turn.activePlayerIndex says it is picks ONE
    // action — the rollout's step function, applied uniformly to every
    // player (ourselves included, on later turns) so opponents are modeled
    // as reasonably self-interested rather than absent or random. Not plain
    // one-ply greedy: prunes to the top `breadth` legal actions by one-ply
    // evaluateSnapshot(), then (while `depth` remains) recurses ONE more
    // ply past each survivor and re-ranks by that deeper value — still
    // scored entirely from the CURRENT acting player's own perspective at
    // every ply (self-interested "how does this look a couple of moves from
    // now," not adversarial minimax against whoever's turn a deeper ply
    // lands on). depth=1 collapses to the original one-ply scan. Returns
    // the snapshot right after the ONE action chosen at this ply, same
    // contract the old one-ply-only version had, so rollout() below is
    // unchanged.
    function rolloutStep(snap, depth) {
        const acting = snap.turn.activePlayerIndex;
        const acts = creditFilter(snap, window.BotSim.legalActions(snap));
        if (!acts.length) return null;
        const breadth = Math.max(1, WEIGHTS.mctsRolloutBreadth | 0);
        const ranked = acts
            .map(a => { const s1 = window.BotSim.simulate(snap, a); return { s1, v1: evaluateSnapshot(s1, acting) }; })
            .sort((x, y) => y.v1 - x.v1)
            .slice(0, breadth);
        if (depth <= 1 || ranked.length === 1) return ranked[0].s1;
        let bestSnap = ranked[0].s1, bestV = -Infinity;
        for (const c of ranked) {
            if (window.BotSim.isTerminal(c.s1)) {
                const v = evaluateSnapshot(c.s1, acting);
                if (v > bestV) { bestV = v; bestSnap = c.s1; }
                continue;
            }
            const deeper = rolloutStep(c.s1, depth - 1);
            const v = evaluateSnapshot(deeper || c.s1, acting);
            if (v > bestV) { bestV = v; bestSnap = c.s1; }
        }
        return bestSnap;
    }

    // Rolls a determinized snapshot forward via rolloutStep() until a
    // terminal win/loss or `horizon` actions have elapsed, then values the
    // result from meIdx's own perspective (evaluateSnapshot already returns
    // ±WEIGHTS.evalWin for an already-terminal snapshot, so no special case
    // is needed here beyond stopping the loop).
    function rollout(startSnap, meIdx, horizon) {
        let snap = startSnap;
        const depth = Math.max(1, WEIGHTS.mctsRolloutDepth | 0);
        for (let i = 0; i < horizon; i++) {
            if (window.BotSim.isTerminal(snap)) break;
            const next = rolloutStep(snap, depth);
            if (!next) break; // no legal action at all shouldn't happen (endTurn is always legal), but never loop forever
            snap = next;
        }
        return evaluateSnapshot(snap, meIdx);
    }

    // Public: root-level UCT over the CURRENT set of legal actions, K
    // determinized samples majority-voted. Returns {action, score, votes,
    // samples} or null when it can't run here (placement phase, no BotSim,
    // no legal actions) — same shape as searchPick()'s return (score is the
    // winning arm's average rollout value, so callers that inspect
    // choice.score — e.g. botAct()'s anti-freeze check — see a number on
    // the same evaluateSnapshot() scale, not undefined).
    // opts.seed: optional, for reproducible tests — omitted in real play so
    // consecutive calls sample fresh completions.
    //
    // Root arms are pruned to the top WEIGHTS.mctsRootBreadth by one-ply
    // evaluateSnapshot() before any UCB1 iteration runs (same trick as
    // searchPick()'s root). Without this, a position with more legal
    // actions than mctsIterations (routine — see mctsRootBreadth's own
    // comment) forces every arm to be visited at most once each, UCB1
    // comparison never actually triggers (arms.find(x => x.visits === 0)
    // keeps finding a fresh arm every iteration), and the final "most
    // visited" tiebreak silently falls back to whichever action
    // legalActions() happened to enumerate first — a real bug, confirmed by
    // a reproduction where the dominant action, placed past index
    // mctsIterations in enumeration order, was never even sampled.
    // Bonus pseudo-visits per matching js/bot-memory.js retrieval, seeded
    // onto the root's arms before real UCB1 iterations begin — a PRIOR,
    // not an override: an arm this seeds still competes on equal footing
    // afterward (its pseudo-average only holds until real rollouts either
    // confirm or swamp it), and any arm memory has nothing to say about
    // still gets its own force-tried real rollout.
    const MEMORY_PRIOR_K = 5;
    const MEMORY_PRIOR_VISITS = 2;

    function mctsPick(opts = {}) {
        const sim = window.BotSim;
        if (!sim || !window.BotState) return null;
        const realSnap = window.BotState.snapshot();
        const meIdx = realSnap.turn.activePlayerIndex;
        if (!realSnap.players[meIdx]) return null;

        const K          = Math.max(1, WEIGHTS.mctsSamples | 0);
        const iterations = Math.max(1, WEIGHTS.mctsIterations | 0);
        const horizon    = Math.max(1, WEIGHTS.mctsHorizon | 0);
        const C          = WEIGHTS.mctsExploration;
        const baseSeed   = (opts.seed ?? Date.now()) >>> 0;

        const votes = new Map();      // actionKey -> vote count
        const actionByKey = new Map(); // actionKey -> {action, avgValue}

        for (let k = 0; k < K; k++) {
            const rng = mulberry32((baseSeed ^ Math.imul(k + 1, 2654435761)) >>> 0);
            const detSnap = determinize(realSnap, rng);
            const legal = creditFilter(detSnap, sim.legalActions(detSnap));
            if (!legal.length || legal[0].type === 'placeTile') continue;

            const rootBreadth = Math.max(2, WEIGHTS.mctsRootBreadth | 0);
            const pruned = legal.length <= rootBreadth ? legal : legal
                .map(a => { const s1 = sim.simulate(detSnap, a); return { a, v1: evaluateSnapshot(s1, meIdx) }; })
                .sort((x, y) => y.v1 - x.v1)
                .slice(0, rootBreadth)
                .map(x => x.a);

            const arms = pruned.map(a => ({ a, visits: 0, total: 0 }));
            if (window.BotMemory?.retrieveSimilar) {
                const baseline = evaluateSnapshot(detSnap, meIdx);
                const similar = window.BotMemory.retrieveSimilar(detSnap, meIdx, MEMORY_PRIOR_K);
                for (const ep of similar) {
                    const arm = arms.find(x => window.BotMemory.actionKey(x.a) === ep.actionKey);
                    if (!arm) continue;
                    arm.visits += MEMORY_PRIOR_VISITS;
                    arm.total += MEMORY_PRIOR_VISITS * (baseline + ep.swing);
                }
            }
            for (let it = 0; it < iterations; it++) {
                let arm = arms.find(x => x.visits === 0);
                if (!arm) {
                    const totalVisits = arms.reduce((s, x) => s + x.visits, 0);
                    let bestUCB = -Infinity;
                    for (const x of arms) {
                        const ucb = (x.total / x.visits) + C * Math.sqrt(Math.log(totalVisits + 1) / x.visits);
                        if (ucb > bestUCB) { bestUCB = ucb; arm = x; }
                    }
                }
                const s1 = sim.simulate(detSnap, arm.a);
                arm.visits++;
                arm.total += rollout(s1, meIdx, horizon);
            }
            // Final pick: most-VISITED arm — standard UCT choice, more
            // robust than highest-average against a single lucky rollout.
            const chosen = arms.reduce((best, x) => (!best || x.visits > best.visits) ? x : best, null);
            const key = JSON.stringify(chosen.a);
            votes.set(key, (votes.get(key) || 0) + 1);
            actionByKey.set(key, { action: chosen.a, avgValue: chosen.total / chosen.visits });
        }

        if (!votes.size) return null;
        let bestKey = null, bestVotes = -1;
        for (const [key, count] of votes) {
            if (count > bestVotes) { bestVotes = count; bestKey = key; }
        }
        const winner = actionByKey.get(bestKey);
        return { action: winner.action, score: winner.avgValue, votes: bestVotes, samples: K };
    }

    // Alliances: harm the coalition target (js/bot-diplomacy.js) the way the
    // owner listed (2026-09-27). Only while it is a real danger (push 2+).
    //  - stones: its stones from the last round, of elements it still needs
    //    (public: who placed what), still on the board -> worth breaking.
    //  - camps: revealed shrines of an element it still needs, with the
    //    supply nearly gone (3 or less) and it short of that stone -> stand on
    //    it so the leader cannot collect there.
    function harmContext(snap, self) {
        const D = window.BotDiplomacy;
        if (!D?.enabled?.() || !D.coalitionTarget || !D.recentStones) return null;
        const ai = snap.turn.activePlayerIndex;
        const L = D.coalitionTarget(ai);
        const lp = L != null ? snap.players[L] : null;
        if (!lp) return null;
        const push = (D.pressures(ai) || [])[L] || 1;
        if (push < 2) return null;
        const need = ELEMENTS.filter(el => !lp.activated.includes(el));
        const seats = snap.players.filter(Boolean).length;
        const stones = new Set();
        for (const r of D.recentStones(L, seats)) {
            if (!need.includes(r.type)) continue;
            const st = snap.stones.find(q => q.type === r.type && Math.hypot(q.x - r.x, q.y - r.y) < 5);
            if (st) stones.add(hexKey(st.x, st.y));
        }
        const camps = [];
        let campHere = null;
        for (const t of snap.tiles) {
            if (!t.revealed || t.isPlayerTile || !need.includes(t.shrineType)) continue;
            if ((snap.sourcePool[t.shrineType] || 0) > 3 || (lp.pool[t.shrineType] || 0) >= 3) continue;
            if (snap.stones.some(q => Math.hypot(q.x - t.x, q.y - t.y) < 5)) continue; // already blocked
            if (Math.hypot(self.x - t.x, self.y - t.y) < 5) { campHere = t; continue; }
            if (snap.players.some((q, j) => q && j !== ai && Math.hypot(q.x - t.x, q.y - t.y) < 5)) continue;
            camps.push(t);
        }
        return { L, push, stones, camps, campHere };
    }

    // Alliances: help fellow pact members (owner's list, 2026-09-27).
    //  - gift: elements some partner still needs, that the pact's target
    //    already has (so it gains no win from the scroll) and I already have
    //    too -> discarding such a scroll to the common area helps.
    //  - road: hexes on the way home of a partner with all five -> wind
    //    there helps. kingmakerFilter still stops any action that brings
    //    them within 5 AP of home, so the help stays small.
    function helpContext(snap, self) {
        const D = window.BotDiplomacy;
        const P = D?.enabled?.() ? D.pact?.() : null;
        const ai = snap.turn.activePlayerIndex;
        if (!P || !P.members.includes(ai)) return null;
        const lp = snap.players[P.target];
        if (!lp) return null;
        const partners = P.members.filter(m => m !== ai && snap.players[m]);
        const gift = new Set();
        for (const el of ELEMENTS) {
            if (!lp.activated.includes(el) || !self.activated.includes(el)) continue;
            if ((snap.sourcePool[el] || 0) <= 0) continue;
            if (partners.some(m => !snap.players[m].activated.includes(el))) gift.add(el);
        }
        const road = new Set();
        for (const m of partners) {
            const q = snap.players[m];
            if (!ELEMENTS.every(el => q.activated.includes(el))) continue;
            const home = snap.tiles.find(t => t.isPlayerTile && t.playerIndex === m);
            const path = home && pathToOrNear(q.x, q.y, home.x, home.y);
            for (const st of path || []) road.add(hexKey(st.x, st.y));
        }
        if (!gift.size && !road.size) return null;
        const push = (D.pressures(ai) || [])[P.target] || 1;
        return { gift, road, push };
    }

    // Rank all legal actions for the current position (debug + decision core)
    // fixationTarget: optional {x,y} from findFixationTarget(), passed by
    // botAct()'s turn-repeat circuit breaker (see turnRepeatStreak below) —
    // turns into a real path in ctx.fixationPath for scoreAction()'s move
    // case. Omitted on every other call site, same as ctx.homePath being
    // conditional on all-5-activated.
    // opts.withTrace (default false): attach each candidate's raw feature
    // trace (see scoreAction()'s contrib()) alongside its score — used only
    // by js/bot-imitation.js's hermit-only learn-from-my-play feature. Every
    // existing call site omits opts, so this can never change default
    // behavior; it only adds a `.trace` object to each returned entry.
    function rankActions(fixationTarget, opts) {
        const withTrace = !!(opts && opts.withTrace);
        const snap = window.BotState.snapshot();
        const legal = kingmakerFilter(snap, window.BotState.legalActions());
        const scoreWithOptionalTrace = (a, ctx) => {
            const trace = withTrace ? {} : null;
            const score = scoreAction(a, snap, trace ? { ...ctx, trace } : ctx);
            return withTrace ? { action: a, score, trace } : { action: a, score };
        };

        // Placement phase: no pawn placed yet, so me(snap) is null — the only
        // legal actions are placeTile candidates, scored without needing self.
        if (legal.length && legal[0].type === 'placeTile') {
            return legal
                .map(a => scoreWithOptionalTrace(a, {}))
                .sort((x, y) => y.score - x.score);
        }

        const self = me(snap);
        if (!self) return [];

        const ctx = {
            shrines: collectibleShrines(snap),
            onShrine: shrineUnderfoot(snap),
            hiddenTiles: snap.tiles.filter(t => !t.revealed && !t.isPlayerTile),
            paths: new Map(),
            recentPositions: mem(snap.turn.activePlayerIndex).recentPositions,
            homePath: null,
            unblock: makeUnblockCtx(snap),
        };
        for (const t of ctx.shrines) {
            ctx.paths.set(t.id, window.BotState.findPath(self.x, self.y, t.x, t.y));
        }
        // Cheapest real path to any walkable hex of a hidden tile (their outer
        // rings ARE walkable). Hidden tile CENTRES are not on the hex grid, so
        // findPath to the centre returns null — target the ring hexes instead.
        ctx.explorePath = null;
        if (ctx.hiddenTiles.length) {
            const targets = window.BotState.hexGrid()
                .filter(h => h.tiles?.some(t => t.flipped && !t.isPlayerTile))
                .sort((a, b) => Math.hypot(a.x - self.x, a.y - self.y) - Math.hypot(b.x - self.x, b.y - self.y));
            let best = null;
            for (const h of targets.slice(0, 10)) {
                if (Math.hypot(h.x - self.x, h.y - self.y) < 5) { best = null; break; } // already there
                const path = window.BotState.findPath(self.x, self.y, h.x, h.y);
                if (!path || !path.length) continue;
                const cost = path.reduce((c, p) => c + p.cost, 0);
                if (!best || cost < best.cost) best = { path, cost };
            }
            if (best) ctx.explorePath = best.path;
        }
        // All 5 elements activated → path back to the bot's own player shrine
        if (ELEMENTS.every(el => self.activated.includes(el))) {
            const homeTile = snap.tiles.find(t =>
                t.isPlayerTile && t.playerIndex === snap.turn.activePlayerIndex);
            if (homeTile) {
                const path = window.BotState.findPath(self.x, self.y, homeTile.x, homeTile.y);
                if (path && path.length) ctx.homePath = path;
            }
        }
        // Alliances: harm the leader (breaking its fresh stones, camping).
        ctx.harm = harmContext(snap, self);
        ctx.help = helpContext(snap, self);
        ctx.campPath = null; ctx.breakPath = null;
        if (ctx.harm && !ctx.harm.campHere) {
            let best = null;
            for (const t of ctx.harm.camps) {
                const path = window.BotState.findPath(self.x, self.y, t.x, t.y);
                if (!path || !path.length) continue;
                const cost = pathCost(path);
                if (cost <= 8 && (!best || cost < best.cost)) best = { path, cost };
            }
            if (best) ctx.campPath = best.path;
        }
        if (ctx.harm && ctx.harm.stones.size && !legal.some(a => a.type === 'breakStone' && ctx.harm.stones.has(hexKey(a.x, a.y)))) {
            let best = null;
            const targets = [...ctx.harm.stones].map(k => { const [x, y] = k.split(',').map(Number); return { x, y }; })
                .filter(t => Math.hypot(t.x - self.x, t.y - self.y) < 35 * 5);
            for (const h of window.BotState.hexGrid()) {
                if (!targets.some(t => { const d = Math.hypot(t.x - h.x, t.y - h.y); return d > 5 && d < 40; })) continue;
                if (snap.stones.some(q => Math.hypot(q.x - h.x, q.y - h.y) < 5)) continue;
                const path = window.BotState.findPath(self.x, self.y, h.x, h.y);
                if (!path || !path.length) continue;
                const cost = pathCost(path);
                if (cost <= 3 && (!best || cost < best.cost)) best = { path, cost };
            }
            if (best) ctx.breakPath = best.path;
        }
        ctx.fixationPath = null;
        if (fixationTarget) {
            const path = window.BotState.findPath(self.x, self.y, fixationTarget.x, fixationTarget.y);
            if (path && path.length) ctx.fixationPath = path;
        }
        // Stage 4 terrain-control sets — only worth building when a stone
        // placement is actually on the table this decision.
        ctx.tac = legal.some(a => a.type === 'placeStone') ? tacticalContext(snap) : null;

        const out = legal
            .map(a => scoreWithOptionalTrace(a, ctx))
            .sort((x, y) => y.score - x.score);
        if (opts && opts.withCtx) out.ctx = ctx; // Bot Mind viewer: goals/paths
        return out;
    }

    // ----------------------------------------------------------------
    // One bot step: pick argmax, apply it. Returns the applied action or null.
    // ----------------------------------------------------------------
    // ----------------------------------------------------------------
    // Bot Mind: plain-language reasons for the viewer (js/bot-mind.js).
    // Read-only: nothing here changes what the bot decides.
    // ----------------------------------------------------------------
    const cap = w => w ? w.charAt(0).toUpperCase() + w.slice(1) : '';
    const scrollName = id => window.SCROLL_DEFINITIONS?.[id]?.name || id || '';
    const pathCost = path => path ? path.reduce((c, p) => c + p.cost, 0) : 0;
    const firstHop = (path, a) => !!(path && path.length && Math.hypot(path[0].x - a.x, path[0].y - a.y) < 5);

    function explainAction(a, snap, ctx) {
        const self = me(snap);
        switch (a.type) {
            case 'placeTile': return 'Place home tile';
            case 'cast': {
                const el = scrollElement(a.scroll);
                const n = scrollName(a.scroll);
                const c = a.choice;
                const who = i => (typeof getPlayerColorName === 'function') ? getPlayerColorName(i) : `player ${i + 1}`;
                if (c && a.scroll === 'FIRE_SCROLL_5') return `Cast ${n}: burn one of ${who(c.target)}'s ${c.element} stones`;
                if (c && a.scroll === 'CATACOMB_SCROLL_8') return `Cast ${n}: send ${who(c.target)}'s ${scrollName(c.scroll)} to the common area`;
                if (c && a.scroll === 'VOID_SCROLL_5') return `Cast ${n}: draw ${c.element} stones`;
                if (c && a.scroll === 'WIND_SCROLL_4') return `Cast ${n}: fly to another player's tile`;
                if (c && a.scroll === 'EARTH_SCROLL_2') return `Cast ${n}: swap a nearby tile with a tile worth having close`;
                if (c && a.scroll === 'VOID_SCROLL_2') return `Cast ${n}: move a tile next to this one`;
                if (c && c.tileId == null) {
                    const e = c.element;
                    if (a.scroll === 'CATACOMB_SCROLL_9') return `Cast ${n}: take the ${e} level-1 scroll and 2 ${e} stones`;
                    return `Cast ${n}: draw from the ${e} deck`;
                }
                if (a.choice) {
                    const t = snap.tiles.find(x => Number(x.id) === Number(a.choice.tileId));
                    const hidden = t && !t.revealed;
                    if (a.scroll === 'WATER_SCROLL_4') {
                        return hidden ? `Cast ${n}: hidden tile becomes ${a.choice.element} (reveal it for a ${a.choice.element} scroll)`
                                      : `Cast ${n}: this shrine counts as ${a.choice.element} (collect ${a.choice.element} stones)`;
                    }
                    const del = choiceDrawElement(a, snap);
                    return `Cast ${n}: flip a hidden tile (draw ${del ? `a ${del}` : 'a'} scroll)`;
                }
                if (el && ELEMENTS.includes(el)) {
                    if (self?.activated.includes(el)) return `Cast ${n} (already has ${el})`;
                    if ((snap.sourcePool[el] || 0) <= 0) return `Cast ${n} (no ${el} stones left to earn)`;
                    return `Cast ${n}: activates ${el}`;
                }
                return `Cast ${n}`;
            }
            case 'placeStone': {
                if (a.scroll) return `${cap(a.stoneType)} stone for ${scrollName(a.scroll)} (${Math.round((a.progress || 0) * 100)}%)`;
                const opens = ctx?.unblock && unblockBonus(a, snap, ctx.unblock) > 0;
                const far = a.ranged ? ' (far away, range buff)' : '';
                const k = hexKey(a.x, a.y);
                if (a.stoneType !== 'void' && ctx?.tac?.oppShrineTargets?.has(k)) return `${cap(a.stoneType)}: block a shrine an opponent is heading for${far}`;
                if (a.stoneType === 'fire' && ctx?.tac && [...ctx.tac.threatStones].some(t => { const [x, y] = t.split(',').map(Number); return Math.hypot(x - a.x, y - a.y) < 40; }))
                    return `Fire: burn an opponent's ready pattern${far}`;
                if (a.stoneType === 'earth' && ctx?.tac?.oppPathCount?.get(k)) return `Earth: wall an opponent's path${far}`;
                if (a.stoneType === 'water' && ctx?.tac?.oppPathCount?.get(k)) return `Water: slow an opponent's path${far}`;
                if (a.stoneType === 'wind' && ctx?.tac?.ownPathHexes?.has(k)) return `Wind: pave own route${far}`;
                if (a.stoneType === 'fire') return opens ? `Fire: burn a blocking stone${far}` : 'Fire: burn nearby stones';
                if (a.stoneType === 'void') return opens ? `Void: open an earth wall${far}` : 'Void stone';
                if (a.stoneType === 'earth') return 'Earth: wall off a path';
                if (a.stoneType === 'wind') return 'Wind: pave own path';
                return `${cap(a.stoneType)} stone`;
            }
            case 'breakStone': {
                const opens = ctx?.unblock && unblockBonus(a, snap, ctx.unblock) > 0;
                if (ctx?.harm?.stones.has(hexKey(a.x, a.y))) return `Break ${a.stoneType} (${a.cost} AP): the leader's new pattern stone`;
                return `Break ${a.stoneType} (${a.cost} AP)${opens ? ': opens the way' : ''}`;
            }
            case 'move': {
                if (ctx) {
                    if (firstHop(ctx.homePath, a)) return `Toward home to win (${pathCost(ctx.homePath)} AP)`;
                    if (firstHop(ctx.campPath, a)) return `Toward a scarce shrine the leader needs (${pathCost(ctx.campPath)} AP)`;
                    if (firstHop(ctx.breakPath, a)) return `Toward the leader's new stones to break them (${pathCost(ctx.breakPath)} AP)`;
                    if (ctx.harm?.campHere) return `Step (leaves the shrine the leader needs)`;
                    if (firstHop(ctx.fixationPath, a)) return `Toward a new build site (${pathCost(ctx.fixationPath)} AP)`;
                    for (const t of ctx.shrines || []) {
                        const path = ctx.paths?.get(t.id);
                        if (firstHop(path, a)) return `Toward ${t.shrineType} shrine (${pathCost(path)} AP)`;
                    }
                    if (ctx.hiddenTiles?.some(t => Math.hypot(t.x - a.x, t.y - a.y) < 70)) return 'Step onto a hidden tile (reveals it)';
                    if (firstHop(ctx.explorePath, a)) return `Toward a hidden tile (${pathCost(ctx.explorePath)} AP)`;
                }
                return `Step (${a.cost} AP)`;
            }
            case 'teleport': return `Teleport to ${a.shrineType} shrine`;
            case 'moveStone': return `Move a ${a.stoneType} stone`;
            case 'discardScroll': {
                if (ctx?.help?.gift.has(scrollElement(a.scroll))) return `Discard ${scrollName(a.scroll)}: a gift for a pact partner`;
                return `Discard ${scrollName(a.scroll)}`;
            }
            case 'endTurn': {
                const on = ctx?.onShrine;
                if (ctx?.harm?.campHere) return `End turn: keep the ${ctx.harm.campHere.shrineType} shrine from the leader`;
                return on ? `End turn: collect ${on.shrineType} stones` : 'End turn';
            }
        }
        return a.type;
    }

    // The tile a cast choice aims at (for the Bot Mind drawing).
    function actionTarget(a, snap) {
        if (!a || !a.choice) return null;
        const c = a.choice;
        if (a.scroll === 'WIND_SCROLL_4' || a.scroll === 'VOID_SCROLL_2') {
            if (c.x != null) return { x: c.x, y: c.y, element: null };
        }
        if (a.scroll === 'EARTH_SCROLL_2') {
            const t = snap.tiles.find(x => Number(x.id) === Number(c.b));
            return t ? { x: t.x, y: t.y, element: null } : null;
        }
        if (c.tileId == null) return null;
        const t = snap.tiles.find(x => Number(x.id) === Number(a.choice.tileId));
        return t ? { x: t.x, y: t.y, element: a.choice.element || choiceDrawElement(a, snap) } : null;
    }

    // Where is the bot trying to go? Same values the move scoring uses.
    function currentGoal(snap, ctx, fixation) {
        const self = me(snap);
        if (!self || !ctx) return null;
        const mk = (kind, label, path, x, y) => ({ kind, label, x, y, cost: pathCost(path),
            path: [{ x: self.x, y: self.y }, ...(path || []).map(p => ({ x: p.x, y: p.y }))] });
        if (ctx.homePath) {
            const h = snap.tiles.find(t => t.isPlayerTile && t.playerIndex === snap.turn.activePlayerIndex);
            return mk('home', 'Home tile (all 5 activated)', ctx.homePath, h?.x, h?.y);
        }
        if (fixation && ctx.fixationPath) return mk('fixation', `New build site for ${scrollName(fixation.scroll)}`, ctx.fixationPath, fixation.x, fixation.y);
        if (ctx.onShrine) return { kind: 'shrine', label: `Standing on ${ctx.onShrine.shrineType} shrine`, x: ctx.onShrine.x, y: ctx.onShrine.y, cost: 0, path: [] };
        let best = null;
        for (const t of ctx.shrines || []) {
            const path = ctx.paths?.get(t.id);
            if (!path || !path.length) continue;
            const v = WEIGHTS.moveShrineValue * shrineValue(snap, t.shrineType) / (1 + pathCost(path));
            if (!best || v > best.v) best = { v, g: mk('shrine', `${cap(t.shrineType)} shrine`, path, t.x, t.y) };
        }
        if (ctx.explorePath && ctx.explorePath.length) {
            const v = WEIGHTS.moveExplorePath / (1 + pathCost(ctx.explorePath));
            const last = ctx.explorePath[ctx.explorePath.length - 1];
            if (!best || v > best.v) best = { v, g: mk('explore', 'Hidden tile (new scroll)', ctx.explorePath, last.x, last.y) };
        }
        return best ? best.g : null;
    }

    function beginThought(snap) {
        const ranked = rankActions(null, { withCtx: true });
        const ctx = ranked.ctx || null;
        const idx = snap.turn.activePlayerIndex;
        return {
            playerIndex: idx,
            turnAp: snap.turn.ap,
            snap, ctx,
            mode: null, line: null, fixation: null,
            options: ranked.slice(0, 6).map(r => ({ action: r.action, score: r.score, reason: explainAction(r.action, snap, ctx) })),
        };
    }

    function finishThought(th, act) {
        const m = mem(th.playerIndex);
        let goal = currentGoal(th.snap, th.ctx, th.fixation);
        // Unstuck mode ranks with a fixation target; rebuild its path for the drawing.
        if (th.fixation && (!goal || goal.kind !== 'fixation')) {
            const self = me(th.snap);
            const path = self && window.BotState.findPath(self.x, self.y, th.fixation.x, th.fixation.y);
            if (path && path.length) goal = { kind: 'fixation', label: `New build site for ${scrollName(th.fixation.scroll)}`,
                x: th.fixation.x, y: th.fixation.y, cost: pathCost(path),
                path: [{ x: self.x, y: self.y }, ...path.map(p => ({ x: p.x, y: p.y }))] };
        }
        const self = me(th.snap);
        // The goal shown should be where the bot is actually walking: when the
        // chosen step is the first hop of a known path, that path wins.
        if (act && act.type === 'move' && th.ctx && self) {
            const ctx = th.ctx;
            const pick = (kind, label, path, x, y) => ({ kind, label, x, y, cost: pathCost(path),
                path: [{ x: self.x, y: self.y }, ...path.map(p => ({ x: p.x, y: p.y }))] });
            let g = null;
            if (firstHop(ctx.homePath, act)) {
                const h = th.snap.tiles.find(t => t.isPlayerTile && t.playerIndex === th.playerIndex);
                g = pick('home', 'Home tile (all 5 activated)', ctx.homePath, h?.x, h?.y);
            }
            for (const t of ctx.shrines || []) {
                const path = ctx.paths?.get(t.id);
                if (!g && firstHop(path, act)) g = pick('shrine', `${cap(t.shrineType)} shrine`, path, t.x, t.y);
            }
            if (!g && firstHop(ctx.explorePath, act)) {
                const last = ctx.explorePath[ctx.explorePath.length - 1];
                g = pick('explore', 'Hidden tile (new scroll)', ctx.explorePath, last.x, last.y);
            }
            if (!g && th.mode === 'plan' && m.plan) {
                const cx = m.plan.cells.reduce((a, c) => a + c.x, 0) / m.plan.cells.length;
                const cy = m.plan.cells.reduce((a, c) => a + c.y, 0) / m.plan.cells.length;
                g = { kind: 'plan', label: `Build site for ${scrollName(m.plan.scroll)}`, x: cx, y: cy, cost: 0,
                    path: [{ x: self.x, y: self.y }, { x: act.x, y: act.y }] };
            }
            if (g) goal = g;
        }
        return {
            playerIndex: th.playerIndex,
            at: Date.now(),
            mode: th.mode || (act ? 'quick' : 'none'),
            ap: th.turnAp,
            from: self ? { x: self.x, y: self.y } : null,
            chosen: act ? { action: act, reason: explainAction(act, th.snap, th.ctx), target: actionTarget(act, th.snap) } : null,
            options: th.options,
            goal,
            plan: m.plan ? { scroll: m.plan.scroll, name: scrollName(m.plan.scroll),
                cells: m.plan.cells.map(c => ({ x: c.x, y: c.y, type: c.type })) } : null,
            line: th.line ? th.line.map(a => ({ action: a, reason: explainAction(a, th.snap, null), target: actionTarget(a, th.snap) })) : null,
            stuck: { unproductive: m.unproductiveStreak, repeat: m.turnRepeatStreak },
            combo: m.combo ? { signature: m.combo.signature, step: m.combo.next, total: m.combo.casts.length,
                next: m.combo.casts[m.combo.next]?.scroll || null } : null,
            searchDepth: th.depth || (WEIGHTS.searchDepth | 0),
        };
    }

    // Bot Mind viewer (js/bot-mind.js): one record per decision. Only built
    // while the viewer is open, so normal and arena play pay nothing.
    let _th = null;
    function botAct() {
        _th = null;
        const snapBefore = (window.BotMind && window.BotMind.wants()) ? window.BotState.snapshot() : null;
        if (snapBefore) {
            try { _th = beginThought(snapBefore); } catch (e) { _th = null; }
        }
        const act = botActCore();
        if (_th) {
            try { window.BotMind.record(finishThought(_th, act)); } catch (e) { log('Bot Mind record failed', e); }
        }
        _th = null;
        return act;
    }

    function botActCore() {
        if (typeof isMultiplayer !== 'undefined' && isMultiplayer &&
            typeof myPlayerIndex !== 'undefined' && activePlayerIndex !== myPlayerIndex) {
            log('Not this client\'s turn - refusing to act (multiplayer guard)');
            return null;
        }

        const snap = window.BotState.snapshot();

        // Hand/active overflow must resolve before anything else — including
        // the pattern plan below, which calls applyAction() directly and would
        // otherwise bypass legalActions()'s discard-only gate while over
        // capacity (see bot-state.js legalActions() overflow gate).
        const self0 = me(snap);
        if (self0) {
            const maxHand = window.spellSystem?.MAX_HAND_SIZE ?? 2;
            const maxActive = window.spellSystem?.MAX_ACTIVE_SIZE ?? 2;
            if (self0.handCount > maxHand || self0.activeCount > maxActive) {
                const ranked = rankActions(); // legalActions() returns discards only right now
                if (ranked.length) {
                    const { action } = ranked[0];
                    if (_th) _th.mode = 'overflow';
                    log(`Resolving scroll overflow: discard ${action.scroll} (from ${action.from})`);
                    const r = window.BotState.applyAction(action);
                    if (r.ok) return action;
                    log(`Discard failed (${r.reason})`);
                }
                return null;
            }
        }

        // All per-bot memory (plan, recent positions, turn-repeat tracking)
        // is keyed by player index — see mem() above.
        const idx = snap.turn.activePlayerIndex;
        const m = mem(idx);
        updateCombo(snap, idx);

        // The pattern plan takes priority: it's the only way multi-hex
        // patterns ever complete under the adjacent-only placement rule
        if (!m.plan || !planValid(snap)) {
            m.plan = makePlan(snap);
            if (m.plan) log(`New plan: build ${m.plan.scroll} anchored at hex (${m.plan.anchor.q},${m.plan.anchor.r})`);
        }
        const planAction = m.plan ? planNextAction(snap) : null;
        if (planAction) {
            const label = planAction.type === 'cast' ? `cast ${planAction.scroll}`
                        : planAction.type === 'placeStone' ? `place ${planAction.stoneType} for ${planAction.scroll}`
                        : planAction.type === 'endTurn' ? 'end turn to collect shrine stones'
                        : `move to (${planAction.x.toFixed(0)},${planAction.y.toFixed(0)})`;
            log(`Plan action: ${label}`);
            if (_th) _th.mode = 'plan';
            const r = window.BotState.applyAction(planAction);
            if (r.ok) {
                if (planAction.type === 'cast') {
                    trackCastCredit(idx, snap, planAction.scroll);
                    _castsApplied++;
                    advanceCombo(idx, planAction);
                    m.plan = null; // plan fulfilled
                }
                if (planAction.type === 'move') recordVisited(idx, planAction.x, planAction.y);
                return planAction;
            }
            log(`Plan action failed (${r.reason}) - falling back to scoring`);
            m.plan = null;
        }

        // Turn-repeat circuit breaker: if the last COMPLETED turn traced the
        // exact same move sequence as the one before it (bookkeeping in
        // botTurn() below), the scoring-driven fallback (search or greedy)
        // is stuck re-deriving an unproductive cycle — the anti-oscillation
        // recency-decay penalty is tuned for 2-hex ties and can get rotated
        // in lockstep by a larger stable N-hex cycle instead of breaking it
        // (RECENT_POS_LIMIT is 6 — any stable loop of 7+ hexes rotates the
        // whole window out from under the penalty before it ever returns to
        // a hex still in memory).
        //
        // That exact-repeat check is a NARROW trigger, though — a bot
        // orbiting a small home region rarely repeats the SAME move list
        // turn to turn (the revisit penalty perturbs lap order), so it can
        // stay at streak 0 for 100+ turns while accomplishing nothing.
        // Confirmed on a real 5-bot 300-turn game log: 4 of 5 bots produced
        // zero casts/placements for the entire second half, movement
        // collapsed from a 400+px exploration spread to a ~70px pocket, and
        // the exact-repeat check fired on almost none of it (different lap
        // order each time). unproductiveStreak (botTurn(), reset only by an
        // actual cast/placeStone) is a direct progress signal instead of a
        // movement-shape one, and triggers the SAME remedy independent of
        // whether the movement looks like a clean loop.
        //
        // Either way, first try findFixationTarget(): a REVEALED hex
        // elsewhere on the board with an uncast-element pattern still
        // buildable pulls the bot there via a strong (but not scripted)
        // scoring term instead of just marking time. If no target exists,
        // an exact-repeat (turnRepeatStreak) falls back to the older "skip
        // movement for one turn" safety net — a confirmed frozen loop
        // genuinely needs SOME intervention. A plain productivity stall
        // (unproductiveStreak alone, no exact repeat) does NOT force that
        // fallback: the bot isn't necessarily looping, just not finding
        // anything to build, and forcing it to stop moving would be actively
        // harmful if repositioning is the only thing left worth doing — it
        // just proceeds to normal scoring below with no fixation applied,
        // same as if this whole block didn't run. Both counters are
        // independent: turnRepeatStreak self-clears (a one-shot
        // intervention, reset by botTurn() regardless of outcome);
        // unproductiveStreak persists across fixation-driven turns and only
        // clears on an actual cast/placeStone — a genuinely dead position
        // (nothing anywhere still grants win credit) just means
        // findFixationTarget() keeps returning null every turn, which is
        // the correct outcome, not a bug to route around further.
        let choice = null;
        const stuckByRepeat = m.turnRepeatStreak >= 1;
        const stuckByStall = m.unproductiveStreak >= UNPRODUCTIVE_LIMIT;
        if (stuckByRepeat || stuckByStall) {
            const fixationTarget = findFixationTarget(snap);
            if (fixationTarget) {
                const ranked = rankActions(fixationTarget);
                if (ranked.length) {
                    choice = ranked[0];
                    if (_th) { _th.mode = 'unstuck'; _th.fixation = fixationTarget; }
                    log(`${stuckByRepeat ? `Turn-repeat circuit breaker (streak ${m.turnRepeatStreak})` : `Unproductive streak (${m.unproductiveStreak})`}: ` +
                        `fixating on ${fixationTarget.scroll} near (${fixationTarget.x.toFixed(0)},${fixationTarget.y.toFixed(0)})`);
                }
            }
            if (!choice && stuckByRepeat) {
                const ranked = rankActions().filter(r => r.action.type !== 'move');
                if (ranked.length) {
                    choice = ranked[0];
                    if (_th) _th.mode = 'unstuck';
                    log(`Turn-repeat circuit breaker (streak ${m.turnRepeatStreak}): skipping movement, picked ${choice.action.type}`);
                } else {
                    const r = window.BotState.applyAction({ type: 'endTurn' });
                    if (r.ok) {
                        log('Turn-repeat circuit breaker: only movement was legal - ending turn');
                        return { type: 'endTurn' };
                    }
                }
            }
        }

        // Stage 2 step 5: multi-turn MCTS, when explicitly enabled — takes
        // priority over single-turn search below. Off by default (see
        // WEIGHTS.mctsEnabled's own comment); falls through to the existing
        // path unchanged when it returns null (placement phase, no legal
        // actions this determinization, etc.).
        if (!choice && WEIGHTS.mctsEnabled && window.BotSim) {
            choice = mctsPick();
            if (choice) {
                if (_th) _th.mode = 'playout';
                log(`MCTS (${choice.samples} samples, ${choice.votes}/${choice.samples} votes) picked ${choice.action.type}`);
                signalBrainMode(snap.turn.activePlayerIndex, 'mcts');
            }
        }

        // Stage 2: lookahead search when enabled, greedy Stage-1 argmax otherwise.
        // Hybrid mode saves the lookahead for states where it can actually pay
        // off — a cast or stone placement is available — and stays greedy for
        // plain movement/exploration.
        if (!choice && (WEIGHTS.searchDepth | 0) > 0 && window.BotSim) {
            let useSearch = true;
            if (WEIGHTS.searchHybrid) {
                const legal = window.BotState.legalActions();
                // Only engage search when a GENUINE tactical decision exists —
                // a legal cast, or a placement that actually bears win credit.
                // Two classes of placement must NOT count as a decision point,
                // or hybrid degenerates into always-on search whose movement
                // choices are known to fight the plan/path logic (see the
                // Stage-2 acceptance measurements: FULL search lost 1-3):
                //   1. Tactical (scroll:null) placements — near-ALWAYS legal
                //      (any held earth/wind/fire next to an empty hex).
                //   2. No-win-credit scroll placements — legalActions()
                //      enumerates a placeStone for every missing cell of every
                //      pattern variant with no credit awareness, so a pattern
                //      for an already-activated element (or one whose source
                //      pool is empty) stays "legal" forever. creditFilter()
                //      already drops these INSIDE the search, so triggering on
                //      one just leaves search doing move-only lookahead — the
                //      exact wandering this gate exists to prevent. Reuse the
                //      same hasWinCredit() the filter/scorer already use so the
                //      trigger and the search agree on what counts.
                // Also while a placement buff is live (Burning Motivation pays
                // AP per stone, Avalanche lifts the range): which stones to
                // spend is a real multi-step choice only search can weigh.
                const b = snap.turn.buffs || {};
                useSearch = legal.some(a => a.type === 'cast' ||
                    (a.type === 'placeStone' && a.scroll && hasWinCredit(snap, a.scroll))) ||
                    ((b.burningMotivationStacks || 0) > 0 && legal.some(a => a.type === 'placeStone')) ||
                    (!!b.globalPlacement && legal.some(a => a.type === 'placeStone'));
            }
            if (useSearch) {
                choice = searchPick();
                if (choice) {
                    if (_th) { _th.mode = 'lookahead'; _th.line = choice.line || null; _th.depth = choice.depth; }
                    log(`Search (depth ${WEIGHTS.searchDepth | 0}${WEIGHTS.searchHybrid ? ', hybrid' : ''}) picked ${choice.action.type}`);
                    signalBrainMode(snap.turn.activePlayerIndex, 'search');
                }
            }
        }
        if (!choice) {
            const ranked = rankActions();
            if (!ranked.length) { log('No legal actions found'); return null; }
            choice = ranked[0];
            if (_th) _th.mode = 'quick';
        }

        // Anti-freeze: choosing endTurn with most of the turn's AP unspent
        // while moves exist almost always means stale revisit-penalty memory
        // has "walled in" the pawn (every escape route was recently visited).
        // Forget the movement grudges once and re-decide — if endTurn is
        // still the best with a clean slate, it's a genuine choice.
        // ONLY when endTurn scored as a do-nothing fallback (< 20): a high
        // endTurn score means shrine collection (or a win) — clearing the
        // memory there re-enables the exact oscillation it suppresses and
        // the bot steps OFF the shrine instead of collecting.
        if (choice.action.type === 'endTurn' && choice.score < 20 &&
            snap.turn.ap >= 3 && m.recentPositions.length) {
            m.recentPositions.length = 0;
            log('Anti-freeze: endTurn chosen with AP to spare - clearing move memory and re-deciding');
            const redo = (WEIGHTS.mctsEnabled && window.BotSim) ? mctsPick()
                : ((WEIGHTS.searchDepth | 0) > 0 && window.BotSim) ? searchPick() : null;
            const rankedRedo = redo ? null : rankActions();
            choice = redo || (rankedRedo && rankedRedo.length ? rankedRedo[0] : choice);
        }

        const { action, score } = choice;
        const label = action.type === 'placeTile'      ? `place player tile at (${action.x.toFixed(0)},${action.y.toFixed(0)})`
                    : action.type === 'cast'           ? `cast ${action.scroll}`
                    : action.type === 'placeStone'     ? (action.scroll
                        ? `place ${action.stoneType} for ${action.scroll} (${Math.round((action.progress||0)*100)}%)`
                        : `place ${action.stoneType} for terrain control`)
                    : action.type === 'move'           ? `move to (${action.x.toFixed(0)},${action.y.toFixed(0)}) cost ${action.cost}`
                    : action.type === 'discardScroll'  ? `discard ${action.scroll} (from ${action.from})`
                    : 'end turn';
        log(`Best action [${score.toFixed(1)}]: ${label}`);

        const res = window.BotState.applyAction(action);
        if (!res.ok) { log(`Action failed: ${res.reason}`); return null; }
        // Episodic memory (js/bot-memory.js, optional — window.BotMemory may
        // not be loaded): record this decision if it swung the position
        // sharply, for MCTS's root to later seed as a prior in a similar
        // future situation. Reads the REAL post-action snapshot rather than
        // BotSim.simulate()'s prediction, so it reflects whatever actually
        // happened (response windows, cascades, etc. included).
        if (window.BotMemory?.recordFromBotDecision) {
            window.BotMemory.recordFromBotDecision(snap, window.BotState.snapshot(), action, idx);
        }
        if (action.type === 'move') recordVisited(idx, action.x, action.y);
        if (action.type === 'teleport') {
            // Record BOTH ends of the hop: the origin first, so "teleport
            // straight back to where I just was" draws the strongest (k=1)
            // revisit penalty on the next decision, then the destination as
            // the new current position.
            const self = snap.players[idx];
            if (self) recordVisited(idx, self.x, self.y);
            recordVisited(idx, action.x, action.y);
        }
        if (action.type === 'cast') { trackCastCredit(idx, snap, action.scroll); _castsApplied++; advanceCombo(idx, action); }
        return action;
    }

    // ----------------------------------------------------------------
    // Quiescence: after a cast, multiplayer opens a ~15s response window;
    // some scroll effects enter selection modes or cascade prompts that
    // wait for input. The bot must NOT take its next action (or end its
    // turn) until this machinery settles — otherwise the stack resolves
    // after the turn has passed, attributed to the wrong player.
    // Resolves what it can (cascade prompt), cancels what it can't drive
    // (selection modes), and waits out the rest.
    // ----------------------------------------------------------------
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    // Arena fast mode: BotSystem.speedScale scales every between-action delay
    // (1 = normal live play; 0.1 = arena). Scaled sleeps still yield the event
    // loop so async effect machinery (fire destroys, cascades) can settle.
    const tick = ms => sleep(Math.max(0, ms * (window.BotSystem?.speedScale ?? 1)));

    async function waitForQuiescence() {
        const deadline = Date.now() + 25000;
        while (Date.now() < deadline) {
            // Let a playing effect (fire burning stones, ~1.7 s) finish first:
            // the bot's next decision runs on the main thread and can block
            // for a moment, which froze the animation mid-way. Real games
            // only: never in arena training, spectate or hill-climb (fast or
            // visual), so training speed is unchanged.
            const inArena = typeof window.BotArena?.isRunning === 'function' && window.BotArena.isRunning();
            if (!inArena && (window.BotSystem?.speedScale ?? 1) >= 0.5 && window.effectsSystem?.isPlaying?.()) {
                await sleep(100);
                continue;
            }
            // Cascade prompt (scroll drawn onto a full hand): choose like a
            // player would — keep the new scroll usable if possible
            const cascade = document.getElementById('cascade-popup');
            if (cascade) {
                const buttons = [...cascade.querySelectorAll('button')];
                const pick = buttons.find(b => b.textContent === 'To Active') ||
                             buttons.find(b => b.textContent === 'To Common');
                if (pick) { log(`Cascade prompt: choosing "${pick.textContent}"`); pick.click(); }
                await tick(250);
                continue;
            }
            // Stage 2.5: drive what BotEffects knows how to drive, before
            // falling through to cancelling everything else it can't yet.
            // Transmute has no selectionMode object (raw DOM modal), so it's
            // checked directly here rather than via se.selectionMode below.
            if (document.getElementById('transmute-modal') && window.BotEffects?.driveTransmute) {
                if (window.BotEffects.driveTransmute()) { await tick(150); continue; }
            }
            // Selection modes (Sacrificial Pyre, Telekinesis, Take Flight, …)
            // need input — Stage 2.5's BotEffects drives the ones it knows
            // (see js/bot-effects.js); anything else is cancelled so the turn
            // never wedges (Control the Current is the one exception — see
            // below). Modal-based effects (Scholar's Insight, Create,
            // Arson…) don't always register a selectionMode, so ALSO detect
            // their overlay elements directly — otherwise the modal lingers
            // on screen for the rest of the game, blocking the board view.
            const se = window.spellSystem?.scrollEffects;
            const openModal = (se?.EFFECT_MODAL_IDS || []).find(id => document.getElementById(id));
            if (se?.selectionMode || window.takeFlightState || openModal) {
                if (window.BotEffects?.driveSelection()) {
                    await tick(250);
                    continue;
                }
                // Control the Current (water-transform) is a persistent
                // whole-turn mode with no "Done" button — driveSelection()
                // returning false here just means no water stone is
                // adjacent RIGHT NOW, not that the bot is stuck. Cancelling
                // it like every other undriven selection would prematurely
                // end the effect's whole-turn duration the instant that's
                // true, denying any benefit from moving toward a water
                // stone later in the same turn. Treat it as quiescent
                // instead — botTurn()'s loop calls waitForQuiescence()
                // again after the bot's next real action (typically a
                // move), re-checking for a newly-adjacent stone then. The
                // scroll's own clearTurnBuffs() (game-core.js, called on
                // End Turn) is what actually ends this mode.
                if (se?.selectionMode?.type === 'water-transform') {
                    return;
                }
                log(`Cancelling a selection the bot cannot drive${openModal ? ` (${openModal})` : ''}`);
                se?.cancelSelectionMode?.();
                if (window.takeFlightState) window.takeFlightState = null;
                await tick(250);
                continue;
            }
            // Response window: in the arena (bot-vs-bot, no multiplayer),
            // actually decide respond/pass instead of just waiting out the
            // timer — see BotEffects.decideResponse for why this needs an
            // explicit responder index. Real multiplayer games still just
            // wait the stack out (response-window.js's existing "bots
            // cannot respond" path is untouched).
            if (window.spellSystem?.responseWindow?.isResponseWindowOpen) {
                const rw = window.spellSystem.responseWindow;
                const arenaActive = typeof window.BotArena?.isRunning === 'function' && window.BotArena.isRunning();
                if (arenaActive && window.BotEffects?.decideResponse) {
                    const casterIdx = rw.currentCaster;
                    const numPlayers = typeof playerPositions !== 'undefined' ? playerPositions.length : 0;
                    let acted = false;
                    for (let i = 0; i < numPlayers; i++) {
                        if (i === casterIdx || rw.respondingPlayers?.has(i)) continue;
                        if (window.BotEffects.decideResponse(i, casterIdx)) { acted = true; break; }
                    }
                    if (acted) { await tick(250); continue; }
                }
                await tick(400);
                continue;
            }
            return; // quiet — safe to act again
        }
        log('waitForQuiescence timed out - proceeding anyway');
    }

    // ----------------------------------------------------------------
    // Whole-turn autopilot: loop steps until the turn ends (or safety cap).
    // Async with a small delay so reveals/casts/HUD settle between actions.
    // ----------------------------------------------------------------
    let _turnRunning = false;
    async function botTurn() {
        if (_turnRunning) { log('Turn already running'); return; }
        _turnRunning = true;
        const startingPlayer = activePlayerIndex;
        const m = mem(startingPlayer);
        m.ownTurns = (m.ownTurns || 0) + 1; // combo timing (Phase 4)
        const wasForced = m.turnRepeatStreak >= 1; // circuit breaker armed for this turn
        const turnMoves = [];
        // A cast is unambiguous progress. A placeStone is only progress if the
        // stone ACTUALLY STICKS — placing a pattern stone that then vanishes
        // (observed with void stones in host-driven multiplayer, cause still
        // open) must NOT reset unproductiveStreak, or the circuit breaker never
        // fires and the bot loops forever re-placing the same vanishing stones.
        // So track casts separately from pattern placements and resolve
        // "productive" at end of turn by checking which placements survived.
        let castThisTurn = false;
        const placedThisTurn = []; // {x, y, type} for scroll-pattern placeStones
        let endedTurn = false;
        try {
            for (let i = 0; i < 30; i++) {                    // safety cap
                if (activePlayerIndex !== startingPlayer) break; // turn passed
                // Stop the instant the win condition is met (all 5 elements
                // activated AND standing on the own-shrine centre). Taking
                // another action would step the pawn off the shrine, and the
                // arena / spectate winner check (BotSim.winner, in
                // _playMatchOnce) only looks once the whole turn is over — so
                // a win reached mid-turn and then walked away from is silently
                // missed, forcing the bot to re-land on the centre a later
                // turn. That is the "bots step onto the home shrine multiple
                // times before the win registers" report. Leaving the pawn put
                // lets the win register this turn. (Real games already fire
                // checkWinCondition on the winning move itself; this also stops
                // a won bot from pointlessly wandering afterward.)
                try {
                    if (window.BotSim && window.BotState &&
                        window.BotSim.winner(window.BotState.snapshot()) === startingPlayer) {
                        log('Win condition met - halting the turn so the pawn stays on its shrine');
                        break;
                    }
                } catch (e) { /* snapshot/winner is never fatal to the turn loop */ }
                await waitForQuiescence();
                flushCastCredit();
                if (activePlayerIndex !== startingPlayer) break;
                const applied = botAct();
                if (!applied) break;
                if (applied.type === 'move') turnMoves.push(`${applied.x.toFixed(1)},${applied.y.toFixed(1)}`);
                // Tactical (scroll:null) drops are terrain control, not
                // progress toward the win — they must not mask a stall or
                // unproductiveStreak's circuit breaker never fires. Pattern
                // placements are recorded here but only COUNT as progress if
                // they survive to end of turn (checked below).
                if (applied.type === 'cast') castThisTurn = true;
                else if (applied.type === 'placeStone' && applied.scroll) {
                    placedThisTurn.push({ x: applied.x, y: applied.y, type: applied.stoneType });
                }
                if (applied.type === 'endTurn') { endedTurn = true; break; }
                await tick(350);
            }
            // Never leave autopilot RESTING ON A STONE when stepping onto a
            // stone-free hex is affordable: endTurn is banned there
            // (transit-only rule) unless genuinely stranded, so both the
            // arena's and bot-driver's forced end-turn safety nets would be
            // rejected and the whole game wedges. One escape step is enough
            // — the pawn is then on an empty hex where endTurn is legal.
            if (!endedTurn && activePlayerIndex === startingPlayer &&
                typeof isPlayerRestingOnStone === 'function' && isPlayerRestingOnStone(startingPlayer)) {
                const esc = window.BotState.legalActions()
                    .filter(a => a.type === 'move' &&
                        !placedStones.some(s => Math.hypot(s.x - a.x, s.y - a.y) < 5))
                    .sort((a, b) => a.cost - b.cost)[0];
                if (esc) {
                    log(`Autopilot ended on a stone - stepping off to (${esc.x.toFixed(0)},${esc.y.toFixed(0)}) so the turn can end`);
                    const r = window.BotState.applyAction(esc);
                    if (r.ok) recordVisited(startingPlayer, esc.x, esc.y);
                }
            }
        } finally {
            _turnRunning = false;
        }
        // Compare this turn's move sequence to THIS SAME PLAYER's last one
        // to detect a stable N-hex cycle (see mem()/turnRepeatStreak above).
        // A circuit-breaker turn (wasForced) is a one-shot intervention, not
        // a new baseline to compare against — fully reset regardless of
        // what it produced (likely empty, which must NOT count as "equal
        // to the last empty turn" or the breaker would just latch forever).
        if (wasForced) {
            m.turnRepeatStreak = 0;
            m.lastTurnMoveKey = null;
        } else {
            const key = turnMoves.join('|');
            if (key && key === m.lastTurnMoveKey) {
                m.turnRepeatStreak++;
                log(`Turn repeated the exact same ${turnMoves.length}-move sequence as last turn (streak ${m.turnRepeatStreak}) - next turn skips movement`);
            } else {
                m.turnRepeatStreak = 0;
            }
            m.lastTurnMoveKey = key || null;
        }
        // Broader stuck signal than the exact-repeat check above: a bot
        // orbiting a small home region rarely repeats the SAME move list
        // turn to turn (the revisit-penalty perturbs which hex it visits
        // first each lap), so turnRepeatStreak can stay at 0 for 100+ turns
        // while the bot accomplishes nothing. Track "how many of my own
        // turns in a row produced no cast/placeStone" instead — a direct
        // measure of progress, not movement shape — and let botAct()'s
        // circuit breaker fire on THIS once it crosses UNPRODUCTIVE_LIMIT,
        // in addition to the exact-repeat trigger. Not reset by a
        // fixation-driven turn (unlike turnRepeatStreak) — as long as the
        // bot keeps failing to progress, keep re-searching for a fixation
        // target every turn; a genuinely dead position (nothing anywhere
        // still grants win credit) just means findFixationTarget() keeps
        // returning null and the old fallback continues, same as before.
        // Resolve productivity: a cast always counts; a pattern placement only
        // counts if the stone is STILL on the board now (a placement that
        // vanished this turn made no real progress). survivedPlacements < total
        // means stones the bot placed disappeared — surface it, since that is a
        // genuine bug (a stuck bot re-placing vanishing stones is the symptom).
        const survived = placedThisTurn.filter(p =>
            placedStones.some(s => s.type === p.type && Math.hypot(s.x - p.x, s.y - p.y) < 5)).length;
        if (placedThisTurn.length && survived < placedThisTurn.length) {
            log(`WARNING: ${placedThisTurn.length - survived}/${placedThisTurn.length} pattern stone(s) placed this turn vanished before turn end - not counting them as progress`);
        }
        const productive = castThisTurn || survived > 0;
        if (productive) m.unproductiveStreak = 0;
        else {
            m.unproductiveStreak++;
            if (m.unproductiveStreak === UNPRODUCTIVE_LIMIT) {
                log(`${m.unproductiveStreak} turns with no lasting cast/placeStone - trying fixation targets from now on`);
            }
        }
        log('Turn autopilot finished');
    }

    // ----------------------------------------------------------------
    // Keyboard: Shift+R = one step, Shift+B = whole turn.
    // Same guards as game-ui.js (no lobby, no text inputs).
    // ----------------------------------------------------------------
    document.addEventListener('keydown', function (e) {
        if (!e.shiftKey) return;
        const key = e.key.toUpperCase();
        if (key !== 'R' && key !== 'B') return;
        // Dev/cheat tooling is restricted to the TheHermit account.
        if (typeof window.isHermit === 'function' && !window.isHermit()) return;

        const tag = document.activeElement?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || document.activeElement?.isContentEditable) return;
        if (!document.getElementById('game-layout')?.classList.contains('active')) return;

        e.preventDefault();
        if (key === 'R') { log('Shift+R - one bot step'); botAct(); }
        else             { log('Shift+B - bot plays out the turn'); botTurn(); }
    });

    // ----------------------------------------------------------------
    // Public API (console debugging + Stage 2/3 hooks)
    // ----------------------------------------------------------------
    // Wipe per-bot memory for ALL players (plan, anti-oscillation history,
    // cursed-cell blacklist, turn-repeat tracking). The arena MUST call this
    // between games — board positions repeat across games, so a cell
    // blacklisted in game 1 would silently handicap every later game.
    function resetMemory() {
        resetAllMemory();
    }

    window.BotSystem = {
        step:  botAct,        // one action
        turn:  botTurn,       // play out the whole turn
        rank:  rankActions,   // scored candidate list (top = what greedy step() would do)
        score: scoreAction,   // (action, snapshot, ctx) → utility
        searchPick,           // Stage 2 lookahead pick — used when WEIGHTS.searchDepth > 0
        mctsPick,             // Stage 2 step 5 multi-turn MCTS — used when WEIGHTS.mctsEnabled
        determinize,          // exposed for testing — samples one hidden-info completion
        rolloutStep,          // exposed for testing — mctsPick()'s per-step rollout policy
        evaluateSnapshot,     // Stage 2 state evaluator (search leaves)
        homeCost,             // real walking cost home (formula input, bot-terms.js)
        kingmakerStats,       // alliances safeguard: {checks, blocked} actions vetoed
        _kingmakerFilter: kingmakerFilter, // tests
        scrollNeed,           // per-element 0..1: needs a scroll of this element (bot-effects.js choices)
        handValue,            // value of a player's held scrolls + per-element cover
        scrollPickScore,      // value of gaining one scroll now (bot-effects.js picks)
        rangedTargets,        // board-wide placement targets while a range buff is live
        setCombos,            // [{signature, score}] combos to follow (normally from get_bot_combos)
        combos: () => COMBOS,
        combosCompleted: () => _combosCompleted,
        resetMemory,          // wipe plan/history/blacklists (arena: call per game)
        castsApplied: () => _castsApplied, // monotonic cast counter — arena's no-cast stall cap reads deltas
        speedScale: 1,        // scales all between-action delays (arena sets ~0.1)
        waitForQuiescence,    // settle response windows / selection modes / cascades
        WEIGHTS,              // live tuning surface (Stage 3a evolves this)
        DEFAULT_WEIGHTS,
        _harmContext: harmContext, // tests
        _helpContext: helpContext, // tests
    };

    log('Loaded - Shift+R = one bot step, Shift+B = full bot turn');
})();
