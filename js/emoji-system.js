// ============================================================
// EMOJI SYSTEM — Godaigo Elements
// Players purchase emojis with gold and display them over their
// pawn during gameplay.  Emojis broadcast to all clients so
// everyone sees the reaction.
// ============================================================

(function () {
    'use strict';

    // ----------------------------------------------------------------
    // EMOJI DEFINITIONS
    // ----------------------------------------------------------------

    // Classic unicode / text emojis were retired 2026-09-27: the Pipoya pixel
    // emotes replace them.
    const RETIRED_EMOJIS = new Set(['P10', 'P11', 'P84', 'P94', 'P95']);

    const EMOJI_TIERS = [
        { id: 'px', name: 'Pixel Emotes (art by Pipoya)', cost: 50, color: '#26C6DA', badge: 'PX' },
    ];

    const EMOJI_ITEMS = [
        // ── Pixel Pops - 50g each (Pipoya Popup Emotes Pack) ─────
        // sprite = cell in images/emotes/pipoya-emotes.png (10 per row,
        // each cell a 3-frame 32x32 animation); see spriteHtml().
        ...[
            'Exclamation',
            'Question',
            'Surprise',
            'Excited',
            'Music Note',
            'Sparkle Burst',
            'Star',
            'Shooting Star',
            'Heart',
            'Broken Heart',
            'Blush',
            'Kiss',
            'Flower',
            'Red Swirl',
            'Confetti',
            'Bullseye',
            'Idea',
            'Ellipsis',
            'Tangled',
            'Dizzy Swirl',
            'Sleepy',
            'Angry Vein',
            'Worried Drops',
            'Gloom',
            'Shock Lines',
            'Sweat Drop',
            'Nervous Sweat',
            'Skull',
            'Rage Spikes',
            'Rubble',
            'Teary Eyes',
            'Blink',
            'Squint',
            'Laughing',
            'Smirk',
            'Scream',
            'Evil Grin',
            'Twinkle',
            'Flame',
            'Ice Crystal',
            'Crack',
            'Splat',
            'Flash',
            'Clash',
            'Sunburst',
            'Hexagram',
            'Shine',
            'Chomp',
            'Gibberish',
            'Singing',
            'Counting',
            'Calculating',
            'Sunny',
            'Cloudy',
            'Thunderstorm',
            'Rain',
            'Snowman',
            'Rainbow',
            'Night',
            'Bread',
            'Meat',
            'Fish',
            'Mushroom',
            'Apple',
            'Cake',
            'Tea',
            'Mug',
            'Letter',
            'Book',
            'Bomb',
            'Hammer',
            'Red Button',
            'Clock',
            'Gold Coin',
            'Diamond',
            'Treasure Chest',
            'Gift',
            'Trophy',
            'Medal',
            'Crown',
            'Chick',
            'Angel',
            'Bat',
            'Happy Ghost',
            'Poop',
            'Fist',
            'Peace Sign',
            'Open Hand',
            'Going Up',
            'Going Down',
            'Spade',
            'Heart Suit',
            'Club',
            'Diamond Suit',
            'Male Sign',
            'Female Sign',
            'Circle',
            'Cross',
            'Triangle',
            'Square'
        ].map((name, i) => ({ id: 'P' + String(i).padStart(2, '0'), tier: 'px', cost: 50, sprite: i, name }))
            // Retired by the owner (2026-09-27): Blush, Kiss, Poop, Male Sign,
            // Female Sign. Ids stay tied to the sheet cell, so they are only
            // filtered out (sql/emoji-server.sql stops selling them too).
            .filter(e => !RETIRED_EMOJIS.has(e.id)),
    ];

    // ----------------------------------------------------------------
    // STATE
    // ----------------------------------------------------------------

    let emojiInventoryIds = new Set();
    let isPanelOpen       = false;
    let currentView       = 'inventory'; // 'inventory' | 'shop'
    let emojiCooldown     = false;
    let emojiCooldownTimer = null;

    // ----------------------------------------------------------------
    // STORAGE - on the server (2026-09-27, sql/emoji-server.sql)
    // Owned emojis are ids 'emoji_<id>' in user_profiles.cosmetics_owned,
    // bought with buy_cosmetic() like name colours, so they follow the
    // account to any browser or device. window.gami.profile holds the copy
    // loaded at sign-in.
    // ----------------------------------------------------------------

    const OWN_PREFIX = 'emoji_';

    function loadInventory() {
        const owned = window.gami?.profile?.cosmetics_owned;
        emojiInventoryIds = new Set(Array.isArray(owned)
            ? owned.filter(id => typeof id === 'string' && id.startsWith(OWN_PREFIX)).map(id => id.slice(OWN_PREFIX.length))
            : []);
    }

    // Pixel emote sprite: a 3-frame animation cut from the Pipoya sheet
    // (css .px-emote). `scale` is the size multiple of the 32 px frame.
    // index may be "15x": that emote with a red X over it (bot talk: a pact ends).
    function spriteHtml(index, scale) {
        const crossed = typeof index === 'string' && /^\d+x$/.test(index);
        const n = Number(crossed ? index.slice(0, -1) : index);
        if (!Number.isInteger(n) || n < 0 || n > 99) return '';
        return `<span class="px-emote${crossed ? ' px-crossed' : ''}" style="--x:${(n % 10) * 96}px;--y:${Math.floor(n / 10) * 32}px;--s:${scale || 1.5}"></span>`;
    }

    // The emoji itself as HTML: sprite for pixel emotes, text otherwise.
    function displayHtml(item, scale) {
        return item.sprite != null ? spriteHtml(item.sprite, scale) : _esc(item.display);
    }

    // ----------------------------------------------------------------
    // PANEL OPEN / CLOSE
    // ----------------------------------------------------------------

    function togglePanel() {
        isPanelOpen ? closePanel() : openPanel();
    }

    function openPanel() {
        isPanelOpen = true;
        loadInventory();
        const panel = document.getElementById('emoji-panel');
        if (panel) panel.classList.add('open');
        const btn = document.getElementById('emoji-panel-btn');
        if (btn) btn.classList.add('active');
        // Sync gold display then render
        renderCurrentView();
    }

    function closePanel() {
        isPanelOpen = false;
        const panel = document.getElementById('emoji-panel');
        if (panel) panel.classList.remove('open');
        const btn = document.getElementById('emoji-panel-btn');
        if (btn) btn.classList.remove('active');
    }

    function switchView(view) {
        currentView = view;
        document.querySelectorAll('.emoji-tab-btn').forEach(b => {
            b.classList.toggle('active', b.dataset.view === view);
        });
        renderCurrentView();
    }

    function renderCurrentView() {
        const content = document.getElementById('emoji-panel-content');
        if (!content) return;
        currentView === 'shop' ? renderShop(content) : renderInventory(content);
    }

    // ----------------------------------------------------------------
    // RENDER — My Emojis (inventory)
    // ----------------------------------------------------------------

    function renderInventory(container) {
        const owned = EMOJI_ITEMS.filter(e => emojiInventoryIds.has(e.id));
        const inGame = isInGame();

        if (owned.length === 0) {
            container.innerHTML = `
              <div class="emoji-empty-state">
                <div style="font-size:42px;margin-bottom:10px;"></div>
                <div style="color:#ccc;font-weight:bold;">No emojis yet!</div>
                <div style="font-size:12px;color:#888;margin-top:6px;">Head to the Shop tab to get started.</div>
              </div>`;
            return;
        }

        let html = '<div class="emoji-grid">';
        for (const item of owned) {
            const isText = item.isText;
            const cls = 'emoji-btn' + (isText ? ' text-emoji' : '') + (item.sprite != null ? ' px-emoji' : '');
            if (inGame) {
                html += `<button class="${cls}" onclick="window.emojiSystem.useEmoji('${item.id}')" title="${_esc(item.name)}">${displayHtml(item)}</button>`;
            } else {
                html += `<div class="${cls} emoji-btn-inactive" title="${_esc(item.name)} (join a game to use)">${displayHtml(item)}</div>`;
            }
        }
        html += '</div>';

        if (!inGame) {
            html += '<p class="emoji-no-game-note">Join a game to use emojis</p>';
        }

        container.innerHTML = html;
    }

    // ----------------------------------------------------------------
    // RENDER — Shop
    // ----------------------------------------------------------------

    function renderShop(container) {
        // Pull cached gold — refreshed when gami is ready
        const gold = (window.gami?.profile?.gold != null) ? window.gami.profile.gold : '…';

        let html = `<div class="shop-gold-display">${gold}g</div>`;

        for (const tier of EMOJI_TIERS) {
            const items = EMOJI_ITEMS.filter(e => e.tier === tier.id);
            html += `
              <div class="shop-tier-section">
                <div class="shop-tier-header" style="border-left-color:${tier.color}">
                  <span style="color:${tier.color};font-weight:bold;font-size:12px;">${tier.badge}</span>
                  <span class="shop-tier-name">${tier.name}</span>
                  <span class="shop-tier-cost" style="color:${tier.color}">${tier.cost}g</span>
                </div>
                <div class="emoji-shop-grid">`;

            for (const item of items) {
                const owned = emojiInventoryIds.has(item.id);
                const btnCls = 'shop-emoji-btn' + (item.isText ? ' text-emoji' : '') + (item.sprite != null ? ' px-emoji' : '');

                if (owned) {
                    html += `
                      <div class="shop-item owned" title="${_esc(item.name)} (owned)">
                        <span class="${btnCls}">${displayHtml(item)}</span>
                        <div class="shop-item-name">${_esc(item.name)}</div>
                        <div class="owned-badge">✓ Owned</div>
                      </div>`;
                } else {
                    html += `
                      <div class="shop-item" title="${_esc(item.name)} - ${item.cost}g">
                        <button class="${btnCls}" onclick="window.emojiSystem.purchaseEmoji('${item.id}')">${displayHtml(item)}</button>
                        <div class="shop-item-name">${_esc(item.name)}</div>
                        <button class="shop-buy-btn" style="border-color:${tier.color};color:${tier.color}" onclick="window.emojiSystem.purchaseEmoji('${item.id}')">${item.cost}g</button>
                      </div>`;
                }
            }

            html += '</div></div>';
        }

        container.innerHTML = html;
    }

    // ----------------------------------------------------------------
    // PURCHASE
    // ----------------------------------------------------------------

    async function purchaseEmoji(emojiId) {
        const item = EMOJI_ITEMS.find(e => e.id === emojiId);
        if (!item) return;
        if (emojiInventoryIds.has(emojiId)) return; // already owned

        if (!window.gami?.userId) {
            alert('Please sign in to purchase emojis.');
            return;
        }

        // Refresh gold from cache
        const profile = window.gami.profile;
        const currentGold = profile?.gold ?? 0;

        if (currentGold < item.cost) {
            if (window.gami.notify) {
                window.gami.notify(`Need ${item.cost}g - you have ${currentGold}g`, null, 'gold');
            } else {
                alert(`Not enough gold! Need ${item.cost}g but you have ${currentGold}g.`);
            }
            return;
        }

        const confirmed = await new Promise(resolve => {
            const overlay = document.createElement('div');
            overlay.className = 'retro-dlg-overlay';
            overlay.innerHTML = `
              <div class="retro-dlg-box">
                <div class="retro-dlg-title">Confirm Purchase</div>
                <div class="retro-dlg-body">
                  <div class="retro-dlg-line">${displayHtml(item)}  ${_esc(item.name)}</div>
                  <div class="retro-dlg-line">Cost: ${item.cost}g</div>
                </div>
                <div class="retro-dlg-btns">
                  <button class="retro-dlg-btn ok" id="rdlg-ok">Buy</button>
                  <button class="retro-dlg-btn cancel" id="rdlg-cancel">Cancel</button>
                </div>
              </div>`;
            document.body.appendChild(overlay);
            overlay.querySelector('#rdlg-ok').onclick = () => { overlay.remove(); resolve(true); };
            overlay.querySelector('#rdlg-cancel').onclick = () => { overlay.remove(); resolve(false); };
        });
        if (!confirmed) return;

        try {
            // Pays the server price and records ownership on the account
            // (fails if there isn't enough gold or it is already owned)
            const { data: newGold, error } = await supabase.rpc('buy_cosmetic', { p_id: OWN_PREFIX + emojiId });

            if (error) throw error;

            if (window.gami.profile) {
                const prof = window.gami.profile;
                prof.gold = typeof newGold === 'number' ? newGold : Math.max(0, (prof.gold || 0) - item.cost);
                prof.cosmetics_owned = [...(Array.isArray(prof.cosmetics_owned) ? prof.cosmetics_owned : []), OWN_PREFIX + emojiId];
            }
            emojiInventoryIds.add(emojiId);

            // Toast notification
            if (window.gami.notify) {
                window.gami.notify(`${item.sprite != null ? '' : item.display + '  '}${item.name} unlocked!`, item.cost, 'gold');
            }

            // Re-render to reflect new state
            renderCurrentView();

        } catch (err) {
            console.error('Emoji purchase failed:', err);
            const msg = /enough gold/.test(err?.message || '') ? 'Not enough gold' : (err?.message || 'Unknown error');
            alert('Purchase failed: ' + msg);
        }
    }

    // ----------------------------------------------------------------
    // USE EMOJI — show locally + broadcast to other players
    // ----------------------------------------------------------------

    function useEmoji(emojiId) {
        if (!isInGame()) return;

        const item = EMOJI_ITEMS.find(e => e.id === emojiId);
        if (!item) return;

        // Per-user cooldown to prevent spam (2 s)
        if (emojiCooldown) return;
        emojiCooldown = true;
        clearTimeout(emojiCooldownTimer);
        emojiCooldownTimer = setTimeout(() => { emojiCooldown = false; }, 2000);

        const myIdx = (typeof myPlayerIndex !== 'undefined') ? myPlayerIndex : 0;

        // Show over my own pawn
        showEmojiOverPawn(myIdx, item.display || '', item.isText, item.sprite);

        // Broadcast to all other players (sprite = pixel emote cell)
        if (typeof isMultiplayer !== 'undefined' && isMultiplayer &&
            typeof broadcastGameAction === 'function') {
            const payload = { playerIndex: myIdx, display: item.display || '', isText: !!item.isText };
            if (item.sprite != null) payload.sprite = item.sprite;
            broadcastGameAction('emoji', payload);
        }

        // Close panel for clean UX
        closePanel();
    }

    // ----------------------------------------------------------------
    // SHOW EMOJI OVER PAWN  (called locally + by broadcast receiver)
    // ----------------------------------------------------------------

    // opts.dur: how long it shows, in ms (default 5000; bot 'thinking' emotes are short).
    function showEmojiOverPawn(playerIndex, display, isText, sprite, opts) {
        const dur = Math.max(400, Math.min(8000, +(opts?.dur) || 5000));
        if (typeof playerPositions === 'undefined') return;
        const player = playerPositions[playerIndex];
        if (!player?.element) return;

        const rect = player.element.getBoundingClientRect();
        if (!rect || (rect.width === 0 && rect.height === 0)) return;

        // Centre horizontally on pawn, anchor just above it
        const cx = rect.left + rect.width  / 2;
        const cy = rect.top  + rect.height / 2;

        const el = document.createElement('div');
        // An array of sprites is a bot "sentence" (js/bot-diplomacy.js):
        // the emotes sit side by side and pop in one after another.
        const list = Array.isArray(sprite) ? sprite.slice(0, 4) : null;
        const px = list
            ? list.map((s, k) => `<span class="emoji-word" style="animation-delay:${k * 0.45}s">${spriteHtml(s, list.length > 2 ? 1.5 : 2)}</span>`).join('')
            : (sprite != null ? spriteHtml(sprite, 2) : '');
        if (px) {
            el.className = 'emoji-float emoji-float-px';
            el.innerHTML = px;
        } else {
            if (!display) return;
            el.className = 'emoji-float' + (isText ? ' emoji-float-text' : '');
            el.textContent = display;
        }
        // Outline in the player's colour (pixel emotes: an edge that follows
        // the sprite; text: the border).
        const colour = typeof player.color === 'string' ? player.color : null;
        if (colour) {
            if (px) {
                const d = (x, y) => `drop-shadow(${x}px ${y}px 0 ${colour})`;
                el.style.filter = `${d(2, 0)} ${d(-2, 0)} ${d(0, 2)} ${d(0, -2)} drop-shadow(0 3px 6px rgba(0,0,0,0.55))`;
            } else if (isText) el.style.borderColor = colour;
        }
        // Pixel emotes (64 px tall): bottom edge just above the pawn, like a
        // speech bubble. Text emojis keep their old anchor at the pawn centre.
        const anchorY = px ? rect.top - 4 : cy;
        el.style.left = '0px';
        el.style.top = px ? `-${list && list.length > 2 ? 48 : 64}px` : '0px';
        el.style.position = 'absolute';
        // Pinned to the board (owner, 2026-09-28): the anchor is a point on
        // the board (#viewport), mapped to the screen every frame, so the
        // emote pans and zooms with the board and stays where it was said.
        const holder = document.createElement('div');
        holder.className = 'emoji-anchor';
        holder.style.left = cx + 'px';
        holder.style.top = anchorY + 'px';
        holder.appendChild(el);
        // The anchor is an invisible box in the board where the pawn stood;
        // its on-screen box (getBoundingClientRect) includes every pan, zoom
        // and board tilt.
        let marker = null, w0 = rect.width || 1;
        try {
            const pe = player.element, parent = pe.parentNode;
            const bb = pe.getBBox();
            const tm = pe.transform?.baseVal?.consolidate?.()?.matrix;
            const a = tm ? new DOMPoint(bb.x, bb.y).matrixTransform(tm) : { x: bb.x, y: bb.y };
            const c = tm ? new DOMPoint(bb.x + bb.width, bb.y + bb.height).matrixTransform(tm) : { x: bb.x + bb.width, y: bb.y + bb.height };
            marker = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
            marker.setAttribute('x', Math.min(a.x, c.x));
            marker.setAttribute('y', Math.min(a.y, c.y));
            marker.setAttribute('width', Math.max(0.01, Math.abs(c.x - a.x)));
            marker.setAttribute('height', Math.max(0.01, Math.abs(c.y - a.y)));
            marker.setAttribute('fill', 'none');
            marker.setAttribute('pointer-events', 'none');
            marker.setAttribute('class', 'emoji-anchor-mark');
            parent.appendChild(marker);
            w0 = marker.getBoundingClientRect().width || w0;
        } catch (e) { marker?.remove(); marker = null; }
        if (marker) {
            const born = performance.now();
            const follow = () => {
                if (!holder.isConnected || !marker.isConnected || performance.now() - born > dur + 1000) { marker.remove(); return; }
                const r = marker.getBoundingClientRect();
                if (r.width || r.height) {
                    const k = Math.max(0.4, Math.min(2, r.width / w0));
                    holder.style.left = (r.left + r.width / 2) + 'px';
                    holder.style.top = (px ? r.top - 4 * k : r.top + r.height / 2) + 'px';
                    holder.style.transform = `scale(${k})`;
                }
                requestAnimationFrame(follow);
            };
            requestAnimationFrame(follow);
        }

        // A new bot sentence over the same pawn replaces the one before it
        // (fades it out) so two sentences never mix into each other.
        if (list) {
            const prev = lastSentence[playerIndex];
            if (prev && prev.isConnected) {
                try { prev.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 250, fill: 'forwards' }); } catch (e) {}
                setTimeout(() => (prev.parentElement || prev).remove(), 260);
            }
            lastSentence[playerIndex] = el;
        }

        if (dur !== 5000) el.style.animationDuration = (dur / 1000) + 's';
        document.body.appendChild(holder);

        // Remove once the CSS animation finishes (+0.5 s to let the fade complete)
        setTimeout(() => holder.remove(), dur + 500);
    }
    const lastSentence = {};
    // Remove every floating emote at once (a training round ended).
    function clearAll() {
        document.querySelectorAll('.emoji-anchor, .emoji-anchor-mark').forEach(n => n.remove());
        for (const k of Object.keys(lastSentence)) delete lastSentence[k];
    }

    // ----------------------------------------------------------------
    // HELPERS
    // ----------------------------------------------------------------

    function isInGame() {
        const gl = document.getElementById('game-layout');
        return !!(gl && gl.classList.contains('active'));
    }

    function _esc(str) {
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    // ----------------------------------------------------------------
    // PANEL DOM — injected once on init
    // ----------------------------------------------------------------

    function createPanelDOM() {
        const panel = document.createElement('div');
        panel.id = 'emoji-panel';
        panel.setAttribute('aria-label', 'Emoji panel');
        panel.innerHTML = `
          <div class="emoji-panel-header">
            <div class="emoji-panel-tabs">
              <button class="emoji-tab-btn active" data-view="inventory"
                      onclick="window.emojiSystem.switchView('inventory')">My Emojis</button>
              <button class="emoji-tab-btn" data-view="shop"
                      onclick="window.emojiSystem.switchView('shop')">Shop</button>
            </div>
            <button class="emoji-panel-close" onclick="window.emojiSystem.closePanel()" title="Close">✕</button>
          </div>
          <div id="emoji-panel-content" class="emoji-panel-body"></div>
        `;
        document.body.appendChild(panel);

        // Close on click outside
        document.addEventListener('click', (e) => {
            if (!isPanelOpen || !e.isTrusted) return; // bots click from script: not a close
            const p = document.getElementById('emoji-panel');
            const b = document.getElementById('emoji-panel-btn');
            const lb = document.getElementById('emoji-lobby-btn');
            if (p && !p.contains(e.target) &&
                b  && !b.contains(e.target)  &&
                (!lb || !lb.contains(e.target))) {
                closePanel();
            }
        });
    }

    // ----------------------------------------------------------------
    // INIT (called after DOM ready)
    // ----------------------------------------------------------------

    function init() {
        createPanelDOM();
        loadInventory();
        renderCurrentView();
        console.log('✅ Emoji system ready -', EMOJI_ITEMS.length, 'emojis in', EMOJI_TIERS.length, 'tiers');
    }

    // ----------------------------------------------------------------
    // PUBLIC API
    // ----------------------------------------------------------------

    window.emojiSystem = {
        init,
        togglePanel,
        openPanel,
        closePanel,
        switchView,
        purchaseEmoji,
        useEmoji,
        showEmojiOverPawn,
        clearAll,
        displayHtml,
        reloadInventory: loadInventory,
        getItems()     { return EMOJI_ITEMS; },
        getTiers()     { return EMOJI_TIERS; },
        getInventory() { return new Set(emojiInventoryIds); },
    };

    // Auto-init when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
