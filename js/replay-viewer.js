// replay-viewer.js: plays back a recorded online game (Phase 3, step 2).
//
// How it works: a replay is the recorded stream of game messages
// (match_moves, see match-recorder.js) fed back into the game's OWN receive
// handlers, so the board updates exactly as it did for the players, with no
// separate copy of the game rules (bot-sim.js is not used).
//
//   1. Fetch the match with get_match_replay (sql/replay-access.sql).
//   2. Switch Supabase to "offline": channel() returns a fake channel, and
//      from()/rpc() return empty results, so nothing is ever sent or saved.
//   3. Start the game the normal way (startMultiplayerGame) from the recorded
//      seats + deck seed. setupGameBroadcast() registers its handlers on the
//      fake channel.
//   4. Set myPlayerIndex to SPECTATOR (a seat nobody has), so every handler
//      treats every recorded move as "someone else's" and applies it.
//   5. Dispatch the moves in order, timed like the real game (long pauses
//      are shortened), with play / pause / speed / step controls.
// Restart rewinds in place (startBoard); leaving the replay reloads the page,
// which restores everything, and skips the intro on that reload.
//
// Players open it from the lobby "Replays" button (openBrowser below): their
// own games, and games other players posted publicly.
(function () {
    const SPECTATOR = -1;
    const MAX_GAP_MS = 1500;      // longest pause between moves at 1x speed
    // Messages a spectator must not act on: prompts meant for a real player,
    // requests to other players, and the placement-timeout reset.
    const SKIP_EVENTS = new Set([
        'response-window-opened',
        'scroll-state-sync-request',
        'take-flight-choose-request',
        'take-flight-cancel-request',
        'game-reset',
    ]);

    let state = null; // { match, moves, index, playing, speed, timer, handlers }

    function log(...a) { console.log('[replay]', ...a); }

    // ── Offline Supabase ─────────────────────────────────────────
    function makeFakeChannel(handlers) {
        const ch = {
            on(type, filter, cb) {
                if (type === 'broadcast') handlers.push({ event: filter?.event, cb });
                return ch;
            },
            subscribe() { return ch; },
            unsubscribe() { return Promise.resolve('ok'); },
            send() { return Promise.resolve('ok'); },
            track() { return Promise.resolve('ok'); },
            untrack() { return Promise.resolve('ok'); },
            presenceState() { return {}; },
        };
        return ch;
    }

    function goOffline(handlers) {
        const empty = { data: null, error: null, count: 0 };
        const builder = new Proxy(function () {}, {
            get(_t, prop) {
                if (prop === 'then') return (res) => Promise.resolve(empty).then(res);
                if (prop === 'catch' || prop === 'finally') return () => builder;
                return () => builder;
            },
            apply() { return builder; },
        });
        supabase.channel = () => makeFakeChannel(handlers);
        supabase.from = () => builder;
        supabase.rpc = () => Promise.resolve(empty);
        try { supabase.removeChannel = () => Promise.resolve('ok'); } catch (e) {}
    }

    // ── Controls ─────────────────────────────────────────────────
    function buildControls() {
        document.getElementById('replay-controls')?.remove();
        const bar = document.createElement('div');
        bar.id = 'replay-controls';
        bar.innerHTML = `
            <span class="replay-title"></span>
            <button data-act="play">Pause</button>
            <button data-act="step">Step</button>
            <select data-act="speed">
                <option value="0.5">0.5x</option>
                <option value="1" selected>1x</option>
                <option value="2">2x</option>
                <option value="4">4x</option>
                <option value="8">8x</option>
            </select>
            <span class="replay-progress"></span>
            <button data-act="restart">Restart</button>
            <button data-act="exit">Exit replay</button>`;
        document.body.appendChild(bar);
        bar.querySelector('[data-act=play]').onclick = () => (state.playing ? pause() : play());
        bar.querySelector('[data-act=step]').onclick = () => { pause(); watchStep(); };
        bar.querySelector('[data-act=speed]').onchange = (e) => { state.speed = +e.target.value || 1; };
        bar.querySelector('[data-act=restart]').onclick = () => restart();
        bar.querySelector('[data-act=exit]').onclick = () => exitReplay();
        updateControls();
    }

    function updateControls() {
        const bar = document.getElementById('replay-controls');
        if (!bar || !state) return;
        const names = (state.match.players || []).map(p => seatName(p)).join(' vs ');
        bar.querySelector('.replay-title').textContent = `Replay #${state.match.id}: ${names}`;
        bar.querySelector('.replay-progress').textContent =
            state.index >= state.moves.length ? 'End of game'
                : `Move ${state.shown} (${Math.floor(100 * state.index / Math.max(1, state.moves.length))}%)`;
        bar.querySelector('[data-act=play]').textContent = state.playing ? 'Pause' : 'Play';
    }

    // ── Playback ─────────────────────────────────────────────────
    // Bot "brain mode" emojis (bot.js signalBrainMode, now off) were recorded
    // in older games; never replay them. Players' own emoji reactions stay.
    const BOT_SIGNAL_EMOJIS = new Set(['🧠', '🎲']);

    function dispatch(move) {
        if (SKIP_EVENTS.has(move.event)) return;
        if (move.event === 'emoji' && BOT_SIGNAL_EMOJIS.has(move.payload?.display)) return;
        const msg = { type: 'broadcast', event: move.event, payload: move.payload || {} };
        for (const h of state.handlers) {
            if (h.event !== move.event && h.event !== '*') continue;
            try { h.cb(msg); } catch (e) {
                console.warn(`[replay] handler for ${move.event} failed:`, e);
                state.errors.push(`${move.event}: ${e?.message || e}`);
            }
        }
    }

    function step() {
        if (!state || state.index >= state.moves.length) { pause(); updateControls(); return false; }
        dispatch(state.moves[state.index]);
        state.index++;
        updateControls();
        return true;
    }

    // What a viewer can see: board, pawns, activated elements, whose turn,
    // AP, hands, active scrolls, common area, and new Game Log lines. Many
    // recorded messages (syncs, timer pings, passes while waiting) change
    // none of it; playback runs through those at once instead of showing
    // them as empty "moves".
    function visibleState() {
        try {
            const scrolls = (spellSystem?.playerScrolls || []).map(p => p
                ? [...(p.hand || [])].sort().join('+') + '/' + [...(p.active || [])].sort().join('+')
                : '-');
            return [
                window.MatchWitness?.publicState?.() || '',
                activePlayerIndex, currentTurnNumber, currentAP,
                scrolls.join(';'),
                JSON.stringify(spellSystem?.commonArea || {}),
                state.logCount,
            ].join('|');
        } catch (e) { return String(Math.random()); } // unknown: treat as visible
    }

    // Always shown, even when the board does not change.
    const SHOWN_EVENTS = new Set(['emoji', 'scroll-used', 'spell-cast', 'game-over']);

    // One visible move: dispatch messages until one changes what the viewer
    // sees. Returns false at the end. (step() stays one message; the replay
    // check, miner and puzzles count on that.)
    function watchStep() {
        if (!state) return false;
        while (state.index < state.moves.length) {
            const move = state.moves[state.index];
            const before = visibleState();
            step();
            if (SHOWN_EVENTS.has(move.event) || visibleState() !== before) {
                state.shown++;
                updateControls();
                return true;
            }
        }
        pause(); updateControls();
        return false;
    }

    function scheduleNext() {
        clearTimeout(state.timer);
        if (!state.playing || state.index >= state.moves.length) { state.playing = false; updateControls(); return; }
        const prev = state.moves[state.index - 1];
        const next = state.moves[state.index];
        const gap = prev ? Math.min(MAX_GAP_MS, Math.max(0, (next.t || 0) - (prev.t || 0))) : 0;
        state.timer = setTimeout(() => { if (watchStep()) scheduleNext(); }, gap / state.speed);
    }

    function play() { if (!state) return; state.playing = true; updateControls(); scheduleNext(); }
    function pause() { if (!state) return; state.playing = false; clearTimeout(state.timer); clearTimeout(state.startTimer); updateControls(); }

    // ── Entry point ──────────────────────────────────────────────
    // opts.check: used by the replay check (runCheck below): no controls, no
    // autoplay, errors are thrown instead of shown.
    async function open(matchId, opts = {}) {
        if (state) { console.warn('[replay] already running; reload to start another'); return; }
        const { data: match, error } = await supabase.rpc('get_match_replay', { p_match_id: matchId });
        if (error || !match) {
            if (opts.check) throw new Error('could not load: ' + (error?.message || 'not found'));
            alert('Could not load this replay: ' + (error?.message || 'not found'));
            return;
        }
        const seats = (match.seats || []).slice().sort((a, b) => a.index - b.index);
        if (!seats.length) { alert('This replay has no players recorded.'); return; }
        log(`match ${match.id}: ${match.moves.length} moves, ${seats.length} seats`);

        // Name colours and pawn decorations of the recorded players: load them
        // while the server is still reachable (the replay goes offline next).
        try { await window.cosmeticsSystem?.loadNameColors(seats.map(x => x.user_id)); } catch (e) {}

        const handlers = [];
        goOffline(handlers);

        document.getElementById('lobby-wrapper').style.display = 'none';
        document.getElementById('multiplayer-lobby')?.style && (document.getElementById('multiplayer-lobby').style.display = 'none');
        document.getElementById('game-layout').classList.add('active');
        if (typeof updateDeckIndicatorVisibility === 'function') updateDeckIndicatorVisibility();
        if (typeof initializeNewUI === 'function') initializeNewUI();
        // The game start asks about sharing game logs; a replay must not.
        window.promptLogConsentIfNeeded = () => {};

        startBoard(match, seats, handlers);
        state = { match, seats, moves: match.moves || [], index: 0, playing: false, speed: opts.speed || 1, timer: null, handlers, errors: [], shown: 0, logCount: 0 };
        window.ActionLog?.onRecord?.(() => { if (state) state.logCount++; });
        if (opts.check) return;
        buildControls();
        const sel = document.querySelector('#replay-controls [data-act=speed]');
        if (sel && opts.speed) sel.value = String(opts.speed);
        state.startTimer = setTimeout(play, 1500); // let the board finish its intro animation
    }

    // Set up the recorded game's starting board (also used by Restart, so a
    // restart rewinds in place instead of reloading the page).
    function startBoard(match, seats, handlers) {
        // setupGameBroadcast() registers its handlers again on the new fake
        // channel; drop the old ones so no message is applied twice.
        handlers.length = 0;
        // Start the game the normal way, seen from the first seat...
        const allPlayers = seats.map(s => ({
            id: 'replay-seat-' + s.index,
            player_index: s.index,
            color: s.color,
            username: s.username,
            user_id: s.user_id || null,
        }));
        isMultiplayer = true;
        isHost = false;
        currentGameId = 'replay-' + match.id;
        myPlayerId = allPlayers[0].id;
        myPlayerIndex = allPlayers[0].player_index;
        document.getElementById('game-over-notification')?.remove();
        try { currentTurnNumber = 0; } catch (e) {}
        startMultiplayerGame(allPlayers, match.deck_seed, match.settings?.scarce_tiles !== false);

        // ...then become a pure spectator: no seat, nothing to drag.
        myPlayerIndex = SPECTATOR;
        const tray = document.getElementById('new-player-tile-deck') || document.getElementById('player-tile-deck');
        if (tray) tray.innerHTML = '';
        ['end-turn', 'leave-game'].forEach(id => { const el = document.getElementById(id); if (el) el.style.display = 'none'; });
        if (typeof updateStatus === 'function') updateStatus('Watching a replay');
    }

    function restart() {
        if (!state) return;
        pause();
        startBoard(state.match, state.seats, state.handlers);
        state.index = 0;
        state.shown = 0;
        state.errors = [];
        updateControls();
        state.startTimer = setTimeout(play, 1500);
    }

    // Leaving a replay reloads the page (the replay switched Supabase offline).
    // Skip the studio logo and lore intro on that one reload (boot-splash.js).
    function exitReplay() {
        try { sessionStorage.setItem('godaigo_skip_intro_once', '1'); } catch (e) {}
        location.reload();
    }

    // ── Replay check (hermit) ────────────────────────────────────
    // Anti-cheat plan part 2: replay a finished match at full speed, take the
    // same board fingerprint the players' browsers took at each turn change
    // (MatchWitness.fingerprint), and look at the winner on the replayed
    // board. Runs inside a hidden iframe (index.html?replaycheck=ID) so each
    // match gets a fresh page; the result is posted to the parent window,
    // which compares it with the reported fingerprints (checkMatch below).
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));

    async function runCheck(matchId) {
        await open(matchId, { check: true });
        if (!state) throw new Error('replay did not start');
        await sleep(300);
        const fps = {};
        let last = currentTurnNumber;
        while (step()) {
            // Some handlers finish on a short timer; give them a moment, like
            // the real game's 100 ms fingerprint watcher.
            await sleep(25);
            if (currentTurnNumber !== last) {
                last = currentTurnNumber;
                if (!(last in fps)) fps[last] = window.MatchWitness?.fingerprint() || null;
            }
        }
        await sleep(1500);
        const w = state.match.winner_index;
        let activated = [], atShrine = null;
        if (typeof w === 'number') {
            try { activated = [...(spellSystem.playerScrolls?.[w]?.activated || [])].sort(); } catch (e) {}
            try { atShrine = !!isPlayerAtOwnShrine(w); } catch (e) {}
        }
        return {
            fps,
            moves: state.moves.length,
            errorCount: state.errors.length,
            errors: state.errors.slice(0, 10),
            final: { winner: w, winType: state.match.win_type, activated, atShrine },
        };
    }

    // Parent side: run one match in a hidden iframe and wait for its result.
    function runInFrame(matchId, timeoutMs = 180000, mode = 'check', extraQuery = '') {
        return new Promise((resolve) => {
            const frame = document.createElement('iframe');
            frame.style.cssText = 'position:fixed;left:-4000px;top:0;width:1400px;height:900px;border:0;';
            frame.setAttribute('aria-hidden', 'true');
            const done = (result) => {
                clearTimeout(timer);
                window.removeEventListener('message', onMsg);
                frame.remove();
                resolve(result);
            };
            const onMsg = (ev) => {
                if (ev.origin !== location.origin || ev.source !== frame.contentWindow) return;
                if (ev.data?.type === 'godaigo-replay-check' && ev.data.matchId === matchId) done(ev.data);
            };
            const timer = setTimeout(() => done({ error: 'timed out' }), timeoutMs);
            window.addEventListener('message', onMsg);
            // The folder URL, not index.html: some servers redirect index.html
            // to the folder and drop the query string.
            const key = mode === 'mine' ? 'replaymine' : mode === 'puzzle' ? 'replaypuzzle' : 'replaycheck';
            frame.src = new URL('.', location.href).pathname + `?${key}=` + encodeURIComponent(matchId) + extraQuery;
            document.body.appendChild(frame);
        });
    }

    const PARTS = ['tiles', 'stones', 'pawns', 'activated'];

    // Compare the replay with the reported fingerprints and store the result
    // on the match (save_match_check). Turn 1 is skipped: players' browsers
    // take it in the middle of the opening tile placement.
    async function checkMatch(matchId) {
        const run = await runInFrame(matchId);
        let status, detail;
        if (run.error || !run.result) {
            status = 'error';
            detail = { error: run.error || 'no result' };
        } else {
            const r = run.result;
            const { data: reported } = await supabase.rpc('get_match_fingerprints', { p_match_id: matchId });
            const mismatches = [];
            let compared = 0, skippedFormat = 0;
            for (const f of (reported || [])) {
                if (!(f.turn > 1)) continue;
                if (!f.fp || f.fp.length !== 32) { skippedFormat++; continue; }
                const mine = r.fps[f.turn];
                compared++;
                if (mine === f.fp) continue;
                mismatches.push({
                    turn: f.turn, seat: f.seat,
                    parts: mine ? PARTS.filter((_, i) => mine.slice(i * 8, i * 8 + 8) !== f.fp.slice(i * 8, i * 8 + 8)) : ['missing'],
                });
            }
            // The recorded winner must have won on the replayed board too.
            const fin = r.final || {};
            const scrollWin = typeof fin.winner === 'number' && (!fin.winType || fin.winType === 'scrolls');
            const winnerOk = !scrollWin || ((fin.activated || []).length >= 5 && fin.atShrine === true);
            status = mismatches.length || !winnerOk ? 'mismatch'
                   : compared ? 'ok'
                   : 'no_data';
            detail = {
                compared, skippedFormat, mismatches: mismatches.slice(0, 30),
                firstMismatchTurn: mismatches.length ? Math.min(...mismatches.map(m => m.turn)) : null,
                winnerOk, final: fin, moves: r.moves, replayErrors: r.errorCount, errors: r.errors,
            };
        }
        const { error } = await supabase.rpc('save_match_check', { p_match_id: matchId, p_status: status, p_detail: detail });
        if (error) console.warn('[replay-check] save failed:', error.message);
        log(`check ${matchId}: ${status}`, detail);
        return { status, detail };
    }


    // ── Combo miner (hermit, bot combo plan Phase 3) ────────────
    // Replays a finished match at full speed (hidden frame, ?replaymine=ID),
    // scores every seat with the bot's evaluator at each turn change, and
    // records what each player cast (with the choices inside the scroll)
    // and revealed. A window of 1 to 3 of a player's own turns with at least
    // two casts and a big rise in value is a combo candidate. The server
    // weights candidates by the player's rank and experience and never
    // counts bots (save_combo_candidates, sql/combo-miner.sql).
    const MINE_MIN_GAIN = 300;
    function mineSeat(move) {
        const p = move.payload || {};
        const v = [p.playerIndex, p.casterIndex, move.sender].find(x => Number.isInteger(x));
        return v === undefined ? null : v;
    }
    // One recorded message -> a step, or a choice detail for the last cast.
    function mineStep(move, pre, lastCast) {
        const p = move.payload || {};
        const seat = mineSeat(move);
        switch (move.event) {
            case 'scroll-used':
                return p.scrollName ? { kind: 'cast', seat, scroll: p.scrollName } : null;
            case 'tile-flip':
                return { kind: 'reveal', seat: move.sender ?? seat, shrine: p.shrineType || null };
            case 'stone-break':
                return { kind: 'break', seat: move.sender ?? seat };
        }
        if (!lastCast) return null;
        const set = c => { Object.assign(lastCast.choice || (lastCast.choice = {}), c); return null; };
        switch (move.event) {
            case 'wandering-river-apply': return set({ tile: pre?.hidden ? 'hidden' : 'revealed', element: p.newElement });
            case 'create-stones':
            case 'scholars-insight':
            case 'quick-reflexes-search': return set({ element: p.element });
            case 'opponent-stone-destroyed': return set({ element: p.stoneType, target: p.opponentIndex });
            case 'scroll-plundered': return set({ scroll: p.scrollName, target: p.targetIndex });
            case 'take-flight': return set({ flew: true });
            case 'tile-swap': return set({ swapped: true });
            case 'telekinesis-move': return set({ movedTile: true });
        }
        return null;
    }

    async function runMine(matchId) {
        await open(matchId, { check: true });
        if (!state) throw new Error('replay did not start');
        await sleep(300);
        const seats = state.seats.map(x => x.index);
        const value = () => seats.map(i => {
            try { return Math.round(window.BotSystem.evaluateSnapshot(window.BotState.snapshot(), i)); } catch (e) { return null; }
        });
        const segs = [];
        let lastTurn = currentTurnNumber, lastActive = activePlayerIndex;
        let seg = { turn: lastTurn, seat: lastActive, v0: value(), steps: [] };
        const lastCastBySeat = {};
        while (state.index < state.moves.length) {
            const move = state.moves[state.index];
            let pre = null;
            if (move.event === 'wandering-river-apply') {
                const t = (typeof placedTiles !== 'undefined' ? placedTiles : []).find(t => Number(t.id) === Number(move.payload?.tileId));
                pre = { hidden: !!t?.flipped };
            }
            step();
            await sleep(20);
            const seat = mineSeat(move);
            const st = mineStep(move, pre, lastCastBySeat[seat]);
            if (st) {
                st.turn = seg.turn;
                seg.steps.push(st);
                if (st.kind === 'cast') lastCastBySeat[st.seat] = st;
            }
            if (currentTurnNumber !== lastTurn || activePlayerIndex !== lastActive) {
                const v = value();
                seg.v1 = v; segs.push(seg);
                lastTurn = currentTurnNumber; lastActive = activePlayerIndex;
                seg = { turn: lastTurn, seat: lastActive, v0: v, steps: [] };
            }
        }
        await sleep(500);
        seg.v1 = value(); segs.push(seg);
        return { candidates: findCombos(segs, seats), segments: segs.length, errorCount: state.errors.length };
    }

    // Readable token for one step: scroll id plus the kind of choice.
    function stepToken(st) {
        if (st.kind === 'reveal') return 'reveal';
        if (st.kind === 'break') return 'break';
        const c = st.choice || {};
        const tag = c.tile ? `[${c.tile} tile]` : c.flew ? '[flight]' : c.swapped ? '[swap]' : c.movedTile ? '[move tile]' : '';
        return st.scroll + tag;
    }

    function findCombos(segs, seats) {
        const all = [];
        for (const seat of seats) {
            const own = segs.filter(s => s.seat === seat);
            const pos = seats.indexOf(seat);
            for (let e = 0; e < own.length; e++) {
                for (let L = 1; L <= 3 && e - L + 1 >= 0; L++) {
                    const first = own[e - L + 1], last = own[e];
                    const a = first.v0?.[pos], b = last.v1?.[pos];
                    if (a == null || b == null) continue;
                    const steps = own.slice(e - L + 1, e + 1)
                        .flatMap((s, j) => s.steps.filter(x => x.seat === seat).map(x => ({ ...x, t: j })));
                    if (steps.filter(x => x.kind === 'cast').length < 2) continue;
                    all.push({ seat, gain: b - a, turns: L, start_turn: first.turn, end_turn: last.turn, steps });
                }
            }
        }
        if (!all.length) return [];
        const gains = all.map(c => c.gain).sort((x, y) => x - y);
        const p75 = gains[Math.floor(gains.length * 0.75)] ?? 0;
        const bar = Math.max(MINE_MIN_GAIN, p75);
        // Best windows first; a window overlapping an already chosen one
        // (same seat, shared turn) is dropped.
        const chosen = [];
        for (const c of all.filter(c => c.gain >= bar).sort((x, y) => y.gain - x.gain)) {
            const overlaps = chosen.some(o => o.seat === c.seat && !(c.end_turn < o.start_turn || c.start_turn > o.end_turn));
            if (!overlaps) chosen.push(c);
        }
        return chosen.map(c => {
            // Signature: steps in order, turns separated by " / ", repeated reveals collapsed.
            const parts = [];
            let t = 0, cur = [];
            for (const st of c.steps) {
                if (st.t !== t) { parts.push(cur); cur = []; t = st.t; }
                const tok = stepToken(st);
                if (tok === 'reveal' && cur[cur.length - 1] === 'reveal') continue;
                cur.push(tok);
            }
            parts.push(cur);
            return {
                seat: c.seat, gain: c.gain, turns: c.turns, start_turn: c.start_turn, end_turn: c.end_turn,
                signature: parts.filter(p => p.length).map(p => p.join(' > ')).join(' / '),
                steps: c.steps.map(({ kind, scroll, choice, shrine, t }) => ({ kind, scroll, choice, shrine, t })),
            };
        });
    }

    // Parent side: mine every finished match not mined yet.
    let mining = false;
    async function mineMatches(onProgress) {
        if (mining) return;
        mining = true;
        let done = 0, found = 0;
        try {
            const { data, error } = await supabase.rpc('list_matches_for_mining', { p_limit: 50 });
            if (error) throw error;
            const ids = (data || []).map(r => r.id);
            for (const id of ids) {
                onProgress?.(`Mining #${id} (${done + 1} of ${ids.length})...`);
                const run = await runInFrame(id, 300000, 'mine');
                const rows = run.result?.candidates || [];
                if (run.error) log(`mine ${id}: ${run.error}`);
                const { error: e2 } = await supabase.rpc('save_combo_candidates', { p_match_id: id, p_rows: rows });
                if (e2) log(`mine ${id}: save failed`, e2.message);
                done++; found += rows.length;
            }
        } finally {
            mining = false;
        }
        return { done, found };
    }


    // ── Puzzle training (hermit, bot combo plan Phase 4b) ────────
    // A puzzle = a mined combo moment (hermit_list_puzzles). In a hidden
    // frame (?replaypuzzle=MATCH&seat=&turn=&turns=&wkey=) the match is
    // replayed up to the start of that seat's turn, then bots take over
    // every seat (the recorded moves stop) until the puzzle seat has played
    // the same number of turns. Score = bot gain / player gain, both from
    // the bot's evaluator; solved when the bot gets 90% of the player's gain.
    // wkey: localStorage key holding the weights to test (default: current).
    const PUZZLE_SOLVED = 0.9;

    async function runPuzzle(p, weights) {
        await open(p.match_id, { check: true });
        if (!state) throw new Error('replay did not start');
        await sleep(300);
        const seat = +p.seat;
        while (state.index < state.moves.length &&
               !(currentTurnNumber === +p.start_turn && activePlayerIndex === seat)) {
            step();
            await sleep(15);
        }
        if (!(currentTurnNumber === +p.start_turn && activePlayerIndex === seat)) throw new Error('start turn not found');
        const value = () => window.BotSystem.evaluateSnapshot(window.BotState.snapshot(), seat);
        const v0 = value();
        if (window.LazyScripts) await window.LazyScripts.load('bot-arena');
        if (weights && window.BotArena?.applyWeights) window.BotArena.applyWeights(weights);
        window.BotSystem.resetMemory?.();
        window.BotSystem.speedScale = 0.02;
        const endBtn = document.getElementById('end-turn');
        let own = 0, guard = 0;
        while (own < (+p.turns || 1) && guard++ < 6 * ((+p.turns || 1) + 1)) {
            const who = activePlayerIndex;
            myPlayerIndex = who;              // the bot plays whoever's turn it is
            if (endBtn) { endBtn.style.display = ''; endBtn.disabled = false; }
            if (typeof updateEndTurnButtonVisibility === 'function') updateEndTurnButtonVisibility();
            await window.BotSystem.turn();
            await window.BotSystem.waitForQuiescence();
            await sleep(150);
            if (who === seat) own++;
            if (activePlayerIndex === who) break; // the turn did not pass; stop rather than loop
        }
        const botGain = Math.round(value() - v0);
        const humanGain = +p.gain || 0;
        const ratio = humanGain > 0 ? botGain / humanGain : 0;
        return { id: p.id, botGain, humanGain, ratio: +ratio.toFixed(3), solved: ratio >= PUZZLE_SOLVED, ownTurns: own };
    }

    // A fixed quarter of the puzzles is kept for testing only (never used to
    // decide training), so a solve rate there shows real skill.
    const isTestPuzzle = p => Number(p.id) % 4 === 0;

    // Parent side: solve each puzzle in a fresh hidden frame.
    let solving = false;
    async function solvePuzzles(puzzles, weights, onProgress) {
        if (solving) throw new Error('already solving');
        solving = true;
        const wkey = 'godaigo_puzzle_weights_' + Date.now();
        try {
            if (weights) localStorage.setItem(wkey, JSON.stringify(weights));
            const results = [];
            for (let i = 0; i < puzzles.length; i++) {
                const p = puzzles[i];
                onProgress?.(`Puzzle ${i + 1} of ${puzzles.length} (game #${p.match_id})...`);
                const q = `&seat=${p.seat}&turn=${p.start_turn}&turns=${p.turns}&gain=${p.gain}&pid=${p.id}` + (weights ? `&wkey=${wkey}` : '');
                const run = await runInFrame(p.match_id, 240000, 'puzzle', q);
                results.push(run.result || { id: p.id, error: run.error || 'no result', ratio: 0, solved: false });
            }
            return results;
        } finally {
            solving = false;
            try { localStorage.removeItem(wkey); } catch (e) {}
        }
    }
    function puzzleSummary(results) {
        const ok = results.filter(r => !r.error);
        const avg = ok.length ? ok.reduce((a, r) => a + Math.max(0, Math.min(1.5, r.ratio)), 0) / ok.length : 0;
        return { n: results.length, errors: results.length - ok.length, solved: ok.filter(r => r.solved).length, avgRatio: +avg.toFixed(3) };
    }
    // For training (BotArena.hillClimb opts.puzzleCheck): average score of
    // these weights on the TRAINING puzzles (at most `max` of them).
    async function puzzleScore(weights, max = 6) {
        const { data, error } = await supabase.rpc('hermit_list_puzzles', { p_limit: 60 });
        if (error) throw error;
        const train = (data || []).filter(p => !isTestPuzzle(p)).slice(0, max);
        if (!train.length) return null;
        return puzzleSummary(await solvePuzzles(train, weights)).avgRatio;
    }

    // Inside the iframe: index.html?replaycheck=ID runs the check (or
    // ?replaymine=ID the combo miner, ?replaypuzzle=ID a puzzle) and reports.
    async function frameEntry() {
        const params = new URLSearchParams(location.search);
        const mineMode = params.has('replaymine');
        const puzzleMode = params.has('replaypuzzle');
        const id = +(mineMode ? params.get('replaymine') : puzzleMode ? params.get('replaypuzzle') : params.get('replaycheck'));
        if (!id || window.parent === window) return;
        const post = (payload) => window.parent.postMessage({ type: 'godaigo-replay-check', matchId: id, ...payload }, location.origin);
        try {
            ['boot-splash', 'lore-intro'].forEach(x => document.getElementById(x)?.remove());
            document.querySelectorAll('video').forEach(v => { try { v.pause(); } catch (e) {} });
            // Wait for sign-in and the lobby start-up, so nothing resets the
            // game after the replay has started.
            for (let i = 0; i < 60; i++) {
                const { data } = await supabase.auth.getSession();
                if (data?.session && window.gami?.userId) break;
                await sleep(500);
            }
            await sleep(1500);
            let result;
            if (puzzleMode) {
                let weights = null;
                try { const k = params.get('wkey'); if (k) weights = JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) {}
                result = await runPuzzle({ id: +params.get('pid'), match_id: id, seat: +params.get('seat'),
                    start_turn: +params.get('turn'), turns: +params.get('turns'), gain: +params.get('gain') }, weights);
            } else result = mineMode ? await runMine(id) : await runCheck(id);
            post({ result });
        } catch (e) {
            post({ error: String(e?.message || e) });
        }
    }
    if (['replaycheck', 'replaymine', 'replaypuzzle'].some(k => new URLSearchParams(location.search).has(k))) {
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', frameEntry);
        else frameEntry();
    }


    // ── Replay browser (lobby "Replays" button) ─────────────────
    // Two lists: my finished games (with Watch + Post publicly / Remove from
    // public) and games other players posted (Watch). Data comes from
    // list_my_matches / list_public_matches (sql/replay-access.sql).
    let browserTab = 'mine';

    function esc(v) {
        return String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    function fmtDuration(sec) {
        if (!(sec > 0)) return '';
        const m = Math.floor(sec / 60), s = sec % 60;
        return m ? `${m} min` : `${s} s`;
    }

    function fmtWhen(iso) {
        if (!iso) return '';
        try {
            return new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
        } catch (e) { return ''; }
    }

    // Player names without emojis: the stored bot name starts with the bot
    // marker (displayUsername strips it); "bot" and "winner" are small text tags.
    function seatName(p) {
        return typeof displayUsername === 'function' ? displayUsername(p.username) : p.username;
    }
    function seatTags(p, won) {
        const isBot = p.is_bot || (typeof window.isBotUsername === 'function' && window.isBotUsername(p.username));
        return (isBot ? '<span class="replay-tag">bot</span>' : '') + (won ? '<span class="replay-tag replay-tag-win">winner</span>' : '');
    }

    // Hermit: the featured replay (lobby "Watch featured replay" button).
    let featuredId = null;
    function featureBtn(id) {
        if (!window.isHermit?.()) return '';
        const on = featuredId === id;
        return `<button class="replay-feature${on ? ' on' : ''}" data-id="${id}" title="${on ? 'Featured in the lobby. Click to stop featuring it.' : 'Show this replay on the lobby button'}">${on ? 'Featured' : 'Feature'}</button>`;
    }

    function rowHtml(m, mine) {
        const players = (m.players || []).slice().sort((a, b) => a.index - b.index).map(p => {
            const won = m.winner_index === p.index;
            return `<span class="replay-player${won ? ' won' : ''}" style="--pc:${esc(p.color)}">${esc(seatName(p))}${seatTags(p, won)}</span>`;
        }).join('<span class="replay-vs">vs</span>');
        const info = [fmtWhen(m.started_at), fmtDuration(m.duration_s),
                      m.status === 'abandoned' ? 'not finished' : ''].filter(Boolean).join(' · ');
        const post = mine
            ? `<button class="replay-post" data-id="${m.id}" data-public="${m.is_public ? 1 : 0}">${m.is_public ? 'Remove from public' : 'Post publicly'}</button>`
            : '';
        return `
            <div class="replay-row">
                <div class="replay-row-main">
                    <div class="replay-players">${players}</div>
                    <div class="replay-info">${esc(info)}${mine && m.is_public ? ' · <b>public</b>' : ''}</div>
                </div>
                <div class="replay-row-actions">
                    <button class="replay-watch" data-id="${m.id}">Watch</button>
                    ${featureBtn(m.id)}
                    ${post}
                </div>
            </div>`;
    }

    // Hermit "Check" tab: replay verification status per match.
    function checkSummary(m) {
        const d = m.check_detail || {};
        if (!m.check_status) return 'not checked';
        if (m.check_status === 'ok') return `ok (${d.compared} turns match)`;
        if (m.check_status === 'no_data') return `no fingerprints to compare${d.skippedFormat ? ` (${d.skippedFormat} old format)` : ''}${d.winnerOk === false ? ', winner NOT confirmed' : ''}`;
        if (m.check_status === 'error') return 'error: ' + (d.error || 'unknown');
        const parts = [...new Set((d.mismatches || []).flatMap(x => x.parts))].join(', ');
        return [d.firstMismatchTurn ? `differs from turn ${d.firstMismatchTurn} (${parts})` : '',
                d.winnerOk === false ? 'winner NOT confirmed on the replayed board' : ''].filter(Boolean).join('; ');
    }

    function checkRowHtml(m) {
        const players = (m.players || []).slice().sort((a, b) => a.index - b.index)
            .map(p => `${esc(seatName(p))}${seatTags(p, m.winner_index === p.index)}`).join(' vs ');
        const flags = [m.desync_count ? `${m.desync_count} desync reports` : '', m.disputed ? 'disputed' : ''].filter(Boolean).join(' · ');
        return `
            <div class="replay-row">
                <div class="replay-row-main">
                    <div class="replay-players">#${m.id} ${players}</div>
                    <div class="replay-info">${esc([fmtWhen(m.started_at), fmtDuration(m.duration_s), flags].filter(Boolean).join(' · '))}</div>
                    <div class="replay-check replay-check-${esc(m.check_status || 'none')}">${esc(checkSummary(m))}</div>
                </div>
                <div class="replay-row-actions">
                    <button class="replay-watch" data-id="${m.id}">Watch</button>
                    <button class="replay-run-check" data-id="${m.id}">Check</button>
                    ${featureBtn(m.id)}
                </div>
            </div>`;
    }

    // Hermit "Players" tab (Phase 4): one row per player from
    // hermit_player_overview (sql/hermit-players.sql), most suspicious first.
    // "Games" opens that player's games with Watch / Check.
    let playerDays = 30;

    // "WATER_SCROLL_4[hidden tile] > reveal / EARTH_SCROLL_4" -> scroll names.
    function prettySignature(sig) {
        return String(sig || '').split(' / ').map(turn => turn.split(' > ').map(tok => {
            const m = /^([A-Z]+_SCROLL_\d+)(\[.*\])?$/.exec(tok);
            if (!m) return esc(tok);
            const name = window.SCROLL_DEFINITIONS?.[m[1]]?.name || m[1];
            return `<b>${esc(name)}</b>${m[2] ? ' ' + esc(m[2].slice(1, -1)) : ''}`;
        }).join(' &gt; ')).map((t, i) => `<div>Turn ${i + 1}: ${t}</div>`).join('');
    }

    let puzzleRows = [];
    function puzzleRowHtml(pz, r) {
        const result = r ? (r.error ? `error: ${esc(r.error)}` : `bot ${r.botGain} vs player ${r.humanGain} = ${r.ratio}${r.solved ? ' (solved)' : ''}`) : 'not tested yet';
        return `<div class="replay-row">
            <div class="replay-row-main">
                <div class="replay-combo-sig">${prettySignature(pz.signature)}</div>
                <div class="replay-info">Game #${pz.match_id} · seat ${pz.seat + 1} · from turn ${pz.start_turn} · ${pz.turns} turn${pz.turns === 1 ? '' : 's'} · player gain ${Math.round(pz.gain)}${isTestPuzzle(pz) ? ' · test puzzle' : ''}</div>
                <div class="replay-check ${r?.solved ? 'replay-check-ok' : ''}">${result}</div>
            </div>
            <div class="replay-row-actions"><button class="replay-watch" data-id="${pz.match_id}">Watch</button></div>
        </div>`;
    }

    function comboRowHtml(c) {
        return `<div class="replay-row replay-combo-row">
            <div class="replay-row-main">
                <div class="replay-combo-sig">${prettySignature(c.signature)}</div>
                <div class="replay-info">Seen ${c.times} time${c.times === 1 ? '' : 's'} in ${c.matches} game${c.matches === 1 ? '' : 's'} by ${c.players} player${c.players === 1 ? '' : 's'} · avg gain ${Math.round(c.avg_gain)} · trust ${(+c.avg_trust).toFixed(2)} · score ${Math.round(c.score)}</div>
            </div>
            <div class="replay-row-actions">
                <button class="replay-watch" data-id="${c.best_match}">Watch</button>
                <div class="replay-combo-state" title="Auto: bots use it once it shows up in 2 games">
                    ${['auto', 'on', 'off'].map(st => `<button class="replay-combo-set${(c.state || 'auto') === st ? ' active' : ''}" data-sig="${esc(c.signature)}" data-state="${st}">${st === 'auto' ? 'Auto' : st === 'on' ? 'On' : 'Off'}</button>`).join('')}
                </div>
                <div class="replay-info">${c.taught ? 'Bots use it' : 'Bots do not use it'}</div>
            </div>
        </div>`;
    }

    function playerRowHtml(pl) {
        const nameStyle = pl.name_color ? (window.cosmeticsSystem?.getNameColorStyle(pl.name_color) || '') : '';
        const rate = pl.games ? Math.round(100 * pl.wins / pl.games) : 0;
        const stats = [`${pl.games} games`, `${pl.wins} wins (${rate}%)`,
            pl.fastest_win_s ? `fastest win ${fmtDuration(pl.fastest_win_s)}` : '',
            pl.last_standing_wins ? `${pl.last_standing_wins} last-standing` : '',
            pl.abandoned ? `${pl.abandoned} unfinished` : '',
            pl.top_opponent && pl.top_opponent_wins ? `most wins vs ${pl.top_opponent} (${pl.top_opponent_wins})` : '',
            `${pl.checked_games}/${pl.games} checked`].filter(Boolean).join(' · ');
        const flags = (pl.flags || []).map(f => `<li>${esc(f)}</li>`).join('');
        return `
            <div class="replay-player-block" data-user="${esc(pl.user_id)}">
                <div class="replay-row">
                    <div class="replay-row-main">
                        <div class="replay-players"><span class="replay-score${pl.score >= 4 ? ' high' : pl.score > 0 ? ' some' : ''}">${pl.score}</span>
                            <span style="${nameStyle}">${esc(pl.name)}</span></div>
                        <div class="replay-info">${esc(stats)}</div>
                        ${flags ? `<ul class="replay-flags">${flags}</ul>` : ''}
                    </div>
                    <div class="replay-row-actions">
                        <button class="replay-player-games" data-user="${esc(pl.user_id)}">Games</button>
                    </div>
                </div>
                <div class="replay-player-matches"></div>
            </div>`;
    }

    async function togglePlayerGames(userId, btn) {
        const block = btn.closest('.replay-player-block');
        const box = block?.querySelector('.replay-player-matches');
        if (!box) return;
        if (box.innerHTML) { box.innerHTML = ''; btn.textContent = 'Games'; return; }
        box.innerHTML = '<div class="replay-empty">Loading...</div>';
        const { data, error } = await supabase.rpc('hermit_player_matches', { p_user: userId, p_limit: 30 });
        if (error) { box.innerHTML = `<div class="replay-empty">Could not load: ${esc(error.message)}</div>`; return; }
        const rows = Array.isArray(data) ? data : [];
        checkRows = rows.concat(checkRows.filter(r => !rows.some(x => x.id === r.id)));
        box.innerHTML = rows.map(checkRowHtml).join('') || '<div class="replay-empty">No games.</div>';
        btn.textContent = 'Hide games';
    }

    let checkRows = [];
    let checking = false;

    async function runChecks(ids) {
        if (checking) return;
        checking = true;
        const status = document.querySelector('#replay-browser .replay-check-progress');
        try {
            for (let i = 0; i < ids.length; i++) {
                if (status) status.textContent = `Checking #${ids[i]} (${i + 1} of ${ids.length})...`;
                await checkMatch(ids[i]);
            }
        } finally {
            checking = false;
            if (status) status.textContent = '';
            if (browserTab === 'check') renderList();
        }
    }

    async function renderList() {
        const overlay = document.getElementById('replay-browser');
        if (!overlay) return;
        overlay.querySelectorAll('.replay-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === browserTab));
        const list = overlay.querySelector('.replay-list');
        list.innerHTML = '<div class="replay-empty">Loading...</div>';
        if (window.isHermit?.()) {
            try { const { data } = await supabase.rpc('get_featured_match'); featuredId = data || null; } catch (e) {}
        }
        if (browserTab === 'players') {
            const { data, error } = await supabase.rpc('hermit_player_overview', { p_days: playerDays });
            if (browserTab !== 'players') return;
            if (error) { list.innerHTML = `<div class="replay-empty">Could not load: ${esc(error.message)}</div>`; return; }
            const rows = Array.isArray(data) ? data : [];
            list.innerHTML = `
                <div class="replay-check-bar">
                    <label>Last <select class="replay-player-days">
                        ${[7, 30, 90].map(d => `<option value="${d}"${d === playerDays ? ' selected' : ''}>${d} days</option>`).join('')}
                    </select></label>
                </div>
                <div class="replay-note">Built only from server records of online games. The number is a warning score: replay-unconfirmed and disputed wins count most, then very fast wins, most wins against one player, waiting wins and out-of-sync games. A score is a reason to watch the games, not proof.</div>
                ${rows.map(playerRowHtml).join('') || '<div class="replay-empty">No online games in this period.</div>'}`;
            const sel = list.querySelector('.replay-player-days');
            if (sel) sel.onchange = () => { playerDays = +sel.value || 30; renderList(); };
            return;
        }
        if (browserTab === 'puzzles') {
            const { data, error } = await supabase.rpc('hermit_list_puzzles', { p_limit: 60 });
            if (browserTab !== 'puzzles') return;
            if (error) { list.innerHTML = `<div class="replay-empty">Could not load: ${esc(error.message)}</div>`; return; }
            puzzleRows = Array.isArray(data) ? data : [];
            let last = {};
            try { last = JSON.parse(localStorage.getItem('godaigo_puzzle_results') || '{}'); } catch (e) {}
            const res = Object.values(last.byId || {});
            const sumOf = set => puzzleSummary(res.filter(r => set === 'test' ? isTestPuzzle(r) : !isTestPuzzle(r)));
            const tr = sumOf('train'), te = sumOf('test');
            list.innerHTML = `
                <div class="replay-check-bar">
                    <button class="replay-puzzle-run">Test current bot</button>
                    <span class="replay-check-progress">${solving ? 'Solving...' : ''}</span>
                </div>
                ${last.at ? `<div class="replay-note">Last test (${esc(fmtWhen(last.at))}): training puzzles ${tr.solved} of ${tr.n} solved, avg score ${tr.avgRatio}; test puzzles ${te.solved} of ${te.n} solved, avg score ${te.avgRatio}.</div>` : ''}
                <div class="replay-note">Each puzzle is a combo a player made in a real game. The bot is put in the same spot and plays the same number of turns. Score = the bot's gain / the player's gain; solved at 0.9 or more. Every 4th puzzle is a test puzzle: training never looks at it.</div>
                ${puzzleRows.map(pz => puzzleRowHtml(pz, (last.byId || {})[pz.id])).join('') || '<div class="replay-empty">No puzzles yet. Mine games in the Combos tab first.</div>'}`;
            return;
        }
        if (browserTab === 'combos') {
            const { data, error } = await supabase.rpc('hermit_combo_summary', { p_min_count: 1 });
            if (browserTab !== 'combos') return;
            if (error) { list.innerHTML = `<div class="replay-empty">Could not load: ${esc(error.message)}</div>`; return; }
            const rows = Array.isArray(data) ? data : [];
            list.innerHTML = `
                <div class="replay-check-bar">
                    <button class="replay-mine">Mine new games</button>
                    <button class="replay-mine-all">Mine everything again</button>
                    <span class="replay-check-progress">${mining ? 'Mining...' : ''}</span>
                </div>
                <div class="replay-note">Each finished game is replayed in a hidden frame. When a player's position jumps within 1 to 3 of their turns and they cast 2 or more scrolls, those casts (with their choices) are saved as a combo. Score = gain x trust, where trust comes from the player's ladder rank and games played. Bots never count. Bots learn a combo once it shows up in 2 different games (Auto). On teaches it now, Off never.</div>
                ${rows.map(comboRowHtml).join('') || '<div class="replay-empty">No combos found yet. Press "Mine new games".</div>'}`;
            return;
        }
        if (browserTab === 'check') {
            const { data, error } = await supabase.rpc('list_matches_for_check', { p_limit: 50 });
            if (browserTab !== 'check') return;
            if (error) { list.innerHTML = `<div class="replay-empty">Could not load: ${esc(error.message)}</div>`; return; }
            checkRows = Array.isArray(data) ? data : [];
            list.innerHTML = `
                <div class="replay-check-bar">
                    <button class="replay-check-all">Check all unchecked</button>
                    <span class="replay-check-progress">${checking ? 'Checking...' : ''}</span>
                </div>
                <div class="replay-note">Replays each game in a hidden frame and compares its board, turn by turn, with the fingerprints the players' browsers reported. Also checks the winner on the replayed board.</div>
                ${checkRows.map(checkRowHtml).join('') || '<div class="replay-empty">No finished games.</div>'}`;
            return;
        }
        const mine = browserTab === 'mine';
        const { data, error } = await supabase.rpc(mine ? 'list_my_matches' : 'list_public_matches', { p_limit: 30 });
        if (!document.getElementById('replay-browser') || (browserTab === 'mine') !== mine) return;
        if (error) { list.innerHTML = `<div class="replay-empty">Could not load games: ${esc(error.message)}</div>`; return; }
        const rows = Array.isArray(data) ? data : [];
        list.innerHTML = rows.length
            ? rows.map(m => rowHtml(m, mine)).join('')
            : `<div class="replay-empty">${mine
                ? 'No games yet. Your online games show up here when they end.'
                : 'Nobody has posted a game yet. Post one of yours from "My games".'}</div>`;
    }

    function openBrowser(tab) {
        document.getElementById('replay-browser')?.remove();
        if (tab) browserTab = tab;
        const overlay = document.createElement('div');
        overlay.id = 'replay-browser';
        overlay.innerHTML = `
            <div class="replay-modal" role="dialog" aria-label="Replays">
                <div class="replay-modal-title">Replays</div>
                <div class="replay-tabs">
                    <button class="replay-tab" data-tab="mine">My games</button>
                    <button class="replay-tab" data-tab="public">Public</button>
                    ${window.isHermit?.() ? '<button class="replay-tab" data-tab="check">Check</button><button class="replay-tab" data-tab="players">Players</button><button class="replay-tab" data-tab="combos">Combos</button><button class="replay-tab" data-tab="puzzles">Puzzles</button>' : ''}
                </div>
                <div class="replay-list"></div>
                <div class="replay-note">Games are kept for 30 days. Posted games are kept until you remove them. Posting shows the whole game, with every player's name, to everyone.</div>
                <button class="replay-close">Close</button>
            </div>`;
        overlay.addEventListener('click', async (ev) => {
            const t = ev.target;
            if (t === overlay || t.classList.contains('replay-close')) {
                if (checking || mining || solving) return; // closing would drop the running frame's results
                overlay.remove(); return;
            }
            if (t.classList.contains('replay-tab')) { browserTab = t.dataset.tab; renderList(); return; }
            if (t.classList.contains('replay-watch')) {
                t.disabled = true; t.textContent = 'Loading...';
                overlay.remove();
                open(+t.dataset.id);
                return;
            }
            if (t.classList.contains('replay-run-check')) { runChecks([+t.dataset.id]); return; }
            if (t.classList.contains('replay-feature')) {
                const id = +t.dataset.id;
                t.disabled = true;
                const { error } = await supabase.rpc('hermit_set_featured_match', { p_match_id: featuredId === id ? null : id });
                if (error) { alert('Could not feature this replay: ' + error.message); t.disabled = false; return; }
                renderList();
                return;
            }
            if (t.classList.contains('replay-puzzle-run')) {
                if (solving || !puzzleRows.length) return;
                const status = overlay.querySelector('.replay-check-progress');
                try {
                    const results = await solvePuzzles(puzzleRows, null, msg => { if (status) status.textContent = msg; });
                    const byId = {};
                    results.forEach(r => { byId[r.id] = r; });
                    localStorage.setItem('godaigo_puzzle_results', JSON.stringify({ at: new Date().toISOString(), byId }));
                } catch (e) {
                    if (status) status.textContent = 'Failed: ' + (e.message || e);
                }
                if (browserTab === 'puzzles') renderList();
                return;
            }
            if (t.classList.contains('replay-combo-set')) {
                t.disabled = true;
                const { error } = await supabase.rpc('hermit_set_combo_state', { p_signature: t.dataset.sig, p_state: t.dataset.state });
                if (error) { alert('Could not change this combo: ' + error.message); t.disabled = false; return; }
                renderList();
                return;
            }
            if (t.classList.contains('replay-mine') || t.classList.contains('replay-mine-all')) {
                if (mining) return;
                if (t.classList.contains('replay-mine-all')) {
                    if (!confirm('Delete all found combos and mine every finished game again?')) return;
                    const { error } = await supabase.rpc('hermit_reset_mining');
                    if (error) { alert('Could not reset: ' + error.message); return; }
                }
                const status = overlay.querySelector('.replay-check-progress');
                try {
                    const r = await mineMatches(msg => { if (status) status.textContent = msg; });
                    if (status) status.textContent = r ? `Mined ${r.done} game${r.done === 1 ? '' : 's'}, ${r.found} combo${r.found === 1 ? '' : 's'} found.` : '';
                } catch (e) {
                    if (status) status.textContent = 'Mining failed: ' + (e.message || e);
                }
                setTimeout(() => { if (browserTab === 'combos') renderList(); }, 1500);
                return;
            }
            if (t.classList.contains('replay-player-games')) { togglePlayerGames(t.dataset.user, t); return; }
            if (t.classList.contains('replay-check-all')) {
                runChecks(checkRows.filter(m => !m.check_status).map(m => m.id));
                return;
            }
            if (t.classList.contains('replay-post')) {
                const makePublic = t.dataset.public !== '1';
                if (makePublic && !confirm('Post this game publicly? Everyone will be able to watch it, with every player\'s name.')) return;
                t.disabled = true;
                const { error } = await supabase.rpc('set_match_public', { p_match_id: +t.dataset.id, p_public: makePublic });
                if (error) { alert('Could not change this game: ' + error.message); t.disabled = false; return; }
                renderList();
            }
        });
        document.body.appendChild(overlay);
        renderList();
    }

    // Lobby "Watch featured replay": the hermit's pick, at 4x.
    async function openFeatured() {
        const { data: id, error } = await supabase.rpc('get_featured_match');
        if (error || !id) { alert('There is no featured replay right now. Check back later!'); return; }
        await open(id, { speed: 4 });
    }

    window.Replay = { open, openFeatured, openBrowser, checkMatch, runCheck, runMine, mineMatches, findCombos,
        runPuzzle, solvePuzzles, puzzleSummary, puzzleScore, play, pause, step, get state() { return state; } };
})();
