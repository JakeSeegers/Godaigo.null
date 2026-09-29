// bot-mind.js: window.BotMind, the "Bot Mind" viewer. Shows what a bot is
// thinking while it plays:
//   * on the board: its build plan as ghost stones, a line to its current
//     goal, the sequence the look-ahead expects to play, and a mark on the
//     stone it is about to break, burn or place;
//   * in a small panel: how it decided (quick / look-ahead / play-out / plan /
//     unstuck), what it is doing and why, its goal, its plan, and its top
//     options with scores.
//
// bot.js builds one record per decision (beginThought / finishThought) and
// calls BotMind.record(). It only does that while wants() is true, so normal
// play and arena training pay nothing.
//
// Who can see it: a bot's plan shows its hand (the ghost stones show which
// scroll it holds), so this is hermit-only for now (window.isHermit()), and
// never during muted arena training runs (fast, nobody watching). Toggle:
// hermit menu "Bot Mind", or Shift+M. Stored in localStorage godaigo_bot_mind.
(function () {
    'use strict';

    const KEY = 'godaigo_bot_mind';
    const NS = 'http://www.w3.org/2000/svg';
    const STONE_COLORS = { earth: '#69d83a', water: '#5894f4', fire: '#ed1b43', wind: '#ffce00', void: '#9458f4', catacomb: '#c8a870' };
    const SEAT_COLORS = { green: '#69d83a', blue: '#5894f4', red: '#ed1b43', yellow: '#ffce00', purple: '#9458f4' };
    const MODES = {
        quick:     ['Quick pick', 'Scored every move once and took the best.'],
        lookahead: ['Look-ahead', 'Tried short sequences of moves in its head first.'],
        playout:   ['Play-out', 'Played many possible future turns in its head (MCTS).'],
        plan:      ['Following plan', 'Next step of the scroll pattern it is building.'],
        unstuck:   ['Getting unstuck', 'No progress for a while, so it picked a new target.'],
        overflow:  ['Too many scrolls', 'Had to discard first.'],
        none:      ['No move', 'Nothing legal to do.'],
    };

    let enabled = false;
    try { enabled = localStorage.getItem(KEY) === '1'; } catch (e) {}
    let last = null;          // latest record
    let lastActive = null;    // activePlayerIndex when `last` was drawn

    function allowed() {
        try {
            if (typeof window.isHermit !== 'function' || !window.isHermit()) return false;
            const A = window.BotArena;
            // Off only in fast (Extreme) training; Watchable training shows it
            // (owner, 2026-09-29).
            if (A && !A.isSpectating?.() && (A.isRunning?.() || A.isEvolving?.() || A.isClimbing?.()) &&
                (window.BotSystem?.speedScale ?? 1) < 1) return false;
            return !!document.getElementById('game-layout')?.classList.contains('active');
        } catch (e) { return false; }
    }
    function wants() { return enabled && allowed(); }

    function setEnabled(on) {
        enabled = !!on;
        try { localStorage.setItem(KEY, enabled ? '1' : '0'); } catch (e) {}
        if (!enabled) clear();
        else renderPanel();
    }

    // ---------------------------------------------------------------- helpers
    function el(tag, attrs, parent) {
        const n = document.createElementNS(NS, tag);
        for (const k in attrs) n.setAttribute(k, attrs[k]);
        if (parent) parent.appendChild(n);
        return n;
    }
    function seatColor(i) {
        const p = (typeof playerPositions !== 'undefined') ? playerPositions[i] : null;
        const c = p && p.color;
        if (c && c.startsWith && c.startsWith('#')) return c;
        return SEAT_COLORS[c] || '#d9b08c';
    }
    function seatName(i) {
        try {
            if (typeof getPlayerColorName === 'function') return getPlayerColorName(i);
        } catch (e) {}
        return `Player ${i + 1}`;
    }
    function esc(t) {
        return String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    }
    function stoneAt(x, y) {
        const list = (typeof placedStones !== 'undefined') ? placedStones : [];
        return list.find(s => Math.hypot(s.x - x, s.y - y) < 5) || null;
    }

    // ---------------------------------------------------------------- board
    function layer() {
        const vp = document.getElementById('viewport');
        if (!vp) return null;
        let g = vp.querySelector(':scope > .bot-mind-layer');
        if (!g) g = el('g', { class: 'bot-mind-layer', 'pointer-events': 'none' }, vp);
        else vp.appendChild(g); // keep on top of stones / pawns added later
        return g;
    }

    function drawBoard(r) {
        const g = layer();
        if (!g) return;
        g.innerHTML = '';
        const col = seatColor(r.playerIndex);

        // Build plan: ghost stones (solid ring once the right stone is there).
        if (r.plan) {
            for (const c of r.plan.cells) {
                const here = stoneAt(c.x, c.y);
                const done = here && here.type === c.type;
                el('circle', {
                    cx: c.x, cy: c.y, r: 11, class: 'bm-plan-cell' + (done ? ' done' : ''),
                    fill: STONE_COLORS[c.type] || '#fff', stroke: STONE_COLORS[c.type] || '#fff',
                }, g);
            }
        }

        // Goal: path from the pawn and a ring on the target.
        if (r.goal && r.goal.path && r.goal.path.length > 1) {
            el('polyline', { points: r.goal.path.map(p => `${p.x},${p.y}`).join(' '), class: 'bm-goal-path', stroke: col }, g);
        }
        if (r.goal && r.goal.x != null) {
            el('circle', { cx: r.goal.x, cy: r.goal.y, r: 16, class: 'bm-goal-ring', stroke: col }, g);
        }

        // Look-ahead line: where it expects to walk, numbered stops for other steps.
        if (r.line && r.from) {
            let pos = r.from;
            const pts = [pos];
            let n = 0;
            for (const step of r.line) {
                const a = step.action;
                if (a.type === 'move' || a.type === 'teleport') { pos = { x: a.x, y: a.y }; pts.push(pos); continue; }
                const at = a.x != null ? a : step.target; // a cast's chosen tile
                if (!at || at.x == null) continue;
                n++;
                el('circle', { cx: at.x, cy: at.y, r: 5.5, class: 'bm-step-dot' }, g);
                const t = el('text', { x: at.x, y: at.y + 2.6, class: 'bm-step-num' }, g);
                t.textContent = n;
            }
            if (pts.length > 1) el('polyline', { points: pts.map(p => `${p.x},${p.y}`).join(' '), class: 'bm-line-path' }, g);
        }

        // What it is doing right now.
        const a = r.chosen && r.chosen.action;
        const tgt = r.chosen && r.chosen.target;
        if (tgt && tgt.x != null) {
            // A scroll aimed at a tile (Wandering River, Heavy Stomp): ring the tile.
            el('circle', { cx: tgt.x, cy: tgt.y, r: 44, class: 'bm-cast-target', stroke: STONE_COLORS[tgt.element] || col }, g);
        }
        if (a && a.x != null) {
            if (a.type === 'breakStone') {
                const d = 7;
                el('path', { d: `M${a.x - d},${a.y - d}L${a.x + d},${a.y + d}M${a.x + d},${a.y - d}L${a.x - d},${a.y + d}`, class: 'bm-break' }, g);
            } else if (a.type === 'placeStone') {
                el('circle', { cx: a.x, cy: a.y, r: 13, class: 'bm-place', stroke: STONE_COLORS[a.stoneType] || col }, g);
            }
        }
    }

    // ---------------------------------------------------------------- panel
    function panel() {
        let p = document.getElementById('bot-mind-panel');
        if (!p) {
            p = document.createElement('div');
            p.id = 'bot-mind-panel';
            document.body.appendChild(p);
            p.addEventListener('click', (e) => {
                if (e.target.closest('.bm-close')) setEnabled(false);
            });
        }
        return p;
    }

    function renderPanel() {
        if (!wants()) { document.getElementById('bot-mind-panel')?.remove(); return; }
        const p = panel();
        const r = last;
        if (!r) {
            p.innerHTML = `<div class="bm-head"><span class="bm-title">Bot Mind</span><button class="bm-close" title="Turn off (Shift+M)">Close</button></div>
                <div class="bm-empty">Waiting for a bot to move.</div>`;
            return;
        }
        const col = seatColor(r.playerIndex);
        const [modeName, modeHelp] = MODES[r.mode] || [r.mode, ''];
        const stale = (typeof activePlayerIndex !== 'undefined') && activePlayerIndex !== r.playerIndex;
        const opts = r.options || [];
        const hi = Math.max(...opts.map(o => o.score), 1);
        const lo = Math.min(...opts.map(o => o.score), 0);
        const width = s => Math.max(3, Math.round(100 * (s - lo) / Math.max(1, hi - lo)));
        const chosenKey = r.chosen ? JSON.stringify(r.chosen.action) : '';

        let html = `<div class="bm-head" style="border-color:${col}">
            <span class="bm-dot" style="background:${col}"></span>
            <span class="bm-title">${esc(seatName(r.playerIndex))}</span>
            <button class="bm-close" title="Turn off (Shift+M)">Close</button></div>`;
        if (stale) html += `<div class="bm-note">Last move (not its turn now)</div>`;
        html += `<div class="bm-row"><span class="bm-k">Thinking</span><span class="bm-v"><b>${esc(modeName)}</b>${r.mode === 'lookahead' ? ` (${r.searchDepth} deep)` : ''}<br><span class="bm-help">${esc(modeHelp)}</span></span></div>`;
        if (r.chosen) html += `<div class="bm-row"><span class="bm-k">Doing</span><span class="bm-v"><b>${esc(r.chosen.reason)}</b></span></div>`;
        if (r.goal) html += `<div class="bm-row"><span class="bm-k">Goal</span><span class="bm-v">${esc(r.goal.label)}${r.goal.cost ? ` (${r.goal.cost} AP away)` : ''}</span></div>`;
        if (r.plan) {
            const done = r.plan.cells.filter(c => { const s = stoneAt(c.x, c.y); return s && s.type === c.type; }).length;
            html += `<div class="bm-row"><span class="bm-k">Plan</span><span class="bm-v">Build ${esc(r.plan.name)}: ${done} of ${r.plan.cells.length} stones</span></div>`;
        }
        if (r.line && r.line.length > 1) {
            // Group runs of plain steps: "Walk 3 steps" reads better than Step > Step > Step.
            const parts = [];
            for (const s of r.line) {
                const walk = s.action.type === 'move';
                const prev = parts[parts.length - 1];
                if (walk && prev && prev.walk) prev.n++;
                else parts.push(walk ? { walk: true, n: 1 } : { text: s.reason });
            }
            const text = parts.map(x => x.walk ? (x.n === 1 ? 'Walk 1 step' : `Walk ${x.n} steps`) : x.text);
            html += `<div class="bm-row"><span class="bm-k">Sees ahead</span><span class="bm-v bm-line">${text.map(esc).join(' <span class="bm-arrow">&gt;</span> ')}</span></div>`;
        }
        if (r.combo) {
            // A combo learned from players' games (bot.js, Phase 4): which step is next.
            const name = id => window.SCROLL_DEFINITIONS?.[id]?.name || id;
            const steps = r.combo.signature.split(' / ').map(t => t.split(' > ').map(tok => {
                const m = /^([A-Z]+_SCROLL_\d+)(?:\[(.*)\])?$/.exec(tok.trim());
                return m ? name(m[1]) + (m[2] ? ` (${m[2]})` : '') : tok;
            }).join(' &gt; ')).join(' / ');
            html += `<div class="bm-row"><span class="bm-k">Combo</span><span class="bm-v">${steps}<br><span class="bm-help">Step ${r.combo.step + 1} of ${r.combo.total}: ${esc(name(r.combo.next))}</span></span></div>`;
        }
        if (r.stuck && (r.stuck.unproductive >= 2 || r.stuck.repeat)) {
            html += `<div class="bm-row"><span class="bm-k">Stuck</span><span class="bm-v">${r.stuck.unproductive} turns without progress${r.stuck.repeat ? ', repeating moves' : ''}</span></div>`;
        }
        // Alliances Phase 1 (js/bot-diplomacy.js): how this bot sees the others.
        const rel = window.BotDiplomacy?.view?.(r.playerIndex) || [];
        if (rel.length) {
            const sign = v => `${v > 0 ? '+' : ''}${v.toFixed(2)}`;
            const tone = v => v > 0.05 ? '#8fe08f' : v < -0.05 ? '#ff9a8a' : '#bbb';
            const threatWord = t => t >= 1 ? 'can win!' : t >= 0.65 ? 'high' : t >= 0.45 ? 'even' : 'low';
            html += `<div class="bm-sub">How it sees the others</div>
                <table style="width:100%;border-collapse:collapse;font-size:12px;">
                <tr style="color:#aaa;text-align:left;"><th>Player</th><th title="Helped (+) or hurt (-) my progress">Favor</th><th title="How dangerous it is to help them now">Threat</th><th title="Favor + trust - threat: who I would rather work with">Ally</th><th title="How hard I push against them (1 = normal play)">Push</th></tr>`
                + rel.map(x => `<tr><td><span class="bm-dot" style="background:${seatColor(x.player)};display:inline-block;"></span> ${esc(x.name)}${x.human ? ' <span style="color:#999;">(human)</span>' : ''} <span style="color:#888;">${x.tracker}/5</span></td>`
                    + `<td style="color:${tone(x.favor)}">${sign(x.favor)}</td><td>${threatWord(x.threat)}</td><td style="color:${tone(x.ally)}">${sign(x.ally)}</td><td style="color:${x.push > 1.2 ? '#ff9a8a' : x.push < 0.9 ? '#8fe08f' : '#bbb'}">×${x.push.toFixed(1)}</td></tr>`).join('')
                + `</table>`;
            const tgt = window.BotDiplomacy.coalitionTarget?.(r.playerIndex);
            if (tgt != null) html += `<div class="bm-help" style="color:#ff9a8a;margin-top:3px;">Ganging up on ${esc(seatName(tgt))}: clearly in the lead.</div>`;
            const ev = window.BotDiplomacy.events(r.playerIndex).slice(0, 3);
            if (ev.length) html += `<div class="bm-help" style="margin-top:3px;">${ev.map(e => `<div><span style="color:${tone(e.df)}">${sign(e.df)}</span> ${esc(e.text)}${e.turn != null ? ` <span style="color:#777;">(turn ${e.turn})</span>` : ''}</div>`).join('')}</div>`;
        }
        if (opts.length) {
            html += `<div class="bm-sub">Top options (score)</div><ol class="bm-opts">`;
            for (const o of opts) {
                const picked = JSON.stringify(o.action) === chosenKey;
                html += `<li class="${picked ? 'picked' : ''}"><div class="bm-bar" style="width:${width(o.score)}%;background:${col}"></div>
                    <span class="bm-opt-t">${esc(o.reason)}</span><span class="bm-opt-s">${Math.round(o.score)}</span></li>`;
            }
            html += `</ol>`;
            if (r.mode !== 'quick' && r.mode !== 'none') html += `<div class="bm-foot">Scores are the quick pick. ${esc(modeName)} can choose differently.</div>`;
        }
        p.innerHTML = html;
    }

    // ---------------------------------------------------------------- api
    function record(r) {
        if (!wants()) return;
        last = r;
        lastActive = r.playerIndex;
        drawBoard(r);
        renderPanel();
    }

    // A new game or training round: drop the last bot's record at once and
    // show the empty panel (it used to keep the old round's view).
    function reset() {
        last = null;
        document.querySelectorAll('.bot-mind-layer').forEach(n => n.remove());
        if (document.getElementById('bot-mind-panel')) renderPanel();
    }

    function clear() {
        document.querySelectorAll('.bot-mind-layer').forEach(n => n.remove());
        document.getElementById('bot-mind-panel')?.remove();
        last = null;
    }

    // Tidy up: hide the board drawing when the turn moves on, remove
    // everything when the viewer is off or the game is over.
    setInterval(() => {
        if (!wants()) {
            if (document.getElementById('bot-mind-panel') || document.querySelector('.bot-mind-layer')) {
                document.querySelectorAll('.bot-mind-layer').forEach(n => n.remove());
                document.getElementById('bot-mind-panel')?.remove();
            }
            if (!document.getElementById('game-layout')?.classList.contains('active')) last = null;
            return;
        }
        const active = (typeof activePlayerIndex !== 'undefined') ? activePlayerIndex : null;
        if (last && active !== lastActive) {
            lastActive = active;
            const g = document.querySelector('.bot-mind-layer');
            if (g) g.innerHTML = '';
            renderPanel();
        }
        if (!document.getElementById('bot-mind-panel')) renderPanel();
    }, 400);

    document.addEventListener('keydown', (e) => {
        if (!e.shiftKey || (e.key !== 'M' && e.key !== 'm')) return;
        if (typeof window.isHermit !== 'function' || !window.isHermit()) return;
        const tag = document.activeElement?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || document.activeElement?.isContentEditable) return;
        e.preventDefault();
        setEnabled(!enabled);
    });

    window.BotMind = { wants, record, setEnabled, isEnabled: () => enabled, clear, reset, last: () => last };
})();
