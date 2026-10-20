// js/training-lab.js - window.TrainingLab: the hermit's Training Lab
// (owner 2026-10-18; rebuilt the same day for clarity). One place to see and
// steer bot training; Train Bot for gold stays one simple button for everyone.
//
// Tabs:
//   Overview    how the bot gets better (ideas -> challengers -> games ->
//               champion) and one card per training method, with its live
//               status and the button that opens it.
//   Challengers every idle challenger (sql/training-lab.sql
//               hermit_training_lab): what it changes, record, progress to
//               40 decided games, chance it beats its champion, Reject.
//   Champions   promoted champions (bot_champion_weights), what each changed,
//               "Make live again" (hermit_restore_champion) and a test of the
//               live champion vs the last 3 (BotArena.run, 10 games each).
//   Saved games how much position data is saved, against rough marks.
//   Warm-up     (owner 2026-10-20) a challenger first beats 3 games it lost: find
//               a deal it loses (played twice, seats swapped), nudge its settings
//               until one version wins that deal both ways, then deal 1 + 2 both
//               ways, then 1 + 2 + 3; then the normal exam on fresh deals.
//
// The Lab never promotes on its own: games and the server rules decide, and
// the hermit can undo a promotion here.
(function () {
    'use strict';

    // Rough marks (games' worth of saved positions), not hard rules.
    const MARKS = { fit: { min: 300, good: 1000 }, net: { min: 2000, good: 5000 } };
    const DECIDED_FOR_VERDICT = 40;   // server: verdict at 40 decided games, 58%+
    const TEST_KEY = 'godaigo_training_lab_test';
    const TAB_KEY = 'godaigo_training_lab_tab';

    const KIND = {
        explore:   { label: 'Explore',          color: '#8fd3ff' },
        formula:   { label: 'Formulas',         color: '#c9a2ff' },
        combo:     { label: 'Combo',            color: '#ffb36b' },
        imitation: { label: 'Learned from you', color: '#7fdc8f' },
        net:       { label: 'Network',          color: '#ff8fc8' },
    };

    const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const num = n => (+n || 0).toLocaleString('en-US');
    const day = t => {
        if (!t) return '-';
        const d = new Date(t);
        return isNaN(d) ? String(t).slice(0, 10) : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    };

    // ── Math ─────────────────────────────────────────────────────
    // Chance the true win rate is above 50% (Beta(w+1, l+1), normal approximation).
    function chanceBetter(w, l) {
        const n = w + l;
        const m = (w + 1) / (n + 2), sd = Math.sqrt(m * (1 - m) / (n + 3));
        const z = (m - 0.5) / sd;
        const x = Math.abs(z) / Math.SQRT2, t = 1 / (1 + 0.3275911 * x);
        const erf = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
        return z >= 0 ? 0.5 * (1 + erf) : 0.5 * (1 - erf);
    }
    function verdict(w, l) {
        const p = chanceBetter(w, l);
        if (w + l < 6) return { text: 'too early', p, cls: 'muted' };
        if (p >= 0.9) return { text: 'likely better', p, cls: 'good' };
        if (p <= 0.1) return { text: 'likely worse', p, cls: 'bad' };
        return { text: 'unclear', p, cls: 'warn' };
    }

    // What a weight table changes vs another one, as short lines.
    function diff(w, base) {
        if (!w || !base) return [];
        const out = [];
        const changed = [];
        for (const k of Object.keys(w)) {
            if (k === 'terms' || k === 'extraCombos' || k === 'net') continue;
            const a = w[k], b = base[k];
            if (typeof a !== 'number' || typeof b !== 'number') continue;
            const scale = Math.max(Math.abs(b), 1e-6);
            if (Math.abs(a - b) / scale > 0.1) changed.push({ k, a, b, rel: Math.abs(a - b) / scale });
        }
        changed.sort((p, q) => q.rel - p.rel);
        if (changed.length) {
            out.push(`${changed.length} setting${changed.length > 1 ? 's' : ''} changed: ` +
                changed.slice(0, 3).map(c => `${c.k} ${+c.b.toPrecision(3)} → ${+c.a.toPrecision(3)}`).join(', ') + (changed.length > 3 ? ', ...' : ''));
        }
        const oldT = new Set((base.terms || []).map(t => t.text));
        const newT = (w.terms || []).filter(t => !oldT.has(t.text));
        const goneT = (base.terms || []).filter(t => !(w.terms || []).some(x => x.text === t.text));
        if (newT.length) out.push('new formula: ' + newT.map(t => `${t.w} × ${t.text}`).join(' | '));
        if (goneT.length) out.push('formula removed: ' + goneT.map(t => t.text).join(' | '));
        const oldC = new Set(base.extraCombos || []);
        const newC = (w.extraCombos || []).filter(c => !oldC.has(c));
        if (newC.length) out.push('trial combo: ' + newC.join(' | '));
        return out;
    }
    const sameWeights = (a, b) => { try { return JSON.stringify(a) === JSON.stringify(b); } catch (e) { return false; } };

    // ── Look ─────────────────────────────────────────────────────
    const CSS = `
        #training-lab { position:fixed; left:50%; top:50%; transform:translate(-50%,-50%); z-index:10059;
            width:min(820px,96vw); height:min(780px,90vh); display:flex; flex-direction:column;
            background:#15151d; color:#e6e6ee; border:1px solid #34344a; border-radius:12px;
            box-shadow:0 12px 40px rgba(0,0,0,.7); font:13.5px/1.45 system-ui,-apple-system,Segoe UI,sans-serif; }
        #training-lab * { box-sizing:border-box; }
        #training-lab .tl-head { padding:14px 18px 10px; border-bottom:1px solid #2a2a3a; }
        #training-lab .tl-title { display:flex; justify-content:space-between; align-items:center; gap:10px; }
        #training-lab h2 { margin:0; font-size:18px; font-weight:650; letter-spacing:.2px; }
        #training-lab .tl-sum { margin-top:8px; display:flex; flex-wrap:wrap; gap:6px; }
        #training-lab .chip { background:#22222f; border:1px solid #33334a; border-radius:999px; padding:2px 10px; font-size:12px; color:#c8c8d8; }
        #training-lab .chip b { color:#fff; }
        #training-lab .tl-tabs { display:flex; gap:2px; padding:0 14px; border-bottom:1px solid #2a2a3a; background:#18181f; }
        #training-lab .tl-tab { background:none; border:none; color:#9a9ab0; padding:9px 12px; cursor:pointer; font:inherit; border-bottom:2px solid transparent; }
        #training-lab .tl-tab:hover { color:#e6e6ee; }
        #training-lab .tl-tab.on { color:#fff; border-bottom-color:#8fd3ff; }
        #training-lab .tl-body { overflow:auto; padding:14px 18px 18px; }
        #training-lab .tl-pane { display:none; } #training-lab .tl-pane.on { display:block; }
        #training-lab h3 { margin:16px 0 8px; font-size:14px; font-weight:650; color:#fff; }
        #training-lab h3:first-child { margin-top:2px; }
        #training-lab .muted { color:#9a9ab0; } #training-lab .small { font-size:12px; }
        #training-lab .good { color:#7fdc8f; } #training-lab .warn { color:#f2cf6a; } #training-lab .bad { color:#ff8a8a; }
        #training-lab .card { background:#1d1d28; border:1px solid #2e2e3e; border-radius:10px; padding:10px 12px; }
        #training-lab .grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(240px,1fr)); gap:10px; }
        #training-lab .stack > * + * { margin-top:8px; }
        #training-lab .card h4 { margin:0 0 4px; font-size:14px; display:flex; justify-content:space-between; gap:6px; align-items:baseline; }
        #training-lab .tag { display:inline-block; font-size:11px; padding:0 7px; border-radius:999px; border:1px solid currentColor; opacity:.9; white-space:nowrap; }
        #training-lab .where { font-size:11px; color:#9a9ab0; }
        #training-lab .status { margin:6px 0 8px; font-size:12.5px; }
        #training-lab button.b { background:#2a2a3a; color:#e6e6ee; border:1px solid #3c3c52; border-radius:7px; padding:4px 10px; cursor:pointer; font:inherit; font-size:12.5px; }
        #training-lab button.b:hover { background:#34344a; }
        #training-lab button.b:disabled { opacity:.5; cursor:default; }
        #training-lab button.b.primary { background:#24465a; border-color:#3a6b88; }
        #training-lab button.b.danger { background:#4a2228; border-color:#7a3a44; }
        #training-lab .row { display:flex; gap:8px; flex-wrap:wrap; align-items:center; }
        #training-lab .flow { display:flex; align-items:stretch; gap:6px; flex-wrap:wrap; }
        #training-lab .step { flex:1 1 150px; background:#1d1d28; border:1px solid #2e2e3e; border-radius:10px; padding:8px 10px; }
        #training-lab .step b { display:block; color:#fff; margin-bottom:2px; }
        #training-lab .arrow { align-self:center; color:#55556e; font-size:18px; }
        #training-lab .bar { position:relative; height:8px; background:#2a2a36; border-radius:4px; overflow:hidden; margin:5px 0 3px; }
        #training-lab .bar > i { position:absolute; left:0; top:0; bottom:0; border-radius:4px; }
        #training-lab .bar > s { position:absolute; top:0; bottom:0; width:2px; background:#ffffffaa; text-decoration:none; }
        #training-lab .rec { font-size:17px; font-weight:650; color:#fff; letter-spacing:.3px; }
        #training-lab ul.changes { margin:6px 0 0; padding-left:18px; color:#b8b8cc; font-size:12px; }
        #training-lab details > summary { cursor:pointer; color:#9a9ab0; margin:10px 0 6px; }
        #training-lab .testbox { border-color:#3a6b4a; background:#1a261e; }
        #training-lab .note { border-left:3px solid #3a6b88; padding:6px 10px; background:#1a2129; border-radius:0 8px 8px 0; color:#c8d4e0; font-size:12.5px; }
        #training-lab.min { left:auto; top:auto; right:16px; bottom:16px; transform:none; width:min(380px,92vw); height:auto; }
        #training-lab.min .tl-tabs, #training-lab.min .tl-body, #training-lab.min .tl-sum { display:none; }
        #training-lab.min .tl-head { border-bottom:none; padding:10px 14px; }
        #training-lab.min h2 { font-size:15px; }
        #training-lab .tl-mini { display:none; margin-top:6px; font-size:12.5px; color:#c8c8d8; }
        #training-lab.min .tl-mini { display:block; }`;

    function bar(pct, color, marks = []) {
        return `<div class="bar"><i style="width:${Math.max(0, Math.min(100, pct))}%;background:${color};"></i>${marks.map(m => `<s style="left:${m}%"></s>`).join('')}</div>`;
    }

    // ── Data ─────────────────────────────────────────────────────
    async function loadChampions() {
        const { data, error } = await supabase.from('bot_champion_weights')
            .select('id, created_at, weights, confirm_wins, confirm_losses, confirm_draws, promoted')
            .eq('promoted', true).order('created_at', { ascending: false }).limit(12);
        if (error) throw error;
        return data || [];
    }
    async function loadTaughtCombos() {
        try { const { data, error } = await supabase.rpc('get_bot_combos'); return error ? null : (data || []).length; }
        catch (e) { return null; }
    }

    // ── Overview ─────────────────────────────────────────────────
    function overviewHtml(S) {
        const open = S.candidates.filter(c => c.status === 'open');
        const openOf = k => open.filter(c => c.kind === k);
        const lastWin = k => S.candidates.filter(c => c.kind === k && c.status === 'promoted')
            .sort((a, b) => String(b.decided_at).localeCompare(String(a.decided_at)))[0];
        const testing = k => {
            const list = openOf(k);
            if (!list.length) return '<span class="muted">nothing being tested right now</span>';
            return `${list.length} being tested: ` + list.map(c => `#${c.id} ${c.wins}-${c.losses}-${c.draws}`).join(', ');
        };
        const won = k => { const c = lastWin(k); return c ? ` · last win: #${c.id} → champion #${c.new_champion_id}` : ''; };
        const games = (+S.data?.games || 0) + (+S.data?.mined_games || 0);
        const imit = window.BotImitation;
        const deltas = imit?.getDeltas ? Object.values(imit.getDeltas() || {}).filter(v => Math.abs(+v || 0) > 1e-6).length : 0;
        const queued = window.FormulaFit?.queued?.();

        const card = (title, kind, what, where, status, buttons) => `
            <div class="card">
                <h4><span>${title}</span>${kind ? `<span class="tag" style="color:${KIND[kind].color}">${KIND[kind].label}</span>` : ''}</h4>
                <div class="small">${what}</div>
                <div class="where">Runs in: ${where}</div>
                <div class="status">${status}</div>
                <div class="row">${buttons}</div>
            </div>`;
        const btn = (cls, text, extra = '') => `<button class="b ${extra}" data-act="${cls}">${text}</button>`;

        const offCard = (title, what, how) => `
            <div class="card" style="opacity:.75;">
                <h4><span>${title}</span><span class="tag bad">off</span></h4>
                <div class="small">${what}</div>
                <div class="where">${how}</div>
            </div>`;
        const comboOff = window.COMBO_MINING === false, inventOff = window.FORMULA_INVENTION === false;

        return `
            <h3>How the bot gets better</h3>
            <div class="flow">
                <div class="step"><b>1. You spot a problem</b><span class="small muted">Watch games. Click "Bad move" (Shift+K) when a bot does something dumb.</span></div>
                <div class="arrow">→</div>
                <div class="step"><b>2. Fix and test</b><span class="small muted">Fix the cause, then "Test a change": your change vs the champion on the same deals.</span></div>
                <div class="arrow">→</div>
                <div class="step"><b>3. Training fills in</b><span class="small muted">Train Bot and idle training try small setting changes against the champion.</span></div>
                <div class="arrow">→</div>
                <div class="step"><b>4. New champion</b><span class="small muted">58%+ of 40 decided games against the champion, the same rule everywhere. Undo in Champions.</span></div>
            </div>

            <h3>Running</h3>
            <div class="grid">
                ${card('Your tests', null, 'The fastest way to make bots stronger: report bad moves, fix them, and test the fix against the champion.',
                    'the Lab and any game', '"Test a change": a change vs the champion. "Bad move" button: downloads the game for Claude.',
                    btn('tab-test', 'Test a change', 'primary'))}
                ${card('Explore', 'explore', 'Small random changes to the bot\'s settings (how much it values stones, scrolls, distance...). The only source that ever made a champion.',
                    'Train Bot (everyone), idle training', testing('explore') + won('explore'), btn('trainbot', 'Open Train Bot'))}
                ${card('Formulas, on purpose', 'formula', 'New senses you write or fit yourself: Formula Lab ideas, a fitted set queued in Fit Formulas, or "Test a change" > Add a formula.',
                    'your Train Bot runs, the Lab', (inventOff ? 'Random invention is off; formulas only come from you. ' : '') + testing('formula') + won('formula') + (queued ? `<br><span class="good">A fitted set is queued for your next Train Bot run.</span>` : ''),
                    btn('formulalab', 'Formula Lab') + btn('fit', 'Fit Formulas'))}
                ${card('Learned from you', 'imitation', 'While on, it watches your choices in games with bots and nudges the bot\'s settings toward them. Saved to your account.',
                    'your games (on), then Train Bot + idle training', `${imit?.isEnabled?.() ? '<span class="good">On</span>' : '<span class="muted">Off</span>'} · ${deltas} setting${deltas === 1 ? '' : 's'} nudged so far<br>` + testing('imitation') + won('imitation'),
                    btn('imitation', imit?.isEnabled?.() ? 'Turn off' : 'Turn on'))}
                ${card('Bot network', 'net', 'A small learned correction on top of the bot\'s score, trained on saved games. It needs many games first.',
                    'trained by you, tested in idle training', testing('net') + `<br>${num(games)} of ~${num(MARKS.net.min)} games for a fair try.`,
                    btn('net', 'Bot Network') + btn('tab-data', 'Saved games'))}
                ${card('Scroll report', null, 'Which scrolls the bots hold but use badly. Good for spotting what to fix by hand.',
                    'your bot games', '<span class="muted">Diagnostic only.</span>', btn('scrolls', 'Scroll report'))}
            </div>

            <h3>Switched off</h3>
            <div class="grid">
                ${comboOff ? offCard('Combos', 'Mining combos from games and teaching them to the bots. The combo drill showed bots got weaker following them (1-9-2), and 3 of the 9 taught ones were one scroll cast twice. All taught combos are off too.',
                    'Back on: window.COMBO_MINING = true in bot.js, and Auto / On per family in the Combos tab.') : ''}
                ${inventOff ? offCard('Random formulas', 'Training inventing formulas at random. The "formula" challengers never carried one that could matter.',
                    'Back on: window.FORMULA_INVENTION = true in bot-terms.js.') : ''}
                ${offCard('Puzzle check and practice duels', 'Extra checks before a Train Bot promotion, built on mined combo moments. They slowed every run and could block a good champion.',
                    'Removed from Train Bot (2026-10-18).')}
            </div>
            <div class="small muted" style="margin-top:8px;">The combo drill and the Combos / Puzzles tabs still work by hand.</div>`;
    }

    // ── Challengers ──────────────────────────────────────────────
    function challengerCard(c, champW) {
        const v = verdict(c.wins, c.losses);
        const dec = c.wins + c.losses;
        const k = KIND[c.kind] || { label: c.kind, color: '#aaa' };
        const changes = diff(c.weights, champW);
        if (c.has_net) changes.push('adds a trained network');
        const status = c.status === 'open'
            ? `<span class="small muted">${dec} of ${DECIDED_FOR_VERDICT} decided games</span>${bar(100 * dec / DECIDED_FOR_VERDICT, '#3a6b88')}`
            : c.status === 'promoted' ? `<span class="good">Won: became champion #${c.new_champion_id}</span>`
            : c.status === 'stale' ? '<span class="muted">Stopped: the champion changed</span>'
            : '<span class="muted">Dropped</span>';
        return `
            <div class="card">
                <h4><span>#${c.id} <span class="tag" style="color:${k.color}">${esc(k.label)}</span></span>
                    <span class="small muted">vs champion #${c.champion_id} · ${day(c.created_at)} · ${c.players} player${c.players === 1 ? '' : 's'}</span></h4>
                <div class="row" style="justify-content:space-between;">
                    <span><span class="rec">${c.wins}-${c.losses}-${c.draws}</span> <span class="small muted">won-lost-drawn</span></span>
                    <span class="${v.cls}" title="Chance it really beats its champion, from its games so far">${v.text} · ${Math.round(100 * v.p)}%</span>
                </div>
                ${status}
                ${changes.length ? `<ul class="changes">${changes.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : '<div class="small muted">No difference found from its champion.</div>'}
                ${c.status === 'open' ? `<div class="row" style="margin-top:8px;"><button class="b danger" data-reject="${c.id}">Reject</button></div>` : ''}
            </div>`;
    }
    function challengersHtml(S) {
        if (S.error) return `<div class="note">${esc(S.error)}</div>`;
        const byId = new Map(S.champs.map(c => [c.id, c.weights]));
        const open = S.candidates.filter(c => c.status === 'open');
        const done = S.candidates.filter(c => c.status !== 'open').slice(0, 12);
        return `
            <div class="note">A challenger is the champion plus one change. It needs 58%+ of ${DECIDED_FOR_VERDICT} decided games to become champion. The % is the chance it really beats its champion so far: under 90% is not much to go on.</div>
            <h3>Being tested (${open.length})</h3>
            <div class="stack">${open.length ? open.map(c => challengerCard(c, byId.get(c.champion_id))).join('') : '<div class="muted">None right now. Train Bot and idle training make new ones.</div>'}</div>
            ${done.length ? `<details><summary>Finished recently (${done.length})</summary><div class="stack">${done.map(c => challengerCard(c, byId.get(c.champion_id))).join('')}</div></details>` : ''}`;
    }

    // ── Champions ────────────────────────────────────────────────
    function testHtml(t) {
        if (!t) return '<span class="muted small">Plays the live champion against the last 3 champions, 10 games each (a few minutes). Shows whether training lost skill.</span>';
        const rows = t.rows.map(r => {
            if (r.error) return `<div>vs #${r.id}: <span class="bad">failed: ${esc(r.error)}</span></div>`;
            if (r.playing) return `<div>vs #${r.id}: <span class="warn">${esc(r.playing)}</span></div>`;
            const v = verdict(r.w, r.l);
            const word = r.w > r.l ? 'live won more' : r.w < r.l ? 'old won more' : 'even';
            return `<div>vs #${r.id}: <b>${r.w}-${r.l}-${r.d}</b> <span class="muted small">(live-old-draw)</span> ${word}` +
                (v.text === 'likely worse' ? ' · <b class="bad">live looks weaker</b>' : v.text === 'likely better' ? ' · <span class="good">live looks stronger</span>' : '') + '</div>';
        }).join('');
        const done = t.rows.filter(r => !r.error && !r.playing);
        let sum = '';
        if (!t.running && done.length) {
            const W = done.reduce((a, r) => a + r.w, 0), L = done.reduce((a, r) => a + r.l, 0), D = done.reduce((a, r) => a + r.d, 0);
            const worse = done.filter(r => verdict(r.w, r.l).text === 'likely worse');
            sum = `<div style="margin-top:6px;padding-top:6px;border-top:1px solid #2e4a36;">Total: live #${t.live} won <b>${W}</b>, lost <b>${L}</b>, drew ${D}. ` +
                (worse.length ? `<b class="bad">Looks weaker than #${worse.map(r => r.id).join(', #')}. Consider making that one live again.</b>`
                    : W >= L ? '<span class="good">No sign it got weaker.</span>' : 'Lost a bit more than it won, but not clearly.') + '</div>';
        }
        return `<div class="small muted">${t.running ? 'Testing...' : 'Last test: ' + esc(t.at)}</div>${rows}${sum}`;
    }
    function championsHtml(S) {
        if (!S.champs.length) return '<div class="muted">No champions found.</div>';
        const list = S.champs.filter(c => c.promoted !== false);
        const cards = list.map((c, i) => {
            const prev = list[i + 1];
            const copyOf = list.slice(i + 1).find(o => sameWeights(o.weights, c.weights));
            const changes = copyOf ? [`same bot as #${copyOf.id} (made live again)`] : prev ? diff(c.weights, prev.weights) : ['oldest in this list'];
            if (c.weights?.net && c.weights?.netWeight) changes.push('uses a network');
            const rec = (c.confirm_wins || c.confirm_losses || c.confirm_draws) ? `own record ${c.confirm_wins}-${c.confirm_losses}-${c.confirm_draws}` : 'no record of its own';
            return `
                <div class="card">
                    <h4><span>#${c.id} ${i === 0 ? '<span class="tag good">live</span>' : ''}</span><span class="small muted">${day(c.created_at)} · ${rec}</span></h4>
                    ${changes.length ? `<ul class="changes">${changes.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : '<div class="small muted">No setting changed by more than 10%.</div>'}
                    ${i > 0 ? `<div class="row" style="margin-top:8px;"><button class="b" data-restore="${c.id}">Make live again</button></div>` : ''}
                </div>`;
        }).join('');
        return `
            <div class="card testbox">
                <div class="row" style="justify-content:space-between;"><b>Did training lose skill?</b><button class="b primary" data-act="test">Test live vs last 3</button></div>
                <div class="tl-test-out" style="margin-top:6px;">${testHtml(S.lastTest)}</div>
            </div>
            <h3>Champions, newest first</h3>
            <div class="note">"Make live again" puts an older champion back. Every bot uses it from the next page load. Challengers being tested against the current one stop.</div>
            <div class="stack" style="margin-top:8px;">${cards}</div>`;
    }

    // ── Saved games ──────────────────────────────────────────────
    function meter(label, games, marks, pace, note) {
        const max = marks.good * 1.2;
        const st = games >= marks.good ? ['good amount', 'good', '#7fdc8f'] : games >= marks.min ? ['enough to try', 'warn', '#f2cf6a'] : ['not enough yet', 'bad', '#ff8a8a'];
        const next = games < marks.min ? marks.min : games < marks.good ? marks.good : null;
        const eta = next && pace > 0 ? `About ${Math.ceil((next - games) / pace * 7)} day(s) to ${num(next)} at this week's pace.` : next ? 'No games saved this week.' : '';
        return `
            <div class="card">
                <h4><span>${label}</span><span class="${st[1]} small">${st[0]}</span></h4>
                ${bar(100 * games / max, st[2], [100 * marks.min / max, 100 * marks.good / max])}
                <div class="small muted">${num(games)} games · try at ${num(marks.min)} · good at ${num(marks.good)}. ${eta}</div>
                ${note ? `<div class="small muted" style="margin-top:4px;">${note}</div>` : ''}
            </div>`;
    }
    function dataHtml(S) {
        if (S.error) return `<div class="note">${esc(S.error)}</div>`;
        const d = S.data || {};
        const games = (+d.games || 0) + (+d.mined_games || 0), pace = +d.games_7d || 0;
        return `
            <div class="note">Every bot game (training, idle) and every mined real game saves board positions with who won. Fit Formulas and the bot network learn from them.</div>
            <div class="grid" style="margin-top:10px;">
                <div class="card"><h4>Bot games</h4><div class="rec">${num(d.games)}</div></div>
                <div class="card"><h4>Real games</h4><div class="rec">${num(d.mined_games)}</div><div class="small muted">mined from recorded online games</div></div>
                <div class="card"><h4>This week</h4><div class="rec">${num(pace)}</div><div class="small muted">games saved in the last 7 days</div></div>
            </div>
            <h3>Enough to learn from?</h3>
            <div class="stack">
                ${meter('Fit Formulas', games, MARKS.fit, pace, '')}
                ${meter('Bot network', games, MARKS.net, pace, 'Real games help most: they show how people play.')}
            </div>
            <div class="small muted" style="margin-top:8px;">${num(d.rows)} positions in all (${num(d.move_rows)} saved move by move), from ${num(d.accounts)} account(s). The marks are rough rules of thumb.</div>`;
    }

    // ── Test a change ────────────────────────────────────────────
    // A = live champion with one change, B = live champion. Same deals with
    // sides swapped (BotArena.run), every 3rd pair a 4-player game.
    const CHANGES_KEY = 'godaigo_training_lab_changes';
    // Combos in plain words (signature e.g. "WATER_SCROLL_4[hidden tile] > reveal / EARTH_SCROLL_4").
    const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V'];
    const cap = x => x ? x[0].toUpperCase() + x.slice(1) : '';
    function scrollLabel(name) {
        const d = window.SCROLL_DEFINITIONS?.[name];
        return d ? `${d.name} (${cap(d.element)} ${ROMAN[d.level] || d.level})` : name;
    }
    function comboShort(sig) {
        return String(sig || '').split(' / ').map(turn => turn.split(' > ').map(tok => {
            const m = /^([A-Z]+_SCROLL_\d+)/.exec(tok.trim());
            return m ? (window.SCROLL_DEFINITIONS?.[m[1]]?.name || m[1]) : null;
        }).filter(Boolean).join(' > ')).filter(Boolean).join(' / ');
    }
    function comboDetailHtml(c) {
        const turns = String(c.signature || '').split(' / ');
        const steps = turns.map((turn, i) => {
            const parts = turn.split(' > ').map(tok => {
                const t = tok.trim();
                const m = /^([A-Z]+_SCROLL_\d+)(?:\[(.*)\])?$/.exec(t);
                if (!m) return `<div class="small muted" style="margin-left:14px;">then: ${esc(t)}</div>`;
                const d = window.SCROLL_DEFINITIONS?.[m[1]];
                return `<div style="margin-left:14px;">cast <b>${esc(scrollLabel(m[1]))}</b>${m[2] ? ` <span class="muted">· choice: ${esc(m[2])}</span>` : ''}` +
                    (d?.description ? `<div class="small muted">${esc(d.description)}</div>` : '') + '</div>';
            }).join('');
            return `<div style="margin-top:4px;"><b>Turn ${i + 1}</b>${parts}</div>`;
        }).join('');
        const stacked = (c.scrolls || []).map(n => {
            const d = window.SCROLL_DEFINITIONS?.[n];
            return `${cap(d?.element || '?')} tile → ${esc(d?.name || n)}`;
        }).join(', ');
        return `${steps}<div class="small" style="margin-top:6px;">Stacked for seat 1: its next reveals become ${stacked}. It still has to build each pattern and pay the AP.</div>`;
    }
    const PRESETS = {
        drill:    { label: 'Combo drill (stacked deals)', a: 'following combos', b: 'champion ignoring combos' },
        combos:   { label: 'Taught combos in normal games', a: 'with taught combos', b: 'without combos' },
        settings: { label: 'Change settings', a: 'with your change', b: 'live champion' },
        formula:  { label: 'Add a formula', a: 'with your formula', b: 'live champion' },
    };
    function loadChanges() { try { return JSON.parse(localStorage.getItem(CHANGES_KEY)) || []; } catch (e) { return []; } }
    function saveChange(t) { try { localStorage.setItem(CHANGES_KEY, JSON.stringify([t, ...loadChanges()].slice(0, 8))); } catch (e) {} }

    // Parse "key = value" lines against the known settings.
    function parseSettings(text, base) {
        const changes = {}, errors = [];
        String(text || '').split('\n').forEach((raw, i) => {
            const line = raw.replace(/#.*$/, '').trim();
            if (!line) return;
            const m = line.match(/^([A-Za-z_][\w]*)\s*[=:]\s*(.+)$/);
            if (!m) { errors.push(`line ${i + 1}: write it as  name = value`); return; }
            const [, k, vRaw] = m;
            if (!(k in base)) { errors.push(`line ${i + 1}: unknown setting "${k}"`); return; }
            const v = vRaw.trim() === 'true' ? true : vRaw.trim() === 'false' ? false : Number(vRaw);
            if (typeof v === 'number' && !Number.isFinite(v)) { errors.push(`line ${i + 1}: "${vRaw.trim()}" is not a number`); return; }
            changes[k] = v;
        });
        return { changes, errors };
    }

    // Build {a, b, summary} for a preset, or {error}.
    function buildTest(preset, text, live) {
        const base = { ...(window.BotSystem?.DEFAULT_WEIGHTS || {}), ...live };
        if (preset === 'drill') {
            const list = (window.BotSystem?.combos?.() || []).map(c => ({ signature: c.signature, scrolls: [...new Set(c.casts.map(x => x.scroll))].slice(0, 3) }));
            if (!list.length) return { error: 'No taught combos are loaded in this browser yet (reload the page, or check the Combos tab).' };
            return { a: { ...base }, b: { ...base, combosOff: true }, drill: list, summary: `${list.length} taught combos, stacked deals` };
        }
        if (preset === 'combos') {
            const n = window.BotSystem?.combos?.()?.length ?? null;
            return { a: { ...base }, b: { ...base, combosOff: true }, summary: `taught combos on vs off${n != null ? ` (${n} loaded)` : ''}` };
        }
        if (preset === 'settings') {
            const { changes, errors } = parseSettings(text, base);
            if (errors.length) return { error: errors.join('\n') };
            const keys = Object.keys(changes);
            if (!keys.length) return { error: 'Write at least one line, for example:  discardFeeds = -14' };
            return { a: { ...base, ...changes }, b: base, summary: keys.map(k => `${k} ${base[k]} → ${changes[k]}`).join(', ') };
        }
        if (preset === 'formula') {
            const { terms, errors } = window.BotTerms.parseLines(text, 'hermit');
            if (errors.length) return { error: errors.map(e => `line ${e.line}: ${e.message}`).join('\n') };
            if (!terms.length) return { error: 'Write a formula line, for example:  5: freeNearHome' };
            const old = Array.isArray(base.terms) ? base.terms : [];
            const all = [...old, ...terms.filter(t => !old.some(o => o.text === t.text))].slice(0, window.BotTerms.MAX_TERMS);
            return { a: { ...base, terms: all }, b: base, summary: terms.map(t => `${t.w}: ${t.text}`).join(' | ') };
        }
        return { error: 'Pick a test.' };
    }

    function changeResultHtml(t) {
        if (!t) return '';
        const P = PRESETS[t.preset] || PRESETS.settings;
        if (t.error) return `<div class="bad" style="white-space:pre-line;">${esc(t.error)}</div>`;
        const head = `<div class="small muted">${esc(P.label)}: ${esc(t.summary)} · ${esc(t.at)}</div>`;
        if (t.running) return head + `<div class="warn">Game ${t.done} of ${t.games}... (${P.a} ${t.w}-${t.l}-${t.d})</div>` +
            (t.current ? `<div class="card" style="margin-top:8px;"><b>Now testing, deal ${t.current.k} of ${t.current.deals}:</b> ${esc(comboShort(t.current.combo.signature))}${comboDetailHtml(t.current.combo)}</div>` : '');
        const p = chanceBetter(t.w, t.l);
        const helps = p >= 0.9, hurts = p <= 0.1;
        const word = helps ? `<b class="good">It helps.</b>` : hurts ? `<b class="bad">It hurts.</b>` : '<b class="warn">No clear difference yet.</b> More games would tell.';
        let next = '';
        if (t.preset === 'drill' || t.preset === 'combos') {
            next = helps ? 'The taught combos make the bots stronger: the miner is doing real work.'
                : hurts ? 'The bots play better without them. Turn the weak combos Off in the Combos tab, or make teaching need a win test.'
                : 'Run 48 games for a clearer answer.';
        } else if (!hurts) {
            next = `<div class="row" style="margin-top:6px;"><button class="b primary" data-act="tc-live">Make it live now</button>
                <button class="b" data-act="tc-idle">Send to idle training</button></div>
                <div class="small muted" style="margin-top:4px;">"Make it live now" skips the 40-game rule; you can undo it in the Champions tab.</div>`;
        }
        const per = t.perCombo ? `<ul class="changes">${Object.entries(t.perCombo).map(([sig, r]) => {
            const q = chanceBetter(r.w, r.l), cls = q >= 0.8 ? 'good' : q <= 0.2 ? 'bad' : 'muted';
            const c = (t.drillList || []).find(x => x.signature === sig) || { signature: sig };
            return `<li><details><summary style="margin:0;color:inherit;"><span class="${cls}">${r.w}-${r.l}-${r.d}</span> ${esc(comboShort(sig))}</summary>${comboDetailHtml(c)}</details></li>`;
        }).join('')}</ul><div class="small muted">Per combo: won-lost-drawn when following it. Only a few deals each, so look for clear patterns, not single results.</div>` : '';
        return `${head}
            <div style="margin-top:4px;"><span class="rec">${t.w}-${t.l}-${t.d}</span> <span class="small muted">${esc(P.a)} won-lost-drawn vs ${esc(P.b)}</span></div>
            <div style="margin-top:4px;">${word} <span class="muted small">Chance the change really helps: ${Math.round(100 * p)}%.</span></div>
            <div class="small" style="margin-top:4px;">${next}</div>${per}`;
    }

    function testChangeHtml(S) {
        const preset = S.tcPreset || 'drill';
        const hist = loadChanges();
        const hint = preset === 'settings' ? 'One per line, for example:\ndiscardFeeds = -14\nevalStoneNeeded = 15'
            : preset === 'formula' ? 'One per line:  weight: formula   (for example  5: freeNearHome)' : '';
        return `
            <div class="note">The quickest way to know if a change makes the bots stronger. Both sides play the same deals with seats swapped; every 3rd pair is a 4-player game. Your own fixes found the biggest gains so far, and this is the tool for testing them.</div>
            <h3>1. What to test</h3>
            <div class="row">${Object.entries(PRESETS).map(([k, v]) => `<button class="b ${k === preset ? 'primary' : ''}" data-tc-preset="${k}">${esc(v.label)}</button>`).join('')}</div>
            ${preset === 'drill' ? `<div class="small muted" style="margin-top:6px;">Each deal is stacked for seat 1, like the tutorial: the next tiles it reveals become the elements of one taught combo, and it draws that combo's scrolls. The deal is played twice with seats swapped, so the combo bot and the champion (ignoring combos) each get the stacked seat once. Combos take turns, one per deal.</div>${(() => {
                const list = window.BotSystem?.combos?.() || [];
                if (!list.length) return '<div class="small warn" style="margin-top:4px;">No taught combos are loaded in this browser yet.</div>';
                return `<details style="margin-top:4px;"><summary>The ${list.length} taught combo${list.length === 1 ? '' : 's'} it will test</summary><div class="stack">${list.map((c, i) =>
                    `<div class="card small"><b>${i + 1}. ${esc(comboShort(c.signature))}</b>${comboDetailHtml({ signature: c.signature, scrolls: [...new Set(c.casts.map(x => x.scroll))].slice(0, 3) })}</div>`).join('')}</div></details>`;
            })()}`
            : preset === 'combos' ? `<div class="small muted" style="margin-top:6px;">Normal random deals: the live champion with the taught combos against the same champion that ignores them. Most games never give a bot a combo's scrolls, so this shows the real-game effect, which is usually small.</div>`
                : `<textarea class="tc-text" spellcheck="false" placeholder="${esc(hint)}" style="margin-top:8px;width:100%;min-height:80px;background:#11111a;color:#e6e6ee;border:1px solid #3c3c52;border-radius:8px;padding:8px;font:12.5px/1.4 ui-monospace,Consolas,monospace;">${esc(S.tcText?.[preset] || '')}</textarea>`}
            <h3>2. How many games</h3>
            <div class="row">${[12, 24, 48].map(n => `<button class="b ${n === (S.tcGames || 24) ? 'primary' : ''}" data-tc-games="${n}">${n}</button>`).join('')}
                <span class="small muted">24 takes a few minutes; 48 gives a clearer answer.</span></div>
            <h3>3. Run</h3>
            <div class="row"><button class="b primary" data-act="tc-run" ${S.tcRun?.running ? 'disabled' : ''}>Run the test</button></div>
            <div class="card testbox tc-out" style="margin-top:8px;${S.tcRun ? '' : 'display:none;'}">${changeResultHtml(S.tcRun)}</div>
            ${hist.length ? `<h3>Earlier tests</h3><div class="stack">${hist.map(t => {
                const p = chanceBetter(t.w, t.l), cls = p >= 0.9 ? 'good' : p <= 0.1 ? 'bad' : 'warn';
                return `<div class="card small"><b>${esc((PRESETS[t.preset] || PRESETS.settings).label)}</b> · ${esc(t.summary)}<br><span class="rec" style="font-size:14px;">${t.w}-${t.l}-${t.d}</span> <span class="${cls}">${Math.round(100 * p)}% chance it helps</span> <span class="muted">· ${esc(t.at)}</span></div>`;
            }).join('')}</div>` : ''}`;
    }

    // ── Warm-up ──────────────────────────────────────────────────
    const WARM_KEY = 'godaigo_training_lab_warmup';
    const WARM = { seeds: 3, tries: 20, findTries: 10, sigma: 0.2, nudge: 0.12, skipMax: 3 };
    function warmResultHtml(W) {
        if (!W) return '';
        const lines = (W.log || []).map(l => `<li class="${l.cls || ''}">${esc(l.text)}</li>`).join('');
        let exam = '';
        if (W.exam) {
            const e = W.exam, dec = e.w + e.l, rate = dec ? e.w / dec : 0, p = chanceBetter(e.w, e.l);
            const pass = !e.running && dec >= DECIDED_FOR_VERDICT * 0.5 && rate >= 0.58;
            exam = `<div class="card" style="margin-top:8px;"><b>Exam on fresh deals:</b> <span class="rec">${e.w}-${e.l}-${e.d}</span>
                <span class="small muted">${e.running ? `game ${e.done} of ${e.games}` : `win rate ${Math.round(100 * rate)}% of decided games, ${Math.round(100 * p)}% chance it is better`}</span>
                ${e.running ? '' : `<div style="margin-top:4px;">${pass ? '<b class="good">Passed</b> (58%+ like the idle rule).' : p >= 0.9 ? '<b class="warn">Better, but under 58%.</b>' : '<b class="bad">Not better.</b>'}</div>
                <div class="row" style="margin-top:6px;"><button class="b primary" data-act="wu-live">Make it live now</button><button class="b" data-act="wu-idle">Send to idle training</button></div>`}</div>`;
        }
        return `<div class="small muted">${esc(W.at || '')} · games played ${W.games || 0}${W.running ? ' · running' : ''}</div>
            <ul class="changes" style="margin-top:6px;">${lines}</ul>${exam}`;
    }
    function warmHtml(S) {
        const W = S.warm;
        const games = S.wuExam || 40;
        return `
            <div class="note">The challenger first fixes games it actually lost. It finds a deal it loses (each deal is played twice with seats swapped), then nudges its settings until one version wins that deal both ways. Then it must win deals 1 and 2, then 1, 2 and 3. Only then does it take the normal exam on fresh deals, which alone decides if it is better.</div>
            <h3>Exam size</h3>
            <div class="row">${[24, 40].map(n => `<button class="b ${n === games ? 'primary' : ''}" data-wu-exam="${n}">${n} games</button>`).join('')}
                <span class="small muted">Warm-up: ${WARM.seeds} lost deals, up to ${WARM.tries} tries each.</span></div>
            <div class="row" style="margin-top:10px;">
                <button class="b primary" data-act="wu-run" ${W?.running ? 'disabled' : ''}>Start warm-up</button>
                <button class="b" data-act="wu-stop" ${W?.running ? '' : 'disabled'}>Stop</button></div>
            <div class="card testbox wu-out" style="margin-top:8px;${W ? '' : 'display:none;'}">${warmResultHtml(W)}</div>`;
    }

    // ── Panel ────────────────────────────────────────────────────
    function open() {
        if (!window.isHermit?.()) return;
        document.getElementById('training-lab')?.remove();
        if (!document.getElementById('training-lab-css')) {
            const st = document.createElement('style');
            st.id = 'training-lab-css';
            st.textContent = CSS;
            document.head.appendChild(st);
        }
        const box = document.createElement('div');
        box.id = 'training-lab';
        const tabs = [['overview', 'Overview'], ['test', 'Test a change'], ['warm', 'Warm-up'], ['challengers', 'Challengers'], ['champions', 'Champions'], ['data', 'Saved games']];
        let tab = 'overview';
        try { tab = localStorage.getItem(TAB_KEY) || tab; } catch (e) {}
        if (!tabs.some(t => t[0] === tab)) tab = 'overview';
        box.innerHTML = `
            <div class="tl-head">
                <div class="tl-title"><h2>Training Lab</h2>
                    <div class="row"><button class="b" data-act="refresh">Refresh</button><button class="b" data-act="min" title="Minimize: watch the games, keep the progress in view">–</button><button class="b" data-act="close">✕</button></div></div>
                <div class="tl-mini">No test running.</div>
                <div class="tl-sum"><span class="chip">Loading...</span></div>
            </div>
            <div class="tl-tabs">${tabs.map(([k, l]) => `<button class="tl-tab" data-tab="${k}">${l}</button>`).join('')}</div>
            <div class="tl-body">${tabs.map(([k]) => `<div class="tl-pane" data-pane="${k}"><div class="muted">Loading...</div></div>`).join('')}</div>`;
        document.body.appendChild(box);
        const $ = s => box.querySelector(s);
        const pane = k => box.querySelector(`[data-pane="${k}"]`);
        const MIN_KEY = 'godaigo_training_lab_min';
        const setMin = (on) => {
            box.classList.toggle('min', !!on);
            const b = box.querySelector('[data-act="min"]');
            if (b) { b.textContent = on ? '▢' : '–'; b.title = on ? 'Open the full Lab again' : 'Minimize: watch the games, keep the progress in view'; }
            try { localStorage.setItem(MIN_KEY, on ? '1' : '0'); } catch (e) {}
        };
        const mini = (text) => { const m = box.querySelector('.tl-mini'); if (m) m.textContent = text; };
        // One line for the minimized box, for a "Test a change" run.
        const miniChange = (t) => {
            const P = PRESETS[t.preset] || PRESETS.settings;
            if (t.error) return mini(`${P.label}: ${t.error.split('\n')[0]}`);
            if (t.running && t.current) return mini(`Deal ${t.current.k} of ${t.current.deals}: ${comboShort(t.current.combo.signature)} · games done ${t.done} · following combos ${t.w}-${t.l}-${t.d}`);
            if (t.running) return mini(`${P.label}: game ${t.done} of ${t.games} · ${P.a} ${t.w}-${t.l}-${t.d}`);
            mini(`${P.label}, done: ${t.w}-${t.l}-${t.d} · ${Math.round(100 * chanceBetter(t.w, t.l))}% chance it helps`);
        };

        const S = { champs: [], candidates: [], data: null, taught: null, error: null, lastTest: null };
        try { const t = JSON.parse(localStorage.getItem(TEST_KEY)); if (t?.rows) S.lastTest = { ...t, running: false }; } catch (e) {}
        try { const w = JSON.parse(localStorage.getItem(WARM_KEY)); if (w?.log) { S.warm = { ...w, running: false, exam: w.exam ? { ...w.exam, running: false } : null }; S.wuWeights = w.weights || null; } } catch (e) {}

        const show = k => {
            tab = k;
            try { localStorage.setItem(TAB_KEY, k); } catch (e) {}
            box.querySelectorAll('.tl-tab').forEach(b => b.classList.toggle('on', b.dataset.tab === k));
            box.querySelectorAll('.tl-pane').forEach(p => p.classList.toggle('on', p.dataset.pane === k));
            if (k === 'warm' && !pane('warm').querySelector('[data-act="wu-run"]')) renderWarm();   // needs no server data
        };
        const render = () => {
            const live = S.champs[0];
            const open = S.candidates.filter(c => c.status === 'open').length;
            const games = (+S.data?.games || 0) + (+S.data?.mined_games || 0);
            $('.tl-sum').innerHTML = [
                live ? `<span class="chip">Live bot <b>#${live.id}</b> since ${day(live.created_at)}</span>` : '',
                `<span class="chip"><b>${open}</b> challenger${open === 1 ? '' : 's'} being tested</span>`,
                S.data ? `<span class="chip"><b>${num(games)}</b> games saved</span>` : '',
            ].join('');
            pane('overview').innerHTML = overviewHtml(S);
            renderTest();
            pane('challengers').innerHTML = challengersHtml(S);
            pane('champions').innerHTML = championsHtml(S);
            pane('data').innerHTML = dataHtml(S);
            pane('warm').innerHTML = warmHtml(S);
            show(tab);
        };

        const renderTest = () => {
            const ta = pane('test').querySelector('.tc-text');
            if (ta) { S.tcText = S.tcText || {}; S.tcText[S.tcPreset || 'drill'] = ta.value; }
            pane('test').innerHTML = testChangeHtml(S);
        };
        const runChange = async () => {
            const ta = pane('test').querySelector('.tc-text');
            const preset = S.tcPreset || 'drill';
            if (ta) { S.tcText = S.tcText || {}; S.tcText[preset] = ta.value; }
            const live = S.champs.find(c => c.promoted !== false)?.weights || { ...(window.BotSystem?.WEIGHTS || {}) };
            const T = buildTest(preset, S.tcText?.[preset] || '', live);
            const games = S.tcGames || 24;
            const t = S.tcRun = { preset, summary: T.summary || '', at: new Date().toLocaleString(), games, done: 0, w: 0, l: 0, d: 0, running: !T.error, error: T.error || null };
            renderTest();
            if (T.error) return;
            S.tcWeights = T.a;
            try { await window.LazyScripts?.load?.('bot-arena'); } catch (e) {}
            if (T.drill) {
                t.perCombo = {};
                t.drillList = T.drill;
                const deals = Math.max(1, Math.round(games / 2));
                const seed0 = (Date.now() % 100000) >>> 0;
                try {
                    for (let k = 0; k < deals; k++) {
                        const c = T.drill[k % T.drill.length];
                        const pc = t.perCombo[c.signature] || (t.perCombo[c.signature] = { w: 0, l: 0, d: 0 });
                        t.current = { k: k + 1, deals, combo: c };
                        { const o = pane('test').querySelector('.tc-out'); if (o) o.innerHTML = changeResultHtml(t); miniChange(t); }
                        const r = await window.BotArena.run(T.a, T.b, 2, seed0 + k, {
                            visual: false, comboWatch: false, positionLog: false, stack: { seat: 0, scrolls: c.scrolls },
                        });
                        t.w += r.aWins; t.l += r.bWins; t.d += r.draws; t.done += 2;
                        pc.w += r.aWins; pc.l += r.bWins; pc.d += r.draws;
                        const o = pane('test').querySelector('.tc-out'); if (o) o.innerHTML = changeResultHtml(t); miniChange(t);
                    }
                } catch (e) { t.error = 'Test failed: ' + (e.message || e); }
                t.games = t.done;
                t.current = null;
            } else try {
                const r = await window.BotArena.run(T.a, T.b, games, (Date.now() % 100000) >>> 0, {
                    visual: false, comboWatch: false, fourPlayerEvery: 3,
                    onGame: (i, n, g, info) => {
                        t.done = i;
                        if (g?.winner == null) t.d++; else if (info?.aWon) t.w++; else t.l++;
                        const o = pane('test').querySelector('.tc-out'); if (o) o.innerHTML = changeResultHtml(t); miniChange(t);
                    },
                });
                Object.assign(t, { w: r.aWins, l: r.bWins, d: r.draws });
            } catch (e) { t.error = 'Test failed: ' + (e.message || e); }
            t.running = false;
            if (!t.error) saveChange({ preset: t.preset, summary: t.summary, at: t.at, w: t.w, l: t.l, d: t.d, perCombo: t.perCombo || null, drillList: t.drillList || null });
            console.log(`🧪 [TrainingLab] test "${t.summary}": ${t.w}-${t.l}-${t.d}`);
            miniChange(t);
            if (!box.isConnected) document.body.appendChild(box);
            box.style.zIndex = '10090';
            show('test');
            renderTest();
        };
        const keepChange = async (where, w = S.tcWeights, rec = S.tcRun, kind = rec?.preset === 'formula' ? 'formula' : 'explore') => {
            if (!w || !rec || rec.running) return;
            if (where === 'live') {
                if (!confirm('Make this the live champion now? Every bot uses it from the next page load. You can undo it in the Champions tab.')) return;
                const { data: u } = await supabase.auth.getUser();
                const { error } = await supabase.from('bot_champion_weights').insert({
                    weights: w, confirm_wins: rec.w, confirm_losses: rec.l, confirm_draws: rec.d, promoted: true, created_by: u?.user?.id,
                });
                if (error) { alert('Failed: ' + error.message); return; }
                alert('Done: it is the live champion. Reload the page to play against it.');
                return refresh();
            }
            const { data: job, error } = await supabase.rpc('idle_training_job');
            if (error || !job?.champion_id) { alert('Failed: ' + (error?.message || 'no champion')); return; }
            const r = await supabase.rpc('idle_training_new', { p_champion: job.champion_id, p_weights: w, p_kind: kind });
            if (r.error) { alert('Failed: ' + r.error.message); return; }
            alert(`Sent: challenger #${r.data?.id ?? '?'} in idle training.`);
            refresh();
        };

        // Warm-up run (see the Warm-up tab note). Deals are seeds; BotArena.run(a, b, 2, seed)
        // plays one deal twice with seats swapped, so "cleared" = won both games.
        const warmDraw = () => {
            const W = S.warm; if (!W) return;
            const o = pane('warm').querySelector('.wu-out'); if (o) { o.style.display = ''; o.innerHTML = warmResultHtml(W); }
            const last = (W.log || [])[W.log.length - 1];
            mini(W.exam ? `Warm-up exam: ${W.exam.w}-${W.exam.l}-${W.exam.d}${W.exam.running ? ` (game ${W.exam.done} of ${W.exam.games})` : ' (done)'}` : `Warm-up: ${last ? last.text : 'starting'} · games ${W.games}`);
        };
        const runWarm = async () => {
            const champ = S.champs.find(c => c.promoted !== false)?.weights || { ...(window.BotSystem?.WEIGHTS || {}) };
            try { await window.LazyScripts?.load?.('bot-arena'); } catch (e) {}
            const A = window.BotArena;
            const W = S.warm = { running: true, at: new Date().toLocaleString(), games: 0, log: [], exam: null, cleared: [] };
            S.wuStopNow = false;
            renderWarm();
            const say = (text, cls) => { W.log.push({ text, cls }); warmDraw(); console.log('🔥 [TrainingLab warm-up] ' + text); };
            const opts = { visual: false, comboWatch: false, positionLog: false };
            let seed = ((Date.now() % 1000000) >>> 0) * 7 + 11;
            const nextSeed = () => (seed += 101);
            const pair = async (w, sd) => { const r = await A.run(w, champ, 2, sd, opts); W.games += 2; return r; };
            // every deal in `set` won both ways (newest first: it is the one most likely to fail)
            const clearsAll = async (w, set) => {
                for (const sd of [...set].reverse()) { const r = await pair(w, sd); if (r.aWins < 2) return false; if (S.wuStopNow) return false; }
                return true;
            };
            let cur = A.perturbWeights({ ...window.BotSystem.DEFAULT_WEIGHTS, ...champ }, WARM.sigma);
            let skipped = 0;
            try {
                while (W.cleared.length < WARM.seeds && !S.wuStopNow) {
                    // 1. a deal the challenger loses (at least one of the two games)
                    let lost = null;
                    for (let k = 0; k < WARM.findTries && !S.wuStopNow; k++) {
                        const sd = nextSeed(), r = await pair(cur, sd);
                        if (r.aWins < 2) { lost = { sd, r }; break; }
                    }
                    if (S.wuStopNow) break;
                    if (!lost) { say(`It won ${WARM.findTries} deals in a row both ways: nothing left to fix, on to the exam.`, 'good'); break; }
                    const n = W.cleared.length + 1;
                    say(`Deal ${n}: it lost deal #${lost.sd} (${lost.r.aWins}-${lost.r.bWins}-${lost.r.draws}). Nudging its settings...`);
                    // 2. nudge until one version wins every deal so far, both ways
                    const set = [...W.cleared, lost.sd];
                    let fixed = null;
                    for (let t = 1; t <= WARM.tries && !S.wuStopNow; t++) {
                        const m = A.perturbWeights(cur, WARM.nudge);
                        if (await clearsAll(m, set)) { fixed = { m, t }; break; }
                        if (t % 5 === 0) { W.log[W.log.length - 1].text = `Deal ${n}: lost deal #${lost.sd}. Tried ${t} versions so far...`; warmDraw(); }
                    }
                    if (S.wuStopNow) break;
                    if (fixed) {
                        cur = fixed.m; W.cleared = set;
                        say(`Deal ${n} fixed after ${fixed.t} tr${fixed.t === 1 ? 'y' : 'ies'}: it now wins deal${set.length > 1 ? 's' : ''} ${set.map(x => '#' + x).join(', ')} both ways.`, 'good');
                    } else {
                        skipped++;
                        say(`Deal #${lost.sd}: no version won it in ${WARM.tries} tries (maybe a bad-luck deal). Skipped${skipped >= WARM.skipMax ? ', and that was the last skip allowed' : ', trying another lost deal'}.`, 'warn');
                        if (skipped >= WARM.skipMax) break;
                    }
                }
                if (S.wuStopNow) say('Stopped.', 'warn');
                else {
                    // 3. the normal exam on fresh deals decides
                    const games = S.wuExam || 40;
                    say(`Warm-up done: ${W.cleared.length} lost deal${W.cleared.length === 1 ? '' : 's'} fixed. Exam: ${games} games on fresh deals...`);
                    W.exam = { running: true, w: 0, l: 0, d: 0, done: 0, games };
                    warmDraw();
                    const r = await A.run(cur, champ, games, nextSeed() + 50000, {
                        ...opts, fourPlayerEvery: 3,
                        onGame: (i, nn, g, info) => { W.exam.done = i; if (g?.winner == null) W.exam.d++; else if (info?.aWon) W.exam.w++; else W.exam.l++; warmDraw(); },
                    });
                    Object.assign(W.exam, { w: r.aWins, l: r.bWins, d: r.draws, running: false });
                    W.games += games;
                    S.wuWeights = W.weights = cur;
                }
            } catch (e) { say('Warm-up failed: ' + (e.message || e), 'bad'); }
            W.running = false;
            try { localStorage.setItem(WARM_KEY, JSON.stringify({ ...W, running: false })); } catch (e) {}
            if (!box.isConnected) document.body.appendChild(box);
            box.style.zIndex = '10090';
            show('warm');
            renderWarm();
        };
        const renderWarm = () => { pane('warm').innerHTML = warmHtml(S); };

        const refresh = async () => {
            S.error = null;
            try { S.champs = await loadChampions(); } catch (e) { S.error = 'Could not load champions: ' + (e.message || e); }
            const [lab, taught] = await Promise.all([supabase.rpc('hermit_training_lab', { p_limit: 40 }), loadTaughtCombos()]);
            S.taught = taught;
            if (lab.error) {
                S.error = /function|does not exist|schema cache/i.test(lab.error.message || '') ? 'Run sql/training-lab.sql in the Supabase SQL editor first.' : (lab.error.message || String(lab.error));
                S.candidates = []; S.data = null;
            } else {
                S.candidates = lab.data?.candidates || [];
                S.data = lab.data?.data || null;
                // Champions the challengers were made from may be older than the list.
                const need = [...new Set(S.candidates.map(c => c.champion_id))].filter(id => !S.champs.some(c => c.id === id));
                if (need.length) {
                    const r = await supabase.from('bot_champion_weights').select('id, weights, promoted').in('id', need);
                    if (!r.error) S.champs = [...S.champs, ...(r.data || []).map(c => ({ ...c, promoted: false }))];
                }
            }
            render();
        };

        const runTest = async () => {
            const list = S.champs.filter(c => c.promoted !== false);
            const btn = box.querySelector('[data-act="test"]');
            const draw = () => {
                const o = box.querySelector('.tl-test-out'); if (o) o.innerHTML = testHtml(S.lastTest);
                const t = S.lastTest;
                if (t) mini(`Live vs last 3: ` + t.rows.map(r => r.error ? `#${r.id} failed` : r.playing ? `#${r.id} ${r.playing}` : `#${r.id} ${r.w}-${r.l}-${r.d}`).join(' · ') + (t.running ? '' : ' (done)'));
            };
            if (list.length < 2) { S.lastTest = { running: false, at: '-', live: '?', rows: [{ id: '-', error: 'need at least 2 champions' }] }; draw(); return; }
            if (btn) btn.disabled = true;
            const live = list[0];
            const t = S.lastTest = { running: true, at: new Date().toLocaleString(), live: live.id, rows: [] };
            try { await window.LazyScripts?.load?.('bot-arena'); } catch (e) {}
            for (const old of list.slice(1, 4)) {
                const row = { id: old.id, playing: 'starting...' };
                t.rows.push(row);
                draw();
                try {
                    const r = await window.BotArena.run(live.weights, old.weights, 10, (Date.now() % 100000) >>> 0, {
                        visual: false, comboWatch: false,
                        onGame: (i, n, g, info) => {
                            row.playing = `game ${i} of ${n}` + (info ? (g?.winner == null ? ' (draw)' : info.aWon ? ' (live won)' : ' (old won)') : '');
                            draw();
                        },
                    });
                    delete row.playing;
                    Object.assign(row, { w: r.aWins, l: r.bWins, d: r.draws });
                } catch (e) { delete row.playing; row.error = e.message || String(e); }
                draw();
            }
            t.running = false;
            draw();
            try { localStorage.setItem(TEST_KEY, JSON.stringify(t)); } catch (e) {}
            console.log('🧪 [TrainingLab] live champion #' + live.id + ' vs older champions: ' +
                t.rows.map(r => r.error ? `#${r.id} failed (${r.error})` : `#${r.id} ${r.w}-${r.l}-${r.d}`).join(', '));
            // Arena games swap the screen; bring the Lab back to the front with the result in view.
            if (!box.isConnected) document.body.appendChild(box);
            box.style.zIndex = '10090';
            show('champions');
            box.querySelector('.tl-test-out')?.scrollIntoView({ block: 'center' });
            if (btn) btn.disabled = false;
        };

        // One click handler for the whole panel.
        box.addEventListener('click', async (ev) => {
            const el = ev.target.closest('button');
            if (!el || !box.contains(el)) return;
            if (el.dataset.tab) return show(el.dataset.tab);
            if (el.dataset.tcPreset) { renderTest(); S.tcPreset = el.dataset.tcPreset; return renderTest(); }
            if (el.dataset.tcGames) { renderTest(); S.tcGames = +el.dataset.tcGames; return renderTest(); }
            if (el.dataset.wuExam) { S.wuExam = +el.dataset.wuExam; return renderWarm(); }
            if (el.dataset.reject) {
                if (!confirm(`Reject challenger #${el.dataset.reject}? Idle training stops testing it.`)) return;
                el.disabled = true;
                const r = await supabase.rpc('hermit_reject_candidate', { p_id: +el.dataset.reject });
                if (r.error) { alert('Reject failed: ' + r.error.message); el.disabled = false; return; }
                return refresh();
            }
            if (el.dataset.restore) {
                const id = +el.dataset.restore;
                if (!confirm(`Make champion #${id} live again? Every bot uses it from the next page load, and challengers being tested now stop.`)) return;
                el.disabled = true;
                const r = await supabase.rpc('hermit_restore_champion', { p_id: id });
                if (r.error) {
                    alert(/function|does not exist|schema cache/i.test(r.error.message || '') ? 'Run the newest sql/training-lab.sql in the SQL editor first.' : 'Failed: ' + r.error.message);
                    el.disabled = false; return;
                }
                if (r.data && r.data.ok === false) { alert('Not changed: ' + (r.data.reason || 'unknown')); el.disabled = false; return; }
                alert(`Done. Champion #${id} is live again (new entry #${r.data?.new_id ?? '?'}). Reload the page to play against it.`);
                return refresh();
            }
            switch (el.dataset.act) {
                case 'close': box.remove(); break;
                case 'min': setMin(!box.classList.contains('min')); break;
                case 'refresh': refresh(); break;
                case 'test': runTest(); break;
                case 'tc-run': runChange(); break;
                case 'tc-live': keepChange('live'); break;
                case 'tc-idle': keepChange('idle'); break;
                case 'wu-run': runWarm(); break;
                case 'wu-stop': S.wuStopNow = true; el.disabled = true; break;
                case 'wu-live': keepChange('live', S.wuWeights, S.warm?.exam, 'explore'); break;
                case 'wu-idle': keepChange('idle', S.wuWeights, S.warm?.exam, 'explore'); break;
                case 'tab-data': show('data'); break;
                case 'tab-test': show('test'); break;
                case 'trainbot': if (typeof window._gami_openTrainBot === 'function') window._gami_openTrainBot(); break;
                case 'formulalab': window.FormulaLab?.open(); break;
                case 'fit': window.FormulaFit?.open(); break;
                case 'net': window.BotNet?.open(); break;
                case 'combos': window.Replay?.openBrowser?.('combos'); break;
                case 'puzzles': window.Replay?.openBrowser?.('puzzles'); break;
                case 'scrolls': try { await window.LazyScripts?.load?.('bot-arena'); } catch (e) {} window.BotArena?.openScrollReport?.(); break;
                case 'imitation':
                    if (window.BotImitation) { window.BotImitation.setEnabled(!window.BotImitation.isEnabled()); render(); }
                    break;
            }
        });

        show(tab);
        try { if (localStorage.getItem(MIN_KEY) === '1') setMin(true); } catch (e) {}
        refresh();
    }

    window.TrainingLab = { open, chanceBetter, verdict, diff };
})();
