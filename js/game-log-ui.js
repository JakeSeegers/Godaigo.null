// ============================================================
// game-log-ui.js — player-facing readable Game Log panel.
// ============================================================
// Renders a colour-coded, human-readable history of PUBLIC actions into
// #game-log-content, fed live by js/action-log.js's onRecord() hook — every
// entry it already records (placeStone, move, cast/effect/response events,
// discardScroll, endTurn) is reused rather than duplicating any of those
// hooks here. This file only decides how to DESCRIBE and FILTER entries for
// players to read during the game.
//
// Deliberately excluded from the visible log (unlike the hidden dev-only
// "Download Action Log" cheat-panel button, which keeps everything):
//   - discardScroll: reveals which scroll left a player's hand. A player
//     already sees their own hand elsewhere, and must never see anyone
//     else's — so it's simplest and correct to just never show it here.
//   - sacrificial_pyre_response_opened/submitted: internal UI-state
//     bookkeeping, not narrative a player needs.
//   - original_countered / original_resolved: always immediately follow a
//     cast_execute (and, when relevant, a response_counter/counter_negated)
//     for the same scroll — the earlier line already tells the story, so
//     showing both would just repeat it.
//   - endTurn: the next turn's header line marks this boundary instead.
//
// Movement is collapsed to one summary line per (turn, player) instead of
// one line per hex stepped into — see pendingMove/flushPendingMove().
//
// LOAD ORDER: after action-log.js (needs window.ActionLog.onRecord/entries)
// AND after scroll-panels.js, whose init() creates #game-log-content (see
// createPanel('gamelog', ...) there) before this file's own DOMContentLoaded
// handler runs — both listen on the same event, so registration order
// (i.e. script tag order in index.html) is what makes this reliable; in
// practice it barely matters since onRecord() only ever fires during real
// gameplay, long after both have finished initializing.
// ============================================================

