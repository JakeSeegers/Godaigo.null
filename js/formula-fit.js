// js/formula-fit.js - window.FormulaFit: fit formula terms to saved positions
// (owner 2026-10-18). Hermit only.
//
// Random formula invention (bot-arena.js mutateTerms) needs 40+ games per
// idea and starts every new term at a random weight. This instead tests
// formulas on the positions already saved for the bot network
// (position_samples, js/bot-net.js loadRows), with no games at all:
//
//   1. Fit the weight. Baseline = the bot's own score: chance to win =
//      sigmoid(a * eval/1000 + b). For a formula x, fit c in
//      sigmoid(base + c * x) (Newton steps, x standardized). The weight in
//      eval units is c * 1000 / (a * std(x)), so the scale is right at once.
//   2. Screen many formulas: singles, products of two inputs, "from N
//      elements on" gates, random trees, plus the Formula Lab ideas. Games
//      are split three ways: FIT (fit c), RANK (pick the best) and CHECK
//      (final honest test; picking the best of thousands on RANK flatters
//      it). Forward selection: up to 3 formulas, each fitted on top of the
//      ones already picked, so copies of a picked formula add nothing.
//   3. Send the picked set (champion + formulas) to idle training as a
//      'formula' challenger. Games still decide: 58%+ over 40 games.
//
// Limits: predicting who wins is not the same as choosing better moves
// (the bot network predicted well and still lost). Formulas reading
// homeCost, myAP or adjacent(a, b) cannot be fitted (not saved per row).
(function () {
    'use strict';

    const EV_SCALE = 1000, EV_CLIP = 20;
    const MAX_PICK = 3;
    const KEEP_TOP = 60;            // candidates kept in memory after round 1
    const MIN_GAIN = 0.002;         // 0.2% lower RANK loss to pick a formula
    const L2 = 1e-3;
    const sigmoid = z => 1 / (1 + Math.exp(-z));
    const evIn = ev => Math.max(-EV_CLIP, Math.min(EV_CLIP, (+ev || 0) / EV_SCALE));
    const bce = (p, y) => { p = Math.min(1 - 1e-6, Math.max(1e-6, p)); return -(y * Math.log(p) + (1 - y) * Math.log(1 - p)); };
    function rng(seed) { let t = seed >>> 0; return () => { t += 0x6D2B79F5; let r = Math.imul(t ^ (t >>> 15), 1 | t); r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r; return ((r ^ (r >>> 14)) >>> 0) / 4294967296; }; }
    const pick = (arr, R) => arr[Math.floor(R() * arr.length)];
    const tick = () => new Promise(r => setTimeout(r, 0));

    // Formula inputs that are saved per row (iHave(el) is a network feature only).
    function inputNames() {
        return window.BotTerms.FEATURE_NAMES.filter(n => !n.startsWith('iHave('));
    }

    // ── Candidates ───────────────────────────────────────────────
    function candidates(opts = {}) {
        const R = rng(opts.seed || 7);
        const names = inputNames();
        const out = new Map();   // text -> source
        const add = (text, src) => {
            const c = window.BotTerms.compile(text);
            if (c.error) return;
            const t = window.BotTerms.toText(c.tree);
            if (!out.has(t)) out.set(t, src);
        };
        // Lab ideas first, so a duplicate keeps the 'lab' label.
        for (const t of opts.lab || []) add(t, 'lab');
        // 'players' alone never changes inside a game: it cannot pick a move.
        for (const a of names) if (a !== 'players') add(a, 'single');
        for (let i = 0; i < names.length; i++) {
            for (let j = i + 1; j < names.length; j++) add(`${names[i]} * ${names[j]}`, 'pair');
        }
        for (const a of names) {
            if (a === 'myActivated' || a === 'players') continue;
            for (const k of [2, 3, 4]) add(`if(myActivated >= ${k}, ${a}, 0)`, 'gate');
            add(`if(leaderActivated >= 4, ${a}, 0)`, 'gate');
        }
        const ops = ['+', '-', '*', '/', 'min', 'max'];
        const leaf = () => (R() < 0.8 ? pick(names, R) : String(1 + Math.floor(R() * 9)));
        const tree = (d) => {
            if (d <= 0 || R() < 0.3) return leaf();
            const op = pick(ops, R), a = tree(d - 1), b = tree(d - 1);
            return /^[a-z]+$/.test(op) ? `${op}(${a}, ${b})` : `(${a} ${op} ${b})`;
        };
        const nRandom = opts.random ?? 400;
        for (let k = 0, tries = 0; k < nRandom && tries < nRandom * 5; tries++) {
            let t = tree(2);
            if (R() < 0.25) t = `if(${pick(names, R)} ${pick(['>', '<', '>='], R)} ${Math.floor(R() * 6)}, ${t}, 0)`;
            const before = out.size;
            add(t, 'random');
            if (out.size > before) k++;
        }
        return [...out].map(([text, src]) => ({ text, src }));
    }

    // ── Data split + baseline ────────────────────────────────────
    // 60% of games FIT, 20% RANK, 20% CHECK (by game, never by row).
    function split(rows, seed) {
        const R = rng(seed || 12345);
        const part = new Map();
        for (const r of rows) {
            if (!part.has(r.game)) { const u = R(); part.set(r.game, u < 0.6 ? 0 : u < 0.8 ? 1 : 2); }
        }
        const sets = [[], [], []];
        rows.forEach((r, i) => sets[part.get(r.game)].push(i));
        return { fit: Int32Array.from(sets[0]), rank: Int32Array.from(sets[1]), check: Int32Array.from(sets[2]), games: part.size };
    }

    function fitBase(rows, idx) {
        let a = 0.5, b = 0;
        for (let it = 0; it < 300; it++) {
            let ga = 0, gb = 0;
            for (const i of idx) { const r = rows[i], x = evIn(r.ev), e = sigmoid(a * x + b) - r.result; ga += e * x; gb += e; }
            a -= 0.5 * ga / idx.length; b -= 0.5 * gb / idx.length;
        }
        return { a: Math.max(0.01, a), b };
    }

    // A formula's value on every row (clamped like BotTerms.score), or null.
    function values(text, rows) {
        const c = window.BotTerms.compile(text);
        if (!c.fn) return null;
        const clamp = window.BotTerms.CLAMP;
        const x = new Float32Array(rows.length);
        for (let i = 0; i < rows.length; i++) {
            let v = c.fn(window.BotTerms.rowContext(rows[i].f));
            if (!Number.isFinite(v)) v = 0;
            x[i] = v > clamp ? clamp : v < -clamp ? -clamp : v;
        }
        return x;
    }

    // Standardize with FIT-set mean / std (null when it never changes).
    function standardize(x, fitIdx) {
        let m = 0;
        for (const i of fitIdx) m += x[i];
        m /= fitIdx.length;
        let s = 0;
        for (const i of fitIdx) s += (x[i] - m) ** 2;
        s = Math.sqrt(s / fitIdx.length);
        if (!(s > 1e-9)) return null;
        const xs = new Float32Array(x.length);
        for (let i = 0; i < x.length; i++) xs[i] = (x[i] - m) / s;
        return { xs, mean: m, std: s };
    }

    // 1-D logistic fit of c in sigmoid(z[i] + c * xs[i]) on idx (Newton).
    function fitC(z, xs, y, idx) {
        let c = 0;
        for (let it = 0; it < 8; it++) {
            let g = 0, h = 0;
            for (const i of idx) { const p = sigmoid(z[i] + c * xs[i]); g += (p - y[i]) * xs[i]; h += p * (1 - p) * xs[i] * xs[i]; }
            g = g / idx.length + L2 * c; h = h / idx.length + L2;
            const step = g / h;
            c -= Math.max(-2, Math.min(2, step));
            if (Math.abs(step) < 1e-5) break;
        }
        return c;
    }
    function lossOn(z, xs, c, y, idx) {
        let L = 0;
        for (const i of idx) L += bce(sigmoid(z[i] + (xs ? c * xs[i] : 0)), y[i]);
        return L / idx.length;
    }
    function accOn(z, y, idx) {
        let ok = 0, n = 0;
        for (const i of idx) { if (y[i] !== 0 && y[i] !== 1) continue; n++; ok += (z[i] >= 0) === (y[i] === 1); }
        return n ? ok / n : null;
    }

    // ── Steps 1 + 2: fit and screen ──────────────────────────────
    async function run(rows, opts = {}) {
        if (!window.BotTerms?.rowContext) throw new Error('BotTerms not loaded');
        const onProgress = opts.onProgress || (() => {});
        const S = split(rows, opts.seed);
        if (S.fit.length < 200 || S.rank.length < 50 || S.check.length < 50) {
            throw new Error(`not enough data (${rows.length} positions in ${S.games} games)`);
        }
        const y = Float32Array.from(rows, r => r.result);
        const { a, b } = fitBase(rows, S.fit);
        const z = Float64Array.from(rows, r => a * evIn(r.ev) + b);
        const base = { rank: lossOn(z, null, 0, y, S.rank), check: lossOn(z, null, 0, y, S.check), accCheck: accOn(z, y, S.check) };

        // Lab ideas that read unsaved inputs are reported, not fitted.
        const skipped = [];
        const cands = candidates(opts).filter(cd => {
            const miss = window.BotTerms.missingInputs(cd.text);
            if (miss && miss.length) { if (cd.src === 'lab') skipped.push({ text: cd.text, missing: miss }); return false; }
            return !!miss;
        });

        // Round 1: every candidate on its own, on top of the bot's score.
        const scored = [];
        for (let k = 0; k < cands.length; k++) {
            const cd = cands[k];
            const x = values(cd.text, rows);
            const st = x && standardize(x, S.fit);
            if (st) {
                const c = fitC(z, st.xs, y, S.fit);
                const gain = 1 - lossOn(z, st.xs, c, y, S.rank) / base.rank;
                scored.push({ ...cd, c, gain, xs: st.xs, mean: st.mean, std: st.std });
            }
            if (k % 25 === 0) { onProgress({ stage: 'screen', done: k, total: cands.length }); await tick(); }
        }
        scored.sort((p, q) => q.gain - p.gain);
        const top = scored.slice(0, KEEP_TOP);
        const lab = scored.filter(s => s.src === 'lab').map(s => ({ text: s.text, gain: s.gain, w: s.c * EV_SCALE / (a * s.std) }));
        for (const s of scored.slice(KEEP_TOP)) s.xs = null;   // free memory

        // Forward selection: refit the top candidates on top of the picked ones.
        const picked = [];
        const zc = Float64Array.from(z);
        let rankLoss = base.rank;
        for (let round = 0; round < MAX_PICK; round++) {
            let best = null;
            for (const s of top) {
                if (picked.includes(s)) continue;
                const c = fitC(zc, s.xs, y, S.fit);
                const L = lossOn(zc, s.xs, c, y, S.rank);
                if (!best || L < best.L) best = { s, c, L };
            }
            if (!best || 1 - best.L / rankLoss < MIN_GAIN) break;
            best.s.cPicked = best.c;
            picked.push(best.s);
            for (let i = 0; i < zc.length; i++) zc[i] += best.c * best.s.xs[i];
            rankLoss = best.L;
            onProgress({ stage: 'pick', picked: picked.length });
            await tick();
        }

        // Step 2b: the honest test on CHECK games (never used to fit or pick).
        const check = { loss: lossOn(zc, null, 0, y, S.check), acc: accOn(zc, y, S.check) };
        const terms = picked.map(s => ({
            text: s.text,
            w: +(s.cPicked * EV_SCALE / (a * s.std)).toPrecision(3),
            note: `fitted ${new Date().toISOString().slice(0, 10)}, ${s.src}`,
            src: 'fitted',
        }));
        return {
            counts: { rows: rows.length, games: S.games, fit: S.fit.length, rank: S.rank.length, check: S.check.length, candidates: cands.length },
            base: { a, b, ...base },
            top: scored.slice(0, 10).map(s => ({ text: s.text, src: s.src, gain: s.gain, w: s.c * EV_SCALE / (a * s.std) })),
            lab, skipped, terms,
            rankGain: 1 - rankLoss / base.rank,
            checkGain: 1 - check.loss / base.check,
            check,
        };
    }

    // ── Step 3: send to idle training ────────────────────────────
    async function send(terms) {
        if (!terms?.length) throw new Error('no formulas to send');
        const { data: job, error } = await supabase.rpc('idle_training_job');
        if (error || !job?.champion) throw error || new Error('no champion');
        const old = Array.isArray(job.champion.terms) ? job.champion.terms : [];
        const all = [...old, ...terms.filter(t => !old.some(o => o.text === t.text))].slice(0, window.BotTerms.MAX_TERMS);
        const w = { ...(window.BotSystem?.DEFAULT_WEIGHTS || {}), ...job.champion, terms: all };
        const r = await supabase.rpc('idle_training_new', { p_champion: job.champion_id, p_weights: w, p_kind: 'formula' });
        if (r.error) throw r.error;
        return r.data;
    }

    // ── Hermit panel ─────────────────────────────────────────────
    let last = null;
    function open() {
        if (!window.isHermit?.()) return;
        document.getElementById('formula-fit-panel')?.remove();
        const box = document.createElement('div');
        box.id = 'formula-fit-panel';
        box.style.cssText = 'position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:10061;width:min(640px,94vw);max-height:88vh;overflow:auto;' +
            'background:#16161f;border:1px solid #555;border-radius:10px;padding:14px 16px;color:#ddd;font-size:13px;box-shadow:0 8px 32px rgba(0,0,0,.7);';
        box.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                <b style="font-size:15px;">Fit Formulas</b>
                <button class="ff-close" style="padding:2px 9px;">✕</button>
            </div>
            <div style="color:#aaa;font-size:12px;margin-bottom:10px;">Tests formulas on the positions saved for the bot network, with no games: each one gets the weight that best predicts who wins, on top of the bot's own score. The best (up to 3) are checked on games not used to pick them, then can go to idle training, where real games decide. Includes your Formula Lab ideas.</div>
            <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:10px;">
                <label>Random formulas <input class="ff-random" type="number" min="0" max="3000" value="400" style="width:70px;"></label>
                <button class="ff-run" style="padding:5px 10px;">Load positions and fit</button>
                <button class="ff-send" style="padding:5px 10px;" disabled>Send to idle training</button>
            </div>
            <div class="ff-status" style="white-space:pre-line;font-family:monospace;font-size:12px;color:#cfc;"></div>`;
        document.body.appendChild(box);
        const $ = s => box.querySelector(s);
        const status = t => { $('.ff-status').textContent = t; };
        const pct = x => x == null ? '-' : (100 * x).toFixed(2) + '%';
        $('.ff-close').onclick = () => box.remove();

        $('.ff-run').onclick = async () => {
            $('.ff-run').disabled = true; $('.ff-send').disabled = true;
            try {
                status('Loading positions...');
                const rows = await window.BotNet.loadRows(n => status(`Loading positions... ${n}`));
                const lab = window.BotTerms.parseLines(window.FormulaLab?.ideaText?.() || '', 'lab').terms.map(t => t.text);
                const res = await run(rows, {
                    lab, random: Math.max(0, Math.min(3000, +$('.ff-random').value || 0)), seed: (Date.now() % 100000) >>> 0,
                    onProgress: p => status(p.stage === 'screen' ? `Fitting formulas: ${p.done} of ${p.total}...` : `Picking: ${p.picked} picked...`),
                });
                last = res;
                const ok = res.terms.length && res.checkGain >= MIN_GAIN && (res.check.acc == null || res.base.accCheck == null || res.check.acc >= res.base.accCheck - 0.005);
                const lines = [
                    `Positions: ${res.counts.rows} in ${res.counts.games} games (fit ${res.counts.fit}, rank ${res.counts.rank}, check ${res.counts.check}). Formulas tried: ${res.counts.candidates}.`,
                    '',
                    'Best single formulas (lower loss on rank games, weight in score points):',
                    ...res.top.map(t => `  ${pct(t.gain).padStart(7)}  ${(+t.w.toPrecision(3)).toString().padStart(8)}: ${t.text}  [${t.src}]`),
                ];
                if (res.lab.length || res.skipped.length) {
                    lines.push('', 'Formula Lab ideas:');
                    for (const t of res.lab) lines.push(`  ${pct(t.gain).padStart(7)}  ${(+t.w.toPrecision(3)).toString().padStart(8)}: ${t.text}`);
                    for (const t of res.skipped) lines.push(`  cannot fit (uses ${t.missing.join(', ')}, not saved): ${t.text}`);
                }
                lines.push('', 'Picked set (each fitted on top of the ones before):');
                if (!res.terms.length) lines.push('  none: no formula helped enough.');
                for (const t of res.terms) lines.push(`  ${t.w}: ${t.text}`);
                lines.push('', `Check games (not used to fit or pick): loss ${pct(res.checkGain)} lower, right ${pct(res.check.acc)} (bot's score alone ${pct(res.base.accCheck)}).`);
                lines.push(ok ? 'Sendable. Idle training decides with real games.'
                    : 'Not sendable: the picked set did not hold up on the check games. More saved positions will help.');
                status(lines.join('\n'));
                $('.ff-send').disabled = !ok;
            } catch (e) {
                status('Fit failed: ' + (e.message || e));
            } finally { $('.ff-run').disabled = false; }
        };

        $('.ff-send').onclick = async () => {
            if (!last?.terms?.length) return;
            $('.ff-send').disabled = true;
            try {
                const d = await send(last.terms);
                status($('.ff-status').textContent + `\n\nSent: challenger #${d?.id ?? '?'} = champion + ${last.terms.length} formula(s). It becomes the champion only at 58%+ over 40 games.`);
            } catch (e) {
                status($('.ff-status').textContent + '\n\nSend failed: ' + (e.message || e));
                $('.ff-send').disabled = false;
            }
        };
    }

    window.FormulaFit = { run, send, open, candidates, _split: split };
})();
