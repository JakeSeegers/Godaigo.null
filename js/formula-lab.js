// formula-lab.js: window.FormulaLab, the hermit's "Formula Lab" (hermit menu).
//
// Write new bot "senses" as formulas (js/bot-terms.js), one per line:
//   weight: formula   # note
// then Check them, Quick test each one (the current champion plus that one
// term, against the plain champion), or queue them for the next Train Bot
// run: each idea becomes a round-1 challenger (champion + that term), and
// "let training invent formulas" also turns on term mutations for that run
// (BotArena.hillClimb opts.termMutations). The queue is used once.
//
// The starter ideas were suggested by Claude (Option C: ideas come in as
// safe formulas, never as code). Storage: localStorage godaigo_formula_lab
// ({text, queued, invent}). No effect on anyone else until a run with them
// beats the champion and is saved like any other promotion.
(function () {
    'use strict';

    const KEY = 'godaigo_formula_lab';
    const STARTER = [
        '# Ideas suggested by Claude. One per line:  weight: formula   # note',
        '-3: gt(myActivated, 2) * homeCost   # from 3 elements on, prepare a cheap road home early',
        '5: freeNearHome   # free-to-walk stones (wind, chained water) near my home',
        '3: adjacent(water, wind)   # water chained to wind is a cheap free road',
        '8: neededStones * lt(sourceLeft, 10)   # stones I need are worth more when the supply runs low',
        '30: gt(leaderActivated, 3) * myActivated   # an opponent is close to winning: my own elements count more',
    ].join('\n');

    function load() {
        try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; }
    }
    function save(st) {
        try { localStorage.setItem(KEY, JSON.stringify(st)); } catch (e) {}
    }

    function esc(s) {
        return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    // The current champion (same rule as everywhere: newest promoted row).
    async function fetchChampion() {
        try {
            if (typeof supabase !== 'undefined' && supabase?.from) {
                const { data } = await supabase.from('bot_champion_weights').select('weights')
                    .order('promoted', { ascending: false }).order('created_at', { ascending: false }).limit(1);
                if (data?.[0]?.weights) return data[0].weights;
            }
        } catch (e) {}
        return { ...(window.BotSystem?.WEIGHTS || {}) };
    }

    // anchor + one extra term (kept only if there is room)
    function withTerm(anchor, term) {
        const terms = [...(anchor.terms || []).map(t => ({ ...t }))];
        if (terms.length >= window.BotTerms.MAX_TERMS) return null;
        terms.push({ ...term });
        return { ...anchor, terms };
    }

    // Called by game-ui.js runHillClimbTraining (hermit): the queued ideas as
    // round-1 challengers, then clears the queue. null when nothing queued.
    function takeQueued(anchor) {
        const st = load();
        if (!st.queued || !window.BotTerms) return null;
        const { terms } = window.BotTerms.parseLines(st.text ?? STARTER, 'claude');
        st.queued = false;
        save(st);
        const challengers = terms.map(t => withTerm(anchor, t)).filter(Boolean);
        return { challengers, invent: !!st.invent, count: challengers.length };
    }

    let testing = false;

    function open() {
        if (!(typeof window.isHermit === 'function' && window.isHermit())) return;
        document.getElementById('formula-lab')?.remove();
        const st = load();
        const T = window.BotTerms;
        const ov = document.createElement('div');
        ov.id = 'formula-lab';
        Object.assign(ov.style, { position: 'fixed', inset: '0', background: 'rgba(0,0,0,0.65)', zIndex: 10060,
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' });
        const btn = 'padding:6px 12px;background:#1d2a3a;color:#eee;border:1px solid #4a6a95;border-radius:5px;cursor:pointer;font-size:13px;';
        ov.innerHTML = `
          <div style="background:#12121c;color:#ddd;border:1px solid #4a6a95;border-radius:8px;padding:14px 16px;width:100%;max-width:760px;max-height:90vh;overflow:auto;font:13px/1.45 system-ui,sans-serif;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
              <b style="font-size:17px;color:#9cc4ff;">Formula Lab</b>
              <button data-act="close" style="${btn}">Close</button>
            </div>
            <div style="color:#aaa;margin-bottom:8px;">New bot senses as safe formulas. One per line: <code>weight: formula   # note</code>. A positive weight means "the bot likes more of this".
              Operators: <code>+ - * /</code>, <code>min(a, b)</code>, <code>max(a, b)</code>, <code>gt(a, b)</code> (1 if a &gt; b), <code>lt(a, b)</code>, <code>abs(a)</code>.</div>
            <details style="margin-bottom:8px;"><summary style="cursor:pointer;color:#9cc4ff;">Inputs the formulas can use</summary>
              <div style="columns:2;column-gap:18px;margin-top:6px;">${T.inputList().map(x => `<div><code>${x.name}</code>: ${esc(x.label)}</div>`).join('')}</div>
            </details>
            <textarea data-el="text" spellcheck="false" style="width:100%;box-sizing:border-box;height:170px;background:#0b0b12;color:#e6e6e6;border:1px solid #333;border-radius:5px;padding:8px;font:12px/1.5 ui-monospace,Menlo,monospace;"></textarea>
            <div style="display:flex;gap:8px;flex-wrap:wrap;margin:8px 0;">
              <button data-act="check" style="${btn}">Check</button>
              <button data-act="test" style="${btn}">Quick test</button>
              <label style="display:flex;align-items:center;gap:4px;font-size:13px;">games each <input data-el="games" type="number" min="2" max="40" step="2" value="${st.games || 10}" style="width:52px;background:#0b0b12;color:#eee;border:1px solid #333;border-radius:4px;padding:2px 4px;"></label>
              <button data-act="stop" style="${btn}display:none;">Stop</button>
              <button data-act="reset" style="${btn}">Starter ideas</button>
            </div>
            <div style="border-top:1px solid #333;padding-top:8px;margin-top:4px;">
              <label style="display:block;font-size:13px;"><input data-el="queued" type="checkbox"> Use these ideas in my next Train Bot run (each idea = one round-1 challenger)</label>
              <label style="display:block;font-size:13px;"><input data-el="invent" type="checkbox"> Also let training invent and change formulas during that run</label>
              <div style="color:#888;margin-top:4px;">Order matters: round 1 has 3 challenger slots (Quick), 4 (Standard) or 6 (Deep), and Explore takes one. Ideas past that are skipped, so put your favourites first.</div>
            </div>
            <div data-el="out" style="margin-top:10px;"></div>
            <div data-el="champ" style="margin-top:10px;color:#aaa;"></div>
          </div>`;
        const $ = sel => ov.querySelector(sel);
        const ta = $('[data-el=text]');
        ta.value = st.text ?? STARTER;
        $('[data-el=queued]').checked = !!st.queued;
        $('[data-el=invent]').checked = !!st.invent;
        const persist = () => save({ ...load(), text: ta.value, queued: $('[data-el=queued]').checked, invent: $('[data-el=invent]').checked,
            games: Math.max(2, Math.min(40, parseInt($('[data-el=games]').value, 10) || 10)) });
        ta.addEventListener('input', persist);
        $('[data-el=queued]').addEventListener('change', persist);
        $('[data-el=invent]').addEventListener('change', persist);
        $('[data-el=games]').addEventListener('change', persist);
        const out = $('[data-el=out]');

        function check() {
            persist();
            const { terms, errors } = T.parseLines(ta.value, 'claude');
            let snap = null, me = 0;
            try {
                const gl = document.getElementById('game-layout');
                if (gl?.classList.contains('active') && window.BotState) {
                    snap = window.BotState.snapshot();
                    me = snap.turn.myPlayerIndex ?? snap.turn.activePlayerIndex ?? 0;
                }
            } catch (e) { snap = null; }
            const vals = snap ? T.explain(terms, snap, me) : null;
            out.innerHTML = (errors.length ? `<div style="color:#ff8a80;margin-bottom:6px;">${errors.map(e => `Line ${e.line}: ${esc(e.message)}`).join('<br>')}</div>` : '')
                + `<div style="color:#9f9;">${terms.length} idea(s) OK${snap ? ' (values on the current board, for you)' : ''}:</div>`
                + terms.map((t, k) => `<div><code>${esc(t.w)} × ${esc(t.text)}</code>${t.note ? ` <span style="color:#888;">${esc(t.note)}</span>` : ''}${vals ? ` <span style="color:#9cc4ff;">= ${vals[k].value === null ? '?' : +vals[k].value.toFixed(2)} → ${+vals[k].contribution.toFixed(1)}</span>` : ''}</div>`).join('');
            return terms;
        }

        async function quickTest() {
            if (testing) return;
            const terms = check();
            if (!terms.length) return;
            if (!window.BotArena && window.LazyScripts) { try { await window.LazyScripts.load('bot-arena'); } catch (e) {} }
            if (!window.BotArena) { out.insertAdjacentHTML('beforeend', '<div style="color:#ff8a80;">Bot arena is not available.</div>'); return; }
            if (window.BotArena.isRunning()) { out.insertAdjacentHTML('beforeend', '<div style="color:#ff8a80;">A bot job is already running.</div>'); return; }
            const games = Math.max(2, Math.min(40, parseInt($('[data-el=games]').value, 10) || 10));
            testing = true;
            $('[data-act=stop]').style.display = '';
            const anchor = await fetchChampion();
            const rows = terms.map(t => ({ t, res: null }));
            const draw = (status) => {
                out.innerHTML = `<div style="margin-bottom:4px;">${esc(status)}</div><table style="border-collapse:collapse;width:100%;">`
                    + '<tr style="color:#9cc4ff;text-align:left;"><th>Idea</th><th>W-L-D vs champion</th><th>Win share</th></tr>'
                    + rows.map(r => {
                        const res = r.res;
                        const dec = res ? res.aWins + res.bWins : 0;
                        const share = res && dec ? Math.round(100 * res.aWins / dec) + '%' : '';
                        const col = res && dec ? (res.aWins / dec >= 0.58 ? '#9f9' : res.aWins / dec >= 0.5 ? '#ffd27f' : '#ff8a80') : '#888';
                        return `<tr style="border-top:1px solid #222;"><td><code>${esc(r.t.w)} × ${esc(r.t.text)}</code></td><td>${res ? `${res.aWins}-${res.bWins}-${res.draws}` : '...'}</td><td style="color:${col};">${share}</td></tr>`;
                    }).join('') + '</table><div style="color:#888;margin-top:4px;">58% or more of decided games is what Train Bot needs to promote. Few games = lots of luck; use this to pick ideas, not to prove them.</div>';
            };
            try {
                for (let k = 0; k < rows.length; k++) {
                    const w = withTerm(anchor, rows[k].t);
                    if (!w) continue;
                    draw(`Testing idea ${k + 1}/${rows.length} (${games} games)...`);
                    let done = 0;
                    rows[k].res = await window.BotArena.run(w, anchor, games, 7000 + k * 100, {
                        onGame: () => { done++; draw(`Testing idea ${k + 1}/${rows.length}, game ${done}/${games}...`); },
                    });
                    if (window.BotArena.stopRequested?.()) break;
                }
                draw(window.BotArena.stopRequested?.() ? 'Stopped.' : 'Done.');
            } catch (e) {
                out.insertAdjacentHTML('beforeend', `<div style="color:#ff8a80;">Test failed: ${esc(e.message || e)}</div>`);
            } finally {
                testing = false;
                $('[data-act=stop]').style.display = 'none';
            }
        }

        ov.addEventListener('click', e => {
            const act = e.target?.dataset?.act;
            if (e.target === ov || act === 'close') { persist(); ov.remove(); }
            else if (act === 'check') check();
            else if (act === 'test') quickTest();
            else if (act === 'stop') window.BotArena?.stop?.();
            else if (act === 'reset') { ta.value = STARTER; persist(); check(); }
        });
        document.body.appendChild(ov);

        fetchChampion().then(w => {
            const el = $('[data-el=champ]');
            if (!el) return;
            el.innerHTML = w.terms?.length
                ? `The current champion already has ${w.terms.length} formula(s):<br>${w.terms.map(t => `<code>${esc(t.w)} × ${esc(t.text)}</code>`).join('<br>')}`
                : 'The current champion has no formulas yet.';
        });
    }

    window.FormulaLab = { open, takeQueued, STARTER };
})();
