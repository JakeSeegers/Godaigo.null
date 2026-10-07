        // ============================================
        // NEW UI FUNCTIONS
        // ============================================

        // Shared "is the active player still mid placement-tile-overlay" check.
        // isPlacementPhase is only ever set true by the real multiplayer lobby
        // flow (startMultiplayerGame() in lobby.js) — the local startGame() path
        // (used by both a manual local game and js/tutorial-mode.js) never
        // touches it, so it stays permanently false/undefined there. Falling
        // back to "has the active player placed a pawn yet" (same trick
        // js/bot-state.js's legalActions() uses) makes this observable for
        // local/tutorial games too, not just real multiplayer.
        function isTilePlacementPending() {
            if (typeof isPlacementPhase !== 'undefined' && isPlacementPhase) return true;
            return typeof playerPositions !== 'undefined' && typeof activePlayerIndex !== 'undefined' &&
                !playerPositions[activePlayerIndex];
        }

        function initializeNewUI() {
            console.log('🎨 Initializing new UI...');

            // Setup stone card drag handlers for new UI
            const stoneCards = document.querySelectorAll('.stone-card');
            stoneCards.forEach(card => {
                const element = card.dataset.element;
                if (element) {
                    setupStoneDragFromCard(card, element);
                }
            });

            // Setup scroll deck UI
            initializeScrollDeckUI();

            // Game Log/Opponent Status/Elemental Stones are built (but left
            // CLOSED) by js/scroll-panels.js's init() at page load — same
            // draggable/resizable/collapsible/closeable chrome as Hand/Active/
            // Common. Opening them is deliberately NOT done there (that runs at
            // DOMContentLoaded, before login/the splash screen/the lobby even
            // exist) and not immediately here either: initializeNewUI() itself
            // runs at game START, which means the tile-placement phase (and the
            // #placement-tile-overlay it shows top-center, z-index 500) is still
            // ahead — a real bug this project hit was these three (.fsp,
            // z-index 800) floating over that overlay. Poll isTilePlacementPending()
            // — same fallback updatePlacementTileOverlay() uses below, so this
            // now waits correctly for local games and tutorial mode too, not
            // just real multiplayer — and open them the moment it clears.
            (function openAmbientPanelsWhenReady() {
                if (isTilePlacementPending()) {
                    setTimeout(openAmbientPanelsWhenReady, 300);
                    return;
                }
                window.ScrollPanelSystem?.openAmbientPanels?.();
            })();

            // Initial HUD update
            updateHUD();

            // Placement-tile overlay: no button, so poll rather than hook
            // every code path that could change phase/turn state.
            setInterval(() => { if (!document.hidden) updatePlacementTileOverlay(); }, 300);
        }

        // Placement-tile overlay: auto-shown only during the local player's
        // own placement-phase turn — no button, since it's only ever
        // relevant briefly at game start. isMyTurn() explicitly excludes
        // placement (it's for in-game actions), so check activePlayerIndex
        // directly instead.
        function updatePlacementTileOverlay() {
            const overlay = document.getElementById('placement-tile-overlay');
            if (!overlay) return;
            const myPlacementTurn = isTilePlacementPending() &&
                (typeof isMultiplayer === 'undefined' || !isMultiplayer || myPlayerIndex === activePlayerIndex);
            const hasTiles = typeof playerTilesAvailable !== 'undefined' && playerTilesAvailable > 0;
            overlay.style.display = (myPlacementTurn && hasTiles) ? '' : 'none';
        }

        // Play n footstep sounds spaced ~160ms apart (for multi-hex moves).
        // Wind steps (cost 0) are excluded by the caller — only pass non-wind steps.
        function playFootsteps(n) {
            if (!n || n <= 0) return;
            window.SoundSystem?.playFootstep();
            for (let i = 1; i < n; i++) {
                setTimeout(() => window.SoundSystem?.playFootstep(), i * 160);
            }
        }

        // Initialize scroll deck UI with right-click handlers
        function initializeScrollDeckUI() {
            const deckCards = document.querySelectorAll('.scrolldeck-pip');
            deckCards.forEach(card => {
                const element = card.dataset.element;
                if (element) {
                    // Right-click to browse deck (gated by console flag)
                    card.addEventListener('contextmenu', (e) => {
                        e.preventDefault();
                        if (typeof window !== 'undefined' && window.SHOW_SCROLL_DECK_BROWSER) {
                            showScrollDeckBrowser(element);
                        }
                    });

                    // Left-click also opens browser for convenience (gated)
                    card.addEventListener('click', (e) => {
                        if (typeof window !== 'undefined' && window.SHOW_SCROLL_DECK_BROWSER) {
                            showScrollDeckBrowser(element);
                        }
                    });
                }
            });

            // Update deck counts initially
            updateScrollDeckUI();
        }

        // Update the dock's scroll-deck pips with current deck counts
        function updateScrollDeckUI() {
            if (!spellSystem || !spellSystem.scrollDecks) return;

            const elements = ['earth', 'water', 'fire', 'wind', 'void', 'catacomb'];
            elements.forEach(element => {
                const count = spellSystem.scrollDecks[element]?.length || 0;
                const pipEl = document.getElementById(`scrolldeck-pip-${element}`);
                const pipCountEl = document.getElementById(`scrolldeck-pip-${element}-count`);
                if (pipCountEl) pipCountEl.textContent = count;
                if (pipEl) pipEl.classList.toggle('empty', count === 0);
            });

            // Update common area display
            updateCommonAreaUI();
        }

        // Update common area UI
        function updateCommonAreaUI() {
            if (!spellSystem) return;

            const container = document.getElementById('common-area-container');
            if (!container) return;
            if (container.dataset.expanded === undefined) container.dataset.expanded = 'false';

            const commonScrolls = spellSystem.getCommonAreaScrolls();

            if (commonScrolls.length === 0) {
                container.innerHTML = '<div class="common-area-empty">No scrolls in common area</div>';
                return;
            }

            container.innerHTML = '';
            commonScrolls.forEach(scrollName => {
                const scrollInfo = spellSystem.patterns?.[scrollName] || SCROLL_DEFINITIONS?.[scrollName];
                if (!scrollInfo) return;

                const element = spellSystem.getScrollElement(scrollName);
                const scrollEl = document.createElement('div');
                scrollEl.className = `common-area-scroll ${element}`;
                scrollEl.title = scrollInfo.description || '';

                const nameEl = document.createElement('div');
                nameEl.className = 'common-area-scroll-name';
                nameEl.textContent = scrollInfo.name || scrollName;
                scrollEl.appendChild(nameEl);

                // Stone formation / pattern display only when common area is expanded (popout mode)
                const isExpanded = container.dataset.expanded === 'true';
                if (isExpanded && scrollInfo.patterns && typeof spellSystem.createPatternVisual === 'function') {
                    const patternVisual = spellSystem.createPatternVisual(scrollInfo, element);
                    patternVisual.classList?.add?.('common-area-pattern');
                    patternVisual.style.marginTop = '6px';
                    patternVisual.style.padding = '8px';
                    if (patternVisual.style) patternVisual.style.maxWidth = '100%';
                    scrollEl.appendChild(patternVisual);
                }

                // Click to view details
                scrollEl.addEventListener('click', () => {
                    showScrollInfoPopup(scrollName, scrollInfo, element);
                });

                container.appendChild(scrollEl);
            });
        }

        // Shared scroll info popup — used by common area and opponent active area
        function showScrollInfoPopup(scrollName, pattern, element) {
            const existing = document.getElementById('scroll-info-popup-overlay');
            if (existing) existing.remove();

            // A catacomb scroll shows both of its element colors (ScrollLook, game-core.js)
            const look = window.ScrollLook;
            const elementColor = look ? look.colors(scrollName)[0] : (STONE_TYPES[element]?.color || '#aaa');
            const elementLabel = look ? look.label(scrollName) : (element ? element.charAt(0).toUpperCase() + element.slice(1) : 'Unknown');
            const elementImg   = STONE_TYPES[element]?.img || '';
            const scrollTitle  = pattern?.name || scrollName;
            const levelText    = pattern?.level ? `Level ${pattern.level}` : '';
            const description  = pattern?.description || 'No description available.';

            const overlay = document.createElement('div');
            overlay.id = 'scroll-info-popup-overlay';
            overlay.className = 'retro-dlg-overlay';
            overlay.style.zIndex = '2000';
            overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

            const box = document.createElement('div');
            box.className = 'retro-dlg-box wide';
            box.style.cssText = `
                max-width: 480px;
                width: 90vw;
                padding: 0;
                overflow: hidden;
                border: 2px solid ${elementColor};
                box-shadow: 0 0 24px ${elementColor}55, 0 4px 32px #000a;
            `;

            // ── Coloured header band ──────────────────────────────────
            const header = document.createElement('div');
            header.style.cssText = `
                background: ${elementColor}22;
                border-bottom: 2px solid ${elementColor};
                padding: 14px 18px 10px;
                display: flex;
                align-items: center;
                gap: 10px;
            `;
            if (look && element) {
                header.insertAdjacentHTML('beforeend', look.iconHtml(scrollName, 'element-icon-sm', 'width:28px;height:28px;object-fit:contain;flex-shrink:0;'));
            } else if (elementImg) {
                const icon = document.createElement('img');
                icon.src = elementImg;
                icon.className = 'element-icon-sm';
                icon.alt = elementLabel;
                icon.style.cssText = 'width:28px;height:28px;object-fit:contain;flex-shrink:0;';
                header.appendChild(icon);
            }
            const headerText = document.createElement('div');
            headerText.style.cssText = 'flex:1;';
            const line1 = document.createElement('div');
            line1.style.cssText = `font-family:var(--font-pixel);font-size:13px;color:${elementColor};letter-spacing:2px;text-transform:uppercase;` + (look ? look.textStyle(scrollName) : '');
            line1.textContent = elementLabel + (levelText ? ' · ' + levelText : '');
            headerText.appendChild(line1);
            const line2 = document.createElement('div');
            line2.style.cssText = 'font-family:var(--font-terminal);font-size:20px;color:#e8dcc8;margin-top:3px;line-height:1.2;word-break:break-word;';
            line2.textContent = scrollTitle;
            headerText.appendChild(line2);
            header.appendChild(headerText);
            box.appendChild(header);

            // ── Description ──────────────────────────────────────────
            const body = document.createElement('div');
            body.style.cssText = 'padding: 16px 18px 4px;';

            const desc = document.createElement('div');
            desc.style.cssText = `
                font-family: var(--font-terminal);
                font-size: 17px;
                color: #cfc9b8;
                line-height: 1.55;
                text-align: left;
            `;
            desc.textContent = description;
            body.appendChild(desc);
            box.appendChild(body);

            // ── Pattern visual ───────────────────────────────────────
            if (pattern?.patterns && typeof spellSystem?.createPatternVisual === 'function') {
                const sep = document.createElement('div');
                sep.style.cssText = `
                    margin: 14px 18px 0;
                    border-top: 1px solid ${elementColor}44;
                    padding-top: 12px;
                `;
                const patternLabel = document.createElement('div');
                patternLabel.style.cssText = `
                    font-family: var(--font-pixel);
                    font-size: 12px;
                    color: ${elementColor};
                    letter-spacing: 2px;
                    text-transform: uppercase;
                    margin-bottom: 10px;
                    text-align: center;
                `;
                patternLabel.textContent = 'Stone Pattern';
                sep.appendChild(patternLabel);

                const patternWrap = document.createElement('div');
                patternWrap.style.cssText = 'display:flex;justify-content:center;padding-bottom:4px;';
                const visual = spellSystem.createPatternVisual(pattern, element);
                // Scale up the pattern SVG slightly for readability
                visual.style.transform = 'scale(1.3)';
                visual.style.transformOrigin = 'center top';
                visual.style.marginBottom = '20px';
                patternWrap.appendChild(visual);
                sep.appendChild(patternWrap);
                box.appendChild(sep);
            }

            // ── Close button ─────────────────────────────────────────
            const footer = document.createElement('div');
            footer.style.cssText = 'padding: 14px 18px 16px; text-align: center;';
            const closeBtn = document.createElement('button');
            closeBtn.textContent = 'Close';
            closeBtn.className = 'retro-dlg-btn';
            closeBtn.onclick = () => overlay.remove();
            footer.appendChild(closeBtn);
            box.appendChild(footer);

            overlay.appendChild(box);
            document.body.appendChild(overlay);
        }
        // Expose globally so scroll-panels.js can call it
        window.showScrollInfoPopup = showScrollInfoPopup;

        // Show details for a common area scroll
        function showCommonAreaScrollDetails(scrollName, scrollInfo, element) {
            const modal = document.createElement('div');
            modal.className = 'scroll-browse-modal';
            modal.innerHTML = `
                <div class="scroll-browse-content">
                    <div class="scroll-browse-header">
                        <h3>${scrollInfo.name || scrollName}</h3>
                        <button class="scroll-browse-close">&times;</button>
                    </div>
                    <div style="padding: 16px;">
                        <div style="color: var(--text-secondary); margin-bottom: 8px;">
                            <strong>Element:</strong> ${element.charAt(0).toUpperCase() + element.slice(1)}
                        </div>
                        <div style="color: var(--text-secondary); margin-bottom: 8px;">
                            <strong>Level:</strong> ${scrollInfo.level || 'N/A'}
                        </div>
                        <div style="color: var(--text-primary); line-height: 1.5;">
                            ${scrollInfo.description || 'No description available.'}
                        </div>
                        <div id="common-area-detail-pattern" style="margin-top: 12px;"></div>
                    </div>
                    <div class="scroll-browse-footer">
                        <button class="btn-close">Close</button>
                    </div>
                </div>
            `;

            document.body.appendChild(modal);

            // Add stone formation / pattern display (match other scrolls)
            const patternContainer = modal.querySelector('#common-area-detail-pattern');
            if (patternContainer && scrollInfo.patterns && typeof spellSystem.createPatternVisual === 'function') {
                const patternVisual = spellSystem.createPatternVisual(scrollInfo, element);
                patternContainer.appendChild(patternVisual);
            }

            // Close handlers
            modal.querySelector('.scroll-browse-close').addEventListener('click', () => modal.remove());
            modal.querySelector('.btn-close').addEventListener('click', () => modal.remove());
            modal.addEventListener('click', (e) => {
                if (e.target === modal) modal.remove();
            });
        }

        // Show scroll deck browser modal
        function showScrollDeckBrowser(element) {
            if (!spellSystem || !spellSystem.scrollDecks) return;

            const deck = spellSystem.scrollDecks[element];
            if (!deck || deck.length === 0) {
                updateStatus(`The ${element} scroll deck is empty!`);
                return;
            }

            const modal = document.createElement('div');
            modal.className = 'scroll-browse-modal';
            modal.innerHTML = `
                <div class="scroll-browse-content">
                    <div class="scroll-browse-header">
                        <h3>${element.charAt(0).toUpperCase() + element.slice(1)} Scroll Deck (${deck.length})</h3>
                        <button class="scroll-browse-close">&times;</button>
                    </div>
                    <div class="scroll-browse-list" id="scroll-browse-list">
                        <!-- Scrolls will be added here -->
                    </div>
                    <div class="scroll-browse-footer">
                        <button class="btn-shuffle">Shuffle Deck</button>
                        <button class="btn-close">Close</button>
                    </div>
                </div>
            `;

            const listEl = modal.querySelector('#scroll-browse-list');

            // Add each scroll in the deck
            deck.forEach((scrollName, index) => {
                const scrollInfo = spellSystem.patterns?.[scrollName] || SCROLL_DEFINITIONS?.[scrollName];
                if (!scrollInfo) return;

                const item = document.createElement('div');
                item.className = 'scroll-browse-item';
                item.innerHTML = `
                    <div class="scroll-name">${scrollInfo.name || scrollName}</div>
                    <div class="scroll-desc">${scrollInfo.description || 'No description'}</div>
                    <div class="scroll-level">Level ${scrollInfo.level || '?'} • Position ${index + 1} in deck</div>
                `;

                // Click to draw this scroll
                item.addEventListener('click', () => {
                    drawScrollFromDeck(element, scrollName, index);
                    modal.remove();
                });

                listEl.appendChild(item);
            });

            document.body.appendChild(modal);

            // Close handlers
            modal.querySelector('.scroll-browse-close').addEventListener('click', () => modal.remove());
            modal.querySelector('.btn-close').addEventListener('click', () => modal.remove());
            modal.addEventListener('click', (e) => {
                if (e.target === modal) modal.remove();
            });

            // Shuffle handler
            modal.querySelector('.btn-shuffle').addEventListener('click', () => {
                if (spellSystem.shuffleDeck && spellSystem.scrollDecks[element]) {
                    spellSystem.shuffleDeck(spellSystem.scrollDecks[element]);
                    updateStatus(`${element.charAt(0).toUpperCase() + element.slice(1)} scroll deck shuffled!`);
                    modal.remove();
                    // Reopen to show new order
                    showScrollDeckBrowser(element);
                }
            });
        }

        // Draw a specific scroll from a deck (for testing)
        function drawScrollFromDeck(element, scrollName, index) {
            if (!spellSystem || !spellSystem.scrollDecks) return;

            const deck = spellSystem.scrollDecks[element];
            if (!deck || index >= deck.length) return;

            // Remove scroll from deck at specified index
            deck.splice(index, 1);

            // Add to player's hand
            const scrolls = spellSystem.getPlayerScrolls(false);

            // Check hand limit
            if (scrolls.hand.size >= 4) {
                updateStatus(`Your hand is full (4 scrolls max)! Discard or use a scroll first.`);
                // Put scroll back
                deck.splice(index, 0, scrollName);
                return;
            }

            scrolls.hand.add(scrollName);
            spellSystem.updateScrollCount();
            updateScrollDeckUI();
            updateHUD();

            const scrollInfo = spellSystem.patterns?.[scrollName] || SCROLL_DEFINITIONS?.[scrollName];
            updateStatus(`Drew ${scrollInfo?.name || scrollName} from the ${element} deck!`);

            // Shuffle the deck after drawing (as requested)
            if (spellSystem.shuffleDeck) {
                spellSystem.shuffleDeck(deck);
                console.log(`📜 ${element} deck shuffled after drawing`);
            }

            // Broadcast so other clients update their deck/hand state
            if (isMultiplayer) {
                broadcastGameAction('scroll-collected', {
                    playerIndex: activePlayerIndex,
                    scrollName: scrollName,
                    shrineType: element
                });
                if (typeof syncPlayerState === 'function') syncPlayerState();
            }
        }

        function updateHUD() {
            // Guard: Don't update if game variables aren't initialized yet
            try {
                if (typeof currentAP === 'undefined' || typeof voidAP === 'undefined') {
                    return;
                }
            } catch (e) {
                return; // Variables not ready yet
            }

            // Update AP
            const hudApValue = document.getElementById('hud-ap-value');
            if (hudApValue) hudApValue.textContent = currentAP;
            updateApPips(currentAP);

            // Update Void AP display
            const hudVoidAp = document.getElementById('hud-void-ap');
            if (hudVoidAp) {
                hudVoidAp.textContent = voidAP > 0 ? `+${voidAP}` : '';
            }

            // Update scroll counts - only if spellSystem is fully initialized
            try {
                if (typeof spellSystem !== 'undefined' && spellSystem && spellSystem.handScrolls) {
                    const hudHandCount = document.getElementById('hud-hand-count');
                    const hudActiveCount = document.getElementById('hud-active-count');
                    const hudCommonCount = document.getElementById('hud-common-count');

                    if (hudHandCount) hudHandCount.textContent = spellSystem.handScrolls.size || 0;
                    if (hudActiveCount) hudActiveCount.textContent = spellSystem.activeScrolls ? spellSystem.activeScrolls.size : 0;
                    if (hudCommonCount && spellSystem.getCommonAreaScrolls) hudCommonCount.textContent = spellSystem.getCommonAreaScrolls().length;
                }
            } catch (e) {
                // spellSystem not ready yet
            }

            // Update player name/turn indicator
            try {
                const hudPlayerName = document.getElementById('hud-player-name');
                const hudPlayerDot  = document.getElementById('hud-player-dot');
                const hudPlayer     = hudPlayerName?.closest('.hud-player');
                if (hudPlayerName && typeof activePlayerIndex !== 'undefined') {
                    // While the host is impersonating a bot (see bot-driver.js's
                    // asBot()), myPlayerIndex is temporarily swapped to the BOT's
                    // own index, so activePlayerIndex === myPlayerIndex is true
                    // for the bot's own turn too — which wrongly showed "Your
                    // Turn" on the host's screen while a bot was acting. Compare
                    // against the host's real identity instead, same as
                    // response-window.js's localResponderIndex().
                    const driverIdx = (typeof window !== 'undefined' && window.BotDriver
                        && typeof window.BotDriver.driverRealIndex === 'function')
                        ? window.BotDriver.driverRealIndex() : null;
                    const realMyIndex = driverIdx != null ? driverIdx : myPlayerIndex;
                    const isMyTurnNow = typeof isMultiplayer !== 'undefined' && isMultiplayer
                        && realMyIndex === activePlayerIndex;
                    if (isMyTurnNow) {
                        hudPlayerName.textContent = 'Your Turn';
                    } else {
                        // getPlayerColorName() returns "Username (Color)" — for a
                        // bot that's the raw "🤖 Some Bot Name (Purple)" username,
                        // which is far longer/taller than "Your Turn" and was
                        // stretching the dock bar's height every time a bot's
                        // turn came up. Keep just the color for this compact
                        // slot; the full name is still shown elsewhere (player
                        // cards, response window, etc).
                        const raw = typeof getPlayerColorName === 'function'
                            ? getPlayerColorName(activePlayerIndex)
                            : `Player ${activePlayerIndex + 1}`;
                        const colorOnly = raw.match(/\(([^)]+)\)\s*$/);
                        const name = colorOnly ? colorOnly[1] : raw;
                        hudPlayerName.textContent = `${name}'s Turn`;
                    }
                    if (hudPlayer) hudPlayer.classList.toggle('your-turn', isMyTurnNow);
                }

                // Update player dot color — must reflect the ACTIVE player, not the local player
                if (hudPlayerDot) {
                    const colorMap = {
                        'purple': '#9458f4',
                        'yellow': '#ffce00',
                        'red': '#ed1b43',
                        'blue': '#5894f4',
                        'green': '#69d83a'
                    };
                    // Prefer the active player's colour from allPlayersData
                    const activePlayerData = typeof allPlayersData !== 'undefined'
                        ? allPlayersData.find(p => p.player_index === activePlayerIndex)
                        : null;
                    const activeColorKey = activePlayerData?.color
                        || (typeof playerColor !== 'undefined' ? playerColor : null);
                    hudPlayerDot.style.background = (activeColorKey && colorMap[activeColorKey])
                        ? colorMap[activeColorKey]
                        : '#d9b08c';
                }
                // Update shrine dots — always show the LOCAL player's win progress
                const shrineIndex = (typeof isMultiplayer !== 'undefined' && isMultiplayer && typeof myPlayerIndex !== 'undefined' && myPlayerIndex !== null)
                    ? myPlayerIndex
                    : (typeof activePlayerIndex !== 'undefined' ? activePlayerIndex : 0);
                updateShrineDots(shrineIndex);
                // Update dock
                updateDockPlayers();
            } catch (e) {
                // Variables not ready yet
            }
        }

        function updateDockPlayers() { /* removed — dock player roster was redundant with existing AP/turn displays */ }

        function updateShrineDots(playerIndex) {
            try {
                const scrollData = window.spellSystem?.playerScrolls?.[playerIndex];
                const activated = scrollData?.activated ?? new Set();
                ['earth', 'water', 'fire', 'wind', 'void'].forEach(el => {
                    const dot = document.getElementById('shrine-dot-' + el);
                    if (!dot) return;
                    dot.classList.toggle('complete', activated.has(el));
                });
            } catch (e) { /* spellSystem not ready */ }
        }

        // Five orange pips for regular AP, plus one purple pip per void AP
        // (void stones in your pool you can still spend this turn).
        function updateApPips(apValue, voidValue) {
            if (voidValue === undefined) voidValue = (typeof voidAP !== 'undefined') ? voidAP : 0;
            const wrap = document.getElementById('hud-ap-pips');
            document.querySelectorAll('.ap-pip:not(.void)').forEach(pip => {
                const n = parseInt(pip.dataset.pip, 10);
                pip.classList.toggle('filled', n <= apValue);
            });
            if (!wrap) return;
            const extra = wrap.querySelectorAll('.ap-pip.void');
            const want = Math.max(0, Math.min(10, voidValue | 0));
            for (let k = extra.length; k < want; k++) {
                const pip = document.createElement('span');
                pip.className = 'ap-pip void filled';
                wrap.appendChild(pip);
            }
            for (let k = extra.length - 1; k >= want; k--) extra[k].remove();
            wrap.title = want ? `Action Points: ${apValue} + ${want} Void AP` : 'Action Points';
        }

        function setupStoneDragFromCard(card, element) {
            card.addEventListener('mousedown', (e) => {
                if (stoneCounts[element] <= 0) {
                    updateStatus(`No ${element} stones available!`);
                    return;
                }
                // Start dragging a new stone from the deck
                startStoneDragFromDeck(e, element);
            });
        }

        function startStoneDragFromDeck(e, type) {
            // Check if it's this player's turn and no pending cascade
            if (!canTakeAction()) {
                notYourTurn();
                return;
            }

            if (stoneCounts[type] <= 0) {
                updateStatus(`No ${type} stones available!`);
                return;
            }

            e.preventDefault();

            // Clean up any pre-existing ghost (prevents orphaned stamps if drag starts mid-drag)
            if (ghostStone) {
                ghostStone.remove();
                ghostStone = null;
            }

            isDraggingFromDeck = true;
            isDraggingStone = true;
            draggedStoneId = null;
            draggedStoneType = type;

            // Create ghost stone at cursor position
            const coords = getEventCoords(e);
            const { x: screenX, y: screenY } = getBoardScreenXY(coords.x, coords.y);
            const world = screenToWorld(screenX, screenY);

            ghostStone = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            ghostStone.setAttribute('class', 'stone stone-ghost');
            ghostStone.setAttribute('transform', `translate(${world.x}, ${world.y})`);

            const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            circle.setAttribute('cx', 0);
            circle.setAttribute('cy', 0);
            circle.setAttribute('r', STONE_SIZE);
            circle.setAttribute('class', 'stone-piece');
            circle.setAttribute('fill', STONE_TYPES[type].color);

            const ghostImg = document.createElementNS('http://www.w3.org/2000/svg', 'image');
            ghostImg.setAttribute('href', STONE_TYPES[type].img);
            ghostImg.setAttribute('x', -STONE_SIZE);
            ghostImg.setAttribute('y', -STONE_SIZE);
            ghostImg.setAttribute('width', STONE_SIZE * 2);
            ghostImg.setAttribute('height', STONE_SIZE * 2);
            ghostImg.style.mixBlendMode = 'screen';

            ghostStone.appendChild(circle);
            ghostStone.appendChild(ghostImg);
            viewport.appendChild(ghostStone);
        }

        function updateSourceCount(type) {
            document.getElementById(type + '-source').textContent = 'Source: ' + sourcePool[type] + '/' + sourcePoolCapacity[type];
        }

        function returnStoneToPool(type) {
            // Return a stone to the SOURCE pool (not player pool)
            // This happens when stones are removed from board or destroyed
            const maxStones = sourcePoolCapacity[type];
            if (sourcePool[type] < maxStones) {
                sourcePool[type]++;
                updateSourceCount(type);
                console.log(`♻️ Returned ${type} stone to source pool (${sourcePool[type]}/${maxStones})`);
            } else {
                console.log(`⚠️ Cannot return ${type} stone to source pool: already at maximum (${maxStones})`);
            }
        }

        // ── Elemental Stones panel: drag-a-board-stone-back-to-return-it ──────
        // Mirrors returnStoneToPool's naming but targets the PLAYER's own pool
        // (stoneCounts — what the Resources UI displays), not the shared
        // source/deck pool that returnStoneToPool() manages.
        function isPointOverElementalStonesPanel(clientX, clientY) {
            const panel = document.getElementById('elemental-stones-panel');
            // Open state now comes from js/scroll-panels.js's panel system
            // (createPanel('elementalstones', ...)) instead of an 'open' CSS
            // class — the panel is draggable/resizable/closeable now, not a
            // fixed slide-up bar.
            if (!panel || !window.ScrollPanelSystem?.isOpen('elementalstones')) return false;
            const rect = panel.getBoundingClientRect();
            return clientX >= rect.left && clientX <= rect.right &&
                   clientY >= rect.top && clientY <= rect.bottom;
        }

        function updateStoneReturnHighlight(clientX, clientY, stoneType) {
            const panel = document.getElementById('elemental-stones-panel');
            if (!panel) return;
            const over = isPointOverElementalStonesPanel(clientX, clientY);
            panel.querySelectorAll('.stone-card').forEach(card => {
                card.classList.toggle('drag-return-target', over && card.dataset.element === stoneType);
            });
        }

        function clearStoneReturnHighlight() {
            const panel = document.getElementById('elemental-stones-panel');
            if (!panel) return;
            panel.querySelectorAll('.stone-card').forEach(card => card.classList.remove('drag-return-target'));
        }

        // Returns true if the drop was over the open panel (caller should skip
        // its normal board-placement handling). Dropping on the panel only
        // cancels a placement: a stone dragged out of the panel and dropped back
        // was never taken from the pool, so nothing changes. A stone already on
        // the board never goes into a pool this way (owner, 2026-10-01: that
        // "pocketed" stones and was never broadcast); it goes back to its spot.
        function tryReturnStoneToElementalPanel(clientX, clientY, stoneId, stoneType, originalPos) {
            if (!isPointOverElementalStonesPanel(clientX, clientY)) return false;
            if (stoneId !== null && originalPos) {
                placeMovedStone(originalPos.x, originalPos.y, stoneType, stoneId);
                updateStatus('Stones on the board can\'t go back to your pool. Stone returned to its spot.');
                window.SoundSystem?.play('error');
            }
            clearStoneReturnHighlight();
            return true;
        }

        let lastStatusMessage = null;
        let _statusFlashTimer = null;
        // Ambient override for the bot-turn suppression below — set by callers
        // that know EXACTLY whose action a status message is about (the
        // 'scroll-resolved' listener in multiplayer-state.js, which knows the
        // real responder/caster index for a resolving response/counter, as
        // opposed to whatever this client happens to be impersonating right
        // now). undefined means "fall back to the default (BotDriver.
        // controlsActivePlayer + activePlayerIndex) check below".
        let _statusActorIndex;
        window.withStatusActor = function (actorIndex, fn) {
            const prev = _statusActorIndex;
            _statusActorIndex = actorIndex;
            try { return fn(); }
            finally { _statusActorIndex = prev; }
        };
        function updateStatus(msg) {
            // Suppress messages that reveal a BOT's private state (scroll draws,
            // sacrifices, casts, ...). bot-driver.js impersonates a bot for the
            // duration of its own turn (swapping myPlayerIndex), which reused the
            // normal action code's updateStatus() calls and leaked what the bot
            // drew/activated onto the host's own screen. controlsActivePlayer()
            // covers a bot's own turn (movement/casting/drawing); _statusActorIndex
            // (set via withStatusActor) covers the separate case of a bot RESPONDING
            // to any cast, which runs without impersonation.
            const actorIndex = _statusActorIndex !== undefined
                ? _statusActorIndex
                : (window.BotDriver?.controlsActivePlayer?.() ? activePlayerIndex : null);
            if (actorIndex != null && window.BotDriver?.isBot?.(actorIndex)) {
                const name = typeof getPlayerColorName === 'function' ? getPlayerColorName(actorIndex) : `Player ${actorIndex + 1}`;
                msg = `${name} is taking their turn...`;
            }
            if (msg === lastStatusMessage) return;
            lastStatusMessage = msg;
            const el = document.getElementById('status');
            if (!el) return;
            el.textContent = msg;
            // Brief gold flash to draw attention to new messages
            el.style.color = '#d9b08c';
            clearTimeout(_statusFlashTimer);
            _statusFlashTimer = setTimeout(() => { el.style.color = ''; }, 1800);
        }

        let endTurnPromptShown = false;
        function resetEndTurnPrompt() {
            endTurnPromptShown = false;
        }

        window.showEndTurnPrompt = function () {
            if (endTurnPromptShown) return;
            // Bot turns decide when to end on their own (BotSystem's own scoring
            // already weighs endTurn against remaining actions) — this modal is a
            // human nudge only. asBot() swaps myPlayerIndex to the bot's index
            // while impersonating, so isMyTurn() reads true and this would
            // otherwise block the host's screen for every bot turn that spends
            // its AP to 0 (the same class of bug as the scroll-overflow stall).
            if (window.BotDriver?.controlsActivePlayer?.()) return;
            const endTurnBtn = document.getElementById('end-turn');
            if (!endTurnBtn || endTurnBtn.disabled) return;

            endTurnPromptShown = true;

            const existing = document.getElementById('end-turn-empty-ap-modal');
            if (existing) existing.remove();

            const overlay = document.createElement('div');
            overlay.id = 'end-turn-empty-ap-modal';
            overlay.className = 'retro-dlg-overlay';

            const modal = document.createElement('div');
            modal.className = 'retro-dlg-box';

            const title = document.createElement('div');
            title.textContent = 'Out of AP';
            title.className = 'retro-dlg-title';
            modal.appendChild(title);

            const message = document.createElement('div');
            message.textContent = "You're out of AP. Do you want to end your turn?";
            message.className = 'retro-dlg-line';
            modal.appendChild(message);

            const btnRow = document.createElement('div');
            btnRow.className = 'retro-dlg-btns';

            const cancelBtn = document.createElement('button');
            cancelBtn.textContent = 'Keep Playing';
            cancelBtn.className = 'retro-dlg-btn cancel';
            cancelBtn.onclick = () => overlay.remove();

            const confirmBtn = document.createElement('button');
            confirmBtn.textContent = 'End Turn';
            confirmBtn.className = 'retro-dlg-btn ok';
            confirmBtn.onclick = () => { overlay.remove(); endTurnBtn.click(); };

            btnRow.appendChild(cancelBtn);
            btnRow.appendChild(confirmBtn);
            modal.appendChild(btnRow);

            overlay.appendChild(modal);
            document.body.appendChild(overlay);
        };

        // Update the opponent panel with current game state
        function updateOpponentPanel() {
            const panel = document.getElementById('opponent-panel');
            const cardsContainer = document.getElementById('opponent-cards');
            const newCardsContainer = document.getElementById('new-opponent-cards');

            // Only show in multiplayer with more than 1 player
            if (!isMultiplayer || totalPlayers <= 1) {
                if (panel) panel.classList.remove('visible');
                return;
            }

            if (panel) {
                panel.classList.add('visible');
            }
            if (cardsContainer) cardsContainer.innerHTML = '';
            if (newCardsContainer) newCardsContainer.innerHTML = '';

            // No click delegate here — hovering an .opponent-scroll-card shows
            // the same enlarged preview as the floating Hand/Active/Common
            // panels (see js/scroll-panels.js's _initCardHoverPreview, which
            // delegates from document level so this needs no wiring here).

            // Build ordered list: self first, then others
            const playerOrder = [];
            playerOrder.push(myPlayerIndex);
            for (let i = 0; i < totalPlayers; i++) {
                if (i !== myPlayerIndex) playerOrder.push(i);
            }

            for (const i of playerOrder) {
                const isSelf = (i === myPlayerIndex);
                const playerData = allPlayersData.find(p => p.player_index === i);
                const playerName = getPlayerColorName(i);
                const playerColor = playerData ? PLAYER_COLORS[playerData.color] : '#666';
                const isActiveTurn = (i === activePlayerIndex);

                // Get player resources
                const pool = playerPools[i] || { earth: 0, water: 0, fire: 0, wind: 0, void: 0 };
                const ap = playerAPs[i] || { currentAP: 5, voidAP: 0 };
                const scrollData = spellSystem.playerScrolls[i] || { hand: new Set(), active: new Set(), activated: new Set() };

                const card = document.createElement('div');
                card.className = 'opponent-card' + (isActiveTurn ? ' active-turn' : '') + (isSelf ? ' self-card' : '');
                card.style.borderLeftColor = playerColor;
                card.dataset.playerIndex = i; // click = flash this player (PlayerFlash below)
                card.title = 'Click to show this player on the board';
                const look = window.ScrollLook;
                const ELS = ['earth', 'water', 'fire', 'wind', 'void'];
                const row = (label, html) => `<div class="opp-row"><span class="opp-label">${label}</span><span class="opp-value">${html}</span></div>`;

                // Header: name + AP (void AP as a small extra)
                const nameHtml = window.cosmeticsSystem?.seatNameHtml ? window.cosmeticsSystem.seatNameHtml(i) : playerName;
                const voidAp = ap.voidAP > 0 ? ` <span class="opp-void-ap" title="Void AP">+${ap.voidAP}<img src="${STONE_TYPES.void.img}" class="element-icon-sm" alt="void"></span>` : '';
                let html = `<div class="opponent-header">
                        <span class="opponent-name" style="color: ${playerColor};">${nameHtml}${isSelf ? ' <span class="opp-you">you</span>' : ''}</span>
                        <span class="opponent-ap">${ap.currentAP} AP${voidAp}</span>
                    </div>`;

                // Elements activated (public: the symbols on their shrine)
                const activated = scrollData.activated || new Set();
                html += row(`Won ${activated.size}/5`, ELS.map(el =>
                    `<img src="${STONE_TYPES[el].img}" class="element-icon-sm opp-pip${activated.has(el) ? ' on' : ''}" alt="${el}" title="${el.charAt(0).toUpperCase() + el.slice(1)}${activated.has(el) ? ' activated' : ''}">`).join(''));

                // Stones in their pool
                const stones = ELS.filter(el => pool[el] > 0).map(el =>
                    `<span class="opponent-stone" style="color:${STONE_TYPES[el].color}" title="${pool[el]} ${el} stone${pool[el] !== 1 ? 's' : ''}"><img src="${STONE_TYPES[el].img}" class="element-icon-sm" alt="${el}">${pool[el]}</span>`).join('');
                html += row('Stones', stones || '<span class="opp-none">none</span>');

                // Hand: count + each scroll's ELEMENT only (name/pattern stay
                // private, like a face-down card showing its suit). A catacomb
                // scroll in hand is a plain light-tan symbol: its two element
                // colors would tell others which catacomb scroll it is.
                const handNames = scrollData.hand ? [...scrollData.hand] : [];
                html += row(`Hand ${handNames.length}`, handNames.length
                    ? handNames.map(n => look ? look.iconHtml(spellSystem.getScrollElement(n) === 'catacomb' ? 'catacomb' : n, 'element-icon-sm opp-hand-icon') : '').join('')
                    : '<span class="opp-none">empty</span>');

                // Active scrolls (public): icon + name, hover = preview
                const activeNames = scrollData.active ? [...scrollData.active] : [];
                if (activeNames.length) {
                    html += row('Active', activeNames.map(n => {
                        const pattern = spellSystem.patterns[n];
                        return `<span class="opponent-scroll-card" data-scroll-name="${n}" title="${look ? look.label(n) : ''}: hover to preview">${look ? look.iconHtml(n) : ''}<span class="opponent-scroll-name" style="${look ? look.textStyle(n) : ''}">${pattern ? pattern.name : n}</span></span>`;
                    }).join(''));
                }
                card.innerHTML = html;

                if (cardsContainer) cardsContainer.appendChild(card);
                // Clone into new UI container — delegation listener on the container
                // handles clicks so no per-card event wiring is needed on the clone.
                if (newCardsContainer) newCardsContainer.appendChild(card.cloneNode(true));
            }

            // If no opponents to show
            if (cardsContainer && cardsContainer.children.length === 0) {
                cardsContainer.innerHTML = '<div style="color: #ccc; font-size: 12px; text-align: center;">Waiting for opponents...</div>';
            }
            if (newCardsContainer && newCardsContainer.children.length === 0) {
                newCardsContainer.innerHTML = '<div style="color: var(--text-muted); font-size: 12px; text-align: center; padding: 20px; opacity: 0.5;">Waiting for opponents...</div>';
            }

            // Update HUD
            if (typeof updateHUD === 'function') updateHUD();

            // Re-fit the Opponent Status panel to its (now different) card
            // count — js/scroll-panels.js's fitPanel() is a no-op when
            // autofit is off for it or it's collapsed, so always safe to call.
            window.ScrollPanelSystem?.fitPanel?.('opponents');
        }

        // Own scroll changes (draw, cast, discard) only refresh the floating
        // scroll panels, not this one, so the self card could say "Hand: 0"
        // while you held a scroll (owner, 2026-10-01). updateScrollCount()
        // calls this; several calls in one frame rebuild once.
        let _oppRefreshQueued = false;
        window.scheduleOpponentPanelRefresh = function () {
            if (_oppRefreshQueued) return;
            _oppRefreshQueued = true;
            requestAnimationFrame(() => { _oppRefreshQueued = false; try { updateOpponentPanel(); } catch (e) {} });
        };

        // Click a player's pawn, their player shrine, or their card in the
        // Opponent Status panel: all three briefly glow in that player's color.
        // A click is a press and release within 6 px and 500 ms, so dragging
        // a pawn never flashes.
        window.PlayerFlash = (function () {
            const MS = 1300;
            let down = null;
            function colorOf(i) {
                const pd = (typeof allPlayersData !== 'undefined' ? allPlayersData : []).find(p => p.player_index === i);
                return (pd && PLAYER_COLORS[pd.color]) || playerPositions[i]?.color || '#ffffff';
            }
            function pulse(el, color) {
                if (!el) return;
                el.classList.remove('player-flash');
                void el.getBoundingClientRect(); // restart the animation
                el.style.setProperty('--flash-color', color);
                el.classList.add('player-flash');
                clearTimeout(el._flashTimer);
                el._flashTimer = setTimeout(() => el.classList.remove('player-flash'), MS);
            }
            function flash(i) {
                if (typeof i !== 'number' || i < 0) return;
                const color = colorOf(i);
                pulse(playerPositions[i]?.element, color);
                const tile = placedTiles.find(t => t.isPlayerTile && t.playerIndex === i);
                pulse(tile?.element, color);
                document.querySelectorAll(`.opponent-card[data-player-index="${i}"]`).forEach(c => pulse(c, color));
            }
            function playerAt(target) {
                if (!target || !target.closest) return -1;
                const card = target.closest('.opponent-card[data-player-index]');
                if (card) return Number(card.dataset.playerIndex);
                const pawn = playerPositions.findIndex(p => p && p.element && p.element.contains(target));
                if (pawn >= 0) return pawn;
                const tile = placedTiles.find(t => t.isPlayerTile && t.element && t.element.contains(target));
                return tile && typeof tile.playerIndex === 'number' ? tile.playerIndex : -1;
            }
            document.addEventListener('pointerdown', e => {
                down = { x: e.clientX, y: e.clientY, t: Date.now(), target: e.target };
            }, true);
            document.addEventListener('pointerup', e => {
                const d = down; down = null;
                if (!d || Date.now() - d.t > 500 || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 6) return;
                if (d.target?.closest?.('.opponent-scroll-card')) return; // scroll chip = preview, not a flash
                const i = playerAt(d.target);
                if (i >= 0) flash(i);
            }, true);
            return { flash };
        })();

        function clearBoard(skipConfirm = false) {
            if (!skipConfirm && !confirm('Clear all tiles and stones from the board?')) {
                return;
            }
            
            placedTiles.forEach(tile => tile.element.remove());
            placedStones.forEach(stone => stone.element.remove());
            
            // Clear all player pawns
            playerPositions.forEach(player => {
                if (player && player.element) player.element.remove();
            });
            
            placedTiles = [];
            placedStones = [];
            playerPositions = [];
            activePlayerIndex = 0;
            // Reset ID counters so each new game starts from 1 (prevents cross-game ID drift).
            // Both clients must reset in sync — clearBoard is called from startMultiplayerGame
            // before any tile/stone placement, so this is safe.
            if (typeof nextTileId !== 'undefined') nextTileId = 1;
            if (typeof nextStoneId !== 'undefined') nextStoneId = 1;
            updateStatus('Board cleared');
        }

        // Event Handlers - Tile Deck
        deckTileSvg.addEventListener('mousedown', (e) => {
            if (e.button === 2) {
                e.preventDefault();
                isRotatingTile = true;
                rotateTileStartX = e.clientX;
                rotateTileStartRotation = currentRotation;
                return;
            }

            isDraggingTile = true;
            draggedTileId = null;
            draggedTileRotation = currentRotation;
            draggedTileFlipped = currentFlipped;
            draggedTileShrineType = null; // Draw from deck
            const { x: screenX, y: screenY } = getBoardScreenXY(e.clientX, e.clientY);
            const world = screenToWorld(screenX, screenY);

            ghostTile = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            ghostTile.setAttribute('class', 'ghost-tile');
            ghostTile.setAttribute('transform', `translate(${world.x}, ${world.y})`);
            const tile = createTileGroup(TILE_SIZE, currentRotation, currentFlipped);
            ghostTile.appendChild(tile);
            viewport.appendChild(ghostTile);
        });

        deckTileSvg.addEventListener('contextmenu', (e) => e.preventDefault());

        // Event Handlers - Stone Decks
        ['earth', 'water', 'fire', 'wind', 'void'].forEach(type => {
            const deckElement = document.getElementById(type + '-deck');

            // Mouse handler
            deckElement.addEventListener('mousedown', (e) => {
                if (stoneCounts[type] <= 0) return;

                isDraggingStone = true;
                draggedStoneId = null;
                draggedStoneType = type;

                const coords = getEventCoords(e);
                const { x: screenX, y: screenY } = getBoardScreenXY(coords.x, coords.y);
                const world = screenToWorld(screenX, screenY);

                ghostStone = document.createElementNS('http://www.w3.org/2000/svg', 'g');
                ghostStone.setAttribute('class', 'stone stone-ghost');
                ghostStone.setAttribute('transform', `translate(${world.x}, ${world.y})`);

                const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
                circle.setAttribute('cx', 0);
                circle.setAttribute('cy', 0);
                circle.setAttribute('r', STONE_SIZE);
                circle.setAttribute('class', 'stone-piece');
                circle.setAttribute('fill', STONE_TYPES[type].color);

                const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
                text.setAttribute('x', 0);
                text.setAttribute('y', 0);
                text.setAttribute('text-anchor', 'middle');
                text.setAttribute('dominant-baseline', 'middle');
                text.setAttribute('fill', '#fff');
                text.setAttribute('font-size', '14');
                text.setAttribute('font-weight', 'bold');
                text.textContent = STONE_TYPES[type].symbol;

                ghostStone.appendChild(circle);
                ghostStone.appendChild(text);
                viewport.appendChild(ghostStone);
            });

            // Touch handler
            deckElement.addEventListener('touchstart', (e) => {
                if (stoneCounts[type] <= 0) return;
                e.preventDefault();

                isDraggingStone = true;
                draggedStoneId = null;
                draggedStoneType = type;

                const coords = getEventCoords(e);
                const { x: screenX, y: screenY } = getBoardScreenXY(coords.x, coords.y);
                const world = screenToWorld(screenX, screenY);

                ghostStone = document.createElementNS('http://www.w3.org/2000/svg', 'g');
                ghostStone.setAttribute('class', 'stone stone-ghost');
                ghostStone.setAttribute('transform', `translate(${world.x}, ${world.y})`);

                const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
                circle.setAttribute('cx', 0);
                circle.setAttribute('cy', 0);
                circle.setAttribute('r', STONE_SIZE);
                circle.setAttribute('class', 'stone-piece');
                circle.setAttribute('fill', STONE_TYPES[type].color);

                const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
                text.setAttribute('x', 0);
                text.setAttribute('y', 0);
                text.setAttribute('text-anchor', 'middle');
                text.setAttribute('dominant-baseline', 'middle');
                text.setAttribute('fill', '#fff');
                text.setAttribute('font-size', '14');
                text.setAttribute('font-weight', 'bold');
                text.textContent = STONE_TYPES[type].symbol;

                ghostStone.appendChild(circle);
                ghostStone.appendChild(text);
                viewport.appendChild(ghostStone);
            }, { passive: false });
        });

        // Event Handlers - Board (throttled to animation frames)
        let pendingBoardMove = false;
        let lastBoardMove = null;
        boardSvg.addEventListener('mousemove', (e) => {
            lastBoardMove = { clientX: e.clientX, clientY: e.clientY };
            if (pendingBoardMove) return;
            pendingBoardMove = true;
            requestAnimationFrame(() => {
                pendingBoardMove = false;
                if (!lastBoardMove) return;

                const { x: screenX, y: screenY } = getBoardScreenXY(lastBoardMove.clientX, lastBoardMove.clientY);
                const world = screenToWorld(screenX, screenY);

                if (isDraggingTile && ghostTile) {
                    const isPlayerTile = (draggedTileShrineType === 'player');
                    const snapResult = findNearestSnapPoint(world.x, world.y, isPlayerTile);
                    ghostTile.setAttribute('transform', `translate(${snapResult.x}, ${snapResult.y})`);

                    if (snapResult.snapped) {
                        snapIndicator.setAttribute('cx', snapResult.x);
                        snapIndicator.setAttribute('cy', snapResult.y);
                        snapIndicator.classList.add('active');
                    } else {
                        snapIndicator.classList.remove('active');
                    }
                } else if (isDraggingStone && ghostStone) {
                    const stonePos = findValidStonePosition(world.x, world.y);
                    ghostStone.setAttribute('transform', `translate(${stonePos.x}, ${stonePos.y})`);

                    if (stonePos.valid) {
                        snapIndicator.setAttribute('cx', stonePos.x);
                        snapIndicator.setAttribute('cy', stonePos.y);
                        snapIndicator.classList.add('active');
                    } else {
                        snapIndicator.classList.remove('active');
                    }
                } else if (isDraggingPlayer && ghostPlayer) {
                    const tf = (typeof window !== 'undefined') ? window.takeFlightState : null;
                    const playerPos = findNearestHexPosition(world.x, world.y);

                    if (tf && tf.active) {
                        if (playerPos.valid) {
                            ghostPlayer.setAttribute('transform', `translate(${playerPos.x}, ${playerPos.y})`);
                            snapIndicator.setAttribute('cx', playerPos.x);
                            snapIndicator.setAttribute('cy', playerPos.y);
                            snapIndicator.classList.add('active');
                        } else {
                            snapIndicator.classList.remove('active');
                        }
                        tf.hoverPos = playerPos;
                        return;
                    }

                    // Prevent the ghost and path preview from moving "through" other players.
                    // If the nearest hex is occupied, clamp the ghost to the last valid path node.
                    if (playerPos.valid && isHexOccupiedByOtherPlayer(playerPos.x, playerPos.y)) {
                        const last = (playerPath && playerPath.length) ? playerPath[playerPath.length - 1] : playerPosition;
                        ghostPlayer.setAttribute('transform', `translate(${last.x}, ${last.y})`);
                        snapIndicator.classList.remove('active');
                        updateStatus('Blocked by another player');
                        return;
                    }

                    ghostPlayer.setAttribute('transform', `translate(${playerPos.x}, ${playerPos.y})`);

                    if (playerPos.valid) {
                        updatePlayerPath(playerPos.x, playerPos.y);

                        const totalCost = calculatePathCost();
                        const moveCheck = canPlayerMoveToHex(playerPos.x, playerPos.y);

                        if (moveCheck.canMove && totalCost <= getTotalAP()) {
                            snapIndicator.setAttribute('cx', playerPos.x);
                            snapIndicator.setAttribute('cy', playerPos.y);
                            snapIndicator.classList.add('active');
                        } else {
                            snapIndicator.classList.remove('active');
                        }

                        // Update status with path cost
                        updateStatus(`Path cost: ${totalCost} AP (${getTotalAP() - totalCost} remaining)`);
                    } else {
                        snapIndicator.classList.remove('active');
                    }
                }
            });
        });

        // Telekinesis carries a lone player along with the tile it moves
        // (same rule as Shifting Sands — see isTileEligibleForShiftingSands).
        // Call right AFTER placeTile() has moved the tile: `oldPos` is where
        // the tile (and its occupant) were, `newPos` is where it landed.
        // Returns the movedPlayers list for the telekinesis-move broadcast.
        function carryPlayersOnTelekinesisMove(oldPos, newPos) {
            const moved = [];
            if (!oldPos || !newPos || typeof playerPositions === 'undefined') return moved;
            const R = (typeof TILE_SIZE !== 'undefined' ? TILE_SIZE * 4 : 80);
            playerPositions.forEach((pos, idx) => {
                if (!pos) return;
                const d = Math.hypot(pos.x - oldPos.x, pos.y - oldPos.y);
                if (d >= R) return;
                if (typeof window.movePlayerVisually === 'function') window.movePlayerVisually(idx, newPos.x, newPos.y, 0);
                else { pos.x = newPos.x; pos.y = newPos.y; if (pos.element) pos.element.setAttribute('transform', `translate(${newPos.x}, ${newPos.y})`); }
                moved.push({ playerIndex: idx, newX: newPos.x, newY: newPos.y });
            });
            if (moved.length && typeof window.checkWinCondition === 'function') {
                try { window.checkWinCondition(moved[0].playerIndex, { announce: false }); } catch (e) {}
            }
            return moved;
        }

        document.addEventListener('mouseup', (e) => {
            if (e.button === 0) leftButtonDown = false;
            if (e.button === 2) rightButtonDown = false;

            if (isDraggingTile && ghostTile) {
                const { x: screenX, y: screenY } = getBoardScreenXY(e.clientX, e.clientY);
                const world = screenToWorld(screenX, screenY);

                const isPlayerTile = (draggedTileShrineType === 'player');
                const snapResult = findNearestSnapPoint(world.x, world.y, isPlayerTile, draggedTileId);
                if (snapResult.snapped) {
                    if (window.shouldDebugLog ? window.shouldDebugLog('placeTile', 500) : true) {
                        console.log(`📍 Placing tile: rotation=${draggedTileRotation}, flipped=${draggedTileFlipped}, shrine=${draggedTileShrineType}`);
                    }
                    const tileId = placeTile(snapResult.x, snapResult.y, draggedTileRotation, draggedTileFlipped, draggedTileShrineType, false, false, draggedTileId);
                    console.log(`   Tile placed with ID: ${tileId}`);
                    if (tileId !== null) window.SoundSystem?.play('placetile');

                    // If this was a player tile from the deck and it was successfully placed
                    if (draggedTileShrineType === 'player' && draggedTileId === null && tileId !== null) {
                        playerTilesAvailable--;
                        const countEl = document.getElementById('new-player-tile-count') || document.getElementById('player-tile-count');
                        if (countEl) countEl.textContent = playerTilesAvailable;

                        // Remove the first available player tile from the deck visually
                        if (playerTileElements.length > 0) {
                            const tileToRemove = playerTileElements.shift();
                            tileToRemove.remove();
                        }

                        // Broadcast player tile placement in multiplayer
                        if (isMultiplayer) {
                            broadcastGameAction('player-tile-place', {
                                x: snapResult.x,
                                y: snapResult.y,
                                playerIndex: myPlayerIndex,
                                color: playerColor,
                                cosmetics: window.cosmeticsSystem?.getEquippedAll() || null
                            });
                        }
                    }

                    // TELEKINESIS: track moves
                    const tkState = window.telekinesisState;
                    if (tkState && tkState.active && draggedTileId !== null && draggedTileOriginalPos) {
                        // Carry a lone player on the moved tile along with it.
                        const tkMovedPlayers = carryPlayersOnTelekinesisMove(
                            { x: draggedTileOriginalPos.x, y: draggedTileOriginalPos.y },
                            { x: snapResult.x, y: snapResult.y });
                        // Broadcast in multiplayer
                        if (isMultiplayer && typeof broadcastGameAction === 'function') {
                            broadcastGameAction('telekinesis-move', {
                                tileId: draggedTileId,
                                newPos: { x: snapResult.x, y: snapResult.y },
                                oldPos: { x: draggedTileOriginalPos.x, y: draggedTileOriginalPos.y },
                                movedPlayers: tkMovedPlayers
                            });
                        }

                        window.SoundSystem?.play('placetile');
                        tkState.movesLeft--;
                        tkState.movedTiles.push(draggedTileId);
                        console.log(`🔮 Telekinesis: ${tkState.maxMoves - tkState.movesLeft}/${tkState.maxMoves} moves`);

                        // Update Done button if present
                        const doneBtn = document.getElementById('telekinesis-done-btn');
                        if (doneBtn) {
                            const movesDone = tkState.maxMoves - tkState.movesLeft;
                            doneBtn.textContent = `Done (${movesDone}/${tkState.maxMoves})`;
                        }

                        updateStatus(`Telekinesis: tile moved! (${tkState.maxMoves - tkState.movesLeft}/${tkState.maxMoves})`);

                        // Refresh catacomb indicators
                        if (typeof updateCatacombIndicators === 'function') updateCatacombIndicators();

                        if (tkState.movesLeft <= 0) {
                            // All moves used — finish telekinesis
                            if (typeof window.finishTelekinesis === 'function') {
                                window.finishTelekinesis();
                            }
                        }
                    }
                } else if (draggedTileId !== null && draggedTileOriginalPos) {
                    // If this was a placed tile that couldn't be re-placed, restore it to its original position
                    const tkActive = window.telekinesisState && window.telekinesisState.active;
                    window.SoundSystem?.play('error');
                    updateStatus(tkActive
                        ? 'Invalid placement! Tiles must touch at least 2 other tiles. Tile snapped back.'
                        : 'Invalid placement! Tile snapped back to original position.');
                    placeTile(draggedTileOriginalPos.x, draggedTileOriginalPos.y, draggedTileRotation, draggedTileFlipped, draggedTileShrineType, false, false, draggedTileId);
                } else if (isPlayerTile) {
                    // Player tile couldn't be placed - show why
                    updateStatus('Player tiles must touch at least 2 unrevealed tiles!');
                }

                ghostTile.remove();
                ghostTile = null;
                window.TileMark?.clearFrom();
                isDraggingTile = false;
                draggedTileId = null;
                draggedTileOriginalPos = null;
                snapIndicator.classList.remove('active');
                if (typeof clearLegalPlacementHighlights === 'function') clearLegalPlacementHighlights();
            } else if (isDraggingStone && ghostStone) {
                const { x: screenX, y: screenY } = getBoardScreenXY(e.clientX, e.clientY);
                const world = screenToWorld(screenX, screenY);

                // Remove ghost FIRST — prevents orphaned ghost stamps if anything below throws
                ghostStone.remove();
                ghostStone = null;
                isDraggingStone = false;
                snapIndicator.classList.remove('active');

                const capturedStoneId = draggedStoneId;
                const capturedStoneType = draggedStoneType;
                const capturedOriginalPos = draggedStoneOriginalPos;
                draggedStoneId = null;
                draggedStoneType = null;
                draggedStoneOriginalPos = null;

                if (!tryReturnStoneToElementalPanel(e.clientX, e.clientY, capturedStoneId, capturedStoneType, capturedOriginalPos)) {
                    const stonePos = findValidStonePosition(world.x, world.y, capturedStoneType);
                    if (stonePos.valid) {
                        if (capturedStoneId === null) {
                            window._pendingFireDestroys = [];
                            const vapBeforePlace = voidAP;
                            const placedStoneId = placeStone(stonePos.x, stonePos.y, capturedStoneType);
                            window.SoundSystem?.play(capturedStoneType === 'earth' ? 'placeearthstone' : 'placestone');
                            // Track for undo: the id placeStone returned (nextStoneId - 1
                            // can be another stone once a moved stone bumped the counter)
                            lastMove = {
                                type: 'stone-place',
                                stoneId: placedStoneId,
                                x: stonePos.x,
                                y: stonePos.y,
                                element: capturedStoneType,
                                prevVoidAP: vapBeforePlace,
                                destroyedByFire: window._pendingFireDestroys
                            };
                            window._pendingFireDestroys = null;
                            window.lastScrollAction = null;
                            console.log(`📤 Placing stone from deck: type=${capturedStoneType}, before=${stoneCounts[capturedStoneType]}`);
                            stoneCounts[capturedStoneType]--;
                            console.log(`📤 After decrement: ${capturedStoneType}=${stoneCounts[capturedStoneType]}, playerPool.${capturedStoneType}=${playerPool[capturedStoneType]}`);
                            updateStoneCount(capturedStoneType);

                            // Sync resources after placing stone
                            syncPlayerState();
                            updateStatus('Placed ' + capturedStoneType + ' stone');
                        } else {
                            placeMovedStone(stonePos.x, stonePos.y, capturedStoneType, capturedStoneId);
                            // Moving a board stone (Breath of Power, Control the Current) can't be
                            // undone, and Undo must not reverse the step before it (undo fuzz test
                            // 2026-10-01: step next to stones, move them, Undo refunded the step).
                            if (!capturedOriginalPos || Math.hypot(stonePos.x - capturedOriginalPos.x, stonePos.y - capturedOriginalPos.y) > 5) clearUndo();
                            if (isMultiplayer) {
                                broadcastGameAction('stone-move', {
                                    stoneId: capturedStoneId,
                                    fromX: capturedOriginalPos?.x,
                                    fromY: capturedOriginalPos?.y,
                                    x: stonePos.x,
                                    y: stonePos.y,
                                    stoneType: capturedStoneType
                                });
                            }
                            updateStatus('Moved ' + capturedStoneType + ' stone');
                        }
                    } else {
                        if (capturedStoneId !== null) {
                            // Was a placed stone, couldn't place back
                            if (capturedOriginalPos) {
                                placeMovedStone(capturedOriginalPos.x, capturedOriginalPos.y, capturedStoneType, capturedStoneId);
                                window.SoundSystem?.play('error');
                                updateStatus('Invalid placement! Stone returned to original spot.');
                            } else {
                                returnStoneToPool(capturedStoneType);
                            }
                        }
                    }
                }
            } else if (isDraggingPlayer && ghostPlayer) {
                const tf = (typeof window !== 'undefined') ? window.takeFlightState : null;
                const { x: screenX, y: screenY } = getBoardScreenXY(e.clientX, e.clientY);
                const world = screenToWorld(screenX, screenY);

                const playerPos = findNearestHexPosition(world.x, world.y);
                const totalCost = calculatePathCost();
                const startPos = playerPath[0];

                if (tf && tf.active) {
                    const targetIndex = tf.targetPlayerIndex;
                    const destPos = playerPos && playerPos.valid ? { x: playerPos.x, y: playerPos.y } : null;
                    const origin = tf.startPos || startPos;

                    // Destination rule: unoccupied hex on a tile occupied by
                    // another player, never a player tile — see
                    // ScrollEffects.getValidTakeFlightDestinations() for the
                    // full definition (also used by the bot's take-flight driver).
                    const isValidDest = destPos && typeof window.spellSystem?.scrollEffects?.isValidTakeFlightDestination === 'function' &&
                        window.spellSystem.scrollEffects.isValidTakeFlightDestination(targetIndex, destPos.x, destPos.y);

                    if (!destPos || !isValidDest) {
                        updateStatus('Take Flight: must land on an unoccupied hex on a tile occupied by another player.');

                        if (origin) {
                            if (targetIndex === activePlayerIndex) {
                                placePlayer(origin.x, origin.y);
                            } else if (typeof movePlayerVisually === 'function') {
                                movePlayerVisually(targetIndex, origin.x, origin.y, 0);
                            }
                        }
                    } else {
                        if (targetIndex === activePlayerIndex) {
                            placePlayer(destPos.x, destPos.y);
                        } else if (typeof movePlayerVisually === 'function') {
                            movePlayerVisually(targetIndex, destPos.x, destPos.y, 0);
                        }

                        if (tf.onComplete) {
                            tf.onComplete(destPos.x, destPos.y);
                        }
                    }

                    ghostPlayer.remove();
                    ghostPlayer = null;
                    if (pathLine) {
                        pathLine.remove();
                        pathLine = null;
                    }
                    // Clean up path labels
                    pathCostLabels.forEach(label => label.remove());
                    pathCostLabels = [];
                    playerPath = [];
                    isDraggingPlayer = false;
                    snapIndicator.classList.remove('active');
                } else if (playerPos.valid && playerPath.length > 1) {

                    const finalPos = playerPath[playerPath.length - 1];
                    const moveCheck = canPlayerMoveToHex(finalPos.x, finalPos.y, true);

                    // Check if there's a stone at the final position that you CAN'T end turn on
                    const stoneAtFinal = placedStones.find(s => {
                        const dist = Math.sqrt(Math.pow(s.x - finalPos.x, 2) + Math.pow(s.y - finalPos.y, 2));
                        return dist < 5;
                    });

                    // Can't end turn on: earth, wind, water, fire
                    // CAN end turn on: void (or empty hex)
                    const cannotEndTurnHere = stoneAtFinal && stoneAtFinal.type !== 'void';

                    // Tutorial gate: only allow movement to the designated hex(es)
                    const tutorialBlocked = window.isTutorialMode && window.tutorialAllowedHexes &&
                        ![...window.tutorialAllowedHexes].some(key => {
                            const [ax, ay] = key.split(',').map(Number);
                            return Math.abs(ax - finalPos.x) < 70 && Math.abs(ay - finalPos.y) < 70;
                        });

                    // Tutorial gate: reject the whole move (not just the reveal) if
                    // it would step onto a still-hidden tile before the current
                    // step actually expects a flip — e.g. a Wind stone's free
                    // movement could otherwise walk the pawn onto unrevealed
                    // territory even though nothing there ever gets shown.
                    const tutorialFlipBlocked = window.isTutorialMode &&
                        window.TutorialMode?.isTileFlipExpected && !window.TutorialMode.isTileFlipExpected() &&
                        typeof pathHasHiddenTile === 'function' && pathHasHiddenTile(playerPath.slice(1));

                    if (cannotEndTurnHere) {
                        console.log(`❌ Movement rejected: Cannot end turn on ${stoneAtFinal.type} stone at (${finalPos.x.toFixed(1)}, ${finalPos.y.toFixed(1)})`);
                        placePlayer(startPos.x, startPos.y);
                        updateStatus('Cannot end movement on a ' + stoneAtFinal.type + ' stone!');
                    } else if (tutorialBlocked) {
                        placePlayer(startPos.x, startPos.y);
                        if (window.TutorialMode) window.TutorialMode.showMovementHint();
                    } else if (tutorialFlipBlocked) {
                        placePlayer(startPos.x, startPos.y);
                        alert("Sorry, we can't let you do that yet, it breaks the tutorial!");
                    } else if (moveCheck.canMove && totalCost <= getTotalAP()) {
                        console.log(`✅ Movement successful: ${playerPath.length - 1} hexes, cost ${totalCost} AP`);
                        // Store the last move for undo (snapshot AP before spending)
                        lastMove = {
                            type: 'move',
                            prevPos: { x: startPos.x, y: startPos.y },
                            prevCurrentAP: currentAP,
                            prevVoidAP: voidAP
                        };
                        window.lastScrollAction = null;
                        // If any step in the path passed through a wind stone (cost 0), fire the wind ability sound
                        if (playerPath.slice(1).some(step => step.cost === 0)) {
                            window.SoundSystem?.play('windactivates');
                            if (window.isTutorialMode && window.TutorialMode?.onWindStoneUsed) {
                                window.TutorialMode.onWindStoneUsed();
                            }
                        }
                        // One footstep per non-wind step (cost > 0)
                        playFootsteps(playerPath.slice(1).filter(step => step.cost > 0).length);
                        placePlayer(finalPos.x, finalPos.y);
                        // Notify tutorial that the player has moved
                        if (window.isTutorialMode && window.TutorialMode?.onPlayerMoved) {
                            window.TutorialMode.onPlayerMoved(finalPos.x, finalPos.y);
                        }
                        // Update Steam Vents alternation state before spending AP
                        if (typeof commitSteamVentsState === 'function') commitSteamVentsState(playerPath);
                        spendAP(totalCost); // Use void AP first, then regular AP

                        // Broadcast player movement to other players
                        broadcastGameAction('player-move', {
                            playerIndex: activePlayerIndex,
                            x: finalPos.x,
                            y: finalPos.y,
                            apSpent: totalCost,
                            cosmetics: window.cosmeticsSystem?.getEquippedAll() || null
                        });

                        // Check if the path stepped on any hidden tile - reveal it!
                        // Walk every hex actually crossed (not just where the
                        // pawn stopped) so a tile the path merely passed
                        // through on the way to an already-revealed tile
                        // still flips. playerPath[0] is the origin hex, so
                        // skip it — everything after is a hex stepped onto.
                        const revealedAlongPath = revealFlippedTilesAlongPath(playerPath.slice(1));
                        if (revealedAlongPath === 0) {
                            updateStatus(`Moved ${playerPath.length - 1} hexes (cost: ${totalCost} AP, ${getTotalAP()} AP remaining)`);
                        }
                    } else if (!moveCheck.canMove) {
                        console.log(`❌ Movement rejected: Path blocked at (${finalPos.x.toFixed(1)}, ${finalPos.y.toFixed(1)})`);
                        placePlayer(startPos.x, startPos.y);
                        window.SoundSystem?.play('error');
                        updateStatus('Cannot move there!');
                    } else {
                        console.log(`❌ Movement rejected: Insufficient AP (need ${totalCost}, have ${getTotalAP()})`);
                        placePlayer(startPos.x, startPos.y);
                        window.SoundSystem?.play('error');
                        updateStatus(`Not enough AP! (need ${totalCost}, have ${getTotalAP()})`);
                    }
                } else {
                    placePlayer(startPos.x, startPos.y);
                }

                ghostPlayer.remove();
                ghostPlayer = null;
                if (pathLine) {
                    pathLine.remove();
                    pathLine = null;
                }
                // Clean up path labels
                pathCostLabels.forEach(label => label.remove());
                pathCostLabels = [];
                playerPath = [];
                isDraggingPlayer = false;
                snapIndicator.classList.remove('active');
            }

            if (isPanning) {
                isPanning = false;
                endFastPan();
                boardSvg.style.cursor = 'grab';
            }
            if (isRotatingBoard) {
                isRotatingBoard = false;
                boardSvg.style.cursor = 'grab';
            }
            if (isRotatingTile) {
                isRotatingTile = false;
            }
        });

        // Clean up ghost when mouse leaves the board
        boardSvg.addEventListener('mouseleave', () => {
            snapIndicator.classList.remove('active');
        });

        // Touch event support for mobile
        
        // Touch handlers extracted for reuse (board + document)
        let touchStartWorldPos = null; // Store world position for tap-to-move

        function handleBoardTouchStart(e) {
            touchStartTime = Date.now();
            const coords = getEventCoords(e);
            touchStartPos = { x: coords.x, y: coords.y };

            // Store world position for potential tap-to-move
            if (e.touches.length === 1) {
                const { x: screenX, y: screenY } = getBoardScreenXY(coords.x, coords.y);
                touchStartWorldPos = screenToWorld(screenX, screenY);
            }

            // Single-finger pan (only when not interacting with a tile/player/stone)
            if (e.touches.length === 1 && !isDraggingTile && !isDraggingStone && !isDraggingPlayer) {
                const targetClass = e.target?.getAttribute && e.target.getAttribute('class');
                const isStone = targetClass && (targetClass.includes('stone') || e.target.closest('.stone'));
                const isPlayer = targetClass && (targetClass.includes('player') || e.target.closest('.player'));
                const isTile = e.target && (e.target.closest('.placed-tile') || e.target.closest('.tile'));
                if (!isStone && !isPlayer && !isTile) {
                    e.preventDefault();
                    isPanning = true;
                    beginFastPan(); // move the painted board, no repaint per frame (game-core.js)
                    panStartX = coords.x;
                    panStartY = coords.y;
                    lastPanX = viewportX;
                    lastPanY = viewportY;
                    boardSvg.style.cursor = 'grabbing';
                }
            }


            if (e.touches.length === 2 && !isDraggingTile && !isDraggingPlayer) {
                // Two-finger pinch zoom / pan (board)
                e.preventDefault();
                isPinching = true;
                isGestureRotating = false;

                const dx = e.touches[1].clientX - e.touches[0].clientX;
                const dy = e.touches[1].clientY - e.touches[0].clientY;
                pinchStartDist = Math.hypot(dx, dy) || 1;
                pinchStartScale = viewportScale;

                const midX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
                const midY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
                pinchStartMid = { x: midX, y: midY };
                pinchLastMid = { x: midX, y: midY };
            }
        
        }

        function handleBoardTouchMove(e) {
            e.preventDefault(); // Prevent scrolling

            if (e.touches.length === 2 && isPinching) {
                // Pinch zoom / pan board
                const dx = e.touches[1].clientX - e.touches[0].clientX;
                const dy = e.touches[1].clientY - e.touches[0].clientY;
                const dist = Math.hypot(dx, dy) || 1;

                // Midpoint pan
                const midX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
                const midY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
                const midDeltaX = midX - pinchLastMid.x;
                const midDeltaY = midY - pinchLastMid.y;
                pinchLastMid = { x: midX, y: midY };

                // Apply pan in world space
                viewportX += midDeltaX / viewportScale;
                viewportY += midDeltaY / viewportScale;

                // Apply zoom anchored near screen midpoint (approx)
                let newScale = pinchStartScale * (dist / pinchStartDist);
                newScale = Math.max(0.25, Math.min(3.0, newScale));

                const centerX = boardSvg.clientWidth / 2;
                const centerY = boardSvg.clientHeight / 2;

                // Keep pinch midpoint roughly stable during zoom
                const k = (1 / viewportScale) - (1 / newScale);
                viewportX += (midX - centerX) * k;
                viewportY += (midY - centerY) * k;

                viewportScale = newScale;
                updateViewport();
                return;
            }

            else if (e.touches.length === 1) {
                // Single touch - pan or drag
                if (isPanning && !isDraggingTile && !isDraggingStone && !isDraggingPlayer) {
                    const dx = e.touches[0].clientX - panStartX;
                    const dy = e.touches[0].clientY - panStartY;
                    const rad = -viewportRotation * Math.PI / 180;
                    const cos = Math.cos(rad);
                    const sin = Math.sin(rad);
                    const rotatedDx = dx * cos - dy * sin;
                    const rotatedDy = dx * sin + dy * cos;
                    viewportX = lastPanX + rotatedDx;
                    viewportY = lastPanY + rotatedDy;
                    updateViewport();
                    return;
                }
                // Single touch - handle drag
                const { x: screenX, y: screenY } = getBoardScreenXY(e.touches[0].clientX, e.touches[0].clientY);
                const world = screenToWorld(screenX, screenY);

                if (isDraggingTile && ghostTile) {
                    const isPlayerTile = (draggedTileShrineType === 'player');
                    const snapResult = findNearestSnapPoint(world.x, world.y, isPlayerTile);
                    ghostTile.setAttribute('transform', `translate(${snapResult.x}, ${snapResult.y})`);

                    if (snapResult.snapped) {
                        snapIndicator.setAttribute('cx', snapResult.x);
                        snapIndicator.setAttribute('cy', snapResult.y);
                        snapIndicator.classList.add('active');
                    } else {
                        snapIndicator.classList.remove('active');
                    }
                } else if (isDraggingStone && ghostStone) {
                    const stonePos = findValidStonePosition(world.x, world.y);
                    ghostStone.setAttribute('transform', `translate(${stonePos.x}, ${stonePos.y})`);

                    if (stonePos.valid) {
                        snapIndicator.setAttribute('cx', stonePos.x);
                        snapIndicator.setAttribute('cy', stonePos.y);
                        snapIndicator.classList.add('active');
                    } else {
                        snapIndicator.classList.remove('active');
                    }
                    // Touch keeps firing on its original target (boardSvg) even
                    // once the finger moves over the panel, unlike mousemove.
                    updateStoneReturnHighlight(e.touches[0].clientX, e.touches[0].clientY, draggedStoneType);
                } else if (isDraggingPlayer && ghostPlayer) {
                    const tf = (typeof window !== 'undefined') ? window.takeFlightState : null;
                    const playerPos = findNearestHexPosition(world.x, world.y);

                    if (tf && tf.active) {
                        if (playerPos.valid) {
                            ghostPlayer.setAttribute('transform', `translate(${playerPos.x}, ${playerPos.y})`);
                            snapIndicator.setAttribute('cx', playerPos.x);
                            snapIndicator.setAttribute('cy', playerPos.y);
                            snapIndicator.classList.add('active');
                        } else {
                            snapIndicator.classList.remove('active');
                        }
                        tf.hoverPos = playerPos;
                        return;
                    }

                    ghostPlayer.setAttribute('transform', `translate(${playerPos.x}, ${playerPos.y})`);

                    if (playerPos.valid) {
                        updatePlayerPath(playerPos.x, playerPos.y);

                        const totalCost = calculatePathCost();
                        const moveCheck = canPlayerMoveToHex(playerPos.x, playerPos.y);

                        if (moveCheck.canMove && totalCost <= getTotalAP()) {
                            snapIndicator.setAttribute('cx', playerPos.x);
                            snapIndicator.setAttribute('cy', playerPos.y);
                            snapIndicator.classList.add('active');
                        } else {
                            snapIndicator.classList.remove('active');
                        }

                        updateStatus(`Path cost: ${totalCost} AP (${getTotalAP() - totalCost} remaining)`);
                    } else {
                        snapIndicator.classList.remove('active');
                    }
                }
            }
        
        }

        function handleBoardTouchEnd(e) {
            const touchDuration = Date.now() - touchStartTime;
            const coords = e.changedTouches[0];
            const { x: screenX, y: screenY } = getBoardScreenXY(coords.clientX, coords.clientY);

            // Check if this was a tap (short touch without much movement)
            const distMoved = Math.sqrt(
                Math.pow(coords.clientX - touchStartPos.x, 2) +
                Math.pow(coords.clientY - touchStartPos.y, 2)
            );
            const isTap = touchDuration < 300 && distMoved < 10;

            if (isPanning) {
                isPanning = false;
                endFastPan();
                boardSvg.style.cursor = 'grab';
            }

            // TAP-TO-MOVE: If tapped on a valid hex and not doing anything else, move player there
            console.log(`📱 Tap-to-move check: isTap=${isTap}, isDraggingTile=${isDraggingTile}, isDraggingStone=${isDraggingStone}, isDraggingPlayer=${isDraggingPlayer}, ghostTile=${!!ghostTile}, ghostStone=${!!ghostStone}, playerPosition=${!!playerPosition}, canTakeAction=${canTakeAction()}`);
            if (isTap && !isDraggingTile && !isDraggingStone && !isDraggingPlayer && !ghostTile && !ghostStone && playerPosition && canTakeAction()) {
                const world = screenToWorld(screenX, screenY);
                const targetHex = findNearestHexPosition(world.x, world.y);
                console.log(`📱 Tap target: world=(${world.x.toFixed(1)}, ${world.y.toFixed(1)}), targetHex valid=${targetHex.valid}`);

                if (targetHex.valid) {
                    // Check if we tapped on the player's current position (within small radius)
                    const distFromPlayer = Math.sqrt(
                        Math.pow(targetHex.x - playerPosition.x, 2) +
                        Math.pow(targetHex.y - playerPosition.y, 2)
                    );

                    if (distFromPlayer > 5) { // Not tapping on current position
                        // Calculate path cost using simple distance (1 AP per hex)
                        const hexDist = Math.round(distFromPlayer / 17.3); // Approximate hex distance
                        const pathCost = Math.max(1, hexDist);

                        // Check if move is valid
                        const moveCheck = canPlayerMoveToHex(targetHex.x, targetHex.y, true);

                        // Check for stone at destination
                        const stoneAtTarget = placedStones.find(s => {
                            const dist = Math.sqrt(Math.pow(s.x - targetHex.x, 2) + Math.pow(s.y - targetHex.y, 2));
                            return dist < 5;
                        });
                        const cannotEndTurnHere = stoneAtTarget && stoneAtTarget.type !== 'void';

                        // Compute the actual path early (used both for the reveal
                        // walk below and the tutorial flip-block check) — the
                        // same shortest-path search the drag-path uses, so a
                        // tile merely passed through still counts.
                        const startPosForPath = { x: playerPosition.x, y: playerPosition.y };
                        const tapPath = _dijkstraPath(startPosForPath, targetHex);

                        const tutorialFlipBlocked = window.isTutorialMode &&
                            window.TutorialMode?.isTileFlipExpected && !window.TutorialMode.isTileFlipExpected() &&
                            typeof pathHasHiddenTile === 'function' && pathHasHiddenTile(tapPath ? tapPath.slice(1) : []);

                        if (cannotEndTurnHere) {
                            updateStatus('Cannot end movement on a ' + stoneAtTarget.type + ' stone!');
                        } else if (!moveCheck.canMove) {
                            updateStatus(moveCheck.reason || 'Cannot move there');
                        } else if (pathCost > getTotalAP()) {
                            updateStatus(`Not enough AP (need ~${pathCost}, have ${getTotalAP()})`);
                        } else if (tutorialFlipBlocked) {
                            alert("Sorry, we can't let you do that yet, it breaks the tutorial!");
                        } else {
                            // Calculate actual path cost by building path
                            const startPos = startPosForPath;
                            const actualCost = calculateTapMoveCost(startPos, targetHex);

                            if (actualCost > 0 && actualCost <= getTotalAP()) {
                                console.log(`📱 Tap-to-move: from (${startPos.x.toFixed(1)}, ${startPos.y.toFixed(1)}) to (${targetHex.x.toFixed(1)}, ${targetHex.y.toFixed(1)}), cost=${actualCost}`);

                                // Store for undo (snapshot AP before spending)
                                lastMove = {
                                    type: 'move',
                                    prevPos: { x: startPos.x, y: startPos.y },
                                    prevCurrentAP: currentAP,
                                    prevVoidAP: voidAP
                                };
                                window.lastScrollAction = null;
                                window.SoundSystem?.playFootstep();
                                placePlayer(targetHex.x, targetHex.y);
                                spendAP(actualCost);

                                // Broadcast in multiplayer
                                if (isMultiplayer) {
                                    broadcastGameAction('player-move', {
                                        playerIndex: activePlayerIndex,
                                        x: targetHex.x,
                                        y: targetHex.y,
                                        apSpent: actualCost
                                    });
                                }

                                // Check for hidden tile reveal — walk every hex the
                                // path actually crosses (not just the destination),
                                // so a tile merely passed through still flips.
                                const revealedAlongPath = revealFlippedTilesAlongPath(tapPath ? tapPath.slice(1) : []);

                                if (revealedAlongPath === 0) {
                                    updateStatus(`Moved (cost: ${actualCost} AP, ${getTotalAP()} AP remaining)`);
                                }
                            } else if (actualCost <= 0) {
                                updateStatus('No valid path to that hex');
                            } else {
                                updateStatus(`Not enough AP (need ${actualCost}, have ${getTotalAP()})`);
                            }
                        }
                    }
                }
            }

            if (isTap && isDraggingTile && ghostTile) {
                // Tap to flip
                draggedTileFlipped = !draggedTileFlipped;

                // Regenerate ghost tile with new flip state
                const oldTransform = ghostTile.getAttribute('transform');
                const translateMatch = oldTransform?.match(/translate\(([^,]+),\s*([^)]+)\)/);
                const currentX = translateMatch ? parseFloat(translateMatch[1]) : 0;
                const currentY = translateMatch ? parseFloat(translateMatch[2]) : 0;

                viewport.removeChild(ghostTile);
                ghostTile = createTileGroup(draggedTileRotation, draggedTileFlipped, draggedTileShrineType);
                ghostTile.classList.add('ghost-tile');
                ghostTile.setAttribute('transform', `translate(${currentX}, ${currentY})`);
                viewport.appendChild(ghostTile);
            } else {
                // Handle drop (same logic as mouseup)
                const world = screenToWorld(screenX, screenY);

                if (isDraggingTile && ghostTile) {
                    const isPlayerTile = (draggedTileShrineType === 'player');
                    const snapResult = findNearestSnapPoint(world.x, world.y, isPlayerTile, draggedTileId);
                    if (snapResult.snapped) {
                        console.log(`Placing tile: rotation=${draggedTileRotation}, flipped=${draggedTileFlipped}, shrine=${draggedTileShrineType}`);
                        const tileId = placeTile(snapResult.x, snapResult.y, draggedTileRotation, draggedTileFlipped, draggedTileShrineType, false, false, draggedTileId);

                        if (draggedTileShrineType === 'player' && draggedTileId === null && tileId !== null) {
                            playerTilesAvailable--;
                            const countEl = document.getElementById('new-player-tile-count') || document.getElementById('player-tile-count');
                            if (countEl) countEl.textContent = playerTilesAvailable;
                            if (isMobile) document.getElementById('mobile-tile-count').textContent = playerTilesAvailable;

                            if (playerTileElements.length > 0) {
                                const tileToRemove = playerTileElements.shift();
                                tileToRemove.remove();
                            }

                            if (isMultiplayer) {
                                // Broadcast for other clients to place the player tile visually.
                                broadcastGameAction('player-tile-place', {
                                    x: snapResult.x,
                                    y: snapResult.y,
                                    playerIndex: myPlayerIndex,
                                    color: playerColor,
                                    cosmetics: window.cosmeticsSystem?.getEquippedAll() || null
                                });
                            }
                        }

                        // TELEKINESIS: track moves and move players with tiles (touch handler)
                        const tkStateTouch = window.telekinesisState;
                        if (tkStateTouch && tkStateTouch.active && draggedTileId !== null && draggedTileOriginalPos) {
                            const tkMovedPlayersTouch = carryPlayersOnTelekinesisMove(
                                { x: draggedTileOriginalPos.x, y: draggedTileOriginalPos.y },
                                { x: snapResult.x, y: snapResult.y });
                            if (isMultiplayer && typeof broadcastGameAction === 'function') {
                                broadcastGameAction('telekinesis-move', {
                                    tileId: draggedTileId,
                                    newPos: { x: snapResult.x, y: snapResult.y },
                                    oldPos: { x: draggedTileOriginalPos.x, y: draggedTileOriginalPos.y },
                                    movedPlayers: tkMovedPlayersTouch
                                });
                            }
                            window.SoundSystem?.play('placetile');
                            tkStateTouch.movesLeft--;
                            tkStateTouch.movedTiles.push(draggedTileId);
                            const doneBtnT = document.getElementById('telekinesis-done-btn');
                            if (doneBtnT) doneBtnT.textContent = `Done (${tkStateTouch.maxMoves - tkStateTouch.movesLeft}/${tkStateTouch.maxMoves})`;
                            updateStatus(`Telekinesis: tile moved! (${tkStateTouch.maxMoves - tkStateTouch.movesLeft}/${tkStateTouch.maxMoves})`);
                            if (typeof updateCatacombIndicators === 'function') updateCatacombIndicators();
                            if (tkStateTouch.movesLeft <= 0 && typeof window.finishTelekinesis === 'function') {
                                window.finishTelekinesis();
                            }
                        } else if (draggedTileId !== null) {
                            // Moving already-placed non-player tiles is not synced in multiplayer; revert to avoid desync.
                            if (isMultiplayer && draggedTileOriginalPos) {
                                updateStatus('Tiles cannot be moved in multiplayer.');
                                placeTile(draggedTileOriginalPos.x, draggedTileOriginalPos.y, draggedTileRotation, draggedTileFlipped, draggedTileShrineType, false, false, draggedTileId);
                            }
                        }
                    } else if (draggedTileOriginalPos && draggedTileId !== null) {
                        const tkActiveTouch = window.telekinesisState && window.telekinesisState.active;
                        updateStatus(tkActiveTouch
                            ? 'Invalid placement! Tiles must touch at least 2 other tiles. Tile snapped back.'
                            : 'Invalid placement! Tile snapped back to original position.');
                        placeTile(draggedTileOriginalPos.x, draggedTileOriginalPos.y, draggedTileRotation, draggedTileFlipped, draggedTileShrineType, false, false, draggedTileId);
                    } else if (draggedTileShrineType === 'player') {
                        updateStatus('Player tiles must touch 2+ adjacent unrevealed tiles');
                    }

                    viewport.removeChild(ghostTile);
                    ghostTile = null;
                    window.TileMark?.clearFrom();
                    isDraggingTile = false;
                    draggedTileId = null;
                    draggedTileOriginalPos = null;
                    snapIndicator.classList.remove('active');
                    if (typeof clearLegalPlacementHighlights === 'function') clearLegalPlacementHighlights();
                } else if (isDraggingStone && ghostStone) {
                    // Remove ghost FIRST — prevents orphaned ghost stamps if anything below throws
                    viewport.removeChild(ghostStone);
                    ghostStone = null;
                    isDraggingStone = false;
                    snapIndicator.classList.remove('active');

                    const capturedStoneId = draggedStoneId;
                    const capturedStoneType = draggedStoneType;
                    const capturedOriginalPos = draggedStoneOriginalPos;
                    draggedStoneId = null;
                    draggedStoneType = null;
                    draggedStoneOriginalPos = null;

                    if (!tryReturnStoneToElementalPanel(coords.clientX, coords.clientY, capturedStoneId, capturedStoneType, capturedOriginalPos)) {
                        const stonePos = findValidStonePosition(world.x, world.y, capturedStoneType);
                        if (stonePos.valid && capturedStoneId === null) {
                            placeStone(stonePos.x, stonePos.y, capturedStoneType);
                            window.SoundSystem?.play(capturedStoneType === 'earth' ? 'placeearthstone' : 'placestone');
                            stoneCounts[capturedStoneType]--;
                            updateStoneCount(capturedStoneType);
                            syncPlayerState();
                            // Note: placeStone already calls broadcastGameAction('stone-place', ...) internally.
                        } else if (stonePos.valid) {
                            // A board stone moved (same as the mouse path): broadcast the
                            // move with its old position. It used to be placed as a NEW
                            // stone, leaving the old one on every other board.
                            placeMovedStone(stonePos.x, stonePos.y, capturedStoneType, capturedStoneId);
                            // Moving a board stone (Breath of Power, Control the Current) can't be
                            // undone, and Undo must not reverse the step before it (undo fuzz test
                            // 2026-10-01: step next to stones, move them, Undo refunded the step).
                            if (!capturedOriginalPos || Math.hypot(stonePos.x - capturedOriginalPos.x, stonePos.y - capturedOriginalPos.y) > 5) clearUndo();
                            if (isMultiplayer) {
                                broadcastGameAction('stone-move', {
                                    stoneId: capturedStoneId,
                                    fromX: capturedOriginalPos?.x,
                                    fromY: capturedOriginalPos?.y,
                                    x: stonePos.x,
                                    y: stonePos.y,
                                    stoneType: capturedStoneType
                                });
                            }
                            updateStatus('Moved ' + capturedStoneType + ' stone');
                        } else if (capturedStoneId !== null && capturedOriginalPos) {
                            // Invalid spot: the board stone goes back where it was.
                            placeMovedStone(capturedOriginalPos.x, capturedOriginalPos.y, capturedStoneType, capturedStoneId);
                            window.SoundSystem?.play('error');
                            updateStatus('Invalid placement! Stone returned to original spot.');
                        }
                    }
                } else if (isDraggingPlayer && ghostPlayer) {
                    const tf = (typeof window !== 'undefined') ? window.takeFlightState : null;
                    const playerPos = findNearestHexPosition(world.x, world.y);
                    const startPos = playerPath[0];
                    let movementSuccessful = false;

                    if (tf && tf.active) {
                        const targetIndex = tf.targetPlayerIndex;
                        const destPos = playerPos && playerPos.valid ? { x: playerPos.x, y: playerPos.y } : null;
                        const origin = tf.startPos || startPos;

                        const hasStone = destPos && placedStones.some(s => {
                            const dist = Math.sqrt(Math.pow(s.x - destPos.x, 2) + Math.pow(s.y - destPos.y, 2));
                            return dist < 5;
                        });
                        const hasPlayer = destPos && playerPositions.some((p, idx) => {
                            if (!p) return false;
                            if (idx === targetIndex) return false;
                            const dist = Math.sqrt(Math.pow(p.x - destPos.x, 2) + Math.pow(p.y - destPos.y, 2));
                            return dist < 5;
                        });
                        // A teleport may not land on a face-down tile — it
                        // doesn't reveal it, so ending there is illegal.
                        const onFlipped = destPos && typeof isPositionOnFlippedTile === 'function' &&
                            isPositionOnFlippedTile(destPos.x, destPos.y, getAllHexagonPositions());

                        if (!destPos || hasStone || hasPlayer || onFlipped) {
                            if (hasStone) updateStatus('Take Flight: cannot teleport onto a stone.');
                            else if (hasPlayer) updateStatus('Take Flight: another player is in the way.');
                            else if (onFlipped) updateStatus('Take Flight: cannot teleport onto a face-down tile.');
                            else updateStatus('Take Flight: invalid destination.');

                            if (origin) {
                                if (targetIndex === activePlayerIndex) {
                                    placePlayer(origin.x, origin.y);
                                } else if (typeof movePlayerVisually === 'function') {
                                    movePlayerVisually(targetIndex, origin.x, origin.y, 0);
                                }
                            }
                        } else {
                            if (targetIndex === activePlayerIndex) {
                                placePlayer(destPos.x, destPos.y);
                            } else if (typeof movePlayerVisually === 'function') {
                                movePlayerVisually(targetIndex, destPos.x, destPos.y, 0);
                            }

                            if (tf.onComplete) {
                                tf.onComplete(destPos.x, destPos.y);
                            }
                        }
                    } else if (playerPath.length > 1 && playerPos.valid) {
                        const totalCost = calculatePathCost();
                        const finalPos = playerPath[playerPath.length - 1];
                        const moveCheck = canPlayerMoveToHex(finalPos.x, finalPos.y, true);

                        // Check if there's a stone at the final position that you CAN'T end turn on
                        const stoneAtFinal = placedStones.find(s => {
                            const dist = Math.sqrt(Math.pow(s.x - finalPos.x, 2) + Math.pow(s.y - finalPos.y, 2));
                            return dist < 5;
                        });
                        const cannotEndTurnHere = stoneAtFinal && stoneAtFinal.type !== 'void';

                        // Tutorial gate: reject the whole move if it would step onto
                        // a still-hidden tile before the current step expects a flip
                        // — see the drag-handler's own copy of this check above.
                        const tutorialFlipBlocked = window.isTutorialMode &&
                            window.TutorialMode?.isTileFlipExpected && !window.TutorialMode.isTileFlipExpected() &&
                            typeof pathHasHiddenTile === 'function' && pathHasHiddenTile(playerPath.slice(1));

                        if (cannotEndTurnHere) {
                            updateStatus('Cannot end movement on a ' + stoneAtFinal.type + ' stone!');
                        } else if (!moveCheck.canMove) {
                            updateStatus(moveCheck.reason || 'Cannot move to this position');
                        } else if (totalCost > getTotalAP()) {
                            updateStatus(`Not enough AP (need ${totalCost}, have ${getTotalAP()})`);
                        } else if (tutorialFlipBlocked) {
                            alert("Sorry, we can't let you do that yet, it breaks the tutorial!");
                        } else {
                            // Store the last move for undo (snapshot AP before spending)
                            lastMove = {
                                type: 'move',
                                prevPos: { x: startPos.x, y: startPos.y },
                                prevCurrentAP: currentAP,
                                prevVoidAP: voidAP
                            };
                            window.lastScrollAction = null;
                            // One footstep per non-wind step (cost > 0)
                            playFootsteps(playerPath.slice(1).filter(step => step.cost > 0).length);
                            placePlayer(finalPos.x, finalPos.y);
                            spendAP(totalCost);
                            movementSuccessful = true;

                            // Broadcast player movement to other players
                            if (isMultiplayer) {
                                broadcastGameAction('player-move', {
                                    playerIndex: activePlayerIndex,
                                    x: finalPos.x,
                                    y: finalPos.y,
                                    apSpent: totalCost,
                                    cosmetics: window.cosmeticsSystem?.getEquippedAll() || null
                                });
                            }

                            // Check if the path stepped on any hidden tile - reveal it!
                            // Walk every hex actually crossed, not just where the pawn
                            // stopped (playerPath[0] is the origin, so skip it).
                            revealFlippedTilesAlongPath(playerPath.slice(1));
                        }
                    }

                    // If movement failed or was cancelled, restore player to start position
                    if (!movementSuccessful && startPos) {
                        placePlayer(startPos.x, startPos.y);
                    }

                    if (ghostPlayer) {
                        viewport.removeChild(ghostPlayer);
                        ghostPlayer = null;
                    }
                    clearPlayerPath();
                    isDraggingPlayer = false;
                    snapIndicator.classList.remove('active');
                }
            }

            isGestureRotating = false;
            isPinching = false;
            initialTouches = [];
        
        }

boardSvg.addEventListener('touchstart', handleBoardTouchStart, { passive: false });

        boardSvg.addEventListener('touchmove', handleBoardTouchMove, { passive: false });

        boardSvg.addEventListener('touchend', handleBoardTouchEnd, { passive: false });
        // Ensure deck-origin drags keep updating even when touch target isn't the board SVG
        document.addEventListener('touchmove', (e) => {
            if (isDraggingTile || isDraggingPlayer || isDraggingStone || isPanning || isPinching) {
                handleBoardTouchMove(e);
            }
        }, { passive: false });

        document.addEventListener('touchend', (e) => {
            if (isDraggingTile || isDraggingPlayer || isDraggingStone || isPanning || isPinching) {
                handleBoardTouchEnd(e);
            }
        }, { passive: false });

        document.addEventListener('touchcancel', (e) => {
            if (isDraggingTile || isDraggingPlayer || isDraggingStone || isPanning || isPinching) {
                handleBoardTouchEnd(e);
            }
        }, { passive: false });


        boardSvg.addEventListener('mousedown', (e) => {
            if (window.shouldDebugLog ? window.shouldDebugLog('boardMouseDown', 300) : true) {
                console.log(`🖱️ boardSvg mousedown: button=${e.button}, shift=${e.shiftKey}, target=${e.target.tagName}`);
            }

            if (e.button === 0) leftButtonDown = true;
            if (e.button === 2) rightButtonDown = true;

            // Check for scroll effect selection mode (tile swap, tile flip, etc.)
            if (e.button === 0 && spellSystem && spellSystem.scrollEffects && spellSystem.scrollEffects.selectionMode) {
                const { x: screenX, y: screenY } = getBoardScreenXY(e.clientX, e.clientY);
                const world = screenToWorld(screenX, screenY);

                if (handleSelectionModeClick(world.x, world.y)) {
                    e.preventDefault();
                    e.stopPropagation();
                    return; // Click was handled by selection mode
                }
            }

            // SHIFT+CLICK: Debug mode - pin hex coordinates
            if (e.shiftKey && e.button === 0) {
                if (window.shouldDebugLog ? window.shouldDebugLog('shiftClick', 500) : true) {
                    console.log(`📍 SHIFT+CLICK DETECTED!`);
                }
                e.preventDefault();
                e.stopPropagation();
                const { x: screenX, y: screenY } = getBoardScreenXY(e.clientX, e.clientY);
                const world = screenToWorld(screenX, screenY);

                if (window.shouldDebugLog ? window.shouldDebugLog('shiftClickPos', 500) : true) {
                    console.log(`📍 DEBUG: Shift+Click at screen (${screenX.toFixed(1)}, ${screenY.toFixed(1)})`);
                }
                console.log(`   World coordinates: (${world.x.toFixed(1)}, ${world.y.toFixed(1)})`);
                
                // Find nearest hex position
                const hexPos = findNearestHexPosition(world.x, world.y);
                if (hexPos.valid) {
                    console.log(`   Nearest hex: (${hexPos.x.toFixed(1)}, ${hexPos.y.toFixed(1)})`);
                    
                    // Find all hexagon positions to see which tiles contribute
                    const allHexes = getAllHexagonPositions();
                    const matchingHex = allHexes.find(h => {
                        const dist = Math.sqrt(Math.pow(h.x - hexPos.x, 2) + Math.pow(h.y - hexPos.y, 2));
                        return dist < 5;
                    });
                    
                    if (matchingHex && matchingHex.tiles) {
                        console.log(`   This hex is contributed by ${matchingHex.tiles.length} tile(s):`);
                        matchingHex.tiles.forEach((tile, i) => {
                            console.log(`     [${i}] Tile at (${tile.x.toFixed(1)}, ${tile.y.toFixed(1)}): flipped=${tile.flipped}, shrine=${tile.shrineType}, id=${tile.id}`);
                        });
                    }
                }
                
                // Create visual debug marker
                const marker = document.createElementNS('http://www.w3.org/2000/svg', 'g');
                marker.setAttribute('class', 'debug-marker');
                marker.setAttribute('transform', `translate(${world.x}, ${world.y})`);
                
                // Draw crosshair
                const line1 = document.createElementNS('http://www.w3.org/2000/svg', 'line');
                line1.setAttribute('x1', '-10');
                line1.setAttribute('y1', '0');
                line1.setAttribute('x2', '10');
                line1.setAttribute('y2', '0');
                line1.setAttribute('stroke', '#ff00ff');
                line1.setAttribute('stroke-width', '2');
                marker.appendChild(line1);
                
                const line2 = document.createElementNS('http://www.w3.org/2000/svg', 'line');
                line2.setAttribute('x1', '0');
                line2.setAttribute('y1', '-10');
                line2.setAttribute('x2', '0');
                line2.setAttribute('y2', '10');
                line2.setAttribute('stroke', '#ff00ff');
                line2.setAttribute('stroke-width', '2');
                marker.appendChild(line2);
                
                // Draw circle
                const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
                circle.setAttribute('cx', '0');
                circle.setAttribute('cy', '0');
                circle.setAttribute('r', '5');
                circle.setAttribute('fill', 'none');
                circle.setAttribute('stroke', '#ff00ff');
                circle.setAttribute('stroke-width', '2');
                marker.appendChild(circle);
                
                // Add text label
                const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
                text.setAttribute('x', '12');
                text.setAttribute('y', '5');
                text.setAttribute('fill', '#ff00ff');
                text.setAttribute('font-size', '10');
                text.setAttribute('font-weight', 'bold');
                text.textContent = `(${world.x.toFixed(0)}, ${world.y.toFixed(0)})`;
                marker.appendChild(text);
                
                viewport.appendChild(marker);
                debugMarkers.push(marker);
                
                updateStatus(`DEBUG: Pinned (${world.x.toFixed(1)}, ${world.y.toFixed(1)}) - Check console for details`);
                return; // Don't start panning
            }

            // Don't start panning if we're already dragging something
            if (isDraggingTile || isDraggingStone || isDraggingPlayer) return;

            const targetClass = e.target.getAttribute('class');
            const isStone = targetClass && (targetClass.includes('stone') || e.target.closest('.stone'));
            const isPlayer = targetClass && (targetClass.includes('player') || e.target.closest('.player'));

            if (e.button === 0 && (e.target === boardSvg || e.target === viewport || e.target.tagName === 'polygon') && !isStone && !isPlayer) {
                e.preventDefault();
                isPanning = true;
                beginFastPan(); // move the painted board, no repaint per frame (game-core.js)
                panStartX = e.clientX;
                panStartY = e.clientY;
                lastPanX = viewportX;
                lastPanY = viewportY;
                boardSvg.style.cursor = 'grabbing';
            } else if (e.button === 2 && (e.target === boardSvg || e.target === viewport)) {
                e.preventDefault();
                isRotatingBoard = true;
                rotateStartX = e.clientX;
                rotateStartRotation = viewportRotation;
                boardSvg.style.cursor = 'grabbing';
            }
        });

        boardSvg.addEventListener('contextmenu', (e) => e.preventDefault());

        let pendingDocumentMove = false;
        let lastDocumentMove = null;
        document.addEventListener('mousemove', (e) => {
            lastDocumentMove = { clientX: e.clientX, clientY: e.clientY };
            if (pendingDocumentMove) return;
            pendingDocumentMove = true;
            requestAnimationFrame(() => {
                pendingDocumentMove = false;
                if (!lastDocumentMove) return;

                if (isPanning) {
                    const dx = lastDocumentMove.clientX - panStartX;
                    const dy = lastDocumentMove.clientY - panStartY;
                    const rad = -viewportRotation * Math.PI / 180;
                    const cos = Math.cos(rad);
                    const sin = Math.sin(rad);
                    const rotatedDx = dx * cos - dy * sin;
                    const rotatedDy = dx * sin + dy * cos;
                    viewportX = lastPanX + rotatedDx;
                    viewportY = lastPanY + rotatedDy;
                    updateViewport();
                } else if (isRotatingBoard) {
                    const dx = lastDocumentMove.clientX - rotateStartX;
                    viewportRotation = rotateStartRotation + (dx / 100) * 90;
                    updateViewport();
                } else if (isRotatingTile) {
                    const dx = lastDocumentMove.clientX - rotateTileStartX;
                    const steps = Math.round(dx / 60);
                    currentRotation = (rotateTileStartRotation - steps + 6) % 6; // Reversed direction: subtract instead of add
                    drawDeckTile();
                }

                // Elemental Stones panel hover feedback — boardSvg's own
                // mousemove listener above stops firing once the cursor
                // leaves the board, so this document-level one (which keeps
                // firing anywhere on the page) drives the drag-return glow.
                if (isDraggingStone && ghostStone) {
                    updateStoneReturnHighlight(lastDocumentMove.clientX, lastDocumentMove.clientY, draggedStoneType);
                }
            });
        });

        // Debug mode: array to store debug markers
        let debugMarkers = [];

        // Player tile keyboard-placement preview state
        let tilePreviewActive = false;
        let tilePreviewPositions = [];
        let tilePreviewIndex = 0;
        let tilePreviewGhost = null;

        function buildValidPlayerTilePositions() {
            const largeHexSize = TILE_SIZE * 4;
            const offsets = [
                { q: 1, r: 0 }, { q: 0, r: 1 }, { q: -1, r: 1 },
                { q: -1, r: 0 }, { q: 0, r: -1 }, { q: 1, r: -1 }
            ];
            const valid = [];
            const seen = new Set();
            for (const tile of placedTiles) {
                const th = pixelToHex(tile.x, tile.y, largeHexSize);
                for (const off of offsets) {
                    const key = `${th.q + off.q},${th.r + off.r}`;
                    if (seen.has(key)) continue;
                    seen.add(key);
                    const pos = hexToPixel(th.q + off.q, th.r + off.r, largeHexSize);
                    const occupied = placedTiles.some(t =>
                        Math.sqrt(Math.pow(t.x - pos.x, 2) + Math.pow(t.y - pos.y, 2)) < TILE_SIZE
                    );
                    if (!occupied && countTouchingUnrevealedTiles(pos.x, pos.y) >= 2) {
                        valid.push(pos);
                    }
                }
            }
            // Sort clockwise by angle from board centre so ←/→ feel spatial
            valid.sort((a, b) => Math.atan2(a.y, a.x) - Math.atan2(b.y, b.x));
            return valid;
        }

        function showTilePreviewGhost(pos) {
            if (tilePreviewGhost) tilePreviewGhost.remove();
            const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            g.setAttribute('class', 'player-tile-preview');
            g.setAttribute('transform', `translate(${pos.x}, ${pos.y})`);

            const tile = createTileGroup(TILE_SIZE, 0, false);
            g.appendChild(tile);

            // Dashed outline ring
            const outline = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            outline.setAttribute('class', 'preview-outline');
            outline.setAttribute('cx', 0);
            outline.setAttribute('cy', 0);
            outline.setAttribute('r', TILE_SIZE * 2);
            g.appendChild(outline);

            viewport.appendChild(g);
            tilePreviewGhost = g;
        }

        function cancelTilePreview() {
            if (tilePreviewGhost) { tilePreviewGhost.remove(); tilePreviewGhost = null; }
            tilePreviewActive = false;
            tilePreviewPositions = [];
        }

        // Player pawn keyboard-movement preview state
        let movePreviewActive = false;
        let movePreviewPositions = [];
        let movePreviewIndex = 0;
        let movePreviewGhost = null;

        function buildValidMovePositions() {
            if (!playerPosition) return [];
            const allHexes = getAllHexagonPositions();

            return allHexes
                .filter(h => {
                    const dist = Math.sqrt(Math.pow(h.x - playerPosition.x, 2) + Math.pow(h.y - playerPosition.y, 2));
                    return dist > 5 && dist < 40; // immediately adjacent only
                })
                .filter(h => {
                    // Tutorial gate
                    if (window.isTutorialMode && window.tutorialAllowedHexes) {
                        return [...window.tutorialAllowedHexes].some(key => {
                            const [ax, ay] = key.split(',').map(Number);
                            return Math.abs(ax - h.x) < 70 && Math.abs(ay - h.y) < 70;
                        });
                    }
                    return true;
                })
                .filter(h => {
                    const moveCheck = canPlayerMoveToHex(h.x, h.y, false);
                    if (!moveCheck.canMove) return false;
                    if (moveCheck.cost > getTotalAP()) return false;
                    // Can't end turn on a non-void stone
                    const stone = placedStones.find(s =>
                        Math.sqrt(Math.pow(s.x - h.x, 2) + Math.pow(s.y - h.y, 2)) < 5
                    );
                    if (stone && stone.type !== 'void') return false;
                    return true;
                })
                .sort((a, b) => {
                    const angleA = Math.atan2(a.y - playerPosition.y, a.x - playerPosition.x);
                    const angleB = Math.atan2(b.y - playerPosition.y, b.x - playerPosition.x);
                    return angleA - angleB;
                });
        }

        function showMovePreviewGhost(pos) {
            if (movePreviewGhost) movePreviewGhost.remove();
            const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            g.setAttribute('class', 'move-preview');
            g.setAttribute('transform', `translate(${pos.x}, ${pos.y})`);
            const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            circle.setAttribute('cx', 0);
            circle.setAttribute('cy', 0);
            circle.setAttribute('r', TILE_SIZE - 3);
            g.appendChild(circle);
            viewport.appendChild(g);
            movePreviewGhost = g;
        }

        function cancelMovePreview() {
            if (movePreviewGhost) { movePreviewGhost.remove(); movePreviewGhost = null; }
            movePreviewActive = false;
            movePreviewPositions = [];
        }

        // Catacomb teleport keyboard-preview state
        let cataPreviewActive = false;
        let cataPreviewDestinations = [];
        let cataPreviewIndex = 0;
        let cataPreviewGhost = null;

        function buildCatacombDestinations() {
            if (!playerPosition) return [];
            const currentShrine = findShrineAtPosition(playerPosition.x, playerPosition.y);
            const freedomActive = spellSystem && spellSystem.scrollEffects
                && typeof spellSystem.scrollEffects.hasFreedomActive === 'function'
                && spellSystem.scrollEffects.hasFreedomActive(myPlayerIndex);
            const elementalTypes = ['earth', 'water', 'fire', 'wind', 'void'];
            // Departure eligibility: standing on a catacomb tile, or on any
            // elemental shrine while Freedom is active.
            const isCatacombLike = (tile) => {
                if (!tile) return false;
                if (tile.shrineType === 'catacomb') return true;
                if (freedomActive && elementalTypes.includes(tile.shrineType)) return true;
                return false;
            };
            if (!currentShrine || !isCatacombLike(currentShrine)) return [];
            // Destinations are always elemental shrine centers — see
            // catacombEligibility()'s isElementalCenter comment.
            return placedTiles.filter(tile => {
                if (!elementalTypes.includes(tile.shrineType)) return false;
                if (tile.flipped) return false;
                if (Math.abs(tile.x - currentShrine.x) <= 5 && Math.abs(tile.y - currentShrine.y) <= 5) return false;
                const hasStone = placedStones.some(s => Math.sqrt(Math.pow(s.x - tile.x, 2) + Math.pow(s.y - tile.y, 2)) < 5);
                const hasPlayer = playerPositions.some(p => p && Math.sqrt(Math.pow(p.x - tile.x, 2) + Math.pow(p.y - tile.y, 2)) < 5);
                return !hasStone && !hasPlayer;
            });
        }

        function showCataPreviewGhost(shrine) {
            if (cataPreviewGhost) cataPreviewGhost.remove();
            const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            g.setAttribute('class', 'catacomb-preview');
            g.setAttribute('transform', `translate(${shrine.x}, ${shrine.y})`);

            const outer = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            outer.setAttribute('cx', 0);
            outer.setAttribute('cy', 0);
            outer.setAttribute('r', '18');
            outer.setAttribute('fill', '#8b4513');
            outer.setAttribute('stroke', '#fff');
            outer.setAttribute('stroke-width', '3');
            outer.setAttribute('stroke-dasharray', '8 4');
            g.appendChild(outer);

            const inner = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            inner.setAttribute('cx', 0);
            inner.setAttribute('cy', 0);
            inner.setAttribute('r', '6');
            inner.setAttribute('fill', '#fff');
            g.appendChild(inner);

            viewport.appendChild(g);
            cataPreviewGhost = g;
        }

        function cancelCataPreview() {
            if (cataPreviewGhost) { cataPreviewGhost.remove(); cataPreviewGhost = null; }
            cataPreviewActive = false;
            cataPreviewDestinations = [];
        }

        function confirmCataTransport() {
            const shrine = cataPreviewDestinations[cataPreviewIndex];
            cancelCataPreview();
            // Re-verify destination is still clear
            const hasStone = placedStones.some(s => Math.sqrt(Math.pow(s.x - shrine.x, 2) + Math.pow(s.y - shrine.y, 2)) < 5);
            const hasPlayer = playerPositions.some(p => p && Math.sqrt(Math.pow(p.x - shrine.x, 2) + Math.pow(p.y - shrine.y, 2)) < 5);
            if (hasStone || hasPlayer) {
                updateStatus('Cannot teleport there - destination is now blocked!');
                updateCatacombIndicators();
                return;
            }
            placePlayer(shrine.x, shrine.y);
            updateStatus(`Teleported to the ${shrine.shrineType} shrine!`);
            if (window.isTutorialMode && window.TutorialMode?.onCatacombTeleport) {
                window.TutorialMode.onCatacombTeleport();
            }
            if (typeof isMultiplayer !== 'undefined' && isMultiplayer && typeof broadcastGameAction === 'function') {
                const playerIndex = (typeof myPlayerIndex !== 'undefined' && myPlayerIndex !== null) ? myPlayerIndex : activePlayerIndex;
                broadcastGameAction('catacomb-teleport', { playerIndex, x: shrine.x, y: shrine.y });
            }
            updateCatacombIndicators();
        }

        // Hand / Active / Common keyboard navigation state
        let handNavActive = false;
        let handNavIndex = 0;
        let activeNavActive = false;
        let activeNavIndex = 0;
        let commonNavActive = false;
        let commonNavIndex = 0;

        function getHandScrolls()   { return [...(window.spellSystem?.handScrolls   || [])]; }
        function getActiveScrolls() { return [...(window.spellSystem?.activeScrolls || [])]; }
        function getCommonScrolls() {
            return typeof window.spellSystem?.getCommonAreaScrolls === 'function'
                ? window.spellSystem.getCommonAreaScrolls() : [];
        }

        function clearScrollSelection() {
            document.querySelectorAll('.fsp-card-selected').forEach(c => c.classList.remove('fsp-card-selected'));
        }

        function highlightScrollCard(panelId, index) {
            clearScrollSelection();
            const body = document.getElementById(`fsp-body-${panelId}`);
            if (!body) return;
            const cards = body.querySelectorAll('.fsp-card');
            if (!cards.length) return;
            const card = cards[index];
            if (card) {
                card.classList.add('fsp-card-selected');
                card.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
            }
        }

        function cancelHandNav()   { handNavActive   = false; clearScrollSelection(); }
        function cancelActiveNav() { activeNavActive = false; clearScrollSelection(); }
        function cancelCommonNav() { commonNavActive = false; clearScrollSelection(); }

        function enterHandNav() {
            const sps = window.ScrollPanelSystem;
            const scrolls = getHandScrolls();
            if (!scrolls.length) { updateStatus('Hand is empty.'); return; }
            const el = document.getElementById('fsp-hand');
            if (!el || el.style.display === 'none') sps?.openPanel('hand');
            cancelActiveNav(); cancelCommonNav();
            handNavActive = true;
            handNavIndex = 0;
            highlightScrollCard('hand', 0);
            updateStatus(`Hand ${handNavIndex + 1}/${scrolls.length} - ← → pick · Enter=active · Tab=common · Space=activate · Esc cancel`);
        }

        function enterActiveNav() {
            const sps = window.ScrollPanelSystem;
            const scrolls = getActiveScrolls();
            if (!scrolls.length) { updateStatus('Active area is empty.'); return; }
            const el = document.getElementById('fsp-active');
            if (!el || el.style.display === 'none') sps?.openPanel('active');
            cancelHandNav(); cancelCommonNav();
            activeNavActive = true;
            activeNavIndex = 0;
            highlightScrollCard('active', 0);
            updateStatus(`Active ${activeNavIndex + 1}/${scrolls.length} - ← → pick · Tab=common · Space=activate · Esc cancel`);
        }

        function enterCommonNav() {
            const sps = window.ScrollPanelSystem;
            const scrolls = getCommonScrolls();
            if (!scrolls.length) { updateStatus('Common area is empty.'); return; }
            const el = document.getElementById('fsp-common');
            if (!el || el.style.display === 'none') sps?.openPanel('common');
            cancelHandNav(); cancelActiveNav();
            commonNavActive = true;
            commonNavIndex = 0;
            highlightScrollCard('common', 0);
            updateStatus(`Common ${commonNavIndex + 1}/${scrolls.length} - ← → pick · Space=activate · Esc cancel`);
        }

        // Stone placement keyboard-preview state
        // Keys 1-6 map to: earth, water, fire, wind, void, catacomb
        const STONE_KEY_ORDER = ['void', 'wind', 'fire', 'water', 'earth'];
        let stonePreviewActive = false;
        let stonePreviewType = null;
        let stonePreviewPositions = [];
        let stonePreviewIndex = 0;
        let stonePreviewGhost = null;

        function buildValidStonePositions(type) {
            const hexPositions = getAllHexagonPositions();
            // Temporarily set draggedStoneType so isInPlacementRange reads the right type
            const prevType = draggedStoneType;
            draggedStoneType = type;

            const valid = hexPositions.filter(pos => {
                const stoneHere = placedStones.some(s =>
                    Math.sqrt(Math.pow(s.x - pos.x, 2) + Math.pow(s.y - pos.y, 2)) < 5
                );
                if (stoneHere) return false;

                let playerHere = false;
                if (playerPosition) {
                    playerHere = Math.sqrt(Math.pow(playerPosition.x - pos.x, 2) + Math.pow(playerPosition.y - pos.y, 2)) < 5;
                }
                if (!playerHere && typeof playerPositions !== 'undefined') {
                    playerPositions.forEach(p => {
                        if (p && p.x != null) {
                            if (Math.sqrt(Math.pow(p.x - pos.x, 2) + Math.pow(p.y - pos.y, 2)) < 5) playerHere = true;
                        }
                    });
                }
                if (playerHere) return false;

                if (isPositionOnFlippedTile(pos.x, pos.y, hexPositions)) return false;
                if (!isInPlacementRange(pos.x, pos.y, type)) return false;
                return true;
            });

            draggedStoneType = prevType;

            // Sort by clockwise angle around the player so ←/→ sweeps in a circle
            if (playerPosition) {
                valid.sort((a, b) => {
                    const angleA = Math.atan2(a.y - playerPosition.y, a.x - playerPosition.x);
                    const angleB = Math.atan2(b.y - playerPosition.y, b.x - playerPosition.x);
                    return angleA - angleB;
                });
            }
            return valid;
        }

        function showStonePreviewGhost(pos, type) {
            if (stonePreviewGhost) stonePreviewGhost.remove();
            const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            g.setAttribute('class', 'stone-preview');
            g.setAttribute('transform', `translate(${pos.x}, ${pos.y})`);

            const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            circle.setAttribute('cx', 0);
            circle.setAttribute('cy', 0);
            circle.setAttribute('r', STONE_SIZE);
            circle.setAttribute('fill', STONE_TYPES[type].color);
            circle.setAttribute('stroke', '#fff');
            circle.setAttribute('stroke-width', '2');
            g.appendChild(circle);

            const img = document.createElementNS('http://www.w3.org/2000/svg', 'image');
            img.setAttribute('href', STONE_TYPES[type].img);
            img.setAttribute('x', -STONE_SIZE);
            img.setAttribute('y', -STONE_SIZE);
            img.setAttribute('width', STONE_SIZE * 2);
            img.setAttribute('height', STONE_SIZE * 2);
            g.appendChild(img);

            viewport.appendChild(g);
            stonePreviewGhost = g;
        }

        function cancelStonePreview() {
            if (stonePreviewGhost) { stonePreviewGhost.remove(); stonePreviewGhost = null; }
            stonePreviewActive = false;
            stonePreviewType = null;
            stonePreviewPositions = [];
        }

        function enterStonePreview(type) {
            cancelTilePreview();
            cancelMovePreview();
            cancelCataPreview();
            const positions = buildValidStonePositions(type);
            if (positions.length === 0) {
                updateStatus(`No valid positions for ${type} stone!`);
                return;
            }
            stonePreviewType = type;
            stonePreviewPositions = positions;
            stonePreviewIndex = 0;
            stonePreviewActive = true;
            showStonePreviewGhost(positions[0], type);
            updateStatus(`${type} stone - pos 1 of ${positions.length} - ← → to move, Enter to place, ${STONE_KEY_ORDER.indexOf(type) + 1} or Esc to cancel`);
        }

        document.addEventListener('keydown', (e) => {
            // Don't fire game shortcuts while the player is typing in any input / textarea / contenteditable
            const tag = document.activeElement?.tagName;
            if (tag === 'INPUT' || tag === 'TEXTAREA' || document.activeElement?.isContentEditable) return;

            // Don't fire game shortcuts until the game board is actually active
            if (!document.getElementById('game-layout')?.classList.contains('active')) return;

            console.log(`Key pressed: ${e.key}, isDraggingTile=${isDraggingTile}, ghostTile=${!!ghostTile}, shift=${e.shiftKey}`);
            if (e.key === 'f' || e.key === 'F') {
                console.log(`F key detected! isDraggingTile=${isDraggingTile}, ghostTile exists=${!!ghostTile}, shift=${e.shiftKey}`);
                
                // SHIFT+F: Debug mode - show tile coordinates
                if (e.shiftKey && isDraggingTile && ghostTile) {
                    if (window.shouldDebugLog ? window.shouldDebugLog('tileDragged', 500) : true) {
                        console.log(`📍 DEBUG: Tile being dragged`);
                    }
                    console.log(`   draggedTileId: ${draggedTileId}`);
                    console.log(`   draggedTileShrineType: ${draggedTileShrineType}`);
                    console.log(`   draggedTileFlipped: ${draggedTileFlipped}`);
                    console.log(`   draggedTileRotation: ${draggedTileRotation}`);
                    if (draggedTileOriginalPos) {
                        console.log(`   Original position: (${draggedTileOriginalPos.x.toFixed(1)}, ${draggedTileOriginalPos.y.toFixed(1)})`);
                    }
                    
                    // Get current ghost position
                    const transform = ghostTile.getAttribute('transform');
                    console.log(`   Current ghost transform: ${transform}`);
                    
                    updateStatus(`DEBUG: Tile ID=${draggedTileId}, shrine=${draggedTileShrineType}, flipped=${draggedTileFlipped}`);
                }
                // Normal F: Flip the tile
                else if (!e.shiftKey && isDraggingTile && ghostTile) {
                    console.log(`Before flip: draggedTileFlipped=${draggedTileFlipped}`);
                    // Flip the tile being dragged
                    draggedTileFlipped = !draggedTileFlipped;
                    console.log(`After flip: draggedTileFlipped=${draggedTileFlipped}`);

                    // Update the ghost tile visual
                    ghostTile.innerHTML = '';
                    const tile = createTileGroup(TILE_SIZE, draggedTileRotation, draggedTileFlipped);
                    ghostTile.appendChild(tile);

                    updateStatus(`Tile ${draggedTileFlipped ? 'flipped' : 'unflipped'}`);
                    console.log(`Tile visual updated`);
                } else {
                    console.log(`Cannot flip - not dragging a tile or no ghost tile`);
                }
            }

            // Q: navigate Hand scrolls
            if ((e.key === 'q' || e.key === 'Q') && !e.ctrlKey && !e.altKey && !e.metaKey) {
                if (handNavActive) { cancelHandNav(); updateStatus('Hand navigation cancelled.'); }
                else enterHandNav();
            }

            // W: navigate Active scrolls
            if ((e.key === 'w' || e.key === 'W') && !e.ctrlKey && !e.altKey && !e.metaKey) {
                if (activeNavActive) { cancelActiveNav(); updateStatus('Active navigation cancelled.'); }
                else enterActiveNav();
            }

            // E: navigate Common scrolls
            if ((e.key === 'e' || e.key === 'E') && !e.ctrlKey && !e.altKey && !e.metaKey) {
                if (commonNavActive) { cancelCommonNav(); updateStatus('Common navigation cancelled.'); }
                else enterCommonNav();
            }

            // Tab: move selected card to Common Area
            if (e.key === 'Tab' && (handNavActive || activeNavActive)) {
                e.preventDefault();
                const sp = window.spellSystem;
                const sps = window.ScrollPanelSystem;
                if (handNavActive) {
                    const scrolls = getHandScrolls();
                    if (scrolls.length) {
                        const name = scrolls[handNavIndex];
                        cancelHandNav();
                        sp?.discardScroll(name);
                        sps?.refresh();
                        updateStatus(`${name} moved to common area.`);
                    }
                } else if (activeNavActive) {
                    const scrolls = getActiveScrolls();
                    if (scrolls.length) {
                        const name = scrolls[activeNavIndex];
                        cancelActiveNav();
                        sp?.discardScroll(name);
                        sps?.refresh();
                        updateStatus(`${name} moved to common area.`);
                    }
                }
            }

            // Space: cast selected card (hand or active nav)
            if (e.key === ' ' && (handNavActive || activeNavActive || commonNavActive)) {
                e.preventDefault();
                const sp = window.spellSystem;
                const sps = window.ScrollPanelSystem;
                let scrolls, idx;
                if (handNavActive)   { scrolls = getHandScrolls();   idx = handNavIndex; }
                else if (activeNavActive) { scrolls = getActiveScrolls(); idx = activeNavIndex; }
                else                 { scrolls = getCommonScrolls();  idx = commonNavIndex; }
                const name = scrolls[idx];
                if (name && sp) {
                    if (sp.checkPattern && sp.checkPattern(name)) {
                        cancelHandNav(); cancelActiveNav(); cancelCommonNav();
                        // Cast the specific selected scroll — castSpell() scans every
                        // castable scroll and could execute a different one if this one
                        // turns out to be the sole match that isn't affordable.
                        if (typeof sp.castSpecificScroll === 'function') sp.castSpecificScroll(name);
                        else sp.castSpell();
                        sps?.refresh();
                    } else {
                        updateStatus(`Pattern not matched - place the required stones first.`);
                    }
                }
            }

            // H / A / C: toggle Hand / Active / Common scroll panels
            if ((e.key === 'h' || e.key === 'H') && !e.ctrlKey && !e.altKey && !e.metaKey) {
                const sps = window.ScrollPanelSystem;
                if (sps) {
                    const el = document.getElementById('fsp-hand');
                    if (el && el.style.display !== 'none') sps.closePanel('hand');
                    else sps.openPanel('hand');
                }
            }
            if ((e.key === 'a' || e.key === 'A') && !e.ctrlKey && !e.altKey && !e.metaKey) {
                const sps = window.ScrollPanelSystem;
                if (sps) {
                    const el = document.getElementById('fsp-active');
                    if (el && el.style.display !== 'none') sps.closePanel('active');
                    else sps.openPanel('active');
                }
            }
            if ((e.key === 'c' || e.key === 'C') && !e.ctrlKey && !e.altKey && !e.metaKey) {
                const sps = window.ScrollPanelSystem;
                if (sps) {
                    const el = document.getElementById('fsp-common');
                    if (el && el.style.display !== 'none') sps.closePanel('common');
                    else sps.openPanel('common');
                }
            }

            // T key: catacomb Teleport preview
            if ((e.key === 't' || e.key === 'T') && !e.ctrlKey && !e.altKey && !e.metaKey) {
                if (cataPreviewActive) {
                    confirmCataTransport();
                } else if (canTakeAction() && playerPosition) {
                    const dests = buildCatacombDestinations();
                    if (dests.length === 0) {
                        // Not on a catacomb, or no valid destinations — do nothing silently
                    } else {
                        cancelTilePreview();
                        cancelMovePreview();
                        cancelStonePreview();
                        cataPreviewDestinations = dests;
                        cataPreviewIndex = 0;
                        cataPreviewActive = true;
                        showCataPreviewGhost(dests[0]);
                        updateStatus(`Catacomb teleport - destination 1 of ${dests.length} - ← → to cycle, T to confirm, Esc to cancel`);
                    }
                }
            }

            // Number keys 1-6: stone placement preview
            if (/^[1-5]$/.test(e.key) && !e.ctrlKey && !e.altKey && !e.metaKey) {
                const type = STONE_KEY_ORDER[parseInt(e.key) - 1];
                if (canTakeAction() && stoneCounts[type] > 0) {
                    if (stonePreviewActive && stonePreviewType === type) {
                        cancelStonePreview();
                        updateStatus('Stone placement cancelled.');
                    } else {
                        enterStonePreview(type);
                    }
                }
            }

            // Enter: drives tile-placement, movement, stone placement previews, and hand nav
            if (e.key === 'Enter') {
                // --- Hand nav: move to active ---
                if (handNavActive) {
                    const sp = window.spellSystem;
                    const sps = window.ScrollPanelSystem;
                    const scrolls = getHandScrolls();
                    if (scrolls.length) {
                        const name = scrolls[handNavIndex];
                        cancelHandNav();
                        sp?.moveToActive(name);
                        sps?.refresh();
                        updateStatus(`${name} moved to active area.`);
                    }
                    return;
                }

                // --- Stone placement: confirm ---
                if (stonePreviewActive) {
                    const pos = stonePreviewPositions[stonePreviewIndex];
                    const type = stonePreviewType;
                    cancelStonePreview();
                    window._pendingFireDestroys = [];
                    const vapBeforePlace = voidAP;
                    const placedStoneId = placeStone(pos.x, pos.y, type);
                    window.SoundSystem?.play(type === 'earth' ? 'placeearthstone' : 'placestone');
                    lastMove = { type: 'stone-place', stoneId: placedStoneId, x: pos.x, y: pos.y, element: type, destroyedByFire: window._pendingFireDestroys, prevVoidAP: vapBeforePlace };
                    window._pendingFireDestroys = null;
                    window.lastScrollAction = null;
                    stoneCounts[type]--;
                    updateStoneCount(type);
                    syncPlayerState();
                    updateStatus(`Placed ${type} stone`);
                    return;
                }

                // --- Tile placement: confirm ---
                if (tilePreviewActive) {
                    const pos = tilePreviewPositions[tilePreviewIndex];
                    cancelTilePreview();
                    const tileId = placeTile(pos.x, pos.y, 0, false, 'player', false, false, null);
                    if (tileId !== null) {
                        playerTilesAvailable--;
                        const countEl = document.getElementById('new-player-tile-count') || document.getElementById('player-tile-count');
                        if (countEl) countEl.textContent = playerTilesAvailable;
                        if (playerTileElements.length > 0) playerTileElements.shift().remove();
                        if (isMultiplayer) {
                            broadcastGameAction('player-tile-place', {
                                x: pos.x, y: pos.y,
                                playerIndex: myPlayerIndex,
                                color: playerColor,
                                cosmetics: window.cosmeticsSystem?.getEquippedAll() || null
                            });
                        }
                        updateStatus('Player tile placed!');
                    }
                    return;
                }

                // --- Movement: confirm ---
                if (movePreviewActive) {
                    const target = movePreviewPositions[movePreviewIndex];
                    cancelMovePreview();
                    const startPos = { x: playerPosition.x, y: playerPosition.y };
                    const actualCost = calculateTapMoveCost(startPos, target);
                    // Reveal hidden tiles anywhere along the path — not just
                    // the hex the pawn stops on — using the same shortest-path
                    // search the drag-path uses to find which hexes it crossed.
                    // Computed before committing so the tutorial gate below can
                    // reject the whole move, not just the reveal.
                    const previewPath = _dijkstraPath(startPos, target);
                    const tutorialFlipBlocked = window.isTutorialMode &&
                        window.TutorialMode?.isTileFlipExpected && !window.TutorialMode.isTileFlipExpected() &&
                        typeof pathHasHiddenTile === 'function' && pathHasHiddenTile(previewPath ? previewPath.slice(1) : []);
                    if (tutorialFlipBlocked) {
                        alert("Sorry, we can't let you do that yet, it breaks the tutorial!");
                    } else if (actualCost >= 0 && actualCost <= getTotalAP()) {
                        lastMove = { type: 'move', prevPos: startPos, prevCurrentAP: currentAP, prevVoidAP: voidAP };
                        window.lastScrollAction = null;
                        // Only play footstep if AP was spent (wind steps cost 0)
                        if (actualCost > 0) window.SoundSystem?.playFootstep();
                        placePlayer(target.x, target.y);
                        if (window.isTutorialMode && window.TutorialMode?.onPlayerMoved) {
                            window.TutorialMode.onPlayerMoved(target.x, target.y);
                        }
                        spendAP(actualCost);
                        if (isMultiplayer) {
                            broadcastGameAction('player-move', {
                                playerIndex: activePlayerIndex,
                                x: target.x, y: target.y,
                                apSpent: actualCost,
                                cosmetics: window.cosmeticsSystem?.getEquippedAll() || null
                            });
                        }
                        const revealedAlongPath = revealFlippedTilesAlongPath(previewPath ? previewPath.slice(1) : []);
                        if (revealedAlongPath === 0) {
                            updateStatus(`Moved (cost: ${actualCost} AP, ${getTotalAP()} AP remaining)`);
                        }
                    } else {
                        updateStatus('Could not move there!');
                    }
                    return;
                }

                // --- Tile placement: enter preview ---
                if (playerTilesAvailable > 0) {
                    if (isMultiplayer && (!isPlacementPhase || !canPlaceTile())) { notYourTurn(); return; }
                    const positions = buildValidPlayerTilePositions();
                    if (positions.length === 0) { updateStatus('No valid edge positions available for your tile!'); return; }
                    tilePreviewPositions = positions;
                    tilePreviewIndex = Math.floor(Math.random() * positions.length);
                    tilePreviewActive = true;
                    showTilePreviewGhost(tilePreviewPositions[tilePreviewIndex]);
                    updateStatus(`Tile position ${tilePreviewIndex + 1} of ${tilePreviewPositions.length} - ← → to move, Enter to confirm, Esc to cancel`);
                    return;
                }

                // --- Movement: enter preview ---
                if (canTakeAction() && playerPosition && getTotalAP() > 0 && !isDraggingPlayer && !isDraggingTile) {
                    const positions = buildValidMovePositions();
                    if (positions.length === 0) { updateStatus('No valid moves available!'); return; }
                    movePreviewPositions = positions;
                    movePreviewIndex = 0;
                    movePreviewActive = true;
                    showMovePreviewGhost(movePreviewPositions[0]);
                    const cost = canPlayerMoveToHex(movePreviewPositions[0].x, movePreviewPositions[0].y, false).cost;
                    updateStatus(`Move 1 of ${positions.length} (${cost} AP) - ← → to choose, Enter to confirm, Esc to cancel`);
                }
            }

            // Arrow keys: cycle tile-placement, movement, stone, catacomb, or scroll nav
            if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                if (!tilePreviewActive && !movePreviewActive && !stonePreviewActive && !cataPreviewActive && !handNavActive && !activeNavActive && !commonNavActive) return;
                e.preventDefault();
                const dir = e.key === 'ArrowRight' ? 1 : -1;
                if (handNavActive) {
                    const scrolls = getHandScrolls();
                    handNavIndex = (handNavIndex + dir + scrolls.length) % scrolls.length;
                    highlightScrollCard('hand', handNavIndex);
                    updateStatus(`Hand ${handNavIndex + 1}/${scrolls.length} - ← → pick · Enter=active · Tab=common · Space=activate · Esc cancel`);
                } else if (activeNavActive) {
                    const scrolls = getActiveScrolls();
                    activeNavIndex = (activeNavIndex + dir + scrolls.length) % scrolls.length;
                    highlightScrollCard('active', activeNavIndex);
                    updateStatus(`Active ${activeNavIndex + 1}/${scrolls.length} - ← → pick · Tab=common · Space=activate · Esc cancel`);
                } else if (commonNavActive) {
                    const scrolls = getCommonScrolls();
                    commonNavIndex = (commonNavIndex + dir + scrolls.length) % scrolls.length;
                    highlightScrollCard('common', commonNavIndex);
                    updateStatus(`Common ${commonNavIndex + 1}/${scrolls.length} - ← → pick · Space=activate · Esc cancel`);
                } else if (tilePreviewActive) {
                    tilePreviewIndex = (tilePreviewIndex + dir + tilePreviewPositions.length) % tilePreviewPositions.length;
                    showTilePreviewGhost(tilePreviewPositions[tilePreviewIndex]);
                    updateStatus(`Tile position ${tilePreviewIndex + 1} of ${tilePreviewPositions.length} - ← → to move, Enter to confirm, Esc to cancel`);
                } else if (stonePreviewActive) {
                    stonePreviewIndex = (stonePreviewIndex + dir + stonePreviewPositions.length) % stonePreviewPositions.length;
                    showStonePreviewGhost(stonePreviewPositions[stonePreviewIndex], stonePreviewType);
                    updateStatus(`${stonePreviewType} stone - pos ${stonePreviewIndex + 1} of ${stonePreviewPositions.length} - ← → to move, Enter to place, ${STONE_KEY_ORDER.indexOf(stonePreviewType) + 1} or Esc to cancel`);
                } else if (cataPreviewActive) {
                    cataPreviewIndex = (cataPreviewIndex + dir + cataPreviewDestinations.length) % cataPreviewDestinations.length;
                    showCataPreviewGhost(cataPreviewDestinations[cataPreviewIndex]);
                    updateStatus(`Catacomb teleport - destination ${cataPreviewIndex + 1} of ${cataPreviewDestinations.length} - ← → to cycle, T to confirm, Esc to cancel`);
                } else {
                    movePreviewIndex = (movePreviewIndex + dir + movePreviewPositions.length) % movePreviewPositions.length;
                    showMovePreviewGhost(movePreviewPositions[movePreviewIndex]);
                    const cost = canPlayerMoveToHex(movePreviewPositions[movePreviewIndex].x, movePreviewPositions[movePreviewIndex].y, false).cost;
                    updateStatus(`Move ${movePreviewIndex + 1} of ${movePreviewPositions.length} (${cost} AP) - ← → to choose, Enter to confirm, Esc to cancel`);
                }
            }

            // X: end turn
            if ((e.key === 'x' || e.key === 'X') && !e.ctrlKey && !e.altKey && !e.metaKey) {
                const btn = document.getElementById('end-turn');
                if (btn && !btn.disabled) btn.click();
            }

            // Escape: cancel whichever preview or nav is active
            if (e.key === 'Escape') {
                if (tilePreviewActive) { cancelTilePreview(); updateStatus('Tile placement cancelled.'); }
                else if (movePreviewActive) { cancelMovePreview(); updateStatus('Move cancelled.'); }
                else if (stonePreviewActive) { cancelStonePreview(); updateStatus('Stone placement cancelled.'); }
                else if (cataPreviewActive) { cancelCataPreview(); updateStatus('Teleport cancelled.'); }
                else if (handNavActive) { cancelHandNav(); updateStatus('Hand navigation cancelled.'); }
                else if (activeNavActive) { cancelActiveNav(); updateStatus('Active navigation cancelled.'); }
                else if (commonNavActive) { cancelCommonNav(); updateStatus('Common navigation cancelled.'); }
            }
        });

        boardSvg.addEventListener('wheel', (e) => {
            e.preventDefault();
            const { x: mouseX, y: mouseY } = getBoardScreenXY(e.clientX, e.clientY);
            const worldBefore = screenToWorld(mouseX, mouseY);
            const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
            viewportScale = Math.max(0.1, Math.min(10, viewportScale * zoomFactor));
            const worldAfter = screenToWorld(mouseX, mouseY);
            viewportX += (worldAfter.x - worldBefore.x) * viewportScale;
            viewportY += (worldAfter.y - worldBefore.y) * viewportScale;
            updateViewport();
        });

        let isEndingTurn = false; // Double-click guard for end-turn button

        document.getElementById('end-turn').onclick = function() {
            resetEndTurnPrompt();
            // Prevent double-click from advancing turn twice
            if (isEndingTurn) return;

            // In multiplayer, only allow ending turn if it's your turn
            if (!canTakeAction()) {
                notYourTurn();
                return;
            }

            // Block end-turn if the player has an unresolved scroll cascade.
            // They must choose where to place the overflowing scroll before ending.
            const turnPlayerIdx = isMultiplayer ? myPlayerIndex : activePlayerIndex;
            if (spellSystem && spellSystem.hasPendingCascade(turnPlayerIdx)) {
                updateStatus('Resolve your pending scroll cascade before ending your turn!');
                spellSystem.showPendingCascadePrompt(turnPlayerIdx);
                return;
            }

            // Mid-transit across a stone — must move off before resting the
            // turn there (see isPlayerRestingOnStone). Exempt when stranded
            // (no legal move to escape it) — that's the one case where
            // ending the turn HAS to stay legal, or the game hard-deadlocks.
            if (typeof isPlayerRestingOnStone === 'function' && isPlayerRestingOnStone(turnPlayerIdx) &&
                !(typeof isPlayerStrandedOnStone === 'function' && isPlayerStrandedOnStone(turnPlayerIdx))) {
                updateStatus('Cannot end your turn while standing on a stone - move to an empty hex first.');
                window.SoundSystem?.play('error');
                return;
            }

            // Another player's tile: you may cross it, but not end your turn
            // on it (see isPlayerOnOpponentTile). Same stranded exemption.
            if (typeof isPlayerOnOpponentTile === 'function' && isPlayerOnOpponentTile(turnPlayerIdx) &&
                !(typeof isPlayerStrandedOnStone === 'function' && isPlayerStrandedOnStone(turnPlayerIdx))) {
                updateStatus("You can't end your turn on another player's tile - move off it first.");
                window.SoundSystem?.play('error');
                return;
            }

            // R2 (docs/bot-roadmap.md, Runtime Track): shadow-mode backend validator.
            // Asks the server (which only knows the LAST persisted turn owner — see
            // persistCurrentTurnIndex below) whether it agrees this player currently
            // holds the turn. Logged only, never blocks — proves the backend-authority
            // path works before anything is made to depend on it.
            if (isMultiplayer && typeof supabase !== 'undefined' && currentGameId) {
                const endingPlayerIndex = activePlayerIndex;
                supabase.functions.invoke('validate-end-turn', {
                    body: { gameId: currentGameId, playerIndex: endingPlayerIndex }
                }).then(({ data, error }) => {
                    if (error) { console.warn('⚠️ [R2 shadow-validator] call failed:', error); return; }
                    if (data?.legal === false) {
                        console.warn(`⚠️ [R2 shadow-validator] DISAGREEMENT - DB says turn belongs to player ${data.currentTurnIndex}, client ended turn for player ${endingPlayerIndex}`);
                    } else {
                        console.log(`✅ [R2 shadow-validator] confirmed endTurn legal for player ${endingPlayerIndex}`);
                    }
                });
            }

            isEndingTurn = true;

            // Replenish shrine stones BEFORE clearing buffs (Mine buff doubles output)
            if (playerPosition) {
                const shrine = findShrineAtPosition(playerPosition.x, playerPosition.y);
                if (shrine && shrine.shrineType !== 'catacomb') {
                    const effectiveType = spellSystem?.scrollEffects?.getEffectiveTileElement?.(shrine) ?? shrine.shrineType;
                    replenishShrineStones(effectiveType);
                }
            }
            window.SoundSystem?.play('endturn');

            // Tutorial hook — fires after shrine stone collection so the tutorial
            // can detect which shrine the player just ended their turn on.
            if (window.isTutorialMode && window.TutorialMode?.onEndTurn) {
                window.TutorialMode.onEndTurn(playerPosition);
            }

            // Cancel any active selection mode (tile swap/flip in progress)
            if (spellSystem && spellSystem.scrollEffects) {
                spellSystem.scrollEffects.cancelSelectionMode();
                // Clear turn-based buffs (like extended placement, global placement)
                spellSystem.scrollEffects.clearTurnBuffs();
                // Clear turn tracking (for Reflect and Burning Motivation)
                spellSystem.scrollEffects.clearTurnTracking();
            }

            // End-of-turn overflow: if hand or active scroll count exceeds capacity, show resolve modal first
            const scrolls = spellSystem.getPlayerScrolls(false);
            const handOver = scrolls.hand.size > spellSystem.MAX_HAND_SIZE;
            const activeOver = scrolls.active.size > spellSystem.MAX_ACTIVE_SIZE;
            if (handOver || activeOver) {
                spellSystem.showEndTurnOverflowModal(function doEndTurn() {
                    lastMove = null;
                    if (playerPositions.length > 1) {
                        const COLOR_RANK = {
                            '#9458f4': 1, '#ffce00': 2, '#ed1b43': 3, '#5894f4': 4, '#69d83a': 5
                        };
                        // Guard: skip null/undefined entries (e.g. sparse indices after a player disconnects)
                        const sortedPlayers = playerPositions
                            .map((p, idx) => ({ index: idx, color: p?.color, rank: COLOR_RANK[p?.color] || 999 }))
                            .filter((_, idx) => playerPositions[idx] != null)
                            .sort((a, b) => a.rank - b.rank);
                        if (sortedPlayers.length === 0) {
                            console.warn('⚠️ sortedPlayers is empty - cannot advance turn');
                            isEndingTurn = false;
                            return;
                        }
                        let currentSortedIndex = sortedPlayers.findIndex(p => p.index === activePlayerIndex);
                        if (currentSortedIndex === -1) {
                            console.warn('⚠️ activePlayerIndex', activePlayerIndex, 'not found in sortedPlayers - defaulting to first player');
                            currentSortedIndex = sortedPlayers.length - 1; // will wrap to 0
                        }
                        const nextSortedIndex = (currentSortedIndex + 1) % sortedPlayers.length;
                        activePlayerIndex = sortedPlayers[nextSortedIndex].index;

                        // Broadcast turn change FIRST in multiplayer
                        if (isMultiplayer) {
                            const startedAt = window.serverNow();
                            turnStartedAtMs = startedAt;
                            currentTurnNumber++;
                            broadcastGameAction('turn-change', {
                                playerIndex: activePlayerIndex,
                                turnStartedAt: startedAt,
                                turnNumber: currentTurnNumber
                            });
                            persistCurrentTurnIndex(activePlayerIndex);
                        }

                        // Wandering River ends at the beginning of your next turn: clear when we switch TO that player
                        if (spellSystem?.scrollEffects?.clearWanderingRiverForPlayer) {
                            spellSystem.scrollEffects.clearWanderingRiverForPlayer(activePlayerIndex);
                        }
                        if (spellSystem?.scrollEffects?.clearFreedomForPlayer) {
                            spellSystem.scrollEffects.clearFreedomForPlayer(activePlayerIndex);
                        }
                        if (spellSystem?.scrollEffects?.clearQuickReflexesForPlayer) {
                            spellSystem.scrollEffects.clearQuickReflexesForPlayer(activePlayerIndex);
                        }
                        if (spellSystem?.scrollEffects?.clearExcavateForPlayer) {
                            spellSystem.scrollEffects.clearExcavateForPlayer(activePlayerIndex);
                        }
                        // Reflect fires first, then Psychic fires after all reflects fully resolve.
                        // Both use sequential onComplete chaining for interactive scrolls.
                        const reflectResult = spellSystem?.scrollEffects?.processReflectPending
                            ? spellSystem.scrollEffects.processReflectPending(activePlayerIndex, () => {
                                // All reflects done — now run Psychic stolen scrolls
                                if (spellSystem?.scrollEffects?.processPsychicPending) {
                                    spellSystem.scrollEffects.processPsychicPending(activePlayerIndex);
                                }
                              })
                            : null;
                        // If no reflects, start Psychic immediately
                        if (reflectResult === null && spellSystem?.scrollEffects?.processPsychicPending) {
                            spellSystem.scrollEffects.processPsychicPending(activePlayerIndex);
                        }
                        // Excavate teleport: if this player has a pending teleport, trigger it
                        if (spellSystem?.scrollEffects?.processExcavateTeleport) {
                            spellSystem.scrollEffects.processExcavateTeleport(activePlayerIndex);
                        }
                        // AP resets at the start of the new player's turn (only for the new active player)
                        if (activePlayerIndex === myPlayerIndex) {
                            currentAP = 5;
                            document.getElementById('ap-count').textContent = currentAP;
                            updateApPips(currentAP);
                            refreshVoidAP();
                            syncPlayerState();
                        }

                        // Note: reflect-triggered and psychic-triggered broadcasts are both sent
                        // inside processReflectPending/processPsychicPending respectively
                        // (one per scroll, immediately before its interactive selection begins), so
                        // remote clients receive them in order and can queue them sequentially.
                        if (isMultiplayer) {
                            if (Array.isArray(reflectResult) && typeof syncPlayerState === 'function') {
                                syncPlayerState();
                            }
                        }

                        const nextPlayerColorName = getPlayerColorName(activePlayerIndex);
                        Object.keys(stoneCounts).forEach(updateStoneCount);
                        spellSystem.updateScrollCount();
                        updateStatus(`Turn ended. Now ${nextPlayerColorName}'s turn! AP restored.`);
                        console.log(`📄 Switched to player ${activePlayerIndex + 1} (${nextPlayerColorName})`);
                    } else {
                        // Single player: AP resets for next turn
                        currentAP = 5;
                        document.getElementById('ap-count').textContent = currentAP;
                        updateApPips(currentAP);
                        refreshVoidAP();
                        updateStatus('Turn ended. AP restored.');
                    }
                    isEndingTurn = false;
                });
                return;
            }

            // Shrine replenishment already handled above (before clearTurnBuffs, so Mine buff applies)

            lastMove = null; window.lastScrollAction = null; // Clear undo history on new turn

            // Switch to next player based on color rank
            if (playerPositions.length > 1) {
                // Color rank order: void(1) -> wind(2) -> fire(3) -> water(4) -> earth(5)
                const COLOR_RANK = {
                    '#9458f4': 1, // purple/void
                    '#ffce00': 2, // yellow/wind
                    '#ed1b43': 3, // red/fire
                    '#5894f4': 4, // blue/water
                    '#69d83a': 5  // green/earth
                };

                // Sort players by rank — guard against null/undefined entries (sparse indices after disconnect)
                const sortedPlayers = playerPositions
                    .map((p, idx) => ({ index: idx, color: p?.color, rank: COLOR_RANK[p?.color] || 999 }))
                    .filter((_, idx) => playerPositions[idx] != null)
                    .sort((a, b) => a.rank - b.rank);

                if (sortedPlayers.length === 0) {
                    console.warn('⚠️ sortedPlayers is empty - cannot advance turn (no placed player positions)');
                    isEndingTurn = false;
                    return;
                }

                // Find current player in sorted list
                let currentSortedIndex = sortedPlayers.findIndex(p => p.index === activePlayerIndex);
                if (currentSortedIndex === -1) {
                    console.warn('⚠️ activePlayerIndex', activePlayerIndex, 'not in sortedPlayers - defaulting to first player. Sorted:', sortedPlayers);
                    currentSortedIndex = sortedPlayers.length - 1; // wraps to 0 below
                }

                // Move to next player in sorted order (wrap around)
                const nextSortedIndex = (currentSortedIndex + 1) % sortedPlayers.length;
                activePlayerIndex = sortedPlayers[nextSortedIndex].index;

                // Broadcast turn change FIRST in multiplayer so the receiver
                // updates activePlayerIndex before any follow-up broadcasts arrive
                if (isMultiplayer) {
                    const startedAt = window.serverNow();
                    turnStartedAtMs = startedAt;
                    currentTurnNumber++;
                    broadcastGameAction('turn-change', {
                        playerIndex: activePlayerIndex,
                        turnStartedAt: startedAt,
                        turnNumber: currentTurnNumber
                    });
                    persistCurrentTurnIndex(activePlayerIndex);
                }

                // Wandering River ends at the beginning of your next turn
                if (spellSystem?.scrollEffects?.clearWanderingRiverForPlayer) {
                    spellSystem.scrollEffects.clearWanderingRiverForPlayer(activePlayerIndex);
                }
                if (spellSystem?.scrollEffects?.clearFreedomForPlayer) {
                    spellSystem.scrollEffects.clearFreedomForPlayer(activePlayerIndex);
                }
                if (spellSystem?.scrollEffects?.clearQuickReflexesForPlayer) {
                    spellSystem.scrollEffects.clearQuickReflexesForPlayer(activePlayerIndex);
                }
                if (spellSystem?.scrollEffects?.clearExcavateForPlayer) {
                    spellSystem.scrollEffects.clearExcavateForPlayer(activePlayerIndex);
                }
                // Reflect fires first, then Psychic fires after all reflects fully resolve.
                const reflectResult = spellSystem?.scrollEffects?.processReflectPending
                    ? spellSystem.scrollEffects.processReflectPending(activePlayerIndex, () => {
                        // All reflects done — now run Psychic stolen scrolls
                        if (spellSystem?.scrollEffects?.processPsychicPending) {
                            spellSystem.scrollEffects.processPsychicPending(activePlayerIndex);
                        }
                      })
                    : null;
                // If no reflects, start Psychic immediately
                if (reflectResult === null && spellSystem?.scrollEffects?.processPsychicPending) {
                    spellSystem.scrollEffects.processPsychicPending(activePlayerIndex);
                }
                // Excavate teleport: if this player has a pending teleport, trigger it
                if (spellSystem?.scrollEffects?.processExcavateTeleport) {
                    spellSystem.scrollEffects.processExcavateTeleport(activePlayerIndex);
                }

                // AP resets at the start of the new player's turn (only for the new active player)
                if (activePlayerIndex === myPlayerIndex) {
                    currentAP = 5;
                    document.getElementById('ap-count').textContent = currentAP;
                    updateApPips(currentAP);
                    refreshVoidAP();
                    syncPlayerState();
                }

                // Note: reflect-triggered and psychic-triggered broadcasts are both handled
                // inside processReflectPending/processPsychicPending respectively
                if (isMultiplayer) {
                    if (Array.isArray(reflectResult) && typeof syncPlayerState === 'function') {
                        syncPlayerState();
                    }
                }

                const nextPlayerColorName = getPlayerColorName(activePlayerIndex);

                // Update UI to show new player's inventory
                Object.keys(stoneCounts).forEach(updateStoneCount);
                spellSystem.updateScrollCount();

                updateStatus(`Turn ended. Now ${nextPlayerColorName}'s turn! AP restored.`);
                console.log(`📄 Switched to player ${activePlayerIndex + 1} (${nextPlayerColorName})`);
                isEndingTurn = false;
            } else {
                // Single player: your next turn starts now; clear buffs then restore AP
                if (spellSystem && spellSystem.scrollEffects && spellSystem.scrollEffects.clearWanderingRiverForPlayer) {
                    spellSystem.scrollEffects.clearWanderingRiverForPlayer(activePlayerIndex);
                }
                if (spellSystem?.scrollEffects?.clearFreedomForPlayer) {
                    spellSystem.scrollEffects.clearFreedomForPlayer(activePlayerIndex);
                }
                if (spellSystem?.scrollEffects?.clearQuickReflexesForPlayer) {
                    spellSystem.scrollEffects.clearQuickReflexesForPlayer(activePlayerIndex);
                }
                if (spellSystem?.scrollEffects?.clearExcavateForPlayer) {
                    spellSystem.scrollEffects.clearExcavateForPlayer(activePlayerIndex);
                }
                // Reflect fires first, then Psychic fires after all reflects fully resolve.
                const reflectResultSingle = spellSystem?.scrollEffects?.processReflectPending
                    ? spellSystem.scrollEffects.processReflectPending(activePlayerIndex, () => {
                        if (spellSystem?.scrollEffects?.processPsychicPending) {
                            spellSystem.scrollEffects.processPsychicPending(activePlayerIndex);
                        }
                      })
                    : null;
                if (reflectResultSingle === null && spellSystem?.scrollEffects?.processPsychicPending) {
                    spellSystem.scrollEffects.processPsychicPending(activePlayerIndex);
                }
                // Excavate teleport for single player
                if (spellSystem?.scrollEffects?.processExcavateTeleport) {
                    spellSystem.scrollEffects.processExcavateTeleport(activePlayerIndex);
                }
                // AP resets at start of new turn
                currentAP = 5;
                document.getElementById('ap-count').textContent = currentAP;
                updateApPips(currentAP);
                refreshVoidAP();
                updateStatus('Turn ended. AP restored.');
                isEndingTurn = false;
            }
        };

        
        // Inventory toggle button
        const invBtn = document.getElementById('inventory-toggle');
        if (invBtn) invBtn.onclick = toggleInventory;
document.getElementById('undo-move').onclick = function() {
            // Resolve which action to undo: scroll-panel moves use window.lastScrollAction
            // (different closure), everything else uses lastMove.
            const scrollAction = window.lastScrollAction;
            const action = lastMove || (scrollAction ? { type: 'scroll-move', ...scrollAction } : null);

            if (!action) {
                window.SoundSystem?.play('error');
                updateStatus('Nothing to undo!');
                return;
            }
            // Only on your own turn, and not in the middle of a drag (undo fuzz
            // test 2026-10-01: Undo mid-drag reversed the move before it).
            if (typeof canTakeAction === 'function' && !canTakeAction()) {
                window.SoundSystem?.play('error');
                updateStatus('You can only undo on your own turn.');
                return;
            }
            if (isDraggingStone || isDraggingPlayer || isDraggingTile) {
                window.SoundSystem?.play('error');
                updateStatus('Finish the drag first.');
                return;
            }

            if (action.type === 'move') {
                // --- Undo player movement ---
                placePlayer(action.prevPos.x, action.prevPos.y);
                // Restore exact AP snapshot (handles voidAP correctly)
                currentAP = action.prevCurrentAP;
                voidAP    = action.prevVoidAP;
                document.getElementById('ap-count').textContent = currentAP;
                // updateVoidAP, not refreshVoidAP: refresh reloads void AP from
                // the pool, which gave spent void stones back as fresh AP.
                if (typeof updateVoidAP === 'function') updateVoidAP();
                updateStatus(`Undid movement. AP restored to ${getTotalAP()}.`);
                if (isMultiplayer) {
                    broadcastGameAction('undo-move', {
                        playerIndex: activePlayerIndex,
                        x: action.prevPos.x,
                        y: action.prevPos.y,
                        apRestored: currentAP
                    });
                    if (typeof syncPlayerState === 'function') syncPlayerState();
                }

            } else if (action.type === 'stone-place') {
                // --- Undo stone placement: remove it from the board and return to pool ---
                // By id, else by position (an id can be stale; the stone is
                // still the one of that type on that hex)
                const stone = placedStones.find(s => s.id === action.stoneId)
                    || placedStones.find(s => s.type === action.element && Math.hypot(s.x - action.x, s.y - action.y) < 5);
                if (!stone) {
                    window.SoundSystem?.play('error');
                    updateStatus('That stone is no longer on the board, nothing to undo.');
                    lastMove = null;
                    return;
                }
                if (stone) {
                    if (stone.element && stone.element.parentNode) stone.element.remove();
                    placedStones.splice(placedStones.indexOf(stone), 1);
                    // The stone came from the player's pool, so it goes back there only
                    // (it used to go to the source pool as well: counted twice).
                    stoneCounts[action.element] = (stoneCounts[action.element] || 0) + 1;
                    updateStoneCount(action.element);
                    // Placing a void stone can lower void AP (one less in the pool);
                    // the stone is back, so is that void AP.
                    if (action.prevVoidAP != null && action.prevVoidAP > voidAP) {
                        voidAP = Math.min(action.prevVoidAP, playerPool.void);
                        if (typeof updateVoidAP === 'function') updateVoidAP();
                    }
                    updateTileClasses();
                    recheckAllStoneInteractions();
                    updateAllWaterStoneVisuals();
                    updateAllVoidNullificationVisuals();
                    if (isMultiplayer) {
                        // By position: stone ids are counted separately on every board.
                        // noSource: the stone goes back to the player, not the source pool.
                        broadcastGameAction('stone-break', { stoneId: action.stoneId, x: action.x, y: action.y, noSource: true });
                    }
                }
                // Restore any stones that were destroyed by the fire placement. Fire sent
                // them to the source pool, so they come back out of it.
                if (action.destroyedByFire && action.destroyedByFire.length > 0) {
                    action.destroyedByFire.forEach(s => {
                        placeStoneVisually(s.x, s.y, s.type);
                        if (sourcePool[s.type] > 0) { sourcePool[s.type]--; updateStoneCount(s.type); }
                        if (isMultiplayer) {
                            broadcastGameAction('stone-place', { x: s.x, y: s.y, stoneType: s.type });
                        }
                    });
                }
                syncPlayerState();
                updateStatus(`Undid ${action.element} stone placement.`);

            } else if (action.type === 'stone-break') {
                // --- Undo stone break: re-place it and restore AP ---
                currentAP = action.prevCurrentAP;
                voidAP    = action.prevVoidAP;
                document.getElementById('ap-count').textContent = currentAP;
                if (typeof updateVoidAP === 'function') updateVoidAP(); // not refreshVoidAP, see the move undo
                placeStoneVisually(action.x, action.y, action.element);
                // Breaking it sent it to the source pool; it comes back out of it.
                if (sourcePool[action.element] > 0) { sourcePool[action.element]--; updateStoneCount(action.element); }
                if (isMultiplayer) {
                    broadcastGameAction('stone-place', { x: action.x, y: action.y, stoneType: action.element });
                    if (typeof syncPlayerState === 'function') syncPlayerState();
                }
                updateStatus(`Undid ${action.element} stone break. AP restored to ${getTotalAP()}.`);

            } else if (action.type === 'scroll-move') {
                // --- Undo scroll area move (hand↔active↔common) ---
                const sp = window.spellSystem;
                if (sp && typeof sp._undoScrollMove === 'function') {
                    sp._undoScrollMove(action.scrollName, action.from, action.to, action.displacedScroll);
                    if (window.ScrollPanelSystem) window.ScrollPanelSystem.refresh();
                    updateStatus(`Undid scroll move: ${action.scrollName} returned to ${action.from}.`);
                }
            }

            // Clear undo history
            lastMove = null;
            window.lastScrollAction = null;
        };

        // scroll-inventory replaced by panel-btn-hand/active/common in scroll-panels.js
        const _legacyScrollBtn = document.getElementById('scroll-inventory');
        if (_legacyScrollBtn) _legacyScrollBtn.onclick = () => spellSystem.showInventory();

        document.getElementById('cast-spell').onclick = function() {
            if (!canTakeAction()) {
                notYourTurn();
                return;
            }
            spellSystem.castSpell();
        };

        document.getElementById('leave-game').onclick = function() {
            leaveGame();
        };

        function findShrineAtPosition(x, y) {
            // Check each tile to see if player is on the center hex (shrine location)
            // Skip player tiles - we want the actual shrine tile
            for (const tile of placedTiles) {
                // Skip player tiles (shrineType === 'player')
                if (tile.shrineType === 'player') continue;

                const dist = Math.sqrt(Math.pow(tile.x - x, 2) + Math.pow(tile.y - y, 2));
                // Center hex is at the tile's position (0,0 offset)
                if (dist < 5) {
                    console.log(`🔍 findShrineAtPosition(${x.toFixed(1)}, ${y.toFixed(1)}): Found ${tile.shrineType} shrine at tile ${tile.id}`);
                    return tile;
                }
            }
            console.log(`🔍 findShrineAtPosition(${x.toFixed(1)}, ${y.toFixed(1)}): No shrine found`);
            return null;
        }

        function replenishShrineStones(shrineType) {
            // Stone rank determines replenishment amount
            const STONE_RANK = {
                'void': 1,
                'wind': 2,
                'fire': 3,
                'water': 4,
                'earth': 5
            };

            let replenishAmount = STONE_RANK[shrineType];

            // Mine buff: double output for the buffed shrine type
            const mineBuff = spellSystem?.scrollEffects?.activeBuffs?.mine;
            if (mineBuff && mineBuff.playerIndex === activePlayerIndex && mineBuff.shrineType === shrineType) {
                replenishAmount *= 2;
                console.log(`⛏️ Mine: doubling ${shrineType} shrine output to ${replenishAmount}`);
            }

            // Calculate how many stones we can actually transfer
            // Limited by: source pool availability, player pool capacity, and replenish amount
            const availableInSource = sourcePool[shrineType];
            const spaceInPlayer = playerPoolCapacity[shrineType] - playerPool[shrineType];
            const actualReplenished = Math.min(replenishAmount, availableInSource, spaceInPlayer);

            if (actualReplenished > 0) {
                // Transfer from source pool to player pool
                sourcePool[shrineType] -= actualReplenished;
                playerPool[shrineType] += actualReplenished;
                updateStoneCount(shrineType);
                window.SoundSystem?.play('collectstones');

                // Sync resources in multiplayer
                syncPlayerState();

                updateStatus(`Shrine activated! Transferred ${actualReplenished} ${shrineType} stone${actualReplenished > 1 ? 's' : ''} from source to player pool. (Source: ${sourcePool[shrineType]}/${sourcePoolCapacity[shrineType]}, Player: ${playerPool[shrineType]}/${playerPoolCapacity[shrineType]}). AP restored.`);
            } else if (spaceInPlayer === 0) {
                updateStatus(`Shrine activated but player pool is full! (${playerPool[shrineType]}/${playerPoolCapacity[shrineType]}). AP restored.`);
            } else if (availableInSource === 0) {
                updateStatus(`Shrine activated but source pool is empty! (${sourcePool[shrineType]}/${sourcePoolCapacity[shrineType]}). AP restored.`);
            }
        }

        let activeTeleportIndicators = [];

        // Freedom ("only applies to you") is scoped by playerIndex in
        // activeBuffs.freedom, but the teleport indicators built from it are
        // DOM elements that persist until the next recompute — with no
        // recompute wired to the turn boundary, an indicator drawn during
        // the caster's turn (correctly, per hasFreedomActive at that moment)
        // stays on the board and clickable into whoever's turn comes next.
        // Its click handler only re-checked canTakeAction()/occupancy, never
        // eligibility, so any later player could click through it and
        // teleport for free even though Freedom was never active for them.
        // Both call sites below recompute fresh off CURRENT myPlayerIndex so
        // a stale indicator can't be exploited after control passes on.
        function catacombEligibility() {
            if (!playerPosition) return { shrine: null, isCatacombLike: () => false, isElementalCenter: () => false };
            const shrine = findShrineAtPosition(playerPosition.x, playerPosition.y);
            const freedomActive = spellSystem && spellSystem.scrollEffects
                && typeof spellSystem.scrollEffects.hasFreedomActive === 'function'
                && spellSystem.scrollEffects.hasFreedomActive(myPlayerIndex);
            const elementalTypes = ['earth', 'water', 'fire', 'wind', 'void'];
            // Departure eligibility: standing on a catacomb tile, or on any
            // elemental shrine while Freedom is active.
            const isCatacombLike = (tile) => {
                if (!tile) return false;
                if (tile.shrineType === 'catacomb') return true;
                if (freedomActive && elementalTypes.includes(tile.shrineType)) return true;
                return false;
            };
            // Destination filter — EXPLORATION: catacomb tiles no longer link
            // to each other. Every teleport (whether departing from a
            // catacomb tile or, via Freedom, from any elemental shrine) now
            // lands only on the center of an elemental shrine.
            const isElementalCenter = (tile) => !!tile && elementalTypes.includes(tile.shrineType);
            return { shrine, isCatacombLike, isElementalCenter };
        }

        function updateCatacombIndicators() {
            // Remove existing indicators
            activeTeleportIndicators.forEach(ind => ind.remove());
            activeTeleportIndicators = [];

            // Only allow teleport indicators on the active player's turn
            if (typeof canTakeAction === 'function' && !canTakeAction()) return;

            const { shrine: currentShrine, isCatacombLike, isElementalCenter } = catacombEligibility();
            if (!currentShrine || !isCatacombLike(currentShrine)) return;

            // Find all REVEALED elemental shrine centers (not flipped) WITHOUT stones on them
            const otherCatacombs = placedTiles.filter(tile => {
                if (!isElementalCenter(tile)) return false;
                if (tile.flipped) return false; // Only revealed shrines
                if (Math.abs(tile.x - currentShrine.x) <= 5 && Math.abs(tile.y - currentShrine.y) <= 5) return false; // Same shrine
                
                // Check if there's a stone at the catacomb center
                const hasStone = placedStones.some(stone => {
                    const dist = Math.sqrt(Math.pow(stone.x - tile.x, 2) + Math.pow(stone.y - tile.y, 2));
                    return dist < 5; // Stone is at the center of this catacomb
                });

                // Check if another player is standing there
                const hasPlayer = playerPositions.some(p => {
                    if (!p) return false;
                    const dist = Math.sqrt(Math.pow(p.x - tile.x, 2) + Math.pow(p.y - tile.y, 2));
                    return dist < 5;
                });
                
                return !hasStone && !hasPlayer; // Only allow teleport to unoccupied shrines
            });

            if (otherCatacombs.length === 0) {
                const message = currentShrine.shrineType === 'catacomb'
                    ? 'Standing on catacomb shrine, but no valid elemental destinations! (must be revealed and have no stone on center)'
                    : 'Freedom active, but no valid elemental destinations! (must be revealed and have no stone on center)';
                updateStatus(message);
                return;
            }

            // Create visual indicators for teleport destinations
            otherCatacombs.forEach(shrine => {
                const indicator = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
                indicator.setAttribute('cx', shrine.x);
                indicator.setAttribute('cy', shrine.y);
                indicator.setAttribute('r', '11');
                indicator.setAttribute('fill', '#8b4513');
                indicator.setAttribute('opacity', '0.5');
                indicator.setAttribute('stroke', '#fff');
                indicator.setAttribute('stroke-width', '2');
                indicator.setAttribute('class', 'teleport-indicator');
                indicator.style.cursor = 'pointer';
                indicator.style.animation = 'catacomb-teleport-pulse 3s ease-in-out infinite';

                // Add click handler for teleportation
                indicator.addEventListener('click', (e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    if (typeof canTakeAction === 'function' && !canTakeAction()) {
                        updateStatus('Not your turn.');
                        return;
                    }

                    // Re-validate departure eligibility fresh — see
                    // catacombEligibility()'s comment. This indicator's own
                    // closure captured currentShrine/isCatacombLike from
                    // whenever it was drawn (e.g. during another player's
                    // Freedom-active turn), so trusting that snapshot here
                    // would let a leftover indicator be exploited after
                    // control passes to whoever's turn it is now.
                    const fresh = catacombEligibility();
                    if (!fresh.shrine || !fresh.isCatacombLike(fresh.shrine)) {
                        updateStatus('Cannot teleport - no catacomb/Freedom access from here anymore.');
                        updateCatacombIndicators();
                        return;
                    }

                    // Double-check no stone was placed since indicators were created
                    const hasStoneNow = placedStones.some(stone => {
                        const dist = Math.sqrt(Math.pow(stone.x - shrine.x, 2) + Math.pow(stone.y - shrine.y, 2));
                        return dist < 5;
                    });
                    
                    if (hasStoneNow) {
                        updateStatus('Cannot teleport there - a stone is blocking!');
                        updateCatacombIndicators();
                        return;
                    }

                    // Double-check no player moved there since indicators were created
                    const hasPlayerNow = playerPositions.some(p => {
                        if (!p) return false;
                        const dist = Math.sqrt(Math.pow(p.x - shrine.x, 2) + Math.pow(p.y - shrine.y, 2));
                        return dist < 5;
                    });

                    if (hasPlayerNow) {
                        updateStatus('Cannot teleport there - another player is in the way!');
                        updateCatacombIndicators();
                        return;
                    }

                    // Teleport player (no AP cost). Not undoable, and Undo must not
                    // reverse the move before it (that refunded its AP).
                    placePlayer(shrine.x, shrine.y);
                    clearUndo();
                    updateStatus(`Teleported to the ${shrine.shrineType} shrine!`);
                    if (window.isTutorialMode && window.TutorialMode?.onCatacombTeleport) {
                        window.TutorialMode.onCatacombTeleport();
                    }

                    // Broadcast teleport so other clients stay in sync
                    if (typeof isMultiplayer !== 'undefined' && isMultiplayer && typeof broadcastGameAction === 'function') {
                        const playerIndex = (typeof myPlayerIndex !== 'undefined' && myPlayerIndex !== null)
                            ? myPlayerIndex
                            : activePlayerIndex;
                        broadcastGameAction('catacomb-teleport', {
                            playerIndex,
                            x: shrine.x,
                            y: shrine.y
                        });
                    }

                    // Update indicators for new position
                    updateCatacombIndicators();
                });

                viewport.appendChild(indicator);
                activeTeleportIndicators.push(indicator);
            });

            const prompt = currentShrine.shrineType === 'catacomb'
                ? 'Standing on catacomb shrine. Click a revealed elemental shrine center to teleport (free).'
                : 'Freedom active. Click a revealed elemental shrine center to teleport (free).';
            updateStatus(prompt);
        }

        // Expose for scroll effects (e.g. Freedom)
        window.updateCatacombIndicators = updateCatacombIndicators;

        // ── Scroll Reference Panel ────────────────────────────────────────────────
        // Read-only in-game encyclopedia of all scrolls pulled from scroll-definitions.js.
        // Toggling calls remove so the button acts as open/close.
        function showScrollReferencePopup() {
            const existing = document.getElementById('scroll-ref-overlay');
            if (existing) { existing.remove(); return; }

            const ELEMENT_ORDER = ['earth', 'water', 'fire', 'wind', 'void', 'catacomb'];
            const elementColor = (el) => el === 'catacomb' ? '#c8a870' : (STONE_TYPES[el]?.color || '#aaa');

            const overlay = document.createElement('div');
            overlay.id = 'scroll-ref-overlay';
            overlay.className = 'retro-dlg-overlay';
            overlay.style.zIndex = '2000';
            overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

            const box = document.createElement('div');
            box.className = 'retro-dlg-box';
            box.style.cssText = `
                max-width: 540px; width: 95vw; max-height: 85vh;
                display: flex; flex-direction: column;
                padding: 0; overflow: hidden;
            `;

            // Header
            const header = document.createElement('div');
            header.style.cssText = `
                padding: 12px 16px; border-bottom: 1px solid #333;
                display: flex; align-items: center; justify-content: space-between;
                flex-shrink: 0;
            `;
            const titleEl = document.createElement('div');
            titleEl.textContent = 'Scroll Reference';
            titleEl.style.cssText = `font-family: var(--font-pixel); font-size: 14px; color: #e8dcc8; letter-spacing: 1px;`;
            const closeX = document.createElement('button');
            closeX.textContent = '×';
            closeX.className = 'retro-dlg-btn';
            closeX.style.cssText = `padding: 1px 10px; font-size: 20px; line-height: 1;`;
            closeX.onclick = () => overlay.remove();
            header.appendChild(titleEl);
            header.appendChild(closeX);
            box.appendChild(header);

            // Tab bar
            const tabBar = document.createElement('div');
            tabBar.style.cssText = `
                display: flex; flex-wrap: wrap; gap: 2px;
                padding: 8px 10px 0; background: #111; flex-shrink: 0;
                border-bottom: 1px solid #2a2a2a;
            `;
            ELEMENT_ORDER.forEach(el => {
                const c = elementColor(el);
                const tab = document.createElement('button');
                tab.dataset.element = el;
                tab.textContent = el.charAt(0).toUpperCase() + el.slice(1);
                tab.style.cssText = `
                    font-family: var(--font-pixel); font-size: 11px;
                    padding: 6px 11px; border: 1px solid ${c}44;
                    background: transparent; color: ${c}88; cursor: pointer;
                    border-radius: 3px 3px 0 0; letter-spacing: 1px;
                `;
                tab.addEventListener('click', () => switchTab(el));
                tabBar.appendChild(tab);
            });

            // Rulings tab
            const rulingsTab = document.createElement('button');
            rulingsTab.dataset.element = 'rulings';
            rulingsTab.textContent = 'Rulings';
            rulingsTab.style.cssText = `
                font-family: var(--font-pixel); font-size: 11px;
                padding: 6px 11px; border: 1px solid #aaa4;
                background: transparent; color: #aaa8; cursor: pointer;
                border-radius: 3px 3px 0 0; letter-spacing: 1px;
            `;
            rulingsTab.addEventListener('click', () => switchTab('rulings'));
            tabBar.appendChild(rulingsTab);

            box.appendChild(tabBar);

            // Scroll list content
            const content = document.createElement('div');
            content.style.cssText = `overflow-y: auto; flex: 1; padding: 12px 14px;`;
            box.appendChild(content);

            overlay.appendChild(box);
            document.body.appendChild(overlay);

            function switchTab(el) {
                const c = el === 'rulings' ? '#aaa' : elementColor(el);

                // Update tab button styles
                tabBar.querySelectorAll('button[data-element]').forEach(btn => {
                    const bc = btn.dataset.element === 'rulings' ? '#aaa' : elementColor(btn.dataset.element);
                    const active = btn.dataset.element === el;
                    btn.style.background  = active ? `${bc}1a` : 'transparent';
                    btn.style.color       = active ? bc : `${bc}88`;
                    btn.style.borderColor = active ? bc : `${bc}44`;
                });

                content.innerHTML = '';

                // Rulings tab — render official scroll rulings
                if (el === 'rulings') {
                    const rulings = typeof SCROLL_RULINGS !== 'undefined' ? SCROLL_RULINGS : {};
                    const scrollIds = Object.keys(rulings);
                    if (scrollIds.length === 0) {
                        content.innerHTML = `<div style="color:#ccc;font-family:var(--font-terminal);padding:20px;text-align:center;">No rulings recorded yet.</div>`;
                        return;
                    }
                    const sectionLabel = document.createElement('div');
                    sectionLabel.textContent = 'Official Scroll Rulings';
                    sectionLabel.style.cssText = `font-family:var(--font-pixel);font-size:11px;color:#aaa;letter-spacing:2px;margin-bottom:12px;text-transform:uppercase;`;
                    content.appendChild(sectionLabel);

                    scrollIds.forEach(scrollId => {
                        const pattern = spellSystem?.patterns?.[scrollId];
                        const scrollRulings = rulings[scrollId];
                        if (!pattern || !scrollRulings) return;
                        const rc = elementColor(pattern.element);

                        const card = document.createElement('div');
                        card.style.cssText = `
                            border-left: 3px solid ${rc}; background: ${rc}0d;
                            border-radius: 0 4px 4px 0; padding: 10px 12px;
                            margin-bottom: 8px;
                        `;

                        const nameRow = document.createElement('div');
                        nameRow.style.cssText = `display:flex;align-items:baseline;gap:8px;margin-bottom:8px;`;
                        const nameEl = document.createElement('span');
                        nameEl.textContent = pattern.name;
                        nameEl.style.cssText = `font-family:var(--font-terminal);font-size:17px;color:${rc};`;
                        const lvl = document.createElement('span');
                        lvl.textContent = `${pattern.element.charAt(0).toUpperCase() + pattern.element.slice(1)} Lv ${pattern.level}`;
                        lvl.style.cssText = `font-family:var(--font-pixel);font-size:10px;color:#ccc;letter-spacing:1px;`;
                        nameRow.appendChild(nameEl);
                        nameRow.appendChild(lvl);
                        card.appendChild(nameRow);

                        scrollRulings.forEach(ruling => {
                            const row = document.createElement('div');
                            row.style.cssText = `display:flex;gap:8px;margin-bottom:6px;`;
                            const bullet = document.createElement('span');
                            bullet.textContent = '•';
                            bullet.style.cssText = `color:${rc};font-size:14px;flex-shrink:0;margin-top:1px;`;
                            const text = document.createElement('span');
                            text.textContent = ruling;
                            text.style.cssText = `font-family:var(--font-terminal);font-size:14px;color:#bbb;line-height:1.45;`;
                            row.appendChild(bullet);
                            row.appendChild(text);
                            card.appendChild(row);
                        });

                        content.appendChild(card);
                    });
                    return;
                }

                // Build list
                const scrollNames = (typeof SCROLL_DECKS !== 'undefined' && SCROLL_DECKS[el]) || [];

                if (scrollNames.length === 0) {
                    content.innerHTML = `<div style="color:#ccc;font-family:var(--font-terminal);padding:20px;text-align:center;">No scrolls found.</div>`;
                    return;
                }

                scrollNames.forEach(scrollName => {
                    const pattern = spellSystem?.patterns?.[scrollName];
                    if (!pattern) return;

                    const card = document.createElement('div');
                    // scroll-ref-row + data-scrollName: recognized by
                    // scroll-panels.js's findHoverable() so hovering shows
                    // the same .fsp-card-preview a Hand/Active/Common card
                    // shows (pattern diagram included) — see _buildCard()/
                    // _initCardHoverPreview(). Replaces the old click-to-open
                    // showScrollInfoPopup() pattern-only popup.
                    card.className = 'scroll-ref-row';
                    card.dataset.scrollName = scrollName;
                    card.style.cssText = `
                        border-left: 3px solid ${c}; background: ${c}0d;
                        border-radius: 0 4px 4px 0; padding: 10px 12px;
                        margin-bottom: 8px;
                    `;

                    // Name + level row
                    const nameRow = document.createElement('div');
                    nameRow.style.cssText = `display: flex; align-items: baseline; gap: 8px; margin-bottom: 4px;`;

                    const nameEl = document.createElement('span');
                    nameEl.textContent = pattern.name;
                    nameEl.style.cssText = `font-family: var(--font-terminal); font-size: 17px; color: ${c};`;

                    const lvl = document.createElement('span');
                    lvl.textContent = `Lv ${pattern.level}`;
                    lvl.style.cssText = `font-family: var(--font-pixel); font-size: 10px; color: #ccc; letter-spacing: 1px;`;

                    nameRow.appendChild(nameEl);
                    nameRow.appendChild(lvl);
                    card.appendChild(nameRow);

                    const descEl = document.createElement('div');
                    descEl.textContent = pattern.description;
                    descEl.style.cssText = `font-family: var(--font-terminal); font-size: 14px; color: #aaa; line-height: 1.45;`;
                    card.appendChild(descEl);

                    const hint = document.createElement('div');
                    hint.textContent = 'hover for pattern';
                    hint.style.cssText = `font-family: var(--font-pixel); font-size: 9px; color: ${c}55; margin-top: 5px; letter-spacing: 1px;`;
                    card.appendChild(hint);

                    content.appendChild(card);
                });
            }

            switchTab('earth');
        }

        window.showScrollReferencePopup = showScrollReferencePopup;

        // Generate spiral tile positions starting from center
        // Based on the spiral pattern from the image: 1(center), 2(SE), 3(SW), 4(W), 5(NW), 6(NE), 7(E), then ring 2...
        function generateSpiralPositions(numTiles) {
            const positions = [];
            const largeHexSize = TILE_SIZE * 4; // Grid size for tile snapping

            // Predefined spiral path in axial coordinates (q, r)
            // 6 tiles per player (one of each shrine type)
            const spiralPath = [
                { q: 0, r: 0 },    // 1 - Center
                { q: 0, r: 1 },    // 2 - SE
                { q: -1, r: 1 },   // 3 - SW
                { q: -1, r: 0 },   // 4 - W
                { q: 0, r: -1 },   // 5 - NW
                { q: 1, r: -1 },   // 6 - NE (1 player complete - 6 tiles)
                { q: 1, r: 0 },    // 7 - E
                { q: 1, r: 1 },    // 8 - SE (ring 2)
                { q: 0, r: 2 },    // 9
                { q: -1, r: 2 },   // 10
                { q: -2, r: 2 },   // 11
                { q: -2, r: 1 },   // 12 (2 players complete - 12 tiles)
                { q: -2, r: 0 },   // 13
                { q: -1, r: -1 },  // 14
                { q: 0, r: -2 },   // 15
                { q: 1, r: -2 },   // 16
                { q: 2, r: -2 },   // 17
                { q: 2, r: -1 },   // 18 (3 players complete - 18 tiles)
                { q: 2, r: 0 },    // 19
                { q: 2, r: 1 },    // 20
                { q: 1, r: 2 },    // 21 (ring 3)
                { q: 0, r: 3 },    // 22
                { q: -1, r: 3 },   // 23
                { q: -2, r: 3 },   // 24 (4 players complete - 24 tiles)
                { q: -3, r: 3 },   // 25
                { q: -3, r: 2 },   // 26
                { q: -3, r: 1 },   // 27
                { q: -3, r: 0 },   // 28
                { q: -2, r: -1 },  // 29
                { q: -1, r: -2 },  // 30 (5 players complete - 30 tiles)
                { q: 0, r: -3 },   // 31 (extra positions for future)
                { q: 1, r: -3 },   // 32
                { q: 2, r: -3 },   // 33
                { q: 3, r: -3 },   // 34
                { q: 3, r: -2 },   // 35
                { q: 3, r: -1 },   // 36
            ];

            // Convert to pixel positions
            for (let i = 0; i < Math.min(numTiles, spiralPath.length); i++) {
                const pos = hexToPixel(spiralPath[i].q, spiralPath[i].r, largeHexSize);
                positions.push({ x: pos.x, y: pos.y });
            }

            return positions;
        }

        // Stop any currently-running local bot job (spectate/run/evolve) and
        // wait for it to actually finish — BotArena.isRunning() covers all
        // three, checked between turns/generations, which can take a few
        // seconds. Returns false (with a status message already shown) if it
        // couldn't be stopped in time. Shared by the dev cheat panel and the
        // Profile-header bot training panel below — hoisted out of either
        // panel's own IIFE so both call the same instance instead of two
        // independently-maintained copies of correctness-sensitive cleanup.
        async function stopAnyRunningBotJob() {
            if (!window.BotArena.isRunning()) return true;
            updateStatus('Stopping the current bot job…');
            for (let i = 0; i < 100 && window.BotArena.isRunning(); i++) {
                window.BotArena.stop();
                await new Promise(r => setTimeout(r, 300));
            }
            if (window.BotArena.isRunning()) {
                updateStatus('Could not stop the running bot job');
                return false;
            }
            return true;
        }

        // Leave the current online room if we're in one — bot jobs
        // (spectate/run/evolve) run local hot-seat games and would otherwise
        // collide with a live multiplayer session. Shared, see note above.
        async function leaveOnlineGameIfAny() {
            if (!isMultiplayer) return;
            updateStatus('Leaving the online game…');
            if (isHost && currentGameId) {
                try {
                    const { data: players } = await supabase.from('players')
                        .select('id, username').eq('game_id', currentGameId);
                    for (const p of (players || []).filter(p => window.isBotUsername?.(p.username))) {
                        await supabase.rpc('remove_player', { p_player_id: p.id });
                    }
                } catch (e) { console.warn('bot-row cleanup failed (continuing):', e); }
            }
            if (typeof _doLeaveGame === 'function') await _doLeaveGame();
        }

        // Run one weight-training cycle: evolve() a population, then CONFIRM
        // the champion actually beats the pre-training weights in a real
        // series before keeping it (reverting to the exact prior
        // localStorage value otherwise) — see the "Confirmation gate" note
        // at this function's cheat-panel call site for why. opts.nPlayers
        // (default 2) and opts.visual (default false, i.e. muted/fast) let
        // a caller choose training-game size and pacing without changing
        // the function's own default behavior for existing callers.
        async function runWeightTraining(preset, onProgress, opts = {}) {
            const { generations, gamesPerPair, popSize, confirmGames } = preset;
            const nPlayers = opts.nPlayers ?? 2;
            // 'all' = generalist: evolve across mixed 2–5-player arenas, then
            // confirm the champion across every size (confirmAcrossSizes),
            // instead of the fixed-count evolve + 2-player run() gate.
            const allSizes = nPlayers === 'all';
            const confirmSizes = [2, 3, 4, 5];
            const gamesPerSize = preset.gamesPerSize ?? 4;
            const visual = !!opts.visual;
            const baselineWeights = { ...window.BotSystem.WEIGHTS };
            let baselineStored = null;
            try { baselineStored = localStorage.getItem('godaigo_bot_weights'); } catch (e) {}
            await leaveOnlineGameIfAny();

            // Noisy anchor (opts.noisyAnchor): seed the population from a
            // perturbed copy of the live weights so evolution starts displaced
            // and generalizes, while the confirmation gate below still compares
            // against baselineWeights (the TRUE, unperturbed live table).
            const seedWeights = (opts.noisyAnchor && typeof window.BotArena.perturbWeights === 'function')
                ? [window.BotArena.perturbWeights(baselineWeights)]
                : undefined;

            const pairs = popSize * (popSize - 1) / 2;
            const sampledPerGen = opts.gamesPerGen ?? popSize * 2;
            const confirmTotal = allSizes ? confirmSizes.length * gamesPerSize : confirmGames;
            const totalGames = ((allSizes || nPlayers > 2) ? sampledPerGen * generations : pairs * gamesPerPair * generations) + confirmTotal;
            const startedAt = Date.now();
            let gamesDone = 0, lastGen = 0, lastFitness = null;
            const stats = makeTrainingStats();
            const report = (phase) => onProgress({
                phase, gamesDone, totalGames, startedAt,
                gen: lastGen, generations, fitness: lastFitness,
                nPlayers, popSize, mode: 'training', stats,
            });

            const champion = await window.BotArena.evolve(generations, {
                gamesPerPair, popSize, nPlayers, visual, seedWeights,
                seed: 1 + Math.floor(Math.random() * 1e6), // fresh per run (default 1 repeated every run)
                gamesPerGen: (allSizes || nPlayers > 2) ? sampledPerGen : undefined,
                onGeneration: (gen, total, fitness) => {
                    lastGen = gen; lastFitness = fitness;
                    const best = Array.isArray(fitness) && fitness.length ? Math.max(...fitness) : null;
                    stats.event(`Generation ${gen}/${total} done${best !== null ? `, best fitness ${best.toFixed(1)}` : ''}`);
                    report('training');
                },
                onGame: (n, t, g) => { gamesDone++; stats.addGame(g); report('training'); },
            });

            // stop() during the evolve phase only cuts THAT phase short —
            // run() resets the same shared _stopRequested flag the instant
            // it starts, so without this check a cancelled evolve() would
            // silently still run the full (un-stoppable) confirmation
            // series behind it. Treat an early stop like "did not improve":
            // discard whatever evolve() got to and revert to the exact
            // pre-training weights.
            if (window.BotArena.stopRequested()) {
                window.BotArena.applyWeights(baselineWeights);
                try {
                    if (baselineStored === null) localStorage.removeItem('godaigo_bot_weights');
                    else localStorage.setItem('godaigo_bot_weights', baselineStored);
                } catch (e) {}
                return { improved: false, record: 'stopped' };
            }

            report('confirming');
            let improved, record, confirmWins, confirmLosses, confirmDraws;
            if (allSizes) {
                // Generalist gate: champion vs a field of baselines at every
                // size (2–5), rotating seats. Kept only if it's a better
                // generalist overall, not just a better duelist.
                const confirm = await window.BotArena.confirmAcrossSizes(
                    champion, baselineWeights,
                    { sizes: confirmSizes, gamesPerSize, visual, seed: Date.now() % 100000,
                      onGame: (n, t, g) => { gamesDone++; stats.addGame(g); report('confirming'); } });
                improved = confirm.improved;
                record = confirm.record;
                confirmWins = confirm.champWins; confirmLosses = confirm.baseWins; confirmDraws = confirm.draws;
            } else {
                const confirm = await window.BotArena.run(
                    champion, baselineWeights, confirmGames, Date.now() % 100000,
                    { visual, onGame: (n, t, g) => { gamesDone++; stats.addGame(g); report('confirming'); } });
                improved = confirm.aFitness > confirm.bFitness;
                record = `${confirm.aWins}-${confirm.bWins}` + (confirm.draws ? ` (${confirm.draws} draws)` : '');
                confirmWins = confirm.aWins; confirmLosses = confirm.bWins; confirmDraws = confirm.draws;
            }

            // Stop pressed DURING the confirmation: the check is incomplete, so
            // never apply or share the result. Revert like a stop mid-training.
            if (window.BotArena.stopRequested()) {
                window.BotArena.applyWeights(baselineWeights);
                try {
                    if (baselineStored === null) localStorage.removeItem('godaigo_bot_weights');
                    else localStorage.setItem('godaigo_bot_weights', baselineStored);
                } catch (e) {}
                return { improved: false, record: 'stopped' };
            }

            if (improved) {
                // Local only (owner 2026-09-26): Evolve's gate compares against
                // this browser's current weights over a few games, too weak to
                // replace the shared champion. To share an Evolve result, use
                // Hill Climb with Explore, which must beat the online champion.
                window.BotArena.applyWeights(champion);
            } else {
                window.BotArena.applyWeights(baselineWeights);
                try {
                    if (baselineStored === null) localStorage.removeItem('godaigo_bot_weights');
                    else localStorage.setItem('godaigo_bot_weights', baselineStored);
                } catch (e) {}
            }
            return { improved, record };
        }

        // ─── Hill Climb training (separate method from evolve() above) ──────
        // Wraps BotArena.hillClimb() the same way runWeightTraining() wraps
        // evolve() — a champion-anchored (1+λ) monotonic climber, distinct
        // from evolve()'s population GA (see docs/bot-roadmap.md § STAGE 3a
        // and the tools/arena-headless.mjs --hillclimb CLI this mirrors).
        // Two things this MUST get right, both hard-learned from the CLI's
        // own history (planning/current.md):
        //   1. Anchor explicitly to the ONLINE champion via a direct,
        //      awaited Supabase query — never trust window.BotSystem.WEIGHTS
        //      already holding it, since bot.js's own background
        //      loadCommunityChampion() fetch is async/racy and could still
        //      be in flight (or have silently no-opped) when this starts.
        //      ABORT with a clear error rather than silently falling back to
        //      whatever WEIGHTS currently holds — a hillclimb session that
        //      thinks it's anchored to the champion but is actually anchored
        //      to defaults produces a champion that beats defaults but loses
        //      online, with no indication anything went wrong.
        //   2. A round-level promotion is NOT trustworthy on its own (30-game
        //      trials are noisy) — always run a separate confirm series
        //      against the true baseline before ever applying/submitting.
        // hillClimb() itself is 2-player only (champion vs. mutant
        // challengers) — no nPlayers concept, unlike evolve(). The FINAL
        // confirmation, though, is played across every real table size
        // (2–5 players) via confirmAcrossSizes(): a promoted result is only
        // applied/submitted/rewarded if it's a better GENERALIST, not just a
        // better duelist. Keeps the reliable 2-player trainer while making
        // sure what ships to the shared champion holds up at big tables too.
        // ─── Bot talk during training (alliances, owner 2026-09-28) ────────
        // Every sentence the bots say in a training run (bot-diplomacy.js
        // onTalk, shown or not), newest first, for the popup's list.
        // {pN} becomes the seat's colour name, coloured.
        const trainTalk = [];
        let trainTalkHooked = false;
        function hookTrainTalk() {
            if (trainTalkHooked || !window.BotDiplomacy?.onTalk) return;
            trainTalkHooked = true;
            window.BotDiplomacy.onTalk(({ text }) => {
                if (!window.BotArena?.isRunning?.()) return;
                const html = String(text).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
                    .replace(/\{p(\d+)\}/g, (m, n) => {
                        const i = Number(n);
                        const name = typeof getPlayerColorName === 'function' ? getPlayerColorName(i) : `Player ${i + 1}`;
                        const hex = (typeof playerPositions !== 'undefined' && playerPositions[i]?.color) || '#ddd';
                        return `<span style="color:${hex};font-style:normal;font-weight:600;">${name}</span>`;
                    });
                trainTalk.unshift(html);
                if (trainTalk.length > 6) trainTalk.pop();
            });
        }
        function startTrainTalk(show) {
            hookTrainTalk();
            trainTalk.length = 0;
            window.BotDiplomacy?.setTalkInTraining?.(show !== false);
        }
        function renderTrainingTalk(el) {
            const box = el.querySelector('#bt-popup-talk');
            const label = el.querySelector('#bt-popup-talk-label');
            if (!box || !label) return;
            label.style.display = trainTalk.length ? 'block' : 'none';
            box.innerHTML = trainTalk.map(h => `<div>${h}</div>`).join('');
        }

        // ─── Saved training runs (owner request 2026-09-27) ───────────────
        // A Hill Climb run saves itself after every challenger series and
        // every Explore generation (localStorage, this browser only), so it
        // can be finished later: "Save & quit" in the popup, or a closed tab.
        // Train Bot then offers "Continue saved run". Cleared when a run ends
        // (finished, stopped, ended early). The final 2-5 player test is not
        // saved: it runs again in full after a continue.
        const TRAIN_SAVE_KEY = 'godaigo_train_save';
        function readTrainSave() {
            try { const v = JSON.parse(localStorage.getItem(TRAIN_SAVE_KEY) || 'null'); return v && v.v === 1 ? v : null; } catch (e) { return null; }
        }
        function writeTrainSave(o) { try { localStorage.setItem(TRAIN_SAVE_KEY, JSON.stringify(o)); } catch (e) { console.warn('training save failed:', e); } }
        function clearTrainSave() { try { localStorage.removeItem(TRAIN_SAVE_KEY); } catch (e) {} }
        function describeTrainSave(sv) {
            if (!sv) return '';
            const when = new Date(sv.savedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
            const where = sv.phase === 'explore'
                ? `Explore ${sv.explore?.gensDone || 0}/${EXPLORE_GENERATIONS} done`
                : `round ${Math.min((sv.climb?.round || 0) + 1, sv.preset.rounds)} of ${sv.preset.rounds}`;
            return `${where}, ${sv.gamesDone || 0} games played, saved ${when}`;
        }
        window._trainSaveWanted = false;
        let trainPhase = null; // 'exploring' | 'training' | 'confirming' (Save & quit only before confirming)

        async function runHillClimbTraining(preset, onProgress, opts = {}) {
            const resume = opts.resume || null;
            if (resume) { preset = resume.preset; opts = { ...opts, ...resume.runOpts }; }
            else clearTrainSave(); // a new run replaces any older saved one
            window._trainSaveWanted = false;
            const { rounds, lambda, gamesPerChallenge } = preset;
            const confirmSizes = (preset.confirmSizes && preset.confirmSizes.length) ? preset.confirmSizes : [2, 3, 4, 5];
            const gamesPerSize = preset.gamesPerSize ?? 5;
            const visual = !!opts.visual;

            // Single anchor: the ONE shared community bot brain
            // (bot_champion_weights). The climb starts from it and a promoted
            // result must beat it in the confirm series before it's applied /
            // submitted / rewarded. Anchor explicitly via a direct awaited
            // query — never trust window.BotSystem.WEIGHTS already holding it
            // (bot.js's own loadCommunityChampion() is async/racy). ABORT with
            // a clear error rather than silently anchoring to defaults.
            let baseline;
            try {
                if (typeof supabase === 'undefined' || !supabase?.from) throw new Error('no Supabase client on this page');
                const { data, error } = await supabase.from('bot_champion_weights')
                    .select('weights, win_rate').order('promoted', { ascending: false }).order('created_at', { ascending: false }).limit(1); // current champion, sql/champion-promoted.sql
                if (error) throw new Error(error.message);
                if (!data?.length || !data[0].weights || typeof data[0].weights !== 'object') throw new Error('no champion rows in bot_champion_weights');
                baseline = data[0].weights;
            } catch (e) {
                throw new Error(`Hill Climb needs the online champion to anchor to, not defaults - couldn't fetch it (${e.message}). Try again when online.`);
            }

            // Noisy anchor (opts.noisyAnchor): climb from a perturbed copy of
            // the anchor so the champion generalizes, but keep `baseline` (the
            // TRUE anchor) for the confirmation run below — a win must still be
            // a win against the real thing. Falls back to the exact anchor when
            // BotArena.perturbWeights is somehow unavailable.
            const climbAnchor = resume ? resume.climbAnchor
                : (opts.noisyAnchor && typeof window.BotArena.perturbWeights === 'function')
                ? window.BotArena.perturbWeights(baseline)
                : baseline;

            const baselineWeights = { ...window.BotSystem.WEIGHTS };
            let baselineStored = null;
            try { baselineStored = localStorage.getItem('godaigo_bot_weights'); } catch (e) {}
            await leaveOnlineGameIfAny();

            let totalGames = rounds * lambda * gamesPerChallenge + confirmSizes.length * gamesPerSize;
            const startedAt = Date.now() - (resume?.elapsedMs || 0);
            let gamesDone = resume?.gamesDone || 0, lastRound = 0, lastInfo = null, lastGen = 0, lastFitness = null;
            let lastChallenger = 0, totalChallengers = lambda;
            let lastGameNum = 0, lastGameTotal = gamesPerChallenge;
            // "How rounds have gone" summary the popup renders as a compact
            // chip strip — one entry per completed round, oldest first.
            const roundHistory = Array.isArray(resume?.roundHistory) ? resume.roundHistory.slice() : [];
            const stats = makeTrainingStats();
            if (resume) stats.event(`Continuing a saved run (${describeTrainSave(resume)})`);
            // One save object for the whole run; each checkpoint updates it.
            const hcSeed = resume?.hcSeed || (1 + Math.floor(Math.random() * 1e6));
            const save = resume ? { ...resume } : {
                v: 1, preset, runOpts: { visual: !!opts.visual, noisyAnchor: !!opts.noisyAnchor, explore: !!opts.explore, formulas: !!opts.formulas, public: !!opts.public },
                climbAnchor, hcSeed, phase: opts.explore ? 'explore' : 'climb', explore: null, climb: null,
            };
            const persist = (patch) => {
                Object.assign(save, patch, { savedAt: Date.now(), gamesDone, roundHistory, elapsedMs: Date.now() - startedAt });
                writeTrainSave(save);
            };
            const savedResult = () => {
                window.BotArena.applyWeights(baselineWeights);
                try {
                    if (baselineStored === null) localStorage.removeItem('godaigo_bot_weights');
                    else localStorage.setItem('godaigo_bot_weights', baselineStored);
                } catch (e) {}
                return { improved: false, record: 'saved', promotions: 0, saveInfo: describeTrainSave(readTrainSave()) };
            };
            let lastExploredChallenger = false; // current challenger = the explored bot
            let lastChallengerTerms = [];       // [{text, w, isNew}] of the current challenger (formulas box)
            let termMutations = !!opts.formulas; // challengers may invent formulas (panel option or Formula Lab)
            const needPct = Math.round((window.BotArena.HILLCLIMB_PROMOTE_RATE ?? 0.58) * 100);
            // Local-game color assignment (game-core.js's colorRankOrder):
            // player index 0 = Purple, 1 = Yellow (only the first two matter —
            // every trial here is 2-player). _playSeries alternates who's
            // player 0 each game (i%2===0), so this is recomputed from the
            // CURRENT game number every report, not a fixed assignment.
            // Hex values match config.js's PLAYER_COLORS exactly.
            function sideColors() {
                if (!lastGameNum) return { aName: '-', bName: '-', aHex: '#555', bHex: '#555' };
                const aIsPlayer0 = (lastGameNum - 1) % 2 === 0;
                return aIsPlayer0
                    ? { aName: 'Purple', bName: 'Yellow', aHex: '#9458f4', bHex: '#ffce00' }
                    : { aName: 'Yellow', bName: 'Purple', aHex: '#ffce00', bHex: '#9458f4' };
            }
            const report = (phase) => {
                trainPhase = phase;
                const { aName, bName, aHex, bHex } = sideColors();
                onProgress({
                    phase, gamesDone, totalGames, startedAt, mode: 'hillclimb',
                    round: lastRound, rounds, info: lastInfo, roundHistory,
                    challenger: lastChallenger, totalChallengers,
                    gameNum: lastGameNum, gameTotal: lastGameTotal,
                    sideAColor: aName, sideBColor: bName, sideAHex: aHex, sideBHex: bHex,
                    stats, explore: !!opts.explore, explored: lastExploredChallenger,
                    formulas: !!termMutations, challengerTerms: lastChallengerTerms,
                    gen: lastGen, generations: EXPLORE_GENERATIONS, fitness: lastFitness,
                });
            };

            // Explore phase (opts.explore): short Evolve search across 2-5
            // player games seeded from the anchor; its champion becomes the
            // first round-1 challenger (must still beat the real champion).
            let seedChallengers = resume?.seedChallengers, explored = !!resume?.explored, exploreEndedEarly = false;
            if (opts.explore && !(resume && resume.phase === 'climb')) {
                totalGames += EXPLORE_GAMES;
                const gensBefore = resume?.explore?.gensDone || 0;
                const exploreSeeds = resume?.explore?.seeds || [climbAnchor];
                stats.event(gensBefore ? `Explore: carrying on from generation ${gensBefore}` : 'Explore: searching across 2-5 player games first');
                lastGen = gensBefore;
                let found = gensBefore >= EXPLORE_GENERATIONS ? exploreSeeds[0] : null;
                if (!found) found = await window.BotArena.evolve(EXPLORE_GENERATIONS - gensBefore, {
                    popSize: EXPLORE_POP, nPlayers: 'all', gamesPerGen: EXPLORE_GAMES_PER_GEN,
                    visual, seedWeights: exploreSeeds, seed: Date.now() % 100000,
                    onGeneration: (gen, total, fitness, roster) => {
                        lastGen = gensBefore + gen; lastFitness = fitness;
                        const best = Array.isArray(fitness) && fitness.length ? Math.max(...fitness) : null;
                        stats.event(`Explore generation ${lastGen}/${EXPLORE_GENERATIONS} done${best !== null ? `, best fitness ${best.toFixed(1)}` : ''}`);
                        // The two best carry the search on after a continue.
                        if (Array.isArray(roster) && roster.length) persist({ phase: 'explore', explore: { gensDone: lastGen, seeds: roster.slice(0, 2).map(r => r.w) } });
                        report('exploring');
                    },
                    onGame: (n, t, g) => {
                        gamesDone++; stats.addGame(g);
                        if (window.BotArena.endEarlyRequested()) exploreEndedEarly = true;
                        report('exploring');
                    },
                });
                if (window._trainSaveWanted) {
                    if (!readTrainSave()) persist({ phase: 'explore', explore: { gensDone: gensBefore, seeds: exploreSeeds } });
                    return savedResult();
                }
                if (window.BotArena.stopRequested()) {
                    clearTrainSave();
                    window.BotArena.applyWeights(baselineWeights);
                    try {
                        if (baselineStored === null) localStorage.removeItem('godaigo_bot_weights');
                        else localStorage.setItem('godaigo_bot_weights', baselineStored);
                    } catch (e) {}
                    return { improved: false, record: 'stopped', promotions: 0 };
                }
                if (exploreEndedEarly) {
                    // End Early while exploring: nothing has been tested against
                    // the champion yet, so there is nothing to confirm.
                    clearTrainSave();
                    window.BotArena.applyWeights(baselineWeights);
                    return { improved: false, record: 'ended early', promotions: 0, endedEarly: true, attemptGold: 0, totalGold: 0 };
                }
                if (found) {
                    seedChallengers = [found]; explored = true;
                    stats.event('Explore done: its best bot joins round 1 as Challenger 1');
                }
            }

            // Formula Lab (hermit): queued formula ideas join round 1, each as
            // the champion plus that one term; "invent" also lets this run's
            // challengers gain / lose / change formulas. Used once. The panel's
            // "Formulas: Invent" option (opts.formulas) turns inventing on for
            // anyone.
            if (termMutations) stats.event('New senses: challengers may invent formulas this run');
            if (resume?.termMutations) termMutations = true;
            const lab = (!resume && window.isHermit?.() && window.FormulaLab) ? window.FormulaLab.takeQueued(climbAnchor) : null;
            if (lab) {
                if (lab.count) {
                    seedChallengers = [...(seedChallengers || []), ...lab.challengers].slice(0, lambda);
                    stats.event(`Formula Lab: ${Math.min(lab.count, lambda - (explored ? 1 : 0))} idea(s) join round 1`);
                }
                if (lab.invent && !termMutations) {
                    termMutations = true;
                    stats.event('Formula Lab: training may invent new formulas this run');
                }
            }

            if (!(resume && resume.phase === 'climb')) persist({ phase: 'climb', climb: null, seedChallengers: seedChallengers || null, explored, termMutations });
            const result = await window.BotArena.hillClimb({
                seedChallengers, termMutations,
                champion: resume?.climb?.champion || climbAnchor, rounds, lambda, gamesPerChallenge, visual,
                resume: resume?.phase === 'climb' ? resume.climb : null,
                onCheckpoint: (cp) => persist({ phase: 'climb', climb: cp }),
                // A fresh seed per run: with the default (1) every run from the
                // same champion tried the SAME challengers on the same decks,
                // so repeated Train Bot runs mostly redid each other's work.
                seed: hcSeed,
                // Hermit only (puzzles are hermit-only data): a would-be new
                // champion must also do at least as well on the puzzles
                // (combos from players' games, Replays > Puzzles).
                puzzleCheck: (window.isHermit?.() && window.Replay?.puzzleScore) ? (w => window.Replay.puzzleScore(w)) : undefined,
                // onRound alone only updates once per ROUND — a round is
                // lambda*gamesPerChallenge games (180 by default) played
                // sequentially in this one tab (no --shards parallelism like
                // the CLI), so without onChallenger/onGame the popup would sit
                // frozen for however long that takes, looking dead rather than
                // slow, AND never say which of the lambda challengers is
                // currently up (onGame's own game count resets to 1/N for
                // every challenger, so it alone can't distinguish them).
                onChallenger: (c, totalC, r, totalR, orig, w) => {
                    lastChallenger = orig || c; totalChallengers = totalC; lastRound = r; lastGameNum = 0;
                    const had = new Set((climbAnchor.terms || []).map(t => t.text));
                    lastChallengerTerms = (w?.terms || []).map(t => ({ text: t.text, w: t.w, isNew: !had.has(t.text) }));
                    lastExploredChallenger = explored && r === 1 && (orig || c) === 1;
                    stats.cur = { w: 0, l: 0, d: 0 }; report('training');
                },
                onGame: (gameNum, gameTotal, g, side) => {
                    gamesDone++; lastGameNum = gameNum; lastGameTotal = gameTotal;
                    stats.addGame(g, side, { a: lastExploredChallenger ? 'The explored bot' : `Challenger ${lastChallenger}`, b: 'Champion' });
                    report('training');
                },
                onRound: (round, total, info) => {
                    lastRound = round; lastInfo = info; gamesDone = info.gamesPlayed;
                    roundHistory.push({ round, promoted: info.promoted, winRate: info.bestWinRate, decided: info.bestDecided });
                    const pctBest = Math.round((info.bestWinRate || 0) * 100);
                    const fromExplore = explored && round === 1 && info.bestChallenger === 1;
                    stats.event(info.promoted
                        ? `Round ${round}: new champion${fromExplore ? ' (the explored bot)' : ''}! It won ${pctBest}% of ${info.bestDecided} decided games`
                        : info.puzzle?.blocked
                            ? `Round ${round}: challenger won ${pctBest}% but did worse on the puzzles (${info.puzzle.challenger} vs ${info.puzzle.champion}), champion stays`
                            : `Round ${round}: champion stays. Best challenger won ${pctBest}% of ${info.bestDecided} (needs ${needPct}%)`);
                    report('training');
                },
            });

            if (result.saved) return savedResult();
            // Past this point the run always ends: no save to continue.
            clearTrainSave();
            if (window.BotArena.stopRequested()) {
                window.BotArena.applyWeights(baselineWeights);
                try {
                    if (baselineStored === null) localStorage.removeItem('godaigo_bot_weights');
                    else localStorage.setItem('godaigo_bot_weights', baselineStored);
                } catch (e) {}
                return { improved: false, record: 'stopped', promotions: result.promotions };
            }

            lastGameNum = 0; lastGameTotal = confirmSizes.length * gamesPerSize;
            if (termMutations && result.promotions > 0) {
                const had = new Set((climbAnchor.terms || []).map(t => t.text));
                const fresh = (result.champion.terms || []).filter(t => !had.has(t.text));
                stats.event(fresh.length
                    ? `The climbed bot has ${fresh.length} new sense${fresh.length === 1 ? '' : 's'}: ${fresh.slice(0, 2).map(t => `${t.w < 0 ? 'avoids' : 'likes'} ${window.BotTerms?.describe ? window.BotTerms.describe(t.text) : t.text}`).join('; ')}${fresh.length > 2 ? '; ...' : ''}`
                    : 'The climbed bot won without new senses (it only changed numbers)');
            }
            report('confirming');
            // Multi-size gate: pit the climbed champion against a FIELD of the
            // current champion at 2/3/4/5 players, rotating seats. "Improved"
            // = better total seat-fitness across every size (a better
            // generalist). Also require that hillClimb() actually promoted
            // something in the 2-player climb — otherwise result.champion IS
            // the baseline and any "improvement" here is pure noise.
            // No promotion = the climbed bot IS the champion: nothing to test,
            // so skip the (long, 2-5 player) final test. This is also what
            // made "End Early -> Test Now" look dead (owner, 2026-09-27): it
            // still played every final-test game with nothing to test.
            const confirm = result.promotions > 0
                ? await window.BotArena.confirmAcrossSizes(
                    result.champion, baseline,
                    { sizes: confirmSizes, gamesPerSize, visual, seed: Date.now() % 100000,
                      onGame: (gameNum, gameTotal, g) => { gamesDone++; lastGameNum = gameNum; lastGameTotal = gameTotal; stats.addGame(g); report('confirming'); } })
                : { improved: false, record: 'no new champion to test', champWins: 0, baseWins: 0 };
            if (!result.promotions) stats.event('No new champion this run, so the final test was skipped');
            // Stop pressed DURING the confirmation: incomplete check, so no
            // apply, no submit and no gold. Revert like a stop mid-climb.
            if (window.BotArena.stopRequested()) {
                window.BotArena.applyWeights(baselineWeights);
                try {
                    if (baselineStored === null) localStorage.removeItem('godaigo_bot_weights');
                    else localStorage.setItem('godaigo_bot_weights', baselineStored);
                } catch (e) {}
                return { improved: false, record: 'stopped', promotions: result.promotions };
            }
            // End Early: fewer climbing rounds than planned. The run bonus
            // pays for training work, so an ended-early run gets none; a real
            // win in the full confirmation still earns the win gold below.
            const endedEarly = (result.rounds?.length || 0) < rounds;
            const improved = !!confirm.improved && result.promotions > 0;
            const record = confirm.record || `${confirm.champWins}-${confirm.baseWins}`;

            // DEGREE OF SUCCESS (reward tier): the champion's win share across
            // the whole 2–5-player confirm field. A brain equal to the current
            // champion wins ~0.32 of decided games here (the average fair seat
            // share across sizes 2–5, since it's outnumbered by baselines at
            // the big tables), so the tier bars sit well above that.
            const cw = confirm.champWins || 0, bw = confirm.baseWins || 0;
            const champShare = (cw + bw) ? cw / (cw + bw) : 0;
            let tier = null, tierGold = 0;
            if (improved) {
                if (champShare >= 0.55)      { tier = 'dominant'; tierGold = 60; }
                else if (champShare >= 0.42) { tier = 'solid';    tierGold = 40; }
                else                         { tier = 'marginal'; tierGold = 25; }
            }

            let uid = null;
            try { const { data } = await supabase.auth.getSession(); uid = data?.session?.user?.id || null; } catch (e) {}

            let rewarded = false, submitFailed = false, attemptGold = 0;

            if (improved) {
                // Beat the shared champion — apply locally and submit the new
                // champion for everyone. The tier gold below is only paid if
                // that INSERT lands.
                window.BotArena.applyWeights(result.champion);
                if (uid) {
                    try {
                        const { error } = await supabase.from('bot_champion_weights').insert({
                            weights: result.champion,
                            confirm_wins: confirm.aWins,
                            confirm_losses: confirm.bWins,
                            confirm_draws: confirm.draws,
                            promoted: true, // beat the current champion: it is the new one
                            created_by: uid,
                        });
                        if (error) { submitFailed = true; console.warn('Could not submit champion:', error); }
                        else rewarded = true;
                    } catch (e) { console.warn('champion submit failed (continuing):', e); }
                }
            } else {
                window.BotArena.applyWeights(baselineWeights);
                try {
                    if (baselineStored === null) localStorage.removeItem('godaigo_bot_weights');
                    else localStorage.setItem('godaigo_bot_weights', baselineStored);
                } catch (e) {}
            }

            // Run bonus: paid for completing a run, win or not — we WANT
            // people running these. Scaled to the COMPUTE actually contributed
            // (games played: the whole climb + the 2–5-player confirm), not
            // wall-clock — so a slow machine or "Watchable" speed doesn't
            // inflate it, and Deep runs (hundreds of games) pay far more than
            // Quick (~36). ~1g per 4 games, floor 8, cap 40 (kept under the
            // max champion-beating tier).
            if (uid && !endedEarly) {
                try {
                    const runGold = Math.max(8, Math.min(40, Math.round(gamesDone / 4)));
                    // Server-capped (60 per claim, 300 per day); returns what it granted.
                    const { data: granted, error } = await supabase.rpc('claim_training_reward', { p_amount: runGold, p_description: `Bot training - completed a ${gamesDone}-game run` });
                    if (error) throw error;
                    attemptGold = granted || 0;
                } catch (e) { console.warn('run bonus failed (continuing):', e); }
            }

            if (rewarded && tierGold) {
                try {
                    const { data: granted, error } = await supabase.rpc('claim_training_reward', { p_amount: tierGold, p_description: `Bot training - beat the champion (${tier})` });
                    if (error) throw error;
                    tierGold = granted || 0;
                    if (!tierGold) rewarded = false; // daily training cap reached
                } catch (e) { console.warn('tier gold failed (continuing):', e); rewarded = false; }
            }

            // Explore bonus: the extra search phase, paid only for a run that
            // finished (not stopped or ended early). Server-capped like the rest.
            if (uid && explored && !endedEarly) {
                try {
                    const { data: granted, error } = await supabase.rpc('claim_training_reward', { p_amount: EXPLORE_BONUS_GOLD, p_description: 'Bot training - explore phase bonus' });
                    if (error) throw error;
                    attemptGold += granted || 0;
                } catch (e) { console.warn('explore bonus failed (continuing):', e); }
            }

            // Formulas bonus (panel option "Formulas: Invent"): trying new
            // senses, paid only for a finished run; more when the new
            // champion keeps a formula it invented (a real discovery).
            let formulaGold = 0, formulaKept = false;
            if (uid && termMutations && !endedEarly) {
                const had = new Set((climbAnchor.terms || []).map(t => t.text));
                formulaKept = rewarded && (result.champion.terms || []).some(t => !had.has(t.text));
                const amount = FORMULA_BONUS_GOLD + (formulaKept ? FORMULA_DISCOVERY_GOLD : 0);
                try {
                    const { data: granted, error } = await supabase.rpc('claim_training_reward', {
                        p_amount: amount, p_description: formulaKept ? 'Bot training - new formula kept' : 'Bot training - formulas bonus' });
                    if (error) throw error;
                    formulaGold = granted || 0;
                } catch (e) { console.warn('formulas bonus failed (continuing):', e); }
            }

            const totalGold = attemptGold + formulaGold + (rewarded ? tierGold : 0);
            return { improved, record, tier, tierGold, promotions: result.promotions, rewarded, submitFailed, attemptGold, formulaGold, formulaKept, totalGold, endedEarly };
        }

        // ─── Training run stats (shown in the popup) ───────────────────────
        // One collector per run: every finished game (with how it ended),
        // challenger-vs-champion tallies for Hill Climb, and a short event
        // log (promotions, puzzle-blocked promotions, stalls).
        const STALL_NAMES = { camping: 'bots camping', no_cast: 'no casts', no_progress: 'no progress' };
        // Explore phase (Hill Climb opts.explore): a short Evolve search.
        const EXPLORE_GENERATIONS = 2, EXPLORE_POP = 6, EXPLORE_GAMES_PER_GEN = 12;
        const EXPLORE_GAMES = EXPLORE_GENERATIONS * EXPLORE_GAMES_PER_GEN;
        const EXPLORE_BONUS_GOLD = 10;
        // Formulas (Hill Climb option "Invent"): per finished run, plus more
        // when the new champion keeps a formula it invented.
        const FORMULA_BONUS_GOLD = 10, FORMULA_DISCOVERY_GOLD = 20;
        function makeTrainingStats() {
            return {
                games: 0, turnsSum: 0, chWins: 0, champWins: 0, draws: 0,
                stalls: { camping: 0, no_cast: 0, no_progress: 0 }, restarts: 0, stuck: 0, turnCap: 0,
                cur: null,           // current challenger {w, l, d}
                last: '',            // last game, one line
                events: [],          // newest first, max 6
                event(text) { this.events.unshift(text); if (this.events.length > 6) this.events.pop(); },
                // g = playMatch result; side = {aIsPlayer0, aWon} for A-vs-B series
                // (A = challenger in Hill Climb); label names the sides.
                addGame(g, side, label) {
                    if (!g) return;
                    this.games++;
                    this.turnsSum += g.turns || 0;
                    for (const [k, n] of Object.entries(g.stallReasons || {})) this.stalls[k] = (this.stalls[k] || 0) + n;
                    this.restarts += g.restarts || 0;
                    if (g.endReason === 'stuck') this.stuck++;
                    if (g.endReason === 'turn_cap') this.turnCap++;
                    const why = g.winner === null
                        ? (STALL_NAMES[g.endReason] ? `stalled, ${STALL_NAMES[g.endReason]}` : g.endReason === 'turn_cap' ? 'turn limit' : g.endReason === 'stuck' ? 'a bot got stuck' : 'no winner')
                        : '';
                    const restartNote = g.restarts ? ` (after ${g.restarts} restart${g.restarts === 1 ? '' : 's'})` : '';
                    if (side && label) {
                        if (g.winner === null) { this.draws++; if (this.cur) this.cur.d++; }
                        else if (side.aWon) { this.chWins++; if (this.cur) this.cur.w++; }
                        else { this.champWins++; if (this.cur) this.cur.l++; }
                        this.last = g.winner === null
                            ? `Draw after ${g.turns} turns - ${why}${restartNote}`
                            : `${side.aWon ? label.a : label.b} won in ${g.turns} turns${restartNote}`;
                    } else {
                        if (g.winner === null) this.draws++;
                        this.last = g.winner === null ? `Draw after ${g.turns} turns - ${why}${restartNote}` : `Seat ${g.winner + 1} won in ${g.turns} turns${restartNote}`;
                    }
                    if (g.stallReasons && Object.keys(g.stallReasons).length) {
                        const kinds = Object.entries(g.stallReasons).map(([k, n]) => `${STALL_NAMES[k] || k}${n > 1 ? ' x' + n : ''}`).join(', ');
                        this.event(`Stall (${kinds})${g.winner === null ? ', game ended as a draw' : ', restarted and finished'}`);
                    }
                },
            };
        }

        // ─── Persistent training-status popup ───────────────────────────────
        // Small fixed-corner popup showing live progress for whichever
        // Start Training run is active — visible the moment
        // a run starts, independent of whether the full "Bot Training"
        // modal is open, same spirit as the always-visible floating Hand/
        // Active/Common scroll panels (.fsp-* in css/styles.css) rather than
        // requiring a full-screen overlay to stay open just to see progress.
        // Deliberately defined at THIS outer scope (not inside
        // openBotTrainingPanel()) so it survives the modal being closed and
        // reopened: everything inside openBotTrainingPanel() — including its
        // own renderProgress()/progressText — is recreated fresh every time
        // the modal opens, but the onProgress/onGeneration callbacks a
        // running job is actually invoking were captured at whichever
        // moment it started, so a closed-and-reopened modal's fresh (empty)
        // UI never hears from an in-flight run. This popup is attached
        // directly to document.body and referenced by a stable outer
        // variable, so it keeps receiving updates regardless.
        let trainingPopupEl = null;
        function fmtPopupTime(s) { return s < 90 ? `${Math.round(s)}s` : `${Math.round(s / 60)}m`; }

        function ensureTrainingPopup() {
            if (trainingPopupEl) return trainingPopupEl;
            const el = document.createElement('div');
            el.id = 'bot-training-status-popup';
            // Fixed-corner positioning is bespoke to this floating popup, but the
            // header row reuses the SAME .panel-header/.panel-title/.hud-toggle-btn
            // classes every other HUD panel (Hand/Active/opponent Players, etc.)
            // uses — same visual language, not a one-off popup style. No emoji
            // anywhere in here — player-facing, and the user explicitly asked
            // for plain design elements (color swatches / chips) instead.
            el.style.cssText = 'position:fixed;bottom:16px;right:16px;z-index:9998;'
                + 'background:#1a1a2e;border:1px solid #5a5;border-radius:8px;'
                + 'box-shadow:0 4px 16px rgba(0,0,0,0.6);overflow:hidden;'
                + 'min-width:300px;max-width:390px;font-size:13px;line-height:1.4;color:#ddd;display:none;';
            el.innerHTML = `
                <div class="panel-header" style="border-radius:7px 7px 0 0;">
                    <span class="panel-title">Bot Training</span>
                    <button id="bt-popup-expand" class="hud-toggle-btn" title="Open full panel">⤢</button>
                </div>
                <div style="padding:12px 14px;">
                    <div id="bt-popup-scenario" style="font-size:14px;font-weight:600;color:#fff;margin-bottom:2px;"></div>
                    <div id="bt-popup-phase" style="font-size:12px;color:#bbb;margin-bottom:10px;"></div>

                    <div id="bt-popup-matchup" style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;font-size:13px;color:#eee;margin-bottom:8px;min-height:16px;"></div>

                    <div style="background:#0d0d18;border:1px solid #333;border-radius:5px;height:10px;overflow:hidden;margin-bottom:4px;">
                        <div id="bt-popup-bar" style="height:100%;background:linear-gradient(90deg,#8a6a3f,#d9b08c);width:0%;transition:width .25s ease-out;"></div>
                    </div>
                    <div id="bt-popup-progress-text" style="font-size:12px;color:#aaa;margin-bottom:10px;"></div>

                    <div id="bt-popup-stats" style="display:none;font-size:12px;color:#ddd;line-height:1.5;margin-bottom:10px;padding:6px 8px;background:#12121f;border:1px solid #2a2a40;border-radius:5px;">
                        <div id="bt-popup-current"></div>
                        <div id="bt-popup-last" style="color:#ddd;"></div>
                        <div id="bt-popup-totals"></div>
                        <div id="bt-popup-stalls" style="color:#c9a36a;"></div>
                    </div>
                    <div id="bt-popup-formulas" style="display:none;font-size:12px;color:#ddd;line-height:1.5;margin-bottom:10px;padding:8px 10px;background:#10181f;border:1px solid #2a4050;border-radius:5px;">
                        <div style="color:#9cc4ff;font-weight:600;font-size:13px;">New senses (formulas)</div>
                        <div style="color:#b8c6d2;margin-bottom:6px;">Bots can invent new things to notice about the board. One is kept only if its bot beats the champion. <span style="color:#8a9aa8;">[ ] = only when true.</span></div>
                        <div id="bt-popup-formulas-list"></div>
                    </div>
                    <div id="bt-popup-talk-label" style="font-size:12px;font-weight:600;color:#bbb;margin-bottom:3px;display:none;">What the bots said</div>
                    <div id="bt-popup-talk" style="font-size:12px;color:#ccc;line-height:1.5;margin-bottom:10px;font-style:italic;"></div>
                    <div id="bt-popup-events-label" style="font-size:12px;font-weight:600;color:#bbb;margin-bottom:3px;display:none;">What happened</div>
                    <div id="bt-popup-events" style="font-size:12px;color:#ccc;line-height:1.5;margin-bottom:10px;"></div>

                    <div id="bt-popup-history-label" style="font-size:12px;color:#bbb;margin-bottom:4px;display:none;">Rounds (gold = new champion)</div>
                    <div id="bt-popup-history" style="display:flex;flex-wrap:wrap;gap:3px;margin-bottom:10px;"></div>

                    <div id="bt-popup-summary" style="font-size:12px;color:#ccc;margin-bottom:10px;"></div>

                    <div style="display:flex;gap:6px;">
                        <button id="bt-popup-end-early" title="Skip to the final test with the best bot so far. Ending early earns no gold for the games run; a real win against the champion still earns the win gold." style="flex:1;padding:4px 6px;background:#2d3a4a;color:#eee;border:1px solid #578;border-radius:4px;cursor:pointer;font-size:12px;">End Early → Test Now</button>
                        <button id="bt-popup-speed" title="Switch this run between Watchable (normal pace) and Extreme (fast). Sound stays as the run started." style="padding:4px 8px;background:#2d2d44;color:#eee;border:1px solid #666;border-radius:4px;cursor:pointer;font-size:12px;">Speed</button>
                        <button id="bt-popup-save" title="Stop now and keep this run. Continue it later from Train Bot (the game in progress is played again)." style="padding:4px 8px;background:#2d4a3a;color:#eee;border:1px solid #5a7;border-radius:4px;cursor:pointer;font-size:12px;">Save &amp; Quit</button>
                        <button id="bt-popup-stop" style="padding:4px 8px;background:#442d2d;color:#eee;border:1px solid #755;border-radius:4px;cursor:pointer;font-size:12px;">Stop</button>
                    </div>
                </div>
            `;
            document.body.appendChild(el);
            el.querySelector('#bt-popup-expand').onclick = () => {
                if (typeof window._openBotTrainingPanel === 'function') window._openBotTrainingPanel();
            };
            el.querySelector('#bt-popup-end-early').onclick = (ev) => {
                if (window.BotArena?.isRunning()) {
                    window.BotArena.endEarly();
                    // Visible feedback: the status line below is not shown on
                    // the main page. The run stops after the current game.
                    ev.currentTarget.textContent = 'Ending after this game…';
                    ev.currentTarget.disabled = true;
                    updateStatus('Ending training early - running the confirmation match against the starting weights with the best result so far…');
                }
            };
            // Live speed switch (owner, 2026-09-29): Watchable <-> Extreme mid-run.
            const speedBtn = el.querySelector('#bt-popup-speed');
            const paintSpeed = () => { speedBtn.textContent = (window.BotSystem?.speedScale ?? 0) >= 1 ? 'Speed: Watchable' : 'Speed: Extreme'; };
            paintSpeed();
            setInterval(paintSpeed, 1000);
            speedBtn.onclick = () => {
                if (!window.BotArena?.isRunning?.() || !window.BotArena.setLiveSpeed) return;
                window.BotArena.setLiveSpeed((window.BotSystem?.speedScale ?? 0) < 1);
                paintSpeed();
            };
            el.querySelector('#bt-popup-save').onclick = (ev) => {
                if (!window.BotArena?.isRunning()) return;
                if (trainPhase === 'confirming') { updateStatus('The final test cannot be saved. It finishes on its own soon.'); return; }
                if (!window.BotArena.saveAndStop || !window.BotArena.isClimbing?.() && !window.BotArena.isEvolving?.()) { updateStatus('Only Train Bot runs can be saved.'); return; }
                window._trainSaveWanted = true;
                window.BotArena.saveAndStop();
                // Visible feedback (the status line is not on the main page).
                // The game in progress stops now and is replayed on continue.
                ev.currentTarget.textContent = 'Saving…';
                ev.currentTarget.disabled = true;
                updateStatus('Saving: the run stops now and can be continued later from Train Bot.');
            };
            el.querySelector('#bt-popup-stop').onclick = () => {
                if (window.BotArena?.isRunning()) {
                    window.BotArena.stop();
                    updateStatus('Stopping - this run\'s result will be discarded, keeping the previous weights.');
                }
            };
            trainingPopupEl = el;
            return el;
        }

        // marked = the challenger / the bot being tested: same red X as its
        // pawn on the board (bot-arena.js syncChallengerMark).
        function swatch(hex, marked) {
            const x = marked ? `<svg viewBox="-6 -6 12 12" width="11" height="11" style="position:absolute;left:-1px;top:-1px;"><path d="M-4-4L4 4M4-4L-4 4" stroke="#111" stroke-width="3.2" stroke-linecap="round"/><path d="M-4-4L4 4M4-4L-4 4" stroke="#ff3b30" stroke-width="1.8" stroke-linecap="round"/></svg>` : '';
            return `<span style="position:relative;display:inline-block;width:9px;height:9px;border-radius:2px;background:${hex};flex-shrink:0;">${x}</span>`;
        }

        // p: {phase, gamesDone, totalGames, startedAt, gen, generations,
        //     fitness, nPlayers, popSize, mode:'training'|'breeding'|'hillclimb',
        //     round, rounds, challenger, totalChallengers, gameNum, gameTotal,
        //     sideAColor/sideBColor/sideAHex/sideBHex, roundHistory, info}
        // The popup only hears from the run when a game ends (a game can take
        // minutes), so redraw the last state every 3 s to keep the clock and
        // time-left estimate moving.
        let trainingPopupLast = null, trainingPopupTicker = null;
        function showTrainingPopup(p) {
            trainingPopupLast = p;
            if (!trainingPopupTicker) {
                trainingPopupTicker = setInterval(() => {
                    const running = window.BotArena?.isRunning?.();
                    if (!running || !trainingPopupEl || trainingPopupEl.style.display === 'none') {
                        clearInterval(trainingPopupTicker); trainingPopupTicker = null; return;
                    }
                    if (trainingPopupLast) renderTrainingPopup(trainingPopupLast);
                }, 3000);
            }
            renderTrainingPopup(p);
        }
        function renderTrainingPopup(p) {
            const el = ensureTrainingPopup();
            el.style.display = 'block';
            const pct = p.totalGames ? Math.min(100, (p.gamesDone / p.totalGames) * 100) : 0;
            const elapsedS = (Date.now() - p.startedAt) / 1000;
            let scenarioLine, phaseLine, summaryLine, matchupHtml = '';
            // Formulas box: what the current challenger is trying (new ones
            // marked), only when the run lets training invent formulas.
            const fBox = el.querySelector('#bt-popup-formulas');
            fBox.style.display = (p.mode === 'hillclimb' && p.formulas) ? 'block' : 'none';
            if (p.mode === 'hillclimb' && p.formulas) {
                const terms = p.challengerTerms || [];
                const escF = t => String(t).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
                el.querySelector('#bt-popup-formulas-list').innerHTML = p.phase === 'exploring' || !p.challenger
                    ? '<span style="color:#aaa;">Shown here once the climb starts.</span>'
                    : terms.length
                        ? `<div style="color:#bbb;margin-bottom:2px;">${p.explored ? 'The explored bot' : `Challenger ${p.challenger}`} is trying:</div>` + terms.slice(0, 4).map(t =>
                            `<div style="margin:3px 0;" title="${escF(`${t.w} × ${t.text}`)}">${t.isNew ? '<span style="background:#1f4a2a;color:#9fe79f;border-radius:3px;padding:0 4px;font-size:11px;">NEW</span> ' : ''}`
                            + `<b style="color:${t.w < 0 ? '#ff9a8a' : '#8fe08f'};">${t.w < 0 ? 'Avoids' : 'Likes'}</b> ${escF(window.BotTerms?.describe ? window.BotTerms.describe(t.text) : t.text)}</div>`).join('')
                            + (terms.length > 4 ? `<div style="color:#999;">and ${terms.length - 4} more</div>` : '')
                        : `<span style="color:#aaa;">${p.explored ? 'The explored bot' : `Challenger ${p.challenger}`} has no new senses. It only changes how much it cares about things.</span>`;
            }
            const historyEl = el.querySelector('#bt-popup-history');
            const historyLabelEl = el.querySelector('#bt-popup-history-label');
            historyEl.innerHTML = '';
            historyLabelEl.style.display = 'none';

            if (p.mode === 'hillclimb') {
                scenarioLine = 'Hill Climb' + (p.explore ? ' with Explore' : '') + (p.formulas ? ' + Formulas' : '') + ' - champion-anchored';
                phaseLine = p.phase === 'confirming'
                    ? 'Confirming across 2–5 player tables'
                    : p.phase === 'starting' ? 'Starting…'
                    : p.phase === 'exploring'
                        ? `Explore: generation ${Math.min(p.gen + 1, p.generations)}/${p.generations} (Evolve search, 2-5 player games)`
                        : `Round ${p.round}/${p.rounds}`;
                // The explicit "what is literally happening right now" line —
                // which challenger (or, once confirming, the climbed champion),
                // which game in its series, and a real color swatch for each
                // side THIS game. Colors come pre-computed from the current
                // game's parity (runHillClimbTraining's sideColors()) — sides
                // alternate every game, never a fixed assignment.
                if (p.phase === 'exploring') {
                    matchupHtml = 'A group of bots based on the champion play each other; the best one joins the climb';
                } else if (p.gameNum && p.phase === 'confirming') {
                    matchupHtml = `${swatch('#888', true)} Climbed champion (marked X) vs. a field of the current champion`
                        + `<span style="color:#aaa;margin-left:auto;">game ${p.gameNum}/${p.gameTotal}</span>`;
                } else if (p.gameNum) {
                    matchupHtml = `${swatch(p.sideAHex, true)} ${p.explored ? 'The explored bot' : `Challenger ${p.challenger}/${p.totalChallengers}`} <span style="color:#aaa;">vs</span> ${swatch(p.sideBHex)} Champion`
                        + `<span style="color:#aaa;margin-left:auto;">game ${p.gameNum}/${p.gameTotal}</span>`;
                } else if (p.challenger) {
                    matchupHtml = `Challenger ${p.challenger}/${p.totalChallengers} vs. Champion <span style="color:#aaa;">- starting…</span>`;
                }
                const bestFit = Array.isArray(p.fitness) && p.fitness.length ? Math.max(...p.fitness) : null;
                summaryLine = p.phase === 'exploring'
                    ? (bestFit !== null ? `Explore best fitness so far: ${bestFit.toFixed(1)}` : 'Exploring…')
                    : p.info
                        ? `${p.info.promotions} promotion${p.info.promotions === 1 ? '' : 's'} so far · this round's best challenger: ${Math.round(p.info.bestWinRate * 100)}%`
                        : 'Climbing…';
                // The "how have rounds gone" summary: one chip per completed
                // round (filled gold = promoted, hollow = held), plus a dashed
                // chip for whichever round is still in progress.
                if (p.roundHistory?.length || p.round > 0) {
                    historyLabelEl.style.display = 'block';
                    for (const h of p.roundHistory) {
                        const chip = document.createElement('span');
                        chip.title = `Round ${h.round}: ${h.promoted ? 'Promoted' : 'Held'} - ${Math.round(h.winRate * 100)}% of ${h.decided} decided`;
                        chip.style.cssText = 'display:inline-block;width:12px;height:12px;border-radius:2px;'
                            + (h.promoted ? 'background:#d9b08c;border:1px solid #d9b08c;' : 'background:#242438;border:1px solid #444;');
                        historyEl.appendChild(chip);
                    }
                    if (p.phase !== 'confirming' && p.round > p.roundHistory.length) {
                        const inProgress = document.createElement('span');
                        inProgress.title = `Round ${p.round}: in progress`;
                        inProgress.style.cssText = 'display:inline-block;width:12px;height:12px;border-radius:2px;border:1px dashed #888;background:transparent;';
                        historyEl.appendChild(inProgress);
                    }
                }
            } else {
                const playersLabel = p.nPlayers === 'all' ? 'all sizes (2–5)' : `${p.nPlayers || 2} players`;
                scenarioLine = p.popSize ? `Training - ${playersLabel}, population ${p.popSize}` : `Training - ${playersLabel}`;
                phaseLine = p.phase === 'starting' ? 'Starting… (first game in progress)'
                    : p.phase === 'confirming'
                    ? (p.nPlayers === 'all'
                        ? 'Confirming: champion vs. baseline at every size'
                        : 'Confirming: new champion vs. starting weights')
                    : `Generation ${p.gen}/${p.generations}`;
                const bestFitness = Array.isArray(p.fitness) && p.fitness.length ? Math.max(...p.fitness) : null;
                summaryLine = bestFitness !== null ? `Best fitness so far: ${bestFitness.toFixed(1)}` : '';
            }

            el.querySelector('#bt-popup-scenario').textContent = scenarioLine;
            el.querySelector('#bt-popup-phase').textContent = phaseLine;
            el.querySelector('#bt-popup-matchup').innerHTML = matchupHtml;
            el.querySelector('#bt-popup-bar').style.width = `${pct}%`;
            el.querySelector('#bt-popup-progress-text').textContent =
                `Games: ${p.gamesDone}/${p.totalGames} (${pct.toFixed(0)}%) · ${fmtPopupTime(elapsedS)} elapsed`
                + (p.gamesDone >= 3 && p.gamesDone < p.totalGames
                    ? ` · about ${fmtPopupTime(elapsedS / p.gamesDone * (p.totalGames - p.gamesDone))} left` : '');
            el.querySelector('#bt-popup-summary').textContent = summaryLine || '';
            renderTrainingStats(el, p);
            renderTrainingTalk(el);
            // Nothing left to "skip ahead to" once already confirming —
            // and breeding has no confirmation phase to jump to at all, so
            // End Early there just means "stop generating more generations
            // and download the current best now" (still meaningful, keep
            // the button, only the confirming-phase case hides it).
            const endEarlyBtn = el.querySelector('#bt-popup-end-early');
            if (endEarlyBtn) {
                endEarlyBtn.style.display = p.phase === 'confirming' ? 'none' : 'block';
                if (!window.BotArena?.endEarlyRequested?.() && endEarlyBtn.disabled) {
                    endEarlyBtn.disabled = false; endEarlyBtn.textContent = 'End Early → Test Now';
                }
            }
            // Only Hill Climb runs (Train Bot) save, and not in the final test.
            const saveBtn = el.querySelector('#bt-popup-save');
            if (saveBtn) {
                saveBtn.style.display = (p.mode === 'hillclimb' && p.phase !== 'confirming') ? '' : 'none';
                if (!window._trainSaveWanted && saveBtn.disabled) { saveBtn.disabled = false; saveBtn.textContent = 'Save & Quit'; }
            }
        }

        function renderTrainingStats(el, p) {
            const st = p.stats;
            const box = el.querySelector('#bt-popup-stats');
            if (!st || !st.games) { box.style.display = 'none'; }
            else {
                box.style.display = 'block';
                const cur = st.cur && p.mode === 'hillclimb' && p.phase !== 'confirming'
                    ? `${p.explored ? 'Explored bot' : 'This challenger'} vs champion: ${st.cur.w} won · ${st.cur.l} lost · ${st.cur.d} drawn` : '';
                el.querySelector('#bt-popup-current').textContent = cur;
                el.querySelector('#bt-popup-last').textContent = st.last ? `Last game: ${st.last}` : '';
                const avg = Math.round(st.turnsSum / st.games);
                const pl = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
                el.querySelector('#bt-popup-totals').textContent = p.mode === 'hillclimb' && p.phase !== 'exploring' && (st.chWins || st.champWins || p.phase === 'training')
                    ? `Run so far: ${pl(st.games, 'game')} · challengers won ${st.chWins} · champion won ${st.champWins} · ${pl(st.draws, 'draw')} · avg ${avg} turns`
                    : `Run so far: ${pl(st.games, 'game')} · ${pl(st.draws, 'draw')} · avg ${avg} turns`;
                const parts = Object.entries(st.stalls).filter(([, n]) => n).map(([k, n]) => `${n} ${STALL_NAMES[k] || k}`);
                if (st.stuck) parts.push(`${st.stuck} stuck`);
                if (st.turnCap) parts.push(`${st.turnCap} hit the turn limit`);
                el.querySelector('#bt-popup-stalls').textContent = parts.length
                    ? `Stalls: ${parts.join(' · ')}${st.restarts ? ` · ${st.restarts} restarted with new cards` : ''}` : '';
            }
            const evEl = el.querySelector('#bt-popup-events');
            const evLabel = el.querySelector('#bt-popup-events-label');
            const events = st?.events || [];
            evLabel.style.display = events.length ? 'block' : 'none';
            evEl.innerHTML = events.map(e => `<div>${String(e).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))}</div>`).join('');
        }

        function hideTrainingPopup() {
            if (trainingPopupEl) trainingPopupEl.style.display = 'none';
        }

        // After a Train Bot run the training board stays on screen (so the
        // player can read the result), but nothing on it leads back to the
        // lobby. This button does: same exit as the replay viewer (reload,
        // skipping the logo / lore intro once).
        function showLeaveTrainingButton() {
            if (!document.getElementById('game-layout')?.classList.contains('active')) return;
            let btn = document.getElementById('leave-training-btn');
            if (!btn) {
                btn = document.createElement('button');
                btn.id = 'leave-training-btn';
                btn.textContent = 'Leave training area';
                btn.title = 'Go back to the lobby';
                btn.style.cssText = 'position:fixed;top:100px;left:50%;transform:translateX(-50%);z-index:10050;'
                    + 'padding:9px 18px;background:#2d3a4a;color:#eee;border:1px solid #6a8ab5;border-radius:6px;'
                    + 'cursor:pointer;font-size:14px;font-weight:bold;box-shadow:0 2px 10px rgba(0,0,0,0.6);';
                btn.onclick = () => {
                    if (window.BotArena?.isRunning?.()) window.BotArena.stop();
                    btn.disabled = true;
                    btn.textContent = 'Leaving...';
                    try { sessionStorage.setItem('godaigo_skip_intro_once', '1'); } catch (e) {}
                    location.reload();
                };
                document.body.appendChild(btn);
            }
            btn.style.display = 'block';
        }
        function hideLeaveTrainingButton() {
            const btn = document.getElementById('leave-training-btn');
            if (btn) btn.style.display = 'none';
        }

        // ─── Hidden cheat panel ──────────────────────────────────────────────
        // Activate: click the "AP" label in the HUD 5 times within 3 seconds
        (function initCheatPanel() {
            let clickCount = 0;
            let clickTimer = null;

            function openCheatPanel(lazyTried) {
                const existing = document.getElementById('cheat-panel');
                if (existing) { existing.remove(); return; }
                // Its bot buttons need bot-arena.js, which is lazy-loaded
                // (js/asset-preloader.js § Lazy scripts) — load it first.
                // One try only: if it fails, open anyway (those buttons
                // already report 'BotArena not loaded').
                if (!window.BotArena && window.LazyScripts && lazyTried !== true) {
                    window.LazyScripts.load('bot-arena').catch(() => {}).then(() => openCheatPanel(true));
                    return;
                }

                const panel = document.createElement('div');
                panel.id = 'cheat-panel';
                Object.assign(panel.style, {
                    position: 'fixed',
                    bottom: '60px',
                    right: '16px',
                    background: '#1a1a2e',
                    border: '1px solid #444',
                    borderRadius: '8px',
                    padding: '10px 14px',
                    zIndex: '9999',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '8px',
                    boxShadow: '0 4px 16px rgba(0,0,0,0.6)',
                    minWidth: '240px',
                    maxWidth: '280px'
                });

                function makeBtn(label, action) {
                    const btn = document.createElement('button');
                    btn.textContent = label;
                    Object.assign(btn.style, {
                        padding: '6px 10px',
                        background: '#2d2d44',
                        color: '#eee',
                        border: '1px solid #555',
                        borderRadius: '5px',
                        cursor: 'pointer',
                        fontSize: '13px',
                        textAlign: 'left'
                    });
                    btn.onclick = action;
                    return btn;
                }

                panel.appendChild(makeBtn('Fill Stones', () => {
                    if (typeof window.fillstones === 'function') window.fillstones();
                }));
                panel.appendChild(makeBtn('Toggle Deck Browser', () => {
                    if (typeof window.showdeck === 'function') window.showdeck();
                }));
                panel.appendChild(makeBtn('Download Action Log', () => {
                    if (typeof window.ActionLog?.download === 'function') window.ActionLog.download();
                    else updateStatus('Action log not available');
                }));
                panel.appendChild(makeBtn('🏹 TheHermit: Layout Editor (Shift+H)', () => {
                    if (typeof window.TheHermit?.toggle === 'function') window.TheHermit.toggle();
                    else updateStatus('TheHermit not available');
                }));

                // Place Anywhere toggle — uses the same globalPlacement buff as Avalanche,
                // but with expiresThisTurn:false so it persists until toggled off.
                const placeAnywhereBtn = makeBtn('Place Anywhere: OFF', () => {
                    if (!spellSystem || !spellSystem.scrollEffects) {
                        updateStatus('spellSystem not ready');
                        return;
                    }
                    const idx = (typeof myPlayerIndex !== 'undefined' && myPlayerIndex !== null)
                        ? myPlayerIndex : activePlayerIndex;
                    const buff = spellSystem.scrollEffects.activeBuffs.globalPlacement;
                    if (buff && buff.playerIndex === idx && buff.cheatPersist) {
                        // Turn off
                        spellSystem.scrollEffects.activeBuffs.globalPlacement = null;
                        placeAnywhereBtn.textContent = 'Place Anywhere: OFF';
                        placeAnywhereBtn.style.color = '#eee';
                        updateStatus('Place anywhere: OFF');
                    } else {
                        // Turn on
                        spellSystem.scrollEffects.activeBuffs.globalPlacement = {
                            playerIndex: idx,
                            expiresThisTurn: false,
                            cheatPersist: true   // flag so we can toggle it off
                        };
                        placeAnywhereBtn.textContent = 'Place Anywhere: ON';
                        placeAnywhereBtn.style.color = '#6ef';
                        updateStatus('Place anywhere: ON - stones may be placed on any empty tile');
                    }
                });
                panel.appendChild(placeAnywhereBtn);

                // Bot Brain toggle — cycles Dumb → Smart → Hybrid → MCTS.
                //   Dumb   = Stage-1 greedy scoring (default)
                //   Smart  = Stage-2 lookahead search (3 plies) on every action
                //   Hybrid = lookahead only when a cast/stone placement is on
                //            the table; plain movement stays greedy (cheap)
                //   MCTS   = Stage 2 step 5 multi-turn search (mctsPick() in
                //            bot.js) — rolls real games forward through
                //            opponent turns instead of stopping at our own
                //            turn boundary; noticeably slower per decision.
                // Persisted to localStorage; bot.js applies it at load, and we
                // also apply it live so no reload is needed.
                const BRAIN_ORDER = ['dumb', 'smart', 'hybrid', 'mcts'];
                const BRAIN_UI = {
                    dumb:   { label: 'Bot Brain: Dumb (greedy)',        color: '#eee' },
                    smart:  { label: '🧠 Bot Brain: Smart (lookahead)', color: '#6ef' },
                    hybrid: { label: '🧠 Bot Brain: Hybrid',            color: '#fc6' },
                    mcts:   { label: '🎲 Bot Brain: MCTS',              color: '#e6f' },
                };
                function currentBrain() {
                    // default matches DEFAULT_WEIGHTS (hybrid, per arena evidence)
                    try { return localStorage.getItem('godaigo_bot_brain') || 'hybrid'; }
                    catch (e) { return 'hybrid'; }
                }
                function applyBrain(mode) {
                    const W = window.BotSystem?.WEIGHTS;
                    if (W) {
                        W.searchDepth = (mode === 'dumb') ? 0 : 3;
                        W.searchHybrid = (mode === 'hybrid' || mode === 'mcts') ? 1 : 0;
                        W.mctsEnabled = (mode === 'mcts');
                    }
                    try { localStorage.setItem('godaigo_bot_brain', mode); } catch (e) {}
                }
                const brainBtn = makeBtn('', () => {
                    const next = BRAIN_ORDER[(BRAIN_ORDER.indexOf(currentBrain()) + 1) % BRAIN_ORDER.length];
                    applyBrain(next);
                    brainBtn.textContent = BRAIN_UI[next].label;
                    brainBtn.style.color = BRAIN_UI[next].color;
                    updateStatus(
                        next === 'dumb'  ? 'Bot brain: DUMB - one-step greedy scoring'
                      : next === 'smart' ? 'Bot brain: SMART - 3-ply lookahead on every action'
                      : next === 'hybrid' ? 'Bot brain: HYBRID - lookahead for casts/stone placements, greedy movement'
                      : 'Bot brain: MCTS - multi-turn search through opponent turns (slower)');
                });
                brainBtn.textContent = BRAIN_UI[currentBrain()].label;
                brainBtn.style.color = BRAIN_UI[currentBrain()].color;
                panel.appendChild(brainBtn);

                // Shared prep for restartAsBots/restartAsEvolve, from ANY game
                // context: stop whatever bot session is already running, then
                // leave the online room if we're in one. Returns false (with a
                // status message) if prep failed, so the caller can bail before
                // starting its own bot session.
                async function stopAnyMatchAndLeaveMultiplayer() {
                    if (!window.BotArena) { updateStatus('BotArena not loaded'); return false; }
                    panel.remove(); // clear the panel; reopen any time via the AP label
                    if (!await stopAnyRunningBotJob()) return false;
                    await leaveOnlineGameIfAny();
                    return true;
                }

                // Start an all-bot spectator match with a CHOSEN player count.
                // The action log auto-downloads when the match ends.
                async function restartAsBots(n) {
                    if (!(await stopAnyMatchAndLeaveMultiplayer())) return;
                    try {
                        await window.BotArena.spectate(n);
                    } catch (err) {
                        console.error('Bot match failed:', err);
                        updateStatus('Bot match failed - see console');
                    }
                }

                // Start a VISUALIZED weight-evolution run with n players per
                // training game (2 = original pairwise round-robin; >2 samples
                // random N-player groupings each generation — see bot-arena.js).
                // Small defaults so a full run finishes in a few minutes, not
                // hours — tune further from the console with BotArena.evolve().
                async function restartAsEvolve(n) {
                    if (!(await stopAnyMatchAndLeaveMultiplayer())) return;
                    try {
                        const generations = 3;
                        const popSize = 6;
                        await window.BotArena.evolve(generations, {
                            nPlayers: n,
                            visual: true,
                            popSize,
                            gamesPerPair: 1,
                            gamesPerGen: n > 2 ? popSize * 2 : undefined,
                        });
                    } catch (err) {
                        console.error('Evolve run failed:', err);
                        updateStatus('Evolve run failed - see console');
                    }
                }

                const matchRow = document.createElement('div');
                matchRow.style.cssText = 'display:flex;align-items:center;gap:6px;';
                const matchLabel = document.createElement('span');
                matchLabel.textContent = 'Bot match:';
                matchLabel.style.cssText = 'font-size:12px;color:#aaa;';
                matchRow.appendChild(matchLabel);
                [2, 3, 4, 5].forEach(n => {
                    const b = document.createElement('button');
                    b.textContent = String(n);
                    b.title = `Restart as a ${n}-bot spectator match (leaves the online game if needed)`;
                    b.style.cssText = 'padding:4px 9px;background:#2d2d44;color:#eee;border:1px solid #555;border-radius:5px;cursor:pointer;font-size:13px;';
                    b.onclick = () => restartAsBots(n);
                    matchRow.appendChild(b);
                });
                const stopBtn = document.createElement('button');
                stopBtn.textContent = '⏹';
                stopBtn.title = 'Stop the running bot session (match or evolve - action log still downloads for a match)';
                stopBtn.style.cssText = 'padding:4px 9px;background:#442d2d;color:#eee;border:1px solid #755;border-radius:5px;cursor:pointer;font-size:13px;';
                stopBtn.onclick = () => {
                    if (window.BotArena?.isRunning()) { window.BotArena.stop(); updateStatus('Stopping bot session…'); }
                    else updateStatus('No bot session running');
                };
                matchRow.appendChild(stopBtn);
                panel.appendChild(matchRow);

                // 🧬 Evolve: same visualized-match core as Bot match above, but
                // plays a small weight-evolution run (3 generations, pop 6)
                // instead of a single game — watch the population improve live.
                // Champion weights are saved to localStorage['godaigo_bot_weights']
                // after every generation and picked up automatically on reload.
                const evolveRow = document.createElement('div');
                evolveRow.style.cssText = 'display:flex;align-items:center;gap:6px;';
                const evolveLabel = document.createElement('span');
                evolveLabel.textContent = '🧬 Evolve:';
                evolveLabel.title = 'Watch a small weight-evolution run (3 generations, pop 6). Tune further from the console: BotArena.evolve(generations, {nPlayers, visual, popSize, gamesPerPair, gamesPerGen})';
                evolveLabel.style.cssText = 'font-size:12px;color:#aaa;';
                evolveRow.appendChild(evolveLabel);
                [2, 3, 4, 5].forEach(n => {
                    const b = document.createElement('button');
                    b.textContent = String(n);
                    b.title = `Evolve with ${n}-player training games (leaves the online game if needed)`;
                    b.style.cssText = 'padding:4px 9px;background:#2d2d44;color:#eee;border:1px solid #555;border-radius:5px;cursor:pointer;font-size:13px;';
                    b.onclick = () => restartAsEvolve(n);
                    evolveRow.appendChild(b);
                });
                panel.appendChild(evolveRow);

                // Same-size convenience: your seat handed to a bot, table
                // size kept. Use the numbered buttons above to pick a count.
                panel.appendChild(makeBtn('🔁 Restart bot game without player (same size)', () =>
                    restartAsBots(Math.max(2, Math.min(5, (playerPositions || []).filter(Boolean).length || 2)))));

                // Weight evolution (BotArena.evolve — roadmap Stage 3a): runs a
                // MUTED self-play arena in the background, then a CONFIRMATION
                // match against the weights in place before training started,
                // only applying/keeping the result if it actually won that
                // match. This mirrors the roadmap's own Stage 3a acceptance bar
                // ("champion beats the hand-tuned defaults...") — a single
                // game per evolve() pairing (the "quick" preset) is noisy
                // enough that its per-generation pick can win by luck, not by
                // being better, so nothing here should be trusted without
                // being checked against a real baseline first (see
                // docs/bot-roadmap.md's "Confirmation gate" note — v1 of this
                // button applied evolve()'s result unconditionally and could
                // silently make bots worse). evolve() itself still
                // auto-persists to localStorage every generation
                // (pre-existing, intentional design so a console-run evolve()
                // takes effect on reload) — this only decides whether to KEEP
                // what got written, reverting it if the result didn't hold up.
                // Leaves any online game first, same reasoning as the
                // bot-match buttons above: this plays local hot-seat games
                // under the hood. (runWeightTraining itself is hoisted above
                // initCheatPanel — shared with the bot training panel.)

                // Shared progress meter for whichever training preset is running.
                const progressWrap = document.createElement('div');
                progressWrap.style.cssText = 'display:none;flex-direction:column;gap:4px;';
                const progressBarOuter = document.createElement('div');
                progressBarOuter.style.cssText = 'background:#111;border:1px solid #444;border-radius:4px;height:8px;overflow:hidden;';
                const progressBarInner = document.createElement('div');
                progressBarInner.style.cssText = 'background:#6ef;height:100%;width:0%;';
                progressBarOuter.appendChild(progressBarInner);
                const progressText = document.createElement('div');
                progressText.style.cssText = 'font-size:11px;color:#aaa;white-space:pre-line;';
                progressWrap.appendChild(progressBarOuter);
                progressWrap.appendChild(progressText);

                function fmtTime(s) { return s < 90 ? `${Math.round(s)}s` : `${Math.round(s / 60)}m`; }
                function renderProgress(p) {
                    progressWrap.style.display = 'flex';
                    const pct = p.totalGames ? Math.min(100, (p.gamesDone / p.totalGames) * 100) : 0;
                    progressBarInner.style.width = pct.toFixed(1) + '%';
                    const elapsedS = (Date.now() - p.startedAt) / 1000;
                    const rate = p.gamesDone > 0 ? elapsedS / p.gamesDone : null;
                    const etaS = rate ? Math.max(0, (p.totalGames - p.gamesDone) * rate) : null;
                    const genLine = p.fitness
                        ? `gen ${p.gen}/${p.generations} · fitness ${p.fitness.map(f => f.toFixed(1)).join(', ')}`
                        : `gen ${p.gen}/${p.generations}`;
                    progressText.textContent =
                        `${p.phase === 'confirming' ? 'Confirming result' : 'Training'} - ${genLine}\n` +
                        `games ${p.gamesDone}/${p.totalGames} (${pct.toFixed(0)}%) · elapsed ${fmtTime(elapsedS)}` +
                        (etaS != null ? ` · ETA ~${fmtTime(etaS)}` : '');
                }
                function hideProgress() { progressWrap.style.display = 'none'; }

                // Two presets: "quick" is the fast sample (few minutes, noisy —
                // may often correctly report no improvement); "thorough" is a
                // real training run (~700 games, likely 1-2+ hours) closer to
                // the roadmap's own spec. Both share the confirmation gate
                // above, so neither can silently apply a worse result.
                const TRAIN_PRESETS = {
                    quick:    { label: '🧬 Train Weights (quick, ~55 games)',
                                generations: 3, gamesPerPair: 1, popSize: 6, confirmGames: 10 },
                    thorough: { label: '🧬 Train Weights (thorough, ~700 games, 1-2+ hrs)',
                                generations: 8, gamesPerPair: 3, popSize: 8, confirmGames: 20 },
                };
                let quickBtn, thoroughBtn;
                function makeTrainButton(key) {
                    const preset = TRAIN_PRESETS[key];
                    const btn = makeBtn(preset.label, async () => {
                        if (!window.BotArena) { updateStatus('BotArena not loaded'); return; }
                        if (window.BotArena.isEvolving()) { updateStatus('Already training - use ⏹ to stop it'); return; }
                        if (!await stopAnyRunningBotJob()) return;
                        quickBtn.disabled = true;
                        thoroughBtn.disabled = true;
                        btn.textContent = `${preset.label} - starting…`;
                        try {
                            const { improved, record } = await runWeightTraining(preset, (p) => {
                                renderProgress(p);
                                btn.textContent = p.phase === 'confirming'
                                    ? `${preset.label} - confirming…`
                                    : `${preset.label} - gen ${p.gen}/${preset.generations}`;
                            });
                            hideProgress();
                            updateStatus(improved
                                ? `Training complete - champion beat the starting weights ${record} in the confirmation ` +
                                  `match. New weights applied live and saved. (Board shows the last game - start a new ` +
                                  `game to keep playing.)`
                                : `Training finished but did not beat the starting weights (${record}) in the ` +
                                  `confirmation match - kept the previous weights. (Board shows the last game - start ` +
                                  `a new game to keep playing.)`);
                        } catch (err) {
                            console.error('Weight training failed:', err);
                            hideProgress();
                            updateStatus('Weight training failed - see console');
                        } finally {
                            quickBtn.disabled = false;
                            thoroughBtn.disabled = false;
                            btn.textContent = preset.label;
                        }
                    });
                    return btn;
                }
                quickBtn = makeTrainButton('quick');
                thoroughBtn = makeTrainButton('thorough');

                panel.appendChild(quickBtn);
                const thoroughRow = document.createElement('div');
                thoroughRow.style.cssText = 'display:flex;align-items:center;gap:6px;';
                thoroughRow.appendChild(thoroughBtn);
                const trainStopBtn = document.createElement('button');
                trainStopBtn.textContent = '⏹';
                trainStopBtn.title = 'Stop training after the current generation finishes';
                trainStopBtn.style.cssText = 'padding:4px 9px;background:#442d2d;color:#eee;border:1px solid #755;border-radius:5px;cursor:pointer;font-size:13px;';
                trainStopBtn.onclick = () => {
                    if (window.BotArena?.isEvolving()) { window.BotArena.stop(); updateStatus('Stopping after this generation…'); }
                    else updateStatus('No training run in progress');
                };
                thoroughRow.appendChild(trainStopBtn);
                panel.appendChild(thoroughRow);
                panel.appendChild(progressWrap);

                // ── Overlay Editor ───────────────────────────────────────────
                const overlaySection = document.createElement('div');
                overlaySection.style.cssText = 'border-top:1px solid #444;padding-top:8px;display:flex;flex-direction:column;gap:6px;';

                const overlayTitle = document.createElement('div');
                overlayTitle.textContent = '🖼 Tile Image Overlays';
                overlayTitle.style.cssText = 'font-size:12px;color:#aaa;font-weight:bold;cursor:pointer;user-select:none;';
                let overlayOpen = false;
                const overlayBody = document.createElement('div');
                overlayBody.style.cssText = 'display:none;flex-direction:column;gap:6px;';
                overlayTitle.onclick = () => {
                    overlayOpen = !overlayOpen;
                    overlayBody.style.display = overlayOpen ? 'flex' : 'none';
                };
                overlaySection.appendChild(overlayTitle);
                overlaySection.appendChild(overlayBody);

                const ELEMENTS = ['earth', 'fire', 'water', 'wind', 'void', 'catacomb'];
                // 'unflipped' = the face-down tile back shown before a tile is revealed.
                // 'player_*' = one overlay per player color, each can carry its own unique image.
                const SPECIAL = ['unflipped', 'player_purple', 'player_yellow', 'player_red', 'player_blue', 'player_green'];
                const ALL_CATEGORIES = [...ELEMENTS, ...SPECIAL];
                const EL_COLORS = {
                    earth:'#69d83a', fire:'#ed1b43', water:'#5894f4', wind:'#ffce00', void:'#9458f4', catacomb:'#aaa',
                    unflipped:'#888888',
                    player_purple:'#9458f4', player_yellow:'#ffce00', player_red:'#ed1b43', player_blue:'#5894f4', player_green:'#69d83a',
                };
                const PILL_LABELS = {
                    unflipped: '🂠 unflipped',
                    player_purple: '♟ purple', player_yellow: '♟ yellow', player_red: '♟ red',
                    player_blue: '♟ blue', player_green: '♟ green',
                };
                let selectedEl = 'earth';

                // Element selector pills
                const pillRow = document.createElement('div');
                pillRow.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;';
                const pills = {};
                ELEMENTS.forEach(el => {
                    const pill = document.createElement('button');
                    pill.textContent = el;
                    pill.style.cssText = `padding:2px 6px;border-radius:10px;border:1px solid ${EL_COLORS[el]};background:#1a1a2e;color:${EL_COLORS[el]};font-size:11px;cursor:pointer;`;
                    pill.onclick = () => { selectedEl = el; refreshOverlayControls(); highlightPill(); };
                    pills[el] = pill;
                    pillRow.appendChild(pill);
                });
                overlayBody.appendChild(pillRow);

                // Special-category pills: unflipped tile back + per-player tiles
                const specialLabel = document.createElement('div');
                specialLabel.textContent = 'Unflipped / Player Tiles:';
                specialLabel.style.cssText = 'font-size:10px;color:#888;margin-top:2px;';
                overlayBody.appendChild(specialLabel);

                const specialPillRow = document.createElement('div');
                specialPillRow.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;';
                SPECIAL.forEach(key => {
                    const pill = document.createElement('button');
                    pill.textContent = PILL_LABELS[key] || key;
                    pill.style.cssText = `padding:2px 6px;border-radius:10px;border:1px solid ${EL_COLORS[key]};background:#1a1a2e;color:${EL_COLORS[key]};font-size:11px;cursor:pointer;`;
                    pill.onclick = () => { selectedEl = key; refreshOverlayControls(); highlightPill(); };
                    pills[key] = pill;
                    specialPillRow.appendChild(pill);
                });
                overlayBody.appendChild(specialPillRow);

                function highlightPill() {
                    ALL_CATEGORIES.forEach(el => {
                        pills[el].style.background = el === selectedEl ? EL_COLORS[el] : '#1a1a2e';
                        pills[el].style.color = el === selectedEl ? '#111' : EL_COLORS[el];
                    });
                }
                highlightPill();

                // Image src input
                const srcRow = document.createElement('div');
                srcRow.style.cssText = 'display:flex;gap:4px;align-items:center;';
                const srcLabel = document.createElement('span');
                srcLabel.textContent = 'Src:';
                srcLabel.style.cssText = 'font-size:11px;color:#aaa;width:30px;flex-shrink:0;';
                const srcInput = document.createElement('input');
                srcInput.type = 'text';
                srcInput.placeholder = 'images/tiles/earth.png';
                srcInput.style.cssText = 'flex:1;background:#111;color:#eee;border:1px solid #555;border-radius:4px;padding:2px 5px;font-size:11px;';
                srcInput.onchange = () => {
                    if (window.tileOverlaySettings?.[selectedEl]) {
                        window.tileOverlaySettings[selectedEl].src = srcInput.value.trim();
                        window.refreshAllTileOverlays?.();
                    }
                };
                srcRow.appendChild(srcLabel);
                srcRow.appendChild(srcInput);
                overlayBody.appendChild(srcRow);

                // Slider helper
                function makeOverlaySlider(label, min, max, step, key) {
                    const row = document.createElement('div');
                    row.style.cssText = 'display:flex;align-items:center;gap:5px;';
                    const lbl = document.createElement('span');
                    lbl.textContent = label;
                    lbl.style.cssText = 'font-size:11px;color:#aaa;width:38px;flex-shrink:0;';
                    const slider = document.createElement('input');
                    slider.type = 'range';
                    slider.min = min; slider.max = max; slider.step = step;
                    slider.style.cssText = 'flex:1;accent-color:#6ef;min-width:0;';
                    const val = document.createElement('span');
                    val.style.cssText = 'font-size:11px;color:#eee;width:36px;text-align:right;flex-shrink:0;';
                    slider.oninput = () => {
                        const v = parseFloat(slider.value);
                        val.textContent = step < 1 ? v.toFixed(2) : Math.round(v);
                        if (window.tileOverlaySettings?.[selectedEl]) {
                            window.tileOverlaySettings[selectedEl][key] = v;
                            window.refreshAllTileOverlays?.();
                        }
                    };
                    row.appendChild(lbl); row.appendChild(slider); row.appendChild(val);
                    overlayBody.appendChild(row);
                    return { slider, val };
                }

                const sliders = {
                    x:        makeOverlaySlider('X',       -80,  80,  1,    'x'),
                    y:        makeOverlaySlider('Y',       -80,  80,  1,    'y'),
                    rotation:    makeOverlaySlider('Rotate',  0,   360, 1,    'rotation'),
                    scale:       makeOverlaySlider('Scale',   0.1, 3,   0.05, 'scale'),
                    opacity:     makeOverlaySlider('Opacity', 0,   1,   0.01, 'opacity'),
                    tintOpacity: makeOverlaySlider('Tint',    0,   1,   0.01, 'tintOpacity'),
                };

                function refreshOverlayControls() {
                    const s = window.tileOverlaySettings?.[selectedEl];
                    if (!s) return;
                    srcInput.value = s.src || '';
                    sliders.x.slider.value = s.x;               sliders.x.val.textContent = s.x;
                    sliders.y.slider.value = s.y;               sliders.y.val.textContent = s.y;
                    sliders.rotation.slider.value = s.rotation; sliders.rotation.val.textContent = s.rotation;
                    sliders.scale.slider.value = s.scale;       sliders.scale.val.textContent = s.scale.toFixed(2);
                    sliders.opacity.slider.value = s.opacity;   sliders.opacity.val.textContent = s.opacity.toFixed(2);
                    const tint = s.tintOpacity ?? 0.22;
                    sliders.tintOpacity.slider.value = tint;    sliders.tintOpacity.val.textContent = tint.toFixed(2);
                }
                refreshOverlayControls();

                // Click-to-select tile mode
                let clickSelectActive = false;
                let clickSelectListener = null;
                const clickSelectBtn = document.createElement('button');
                clickSelectBtn.textContent = '🎯 Click Tile to Select';
                Object.assign(clickSelectBtn.style, { padding:'4px 8px', background:'#2d2d44', color:'#eee', border:'1px solid #555', borderRadius:'5px', cursor:'pointer', fontSize:'11px' });
                clickSelectBtn.onclick = () => {
                    clickSelectActive = !clickSelectActive;
                    clickSelectBtn.style.background = clickSelectActive ? '#3a5a3a' : '#2d2d44';
                    clickSelectBtn.textContent = clickSelectActive ? '🎯 Selecting... (click tile)' : '🎯 Click Tile to Select';
                    if (clickSelectActive) {
                        clickSelectListener = (e) => {
                            const tileEl = e.target.closest('[data-tile-id]');
                            if (!tileEl) return;
                            const tileId = parseInt(tileEl.getAttribute('data-tile-id'));
                            const tile = (typeof placedTiles !== 'undefined') && placedTiles.find(t => t.id === tileId);
                            let key = null;
                            if (tile && tile.isPlayerTile) {
                                key = tile.playerColorName ? `player_${tile.playerColorName}` : null;
                            } else if (tile && tile.flipped) {
                                key = 'unflipped';
                            } else if (tile && tile.shrineType) {
                                key = tile.shrineType;
                            }
                            if (key) {
                                selectedEl = key;
                                highlightPill();
                                refreshOverlayControls();
                            }
                            // Deactivate after one click
                            clickSelectActive = false;
                            clickSelectBtn.style.background = '#2d2d44';
                            clickSelectBtn.textContent = '🎯 Click Tile to Select';
                            document.removeEventListener('click', clickSelectListener, true);
                            clickSelectListener = null;
                        };
                        document.addEventListener('click', clickSelectListener, true);
                    } else if (clickSelectListener) {
                        document.removeEventListener('click', clickSelectListener, true);
                        clickSelectListener = null;
                    }
                };
                overlayBody.appendChild(clickSelectBtn);

                // Export button
                const exportBtn = document.createElement('button');
                exportBtn.textContent = '📋 Export Settings';
                Object.assign(exportBtn.style, { padding:'4px 8px', background:'#2d2d44', color:'#6ef', border:'1px solid #555', borderRadius:'5px', cursor:'pointer', fontSize:'11px' });
                exportBtn.onclick = () => {
                    const out = JSON.stringify(window.tileOverlaySettings, null, 2);
                    console.log('[OVERLAY EXPORT]\n' + out);
                    const pre = document.createElement('textarea');
                    pre.value = out;
                    pre.style.cssText = 'width:100%;height:120px;background:#111;color:#6ef;border:1px solid #444;border-radius:4px;font-size:10px;padding:4px;box-sizing:border-box;resize:vertical;';
                    // Replace or append export area
                    const existing = overlayBody.querySelector('.overlay-export-area');
                    if (existing) existing.remove(); else { pre.className = 'overlay-export-area'; overlayBody.appendChild(pre); pre.select(); }
                };
                overlayBody.appendChild(exportBtn);
                overlaySection.appendChild(overlayBody);
                panel.appendChild(overlaySection);

                // ── Inspect Tool ─────────────────────────────────────────────
                const inspectSection = document.createElement('div');
                inspectSection.style.cssText = 'border-top:1px solid #444;padding-top:8px;display:flex;flex-direction:column;gap:6px;';

                let inspectActive = false;
                let inspectListener = null;
                const inspectOut = document.createElement('div');
                inspectOut.style.cssText = 'display:none;font-size:10px;color:#6ef;background:#111;border:1px solid #444;border-radius:4px;padding:5px 7px;white-space:pre;font-family:monospace;line-height:1.5;';

                const inspectBtn = makeBtn('🔍 Inspect Tile: OFF', () => {
                    inspectActive = !inspectActive;
                    inspectBtn.textContent = inspectActive ? '🔍 Inspect Tile: ON' : '🔍 Inspect Tile: OFF';
                    inspectBtn.style.color = inspectActive ? '#6ef' : '#eee';
                    inspectOut.style.display = inspectActive ? 'block' : 'none';

                    if (inspectListener) {
                        document.removeEventListener('click', inspectListener, true);
                        inspectListener = null;
                    }
                    if (inspectActive) {
                        inspectListener = (e) => {
                            const tileEl = e.target.closest('[data-tile-id]');
                            if (!tileEl) return;
                            e.stopPropagation();
                            e.preventDefault();
                            const tileId = parseInt(tileEl.getAttribute('data-tile-id'));
                            const tile = (typeof placedTiles !== 'undefined') ? placedTiles.find(t => t.id === tileId) : null;
                            if (!tile) { inspectOut.textContent = `tile id=${tileId} not found`; return; }
                            const lines = [
                                `id:        ${tile.id}`,
                                `shrine:    ${tile.shrineType || '(hidden)'}`,
                                `flipped:   ${tile.flipped}`,
                                `pos:       x=${tile.x?.toFixed(1)}, y=${tile.y?.toFixed(1)}`,
                                `rotation:  ${tile.rotation ?? 0}`,
                                `isPlayer:  ${tile.isPlayerTile || false}`,
                            ];
                            const overlayKey = tile.isPlayerTile
                                ? (tile.playerColorName ? `player_${tile.playerColorName}` : null)
                                : (tile.flipped ? 'unflipped' : tile.shrineType);
                            const overlay = window.tileOverlaySettings?.[overlayKey];
                            if (overlay) {
                                lines.push(`overlay:   x=${overlay.x} y=${overlay.y} r=${overlay.rotation} s=${overlay.scale}`);
                                lines.push(`           op=${overlay.opacity} tint=${overlay.tintOpacity}`);
                            }
                            inspectOut.textContent = lines.join('\n');
                        };
                        document.addEventListener('click', inspectListener, true);
                    }
                });
                inspectSection.appendChild(inspectBtn);
                inspectSection.appendChild(inspectOut);
                panel.appendChild(inspectSection);

                // ── Sprite Effect Lab ─────────────────────────────────────────
                (function buildSpriteEffectLab() {
                    const section = document.createElement('div');
                    section.style.cssText = 'border-top:1px solid #444;padding-top:8px;display:flex;flex-direction:column;gap:6px;';

                    const title = document.createElement('div');
                    title.textContent = '✨ Sprite Effect Lab';
                    title.style.cssText = 'font-size:12px;color:#aaa;font-weight:bold;cursor:pointer;user-select:none;';
                    let open = false;
                    const body = document.createElement('div');
                    body.style.cssText = 'display:none;flex-direction:column;gap:6px;';
                    title.onclick = () => { open = !open; body.style.display = open ? 'flex' : 'none'; };
                    section.appendChild(title);
                    section.appendChild(body);

                    // State
                    let frames = [];
                    let animTimer = null;
                    let currentFrame = 0;
                    let cfg = { fps: 18, hueRotate: 0, brightness: 1, saturation: 1, scale: 1, trigger: 'stone_destroyed', stoneType: 'fire' };

                    // Preview canvas
                    const previewWrap = document.createElement('div');
                    previewWrap.style.cssText = 'display:flex;justify-content:center;align-items:center;background:#111;border:1px solid #333;border-radius:4px;height:100px;';
                    const canvas = document.createElement('canvas');
                    canvas.width = 80; canvas.height = 80;
                    canvas.style.cssText = 'image-rendering:pixelated;';
                    previewWrap.appendChild(canvas);
                    body.appendChild(previewWrap);
                    const ctx2 = canvas.getContext('2d');

                    function drawFrame() {
                        ctx2.clearRect(0, 0, canvas.width, canvas.height);
                        if (!frames.length) return;
                        const img = frames[currentFrame % frames.length];
                        const s = cfg.scale;
                        const w = img.width * s, h = img.height * s;
                        ctx2.save();
                        ctx2.filter = `hue-rotate(${cfg.hueRotate}deg) brightness(${cfg.brightness}) saturate(${cfg.saturation})`;
                        ctx2.drawImage(img, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
                        ctx2.restore();
                    }

                    function startAnim() {
                        if (animTimer) clearInterval(animTimer);
                        if (!frames.length) return;
                        animTimer = setInterval(() => { currentFrame = (currentFrame + 1) % frames.length; drawFrame(); }, 1000 / cfg.fps);
                    }

                    // File upload
                    const uploadRow = document.createElement('div');
                    uploadRow.style.cssText = 'display:flex;gap:4px;align-items:center;';
                    const uploadLabel = document.createElement('span');
                    uploadLabel.textContent = 'Frames:';
                    uploadLabel.style.cssText = 'font-size:11px;color:#aaa;width:44px;flex-shrink:0;';
                    const fileInput = document.createElement('input');
                    fileInput.type = 'file';
                    fileInput.multiple = true;
                    fileInput.accept = 'image/png,image/webp';
                    fileInput.style.cssText = 'flex:1;font-size:10px;color:#eee;background:#111;border:1px solid #555;border-radius:4px;padding:2px;cursor:pointer;min-width:0;';
                    const frameCount = document.createElement('span');
                    frameCount.style.cssText = 'font-size:10px;color:#6ef;width:32px;text-align:right;flex-shrink:0;';
                    frameCount.textContent = '0 fr';
                    fileInput.onchange = () => {
                        const files = Array.from(fileInput.files).sort((a, b) => a.name.localeCompare(b.name));
                        frames = [];
                        currentFrame = 0;
                        let loaded = 0;
                        files.forEach((f, i) => {
                            const img = new Image();
                            img.onload = () => {
                                frames[i] = img;
                                loaded++;
                                if (loaded === files.length) {
                                    frameCount.textContent = `${loaded} fr`;
                                    // Fit first frame in preview
                                    const first = frames[0];
                                    cfg.scale = Math.min(1, 80 / Math.max(first.width, first.height));
                                    scaleSlider.value = cfg.scale.toFixed(2);
                                    scaleVal.textContent = cfg.scale.toFixed(2);
                                    startAnim();
                                }
                            };
                            img.src = URL.createObjectURL(f);
                        });
                    };
                    uploadRow.appendChild(uploadLabel);
                    uploadRow.appendChild(fileInput);
                    uploadRow.appendChild(frameCount);
                    body.appendChild(uploadRow);

                    // Slider helper
                    function makeSlider(label, min, max, step, key, initial, format) {
                        const row = document.createElement('div');
                        row.style.cssText = 'display:flex;align-items:center;gap:5px;';
                        const lbl = document.createElement('span');
                        lbl.textContent = label;
                        lbl.style.cssText = 'font-size:11px;color:#aaa;width:44px;flex-shrink:0;';
                        const sl = document.createElement('input');
                        sl.type = 'range'; sl.min = min; sl.max = max; sl.step = step; sl.value = initial;
                        sl.style.cssText = 'flex:1;accent-color:#f96;min-width:0;';
                        const vl = document.createElement('span');
                        vl.style.cssText = 'font-size:11px;color:#eee;width:40px;text-align:right;flex-shrink:0;';
                        vl.textContent = format(initial);
                        sl.oninput = () => {
                            const v = parseFloat(sl.value);
                            cfg[key] = v;
                            vl.textContent = format(v);
                            if (key === 'fps') startAnim(); else drawFrame();
                        };
                        row.appendChild(lbl); row.appendChild(sl); row.appendChild(vl);
                        body.appendChild(row);
                        return { slider: sl, val: vl };
                    }

                    makeSlider('Hue',    0, 360, 1,    'hueRotate',  0,   v => `${Math.round(v)}°`);
                    makeSlider('Bright', 0.1, 3, 0.05, 'brightness', 1,   v => v.toFixed(2));
                    makeSlider('Satur',  0, 3,   0.05, 'saturation', 1,   v => v.toFixed(2));
                    const { slider: scaleSlider, val: scaleVal } = makeSlider('Scale', 0.1, 3, 0.05, 'scale', 1, v => v.toFixed(2));
                    makeSlider('FPS',    1, 60,  1,    'fps',        18,  v => `${Math.round(v)}`);

                    // Trigger + stone type
                    function makeSelect(label, key, options) {
                        const row = document.createElement('div');
                        row.style.cssText = 'display:flex;align-items:center;gap:5px;';
                        const lbl = document.createElement('span');
                        lbl.textContent = label;
                        lbl.style.cssText = 'font-size:11px;color:#aaa;width:44px;flex-shrink:0;';
                        const sel = document.createElement('select');
                        sel.style.cssText = 'flex:1;background:#111;color:#eee;border:1px solid #555;border-radius:4px;padding:2px 4px;font-size:11px;min-width:0;';
                        options.forEach(([val, text]) => {
                            const opt = document.createElement('option');
                            opt.value = val; opt.textContent = text;
                            if (val === cfg[key]) opt.selected = true;
                            sel.appendChild(opt);
                        });
                        sel.onchange = () => { cfg[key] = sel.value; };
                        row.appendChild(lbl); row.appendChild(sel);
                        body.appendChild(row);
                    }

                    makeSelect('Trigger', 'trigger', [
                        ['stone_destroyed', 'Stone destroyed'],
                        ['scroll_cast',     'Scroll activated'],
                        ['tile_placed',     'Tile placed'],
                        ['turn_end',        'Turn end'],
                    ]);
                    makeSelect('Stone', 'stoneType', [
                        ['fire',     'Fire'],
                        ['earth',    'Earth'],
                        ['water',    'Water'],
                        ['wind',     'Wind'],
                        ['void',     'Void'],
                        ['catacomb', 'Catacomb'],
                        ['any',      'Any'],
                    ]);

                    // Export
                    const exportBtn = document.createElement('button');
                    exportBtn.textContent = '📋 Export Config';
                    Object.assign(exportBtn.style, { padding:'4px 8px', background:'#2d2d44', color:'#f96', border:'1px solid #555', borderRadius:'5px', cursor:'pointer', fontSize:'11px' });
                    exportBtn.onclick = () => {
                        const out = JSON.stringify({
                            trigger:    cfg.trigger,
                            stoneType:  cfg.stoneType,
                            frames:     frames.length || '?',
                            fps:        Math.round(cfg.fps),
                            hueRotate:  Math.round(cfg.hueRotate),
                            brightness: parseFloat(cfg.brightness.toFixed(2)),
                            saturation: parseFloat(cfg.saturation.toFixed(2)),
                            scale:      parseFloat(cfg.scale.toFixed(2)),
                        }, null, 2);
                        const existing = body.querySelector('.sprite-export-area');
                        if (existing) { existing.remove(); return; }
                        const ta = document.createElement('textarea');
                        ta.className = 'sprite-export-area';
                        ta.value = out;
                        ta.style.cssText = 'width:100%;height:130px;background:#111;color:#f96;border:1px solid #444;border-radius:4px;font-size:10px;padding:4px;box-sizing:border-box;resize:vertical;';
                        body.appendChild(ta);
                        ta.select();
                    };
                    body.appendChild(exportBtn);
                    panel.appendChild(section);
                })();

                panel.appendChild(makeBtn('✕ Close', () => {
                    if (inspectListener) document.removeEventListener('click', inspectListener, true);
                    panel.remove();
                }));

                document.body.appendChild(panel);
            }

            document.addEventListener('click', function(e) {
                if (!e.target || !e.target.classList.contains('hud-ap-label')) return;
                // Dev/cheat tooling is restricted to the TheHermit account.
                if (typeof window.isHermit === 'function' && !window.isHermit()) return;
                clickCount++;
                clearTimeout(clickTimer);
                if (clickCount >= 5) {
                    clickCount = 0;
                    openCheatPanel();
                } else {
                    clickTimer = setTimeout(() => { clickCount = 0; }, 3000);
                }
            });

            // Bridge so the Hermit-only "TH" menu can open the cheat panel
            // directly, without the secret 5x-click gesture.
            window._openCheatPanel = openCheatPanel;
        })();

        // ─── Bot Training window ────────────────────────────────────────────
        // A lighter, player-facing sibling of the dev cheat panel's Train
        // Weights buttons: pick a player count and a speed, press Start —
        // plus a live roster of the current population, a generation-by-
        // generation log, and a click-through weight diagram per bot, so
        // the "what is actually happening" question has a real answer
        // on-screen instead of just a progress bar.
        // Activate: click the Profile modal's header ("Profile" —
        // <h2 class="gami-title">, always that exact text regardless of
        // which tab is active, see gamification-ui.js) 5 times within 3
        // seconds — same debounce pattern as the AP-label trigger above.
        (function initBotTrainingPanel() {
            let clickCount = 0;
            let clickTimer = null;
            const state = { n: 2, watchable: true, generations: 5, method: 'evolve', noisyAnchor: false, explore: false, formulas: false, talk: true, _public: false };

            // Weight groupings mirror the section comments in bot.js's
            // DEFAULT_WEIGHTS — used purely for the drill-down diagram, so
            // a 50-number table reads as "these are about movement" instead
            // of one long undifferentiated list.
            const WEIGHT_CATEGORIES = [
                { name: 'Activating', keys: ['castBase', 'castUnactivated', 'castDeadElement', 'castAlreadyWon', 'castNoCredit', 'castLevel', 'castChoiceNeed'] },
                { name: 'Stone placement', keys: ['placeBase', 'placeProgress', 'placeUnactivated', 'placeNoCredit', 'placeDoomed', 'planDeficitPenalty'] },
                { name: 'Movement', keys: ['moveBase', 'moveShrineValue', 'moveApPenalty', 'moveExplore', 'moveExploreGradient', 'moveExplorePath', 'moveRevisitPenalty', 'moveFixation'] },
                { name: 'Breaking a stone', keys: ['breakStoneBase', 'breakStoneApPenalty', 'breakUnblock'] },
                { name: 'Clearing a path with fire or void', keys: ['placeUnblock', 'placeFireOwnPlanLoss'] },
                { name: 'Returning home', keys: ['moveReturnHome'] },
                { name: 'Harming the leader (alliances)', keys: ['breakLeaderPattern', 'moveToBreak', 'moveCamp', 'campLeave', 'endTurnCamp'] },
                { name: 'Helping pact partners (alliances)', keys: ['discardForAlly', 'placeAllyRoad'] },
                { name: 'Ending the turn', keys: ['endTurnBase', 'endTurnOnShrine', 'endTurnLowAp'] },
                { name: 'Discarding', keys: ['discardBase', 'discardActivated', 'discardDeadElement', 'discardLevel', 'discardVoluntary', 'discardResponseOnly'] },
                { name: 'Transmute', keys: ['transmuteTargetAP'] },
                { name: 'Placement phase', keys: ['placeTileBase', 'placeTileCentroidPenalty'] },
                { name: 'Shrine valuation', keys: ['shrineNeed', 'shrineUnactivated', 'shrineDeadSource'] },
                { name: 'Lookahead search (set by Bot Brain, not trained)', keys: ['searchDepth', 'searchBreadth', 'searchHybrid', 'searchKeepCasts', 'searchCastExtraDepth'] },
                { name: 'State evaluation (used only when search is active)', keys: ['evalWin', 'evalActivated', 'evalStoneNeeded', 'evalStone', 'evalScrollHeld', 'evalScrollCredit', 'evalScrollNoCredit', 'evalScrollResponse', 'evalScrollUnknownEase', 'evalHandOverflow', 'evalAp', 'evalUnsimCast', 'evalHiddenDist', 'evalHomeDist', 'evalUnreachableSteps'] },
                { name: 'Opponent awareness', keys: ['evalOpponentThreat', 'evalCommonThreat'] },
            ];

            // Small inline "(?)" tooltip — native title attribute, no extra
            // wiring. Used next to jargon (Population, Generation, Fitness, ...).
            function infoIcon(text) {
                const s = document.createElement('span');
                s.textContent = ' ⓘ';
                s.title = text;
                s.style.cssText = 'color:#6ef;cursor:help;font-size:11px;';
                return s;
            }

            function openBotTrainingPanel() {
                const existing = document.getElementById('bot-training-overlay');
                if (existing) { existing.remove(); return; }
                // bot-arena.js is lazy-loaded (js/asset-preloader.js § Lazy scripts).
                if (!window.BotArena && window.LazyScripts) {
                    window.LazyScripts.load('bot-arena').then(openBotTrainingPanel,
                        () => updateStatus('BotArena not loaded'));
                    return;
                }
                if (!window.BotArena) { updateStatus('BotArena not loaded'); return; }

                // The auth-bar "Train Bot" button (gamification-ui.js's
                // _gami_openTrainBot) sets this one-shot flag. Public training
                // is hill-climb-only against the single shared community
                // champion, with Quick / Standard / Deep presets. Consumed
                // into `state` (which persists across this modal being
                // closed/reopened mid-run via the popup's expand button).
                const busy = !!(window.BotArena.isEvolving?.() || window.BotArena.isClimbing?.());
                if (window._botTrainingPublic) {
                    if (!state._public && !state._forced) state._forced = { method: state.method, n: state.n };
                    state._public = true;
                    state.method = 'hillclimb';
                    state.n = 2;
                    window._botTrainingPublic = null;
                } else if (!busy) {
                    // The hermit panel (owner, 2026-09-29): a finished public
                    // Train Bot run or a continued saved run left the panel stuck
                    // in public / Hill Climb mode, hiding or greying out Players.
                    state._public = false;
                    if (state._forced) { state.method = state._forced.method; state.n = state._forced.n; state._forced = null; }
                }

                // ── Shell: full-screen overlay + centered modal box ──────────
                const overlay = document.createElement('div');
                overlay.id = 'bot-training-overlay';
                Object.assign(overlay.style, {
                    position: 'fixed', inset: '0', background: 'rgba(0,0,0,0.6)',
                    zIndex: '9999', display: 'flex', alignItems: 'center', justifyContent: 'center',
                });
                overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

                const modal = document.createElement('div');
                Object.assign(modal.style, {
                    background: '#1a1a2e', border: '1px solid #444', borderRadius: '10px',
                    boxShadow: '0 8px 32px rgba(0,0,0,0.7)', width: 'min(920px, 94vw)',
                    maxHeight: '90vh', display: 'flex', flexDirection: 'column', overflow: 'hidden',
                });
                overlay.appendChild(modal);

                const header = document.createElement('div');
                header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px solid #333;flex-shrink:0;';
                const title = document.createElement('div');
                title.textContent = 'Bot Training';
                title.style.cssText = 'font-size:15px;font-weight:bold;color:#eee;';
                header.appendChild(title);
                const closeBtn = document.createElement('button');
                closeBtn.textContent = '✕';
                closeBtn.style.cssText = 'background:none;border:1px solid #555;border-radius:5px;color:#ccc;cursor:pointer;padding:3px 10px;font-size:13px;';
                closeBtn.onclick = () => overlay.remove();
                header.appendChild(closeBtn);
                modal.appendChild(header);

                const body = document.createElement('div');
                body.style.cssText = 'padding:14px 16px;overflow-y:auto;display:flex;flex-direction:column;gap:14px;';
                modal.appendChild(body);

                const desc = document.createElement('div');
                desc.textContent = 'Trains the bots you play against. New weights are only kept if they beat the current ones in a confirmation match at the end. A small progress popup stays visible in the corner even after you close this panel - use it to check in or end the run early.';
                desc.style.cssText = 'font-size:11px;color:#999;';
                body.appendChild(desc);

                if (state._public) {
                    const publicBanner = document.createElement('div');
                    publicBanner.textContent = 'Training the community bot - the shared brain behind the five elemental bots. Every finished run pays gold scaled to how many games it ran (roughly 8–40). If the result beats the current champion across 2–5 player tables it\'s submitted for everyone and pays 25 / 40 / 60 more by how decisively it won. Nothing changes if it doesn\'t beat the champion.';
                    publicBanner.style.cssText = 'font-size:11px;color:#c9a6ff;background:#221a33;border:1px solid #5a3f8a;border-radius:5px;padding:6px 10px;';
                    body.appendChild(publicBanner);
                }

                // ── Controls: Players / Speed / Repeat ───────────────────────
                const controls = document.createElement('div');
                controls.style.cssText = 'display:flex;flex-direction:column;gap:6px;';
                body.appendChild(controls);

                // isDisabled: optional () => bool for a row disabled for a
                // reason OTHER than "a run is active" (e.g. Players is fixed
                // at 2 while Method is Hill Climb — that trainer has no
                // nPlayers concept). Returns {repaint} so other rows (Method)
                // can force a repaint of THIS row when their own value changes.
                function makeChoiceRow(label, options, getValue, setValue, help, isDisabled) {
                    const row = document.createElement('div');
                    row.style.cssText = 'display:flex;align-items:center;gap:6px;flex-wrap:wrap;';
                    const lbl = document.createElement('span');
                    lbl.textContent = label;
                    lbl.style.cssText = 'font-size:12px;color:#aaa;min-width:52px;';
                    row.appendChild(lbl);
                    if (help) row.appendChild(infoIcon(help));
                    const buttons = options.map(opt => {
                        const b = document.createElement('button');
                        b.textContent = opt.text;
                        if (opt.title) b.title = opt.title;
                        row.appendChild(b);
                        return { b, value: opt.value };
                    });
                    function repaint() {
                        const rowDisabled = !!isDisabled?.();
                        for (const { b, value } of buttons) {
                            const on = value === getValue();
                            b.style.cssText = `padding:4px 9px;border-radius:5px;cursor:${rowDisabled ? 'not-allowed' : 'pointer'};font-size:12px;opacity:${rowDisabled ? '0.45' : '1'};` +
                                `border:1px solid ${on ? '#6ef' : '#555'};background:${on ? '#2d4a4a' : '#2d2d44'};color:#eee;`;
                        }
                    }
                    for (const { b, value } of buttons) {
                        b.onclick = () => {
                            if (startBtnRef.disabled || isDisabled?.()) return; // locked while a run is active, or by another control
                            setValue(value);
                            repaint();
                        };
                    }
                    repaint();
                    controls.appendChild(row);
                    return { repaint };
                }

                // startBtnRef is read inside makeChoiceRow's onclick above, so it
                // needs to exist (even if reassigned below) before the rows are built.
                const startBtnRef = { disabled: false };

                // Method picked FIRST — Players' row below reads state.method
                // to decide whether it's disabled, so it needs to exist first.
                // Evolve = population GA (evolve() below) — noisier, ranks
                // siblings against each other. Hill Climb = champion-anchored
                // (1+λ) monotonic climber (hillClimb()) — holds the ONLINE
                // champion fixed as the opponent every mutant challenger must
                // clear a real margin against; the reliable trainer, same one
                // driving the CLI's --hillclimb sessions. 2-player only — no
                // nPlayers concept, unlike evolve().
                // The auth-bar "Train Bot" button forces Hill Climb against the
                // shared champion — no Method choice in public mode.
                if (!state._public) {
                    makeChoiceRow('Method:', [
                        { value: 'evolve', text: 'Evolve (GA)', title: 'Population-based genetic algorithm - a pool of weight-tables competes and breeds each generation.' },
                        { value: 'hillclimb', text: 'Hill Climb', title: 'Champion-anchored climber - mutant challengers must beat the CURRENT ONLINE CHAMPION by a real margin to be promoted. 2 players only. The more reliable trainer.' },
                    ], () => state.method, (v) => { state.method = v; if (v === 'hillclimb') state.n = 2; playersRow.repaint(); });
                }

                // Public "Train Bot" is always 2-player hill-climb (the final
                // gate already tests 2–5 tables on its own) — no Players choice.
                let playersRow = { repaint() {} };
                if (!state._public) {
                    playersRow = makeChoiceRow('Players:',
                        [2, 3, 4, 5].map(n => ({ value: n, text: String(n) })).concat([
                            { value: 'all', text: 'All', title: 'Generalist: train across arenas of every size (2–5 players) and confirm the champion across every size too. Best for real lobbies, which can be 2–5 players.' },
                        ]),
                        () => state.n, (v) => { state.n = v; },
                        'How many bots play each training game. "All" trains across mixed 2–5-player arenas and confirms the champion at every size. The POPULATION (the pool of competing weight-tables) is a separate number - see the roster below - this only controls how many are sampled into any one game. Fixed at 2 for Hill Climb, which has no population/nPlayers concept.',
                        () => state.method === 'hillclimb');
                }

                makeChoiceRow('Speed:', [
                    { value: true, text: 'Watchable', title: 'Normal pacing - watch the board play out' },
                    { value: false, text: 'Extreme', title: 'Muted, minimal delay - much faster, nothing to watch (a true no-UI "headless" mode isn\'t possible in the browser tab the live game runs in)' },
                ], () => state.watchable, (v) => { state.watchable = v; });

                // For Evolve this is evolve()'s generation count; for Hill
                // Climb it's the number of climbing ROUNDS (each round plays
                // lambda=6 challengers × 30 games, same
                // proportional-not-literal-game-count caveat applies).
                if (state._public) {
                    makeChoiceRow('Depth:', [
                        { value: 1, text: 'Quick', title: 'A short climb - usually under ~15 minutes. Often finds no improvement; run it again or go deeper.' },
                        { value: 5, text: 'Standard', title: 'A medium climb - roughly 30–60 minutes. Better odds of a real improvement.' },
                        { value: 20, text: 'Deep', title: 'A long climb - a couple of hours. Best odds; leave the tab open and watch the corner popup.' },
                    ], () => state.generations, (v) => { state.generations = v; },
                        'How hard to search for a better bot. It plays training games in your browser tab against the current champion, then a final test across 2–5 player tables. Deeper = better odds of beating it, but longer. You can Stop any time from the corner popup; a partial run never makes the bot worse.');
                } else {
                    makeChoiceRow('Repeat:',
                        [1, 5, 10, 20, 50].map(n => ({ value: n, text: String(n) })),
                        () => state.generations, (v) => { state.generations = v; },
                        'Evolve: number of GENERATIONS, not total games - each generation plays many games on its own. Hill Climb: number of climbing ROUNDS - each round plays 6 challengers × 30 games vs the champion. Either way this is proportionally, not literally, that many games.');
                }

                // Noisy anchor: train against a gaussian-perturbed copy of the
                // anchor (the champion / your bot / the Void Knight) instead of
                // the exact table, then CONFIRM against the true anchor. Pushes
                // the result to be robust to a distribution of nearby opponents
                // rather than overfit to one exact champion — a direct counter
                // to the co-evolution weakness (siblings beating siblings).
                makeChoiceRow('Anchor:', [
                    { value: false, text: 'Exact', title: 'Train against the anchor weights exactly as they are.' },
                    { value: true, text: 'Noisy', title: 'Train against a slightly perturbed copy of the anchor each session (more robust, less overfit); the final confirmation match is still played against the TRUE anchor, so a win still means a real improvement.' },
                ], () => state.noisyAnchor, (v) => { state.noisyAnchor = v; },
                    'Noisy trains against a randomly perturbed version of the opponent so the result generalizes to a range of opponents instead of overfitting one exact champion. The confirmation match at the end always uses the true, unperturbed anchor - so "improved" still means genuinely better.');

                // Explore first (Hill Climb only): a short Evolve search across
                // 2-5 player games whose best bot joins round 1 as a challenger
                // (runHillClimbTraining opts.explore). Pays EXPLORE_BONUS_GOLD
                // when the whole run finishes.
                makeChoiceRow('Explore:', [
                    { value: false, text: 'Off', title: 'Climb straight from the champion.' },
                    { value: true, text: `First (+${EXPLORE_BONUS_GOLD} gold)`, title: `First run a short Evolve search across 2-5 player games (about ${EXPLORE_GAMES} extra games). Its best bot joins the climb as a challenger and must still beat the champion. +${EXPLORE_BONUS_GOLD} bonus gold when the whole run finishes.` },
                ], () => state.explore, (v) => { state.explore = v; },
                    'Explore searches more widely (and across 2-5 player games) before the climb. It never lowers the bar: the explored bot has to beat the real champion like every other challenger. Hill Climb only.');

                // Formulas (Hill Climb only): challengers may also invent new
                // "senses", small formulas over board facts (js/bot-terms.js),
                // not just nudge the brain's numbers (hillClimb opts.termMutations).
                makeChoiceRow('Formulas:', [
                    { value: false, text: 'Off', title: 'Challengers only change the brain\'s numbers (how much it cares about each thing it already notices).' },
                    { value: true, text: `Invent (+${FORMULA_BONUS_GOLD} gold)`, title: `Challengers may also invent new senses: small formulas built from board facts, like "the cost of my road home" or "water touching wind". Most will not help; the few that do win their way in. +${FORMULA_BONUS_GOLD} gold when the whole run finishes, and +${FORMULA_DISCOVERY_GOLD} more if the new champion keeps a formula it invented.` },
                ], () => state.formulas, (v) => { state.formulas = v; },
                    'The bot judges a position with a list of things it notices, each with a weight. Normal training only changes the weights. With Invent, a challenger can also add, drop or change a formula, a new thing to notice. It still has to beat the champion to count. Hill Climb only.');

                // Bot talk (alliances emotes) during fast training too, and
                // the training window's "What the bots said" list either way.
                makeChoiceRow('Bot talk:', [
                    { value: true, text: 'Show', title: 'Bots show their emote sentences over their pawns even at Extreme speed.' },
                    { value: false, text: 'Hide', title: 'No emotes over the pawns at Extreme speed (a little faster). The training window still lists what they said.' },
                ], () => state.talk, (v) => { state.talk = v; window.BotDiplomacy?.setTalkInTraining?.(v); },
                    'Bots warn each other, make pacts and hold grudges with emotes. Watchable speed always shows them. Show also keeps them on at Extreme speed; the training window lists what was said either way.');

                const progressText = document.createElement('div');
                progressText.style.cssText = 'font-size:11px;color:#aaa;white-space:pre-line;display:none;';
                body.appendChild(progressText);

                function fmtTime(s) { return s < 90 ? `${Math.round(s)}s` : `${Math.round(s / 60)}m`; }
                function renderProgress(p) {
                    progressText.style.display = 'block';
                    const pct = p.totalGames ? Math.min(100, (p.gamesDone / p.totalGames) * 100) : 0;
                    const elapsedS = (Date.now() - p.startedAt) / 1000;
                    let genLine;
                    if (p.mode === 'hillclimb') {
                        genLine = p.phase === 'confirming' ? 'confirming across 2–5 player tables' : `round ${p.round}/${p.rounds}`;
                        if (p.gameNum) {
                            genLine += p.phase === 'confirming'
                                ? ` - game ${p.gameNum}/${p.gameTotal}`
                                : ` - challenger ${p.challenger}/${p.totalChallengers} (${p.sideAColor}) vs. champion (${p.sideBColor}), game ${p.gameNum}/${p.gameTotal}`;
                        }
                    } else {
                        genLine = p.phase === 'confirming' ? 'Confirming result' : `gen ${p.gen}/${p.generations}`;
                    }
                    progressText.textContent = `${genLine} - games ${p.gamesDone}/${p.totalGames} (${pct.toFixed(0)}%) · ${fmtTime(elapsedS)}`;
                    // Also update the persistent corner popup — see its own
                    // comment for why it's a separate, outer-scope function
                    // rather than just this progressText element.
                    showTrainingPopup(p);
                }

                const actionRow = document.createElement('div');
                actionRow.style.cssText = 'display:flex;gap:8px;';
                body.appendChild(actionRow);

                const startBtn = document.createElement('button');
                startBtn.textContent = 'Start Training';
                startBtn.style.cssText = 'padding:6px 10px;background:#2d4a2d;color:#eee;border:1px solid #5a5;border-radius:5px;cursor:pointer;font-size:12px;';
                actionRow.appendChild(startBtn);

                const stopBtn = document.createElement('button');
                stopBtn.textContent = 'Stop';
                stopBtn.style.cssText = 'padding:5px 9px;background:#442d2d;color:#eee;border:1px solid #755;border-radius:5px;cursor:pointer;font-size:12px;';
                stopBtn.onclick = () => {
                    if (window.BotArena?.isRunning()) { window.BotArena.stop(); updateStatus('Stopping after the current generation…'); }
                    else updateStatus('No training run in progress');
                };
                actionRow.appendChild(stopBtn);

                // ── Live roster + generation log + weight-diagram drill-down ──
                // Populated by Start Training's Evolve method (Hill Climb has
                // no population concept). Population membership persists id/lineage across
                // generations (see bot-arena.js's newMember()/elites), so the
                // roster can show "same bot survived" vs "freshly bred" from
                // one generation to the next instead of just bare numbers.
                // Hidden entirely in public mode (hill-climb only — no population).
                const insightRow = document.createElement('div');
                insightRow.style.cssText = state._public
                    ? 'display:none;'
                    : 'display:flex;gap:14px;flex-wrap:wrap;';
                body.appendChild(insightRow);

                const rosterCol = document.createElement('div');
                rosterCol.style.cssText = 'flex:1 1 260px;min-width:240px;display:flex;flex-direction:column;gap:6px;';
                insightRow.appendChild(rosterCol);

                const rosterHeader = document.createElement('div');
                rosterHeader.style.cssText = 'font-size:12px;font-weight:bold;color:#ccc;';
                rosterHeader.textContent = 'Population';
                rosterHeader.appendChild(infoIcon('The pool of weight-tables currently competing. The top 2 by fitness survive unchanged into the next generation ("elite"); the rest are bred (crossover of the top 3, then mutated) and get a new #id. Click a row to see its weights.'));
                rosterCol.appendChild(rosterHeader);

                const rosterList = document.createElement('div');
                rosterList.style.cssText = 'display:flex;flex-direction:column;gap:3px;max-height:220px;overflow-y:auto;';
                rosterCol.appendChild(rosterList);

                const genCol = document.createElement('div');
                genCol.style.cssText = 'flex:1 1 220px;min-width:200px;display:flex;flex-direction:column;gap:6px;';
                insightRow.appendChild(genCol);

                const genHeader = document.createElement('div');
                genHeader.style.cssText = 'font-size:12px;font-weight:bold;color:#ccc;';
                genHeader.textContent = 'Generations';
                genHeader.appendChild(infoIcon('One line per generation completed so far in the current run: which #id came out on top and its fitness. Fitness is win(±1) plus small bonuses for win-progress and avoiding stalls - not a plain score, so small differences are normal.'));
                genCol.appendChild(genHeader);

                const genLogEl = document.createElement('div');
                genLogEl.style.cssText = 'display:flex;flex-direction:column-reverse;gap:2px;max-height:220px;overflow-y:auto;font-size:11px;color:#aaa;font-family:monospace;';
                genCol.appendChild(genLogEl);

                const detailCol = document.createElement('div');
                detailCol.style.cssText = 'flex:1 1 320px;min-width:280px;display:none;flex-direction:column;gap:6px;';
                insightRow.appendChild(detailCol);

                const detailHeader = document.createElement('div');
                detailHeader.style.cssText = 'font-size:12px;font-weight:bold;color:#ccc;display:flex;align-items:center;justify-content:space-between;';
                detailCol.appendChild(detailHeader);

                const detailBody = document.createElement('div');
                detailBody.style.cssText = 'display:flex;flex-direction:column;gap:8px;max-height:400px;overflow-y:auto;font-size:11px;';
                detailCol.appendChild(detailBody);

                // ── Roster/generation state for the CURRENT run ──────────────
                let currentRoster = [];   // latest members array (id, fitness, parentIds, w), best-first
                let genLog = [];          // [{gen, total, bestId, bestFitness}]
                let seenIds = new Set();  // ids ever shown this run — lets the roster mark "new this gen"
                let selectedMemberId = null;

                function resetInsights() {
                    currentRoster = [];
                    genLog = [];
                    seenIds = new Set();
                    selectedMemberId = null;
                    rosterList.innerHTML = '';
                    genLogEl.innerHTML = '';
                    detailCol.style.display = 'none';
                }

                function renderRoster() {
                    rosterList.innerHTML = '';
                    if (!currentRoster.length) {
                        const empty = document.createElement('div');
                        empty.textContent = 'No run in progress - start training or breeding to see the population here.';
                        empty.style.cssText = 'font-size:11px;color:#777;font-style:italic;';
                        rosterList.appendChild(empty);
                        return;
                    }
                    const maxFitness = Math.max(...currentRoster.map(m => m.fitness), 1);
                    for (const m of currentRoster) {
                        const row = document.createElement('div');
                        row.style.cssText = `display:flex;align-items:center;gap:6px;padding:4px 6px;border-radius:5px;cursor:pointer;` +
                            `background:${m.id === selectedMemberId ? '#2d4a4a' : '#22223a'};border:1px solid ${m.id === selectedMemberId ? '#6ef' : '#333'};`;
                        row.onclick = () => { selectedMemberId = m.id; renderRoster(); renderDetail(); };

                        const idEl = document.createElement('div');
                        idEl.textContent = `#${m.id}`;
                        idEl.style.cssText = 'font-size:11px;color:#eee;font-weight:bold;min-width:28px;';
                        row.appendChild(idEl);

                        const barWrap = document.createElement('div');
                        barWrap.style.cssText = 'flex:1;background:#111;border-radius:3px;height:10px;overflow:hidden;position:relative;';
                        const bar = document.createElement('div');
                        const barPct = maxFitness !== 0 ? Math.max(0, Math.min(100, (m.fitness / maxFitness) * 100)) : 0;
                        bar.style.cssText = `height:100%;width:${barPct}%;background:${m.fitness >= 0 ? '#4a8' : '#a44'};`;
                        barWrap.appendChild(bar);
                        row.appendChild(barWrap);

                        const fitEl = document.createElement('div');
                        fitEl.textContent = m.fitness.toFixed(1);
                        fitEl.style.cssText = 'font-size:11px;color:#ccc;min-width:34px;text-align:right;';
                        row.appendChild(fitEl);

                        // Check "already seen" FIRST — an elite that was
                        // originally bred several generations ago must show
                        // as "surviving," not re-show its birth lineage every
                        // generation as if it had just been bred again.
                        const lineageEl = document.createElement('div');
                        lineageEl.style.cssText = 'font-size:10px;color:#888;min-width:64px;text-align:right;';
                        lineageEl.textContent = seenIds.has(m.id) ? 'elite (surviving)'
                            : (m.parentIds && m.parentIds.length === 2) ? `bred #${m.parentIds[0]}×#${m.parentIds[1]}`
                            : (m.parentIds && m.parentIds.length === 1) ? `mutated #${m.parentIds[0]}`
                            : 'seed';
                        row.appendChild(lineageEl);

                        rosterList.appendChild(row);
                        seenIds.add(m.id);
                    }
                }

                function renderGenLog() {
                    genLogEl.innerHTML = '';
                    for (const g of genLog) {
                        const line = document.createElement('div');
                        line.textContent = `gen ${g.gen}/${g.total} - best: #${g.bestId} (${g.bestFitness.toFixed(1)})`;
                        genLogEl.appendChild(line);
                    }
                }

                function weightBar(key, value, baseline) {
                    const row = document.createElement('div');
                    row.style.cssText = 'display:flex;align-items:center;gap:6px;';
                    const keyEl = document.createElement('div');
                    keyEl.textContent = key;
                    keyEl.style.cssText = 'width:150px;flex-shrink:0;color:#aaa;font-family:monospace;font-size:10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
                    row.appendChild(keyEl);

                    const diffPct = baseline !== 0 ? ((value - baseline) / Math.abs(baseline)) * 100 : (value === 0 ? 0 : 100);
                    const barWrap = document.createElement('div');
                    barWrap.style.cssText = 'flex:1;background:#111;border-radius:3px;height:9px;overflow:hidden;';
                    const bar = document.createElement('div');
                    const width = Math.min(100, Math.abs(diffPct));
                    const color = diffPct > 0.5 ? '#4a8' : diffPct < -0.5 ? '#a44' : '#555';
                    bar.style.cssText = `height:100%;width:${width}%;background:${color};`;
                    barWrap.appendChild(bar);
                    row.appendChild(barWrap);

                    const valEl = document.createElement('div');
                    valEl.textContent = `${value} (base ${baseline}, ${diffPct >= 0 ? '+' : ''}${diffPct.toFixed(0)}%)`;
                    valEl.style.cssText = 'width:130px;flex-shrink:0;color:#ccc;font-family:monospace;font-size:10px;text-align:right;';
                    row.appendChild(valEl);
                    return row;
                }

                function renderDetail() {
                    const member = currentRoster.find(m => m.id === selectedMemberId);
                    if (!member) { detailCol.style.display = 'none'; return; }
                    detailCol.style.display = 'flex';
                    detailHeader.innerHTML = '';
                    const label = document.createElement('span');
                    label.textContent = `#${member.id} weights (vs. hand-tuned default)`;
                    detailHeader.appendChild(label);
                    const closeDetail = document.createElement('button');
                    closeDetail.textContent = '✕';
                    closeDetail.style.cssText = 'background:none;border:1px solid #555;border-radius:4px;color:#ccc;cursor:pointer;padding:1px 7px;font-size:11px;';
                    closeDetail.onclick = () => { selectedMemberId = null; renderRoster(); renderDetail(); };
                    detailHeader.appendChild(closeDetail);

                    detailBody.innerHTML = '';
                    const defaults = window.BotSystem.DEFAULT_WEIGHTS;
                    for (const cat of WEIGHT_CATEGORIES) {
                        const keysPresent = cat.keys.filter(k => member.w[k] !== undefined);
                        if (!keysPresent.length) continue;
                        const catHeader = document.createElement('div');
                        catHeader.textContent = cat.name;
                        catHeader.style.cssText = 'font-size:10px;color:#789;text-transform:uppercase;letter-spacing:0.03em;margin-top:4px;';
                        detailBody.appendChild(catHeader);
                        for (const k of keysPresent) {
                            detailBody.appendChild(weightBar(k, member.w[k], defaults[k]));
                        }
                    }
                }

                // Wired into evolve()'s onGeneration (4th arg — richer roster
                // data, see bot-arena.js) by Start Training's Evolve method.
                function handleGeneration(gen, total, fitnessArr, members) {
                    currentRoster = members;
                    genLog.push({ gen, total, bestId: members[0].id, bestFitness: members[0].fitness });
                    renderRoster();
                    renderGenLog();
                    if (selectedMemberId != null) renderDetail(); // keep the open diagram live
                }

                const startBtnSep = document.createElement('div');
                startBtnSep.style.cssText = 'border-top:1px solid #333;margin:2px 0;';
                body.appendChild(startBtnSep);

                // Continue a saved Train Bot run (see TRAIN_SAVE_KEY).
                const continueBtn = document.createElement('button');
                continueBtn.style.cssText = 'padding:6px 10px;background:#2d4a3a;color:#eee;border:1px solid #5a7;border-radius:5px;cursor:pointer;font-size:12px;';
                const continueNote = document.createElement('div');
                continueNote.style.cssText = 'font-size:11px;color:#9ab;margin-top:4px;';
                function refreshContinue() {
                    const sv = readTrainSave();
                    continueBtn.style.display = sv ? '' : 'none';
                    continueNote.style.display = sv ? '' : 'none';
                    continueBtn.textContent = 'Continue Saved Run';
                    continueNote.textContent = sv ? `Saved run: ${describeTrainSave(sv)}. Starting a new run replaces it.` : '';
                }
                refreshContinue();
                actionRow.insertBefore(continueBtn, startBtn);
                actionRow.insertAdjacentElement('afterend', continueNote);
                let resumeNext = null;
                continueBtn.onclick = () => {
                    resumeNext = readTrainSave();
                    if (!resumeNext) { refreshContinue(); return; }
                    startBtn.onclick();
                };

                startBtn.onclick = async () => {
                    const resumeSave = resumeNext; resumeNext = null;
                    if (window.BotArena.isRunning()) { updateStatus('A bot job is already running - use Stop first'); return; }
                    if (!await stopAnyRunningBotJob()) return;
                    hideLeaveTrainingButton();
                    startBtnRef.disabled = true;
                    startBtn.disabled = true;
                    continueBtn.disabled = true;
                    startBtn.textContent = 'Training…';
                    resetInsights();
                    renderRoster();
                    startTrainTalk(state.talk);
                    // Public mode: collapse to the corner progress popup right
                    // away — the modal's own body has nothing extra to show for
                    // a hill-climb run (the roster is evolve-only). Re-arm the
                    // public flag so the popup's "⤢ expand" reopens in public
                    // mode (cleared again in finally).
                    if (state._public) {
                        window._botTrainingPublic = true;
                        showTrainingPopup({ mode: 'hillclimb', phase: 'starting', explore: resumeSave ? !!resumeSave.runOpts?.explore : state.explore, gamesDone: 0, totalGames: 1, startedAt: Date.now(), roundHistory: [] });
                        overlay.remove();
                    } else {
                        // Hermit runs: the corner popup shows at once too (it
                        // used to wait for the first finished game, ~30 s).
                        showTrainingPopup({ mode: state.method === 'hillclimb' || resumeSave ? 'hillclimb' : 'training', phase: 'starting', nPlayers: state.n, explore: state.explore, gamesDone: 0, totalGames: 1, startedAt: Date.now(), roundHistory: [] });
                    }
                    try {
                        // Public "Train Bot" is hill-climb-only by definition.
                        if ((state._public || resumeSave) && state.method !== 'hillclimb') {
                            if (!state._forced) state._forced = { method: state.method, n: state.n };
                            state.method = 'hillclimb';
                        }
                        if (state.method === 'hillclimb') {
                            // Public Depth presets scale the whole run so the
                            // times in the tooltips are honest; the hermit panel
                            // still uses its own full-size lambda/G.
                            const PUBLIC = {
                                1:  { rounds: 1, lambda: 3, gamesPerChallenge: 8,  gamesPerSize: 3 },
                                5:  { rounds: 3, lambda: 4, gamesPerChallenge: 16, gamesPerSize: 4 },
                                20: { rounds: 8, lambda: 6, gamesPerChallenge: 24, gamesPerSize: 5 },
                            };
                            const p = state._public
                                ? (PUBLIC[state.generations] || PUBLIC[5])
                                : { rounds: state.generations, lambda: 6, gamesPerChallenge: 30, gamesPerSize: 5 };
                            const preset = { ...p, confirmSizes: [2, 3, 4, 5] };
                            const { improved, record, tier, tierGold, promotions, rewarded, submitFailed, attemptGold, formulaGold, formulaKept, totalGold, endedEarly, saveInfo } = await runHillClimbTraining(preset, renderProgress, {
                                visual: state.watchable, noisyAnchor: state.noisyAnchor, explore: state.explore, formulas: state.formulas,
                                public: !!state._public, resume: resumeSave,
                            });
                            progressText.style.display = 'none';
                            const formulaTail = formulaGold
                                ? (formulaKept ? ` +${formulaGold} for formulas, including a new one the champion kept!` : ` +${formulaGold} for trying formulas.`)
                                : '';
                            const bonusTail = (attemptGold ? ` (+${attemptGold} for the games run)` : '') + formulaTail;
                            let msg;
                            if (record === 'saved') {
                                msg = `Training saved (${saveInfo || 'saved'}). Continue it any time from Train Bot on this browser.`;
                            } else if (record === 'stopped') {
                                msg = 'Training stopped - the result was discarded, the champion is unchanged.';
                            } else if (record === 'ended early') {
                                msg = 'Training ended during Explore, before anything was tested against the champion - nothing changed, no gold.';
                            } else if (improved && rewarded) {
                                msg = `Your bot beat the champion - ${tier} win, ${record} across 2-5 player tables. Submitted for everyone. +${totalGold} gold${(attemptGold || formulaGold) ? ` (${tierGold} win${attemptGold ? ` + ${attemptGold} for the games run` : ''}${formulaGold ? ` + ${formulaGold} for formulas${formulaKept ? ', a new one was kept' : ''}` : ''})` : ''}.`;
                            } else if (improved && submitFailed) {
                                msg = `Your bot beat the champion ${record}, but the submission failed - champion unchanged, no win reward.${bonusTail}`;
                            } else if (improved) {
                                msg = `Your bot beat the champion ${record} - new weights applied locally. Log in to submit it for everyone and earn gold.`;
                            } else {
                                msg = endedEarly
                                    ? `Training ended early - didn't beat the champion (${record}), so nothing changed. Runs that end early earn no gold; let a run finish to earn the bonus.`
                                    : `Training done - didn't beat the champion by enough (${record}), so nothing changed.${attemptGold ? ` +${attemptGold} gold for the games run - thanks for helping.` : ''}${formulaTail} Try again or go deeper.`;
                            }
                            updateStatus(msg);
                            // Main page has no #status HUD — the toast is the
                            // only visible result feedback there.
                            window.gami?.notify(msg, totalGold || 0, 'gold');
                        } else {
                            const preset = { generations: state.generations, gamesPerPair: 1, popSize: 6, confirmGames: 10, gamesPerSize: 4 };
                            const { improved, record } = await runWeightTraining(preset, renderProgress, {
                                nPlayers: state.n, visual: state.watchable, noisyAnchor: state.noisyAnchor,
                                onGeneration: handleGeneration,
                            });
                            progressText.style.display = 'none';
                            updateStatus(improved
                                ? `Training complete - champion beat the starting weights ${record} in the confirmation match. New weights applied and saved.`
                                : `Training finished but did not beat the starting weights (${record}) - kept the previous weights.`);
                        }
                    } catch (err) {
                        console.error('Bot training failed:', err);
                        progressText.style.display = 'none';
                        updateStatus(`Bot training failed - ${err.message || 'see console'}`);
                        window.gami?.notify(`Bot training couldn't run - ${err.message || 'see console'}`, 0, 'gold');
                    } finally {
                        startBtnRef.disabled = false;
                        startBtn.disabled = false;
                        continueBtn.disabled = false;
                        refreshContinue();
                        startBtn.textContent = 'Start Training';
                        hideTrainingPopup();
                        showLeaveTrainingButton();
                        window._botTrainingPublic = null; // run over — a fresh open goes through _gami_openTrainBot
                    }
                };

                renderRoster();
                document.body.appendChild(overlay);
            }

            document.addEventListener('click', function(e) {
                if (!e.target || !e.target.classList.contains('gami-title')) return;
                // Dev/cheat tooling is restricted to the TheHermit account.
                if (typeof window.isHermit === 'function' && !window.isHermit()) return;
                clickCount++;
                clearTimeout(clickTimer);
                if (clickCount >= 5) {
                    clickCount = 0;
                    openBotTrainingPanel();
                } else {
                    clickTimer = setTimeout(() => { clickCount = 0; }, 3000);
                }
            });

            // Bridge so the outer-scope training popup's "expand" button can
            // open the full modal without needing its own copy of the
            // 5x-click trigger — see showTrainingPopup()/ensureTrainingPopup().
            window._openBotTrainingPanel = openBotTrainingPanel;
        })();

        // ─── Hermit-only live UI editor (Ctrl+Click) ───────────────────────
        // TheHermit can Ctrl+Click any element to tweak its text/size/font/
        // outline/colour live, then Download the collected overrides as JSON to
        // hand off for baking into the real CSS. Session-only: overrides live in
        // memory (no persistence), applied as !important inline styles. Uploading
        // a previously-downloaded file re-applies it to the current page.
        (function initUiEditor() {
            let overrides = {};          // selector -> { styles:{prop:val}, text? }
            const lastApplied = {};      // selector -> styles last written (for clean removal)
            let panelEl = null;
            let highlightEl = null;

            // Unique-ish CSS selector: shortcut to #id when present, else a
            // positional path (tag:nth-of-type) up to the nearest id or <body>.
            function cssPath(el) {
                if (!(el instanceof Element)) return null;
                if (el.id) return '#' + CSS.escape(el.id);
                const parts = [];
                let node = el;
                while (node && node.nodeType === 1 && node !== document.body && node !== document.documentElement) {
                    let sel = node.nodeName.toLowerCase();
                    if (node.id) { parts.unshift('#' + CSS.escape(node.id)); break; }
                    let nth = 1, sib = node;
                    while ((sib = sib.previousElementSibling)) {
                        if (sib.nodeName.toLowerCase() === sel) nth++;
                    }
                    parts.unshift(sel + ':nth-of-type(' + nth + ')');
                    node = node.parentElement;
                }
                return parts.length ? parts.join(' > ') : el.nodeName.toLowerCase();
            }

            function applyOne(sel, ov) {
                let nodes;
                try { nodes = document.querySelectorAll(sel); } catch (e) { return; }
                const newStyles = (ov && ov.styles) || {};
                const prev = lastApplied[sel] || {};
                nodes.forEach((el) => {
                    Object.keys(prev).forEach((p) => { if (!(p in newStyles)) el.style.removeProperty(p); });
                    Object.entries(newStyles).forEach(([k, v]) => el.style.setProperty(k, v, 'important'));
                    if (ov && ov.text != null && el.children.length === 0) el.textContent = ov.text;
                });
                if (Object.keys(newStyles).length || (ov && ov.text != null)) lastApplied[sel] = newStyles;
                else delete lastApplied[sel];
            }

            function applyAll() { Object.keys(overrides).forEach((sel) => applyOne(sel, overrides[sel])); }

            // ── Universal font switcher ─────────────────────────────────────
            // Remap every instance of one font-family to another, page-wide.
            // Elements are tagged with their ORIGINAL font (data-fontswap-orig)
            // so a swap can be re-derived, re-applied to late-built elements
            // (via a scoped observer), and cleanly reverted.
            let fontMap = {};            // originalPrimaryFamily -> targetFamily
            let fontObserver = null;
            let fontApplyScheduled = false;
            const FONT_SKIP = '#ui-editor-panel, #hermit-menu, #hermit-menu-btn, #font-switcher-panel';

            function primaryFont(ff) {
                if (!ff) return '';
                return ff.split(',')[0].trim().replace(/^["']|["']$/g, '');
            }

            function collectUsedFonts() {
                const counts = new Map();
                document.querySelectorAll('body *').forEach((el) => {
                    if (el.closest(FONT_SKIP)) return;
                    const orig = el.dataset.fontswapOrig || primaryFont(getComputedStyle(el).fontFamily);
                    if (!orig) return;
                    counts.set(orig, (counts.get(orig) || 0) + 1);
                });
                return [...counts.entries()].sort((a, b) => b[1] - a[1]);
            }

            function restoreFont(el) {
                // Restore the element's original inline font-family exactly (it may
                // have had its own, e.g. from a per-element override), else clear.
                const prev = el.dataset.fontswapPrev;
                if (prev) el.style.setProperty('font-family', prev);
                else el.style.removeProperty('font-family');
                delete el.dataset.fontswapOrig;
                delete el.dataset.fontswapPrev;
            }

            function applyFontMap() {
                document.querySelectorAll('body *').forEach((el) => {
                    if (el.closest(FONT_SKIP)) return;
                    const orig = el.dataset.fontswapOrig || primaryFont(getComputedStyle(el).fontFamily);
                    const target = fontMap[orig];
                    if (target) {
                        if (!el.dataset.fontswapOrig) {
                            el.dataset.fontswapOrig = orig;
                            el.dataset.fontswapPrev = el.style.fontFamily || '';
                        }
                        el.style.setProperty('font-family', target, 'important');
                    } else if (el.dataset.fontswapOrig) {
                        restoreFont(el);
                    }
                });
                ensureFontObserver();
            }

            function ensureFontObserver() {
                const active = Object.keys(fontMap).length > 0;
                if (active && !fontObserver) {
                    // childList/subtree only — our own inline style/dataset writes
                    // are attribute changes, so they never re-trigger this (no loop).
                    fontObserver = new MutationObserver(() => {
                        if (fontApplyScheduled) return;
                        fontApplyScheduled = true;
                        setTimeout(() => { fontApplyScheduled = false; applyFontMap(); }, 300);
                    });
                    fontObserver.observe(document.body, { childList: true, subtree: true });
                } else if (!active && fontObserver) {
                    fontObserver.disconnect();
                    fontObserver = null;
                }
            }

            function revertAllFonts() {
                fontMap = {};
                document.querySelectorAll('[data-fontswap-orig]').forEach((el) => restoreFont(el));
                ensureFontObserver();
            }

            // ── Element editor popup ────────────────────────────────────────
            function serializeCss(styles) {
                return Object.entries(styles || {}).map(([k, v]) => k + ': ' + v + ';').join('\n');
            }
            function parseCss(text) {
                const styles = {};
                (text || '').split(/[\n;]/).forEach((line) => {
                    const i = line.indexOf(':');
                    if (i > 0) {
                        const k = line.slice(0, i).trim();
                        const v = line.slice(i + 1).trim().replace(/!important/i, '').trim();
                        if (k && v) styles[k] = v;
                    }
                });
                return styles;
            }

            function highlight(el) {
                if (!highlightEl) {
                    highlightEl = document.createElement('div');
                    Object.assign(highlightEl.style, { position: 'fixed', zIndex: '10065', pointerEvents: 'none', border: '2px dashed #d9b08c', borderRadius: '2px', boxShadow: '0 0 0 9999px rgba(0,0,0,0.15)' });
                    document.body.appendChild(highlightEl);
                }
                const r = el.getBoundingClientRect();
                Object.assign(highlightEl.style, { display: 'block', left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' });
            }
            function clearHighlight() { if (highlightEl) highlightEl.style.display = 'none'; }

            function openEditorFor(el) {
                const sel = cssPath(el);
                if (!sel) return;
                if (panelEl) panelEl.remove();
                highlight(el);

                const cs = getComputedStyle(el);
                const isLeaf = el.children.length === 0;
                const originalText = isLeaf ? el.textContent : null;
                const existing = overrides[sel] || {};

                panelEl = document.createElement('div');
                panelEl.id = 'ui-editor-panel';
                Object.assign(panelEl.style, {
                    position: 'fixed', top: '12px', right: '12px', zIndex: '10070',
                    background: '#1a1a2e', border: '1px solid #d9b08c', borderRadius: '10px',
                    padding: '12px', width: '300px', maxHeight: '88vh', overflowY: 'auto',
                    display: 'flex', flexDirection: 'column', gap: '8px',
                    boxShadow: '0 8px 32px rgba(0,0,0,0.7)', color: '#eee'
                });

                const head = document.createElement('div');
                Object.assign(head.style, { fontSize: '13px', fontWeight: 'bold', color: '#d9b08c', wordBreak: 'break-all' });
                head.textContent = 'Edit: ' + sel;
                panelEl.appendChild(head);

                // ── Shared state: one `styles` model is the source of truth.
                //    UI controls and the CSS box both read/write it, stay in
                //    sync, and apply live. The CSS box is the copy/paste surface.
                let styles = Object.assign({}, existing.styles || {});
                const refreshers = [];   // control -> re-read its value from `styles`

                // Text content (leaf elements only)
                let textArea = null;
                if (isLeaf) {
                    const tlbl = document.createElement('div');
                    tlbl.textContent = 'Text';
                    Object.assign(tlbl.style, { fontSize: '11px', color: '#999' });
                    textArea = document.createElement('textarea');
                    Object.assign(textArea.style, { width: '100%', boxSizing: 'border-box', height: '40px', background: '#111', color: '#eee', border: '1px solid #444', borderRadius: '4px', padding: '4px', fontSize: '12px', resize: 'vertical' });
                    textArea.value = existing.text != null ? existing.text : (originalText || '');
                    panelEl.appendChild(tlbl);
                    panelEl.appendChild(textArea);
                }

                // CSS box element (appended lower down, but created now so the
                // control helpers can push their changes into it).
                const cssBox = document.createElement('textarea');
                cssBox.spellcheck = false;
                Object.assign(cssBox.style, { width: '100%', boxSizing: 'border-box', height: '150px', background: '#0f0f16', color: '#d7e0ff', border: '1px solid #444', borderRadius: '4px', padding: '6px', fontSize: '12px', fontFamily: 'ui-monospace, Menlo, Consolas, monospace', lineHeight: '1.5', resize: 'vertical', whiteSpace: 'pre' });
                cssBox.placeholder = 'font-size: 24px;\ncolor: #ffcc00;\n-webkit-text-stroke: 1px #000;';

                function apply() {
                    const ov = {};
                    if (Object.keys(styles).length) ov.styles = Object.assign({}, styles);
                    if (textArea && textArea.value !== originalText) ov.text = textArea.value;
                    if (!ov.styles && ov.text == null) delete overrides[sel];
                    else overrides[sel] = ov;
                    applyOne(sel, overrides[sel] || {});
                    highlight(el);
                }
                function syncBox() { cssBox.value = serializeCss(styles); }
                function commit() { syncBox(); apply(); }            // after a control edit
                function refreshControls() { refreshers.forEach((fn) => fn()); }
                function setProp(prop, val) {
                    if (val == null || val === '') delete styles[prop];
                    else styles[prop] = val;
                }

                // ── Control factories ───────────────────────────────────────
                function rowWith(labelText, control) {
                    const row = document.createElement('label');
                    Object.assign(row.style, { display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: '#ccc' });
                    const span = document.createElement('span');
                    span.textContent = labelText;
                    Object.assign(span.style, { flex: '0 0 82px' });
                    row.appendChild(span);
                    row.appendChild(control);
                    return row;
                }
                function styleInput(el2) {
                    Object.assign(el2.style, { flex: '1', minWidth: '0', background: '#111', color: '#eee', border: '1px solid #444', borderRadius: '4px', padding: '3px 5px', fontSize: '12px' });
                    return el2;
                }
                function addText(labelText, prop, opts) {
                    opts = opts || {};
                    const inp = styleInput(document.createElement('input'));
                    inp.type = 'text';
                    if (opts.placeholder) inp.placeholder = opts.placeholder;
                    inp.addEventListener('input', () => {
                        let v = inp.value.trim();
                        if (opts.len && v && /^-?\d*\.?\d+$/.test(v)) v = v + 'px';
                        setProp(prop, v);
                        commit();
                    });
                    refreshers.push(() => { inp.value = styles[prop] != null ? styles[prop] : ''; });
                    panelEl.appendChild(rowWith(labelText, inp));
                }
                function addSelect(labelText, prop, options) {
                    const sel2 = styleInput(document.createElement('select'));
                    ['-'].concat(options).forEach((o, i) => {
                        const op = document.createElement('option');
                        op.value = i === 0 ? '' : o; op.textContent = o;
                        sel2.appendChild(op);
                    });
                    sel2.addEventListener('change', () => { setProp(prop, sel2.value || null); commit(); });
                    refreshers.push(() => { sel2.value = styles[prop] || ''; });
                    panelEl.appendChild(rowWith(labelText, sel2));
                }
                function addColor(labelText, prop) {
                    const wrap = document.createElement('span');
                    Object.assign(wrap.style, { display: 'flex', alignItems: 'center', gap: '6px', flex: '1' });
                    const sw = document.createElement('input'); sw.type = 'color';
                    Object.assign(sw.style, { width: '34px', height: '24px', padding: '0', background: 'none', border: '1px solid #444', borderRadius: '4px', cursor: 'pointer', flex: '0 0 auto' });
                    const tx = styleInput(document.createElement('input')); tx.type = 'text'; tx.placeholder = 'unset';
                    sw.addEventListener('input', () => { tx.value = sw.value; setProp(prop, sw.value); commit(); });
                    tx.addEventListener('input', () => { const v = tx.value.trim(); setProp(prop, v || null); if (/^#([0-9a-f]{6})$/i.test(v)) sw.value = v; commit(); });
                    wrap.appendChild(sw); wrap.appendChild(tx);
                    refreshers.push(() => { const v = styles[prop] || ''; tx.value = v; if (/^#([0-9a-f]{6})$/i.test(v)) sw.value = v; });
                    panelEl.appendChild(rowWith(labelText, wrap));
                }
                function addOutline() {
                    const wrap = document.createElement('span');
                    Object.assign(wrap.style, { display: 'flex', alignItems: 'center', gap: '6px', flex: '1' });
                    const w = styleInput(document.createElement('input')); w.type = 'text'; w.placeholder = 'width px';
                    const sw = document.createElement('input'); sw.type = 'color'; sw.value = '#000000';
                    Object.assign(sw.style, { width: '34px', height: '24px', padding: '0', background: 'none', border: '1px solid #444', borderRadius: '4px', cursor: 'pointer', flex: '0 0 auto' });
                    function upd() {
                        const ww = parseFloat(w.value);
                        if (ww > 0) { styles['-webkit-text-stroke'] = ww + 'px ' + sw.value; styles['paint-order'] = 'stroke fill'; }
                        else { delete styles['-webkit-text-stroke']; delete styles['paint-order']; }
                        commit();
                    }
                    w.addEventListener('input', upd); sw.addEventListener('input', upd);
                    wrap.appendChild(w); wrap.appendChild(sw);
                    refreshers.push(() => {
                        const v = styles['-webkit-text-stroke'] || '';
                        const mw = v.match(/([\d.]+)px/); w.value = mw ? mw[1] : '';
                        const mc = v.match(/#([0-9a-f]{6})/i); if (mc) sw.value = '#' + mc[1];
                    });
                    panelEl.appendChild(rowWith('Outline', wrap));
                }

                // ── Build the control panel ─────────────────────────────────
                addText('Font size', 'font-size', { len: true, placeholder: parseFloat(cs.fontSize) + ' (px)' });
                addText('Font', 'font-family', { placeholder: cs.fontFamily.split(',')[0] });
                addSelect('Weight', 'font-weight', ['normal', 'bold', '100', '200', '300', '400', '500', '600', '700', '800', '900']);
                addSelect('Style', 'font-style', ['normal', 'italic', 'oblique']);
                addSelect('Align', 'text-align', ['left', 'center', 'right', 'justify']);
                addSelect('Transform', 'text-transform', ['none', 'uppercase', 'lowercase', 'capitalize']);
                addText('Letter sp.', 'letter-spacing', { len: true, placeholder: 'px' });
                addText('Line height', 'line-height', { placeholder: cs.lineHeight });
                addColor('Text color', 'color');
                addColor('Background', 'background-color');
                addOutline();
                addText('Text shadow', 'text-shadow', { placeholder: '1px 1px 2px #000' });
                addText('Opacity', 'opacity', { placeholder: '0–1' });
                addText('Padding', 'padding', { placeholder: 'e.g. 4px 8px' });
                addText('Border', 'border', { placeholder: 'e.g. 1px solid #fff' });
                addText('Radius', 'border-radius', { len: true });

                // ── CSS box (source of truth + copy/paste surface) ──────────
                const cssLbl = document.createElement('div');
                cssLbl.textContent = 'CSS - reflects the controls; edit or copy/paste between elements';
                Object.assign(cssLbl.style, { fontSize: '11px', color: '#999', marginTop: '4px' });
                panelEl.appendChild(cssLbl);
                panelEl.appendChild(cssBox);
                cssBox.addEventListener('input', () => {
                    styles = parseCss(cssBox.value);
                    apply();
                    refreshControls();      // keep the UI controls in sync with hand-edited CSS
                });
                if (textArea) textArea.addEventListener('input', apply);

                // Populate controls + box from the initial styles.
                refreshControls();
                syncBox();

                const btnRow = document.createElement('div');
                Object.assign(btnRow.style, { display: 'flex', gap: '6px', marginTop: '4px', flexWrap: 'wrap' });
                function mkBtn(label, bg, fn) {
                    const b = document.createElement('button');
                    b.textContent = label;
                    Object.assign(b.style, { flex: '1', minWidth: '90px', padding: '6px', borderRadius: '5px', cursor: 'pointer', fontSize: '12px', border: '1px solid #555', background: bg, color: '#eee' });
                    b.onclick = fn;
                    return b;
                }
                btnRow.appendChild(mkBtn('Load current styles', '#26304a', () => {
                    styles = snapshotComputed(el);
                    refreshControls();
                    commit();
                }));
                btnRow.appendChild(mkBtn('Reset', '#3a1f28', () => {
                    delete overrides[sel];
                    applyOne(sel, {});
                    if (textArea && originalText != null) el.textContent = originalText;
                    closeEditor();
                }));
                btnRow.appendChild(mkBtn('Close', '#2d2d44', closeEditor));
                panelEl.appendChild(btnRow);

                document.body.appendChild(panelEl);
            }

            function closeEditor() {
                if (panelEl) { panelEl.remove(); panelEl = null; }
                clearHighlight();
            }

            // Snapshot an element's key computed styles as a { prop: value }
            // map — used by the editor's "Load current styles" button to seed
            // the CSS box with the element's current look.
            function snapshotComputed(el) {
                const cs = getComputedStyle(el);
                const s = {
                    'font-size': cs.fontSize,
                    'font-family': cs.fontFamily,
                    'font-weight': cs.fontWeight,
                    'font-style': cs.fontStyle,
                    'line-height': cs.lineHeight,
                    'color': cs.color,
                    'text-align': cs.textAlign
                };
                if (cs.letterSpacing && cs.letterSpacing !== 'normal') s['letter-spacing'] = cs.letterSpacing;
                if (cs.textTransform && cs.textTransform !== 'none') s['text-transform'] = cs.textTransform;
                if (cs.textShadow && cs.textShadow !== 'none') s['text-shadow'] = cs.textShadow;
                if (cs.backgroundColor && cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && cs.backgroundColor !== 'transparent') s['background-color'] = cs.backgroundColor;
                if (parseFloat(cs.webkitTextStrokeWidth) > 0) {
                    s['-webkit-text-stroke'] = cs.webkitTextStrokeWidth + ' ' + cs.webkitTextStrokeColor;
                    s['paint-order'] = 'stroke fill';
                }
                return s;
            }

            // ── Ctrl+Click opens the editor (capture phase so it beats game
            //    handlers). Copy/paste happens inside the CSS box with normal
            //    Ctrl+C / Ctrl+V — no special gesture. ─────────────────────────
            document.addEventListener('click', function (e) {
                if (!(e.ctrlKey || e.metaKey)) return;
                if (typeof window.isHermit === 'function' && !window.isHermit()) return;
                const t = e.target;
                if (!t || (t.closest && t.closest(FONT_SKIP))) return;
                e.preventDefault();
                e.stopPropagation();
                openEditorFor(t);
            }, true);

            // ── Download / Upload / Clear (wired to the TH menu) ──────────────
            function download() {
                // Per-element overrides plus, under a reserved key, the global
                // font swaps — so a downloaded file carries the whole design.
                const out = Object.assign({}, overrides);
                if (Object.keys(fontMap).length) out.__fontSwaps = Object.assign({}, fontMap);
                const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url; a.download = 'godaigo-ui-settings.json';
                document.body.appendChild(a); a.click(); a.remove();
                setTimeout(() => URL.revokeObjectURL(url), 1000);
            }
            function upload() {
                const inp = document.createElement('input');
                inp.type = 'file'; inp.accept = 'application/json,.json';
                inp.onchange = function () {
                    const f = inp.files && inp.files[0];
                    if (!f) return;
                    const r = new FileReader();
                    r.onload = function () {
                        let parsed;
                        try { parsed = JSON.parse(r.result); } catch (err) { updateStatus('Invalid UI settings file'); return; }
                        if (!parsed || typeof parsed !== 'object') { updateStatus('Invalid UI settings file'); return; }
                        Object.keys(lastApplied).forEach((sel) => applyOne(sel, {}));
                        // Pull the global font swaps out of the reserved key.
                        revertAllFonts();
                        const swaps = parsed.__fontSwaps;
                        delete parsed.__fontSwaps;
                        overrides = parsed;
                        applyAll();
                        if (swaps && typeof swaps === 'object') { fontMap = swaps; applyFontMap(); }
                        updateStatus('UI settings applied');
                    };
                    r.readAsText(f);
                };
                inp.click();
            }
            function clearAll() {
                if (!window.confirm('Remove ALL live UI overrides (and font swaps) this session?')) return;
                Object.keys(lastApplied).forEach((sel) => applyOne(sel, {}));
                overrides = {};
                revertAllFonts();
                closeEditor();
                updateStatus('UI overrides cleared');
            }

            // ── Universal font switcher panel ───────────────────────────────
            function openFontSwitcher() {
                const existing = document.getElementById('font-switcher-panel');
                if (existing) { existing.remove(); return; }

                const panel = document.createElement('div');
                panel.id = 'font-switcher-panel';
                Object.assign(panel.style, {
                    position: 'fixed', top: '12px', left: '64px', zIndex: '10070',
                    background: '#1a1a2e', border: '1px solid #d9b08c', borderRadius: '10px',
                    padding: '12px', width: '340px', maxHeight: '88vh', overflowY: 'auto',
                    display: 'flex', flexDirection: 'column', gap: '8px',
                    boxShadow: '0 8px 32px rgba(0,0,0,0.7)', color: '#eee'
                });

                const head = document.createElement('div');
                Object.assign(head.style, { fontSize: '14px', fontWeight: 'bold', color: '#d9b08c' });
                head.textContent = 'Universal Font Switcher';
                panel.appendChild(head);

                const hint = document.createElement('div');
                Object.assign(hint.style, { fontSize: '11px', color: '#999' });
                hint.textContent = 'Swap every instance of a font for another, page-wide. Pick a target from the list or type any loaded font name.';
                panel.appendChild(hint);

                // Suggestions: web-safe fonts + fonts already loaded on the page.
                const websafe = ['Arial', 'Helvetica', 'Georgia', 'Times New Roman', 'Courier New', 'Verdana', 'Trebuchet MS', 'Tahoma', 'Impact', 'system-ui', 'serif', 'sans-serif', 'monospace'];
                const datalist = document.createElement('datalist');
                datalist.id = 'fontswap-suggestions';
                panel.appendChild(datalist);

                const body = document.createElement('div');
                Object.assign(body.style, { display: 'flex', flexDirection: 'column', gap: '6px' });
                panel.appendChild(body);

                let rowInputs = [];      // { source, inp } for each detected font
                let allInpRef = null;    // the "Replace ALL" input

                function targetInput(sourceName) {
                    const inp = document.createElement('input');
                    inp.type = 'text';
                    inp.setAttribute('list', 'fontswap-suggestions');
                    inp.placeholder = '(no change)';
                    Object.assign(inp.style, { flex: '1', minWidth: '0', background: '#111', color: '#eee', border: '1px solid #444', borderRadius: '4px', padding: '3px 5px', fontSize: '12px' });
                    inp.value = fontMap[sourceName] || '';
                    // Live-apply on change too, but the Run button is the reliable path.
                    inp.addEventListener('change', runNow);
                    rowInputs.push({ source: sourceName, inp });
                    return inp;
                }

                // Read every row (and the Replace-ALL field) into the font map and
                // apply. A row's own target wins; otherwise Replace-ALL fills in.
                function runNow() {
                    const all = allInpRef ? allInpRef.value.trim() : '';
                    rowInputs.forEach(({ source, inp }) => {
                        const v = inp.value.trim() || all;
                        if (v) fontMap[source] = v; else delete fontMap[source];
                    });
                    applyFontMap();
                }

                function render() {
                    body.innerHTML = '';
                    rowInputs = [];
                    const used = collectUsedFonts();
                    datalist.innerHTML = '';
                    const suggest = Array.from(new Set(websafe.concat(used.map((u) => u[0]))));
                    suggest.forEach((name) => { const o = document.createElement('option'); o.value = name; datalist.appendChild(o); });

                    // Quick "replace ALL" row
                    const allRow = document.createElement('div');
                    Object.assign(allRow.style, { display: 'flex', alignItems: 'center', gap: '8px', paddingBottom: '6px', borderBottom: '1px solid #333' });
                    const allLbl = document.createElement('span');
                    allLbl.textContent = 'Replace ALL →';
                    Object.assign(allLbl.style, { flex: '0 0 110px', fontSize: '12px', color: '#d9b08c' });
                    const allInp = document.createElement('input');
                    allInp.type = 'text'; allInp.setAttribute('list', 'fontswap-suggestions'); allInp.placeholder = 'font for everything';
                    Object.assign(allInp.style, { flex: '1', minWidth: '0', background: '#111', color: '#eee', border: '1px solid #444', borderRadius: '4px', padding: '3px 5px', fontSize: '12px' });
                    allInp.addEventListener('change', runNow);
                    allInpRef = allInp;
                    allRow.appendChild(allLbl); allRow.appendChild(allInp);
                    body.appendChild(allRow);

                    if (!used.length) { const p = document.createElement('div'); p.textContent = 'No fonts detected.'; p.style.color = '#999'; body.appendChild(p); return; }

                    used.forEach(([name, count]) => {
                        const row = document.createElement('div');
                        Object.assign(row.style, { display: 'flex', alignItems: 'center', gap: '8px' });
                        const lbl = document.createElement('span');
                        lbl.textContent = name + ' (' + count + ')';
                        Object.assign(lbl.style, { flex: '0 0 110px', fontSize: '12px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: name });
                        lbl.title = name;
                        const arrow = document.createElement('span'); arrow.textContent = '→'; arrow.style.color = '#888';
                        row.appendChild(lbl); row.appendChild(arrow); row.appendChild(targetInput(name));
                        body.appendChild(row);
                    });
                }
                render();

                const btnRow = document.createElement('div');
                Object.assign(btnRow.style, { display: 'flex', gap: '6px', marginTop: '4px', flexWrap: 'wrap' });
                function mkBtn(label, bg, fn) {
                    const b = document.createElement('button');
                    b.textContent = label;
                    Object.assign(b.style, { flex: '1', minWidth: '80px', padding: '6px', borderRadius: '5px', cursor: 'pointer', fontSize: '12px', border: '1px solid #555', background: bg, color: '#eee' });
                    b.onclick = fn;
                    return b;
                }
                // Primary action — reads the fields and actually switches fonts.
                const runBtn = mkBtn('▶ Switch Fonts', '#2e7d32', () => { runNow(); render(); });
                Object.assign(runBtn.style, { flex: '1 0 100%', fontWeight: 'bold', color: '#fff' });
                btnRow.appendChild(runBtn);
                btnRow.appendChild(mkBtn('Rescan', '#26304a', render));
                btnRow.appendChild(mkBtn('Reset fonts', '#3a1f28', () => { revertAllFonts(); render(); }));
                btnRow.appendChild(mkBtn('Close', '#2d2d44', () => panel.remove()));
                panel.appendChild(btnRow);

                document.body.appendChild(panel);
            }

            window._uiEditor = { download, upload, clearAll, openFontSwitcher };
        })();

        // ─── Hermit-only dev menu ("TH" icon, top-left) ─────────────────────
        // Surfaces every hidden cheat/dev screen behind one visible button, but
        // ONLY for the developer account (TheHermit — see window.isHermit() in
        // lobby.js). The old secret gestures (AP-label ×5, Profile-title ×5)
        // still work, but only for the same account; this menu is the primary
        // entry point so the tools no longer depend on remembering a gesture.
        (function initHermitMenu() {
            let btn = null;      // the "TH" launcher
            let menu = null;     // the dropdown

            // ── Admin: registered-profiles console ──────────────────────────
            // Lists every account (via the TheHermit-gated admin_list_users RPC)
            // and lets the developer permanently delete test accounts (auth login
            // + profile + all their game data via admin_delete_user). Both RPCs
            // self-verify the caller is TheHermit, so this is safe even though the
            // button is only ever shown to that account.
            function openProfileAdmin() {
                const existing = document.getElementById('profile-admin-overlay');
                if (existing) { existing.remove(); return; }

                const overlay = document.createElement('div');
                overlay.id = 'profile-admin-overlay';
                Object.assign(overlay.style, {
                    position: 'fixed', inset: '0', zIndex: '10060',
                    background: 'rgba(0,0,0,0.7)', display: 'flex',
                    alignItems: 'center', justifyContent: 'center'
                });
                overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

                const panel = document.createElement('div');
                Object.assign(panel.style, {
                    background: '#1a1a2e', border: '1px solid #444', borderRadius: '10px',
                    width: 'min(560px, 92vw)', maxHeight: '82vh', display: 'flex',
                    flexDirection: 'column', boxShadow: '0 8px 32px rgba(0,0,0,0.7)',
                    color: '#eee', fontSize: '13px'
                });

                const header = document.createElement('div');
                Object.assign(header.style, {
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '12px 16px', borderBottom: '1px solid #333'
                });
                const title = document.createElement('div');
                title.textContent = 'Registered Profiles';
                Object.assign(title.style, { fontSize: '16px', fontWeight: 'bold', color: '#d9b08c' });
                const closeX = document.createElement('button');
                closeX.textContent = '✕';
                Object.assign(closeX.style, {
                    background: 'none', border: '1px solid #444', borderRadius: '5px',
                    color: '#ccc', cursor: 'pointer', padding: '2px 9px'
                });
                closeX.onclick = () => overlay.remove();
                header.appendChild(title);
                header.appendChild(closeX);

                const list = document.createElement('div');
                Object.assign(list.style, { overflowY: 'auto', padding: '8px', flex: '1' });
                list.textContent = 'Loading…';

                panel.appendChild(header);
                panel.appendChild(list);
                overlay.appendChild(panel);
                document.body.appendChild(overlay);

                function fmtDate(s) {
                    if (!s) return '-';
                    const d = new Date(s);
                    return isNaN(d) ? '-' : d.toLocaleDateString();
                }

                async function load() {
                    list.textContent = 'Loading…';
                    const { data, error } = await supabase.rpc('admin_list_users');
                    if (error) {
                        list.textContent = 'Error: ' + (error.message || 'could not load profiles');
                        return;
                    }
                    const rows = data || [];
                    let count = rows.length;
                    title.textContent = `Registered Profiles (${count})`;
                    list.innerHTML = '';

                    rows.forEach((u) => {
                        const row = document.createElement('div');
                        Object.assign(row.style, {
                            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                            gap: '10px', padding: '8px 10px', borderBottom: '1px solid #2a2a3a'
                        });

                        const info = document.createElement('div');
                        info.style.minWidth = '0';
                        const nameLine = document.createElement('div');
                        nameLine.style.fontWeight = 'bold';
                        nameLine.textContent = u.username || '(unknown)';
                        if (u.is_admin) {
                            const badge = document.createElement('span');
                            badge.textContent = ' admin';
                            Object.assign(badge.style, {
                                fontSize: '10px', color: '#1a1a2e', background: '#d9b08c',
                                borderRadius: '3px', padding: '1px 5px', marginLeft: '6px',
                                fontWeight: 'bold', verticalAlign: 'middle'
                            });
                            nameLine.appendChild(badge);
                        }
                        const meta = document.createElement('div');
                        Object.assign(meta.style, { fontSize: '11px', color: '#999', marginTop: '2px' });
                        meta.textContent =
                            `Lv ${u.current_level ?? '?'} · ${u.total_xp ?? 0} XP · ${u.gold ?? 0}g · ` +
                            `${u.games_played ?? 0} games · last seen ${fmtDate(u.last_sign_in_at)}`;
                        info.appendChild(nameLine);
                        info.appendChild(meta);

                        const del = document.createElement('button');
                        Object.assign(del.style, {
                            flex: '0 0 auto', padding: '5px 10px', borderRadius: '5px',
                            cursor: 'pointer', fontSize: '12px', border: '1px solid #a33',
                            background: '#3a1f28', color: '#f2b8c0'
                        });
                        if (u.is_admin) {
                            del.textContent = '-';
                            del.disabled = true;
                            del.title = 'The admin account cannot be deleted here';
                            Object.assign(del.style, { opacity: '0.4', cursor: 'default', borderColor: '#555', color: '#888', background: '#222' });
                        } else {
                            del.textContent = 'Delete';
                            del.onclick = async () => {
                                const ok = window.confirm(
                                    `Permanently delete "${u.username}" and ALL of their data ` +
                                    `(login, profile, bots, activity)?\n\nThis cannot be undone.`);
                                if (!ok) return;
                                del.disabled = true;
                                del.textContent = 'Deleting…';
                                const { error: delErr } = await supabase.rpc('admin_delete_user', { p_user_id: u.user_id });
                                if (delErr) {
                                    del.disabled = false;
                                    del.textContent = 'Delete';
                                    updateStatus('Delete failed: ' + (delErr.message || 'unknown error'));
                                    return;
                                }
                                row.remove();
                                count = Math.max(0, count - 1);
                                title.textContent = `Registered Profiles (${count})`;
                                updateStatus(`Deleted "${u.username}"`);
                            };
                        }

                        row.appendChild(info);
                        row.appendChild(del);
                        list.appendChild(row);
                    });

                    if (!rows.length) list.textContent = 'No profiles found.';
                }

                load();
            }

            // ── Admin: stored session game logs ──────────────────────────────
            // Lists rows from game_session_logs (only ever non-empty for this
            // account — RLS restricts SELECT to is_hermit()) and lets the
            // developer download an individual log or all of them, in the same
            // {meta, entries} JSON shape action-log.js's own "Download Action
            // Log" cheat-panel button already produces.
            function openGameLogsPanel() {
                const existing = document.getElementById('game-logs-overlay');
                if (existing) { existing.remove(); return; }

                const overlay = document.createElement('div');
                overlay.id = 'game-logs-overlay';
                Object.assign(overlay.style, {
                    position: 'fixed', inset: '0', zIndex: '10060',
                    background: 'rgba(0,0,0,0.7)', display: 'flex',
                    alignItems: 'center', justifyContent: 'center'
                });
                overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

                const panel = document.createElement('div');
                Object.assign(panel.style, {
                    background: '#1a1a2e', border: '1px solid #444', borderRadius: '10px',
                    width: 'min(640px, 92vw)', maxHeight: '82vh', display: 'flex',
                    flexDirection: 'column', boxShadow: '0 8px 32px rgba(0,0,0,0.7)',
                    color: '#eee', fontSize: '13px'
                });

                const header = document.createElement('div');
                Object.assign(header.style, {
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '12px 16px', borderBottom: '1px solid #333', gap: '10px'
                });
                const title = document.createElement('div');
                title.textContent = 'Game Session Logs';
                Object.assign(title.style, { fontSize: '16px', fontWeight: 'bold', color: '#d9b08c', flex: '1' });
                const downloadAllBtn = document.createElement('button');
                downloadAllBtn.textContent = 'Download All';
                Object.assign(downloadAllBtn.style, {
                    background: '#222', border: '1px solid #444', borderRadius: '5px',
                    color: '#ccc', cursor: 'pointer', padding: '4px 10px', fontSize: '12px'
                });
                const closeX = document.createElement('button');
                closeX.textContent = '✕';
                Object.assign(closeX.style, {
                    background: 'none', border: '1px solid #444', borderRadius: '5px',
                    color: '#ccc', cursor: 'pointer', padding: '2px 9px'
                });
                closeX.onclick = () => overlay.remove();
                header.appendChild(title);
                header.appendChild(downloadAllBtn);
                header.appendChild(closeX);

                const list = document.createElement('div');
                Object.assign(list.style, { overflowY: 'auto', padding: '8px', flex: '1' });
                list.textContent = 'Loading…';

                panel.appendChild(header);
                panel.appendChild(list);
                overlay.appendChild(panel);
                document.body.appendChild(overlay);

                function fmtDate(s) {
                    if (!s) return '-';
                    const d = new Date(s);
                    return isNaN(d) ? '-' : d.toLocaleDateString() + ' ' + d.toLocaleTimeString();
                }

                function downloadJSON(obj, filename) {
                    const blob = new Blob([JSON.stringify(obj, null, 1)], { type: 'application/json' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = filename;
                    document.body.appendChild(a);
                    a.click();
                    a.remove();
                    URL.revokeObjectURL(url);
                }

                let loadedRows = [];

                async function load() {
                    list.textContent = 'Loading…';
                    const { data, error } = await supabase
                        .from('game_session_logs')
                        .select('id, user_id, game_id, is_multiplayer, player_count, created_at, log')
                        .order('created_at', { ascending: false })
                        .limit(200);
                    if (error) {
                        list.textContent = 'Error: ' + (error.message || 'could not load session logs');
                        return;
                    }
                    loadedRows = data || [];
                    title.textContent = `Game Session Logs (${loadedRows.length})`;
                    list.innerHTML = '';

                    loadedRows.forEach((row) => {
                        const item = document.createElement('div');
                        Object.assign(item.style, {
                            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                            gap: '10px', padding: '8px 10px', borderBottom: '1px solid #2a2a3a'
                        });

                        const info = document.createElement('div');
                        info.style.minWidth = '0';
                        const dateLine = document.createElement('div');
                        dateLine.style.fontWeight = 'bold';
                        dateLine.textContent = fmtDate(row.created_at);
                        const badge = document.createElement('span');
                        badge.textContent = row.is_multiplayer ? ' MP' : ' Solo';
                        Object.assign(badge.style, {
                            fontSize: '10px', color: '#1a1a2e',
                            background: row.is_multiplayer ? '#8cd9b0' : '#d9b08c',
                            borderRadius: '3px', padding: '1px 5px', marginLeft: '6px',
                            fontWeight: 'bold', verticalAlign: 'middle'
                        });
                        dateLine.appendChild(badge);
                        const meta = document.createElement('div');
                        Object.assign(meta.style, { fontSize: '11px', color: '#999', marginTop: '2px' });
                        meta.textContent =
                            `${row.player_count ?? '?'} player(s) · ${row.log?.entries?.length ?? '?'} actions · user ${(row.user_id || '').slice(0, 8)}…`;
                        info.appendChild(dateLine);
                        info.appendChild(meta);

                        const dl = document.createElement('button');
                        dl.textContent = 'Download';
                        Object.assign(dl.style, {
                            flex: '0 0 auto', padding: '5px 10px', borderRadius: '5px',
                            cursor: 'pointer', fontSize: '12px', border: '1px solid #4a4',
                            background: '#1f3a28', color: '#b8f2c0'
                        });
                        dl.onclick = () => {
                            const dateStr = new Date(row.created_at).toISOString().slice(0, 10);
                            downloadJSON(row.log, `godaigo-session-log-${row.id}-${dateStr}.json`);
                        };

                        item.appendChild(info);
                        item.appendChild(dl);
                        list.appendChild(item);
                    });

                    if (!loadedRows.length) list.textContent = 'No session logs found.';
                }

                downloadAllBtn.onclick = () => {
                    if (!loadedRows.length) return;
                    downloadJSON({ logs: loadedRows.map(r => r.log) }, `godaigo-all-session-logs-${Date.now()}.json`);
                };

                load();
            }

            // ── Board Rotation tool ──────────────────────────────────────────
            // Lets the developer spin the whole board (viewport) flat, in-plane,
            // live, with a readout of the exact degree value so it can be
            // reported back. Backed by window.getBoardRotation/setBoardRotation
            // in game-core.js — viewportRotation already drives the render
            // transform and screenToWorld()'s inverse, so this was just missing
            // a UI. Distinct from the Board Angle (tilt) tool below.
            function openBoardRotationPanel() {
                const existing = document.getElementById('board-rotation-panel');
                if (existing) { existing.remove(); return; }

                if (typeof window.getBoardRotation !== 'function' || typeof window.setBoardRotation !== 'function') {
                    updateStatus('Board rotation tool unavailable - start a game first');
                    return;
                }

                const panel = document.createElement('div');
                panel.id = 'board-rotation-panel';
                Object.assign(panel.style, {
                    position: 'fixed', top: '12px', right: '12px', zIndex: '10060',
                    background: '#1a1a2e', border: '1px solid #444', borderRadius: '8px',
                    padding: '12px 14px', width: '220px', boxShadow: '0 4px 16px rgba(0,0,0,0.6)',
                    color: '#eee', fontSize: '13px'
                });

                const header = document.createElement('div');
                Object.assign(header.style, {
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px'
                });
                const title = document.createElement('div');
                title.textContent = 'Board Rotation';
                Object.assign(title.style, { fontWeight: 'bold', color: '#d9b08c' });
                const closeX = document.createElement('button');
                closeX.textContent = '✕';
                Object.assign(closeX.style, {
                    background: 'none', border: '1px solid #444', borderRadius: '5px',
                    color: '#ccc', cursor: 'pointer', padding: '1px 7px'
                });
                closeX.onclick = () => panel.remove();
                header.appendChild(title);
                header.appendChild(closeX);

                const readout = document.createElement('div');
                Object.assign(readout.style, {
                    fontSize: '22px', fontWeight: 'bold', textAlign: 'center',
                    margin: '4px 0 10px', color: '#fff'
                });

                const slider = document.createElement('input');
                slider.type = 'range'; slider.min = '0'; slider.max = '359'; slider.step = '1';
                slider.style.width = '100%';

                const numberRow = document.createElement('div');
                Object.assign(numberRow.style, { display: 'flex', gap: '6px', marginTop: '8px', alignItems: 'center' });
                const numInput = document.createElement('input');
                numInput.type = 'number'; numInput.min = '0'; numInput.max = '359';
                Object.assign(numInput.style, {
                    width: '64px', background: '#111', color: '#eee',
                    border: '1px solid #555', borderRadius: '4px', padding: '4px 6px'
                });
                const degLabel = document.createElement('span');
                degLabel.textContent = '°';
                numberRow.appendChild(numInput);
                numberRow.appendChild(degLabel);

                function apply(deg) {
                    const applied = window.setBoardRotation(deg);
                    slider.value = String(applied);
                    numInput.value = String(applied);
                    readout.textContent = `${applied}°`;
                }

                function makeStepBtn(label, delta) {
                    const b = document.createElement('button');
                    b.textContent = label;
                    Object.assign(b.style, {
                        flex: '1', padding: '5px 0', background: '#2d2d44', color: '#eee',
                        border: '1px solid #555', borderRadius: '5px', cursor: 'pointer'
                    });
                    b.onclick = () => apply(window.getBoardRotation() + delta);
                    return b;
                }

                const stepRow = document.createElement('div');
                Object.assign(stepRow.style, { display: 'flex', gap: '6px', marginTop: '8px' });
                stepRow.appendChild(makeStepBtn('-15°', -15));
                stepRow.appendChild(makeStepBtn('-1°', -1));
                stepRow.appendChild(makeStepBtn('+1°', 1));
                stepRow.appendChild(makeStepBtn('+15°', 15));

                const resetBtn = document.createElement('button');
                resetBtn.textContent = 'Reset to 0°';
                Object.assign(resetBtn.style, {
                    width: '100%', marginTop: '8px', padding: '6px 0', background: '#2d2d44',
                    color: '#eee', border: '1px solid #555', borderRadius: '5px', cursor: 'pointer'
                });
                resetBtn.onclick = () => apply(0);

                slider.addEventListener('input', () => apply(Number(slider.value)));
                numInput.addEventListener('change', () => apply(Number(numInput.value) || 0));

                panel.appendChild(header);
                panel.appendChild(readout);
                panel.appendChild(slider);
                panel.appendChild(numberRow);
                panel.appendChild(stepRow);
                panel.appendChild(resetBtn);
                document.body.appendChild(panel);

                apply(window.getBoardRotation());
            }

            // ── Board Angle (tilt) tool ──────────────────────────────────────
            // Lets the developer tilt the camera on the board — like tipping a
            // table up to view it at a slant instead of straight top-down —
            // live, with a readout of the exact degree value so it can be
            // reported back. Backed by window.getBoardTilt/setBoardTilt in
            // game-core.js, which apply a CSS 3D perspective/rotateX transform
            // to the board container. Purely a camera-preview effect layered on
            // top of the SVG's own coordinates — distinct from Board Rotation
            // above, which actually spins board-space and stays interactive.
            function openBoardTiltPanel() {
                const existing = document.getElementById('board-tilt-panel');
                if (existing) { existing.remove(); return; }

                if (typeof window.getBoardTilt !== 'function' || typeof window.setBoardTilt !== 'function') {
                    updateStatus('Board angle tool unavailable - start a game first');
                    return;
                }

                const panel = document.createElement('div');
                panel.id = 'board-tilt-panel';
                Object.assign(panel.style, {
                    position: 'fixed', top: '12px', right: '244px', zIndex: '10060',
                    background: '#1a1a2e', border: '1px solid #444', borderRadius: '8px',
                    padding: '12px 14px', width: '220px', boxShadow: '0 4px 16px rgba(0,0,0,0.6)',
                    color: '#eee', fontSize: '13px'
                });

                const header = document.createElement('div');
                Object.assign(header.style, {
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px'
                });
                const title = document.createElement('div');
                title.textContent = 'Board Angle';
                Object.assign(title.style, { fontWeight: 'bold', color: '#d9b08c' });
                const closeX = document.createElement('button');
                closeX.textContent = '✕';
                Object.assign(closeX.style, {
                    background: 'none', border: '1px solid #444', borderRadius: '5px',
                    color: '#ccc', cursor: 'pointer', padding: '1px 7px'
                });
                closeX.onclick = () => panel.remove();
                header.appendChild(title);
                header.appendChild(closeX);

                const readout = document.createElement('div');
                Object.assign(readout.style, {
                    fontSize: '22px', fontWeight: 'bold', textAlign: 'center',
                    margin: '4px 0 10px', color: '#fff'
                });

                const slider = document.createElement('input');
                slider.type = 'range'; slider.min = '0'; slider.max = '80'; slider.step = '1';
                slider.style.width = '100%';

                const numberRow = document.createElement('div');
                Object.assign(numberRow.style, { display: 'flex', gap: '6px', marginTop: '8px', alignItems: 'center' });
                const numInput = document.createElement('input');
                numInput.type = 'number'; numInput.min = '0'; numInput.max = '80';
                Object.assign(numInput.style, {
                    width: '64px', background: '#111', color: '#eee',
                    border: '1px solid #555', borderRadius: '4px', padding: '4px 6px'
                });
                const degLabel = document.createElement('span');
                degLabel.textContent = '°';
                numberRow.appendChild(numInput);
                numberRow.appendChild(degLabel);

                function apply(deg) {
                    const applied = window.setBoardTilt(deg);
                    slider.value = String(applied);
                    numInput.value = String(applied);
                    readout.textContent = `${applied}°`;
                }

                function makeStepBtn(label, delta) {
                    const b = document.createElement('button');
                    b.textContent = label;
                    Object.assign(b.style, {
                        flex: '1', padding: '5px 0', background: '#2d2d44', color: '#eee',
                        border: '1px solid #555', borderRadius: '5px', cursor: 'pointer'
                    });
                    b.onclick = () => apply(window.getBoardTilt() + delta);
                    return b;
                }

                const stepRow = document.createElement('div');
                Object.assign(stepRow.style, { display: 'flex', gap: '6px', marginTop: '8px' });
                stepRow.appendChild(makeStepBtn('-15°', -15));
                stepRow.appendChild(makeStepBtn('-1°', -1));
                stepRow.appendChild(makeStepBtn('+1°', 1));
                stepRow.appendChild(makeStepBtn('+15°', 15));

                const resetBtn = document.createElement('button');
                resetBtn.textContent = 'Reset to 0°';
                Object.assign(resetBtn.style, {
                    width: '100%', marginTop: '8px', padding: '6px 0', background: '#2d2d44',
                    color: '#eee', border: '1px solid #555', borderRadius: '5px', cursor: 'pointer'
                });
                resetBtn.onclick = () => apply(0);

                slider.addEventListener('input', () => apply(Number(slider.value)));
                numInput.addEventListener('change', () => apply(Number(numInput.value) || 0));

                panel.appendChild(header);
                panel.appendChild(readout);
                panel.appendChild(slider);
                panel.appendChild(numberRow);
                panel.appendChild(stepRow);
                panel.appendChild(resetBtn);
                document.body.appendChild(panel);

                apply(window.getBoardTilt());
            }

            function buildMenu() {
                if (btn) return;

                btn = document.createElement('button');
                btn.id = 'hermit-menu-btn';
                btn.textContent = 'TH';
                btn.title = 'Developer menu (TheHermit only)';
                Object.assign(btn.style, {
                    position: 'fixed',
                    // Was top:12px, overlapping whatever sits at the very
                    // start of .hud-section.left (used to clear it via the
                    // old .hud-player wrapper's own padding; that wrapper's
                    // gone now — see js/thehermit.js normalizeDOM()). Same
                    // var(--hud-height)-relative pattern as
                    // .placement-tile-overlay in css/styles.css, so this
                    // still tracks the HUD bar's height across breakpoints.
                    top: 'calc(var(--hud-height) + 8px)',
                    left: '12px',
                    zIndex: '10000',
                    width: '40px',
                    height: '40px',
                    borderRadius: '50%',
                    background: '#1a1a2e',
                    color: '#d9b08c',
                    border: '1px solid #d9b08c',
                    fontSize: '15px',
                    fontWeight: 'bold',
                    letterSpacing: '1px',
                    cursor: 'pointer',
                    boxShadow: '0 2px 8px rgba(0,0,0,0.5)',
                    display: 'none'
                });

                menu = document.createElement('div');
                menu.id = 'hermit-menu';
                Object.assign(menu.style, {
                    position: 'fixed',
                    // Kept the same 46px gap below the button's own top that
                    // 58-12 worked out to before it moved (see btn.style.top).
                    top: 'calc(var(--hud-height) + 8px + 46px)',
                    left: '12px',
                    zIndex: '10000',
                    background: '#1a1a2e',
                    border: '1px solid #444',
                    borderRadius: '8px',
                    padding: '8px',
                    display: 'none',
                    flexDirection: 'column',
                    gap: '6px',
                    minWidth: '180px',
                    boxShadow: '0 4px 16px rgba(0,0,0,0.6)'
                });

                function makeItem(label, action) {
                    const item = document.createElement('button');
                    item.textContent = label;
                    Object.assign(item.style, {
                        padding: '7px 10px',
                        background: '#2d2d44',
                        color: '#eee',
                        border: '1px solid #555',
                        borderRadius: '5px',
                        cursor: 'pointer',
                        fontSize: '13px',
                        textAlign: 'left'
                    });
                    item.onclick = () => {
                        menu.style.display = 'none';
                        action();
                    };
                    return item;
                }

                menu.appendChild(makeItem('Cheat Panel', () => {
                    if (typeof window._openCheatPanel === 'function') window._openCheatPanel();
                }));
                menu.appendChild(makeItem('Bot Training', () => {
                    if (typeof window._openBotTrainingPanel === 'function') window._openBotTrainingPanel();
                }));
                menu.appendChild(makeItem('Bot: One Step (Shift+R)', () => {
                    if (window.BotSystem && typeof window.BotSystem.step === 'function') window.BotSystem.step();
                }));
                menu.appendChild(makeItem('Bot: Play Turn (Shift+B)', () => {
                    if (window.BotSystem && typeof window.BotSystem.turn === 'function') window.BotSystem.turn();
                }));
                menu.appendChild(makeItem('Joytone Sequencer (Shift+J+T)', () => {
                    if (window.JoytoneBridge && typeof window.JoytoneBridge.togglePopup === 'function') window.JoytoneBridge.togglePopup();
                }));
                const imitationLabel = () =>
                    `🧠 Learn from my play: ${(window.BotImitation && window.BotImitation.isEnabled()) ? 'ON' : 'OFF'}`;
                const imitationItem = makeItem(imitationLabel(), () => {
                    if (!window.BotImitation) return;
                    window.BotImitation.setEnabled(!window.BotImitation.isEnabled());
                    imitationItem.textContent = imitationLabel();
                });
                menu.appendChild(imitationItem);
                const mindLabel = () =>
                    `Bot Mind (Shift+M): ${(window.BotMind && window.BotMind.isEnabled()) ? 'ON' : 'OFF'}`;
                const mindItem = makeItem(mindLabel(), () => {
                    if (!window.BotMind) return;
                    window.BotMind.setEnabled(!window.BotMind.isEnabled());
                    mindItem.textContent = mindLabel();
                });
                menu.appendChild(mindItem);
                menu.appendChild(makeItem('Formula Lab (new bot senses)', () => {
                    if (window.FormulaLab) window.FormulaLab.open();
                }));
                menu.appendChild(makeItem('Rewards: sign-up events, game rewards', () => {
                    window.HermitRewards?.open();
                }));
                menu.appendChild(makeItem('Test games: reward and reports', () => {
                    window.TestGame?.openHermit();
                }));
                // Experiment (js/ui-fit.js): smart sizing of the HUD and dock. Off by
                // default; this browser only. Off = the hand-made layout, unchanged.
                const uiFitLabel = () => `Smart UI fit (experiment): ${window.UiFit?.isEnabled?.() ? 'ON' : 'OFF'}`;
                const uiFitItem = makeItem(uiFitLabel(), () => {
                    if (!window.UiFit) return;
                    window.UiFit.setEnabled(!window.UiFit.isEnabled());
                    uiFitItem.textContent = uiFitLabel();
                });
                menu.appendChild(uiFitItem);
                menu.appendChild(makeItem('Pot Drop demo (plinko)', () => {
                    // Local only: runs the same physics as the real pot, pays nothing.
                    const n = parseInt(window.prompt('How many coins? (1-70, one coin = 10g)', '30'), 10);
                    if (!n) return;
                    const seed = Math.floor(Math.random() * 4294967296);
                    window.PotPlinko?.preview(seed, Math.max(1, Math.min(70, n)));
                }));
                menu.appendChild(makeItem('Manage Profiles', openProfileAdmin));
                menu.appendChild(makeItem('Game Logs', openGameLogsPanel));
                menu.appendChild(makeItem('Board Rotation', openBoardRotationPanel));
                menu.appendChild(makeItem('Board Angle', openBoardTiltPanel));
                menu.appendChild(makeItem('☢️ Nuke All Rooms', async () => {
                    const ok = window.confirm('Nuke ALL rooms and players from the database?\n\nThis cannot be undone.');
                    if (!ok) return;
                    const { error } = await supabase.rpc('nuke_all_rooms');
                    if (error) {
                        console.error('💥 Nuke failed:', error);
                        updateStatus('Nuke failed: ' + (error.message || 'unknown error'));
                        alert('Nuke failed: ' + (error.message || 'unknown error'));
                        return;
                    }
                    console.log('💥 All rooms nuked.');
                    window.location.reload();
                }));
                menu.appendChild(makeItem('Edit UI: Ctrl+Click an element', () => {
                    updateStatus('Ctrl+Click any element to edit its text & CSS - copy/paste the CSS box to reuse a style');
                }));
                menu.appendChild(makeItem('Universal Font Switcher', () => {
                    if (window._uiEditor) window._uiEditor.openFontSwitcher();
                }));
                menu.appendChild(makeItem('Download UI Settings', () => {
                    if (window._uiEditor) window._uiEditor.download();
                }));
                menu.appendChild(makeItem('Upload UI Settings', () => {
                    if (window._uiEditor) window._uiEditor.upload();
                }));
                menu.appendChild(makeItem('Clear UI Overrides', () => {
                    if (window._uiEditor) window._uiEditor.clearAll();
                }));

                btn.onclick = (e) => {
                    e.stopPropagation();
                    menu.style.display = (menu.style.display === 'none') ? 'flex' : 'none';
                };
                // Click elsewhere closes the menu. Only a real click: bots
                // "click" buttons from script (End Turn, scroll menus), which
                // closed the menu at every bot turn in training (owner, 2026-09-29).
                document.addEventListener('click', (e) => {
                    if (!e.isTrusted) return;
                    if (menu && menu.style.display !== 'none' &&
                        e.target !== btn && !menu.contains(e.target)) {
                        menu.style.display = 'none';
                    }
                });

                document.body.appendChild(btn);
                document.body.appendChild(menu);
            }

            // Show the launcher only for the developer account; hide (and close
            // the menu) for everyone else. Called from onAuthSuccess/authSignOut.
            window.updateHermitUI = function () {
                const isDev = (typeof window.isHermit === 'function') && window.isHermit();
                if (isDev) buildMenu();
                if (btn) btn.style.display = isDev ? 'block' : 'none';
                if (menu && !isDev) menu.style.display = 'none';
            };

            // Reflect any session already restored before this script ran.
            window.updateHermitUI();
        })();

