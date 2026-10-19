// js/bad-move.js - window.BadMove: the hermit's "Bad move" button (owner 2026-10-18).
//
// When a bot does something dumb, in a training run or a real game, the hermit
// clicks "⚑ Bad move" (or Shift+K). The game stops while a short note is typed
// (a prompt blocks the page, so no bot acts meanwhile), then one JSON file
// downloads with everything needed to understand and fix the move:
//   note, when, game version, where (training run / online / local)
//   the training game (seed, players, each seat's weights, stacked deal)
//   the board right now (BotState.snapshot, hidden info masked as for bots)
//   the bot's last decision with its options and reasons (BotMind.last, when on)
//   the active seat's weight table
//   this game's whole action log (from its gameStart) and the last 20 actions
// The report is for reading with Claude; nothing is sent anywhere.
(function () {
    'use strict';

    const isHermit = () => typeof window.isHermit === 'function' && window.isHermit();
    const inGame = () => !!document.getElementById('game-layout')?.classList.contains('active')
        || !!window.BotArena?.isRunning?.();

    let btn = null;
    function ensureButton() {
        if (btn || !document.body) return;
        btn = document.createElement('button');
        btn.id = 'bad-move-btn';
        btn.textContent = '⚑ Bad move';
        btn.title = 'A bot just did something dumb: type a note and download this game\'s report (Shift+K)';
        Object.assign(btn.style, {
            position: 'fixed', left: '10px', bottom: '42px', zIndex: '10085', display: 'none',
            background: '#3a1f24', color: '#ffb3b3', border: '1px solid #7a3a44', borderRadius: '8px',
            padding: '5px 11px', font: '600 12.5px system-ui, sans-serif', cursor: 'pointer',
            boxShadow: '0 2px 10px rgba(0,0,0,.5)',
        });
        btn.addEventListener('click', report);
        document.body.appendChild(btn);
    }
    setInterval(() => {
        ensureButton();
        if (btn) btn.style.display = (isHermit() && inGame()) ? 'block' : 'none';
    }, 1000);

    document.addEventListener('keydown', (e) => {
        if (!e.shiftKey || e.ctrlKey || e.metaKey || e.altKey || (e.key !== 'K' && e.key !== 'k')) return;
        const tag = document.activeElement?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || document.activeElement?.isContentEditable) return;
        if (!isHermit() || !inGame()) return;
        e.preventDefault();
        report();
    });

    const safe = (fn, fallback = null) => { try { const v = fn(); return v === undefined ? fallback : v; } catch (e) { return fallback; } };
    const noNet = (w) => (w ? Object.fromEntries(Object.entries(w).filter(([k]) => k !== 'net')) : null);

    function thisGameLog() {
        const all = safe(() => window.ActionLog.entries(), []) || [];
        let start = 0;
        for (let i = all.length - 1; i >= 0; i--) if (all[i]?.type === 'gameStart') { start = i; break; }
        const game = all.slice(start);
        return game.length > 6000 ? game.slice(-6000) : game;
    }

    function report() {
        if (!isHermit()) return;
        const note = window.prompt('What did the bot do wrong? A few words help, for example "kept a useless scroll" or "walked away from its shrine".', '');
        if (note === null) return;   // cancelled
        const training = !!safe(() => window.BotArena?.isRunning?.(), false);
        const active = safe(() => activePlayerIndex);
        const log = thisGameLog();
        const data = {
            kind: 'godaigo-bad-move',
            note: note.trim(),
            at: new Date().toISOString(),
            version: window.GAME_VERSION || null,
            where: training ? 'training run' : (safe(() => isMultiplayer) ? 'online game' : 'local game'),
            turn: safe(() => currentTurnNumber),
            activeSeat: active,
            activeIsBot: safe(() => window.BotDriver?.isBotSeat?.(active)),
            training: training ? {
                match: safe(() => window.__arenaMatch),
                challengerSeat: safe(() => window.BotArena.markedSeat?.()),
                speed: safe(() => window.BotSystem.speedScale),
            } : null,
            players: safe(() => (Array.isArray(allPlayersData) ? allPlayersData.map(p => ({ index: p.player_index, username: p.username })) : null)),
            board: safe(() => window.BotState.snapshot()),
            botThought: safe(() => window.BotMind?.last?.()),
            botMindOn: safe(() => window.BotMind?.isEnabled?.(), false),
            activeWeights: safe(() => noNet({ ...window.BotSystem.WEIGHTS })),
            lastActions: log.slice(-20),
            gameLog: log,
        };
        let text;
        try { text = JSON.stringify(data, null, 1); } catch (e) { alert('Could not build the report: ' + e.message); return; }
        const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16);
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
        a.download = `godaigo-bad-move-${stamp}.json`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 2000);
        console.log(`⚑ [BadMove] report saved: "${data.note}" (${log.length} actions, turn ${data.turn})`);
        if (btn) { const old = btn.textContent; btn.textContent = '⚑ Saved'; setTimeout(() => { btn.textContent = old; }, 1500); }
    }

    window.BadMove = { report };
})();
