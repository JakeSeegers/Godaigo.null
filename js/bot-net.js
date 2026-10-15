// js/bot-net.js - window.BotNet: the bot network (owner 2026-10-13, step 2).
//
// A small network that ADDS a correction to the bot's own position score
// (bot.js evaluateSnapshot). It never replaces the weighted sum: with no
// network, or WEIGHTS.netWeight 0, the bots play exactly as before.
//
// Data: position_samples (sql/position-samples.sql), from bot arena games
// (bot-arena.js) and replays of real games (replay-viewer.js runMine), every
// device and account. Each row: 50 board facts (BotTerms.features), the
// weighted-sum score there (eval) and how the game ended for that seat.
//
// Model: chance to win = sigmoid(a * eval/1000 + b + net(features)).
// a and b are fitted first (the weighted sum alone = the baseline); the
// network then learns only what the weighted sum misses. As a score
// correction: net(features) * 1000 / a eval units, clipped to +-CLIP.
//
// Stored inside the weight table as WEIGHTS.net (with WEIGHTS.netWeight, 1
// = full strength), so it travels with the champion to every device. A
// network gets in only like any challenger: sent to the shared idle pool
// (kind 'net', sql/bot-net.sql) and promoted by beating the champion.
//
// Hermit menu "Bot Network": load positions, train, compare with the
// weighted sum on games held out, quick arena test, send to idle training.
(function () {
    'use strict';

    const HIDDEN = 8;
    // Max correction in eval units (owner 2026-10-14: smaller limit). One move
    // changes the weighted sum by about 2-15 points, so a limit of 2000 let the
    // net overrule every move choice. A net carries its own limit (net.clip);
    // older nets without one use this default.
    // Tested 2026-10-14 (30 games each vs the champion): 5 -> 13-15-2, 20 -> 13-15-2,
    // 60 -> 16-13-1, 2000 -> 4-14-2.
    const CLIP = 60;
    const EV_SCALE = 1000;      // eval / 1000 goes into the baseline
    const EV_CLIP = 20;
    const sigmoid = z => 1 / (1 + Math.exp(-z));
    const evIn = ev => Math.max(-EV_CLIP, Math.min(EV_CLIP, (+ev || 0) / EV_SCALE));

    function log(...a) { console.log('🕸️ [BotNet]', ...a); }

    // ── Forward pass ──────────────────────────────────────────────
    // Hidden layer cached per net object (arrays rebuilt once).
    function prep(net) {
        if (net._p) return net._p;
        const n = net.mean.length, h = net.b1.length;
        net._p = { n, h, W1: Float64Array.from(net.W1), b1: Float64Array.from(net.b1), W2: Float64Array.from(net.W2),
            mean: Float64Array.from(net.mean), inv: Float64Array.from(net.std.map(s => 1 / (s || 1))), hid: new Float64Array(h) };
        return net._p;
    }
    function netOut(net, f) {
        const P = prep(net);
        let out = net.b2 || 0;
        for (let j = 0; j < P.h; j++) {
            let s = P.b1[j];
            const row = j * P.n;
            for (let k = 0; k < P.n; k++) s += P.W1[row + k] * ((f[k] - P.mean[k]) * P.inv[k]);
            out += P.W2[j] * Math.tanh(s);
        }
        return out;
    }
    // Correction in eval units for seat i (0 when the net does not fit the features).
    function correction(snap, i, net) {
        if (!net || net.v !== window.BotTerms?.FEATURE_VERSION || !(net.a > 0.01)) return 0;
        const f = window.BotTerms.features(snap, i);
        if (!f || f.length !== net.mean.length) return 0;
        const c = netOut(net, f) * EV_SCALE / net.a;
        const lim = net.clip > 0 ? net.clip : CLIP;
        return Number.isFinite(c) ? Math.max(-lim, Math.min(lim, c)) : 0;
    }

    // ── Training ─────────────────────────────────────────────────
    // rows: [{f, ev, result, game, seat}] in game order. Split by game (20%
    // held out), fit the baseline, then the network with Adam on cross-entropy.
    // Learning from moves (owner 2026-10-14, TD(lambda) like TD-Gammon): rows of
    // one seat in one game form a chain; each position's target mixes the
    // network's own value of the NEXT position with the final result
    // (G = (1 - lambda) * V(next) + lambda * G(next), last = result), recomputed
    // every round. So a move gets credit for the position it leads to, not only
    // for the winner 30 turns later. opts.lambda 1 = plain "learn from results".
    // Soft labels (0.5 = no winner) are fine for cross-entropy.
    function rng(seed) { let t = seed >>> 0; return () => { t += 0x6D2B79F5; let r = Math.imul(t ^ (t >>> 15), 1 | t); r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r; return ((r ^ (r >>> 14)) >>> 0) / 4294967296; }; }
    const bce = (p, y) => { p = Math.min(1 - 1e-6, Math.max(1e-6, p)); return -(y * Math.log(p) + (1 - y) * Math.log(1 - p)); };

    async function train(rows, opts = {}) {
        const R = rng(opts.seed || 12345);
        const epochs = opts.epochs || 40, lr = opts.lr || 0.003, l2 = opts.l2 ?? 3e-3;
        const onProgress = opts.onProgress || (() => {});
        const games = [...new Set(rows.map(r => r.game))];
        const testGames = new Set(games.filter(() => R() < 0.2));
        if (!testGames.size && games.length > 1) testGames.add(games[0]);
        const tr = rows.filter(r => !testGames.has(r.game)), te = rows.filter(r => testGames.has(r.game));
        if (tr.length < 50 || te.length < 10) throw new Error(`not enough data (${rows.length} positions in ${games.length} games)`);
        const n = tr[0].f.length;
        const lambda = opts.lambda ?? 0.7;
        // Chains: next row of the same seat in the same game (-1 = last).
        const next = new Int32Array(tr.length).fill(-1), last = new Map();
        for (let i = tr.length - 1; i >= 0; i--) {
            const key = tr[i].game + '|' + (tr[i].seat ?? '');
            if (last.has(key)) next[i] = last.get(key);
            last.set(key, i);
        }

        // Baseline: p = sigmoid(a * ev + b).
        let a = 0.5, b = 0;
        for (let it = 0; it < 300; it++) {
            let ga = 0, gb = 0;
            for (const r of tr) { const x = evIn(r.ev), e = sigmoid(a * x + b) - r.result; ga += e * x; gb += e; }
            a -= 0.5 * ga / tr.length; b -= 0.5 * gb / tr.length;
        }
        if (!(a > 0.01)) a = 0.01;   // the weighted sum must point the right way

        // Feature scaling from training rows.
        const mean = new Array(n).fill(0), std = new Array(n).fill(0);
        for (const r of tr) for (let k = 0; k < n; k++) mean[k] += r.f[k] / tr.length;
        for (const r of tr) for (let k = 0; k < n; k++) std[k] += (r.f[k] - mean[k]) ** 2 / tr.length;
        for (let k = 0; k < n; k++) std[k] = Math.sqrt(std[k]) || 1;

        // Small random first layer, zero output layer: training starts at "no correction".
        const H = opts.hidden || HIDDEN;
        const W1 = Array.from({ length: H * n }, () => (R() * 2 - 1) * Math.sqrt(1 / n));
        const b1 = new Array(H).fill(0), W2 = new Array(H).fill(0);
        let b2 = 0;
        const params = [W1, b1, W2];
        const m1 = params.map(p => new Float64Array(p.length)), v1 = params.map(p => new Float64Array(p.length));
        let mB = 0, vB = 0, step = 0;
        const X = tr.map(r => r.f.map((x, k) => (x - mean[k]) / std[k]));
        const base = tr.map(r => a * evIn(r.ev) + b);
        const hid = new Float64Array(H), gW1 = new Float64Array(H * n), gb1 = new Float64Array(H), gW2 = new Float64Array(H);
        const batch = 64;

        const evalSet = (set) => {
            const net = { v: 0, mean, std, W1, b1, W2, b2, a };
            delete net._p;
            let lossBase = 0, lossNet = 0, okBase = 0, okNet = 0, decided = 0;
            for (const r of set) {
                const z0 = a * evIn(r.ev) + b, p0 = sigmoid(z0), p1 = sigmoid(z0 + netOut(net, r.f));
                lossBase += bce(p0, r.result); lossNet += bce(p1, r.result);
                if (r.result === 0 || r.result === 1) { decided++; okBase += (p0 >= 0.5) === (r.result === 1); okNet += (p1 >= 0.5) === (r.result === 1); }
            }
            return { lossBase: lossBase / set.length, lossNet: lossNet / set.length, accBase: decided ? okBase / decided : null, accNet: decided ? okNet / decided : null };
        };

        // TD targets from the current network (values of every training row).
        const target = new Float64Array(tr.length);
        const fillTargets = () => {
            if (lambda >= 1) { for (let i = 0; i < tr.length; i++) target[i] = tr[i].result; return; }
            const net = { mean, std, W1, b1, W2, b2 };
            const V = tr.map((r, i) => sigmoid(base[i] + netOut(net, r.f)));
            for (let i = tr.length - 1; i >= 0; i--) {
                const j = next[i];
                target[i] = j < 0 ? tr[i].result : (1 - lambda) * V[j] + lambda * target[j];
            }
        };

        let best = null;
        const order = tr.map((_, i) => i);
        for (let ep = 0; ep < epochs; ep++) {
            fillTargets();
            for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(R() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
            for (let s = 0; s < order.length; s += batch) {
                gW1.fill(0); gb1.fill(0); gW2.fill(0);
                let gB = 0;
                const end = Math.min(order.length, s + batch), m = end - s;
                for (let q = s; q < end; q++) {
                    const i = order[q], x = X[i];
                    let out = b2;
                    for (let j = 0; j < H; j++) {
                        let z = b1[j]; const row = j * n;
                        for (let k = 0; k < n; k++) z += W1[row + k] * x[k];
                        hid[j] = Math.tanh(z); out += W2[j] * hid[j];
                    }
                    const e = sigmoid(base[i] + out) - target[i];   // d loss / d out
                    gB += e;
                    for (let j = 0; j < H; j++) {
                        gW2[j] += e * hid[j];
                        const d = e * W2[j] * (1 - hid[j] * hid[j]);
                        gb1[j] += d; const row = j * n;
                        for (let k = 0; k < n; k++) gW1[row + k] += d * x[k];
                    }
                }
                step++;
                const b1c = 1 - 0.9 ** step, b2c = 1 - 0.999 ** step;
                const grads = [gW1, gb1, gW2];
                for (let p = 0; p < 3; p++) {
                    const P = params[p], G = grads[p], M = m1[p], V = v1[p];
                    for (let k = 0; k < P.length; k++) {
                        const g = G[k] / m + (p === 1 ? 0 : l2 * P[k]);
                        M[k] = 0.9 * M[k] + 0.1 * g; V[k] = 0.999 * V[k] + 0.001 * g * g;
                        P[k] -= lr * (M[k] / b1c) / (Math.sqrt(V[k] / b2c) + 1e-8);
                    }
                }
                const g = gB / m;
                mB = 0.9 * mB + 0.1 * g; vB = 0.999 * vB + 0.001 * g * g;
                b2 -= lr * (mB / b1c) / (Math.sqrt(vB / b2c) + 1e-8);
            }
            const t = evalSet(te);
            if (!best || t.lossNet < best.test.lossNet) {
                best = { epoch: ep + 1, test: t, snap: { W1: W1.slice(), b1: b1.slice(), W2: W2.slice(), b2 } };
            }
            onProgress({ epoch: ep + 1, epochs, test: t });
            await new Promise(r => setTimeout(r, 0));   // keep the page responsive
        }
        const round = x => +x.toPrecision(4);
        const net = {
            v: window.BotTerms?.FEATURE_VERSION || 1, n, hidden: H, a: round(a), b: round(b), clip: opts.clip || CLIP,
            mean: mean.map(round), std: std.map(round),
            W1: best.snap.W1.map(round), b1: best.snap.b1.map(round), W2: best.snap.W2.map(round), b2: round(best.snap.b2),
            trained: { at: new Date().toISOString(), positions: rows.length, games: games.length, testGames: testGames.size, epoch: best.epoch, lambda },
        };
        return { net, test: best.test, train: evalSet(tr), counts: { rows: rows.length, games: games.length, train: tr.length, test: te.length } };
    }

    // ── Data ─────────────────────────────────────────────────────
    // Every row from the server, any account or device; one copy per game
    // (the same real game mined by two accounts counts once).
    async function loadRows(onProgress) {
        const out = [], seen = new Map();
        let after = 0;
        for (let page = 0; page < 200; page++) {
            const { data, error } = await supabase.rpc('hermit_position_samples', { p_after: after, p_limit: 5000 });
            if (error) throw error;
            if (!data?.length) break;
            for (const r of data) {
                after = Math.max(after, r.id);
                const f = window.BotTerms?.toCurrent?.(r.features, r.version);
                if (!f) continue;
                // '#n' = a chunk of one game's move sequence: same game.
                const game = String(r.game_key).split('#')[0];
                const owner = seen.get(game);
                if (owner && owner !== r.created_by) continue;
                seen.set(game, r.created_by);
                out.push({ f, ev: r.eval, result: r.result, game, seat: r.seat, turn: r.turn, source: r.source, players: r.n_players });
            }
            onProgress?.(out.length);
            if (data.length < 5000) break;
        }
        return out;
    }

    // ── Hermit panel ─────────────────────────────────────────────
    let lastNet = null;
    function open() {
        if (!window.isHermit?.()) return;
        document.getElementById('bot-net-panel')?.remove();
        const box = document.createElement('div');
        box.id = 'bot-net-panel';
        box.style.cssText = 'position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:10060;width:min(560px,94vw);max-height:88vh;overflow:auto;' +
            'background:#16161f;border:1px solid #555;border-radius:10px;padding:14px 16px;color:#ddd;font-size:13px;box-shadow:0 8px 32px rgba(0,0,0,.7);';
        box.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                <b style="font-size:15px;">Bot Network</b>
                <button class="bn-close" style="padding:2px 9px;">✕</button>
            </div>
            <div style="color:#aaa;font-size:12px;margin-bottom:10px;">A small network that adds a correction to the bot's own score. It learns from positions saved in every bot game and every mined real game, from all devices. It only reaches the bots by beating the champion in idle training.</div>
            <div class="bn-summary" style="margin-bottom:10px;">Loading summary...</div>
            <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px;">
                <button class="bn-train" style="padding:5px 10px;">Load positions and train</button>
                <button class="bn-test" style="padding:5px 10px;" disabled>Quick test vs champion (20 games)</button>
                <button class="bn-send" style="padding:5px 10px;" disabled>Send to idle training</button>
            </div>
            <div class="bn-status" style="white-space:pre-line;font-family:monospace;font-size:12px;color:#cfc;"></div>`;
        document.body.appendChild(box);
        const $ = s => box.querySelector(s);
        const status = (t) => { $('.bn-status').textContent = t; };
        $('.bn-close').onclick = () => box.remove();

        supabase.rpc('hermit_position_summary').then(({ data, error }) => {
            if (error || !data) { $('.bn-summary').textContent = 'No summary (is sql/position-samples.sql applied?)'; return; }
            const by = Object.entries(data.by_players || {}).map(([k, v]) => `${k}p: ${v}`).join(', ');
            $('.bn-summary').textContent = `Saved: ${data.rows} positions from ${data.games} games, ${data.accounts} account(s). ${by}`;
        });

        $('.bn-train').onclick = async () => {
            $('.bn-train').disabled = true;
            try {
                status('Loading positions...');
                const rows = await loadRows(n => status(`Loading positions... ${n}`));
                const src = {};
                for (const r of rows) src[r.source] = (src[r.source] || 0) + 1;
                status(`Training on ${rows.length} positions (${Object.entries(src).map(([k, v]) => `${k} ${v}`).join(', ')})...`);
                const res = await train(rows, { onProgress: p => status(`Training: round ${p.epoch} of ${p.epochs}, held-out loss ${p.test.lossNet.toFixed(4)} (weighted sum alone ${p.test.lossBase.toFixed(4)})`) });
                lastNet = res.net;
                const t = res.test, pct = (x) => x == null ? '-' : (100 * x).toFixed(1) + '%';
                const gain = (1 - t.lossNet / t.lossBase) * 100;
                // Send only a network that beats the weighted sum on held-out games,
                // on both loss and % right (a net that memorised its games fails here).
                const better = gain >= 1 && (t.accNet == null || t.accBase == null || t.accNet >= t.accBase);
                status([
                    `Positions: ${res.counts.rows} in ${res.counts.games} games (${res.counts.test} held out to check).`,
                    `Held-out games, predicting who wins:`,
                    `  weighted sum alone: loss ${t.lossBase.toFixed(4)}, right ${pct(t.accBase)}`,
                    `  with the network:   loss ${t.lossNet.toFixed(4)}, right ${pct(t.accNet)}`,
                    better ? `The network predicts ${gain.toFixed(1)}% better on games it never saw. Next: quick test, then send.`
                        : `Not better than the bot's own score on games it never saw (loss ${gain.toFixed(1)}%). Not sendable yet; more games will help.`,
                ].join('\n'));
                $('.bn-test').disabled = false; $('.bn-send').disabled = !better;
            } catch (e) {
                status('Training failed: ' + (e.message || e));
            } finally { $('.bn-train').disabled = false; }
        };

        $('.bn-test').onclick = async () => {
            if (!lastNet) return;
            $('.bn-test').disabled = true;
            try {
                await window.LazyScripts?.load?.('bot-arena');
                const champ = { ...window.BotSystem.WEIGHTS };
                delete champ.net;
                const withNet = { ...champ, net: lastNet, netWeight: 1 };
                status('Quick test: champion + network vs champion, 20 muted games...');
                const r = await window.BotArena.run(withNet, champ, 20, (Date.now() % 100000) >>> 0, { visual: false, comboWatch: false });
                status(`Quick test: network won ${r.aWins}, lost ${r.bWins}, drew ${r.draws}. 20 games is only a hint; idle training decides.`);
            } catch (e) { status('Quick test failed: ' + (e.message || e)); }
            finally { $('.bn-test').disabled = false; }
        };

        $('.bn-send').onclick = async () => {
            if (!lastNet) return;
            $('.bn-send').disabled = true;
            try {
                const { data: job, error } = await supabase.rpc('idle_training_job');
                if (error || !job?.champion) throw error || new Error('no champion');
                const w = { ...(window.BotSystem?.DEFAULT_WEIGHTS || {}), ...job.champion, net: lastNet, netWeight: 1 };
                const r = await supabase.rpc('idle_training_new', { p_champion: job.champion_id, p_weights: w, p_kind: 'net' });
                if (r.error) throw r.error;
                status(`Sent. Idle training on every device now tests champion + network (challenger #${r.data?.id ?? '?'}). It becomes the champion only at 58%+ over 40 games.`);
            } catch (e) {
                status('Send failed: ' + (e.message || e) + (/bad kind/.test(e.message || '') ? ' (run sql/bot-net.sql first)' : ''));
                $('.bn-send').disabled = false;
            }
        };
    }

    window.BotNet = { correction, train, loadRows, open, _netOut: netOut };
})();
