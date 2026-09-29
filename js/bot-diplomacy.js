// bot-diplomacy.js: window.BotDiplomacy, each bot's memory of the other
// players (docs/bot-alliances.md, Phase 1: memory only, no behaviour change).
//
// For every bot seat (the observer) and every other player it keeps:
//   favor  how much that player has helped (+) or hurt (-) MY progress.
//          Decays 0.9 per full round, so recent behaviour counts most.
//   trust  kept pacts (Phase 3; stays 0 for now). Decays 0.95 per round.
// and works out on demand:
//   threat how dangerous it is to help them now (0-1), from the progress
//          tracker (elements activated) plus a mild human bias; 1 when they
//          could win on their next turn.
//   ally   wF * favor + wT * trust - wH * threat (who I would rather work with).
//
// How help and harm are measured: by EFFECT. After every logged action and at
// every turn end, each bot scores its own situation (progress() below); the
// change since the last look is blamed on the player whose turn it is. Help
// that mostly served the actor itself counts half. Hostile scrolls (Arson,
// Plunder, Shifting Sands, Telekinesis, Take Flight, Combust) that hurt me
// count extra, as intent. When someone hurts a player who is ahead of me, I
// also note a small plus for them (they slowed a shared threat).
//
// Runs where the bots think: in the arena (every seat is a bot) and on the
// host of an online game (bots are driven there). Not in replays. Per game
// only (owner, 2026-09-27): reset when a new game starts. The hermit's Bot
// Mind viewer shows it (js/bot-mind.js).
(function () {
    'use strict';

    const W = { favor: 1, trust: 0.5, threat: 1 };  // ally-preference weights (personalities: phase 4)
    const HUMAN_BIAS = 0.5;                          // a human counts half a tracker step further ahead (mild)
    const FAVOR_DECAY = 0.9, TRUST_DECAY = 0.95;     // per full round
    const SCALE = 500;                               // progress points per 1.0 favor
    const MIN_DELTA = 8;                             // ignore smaller wobbles
    const MAX_EVENTS = 8;                            // remembered notable events per observer
    const HOSTILE = new Set(['EARTH_SCROLL_2', 'FIRE_SCROLL_5', 'VOID_SCROLL_2', 'WIND_SCROLL_4', 'CATACOMB_SCROLL_8', 'CATACOMB_SCROLL_10']);
    const ELEMENTS4 = ['earth', 'water', 'fire', 'wind'];
    const STEP_PX = 35;

    let S = fresh();
    // "Bots remember" was tried and removed (2026-09-29): drop its saved data.
    try { localStorage.removeItem('godaigo_bot_bonds'); } catch (e) {}
    function fresh() {
        return { rel: {}, prev: null, lastActive: null, lastTurn: null, hostile: null, events: {}, seats: 0, turns: 0, looks: 0, press: {},
                 pact: null, lastPactTurn: -99, warned: {}, asked: {}, rallied: {}, intents: {}, spoke: {}, thanked: {}, placed: {} };
    }
    // A new game or the end of a training round: forget everything, and take
    // every floating emote and queued sentence off the board at once.
    function reset() {
        S = fresh();
        try { queue.length = 0; } catch (e) {}
        try { window.emojiSystem?.clearAll?.(); } catch (e) {}
        try { window.BotMind?.reset?.(); } catch (e) {}
    }

    // ---------------------------------------------------------------- where it runs
    function gameActive() { return !!document.getElementById('game-layout')?.classList.contains('active'); }
    function arenaRunning() {
        const A = window.BotArena;
        return !!(A && (A.isRunning?.() || A.isEvolving?.() || A.isClimbing?.() || A.isSpectating?.()));
    }
    function hostOnline() {
        return typeof isMultiplayer !== 'undefined' && isMultiplayer && typeof isHost !== 'undefined' && isHost;
    }
    let switchedOn = true; // setEnabled(false): tests and timing
    function enabled() {
        if (!switchedOn || !gameActive() || window.Replay?.state) return false;
        return arenaRunning() || hostOnline();
    }
    function isBotSeat(j) {
        if (arenaRunning()) return true;
        return !!window.BotDriver?.isBot?.(j);
    }
    function seatCount() {
        return (typeof playerPositions !== 'undefined' && Array.isArray(playerPositions)) ? playerPositions.filter(Boolean).length : 0;
    }

    // ---------------------------------------------------------------- my progress
    // Parts, so an event can say what changed. Points are on the bot's usual
    // scale (an activated element is about 200).
    // full: also measure the path to my next shrine (a path search, so only
    // at turn ends; between them the last value is kept).
    function parts(snap, o, full, prevPt) {
        const p = snap.players[o];
        if (!p) return null;
        const need = ELEMENTS4.filter(el => !p.activated.includes(el));
        const out = { elements: 200 * p.activated.length, stones: 0, ready: 0, shrines: 0, supply: 0, road: 0, plan: 0, common: 0, path: 0 };
        // Disruption (owner, 2026-09-28): the shape I am building, a common
        // scroll I could use, and my path to the next shrine I need.
        const plan = isBotSeat(o) ? window.BotSystem?.planOf?.(o) : null;
        if (plan?.cells) {
            for (const c of plan.cells) {
                if ((snap.stones || []).some(st => st.type === c.type && Math.hypot(st.x - c.x, st.y - c.y) < 5)) out.plan += 20;
            }
        }
        let usable = 0;
        for (const n of snap.commonArea || []) {
            if (window.SCROLL_DEFINITIONS?.[n]?.level >= 2 && need.some(el => scrollCovers(n, el))) usable++;
        }
        out.common = 20 * Math.min(2, usable);
        // Hidden flag (not summed): the path value is a real measurement, so
        // the first one is never read as a sudden detour.
        let pathOk = false;
        if (full && window.BotSystem?.goalCost) {
            try { const c = window.BotSystem.goalCost(snap, o); out.path = c == null ? 0 : -4 * c; pathOk = true; } catch (e) {}
        } else if (prevPt) { out.path = prevPt.path || 0; pathOk = !!prevPt._pathOk; }
        Object.defineProperty(out, '_pathOk', { value: pathOk, enumerable: false });
        for (const el of need) out.stones += 8 * Math.min(p.pool[el] || 0, 5);
        out.stones += 4 * Math.min(p.pool.void || 0, 3);
        // Scrolls I hold whose stone pattern is formed around me right now.
        const sc = window.spellSystem?.playerScrolls?.[o];
        if (sc && window.BotSim?.checkPattern) {
            for (const name of [...(sc.hand || []), ...(sc.active || [])]) {
                const def = window.SCROLL_DEFINITIONS?.[name];
                if (!def || def.level === 1) continue;
                const els = def.element === 'catacomb' ? [...new Set((def.patterns?.[0] || []).map(c => c.type))] : [def.element];
                if (!els.some(el => !p.activated.includes(el))) continue;
                try { if (window.BotSim.checkPattern(snap, name, o)) out.ready += 60; } catch (e) {}
            }
        }
        // Shrines of elements I need: blocked by a stone, or someone standing on them.
        for (const t of snap.tiles) {
            if (!t.revealed || t.isPlayerTile || !need.includes(t.shrineType)) continue;
            if ((snap.stones || []).some(st => Math.hypot(st.x - t.x, st.y - t.y) < 5)) out.shrines -= 25;
            else if ((snap.sourcePool?.[t.shrineType] || 0) <= 3 &&
                snap.players.some((q, j) => q && j !== o && Math.hypot(q.x - t.x, q.y - t.y) < 5)) out.shrines -= 15; // camping a scarce shrine
        }
        // Stones left in the supply for elements I need (running out hurts).
        for (const el of need) out.supply += 2 * Math.min(snap.sourcePool?.[el] || 0, 5);
        // Once I have all five, the road home is everything.
        if (p.activated.length >= 5 && window.BotSystem?.homeCost) {
            try { out.road = -10 * window.BotSystem.homeCost(snap, o); } catch (e) {}
        }
        return out;
    }
    const total = pt => pt ? Object.values(pt).reduce((a, b) => a + b, 0) : 0;
    // The part of a change another player can cause: nobody can activate my
    // elements or hand me stones (those are always my own doing, even when
    // they land on someone else's turn), but they can take stones away.
    function blameable(now, prev) {
        const out = {};
        for (const k of Object.keys(now)) {
            let c = now[k] - (prev?.[k] || 0);
            if (k === 'elements') c = 0;
            if (k === 'stones' && c > 0) c = 0;
            if (k === 'path' && !(now._pathOk && prev?._pathOk)) c = 0;
            // Disruption hurts more than it measures (bots are touchy).
            if (c < 0) c *= (DISRUPT[k] || 1);
            out[k] = c;
        }
        return out;
    }
    // Less touchy (2026-09-29): was x2 for plan / common / path.
    const DISRUPT = { ready: 1.5, plan: 1.5, shrines: 1.25, common: 1.5, path: 1.5 };
    const sumParts = o => Object.values(o).reduce((a, b) => a + b, 0);
    // Which of my parts each hostile scroll can plausibly have hit.
    const HOSTILE_HITS = {
        FIRE_SCROLL_5: ['stones'],                              // Arson
        CATACOMB_SCROLL_8: ['ready'],                           // Plunder
        EARTH_SCROLL_2: ['ready', 'road', 'shrines', 'plan', 'path'],     // Shifting Sands
        VOID_SCROLL_2: ['ready', 'road', 'shrines', 'plan', 'path'],      // Telekinesis
        WIND_SCROLL_4: ['ready', 'road', 'shrines', 'path'],              // Take Flight
        CATACOMB_SCROLL_10: ['ready', 'road', 'shrines', 'plan', 'path'], // Combust
    };
    const PART_WORDS = {
        elements: 'my elements', stones: 'stones I need', ready: 'a scroll pattern I had ready',
        shrines: 'a shrine I need', supply: 'the stone supply I need', road: 'my road home',
        plan: 'the shape I was building', common: 'a common scroll I wanted', path: 'my path to a shrine',
    };

    // ---------------------------------------------------------------- threat
    // Elements won, weighted by how hard each is to activate (void most,
    // earth least; bot.js ELEMENT_THREAT, owner 2026-09-28).
    function tracker(snap, j) {
        const els = snap.players[j]?.activated || [];
        const tc = window.BotSystem?.threatCount;
        return Math.min(5.5, tc ? tc(els) : els.length);
    }
    function canWinNext(snap, j) {
        const p = snap.players[j];
        if (!p || p.activated.length < 5 || !window.BotSystem?.homeCost) return false;
        try { return window.BotSystem.homeCost(snap, j) <= 5; } catch (e) { return false; }
    }
    function threatOf(snap, o, j) {
        if (canWinNext(snap, j)) return 1;
        const diff = tracker(snap, j) - tracker(snap, o) + (isBotSeat(j) ? 0 : HUMAN_BIAS);
        return Math.max(0.05, Math.min(0.9, 0.45 + 0.2 * diff));
    }

    // ---------------------------------------------------------------- memory
    function relOf(o, j) {
        const r = (S.rel[o] ||= {});
        return (r[j] ||= { favor: 0, trust: 0 });
    }
    function note(o, text, df) {
        const list = (S.events[o] ||= []);
        list.unshift({ turn: S.turns + 1, text, df: +df.toFixed(2) });
        if (list.length > MAX_EVENTS) list.length = MAX_EVENTS;
    }
    function nameOf(j) {
        try { if (typeof getPlayerColorName === 'function') return getPlayerColorName(j); } catch (e) {}
        return `Player ${j + 1}`;
    }

    // Look at the board: blame each bot's change since the last look on the
    // player whose turn it was.
    function observe(full) {
        if (!enabled() || !window.BotState?.snapshot) return;
        let snap;
        try { snap = window.BotState.snapshot(); } catch (e) { return; }
        const n = snap.players.length;
        if (S.seats && S.seats !== n) reset();
        S.seats = n;
        const prevOk = S.prev && S.prev.length === n;
        const now = snap.players.map((p, j) => (p ? parts(snap, j, full, prevOk ? S.prev[j] : null) : null));
        const actor = S.lastActive;
        if (S.prev && actor != null && S.prev.length === n) {
            const changes = now.map((pt, j) => (pt && S.prev[j]) ? blameable(pt, S.prev[j]) : null);
            const delta = changes.map(c => (c ? sumParts(c) : 0));
            const actorGain = (now[actor] && S.prev[actor]) ? total(now[actor]) - total(S.prev[actor]) : 0;
            const dfs = [];
            for (let o = 0; o < n; o++) {
                if (o === actor || !now[o] || !isBotSeat(o)) continue;
                const d = delta[o];
                let df = 0, deliberate = false;
                if (Math.abs(d) >= MIN_DELTA) {
                    df = Math.max(-0.6, Math.min(0.4, d / SCALE));
                    if (actorGain > Math.abs(d)) df *= 0.5;                       // mostly served itself
                    const hitParts = HOSTILE_HITS[S.hostile?.id] || [];
                    const hostileHit = d < 0 && S.hostile?.actor === actor && hitParts.some(k => changes[o][k] < 0);
                    if (hostileHit) df = df * 1.5 - 0.05;                          // hostile scroll: intent
                    // Aimed at me (2026-09-29): a hostile scroll that hit me, or my
                    // own shape broken. Only this can count as a betrayal; other
                    // losses are side effects (a shared shrine, a common scroll).
                    deliberate = hostileHit || (d < 0 && ((changes[o].plan || 0) < 0 || (changes[o].ready || 0) < 0));
                }
                // Global view: they hurt someone who is ahead of me.
                for (let v = 0; v < n; v++) {
                    if (v === o || v === actor || !now[v] || delta[v] > -100) continue;
                    if (threatOf(snap, o, v) >= 0.65) df += 0.05 * Math.min(1, -delta[v] / 200);
                }
                if (!df) continue;
                dfs.push([o, df, deliberate]);
                const r = relOf(o, actor);
                r.favor = Math.max(-3, Math.min(3, r.favor + df));
                if (Math.abs(df) >= 0.05) {
                    // Say what changed most.
                    let key = null, best = 0;
                    for (const [k, c] of Object.entries(changes[o])) if (Math.abs(c) > Math.abs(best)) { best = c; key = k; }
                    const what = key && Math.abs(d) >= MIN_DELTA ? `${best > 0 ? 'helped' : 'hurt'} ${PART_WORDS[key]}` : 'slowed a player ahead of me';
                    const tag = S.hostile?.actor === actor && best < 0 && (HOSTILE_HITS[S.hostile.id] || []).includes(key) ? ` (${S.hostile.name})` : '';
                    note(o, `${nameOf(actor)} ${what}${tag}`, df);
                }
                if (Math.abs(df) >= 0.1) feel(o, actor, df);
            }
            pactObserve(actor, changes, dfs);
        }
        S.prev = now;
        S.looks++;
    }

    // A new turn: close the old one, decay once per full round.
    function turnChanged(newActive) {
        const n = S.seats || seatCount() || 1;
        const f = Math.pow(FAVOR_DECAY, 1 / n), t = Math.pow(TRUST_DECAY, 1 / n);
        for (const o of Object.keys(S.rel)) for (const j of Object.keys(S.rel[o])) {
            S.rel[o][j].favor *= f;
            S.rel[o][j].trust *= t;
        }
        S.lastActive = newActive;
        S.hostile = null;
        S.turns++;
        try { pactStep(newActive); } catch (e) { console.warn('[BotDiplomacy] pact step failed', e); }
    }

    // ---------------------------------------------------------------- hooks
    function onEntry(e) {
        if (!enabled() || e.type === 'botTalk') return;
        const active = (typeof activePlayerIndex !== 'undefined') ? activePlayerIndex : null;
        if (S.lastActive == null) S.lastActive = active;
        // A new turn began before the watcher noticed (fast arena games): the
        // old turn was already closed by its end-turn entry, so switch first.
        // The old turn is closed first (end-of-turn stone collection lands
        // after its end-turn entry), except for entries logged AFTER their
        // effect (placeStone), which already belong to the new turn.
        else if (active != null && active !== S.lastActive && e.type !== 'endTurn') {
            if (e.type !== 'placeStone') observe(true);
            turnChanged(active);
        }
        // Who placed which stone (public): bot.js breaks a leader's fresh
        // pattern stones (owner's harm list, 2026-09-27).
        if (e.type === 'placeStone' && e.player != null && e.stoneType) {
            const list = (S.placed[e.player] ||= []);
            list.push({ x: e.x, y: e.y, type: e.stoneType, turn: S.turns });
            if (list.length > 30) list.shift();
        }
        if (e.type === 'cast_execute' && HOSTILE.has(e.scrollName)) {
            const def = window.SCROLL_DEFINITIONS?.[e.scrollName];
            S.hostile = { actor: e.playerIndex ?? e.player, id: e.scrollName, name: def?.name || e.scrollName };
        }
        observe(e.type === 'endTurn');
    }
    function hook() {
        if (!window.ActionLog?.onRecord) return false;
        window.ActionLog.onRecord(onEntry);
        return true;
    }
    if (!hook()) {
        let tries = 0;
        const t = setInterval(() => { if (hook() || ++tries > 40) clearInterval(t); }, 250);
    }
    // Arena games reset bot memory between games: reset ours with it.
    let wrapTries = 0;
    const wrapTimer = setInterval(() => {
        const B = window.BotSystem;
        if (B?.resetMemory && !B.__diplomacyWrapped) {
            const orig = B.resetMemory;
            B.resetMemory = function () { reset(); return orig.apply(this, arguments); };
            B.__diplomacyWrapped = true;
        }
        if (B?.__diplomacyWrapped || ++wrapTries > 40) clearInterval(wrapTimer);
    }, 250);
    // Turn changes (after the end-turn log entry has closed the old turn) and
    // new games (turn number going back, or the game ending).
    setInterval(() => {
        if (!gameActive()) { if (S.prev) reset(); return; }
        if (!enabled()) return;
        const turn = (typeof currentTurnNumber !== 'undefined') ? currentTurnNumber : null;
        const active = (typeof activePlayerIndex !== 'undefined') ? activePlayerIndex : null;
        if (S.lastTurn != null && turn != null && turn < S.lastTurn) reset();
        if (S.lastActive == null) { S.lastActive = active; observe(true); }
        else if (active !== S.lastActive) { observe(true); turnChanged(active); }
        S.lastTurn = turn;
    }, 200);

    // ---------------------------------------------------------------- phase 2: pressure
    // How hard bot `o` should push against each player (1 = normal play).
    // Leader response (docs/bot-alliances.md): only when someone is clearly
    // ahead of me AND of everyone else does the table gang up on them:
    //   clear leader 1.5, leader at 4 elements 2, at 5 elements 2.5, can win
    //   next turn 4. A big lead counts too (2026-09-27, owner's test game: a
    //   human 3 elements ahead met no pact until 4): 2+ ahead of everyone
    //   else 2, 3+ ahead 2.5. When the leader is pulled back into the pack, or I am
    //   level with them, it drops back to 1 (the coalition ends by itself).
    // Favor shifts it: players who helped me get pushed a bit less, players
    // who hurt me a bit more. Humans count half an element further ahead.
    // Cached per look at the board; returns null when the system is off.
    const STAGE = { clear: 1.5, four: 2, five: 2.5, canWin: 4 };  // 'four' = push 2, now from 3 elements

    // "One cast from winning" (owner, 2026-09-28): from public information
    // only (elements won, the active area, the ELEMENT of each hand scroll,
    // the common area). Player j has all five (walking home), or misses one
    // live element and has a scroll that could give it: a hand scroll of
    // that element, an active-area or common-area scroll of it (level 2+,
    // level 1 only as a response) or a catacomb covering it.
    const ALL_ELS = ['earth', 'water', 'fire', 'wind', 'void'];
    function scrollCovers(name, el) {
        const d = window.SCROLL_DEFINITIONS?.[name];
        if (!d) return false;
        if (d.element === 'catacomb') return (d.patterns?.[0] || []).some(c => c.type === el);
        return d.element === el;
    }
    function oneCastFromWin(snap, j) {
        const p = snap.players[j];
        if (!p) return false;
        const miss = ALL_ELS.filter(el => !p.activated.includes(el));
        if (!miss.length) return true;
        if (miss.length !== 1) return false;
        const el = miss[0];
        if ((snap.sourcePool?.[el] || 0) <= 0) return false;
        if ((p.handElements || []).includes(el)) return true;
        if ((p.active || []).some(n => scrollCovers(n, el))) return true;
        return (snap.commonArea || []).some(n => scrollCovers(n, el));
    }
    // The opponent of o to guard against right now (one cast from winning),
    // or null. In a two-player game the opponent as soon as it has four.
    function alertOn(o, snapIn) {
        let snap = snapIn;
        if (!snap) { try { snap = window.BotState.snapshot(); } catch (e) { return null; } }
        let best = null;
        for (let j = 0; j < snap.players.length; j++) {
            if (j === o || !snap.players[j] || !oneCastFromWin(snap, j)) continue;
            if (best == null || snap.players[j].activated.length > snap.players[best].activated.length) best = j;
        }
        return best;
    }

    function pressures(o) {
        if (!enabled()) return null;
        const key = `${S.turns}|${S.looks}`;
        const c = S.press[o];
        if (c && c.key === key) return c.arr;
        let snap;
        try { snap = window.BotState.snapshot(); } catch (e) { return null; }
        if (!snap.players[o]) return null;
        const n = snap.players.length;
        const arr = new Array(n).fill(1);
        const t = snap.players.map((p, j) => p ? tracker(snap, j) + (j !== o && !isBotSeat(j) ? HUMAN_BIAS : 0) : -1);
        let leader = -1;
        for (let j = 0; j < n; j++) if (j !== o && snap.players[j] && (leader < 0 || t[j] > t[leader])) leader = j;
        if (leader >= 0) {
            const others = t.filter((v, j) => j !== leader && snap.players[j]);
            // Engage early (owner, 2026-09-28): a clear leader is 0.75
            // (weighted) ahead of everyone else, so one element always
            // counts, from the first element on. Pacts and harm (push 2)
            // start when the leader has 3 elements, not 4.
            const lead = t[leader] - Math.max(...others);
            if (lead >= 0.75) {
                const acts = snap.players[leader].activated.length;
                const byCount = canWinNext(snap, leader) ? STAGE.canWin : acts >= 5 ? STAGE.five : acts >= 4 ? STAGE.four + 0.25 : acts >= 3 ? STAGE.four : STAGE.clear;
                const byLead = lead >= 2.75 ? STAGE.five : lead >= 1.75 ? STAGE.four : STAGE.clear;
                // A lead in hard elements (void, wind) weighs a bit more.
                arr[leader] = Math.max(byCount, byLead) * Math.max(0.9, Math.min(1.15, tracker(snap, leader) / Math.max(1, acts)));
            }
        }
        for (let j = 0; j < n; j++) {
            if (j === o || !snap.players[j]) continue;
            const f = S.rel[o]?.[j]?.favor || 0;
            // Touchy (owner, 2026-09-28): a grudge of about -0.85 alone
            // reaches push 1.5, where harm actions start.
            arr[j] *= Math.max(0.6, Math.min(1.7, 1 - 0.6 * f));
        }
        // A pact: push harder on its target, ease off fellow members.
        if (S.pact && S.pact.members.has(o)) {
            for (let j = 0; j < n; j++) {
                if (j === S.pact.target) arr[j] = S.pact.kind === 'grudge' ? Math.max(arr[j] * 1.3, 1.6) : arr[j] * 1.3;
                else if (S.pact.members.has(j)) arr[j] *= 0.7;
            }
        }
        arr[o] = 1;
        // One cast from winning: at least "five elements" pressure.
        for (let j = 0; j < n; j++) {
            if (j !== o && snap.players[j] && oneCastFromWin(snap, j)) arr[j] = Math.max(arr[j], STAGE.five);
        }
        let top = -1;
        for (let j = 0; j < n; j++) if (j !== o && snap.players[j] && (top < 0 || arr[j] > arr[top])) top = j;
        S.press[o] = { key, arr, leader: top >= 0 && arr[top] > 1.2 ? top : null };
        return arr;
    }
    function coalitionTarget(o) {
        pressures(o);
        return S.press[o]?.leader ?? null;
    }

    // ---------------------------------------------------------------- phase 3: talk
    // Emote sentences (owner's vocabulary, docs/bot-alliances.md): what, then
    // who. Cells of images/emotes/pipoya-emotes.png (js/emoji-system.js).
    const E = {
        // Owner's phrase edits (2026-09-29, Bot Phrases page).
        warning: 0, question: 1, target: 15, accept: 85, decline: 32, withdraw: 86, thanks: 30,
        commit: 47,                    // Chomp
        hurt: 21,                      // Angry Vein (asks for help)
        betrayed: 9,                   // Broken Heart
        grudge: 18,                    // Tangled
        leaderPact: 79, grudgePact: 8, // Crown / Heart after accept or decline: which kind of pact
        pactEnds: '15x',               // Bullseye with an X
        leader: 79,                    // Crown
        colour: { green: 99, blue: 97, red: 96, yellow: 98, purple: 19 },
    };
    // Its own random numbers: the arena seeds Math.random, and talk must
    // never change how a seeded game plays out (2026-09-28: new sentences
    // shifted every later random pick, so the same seed played a new game).
    const talkRandom = () => {
        try { return crypto.getRandomValues(new Uint32Array(1))[0] / 4294967296; } catch (e) { return 0.5; }
    };
    const pickOne = a => (Array.isArray(a) ? a[Math.floor(talkRandom() * a.length)] : a);
    // Pawn colours are stored as hex codes (game-core.js PLAYER_COLORS).
    const HEX_TO_COLOUR = { '#69d83a': 'green', '#5894f4': 'blue', '#ed1b43': 'red', '#ffce00': 'yellow', '#9458f4': 'purple' };
    function symbolOf(j, leader) {
        if (leader != null && j === leader) return E.leader;
        let c = (typeof playerPositions !== 'undefined') ? playerPositions[j]?.color : null;
        if (typeof c === 'string' && c.startsWith('#')) c = HEX_TO_COLOUR[c.toLowerCase()];
        if (!c && typeof getPlayerColorName === 'function') { try { c = String(getPlayerColorName(j)).toLowerCase(); } catch (e) {} }
        return E.colour[c] ?? E.question;
    }
    // Emotes only show where someone watches: online, spectated or visual
    // arena games. Muted training keeps the pacts but skips the talking.
    let talkAlways = false; // tests
    // Fast (muted) training: emotes show when talkInTraining is on (Train
    // Bot option "Bot talk", owner 2026-09-28; on by default).
    let talkInTraining = true;
    function visible() {
        if (talkAlways || !arenaRunning()) return true;
        return !!(window.BotArena?.isSpectating?.() || (window.BotSystem?.speedScale ?? 0) >= 1 || talkInTraining);
    }
    // Every sentence, shown or not: {o, text} (the training window's list).
    const talkListeners = [];
    function tellListeners(o, text) {
        for (const fn of talkListeners) { try { fn({ o, text }); } catch (e) {} }
    }
    const queue = [];
    let speaking = false;
    // text uses {pN} for player N; js/game-log-ui.js renders it with names.
    // The Game Log line is written at once; the sentence's emotes show
    // side by side over the bot, and sentences follow each other about 2 s
    // apart. A long backlog drops the oldest sentences so the table never
    // lags behind the game.
    // opts.short: a quick emote (thinking), shown for a quarter of the time.
    function say(o, sprites, text, opts) {
        if (text) tellListeners(o, text);
        if (!visible() || !window.emojiSystem?.showEmojiOverPawn) return;
        if (text) window.ActionLog?.record?.('botTalk', { text }, o);
        const item = { o, sprites: sprites.map(pickOne), text, short: !!opts?.short };
        // Fast training: show it now (a queue falls behind fast games; a new
        // sentence over the same bot replaces its last one anyway).
        if (fastTraining()) { show(item); return; }
        queue.push(item);
        while (queue.length > 3) queue.shift();
        if (!speaking) speakNext();
    }
    function fastTraining() {
        return arenaRunning() && !window.BotArena?.isSpectating?.() && (window.BotSystem?.speedScale ?? 0) < 1;
    }
    function show(item) {
        if (!gameActive()) return;
        // Always a list, so a new sentence replaces the last one (emoji-system.js).
        const sprite = item.sprites;
        const dur = item.short ? 1250 : undefined;
        window.emojiSystem.showEmojiOverPawn(item.o, '', false, sprite, dur ? { dur } : undefined);
        const payload = { playerIndex: item.o, display: '', isText: false, sprite };
        if (dur) payload.dur = dur;
        if (item.text) payload.talk = item.text; // other players' Game Log
        if (hostOnline() && typeof broadcastGameAction === 'function') {
            try { broadcastGameAction('emoji', payload); } catch (e) {}
        }
    }
    function speakNext() {
        const item = queue.shift();
        if (!item) { speaking = false; return; }
        speaking = true;
        // One float with the whole sentence side by side (emoji-system.js
        // takes an array of sprites and pops them in one after another).
        show(item);
        setTimeout(speakNext, item.short ? 400 : 1500 + item.sprites.length * 450);
    }

    // ---------------------------------------------------------------- phase 3: pacts
    // One pact at a time, bots only, against the clear leader, for one round.
    // Members push harder on the target and ease off each other. Kept: trust
    // up. Withdrawn: a little trust down. Broken (hurting a member): a lot.
    const PACT = { minPush: 2, gapTurns: 2, keptTrust: 0.15, committedTrust: 0.1, withdrawTrust: -0.05, brokenTrust: -0.45, brokenFavor: -0.15 };
    function inPact(o) { return !!S.pact && S.pact.members.has(o); }
    function pactStep(active) {
        const P = S.pact;
        if (P) {
            // Members who no longer see the target as the leader step out.
            for (const m of [...P.members]) {
                if (coalitionTarget(m) === P.target) continue;
                if (P.kind === 'grudge' && relOf(m, P.target).favor < 0) continue;
                P.members.delete(m);
                for (const k of P.members) relOf(k, m).trust = clampT(relOf(k, m).trust + PACT.withdrawTrust);
                say(m, [E.withdraw], `{p${m}} leaves the pact against {p${P.target}}`);
            }
            if (P.members.size < 2) endPact();
            else if (--P.turnsLeft <= 0) {
                // Still a real threat to every member: the pact holds for
                // another round instead of lapsing just as the leader runs
                // home (owner's test game, 2026-09-27).
                const holds = P.kind === 'grudge'
                    ? [...P.members].every(m => relOf(m, P.target).favor <= GRUDGE.hold)
                    : [...P.members].every(m => ((pressures(m) || [])[P.target] || 1) >= PACT.minPush);
                if (holds) P.turnsLeft = S.seats || seatCount();
                else endPact();
            }
        }
        if (!S.pact && isBotSeat(active)) {
            // Urgent (the leader has all five): no waiting between pacts.
            const L = coalitionTarget(active);
            let urgent = false;
            if (L != null) { try { urgent = window.BotState.snapshot().players[L]?.activated?.length >= 5; } catch (e) {} }
            if (urgent || S.turns - S.lastPactTurn >= PACT.gapTurns * (S.seats || 1)) propose(active);
            if (!S.pact && S.turns - S.lastPactTurn >= GRUDGE.gapTurns * (S.seats || 1)) proposeGrudge(active);
        }
    }
    function clampT(v) { return Math.max(-1, Math.min(1, v)); }
    function propose(o) {
        const L = coalitionTarget(o);
        if (L == null) return;
        const push = (pressures(o) || [])[L] || 1;
        const n = S.seats || seatCount();
        // Warn once per stage (the number of elements the leader has), and
        // only once the leader is a real danger (the same bar as a pact).
        if (push < PACT.minPush) return;
        let snap; try { snap = window.BotState.snapshot(); } catch (e) { return; }
        const stage = snap.players[L]?.activated?.length || 0;
        if (S.warned[L] !== stage) {
            S.warned[L] = stage;
            say(o, [E.warning, symbolOf(L, L)], `{p${o}} warns: {p${L}} is close to winning`);
        }
        const others = [];
        for (let b = 0; b < n; b++) if (b !== o && b !== L && snap.players[b] && isBotSeat(b)) others.push(b);
        if (!others.length) return;
        S.lastPactTurn = S.turns;
        say(o, [E.target, E.question, symbolOf(L, null)], `{p${o}} offers a pact against {p${L}}`);
        const members = new Set([o]);
        for (const b of others) {
            const r = relOf(b, o);
            const mine = W.favor * r.favor + W.trust * r.trust;
            // A friend of the proposer (thanked them) joins even when it
            // had not picked the same target yet, unless it likes the target.
            const ok = (coalitionTarget(b) === L && mine > -0.5) || (mine >= GRUDGE.friend && relOf(b, L).favor < 0.3);
            if (ok) members.add(b);
            say(b, [ok ? E.accept : E.decline, E.leaderPact], `{p${b}} ${ok ? 'joins' : 'declines'} the pact against the leader`);
        }
        if (members.size < 2) return;
        S.pact = { kind: 'leader', target: L, members, committed: new Set(), turnsLeft: n + 1 };
        S.press = {}; // pact changes pressures
    }
    // Grudge pacts (owner, 2026-09-28): bots are touchy. A bot that another
    // player hurt (broke its shape, took the common scroll it wanted, blocked
    // its path, cast a hostile scroll on it: favor at or under GRUDGE.bar)
    // asks the others for help against that player at once, leader or not.
    // Having a friend (someone it thanked, or who thanked it) makes it
    // quicker to ask. Others join when they also dislike the target, like
    // the proposer, or find the target a threat.
    const GRUDGE = { bar: -0.25, friendBar: -0.15, friend: 0.2, accept: 0.05, hold: -0.2, gapTurns: 1, askAgain: 2 };
    function proposeGrudge(o) {
        let snap; try { snap = window.BotState.snapshot(); } catch (e) { return; }
        const n = snap.players.length;
        const live = snap.players.map((p, j) => p ? j : -1).filter(j => j >= 0);
        if (live.length < 3) return;
        const hasFriend = live.some(b => b !== o && isBotSeat(b) &&
            (relOf(o, b).favor >= GRUDGE.friend || relOf(b, o).favor >= GRUDGE.friend));
        const bar = hasFriend ? GRUDGE.friendBar : GRUDGE.bar;
        let X = null;
        for (const j of live) {
            if (j === o) continue;
            // Turned down about this player lately: do not ask again yet.
            if ((S.asked[`${o}>${j}`] ?? -99) > S.turns - GRUDGE.askAgain * n) continue;
            const f = relOf(o, j).favor;
            if (f <= bar && (X == null || f < relOf(o, X).favor)) X = j;
        }
        if (X == null) return;
        // Not against a player behind me, and not against the same player
        // again within 3 rounds (2026-09-29: the table kept piling onto one
        // player that was not winning, which only helped the leader).
        if (tracker(snap, X) < tracker(snap, o) - 1) return;
        if ((S.rallied[X] ?? -99) > S.turns - 3 * n) return;
        const others = live.filter(b => b !== o && b !== X && isBotSeat(b));
        if (!others.length) return;
        S.lastPactTurn = S.turns;
        S.asked[`${o}>${X}`] = S.turns;
        S.rallied[X] = S.turns;
        say(o, [E.hurt, E.target, E.question, symbolOf(X, null)], `{p${o}} was hurt by {p${X}} and asks for help against them`);
        const members = new Set([o]);
        for (const b of others) {
            const fx = relOf(b, X).favor, r = relOf(b, o);
            // A threat to me too counts much more; a target behind me: no.
            const score = -fx + 0.6 * (W.favor * r.favor + W.trust * r.trust) + 1.0 * (threatOf(snap, b, X) - 0.45);
            const ok = score >= GRUDGE.accept && fx < 0.3 && tracker(snap, X) >= tracker(snap, b) - 0.75;
            if (ok) members.add(b);
            say(b, [ok ? E.accept : E.decline, E.grudgePact], `{p${b}} ${ok ? 'joins' : 'declines'} the pact against {p${X}}`);
        }
        if (members.size < 2) return;
        S.pact = { kind: 'grudge', target: X, members, committed: new Set(), turnsLeft: n + 1 };
        S.press = {};
    }
    function endPact() {
        const P = S.pact;
        if (!P) return;
        const kept = [...P.members];
        for (const m of kept) for (const k of kept) {
            if (m === k) continue;
            const r = relOf(k, m);
            r.trust = clampT(r.trust + PACT.keptTrust + (P.committed.has(m) ? PACT.committedTrust : 0));
            r.favor += 0.05;
        }
        if (kept.length >= 2) {
            say(kept[0], [E.pactEnds, symbolOf(P.target, null)], `The pact against {p${P.target}} ends`);
        }
        S.pact = null;
        S.lastPactTurn = S.turns; // the next offer waits two rounds from here
        S.press = {};
    }
    // Called from observe() with each bot's blameable change this look.
    function pactObserve(actor, changes, dfs) {
        const P = S.pact;
        if (!P || !P.members.has(actor)) return;
        const t = changes[P.target];
        if (t && Object.values(t).reduce((a, b) => a + b, 0) <= -20 && !P.committed.has(actor)) {
            P.committed.add(actor);
            say(actor, [E.commit, symbolOf(P.target, null)], `{p${actor}} strikes at {p${P.target}}`);
        }
        for (const [v, df, deliberate] of dfs) {
            // Only harm aimed at the partner breaks a pact; side effects of
            // hitting the shared target just cost a little favor (2026-09-29:
            // nearly every pact ended in a false "betrayal").
            if (v === actor || !P.members.has(v) || df > -0.1 || !deliberate) continue;
            const r = relOf(v, actor);
            r.trust = clampT(r.trust + PACT.brokenTrust);
            r.favor += PACT.brokenFavor;
            P.members.delete(actor);
            say(v, [E.betrayed, symbolOf(actor, null)], `{p${v}} was betrayed by {p${actor}}`);
            break;
        }
    }
    // Thanks and grudges outside pacts: at most one sentence per bot per turn,
    // and the same thanks or grudge toward a player at most once per round.
    function feel(o, actor, df) {
        if (S.spoke[o] === S.turns) return;
        const key = `${o}>${actor}`, n = S.seats || 1;
        if ((S.thanked[key] ?? -99) > S.turns - n) return;
        if (df >= 0.1) {
            say(o, [E.thanks, symbolOf(actor, null)], `{p${o}} thanks {p${actor}}`);
        } else if (df <= -0.25 && !(inPact(o) && inPact(actor))) {
            say(o, [E.grudge, symbolOf(actor, null)], `{p${o}} holds a grudge against {p${actor}}`);
        } else return;
        S.spoke[o] = S.turns;
        S.thanked[key] = S.turns;
    }

    // Intentions (owner, 2026-09-28): short emote sentences that show what a
    // bot is doing to (or for) others. Called by bot.js announceIntent and
    // bot-effects.js (counters). The same intention toward the same player
    // is said at most once a round; 'home' once a game, 'watch' once per
    // number of elements the target has.
    const INTENT = {
        break:   { sp: [70, 40],     text: '{o} breaks the new stones of {t}' },
        camp:    { sp: [36, 68],     text: '{o} holds a shrine that {t} needs' },
        gift:    { sp: [76, 68],     text: '{o} leaves a scroll for {t}' },
        road:    { sp: [57, 76],     text: '{o} lays a wind road for {t}' },
        fetch:   { sp: [68, 15],     text: '{o} looks for a counter to {t}' },
        watch:   { sp: [31],         text: '{o} watches the next cast of {t}' },
        counter: { sp: [43],         text: '{o} counters {t}' },
        idea:    { sp: [16],         text: '{o} has an idea' },
        scout:   { sp: [33],         text: '{o} reveals a tile before {t} can' },
        river:   { sp: [45],         text: '{o} turns a shrine that {t} needs' },
        shove:   { sp: [80],         text: '{o} sends {t} far away' },
        wall:    { sp: [29],         text: '{o} builds a wall against {t}' },
        home:    { sp: [77, 88],     text: '{o} runs for home' },
        // Look-ahead (Calculating) and playouts (Counting): emote only, no
        // Game Log line, at most once every 2 rounds.
        think:   { sp: [51],         text: null, rounds: 2, short: true },
        playout: { sp: [50],         text: null, rounds: 2, short: true },
    };
    function intend(o, kind, t) {
        const I = INTENT[kind];
        if (!I || !enabled()) return;
        let stage = '';
        if (kind === 'watch' && t != null) {
            try { stage = window.BotState.snapshot().players[t]?.activated?.length ?? ''; } catch (e) {}
        }
        const key = `${o}:${kind}:${t ?? ''}:${stage}`;
        const last = S.intents[key];
        if (last != null) {
            if (kind === 'home' || kind === 'watch') return;
            if (last > S.turns - (I.rounds || 1) * (S.seats || 1)) return;
        }
        S.intents[key] = S.turns;
        const sprites = t != null ? [...I.sp, symbolOf(t, null)] : I.sp.slice();
        const text = I.text ? I.text.replace('{o}', `{p${o}}`).replace('{t}', t != null ? `{p${t}}` : 'someone') : null;
        say(o, sprites, text, I.short ? { short: true } : undefined);
    }

    // ---------------------------------------------------------------- api
    // How bot `o` sees every other player right now.
    function view(o) {
        let snap = null;
        try { snap = window.BotState?.snapshot?.(); } catch (e) {}
        if (!snap || !snap.players[o]) return [];
        return snap.players.map((p, j) => {
            if (!p || j === o) return null;
            const r = S.rel[o]?.[j] || { favor: 0, trust: 0 };
            const threat = threatOf(snap, o, j);
            return {
                player: j, name: nameOf(j), human: !isBotSeat(j), tracker: tracker(snap, j),
                favor: +r.favor.toFixed(2), trust: +r.trust.toFixed(2), threat: +threat.toFixed(2),
                ally: +(W.favor * r.favor + W.trust * r.trust - W.threat * threat).toFixed(2),
                push: +((pressures(o) || [])[j] ?? 1).toFixed(2),
            };
        }).filter(Boolean);
    }

    window.BotDiplomacy = {
        view, events: o => (S.events[o] || []).slice(), relation: relOf, reset, observe,
        enabled, threatOf, _state: () => S, pressures, coalitionTarget,
        // Stones player j placed in the last `turns` turns: [{x, y, type, turn}].
        recentStones: (j, turns) => (S.placed[j] || []).filter(r => S.turns - r.turn <= turns),
        setTalkAlways: on => { talkAlways = !!on; },
        oneCastFromWin: (j, snap) => { try { return oneCastFromWin(snap || window.BotState.snapshot(), j); } catch (e) { return false; } },
        alertOn, intend,
        isBot: j => isBotSeat(j),
        // Player j's progress on the diplomacy scale (an element about 200).
        progressOf: (j, snap) => { try { const sn = snap || window.BotState.snapshot(); return sn.players[j] ? total(parts(sn, j, false, null)) : 0; } catch (e) { return 0; } },
        setTalkInTraining: on => { talkInTraining = !!on; },
        talkInTraining: () => talkInTraining,
        onTalk: fn => { talkListeners.push(fn); return () => { const i = talkListeners.indexOf(fn); if (i >= 0) talkListeners.splice(i, 1); }; },
        pact: () => S.pact ? { kind: S.pact.kind, target: S.pact.target, members: [...S.pact.members], turnsLeft: S.pact.turnsLeft } : null,
        setEnabled: on => { switchedOn = !!on; if (!on) reset(); },
    };
})();
