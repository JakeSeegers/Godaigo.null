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
    function fresh() {
        return { rel: {}, prev: null, lastActive: null, lastTurn: null, hostile: null, events: {}, seats: 0, turns: 0 };
    }
    function reset() { S = fresh(); }

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
    function parts(snap, o) {
        const p = snap.players[o];
        if (!p) return null;
        const need = ELEMENTS4.filter(el => !p.activated.includes(el));
        const out = { elements: 200 * p.activated.length, stones: 0, ready: 0, shrines: 0, supply: 0, road: 0 };
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
            out[k] = c;
        }
        return out;
    }
    const sumParts = o => Object.values(o).reduce((a, b) => a + b, 0);
    // Which of my parts each hostile scroll can plausibly have hit.
    const HOSTILE_HITS = {
        FIRE_SCROLL_5: ['stones'],                              // Arson
        CATACOMB_SCROLL_8: ['ready'],                           // Plunder
        EARTH_SCROLL_2: ['ready', 'road', 'shrines'],           // Shifting Sands
        VOID_SCROLL_2: ['ready', 'road', 'shrines'],            // Telekinesis
        WIND_SCROLL_4: ['ready', 'road', 'shrines'],            // Take Flight
        CATACOMB_SCROLL_10: ['ready', 'road', 'shrines'],       // Combust
    };
    const PART_WORDS = {
        elements: 'my elements', stones: 'stones I need', ready: 'a scroll pattern I had ready',
        shrines: 'a shrine I need', supply: 'the stone supply I need', road: 'my road home',
    };

    // ---------------------------------------------------------------- threat
    function tracker(snap, j) { return Math.min(5, snap.players[j]?.activated?.length || 0); }
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
    function observe() {
        if (!enabled() || !window.BotState?.snapshot) return;
        let snap;
        try { snap = window.BotState.snapshot(); } catch (e) { return; }
        const n = snap.players.length;
        if (S.seats && S.seats !== n) reset();
        S.seats = n;
        const now = snap.players.map((p, j) => (p ? parts(snap, j) : null));
        const actor = S.lastActive;
        if (S.prev && actor != null && S.prev.length === n) {
            const changes = now.map((pt, j) => (pt && S.prev[j]) ? blameable(pt, S.prev[j]) : null);
            const delta = changes.map(c => (c ? sumParts(c) : 0));
            const actorGain = (now[actor] && S.prev[actor]) ? total(now[actor]) - total(S.prev[actor]) : 0;
            for (let o = 0; o < n; o++) {
                if (o === actor || !now[o] || !isBotSeat(o)) continue;
                const d = delta[o];
                let df = 0;
                if (Math.abs(d) >= MIN_DELTA) {
                    df = Math.max(-0.6, Math.min(0.4, d / SCALE));
                    if (actorGain > Math.abs(d)) df *= 0.5;                       // mostly served itself
                    const hitParts = HOSTILE_HITS[S.hostile?.id] || [];
                    const hostileHit = d < 0 && S.hostile?.actor === actor && hitParts.some(k => changes[o][k] < 0);
                    if (hostileHit) df = df * 1.5 - 0.05;                          // hostile scroll: intent
                }
                // Global view: they hurt someone who is ahead of me.
                for (let v = 0; v < n; v++) {
                    if (v === o || v === actor || !now[v] || delta[v] > -100) continue;
                    if (threatOf(snap, o, v) >= 0.65) df += 0.05 * Math.min(1, -delta[v] / 200);
                }
                if (!df) continue;
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
            }
        }
        S.prev = now;
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
    }

    // ---------------------------------------------------------------- hooks
    function onEntry(e) {
        if (!enabled()) return;
        const active = (typeof activePlayerIndex !== 'undefined') ? activePlayerIndex : null;
        if (S.lastActive == null) S.lastActive = active;
        // A new turn began before the watcher noticed (fast arena games): the
        // old turn was already closed by its end-turn entry, so switch first.
        // The old turn is closed first (end-of-turn stone collection lands
        // after its end-turn entry), except for entries logged AFTER their
        // effect (placeStone), which already belong to the new turn.
        else if (active != null && active !== S.lastActive && e.type !== 'endTurn') {
            if (e.type !== 'placeStone') observe();
            turnChanged(active);
        }
        if (e.type === 'cast_execute' && HOSTILE.has(e.scrollName)) {
            const def = window.SCROLL_DEFINITIONS?.[e.scrollName];
            S.hostile = { actor: e.playerIndex ?? e.player, id: e.scrollName, name: def?.name || e.scrollName };
        }
        observe();
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
        if (S.lastActive == null) { S.lastActive = active; observe(); }
        else if (active !== S.lastActive) { observe(); turnChanged(active); }
        S.lastTurn = turn;
    }, 200);

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
            };
        }).filter(Boolean);
    }

    window.BotDiplomacy = {
        view, events: o => (S.events[o] || []).slice(), relation: relOf, reset, observe,
        enabled, threatOf, _state: () => S,
        setEnabled: on => { switchedOn = !!on; if (!on) reset(); },
    };
})();