(function () {
    'use strict';

    // The panel itself (drag/resize/collapse/close/open, the
    // #panel-btn-gamelog toggle button) is now built and wired entirely by
    // js/scroll-panels.js's createPanel('gamelog', 'Game Log', {bodyId:
    // 'game-log-content', ...}) — this file only ever writes into that body.
    const CONTENT_ID = 'game-log-content';

    // Same name→hex mapping used elsewhere (multiplayer-state.js's
    // updateTurnDisplay, etc.) — not imported from anywhere shared, just
    // duplicated the same small table rather than reach into another
    // module's closure for it.
    const PLAYER_HEX = { purple: '#9458f4', yellow: '#ffce00', red: '#ed1b43', blue: '#5894f4', green: '#69d83a' };

    const ELEMENT_COLOR_VAR = {
        earth: 'var(--earth-color)',
        water: 'var(--water-color)',
        fire: 'var(--fire-color)',
        wind: 'var(--wind-color)',
        void: 'var(--void-color)',
        catacomb: 'var(--catacomb-color)',
    };

    function elementOf(scrollName) {
        return window.SCROLL_DEFINITIONS?.[scrollName]?.element || null;
    }
    function scrollDisplayName(scrollName) {
        return window.SCROLL_DEFINITIONS?.[scrollName]?.name || scrollName || 'a scroll';
    }
    function elColor(element) {
        return ELEMENT_COLOR_VAR[element] || 'var(--text-primary)';
    }
    function playerColorHex(playerIndex) {
        try {
            if (typeof allPlayersData !== 'undefined' && Array.isArray(allPlayersData)) {
                const p = allPlayersData.find(pl => pl.player_index === playerIndex);
                if (p && p.color && PLAYER_HEX[p.color]) return PLAYER_HEX[p.color];
            }
        } catch (e) { /* solo/tutorial — fall through */ }
        try {
            if (typeof playerPositions !== 'undefined' && playerPositions[playerIndex]?.color) {
                return playerPositions[playerIndex].color;
            }
        } catch (e) { /* ignore */ }
        return 'var(--text-primary)';
    }
    function playerName(playerIndex) {
        return (typeof getPlayerColorName === 'function') ? getPlayerColorName(playerIndex) : `Player ${playerIndex + 1}`;
    }
    function esc(s) {
        return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }
    function playerSpan(playerIndex) {
        const inner = window.cosmeticsSystem?.seatNameHtml ? window.cosmeticsSystem.seatNameHtml(playerIndex) : esc(playerName(playerIndex));
        return `<span style="color:${playerColorHex(playerIndex)}">${inner}</span>`;
    }
    function aOrAn(word) {
        return /^[aeiou]/i.test(word || '') ? 'an' : 'a';
    }

    // ---- Active Buffs strip (#game-log-buffs) ----
    // spellSystem.scrollEffects.activeBuffs is a plain object mutated
    // directly by ~20 different scroll execute()s and cleared piecemeal
    // (clearTurnBuffs() on End Turn, plus a couple of player-specific
    // clearXForPlayer() calls at that player's own next-turn start) — there
    // is no single "a buff changed" hook to subscribe to without adding a
    // call at every one of those sites. Polling a plain object read (cheap,
    // and skipped entirely when the signature hasn't changed since the last
    // tick — see the signature check below) is simpler and can't miss an
    // update the way trying to enumerate every mutation site could.
    // Only buffs meaningful to show a player (not internal bookkeeping like
    // suppressVoidAPSync, or arrays like wanderingRiver/reflectPending that
    // don't fit this "one row per player+buff" shape) are listed here.
    const BUFF_META = {
        burningMotivation:        { scroll: 'FIRE_SCROLL_2', extra: b => (b.stacks > 1 ? ` ×${b.stacks}` : '') },
        controlTheCurrent:        { scroll: 'WATER_SCROLL_5' },
        breathOfPower:             { scroll: 'WIND_SCROLL_3' },
        respirateWind:             { scroll: 'WIND_SCROLL_2' },
        simplify:                  { scroll: 'VOID_SCROLL_3' },
        mine:                      { scroll: 'CATACOMB_SCROLL_2', extra: b => (b.shrineType ? ` (${b.shrineType})` : '') },
        steamVents:                { scroll: 'CATACOMB_SCROLL_5' },
        mudslide:                  { scroll: 'CATACOMB_SCROLL_1' },
        reflectingPool:            { scroll: 'CATACOMB_SCROLL_7' },
        globalPlacement:           { scroll: 'EARTH_SCROLL_5' },
        waterWindGlobalPlacement:  { scroll: 'CATACOMB_SCROLL_6' },
        earthExtendedPlacement:    { scroll: 'EARTH_SCROLL_3' },
        freedom:                   { scroll: 'WIND_SCROLL_5' },
        quickReflexes:             { scroll: 'CATACOMB_SCROLL_9' },
        excavate:                  { scroll: 'CATACOMB_SCROLL_4' },
        unbiddenLamplight:         { scroll: 'FIRE_SCROLL_1' },
    };
    const BUFFS_ID = 'game-log-buffs';
    let lastBuffsSignature = null;

    function renderActiveBuffs() {
        const el = document.getElementById(BUFFS_ID);
        const active = window.spellSystem?.scrollEffects?.activeBuffs;
        if (!el || !active) return;

        const rows = [];
        for (const key of Object.keys(BUFF_META)) {
            const buff = active[key];
            if (!buff || buff.playerIndex == null) continue;
            const meta = BUFF_META[key];
            const label = scrollDisplayName(meta.scroll) + (meta.extra ? meta.extra(buff) : '');
            rows.push({ key, playerIndex: buff.playerIndex, label, element: elementOf(meta.scroll) });
        }

        const signature = rows.map(r => `${r.playerIndex}:${r.key}:${r.label}`).sort().join('|');
        if (signature === lastBuffsSignature) return; // nothing visibly changed — skip the DOM churn
        lastBuffsSignature = signature;

        if (!rows.length) {
            el.style.display = 'none';
            el.innerHTML = '';
            _fit();
            return;
        }

        el.style.display = '';
        el.innerHTML = '<div class="gl-buffs-title">Active Buffs</div>' +
            rows.map(r => `<div class="gl-buff-row" style="border-left-color:${elColor(r.element)}">` +
                `${playerSpan(r.playerIndex)}: <span style="color:${elColor(r.element)}">${esc(r.label)}</span></div>`
            ).join('');
        _fit();
    }

    // ---- Movement collapsing ----
    let pendingMove = null; // { turn, player, count }

    function flushPendingMove() {
        if (!pendingMove || pendingMove.count <= 0) { pendingMove = null; return; }
        const n = pendingMove.count;
        appendLine(`Moved ${n} space${n === 1 ? '' : 's'}`, 'gl-move');
        pendingMove = null;
    }

    // ---- Turn headers ----
    let lastHeaderTurn = null;

    // ---- Repeat-line multiplier ----
    // Consecutive identical lines ("Placed an earth stone" three times in a
    // row) collapse into one line with a "×N" suffix instead of repeating
    // verbatim — a signature (className+html) identifies "identical", so a
    // change in stone type/scroll/wording always breaks the streak. Reset on
    // every new turn header (see ensureTurnHeader) so a streak never spans a
    // turn boundary — a fresh turn's first action must never just bump last
    // turn's count. baseHtml is kept separate from the element's rendered
    // innerHTML so re-rendering with an incremented count never compounds
    // the previous "×N" into the text itself.
    let lastLine = null; // { el, signature, baseHtml, count } | null

    function _multiplierSuffix(count) {
        return count > 1 ? ` <span class="gl-mult">×${count}</span>` : '';
    }

    // Re-fits the panel to its (now taller) content when autofit is on —
    // js/scroll-panels.js's fitPanel() itself is a no-op when it's off, or
    // when the panel is currently collapsed, so this is always safe to call.
    // Keep only the newest lines: every append re-measures the panel, so an
    // uncapped log made each action a little slower as the game went on.
    const MAX_LOG_LINES = 500;
    function _trim(content) {
        while (content.childElementCount > MAX_LOG_LINES) content.firstElementChild.remove();
    }
    // Scroll to the newest line and refit the panel once per frame, not
    // once per line: both force a layout, and bots add many lines quickly.
    let _scrollQueued = false;
    function _scrollSoon() {
        if (_scrollQueued) return;
        _scrollQueued = true;
        requestAnimationFrame(() => {
            _scrollQueued = false;
            const content = document.getElementById(CONTENT_ID);
            if (!content) return;
            _fit();
            content.scrollTop = content.scrollHeight;
        });
    }
    function _fit() {
        const content = document.getElementById(CONTENT_ID);
        if (content) _trim(content);
        window.ScrollPanelSystem?.fitPanel?.('gamelog');
    }

    function ensureTurnHeader(entry) {
        if (entry.turn == null || entry.turn === lastHeaderTurn) return;
        lastHeaderTurn = entry.turn;
        lastLine = null; // a new turn's first line must never extend last turn's streak
        const content = document.getElementById(CONTENT_ID);
        if (!content) return;
        const botTag = entry.actor === 'bot' ? ' (bot)' : '';
        const div = document.createElement('div');
        div.className = 'gl-turn-header';
        div.innerHTML = `Turn ${entry.turn} - ${playerSpan(entry.player)}${botTag}`;
        content.appendChild(div);
        _scrollSoon();
    }

    function appendLine(html, className) {
        const content = document.getElementById(CONTENT_ID);
        if (!content) return;
        const signature = className + '|' + html;

        if (lastLine && lastLine.signature === signature && lastLine.el.isConnected) {
            lastLine.count++;
            lastLine.el.innerHTML = lastLine.baseHtml + _multiplierSuffix(lastLine.count);
            _scrollSoon();
            return;
        }

        const div = document.createElement('div');
        div.className = 'gl-line ' + className;
        div.innerHTML = html;
        content.appendChild(div);
        lastLine = { el: div, signature, baseHtml: html, count: 1 };
        _scrollSoon();
    }

    // ---- Entry -> line. Returns null to omit. ----
    function describe(entry) {
        switch (entry.type) {
            case 'placeStone': {
                const el = entry.stoneType;
                return {
                    html: `Placed ${aOrAn(el)} <span style="color:${elColor(el)}">${esc(el)}</span> stone`,
                    className: 'gl-place',
                };
            }
            case 'cast_execute': {
                return {
                    html: `Cast <span style="color:${elColor(entry.element)}">${esc(scrollDisplayName(entry.scrollName))}</span>`,
                    className: 'gl-cast',
                };
            }
            case 'effect_execute': {
                if (entry.success === false) return null;
                const text = entry.message || `${scrollDisplayName(entry.scrollName)} resolved.`;
                return {
                    html: `<span style="color:${elColor(elementOf(entry.scrollName))}">${esc(text)}</span>`,
                    className: 'gl-effect',
                };
            }
            case 'response_counter': {
                return {
                    html: `${playerSpan(entry.casterIndex)} counters ${playerSpan(entry.player)}'s ` +
                        `${esc(scrollDisplayName(entry.triggeringScroll))} with ` +
                        `<span style="color:${elColor(elementOf(entry.scrollName))}">${esc(scrollDisplayName(entry.scrollName))}</span>!`,
                    className: 'gl-counter',
                };
            }
            case 'counter_negated': {
                return {
                    html: `${playerSpan(entry.player)} pays ${entry.ransomAP ?? 2} AP - negates ` +
                        `${playerSpan(entry.casterIndex)}'s ${esc(scrollDisplayName(entry.scrollName))}!`,
                    className: 'gl-negated',
                };
            }
            case 'response_resolved': {
                return {
                    html: `${playerSpan(entry.casterIndex)} responds with ` +
                        `<span style="color:${elColor(elementOf(entry.scrollName))}">${esc(scrollDisplayName(entry.scrollName))}</span>`,
                    className: 'gl-response',
                };
            }
            // Reflect and Psychic don't resolve when cast — they queue a
            // scroll to activate at the start of the CASTER's own next turn
            // (see processReflectPending/processPsychicPending in
            // scroll-effects.js). That's easy to miss entirely otherwise: it
            // happens amid a turn-start flurry of other status text with no
            // lasting trace, so these get their own explicit, permanent line.
            case 'reflect_triggered': {
                return {
                    html: `${playerSpan(entry.casterIndex)}'s Reflect activates: ` +
                        `<span style="color:${elColor(elementOf(entry.scrollName))}">${esc(scrollDisplayName(entry.scrollName))}</span>!`,
                    className: 'gl-reflect',
                };
            }
            case 'psychic_triggered': {
                return {
                    html: `${playerSpan(entry.casterIndex)}'s Psychic activates: ` +
                        `<span style="color:${elColor(elementOf(entry.scrollName))}">${esc(scrollDisplayName(entry.scrollName))}</span>!`,
                    className: 'gl-psychic',
                };
            }
            // Excavate (Catacomb IV) is the same "nothing visible happens
            // until the caster's own next turn starts" shape as Reflect/
            // Psychic above — same fix, same reasoning.
            case 'excavate_triggered': {
                return {
                    html: `${playerSpan(entry.casterIndex)}'s ` +
                        `<span style="color:${elColor('catacomb')}">Excavate</span> offers a teleport this turn`,
                    className: 'gl-excavate',
                };
            }
            case 'excavate_teleport_used': {
                return {
                    html: `${playerSpan(entry.casterIndex)} teleports via ` +
                        `<span style="color:${elColor('catacomb')}">Excavate</span>`,
                    className: 'gl-excavate',
                };
            }
            case 'original_countered':
            case 'original_resolved':
            case 'sacrificial_pyre_response_opened':
            case 'sacrificial_pyre_response_submitted':
            case 'discardScroll':
            case 'endTurn':
                return null;
            default:
                return null;
        }
    }

    function handle(entry) {
        // Training game boundaries (bot-arena.js).
        if (entry.type === 'gameStart' || entry.type === 'gameOver') {
            flushPendingMove();
            lastHeaderTurn = null;
            if (entry.type === 'gameStart') appendLine(`<b>New game (${esc(String(entry.nPlayers || ''))} players)</b>`, 'gl-talk');
            else appendLine(`<b>Game over: ${entry.winner != null ? playerSpan(entry.winner) + ' wins' : 'no winner (' + esc(String(entry.endReason || '')) + ')'}${entry.turns ? `, ${entry.turns} turns` : ''}</b>`, 'gl-talk');
            return;
        }
        // Bot alliance talk (js/bot-diplomacy.js): may come from a bot whose
        // turn it is not, so it never opens a turn header. {pN} = player N.
        if (entry.type === 'botTalk') {
            flushPendingMove();
            const html = esc(String(entry.text || '')).replace(/\{p(\d)\}/g, (m, n) => playerSpan(+n));
            appendLine(`<i>${html}</i>`, 'gl-talk');
            return;
        }
        ensureTurnHeader(entry);
        if (entry.type === 'move') {
            if (!pendingMove || pendingMove.turn !== entry.turn || pendingMove.player !== entry.player) {
                flushPendingMove();
                pendingMove = { turn: entry.turn, player: entry.player, count: 0 };
            }
            pendingMove.count++;
            return;
        }
        flushPendingMove();
        const line = describe(entry);
        if (line) appendLine(line.html, line.className);
    }

    // ---- Alliances tab (owner, 2026-09-29) ----
    // A second tab in the Game Log: the current pact, how each bot sees every
    // other player (js/bot-diplomacy.js view()), this game's alliance talk. Tabs switch on pointerdown, and the tab bar is never rebuilt, so
    // a bot acting mid-click cannot swallow the switch during training.
    const ALLY_ID = 'game-log-alliances';
    let allyTab = false, allyHistory = [], allyState = null, lastAllySig = null;
    function initAllianceTab() {
        const wrap = document.getElementById('game-log-body-wrap');
        const content = document.getElementById(CONTENT_ID);
        if (!wrap || !content || document.getElementById('game-log-tabs')) return !!wrap;
        const tabs = document.createElement('div');
        tabs.id = 'game-log-tabs';
        tabs.innerHTML = '<button type="button" data-tab="log" class="gl-tab on">Log</button><button type="button" data-tab="ally" class="gl-tab">Alliances</button>';
        const ally = document.createElement('div');
        ally.id = ALLY_ID;
        ally.style.display = 'none';
        wrap.insertBefore(tabs, wrap.firstChild);
        wrap.appendChild(ally);
        tabs.addEventListener('pointerdown', (e) => {
            const b = e.target.closest('[data-tab]');
            if (!b) return;
            e.preventDefault();
            allyTab = b.dataset.tab === 'ally';
            for (const t of tabs.querySelectorAll('.gl-tab')) t.classList.toggle('on', t === b);
            wrap.classList.toggle('gl-ally-mode', allyTab);
            ally.style.display = allyTab ? '' : 'none';
            lastAllySig = null;
            renderAlliances();
            _fit();
        });
        const D = window.BotDiplomacy;
        D?.onTalk?.(({ text }) => {
            const S = D._state?.();
            if (S !== allyState) { allyState = S; allyHistory = []; }
            const turn = (typeof currentTurnNumber !== 'undefined' && currentTurnNumber) ? currentTurnNumber : (S?.turns ?? 0);
            allyHistory.push({ turn, text });
            if (allyHistory.length > 60) allyHistory.shift();
        });
        return true;
    }
    const fmt = v => (v >= 0 ? '+' : '') + v.toFixed(2);
    function feeling(r) {
        const f = r.favor >= 0.1 ? 'likes' : r.favor <= -0.1 ? 'resents' : 'is neutral to';
        const t = r.trust >= 0.1 ? ', trusts' : r.trust <= -0.1 ? ', distrusts' : '';
        return f + t;
    }
    function renderAlliances() {
        const el = document.getElementById(ALLY_ID);
        const D = window.BotDiplomacy;
        if (!el || !allyTab) return;
        const S = D?._state?.();
        if (S !== allyState) { allyState = S; allyHistory = []; }
        const n = (typeof playerPositions !== 'undefined' && Array.isArray(playerPositions)) ? playerPositions.length : 0;
        const on = !!D?.enabled?.();
        const parts = [];
        const pact = on ? D.pact?.() : null;
        parts.push('<div class="gl-ally-h">Now</div>');
        if (!on) parts.push('<div class="gl-ally-dim">Alliances run in bot training and in online games you host.</div>');
        else if (pact) parts.push(`<div class="gl-ally-pact">${pact.kind === 'grudge' ? 'Grudge pact' : 'Pact against the leader'}: ${pact.members.map(j => playerSpan(j) + (pact.roles?.[j] ? ` (${{ racer: 'racer', scholar: 'scholar', builder: 'builder', guard: 'guard', blocker: 'blocker' }[pact.roles[j]] || pact.roles[j]})` : '')).join(', ')} against ${playerSpan(pact.target)} (${pact.turnsLeft} turns left)</div>`);
        else parts.push('<div class="gl-ally-dim">No pact right now.</div>');
        if (on) {
            for (let o = 0; o < n; o++) {
                if (!playerPositions[o] || !D.isBot?.(o)) continue;
                const rows = D.view(o) || [];
                if (!rows.length) continue;
                const target = D.coalitionTarget?.(o);
                const lines = rows.map(r => `<div class="gl-ally-row" style="color:${r.favor >= 0.1 ? '#8fe0a5' : r.favor <= -0.1 ? '#ff9a8a' : ''}">${feeling(r)} ${playerSpan(r.player)} <span class="gl-ally-dim">(favor ${fmt(r.favor)}, trust ${fmt(r.trust)}, push ${r.push.toFixed(1)})</span></div>`).join('');
                parts.push(`<div class="gl-ally-bot">${playerSpan(o)}${target != null ? ` <span class="gl-ally-dim">wants to stop</span> ${playerSpan(target)}` : ''}${lines}</div>`);
            }
        }
        parts.push('<div class="gl-ally-h">This game</div>');
        if (!allyHistory.length) parts.push('<div class="gl-ally-dim">Nothing said yet.</div>');
        else parts.push(allyHistory.slice(-25).reverse().map(h => `<div class="gl-ally-row"><span class="gl-ally-dim">T${h.turn}</span> ${esc(h.text).replace(/\{p(\d)\}/g, (m, k) => playerSpan(+k))}</div>`).join(''));
        const html = parts.join('');
        if (html === lastAllySig) return; // unchanged: leave the DOM (and any scroll) alone
        lastAllySig = html;
        el.innerHTML = html;
    }

    function init() {
        // Backfill anything already recorded (normally empty this early —
        // defensive only) before subscribing for live updates.
        if (window.ActionLog?.entries) {
            for (const entry of window.ActionLog.entries()) handle(entry);
        }
        if (window.ActionLog?.onRecord) {
            window.ActionLog.onRecord(handle);
        }
        // Active Buffs strip: see renderActiveBuffs()'s own comment for why
        // this is a poll rather than a hook off any single event.
        renderActiveBuffs();
        // Hidden tab: skip the redraw; the next tick after coming back catches up.
        setInterval(() => { if (!document.hidden) renderActiveBuffs(); }, 800);
        // The Game Log panel is built by scroll-panels.js; add the tabs once it exists.
        const tabTimer = setInterval(() => { if (initAllianceTab()) clearInterval(tabTimer); }, 500);
        setInterval(() => { if (!document.hidden) renderAlliances(); }, 1000);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
