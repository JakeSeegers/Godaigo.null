// match-recorder.js: records every online game's messages to Supabase.
//
// Phase 1 of replays / cheat checks / stats (sql/match-recording.sql).
// Only the room HOST records: it hears everyone's moves (catch-all listener
// on the game channel) and sends its own and its bots' moves (hook in
// broadcastGameAction). The channel uses broadcast self:false, so both hooks
// are needed. Moves are buffered and sent in small batches.
//
// If the host leaves mid-game, the new host calls adopt() and continues the
// same match (the match id is stored on game_room.match_id).
//
// Players notice nothing: this never blocks or changes gameplay, and every
// failure is only logged.
(function () {
    const FLUSH_MS = 3000;
    const MAX_BATCH = 100;
    const MAX_PAYLOAD_CHARS = 30000;
    const MAX_BUFFER = 2000; // safety cap if the server is unreachable for long
    // Periodic "resend the whole state" messages. The first real game (match 2)
    // showed these repeat unchanged most of the time (common-area-sync: 105
    // sent, 4 different), so an exact repeat of the last one saved is skipped.
    // Every change is still recorded, so replays lose nothing.
    const DEDUPE_EVENTS = new Set(['turn-sync', 'common-area-sync', 'scroll-state-sync']);

    let matchId = null;
    let roomId = null;
    let buffer = [];
    let timer = null;
    let flushing = false;
    let adopting = false;
    let finishing = false; // finish() can be called from several game-over paths
    let lastSync = new Map(); // "event|sender" -> content of the last one saved

    function log(...a) { console.log('[match-rec]', ...a); }

    // Globals from multiplayer-state.js / lobby.js, read at call time.
    function isRecorder() {
        try {
            return !!(isHost && isMultiplayer && currentGameId);
        } catch (e) { return false; }
    }

    function ensureTimer() {
        if (!timer) timer = setInterval(flush, FLUSH_MS);
    }

    function reset() {
        if (timer) { clearInterval(timer); timer = null; }
        matchId = null;
        roomId = null;
        buffer = [];
        finishing = false;
        lastSync = new Map();
    }

    // Host, right after the game starts.
    async function start(seed, players, settings) {
        if (!isRecorder()) return;
        reset();
        roomId = currentGameId;
        ensureTimer();
        const snapshot = (players || []).map(p => ({
            index: p.player_index,
            color: p.color,
            username: p.username,
            user_id: p.user_id || null,
            is_bot: !!window.isBotUsername?.(p.username),
        }));
        const { data, error } = await supabase.rpc('start_match', {
            p_room_id: roomId,
            p_deck_seed: seed ?? null,
            p_players: snapshot,
            p_settings: settings || {},
        });
        if (error) { console.warn('[match-rec] start failed:', error.message); return; }
        if (roomId !== currentGameId) return; // left the room meanwhile
        matchId = data;
        log('recording match', matchId);
        flush();
    }

    // New host mid-game: continue the match the old host started.
    async function adopt() {
        if (!isRecorder() || matchId || adopting) return;
        adopting = true;
        try {
            const { data } = await supabase.from('game_room')
                .select('match_id').eq('id', currentGameId).single();
            if (data?.match_id) {
                roomId = currentGameId;
                matchId = data.match_id;
                ensureTimer();
                log('took over recording match', matchId);
            }
        } catch (e) { /* ignore */ }
        adopting = false;
    }

    function record(event, payload, sender) {
        if (!isRecorder()) return;
        if (!matchId && !timer) return; // not recording this game
        let clean;
        try {
            const text = JSON.stringify(payload ?? {});
            if (text.length > MAX_PAYLOAD_CHARS) return;
            clean = JSON.parse(text);
        } catch (e) { return; }
        if (DEDUPE_EVENTS.has(event)) {
            // Ignore the ordering/time stamps broadcastGameAction adds to scroll events
            const { _seq, _timestamp, ...content } = clean || {};
            const key = event + '|' + sender;
            const text = JSON.stringify(content);
            if (lastSync.get(key) === text) return;
            lastSync.set(key, text);
        }
        if (buffer.length >= MAX_BUFFER) buffer.shift();
        buffer.push({
            event: String(event),
            sender: Number.isInteger(sender) ? sender : null,
            payload: clean,
            at_ms: Date.now(),
        });
    }

    async function flush() {
        if (flushing || !matchId || !buffer.length) return;
        flushing = true;
        const batch = buffer.slice(0, MAX_BATCH);
        try {
            const { error } = await supabase.rpc('append_match_moves', { p_match_id: matchId, p_moves: batch });
            if (error) {
                console.warn('[match-rec] save failed:', error.message);
                if (/not authorized|match closed|no such match/.test(error.message)) {
                    reset(); // no longer the host, or the match is over
                }
            } else {
                buffer.splice(0, batch.length);
            }
        } catch (e) { /* network: keep the buffer, try again next tick */ }
        flushing = false;
        if (buffer.length >= MAX_BATCH) flush();
    }

    // Host, at game over.
    async function finish(winnerIndex, winType) {
        if (!matchId || finishing) return;
        finishing = true;
        const id = matchId;
        for (let i = 0; i < 5 && buffer.length; i++) await flush();
        try {
            const { error } = await supabase.rpc('finish_match', {
                p_match_id: id, p_winner_index: winnerIndex ?? null, p_win_type: winType || null,
            });
            if (error) console.warn('[match-rec] finish failed:', error.message);
            else log('match', id, 'finished');
        } catch (e) { /* ignore */ }
        // Keep the timer briefly so late messages (game-over echoes) still land.
        setTimeout(() => { flush().finally(reset); }, 5000);
    }

    // Leaving the game early: save what we have, then stop.
    function stop() {
        if (!matchId) { reset(); return; }
        flush().finally(reset);
    }

    // Save & quit (js/save-game.js): send everything still waiting.
    async function flushAll(maxMs = 8000) {
        const t0 = Date.now();
        while (buffer.length && Date.now() - t0 < maxMs) {
            await flush();
            if (buffer.length) await new Promise(r => setTimeout(r, 250));
        }
        return buffer.length === 0;
    }
    window.MatchRecorder = { start, adopt, record, finish, stop, flushAll,
        pending: () => buffer.length, matchId: () => matchId };
})();
