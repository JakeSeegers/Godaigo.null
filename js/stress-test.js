// Stress test (hermit only, owner 2026-10-08): how much can this browser and
// connection take? Hermit menu "Stress test". Plays bot games at Extreme
// speed with every board effect on (or off, to compare), optionally with Bot
// Mind on, for a few minutes, while js/lag-recorder.js samples the screen and
// a network probe measures the real-time connection:
//   - its own Supabase Realtime channel (broadcast self + ack): a test message
//     every 500 ms and a burst of 10 every 10 s (like a bot turn), each echoed
//     back by the server -> round trip, ack time, jitter, lost messages. Runs
//     on the same busy main thread as the game, so a round trip also shows
//     when a blocked screen handled a message late.
//   - the HTTP ping of ConnectionMonitor (in the lag samples).
// At the end: a summary with plain-words verdicts and a Download report button
// (summary + lag samples + probe numbers). Start it from the lobby only.
(function () {
    'use strict';
    let run = null;   // { opts, startedAt, endsAt, sampleStart, probe, stop }

    function isHermit() {
        try { return typeof window.isHermit === 'function' && !!window.isHermit(); } catch (e) { return false; }
    }
    function inGame() { return !!document.getElementById('game-layout')?.classList.contains('active'); }
    const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

    function box(id, html) {
        document.getElementById(id)?.remove();
        const d = document.createElement('div');
        d.id = id;
        d.style.cssText = 'position:fixed;z-index:10050;background:#141822;color:#e8ecf4;border:1px solid #4a5570;border-radius:10px;'
            + 'box-shadow:0 10px 40px #000a;font:14px/1.45 sans-serif;padding:16px 18px;max-width:min(560px,92vw);max-height:86vh;overflow:auto;';
        d.innerHTML = html;
        document.body.appendChild(d);
        return d;
    }

    // ── network probe ─────────────────────────────────────────────
    function startProbe() {
        const P = { sent: 0, recv: 0, acks: [], rtts: [], burstRtts: [], lost: 0, errors: 0, pending: new Map(), timers: [], ch: null, status: 'starting' };
        if (typeof supabase === 'undefined' || !supabase?.channel) { P.status = 'no connection'; return P; }
        const name = 'stress-' + Math.random().toString(36).slice(2, 10);
        const pad = 'x'.repeat(300);      // about the size of a typical game message
        let seq = 0;
        try {
            P.ch = supabase.channel(name, { config: { broadcast: { self: true, ack: true } } });
            P.ch.on('broadcast', { event: 'probe' }, ({ payload }) => {
                const p = P.pending.get(payload?.seq);
                if (!p) return;
                P.pending.delete(payload.seq);
                P.recv++;
                const rtt = performance.now() - p.t;
                (p.burst ? P.burstRtts : P.rtts).push(rtt);
            });
            P.ch.subscribe(status => { P.status = status; });
        } catch (e) { P.status = 'error'; P.errors++; return P; }
        const send = (burst) => {
            if (P.status !== 'SUBSCRIBED') return;
            const s = ++seq, t = performance.now();
            P.pending.set(s, { t, burst });
            P.sent++;
            P.ch.send({ type: 'broadcast', event: 'probe', payload: { seq: s, pad } })
                .then(r => { if (r === 'ok') P.acks.push(performance.now() - t); else P.errors++; })
                .catch(() => { P.errors++; });
        };
        P.timers.push(setInterval(() => send(false), 500));
        P.timers.push(setInterval(() => { for (let i = 0; i < 10; i++) send(true); }, 10000));
        // a message not back within 5 s counts as lost
        P.timers.push(setInterval(() => {
            const now = performance.now();
            for (const [k, v] of P.pending) if (now - v.t > 5000) { P.pending.delete(k); P.lost++; }
        }, 1000));
        return P;
    }
    function stopProbe(P) {
        if (!P) return;
        P.timers.forEach(clearInterval);
        try { if (P.ch) supabase.removeChannel(P.ch); } catch (e) {}
    }

    // ── stats helpers ─────────────────────────────────────────────
    const avg = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
    const pct = (a, p) => { if (!a.length) return null; const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
    const r0 = v => v == null ? null : Math.round(v);

    function summarize() {
        const rows = (window.LagRecorder?.samples?.() || []).slice(run.sampleStart);
        const P = run.probe;
        const secs = rows.length * 5 || 1;
        const sum = k => rows.reduce((n, r) => n + (r[k] || 0), 0);
        const fps = rows.map(r => r.fps).filter(v => v != null);
        const S = {
            settings: run.opts,
            minutes: +((Date.now() - run.startedAt) / 60000).toFixed(1),
            screen: {
                fpsAvg: r0(avg(fps)), fpsLow: fps.length ? Math.min(...fps) : null,
                blockedMs: sum('longMs'), blockedPct: +(100 * sum('longMs') / (secs * 1000)).toFixed(1),
                blockedDuringBotTurns: sum('longWhileBot'), worstFreezeMs: rows.reduce((m, r) => Math.max(m, r.longWorst || 0), 0),
                botThinkingMs: sum('botMs'), botDecisions: sum('botN'),
                effectsMax: rows.reduce((m, r) => Math.max(m, r.fx || 0), 0),
                boardElements: rows.length ? [rows[0].nodes, rows[rows.length - 1].nodes] : null,
                memoryMB: rows.length ? [rows[0].memMB ?? null, rows[rows.length - 1].memMB ?? null] : null,
            },
            network: P ? {
                status: P.status, sent: P.sent, received: P.recv, lost: P.lost, errors: P.errors,
                roundTripAvg: r0(avg(P.rtts)), roundTripP95: r0(pct(P.rtts, 0.95)), roundTripMax: r0(P.rtts.length ? Math.max(...P.rtts) : null),
                burstRoundTripAvg: r0(avg(P.burstRtts)), burstRoundTripMax: r0(P.burstRtts.length ? Math.max(...P.burstRtts) : null),
                serverAckAvg: r0(avg(P.acks)), serverAckP95: r0(pct(P.acks, 0.95)),
                httpPingAvg: r0(avg(rows.map(r => r.ping).filter(v => typeof v === 'number'))),
            } : null,
        };
        const v = [];
        const sc = S.screen, nw = S.network;
        if (sc.fpsAvg != null && sc.fpsAvg < 20) v.push(`Drawing struggles: ${sc.fpsAvg} frames per second on average (smooth is 30+).`);
        if (sc.blockedPct > 10) {
            const botShare = sc.blockedMs ? sc.blockedDuringBotTurns / sc.blockedMs : 0;
            v.push(`The screen was blocked ${sc.blockedPct}% of the time` + (botShare > 0.6 ? ', mostly while bots were thinking.' : ', mostly NOT from bot thinking (drawing or effects).'));
        }
        if (sc.worstFreezeMs > 1000) v.push(`Worst single freeze: ${(sc.worstFreezeMs / 1000).toFixed(1)} s.`);
        if (nw) {
            if (nw.status !== 'SUBSCRIBED' && !nw.received) v.push(`Network test could not connect (${nw.status}).`);
            if (nw.lost) v.push(`${nw.lost} of ${nw.sent} test messages were lost.`);
            if (nw.roundTripP95 != null && nw.roundTripP95 > 500) v.push(`Slow messages: 1 in 20 took over ${nw.roundTripP95} ms to come back.`);
            if (nw.roundTripP95 != null && nw.serverAckP95 != null && nw.roundTripP95 > 2 * nw.serverAckP95 + 150 && sc.blockedPct > 5)
                v.push('Messages came back late mostly because the screen was busy, not because of the network.');
        }
        // bot decisions over 1 s (bot.js saves them as lag moments)
        const since = new Date(run.startedAt).toISOString();
        S.slowDecisions = (window.LagRecorder?.moments?.() || [])
            .filter(m => m.at >= since && /^slow bot decision/.test(m.reason))
            .map(m => m.sample);
        if (S.slowDecisions.length) {
            const worst = S.slowDecisions.reduce((a, b) => (b.ms > a.ms ? b : a));
            const part = Object.entries(worst.parts || {}).sort((a, b) => b[1].ms - a[1].ms)[0];
            v.push(`${S.slowDecisions.length} bot decision(s) took over 1 s. Worst: ${(worst.ms / 1000).toFixed(1)} s in "${worst.mode || 'unknown'}" mode`
                + (part ? `, most of it in ${part[0]} (${part[1].calls} calls)` : '') + '.');
        }
        if (!v.length) v.push('No problems found: the screen stayed smooth and messages came back quickly.');
        S.verdicts = v;
        return S;
    }

    // ── run ───────────────────────────────────────────────────────
    async function start(opts) {
        if (run) return;
        if (inGame()) { alert('Leave the game first: the stress test plays its own bot games.'); return; }
        await window.LazyScripts?.load?.('bot-arena').catch(() => {});
        if (!window.BotArena?.spectate) { alert('Bot arena could not load.'); return; }
        run = { opts, startedAt: Date.now(), endsAt: Date.now() + opts.minutes * 60000, sampleStart: (window.LagRecorder?.samples?.() || []).length, probe: null, saved: {} };
        // effects on even at Extreme speed (or off, to compare)
        run.saved.fxOn = window.fxOn;
        const effectsOn = opts.effects;
        window.fxOn = () => effectsOn;
        if (opts.botMind && window.BotMind?.setEnabled) { run.saved.mind = window.BotMind.isEnabled?.(); window.BotMind.setEnabled(true); }
        if (opts.network) run.probe = startProbe();
        window.LagRecorder?.mark?.('stress test start: ' + JSON.stringify(opts));
        const status = box('stress-test-status', '');
        status.style.cssText += 'top:64px;right:16px;padding:10px 14px;';
        const tick = setInterval(() => {
            const left = Math.max(0, Math.round((run.endsAt - Date.now()) / 1000));
            const P = run.probe;
            status.innerHTML = `<b>Stress test</b> ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')} left`
                + (P ? `<br>Network: ${P.recv}/${P.sent} back, ${P.lost} lost` : '')
                + `<br><button id="stress-stop" style="margin-top:6px">Stop now</button>`;
            status.querySelector('#stress-stop').onclick = () => { run.endsAt = 0; window.BotArena.stop?.(); };
        }, 1000);
        // play games until the time is up
        while (Date.now() < run.endsAt) {
            try { await window.BotArena.spectate(opts.players, { speed: 0.1 }); } catch (e) { console.warn('[stress] game failed', e); break; }
        }
        clearInterval(tick);
        status.remove();
        // let the last 5 s sample land
        await new Promise(r => setTimeout(r, 5200));
        stopProbe(run.probe);
        window.fxOn = run.saved.fxOn;
        if (run.saved.mind !== undefined) window.BotMind.setEnabled(run.saved.mind);
        const S = summarize();
        showResults(S);
        run = null;
    }

    function showResults(S) {
        const sc = S.screen, nw = S.network;
        const f = v => (v == null ? 'n/a' : v);
        const line = (k, v) => `<tr><td style="color:#9aa6c0;padding:2px 10px 2px 0">${esc(k)}</td><td>${esc(v ?? 'n/a')}</td></tr>`;
        const d = box('stress-test-results', `
            <b style="font-size:17px;color:#9cc4ff">Stress test results</b>
            <div style="margin:6px 0 10px;color:#9aa6c0">${S.settings.players} bots, Extreme speed, effects ${S.settings.effects ? 'on' : 'off'}${S.settings.botMind ? ', Bot Mind on' : ''}, ${S.minutes} min</div>
            <ul style="margin:0 0 10px 18px;padding:0">${S.verdicts.map(v => `<li>${esc(v)}</li>`).join('')}</ul>
            <table style="border-collapse:collapse;font-size:13px">
              ${line('Frames per second (avg / lowest)', `${sc.fpsAvg} / ${sc.fpsLow}`)}
              ${line('Screen blocked', `${(sc.blockedMs / 1000).toFixed(1)} s (${sc.blockedPct}%)`)}
              ${line('  of it while bots thought', `${(sc.blockedDuringBotTurns / 1000).toFixed(1)} s`)}
              ${line('Worst freeze', `${sc.worstFreezeMs} ms`)}
              ${line('Bot thinking', `${(sc.botThinkingMs / 1000).toFixed(1)} s over ${sc.botDecisions} decisions`)}
              ${line('Most effects at once', sc.effectsMax)}
              ${line('Board elements (start / end)', sc.boardElements && sc.boardElements.join(' / '))}
              ${line('Memory MB (start / end)', sc.memoryMB && sc.memoryMB.join(' / '))}
              ${nw ? line('Test messages back / sent / lost', `${f(nw.received)} / ${f(nw.sent)} / ${f(nw.lost)}`) : ''}
              ${nw ? line('Round trip avg / 95% / max', `${f(nw.roundTripAvg)} / ${f(nw.roundTripP95)} / ${f(nw.roundTripMax)} ms`) : ''}
              ${nw ? line('Bursts (like a bot turn) avg / max', `${f(nw.burstRoundTripAvg)} / ${f(nw.burstRoundTripMax)} ms`) : ''}
              ${nw ? line('Server ack avg / 95%', `${f(nw.serverAckAvg)} / ${f(nw.serverAckP95)} ms`) : ''}
              ${nw ? line('HTTP ping avg', `${f(nw.httpPingAvg)} ms`) : ''}
            </table>
            <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap">
              <button id="stress-dl">Download report</button>
              <button id="stress-again">Run again</button>
              <button id="stress-lobby">Back to lobby</button>
            </div>`);
        d.style.cssText += 'left:50%;top:50%;transform:translate(-50%,-50%);';
        d.querySelector('#stress-dl').onclick = () => {
            const blob = new Blob([JSON.stringify({ summary: S, lag: window.LagRecorder?.export?.() || null }, null, 1)], { type: 'application/json' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = `godaigo-stress-test-${Date.now()}.json`;
            document.body.appendChild(a); a.click(); a.remove();
            setTimeout(() => URL.revokeObjectURL(a.href), 1000);
        };
        d.querySelector('#stress-again').onclick = () => { d.remove(); open(); };
        d.querySelector('#stress-lobby').onclick = () => {
            try { sessionStorage.setItem('godaigo_skip_intro_once', '1'); } catch (e) {}
            location.reload();
        };
    }

    function open() {
        if (!isHermit()) { alert('The stress test is for the hermit account.'); return; }
        const d = box('stress-test-panel', `
            <b style="font-size:17px;color:#9cc4ff">Stress test</b>
            <div style="margin:6px 0 12px;color:#9aa6c0">Bot games at Extreme speed for a few minutes while the screen and the connection are measured. Start from the lobby.</div>
            <label>Bots <select id="st-players"><option>2</option><option>3</option><option selected>4</option><option>5</option></select></label>
            &nbsp; <label>Minutes <select id="st-min"><option>1</option><option>2</option><option selected>3</option><option>5</option><option>10</option></select></label>
            <div style="margin-top:8px"><label><input type="checkbox" id="st-fx" checked> Board effects on</label></div>
            <div><label><input type="checkbox" id="st-net" checked> Network test (real-time messages to the server and back)</label></div>
            <div><label><input type="checkbox" id="st-mind"> Bot Mind on (to see what it costs)</label></div>
            <div style="margin-top:12px;display:flex;gap:8px"><button id="st-go">Start</button><button id="st-cancel">Cancel</button></div>`);
        d.style.cssText += 'left:50%;top:50%;transform:translate(-50%,-50%);';
        d.querySelector('#st-cancel').onclick = () => d.remove();
        d.querySelector('#st-go').onclick = () => {
            const opts = {
                players: +d.querySelector('#st-players').value,
                minutes: +d.querySelector('#st-min').value,
                effects: d.querySelector('#st-fx').checked,
                network: d.querySelector('#st-net').checked,
                botMind: d.querySelector('#st-mind').checked,
            };
            d.remove();
            start(opts);
        };
    }

    window.StressTest = { open, start, isRunning: () => !!run };
})();
