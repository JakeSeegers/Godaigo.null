// ui-fit.js: smart sizing for the top HUD bar and the bottom dock (window.UiFit).
//
// The owner places buttons by hand (TheHermit, js/thehermit.js: order + fixed
// spacers). At full size that layout is kept exactly. When a bar does not fit
// the window, this steps down, one step at a time, until it fits:
//   1. spacers shrink (CSS: .hermit-spacer may shrink inside the bars)
//   2. the bar's contents scale down (CSS zoom), to 75%
//   3. long labels get short ones ("Activate Scroll" -> "Activate")
//   4. the least needed buttons move into a "More" menu (the real buttons stay
//      in the page, hidden; the menu clicks them, so all game code still works)
//   5. the bar wraps onto two rows (phones)
// Re-checked on resize and when a bar's content changes (1 s check).
// EXPERIMENT, OFF by default (owner 2026-10-03: keep the current hand-made layout
// safe). Only the Hermit menu "Smart UI fit" toggle turns it on, for that browser
// (localStorage godaigo_ui_fit = 'on'). All its CSS is scoped to html.ui-fit-on, so
// with it off nothing changes at all.
(function () {
    'use strict';

    let enabled = (() => { try { return localStorage.getItem('godaigo_ui_fit') === 'on'; } catch (e) { return false; } })();
    const MIN_SCALE = 0.75;
    // Short labels (plain-text buttons only; buttons with counters are left alone).
    const SHORT = {
        'scroll-reference-btn': 'Scrolls', 'panel-btn-gamelog': 'Log', 'panel-btn-rulebook': 'Rules',
        'panel-btn-opponents': 'Players', 'elemental-stones-btn': 'Stones', 'panel-btn-common': 'Common',
        'undo-move': 'Undo', 'cast-spell': 'Activate',
    };
    // Into "More" first (least needed in play); game actions never move.
    const MORE_ORDER = ['scroll-reference-btn', 'panel-btn-rulebook', 'cosmetics-panel-btn', 'emoji-panel-btn',
        'settings-panel-btn', 'panel-btn-gamelog', 'elemental-stones-btn'];
    const MORE_LABEL = { 'cosmetics-panel-btn': 'Colours', 'emoji-panel-btn': 'Emojis', 'settings-panel-btn': 'Settings' };

    const bars = [
        { name: 'hud', bar: () => document.querySelector('.hud-bar'), parts: () => [...document.querySelectorAll('.hud-bar .hud-section')] },
        { name: 'dock', bar: () => document.querySelector('.dock-bar'), parts: () => [...document.querySelectorAll('.dock-bar .dock-actions')] },
    ];
    const state = { hud: null, dock: null };
    const visible = (el) => !!el && el.offsetParent !== null && getComputedStyle(el).display !== 'none';
    const overflowing = (bar) => bar.scrollWidth > bar.clientWidth + 1 ||
        [...bar.querySelectorAll('.hud-section, .dock-actions')].some(p => p.scrollWidth > p.clientWidth + 1);

    function setScale(b, s) { for (const p of b.parts()) p.style.zoom = s === 1 ? '' : String(s); }
    function setShort(b, on) {
        const bar = b.bar();
        for (const id in SHORT) {
            const el = document.getElementById(id);
            if (!el || !bar.contains(el) || el.children.length) continue;
            if (on) { if (!el.dataset.longLabel) el.dataset.longLabel = el.textContent; el.textContent = SHORT[id]; }
            else if (el.dataset.longLabel) { el.textContent = el.dataset.longLabel; delete el.dataset.longLabel; }
        }
    }
    function moreButton(b) {
        const bar = b.bar();
        let m = bar.querySelector('.ui-fit-more');
        if (!m) {
            m = document.createElement('button');
            m.type = 'button';
            m.className = 'ui-fit-more';
            m.textContent = 'More';
            m.title = 'More buttons';
            m.onclick = (e) => { e.stopPropagation(); toggleMenu(b, m); };
            const host = b.name === 'hud' ? bar.querySelector('.hud-section.right') || bar : bar.querySelector('.dock-actions') || bar;
            host.appendChild(m);
        }
        return m;
    }
    function setHidden(b, ids) {
        const bar = b.bar();
        bar.querySelectorAll('[data-ui-fit-hidden]').forEach(el => { el.style.display = el.dataset.uiFitDisplay || ''; delete el.dataset.uiFitHidden; delete el.dataset.uiFitDisplay; });
        for (const id of ids) {
            const el = document.getElementById(id);
            if (!el || !bar.contains(el)) continue;
            el.dataset.uiFitDisplay = el.style.display || '';
            el.dataset.uiFitHidden = '1';
            el.style.display = 'none';
        }
        const m = bar.querySelector('.ui-fit-more');
        if (ids.length) moreButton(b).style.display = '';
        else if (m) m.style.display = 'none';
    }
    function toggleMenu(b, anchor) {
        let menu = document.getElementById('ui-fit-menu');
        if (menu && menu.dataset.bar === b.name) { menu.remove(); return; }
        menu?.remove();
        menu = document.createElement('div');
        menu.id = 'ui-fit-menu';
        menu.dataset.bar = b.name;
        for (const el of b.bar().querySelectorAll('[data-ui-fit-hidden]')) {
            const item = document.createElement('button');
            item.type = 'button';
            item.textContent = MORE_LABEL[el.id] || el.dataset.longLabel || el.textContent.trim() || el.title || el.id;
            item.onclick = () => { menu.remove(); el.click(); };
            menu.appendChild(item);
        }
        document.body.appendChild(menu);
        const r = anchor.getBoundingClientRect();
        const top = b.name === 'hud' ? r.bottom + 4 : r.top - menu.offsetHeight - 4;
        menu.style.top = Math.max(4, top) + 'px';
        menu.style.left = Math.max(4, Math.min(innerWidth - menu.offsetWidth - 4, r.right - menu.offsetWidth)) + 'px';
        setTimeout(() => document.addEventListener('click', function close(ev) {
            if (!menu.contains(ev.target)) { menu.remove(); document.removeEventListener('click', close, true); }
        }, true), 0);
    }
    function setWrap(b, on) { b.bar().classList.toggle('ui-fit-wrap', on); }

    function fitBar(b) {
        const bar = b.bar();
        if (!visible(bar)) return;
        // start from the full design
        setWrap(b, false); setScale(b, 1); setShort(b, false); setHidden(b, []);
        let level = 0, scale = 1, hidden = [];
        if (overflowing(bar)) {
            level = 2;
            while (overflowing(bar) && scale > MIN_SCALE + 0.001) { scale = Math.round((scale - 0.05) * 100) / 100; setScale(b, scale); }
        }
        if (overflowing(bar)) { level = 3; setShort(b, true); }
        if (overflowing(bar)) {
            level = 4;
            for (const id of MORE_ORDER) {
                const el = document.getElementById(id);
                if (!el || !bar.contains(el) || !visible(el)) continue;
                hidden.push(id);
                setHidden(b, hidden);
                if (!overflowing(bar)) break;
            }
        }
        if (overflowing(bar)) { level = 5; setWrap(b, true); }
        state[b.name] = { level, scale, hidden: hidden.slice(), width: innerWidth };
        document.body.dataset[b.name === 'hud' ? 'uiFitHud' : 'uiFitDock'] = String(level);
    }

    let pending = false;
    function fitAll() {
        if (!enabled || pending) return;
        pending = true;
        requestAnimationFrame(() => {
            pending = false;
            document.getElementById('ui-fit-menu')?.remove();
            for (const b of bars) { try { fitBar(b); } catch (e) { console.warn('[UiFit]', e); } }
        });
    }

    // Put every bar back to the hand-made design.
    function restoreAll() {
        document.getElementById('ui-fit-menu')?.remove();
        for (const b of bars) {
            const bar = b.bar();
            if (!bar) continue;
            setWrap(b, false); setScale(b, 1); setShort(b, false); setHidden(b, []);
            bar.querySelector('.ui-fit-more')?.remove();
        }
        delete document.body.dataset.uiFitHud; delete document.body.dataset.uiFitDock;
    }
    function setEnabled(on) {
        enabled = !!on;
        try { localStorage.setItem('godaigo_ui_fit', enabled ? 'on' : 'off'); } catch (e) {}
        document.documentElement.classList.toggle('ui-fit-on', enabled);
        if (enabled) { sig = ''; fitAll(); } else restoreAll();
    }

    window.addEventListener('resize', fitAll);
    // Content changes (buttons shown / hidden, counters, End Turn appearing).
    let sig = '';
    setInterval(() => {
        if (!enabled) return;
        const parts = [innerWidth, innerHeight];
        for (const b of bars) {
            const bar = b.bar();
            if (!bar) continue;
            parts.push(visible(bar), [...bar.querySelectorAll('button, .dock-turn-indicator, .hud-timer')]
                .filter(el => !el.dataset.uiFitHidden).map(el => el.offsetParent ? 1 : 0).join(''), overflowing(bar));
        }
        const s2 = parts.join('|');
        if (s2 !== sig) { sig = s2; fitAll(); }
    }, 1000);
    if (enabled) {
        document.documentElement.classList.add('ui-fit-on');
        document.addEventListener('DOMContentLoaded', fitAll);
    }

    window.UiFit = { fit: fitAll, state: () => JSON.parse(JSON.stringify(state)), isEnabled: () => enabled, setEnabled };
})();
