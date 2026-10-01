// stream-votes.js: Twitch chat votes on what the bots do (window.StreamVotes).
// Design: docs/twitch-votes.md.
//
// The streamer turns on "Stream mode" (lobby "Stream" button) and types their
// Twitch channel. This browser then reads that channel's chat anonymously
// (Twitch IRC over WebSocket, no app, no login, nothing is ever sent to chat).
// When this browser HOSTS an online game with bots:
//   * the bot seats become "Twitchbot (<element bot>)": one leaderboard bot,
//     Twitchbot (deployed_bots row, sql/stream-games.sql). Rewards as normal.
//   * mood vote, about once a round: chat picks a bot's mood for its next
//     turns: Rush home / Block the leader / Pick on <player>
//     (BotDiplomacy.setMood: changes how hard the bot pushes on each player).
//   * cast vote, at most once per bot turn: when a bot has 2+ good casts,
//     chat picks one (words from BotSystem.explain) or "Let <bot> decide".
//     The pick goes to BotSystem.setNextChoice and the bot casts it.
// Votes are typed in chat as !1 !2 !3 (or 1 2 3): one vote per viewer, the
// last one counts. No votes or a tie = the bot decides.
// The host broadcasts 'stream-vote' messages, so every player (and replays)
// sees the vote box and the result line in the Game Log. Vote time is given
// back to the turn timer. Never runs in the arena, training, replays or the
// tutorial.
(function () {
    'use strict';

    const KEY = 'godaigo_stream';
    const DEFAULTS = { on: false, channel: '', secs: 20, cast: true, mood: true };
    const SPRITE_CHAT = 48;            // Gibberish: the Twitch / chat icon
    const TWITCHBOT = 'Twitchbot';

    // lobby.js / game-core.js keep these in script-level bindings.
    const S = {
        get isMultiplayer() { try { return isMultiplayer; } catch (e) { return false; } },
        get isHost() { try { return isHost; } catch (e) { return false; } },
        get currentGameId() { try { return currentGameId; } catch (e) { return null; } },
        get currentTurnNumber() { try { return currentTurnNumber; } catch (e) { return 0; } },
        get activePlayerIndex() { try { return activePlayerIndex; } catch (e) { return null; } },
        get allPlayersData() { try { return allPlayersData; } catch (e) { return []; } },
        get playerPositions() { try { return playerPositions; } catch (e) { return []; } },
        get supabase() { try { return supabase; } catch (e) { return null; } },
    };
    const log = (...a) => console.log('[StreamVotes]', ...a);
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const esc = (t) => String(t ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const sprite = (i, s) => window.emojiSystem?.spriteHtml?.(i, s) || '';
    const now = () => (typeof window.serverNow === 'function' ? window.serverNow() : Date.now());

    // ------------------------------------------------------------ settings
    function load() {
        try { return Object.assign({}, DEFAULTS, JSON.parse(localStorage.getItem(KEY) || '{}')); }
        catch (e) { return Object.assign({}, DEFAULTS); }
    }
    let cfg = load();
    function save() { try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch (e) {} }
    const cleanChannel = (c) => String(c || '').trim().toLowerCase().replace(/^https?:\/\/(www\.)?twitch\.tv\//, '').replace(/^#/, '').replace(/[^a-z0-9_]/g, '').slice(0, 25);
    const voteMs = () => Math.max(10, Math.min(45, Number(cfg.secs) || 20)) * 1000;

    // ------------------------------------------------------------ Twitch chat
    // Anonymous read-only login: Twitch accepts any "justinfan<number>" nick.
    let ws = null, wsState = 'off', wsChannel = null, retry = 0, retryTimer = null;
    let chatLines = 0, fakeMode = false;
    const listeners = new Set();
    function setState(s) { wsState = s; renderPanelStatus(); }

    function connect() {
        clearTimeout(retryTimer);
        const chan = cleanChannel(cfg.channel);
        if (!cfg.on || chan.length < 3) { disconnect(); return; }
        if (ws && wsChannel === chan) return;
        disconnect();
        wsChannel = chan;
        let sock;
        try { sock = new WebSocket('wss://irc-ws.chat.twitch.tv:443'); } catch (e) { setState('error'); return; }
        ws = sock;
        setState('connecting');
        sock.onopen = () => {
            sock.send('CAP REQ :twitch.tv/tags');
            sock.send('PASS SCHMOOPIIE');
            sock.send('NICK justinfan' + (10000 + Math.floor(Math.random() * 80000)));
            sock.send('JOIN #' + chan);
        };
        sock.onmessage = (e) => {
            for (const line of String(e.data).split('\r\n')) {
                if (!line) continue;
                if (line.startsWith('PING')) { try { sock.send('PONG :tmi.twitch.tv'); } catch (err) {} continue; }
                if (/ 366 /.test(line) || line.includes(' JOIN #' + chan)) { retry = 0; setState('connected'); continue; }
                const m = line.match(/^(?:@(\S+) )?:(\w+)!\S+ PRIVMSG #\w+ :(.*)$/);
                if (!m) continue;
                const tags = {};
                for (const kv of (m[1] || '').split(';')) { const i = kv.indexOf('='); if (i > 0) tags[kv.slice(0, i)] = kv.slice(i + 1); }
                onChat(tags['user-id'] || m[2], tags['display-name'] || m[2], m[3]);
            }
        };
        sock.onclose = () => {
            if (ws !== sock) return;
            ws = null;
            setState(cfg.on ? 'reconnecting' : 'off');
            if (cfg.on) retryTimer = setTimeout(connect, Math.min(30000, 2000 * 2 ** retry++));
        };
        sock.onerror = () => { try { sock.close(); } catch (e) {} };
    }
    function disconnect() {
        clearTimeout(retryTimer);
        const sock = ws;
        ws = null; wsChannel = null;
        if (sock) { try { sock.close(); } catch (e) {} }
        setState('off');
    }

    function onChat(user, name, text) {
        chatLines++;
        for (const fn of listeners) { try { fn({ user, name, text }); } catch (e) {} }
        const m = String(text).trim().match(/^!?([1-9])\b/);
        if (!m || !vote) return;
        const n = Number(m[1]) - 1;
        if (n < vote.options.length) vote.ballots.set(String(user), n);
    }

    // ------------------------------------------------------------ when it runs
    let streamGameId = null;           // the game this host started in stream mode
    const inGame = () => !!document.getElementById('game-layout')?.classList.contains('active');
    function arenaRunning() {
        const A = window.BotArena;
        return !!(A && (A.isRunning?.() || A.isEvolving?.() || A.isClimbing?.() || A.isSpectating?.()));
    }
    function chatReady() { return fakeMode || wsState === 'connected'; }
    function active() {
        return !!cfg.on && chatReady() && inGame() && S.isMultiplayer && S.isHost &&
            streamGameId != null && streamGameId === S.currentGameId &&
            !window.Replay?.state && !window.isTutorialMode && !arenaRunning();
    }

    // ------------------------------------------------------------ names
    function seatRow(i) { return (S.allPlayersData || []).find(p => p.player_index === i) || null; }
    function nameOf(i) {
        const u = seatRow(i)?.username;
        if (u) return String(u).replace(/^🤖\s*/u, '');
        try { return typeof getPlayerColorName === 'function' ? getPlayerColorName(i) : 'Player ' + (i + 1); } catch (e) { return 'Player ' + (i + 1); }
    }
    function colorOf(i) {
        const c = S.playerPositions?.[i]?.color;
        if (typeof c === 'string' && c.startsWith('#')) return c;
        const name = seatRow(i)?.color;
        try { return (name && typeof PLAYER_COLORS !== 'undefined' && PLAYER_COLORS[name]) || '#ccc'; } catch (e) { return '#ccc'; }
    }
    // Short name for a Twitchbot seat: "Twitchbot (Emberkin)" -> "Emberkin".
    function shortBot(i) {
        const n = nameOf(i);
        const m = n.match(/^Twitchbot \((.+)\)$/);
        return m ? m[1] : n;
    }

    // ------------------------------------------------------------ the vote box
    // Same drawing for the host (live) and every other player / replay (remote).
    function render(p) {
        if (!p) { document.getElementById('stream-vote-box')?.remove(); return; }
        let box = document.getElementById('stream-vote-box');
        if (!box) {
            box = document.createElement('div');
            box.id = 'stream-vote-box';
            document.body.appendChild(box);
        }
        const counts = p.counts || [];
        const total = counts.reduce((a, b) => a + b, 0);
        const rows = (p.options || []).map((o, i) => {
            const c = counts[i] || 0;
            const pct = total ? Math.round(100 * c / total) : 0;
            const won = p.phase === 'close' && p.winner === i;
            return `<div class="sv-opt${won ? ' sv-won' : ''}">
                <span class="sv-num">!${i + 1}</span>
                <span class="sv-label">${esc(o)}</span>
                <span class="sv-count">${c}</span>
                <span class="sv-bar" style="width:${pct}%"></span>
            </div>`;
        }).join('');
        const left = Math.max(0, Math.ceil(((p.endsAt || 0) - now()) / 1000));
        const foot = p.phase === 'close'
            ? (p.winner == null ? `No clear winner: ${esc(p.botName)} decides.` : `Chat chose !${p.winner + 1} (${counts[p.winner] || 0} of ${total} votes)`)
            : `Type <b>!1</b>, <b>!2</b> or <b>!3</b> in chat. ${left} s left`;
        box.className = p.phase === 'close' ? 'sv-closed' : '';
        box.dataset.id = p.id || '';
        box.innerHTML = `
            <div class="sv-head">${sprite(SPRITE_CHAT, 0.7)} <span>Chat vote for</span>
                <b style="color:${esc(p.botColor || '#ccc')}">${esc(p.botName || '')}</b></div>
            <div class="sv-title">${esc(p.title)}</div>
            ${rows}
            <div class="sv-foot">${foot}</div>
            ${p.phase !== 'close' ? `<div class="sv-timer"><span style="width:${Math.max(0, Math.min(100, 100 * ((p.endsAt || 0) - now()) / (p.ms || 20000)))}%"></span></div>` : ''}`;
        clearTimeout(box._hide);
        if (p.phase === 'close') box._hide = setTimeout(() => { if (document.getElementById('stream-vote-box') === box) box.remove(); }, 5000);
    }

    // Game Log line for the result (host: at once; others: on the close message).
    function logResult(p) {
        if (p.phase !== 'close' || !p.logText) return;
        window.ActionLog?.record?.('botTalk', { text: p.logText }, p.bot);
    }

    function broadcast(p) {
        if (!S.isMultiplayer || typeof broadcastGameAction !== 'function') return;
        try { broadcastGameAction('stream-vote', p); } catch (e) {}
    }

    let vote = null, voteSeq = 0;
    // Runs one vote; resolves { winner: index or null, counts, total }.
    async function runVote(bot, title, options, resultText) {
        const ms = voteMs();
        const t0 = Date.now();
        vote = { id: `${Date.now()}-${++voteSeq}`, options, ballots: new Map() };
        const base = { id: vote.id, bot, botName: nameOf(bot), botColor: colorOf(bot), title, options, ms, endsAt: now() + ms };
        const tally = () => { const c = options.map(() => 0); for (const n of vote.ballots.values()) c[n]++; return c; };
        let p = { ...base, phase: 'open', counts: tally() };
        render(p); broadcast(p);
        if (typeof updateStatus === 'function') updateStatus('Chat is voting...');
        let lastSent = Date.now();
        while (Date.now() - t0 < ms) {
            await sleep(250);
            if (!inGame() || S.activePlayerIndex !== bot) { log('vote stopped early: turn moved on'); break; }
            p = { ...base, phase: 'tick', counts: tally() };
            render(p);
            if (Date.now() - lastSent >= 2000) { lastSent = Date.now(); broadcast(p); }
        }
        const counts = tally();
        log(`vote "${title}" ran ${Math.round((Date.now() - t0) / 1000)} s`);
        const total = counts.reduce((a, b) => a + b, 0);
        const best = Math.max(...counts);
        const tops = counts.map((c, i) => (c === best ? i : -1)).filter(i => i >= 0);
        const winner = total > 0 && tops.length === 1 ? tops[0] : null;
        vote = null;
        // Give the vote time back to the turn timer (host enforces it, game-core.js).
        try { if (turnStartedAtMs) turnStartedAtMs += Date.now() - t0; } catch (e) {}
        p = { ...base, phase: 'close', counts, winner, logText: resultText(winner, counts, total) };
        render(p); broadcast(p); logResult(p);
        stats.votes++; stats.voters += total;
        return { winner, counts, total };
    }

    // ------------------------------------------------------------ mood vote
    let lastMoodTurn = -99, moodRot = 0;
    const moodAt = {};               // bot seat -> turn of its last mood vote
    const moodSprite = (k) => ({ rush: 88, block: 79, pick: 15 }[k]); // Going Up, Crown, Bullseye
    // Only bot seats: a human seat on autopilot (test games) is never voted on.
    const isBotSeat = (idx) => !!window.BotDriver?.isBot?.(idx);
    async function beforeTurn(idx) {
        if (!active() || !cfg.mood || !window.BotDiplomacy?.setMood || !isBotSeat(idx)) return;
        const turn = S.currentTurnNumber || 0;
        const seats = (S.allPlayersData || []).length || 2;
        if (turn - lastMoodTurn < seats) return;          // about once a round
        // Bots take turns: the one that had a mood vote longest ago goes next.
        const bots = [...(window.BotDriver?.botIndices?.() || [])].sort((a, b) => a - b);
        const due = bots.reduce((best, j) => (best == null || (moodAt[j] ?? -1) < (moodAt[best] ?? -1) ? j : best), null);
        if (due != null && due !== idx) return;
        moodAt[idx] = turn;
        const others = (S.allPlayersData || []).map(p => p.player_index)
            .filter(j => typeof j === 'number' && j !== idx).sort((a, b) => a - b);
        if (!others.length) return;
        lastMoodTurn = turn;
        const target = others[moodRot++ % others.length];
        const who = shortBot(idx);
        const options = ['Rush home: race for its own elements', 'Block the leader', `Pick on ${nameOf(target)}`];
        const kinds = ['rush', 'block', 'pick'];
        const res = await runVote(idx, `What mood is ${who} in?`, options, (w) =>
            w == null ? `Chat could not agree on a mood for {p${idx}}.`
                      : `Chat set {p${idx}}'s mood: ${w === 2 ? `pick on {p${target}}` : options[w].split(':')[0].toLowerCase()}.`);
        if (res.winner == null) { window.BotDiplomacy.setMood(idx, null); return; }
        const kind = kinds[res.winner];
        window.BotDiplomacy.setMood(idx, kind, kind === 'pick' ? target : null);
        try { window.emojiSystem?.showEmojiOverPawn?.(idx, '', false, [moodSprite(kind)]); } catch (e) {}
    }

    // ------------------------------------------------------------ cast vote
    const castVotedTurn = {};
    // The two best casts that read differently (same words = same choice for chat).
    function castOptions(snap) {
        let ranked = [];
        try { ranked = window.BotSystem.rank() || []; } catch (e) { return []; }
        const seen = new Set(), out = [];
        for (const r of ranked) {
            if (!r || r.action?.type !== 'cast' || !(r.score > 0)) continue;
            let words = '';
            try { words = window.BotSystem.explain(r.action, snap) || ''; } catch (e) {}
            words = words || ('Cast ' + r.action.scroll);
            if (seen.has(words)) continue;
            seen.add(words);
            out.push({ action: r.action, words });
            if (out.length === 2) break;
        }
        return out;
    }
    async function beforeAct(idx) {
        if (!active() || !cfg.cast || !window.BotSystem?.setNextChoice || !isBotSeat(idx)) return;
        const turn = S.currentTurnNumber || 0;
        if (castVotedTurn[idx] === turn) return;
        let snap = null;
        try { snap = window.BotState.snapshot(); } catch (e) { return; }
        const opts = castOptions(snap);
        if (opts.length < 2) return;
        castVotedTurn[idx] = turn;
        const words = opts.map(o => o.words);
        const who = shortBot(idx);
        const options = [words[0], words[1], `Let ${who} decide`];
        const res = await runVote(idx, `What should ${who} cast?`, options, (w) =>
            w == null || w === 2 ? `Chat let {p${idx}} decide what to cast.` : `Chat chose for {p${idx}}: ${words[w]}.`);
        if (res.winner === 0 || res.winner === 1) window.BotSystem.setNextChoice(idx, opts[res.winner].action);
    }

    // ------------------------------------------------------------ host start (lobby.js)
    let twitchbotId = null;
    async function resolveTwitchbot() {
        if (twitchbotId != null) return twitchbotId;
        try {
            const { data } = await S.supabase.from('deployed_bots').select('id').is('owner', null).eq('nickname', TWITCHBOT).maybeSingle();
            if (data?.id != null) twitchbotId = data.id;
        } catch (e) {}
        return twitchbotId;
    }
    // Called by hostStartGame before the game starts. Returns true when this
    // game is a stream game (bots become Twitchbots).
    async function prepareHostedGame(roomId) {
        const on = !!cfg.on && cleanChannel(cfg.channel).length >= 3;
        streamGameId = on ? roomId : null;
        lastMoodTurn = -99; moodRot = 0;
        for (const k in moodAt) delete moodAt[k];
        for (const k in castVotedTurn) delete castVotedTurn[k];
        try { await S.supabase.from('game_room').update({ stream_mode: on }).eq('id', roomId); } catch (e) {}
        if (on) { connect(); await resolveTwitchbot(); }
        return on;
    }
    // "🤖 Twitchbot (Emberkin)" for a bot seat that would be "🤖 Emberkin".
    function botSeatName(elementName) {
        const short = String(elementName || '').replace(/^The\s+/i, '');
        return `${window.BOT_USERNAME_PREFIX || '🤖'} ${TWITCHBOT} (${short})`;
    }

    // ------------------------------------------------------------ remote (other players, replays)
    function onRemote(p) {
        if (!p || typeof p !== 'object' || !Array.isArray(p.options) || p.options.length > 5) return;
        if (S.isHost && vote && p.id === vote.id) return;   // our own echo
        render(p);
        logResult(p);
    }

    // ------------------------------------------------------------ settings panel
    const stats = { votes: 0, voters: 0 };
    function renderPanelStatus() {
        const el = document.getElementById('stream-status');
        if (!el) return;
        const txt = { off: 'Not connected', connecting: 'Connecting...', connected: `Connected to #${wsChannel || ''}`, reconnecting: 'Lost the connection, trying again...', error: 'Could not connect' }[wsState] || wsState;
        el.textContent = txt + (wsState === 'connected' ? ` (${chatLines} chat lines seen)` : '');
        el.className = 'stream-status stream-' + wsState;
    }
    let statusTimer = null;
    function openPanel() {
        document.getElementById('stream-overlay')?.remove();
        const o = document.createElement('div');
        o.id = 'stream-overlay';
        o.innerHTML = `
            <div class="changelog-modal" role="dialog" aria-label="Stream mode">
                <div class="changelog-title">${sprite(SPRITE_CHAT, 0.8)} Stream Mode</div>
                <div class="changelog-body stream-body">
                    <p>Streaming on Twitch? Let your chat vote on what the bots do. Host a game with bots
                    (Quick Play works): every bot becomes a <b>Twitchbot</b>, and chat types <b>!1</b>, <b>!2</b> or <b>!3</b>
                    to pick a bot's mood or which scroll it casts. Twitchbots win and lose on the leaderboard as one bot.</p>
                    <label class="stream-row"><input type="checkbox" id="stream-on"> Stream mode on</label>
                    <label class="stream-row">Twitch channel <input type="text" id="stream-channel" placeholder="your_channel" maxlength="40"></label>
                    <label class="stream-row">Vote time <input type="number" id="stream-secs" min="10" max="45" step="5"> seconds</label>
                    <label class="stream-row"><input type="checkbox" id="stream-mood"> Mood votes (about once a round)</label>
                    <label class="stream-row"><input type="checkbox" id="stream-cast"> Cast votes (when a bot has 2 good casts)</label>
                    <div id="stream-status" class="stream-status"></div>
                    <p class="stream-note">Only reads chat. Nothing is posted to your channel and no Twitch login is needed.
                    Bot turns wait while chat votes; the turn timer gets that time back.</p>
                </div>
                <button class="changelog-close">Close</button>
            </div>`;
        document.body.appendChild(o);
        const $ = (id) => o.querySelector('#' + id);
        $('stream-on').checked = !!cfg.on;
        $('stream-channel').value = cfg.channel || '';
        $('stream-secs').value = cfg.secs;
        $('stream-mood').checked = !!cfg.mood;
        $('stream-cast').checked = !!cfg.cast;
        const apply = () => {
            cfg.on = $('stream-on').checked;
            cfg.channel = cleanChannel($('stream-channel').value);
            cfg.secs = Math.max(10, Math.min(45, Number($('stream-secs').value) || 20));
            cfg.mood = $('stream-mood').checked;
            cfg.cast = $('stream-cast').checked;
            save();
            connect();
            updateLobbyButton();
        };
        o.querySelectorAll('input').forEach(i => i.addEventListener('change', apply));
        const close = () => { clearInterval(statusTimer); o.remove(); };
        o.addEventListener('click', ev => { if (ev.target === o) close(); });
        o.querySelector('.changelog-close').addEventListener('click', close);
        renderPanelStatus();
        clearInterval(statusTimer);
        statusTimer = setInterval(renderPanelStatus, 1000);
    }
    function updateLobbyButton() {
        const b = document.getElementById('stream-btn');
        if (b) b.classList.toggle('stream-btn-on', !!cfg.on);
    }

    // Waiting room: the host sees that stream mode is on.
    function waitingRoomTick() {
        const panel = document.getElementById('waiting-room-panel');
        const visible = panel && panel.style.display !== 'none' && panel.offsetParent !== null;
        let b = document.getElementById('stream-room-banner');
        if (!visible || !S.isHost || !cfg.on || cleanChannel(cfg.channel).length < 3) { b?.remove(); return; }
        if (!b) {
            b = document.createElement('div');
            b.id = 'stream-room-banner';
            b.className = 'stream-room-banner';
            const info = document.getElementById('room-info-bar');
            if (info && info.parentNode) info.parentNode.insertBefore(b, info.nextSibling); else panel.appendChild(b);
        }
        const st = wsState === 'connected' ? 'chat connected' : 'chat not connected yet';
        const html = `${sprite(SPRITE_CHAT, 0.6)} <b>Stream game</b> (#${esc(cleanChannel(cfg.channel))}, ${st}): bots become Twitchbots and chat votes on what they do.`;
        if (b.innerHTML !== html) b.innerHTML = html;
    }

    setInterval(() => { try { waitingRoomTick(); } catch (e) {} }, 1000);
    document.addEventListener('DOMContentLoaded', () => { updateLobbyButton(); if (cfg.on) connect(); });
    if (document.readyState !== 'loading') { updateLobbyButton(); if (cfg.on) connect(); }

    window.StreamVotes = {
        active, beforeTurn, beforeAct, onRemote, openPanel,
        prepareHostedGame, botSeatName, resolveTwitchbot,
        isOn: () => !!cfg.on && cleanChannel(cfg.channel).length >= 3,
        settings: () => ({ ...cfg }), state: () => wsState, stats: () => ({ ...stats, chatLines }),
        onChat: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
        // Tests: fake chat without Twitch. fakeChat(true) = pretend connected;
        // fakeChat(['!1', '!2'], 'user') = those chat lines from users.
        fakeChat(lines, user) {
            if (lines === true || lines === false) { fakeMode = lines; return; }
            (lines || []).forEach((t, i) => onChat((user || 'u') + i, (user || 'u') + i, t));
        },
        _setGame: (id) => { streamGameId = id; },
        _set: (o) => { Object.assign(cfg, o); save(); },
    };
})();
