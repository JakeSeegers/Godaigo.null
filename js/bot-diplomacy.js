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
        return { rel: {}, prev: null, lastActive: null, lastTurn: null, hostile: null, events: {}, seats: 0, turns: 0, looks: 0, press: {},
                 pact: null, lastPactTurn: -99, warned: {}, spoke: {}, thanked: {}, placed: {} };
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
            const dfs = [];
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
                dfs.push([o, df]);
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
            if (e.type !== 'placeStone') observe();
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
    const STAGE = { clear: 1.5, four: 2, five: 2.5, canWin: 4 };

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
            const clear = t[leader] >= Math.max(...others) + 1;
            if (clear) {
                const acts = snap.players[leader].activated.length;
                const lead = t[leader] - Math.max(...others);
                const byCount = canWinNext(snap, leader) ? STAGE.canWin : acts >= 5 ? STAGE.five : acts >= 4 ? STAGE.four : STAGE.clear;
                const byLead = lead >= 3 ? STAGE.five : lead >= 2 ? STAGE.four : STAGE.clear;
                arr[leader] = Math.max(byCount, byLead);
            }
        }
        for (let j = 0; j < n; j++) {
            if (j === o || !snap.players[j]) continue;
            const f = S.rel[o]?.[j]?.favor || 0;
            arr[j] *= Math.max(0.6, Math.min(1.4, 1 - 0.4 * f));
        }
        // A pact: push harder on its target, ease off fellow members.
        if (S.pact && S.pact.members.has(o)) {
            for (let j = 0; j < n; j++) {
                if (j === S.pact.target) arr[j] *= 1.3;
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
        warning: 0, question: 1, bread: 59, accept: 85, decline: 32, withdraw: 86, thanks: 12,
        commit: [37, 47, 70],          // Twinkle, Chomp, Hammer (at random)
        grudge: [28, 9, 21],           // Rage Spikes, Broken Heart, Angry Vein (at random)
        leader: 79,                    // Crown
        colour: { green: 99, blue: 97, red: 96, yellow: 98, purple: 19 },
    };
    const pickOne = a => (Array.isArray(a) ? a[Math.floor(Math.random() * a.length)] : a);
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
    function say(o, sprites, text) {
        if (text) tellListeners(o, text);
        if (!visible() || !window.emojiSystem?.showEmojiOverPawn) return;
        if (text) window.ActionLog?.record?.('botTalk', { text }, o);
        queue.push({ o, sprites: sprites.map(pickOne), text });
        while (queue.length > 3) queue.shift();
        if (!speaking) speakNext();
    }
    function speakNext() {
        const item = queue.shift();
        if (!item) { speaking = false; return; }
        speaking = true;
        // One float with the whole sentence side by side (emoji-system.js
        // takes an array of sprites and pops them in one after another).
        const sprite = item.sprites.length === 1 ? item.sprites[0] : item.sprites;
        if (gameActive()) {
            window.emojiSystem.showEmojiOverPawn(item.o, '', false, sprite);
            const payload = { playerIndex: item.o, display: '', isText: false, sprite };
            if (item.text) payload.talk = item.text; // other players' Game Log
            if (hostOnline() && typeof broadcastGameAction === 'function') {
                try { broadcastGameAction('emoji', payload); } catch (e) {}
            }
        }
        setTimeout(speakNext, 1500 + item.sprites.length * 450);
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
                P.members.delete(m);
                for (const k of P.members) relOf(k, m).trust = clampT(relOf(k, m).trust + PACT.withdrawTrust);
                say(m, [E.withdraw], `{p${m}} leaves the pact against {p${P.target}}`);
            }
            if (P.members.size < 2) endPact();
            else if (--P.turnsLeft <= 0) {
                // Still a real threat to every member: the pact holds for
                // another round instead of lapsing just as the leader runs
                // home (owner's test game, 2026-09-27).
                const holds = [...P.members].every(m => ((pressures(m) || [])[P.target] || 1) >= PACT.minPush);
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
        say(o, [E.bread, E.question, symbolOf(L, L)], `{p${o}} offers a pact against {p${L}}`);
        const members = new Set([o]);
        for (const b of others) {
            const r = relOf(b, o);
            const ok = coalitionTarget(b) === L && (W.favor * r.favor + W.trust * r.trust) > -0.5;
            if (ok) members.add(b);
            say(b, [ok ? E.accept : E.decline], `{p${b}} ${ok ? 'accepts' : 'declines'}`);
        }
        if (members.size < 2) return;
        S.pact = { target: L, members, committed: new Set(), turnsLeft: n + 1 };
        S.press = {}; // pact changes pressures
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
            tellListeners(kept[0], `The pact against {p${P.target}} ends`);
            if (visible()) window.ActionLog?.record?.('botTalk', { text: `The pact against {p${P.target}} ends` }, kept[0]);
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
            say(actor, [E.commit, symbolOf(P.target, P.target)], `{p${actor}} strikes at {p${P.target}}`);
        }
        for (const [v, df] of dfs) {
            if (v === actor || !P.members.has(v) || df > -0.1) continue;
            const r = relOf(v, actor);
            r.trust = clampT(r.trust + PACT.brokenTrust);
            r.favor += PACT.brokenFavor;
            P.members.delete(actor);
            say(v, [E.grudge, symbolOf(actor, null)], `{p${v}} was betrayed by {p${actor}}`);
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
        alertOn,
        setTalkInTraining: on => { talkInTraining = !!on; },
        talkInTraining: () => talkInTraining,
        onTalk: fn => { talkListeners.push(fn); return () => { const i = talkListeners.indexOf(fn); if (i >= 0) talkListeners.splice(i, 1); }; },
        pact: () => S.pact ? { target: S.pact.target, members: [...S.pact.members], turnsLeft: S.pact.turnsLeft } : null,
        setEnabled: on => { switchedOn = !!on; if (!on) reset(); },
    };
})();
