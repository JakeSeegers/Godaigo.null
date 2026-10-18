// js/training-lab.js - window.TrainingLab: the hermit's Training Lab
// (owner 2026-10-18). One screen to see and judge bot training; Train Bot for
// gold stays one simple button for everyone.
//
//   1. Saved games meter: how many games' worth of positions are saved
//      (position_samples), against rough marks for Fit Formulas and the bot
//      network, with the last 7 days' pace.
//   2. Challengers: every idle challenger (sql/training-lab.sql
//      hermit_training_lab), what it changes vs its champion, its record, a
//      plain verdict (chance it is better than the champion) and Reject.
//   3. Champion history: promoted champions (bot_champion_weights, public
//      read), what each changed, and a test of the current champion against
//      the last 3 (BotArena.run, 10 muted games each) to catch circles.
//   4. Shortcuts to Fit Formulas, Bot Network, Formula Lab, Scroll report.
//
// The Lab never promotes anything: real games and the server rules decide.
(function () {
    'use strict';

    // Rough marks (games' worth of saved positions), not hard rules.
    const MARKS = {
        fit: { min: 300, good: 1000 },
        net: { min: 2000, good: 5000 },
    };
    const DECIDED_FOR_VERDICT = 40;   // server: verdict at 40 decided games, 58%+

    const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const num = n => (+n || 0).toLocaleString('en-US');
    const day = t => t ? String(t).slice(0, 10) : '-';

    // Chance the true win rate is above 50% (Beta(w+1, l+1), normal approximation).
    function chanceBetter(w, l) {
        const n = w + l;
        const m = (w + 1) / (n + 2), sd = Math.sqrt(m * (1 - m) / (n + 3));
        const z = (m - 0.5) / sd;
        // Standard normal CDF (Abramowitz-Stegun 7.1.26 via erf).
        const x = Math.abs(z) / Math.SQRT2, t = 1 / (1 + 0.3275911 * x);
        const erf = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
        return z >= 0 ? 0.5 * (1 + erf) : 0.5 * (1 - erf);
    }
    function verdict(w, l) {
        const p = chanceBetter(w, l);
        if (w + l < 6) return { text: 'too early', p, color: '#aaa' };
        if (p >= 0.9) return { text: 'likely better', p, color: '#7f7' };
        if (p <= 0.1) return { text: 'likely worse', p, color: '#f77' };
        return { text: 'unclear', p, color: '#fd7' };
    }

    // What a weight table changes vs another one, in short words.
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
            out.push(`${changed.length} weight(s) changed` + (changed.length ? ': ' +
                changed.slice(0, 3).map(c => `${c.k} ${+c.b.toPrecision(3)} → ${+c.a.toPrecision(3)}`).join(', ') + (changed.length > 3 ? ', ...' : '') : ''));
        }
        const oldT = new Set((base.terms || []).map(t => t.text));
        const newT = (w.terms || []).filter(t => !oldT.has(t.text));
        const goneT = (base.terms || []).filter(t => !(w.terms || []).some(x => x.text === t.text));
        if (newT.length) out.push('formulas added: ' + newT.map(t => `${t.w}: ${t.text}`).join(' | '));
        if (goneT.length) out.push('formulas removed: ' + goneT.map(t => t.text).join(' | '));
        const oldC = new Set(base.extraCombos || []);
        const newC = (w.extraCombos || []).filter(c => !oldC.has(c));
        if (newC.length) out.push('trial combos: ' + newC.join(' | '));
        return out;
    }

    async function loadChampions() {
        const { data, error } = await supabase.from('bot_champion_weights')
            .select('id, created_at, weights, confirm_wins, confirm_losses, confirm_draws, promoted')
            .eq('promoted', true).order('created_at', { ascending: false }).limit(12);
        if (error) throw error;
        return data || [];
    }

    // ── Sections ─────────────────────────────────────────────────
    function meterHtml(label, games, marks, pace, note) {
        const max = marks.good * 1.2;
        const pct = Math.min(100, 100 * games / max);
        const minAt = 100 * marks.min / max, goodAt = 100 * marks.good / max;
        const state = games >= marks.good ? ['good amount', '#7f7'] : games >= marks.min ? ['enough to try', '#fd7'] : ['not enough yet', '#f99'];
        const next = games < marks.min ? marks.min : games < marks.good ? marks.good : null;
        const eta = next && pace > 0 ? ` About ${Math.ceil((next - games) / pace * 7)} day(s) to ${num(next)} at this week's pace.` : (next ? ' No games saved this week.' : '');
        return `
            <div style="margin:6px 0 10px;">
                <div style="display:flex;justify-content:space-between;"><span>${esc(label)}</span><span style="color:${state[1]};">${state[0]}</span></div>
                <div style="position:relative;height:14px;background:#2a2a36;border-radius:7px;overflow:hidden;margin:3px 0;">
                    <div style="height:100%;width:${pct}%;background:${state[1]};opacity:.75;"></div>
                    <div title="enough to try" style="position:absolute;top:0;bottom:0;left:${minAt}%;width:2px;background:#fff8;"></div>
                    <div title="good amount" style="position:absolute;top:0;bottom:0;left:${goodAt}%;width:2px;background:#fff;"></div>
                </div>
                <div style="color:#aaa;font-size:11px;">${num(games)} games. Marks: try at ${num(marks.min)}, good at ${num(marks.good)}.${eta} ${esc(note || '')}</div>
            </div>`;
    }

    function dataHtml(d) {
        if (!d) return '<div style="color:#f99;">No data summary.</div>';
        const pace = +d.games_7d || 0;
        return `
            <div style="color:#ccc;margin-bottom:4px;">${num(d.games)} bot games and ${num(d.mined_games)} real games saved (${num(d.rows)} positions, ${num(d.move_rows)} of them move by move), from ${num(d.accounts)} account(s). This week: ${num(pace)} games.</div>
            ${meterHtml('Fit Formulas', (+d.games || 0) + (+d.mined_games || 0), MARKS.fit, pace, '')}
            ${meterHtml('Bot network', (+d.games || 0) + (+d.mined_games || 0), MARKS.net, pace, 'Real games count most: more mined games help it learn how people play.')}
            <div style="color:#888;font-size:11px;">The marks are rough rules of thumb, not proof. The real test stays the same: does the new bot win games.</div>`;
    }

    function candidatesHtml(list, champs) {
        if (!list.length) return '<div style="color:#aaa;">No challengers yet.</div>';
        const byId = new Map(champs.map(c => [c.id, c.weights]));
        const rows = list.map(c => {
            const v = verdict(c.wins, c.losses);
            const dec = c.wins + c.losses;
            const changes = diff(c.weights, byId.get(c.champion_id));
            if (c.has_net) changes.push('adds a network');
            const status = c.status === 'open' ? `${dec}/${DECIDED_FOR_VERDICT} decided` :
                c.status === 'promoted' ? `<b style="color:#7f7;">promoted → champion #${c.new_champion_id}</b>` : esc(c.status);
            return `
                <div style="border-top:1px solid #333;padding:6px 0;">
                    <div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;">
                        <span><b>#${c.id}</b> ${esc(c.kind)} <span style="color:#888;">vs champion #${c.champion_id}, ${day(c.created_at)}, ${c.players} player(s)</span></span>
                        <span>${c.wins}-${c.losses}-${c.draws} · <span style="color:${v.color};" title="chance it is better than its champion">${v.text} (${Math.round(100 * v.p)}%)</span> · ${status}
                            ${c.status === 'open' ? `<button class="tl-reject" data-id="${c.id}" style="padding:1px 7px;margin-left:4px;">Reject</button>` : ''}</span>
                    </div>
                    <div style="color:#aaa;font-size:11px;margin-top:2px;">${changes.length ? changes.map(esc).join('<br>') : 'no change found (champion weights not loaded?)'}</div>
                </div>`;
        }).join('');
        return `<div style="color:#888;font-size:11px;margin-bottom:4px;">The server promotes at ${DECIDED_FOR_VERDICT} decided games with 58%+. The % is the chance it really beats its champion, from its games so far.</div>${rows}`;
    }

    function championsHtml(champs) {
        if (!champs.length) return '<div style="color:#aaa;">No champions found.</div>';
        return champs.map((c, i) => {
            const prev = champs[i + 1];
            const changes = prev ? diff(c.weights, prev.weights) : ['first one in this list'];
            if (c.weights?.net && c.weights?.netWeight) changes.push('uses a network');
            return `
                <div style="border-top:1px solid #333;padding:6px 0;">
                    <div><b>#${c.id}</b> ${i === 0 ? '<span style="color:#7f7;">(live)</span>' : ''} <span style="color:#888;">${day(c.created_at)}, own record ${c.confirm_wins ?? '-'}-${c.confirm_losses ?? '-'}-${c.confirm_draws ?? '-'}</span></div>
                    <div style="color:#aaa;font-size:11px;margin-top:2px;">${changes.length ? changes.map(esc).join('<br>') : 'no weight changes over 10%'}</div>
                </div>`;
        }).join('');
    }

    // ── Panel ────────────────────────────────────────────────────
    function open() {
        if (!window.isHermit?.()) return;
        document.getElementById('training-lab')?.remove();
        const box = document.createElement('div');
        box.id = 'training-lab';
        box.style.cssText = 'position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:10059;width:min(760px,96vw);max-height:90vh;overflow:auto;' +
            'background:#16161f;border:1px solid #555;border-radius:10px;padding:14px 16px;color:#ddd;font-size:13px;box-shadow:0 8px 32px rgba(0,0,0,.7);';
        const btn = (cls, text) => `<button class="${cls}" style="padding:4px 9px;">${text}</button>`;
        box.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                <b style="font-size:16px;">Training Lab</b>
                <span>${btn('tl-refresh', 'Refresh')} ${btn('tl-close', '✕')}</span>
            </div>
            <div style="color:#aaa;font-size:12px;margin-bottom:10px;">See what bot training is doing and judge it. Nothing here promotes a bot: real games and the server rules decide.</div>
            <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px;">
                ${btn('tl-fit', 'Fit Formulas')} ${btn('tl-net', 'Bot Network')} ${btn('tl-lab', 'Formula Lab')} ${btn('tl-scrolls', 'Scroll report')}
            </div>
            <h4 style="margin:8px 0 4px;">Saved games for learning</h4>
            <div class="tl-data">Loading...</div>
            <h4 style="margin:14px 0 4px;">Challengers</h4>
            <div class="tl-cands">Loading...</div>
            <h4 style="margin:14px 0 4px;">Champion history</h4>
            <div style="margin-bottom:6px;">${btn('tl-test', 'Test the live champion vs the last 3 (10 games each)')}</div>
            <div class="tl-test-out" style="display:none;margin:0 0 10px;padding:8px 10px;border:1px solid #4a6;border-radius:6px;background:#1c2a20;font-size:13px;"></div>
            <div class="tl-champs">Loading...</div>`;
        document.body.appendChild(box);
        const $ = s => box.querySelector(s);
        $('.tl-close').onclick = () => box.remove();
        $('.tl-fit').onclick = () => window.FormulaFit?.open();
        $('.tl-net').onclick = () => window.BotNet?.open();
        $('.tl-lab').onclick = () => window.FormulaLab?.open();
        $('.tl-scrolls').onclick = async () => { try { await window.LazyScripts?.load?.('bot-arena'); } catch (e) {} window.BotArena?.openScrollReport?.(); };

        let champs = [];
        const refresh = async () => {
            $('.tl-data').textContent = $('.tl-cands').textContent = $('.tl-champs').textContent = 'Loading...';
            try { champs = await loadChampions(); $('.tl-champs').innerHTML = championsHtml(champs); }
            catch (e) { $('.tl-champs').textContent = 'Could not load champions: ' + (e.message || e); }
            const { data, error } = await supabase.rpc('hermit_training_lab', { p_limit: 40 });
            if (error) {
                const msg = /function|does not exist|schema cache/i.test(error.message || '') ? 'Run sql/training-lab.sql in the Supabase SQL editor first.' : (error.message || error);
                $('.tl-data').textContent = $('.tl-cands').textContent = msg;
                return;
            }
            $('.tl-data').innerHTML = dataHtml(data.data);
            // Champions the challengers were made from may be older than the list.
            const need = [...new Set((data.candidates || []).map(c => c.champion_id))].filter(id => !champs.some(c => c.id === id));
            if (need.length) {
                const r = await supabase.from('bot_champion_weights').select('id, weights').in('id', need);
                if (!r.error) champs = [...champs, ...(r.data || [])];
            }
            $('.tl-cands').innerHTML = candidatesHtml(data.candidates || [], champs);
            box.querySelectorAll('.tl-reject').forEach(b => b.onclick = async () => {
                if (!confirm(`Reject challenger #${b.dataset.id}? Idle training stops testing it.`)) return;
                b.disabled = true;
                const r = await supabase.rpc('hermit_reject_candidate', { p_id: +b.dataset.id });
                if (r.error) { alert('Reject failed: ' + r.error.message); b.disabled = false; return; }
                refresh();
            });
        };
        $('.tl-refresh').onclick = refresh;

        // Test results: a box of its own (one row per older champion, then a
        // summary), kept in localStorage so they are still here after a reload.
        const TEST_KEY = 'godaigo_training_lab_test';
        const showTest = (t) => {
            const out = $('.tl-test-out');
            out.style.display = '';
            const rows = t.rows.map(r => {
                if (r.error) return `<div>vs champion #${r.id}: <span style="color:#f99;">failed: ${esc(r.error)}</span></div>`;
                if (r.playing) return `<div>vs champion #${r.id}: <span style="color:#fd7;">${esc(r.playing)}</span></div>`;
                const v = verdict(r.w, r.l);
                const word = r.w > r.l ? 'live won more' : r.w < r.l ? 'old won more' : 'even';
                return `<div>vs champion #${r.id}: <b>${r.w}-${r.l}-${r.d}</b> (live-old-draw), ${word}` +
                    (v.text === 'likely worse' ? ' <b style="color:#f77;">live looks WORSE</b>' : v.text === 'likely better' ? ' <span style="color:#7f7;">live looks better</span>' : '') + '</div>';
            }).join('');
            const done = t.rows.filter(r => !r.error && !r.playing);
            let sum = '';
            if (!t.running && done.length) {
                const W = done.reduce((a, r) => a + r.w, 0), L = done.reduce((a, r) => a + r.l, 0), D = done.reduce((a, r) => a + r.d, 0);
                const worse = done.filter(r => verdict(r.w, r.l).text === 'likely worse');
                sum = `<div style="margin-top:6px;border-top:1px solid #355;padding-top:6px;">Total: live champion #${t.live} won <b>${W}</b>, lost <b>${L}</b>, drew ${D}. ` +
                    (worse.length ? `<b style="color:#f77;">It looks weaker than #${worse.map(r => r.id).join(', #')}. Run the test again before trusting this.</b>`
                        : W >= L ? 'No sign it got weaker.' : 'It lost more than it won, but not clearly. 10 games per champion is only a hint.') + '</div>';
            }
            out.innerHTML = `<div style="color:#aaa;font-size:11px;margin-bottom:4px;">${t.running ? 'Testing...' : 'Last test, ' + esc(t.at)}</div>${rows}${sum}`;
        };
        try { const t = JSON.parse(localStorage.getItem(TEST_KEY)); if (t?.rows) showTest({ ...t, running: false }); } catch (e) {}

        $('.tl-test').onclick = async () => {
            if (champs.length < 2) { showTest({ running: false, at: '-', live: '?', rows: [{ id: '-', error: 'need at least 2 champions' }] }); return; }
            $('.tl-test').disabled = true;
            const live = champs[0];
            const t = { running: true, at: new Date().toLocaleString(), live: live.id, rows: [] };
            try { await window.LazyScripts?.load?.('bot-arena'); } catch (e) {}
            for (const old of champs.slice(1, 4)) {
                const row = { id: old.id, playing: 'starting...' };
                t.rows.push(row);
                showTest(t);
                try {
                    const r = await window.BotArena.run(live.weights, old.weights, 10, (Date.now() % 100000) >>> 0, {
                        visual: false, comboWatch: false,
                        onGame: (i, n, g, info) => {
                            row.playing = `game ${i} of ${n} done` + (info ? (g?.winner == null ? ' (draw)' : info.aWon ? ' (live won)' : ' (old won)') : '');
                            showTest(t);
                        },
                    });
                    delete row.playing;
                    Object.assign(row, { w: r.aWins, l: r.bWins, d: r.draws });
                } catch (e) { delete row.playing; row.error = e.message || String(e); }
                showTest(t);
            }
            t.running = false;
            showTest(t);
            try { localStorage.setItem(TEST_KEY, JSON.stringify(t)); } catch (e) {}
            console.log('🧪 [TrainingLab] live champion #' + live.id + ' vs older champions: ' +
                t.rows.map(r => r.error ? `#${r.id} failed (${r.error})` : `#${r.id} ${r.w}-${r.l}-${r.d}`).join(', '));
            // Arena games swap the screen; bring the Lab back to the front with the result in view.
            if (!box.isConnected) document.body.appendChild(box);
            box.style.zIndex = '10090';
            $('.tl-test-out').scrollIntoView({ block: 'center' });
            $('.tl-test').disabled = false;
        };

        refresh();
    }

    window.TrainingLab = { open, chanceBetter, verdict, diff };
})();
