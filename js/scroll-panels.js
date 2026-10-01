// ============================================
// FLOATING SCROLL PANELS
// ============================================
// Three independently floating panels: Hand | Active | Common
// Each is draggable, resizable, and collapsible.
// Replaces spellSystem.showInventory() modal.
// Triggered by #scroll-inventory dock button.
// ============================================

const ScrollPanelSystem = (() => {
    'use strict';

    // ---- Config ----
    // common: 6, not 5 — spellSystem.commonArea holds one slot per element
    // (earth/water/fire/wind/void/catacomb, see getCommonAreaScrolls() in
    // game-core.js, and the "(N/6)" label the old inventory modal already
    // used), so a full common area was 6 scrolls behaving completely
    // normally, just past a badge/pulse threshold that was one element short.
    const CAPACITY    = { hand: 2, active: 2, common: 6 };
    const STORAGE_KEY = 'godaigo_scroll_panels_v8';  // bumped — cards flex column, height 400, autofit on by default
    const EL_COLORS   = {
        earth: '#69d83a', water: '#5894f4', fire: '#ed1b43',
        wind: '#ffce00', void: '#9458f4', catacomb: '#c8a870' // catacomb scrolls use ScrollLook (two colors)
    };

    // Static reference text for the Elemental Stones panel's hover preview —
    // replaces the old click-to-open "Elemental Reference" popup (index.html's
    // #stone-info-overlay / showStoneInfoPopup(), both removed). Read by
    // _buildStoneCard() below via the same hover-preview plumbing _buildCard()
    // already uses for scroll cards.
    const STONE_INFO = {
        earth: { name: 'Earth', rank: 5, cost: 5, ability: 'Cannot be walked through.', interaction: null },
        water: { name: 'Water', rank: 4, cost: 4, ability: 'Adopts the ability of an adjacent Earth or Wind stone.', interaction: null },
        fire:  { name: 'Fire',  rank: 3, cost: 3, ability: 'Stones other than Void or Fire are destroyed if adjacent to them.', interaction: 'Countered by: Void stones' },
        wind:  { name: 'Wind',  rank: 2, cost: 2, ability: 'Costs zero AP to walk through.', interaction: null },
        void:  { name: 'Void',  rank: 1, cost: 1, ability: 'Nullifies the effects of adjacent stones. Can be spent as action points from your inventory.', interaction: 'Counters: adjacent stone effects' },
    };

    // Default positions — matches a reference layout the user arranged and
    // asked to become the default for a fresh session (screenshot-estimated
    // pixel coordinates, clamped to whatever viewport actually loads via
    // _clampToViewport). Hand/Active/Common default COLLAPSED (compact
    // Name/Type/Level list) — that was part of "like this", not just position.
    // User-captured layout (console snapshot combining localStorage's
    // x/y/w/h/collapsed/autofit with a live ScrollPanelSystem.isOpen() read
    // per panel — see js/INDEX.md) taken as the new default wholesale,
    // including collapsed and open state, not just position. w/h are moot
    // for any panel whose autofit is on (hand/active/common/opponents) or
    // that uses opts.autoHeight (elementalstones) — both recompute their own
    // size from content on render/creation regardless of what's stored here
    // — kept anyway for completeness/documentation.
    const DEFAULTS = {
        hand:   { x: 0,    y: 89,  w: 484, h: 446, collapsed: true,  autofit: true },
        active: { x: 2,    y: 175, w: 484, h: 446, collapsed: true,  autofit: true },
        common: { x: 0,    y: 280, w: 722, h: 446, collapsed: true,  autofit: true },
        gamelog:         { x: 1184, y: 103, w: 235, h: 195, collapsed: false, autofit: false },
        opponents:       { x: 1429, y: 92,  w: 273, h: 461, collapsed: false, autofit: true },
        elementalstones: { x: 1,    y: 761, w: 628, h: 100, collapsed: false, autofit: false },
        // Closed by default (not in DEFAULT_OPEN_IDS) — it's an on-demand
        // reference, same spirit as the Scroll Reference popup, not an
        // ambient panel a player wants up the whole game.
        rulebook:        { x: 360,  y: 150, w: 560, h: 520, collapsed: false, autofit: false },
    };
    // All six now default OPEN (not just the three ambient ones) — see
    // openAmbientPanels()/init()'s call site below.
    const DEFAULT_OPEN_IDS = ['hand', 'active', 'common', 'gamelog', 'opponents', 'elementalstones'];

    const panels = {};      // { id → { el, state, open } }
    let initialized = false;

    // ---- Persistence ----
    function loadStored() {
        try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}; } catch { return {}; }
    }
    function saveState() {
        const out = {};
        Object.keys(panels).forEach(id => { out[id] = { ...panels[id].state }; });
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(out)); } catch {}
    }

    // Clamp a panel position into the current viewport — a position saved on
    // a wider/taller window (or dragged to the far edge) would otherwise put
    // the panel entirely offscreen, making every "open" look like a no-op.
    // localStorage survives hard refreshes, so without this the panel stays
    // lost until site data is cleared. Same 60/40px margins the drag handler
    // enforces.
    function _clampToViewport(state) {
        state.x = Math.max(0, Math.min(window.innerWidth  - 60, state.x));
        state.y = Math.max(0, Math.min(window.innerHeight - 40, state.y));
    }

    // ---- Panel creation ----
    // opts:
    //   panelId  — use this as the outer element's id instead of 'fsp-'+id.
    //              Needed when OTHER code already has hard id references into
    //              a panel being migrated to this system (elemental-stones-panel's
    //              stone-return drag logic, right-panel — see game-ui.js).
    //   bodyEl   — reuse this EXISTING element as the .fsp-body instead of
    //              creating one fresh, preserving its own id/children/classes
    //              (new-opponent-cards' population code, elemental-stones-body's
    //              stone cards). Its own id wins over bodyId/the default
    //              convention if it already has one.
    //   bodyId   — id to give a freshly-created body div (ignored if bodyEl
    //              already has an id). Defaults to 'fsp-body-'+id, same as
    //              every panel before this option existed.
    //   noBadge  — omit the capacity badge (hand/active/common only concept).
    //   noAutofit — force autofit off and omit the autofit button; content
    //              here isn't scroll cards, so the AUTOFIT_CARD_W/H formula
    //              (fitPanel) would size the panel completely wrong for it.
    //   lockAutofit — the opposite: force autofit PERMANENTLY ON (ignoring
    //              any stored false — there's no benefit to it ever being
    //              off) and omit the button, since there's nothing useful
    //              for it to toggle. Pairs naturally with noResize — the
    //              resize handle is already hidden whenever autofit is on
    //              (see below), so with no way to ever turn autofit off,
    //              it would just be permanently unreachable dead UI.
    //   noCollapse — omit the collapse (−) button. Collapsing swaps the body
    //              for #fsp-compact-{id} (see _applyCollapsed), which is only
    //              ever populated for scroll-card panels (_renderCompactList)
    //              — for anything else it's just an empty box, so the button
    //              doesn't do anything useful (Elemental Stones' own reason
    //              for opting out).
    //   autoHeight — no inline width/height at all, ever (ignores DEFAULTS
    //              and any stored size) — the flex column just hugs its
    //              content's natural size via plain CSS. For a panel whose
    //              content is fixed and never varies, there's nothing to
    //              size beyond what the browser already computes for free.
    //              Pair with noResize (below) — a panel with no resize
    //              handle should never end up with a stray inline size either.
    //   noResize — omit the resize handle entirely. Without this, an
    //              accidental drag can lock in a taller/wider-than-content
    //              size forever (_makeResizable's Math.max(100, ...) floor
    //              means even a 1px nudge sets a 100px minimum height) —
    //              exactly what caused Elemental Stones' reported "big
    //              bottom margin" even after autoHeight was added.
    function createPanel(id, title, opts = {}) {
        const stored = loadStored()[id] || {};
        const state  = { ...DEFAULTS[id], ...stored };
        _clampToViewport(state);
        if (opts.noAutofit) state.autofit = false;
        if (opts.lockAutofit) state.autofit = true;

        const el = document.createElement('div');
        el.className     = 'fsp';
        el.id            = opts.panelId || ('fsp-' + id);
        el.dataset.panel = id;
        // opts.autoHeight (paired with opts.noResize below — a panel with no
        // way to resize should never end up with a stray inline height
        // either): no inline width/height at all, ever, regardless of any
        // stored state — the flex column just hugs its content's natural
        // size via normal CSS. For a fixed single-row panel like Elemental
        // Stones there's nothing to "fit" beyond what CSS does for free,
        // and no benefit to ever being taller/wider than that.
        if (opts.autoHeight) {
            el.style.left = state.x + 'px';
            el.style.top  = state.y + 'px';
        } else {
            el.style.cssText = `left:${state.x}px; top:${state.y}px; width:${state.w}px;`;
            if (!state.collapsed) el.style.height = state.h + 'px';
        }

        const header = document.createElement('div');
        header.className = 'fsp-header';
        header.setAttribute('data-drag-handle', '');
        header.innerHTML = `
            <span class="fsp-title">${title}</span>
            ${opts.noBadge ? '' : `<span class="fsp-badge" id="fsp-badge-${id}">0/0</span>`}
            ${(opts.noAutofit || opts.lockAutofit) ? '' : `<button class="fsp-btn fsp-autofit-btn" title="Auto-fit height to content">↕</button>`}
            ${opts.noCollapse ? '' : `<button class="fsp-btn fsp-collapse-btn" title="Collapse / expand">−</button>`}
            <button class="fsp-btn fsp-close-btn"    title="Close">✕</button>
        `;
        el.appendChild(header);

        const bodyEl = opts.bodyEl || document.createElement('div');
        bodyEl.classList.add('fsp-body');
        if (!bodyEl.id) bodyEl.id = opts.bodyId || ('fsp-body-' + id);
        el.appendChild(bodyEl);

        const compact = document.createElement('div');
        compact.className   = 'fsp-compact';
        compact.id           = 'fsp-compact-' + id;
        compact.style.display = 'none';
        el.appendChild(compact);

        // opts.noResize: no handle at all — for a panel whose size is
        // always exactly its (fixed, unchanging) content, a resize handle
        // only invites an accidental drag that locks in a taller-than-
        // needed height forever (Math.max(100, ...) in _makeResizable
        // means even a 1px nudge sets a 100px floor) — Elemental Stones'
        // reported "big bottom margin" was exactly that.
        const handle = opts.noResize ? null : document.createElement('div');
        if (handle) {
            handle.className = 'fsp-resize-handle';
            handle.title      = 'Drag to resize';
            el.appendChild(handle);
        }

        document.body.appendChild(el);
        panels[id] = { el, state, open: false, bodyId: bodyEl.id, dockBtnId: opts.dockBtnId || ('panel-btn-' + id) };

        // Apply saved collapsed state
        if (state.collapsed) _applyCollapsed(id, true);

        // Wire buttons
        header.querySelector('.fsp-close-btn').addEventListener('click', e => { e.stopPropagation(); closePanel(id); });
        const collapseBtn = header.querySelector('.fsp-collapse-btn');
        if (collapseBtn) collapseBtn.addEventListener('click', e => { e.stopPropagation(); toggleCollapse(id); });

        const autofitBtn = header.querySelector('.fsp-autofit-btn');
        if (autofitBtn) {
            if (state.autofit !== false) autofitBtn.classList.add('fsp-autofit-active');
            autofitBtn.addEventListener('click', e => { e.stopPropagation(); setAutofit(id, !panels[id].state.autofit); });
        }

        // Hide resize handle immediately if autofit is on and panel isn't collapsed
        if (handle && state.autofit !== false && !state.collapsed) {
            handle.style.display = 'none';
        }

        // Drag & resize
        _makeDraggable(el, header, id);
        if (handle) _makeResizable(el, handle, id);

        return el;
    }

    // ---- Drag ----
    function _makeDraggable(panel, handle, id) {
        let ox, oy, ol, ot, active = false;

        handle.addEventListener('mousedown', e => {
            if (e.button !== 0) return;
            if (e.target.classList.contains('fsp-btn')) return;
            active = true;
            ox = e.clientX; oy = e.clientY;
            ol = parseInt(panel.style.left) || 0;
            ot = parseInt(panel.style.top)  || 0;
            panel.style.transition = 'none';
            document.body.style.userSelect = 'none';
            e.preventDefault();
        });

        const onMove = e => {
            if (!active) return;
            const nx = Math.max(0, Math.min(window.innerWidth  - 60, ol + (e.clientX - ox)));
            const ny = Math.max(0, Math.min(window.innerHeight - 40, ot + (e.clientY - oy)));
            panel.style.left = nx + 'px';
            panel.style.top  = ny + 'px';
        };
        const onUp = () => {
            if (!active) return;
            active = false;
            document.body.style.userSelect = '';
            panels[id].state.x = parseInt(panel.style.left);
            panels[id].state.y = parseInt(panel.style.top);
            saveState();
        };

        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup',   onUp);
    }

    // ---- Resize ----
    function _makeResizable(panel, handle, id) {
        let sx, sy, sw, sh, active = false;

        handle.addEventListener('mousedown', e => {
            e.stopPropagation();
            active = true;
            sx = e.clientX; sy = e.clientY;
            sw = panel.offsetWidth; sh = panel.offsetHeight;
            panel.style.transition = 'none';
            document.body.style.userSelect = 'none';
            e.preventDefault();
        });

        const onMove = e => {
            if (!active) return;
            const w = Math.max(180, sw + (e.clientX - sx));
            const h = Math.max(100, sh + (e.clientY - sy));
            panel.style.width  = w + 'px';
            panel.style.height = h + 'px';
        };
        const onUp = () => {
            if (!active) return;
            active = false;
            document.body.style.userSelect = '';
            panels[id].state.w = panel.offsetWidth;
            panels[id].state.h = panel.offsetHeight;
            saveState();
        };

        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup',   onUp);
    }

    // ---- Collapse ----
    // Collapsed no longer just hides everything down to a bare title bar —
    // it swaps the full card grid for a compact Name / Type / Level list
    // (fsp-compact), so the button actually has a purpose: a quick glance at
    // what's in hand/active/common without the full card real estate.
    function _applyCollapsed(id, collapsed) {
        const { el, state, bodyId } = panels[id];
        state.collapsed = collapsed;
        const body    = document.getElementById(bodyId || ('fsp-body-' + id));
        const compact = document.getElementById('fsp-compact-' + id);
        const handle  = el.querySelector('.fsp-resize-handle');
        const btn     = el.querySelector('.fsp-collapse-btn');
        if (collapsed) {
            if (body)    body.style.display    = 'none';
            if (compact) compact.style.display = '';
            if (handle)  handle.style.display  = 'none';
            if (btn)     btn.textContent        = '+';
            el.style.height = '';
            // Shrink to fit the compact list's own content instead of
            // staying at whatever width the full card grid needed — a
            // one-line "Reflecting Pool · Catacomb · Lv. II" row doesn't
            // need the same width as a row of 400px-wide cards.
            el.style.width = '';
        } else {
            if (body)    body.style.display    = '';
            if (compact) compact.style.display = 'none';
            if (handle)  handle.style.display  = (state.autofit !== false) ? 'none' : '';
            if (btn)     btn.textContent        = '−';
            if (state.h) el.style.height = state.h + 'px';
            // Restore the card-grid width (autofit recomputes it fresh below
            // if enabled; otherwise fall back to the last saved width).
            el.style.width = (state.w || DEFAULTS[id].w) + 'px';
            if (state.autofit !== false) fitPanel(id);
        }
    }
    function toggleCollapse(id) {
        _applyCollapsed(id, !panels[id].state.collapsed);
        saveState();
    }

    // ---- Reset to defaults ----
    // Re-applies each panel's DEFAULTS position/size/collapsed state to both
    // panels[id].state and the live DOM, without touching what's saved in
    // localStorage — used by the tutorial so its walkthrough always starts
    // from the same known layout regardless of how a player previously
    // dragged/resized these panels in a real game. Omit `ids` to reset all.
    function resetToDefaults(ids) {
        (ids || Object.keys(DEFAULTS)).forEach(id => {
            const p = panels[id];
            if (!p || !DEFAULTS[id]) return;
            const state = { ...DEFAULTS[id] };
            _clampToViewport(state);
            p.state = state;
            if (id === 'elementalstones') {
                // autoHeight panel (see createPanel's opts.autoHeight) — no
                // inline width/height, ever; just reposition it.
                p.el.style.left = state.x + 'px';
                p.el.style.top  = state.y + 'px';
            } else {
                p.el.style.left   = state.x + 'px';
                p.el.style.top    = state.y + 'px';
                p.el.style.width  = state.w + 'px';
                p.el.style.height = state.collapsed ? '' : state.h + 'px';
            }
            _applyCollapsed(id, state.collapsed);
        });
    }

    // ---- Open / close ----
    // Syncs the associated dock/HUD button's lit (fsp-dock-btn-open) state
    // right here, not just from each button's own click handler — a panel
    // can also close via its own header ✕ button (createPanel's
    // .fsp-close-btn wiring calls closePanel(id) directly), which used to
    // leave the dock button stuck lit since nothing else updated it.
    function _syncDockBtn(id) {
        const p = panels[id];
        const btn = p && document.getElementById(p.dockBtnId || ('panel-btn-' + id));
        if (btn) btn.classList.toggle('fsp-dock-btn-open', !!p.open);
    }

    function openPanel(id) {
        const p = panels[id];
        if (!p) return;
        // Re-clamp on every open — the window may have shrunk (or the panel
        // been dragged near an edge) since createPanel restored the position.
        _clampToViewport(p.state);
        p.el.style.left = p.state.x + 'px';
        p.el.style.top  = p.state.y + 'px';
        p.open = true;
        p.el.style.display = 'flex';
        renderPanel(id);
        // renderPanel() already calls fitPanel() itself for hand/active/common
        // (redundant-but-harmless to call again here); it early-returns for
        // everything else, so this is the only fitPanel() call gamelog/
        // opponents get on open — sizes them to whatever content already
        // rendered before this open (their own code re-fits on every new
        // line/card after this).
        fitPanel(id);
        _syncDockBtn(id);
    }

    function closePanel(id) {
        const p = panels[id];
        if (!p) return;
        p.open = false;
        p.el.style.display = 'none';
        _syncDockBtn(id);
    }

    function toggle() {
        const anyOpen = Object.values(panels).some(p => p.open);
        if (anyOpen) {
            Object.keys(panels).forEach(closePanel);
        } else {
            Object.keys(panels).forEach(openPanel);
        }
    }

    // ---- Capacity badge + glow ----
    function _updateBadge(id, current, max) {
        const badge = document.getElementById('fsp-badge-' + id);
        if (badge) badge.textContent = current + '/' + max;
        const header = panels[id]?.el?.querySelector('.fsp-header');
        if (header) header.classList.toggle('fsp-over-capacity', current > max);
    }

    // ---- Scroll card builder ----
    const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V'];

    // Shared name/type/level lookup — used by both the full card and the
    // collapsed compact-list row so they never disagree.
    function _scrollMeta(scrollName) {
        const sp = window.spellSystem;
        if (!sp) return null;
        const def = sp.patterns?.[scrollName] || window.SCROLL_DEFINITIONS?.[scrollName];
        if (!def) return null;
        const element = typeof sp.getScrollElement === 'function'
            ? sp.getScrollElement(scrollName) : 'earth';
        // A catacomb scroll blends two elements: colors = both (ScrollLook, game-core.js)
        const look    = window.ScrollLook;
        const colors  = look ? look.colors(scrollName) : [EL_COLORS[element] || '#aaa'];
        const color   = colors[0];
        const bg      = look ? look.gradient(colors) : color;
        const elLabel = look ? look.label(scrollName) : (element ? element.charAt(0).toUpperCase() + element.slice(1) : '');
        const lvLabel = def.level ? 'Lv. ' + (ROMAN[def.level] || def.level) : '';
        return { def, element, colors, color, bg, elLabel, lvLabel, name: def.name || scrollName };
    }

    // ---- Compact list row (shown in place of the cards while collapsed) ----
    function _buildCompactRow(scrollName) {
        const meta = _scrollMeta(scrollName);
        if (!meta) return null;

        const row = document.createElement('div');
        row.className = 'fsp-compact-row';
        row.dataset.scrollName = scrollName;

        const dot = document.createElement('span');
        dot.className = 'fsp-compact-dot';
        dot.style.background = meta.bg;
        row.appendChild(dot);

        const name = document.createElement('span');
        name.className = 'fsp-compact-name';
        name.textContent = meta.name;
        row.appendChild(name);

        const meta_ = document.createElement('span');
        meta_.className = 'fsp-compact-meta';
        meta_.textContent = [meta.elLabel, meta.lvLabel].filter(Boolean).join(' · ');
        row.appendChild(meta_);

        // No click handler — hovering shows the same preview a full card
        // gets (see _initCardHoverPreview's delegated listeners below).
        return row;
    }

    function _renderCompactList(id, scrollNames) {
        const compact = document.getElementById('fsp-compact-' + id);
        if (!compact) return;
        compact.innerHTML = '';
        if (!scrollNames.length) {
            compact.innerHTML = '<div class="fsp-compact-empty">Empty</div>';
            return;
        }
        const frag = document.createDocumentFragment();
        scrollNames.forEach(n => { const r = _buildCompactRow(n); if (r) frag.appendChild(r); });
        compact.appendChild(frag);
    }

    function _buildCard(scrollName, area) {
        const sp = window.spellSystem;
        if (!sp) return null;

        const meta = _scrollMeta(scrollName);
        if (!meta) return null;
        const { def, element, colors, color, bg, elLabel, lvLabel } = meta;
        const iconSrc  = window.STONE_TYPES?.[element]?.img || '';

        const canModify = (typeof isMultiplayer === 'undefined' || !isMultiplayer)
            || (typeof myPlayerIndex !== 'undefined' && typeof activePlayerIndex !== 'undefined'
                && myPlayerIndex === activePlayerIndex);

        const card = document.createElement('div');
        card.className = 'fsp-card';
        card.dataset.scrollName = scrollName;
        card.dataset.area = area;
        card.style.setProperty('--el-color', color);
        if (colors.length > 1) {
            card.classList.add('fsp-card-blend');
            card.style.setProperty('--el-color2', colors[1]);
            card.style.setProperty('--el-grad', bg);
        }

        // ── Header: icon · name · level · tag ──────────────────────────
        const hdr = document.createElement('div');
        hdr.className = 'fsp-card-header';

        if (element === 'catacomb' && window.ScrollLook) {
            hdr.insertAdjacentHTML('beforeend', window.ScrollLook.iconHtml(scrollName, 'fsp-card-icon'));
        } else if (iconSrc) {
            const icon = document.createElement('img');
            icon.src = iconSrc;
            icon.className = 'fsp-card-icon';
            icon.alt = element;
            hdr.appendChild(icon);
        }

        const titleWrap = document.createElement('div');
        titleWrap.className = 'fsp-card-title';

        const nameEl = document.createElement('span');
        nameEl.className = 'fsp-card-name';
        nameEl.textContent = def.name || scrollName;
        titleWrap.appendChild(nameEl);

        const metaEl = document.createElement('span');
        metaEl.className = 'fsp-card-meta';
        metaEl.textContent = [elLabel, lvLabel].filter(Boolean).join(' · ');
        if (colors.length > 1 && window.ScrollLook) metaEl.style.cssText = window.ScrollLook.textStyle(scrollName);
        titleWrap.appendChild(metaEl);

        hdr.appendChild(titleWrap);

        if (def.isCounter) {
            const tag = document.createElement('span');
            tag.className = 'fsp-card-tag fsp-tag-counter';
            tag.textContent = 'COUNTER';
            hdr.appendChild(tag);
        } else if (def.isResponse) {
            const tag = document.createElement('span');
            tag.className = 'fsp-card-tag fsp-tag-response';
            tag.textContent = 'RESPONSE';
            hdr.appendChild(tag);
        }

        card.appendChild(hdr);

        // ── Description ─────────────────────────────────────────────────
        if (def.description) {
            const desc = document.createElement('div');
            desc.className = 'fsp-card-desc';
            desc.textContent = def.description;
            card.appendChild(desc);
        }

        // ── Stone pattern visual (scaled-down hex grid) ─────────────────
        if (def.patterns && typeof sp.createPatternVisual === 'function') {
            const patWrap = document.createElement('div');
            patWrap.className = 'fsp-card-pattern';
            try {
                const visual = sp.createPatternVisual(def, element);
                patWrap.appendChild(visual);
            } catch (e) { /* pattern rendering failed — skip */ }
            card.appendChild(patWrap);
        }

        // ── Action buttons ───────────────────────────────────────────────
        if (canModify) {
            const acts = document.createElement('div');
            acts.className = 'fsp-card-actions';

            if (area === 'hand') {
                // Hand → move to Active Area
                const toActive = document.createElement('button');
                toActive.className = 'fsp-card-btn';
                toActive.textContent = 'Move to Active Area';
                toActive.addEventListener('click', e => {
                    e.stopPropagation();
                    const dest = document.getElementById('fsp-active');
                    if (dest) animateCardMove(card, dest);
                    if (window.isTutorialMode && window.TutorialMode?.onScrollMoved) {
                        window.TutorialMode.onScrollMoved(scrollName, 'hand', 'active');
                    }
                    // Record undo state before moving
                    window.lastScrollAction = { type: 'scroll-move', scrollName, from: 'hand', to: 'active', displacedScroll: null };
                    window.clearPawnUndo?.(); // Undo now means this scroll move, not an earlier pawn/stone action
                    window.SoundSystem?.play('scrollmove');
                    // Mutate state immediately so an "Undo Step" fired before the animation's
                    // 60ms elapses reverses a move that has actually happened, instead of a
                    // no-op that the still-pending move below then applies anyway. Only the
                    // visual refresh (which would otherwise cut off the animation) is delayed.
                    sp.moveToActive(scrollName);
                    setTimeout(() => { refresh(); }, 60);
                });
                acts.appendChild(toActive);

                // Hand → move to Common Area
                const toCommon = document.createElement('button');
                toCommon.className = 'fsp-card-btn fsp-card-btn-alt';
                toCommon.textContent = 'Move to Common Area';
                toCommon.addEventListener('click', e => {
                    e.stopPropagation();
                    const dest = document.getElementById('fsp-common');
                    if (dest) animateCardMove(card, dest);
                    if (window.isTutorialMode && window.TutorialMode?.onScrollMoved) {
                        window.TutorialMode.onScrollMoved(scrollName, 'hand', 'common');
                    }
                    // Capture any scroll that will be displaced from common area by this move
                    const element = sp.getScrollElement?.(scrollName);
                    const displaced = element ? (sp.commonArea?.[element] || null) : null;
                    window.lastScrollAction = { type: 'scroll-move', scrollName, from: 'hand', to: 'common', displacedScroll: displaced !== scrollName ? displaced : null };
                    window.clearPawnUndo?.();
                    window.SoundSystem?.play('scrollmove');
                    // Mutate state immediately — see the "Move to Active Area" handler above.
                    sp.discardScroll(scrollName);
                    setTimeout(() => { refresh(); }, 60);
                });
                acts.appendChild(toCommon);
            }

            if (area === 'active') {
                // Active → move to Common Area
                const toCommon = document.createElement('button');
                toCommon.className = 'fsp-card-btn fsp-card-btn-alt';
                toCommon.textContent = 'Move to Common Area';
                toCommon.addEventListener('click', e => {
                    e.stopPropagation();
                    const dest = document.getElementById('fsp-common');
                    if (dest) animateCardMove(card, dest);
                    if (window.isTutorialMode && window.TutorialMode?.onScrollMoved) {
                        window.TutorialMode.onScrollMoved(scrollName, 'active', 'common');
                    }
                    const element = sp.getScrollElement?.(scrollName);
                    const displaced = element ? (sp.commonArea?.[element] || null) : null;
                    window.lastScrollAction = { type: 'scroll-move', scrollName, from: 'active', to: 'common', displacedScroll: displaced !== scrollName ? displaced : null };
                    window.clearPawnUndo?.();
                    window.SoundSystem?.play('scrollmove');
                    // Mutate state immediately — see the "Move to Active Area" handler above.
                    sp.discardScroll(scrollName);
                    setTimeout(() => { refresh(); }, 60);
                });
                acts.appendChild(toCommon);

                // Active → Cast (shown when pattern matches board)
                const patternMatches = typeof sp.checkPattern === 'function' && sp.checkPattern(scrollName);
                const castBtn = document.createElement('button');
                castBtn.className = 'fsp-card-btn fsp-card-btn-cast' + (patternMatches ? ' fsp-cast-ready' : ' fsp-cast-dim');
                castBtn.textContent = patternMatches ? 'Activate ✦' : 'Activate';
                castBtn.title = patternMatches ? 'Pattern matches - ready to activate!' : 'Place stones in the required pattern first';
                castBtn.addEventListener('click', e => {
                    e.stopPropagation();
                    // Activate THIS scroll specifically — not castSpell(), which scans every
                    // castable scroll (active + common) and would happily fire a different,
                    // actually-ready scroll elsewhere instead of erroring on this one.
                    if (typeof sp.castSpecificScroll === 'function') sp.castSpecificScroll(scrollName);
                    else sp.castSpell();
                });
                acts.appendChild(castBtn);
            }

            if (area === 'common') {
                // Common → Cast (shown when pattern matches board)
                const patternMatches = typeof sp.checkPattern === 'function' && sp.checkPattern(scrollName);
                const castBtn = document.createElement('button');
                castBtn.className = 'fsp-card-btn fsp-card-btn-cast' + (patternMatches ? ' fsp-cast-ready' : ' fsp-cast-dim');
                castBtn.textContent = patternMatches ? 'Activate ✦' : 'Activate';
                castBtn.title = patternMatches ? 'Pattern matches - ready to activate!' : 'Place stones in the required pattern first';
                castBtn.addEventListener('click', e => {
                    e.stopPropagation();
                    // Activate THIS scroll specifically — not castSpell(), which scans every
                    // castable scroll (active + common) and would happily fire a different,
                    // actually-ready scroll elsewhere instead of erroring on this one.
                    if (typeof sp.castSpecificScroll === 'function') sp.castSpecificScroll(scrollName);
                    else sp.castSpell();
                });
                acts.appendChild(castBtn);
            }

            if (acts.children.length) card.appendChild(acts);
        }

        // No click-to-popup — hovering the card already shows the enlarged
        // preview (see _initCardHoverPreview).

        return card;
    }

    // Builds a read-only .fsp-card for the hover preview over an Elemental
    // Stones panel .stone-card — same visual family as _buildCard()'s scroll
    // cards (shares .fsp-card/-header/-icon/-title/-name/-meta/-desc CSS),
    // just no pattern diagram or action buttons since a stone isn't something
    // you activate.
    function _buildStoneCard(element) {
        const info = STONE_INFO[element];
        if (!info) return null;
        const color   = EL_COLORS[element] || '#888';
        const iconSrc = window.STONE_TYPES?.[element]?.img || '';

        const card = document.createElement('div');
        card.className = 'fsp-card';
        card.style.setProperty('--el-color', color);

        const hdr = document.createElement('div');
        hdr.className = 'fsp-card-header';
        if (iconSrc) {
            const icon = document.createElement('img');
            icon.src = iconSrc;
            icon.className = 'fsp-card-icon';
            icon.alt = element;
            hdr.appendChild(icon);
        }

        const titleWrap = document.createElement('div');
        titleWrap.className = 'fsp-card-title';
        const nameEl = document.createElement('span');
        nameEl.className = 'fsp-card-name';
        nameEl.textContent = info.name;
        titleWrap.appendChild(nameEl);
        const metaEl = document.createElement('span');
        metaEl.className = 'fsp-card-meta';
        metaEl.textContent = `Rank ${info.rank} · ${info.cost} AP to break`;
        titleWrap.appendChild(metaEl);
        hdr.appendChild(titleWrap);
        card.appendChild(hdr);

        const desc = document.createElement('div');
        desc.className = 'fsp-card-desc';
        desc.textContent = info.ability;
        card.appendChild(desc);

        if (info.interaction) {
            const note = document.createElement('div');
            note.className = 'fsp-card-desc';
            note.style.cssText = `color:${color}; opacity:0.75; font-style:italic; margin-top:6px;`;
            note.textContent = info.interaction;
            card.appendChild(note);
        }

        return card;
    }

    // ---- Rulebook ----
    // Static reference content for the Rulebook panel. Stone entries are
    // generated from STONE_INFO (declared above) so ability text can never
    // drift out of sync with the Elemental Stones hover preview.
    const RULEBOOK_TABS = [
        { id: 'basics',   label: 'Basics & Movement', color: '#8ecdf0' },
        { id: 'stones',   label: 'Stones & Shrines',  color: '#c8a870' },
        { id: 'scrolls',  label: 'Scrolls',           color: '#e8dcc8' },
        { id: 'win',      label: 'Win Condition',     color: '#ffd700' },
        { id: 'advanced', label: 'Advanced Rules',    color: '#ff8c69' },
    ];

    function _rulebookEntries() {
        const stoneEntries = ['void', 'wind', 'fire', 'water', 'earth'].map(el => {
            const info = STONE_INFO[el];
            const interactionText = info.interaction ? ` ${info.interaction}.` : '';
            return { title: info.name, body: `${info.ability} Rank ${info.rank}.${interactionText}` };
        });
        return {
            basics: [
                { title: 'Board Setup', body: 'The tile deck holds one of each tile type (Earth, Water, Fire, Wind, Void, and Catacomb) for every player, minus one. All of these tiles are shuffled together to form the hidden board.' },
                { title: 'Turns & Action Points', body: 'Each turn gives you 5 AP. Moving into a hex costs 1 AP, except through a Wind stone (or a Water stone adjacent to a Wind stone), which cost 0 AP. Unused AP does not carry over to your next turn.' },
                { title: 'Exploring Tiles', body: 'All tiles start face-down. Stepping onto a face-down tile flips it, revealing its shrine type and drawing a scroll into your hand.' },
                { title: 'Undo Step', body: "Undo Step reverses your most recent action: a move, a stone placement or break, or a scroll move. It only works until you end your turn." },
                { title: 'Player Tiles', body: "You can't end your turn on the center hex of another player's tile. You can end your turn on your own. You can't place a stone anywhere on a player tile, including your own." },
                { title: 'Sharing a Hex', body: "You can never move onto a hex that another player currently occupies." },
            ],
            stones: [
                ...stoneEntries,
                { title: 'Placing Stones', body: "A stone you place must land adjacent to your pawn's current position, and never on a player tile." },
                { title: 'Breaking Stones', body: "Right-click a stone adjacent to your pawn to break it. This costs AP equal to the stone's rank (Void 1, Wind 2, Fire 3, Water 4, Earth 5). You can break any stone within reach, not just your own, but not while standing on a stone yourself. A broken stone returns to the shared source pool, not to any player's pool." },
                { title: 'Shrine Types', body: "There are six shrine tile types: Earth, Water, Fire, Wind, Void, and Catacomb. Ending your turn on a shrine's center hex grants stones of that type from the shared source pool. The amount depends on the element's rank." },
                { title: 'Catacomb Shrines', body: "Revealing a Catacomb tile instantly refunds 1 AP and draws a Catacomb scroll. Standing on a Catacomb shrine lets you teleport for free to the center of any other revealed, empty elemental shrine. A stone placed there blocks the teleport." },
            ],
            scrolls: [
                { title: 'Hand, Active & Common', body: 'Scrolls live in three areas: Hand (private, max 2), Active (face-up, anyone can activate), and Common Area (a shared pool anyone can activate from).' },
                { title: 'Building a Pattern', body: "A scroll's stone pattern is always checked relative to your pawn's current hex. It doesn't matter what tile type you're standing on, and you don't need to be in a tile's center." },
                { title: 'Level 1 Response Scrolls', body: "Level 1 scrolls are Response scrolls: they activate on an opponent's turn, not yours. Only one response scroll resolves per turn. Competing responses are resolved by element rank." },
                { title: 'Stacking Activations', body: 'Most scrolls have no once-per-turn limit. Activate the same scroll multiple times in one turn to stack its effect. A few, mostly Level 1 response/counter scrolls, are limited to once per turn.' },
                { title: 'Catacomb Scrolls', body: 'Catacomb scrolls span two element types and reward or activate both at once.' },
            ],
            win: [
                { title: 'How to Win', body: 'Activate at least one scroll of each of the five elements (Earth, Water, Fire, Wind, and Void) over the course of the game, then return to the center of your own player shrine.' },
                { title: 'Empty Source Pools', body: "Activating a scroll, including a Catacomb scroll, doesn't count toward your win condition for an element whose shared source pool is empty. Destroy a placed stone of that type to free one up in the source pool." },
            ],
            advanced: [
                { title: 'Empty Source Pools', body: "Activating a scroll doesn't count toward your win condition if that element's source pool is empty. Destroy a placed stone of that type to free one up and get around this." },
                { title: 'Element Rank Resolves Conflicts', body: "When scroll effects conflict (for example, two players' response scrolls both try to fire on the same turn), they resolve by element rank." },
                { title: "Scrolls Don't Need a Tile Center", body: "You don't need to be standing in the center of a tile to activate a scroll. This is a common mistake." },
                { title: 'Stacking', body: 'Some scrolls can be activated more than once in the same turn. Stack repeated activations to maximize your control of the board.' },
                { title: 'Player Tile Restrictions', body: "You can't end your turn on another player's tile, and you can't place stones on any player tile. You can end your turn on your own tile." },
                { title: 'Catacomb Teleport Blocking', body: "Placing a stone on an elemental shrine's center blocks other players from teleporting there." },
                { title: 'No Shared Hexes', body: "You can't stand on the same hex as another player." },
            ],
        };
    }

    function _buildRulebookBody(bodyEl) {
        if (!bodyEl) return;
        const entriesByTab = _rulebookEntries();
        bodyEl.innerHTML = '';
        bodyEl.classList.add('rulebook-body');

        const searchWrap = document.createElement('div');
        searchWrap.className = 'rulebook-search-wrap';
        const searchInput = document.createElement('input');
        searchInput.type = 'text';
        searchInput.className = 'rulebook-search';
        searchInput.placeholder = 'Search the rulebook…';
        searchWrap.appendChild(searchInput);
        bodyEl.appendChild(searchWrap);

        const tabBar = document.createElement('div');
        tabBar.className = 'rulebook-tabs';
        RULEBOOK_TABS.forEach(tab => {
            const btn = document.createElement('button');
            btn.className = 'rulebook-tab-btn';
            btn.textContent = tab.label;
            btn.dataset.tab = tab.id;
            btn.style.setProperty('--tab-color', tab.color);
            btn.addEventListener('click', () => {
                searchInput.value = '';
                setActiveTab(tab.id);
            });
            tabBar.appendChild(btn);
        });
        bodyEl.appendChild(tabBar);

        const list = document.createElement('div');
        list.className = 'rulebook-list';
        bodyEl.appendChild(list);

        function renderEntries(entries, color) {
            list.innerHTML = '';
            if (entries.length === 0) {
                const empty = document.createElement('div');
                empty.className = 'rulebook-empty';
                empty.textContent = 'No matching rules found.';
                list.appendChild(empty);
                return;
            }
            entries.forEach(entry => {
                const card = document.createElement('div');
                card.className = 'rulebook-entry';
                card.style.setProperty('--el-color', entry.color || color);
                const title = document.createElement('div');
                title.className = 'rulebook-entry-title';
                title.textContent = entry.title;
                const body = document.createElement('div');
                body.className = 'rulebook-entry-body';
                body.textContent = entry.body;
                card.appendChild(title);
                card.appendChild(body);
                list.appendChild(card);
            });
        }

        // Tracked separately from the DOM's .active class, which the search
        // handler below clears on every keystroke while searching — without
        // this, clearing the search box would always fall back to the first
        // tab instead of the one the player was actually on before they typed.
        let lastTab = RULEBOOK_TABS[0].id;

        function setActiveTab(tabId) {
            lastTab = tabId;
            tabBar.querySelectorAll('.rulebook-tab-btn').forEach(btn => {
                btn.classList.toggle('active', btn.dataset.tab === tabId);
            });
            const tab = RULEBOOK_TABS.find(t => t.id === tabId) || RULEBOOK_TABS[0];
            renderEntries(entriesByTab[tab.id] || [], tab.color);
        }

        searchInput.addEventListener('input', () => {
            const q = searchInput.value.trim().toLowerCase();
            if (!q) {
                setActiveTab(lastTab);
                return;
            }
            tabBar.querySelectorAll('.rulebook-tab-btn').forEach(btn => btn.classList.remove('active'));
            const matches = [];
            RULEBOOK_TABS.forEach(tab => {
                (entriesByTab[tab.id] || []).forEach(entry => {
                    if (entry.title.toLowerCase().includes(q) || entry.body.toLowerCase().includes(q)) {
                        matches.push({ ...entry, color: tab.color });
                    }
                });
            });
            renderEntries(matches);
        });

        setActiveTab(RULEBOOK_TABS[0].id);
    }

    // ---- Autofit ----
    // Width  = body_padding + n_cards × card_width + (n_cards−1) × gap
    // Height = header_height + card_height + body_padding
    // AUTOFIT_CARD_H must stay in sync with CSS `.fsp-card { height: 280px }`
    const AUTOFIT_CARD_W = 230;
    const AUTOFIT_CARD_H = 400;  // must match CSS .fsp-card { height: 400px }
    const AUTOFIT_GAP    = 8;
    const AUTOFIT_PAD    = 16;   // 8px left + 8px right body padding

    // hand/active/common lay out a horizontal row of FIXED-size scroll cards,
    // so "fit to content" means solving width from card count. Everything
    // else registered on this system (gamelog/opponents) is a vertical list
    // of variable, unpredictably-sized content (log lines, opponent cards) —
    // wrong panel for that same formula, so they get a generic content-fit
    // instead (_fitPanelToContent below).
    const SCROLL_CARD_PANELS = new Set(['hand', 'active', 'common']);

    function fitPanel(id) {
        const p      = panels[id];
        if (!p || !p.el || p.state.collapsed || p.state.autofit === false) return;
        const body   = document.getElementById(p.bodyId || ('fsp-body-' + id));
        const header = p.el.querySelector('.fsp-header');
        if (!body || !header) return;

        if (!SCROLL_CARD_PANELS.has(id)) { _fitPanelToContent(p, body, header); return; }

        // Count rendered cards (empty → 1 child fsp-empty div → minimum 1-card width)
        const n = Math.max(1, body.children.length);
        const w = AUTOFIT_PAD + n * AUTOFIT_CARD_W + (n - 1) * AUTOFIT_GAP;
        const h = header.offsetHeight + AUTOFIT_CARD_H + AUTOFIT_PAD;

        p.el.style.width  = w + 'px';
        p.el.style.height = h + 'px';
        p.state.w = w;
        p.state.h = h;
    }

    // Generic content-fit: snap HEIGHT to the body's actual rendered content
    // (header + content + a little padding), leaving width as whatever the
    // panel is currently sized to (these bodies wrap/scroll vertically, not
    // horizontally, so width isn't a function of item count the way scroll
    // cards' row is). Capped between MIN_H and 50% of the viewport — gamelog
    // especially grows unbounded over a long game, and without a ceiling
    // autofit would keep stretching the panel instead of letting
    // .fsp-body's own overflow-y:auto (see CSS) take over past a reasonable
    // size.
    function _fitPanelToContent(p, body, header) {
        const MIN_H = 120;
        const maxH  = Math.round(window.innerHeight * 0.5);
        // .fsp-body is `flex: 1`, so it always stretches to fill whatever
        // height the panel currently has — scrollHeight on a flex-stretched
        // element is never less than its own (stretched) clientHeight, so
        // reading it directly just echoes the panel's *current* size back
        // instead of the content's natural size, and the panel could only
        // ever grow, never shrink. Briefly drop the stretch so the body
        // hugs its real content height, measure that, then restore it.
        const prevFlex = body.style.flex, prevHeight = body.style.height;
        body.style.flex = 'none';
        body.style.height = 'auto';
        const contentH = body.scrollHeight;
        body.style.flex = prevFlex;
        body.style.height = prevHeight;
        let h = Math.min(maxH, Math.max(MIN_H, header.offsetHeight + contentH + 16));
        p.el.style.height = h + 'px';
        p.state.h = h;

        // contentH above was measured with no scrollbar present (the body
        // was auto-height, so nothing overflowed). If applying that height
        // back causes a scrollbar to appear (overflow-y: auto), it steals
        // width from the body, which can wrap long text (e.g. a long
        // opponent name) onto an extra line — needing MORE height than
        // just measured a moment ago, clipping content and leaving it
        // stuck at the resulting one-line-short size forever. Re-measure
        // once against that now-scrollbar'd layout and grow to match.
        if (body.scrollHeight > body.clientHeight + 1 && h < maxH) {
            h = Math.min(maxH, Math.max(h, header.offsetHeight + body.scrollHeight + 16));
            p.el.style.height = h + 'px';
            p.state.h = h;
        }
    }

    function setAutofit(id, on) {
        const p = panels[id];
        if (!p) return;
        p.state.autofit = on;
        const btn    = p.el.querySelector('.fsp-autofit-btn');
        const handle = p.el.querySelector('.fsp-resize-handle');
        if (btn)    btn.classList.toggle('fsp-autofit-active', on);
        if (handle) handle.style.display = (on || p.state.collapsed) ? 'none' : '';
        if (on) fitPanel(id);
        saveState();
    }

    // ---- Render ----
    // Scroll-card panels only (hand/active/common) — gamelog/opponents/
    // elementalstones manage their own content entirely (game-log-ui.js,
    // game-ui.js) and must never have this touch their body: it does an
    // unconditional body.innerHTML = '' below, and refresh() calls this for
    // every OPEN panel, so without this guard opening the Game Log or
    // Opponent Status panel would get its content silently wiped the next
    // time anything calls refresh() (e.g. after any hand/active/common change).
    function renderPanel(id) {
        if (id !== 'hand' && id !== 'active' && id !== 'common') return;
        const sp   = window.spellSystem;
        const body = document.getElementById(panels[id]?.bodyId || ('fsp-body-' + id));
        if (!body || !sp) return;

        body.innerHTML = '';
        const frag  = document.createDocumentFragment();
        let   empty = false;
        let   scrolls = [];

        if (id === 'hand') {
            scrolls = [...(sp.handScrolls || [])];
            _updateBadge('hand', scrolls.length, CAPACITY.hand);
            if (!scrolls.length) { empty = true; body.innerHTML = '<div class="fsp-empty">Hand is empty</div>'; }
            else scrolls.forEach(n => { const c = _buildCard(n, 'hand');   if (c) frag.appendChild(c); });

        } else if (id === 'active') {
            scrolls = [...(sp.activeScrolls || [])];
            _updateBadge('active', scrolls.length, CAPACITY.active);
            if (!scrolls.length) { empty = true; body.innerHTML = '<div class="fsp-empty">No active scrolls</div>'; }
            else scrolls.forEach(n => { const c = _buildCard(n, 'active'); if (c) frag.appendChild(c); });

        } else if (id === 'common') {
            scrolls = typeof sp.getCommonAreaScrolls === 'function' ? sp.getCommonAreaScrolls() : [];
            _updateBadge('common', scrolls.length, CAPACITY.common);
            if (!scrolls.length) { empty = true; body.innerHTML = '<div class="fsp-empty">Common area is empty</div>'; }
            else scrolls.forEach(n => { const c = _buildCard(n, 'common'); if (c) frag.appendChild(c); });
        }

        if (!empty) body.appendChild(frag);

        // Keep the collapsed compact list in sync too, whether or not it's
        // currently visible — cheap, and means toggling collapse never shows
        // stale content from before the last change.
        _renderCompactList(id, scrolls);

        // Autofit: snap height to content after rendering
        if (panels[id]?.state?.autofit !== false) fitPanel(id);
    }

    function refresh() {
        Object.keys(panels).forEach(id => { if (panels[id].open) renderPanel(id); });
        _updateDockBtn();
    }

    function _updateDockBtn() {
        const sp = window.spellSystem;
        if (!sp) return;
        const handN   = sp.handScrolls?.size   || 0;
        const activeN = sp.activeScrolls?.size  || 0;
        const hSpan = document.getElementById('hand-count');
        const aSpan = document.getElementById('active-count');
        if (hSpan) hSpan.textContent = handN;
        if (aSpan) aSpan.textContent = activeN;

        // Light up panel buttons when their panel is open
        ['hand', 'active', 'common'].forEach(id => {
            const btn = document.getElementById('panel-btn-' + id);
            if (btn) btn.classList.toggle('fsp-dock-btn-open', !!(panels[id]?.open));
        });
    }

    // ---- Animation: card flies from source element to destination panel ----
    function animateCardMove(srcEl, destPanelEl) {
        if (!srcEl || !destPanelEl) return;

        const fromRect = srcEl.getBoundingClientRect();
        const destBody = destPanelEl.querySelector('.fsp-body');
        const toRect   = (destBody || destPanelEl).getBoundingClientRect();

        // Build ghost
        const ghost = srcEl.cloneNode(true);
        Object.assign(ghost.style, {
            position:      'fixed',
            left:          fromRect.left + 'px',
            top:           fromRect.top  + 'px',
            width:         fromRect.width + 'px',
            height:        fromRect.height + 'px',
            zIndex:        '9000',
            pointerEvents: 'none',
            margin:        '0',
            transition:    'none',
            opacity:       '1',
            boxShadow:     '0 4px 20px rgba(0,0,0,0.6)',
            borderRadius:  '4px'
        });
        document.body.appendChild(ghost);

        // Double-RAF ensures the initial position paints before the transition starts
        requestAnimationFrame(() => requestAnimationFrame(() => {
            ghost.style.transition = [
                'left 0.3s cubic-bezier(0.25,0.46,0.45,0.94)',
                'top  0.3s cubic-bezier(0.25,0.46,0.45,0.94)',
                'opacity 0.25s ease',
                'transform 0.3s ease'
            ].join(', ');
            ghost.style.left      = (toRect.left + 8)  + 'px';
            ghost.style.top       = (toRect.top  + 8)  + 'px';
            ghost.style.opacity   = '0';
            ghost.style.transform = 'scale(0.72)';
            setTimeout(() => ghost.remove(), 340);
        }));
    }

    // Animation: card falls to deck (called when a common-area scroll is displaced)
    function animateCardToDeck(srcEl) {
        if (!srcEl) return;
        const rect = srcEl.getBoundingClientRect();
        const ghost = srcEl.cloneNode(true);
        Object.assign(ghost.style, {
            position: 'fixed', left: rect.left + 'px', top: rect.top + 'px',
            width: rect.width + 'px', height: rect.height + 'px',
            zIndex: '9000', pointerEvents: 'none', margin: '0',
            transition: 'none', opacity: '1'
        });
        document.body.appendChild(ghost);
        requestAnimationFrame(() => requestAnimationFrame(() => {
            ghost.style.transition = 'top 0.38s ease-in, opacity 0.3s ease, transform 0.38s ease';
            ghost.style.top       = (window.innerHeight + 60) + 'px';
            ghost.style.opacity   = '0';
            ghost.style.transform = 'scale(0.55) rotate(8deg)';
            setTimeout(() => ghost.remove(), 420);
        }));
    }

    // ---- Init ----
    function init() {
        if (initialized) return;
        initialized = true;

        // Same reasoning as Game Log/Opponent Status: autofit was already on
        // by default with no benefit to ever turning it off, so lock it on
        // and drop the now-pointless toggle button + the resize handle
        // (already permanently hidden whenever autofit is on, so with no way
        // to ever disable it the handle would just be unreachable dead UI).
        createPanel('hand',   'Hand',   { lockAutofit: true, noResize: true });
        createPanel('active', 'Active', { lockAutofit: true, noResize: true });
        createPanel('common', 'Common', { lockAutofit: true, noResize: true });

        // Wire the three dock panel buttons
        ['hand', 'active', 'common'].forEach(id => {
            const btn = document.getElementById('panel-btn-' + id);
            if (btn) btn.addEventListener('click', e => {
                e.preventDefault();
                if (panels[id].open) { closePanel(id); } else { openPanel(id); }
                _updateDockBtn();
            });
        });

        // Override spellSystem.showInventory so Transmute and other callers use panels.
        // Scoped to the three scroll-card panels explicitly (NOT
        // Object.keys(panels)) — gamelog/opponents/elementalstones aren't
        // "inventory" and must not get force-opened just because Transmute
        // wants to show the player their scrolls.
        const hookSpell = () => {
            if (!window.spellSystem) return false;
            window.spellSystem.showInventory = () => {
                ['hand', 'active', 'common'].forEach(id => { if (!panels[id].open) openPanel(id); });
                refresh();
            };
            return true;
        };

        if (!hookSpell()) {
            const t = setInterval(() => { if (hookSpell()) clearInterval(t); }, 400);
        }

        // ── Non-scroll floating panels: Game Log, Opponent Status, Elemental
        // Stones — same drag/resize/collapse/close chrome as Hand/Active/
        // Common, but each keeps content other code already depends on by id
        // (game-log-ui.js's game-log-content, game-ui.js's new-opponent-cards
        // and elemental-stones-panel/.stone-card drag-return logic) — see
        // createPanel()'s opts.
        //
        // createPanel() itself just builds the DOM (appended to document.body,
        // starts closed) — it must NOT be opened here. init() runs at page
        // DOMContentLoaded, long before a game exists: the login screen, the
        // splash video, and the multiplayer lobby all happen first, and these
        // three are position:fixed elements with no relation to .game-layout's
        // own display:none-until-.active gating, so opening them here would
        // float them over all of that too (a real bug this project hit).
        // openAmbientPanels(), exposed below, is what actually opens them —
        // called from game-ui.js's initializeNewUI(), which only ever runs
        // once a game has actually started (see lobby.js's startGame()/
        // startMultiplayerGame()). Hand/Active/Common need no such call: they
        // default closed and only ever open from their own dock button click,
        // which isn't reachable before a game exists either (same
        // .game-layout gating covers the dock bar those buttons live in).
        // Game Log/Opponent Status get autofit ON by default (_fitPanelToContent
        // — the generic, non-scroll-card fit added alongside them), same ↕
        // button hand/active/common show. Elemental Stones keeps noAutofit —
        // it's a fixed 5-card horizontal row, nothing to fit as content changes.
        // Game Log's body is a small wrapper (#game-log-body-wrap, becomes
        // the panel's actual .fsp-body) around TWO children: a persistent,
        // non-scrolling "Active Buffs" strip (#game-log-buffs, populated by
        // game-log-ui.js's renderActiveBuffs() — hidden via display:none
        // until at least one buff is active) and the existing scrolling
        // entry list (#game-log-content, unchanged — game-log-ui.js's
        // CONTENT_ID still points at it directly). See css/styles.css's
        // "OPPONENT STATUS + GAME LOG panel bodies" section for the layout.
        const gamelogWrap = document.createElement('div');
        gamelogWrap.id = 'game-log-body-wrap';
        const gamelogBuffs = document.createElement('div');
        gamelogBuffs.id = 'game-log-buffs';
        gamelogBuffs.style.display = 'none';
        const gamelogEntries = document.createElement('div');
        gamelogEntries.id = 'game-log-content';
        gamelogWrap.appendChild(gamelogBuffs);
        gamelogWrap.appendChild(gamelogEntries);

        createPanel('gamelog', 'Game Log', {
            bodyEl: gamelogWrap,
            noBadge: true,
            // Unlike Opponent Status, autofit permanently on doesn't actually
            // serve Game Log well: new lines keep arriving all game, so a
            // locked-on fit would fight any manual size the player picks,
            // re-growing right back on the next entry — there's no stable
            // "fits the content" size to lock onto. Manual resize only (same
            // as Elemental Stones) — noAutofit skips the fit machinery and
            // its button entirely; game-log-ui.js's own fitPanel() calls
            // become harmless no-ops once autofit is off.
            noAutofit: true,
        });
        createPanel('opponents', 'Opponent Status', {
            panelId: 'right-panel',
            bodyEl: document.getElementById('new-opponent-cards'),
            noBadge: true,
            // Autofit stays on permanently (opponent cards' natural height
            // changes player to player, so auto-sizing is genuinely useful
            // here) but there's no benefit to a visible toggle for it — same
            // reasoning as Hand/Active/Common. lockAutofit keeps the
            // functionality without the button; noResize follows because the
            // handle would be unreachable dead UI once autofit can never be
            // switched off.
            lockAutofit: true,
            noResize: true,
        });
        createPanel('elementalstones', 'Elemental Stones', {
            panelId: 'elemental-stones-panel',
            bodyEl: document.getElementById('elemental-stones-body'),
            dockBtnId: 'elemental-stones-btn', // doesn't follow the panel-btn-{id} convention
            noBadge: true,
            noAutofit: true,
            noCollapse: true, // collapsing here would just show an empty box — nothing populates fsp-compact-elementalstones
            autoHeight: true, // one fixed-size row of stone cards — no fixed pixel guess to keep in sync, just hug it
            noResize: true,   // nothing to gain from resizing fixed content — see createPanel()'s opts doc
        });
        createPanel('rulebook', 'Rulebook', {
            noBadge: true,
            noAutofit: true, // fixed reference content, not a growing feed — manual resize only, same as Game Log
            noCollapse: true, // collapsing would show an empty box — nothing populates fsp-compact-rulebook, same as Elemental Stones
        });
        _buildRulebookBody(document.getElementById('fsp-body-rulebook'));

        ['gamelog', 'opponents', 'elementalstones', 'rulebook'].forEach(id => {
            const btn = document.getElementById(panels[id].dockBtnId);
            if (!btn) return;
            btn.addEventListener('click', e => {
                e.preventDefault();
                if (panels[id].open) { closePanel(id); } else { openPanel(id); }
            });
        });

        // ── Hover preview: enlarged card that floats outside the panel ──────
        _initCardHoverPreview();

        // Expose globally
        window.ScrollPanelSystem = {
            toggle, refresh, openPanel, closePanel, animateCardMove, animateCardToDeck,
            isOpen: id => !!panels[id]?.open,
            openAmbientPanels,
            // Re-fits a panel to its current content when autofit is on for it
            // (a no-op otherwise) — call after appending to gamelog's body or
            // re-rendering opponents' cards, same as hand/active/common get
            // via renderPanel()'s own internal fitPanel() call.
            fitPanel,
        };
    }

    // Opens every panel that defaults open (DEFAULT_OPEN_IDS — currently
    // all six, per the user's captured layout) — called from game-ui.js's
    // initializeNewUI() once a game has actually started (see the long
    // comment above the createPanel() calls for why this can't just happen
    // in init() itself). Safe to call more than once (e.g. a rematch/new
    // game) — openPanel() on an already-open panel is a no-op beyond
    // re-clamping its position. Hand/Active/Common default open now too,
    // but collapsed (see DEFAULTS) — a compact glance, not the full card
    // grid, until the player expands one.
    function openAmbientPanels() {
        DEFAULT_OPEN_IDS.forEach(id => {
            if (panels[id]) openPanel(id);
        });
    }

    // ---- Hover preview panel ----
    // Shared by three surfaces: full .fsp-card grids, the collapsed
    // .fsp-compact-row list, and the Players panel's .opponent-scroll-card
    // icons — all three used to open a click-triggered popup; now hovering
    // any of them shows this same enlarged preview instead. Built fresh from
    // scrollName via _buildCard() each time (minus action buttons, since
    // 'preview' isn't a real area) rather than cloning the hovered element,
    // so it works the same regardless of which of the three triggered it.
    function _initCardHoverPreview() {
        const preview = document.createElement('div');
        preview.className = 'fsp-card-preview';
        preview.style.display = 'none';
        document.body.appendChild(preview);

        let hideTimer = null;
        let showTimer = null;
        let throbberEl = null;
        // 'scroll:<name>' or 'stone:<element>' — which card we're hovering,
        // so child mouseover events don't restart the timer.
        let currentKey = null;
        // The AREA a repeat hover resolves to is kept fresh even though the
        // currentKey guard in _showCardPreview skips restarting the timer/
        // spinner for it — otherwise, whichever mouseover happened to be the
        // FIRST one to start tracking a given scroll permanently pins its
        // area (even undefined/wrong) for every later hover of the same
        // scroll, since the guard never lets a later, correct area overwrite
        // it. The showTimer callback reads this variable at fire time, not a
        // closed-over parameter, so it always uses whatever's most current.
        let currentArea;

        function clearThrobber() {
            if (throbberEl) { throbberEl.remove(); throbberEl = null; }
        }

        // Shared by scroll cards and stone cards: shows a spinner near
        // anchorEl, then after 500ms builds the preview via buildFn() and
        // positions it next to the hovered element's panel.
        function _showCardPreview(key, anchorEl, elColor, buildFn) {
            if (key === currentKey) return; // already tracking this card — don't restart the timer/spinner
            currentKey = key;
            clearTimeout(hideTimer);
            clearTimeout(showTimer);
            clearThrobber();

            // Show a small spinner near the hovered element for 500ms before the preview appears
            const anchorRect = anchorEl.getBoundingClientRect();
            const dot = document.createElement('div');
            dot.style.cssText = `
                position: fixed;
                left: ${anchorRect.right - 18}px;
                top: ${anchorRect.top + 6}px;
                width: 12px; height: 12px;
                border: 2px solid ${elColor}55;
                border-top-color: ${elColor};
                border-radius: 50%;
                animation: scroll-popup-spin 0.5s linear infinite;
                pointer-events: none;
                z-index: 9999;
            `;
            document.body.appendChild(dot);
            throbberEl = dot;

            showTimer = setTimeout(() => {
                clearThrobber();

                const card = buildFn();
                if (!card) return;
                card.style.height = 'auto'; // preview is not height-constrained

                preview.innerHTML = '';
                preview.appendChild(card);
                preview.style.display = 'block';
                preview.style.setProperty('--el-color', elColor);

                // Position: prefer to the right of the containing panel; fall back to left
                const anchorRect2 = anchorEl.getBoundingClientRect();
                const panelEl   = anchorEl.closest('.fsp') || anchorEl.closest('#right-panel');
                const panelRect = panelEl ? panelEl.getBoundingClientRect() : anchorRect2;

                const previewW = 480;
                const gap      = 14;
                let left = panelRect.right + gap;
                if (left + previewW > window.innerWidth - 8) {
                    left = panelRect.left - previewW - gap;
                }
                let top = anchorRect2.top;
                // Keep preview within viewport vertically
                const maxTop = window.innerHeight - preview.offsetHeight - 8;
                if (top > maxTop) top = Math.max(8, maxTop);

                preview.style.left = left + 'px';
                preview.style.top  = top  + 'px';
            }, 500); // 500ms hover delay
        }

        // anchorEl: the hovered element (for positioning + the spinner). area:
        // the real hand/active/common area it belongs to, when known (see
        // findHoverable) — passed through to _buildCard so the preview shows
        // the SAME "Move to Active/Common Area"/"Activate" buttons the real
        // card has, not just an inert copy. Left undefined for surfaces where
        // it isn't meaningful (opponent cards aren't the viewer's to move).
        function showPreview(scrollName, anchorEl, area) {
            currentArea = area; // kept fresh regardless of the currentKey guard in _showCardPreview
            if (window.isTutorialMode && window.TutorialMode?.onScrollHovered) {
                window.TutorialMode.onScrollHovered(scrollName);
            }
            const sp = window.spellSystem;
            const element = (sp && typeof sp.getScrollElement === 'function')
                ? sp.getScrollElement(scrollName) : 'earth';
            const elColor = window.ScrollLook ? window.ScrollLook.colors(scrollName)[0] : (EL_COLORS[element] || '#888');
            // Real area → _buildCard adds the same Move to Active/Common Area
            // / Activate buttons the actual card has. Falls back to 'preview'
            // (no action buttons) when the area isn't known/meaningful
            // (opponent cards). Reads currentArea (kept fresh above) rather
            // than this closure's own `area` param, which could be stale/
            // wrong if THIS call was the one that skipped past the
            // currentKey guard in _showCardPreview.
            _showCardPreview(`scroll:${scrollName}`, anchorEl, elColor, () => _buildCard(scrollName, currentArea || 'preview'));
        }

        // Elemental Stones panel hover — replaces the old click-to-open
        // "Elemental Reference" popup. Same preview mechanism as scroll
        // cards, built from STONE_INFO via _buildStoneCard() instead of a
        // scroll definition.
        function showStonePreview(element, anchorEl) {
            const elColor = EL_COLORS[element] || '#888';
            _showCardPreview(`stone:${element}`, anchorEl, elColor, () => _buildStoneCard(element));
        }

        function hidePreview() {
            currentKey = null;
            clearTimeout(showTimer);
            clearThrobber();
            hideTimer = setTimeout(() => { preview.style.display = 'none'; }, 80);
        }

        // Find the nearest hoverable ancestor of any of the four kinds, if any.
        function findHoverable(target) {
            const fspCard = target.closest('.fsp-card');
            if (fspCard && fspCard.closest('.fsp') && fspCard.dataset.scrollName) {
                return { kind: 'scroll', el: fspCard, scrollName: fspCard.dataset.scrollName, area: fspCard.dataset.area };
            }
            const compactRow = target.closest('.fsp-compact-row');
            if (compactRow && compactRow.closest('.fsp') && compactRow.dataset.scrollName) {
                // The compact list doesn't tag its own rows with an area (unlike
                // .fsp-card) — but it only ever renders inside hand/active/common,
                // and createPanel() already tags the panel itself (dataset.panel),
                // so read it from there instead of threading a new attribute through.
                const area = compactRow.closest('.fsp')?.dataset.panel;
                return { kind: 'scroll', el: compactRow, scrollName: compactRow.dataset.scrollName, area };
            }
            const oppCard = target.closest('.opponent-scroll-card[data-scroll-name]');
            if (oppCard) return { kind: 'scroll', el: oppCard, scrollName: oppCard.dataset.scrollName }; // no area — it's an opponent's scroll, not the viewer's to move
            // Scroll Reference popup's list rows (game-ui.js's showScrollReferencePopup) —
            // browsing the full scroll index, not the viewer's own hand/active/common,
            // so no area/action buttons here either.
            const refRow = target.closest('.scroll-ref-row[data-scroll-name]');
            if (refRow) return { kind: 'scroll', el: refRow, scrollName: refRow.dataset.scrollName };
            const stoneCard = target.closest('.stone-card[data-element]');
            if (stoneCard) return { kind: 'stone', el: stoneCard, element: stoneCard.dataset.element };
            return null;
        }

        // Delegation — works for dynamically rendered cards/rows
        document.addEventListener('mouseover', e => {
            const hit = findHoverable(e.target);
            if (!hit) return;
            if (hit.kind === 'stone') showStonePreview(hit.element, hit.el);
            else showPreview(hit.scrollName, hit.el, hit.area);
        });
        // Clicking one of the preview's own action buttons (Move to Active/
        // Common Area, Activate — see showPreview's area param) changes the
        // real hand/active/common state via the same handlers the actual
        // card uses, but the floating preview itself has no other reason to
        // know it should close now that the card it was describing just
        // moved out from under it. Capture phase so this fires before the
        // button's own click handler's setTimeout-deferred refresh() runs.
        preview.addEventListener('click', e => {
            if (e.target.closest('.fsp-card-btn')) hidePreview();
        }, true);
        document.addEventListener('mouseout', e => {
            const hit = findHoverable(e.target);
            if (hit) {
                // Only hide when the mouse truly leaves the element, not when moving between child elements
                const related = e.relatedTarget;
                if (!related || !hit.el.contains(related)) {
                    hidePreview();
                }
            }
        });
        // Keep preview alive while the mouse is over it
        preview.addEventListener('mouseover', () => clearTimeout(hideTimer));
        preview.addEventListener('mouseout',  hidePreview);
    }

    // Boot after DOM ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        // DOMContentLoaded already fired; wait a tick for game-ui.js to set onclick
        setTimeout(init, 0);
    }

    return { init, toggle, refresh, openPanel, closePanel, animateCardMove, animateCardToDeck, resetToDefaults };
})();
