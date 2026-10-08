        // ========================================
        // GAME CONSTANTS
        // ========================================
        const TILE_SIZE = 20;
        const SNAP_THRESHOLD = 40;
        const STONE_SIZE = 12;

        // Cache-bust token for image assets — bump when replacing an image file
        window.IMG_V = '?v=2';
        const IMG_V = window.IMG_V;

        const STONE_TYPES = {
            earth:    { color: '#69d83a', symbol: '▲', img: 'images/mountainsymbol.webp' + IMG_V },
            water:    { color: '#5894f4', symbol: '◯', img: 'images/watersymbol.webp'    + IMG_V },
            fire:     { color: '#ed1b43', symbol: '♦', img: 'images/firesymbol.webp'     + IMG_V },
            wind:     { color: '#ffce00', symbol: '≋', img: 'images/windsymbol.webp'     + IMG_V },
            void:     { color: '#9458f4', symbol: '✺', img: 'images/voidsymbol.webp'     + IMG_V },
            catacomb: { color: '#c8a870', symbol: '✦', img: 'images/Catacomb.webp'       + IMG_V }
        };
        window.STONE_TYPES = STONE_TYPES; // scroll-panels.js / scroll-effects.js card icons read it

        // How a scroll's element looks (owner, 2026-10-01). A catacomb scroll blends
        // two elements, so it shows BOTH colors (it used to be void's purple), and
        // its symbol is drawn as a mask filled with those colors: the image itself
        // is black, and .element-icon-sm's screen blend made it invisible.
        window.ScrollLook = (function () {
            const ORDER = ['earth', 'water', 'fire', 'wind', 'void'];
            const cap = s => s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
            // name = a scroll key ('CATACOMB_SCROLL_2') or its definition object.
            function elementOf(name) {
                if (name && typeof name === 'object') return name.element || null;
                const n = String(name || '').toUpperCase(); // 'CATACOMB_SCROLL_2' or a bare 'catacomb'
                for (const el of [...ORDER, 'catacomb']) if (n.startsWith(el.toUpperCase())) return el;
                return null;
            }
            // Component elements of a catacomb scroll (pattern stone types), in element order.
            function parts(name) {
                const def = (name && typeof name === 'object') ? name
                    : (window.SCROLL_DEFINITIONS?.[name] || window.spellSystem?.patterns?.[name]);
                const types = new Set((def?.patterns?.[0] || []).map(p => p.type));
                return ORDER.filter(el => types.has(el)); // [] for a bare 'catacomb'
            }
            function colors(name) {
                const el = elementOf(name);
                if (el === 'catacomb') {
                    const ps = parts(name);
                    return ps.length ? ps.map(e => STONE_TYPES[e].color) : ['#eadfc8']; // bare catacomb: light tan, says nothing about its elements
                }
                return [STONE_TYPES[el]?.color || '#aaa'];
            }
            function gradient(cols) {
                if (cols.length < 2) return cols[0];
                const step = 100 / cols.length;
                return 'linear-gradient(90deg, ' + cols.map((c, i) => `${c} ${i * step}%, ${c} ${(i + 1) * step}%`).join(', ') + ')';
            }
            // <img> for an element, a two-color masked symbol for a catacomb scroll.
            function iconHtml(name, cls = 'element-icon-sm', extraStyle = '') {
                const el = elementOf(name);
                if (el === 'catacomb') {
                    return `<span class="catacomb-icon ${cls}" style="background:${gradient(colors(name))};${extraStyle}" title="${label(name)}"></span>`;
                }
                const img = STONE_TYPES[el]?.img;
                return img ? `<img src="${img}" class="${cls}" alt="${el}" style="${extraStyle}">` : '';
            }
            // Inline style for text in the scroll's color(s).
            function textStyle(name) {
                const cols = colors(name);
                if (cols.length < 2) return `color:${cols[0]};`;
                return `background:${gradient(cols)};-webkit-background-clip:text;background-clip:text;color:transparent;`;
            }
            // "Earth", or "Catacomb (Earth + Wind)".
            function label(name) {
                const el = elementOf(name);
                const ps = el === 'catacomb' ? parts(name) : [];
                return ps.length ? `Catacomb (${ps.map(cap).join(' + ')})` : cap(el);
            }
            return { elementOf, parts, colors, gradient, iconHtml, textStyle, label };
        })();

        // Spell System for pattern-based stone generation
        class SpellSystem {
            constructor() {
                this.SPELL_AP_COST = 2;

                // Per-player scroll inventories: { hand: Set, active: Set, activated: Set }
                // hand = scrolls in player's hand (private, max 4)
                // active = scrolls in active area (visible to opponents: name + element only, max 2)
                // activated = elements that have been used for win condition tracking
                this.playerScrolls = [];
                this.MAX_HAND_SIZE = 2;
                this.MAX_ACTIVE_SIZE = 2;

                // Shows the "why am I over the limit" explainer once per session the
                // first time showEndTurnOverflowModal() fires — see that method.
                this._overflowExplained = false;

                // Common area - shared scrolls any player can activate
                // Max 1 scroll per element type. When a new scroll of same element enters,
                // the old one goes to bottom of deck
                this.commonArea = {
                    earth: null,
                    water: null,
                    fire: null,
                    wind: null,
                    void: null,
                    catacomb: null
                };

                // Scroll decks - use external definitions if available, otherwise use defaults
                if (typeof SCROLL_DECKS !== 'undefined') {
                    // Deep copy the external deck definitions
                    this.scrollDecks = {};
                    Object.keys(SCROLL_DECKS).forEach(element => {
                        this.scrollDecks[element] = [...SCROLL_DECKS[element]];
                    });
                } else {
                    // Fallback to inline definitions
                    this.scrollDecks = {
                        earth: ['EARTH_SCROLL_1', 'EARTH_SCROLL_2', 'EARTH_SCROLL_3', 'EARTH_SCROLL_4', 'EARTH_SCROLL_5'],
                        water: ['WATER_SCROLL_1', 'WATER_SCROLL_2', 'WATER_SCROLL_3', 'WATER_SCROLL_4', 'WATER_SCROLL_5'],
                        fire: ['FIRE_SCROLL_1', 'FIRE_SCROLL_2', 'FIRE_SCROLL_3', 'FIRE_SCROLL_4', 'FIRE_SCROLL_5'],
                        wind: ['WIND_SCROLL_1', 'WIND_SCROLL_2', 'WIND_SCROLL_3', 'WIND_SCROLL_4', 'WIND_SCROLL_5'],
                        void: ['VOID_SCROLL_1', 'VOID_SCROLL_2', 'VOID_SCROLL_3', 'VOID_SCROLL_4', 'VOID_SCROLL_5'],
                        catacomb: ['CATACOMB_SCROLL_1', 'CATACOMB_SCROLL_2', 'CATACOMB_SCROLL_3', 'CATACOMB_SCROLL_4', 'CATACOMB_SCROLL_5', 'CATACOMB_SCROLL_6', 'CATACOMB_SCROLL_7', 'CATACOMB_SCROLL_8', 'CATACOMB_SCROLL_9', 'CATACOMB_SCROLL_10']
                    };
                }

                // Shuffle all decks at initialization
                this.shuffleAllDecks();

                this.initializePatterns();
                this.updateScrollCount();

                // Initialize response window system
                this.responseWindow = null;
                if (typeof ResponseWindowSystem !== 'undefined') {
                    this.responseWindow = new ResponseWindowSystem(this);
                    console.log('Response window system initialized');
                }

                // Initialize scroll effects system (use window.ScrollEffects – set by scroll-effects.js)
                this.scrollEffects = null;
                const SE = (typeof window !== 'undefined' && window.ScrollEffects) || (typeof ScrollEffects !== 'undefined' && ScrollEffects);
                if (SE) {
                    SE.init(this);
                    this.scrollEffects = SE;
                    console.log('Scroll effects system initialized');
                }

                // Pending cascade state - blocks all actions until resolved
                // Stored per player: { playerIndex: { scrollName, scrollInfo, shrineType, canCascadeToActive } }
                this.pendingCascades = {};

                // Pending end-of-turn overflow state - blocks all actions until the
                // player's hand/active scroll counts are back within limits (see
                // showEndTurnOverflowModal). Stored per player: { playerIndex: true }
                this.pendingEndTurnOverflow = {};
            }

            // Check if a player has a pending cascade that must be resolved
            hasPendingCascade(playerIndex) {
                return !!this.pendingCascades[playerIndex];
            }

            // Check if a player must resolve a scroll-overflow discard before
            // taking any other action (see showEndTurnOverflowModal)
            hasPendingEndTurnOverflow(playerIndex) {
                return !!this.pendingEndTurnOverflow[playerIndex];
            }

            // Get the pending cascade for a player
            getPendingCascade(playerIndex) {
                return this.pendingCascades[playerIndex] || null;
            }

            // Set a pending cascade for a player
            setPendingCascade(playerIndex, cascadeData) {
                this.pendingCascades[playerIndex] = cascadeData;
                console.log(`📜 Pending cascade set for player ${playerIndex}:`, cascadeData?.scrollName);
            }

            // Clear a pending cascade for a player
            clearPendingCascade(playerIndex) {
                delete this.pendingCascades[playerIndex];
                console.log(`📜 Pending cascade cleared for player ${playerIndex}`);
            }

            // Show the cascade prompt for a player (used when they try to take an action with pending cascade)
            showPendingCascadePrompt(playerIndex) {
                const cascade = this.pendingCascades[playerIndex];
                if (!cascade) return false;

                // The old "Hand Full! / All Slots Full!" cascade popup is gone.
                // overflow is handled only by the end-of-turn overflow banner
                // (showEndTurnOverflowModal). Nothing sets a pending cascade now,
                // so just drop any stale one.
                this.clearPendingCascade(playerIndex);
                return false;
            }

            // Fisher-Yates shuffle algorithm
            shuffleDeck(deck) {
                for (let i = deck.length - 1; i > 0; i--) {
                    const j = Math.floor(Math.random() * (i + 1));
                    [deck[i], deck[j]] = [deck[j], deck[i]];
                }
                return deck;
            }

            shuffleAllDecks() {
                Object.keys(this.scrollDecks).forEach(element => {
                    this.shuffleDeck(this.scrollDecks[element]);
                });
                console.log('🎴 All scroll decks shuffled');
            }

            // Draw a scroll from the top of a specific element's deck
            drawFromDeck(element) {
                if (!this.scrollDecks[element] || this.scrollDecks[element].length === 0) {
                    return null;
                }
                return this.scrollDecks[element].shift(); // Remove and return first element
            }

            // Discard a scroll to the common area
            // If a scroll of the same element is already there, it goes to bottom of deck
            discardToCommonArea(scrollName) {
                const element = this.getScrollElement(scrollName);
                if (!element) return;

                let replacedScroll = null;

                // If there's already a scroll of this element in common area, send it to deck
                // Guard: don't push to deck if it's the same scroll being discarded (avoids duplicates)
                if (this.commonArea[element] && this.commonArea[element] !== scrollName) {
                    replacedScroll = this.commonArea[element];
                    this.scrollDecks[element].push(replacedScroll); // Add old scroll to bottom of deck
                    console.log(`📜 Common area: Replaced ${replacedScroll} with ${scrollName} (old scroll to deck)`);
                } else {
                    console.log(`📜 Common area: Added ${scrollName}`);
                }

                // Place new scroll in common area
                this.commonArea[element] = scrollName;

                // Update the scroll deck UI
                try {
                    if (typeof updateScrollDeckUI === 'function') updateScrollDeckUI();
                } catch (e) {}

                // Broadcast in multiplayer
                if (isMultiplayer) {
                    broadcastGameAction('common-area-update', {
                        element: element,
                        scrollName: scrollName,
                        replacedScroll: replacedScroll
                    });
                }
            }

            // Direct discard to deck (used internally, not for player discards)
            discardToDeck(scrollName) {
                const element = this.getScrollElement(scrollName);
                if (element && this.scrollDecks[element]) {
                    this.scrollDecks[element].push(scrollName); // Add to end of deck
                    console.log(`📜 Discarded ${scrollName} to bottom of ${element} deck`);

                    // Update the scroll deck UI
                    try {
                        if (typeof updateScrollDeckUI === 'function') updateScrollDeckUI();
                    } catch (e) {}
                }
            }

            // Get all scrolls in common area (returns array of scroll names)
            getCommonAreaScrolls() {
                return Object.values(this.commonArea).filter(scroll => scroll !== null);
            }

            // Get the element type from a scroll name
            getScrollElement(scrollName) {
                if (scrollName.startsWith('EARTH')) return 'earth';
                if (scrollName.startsWith('WATER')) return 'water';
                if (scrollName.startsWith('FIRE')) return 'fire';
                if (scrollName.startsWith('WIND')) return 'wind';
                if (scrollName.startsWith('VOID')) return 'void';
                if (scrollName.startsWith('CATACOMB')) return 'catacomb';
                return null;
            }
            
            // Get active player's scroll collection
            // In multiplayer, show MY scrolls for display, but use activePlayerIndex for game logic
            getPlayerScrolls(forDisplay = false) {
                // For display in multiplayer, show my own scrolls — never a bot's,
                // even while this client is impersonating one. BotDriver
                // temporarily swaps myPlayerIndex to the bot's index for the
                // duration of its turn so the same action code can drive it
                // (asBot() in bot-driver.js); driverRealIndex() is the host's
                // real identity underneath that swap. Without this, the Hand/
                // Active panels (scroll-panels.js, via the handScrolls/
                // activeScrolls getters below) would briefly render the bot's
                // actual private hand/active contents on the host's own screen
                // during its turn.
                const realIndex = (typeof window !== 'undefined' && window.BotDriver
                    && typeof window.BotDriver.driverRealIndex === 'function'
                    && window.BotDriver.driverRealIndex() != null)
                    ? window.BotDriver.driverRealIndex()
                    : myPlayerIndex;
                // A replay spectator has no seat (myPlayerIndex < 0, see
                // js/replay-viewer.js): show whoever's turn it is instead.
                const displayIndex = (forDisplay && isMultiplayer && realIndex !== null && realIndex >= 0) ? realIndex : activePlayerIndex;

                this.ensurePlayerScrollsStructure(displayIndex);
                return this.playerScrolls[displayIndex];
            }

            // Reinforce scroll state: ensure hand/active/activated are Sets (prevents "disappearing" from bad state)
            // Give a player win-condition elements, with the empty-source rule: an
            // element whose shared source pool is empty does not count. Returns the
            // elements really granted (announce only these to the other players).
            grantElements(playerIndex, elements) {
                this.ensurePlayerScrollsStructure(playerIndex);
                const ps = this.playerScrolls[playerIndex];
                const granted = [];
                (elements || []).forEach(el => {
                    if (!el) return;
                    if ((window.stonePools?.[el] ?? 1) > 0) {
                        const isNew = !ps.activated.has(el);
                        ps.activated.add(el);
                        granted.push(el);
                        if (isNew && playerIndex === (typeof myPlayerIndex !== 'undefined' ? myPlayerIndex : playerIndex)) window.SoundSystem?.onWinCondition?.(el);
                    } else {
                        console.log(`📜 Win condition skipped for ${el} (player ${playerIndex}): source pool is empty.`);
                    }
                });
                return granted;
            }

            ensurePlayerScrollsStructure(playerIndex) {
                if (playerIndex == null || playerIndex < 0) return;
                if (!this.playerScrolls[playerIndex]) {
                    this.playerScrolls[playerIndex] = {
                        hand: new Set(),
                        active: new Set(),
                        activated: new Set()
                    };
                    return;
                }
                const p = this.playerScrolls[playerIndex];
                if (!(p.hand instanceof Set)) p.hand = new Set(Array.isArray(p.hand) ? p.hand : []);
                if (!(p.active instanceof Set)) p.active = new Set(Array.isArray(p.active) ? p.active : []);
                if (!(p.activated instanceof Set)) p.activated = new Set(Array.isArray(p.activated) ? p.activated : []);
            }

            // Validate scroll state and log warnings (helps catch sync bugs)
            validateScrollState() {
                const n = typeof totalPlayers !== 'undefined' ? totalPlayers : Math.max(2, (this.playerScrolls && this.playerScrolls.length) || 0);
                for (let i = 0; i < n; i++) {
                    this.ensurePlayerScrollsStructure(i);
                }
                const inHand = new Map();
                const inActive = new Map();
                let errorsFound = false;

                for (let i = 0; i < (this.playerScrolls && this.playerScrolls.length) || 0; i++) {
                    const p = this.playerScrolls[i];
                    if (!p || !p.hand || !p.active) continue;
                    p.hand.forEach(name => {
                        if (inHand.has(name)) {
                            console.warn('[Scroll state] ⚠️ DUPLICATE:', name, 'in hand of both player', inHand.get(name), 'and', i);
                            errorsFound = true;
                        }
                        inHand.set(name, i);
                    });
                    p.active.forEach(name => {
                        if (inActive.has(name)) {
                            console.warn('[Scroll state] ⚠️ DUPLICATE:', name, 'in active of both player', inActive.get(name), 'and', i);
                            errorsFound = true;
                        }
                        if (inHand.has(name)) {
                            console.warn('[Scroll state] ⚠️ DUPLICATE:', name, 'in both hand and active areas');
                            errorsFound = true;
                        }
                        inActive.set(name, i);
                    });
                }
                const commonElements = ['earth', 'water', 'fire', 'wind', 'void', 'catacomb'];
                commonElements.forEach(element => {
                    const name = this.commonArea[element];
                    if (!name) return;
                    if (inHand.has(name)) {
                        console.warn('[Scroll state] ⚠️ DUPLICATE:', name, 'in common area (' + element + ') and in hand of player', inHand.get(name));
                        errorsFound = true;
                    }
                    if (inActive.has(name)) {
                        console.warn('[Scroll state] ⚠️ DUPLICATE:', name, 'in common area (' + element + ') and in active of player', inActive.get(name));
                        errorsFound = true;
                    }
                });

                // Repair what has a clear answer, the same way on every board:
                // a scroll in the common area is not also held by a player (going to
                // the common area is always the later move), and a scroll in one
                // player's hand and active area stays in the active area. Before, duplicates
                // were only reported, and the host's snapshot carried them too, so
                // every board asked for a resync again and again (match 43: 4,415
                // requests). A scroll held by a player is also taken out of the decks.
                let unresolved = false;
                if (errorsFound) {
                    const common = new Set(commonElements.map(el => this.commonArea[el]).filter(Boolean));
                    (this.playerScrolls || []).forEach((p, i) => {
                        if (!p) return;
                        [...p.hand].forEach(n => {
                            if (common.has(n) || p.active.has(n)) { p.hand.delete(n); console.warn(`[Scroll state] repaired: ${n} removed from hand of player ${i}`); }
                        });
                        [...p.active].forEach(n => {
                            if (common.has(n)) { p.active.delete(n); console.warn(`[Scroll state] repaired: ${n} removed from active of player ${i}`); }
                        });
                    });
                    // Two players holding the same scroll has no clear answer: ask the host.
                    const seen = new Map();
                    (this.playerScrolls || []).forEach((p, i) => {
                        if (!p) return;
                        [...p.hand, ...p.active].forEach(n => {
                            if (seen.has(n) && seen.get(n) !== i) unresolved = true;
                            seen.set(n, i);
                        });
                    });
                }
                // A scroll that is held or in the common area is never also in a deck.
                const placed = new Set(commonElements.map(el => this.commonArea[el]).filter(Boolean));
                (this.playerScrolls || []).forEach(p => { p?.hand?.forEach(n => placed.add(n)); p?.active?.forEach(n => placed.add(n)); });
                Object.keys(this.scrollDecks || {}).forEach(el => {
                    const deck = this.scrollDecks[el];
                    if (!Array.isArray(deck)) return;
                    for (let k = deck.length - 1; k >= 0; k--) {
                        if (placed.has(deck[k])) { console.warn(`[Scroll state] repaired: ${deck[k]} removed from the ${el} deck`); deck.splice(k, 1); }
                    }
                });

                // Only an unresolved conflict asks the host, and at most every 5 s.
                if (unresolved && typeof isMultiplayer !== 'undefined' && isMultiplayer) {
                    const now = Date.now();
                    if (!this._lastSyncRequestAt || now - this._lastSyncRequestAt > 5000) {
                        this._lastSyncRequestAt = now;
                        console.warn('⚠️ Scroll state conflict! Requesting sync from host...');
                        if (typeof broadcastGameAction === 'function' && typeof myPlayerIndex !== 'undefined' && myPlayerIndex !== 0) {
                            broadcastGameAction('scroll-state-sync-request', { playerIndex: myPlayerIndex });
                        }
                    }
                }

                return errorsFound;
            }

            // Generate complete scroll state snapshot for syncing
            getScrollStateSnapshot() {
                const snapshot = {
                    players: [],
                    commonArea: {},
                    decks: {}
                };

                // Capture each player's scrolls
                for (let i = 0; i < this.playerScrolls.length; i++) {
                    const p = this.playerScrolls[i];
                    if (!p) continue;
                    snapshot.players[i] = {
                        hand: Array.from(p.hand || []),
                        active: Array.from(p.active || []),
                        activated: Array.from(p.activated || [])
                    };
                }

                // Capture common area
                ['earth', 'water', 'fire', 'wind', 'void', 'catacomb'].forEach(element => {
                    snapshot.commonArea[element] = this.commonArea[element] || null;
                });

                // Capture full decks (host is authoritative, clients should match exactly)
                Object.keys(this.scrollDecks || {}).forEach(element => {
                    snapshot.decks[element] = [...(this.scrollDecks[element] || [])];
                });

                return snapshot;
            }

            // Apply scroll state snapshot from authoritative source
            applyScrollStateSnapshot(snapshot) {
                let corrected = false;
                const activatedChangedPlayers = [];

                // Apply player scrolls
                if (snapshot.players) {
                    for (let i = 0; i < snapshot.players.length; i++) {
                        if (!snapshot.players[i]) continue;
                        this.ensurePlayerScrollsStructure(i);
                        const p = this.playerScrolls[i];
                        const snap = snapshot.players[i];

                        // Sync hand
                        const newHand = new Set(snap.hand || []);
                        if (!this.setsEqual(p.hand, newHand)) {
                            console.log(`🔄 Player ${i} hand corrected:`, Array.from(p.hand), '→', Array.from(newHand));
                            p.hand = newHand;
                            corrected = true;
                        }

                        // Sync active
                        const newActive = new Set(snap.active || []);
                        if (!this.setsEqual(p.active, newActive)) {
                            console.log(`🔄 Player ${i} active corrected:`, Array.from(p.active), '→', Array.from(newActive));
                            p.active = newActive;
                            corrected = true;
                        }

                        // Sync activated (win condition tracking) - additive only.
                        // Never remove locally-tracked activations: a non-host player may have
                        // pre-tracked an element during an interactive scroll (e.g. Take Flight)
                        // before the host's periodic sync fires, which would otherwise wipe it.
                        const newActivated = new Set(snap.activated || []);
                        const prevActivatedSize = p.activated.size;
                        newActivated.forEach(el => p.activated.add(el));
                        if (p.activated.size !== prevActivatedSize) {
                            console.log(`🔄 Player ${i} activated updated (additive):`, Array.from(newActivated), '→', Array.from(p.activated));
                            corrected = true;
                            activatedChangedPlayers.push(i);
                        }
                    }
                }

                // Apply common area
                if (snapshot.commonArea) {
                    // Build a set of scrolls already in players' hands/active areas locally.
                    // If a scroll is here, the player just drew/played it and the host's
                    // periodic broadcast is stale — don't put it back in the common area.
                    const inLocalPlay = new Set();
                    for (const p of this.playerScrolls) {
                        if (!p) continue;
                        p.hand.forEach(s => inLocalPlay.add(s));
                        p.active.forEach(s => inLocalPlay.add(s));
                    }

                    ['earth', 'water', 'fire', 'wind', 'void', 'catacomb'].forEach(element => {
                        const newScroll = snapshot.commonArea[element] || null;
                        if (newScroll && inLocalPlay.has(newScroll)) {
                            // Host state is stale — this scroll was already drawn by a player
                            console.log(`[sync] Skipping common area restore for ${element}: ${newScroll} is already in local play`);
                            return;
                        }
                        if (this.commonArea[element] !== newScroll) {
                            console.log(`🔄 Common area ${element} corrected:`, this.commonArea[element], '→', newScroll);
                            this.commonArea[element] = newScroll;
                            corrected = true;
                        }
                    });
                }

                // Apply decks (sync full deck contents from host)
                if (snapshot.decks) {
                    Object.keys(snapshot.decks).forEach(element => {
                        const newDeck = snapshot.decks[element] || [];
                        const currentDeck = this.scrollDecks[element] || [];

                        // Compare deck contents (order matters for deck draw)
                        if (!this.arraysEqual(currentDeck, newDeck)) {
                            console.log(`🔄 ${element} deck corrected: ${currentDeck.length} scrolls → ${newDeck.length} scrolls`);
                            this.scrollDecks[element] = [...newDeck];
                            corrected = true;
                        }
                    });
                }

                if (corrected) {
                    // Only update UI and validate, no console spam
                    this.validateScrollState();
                    this.updateScrollCount();
                    if (typeof updateCommonAreaUI === 'function') updateCommonAreaUI();
                    if (typeof updateScrollDeckUI === 'function') updateScrollDeckUI();
                    // Refresh win-condition markers and check win condition for any player
                    // whose activated set gained elements via this sync
                    if (typeof updatePlayerElementSymbols === 'function') {
                        activatedChangedPlayers.forEach(playerIdx => {
                            updatePlayerElementSymbols(playerIdx);
                            // Win condition: all 5 elements activated + returned to own shrine
                            if (checkWinCondition(playerIdx, { announce: true })) {
                                console.log(`🏆 Win condition met for player ${playerIdx} (detected via state sync)`);
                            }
                        });
                    }
                }

                return corrected;
            }

            // Helper: compare two sets for equality
            setsEqual(set1, set2) {
                if (set1.size !== set2.size) return false;
                for (const item of set1) {
                    if (!set2.has(item)) return false;
                }
                return true;
            }

            // Helper: compare two arrays for equality (order matters)
            arraysEqual(arr1, arr2) {
                if (arr1.length !== arr2.length) return false;
                for (let i = 0; i < arr1.length; i++) {
                    if (arr1[i] !== arr2[i]) return false;
                }
                return true;
            }

            // Comprehensive scroll audit - finds ALL scrolls and reports discrepancies
            auditScrolls() {
                const allScrolls = new Map(); // scrollName -> locations[]
                const issues = [];

                // Count scrolls in each location
                const countScroll = (scrollName, location) => {
                    if (!scrollName) return;
                    if (!allScrolls.has(scrollName)) {
                        allScrolls.set(scrollName, []);
                    }
                    allScrolls.get(scrollName).push(location);
                };

                // Check player hands and active areas
                for (let i = 0; i < (this.playerScrolls?.length || 0); i++) {
                    const p = this.playerScrolls[i];
                    if (!p) continue;
                    const playerName = typeof getPlayerColorName === 'function' ? getPlayerColorName(i) : `Player ${i}`;

                    (p.hand || new Set()).forEach(scroll => countScroll(scroll, `${playerName} hand`));
                    (p.active || new Set()).forEach(scroll => countScroll(scroll, `${playerName} active`));
                }

                // Check common area
                ['earth', 'water', 'fire', 'wind', 'void', 'catacomb'].forEach(element => {
                    const scroll = this.commonArea[element];
                    if (scroll) countScroll(scroll, `Common (${element})`);
                });

                // Check decks
                Object.keys(this.scrollDecks || {}).forEach(element => {
                    (this.scrollDecks[element] || []).forEach(scroll => {
                        countScroll(scroll, `${element} deck`);
                    });
                });

                // Analyze results
                console.log('\n🔍 SCROLL AUDIT REPORT\n');

                let duplicates = 0;
                allScrolls.forEach((locations, scrollName) => {
                    if (locations.length > 1) {
                        console.warn(`⚠️  DUPLICATE: ${scrollName} exists in ${locations.length} locations:`, locations);
                        issues.push({ scroll: scrollName, issue: 'duplicate', locations });
                        duplicates++;
                    }
                });

                if (duplicates === 0) {
                    console.log('✅ No duplicates found');
                } else {
                    console.warn(`⚠️  Found ${duplicates} duplicated scrolls!`);
                }

                // Count total scrolls by element
                const elementCounts = { earth: 0, water: 0, fire: 0, wind: 0, void: 0, catacomb: 0 };
                allScrolls.forEach((locations, scrollName) => {
                    const element = this.getScrollElement(scrollName);
                    if (element && elementCounts.hasOwnProperty(element)) {
                        elementCounts[element] += locations.length; // Count all instances (including duplicates)
                    }
                });

                console.log('\n📊 Total Scroll Counts (across all locations):');
                Object.entries(elementCounts).forEach(([element, count]) => {
                    console.log(`  ${element}: ${count} scrolls found`);
                });

                console.log('\n');

                return { issues, elementCounts, allScrolls };
            }

            // Compatibility getters for existing code
            // collectedScrolls now returns both hand AND active scrolls combined
            get collectedScrolls() {
                const scrolls = this.getPlayerScrolls(true);
                const combined = new Set([...scrolls.hand, ...scrolls.active]);
                return combined;
            }

            get activatedScrollTypes() {
                return this.getPlayerScrolls(true).activated;
            }

            // Get scrolls in hand only
            get handScrolls() {
                return this.getPlayerScrolls(true).hand;
            }

            // Get scrolls in active area only
            get activeScrolls() {
                return this.getPlayerScrolls(true).active;
            }

            // Move scroll from hand to active area (0 AP cost)
            moveToActive(scrollName) {
                const scrolls = this.getPlayerScrolls(false); // Use active player for game logic

                // Check active area limit
                if (scrolls.active.size >= this.MAX_ACTIVE_SIZE) {
                    updateStatus(`Active area full! Max ${this.MAX_ACTIVE_SIZE} scrolls. Move one to hand or common area first.`);
                    window.SoundSystem?.play('error');
                    return false;
                }

                if (scrolls.hand.has(scrollName)) {
                    scrolls.hand.delete(scrollName);
                    scrolls.active.add(scrollName);
                    console.log(`📜 Moved ${scrollName} to active area`);
                    this.updateScrollCount();

                    // Broadcast in multiplayer
                    if (isMultiplayer) {
                        broadcastGameAction('scroll-move', {
                            playerIndex: activePlayerIndex,
                            scrollName: scrollName,
                            toLocation: 'active'
                        });
                    }
                    return true;
                }
                return false;
            }

            // Move scroll from active area back to hand - DISABLED
            // Scrolls cannot be returned to hand once placed in active area
            moveToHand(scrollName) {
                // Per game rules, scrolls cannot be moved back to hand once in active area
                updateStatus(`Scrolls cannot be returned to hand! Discard to Common Area instead.`);
                return false;
            }

            // Internal undo helper — reverses a scroll move without rule checks.
            // 'from' and 'to' are the ORIGINAL move's from/to; this reverses it.
            // Broadcasts the reversal in multiplayer (mirrors the undo-move/stone-break/
            // stone-place branches in game-ui.js) so remote clients don't keep believing
            // the scroll is still in the common area — see 'scroll-move-undo' in lobby.js.
            _undoScrollMove(scrollName, from, to, displacedScroll) {
                const scrolls = this.getPlayerScrolls(false);
                const element = this.getScrollElement(scrollName);

                if (to === 'active') {
                    // Undo hand → active: move back to hand
                    if (scrolls.active.has(scrollName)) {
                        scrolls.active.delete(scrollName);
                        scrolls.hand.add(scrollName);
                    }
                } else if (to === 'common') {
                    // Undo hand/active → common
                    if (element && this.commonArea[element] === scrollName) {
                        this.commonArea[element] = null;
                        // If a scroll was displaced to deck, restore it to common area
                        if (displacedScroll && element) {
                            const deck = this.scrollDecks[element];
                            const idx = deck ? deck.lastIndexOf(displacedScroll) : -1;
                            if (idx !== -1) deck.splice(idx, 1);
                            this.commonArea[element] = displacedScroll;
                        }
                    }
                    // Restore scroll to its original area
                    if (from === 'hand') scrolls.hand.add(scrollName);
                    else if (from === 'active') scrolls.active.add(scrollName);
                }

                this.updateScrollCount();
                if (typeof updateScrollDeckUI === 'function') try { updateScrollDeckUI(); } catch(e) {}

                if (isMultiplayer) {
                    broadcastGameAction('scroll-move-undo', {
                        playerIndex: activePlayerIndex,
                        scrollName,
                        from,
                        to,
                        displacedScroll: displacedScroll || null
                    });
                }
            }

            // Discard a scroll from hand or active area to common area
            discardScroll(scrollName) {
                const scrolls = this.getPlayerScrolls(false);
                let removed = false;

                if (scrolls.hand.has(scrollName)) {
                    scrolls.hand.delete(scrollName);
                    removed = true;
                } else if (scrolls.active.has(scrollName)) {
                    scrolls.active.delete(scrollName);
                    removed = true;
                }

                if (removed) {
                    // Send to common area instead of deck
                    this.discardToCommonArea(scrollName);
                    this.updateScrollCount();
                    try {
                        if (typeof updateCommonAreaUI === 'function') updateCommonAreaUI();
                    } catch (e) {}

                    // Broadcast in multiplayer
                    if (isMultiplayer) {
                        broadcastGameAction('scroll-discard', {
                            playerIndex: activePlayerIndex,
                            scrollName: scrollName
                        });
                    }
                    return true;
                }
                return false;
            }

            initializePatterns() {
                // Use external scroll definitions if available
                if (typeof SCROLL_DEFINITIONS !== 'undefined') {
                    this.patterns = SCROLL_DEFINITIONS;
                    console.log('📜 Loaded scroll definitions from external file');
                    return;
                }

                // Fallback to inline definitions
                console.log('📜 Using inline scroll definitions (external file not loaded)');

                // Corrected patterns from user's visual editor
                const level1Patterns = [
                    [{ q: 0, r: -1 }, { q: 0, r: 1 }],
                    [{ q: 1, r: -1 }, { q: -1, r: 1 }],
                    [{ q: 1, r: 0 }, { q: -1, r: 0 }]
                ];

                const level2Patterns = [
                    [{ q: -1, r: -1 }, { q: 1, r: 1 }],
                    [{ q: 1, r: -2 }, { q: -1, r: 2 }],
                    [{ q: 2, r: -1 }, { q: -2, r: 1 }]
                ];

                const level3Patterns = [
                    [{ q: 1, r: -1 }, { q: -1, r: 0 }, { q: 0, r: 1 }],
                    [{ q: 0, r: -1 }, { q: 1, r: 0 }, { q: -1, r: 1 }]
                ];

                const level4Patterns = [
                    [{ q: 1, r: -2 }, { q: -2, r: 1 }, { q: 1, r: 1 }],
                    [{ q: -1, r: -1 }, { q: 2, r: -1 }, { q: -1, r: 2 }]
                ];

                const level5Patterns = [
                    [{ q: 0, r: -1 }, { q: 0, r: 1 }, { q: 2, r: -1 }, { q: -2, r: 1 }],
                    [{ q: 1, r: -1 }, { q: -1, r: 1 }, { q: -1, r: -1 }, { q: 1, r: 1 }],
                    [{ q: 1, r: 0 }, { q: -1, r: 0 }, { q: 1, r: -2 }, { q: -1, r: 2 }]
                ];

                this.patterns = {};
                const elementTypes = ['earth', 'water', 'fire', 'wind', 'void'];

                elementTypes.forEach(element => {
                    [level1Patterns, level2Patterns, level3Patterns, level4Patterns, level5Patterns].forEach((patterns, level) => {
                        const scrollName = `${element.toUpperCase()}_SCROLL_${level + 1}`;
                        this.patterns[scrollName] = {
                            name: `${element.charAt(0).toUpperCase() + element.slice(1)} Scroll ${toRoman(level + 1)}`,
                            description: `Stand in the pattern and cast to activate ${element}.`,
                            level: level + 1,
                            element: element,
                            patterns: patterns.map(pattern =>
                                pattern.map(pos => ({ ...pos, type: element }))
                            ),
                            // Earth II can counter any scroll
                            canCounter: (element === 'earth' && level === 1) ? 'any' : null
                        };
                    });
                });

                // Add catacomb scrolls (multi-element patterns)
                // Each gets 3 rotational variations like level 2 scrolls
                const catacombBase = {
                    CATACOMB_SCROLL_1: [
                        { q: -1, r: -1, type: "water" },
                        { q: 1, r: 1, type: "water" },
                        { q: 1, r: -2, type: "earth" },
                        { q: -1, r: 2, type: "earth" }
                    ],
                    CATACOMB_SCROLL_2: [
                        { q: -1, r: -1, type: "earth" },
                        { q: 1, r: 1, type: "earth" },
                        { q: 1, r: -2, type: "fire" },
                        { q: -1, r: 2, type: "fire" }
                    ],
                    CATACOMB_SCROLL_3: [
                        { q: -1, r: -1, type: "wind" },
                        { q: 1, r: 1, type: "wind" },
                        { q: 1, r: -2, type: "earth" },
                        { q: -1, r: 2, type: "earth" }
                    ],
                    CATACOMB_SCROLL_4: [
                        { q: -1, r: -1, type: "void" },
                        { q: 1, r: 1, type: "void" },
                        { q: 1, r: -2, type: "earth" },
                        { q: -1, r: 2, type: "earth" }
                    ],
                    CATACOMB_SCROLL_5: [
                        { q: -1, r: -1, type: "water" },
                        { q: 1, r: 1, type: "water" },
                        { q: 1, r: -2, type: "fire" },
                        { q: -1, r: 2, type: "fire" }
                    ],
                    CATACOMB_SCROLL_6: [
                        { q: -1, r: -1, type: "wind" },
                        { q: 1, r: 1, type: "wind" },
                        { q: 1, r: -2, type: "water" },
                        { q: -1, r: 2, type: "water" }
                    ],
                    CATACOMB_SCROLL_7: [
                        { q: -1, r: -1, type: "void" },
                        { q: 1, r: 1, type: "void" },
                        { q: 1, r: -2, type: "water" },
                        { q: -1, r: 2, type: "water" }
                    ],
                    CATACOMB_SCROLL_8: [
                        { q: -1, r: -1, type: "fire" },
                        { q: 1, r: 1, type: "fire" },
                        { q: 1, r: -2, type: "wind" },
                        { q: -1, r: 2, type: "wind" }
                    ],
                    CATACOMB_SCROLL_9: [
                        { q: -1, r: -1, type: "void" },
                        { q: 1, r: 1, type: "void" },
                        { q: 1, r: -2, type: "wind" },
                        { q: -1, r: 2, type: "wind" }
                    ],
                    CATACOMB_SCROLL_10: [
                        { q: -1, r: -1, type: "fire" },
                        { q: 1, r: 1, type: "fire" },
                        { q: 1, r: -2, type: "void" },
                        { q: -1, r: 2, type: "void" }
                    ]
                };

                // Generate 3 rotational variations for each catacomb scroll
                Object.entries(catacombBase).forEach(([scrollName, basePattern]) => {
                    const scrollNum = parseInt(scrollName.split('_')[2]);

                    // Helper function to rotate hex coordinate by 60 degrees
                    const rotateHex = (q, r, steps) => {
                        // Rotate counter-clockwise by steps * 60 degrees
                        let nq = q, nr = r;
                        for (let i = 0; i < steps; i++) {
                            const tempQ = nq;
                            nq = -nr;
                            nr = -(-tempQ - nr);
                        }
                        return { q: nq, r: nr };
                    };

                    // Create 3 rotational variations (0°, 120°, 240°)
                    const variations = [
                        basePattern, // 0° rotation
                        basePattern.map(pos => ({ // 120° rotation (2 steps)
                            ...rotateHex(pos.q, pos.r, 2),
                            type: pos.type
                        })),
                        basePattern.map(pos => ({ // 240° rotation (4 steps)
                            ...rotateHex(pos.q, pos.r, 4),
                            type: pos.type
                        }))
                    ];

                    this.patterns[scrollName] = {
                        name: `Catacomb Scroll ${scrollNum}`,
                        description: `Multi-element pattern: gain +2 of each stone type (2 AP)`,
                        level: 2,
                        element: 'catacomb',
                        patterns: variations
                    };
                });
            }

            onTileRevealed(shrineType) {
                if (shrineType === 'player') return null;
                if (!this.scrollDecks[shrineType] || this.scrollDecks[shrineType].length === 0) {
                    return null;
                }

                // Draw from top of the element's deck
                const selected = this.drawFromDeck(shrineType);
                if (!selected) return null;

                const scrolls = this.getPlayerScrolls(false);
                const scrollInfo = this.patterns[selected];

                // Always add to hand immediately so the player can still act this turn.
                // If the hand now exceeds the limit the end-of-turn overflow modal will
                // prompt for a cascade before the turn advances.
                scrolls.hand.add(selected);
                this.updateScrollCount();

                // Broadcast scroll collection in multiplayer
                if (isMultiplayer) {
                    broadcastGameAction('scroll-collected', {
                        playerIndex: activePlayerIndex,
                        scrollName: selected,
                        shrineType: shrineType
                    });
                }

                if (scrolls.hand.size > this.MAX_HAND_SIZE) {
                    // Over limit — remind the player they must cascade before ending their turn
                    updateStatus(`Picked up "${scrollInfo?.name || selected}" - hand is over the limit. Cascade a scroll before ending your turn!`);
                } else {
                    this.showScrollNotification(scrollInfo, shrineType, selected);
                }

                return scrollInfo;
            }

            // End-of-turn overflow: hand or active over capacity.
            // Opens the Hand + Active panels and shows a top banner until resolved.
            showEndTurnOverflowModal(onResolved) {
                const self = this;

                // Lock out all other actions (tile/stone placement, movement, etc.)
                // for the rest of this turn — the turn isn't actually over yet
                // (activePlayerIndex hasn't advanced), so without this the player
                // could keep acting while "must discard" is displayed. Cleared
                // below once the overflow is actually resolved.
                const playerIdx = activePlayerIndex;
                self.pendingEndTurnOverflow[playerIdx] = true;

                // Open Hand + Active panels so the player can manage scrolls
                if (window.ScrollPanelSystem) {
                    window.ScrollPanelSystem.openPanel('hand');
                    window.ScrollPanelSystem.openPanel('active');
                    window.ScrollPanelSystem.refresh();
                }

                // First time a player hits overflow this session, explain what's
                // going on — the banner alone says the counts, not why the limit
                // exists or what discarding to the Common Area actually does.
                if (!self._overflowExplained) {
                    self._overflowExplained = true;
                    const old2 = document.getElementById('scroll-overflow-explainer');
                    if (old2) old2.remove();
                    const explainer = document.createElement('div');
                    explainer.id = 'scroll-overflow-explainer';
                    explainer.innerHTML = `
                        <div class="overflow-explainer-title">Scroll Overflow</div>
                        <div class="overflow-explainer-body">Your Hand and Active Area can each hold at most 2 scrolls. When you're over the limit, discard down to 2 before you can end your turn, sometimes down to the Common Area, where any player can use it. Sending a scroll to the Common Area replaces a scroll of the same type already there.</div>
                        <button class="overflow-explainer-btn">Got it</button>
                    `;
                    document.body.appendChild(explainer);
                    explainer.querySelector('.overflow-explainer-btn').addEventListener('click', () => explainer.remove());
                }

                // Remove any stale banner from a previous call
                const old = document.getElementById('scroll-overflow-banner');
                if (old) old.remove();

                // Build the banner
                const banner = document.createElement('div');
                banner.id = 'scroll-overflow-banner';

                const statusEl = document.createElement('span');
                statusEl.className = 'overflow-banner-status';
                banner.appendChild(statusEl);

                const endTurnBtn = document.createElement('button');
                endTurnBtn.className = 'overflow-banner-btn';
                endTurnBtn.textContent = 'End Turn';
                endTurnBtn.disabled = true;
                banner.appendChild(endTurnBtn);

                document.body.appendChild(banner);

                function updateBanner() {
                    if (!document.getElementById('scroll-overflow-banner')) {
                        clearInterval(pollInterval);
                        return;
                    }
                    const scrolls = self.getPlayerScrolls(false);
                    const handOver   = scrolls.hand.size   > self.MAX_HAND_SIZE;
                    const activeOver = scrolls.active.size > self.MAX_ACTIVE_SIZE;
                    const stillOver  = handOver || activeOver;

                    if (stillOver) {
                        let msg = `⚠ Scroll Overflow - `;
                        if (handOver)   msg += `Hand: ${scrolls.hand.size}/${self.MAX_HAND_SIZE}  `;
                        if (activeOver) msg += `Active: ${scrolls.active.size}/${self.MAX_ACTIVE_SIZE}`;
                        statusEl.textContent = msg.trimEnd();
                        banner.classList.remove('overflow-resolved');
                        endTurnBtn.disabled = true;
                    } else {
                        statusEl.textContent = `✓ Resolved - Hand: ${scrolls.hand.size}/${self.MAX_HAND_SIZE}  Active: ${scrolls.active.size}/${self.MAX_ACTIVE_SIZE}`;
                        banner.classList.add('overflow-resolved');
                        endTurnBtn.disabled = false;
                    }

                    // Do NOT call ScrollPanelSystem.refresh() here — rebuilding the card DOM
                    // every 300ms destroys elements mid-hover and mid-click, which:
                    //   • resets the 500ms hover-preview timer (spinner never resolves)
                    //   • destroys the card element the user is about to click
                    // The move buttons in the panels already call refresh() after each move.
                }

                endTurnBtn.addEventListener('click', () => {
                    const scrolls = self.getPlayerScrolls(false);
                    const handOver   = scrolls.hand.size   > self.MAX_HAND_SIZE;
                    const activeOver = scrolls.active.size > self.MAX_ACTIVE_SIZE;
                    if (handOver || activeOver) return;
                    delete self.pendingEndTurnOverflow[playerIdx];
                    clearInterval(pollInterval);
                    banner.remove();
                    onResolved();
                });

                updateBanner();
                const pollInterval = setInterval(updateBanner, 300);
            }

            showScrollNotification(scrollInfo, elementType, scrollId) {
                // Host driving a bot (bot-driver.js asBot()): this draw is the
                // BOT's, not the local player's — myPlayerIndex is swapped to
                // the bot right now, so the panel-open below would render the
                // BOT's hand on the host's screen. Skip all of it; the scroll
                // was already added to the bot's hand before this call, so no
                // game state is lost.
                if (window.BotDriver?.controlsActivePlayer?.()) return;
                const stoneType = STONE_TYPES[elementType];
                const color = stoneType ? stoneType.color : '#9458f4';

                // Open the Hand panel so the player can see the new card
                if (window.ScrollPanelSystem) {
                    window.ScrollPanelSystem.openPanel('hand');
                    window.ScrollPanelSystem.refresh();
                    // Briefly glow the new card after a short render delay
                    if (scrollId) {
                        setTimeout(() => {
                            const body = document.getElementById('fsp-body-hand');
                            if (body) {
                                const card = body.querySelector(`.fsp-card[data-scroll-name="${CSS.escape(scrollId)}"]`);
                                if (card) {
                                    card.classList.add('fsp-card-new-glow');
                                    setTimeout(() => card.classList.remove('fsp-card-new-glow'), 2500);
                                }
                            }
                        }, 120);
                    }
                }

                // Non-blocking toast at the bottom of the screen
                const iconHtml = stoneType
                    ? `<img src="${stoneType.img}" style="width:16px;height:16px;vertical-align:middle;margin-right:4px;" alt="${elementType}">`
                    : '✦ ';

                const toast = document.createElement('div');
                toast.className = 'scroll-found-toast';
                toast.style.setProperty('--toast-color', color);

                const msg = document.createElement('span');
                msg.className = 'scroll-found-toast-msg';
                msg.innerHTML = `${iconHtml}New Scroll: <strong>${scrollInfo?.name || scrollId}</strong>`;
                toast.appendChild(msg);

                const closeBtn = document.createElement('button');
                closeBtn.textContent = 'Got it!';
                closeBtn.className = 'scroll-found-toast-btn';
                closeBtn.onclick = () => toast.remove();
                toast.appendChild(closeBtn);

                document.body.appendChild(toast);
                // Auto-dismiss after 5 seconds
                setTimeout(() => { if (toast.parentNode) toast.remove(); }, 5000);
            }

            checkPattern(patternName) {
                // Use the active player's position by default
                return this.checkPatternForPlayer(patternName, activePlayerIndex);
            }

            // Check pattern for a specific player (used by response window)
            checkPatternForPlayer(patternName, playerIndex) {
                const pattern = this.patterns[patternName];
                if (!pattern) return false;

                // Get the player's position
                let pos;
                if (playerIndex === activePlayerIndex && playerPosition) {
                    // Use global playerPosition for active player
                    pos = playerPosition;
                } else if (playerPositions && playerPositions[playerIndex]) {
                    // Use playerPositions array for other players
                    pos = playerPositions[playerIndex];
                } else {
                    return false;
                }

                const playerHex = pixelToHex(pos.x, pos.y, TILE_SIZE);

                console.log(`  Checking ${patternName} for player ${playerIndex}...`);

                return pattern.patterns.some((patternVariant, variantIdx) => {
                    const allMatch = patternVariant.every((req, reqIdx) => {
                        const checkHex = hexToPixel(playerHex.q + req.q, playerHex.r + req.r, TILE_SIZE);
                        const stone = placedStones.find(s => {
                            const dist = Math.sqrt(Math.pow(s.x - checkHex.x, 2) + Math.pow(s.y - checkHex.y, 2));
                            const matches = dist < 5 && s.type === req.type;
                            if (matches) {
                                console.log(`    ✓ Found ${s.type} stone at (${req.q}, ${req.r})`);
                            }
                            return matches;
                        });
                        if (!stone) {
                            console.log(`    ✗ Missing ${req.type} stone at (${req.q}, ${req.r})`);
                        }
                        return !!stone;
                    });

                    if (allMatch) {
                        console.log(`    ✓✓✓ PATTERN VARIANT ${variantIdx + 1} MATCHED!`);
                    }
                    return allMatch;
                });
            }

            // Get current spell AP cost (may be reduced by buffs)
            getSpellCost(spell = null, playerIndex = activePlayerIndex) {
                // Quick Reflexes: level 1 scrolls cost 0 until caster's next turn
                if (spell && spell.level === 1 && this.scrollEffects?.activeBuffs?.quickReflexes) {
                    const qr = this.scrollEffects.activeBuffs.quickReflexes;
                    if (qr.playerIndex === playerIndex) {
                        return 0;
                    }
                }
                // Simplify: scrolls cost 1 for the caster this turn
                if (this.scrollEffects?.activeBuffs?.simplify) {
                    const buff = this.scrollEffects.activeBuffs.simplify;
                    if (buff.playerIndex === playerIndex) {
                        return 1;
                    }
                }
                return this.SPELL_AP_COST;
            }

            castSpell() {
                // A pawn mid-transit across a stone hasn't come to rest yet —
                // must move off before casting (see isPlayerRestingOnStone).
                if (typeof isPlayerRestingOnStone === 'function' && isPlayerRestingOnStone(activePlayerIndex)) {
                    window.SoundSystem?.play('error');
                    updateStatus('Cannot activate while standing on a stone - move to an empty hex first.');
                    return false;
                }
                // Scrolls in Active Area OR Common Area can be activated
                const activeScrollsList = Array.from(this.getPlayerScrolls(false).active);
                const commonAreaScrolls = this.getCommonAreaScrolls();
                const allCastableScrolls = [...activeScrollsList, ...commonAreaScrolls];
                if (typeof window !== 'undefined' && window.logScrollEvent) {
                    window.logScrollEvent('cast_attempt', {
                        playerIndex: activePlayerIndex,
                        active: activeScrollsList,
                        common: commonAreaScrolls
                    });
                }

                if (allCastableScrolls.length === 0) {
                    window.SoundSystem?.play('error');
                    updateStatus("No scrolls available! Move scrolls to Active Area or use Common Area scrolls.");
                    return false;
                }

                // Debug: Log player position and nearby stones (throttled)
                if (shouldDebugLog('castSpellDebug', 1000)) {
                    console.log('✨ Attempting to cast spell...');
                    console.log(`Player position: (${playerPosition.x.toFixed(1)}, ${playerPosition.y.toFixed(1)})`);
                    console.log(`Active scrolls: ${activeScrollsList.join(', ')}`);
                    console.log(`Common area scrolls: ${commonAreaScrolls.join(', ')}`);

                    if (playerPosition) {
                        const playerHex = pixelToHex(playerPosition.x, playerPosition.y, TILE_SIZE);
                        console.log(`Player hex: q=${playerHex.q}, r=${playerHex.r}`);

                        // Log nearby stones
                        console.log('Nearby stones:');
                        const nearbyStones = [];
                        placedStones.forEach(stone => {
                            const stoneHex = pixelToHex(stone.x, stone.y, TILE_SIZE);
                            const relQ = stoneHex.q - playerHex.q;
                            const relR = stoneHex.r - playerHex.r;
                            nearbyStones.push({ type: stone.type, q: relQ, r: relR });
                            console.log(`  ${stone.type} at relative (${relQ}, ${relR})`);
                        });

                        // Check each castable scroll and show why it doesn't match
                        console.log('\nChecking castable scrolls (Active + Common Area):');
                        for (const scrollName of allCastableScrolls) {
                            const pattern = this.patterns[scrollName];
                            console.log(`\n${scrollName} requires:`);
                            pattern.patterns.forEach((patternVariant, idx) => {
                                const coords = patternVariant.map(p => `(${p.q},${p.r}) ${p.type}`).join(' + ');
                                const matches = patternVariant.every(req => {
                                    return nearbyStones.some(s => s.q === req.q && s.r === req.r && s.type === req.type);
                                });
                                console.log(`  Pattern ${idx + 1}: ${coords} - ${matches ? '✓ MATCH' : '✗ no match'}`);
                            });
                        }
                    }
                }

                const matchingSpells = [];
                // Check scrolls in Active Area AND Common Area
                for (const scrollName of allCastableScrolls) {
                    if (this.checkPattern(scrollName)) {
                        console.log(`\n✓ Pattern match found: ${scrollName}`);
                        const isFromCommonArea = commonAreaScrolls.includes(scrollName);
                        matchingSpells.push({ name: scrollName, spell: this.patterns[scrollName], fromCommonArea: isFromCommonArea });
                    }
                }

                if (matchingSpells.length === 0) {
                    window.SoundSystem?.play('error');
                    updateStatus("No valid scroll pattern found! Check console for details.");
                    console.log('\n✗ No matching patterns');
                    return false;
                }

                matchingSpells.sort((a, b) => b.spell.level - a.spell.level);

                // Level 1 scrolls can only be used during the response window
                const mainPhaseSpells = matchingSpells.filter(s => s.spell.level !== 1);
                if (mainPhaseSpells.length === 0) {
                    window.SoundSystem?.play('error');
                    updateStatus('Level 1 scrolls can only be used as responses.');
                    return false;
                }

                // Filter by affordability based on each spell's actual cost
                const affordableSpells = mainPhaseSpells.filter(({ spell }) => {
                    const cost = this.getSpellCost(spell, activePlayerIndex);
                    return canAfford(cost);
                });

                if (typeof window !== 'undefined' && window.logScrollEvent) {
                    window.logScrollEvent('cast_matches', {
                        playerIndex: activePlayerIndex,
                        matches: matchingSpells.map(m => ({ name: m.name, level: m.spell.level, element: m.spell.element })),
                        affordable: affordableSpells.map(m => ({ name: m.name, level: m.spell.level, element: m.spell.element }))
                    });
                }

                if (affordableSpells.length === 0) {
                    window.SoundSystem?.play('error');
                    const minCost = Math.min(...matchingSpells.map(({ spell }) => this.getSpellCost(spell, activePlayerIndex)));
                    updateStatus(`Not enough AP! Need ${minCost} AP to activate.`);
                    return false;
                }

                if (affordableSpells.length > 1) {
                    // Always show selection when multiple scrolls match
                    this.showSpellSelection(affordableSpells);
                } else {
                    this.executeSpell(affordableSpells[0]);
                }
                return true;
            }

            // Activate exactly the named scroll (the per-card "Activate" button in
            // scroll-panels.js), as opposed to castSpell() which scans every castable
            // scroll (active + common area) and fires whichever one matches. Without
            // this, clicking a specific card's dim/not-ready Activate button could
            // silently activate a *different* scroll elsewhere (e.g. one sitting in
            // the common area) that happened to match the board instead of reporting
            // that this scroll isn't ready.
            castSpecificScroll(scrollName) {
                if (typeof isPlayerRestingOnStone === 'function' && isPlayerRestingOnStone(activePlayerIndex)) {
                    window.SoundSystem?.play('error');
                    updateStatus('Cannot activate while standing on a stone - move to an empty hex first.');
                    return false;
                }

                const activeScrollsList = Array.from(this.getPlayerScrolls(false).active);
                const commonAreaScrolls = this.getCommonAreaScrolls();
                const isFromCommonArea = commonAreaScrolls.includes(scrollName);

                if (!activeScrollsList.includes(scrollName) && !isFromCommonArea) {
                    window.SoundSystem?.play('error');
                    updateStatus(`${scrollName} is no longer available to activate.`);
                    return false;
                }

                const spell = this.patterns[scrollName];
                if (!spell) {
                    window.SoundSystem?.play('error');
                    updateStatus(`Unknown scroll: ${scrollName}.`);
                    return false;
                }

                if (!this.checkPattern(scrollName)) {
                    window.SoundSystem?.play('error');
                    updateStatus(`${spell.name || scrollName}: place stones in the required pattern first.`);
                    return false;
                }

                // Level 1 scrolls can only be used during the response window
                if (spell.level === 1) {
                    window.SoundSystem?.play('error');
                    updateStatus('Level 1 scrolls can only be used as responses.');
                    return false;
                }

                const cost = this.getSpellCost(spell, activePlayerIndex);
                if (!canAfford(cost)) {
                    window.SoundSystem?.play('error');
                    updateStatus(`Not enough AP! Need ${cost} AP to activate.`);
                    return false;
                }

                if (typeof window !== 'undefined' && window.logScrollEvent) {
                    window.logScrollEvent('cast_attempt', {
                        playerIndex: activePlayerIndex,
                        active: activeScrollsList,
                        common: commonAreaScrolls,
                        targeted: scrollName
                    });
                }

                this.executeSpell({ name: scrollName, spell, fromCommonArea: isFromCommonArea });
                return true;
            }

            showSpellSelection(spells) {
                const popup = document.createElement('div');
                Object.assign(popup.style, {
                    position: 'fixed', left: '50%', top: '50%',
                    transform: 'translate(-50%, -50%)',
                    backgroundColor: '#2c3e50', padding: '20px',
                    borderRadius: '10px', boxShadow: '0 0 10px rgba(0,0,0,0.5)',
                    zIndex: '1000', color: 'white', minWidth: '300px'
                });

                const header = document.createElement('div');
                header.style.display = 'flex';
                header.style.alignItems = 'center';
                header.style.justifyContent = 'space-between';
                header.style.marginBottom = '12px';
                const title = document.createElement('h3');
                title.textContent = 'Select Scroll to Activate';
                title.style.textAlign = 'center';
                title.style.margin = '0';
                title.style.flex = '1';
                header.appendChild(title);
                const closeBtn = document.createElement('button');
                closeBtn.textContent = '\u00D7';
                closeBtn.title = 'Close';
                closeBtn.style.cssText = 'background:none;border:none;color:white;font-size:24px;cursor:pointer;line-height:1;padding:0 8px;';
                closeBtn.onclick = () => document.body.removeChild(popup);
                header.appendChild(closeBtn);
                popup.appendChild(header);

                spells.forEach(({name, spell, fromCommonArea}) => {
                    const btn = document.createElement('button');
                    const sourceLabel = fromCommonArea ? ' [Common]' : '';
                    btn.textContent = `${spell.name} (+${spell.level} ${spell.element})${sourceLabel}`;
                    btn.style.width = '100%';
                    btn.style.marginBottom = '10px';
                    if (fromCommonArea) {
                        btn.style.borderLeft = '4px solid #9b59b6'; // Purple border for common area
                    }
                    btn.onclick = () => {
                        document.body.removeChild(popup);
                        this.executeSpell({name, spell, fromCommonArea});
                    };
                    popup.appendChild(btn);
                });

                document.body.appendChild(popup);
            }

            executeSpell({name, spell, fromCommonArea = false}) {
                // Sacrificial Pyre activates a scroll from your hand. With nothing in
                // hand it can use, refuse it before any AP is spent (owner, 2026-10-01:
                // AP was charged and the cast fizzled). Level I scrolls never count
                // here: Pyre can activate them only as a response on another player's
                // turn (owner rule, 2026-10-01).
                if (name === 'FIRE_SCROLL_3') {
                    // Hand or active area (owner, 2026-10-01), never Pyre itself.
                    const ps = this.getPlayerScrolls(false);
                    const usable = [...(ps?.hand || []), ...(ps?.active || [])]
                        .filter(s => s !== 'FIRE_SCROLL_3' && (this.patterns?.[s]?.level ?? 2) !== 1);
                    if (usable.length === 0) {
                        updateStatus('Sacrificial Pyre needs a scroll above Level I in your hand or active area. Level I scrolls can only be activated with it as a response on another player\'s turn. No AP spent.');
                        window.SoundSystem?.play('error');
                        return false;
                    }
                }
                const cost = this.getSpellCost(spell, activePlayerIndex);
                if (!canAfford(cost)) {
                    updateStatus(`Not enough AP! Need ${cost} AP to activate.`);
                    return false;
                }
                // Spend AP first (may be reduced by buffs)
                spendAP(cost);
                // A cast can't be undone, so Undo must not reverse the move or
                // stone before it either (restores the 2026-08-13 fix, 10bbac5,
                // which was lost later: undo fuzz test 2026-10-01).
                clearUndo();
                if (typeof window !== 'undefined' && window.logScrollEvent) {
                    window.logScrollEvent('cast_execute', {
                        playerIndex: activePlayerIndex,
                        scrollName: name,
                        element: spell.element,
                        level: spell.level,
                        cost,
                        fromCommonArea
                    });
                }

                // Tutorial hook — fires when a spell is successfully cast
                if (window.isTutorialMode && window.TutorialMode?.onSpellCast) {
                    window.TutorialMode.onSpellCast(name);
                }

                const scrollData = { name, spell, fromCommonArea, casterIndex: activePlayerIndex };

                // React phase: openResponseWindow itself skips (and resolves the cast
                // immediately) unless an opponent could actually respond or bluff
                const numPlayers = typeof playerPositions !== 'undefined' ? playerPositions.length : 0;
                if (this.responseWindow && numPlayers > 1) {
                    console.log('Opening response window (react phase)');
                    this.responseWindow.openResponseWindow(scrollData, activePlayerIndex, (result) => {
                        this.handleResponseWindowComplete(scrollData, result);
                    });
                    return; // Don't apply effects yet
                }

                // No response window needed - apply effects immediately
                console.log('Response window skipped - no valid responses available');
                this.applyScrollEffects(name, spell, fromCommonArea);
            }

            // Handle the completion of response window
            handleResponseWindowComplete(originalScrollData, result) {
                if (result.skipped) {
                    // No responses - apply original scroll effects
                    this.applyScrollEffects(originalScrollData.name, originalScrollData.spell, originalScrollData.fromCommonArea);
                    return;
                }

                // Process resolved scrolls from the stack
                // The response window already handles the LIFO resolution
                // We just need to check if the original scroll was countered
                const wasCountered = result.responses.some(r =>
                    r.isOriginal && r.result === 'countered'
                );

                if (wasCountered) {
                    updateStatus(`Your ${originalScrollData.spell.name} was countered!`);
                    // Broadcast the counter in multiplayer
                    if (isMultiplayer) {
                        broadcastGameAction('scroll-countered', {
                            scrollName: originalScrollData.name,
                            casterIndex: originalScrollData.casterIndex
                        });
                    }
                    // Still need to handle scroll disposition for countered scroll
                    this.handleScrollDisposition(originalScrollData.name, originalScrollData.fromCommonArea);
                } else {
                    // Original not countered: already applied by scroll-resolved listener when event fired.
                    // Nothing to do here (avoids double-apply).
                }
            }

            // Apply the actual scroll effects (separated from executeSpell for response window support)
            applyScrollEffects(name, spell, fromCommonArea = false) {
                // Sound — play before effects so it feels immediate
                window.SoundSystem?.play('activatescroll');

                // Handle scroll disposition (remove from player and decide where it goes)
                this.handleScrollDisposition(name, fromCommonArea);

                // Save the previous scroll cast (before recording this one) for effects like Sigh of Recollection
                const previousScrollCast = this.scrollEffects ? this.scrollEffects.lastScrollCastThisTurn : null;

                // Track this scroll for Reflect (Water I) effect
                if (this.scrollEffects) {
                    this.scrollEffects.recordScrollCast(name, spell);
                }

                // Check if this scroll has a special effect (Earth scrolls, etc.)
                // Lazy-init: get ScrollEffects from window or global (in case load order / scope hid it at construction)
                if (!this.scrollEffects) {
                    const SE = (typeof window !== 'undefined' && window.ScrollEffects) || (typeof ScrollEffects !== 'undefined' && ScrollEffects);
                    if (SE) {
                        SE.init(this);
                        this.scrollEffects = SE;
                        console.log('Scroll effects system initialized (lazy)');
                    }
                }
                if (this.scrollEffects) {
                    console.log(`📜 Looking up effect for: "${name}", effects keys:`, Object.keys(this.scrollEffects.effects));
                    const effect = this.scrollEffects.getEffect(name);
                    console.log(`📜 getEffect("${name}") returned:`, effect ? effect.name : null);
                    if (effect) {
                        console.log(`📜 Executing special effect for ${name}: ${effect.name}`);
                        // Wrap execute in try/catch so win-condition tracking always runs even if the
                        // effect throws (e.g. DOM error inside enterTransmuteMode or similar)
                        let result = { success: false, requiresSelection: false };
                        try {
                            result = this.scrollEffects.execute(name, activePlayerIndex, { spell, scrollName: name, previousScrollCast }) || result;
                        } catch (execErr) {
                            console.error(`❌ Effect execute threw for "${name}":`, execErr);
                            // Continue below to still track win condition and broadcast
                        }
                        if (typeof window !== 'undefined' && window.logScrollEvent) {
                            window.logScrollEvent('effect_execute', {
                                playerIndex: activePlayerIndex,
                                scrollName: name,
                                effectName: effect.name,
                                success: result?.success,
                                requiresSelection: !!result?.requiresSelection,
                                message: result?.message
                            });
                        }

                        // Refresh all stone count UI after scroll effect (effects may modify pools)
                        ['earth', 'water', 'fire', 'wind', 'void'].forEach(t => updateStoneCount(t));

                        // Track activated element(s) for win condition regardless of effect result
                        // (but skip if the effect was cancelled, e.g. Sacrificial Pyre with empty hand)
                        if (result.cancelled) {
                            console.log(`📜 Effect cancelled - skipping win-condition tracking for ${name}`);
                            return;
                        }
                        // Elements this cast really granted (the source-pool guard below can
                        // skip some). Only these are announced to the other players: they
                        // used to receive the full element list and add it without the
                        // guard (match 43: earth won with an empty earth source).
                        const grantedEls = [];
                        if (spell.element === 'catacomb' && spell.patterns && spell.patterns[0]) {
                            // Catacomb scrolls activate each component element — the same
                            // source-pool guard as regular scrolls applies per component
                            // element (a component whose source is depleted doesn't count).
                            const elements = new Set(spell.patterns[0].map(pos => pos.type));
                            elements.forEach(el => {
                                const elSourcePool = window.stonePools?.[el] ?? 1;
                                if (elSourcePool > 0) {
                                    const ps = this.getPlayerScrolls(false);
                                    const isNew = !ps.activated.has(el);
                                    ps.activated.add(el);
                                    grantedEls.push(el);
                                    if (isNew) window.SoundSystem?.onWinCondition(el);
                                    if (typeof window.gami?.onElementActivated === 'function') {
                                        window.gami.onElementActivated(el, Array.from(this.getPlayerScrolls(false).activated));
                                    }
                                } else {
                                    console.log(`📜 Win condition skipped for ${el} (catacomb component): source pool is empty.`);
                                }
                            });
                        } else {
                            // Source pool guard: if the shared element source pool is fully depleted,
                            // the scroll fires but cannot count toward the win condition — there are
                            // no remaining stones of this element for anyone to use.
                            const elementSourcePool = window.stonePools?.[spell.element] ?? 1;
                            if (elementSourcePool > 0) {
                                const ps = this.getPlayerScrolls(false);
                                const isNew = !ps.activated.has(spell.element);
                                ps.activated.add(spell.element);
                                grantedEls.push(spell.element);
                                if (isNew) window.SoundSystem?.onWinCondition(spell.element);
                                if (typeof window.gami?.onElementActivated === 'function') {
                                    window.gami.onElementActivated(spell.element, Array.from(this.getPlayerScrolls(false).activated));
                                }
                            } else {
                                updateStatus(`The ${spell.element} shrine source is depleted - scroll effect activated, but win condition not met.`);
                                // Normal rules enforcement (empty-source-pool rule), not an anomaly — log, don't warn
                                console.log(`📜 Win condition skipped for ${spell.element}: source pool is empty.`);
                            }
                        }
                        updatePlayerElementSymbols(activePlayerIndex);

                        // Win check BEFORE the requiresSelection early return —
                        // the element is already activated above, and the player
                        // may already be standing on their shrine. (Previously the
                        // early return skipped the win check entirely if the
                        // selection was never completed.)
                        checkWinCondition(activePlayerIndex, { announce: true });

                        // Broadcast the effect in multiplayer. Selection scrolls
                        // (Create, Scholar's Insight, Transmute, ...) send it now
                        // too: the element is already activated on this board,
                        // and several of them never call onSelectionEffectComplete,
                        // so the other players never heard about it (match 5:
                        // Create's void activation was missing on the other board,
                        // found by comparing the replay with its fingerprints).
                        // A later onSelectionEffectComplete repeats it; adding an
                        // element twice is harmless.
                        if (isMultiplayer) {
                            // Only the elements granted above (an empty list = none).
                            broadcastGameAction('scroll-effect', {
                                playerIndex: activePlayerIndex,
                                scrollName: name,
                                effectName: effect.name,
                                element: spell.element,
                                activatedElements: grantedEls
                            });
                            syncPlayerState();
                        }

                        // Win condition already checked above. A selection
                        // effect finishes later (onSelectionEffectComplete).
                        return;
                    } else {
                        console.error(`📜 No effect defined for scroll "${name}": element activated, no other effect. Add its effect in scroll-effects.js.`);
                    }
                } else {
                    console.error(`📜 Scroll effects not available for "${name}": element activated, no other effect. Is js/scrolls/effects/scroll-effects.js loaded?`);
                }

                // No effect found: only activate the element(s). Casting used to
                // give free stones here (an old test rule, removed 2026-10-01 at
                // the owner's request; the stones did not come out of the source).
                if (spell.element === 'catacomb') {
                    const elementCounts = {};
                    spell.patterns[0].forEach(pos => {
                        elementCounts[pos.type] = (elementCounts[pos.type] || 0) + 1;
                    });

                    var defaultGranted = [];
                    Object.keys(elementCounts).forEach(element => {
                        // Track activated element for win condition (for active player):
                        // source pool guard applies per component element here too.
                        const elSourcePool0 = window.stonePools?.[element] ?? 1;
                        if (elSourcePool0 > 0) {
                            const ps0 = this.getPlayerScrolls(false);
                            const isNew0 = !ps0.activated.has(element);
                            ps0.activated.add(element);
                            defaultGranted.push(element);
                            if (isNew0) window.SoundSystem?.onWinCondition(element);
                        } else {
                            console.log(`📜 Win condition skipped for ${element} (catacomb component, default path): source pool is empty.`);
                        }
                    });

                    updatePlayerElementSymbols(activePlayerIndex);
                    updateStatus(`${spell.name || name} activated.`);
                } else {
                    var defaultGranted = [];
                    // Regular element scrolls. Track activated element for win
                    // condition: source pool guard applies here too.
                    const elementSourcePoolDefault = window.stonePools?.[spell.element] ?? 1;
                    if (elementSourcePoolDefault > 0) {
                        const ps1 = this.getPlayerScrolls(false);
                        const isNew1 = !ps1.activated.has(spell.element);
                        ps1.activated.add(spell.element);
                        defaultGranted = [spell.element];
                        if (isNew1) window.SoundSystem?.onWinCondition(spell.element);
                        updateStatus(`${spell.name || name} activated.`);
                    } else {
                        updateStatus(`The ${spell.element} shrine source is depleted - scroll effect activated, but win condition not met.`);
                        // Normal rules enforcement (empty-source-pool rule), not an anomaly — log, don't warn
                        console.log(`📜 Win condition skipped for ${spell.element}: source pool is empty (default path).`);
                    }
                    updatePlayerElementSymbols(activePlayerIndex);
                }

                // Broadcast spell cast in multiplayer
                if (isMultiplayer) {
                    if (spell.element === 'catacomb') {
                        const elementCounts = {};
                        spell.patterns[0].forEach(pos => {
                            elementCounts[pos.type] = (elementCounts[pos.type] || 0) + 1;
                        });
                        broadcastGameAction('spell-cast', {
                            playerIndex: activePlayerIndex,
                            spellName: name,
                            elements: Object.keys(elementCounts),
                            granted: defaultGranted,
                            isCatacomb: true
                        });
                    } else {
                        broadcastGameAction('spell-cast', {
                            playerIndex: activePlayerIndex,
                            spellName: name,
                            element: spell.element,
                            level: spell.level,
                            granted: defaultGranted,
                            isCatacomb: false
                        });
                    }

                    // Sync AP / activated elements after the cast
                    syncPlayerState();
                }

                // Check if THIS player has won (all 5 elements + returned to shrine)
                checkWinCondition(activePlayerIndex, { announce: true });
            }

            // Called by scroll effects when a selection-based effect (e.g. Shifting Sands) is completed
            onSelectionEffectComplete(scrollName, effectName, spell) {
                // Some cast paths (an effect run by another scroll) pass no
                // spell object; look it up by name instead of crashing.
                spell = spell || this.patterns?.[scrollName] || window.SCROLL_DEFINITIONS?.[scrollName];
                if (!spell) return;
                // Update element symbols on player tile
                if (typeof updatePlayerElementSymbols === 'function') {
                    updatePlayerElementSymbols(activePlayerIndex);
                }

                // Gamification hook for element activation via interactive scroll
                if (typeof window.gami?.onElementActivated === 'function') {
                    const activatedEl = (spell.element === 'catacomb' && spell.patterns && spell.patterns[0])
                        ? [...new Set(spell.patterns[0].map(pos => pos.type))]
                        : [spell.element];
                    activatedEl.filter(el => this.getPlayerScrolls(false).activated.has(el)).forEach(el => {
                        window.gami.onElementActivated(el, Array.from(this.getPlayerScrolls(false).activated));
                    });
                }

                if (typeof isMultiplayer !== 'undefined' && isMultiplayer && typeof broadcastGameAction === 'function') {
                    // Only elements the caster really holds now: the cast may have been
                    // refused an element by the empty-source rule in applyScrollEffects.
                    const heldNow = this.getPlayerScrolls(false).activated;
                    const activatedElements = ((spell.element === 'catacomb' && spell.patterns && spell.patterns[0])
                        ? [...new Set(spell.patterns[0].map(pos => pos.type))]
                        : [spell.element]).filter(el => heldNow.has(el));

                    broadcastGameAction('scroll-effect', {
                        playerIndex: activePlayerIndex,
                        scrollName: scrollName,
                        effectName: effectName,
                        element: spell.element,
                        activatedElements: activatedElements
                    });
                    if (typeof syncPlayerState === 'function') syncPlayerState();
                }
                checkWinCondition(activePlayerIndex, { announce: true });
            }

            // Handle scroll disposition after casting
            // Scrolls normally stay in active area after being cast
            // If Unbidden Lamplight was used in response, the scroll goes to common area
            handleScrollDisposition(scrollName, fromCommonArea = false, forceToCommonArea = false) {
                const scrolls = this.getPlayerScrolls(false);

                // Common area scrolls are permanent shared resources — casting them does NOT
                // remove them from the common area. They only leave when replaced by a new scroll
                // of the same element type. So fromCommonArea=true requires no action here.

                // Check if Unbidden Lamplight has marked this scroll to go to caster's hand
                const redirect = this.scrollEffects?.pendingHandRedirect;
                if (redirect && redirect.scrollName === scrollName) {
                    // Remove from the ORIGINAL CASTER's active area
                    const originalCasterIndex = redirect.originalCasterIndex;
                    if (originalCasterIndex !== undefined && this.playerScrolls[originalCasterIndex]) {
                        const originalCasterScrolls = this.playerScrolls[originalCasterIndex];
                        if (originalCasterScrolls.active.has(scrollName)) {
                            originalCasterScrolls.active.delete(scrollName);
                        }
                    } else if (scrolls.active.has(scrollName)) {
                        scrolls.active.delete(scrollName);
                    }

                    // Add to lamplight caster's hand — bypasses hand size limit intentionally
                    const lamplightCasterIndex = redirect.redirectToPlayerIndex;
                    this.ensurePlayerScrollsStructure(lamplightCasterIndex);
                    this.playerScrolls[lamplightCasterIndex].hand.add(scrollName);

                    // Clear the pending redirect
                    this.scrollEffects.pendingHandRedirect = null;

                    // If hand is now over the limit, the end-of-turn overflow banner
                    // makes the player resolve it (no separate cascade popup)
                    const lamplightScrolls = this.playerScrolls[lamplightCasterIndex];
                    if (lamplightScrolls.hand.size > this.MAX_HAND_SIZE) {
                        updateStatus(`Unbidden Lamplight sent "${scrollName}" to your hand - hand is over the limit. Cascade a scroll before ending your turn!`);
                    } else {
                        updateStatus('Unbidden Lamplight sent the scroll to your hand!');
                    }
                } else if (forceToCommonArea) {
                    // Explicit request to send to common area.
                    // Guard: only discard if the scroll is still in active — if Lamplight already
                    // redirected it to hand, the scroll is gone from active and we must not override.
                    if (scrolls.active.has(scrollName)) {
                        scrolls.active.delete(scrollName);
                        this.discardToCommonArea(scrollName);
                    }
                }
                // Otherwise, scroll remains in player's active area - NO auto-discard!

                // Update scroll UI
                this.updateScrollCount();
                updateCommonAreaUI();

                // Broadcast in multiplayer
                if (isMultiplayer) {
                    broadcastGameAction('scroll-used', {
                        playerIndex: activePlayerIndex,
                        scrollName: scrollName,
                        fromCommonArea: fromCommonArea,
                        forceToCommonArea: forceToCommonArea
                    });
                }
            }

            showLevelComplete(playerIndex) {
                // lobby.js's showGameOverToAll() is the authoritative multiplayer
                // win screen (proper Return-to-Lobby room cleanup, shown to every
                // player via broadcast).
                // checkWinCondition() fires THIS function first and
                // handleGameOver()/showGameOverToAll() a moment later on the same
                // client, and both build a fixed, full-screen `.game-over-overlay`
                // — without this early return the second one would render on top
                // and completely cover the first after only a brief flash.
                if (isMultiplayer) return;

                // Guard: only one win overlay at a time
                if (document.querySelector('.game-over-overlay')) return;

                const overlay = document.createElement('div');
                overlay.className = 'game-over-overlay';

                const box = document.createElement('div');
                box.className = 'game-over-box';

                const title = document.createElement('div');
                title.textContent = 'VICTORY';
                title.className = 'game-over-title';
                box.appendChild(title);

                const playerColor = playerPositions[playerIndex]?.color;
                const colorNames = {
                    '#9458f4': 'Purple wins!',
                    '#ffce00': 'Yellow wins!',
                    '#ed1b43': 'Red wins!',
                    '#5894f4': 'Blue wins!',
                    '#69d83a': 'Green wins!'
                };
                const playerName = document.createElement('div');
                playerName.textContent = colorNames[playerColor] || `Player ${playerIndex + 1} wins!`;
                playerName.className = 'game-over-winner';
                playerName.style.color = playerColor || '#d9b08c';
                box.appendChild(playerName);

                const msg = document.createElement('div');
                msg.textContent = 'All five elements mastered - and returned to the shrine!';
                msg.className = 'game-over-msg';
                box.appendChild(msg);

                const elements = document.createElement('div');
                elements.className = 'game-over-elements';
                elements.innerHTML = ['earth','water','fire','wind','void'].map(el =>
                    `<img src="images/${el === 'earth' ? 'mountainsymbol' : el === 'water' ? 'watersymbol' : el === 'fire' ? 'firesymbol' : el === 'wind' ? 'windsymbol' : 'voidsymbol'}.webp" class="element-icon-sm" alt="${el}">`
                ).join(' ');
                box.appendChild(elements);

                const subtitle = document.createElement('div');
                subtitle.textContent = 'The path of balance is complete.';
                subtitle.className = 'game-over-subtitle';
                box.appendChild(subtitle);

                const btnRow = document.createElement('div');
                btnRow.className = 'game-over-btns';

                const closeBtn = document.createElement('button');
                closeBtn.textContent = 'Continue Playing';
                closeBtn.className = 'retro-dlg-btn cancel';
                closeBtn.onclick = () => overlay.remove();
                btnRow.appendChild(closeBtn);

                box.appendChild(btnRow);
                overlay.appendChild(box);
                document.body.appendChild(overlay);
            }

            createPatternVisual(scroll, elementType) {
                const container = document.createElement('div');
                container.style.display = 'flex';
                container.style.justifyContent = 'center';
                container.style.alignItems = 'center';
                container.style.padding = '15px';
                container.style.backgroundColor = '#2c3e50';
                container.style.borderRadius = '5px';
                container.style.marginTop = '10px';
                container.style.position = 'relative';

                // Create SVG
                const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
                svg.setAttribute('width', '200');
                svg.setAttribute('height', '200');
                svg.setAttribute('viewBox', '-100 -100 200 200');

                const hexSize = 15;

                // Helper to create hex points
                const createHexPoints = (cx, cy, size) => {
                    const points = [];
                    for (let i = 0; i < 6; i++) {
                        const angle = (Math.PI / 3) * i - Math.PI / 6;
                        points.push(`${cx + size * Math.cos(angle)},${cy + size * Math.sin(angle)}`);
                    }
                    return points.join(' ');
                };

                // Helper to convert axial to pixel
                const axialToPixel = (q, r) => {
                    const x = hexSize * (Math.sqrt(3) * q + Math.sqrt(3)/2 * r);
                    const y = hexSize * (3/2 * r);
                    return { x, y };
                };

                // Draw background hexes in a grid (static layer)
                const backgroundGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
                for (let q = -2; q <= 2; q++) {
                    for (let r = -2; r <= 2; r++) {
                        if (Math.abs(q + r) <= 2) {
                            const pos = axialToPixel(q, r);
                            const hex = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
                            hex.setAttribute('points', createHexPoints(pos.x, pos.y, hexSize));
                            hex.setAttribute('fill', '#34495e');
                            hex.setAttribute('stroke', '#2c3e50');
                            hex.setAttribute('stroke-width', '2');
                            backgroundGroup.appendChild(hex);
                        }
                    }
                }
                svg.appendChild(backgroundGroup);

                // Draw player hex (static layer)
                const playerHex = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
                playerHex.setAttribute('cx', '0');
                playerHex.setAttribute('cy', '0');
                playerHex.setAttribute('r', hexSize * 0.5);
                playerHex.setAttribute('fill', '#fff');
                playerHex.setAttribute('stroke', '#333');
                playerHex.setAttribute('stroke-width', '2');
                svg.appendChild(playerHex);

                // Create pattern groups for each variation (animated layers)
                const patternGroups = [];
                scroll.patterns.forEach((patternVariation, idx) => {
                    const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
                    group.style.opacity = idx === 0 ? '1' : '0';
                    group.style.transition = 'opacity 0.5s ease-in-out';

                    patternVariation.forEach(pos => {
                        const pixelPos = axialToPixel(pos.q, pos.r);
                        const stoneHex = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
                        stoneHex.setAttribute('points', createHexPoints(pixelPos.x, pixelPos.y, hexSize));
                        // Use pos.type if available (for catacomb multi-element), otherwise use elementType
                        const stoneType = pos.type || elementType;
                        stoneHex.setAttribute('fill', darkenHex(STONE_TYPES[stoneType].color, 0.55));
                        stoneHex.setAttribute('stroke', STONE_TYPES[stoneType].color);
                        stoneHex.setAttribute('stroke-width', '1.5');
                        group.appendChild(stoneHex);

                        // Add element image
                        const symbol = document.createElementNS('http://www.w3.org/2000/svg', 'image');
                        symbol.setAttribute('href', STONE_TYPES[stoneType].img);
                        symbol.setAttribute('x', pixelPos.x - hexSize);
                        symbol.setAttribute('y', pixelPos.y - hexSize);
                        symbol.setAttribute('width', hexSize * 2);
                        symbol.setAttribute('height', hexSize * 2);
                        // No opacity reduction — symbol renders at full strength
                        group.appendChild(symbol);
                    });

                    patternGroups.push(group);
                    svg.appendChild(group);
                });

                // Add pattern indicator text
                const indicatorText = document.createElement('div');
                indicatorText.style.position = 'absolute';
                indicatorText.style.bottom = '5px';
                indicatorText.style.right = '10px';
                indicatorText.style.fontSize = '11px';
                indicatorText.style.color = '#95a5a6';
                indicatorText.style.fontStyle = 'italic';
                indicatorText.textContent = `Pattern 1/${patternGroups.length}`;
                container.appendChild(indicatorText);

                // Cycle through patterns
                let currentPatternIdx = 0;
                let detachedTicks = 0;
                const cycleInterval = setInterval(() => {
                    // Panels re-render often and drop old cards. Stop once this
                    // card has been off the page for two ticks, or the timers
                    // pile up (one per render) and keep old cards in memory.
                    if (!container.isConnected) {
                        if (++detachedTicks >= 2) clearInterval(cycleInterval);
                        return;
                    }
                    detachedTicks = 0;
                    // Fade out current
                    patternGroups[currentPatternIdx].style.opacity = '0';
                    
                    // Move to next
                    currentPatternIdx = (currentPatternIdx + 1) % patternGroups.length;
                    
                    // Fade in next
                    patternGroups[currentPatternIdx].style.opacity = '1';
                    
                    // Update indicator
                    indicatorText.textContent = `Pattern ${currentPatternIdx + 1}/${patternGroups.length}`;
                }, 2500); // Change pattern every 2.5 seconds

                // Store interval ID so we can clean it up if needed
                container.dataset.intervalId = cycleInterval;

                container.appendChild(svg);
                return container;
            }

            showInventory() {
                // Remove any existing inventory popup so we don't stack them
                const existingPopup = document.getElementById('scroll-inventory-popup');
                if (existingPopup) existingPopup.remove();

                const popup = document.createElement('div');
                popup.id = 'scroll-inventory-popup'; // used by Transmute to refresh this popup
                Object.assign(popup.style, {
                    position: 'fixed', left: '50%', top: '50%',
                    transform: 'translate(-50%, -50%)',
                    zIndex: '1001', minWidth: '450px', maxWidth: '600px', maxHeight: '80vh',
                    overflowY: 'auto'
                });

                const title = document.createElement('h2');
                title.textContent = 'Scroll Inventory';
                title.className = 'si-title';
                title.style.color = '#3498db';
                popup.appendChild(title);

                const subtitle = document.createElement('div');
                subtitle.textContent = `Hand: ${this.handScrolls.size}/${this.MAX_HAND_SIZE} | Active: ${this.activeScrolls.size}/${this.MAX_ACTIVE_SIZE}`;
                subtitle.className = 'si-subtitle';
                popup.appendChild(subtitle);

                const closeBtn = document.createElement('button');
                closeBtn.textContent = '×';
                closeBtn.className = 'si-close';
                closeBtn.onclick = () => document.body.removeChild(popup);
                popup.appendChild(closeBtn);

                const self = this;

                // Helper to create a scroll card with move button
                const createScrollCard = (scrollName, scroll, element, location) => {
                    const scrollDiv = document.createElement('div');
                    scrollDiv.className = 'si-card' + (location === 'active' ? ' si-card-active' : '');

                    const headerRow = document.createElement('div');
                    headerRow.className = 'si-card-header';

                    const nameDiv = document.createElement('div');
                    nameDiv.textContent = scroll.name;
                    nameDiv.className = 'si-card-name';
                    headerRow.appendChild(nameDiv);

                    const canModify = !isMultiplayer || (myPlayerIndex === activePlayerIndex);
                    if (canModify) {
                        if (location === 'hand') {
                            const moveBtn = document.createElement('button');
                            moveBtn.textContent = 'To Active';
                            moveBtn.className = 'si-btn si-btn-active-area';
                            moveBtn.onclick = () => {
                                self.moveToActive(scrollName);
                                document.body.removeChild(popup);
                                self.showInventory();
                            };
                            headerRow.appendChild(moveBtn);
                        }

                        const discardBtn = document.createElement('button');
                        discardBtn.textContent = 'To Common';
                        discardBtn.className = 'si-btn si-btn-common';
                        discardBtn.onclick = () => {
                            self.discardScroll(scrollName);
                            document.body.removeChild(popup);
                            self.showInventory();
                        };
                        headerRow.appendChild(discardBtn);
                    }

                    scrollDiv.appendChild(headerRow);

                    const scrollDesc = document.createElement('div');
                    scrollDesc.textContent = scroll.description;
                    scrollDesc.className = 'si-card-desc';
                    scrollDiv.appendChild(scrollDesc);

                    const patternVisual = this.createPatternVisual(scroll, element);
                    scrollDiv.appendChild(patternVisual);

                    const patternInfo = document.createElement('div');
                    patternInfo.className = 'si-pattern-box';

                    const patternTitle = document.createElement('div');
                    patternTitle.textContent = 'Required Pattern (one of these):';
                    patternTitle.className = 'si-pattern-title';
                    patternInfo.appendChild(patternTitle);

                    const isCatacomb = element === 'catacomb';
                    scroll.patterns.slice(0, 3).forEach((pattern, idx) => {
                        const patternLine = document.createElement('div');
                        const coords = isCatacomb
                            ? pattern.map(pos => `${pos.type.charAt(0).toUpperCase()}(${pos.q},${pos.r})`).join(' + ')
                            : pattern.map(pos => `(${pos.q},${pos.r})`).join(' + ');
                        patternLine.textContent = `${idx + 1}. Stones at: ${coords}`;
                        patternLine.className = 'si-pattern-line';
                        patternInfo.appendChild(patternLine);
                    });

                    if (scroll.patterns.length > 3) {
                        const moreText = document.createElement('div');
                        moreText.textContent = `... and ${scroll.patterns.length - 3} more rotations`;
                        moreText.className = 'si-pattern-more';
                        patternInfo.appendChild(moreText);
                    }

                    scrollDiv.appendChild(patternInfo);
                    return scrollDiv;
                };

                // ACTIVE AREA SECTION
                const activeSection = document.createElement('div');
                activeSection.className = 'si-section si-active';

                const activeHeader = document.createElement('h3');
                activeHeader.textContent = `Active Area (${this.activeScrolls.size}/${this.MAX_ACTIVE_SIZE}) - Visible to opponents`;
                activeHeader.className = 'si-section-header';
                activeSection.appendChild(activeHeader);

                const activeScrollsList = Array.from(this.activeScrolls);
                if (activeScrollsList.length === 0) {
                    const emptyMsg = document.createElement('div');
                    emptyMsg.textContent = 'No scrolls in active area. Move scrolls here to prepare for activation.';
                    emptyMsg.className = 'si-empty';
                    activeSection.appendChild(emptyMsg);
                } else {
                    activeScrollsList.forEach(scrollName => {
                        const scroll = this.patterns[scrollName];
                        const element = this.getScrollElement(scrollName);
                        activeSection.appendChild(createScrollCard(scrollName, scroll, element, 'active'));
                    });
                }
                popup.appendChild(activeSection);

                // COMMON AREA SECTION
                const commonSection = document.createElement('div');
                commonSection.className = 'si-section si-common';

                const commonAreaScrolls = this.getCommonAreaScrolls();
                const commonHeader = document.createElement('h3');
                commonHeader.textContent = `Common Area (${commonAreaScrolls.length}/6) - Shared`;
                commonHeader.className = 'si-section-header';
                commonSection.appendChild(commonHeader);

                const commonSubtitle = document.createElement('div');
                commonSubtitle.textContent = 'Discarded scrolls go here. Any player can activate these on their turn.';
                commonSubtitle.className = 'si-common-note';
                commonSection.appendChild(commonSubtitle);

                if (commonAreaScrolls.length === 0) {
                    const emptyMsg = document.createElement('div');
                    emptyMsg.textContent = 'No scrolls in common area yet. Discarded scrolls will appear here.';
                    emptyMsg.className = 'si-empty';
                    commonSection.appendChild(emptyMsg);
                } else {
                    const elementTypes = ['earth', 'water', 'fire', 'wind', 'void', 'catacomb'];
                    elementTypes.forEach(element => {
                        if (this.commonArea[element]) {
                            const scrollName = this.commonArea[element];
                            const scroll = this.patterns[scrollName];

                            const scrollDiv = document.createElement('div');
                            scrollDiv.className = 'si-common-item';

                            const color = STONE_TYPES[element].color;
                            const iconHTML = window.ScrollLook.iconHtml(element, 'element-icon-sm', 'vertical-align:middle;');

                            const nameDiv = document.createElement('div');
                            nameDiv.innerHTML = `<span style="color:${color}">${iconHTML}</span> ${scroll.name}`;
                            nameDiv.className = 'si-common-item-name';
                            scrollDiv.appendChild(nameDiv);

                            const descDiv = document.createElement('div');
                            descDiv.textContent = scroll.description;
                            descDiv.className = 'si-common-item-desc';
                            scrollDiv.appendChild(descDiv);

                            if (scroll.patterns) {
                                const patternVisual = this.createPatternVisual(scroll, element);
                                scrollDiv.appendChild(patternVisual);
                            }

                            commonSection.appendChild(scrollDiv);
                        }
                    });
                }
                popup.appendChild(commonSection);

                // HAND SECTION
                const handSection = document.createElement('div');
                handSection.className = 'si-section si-hand';

                const handHeader = document.createElement('h3');
                handHeader.textContent = `Hand (${this.handScrolls.size}/${this.MAX_HAND_SIZE}) - Private`;
                handHeader.className = 'si-section-header';
                handSection.appendChild(handHeader);

                const handScrollsList = Array.from(this.handScrolls);
                if (handScrollsList.length === 0) {
                    const emptyMsg = document.createElement('div');
                    emptyMsg.textContent = 'No scrolls in hand. Reveal shrine tiles to collect scrolls!';
                    emptyMsg.className = 'si-empty';
                    handSection.appendChild(emptyMsg);
                } else {
                    const elementTypes = ['earth', 'water', 'fire', 'wind', 'void', 'catacomb'];
                    elementTypes.forEach(element => {
                        const elementScrolls = handScrollsList.filter(s => this.getScrollElement(s) === element);
                        if (elementScrolls.length > 0) {
                            const elementLabel = document.createElement('div');
                            const color = STONE_TYPES[element].color;
                            const iconHTML = window.ScrollLook.iconHtml(element, 'element-icon-sm', 'vertical-align:middle;');
                            elementLabel.innerHTML = `<span style="color:${color}">${iconHTML} ${element.charAt(0).toUpperCase() + element.slice(1)}</span>`;
                            elementLabel.className = 'si-element-label';
                            handSection.appendChild(elementLabel);

                            elementScrolls.forEach(scrollName => {
                                const scroll = this.patterns[scrollName];
                                handSection.appendChild(createScrollCard(scrollName, scroll, element, 'hand'));
                            });
                        }
                    });
                }
                popup.appendChild(handSection);

                const infoText = document.createElement('div');
                infoText.innerHTML = '<strong>Tip:</strong> Move scrolls from Hand to Active Area (0 AP) to prepare for activating. Scrolls in Active Area stay there after activating. Scrolls cannot be moved back to Hand - discard to Common Area instead. Common Area scrolls are shared (max 1 per element).';
                infoText.className = 'si-tip';
                popup.appendChild(infoText);

                document.body.appendChild(popup);
            }

            updateScrollCount() {
                const total = this.handScrolls.size + this.activeScrolls.size;
                const scrollCountEl = document.getElementById('scroll-count');
                if (scrollCountEl) scrollCountEl.textContent = total;

                // Update HUD (safely - may not be ready during initialization)
                try {
                    if (typeof updateHUD === 'function') updateHUD();
                } catch (e) {
                    // Ignore - HUD not ready yet
                }

                // Update scroll deck UI (safely)
                try {
                    if (typeof updateScrollDeckUI === 'function') updateScrollDeckUI();
                } catch (e) {
                    // Ignore - UI not ready yet
                }

                // Refresh floating scroll panels so new scrolls appear immediately
                try {
                    if (window.ScrollPanelSystem) window.ScrollPanelSystem.refresh();
                } catch (e) {}
                // ...and the Opponent Status panel (your own card's hand count)
                try { window.scheduleOpponentPanelRefresh?.(); } catch (e) {}
            }
        }

        function toRoman(num) {
            const map = { 1: 'I', 2: 'II', 3: 'III', 4: 'IV', 5: 'V' };
            return map[num] || num;
        }

        // Core game state - declare these FIRST
        let placedTiles = [];
        let placedStones = [];
        let playerPositions = []; // Array of {x, y, element, color} for each player
        let activePlayerIndex = 0; // Which player is currently active
        
        // Player pools - one per player
        let playerPools = []; // Each entry is player's stone pool (for testing: start with 5 of each)
        const playerPoolCapacity = { earth: 5, water: 5, fire: 5, wind: 5, void: 5 };
        const INITIAL_PLAYER_STONES = { earth: 0, water: 0, fire: 0, wind: 0, void: 0 };

        // Elemental source pool - stones available from shrines (max 25 each)
        const sourcePool = { earth: 20, water: 20, fire: 20, wind: 20, void: 20 };
        const sourcePoolCapacity = { earth: 25, water: 25, fire: 25, wind: 25, void: 25 };

        // Initialize spell system (after activePlayerIndex is defined)
        const spellSystem = new SpellSystem();

        // Compatibility: playerPool and stoneCounts refer to active player's pool
        // In multiplayer, playerPool shows MY pool (for display), but operations use activePlayerIndex
        Object.defineProperty(window, 'playerPool', {
            get() {
                // In multiplayer, show my own pool in the UI
                const displayIndex = (isMultiplayer && myPlayerIndex !== null) ? myPlayerIndex : activePlayerIndex;
                if (!playerPools[displayIndex]) {
                    playerPools[displayIndex] = { ...INITIAL_PLAYER_STONES };
                }
                return playerPools[displayIndex];
            }
        });
        Object.defineProperty(window, 'stoneCounts', {
            get() {
                // In multiplayer, show my own pool in the UI
                const displayIndex = (isMultiplayer && myPlayerIndex !== null) ? myPlayerIndex : activePlayerIndex;
                if (!playerPools[displayIndex]) {
                    playerPools[displayIndex] = { ...INITIAL_PLAYER_STONES };
                }
                return playerPools[displayIndex];
            }
        });
        const stoneCapacity = playerPoolCapacity;

        // Expose sourcePool as stonePools for scroll effects system
        window.stonePools = sourcePool;
        // Expose playerPools so scroll effects (e.g. Arson) can read opponent pools
        window.playerPools = playerPools;

        const boardSvg = document.getElementById('boardSvg');
        // Improve mobile interactions: prevent browser gestures from stealing touches
        boardSvg.style.touchAction = 'none';
        const viewport = document.getElementById('viewport');
        const deckTileSvg = document.getElementById('deckTile');
        const snapIndicator = document.getElementById('snapIndicator');
        
        // Compatibility: make playerPosition work as before for active player
        Object.defineProperty(window, 'playerPosition', {
            get() { return playerPositions[activePlayerIndex] || null; },
            set(val) { 
                if (val === null) {
                    playerPositions = [];
                    activePlayerIndex = 0;
                }
            }
        });
        
        let playerColor = null; // Current player's color (when placing their tile)
        let gameSessionColors = new Set(); // Colors used in the current game
        let currentAP = 5;
        let voidAP = 0; // Bonus AP from void stones (used first)
        // lastMove — one-step undo state.  shape depends on .type:
        //   'move'        : { type, prevPos, prevCurrentAP, prevVoidAP }
        //   'stone-place' : { type, stoneId, x, y, element }
        //   'stone-break' : { type, x, y, element, prevCurrentAP, prevVoidAP }
        let lastMove = null;
        // Clear the one-step undo. Call it after anything Undo must not reach
        // back across: a cast, a teleport, a tile reveal (the Undo button
        // would otherwise reverse the action BEFORE it, with a free refund).
        function clearUndo() { lastMove = null; window.lastScrollAction = null; }
        window.clearUndo = clearUndo;
        // For scroll moves (scroll-panels.js): a scroll move replaces any
        // pawn/stone undo. lastMove is a script-scope let, so
        // `window.lastMove = null` there never reached it.
        window.clearPawnUndo = () => { lastMove = null; };

        // Track each player's AP for multiplayer display
        let playerAPs = []; // Each entry is { currentAP: 5, voidAP: 0 }

        // Track player activity for timeout/kick system
        let playerLastActivity = {}; // { playerId: timestamp }
        let activityCheckInterval = null;
        // Host's locally-tracked copy of game_room.status, kept fresh by lobby.js's
        // gameRoomSubscription postgres_changes handler (fires on every status
        // change from any source, including other clients/RPCs). checkTurnTimeout()
        // below reads this instead of querying the DB every second — see its comment.
        let hostTrackedRoomStatus = 'waiting';
        let gameInactivityTimeout = 120000;
        // Turn timer settings (reuses gameInactivityTimeout as the turn time limit, in ms)
        let kickOnTurnTimeout = true;
        let turnStartedAtMs = window.serverNow(); // server time (multiplayer-state.js serverNow)
        let turnTimeoutInterval = null;
        let turnSyncInterval = null; // Host's periodic turn sync broadcast
        let commonAreaSyncInterval = null; // Host's periodic common area sync broadcast
 // Default 2 minutes in milliseconds (set by host)
        let myLastActivity = Date.now(); // Track my own activity
        let timerDisplayInterval = null;

        const PLAYER_COLORS = {
            green: '#69d83a',
            blue: '#5894f4',
            red: '#ed1b43',
            yellow: '#ffce00',
            purple: '#9458f4'
        };

        // Mobile detection and touch support
        let isMobile = false;
        let mobileUIInitialized = false;
        function computeIsMobile() {
            return (/Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)
                || window.matchMedia('(max-width: 768px)').matches
                || (navigator.maxTouchPoints && navigator.maxTouchPoints > 0)
                || window.matchMedia('(pointer: coarse)').matches);
        }
        function updateIsMobile() {
            const next = computeIsMobile();
            if (next === isMobile && mobileUIInitialized) return;
            isMobile = next;

            // Initialize mobile UI once when we enter mobile mode
            if (isMobile && !mobileUIInitialized) {
                initializeMobileUI();
                mobileUIInitialized = true;
            }

            // Keep mobile decks in sync if mobile is active
            if (isMobile) {
                syncMobileTileDeck();
                syncMobileStoneDeck();
            }
        }

        // Touch state for gestures
        let touchStartTime = 0;
        let touchStartPos = { x: 0, y: 0 };
        let initialTouches = [];
        let initialRotation = 0;
        let isGestureRotating = false;
        let isPinching = false;
        let pinchStartDist = 0;
        let pinchStartScale = 1;
        let pinchStartMid = { x: 0, y: 0 };
        let pinchLastMid = { x: 0, y: 0 };
        let stoneLongPressTimer = null; // for long-press stone break on mobile

        // Helper function to get event coordinates (works for both mouse and touch)
        function getEventCoords(e) {
            if (e.touches && e.touches.length > 0) {
                return { x: e.touches[0].clientX, y: e.touches[0].clientY };
            }
            return { x: e.clientX, y: e.clientY };
        }

        // Calculate angle between two touch points
        function getTouchAngle(touch1, touch2) {
            const dx = touch2.clientX - touch1.clientX;
            const dy = touch2.clientY - touch1.clientY;
            return Math.atan2(dy, dx) * (180 / Math.PI);
        }

        // Snap angle to nearest 60 degrees (6 positions for hexagon)
        function snapToHexRotation(degrees) {
            const step = 60;
            return Math.round(degrees / step) % 6;
        }

        function updateVoidAP() {
            // Void AP display only — does NOT increase voidAP beyond current value.
            // New void stones load as "spent" so they don't grant extra AP mid-turn.
            // voidAP can only decrease here (if stones were lost/broken).
            const oldVoidAP = voidAP;
            const poolVoid = playerPool.void;
            if (voidAP > poolVoid) {
                // Stones were lost — clamp voidAP down
                voidAP = poolVoid;
            }
            // Otherwise leave voidAP as-is (new stones are "spent" until next turn)
            console.log(`📄 updateVoidAP: ${oldVoidAP} → ${voidAP} (pool=${poolVoid})`);
            const display = document.getElementById('void-ap-display');
            if (display) {
                if (voidAP > 0) {
                    display.textContent = `(+${voidAP} Void AP)`;
                    display.style.display = 'inline';
                } else {
                    display.style.display = 'none';
                }
            }

            // Update HUD
            if (typeof updateHUD === 'function') updateHUD();
        }

        // Refresh void AP to match pool — called only at turn start
        function refreshVoidAP() {
            voidAP = playerPool.void;
            console.log(`🔄 refreshVoidAP: voidAP set to ${voidAP} (pool=${playerPool.void})`);
            const display = document.getElementById('void-ap-display');
            if (display) {
                if (voidAP > 0) {
                    display.textContent = `(+${voidAP} Void AP)`;
                    display.style.display = 'inline';
                } else {
                    display.style.display = 'none';
                }
            }
            if (typeof updateHUD === 'function') updateHUD();
        }

        function getTotalAP() {
            return currentAP + voidAP;
        }

        function spendAP(cost) {
            console.log(`⚡ spendAP called: cost=${cost}, before: voidAP=${voidAP}, currentAP=${currentAP}`);
            // Spend void AP first, then regular AP
            if (voidAP >= cost) {
                voidAP -= cost;
            } else {
                const remainingCost = cost - voidAP;
                voidAP = 0;
                currentAP = Math.max(0, currentAP - remainingCost); // clamp — never go negative
            }
            console.log(`⚡ spendAP after: voidAP=${voidAP}, currentAP=${currentAP}, total=${getTotalAP()}`);
            const apCountEl = document.getElementById('ap-count');
            if (apCountEl) apCountEl.textContent = currentAP;

            // Update void AP display (but don't reset from pool - that would undo the spend!)
            const display = document.getElementById('void-ap-display');
            if (display) {
                if (voidAP > 0) {
                    display.textContent = `(+${voidAP} Void AP)`;
                    display.style.display = 'inline';
                } else {
                    display.style.display = 'none';
                }
            }

            // Update HUD
            if (typeof updateHUD === 'function') updateHUD();

            // Sync AP state in multiplayer
            syncPlayerState();

            // Prompt to end turn if out of AP (only on active player's turn)
            try {
                const canPrompt = (typeof isMyTurn === 'function') ? isMyTurn() : true;
                if (canPrompt && (typeof isPlacementPhase === 'undefined' || !isPlacementPhase) && getTotalAP() === 0) {
                    if (typeof window !== 'undefined' && typeof window.showEndTurnPrompt === 'function') {
                        window.showEndTurnPrompt();
                    }
                }
            } catch (e) {}
        }

        function addAP(amount) {
            if (amount <= 0) return;
            const maxAP = 5;
            const roomInCurrent = maxAP - currentAP;
            const addToCurrent = Math.min(amount, roomInCurrent);
            currentAP += addToCurrent;
            const overflow = amount - addToCurrent;
            // Overflow can only recharge void AP if the player has void stones (void AP cap = playerPool.void)
            if (overflow > 0 && typeof playerPool !== 'undefined' && playerPool.void > 0) {
                const maxVoidAP = playerPool.void;
                const addToVoid = Math.min(overflow, maxVoidAP - voidAP);
                if (addToVoid > 0) voidAP += addToVoid;
            }
            const apCountEl = document.getElementById('ap-count');
            if (apCountEl) apCountEl.textContent = currentAP;
            const voidDisplay = document.getElementById('void-ap-display');
            if (voidDisplay) {
                if (voidAP > 0) {
                    voidDisplay.textContent = `(+${voidAP} Void AP)`;
                    voidDisplay.style.display = 'inline';
                } else {
                    voidDisplay.style.display = 'none';
                }
            }
            if (typeof updateHUD === 'function') updateHUD();
            if (typeof syncPlayerState === 'function') syncPlayerState();
        }
        if (typeof window !== 'undefined') window.addAP = addAP;

        function canAfford(cost) {
            return getTotalAP() >= cost;
        }

        function attemptBreakStone(stoneId) {
            // Mid-transit across a stone — must move off before acting (see
            // isPlayerRestingOnStone).
            if (typeof isPlayerRestingOnStone === 'function' && isPlayerRestingOnStone(activePlayerIndex)) {
                updateStatus('Cannot break a stone while standing on a stone - move to an empty hex first.');
                window.SoundSystem?.play('error');
                return;
            }
            // In multiplayer, only the active player can break stones
            if (typeof isMultiplayer !== 'undefined' && isMultiplayer &&
                typeof myPlayerIndex !== 'undefined' && myPlayerIndex !== null &&
                myPlayerIndex !== activePlayerIndex) {
                updateStatus("It's not your turn!");
                window.SoundSystem?.play('error');
                return;
            }

            const stone = placedStones.find(s => s.id === stoneId);
            if (!stone) {
                console.log('❌ Stone not found');
                return;
            }

            console.log(`🔨 attemptBreakStone called for stone id=${stoneId}, type=${stone.type}, position=(${stone.x.toFixed(1)}, ${stone.y.toFixed(1)})`);

            // Check if stone is adjacent to player
            if (!playerPosition) {
                updateStatus('No player on board!');
                console.log('❌ No player on board!');
                return;
            }

            const isAdj = isAdjacentToPlayer(stone.x, stone.y);
            console.log(`🔨 Adjacency check: ${isAdj}`);
            
            if (!isAdj) {
                updateStatus('Stone must be adjacent to player to break!');
                console.log('❌ Stone must be adjacent to player to break!');
                return;
            }

            // Calculate break cost based on stone rank
            const STONE_RANK = {
                'void': 1,
                'wind': 2,
                'fire': 3,
                'water': 4,
                'earth': 5
            };

            const breakCost = STONE_RANK[stone.type];

            if (!canAfford(breakCost)) {
                updateStatus(`Not enough AP! Need ${breakCost} AP to break ${stone.type} stone (have ${getTotalAP()} AP)`);
                return;
            }

            // Snapshot undo state before spending AP / removing stone
            lastMove = {
                type: 'stone-break',
                stoneId: stone.id,
                x: stone.x,
                y: stone.y,
                element: stone.type,
                prevCurrentAP: currentAP,
                prevVoidAP: voidAP,
                // Every other stone on the board before the break: breaking one
                // can set off others (break a void stone and the fire next to it
                // destroys a wind stone). Undo puts back any of these that are
                // gone (owner 2026-10-08).
                stonesBefore: placedStones.filter(s => s.id !== stone.id).map(s => ({ x: s.x, y: s.y, type: s.type }))
            };
            window.lastScrollAction = null; // a stone-break supersedes any pending scroll undo

            // Break the stone
            window.SoundSystem?.play('breakstone');
            spendAP(breakCost);

            // Broadcast stone break to other players (with its position: stone ids
            // are counted separately on every board)
            if (isMultiplayer) {
                broadcastGameAction('stone-break', {
                    stoneId: stoneId,
                    x: stone.x,
                    y: stone.y
                });
            }

            // Remove stone from board (crack-and-shatter animation: js/piece-3d.js)
            const stoneElement = stone.element;
            if (stoneElement && stoneElement.parentNode) {
                window.playStoneBreak?.(stoneElement);
                stoneElement.remove();
            }

            // Remove from placedStones array
            const index = placedStones.findIndex(s => s.id === stoneId);
            if (index !== -1) {
                placedStones.splice(index, 1);
            }

            // Tutorial hook — fires after stone confirmed removed
            if (window.isTutorialMode && window.TutorialMode?.onStoneBroken) {
                window.TutorialMode.onStoneBroken(stone.type, stone.x, stone.y);
            }

            // Return stone to source pool
            returnStoneToPool(stone.type);

            // Update interactions since a stone was removed
            updateTileClasses();
            recheckAllStoneInteractions();
            updateAllWaterStoneVisuals();
            updateAllVoidNullificationVisuals();

            // Bot diplomacy reads this as "this player broke a stone" (js/bot-diplomacy.js HARM_CAUSES)
            window.ActionLog?.record('breakStone', { x: +stone.x.toFixed(1), y: +stone.y.toFixed(1), stoneType: stone.type });
            updateStatus(`Broke ${stone.type} stone! Cost: ${breakCost} AP (${getTotalAP()} AP remaining)`);
            console.log(`🔨 Broke ${stone.type} stone (id=${stoneId}), cost=${breakCost} AP`);
        }

        let isDraggingTile = false;
        let isDraggingStone = false;
        let draggedTileId = null;
        let draggedTileRotation = 0;
        let draggedTileFlipped = false;
        let draggedTileShrineType = null;
        let draggedTileOriginalPos = null; // Store original position for snap-back
        let draggedStoneId = null;
        let draggedStoneType = null;
        let draggedStoneOriginalPos = null; // Store original position for stone move
        let ghostTile = null;
        let ghostStone = null;
        let currentRotation = 0;
        let currentFlipped = true; // Start with tiles hidden (flipped)
        let tileMoveMode = false; // Tiles are locked by default

        // Telekinesis state — set by Void Scroll III to track tile moves
        // { active: true, movesLeft: 3, maxMoves: 3, casterIndex: N, movedTiles: [] }
        window.telekinesisState = null;


        // Tile deck - 4 of each shrine type (24 tiles total for 1 player)
        let tileDeck = [];
        let deckIndex = 0;
        let deckSeed = null; // Shared seed for multiplayer deck synchronization

        // Player tile deck
        let playerTilesAvailable = 0;
        let playerTileElements = [];

        // Seeded random number generator (Mulberry32)
        // This ensures all players get the same shuffle with the same seed
        function seededRandom(seed) {
            return function() {
                let t = seed += 0x6D2B79F5;
                t = Math.imul(t ^ t >>> 15, t | 1);
                t ^= t + Math.imul(t ^ t >>> 7, t | 61);
                return ((t ^ t >>> 14) >>> 0) / 4294967296;
            };
        }

        // scarceTiles defaults true — it's the only mode now, no UI toggle left
        // (see hostStartGame()/startGame() in lobby.js).
        function initializeDeck(numPlayers = 1, seed = null, scarceTiles = true) {
            // Tutorial mode: use a fixed deck order so earth lands at the center position
            if (window.tutorialDeckOverride) {
                tileDeck = [...window.tutorialDeckOverride];
                window.tutorialDeckOverride = null;
                deckIndex = 0;
                const countEl = document.getElementById('deck-count');
                if (countEl) countEl.textContent = `0/${tileDeck.length}`;
                console.log('🎓 Tutorial deck applied:', tileDeck.join(', '));
                return;
            }

            const shrineTypes = ['earth', 'water', 'fire', 'wind', 'void', 'catacomb'];
            // Scarce Tiles mode: N-1 of each type instead of N, so not everyone
            // can end up with one of every element. Clamped to 1 so a 1-player
            // game never generates an empty deck.
            const tilesPerType = scarceTiles ? Math.max(1, numPlayers - 1) : numPlayers;

            tileDeck = [];

            shrineTypes.forEach(type => {
                for (let i = 0; i < tilesPerType; i++) {
                    tileDeck.push(type);
                }
            });

            // Use seeded shuffle if seed provided (multiplayer), otherwise random
            if (seed !== null) {
                deckSeed = seed;
                const rng = seededRandom(seed);
                // Seeded Fisher-Yates shuffle
                for (let i = tileDeck.length - 1; i > 0; i--) {
                    const j = Math.floor(rng() * (i + 1));
                    [tileDeck[i], tileDeck[j]] = [tileDeck[j], tileDeck[i]];
                }
                console.log(`🎴 Deck initialized with seed ${seed}:`, tileDeck.join(', '));
            } else {
                // Random shuffle for single player
                for (let i = tileDeck.length - 1; i > 0; i--) {
                    const j = Math.floor(Math.random() * (i + 1));
                    [tileDeck[i], tileDeck[j]] = [tileDeck[j], tileDeck[i]];
                }
                console.log(`🎴 Deck initialized (random):`, tileDeck.join(', '));
            }

            deckIndex = 0;
        }

        function drawNextTileFromDeck() {
            if (deckIndex >= tileDeck.length) {
                updateStatus('No more tiles in deck!');
                return null;
            }
            const shrineType = tileDeck[deckIndex];
            deckIndex++;
            document.getElementById('deck-count').textContent = `${deckIndex}/${tileDeck.length}`;
            updateStatus(`Drew ${shrineType} tile (${deckIndex}/${tileDeck.length} used)`);
            return shrineType;
        }

        let viewportX = 0;
        let viewportY = 0;
        let viewportScale = 1;
        let viewportRotation = 0;
        let isPanning = false;
        let panStartX = 0;
        let panStartY = 0;
        let lastPanX = 0;
        let lastPanY = 0;
        let isRotatingBoard = false;
        let rotateStartX = 0;
        let rotateStartRotation = 0;
        let isRotatingTile = false;
        let rotateTileStartX = 0;
        let rotateTileStartRotation = 0;
        let leftButtonDown = false;
        let rightButtonDown = false;

        // Fast pan (owner 2026-10-01, black bars / cut tiles on the tilted
        // board): the tilted board is one big 3D layer that Chrome paints in
        // strips. Rewriting the viewport transform repaints all of it, every
        // frame of a drag-pan, and strips that fall behind show as flat cuts.
        // While a pan gesture runs, viewportX/Y still change (hit-testing via
        // screenToWorld stays exact), but the already painted board is only
        // shifted with a CSS translate on #boardSvg (will-change: transform,
        // so the compositor moves it without repainting). The shift equals
        // the rotated pan delta, so the picture is identical. endFastPan()
        // writes the real transform once and drops the shift in the same frame.
        let _fastPan = null; // { x, y, rot, scale } committed at pan start
        function beginFastPan() {
            if (_fastPan) return;
            _fastPan = { x: viewportX, y: viewportY, rot: viewportRotation, scale: viewportScale };
        }
        function endFastPan() {
            if (!_fastPan) return;
            _fastPan = null;
            updateViewport();
        }
        window.beginFastPan = beginFastPan;
        window.endFastPan = endFastPan;
        // CSS pixel shift currently applied over the committed transform
        // (for code that reads positions from viewport.getCTM()).
        window.getBoardPanShift = () => _panShift;
        let _panShift = { x: 0, y: 0 };

        function updateViewport() {
            if (_fastPan && _fastPan.rot === viewportRotation && _fastPan.scale === viewportScale) {
                const rad = viewportRotation * Math.PI / 180;
                const dx = viewportX - _fastPan.x, dy = viewportY - _fastPan.y;
                _panShift = { x: dx * Math.cos(rad) - dy * Math.sin(rad), y: dx * Math.sin(rad) + dy * Math.cos(rad) };
                boardSvg.style.transform = `translate(${_panShift.x}px, ${_panShift.y}px)`;
                return;
            }
            if (_fastPan) _fastPan = { x: viewportX, y: viewportY, rot: viewportRotation, scale: viewportScale }; // zoom/turn mid-gesture: commit, keep panning fast from here
            if (_panShift.x || _panShift.y) { _panShift = { x: 0, y: 0 }; boardSvg.style.transform = ''; }
            const centerX = boardSvg.clientWidth / 2;
            const centerY = boardSvg.clientHeight / 2;
            viewport.setAttribute('transform',
                `translate(${centerX}, ${centerY}) rotate(${viewportRotation}) translate(${viewportX - centerX}, ${viewportY - centerY}) scale(${viewportScale})`);
            if (viewportRotation !== _leveledRotation) levelPlayerTileSymbols();
        }

        // Keeps the element row on every player tile level on screen (earth on
        // the left) when the map is turned: turns each row back around the
        // tile's center by the map's rotation.
        let _leveledRotation = 0;
        function levelPlayerTileSymbols() {
            _leveledRotation = viewportRotation;
            document.querySelectorAll('.player-tile-element-symbols').forEach(g => {
                if (viewportRotation) g.setAttribute('transform', `rotate(${-viewportRotation})`);
                else g.removeAttribute('transform');
            });
        }

        // Hermit-only board rotation tool (js/game-ui.js's openBoardRotationPanel):
        // viewportRotation already drives both the render transform above and
        // screenToWorld()'s inverse, so setting it and re-rendering is enough
        // to spin the whole board flat, in-plane — hit-testing/placement stay
        // correct. Distinct from window.getBoardTilt/setBoardTilt below, which
        // is a 3D camera tilt, not a rotation.
        window.getBoardRotation = function () {
            return ((viewportRotation % 360) + 360) % 360;
        };
        window.setBoardRotation = function (degrees) {
            rotateBoardTo(((degrees % 360) + 360) % 360);
            return viewportRotation;
        };

        // Turn the map to `degrees` around the CENTRE OF THE BOARD (the middle
        // of all placed tiles), not the middle of the screen: the board's
        // centre stays where it is on screen and the board spins in place
        // (owner 2026-10-08). Screen point of world p: c + R(rot)(s p + v - c),
        // so for a fixed screen point S the new pan is v = c + R(-rot)(S - c) - s p.
        function rotateBoardTo(degrees) {
            const tiles = (typeof placedTiles !== 'undefined' && placedTiles.length) ? placedTiles : null;
            if (!tiles) { viewportRotation = degrees; updateViewport(); return; }
            let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
            tiles.forEach(t => { x0 = Math.min(x0, t.x); x1 = Math.max(x1, t.x); y0 = Math.min(y0, t.y); y1 = Math.max(y1, t.y); });
            const px = (x0 + x1) / 2, py = (y0 + y1) / 2;
            const cx = boardSvg.clientWidth / 2, cy = boardSvg.clientHeight / 2, sc = viewportScale;
            const rot = (r, x, y) => { const a = r * Math.PI / 180, c = Math.cos(a), s = Math.sin(a); return [x * c - y * s, x * s + y * c]; };
            const [ax, ay] = rot(viewportRotation, sc * px + viewportX - cx, sc * py + viewportY - cy);
            const Sx = cx + ax, Sy = cy + ay;                       // where the board centre is now
            const [bx, by] = rot(-degrees, Sx - cx, Sy - cy);
            viewportRotation = degrees;
            viewportX = cx + bx - sc * px;
            viewportY = cy + by - sc * py;
            updateViewport();
        }
        window.rotateBoardTo = rotateBoardTo;

        // Hermit-only board tilt ("angle") tool (js/game-ui.js's
        // openBoardTiltPanel): a CSS 3D perspective tilt on the board
        // container, like tipping a table up to look at it from an angle
        // rather than straight top-down. It's a camera effect layered on top
        // of the SVG's own coordinate system rather than folded into
        // viewportRotation/screenToWorld above — but unlike a plain 2D
        // rotation, a 3D perspective transform makes the browser's own
        // boardSvg.getBoundingClientRect() return the foreshortened,
        // trapezoidal projected box instead of the board's true layout rect.
        // getBoardScreenXY() below un-projects click/drag coordinates back
        // through this exact transform so every existing hit-testing call
        // site (which assumes a plain untransformed rect) keeps working.
        //
        // The pivot (transform-origin) is fixed at the bottom edge. Pivoting
        // there means every row is at-or-behind the pivot in depth, so the
        // perspective divide only ever shrinks the board back toward that
        // edge as you tilt — never magnifies it past .board-area's bounds.
        // Only intended for positive degrees (the only range actually used —
        // see js/game-ui.js's openBoardTiltPanel); negative values aren't
        // supported by this pivot choice and will look wrong if ever used.
        const BOARD_TILT_PERSPECTIVE_PX = 1400; // must match getBoardScreenXY's inverse below
        window.getBoardTilt = function () {
            return window._boardTiltDegrees || 0;
        };
        window.setBoardTilt = function (degrees) {
            const clamped = Math.max(0, Math.min(80, degrees)); // negative degrees magnify past this pivot and are not supported
            window._boardTiltDegrees = clamped;
            const el = document.getElementById('new-board-container');
            if (el) {
                el.style.transformOrigin = '50% 100%';
                el.style.transform = clamped === 0 ? '' : `perspective(${BOARD_TILT_PERSPECTIVE_PX}px) rotateX(${clamped}deg)`;
            }
            return clamped;
        };
        window.setBoardTilt(20); // default camera angle

        // Positions #board-viewport (position:fixed, holds the actual board
        // content — see index.html) from .board-area's measured rect,
        // expanded by a fixed margin on every side, so a tilted board has
        // real room to render into instead of hitting a hard clip.
        // .board-area itself (and everything that keys off its rect, e.g.
        // getBoardScreenXY below) is completely untouched by this — only
        // .board-viewport's position/size and .board-container's inset are
        // driven by it. Backed by a ResizeObserver on .board-area rather
        // than a plain window-resize listener: "board" is the only
        // flexible (1fr) row in the grid, so any layout change that could
        // move or resize it — a window resize, the status bar's auto row
        // growing if its text wraps, or the game actually starting (which
        // takes .board-area from a display:none ancestor to its real
        // rendered size) — necessarily changes .board-area's own measured
        // box, which ResizeObserver reliably catches; a resize listener
        // alone would miss the status-bar case. rAF-throttled so rapid
        // resize events don't cause redundant layout thrashing.
        const BOARD_VIEWPORT_MARGIN_PX = 150; // must match .board-container's CSS inset fallback
        let _boardViewportSyncQueued = false;
        function syncBoardViewport() {
            if (_boardViewportSyncQueued) return;
            _boardViewportSyncQueued = true;
            requestAnimationFrame(() => {
                _boardViewportSyncQueued = false;
                const area = document.querySelector('.board-area');
                const viewport = document.getElementById('board-viewport');
                const container = document.getElementById('new-board-container');
                if (!area || !viewport) return;
                const rect = area.getBoundingClientRect();
                viewport.style.top = (rect.top - BOARD_VIEWPORT_MARGIN_PX) + 'px';
                viewport.style.left = (rect.left - BOARD_VIEWPORT_MARGIN_PX) + 'px';
                viewport.style.width = (rect.width + BOARD_VIEWPORT_MARGIN_PX * 2) + 'px';
                viewport.style.height = (rect.height + BOARD_VIEWPORT_MARGIN_PX * 2) + 'px';
                if (container) container.style.inset = BOARD_VIEWPORT_MARGIN_PX + 'px';
            });
        }
        window.syncBoardViewport = syncBoardViewport;
        (function initBoardViewportSync() {
            const areaEl = document.querySelector('.board-area');
            if (areaEl && typeof ResizeObserver !== 'undefined') {
                new ResizeObserver(syncBoardViewport).observe(areaEl);
            }
            syncBoardViewport();
        })();

        // Drop-in replacement for the old `rect = boardSvg.getBoundingClientRect();
        // x = clientX - rect.left` pattern used at every drag/click hit-testing
        // call site. Reads the untransformed rect from .board-area (a stable,
        // never-transformed placeholder — see syncBoardViewport above) and, if a
        // tilt is active, inverts the perspective(P) rotateX(θ) projection CSS
        // applied when rendering, pivoting at the bottom edge (per above):
        // forward projection puts a local offset (dx, dy) from that pivot at
        // screen offset (dx/w, dy·cosθ/w) where w = 1 - dy·sinθ/P; solving
        // that pair for (dx, dy) given the click's screen offset (sx, sy)
        // yields the inverse used here. With no tilt this reduces to the
        // exact same math the old pattern did.
        function getBoardScreenXY(clientX, clientY) {
            // .board-area is no longer an ancestor of boardSvg (the actual
            // board content lives in the JS-positioned .board-viewport, see
            // syncBoardViewport below) — .board-area still exists as a
            // stable, untransformed placeholder purely for this reference,
            // so look it up directly rather than via closest().
            const area = document.querySelector('.board-area');
            const rect = area ? area.getBoundingClientRect() : boardSvg.getBoundingClientRect();
            const tiltDeg = window._boardTiltDegrees || 0;
            if (!tiltDeg) {
                return { x: clientX - rect.left, y: clientY - rect.top };
            }
            const W = rect.width, H = rect.height;
            const theta = tiltDeg * Math.PI / 180;
            const sx = (clientX - rect.left) - W / 2;
            const sy = (clientY - rect.top) - H; // pivot is at the bottom edge
            let denom = 1 + (sy * Math.tan(theta)) / BOARD_TILT_PERSPECTIVE_PX;
            if (Math.abs(denom) < 0.01) denom = denom < 0 ? -0.01 : 0.01;
            const w = 1 / denom;
            const dx = sx * w;
            const dy = (sy * w) / Math.cos(theta);
            return { x: W / 2 + dx, y: H + dy };
        }

        // Forward counterpart to getBoardScreenXY above: projects a point
        // FROM the same flat, untransformed board-pixel space (relative to
        // .board-area's rect) TO its actual on-screen position once the
        // tilt is applied — i.e. the inverse operation. For anything that
        // computes a board-space draw position independently of the DOM
        // (e.g. js/effects-system.js's tileToScreen, which derives a flat
        // pixel position via the SVG viewport's own CTM and used to just
        // add boardSvg.getBoundingClientRect() — wrong once tilted, for the
        // exact same reason getBoardScreenXY's own comment explains: that
        // rect is the foreshortened/trapezoidal projected box, not the true
        // layout size). `scale` is the same perspective divisor (w) used
        // for position, returned so callers also shrink whatever they draw
        // there to match — a fire icon on a distant (tilted-away) tile
        // should appear smaller, the same way the tile itself does.
        function getScreenFromBoardXY(localX, localY) {
            const area = document.querySelector('.board-area');
            if (!area) return null;
            const rect = area.getBoundingClientRect();
            const tiltDeg = window._boardTiltDegrees || 0;
            if (!tiltDeg) {
                return { x: rect.left + localX, y: rect.top + localY, scale: 1 };
            }
            const W = rect.width, H = rect.height;
            const theta = tiltDeg * Math.PI / 180;
            const dx = localX - W / 2;
            const dy = localY - H; // pivot is at the bottom edge
            let w = 1 - (dy * Math.sin(theta)) / BOARD_TILT_PERSPECTIVE_PX;
            if (Math.abs(w) < 0.01) w = w < 0 ? -0.01 : 0.01;
            const sx = dx / w;
            const sy = (dy * Math.cos(theta)) / w;
            return { x: rect.left + W / 2 + sx, y: rect.top + H + sy, scale: w };
        }
        window.getScreenFromBoardXY = getScreenFromBoardXY;

        // Fit all placed tiles into view, centered
        function fitBoardToView() {
            if (placedTiles.length === 0) return;

            // Calculate bounding box of all tiles
            let minX = Infinity, maxX = -Infinity;
            let minY = Infinity, maxY = -Infinity;

            placedTiles.forEach(tile => {
                // Each tile is roughly TILE_SIZE * 2.5 in radius
                const tileRadius = TILE_SIZE * 2.5;
                minX = Math.min(minX, tile.x - tileRadius);
                maxX = Math.max(maxX, tile.x + tileRadius);
                minY = Math.min(minY, tile.y - tileRadius);
                maxY = Math.max(maxY, tile.y + tileRadius);
            });

            const boardWidth = maxX - minX;
            const boardHeight = maxY - minY;
            const boardCenterX = (minX + maxX) / 2;
            const boardCenterY = (minY + maxY) / 2;

            // Get available screen space. Read from .board-area, not boardSvg
            // directly — when a board tilt is active, boardSvg's own rect is
            // the foreshortened/trapezoidal projected box, not its true size.
            // .board-area is no longer an ancestor of boardSvg (see
            // getBoardScreenXY above), so look it up directly.
            const svgRect = (document.querySelector('.board-area') || boardSvg).getBoundingClientRect();
            const screenWidth = svgRect.width;
            const screenHeight = svgRect.height;

            // Add padding (10% on each side)
            const paddingFactor = 0.8;
            const scaleX = (screenWidth * paddingFactor) / boardWidth;
            const scaleY = (screenHeight * paddingFactor) / boardHeight;
            const newScale = Math.min(scaleX, scaleY, 2); // Cap at 2x zoom

            // Center the board
            const screenCenterX = screenWidth / 2;
            const screenCenterY = screenHeight / 2;

            viewportScale = newScale;
            viewportX = screenCenterX - boardCenterX * newScale;
            viewportY = screenCenterY - boardCenterY * newScale;

            console.log(`📐 fitBoardToView: board=(${boardWidth.toFixed(0)}x${boardHeight.toFixed(0)}), screen=(${screenWidth.toFixed(0)}x${screenHeight.toFixed(0)}), scale=${newScale.toFixed(2)}`);

            updateViewport();
        }

        function screenToWorld(screenX, screenY) {
            const centerX = boardSvg.clientWidth / 2;
            const centerY = boardSvg.clientHeight / 2;
            let x = screenX - centerX;
            let y = screenY - centerY;
            const rad = -viewportRotation * Math.PI / 180;
            const cos = Math.cos(rad);
            const sin = Math.sin(rad);
            const rotatedX = x * cos - y * sin;
            const rotatedY = x * sin + y * cos;
            const scaledX = rotatedX / viewportScale;
            const scaledY = rotatedY / viewportScale;
            const worldX = scaledX - (viewportX - centerX) / viewportScale;
            const worldY = scaledY - (viewportY - centerY) / viewportScale;
            return { x: worldX, y: worldY };
        }

        function hexToPixel(q, r, s) {
            const width = s * Math.sqrt(3);
            const height = 2 * s;
            const x = width * (q + r / 2);
            const y = height * (3/4) * r;
            return { x, y };
        }

        function pixelToHex(x, y, s) {
            const q = (x * Math.sqrt(3)/3 - y / 3) / s;
            const r = (y * 2/3) / s;
            return hexRound(q, r);
        }

        function hexRound(q, r) {
            let s = -q - r;
            let rq = Math.round(q);
            let rr = Math.round(r);
            let rs = Math.round(s);
            const qDiff = Math.abs(rq - q);
            const rDiff = Math.abs(rr - r);
            const sDiff = Math.abs(rs - s);
            if (qDiff > rDiff && qDiff > sDiff) rq = -rr - rs;
            else if (rDiff > sDiff) rr = -rq - rs;
            return { q: rq, r: rr };
        }

        function createHexagonPoints(cx, cy, s) {
            const points = [];
            for (let i = 0; i < 6; i++) {
                const angle = (Math.PI / 3) * i - Math.PI / 6;
                const x = cx + s * Math.cos(angle);
                const y = cy + s * Math.sin(angle);
                points.push(`${x},${y}`);
            }
            return points.join(' ');
        }

        // Outer edge of a tile (13 hexes + 6 half hexes, createTileGroup), as
        // one path: every polygon edge not shared with another polygon.
        function playerTileOutlinePath(s) {
            const key = (x, y) => `${Math.round(x * 10)},${Math.round(y * 10)}`;
            const edges = new Map();
            createTileGroup(s, 0, false).querySelectorAll('polygon').forEach(poly => {
                const v = poly.getAttribute('points').trim().split(/\s+/).map(pt => pt.split(',').map(Number));
                for (let i = 0; i < v.length; i++) {
                    const p1 = v[i], p2 = v[(i + 1) % v.length];
                    const k = [key(...p1), key(...p2)].sort().join('|');
                    const e = edges.get(k);
                    if (e) e.n++; else edges.set(k, { n: 1, p1, p2 });
                }
            });
            let d = '';
            edges.forEach(e => {
                if (e.n === 1) d += `M${e.p1[0].toFixed(2)},${e.p1[1].toFixed(2)}L${e.p2[0].toFixed(2)},${e.p2[1].toFixed(2)}`;
            });
            return d;
        }

        function createTrapezoidPoints(cx, cy, s, direction) {
            const hexVertices = [];
            for (let i = 0; i < 6; i++) {
                const angle = (Math.PI / 3) * i - Math.PI / 6;
                hexVertices.push({
                    x: cx + s * Math.cos(angle),
                    y: cy + s * Math.sin(angle)
                });
            }
            const indices = [
                [1, 2, 3, 4], [2, 3, 4, 5], [3, 4, 5, 0],
                [4, 5, 0, 1], [5, 0, 1, 2], [0, 1, 2, 3]
            ][direction];
            return indices.map(idx => `${hexVertices[idx].x},${hexVertices[idx].y}`).join(' ');
        }

        function createTileGroup(s, rotation = 0, flipped = false) {
            const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            g.setAttribute('transform', `rotate(${rotation * 60})`);

            if (flipped) {
                // Flipped side: only outer ring of hexagons + trapezoids (no center, no inner ring)
                const hexagons = [
                    { q: 2, r: -1 }, { q: 1, r: 1 }, { q: -1, r: 2 },
                    { q: -2, r: 1 }, { q: -1, r: -1 }, { q: 1, r: -2 }
                ];

                hexagons.forEach(hex => {
                    const pos = hexToPixel(hex.q, hex.r, s);
                    const points = createHexagonPoints(pos.x, pos.y, s);
                    const polygon = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
                    polygon.setAttribute('points', points);
                    polygon.setAttribute('class', 'hex-tile flipped');
                    g.appendChild(polygon);
                });

                const trapezoids = [
                    { q: 2, r: 0, dir: 1 }, { q: 0, r: 2, dir: 2 },
                    { q: -2, r: 2, dir: 3 }, { q: -2, r: 0, dir: 4 },
                    { q: 0, r: -2, dir: 5 }, { q: 2, r: -2, dir: 0 }
                ];

                trapezoids.forEach(trap => {
                    const pos = hexToPixel(trap.q, trap.r, s);
                    const points = createTrapezoidPoints(pos.x, pos.y, s, trap.dir);
                    const polygon = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
                    polygon.setAttribute('points', points);
                    polygon.setAttribute('class', 'hex-tile trapezoid flipped');
                    g.appendChild(polygon);
                });

                // Add empty center hex for visual reference (no fill)
                const centerPos = hexToPixel(0, 0, s);
                const centerPoints = createHexagonPoints(centerPos.x, centerPos.y, s);
                const centerPolygon = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
                centerPolygon.setAttribute('points', centerPoints);
                centerPolygon.setAttribute('class', 'hex-tile empty-center');
                g.appendChild(centerPolygon);
            } else {
                // Normal side: all hexagons
                const hexagons = [
                    { q: 0, r: 0, class: 'center-hex' },
                    { q: 1, r: 0 }, { q: 0, r: 1 }, { q: -1, r: 1 },
                    { q: -1, r: 0 }, { q: 0, r: -1 }, { q: 1, r: -1 },
                    { q: 2, r: -1 }, { q: 1, r: 1 }, { q: -1, r: 2 },
                    { q: -2, r: 1 }, { q: -1, r: -1 }, { q: 1, r: -2 }
                ];

                hexagons.forEach(hex => {
                    const pos = hexToPixel(hex.q, hex.r, s);
                    const points = createHexagonPoints(pos.x, pos.y, s);
                    const polygon = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
                    polygon.setAttribute('points', points);
                    polygon.setAttribute('class', `hex-tile ${hex.class || ''}`);
                    g.appendChild(polygon);
                });

                const trapezoids = [
                    { q: 2, r: 0, dir: 1 }, { q: 0, r: 2, dir: 2 },
                    { q: -2, r: 2, dir: 3 }, { q: -2, r: 0, dir: 4 },
                    { q: 0, r: -2, dir: 5 }, { q: 2, r: -2, dir: 0 }
                ];

                trapezoids.forEach(trap => {
                    const pos = hexToPixel(trap.q, trap.r, s);
                    const points = createTrapezoidPoints(pos.x, pos.y, s, trap.dir);
                    const polygon = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
                    polygon.setAttribute('points', points);
                    polygon.setAttribute('class', 'hex-tile trapezoid');
                    g.appendChild(polygon);
                });
            }

            return g;
        }

        function drawDeckTile() {
            deckTileSvg.innerHTML = '';
            const tile = createTileGroup(6, currentRotation, currentFlipped);
            tile.setAttribute('transform', 'translate(75, 75)');
            deckTileSvg.appendChild(tile);
        }

        function initializePlayerTiles(numPlayers) {
            const playerTileDeck = document.getElementById('new-player-tile-deck') || document.getElementById('player-tile-deck');
            playerTileDeck.innerHTML = '';
            playerTileElements = [];
            playerTilesAvailable = numPlayers;
            const countEl = document.getElementById('new-player-tile-count') || document.getElementById('player-tile-count');
            if (countEl) countEl.textContent = numPlayers;

            for (let i = 0; i < numPlayers; i++) {
                const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
                svg.setAttribute('width', '150');
                svg.setAttribute('height', '150');
                svg.setAttribute('class', 'deck-tile player-tile-deck-item');
                svg.setAttribute('data-player-index', i);

                const tile = createTileGroup(6, 0, false); // Player tiles are not flipped
                tile.setAttribute('transform', 'translate(75, 75)');
                svg.appendChild(tile);

                playerTileDeck.appendChild(svg);
                playerTileElements.push(svg);

                // Add mousedown event for dragging
                svg.addEventListener('mousedown', (e) => {
                    if (playerTilesAvailable <= 0) return;
                    if (e.button === 0) {
                        startPlayerTileDrag(i, e);
                    }
                });

                // Add touch support for mobile
                svg.addEventListener('touchstart', (e) => {
                    if (playerTilesAvailable <= 0) return;
                    e.preventDefault();
                    startPlayerTileDrag(i, e);
                }, { passive: false });
            }
            if (isMobile) syncMobileTileDeck();

        }

        // Initialize a single player tile for multiplayer (only MY tile)
        function initializeMyPlayerTile(playerIndex, color) {
            const playerTileDeck = document.getElementById('new-player-tile-deck') || document.getElementById('player-tile-deck');
            playerTileDeck.innerHTML = '';
            playerTileElements = [];
            playerTilesAvailable = 1;
            const countEl = document.getElementById('new-player-tile-count') || document.getElementById('player-tile-count');
            if (countEl) countEl.textContent = '1';

            const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            svg.setAttribute('width', '150');
            svg.setAttribute('height', '150');
            svg.setAttribute('class', 'deck-tile player-tile-deck-item');
            svg.setAttribute('data-player-index', playerIndex);

            const tile = createTileGroup(6, 0, false);
            tile.setAttribute('transform', 'translate(75, 75)');
            svg.appendChild(tile);

            // Add color indicator to show which player this is
            const colorCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            colorCircle.setAttribute('cx', '75');
            colorCircle.setAttribute('cy', '75');
            colorCircle.setAttribute('r', '12');
            colorCircle.setAttribute('fill', color);
            colorCircle.setAttribute('stroke', '#000');
            colorCircle.setAttribute('stroke-width', '2');
            svg.appendChild(colorCircle);

            playerTileDeck.appendChild(svg);
            playerTileElements.push(svg);

            // Add mousedown event for dragging
            svg.addEventListener('mousedown', (e) => {
                if (playerTilesAvailable <= 0) return;
                // Placement tiles can only be dragged during the placement phase
                if (!isPlacementPhase) return;
                // In multiplayer, only allow drag if it's your turn to place
                if (isMultiplayer && !canPlaceTile()) {
                    notYourTurn();
                    return;
                }
                if (e.button === 0) {
                    startPlayerTileDrag(playerIndex, e);
                }
            });

            // Add touch support for mobile
            svg.addEventListener('touchstart', (e) => {
                if (playerTilesAvailable <= 0) return;
                if (!isPlacementPhase) return;
                if (isMultiplayer && !canPlaceTile()) {
                    notYourTurn();
                    return;
                }
                e.preventDefault();
                startPlayerTileDrag(playerIndex, e);
            }, { passive: false });
            if (isMobile) syncMobileTileDeck();

        }

        function startPlayerTileDrag(playerIndex, e) {
            isDraggingTile = true;
            draggedTileId = null;
            draggedTileRotation = 0;
            draggedTileFlipped = false;
            draggedTileShrineType = 'player'; // Mark as player tile
            draggedTileOriginalPos = null;

            const coords = getEventCoords(e);
            const { x: screenX, y: screenY } = getBoardScreenXY(coords.x, coords.y);
            const world = screenToWorld(screenX, screenY);

            ghostTile = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            ghostTile.setAttribute('class', 'ghost-tile');
            ghostTile.setAttribute('transform', `translate(${world.x}, ${world.y})`);
            const tile = createTileGroup(TILE_SIZE, 0, false);
            ghostTile.appendChild(tile);
            viewport.appendChild(ghostTile);

            showLegalPlacementHighlights('player-tile', null, previewUpcomingPlayerTileColor());
        }

        // Cached: this is called from many places (movement checks, highlights,
        // bot pathing, escape checks) and rebuilt the whole hex list each
        // time. Reused while placedTiles holds the same tile objects at the
        // same places with the same flipped state. Callers get their own copy
        // of the array; the entries inside are shared (none are changed).
        let _hexCache = null;
        function getAllHexagonPositions() {
            const c = _hexCache;
            if (c && c.tiles.length === placedTiles.length) {
                let same = true;
                for (let i = 0; i < placedTiles.length; i++) {
                    const t = placedTiles[i], o = c.state[i];
                    if (c.tiles[i] !== t || o.x !== t.x || o.y !== t.y || o.f !== t.flipped || o.p !== t.isPlayerTile) { same = false; break; }
                }
                if (same) return c.list.slice();
            }
            const list = _buildAllHexagonPositions();
            _hexCache = {
                tiles: placedTiles.slice(),
                state: placedTiles.map(t => ({ x: t.x, y: t.y, f: t.flipped, p: t.isPlayerTile })),
                list,
            };
            return list.slice();
        }

        function _buildAllHexagonPositions() {
            const positions = new Map();
            const trapezoidMap = new Map();

            placedTiles.forEach(tile => {
                const s = TILE_SIZE;

                // For flipped tiles, only include outer ring hexagons
                // For normal tiles and player tiles, include all hexagons
                // Player tiles look revealed but allow walking off them
                let hexagons;
                if (tile.flipped && !tile.isPlayerTile) {
                    hexagons = [
                        { q: 2, r: -1 }, { q: 1, r: 1 }, { q: -1, r: 2 },
                        { q: -2, r: 1 }, { q: -1, r: -1 }, { q: 1, r: -2 }
                    ];
                } else {
                    hexagons = [
                        { q: 0, r: 0 },
                        { q: 1, r: 0 }, { q: 0, r: 1 }, { q: -1, r: 1 },
                        { q: -1, r: 0 }, { q: 0, r: -1 }, { q: 1, r: -1 },
                        { q: 2, r: -1 }, { q: 1, r: 1 }, { q: -1, r: 2 },
                        { q: -2, r: 1 }, { q: -1, r: -1 }, { q: 1, r: -2 }
                    ];
                }

                hexagons.forEach(hex => {
                    const localPos = hexToPixel(hex.q, hex.r, s);
                    const globalX = tile.x + localPos.x;
                    const globalY = tile.y + localPos.y;
                    const roundedX = Math.round(globalX * 100) / 100;
                    const roundedY = Math.round(globalY * 100) / 100;
                    const key = `${roundedX},${roundedY}`;
                    if (!positions.has(key)) {
                        positions.set(key, { x: globalX, y: globalY, key, tiles: [tile] });
                    } else {
                        // Track which tiles contribute to this position
                        const existing = positions.get(key);
                        if (!existing.tiles.includes(tile)) {
                            existing.tiles.push(tile);
                        }
                    }
                });

                const trapezoids = [
                    { q: 2, r: 0 }, { q: 0, r: 2 }, { q: -2, r: 2 },
                    { q: -2, r: 0 }, { q: 0, r: -2 }, { q: 2, r: -2 }
                ];

                trapezoids.forEach(trap => {
                    const localPos = hexToPixel(trap.q, trap.r, s);
                    const globalX = tile.x + localPos.x;
                    const globalY = tile.y + localPos.y;
                    const roundedX = Math.round(globalX * 100) / 100;
                    const roundedY = Math.round(globalY * 100) / 100;
                    const key = `${roundedX},${roundedY}`;
                    if (!trapezoidMap.has(key)) {
                        trapezoidMap.set(key, { count: 1, x: globalX, y: globalY, key, tiles: [tile] });
                    } else {
                        const existing = trapezoidMap.get(key);
                        existing.count += 1;
                        if (!existing.tiles.includes(tile)) {
                            existing.tiles.push(tile);
                        }
                        if (existing.count >= 2 && !positions.has(key)) {
                            positions.set(key, { x: globalX, y: globalY, key, tiles: existing.tiles });
                        }
                    }
                });
            });

            return Array.from(positions.values());
        }

        function isPositionOnFlippedTile(x, y, hexPositions) {
            // Find the hex position that matches this x,y
            const matchingPos = hexPositions.find(pos => {
                const dist = Math.sqrt(Math.pow(pos.x - x, 2) + Math.pow(pos.y - y, 2));
                return dist < 5;
            });

            if (!matchingPos || !matchingPos.tiles) return false;

            // Check if ANY of the tiles contributing to this position are flipped (and not player tile)
            return matchingPos.tiles.some(tile => tile.flipped && !tile.isPlayerTile);
        }

        // Rule: stones may never be placed on a player tile, including its
        // bridge hexes (the shared boundary positions getAllHexagonPositions()
        // synthesizes when ≥2 tiles' trapezoid corners coincide — a bridge hex's
        // `tiles` list carries every tile that contributes to it, so a bridge
        // hex touching a player tile is excluded the same way a normal hex on
        // that tile is). Applies to every player's tile, including your own.
        function isPositionOnPlayerTile(x, y, hexPositions) {
            const matchingPos = hexPositions.find(pos => {
                const dist = Math.sqrt(Math.pow(pos.x - x, 2) + Math.pow(pos.y - y, 2));
                return dist < 5;
            });

            if (!matchingPos || !matchingPos.tiles) return false;

            return matchingPos.tiles.some(tile => tile.isPlayerTile);
        }

        function findValidStonePosition(x, y, stoneTypeOverride) {
            const stoneType = stoneTypeOverride !== undefined ? stoneTypeOverride : draggedStoneType;
            const hexPositions = getAllHexagonPositions();
            let nearest = null;
            let minDist = Infinity;

            hexPositions.forEach(pos => {
                const dist = Math.sqrt(Math.pow(x - pos.x, 2) + Math.pow(y - pos.y, 2));
                if (dist < minDist) {
                    minDist = dist;
                    nearest = pos;
                }
            });

            if (nearest && minDist < TILE_SIZE * 2) {
                const occupied = placedStones.some(stone => {
                    const dist = Math.sqrt(Math.pow(stone.x - nearest.x, 2) + Math.pow(stone.y - nearest.y, 2));
                    return dist < 5;
                });

                // Block placement on any player (active or other players)
                let anyPlayerHere = false;
                if (playerPosition) {
                    const d = Math.sqrt(Math.pow(playerPosition.x - nearest.x, 2) + Math.pow(playerPosition.y - nearest.y, 2));
                    if (d < 5) anyPlayerHere = true;
                }
                if (typeof playerPositions !== 'undefined' && playerPositions.length) {
                    playerPositions.forEach(pos => {
                        if (pos && pos.x != null && pos.y != null) {
                            const d = Math.sqrt(Math.pow(pos.x - nearest.x, 2) + Math.pow(pos.y - nearest.y, 2));
                            if (d < 5) anyPlayerHere = true;
                        }
                    });
                }

                const onFlippedTile = isPositionOnFlippedTile(nearest.x, nearest.y, hexPositions);

                // Check if position is valid for placement based on active buffs
                // (isInPlacementRange already refuses to place while the pawn
                // itself is standing on a stone — see its stoneUnderPawn check)
                const inPlacementRange = playerPosition && isInPlacementRange(nearest.x, nearest.y, stoneType);

                if (!occupied && !anyPlayerHere && !onFlippedTile && inPlacementRange) {
                    return { x: nearest.x, y: nearest.y, valid: true };
                }
            }

            return { x: x, y: y, valid: false };
        }

        // Lightweight log throttling for noisy debug statements
        const _debugLogTimes = {};
        function shouldDebugLog(key, minIntervalMs = 250) {
            if (typeof window !== 'undefined' && window.DEBUG_LOG_VERBOSE) return true;
            const now = Date.now();
            const last = _debugLogTimes[key] || 0;
            if (now - last >= minIntervalMs) {
                _debugLogTimes[key] = now;
                return true;
            }
            return false;
        }
        if (typeof window !== 'undefined') {
            window.shouldDebugLog = shouldDebugLog;
        }

        // Scroll event log buffer (low-noise timeline for debugging)
        if (typeof window !== 'undefined') {
            window._scrollEventLog = window._scrollEventLog || [];
            window.logScrollEvent = function logScrollEvent(type, details = {}) {
                const entry = {
                    ts: new Date().toISOString(),
                    type,
                    details
                };
                window._scrollEventLog.push(entry);
                if (window._scrollEventLog.length > 200) {
                    window._scrollEventLog.shift();
                }
            };
            window.dumpScrollEvents = function dumpScrollEvents() {
                const log = window._scrollEventLog || [];
                console.group(`📜 Scroll Event Log (${log.length} events)`);
                log.forEach((e, i) => {
                    const time = new Date(e.ts).toLocaleTimeString();
                    const type = e.type.padEnd(20);
                    const details = JSON.stringify(e.details);
                    console.log(`#${i + 1} [${time}] ${type} ${details}`);
                });
                console.groupEnd();
            };

            // Clean scroll diagnostics - shows current state + recent events
            window.scrollDiag = function scrollDiag() {
                console.log('\n' + '═'.repeat(80));
                console.log('📊 SCROLL DIAGNOSTICS');
                console.log('═'.repeat(80));

                // Current scroll state
                if (typeof spellSystem !== 'undefined') {
                    console.log('\n📦 CURRENT STATE:\n');

                    for (let i = 0; i < (spellSystem.playerScrolls?.length || 0); i++) {
                        const p = spellSystem.playerScrolls[i];
                        if (!p) continue;
                        const playerName = typeof getPlayerColorName === 'function' ? getPlayerColorName(i) : `Player ${i}`;
                        const isMe = i === (typeof myPlayerIndex !== 'undefined' ? myPlayerIndex : -1);
                        const hand = Array.from(p.hand || []);
                        const active = Array.from(p.active || []);
                        const activated = Array.from(p.activated || []);

                        console.log(`${playerName} ${isMe ? '(YOU)' : ''}`);
                        console.log(`  Hand:    ${hand.length ? hand.join(', ') : '(empty)'}`);
                        console.log(`  Active:  ${active.length ? active.join(', ') : '(empty)'}`);
                        console.log(`  Win:     ${activated.length}/5 → ${activated.length ? activated.join(', ') : '(none)'}`);
                    }

                    console.log('\n🏛️  COMMON AREA:\n');
                    ['earth', 'water', 'fire', 'wind', 'void', 'catacomb'].forEach(element => {
                        const scrollName = spellSystem.commonArea?.[element];
                        if (scrollName) {
                            console.log(`  ${element}: ${scrollName}`);
                        }
                    });

                    console.log('\n📚 DECKS:\n');
                    Object.keys(spellSystem.scrollDecks || {}).forEach(element => {
                        const count = (spellSystem.scrollDecks[element] || []).length;
                        console.log(`  ${element}: ${count} scrolls remaining`);
                    });
                }

                // Recent events
                const log = window._scrollEventLog || [];
                const recent = log.slice(-30);

                console.log('\n📜 RECENT EVENTS (last 30):\n');
                recent.forEach((e) => {
                    const time = new Date(e.ts).toLocaleTimeString();
                    const icon = {
                        'scroll_collected': '📥',
                        'scroll_cast': '⚡',
                        'scroll_moved': '➡️',
                        'scroll_discarded': '🗑️',
                        'effect_execute': '✨',
                        'response_counter': '🛡️',
                        'response_resolved': '⚔️',
                        'original_countered': '❌',
                        'original_resolved': '✅'
                    }[e.type] || '•';

                    let summary = e.type;
                    if (e.details.scrollName) summary += ` ${e.details.scrollName}`;
                    if (e.details.playerIndex !== undefined) {
                        const name = typeof getPlayerColorName === 'function' ? getPlayerColorName(e.details.playerIndex) : `P${e.details.playerIndex}`;
                        summary += ` [${name}]`;
                    }

                    console.log(`${icon} [${time}] ${summary}`);
                });

                console.log('\n' + '═'.repeat(80));
                console.log('Run scrollDiag() again to refresh');
                console.log('═'.repeat(80));
            };

            // Quick alias
            window.sd = window.scrollDiag;

            // Scroll audit command
            window.auditScrolls = function() {
                if (typeof spellSystem !== 'undefined' && spellSystem.auditScrolls) {
                    return spellSystem.auditScrolls();
                } else {
                    console.error('spellSystem not available');
                }
            };

            window.SHOW_SCROLL_FINDER_UI = false;
            window.SHOW_SCROLL_DECK_BROWSER = false;
            window.showScrollFinderUI = function () {
                window.SHOW_SCROLL_FINDER_UI = true;
                console.log('✅ Scroll finder UI enabled');
            };
            window.hideScrollFinderUI = function () {
                window.SHOW_SCROLL_FINDER_UI = false;
                console.log('✅ Scroll finder UI hidden');
            };
            window.showScrollDeckBrowserUI = function () {
                window.SHOW_SCROLL_DECK_BROWSER = true;
                console.log('✅ Scroll deck browser enabled');
            };
            window.hideScrollDeckBrowserUI = function () {
                window.SHOW_SCROLL_DECK_BROWSER = false;
                console.log('✅ Scroll deck browser hidden');
            };
            // Short commands
            window.showdeck = function () {
                window.SHOW_SCROLL_DECK_BROWSER = !window.SHOW_SCROLL_DECK_BROWSER;
                console.log(window.SHOW_SCROLL_DECK_BROWSER ? '✅ Scroll deck browser enabled' : '✅ Scroll deck browser hidden');
            };
            window.givePlayersFiveStones = function () {
                const pools = typeof playerPools !== 'undefined' ? playerPools : null;
                if (!pools) return;
                const count = typeof playerPositions !== 'undefined' ? playerPositions.length : pools.length;
                for (let i = 0; i < count; i++) {
                    if (!pools[i]) pools[i] = { ...INITIAL_PLAYER_STONES };
                    pools[i].earth = 5;
                    pools[i].water = 5;
                    pools[i].fire = 5;
                    pools[i].wind = 5;
                    pools[i].void = 5;
                }
                ['earth', 'water', 'fire', 'wind', 'void'].forEach(t => {
                    if (typeof updateStoneCount === 'function') updateStoneCount(t);
                });
                if (typeof updateVoidAP === 'function') updateVoidAP();
                if (typeof syncPlayerState === 'function') syncPlayerState();
                console.log('✅ Gave all players 5 stones each');
            };
            window.fillstones = function () {
                window.givePlayersFiveStones();
            };
            window.showDebugCommands = function () {
                console.log('Commands:');
                console.log('- dumpGameDebug()  /  debug()     - full game state snapshot (replaces dumpScrollDebug)');
                console.log('- dumpScrollDebug()               - alias for dumpGameDebug');
                console.log('- dumpScrollEvents()');
                console.log('- showScrollFinderUI()');
                console.log('- hideScrollFinderUI()');
                console.log('- showScrollDeckBrowserUI()');
                console.log('- hideScrollDeckBrowserUI()');
                console.log('- showdeck()  // toggle scroll deck browser');
                console.log('- givePlayersFiveStones()');
                console.log('- fillstones()');
                console.log('- window.KNOWN_BUGS              - list of open bug tickets');
                console.log('- window.DEBUG_LOG_VERBOSE = true/false');
            };
            window.help = function () {
                window.showDebugCommands();
            };
        }

        // ─────────────────────────────────────────────────────────────────────
        // KNOWN BUGS TODO LOG
        // ─────────────────────────────────────────────────────────────────────
        window.KNOWN_BUGS = [
            {
                id: 'TRANS-WIN-CON',
                status: 'open',
                title: 'Transmute win-condition marker',
                description: 'Casting Transmute (Fire IV) does not always display the fire ♦ symbol on the player shrine tile. Belt-and-suspenders tracking added inside execute(); still investigating root cause.'
            },
            {
                id: 'TRANS-DOUBLE-DISP',
                status: 'open',
                title: 'Transmute inventory display stale after discard',
                description: 'After transmuting a scroll from hand/active, the scroll inventory popup may still show the discarded scroll if the popup was open before Transmute. State is correct; Done button now refreshes the popup.'
            },
            {
                id: 'TURN-ORDER-NULL',
                status: 'fixed',
                title: 'Turn order crash on null playerPositions entries',
                description: 'If playerPositions has null/undefined entries (e.g. sparse indices after disconnect), COLOR_RANK[p.color] throws TypeError. Fixed with optional-chain guard p?.color and length guard.'
            },
            {
                id: 'COLOR-RANK-MP',
                status: 'fixed',
                title: 'Multiplayer turn order rank always 999 (wrong color key in playerPositions)',
                description: 'In multiplayer, playerPositions stored string color names (\'purple\', \'yellow\') instead of hex values (\'#9458f4\'), so COLOR_RANK lookups returned undefined → rank 999 for every player → non-deterministic turn order. Fixed: placePlayer() now always receives assignedColor (hex) not playerColor (string).'
            }
        ];
        (function printKnownBugs() {
            if (window.KNOWN_BUGS.length === 0) return;
            console.group('%c📋 Known Bugs (' + window.KNOWN_BUGS.length + ') - run dumpGameDebug() for full state', 'color:#e67e22;font-weight:bold');
            window.KNOWN_BUGS.forEach(function(b) {
                console.log('%c[' + b.status.toUpperCase() + '] ' + b.id + ': ' + b.title, 'color:#f39c12;font-weight:bold');
                console.log('   ' + b.description);
            });
            console.groupEnd();
        })();

        // ─────────────────────────────────────────────────────────────────────
        // COMPREHENSIVE GAME DEBUG TOOL  (replaces the old dumpScrollDebug)
        // ─────────────────────────────────────────────────────────────────────
        if (typeof window !== 'undefined') {
            window.dumpGameDebug = function dumpGameDebug() {
                try {
                    const ss = spellSystem;
                    const activeIdx  = typeof activePlayerIndex  !== 'undefined' ? activePlayerIndex  : null;
                    const myIdx      = typeof myPlayerIndex      !== 'undefined' ? myPlayerIndex      : null;
                    const numP       = typeof totalPlayers       !== 'undefined' ? totalPlayers       : 0;
                    const poolsArr   = typeof playerPools        !== 'undefined' ? playerPools        : [];
                    const posArr     = typeof playerPositions    !== 'undefined' ? playerPositions    : [];

                    // ── helpers ───────────────────────────────────────────────
                    const sumScrolls = (idx) => {
                        if (!ss?.playerScrolls?.[idx]) return { hand: [], active: [], activated: [] };
                        const p = ss.playerScrolls[idx];
                        return {
                            hand:      p.hand      ? Array.from(p.hand)      : [],
                            active:    p.active    ? Array.from(p.active)    : [],
                            activated: p.activated ? Array.from(p.activated) : []
                        };
                    };

                    // Turn order reconstruction
                    const COLOR_RANK_D = { '#9458f4': 1, '#ffce00': 2, '#ed1b43': 3, '#5894f4': 4, '#69d83a': 5 };
                    const sortedD = posArr
                        .map((p, idx) => ({ index: idx, color: p?.color, rank: COLOR_RANK_D[p?.color] || 999 }))
                        .filter((_, idx) => posArr[idx] != null)
                        .sort((a, b) => a.rank - b.rank);
                    const curSortIdx = sortedD.findIndex(p => p.index === activeIdx);

                    // Timer
                    const turnStarted = typeof turnStartedAtMs !== 'undefined' ? turnStartedAtMs : null;
                    const elapsed     = turnStarted ? Math.floor((window.serverNow() - turnStarted) / 1000) : null;
                    const limitSec    = typeof TURN_TIME_LIMIT_MS !== 'undefined' ? TURN_TIME_LIMIT_MS / 1000 : '?';

                    // Response window
                    const rw = ss?.responseWindow;
                    const rwState = rw ? {
                        open:      rw.isResponseWindowOpen,
                        caster:    rw.currentCaster,
                        pending:   rw.pendingScrollData?.name || null,
                        responded: Array.from(rw.respondingPlayers || []),
                        stack:     (rw.responseStack || []).map(e => ({
                            name:       e.scrollData?.name,
                            caster:     e.casterIndex,
                            isCounter:  !!e.isCounter,
                            isResponse: !!e.isResponse,
                            isOriginal: !!e.isOriginal,
                            result:     e.result
                        }))
                    } : null;

                    // ── output ────────────────────────────────────────────────
                    console.group('%c🔍 dumpGameDebug() - Full Game Snapshot', 'color:#d4ac0d;font-weight:bold;font-size:14px');

                    // Players & multiplayer
                    console.group('👥 Players & Multiplayer');
                    console.log('activePlayerIndex:', activeIdx, ' | myPlayerIndex:', myIdx, ' | totalPlayers:', numP);
                    console.log('isMultiplayer:', typeof isMultiplayer !== 'undefined' ? isMultiplayer : '?',
                                ' | isHost:',   typeof isHost          !== 'undefined' ? isHost         : '?');
                    console.log('currentGameId:', typeof currentGameId  !== 'undefined' ? currentGameId  : '?');
                    console.log('allPlayersData:', typeof allPlayersData !== 'undefined' ? allPlayersData : []);
                    console.groupEnd();

                    // Turn state
                    console.group('⏱️ Turn State');
                    console.log('currentTurnNumber:',      typeof currentTurnNumber       !== 'undefined' ? currentTurnNumber       : '?');
                    console.log('lastReceivedTurnNumber:', typeof lastReceivedTurnNumber  !== 'undefined' ? lastReceivedTurnNumber  : '?');
                    console.log('turnStartedAt:',          turnStarted ? new Date(turnStarted).toISOString() + ' (' + elapsed + 's elapsed, limit ' + limitSec + 's)' : '?');
                    console.log('isEndingTurn:',    typeof isEndingTurn    !== 'undefined' ? isEndingTurn    : '?');
                    console.log('isPlacementPhase:', typeof isPlacementPhase !== 'undefined' ? isPlacementPhase : '?');
                    console.log('playerTilesPlaced:', typeof playerTilesPlaced !== 'undefined' ? Array.from(playerTilesPlaced) : '?');
                    console.groupEnd();

                    // Turn order
                    console.group('🔄 Turn Order');
                    console.log('sorted:', sortedD.map(p => '[' + p.index + '] ' + (p.color || '?') + ' rank' + p.rank).join(' → '));
                    console.log('currentSortedIndex:', curSortIdx,
                        curSortIdx === -1 ? ' ⚠️ ACTIVE PLAYER NOT FOUND IN SORT - TURN ORDER BUG' :
                        curSortIdx >= 0 && sortedD.length > 0 ? ' → next: [' + sortedD[(curSortIdx + 1) % sortedD.length].index + ']' : '');
                    console.groupEnd();

                    // AP
                    console.group('⚡ AP');
                    console.log('currentAP:', typeof currentAP !== 'undefined' ? currentAP : '?',
                                ' | voidAP:', typeof voidAP   !== 'undefined' ? voidAP     : '?');
                    console.groupEnd();

                    // Scroll state per player
                    console.group('📜 Scroll State (all players)');
                    const printCount = Math.max(numP, ss?.playerScrolls?.length || 0, posArr.length);
                    for (let i = 0; i < printCount; i++) {
                        const scrollData = sumScrolls(i);
                        const isMe       = i === myIdx    ? ' ← ME'          : '';
                        const isActive   = i === activeIdx ? ' ← ACTIVE TURN' : '';
                        const cascade    = ss?.hasPendingCascade?.(i) ? ' ⚠️ CASCADE PENDING' : '';
                        console.group('Player ' + i + isMe + isActive + cascade);
                        console.log('hand:',      scrollData.hand.length      ? scrollData.hand      : '(empty)');
                        console.log('active:',    scrollData.active.length    ? scrollData.active    : '(empty)');
                        console.log('activated:', scrollData.activated.length ? scrollData.activated : '(none)');
                        console.groupEnd();
                    }
                    console.groupEnd();

                    // Stone pools
                    console.group('💎 Stone Pools');
                    for (let i = 0; i < Math.max(numP, poolsArr.length); i++) {
                        const isMe     = i === myIdx     ? ' ← ME'          : '';
                        const isActive = i === activeIdx ? ' ← ACTIVE TURN' : '';
                        console.log('Player ' + i + isMe + isActive + ':', poolsArr[i] || '(no pool)');
                    }
                    const srcPool = (typeof stonePools !== 'undefined') ? stonePools : (window.stonePools || null);
                    console.log('sourcePool (board):', srcPool);
                    console.groupEnd();

                    // Common area
                    console.group('🌐 Common Area');
                    console.log('scrolls:', ss?.getCommonAreaScrolls ? ss.getCommonAreaScrolls() : '?');
                    if (ss?.commonArea) console.log('raw:', ss.commonArea);
                    console.groupEnd();

                    // Active buffs
                    console.group('✨ Active Buffs');
                    const buffs = ss?.scrollEffects?.activeBuffs || {};
                    const bKeys = Object.keys(buffs);
                    if (bKeys.length === 0) console.log('(none)');
                    else bKeys.forEach(k => console.log(k + ':', buffs[k]));
                    console.groupEnd();

                    // Response window
                    console.group('🪟 Response Window');
                    if (!rwState) console.log('(not initialized)');
                    else {
                        console.log('open:', rwState.open, ' | caster:', rwState.caster, ' | pending:', rwState.pending);
                        console.log('responded:', rwState.responded);
                        if (rwState.stack.length > 0) console.log('stack:', rwState.stack);
                    }
                    console.groupEnd();

                    // Player positions
                    console.group('🗺️ Player Positions (' + posArr.length + ')');
                    posArr.forEach(function(p, i) {
                        if (p) console.log('Player ' + i + ': x=' + (p.x != null ? p.x.toFixed(1) : '?') + ' y=' + (p.y != null ? p.y.toFixed(1) : '?') + ' color=' + p.color + ' element=' + p.element);
                        else   console.log('Player ' + i + ': (not placed)');
                    });
                    console.groupEnd();

                    // Known bugs
                    const bugs = window.KNOWN_BUGS || [];
                    if (bugs.length > 0) {
                        console.group('📋 Known Bugs (' + bugs.length + ')');
                        bugs.forEach(function(b, i) {
                            console.log('%c' + (i + 1) + '. [' + b.status.toUpperCase() + '] ' + b.id + ': ' + b.title, 'color:#f39c12;font-weight:bold');
                            console.log('   ' + b.description);
                        });
                        console.groupEnd();
                    }

                    console.groupEnd(); // end main group
                } catch (e) {
                    console.error('dumpGameDebug failed:', e);
                }
            };

            // Aliases so old muscle memory still works
            window.debug        = window.dumpGameDebug;
            window.dumpScrollDebug = window.dumpGameDebug;
        }

        function isAdjacentToPlayer(x, y) {
            if (!playerPosition) return false;

            // Get hex coordinates for both positions
            const playerHex = pixelToHex(playerPosition.x, playerPosition.y, TILE_SIZE);
            const targetHex = pixelToHex(x, y, TILE_SIZE);

            // Calculate axial distance
            const dq = Math.abs(playerHex.q - targetHex.q);
            const dr = Math.abs(playerHex.r - targetHex.r);
            const ds = Math.abs((-playerHex.q - playerHex.r) - (-targetHex.q - targetHex.r));

            // Adjacent means distance = 1 in hex coordinates
            const hexDistance = Math.max(dq, dr, ds);

            const isAdj = hexDistance === 1;
            if (shouldDebugLog('isAdjacentToPlayer', 500)) {
                console.log(`📍 isAdjacentToPlayer: player=(${playerHex.q},${playerHex.r}), target=(${targetHex.q},${targetHex.r}), distance=${hexDistance}, adjacent=${isAdj}`);
            }

            return isAdj;
        }

        // Check if a position is within valid stone placement range (considering buffs)
        function isInPlacementRange(x, y, stoneType) {
            if (!playerPosition) return false;

            // Rule: stones may only be placed while the pawn stands on an
            // UNOCCUPIED hex. Standing on a stone (e.g. mid wind-chain)
            // blocks all placement until the pawn steps off. Checked before
            // the placement-range buffs so it applies even under Avalanche /
            // Seed the Skies / Mason's Savvy.
            const stoneUnderPawn = placedStones.some(s =>
                Math.hypot(s.x - playerPosition.x, s.y - playerPosition.y) < 5);
            if (stoneUnderPawn) return false;

            // Rule: stones may never land on a player tile or its bridge hexes
            // (any player's, including your own) — checked before the
            // placement-range buffs so it applies even under Avalanche / Seed
            // the Skies / Mason's Savvy, same as the stone-under-pawn rule above.
            if (isPositionOnPlayerTile(x, y, getAllHexagonPositions())) return false;

            // Get current player index (use activePlayerIndex in single player, myPlayerIndex in multiplayer)
            const currentPlayerIdx = (typeof myPlayerIndex !== 'undefined' && myPlayerIndex !== null) ? myPlayerIndex : activePlayerIndex;

            // Check for global placement buff (Avalanche - any stone anywhere)
            if (spellSystem && spellSystem.scrollEffects && spellSystem.scrollEffects.hasGlobalPlacement(currentPlayerIdx)) {
                console.log(`ℹ️ Global placement active - allowing stone at any position`);
                return true;
            }

            // Seed the Skies: allow water/wind stones anywhere this turn
            if (stoneType && spellSystem && spellSystem.scrollEffects) {
                const buff = spellSystem.scrollEffects.activeBuffs?.waterWindGlobalPlacement;
                if (buff && buff.playerIndex === currentPlayerIdx && (stoneType === 'water' || stoneType === 'wind')) {
                    console.log(`ℹ️ Seed the Skies active - allowing ${stoneType} stone at any position`);
                    return true;
                }
            }

            // Check for extended placement buff (Mason's Savvy - earth stones within 5 hexes)
            if (stoneType && spellSystem && spellSystem.scrollEffects) {
                const extended = spellSystem.scrollEffects.hasExtendedPlacement(stoneType, currentPlayerIdx);
                if (extended.active) {
                    // Calculate hex distance
                    const playerHex = pixelToHex(playerPosition.x, playerPosition.y, TILE_SIZE);
                    const targetHex = pixelToHex(x, y, TILE_SIZE);

                    const dq = Math.abs(playerHex.q - targetHex.q);
                    const dr = Math.abs(playerHex.r - targetHex.r);
                    const ds = Math.abs((-playerHex.q - playerHex.r) - (-targetHex.q - targetHex.r));
                    const hexDistance = Math.max(dq, dr, ds);

                    if (hexDistance <= extended.range) {
                        console.log(`🎯 Extended placement active - allowing ${stoneType} stone at distance ${hexDistance} (max ${extended.range})`);
                        return true;
                    }
                }
            }

            // Default: must be adjacent to player
            return isAdjacentToPlayer(x, y);
        }

        function findNearestHexPosition(x, y) {
            // Similar to findValidStonePosition, but doesn't care about stones/player
            // Used for player movement pathfinding
            const hexPositions = getAllHexagonPositions();
            let nearest = null;
            let minDist = Infinity;

            hexPositions.forEach(pos => {
                const dist = Math.sqrt(Math.pow(x - pos.x, 2) + Math.pow(y - pos.y, 2));
                if (dist < minDist) {
                    minDist = dist;
                    nearest = pos;
                }
            });

            if (nearest && minDist < TILE_SIZE * 2) {
                return { x: nearest.x, y: nearest.y, valid: true };
            }

            return { x: x, y: y, valid: false };
        }

        function findNearestSnapPoint(x, y, isPlayerTile = false, excludeTileId = null) {
            const largeHexSize = TILE_SIZE * 4;
            const hexCoords = pixelToHex(x, y, largeHexSize);
            const snapPos = hexToPixel(hexCoords.q, hexCoords.r, largeHexSize);
            const distance = Math.sqrt(Math.pow(x - snapPos.x, 2) + Math.pow(y - snapPos.y, 2));

            if (distance < SNAP_THRESHOLD) {
                // Check if a tile already exists at this position
                const tileExists = placedTiles.some(tile => {
                    const dist = Math.sqrt(Math.pow(tile.x - snapPos.x, 2) + Math.pow(tile.y - snapPos.y, 2));
                    return dist < TILE_SIZE; // Tiles are considered overlapping if centers are very close
                });

                if (tileExists) {
                    return { x: x, y: y, snapped: false }; // Don't snap if position is occupied
                }

                // PLAYER TILE SPECIAL RULE: Must touch at least 2 unrevealed tiles
                if (isPlayerTile) {
                    const touchingUnrevealedCount = countTouchingUnrevealedTiles(snapPos.x, snapPos.y);
                    if (touchingUnrevealedCount < 2) {
                        console.log(`❌ Player tile at (${snapPos.x.toFixed(1)}, ${snapPos.y.toFixed(1)}) only touches ${touchingUnrevealedCount} unrevealed tile(s), need 2+`);
                        return { x: x, y: y, snapped: false }; // Don't allow placement
                    }
                    console.log(`✅ Player tile at (${snapPos.x.toFixed(1)}, ${snapPos.y.toFixed(1)}) touches ${touchingUnrevealedCount} unrevealed tiles`);
                }

                // TELEKINESIS RULE: Must touch at least 2 other tiles (matches the
                // "Tiles must touch 2+ others" status text and the drag-fail message
                // shown to players — this used to say "1+" here, which let a tile land
                // on a spot touching only a single neighbor). excludeTileId lets a
                // caller checking a spot adjacent to the tile's OWN original position
                // (e.g. the bot's dry-run destination search) skip counting that tile
                // as a neighbor of its own vacated spot.
                if (window.telekinesisState && window.telekinesisState.active) {
                    const touchingCount = countTouchingTiles(snapPos.x, snapPos.y, excludeTileId);
                    if (touchingCount < 2) {
                        console.log(`❌ Telekinesis: tile at (${snapPos.x.toFixed(1)}, ${snapPos.y.toFixed(1)}) touches ${touchingCount} tile(s), need 2+`);
                        return { x: x, y: y, snapped: false };
                    }
                    console.log(`✅ Telekinesis: tile at (${snapPos.x.toFixed(1)}, ${snapPos.y.toFixed(1)}) touches ${touchingCount} tiles`);
                }

                return { x: snapPos.x, y: snapPos.y, snapped: true };
            }
            return { x: x, y: y, snapped: false };
        }

        function countTouchingUnrevealedTiles(tileX, tileY) {
            // Get the 6 adjacent tile positions in the large hex grid
            const largeHexSize = TILE_SIZE * 4;
            const tileHex = pixelToHex(tileX, tileY, largeHexSize);
            
            const adjacentOffsets = [
                { q: 1, r: 0 },   // East
                { q: 0, r: 1 },   // Southeast
                { q: -1, r: 1 },  // Southwest
                { q: -1, r: 0 },  // West
                { q: 0, r: -1 },  // Northwest
                { q: 1, r: -1 }   // Northeast
            ];

            let unrevealedCount = 0;

            adjacentOffsets.forEach(offset => {
                const adjQ = tileHex.q + offset.q;
                const adjR = tileHex.r + offset.r;
                const adjPos = hexToPixel(adjQ, adjR, largeHexSize);

                // Check if there's an unrevealed (flipped) tile at this position
                const adjacentTile = placedTiles.find(tile => {
                    const dist = Math.sqrt(Math.pow(tile.x - adjPos.x, 2) + Math.pow(tile.y - adjPos.y, 2));
                    return dist < TILE_SIZE;
                });

                if (adjacentTile && adjacentTile.flipped) {
                    unrevealedCount++;
                }
            });

            return unrevealedCount;
        }

        // Count ALL adjacent tiles (revealed or unrevealed) — used by Telekinesis.
        // excludeTileId skips a specific tile id when scanning for neighbors — pass
        // the tile currently being considered for a move so a candidate spot right
        // next to that tile's OWN (soon-to-be-vacated) position doesn't get credited
        // with "touching" a neighbor that won't actually be there once it moves.
        function countTouchingTiles(tileX, tileY, excludeTileId = null) {
            const largeHexSize = TILE_SIZE * 4;
            const tileHex = pixelToHex(tileX, tileY, largeHexSize);
            const adjacentOffsets = [
                { q: 1, r: 0 }, { q: 0, r: 1 }, { q: -1, r: 1 },
                { q: -1, r: 0 }, { q: 0, r: -1 }, { q: 1, r: -1 }
            ];
            let count = 0;
            adjacentOffsets.forEach(offset => {
                const adjPos = hexToPixel(tileHex.q + offset.q, tileHex.r + offset.r, largeHexSize);
                const found = placedTiles.find(t => {
                    if (excludeTileId !== null && t.id === excludeTileId) return false;
                    const dist = Math.sqrt(Math.pow(t.x - adjPos.x, 2) + Math.pow(t.y - adjPos.y, 2));
                    return dist < TILE_SIZE;
                });
                if (found) count++;
            });
            return count;
        }

        // ----------------------------------------------------------------
        // LEGAL PLACEMENT HIGHLIGHTS — faint glowing hex outlines shown at
        // every empty slot a drag-in-progress could legally land on. Computed
        // once when the drag starts (not tracked per-frame) since the set of
        // legal slots only changes when the board changes, not when the
        // cursor moves. Used for player-tile placement and Telekinesis moves.
        // ----------------------------------------------------------------
        function clearLegalPlacementHighlights() {
            const g = document.getElementById('legal-placement-highlights');
            if (g && g.parentNode) g.parentNode.removeChild(g);
        }

        // What color to tint a player tile's legal-slot highlights before it's
        // placed — mirrors placeTile()'s own color-assignment logic (the
        // multiplayer pre-assigned-playerColor branch and the local rank-order
        // branch) exactly, but read-only: it must NOT mutate playerColor or
        // gameSessionColors, since the drag can still be cancelled.
        function previewUpcomingPlayerTileColor() {
            if (isMultiplayer && playerColor) {
                return PLAYER_COLORS[playerColor] || playerColor; // name or already-hex
            }
            const colorRankOrder = ['purple', 'yellow', 'red', 'blue', 'green'];
            const playerIndex = playerPositions.length;
            return playerIndex < 5 ? PLAYER_COLORS[colorRankOrder[playerIndex]] : '#fff';
        }

        function showLegalPlacementHighlights(mode, excludeTileId = null, color = null) {
            clearLegalPlacementHighlights();
            if (typeof viewport === 'undefined' || !viewport) return;

            // Candidate centers = large-hex-grid neighbors of every existing tile
            // (same geometry countTouchingTiles/countTouchingUnrevealedTiles and
            // driveTelekinesis's own destination search already use) — NOT
            // getAllHexagonPositions(), which returns fine-grained sub-hex points
            // spaced ~TILE_SIZE apart for stone/player positioning. Drawing a
            // full tile-sized outline at every one of those densely-packed points
            // was the earlier bug: dozens of oversized, overlapping shapes that
            // didn't correspond to real tile-placement centers at all.
            const largeHexSize = TILE_SIZE * 4;
            const offsets = [[1, 0], [0, 1], [-1, 1], [-1, 0], [0, -1], [1, -1]];
            const candidates = new Map();
            placedTiles.forEach(tile => {
                const hex = pixelToHex(tile.x, tile.y, largeHexSize);
                offsets.forEach(([dq, dr]) => {
                    const p = hexToPixel(hex.q + dq, hex.r + dr, largeHexSize);
                    const key = `${Math.round(p.x)},${Math.round(p.y)}`;
                    if (!candidates.has(key)) candidates.set(key, p);
                });
            });

            const points = makeTileHexPoints(largeHexSize); // full tile-sized outline

            const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            g.setAttribute('id', 'legal-placement-highlights');
            g.setAttribute('class', 'legal-placement-highlights');

            // Color set as real SVG presentation attributes, not a CSS custom
            // property — a var() chain that ever resolves to an invalid token
            // makes `fill` fall back to ITS OWN initial value, which is opaque
            // BLACK per the SVG spec, not "no color at all". That's what was
            // actually happening: the highlights were rendering as solid black
            // hexes instead of a translucent tint. Setting fill/stroke directly
            // here removes any such fallback chain from the picture entirely.
            const hexColor = color || '#e6c79c'; // falls back to the gold accent

            candidates.forEach(pos => {
                const occupied = placedTiles.some(t =>
                    Math.sqrt(Math.pow(t.x - pos.x, 2) + Math.pow(t.y - pos.y, 2)) < TILE_SIZE);
                if (occupied) return;

                let legal = false;
                if (mode === 'player-tile') {
                    legal = countTouchingUnrevealedTiles(pos.x, pos.y) >= 2;
                } else if (mode === 'telekinesis') {
                    legal = countTouchingTiles(pos.x, pos.y, excludeTileId) >= 2;
                }
                if (!legal) return;

                const hex = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
                hex.setAttribute('points', points);
                hex.setAttribute('class', 'legal-placement-hex');
                hex.setAttribute('transform', `translate(${pos.x}, ${pos.y})`);
                hex.setAttribute('fill', hexColor);
                hex.setAttribute('fill-opacity', '0.16'); // translucent — background shows through
                hex.setAttribute('stroke', hexColor);
                hex.setAttribute('stroke-width', '2');
                hex.style.filter = `drop-shadow(0 0 6px ${hexColor})`;
                g.appendChild(hex);
            });

            // Keep the highlight layer UNDER the ghost tile that follows the
            // cursor (SVG paints later siblings on top) — otherwise the glow
            // hexes sit above the dragged tile and it visibly slides beneath
            // them instead of the other way around.
            if (typeof ghostTile !== 'undefined' && ghostTile && ghostTile.parentNode === viewport) {
                viewport.insertBefore(g, ghostTile);
            } else {
                viewport.appendChild(g);
            }
        }

        function tileHasStones(tileId) {
            const tile = placedTiles.find(t => t.id === tileId);
            if (!tile) return false;

            const s = TILE_SIZE;
            const hexagons = [
                { q: 0, r: 0 },
                { q: 1, r: 0 }, { q: 0, r: 1 }, { q: -1, r: 1 },
                { q: -1, r: 0 }, { q: 0, r: -1 }, { q: 1, r: -1 },
                { q: 2, r: -1 }, { q: 1, r: 1 }, { q: -1, r: 2 },
                { q: -2, r: 1 }, { q: -1, r: -1 }, { q: 1, r: -2 }
            ];

            return hexagons.some(hex => {
                const localPos = hexToPixel(hex.q, hex.r, s);
                const globalX = tile.x + localPos.x;
                const globalY = tile.y + localPos.y;

                return placedStones.some(stone => {
                    const dist = Math.sqrt(Math.pow(stone.x - globalX, 2) + Math.pow(stone.y - globalY, 2));
                    return dist < 5;
                });
            });
        }

        // Check if any player is standing on a tile (by tile id)
        function tileHasPlayersById(tileId) {
            return playerCountOnTileById(tileId) > 0;
        }

        // How many player pawns are standing on this tile. Telekinesis now
        // allows moving a tile with ONE player (carried along + recentered,
        // same as Shifting Sands); 2+ still blocks it.
        function playerCountOnTileById(tileId) {
            const tile = placedTiles.find(t => t.id === tileId);
            if (!tile || typeof playerPositions === 'undefined') return 0;
            const tileRadius = TILE_SIZE * 4;
            let n = 0;
            playerPositions.forEach(pos => {
                if (!pos) return;
                const dist = Math.sqrt(Math.pow(pos.x - tile.x, 2) + Math.pow(pos.y - tile.y, 2));
                if (dist < tileRadius) n++;
            });
            return n;
        }

        // Bridge check: would removing this tile leave any of its neighbors with 0 neighbors?
        // Used by Telekinesis to prevent stranding tiles (and players on them).
        function tileIsBridge(tileId) {
            const tile = placedTiles.find(t => t.id === tileId);
            if (!tile) return false;
            const largeHexSize = TILE_SIZE * 4;
            const tileHex = pixelToHex(tile.x, tile.y, largeHexSize);
            const adjacentOffsets = [
                { q: 1, r: 0 }, { q: 0, r: 1 }, { q: -1, r: 1 },
                { q: -1, r: 0 }, { q: 0, r: -1 }, { q: 1, r: -1 }
            ];

            // Find all neighbors of this tile
            const neighbors = [];
            adjacentOffsets.forEach(offset => {
                const adjPos = hexToPixel(tileHex.q + offset.q, tileHex.r + offset.r, largeHexSize);
                const found = placedTiles.find(t => {
                    if (t.id === tileId) return false; // exclude self
                    const dist = Math.sqrt(Math.pow(t.x - adjPos.x, 2) + Math.pow(t.y - adjPos.y, 2));
                    return dist < TILE_SIZE;
                });
                if (found) neighbors.push(found);
            });

            // For each neighbor, count how many neighbors IT would have without this tile
            for (const neighbor of neighbors) {
                const nHex = pixelToHex(neighbor.x, neighbor.y, largeHexSize);
                let otherNeighborCount = 0;
                adjacentOffsets.forEach(offset => {
                    const adjPos = hexToPixel(nHex.q + offset.q, nHex.r + offset.r, largeHexSize);
                    const found = placedTiles.find(t => {
                        if (t.id === tileId) return false; // exclude the tile being removed
                        if (t.id === neighbor.id) return false; // exclude self
                        const dist = Math.sqrt(Math.pow(t.x - adjPos.x, 2) + Math.pow(t.y - adjPos.y, 2));
                        return dist < TILE_SIZE;
                    });
                    if (found) otherNeighborCount++;
                });
                if (otherNeighborCount === 0) return true; // This neighbor would be stranded
            }
            return false;
        }

        function updateTileClasses() {
            placedTiles.forEach(tile => {
                if (tileHasStones(tile.id)) {
                    tile.element.classList.add('has-stones');
                } else {
                    tile.element.classList.remove('has-stones');
                }
            });
        }

        // Shrine marker on a shrine tile: a dark hexagon plate carved into the
        // floor with an element-colour edge and the element symbol drawn as light with a dark outline, so it reads
        // clearly on any tile art (owner 2026-10-07). Same idea as the 3D stones
        // (js/piece-3d.js buildSym): the symbol image is used as an alpha mask
        // over flat colour; the outline is the shape stamped 8 times nudged
        // outward. Masks, not SVG filters (Chrome keeps a filter's picture from
        // an older zoom, so it looks blurry). The void art is light dots on a
        // dark disc, so it masks by brightness instead of shape.
        let _shrineSymSeq = 0;
        // Redraw every shrine marker (their carving light depends on the map
        // rotation). Called by js/piece-3d.js when the map turns.
        window.refreshShrineMarkers = function () {
            document.querySelectorAll('#viewport .shrine-marker[data-shrine-type]').forEach(old => {
                const fresh = createShrineMarker(old.getAttribute('data-shrine-type'));
                const t = old.getAttribute('transform');
                if (t) fresh.setAttribute('transform', t);
                old.replaceWith(fresh);
            });
        };
        function createShrineMarker(shrineType) {
            const NS = 'http://www.w3.org/2000/svg';
            const g = document.createElementNS(NS, 'g');
            g.setAttribute('class', 'shrine-marker');
            g.setAttribute('data-shrine-type', shrineType);

            // Color mapping for shrine types
            const shrineColors = {
                'earth': '#69d83a',
                'water': '#5894f4',
                'fire': '#ed1b43',
                'wind': '#ffce00',
                'void': '#9458f4',
                'catacomb': '#c8a870'
            };
            const color = shrineColors[shrineType] || '#cccccc';
            const tint = (hex, to, a) => {
                const c = hex.replace('#', ''), t = to === 'white' ? 255 : 0;
                return '#' + [0, 2, 4].map(i => {
                    const v = parseInt(c.slice(i, i + 2), 16);
                    return Math.round(v + (t - v) * a).toString(16).padStart(2, '0');
                }).join('');
            };
            const mk = (tag, attrs, parent) => {
                const e = document.createElementNS(NS, tag);
                for (const k in attrs) e.setAttribute(k, attrs[k]);
                (parent || g).appendChild(e);
                return e;
            };
            const R = 13; // a stone is 12; the shrine hex fits about 17

            // A hexagon plate carved into the floor (pointy top, like the grid
            // hexes): round shiny domes are stones, carved hexes are shrines
            // (owner 2026-10-07). Light comes from the top left of the SCREEN,
            // the same light as the 3D pawns and stones (js/piece-3d.js), so the
            // sunken plate's inner walls facing the light are in shadow and the
            // far walls catch it. The marker turns with the map, so the light is
            // worked out for the current map rotation (`lx, ly` = direction to
            // the light in board space); piece-3d.js calls
            // window.refreshShrineMarkers() when the map turns.
            const rotRad = ((typeof viewportRotation === 'number' ? viewportRotation : 0) * Math.PI) / 180;
            const lx = (-Math.cos(rotRad) - Math.sin(rotRad)) / Math.SQRT2;   // screen (-1,-1)/sqrt2 turned back by the map rotation
            const ly = (Math.sin(rotRad) - Math.cos(rotRad)) / Math.SQRT2;
            const hexPt = (rad, k) => {
                const a = (Math.PI / 180) * (60 * k - 90);
                return `${(rad * Math.cos(a)).toFixed(2)},${(rad * Math.sin(a)).toFixed(2)}`;
            };
            const hexPts = (rad) => [0, 1, 2, 3, 4, 5].map(k => hexPt(rad, k)).join(' ');
            const line = (rad, ks) => ks.map(k => hexPt(rad, k)).join(' ');
            // vertices: 0 top, 1 upper right, 2 lower right, 3 bottom, 4 lower left, 5 upper left
            mk('polygon', { points: hexPts(R + 2.5), fill: tint(color, 'black', 0.78), 'fill-opacity': 0.94, stroke: color, 'stroke-width': 1.4, 'stroke-linejoin': 'round' });
            // each inner wall: edge k runs from vertex k to k+1, its outward
            // normal points at 60k - 60 degrees; facing the light = shadow
            for (let k = 0; k < 6; k++) {
                const na = (Math.PI / 180) * (60 * k - 60);
                const face = Math.cos(na) * lx + Math.sin(na) * ly; // 1 = faces the light
                if (face > 0.05) mk('polyline', { points: line(R + 1.2, [k, (k + 1) % 6]), fill: 'none', stroke: '#000', 'stroke-width': 2.4, 'stroke-opacity': (0.55 * face).toFixed(2), 'stroke-linecap': 'round' });
                if (face < -0.05) mk('polyline', { points: line(R + 1.4, [k, (k + 1) % 6]), fill: 'none', stroke: tint(color, 'white', 0.55), 'stroke-width': 1, 'stroke-opacity': (-0.55 * face).toFixed(2), 'stroke-linecap': 'round' });
            }
            // engraved inner ring: shadow line nudged toward the light, colour line away
            const nudge = (d) => `translate(${(lx * d).toFixed(2)} ${(ly * d).toFixed(2)})`;
            mk('polygon', { points: hexPts(R - 0.8), fill: 'none', stroke: '#000', 'stroke-width': 0.8, 'stroke-opacity': 0.35, 'stroke-linejoin': 'round', transform: nudge(0.42) });
            mk('polygon', { points: hexPts(R - 0.8), fill: 'none', stroke: color, 'stroke-width': 0.6, 'stroke-opacity': 0.5, 'stroke-linejoin': 'round', transform: nudge(-0.42) });

            // The symbol as an inlay in carved grooves: groove shadow toward the
            // light, light catch on the far side, a thin outline, then
            // the glowing inlay itself.
            const href = STONE_TYPES[shrineType]?.img || '';
            if (href) {
                const w = R * 1.6, x = -w / 2, y = -w / 2;
                const lum = shrineType === 'void';
                const shifts8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [0.71, 0.71], [-0.71, 0.71], [0.71, -0.71], [-0.71, -0.71]];
                // [fill, opacity, shifts]
                [[ '#000', 0.5, [[lx * 0.85, ly * 0.85]] ],
                 [ tint(color, 'white', 0.6), 0.35, [[-lx * 0.7, -ly * 0.7]] ],
                 [ tint(color, 'black', 0.8), 1, shifts8.map(([dx, dy]) => [dx * 0.4, dy * 0.4]) ],
                 [ tint(color, 'white', lum ? 0.7 : 0.4), 1, [[0, 0]] ]].forEach(([fill, op, shifts]) => {
                    const id = 'shrine-sym-' + (++_shrineSymSeq);
                    const m = mk('mask', { id, maskUnits: 'userSpaceOnUse', x: -R * 2, y: -R * 2, width: R * 4, height: R * 4 });
                    m.style.maskType = lum ? 'luminance' : 'alpha';
                    shifts.forEach(([dx, dy]) => mk('image', {
                        href, x: x + dx, y: y + dy, width: w, height: w, preserveAspectRatio: 'xMidYMid meet'
                    }, m));
                    mk('rect', { x: -R * 2, y: -R * 2, width: R * 4, height: R * 4, fill, 'fill-opacity': op, mask: `url(#${id})` });
                });
            }

            return g;
        }

        let nextTileId = 1; // Global counter for unique tile IDs

        function placeTile(x, y, rotation = 0, flipped = false, shrineType = null, isPlayerTile = false, skipMultiplayerLogic = false, forcedTileId = null) {
            console.log(`   placeTile called: x=${x.toFixed(1)}, y=${y.toFixed(1)}, rotation=${rotation}, flipped=${flipped}, shrineType=${shrineType}, isPlayerTile=${isPlayerTile}, skipMP=${skipMultiplayerLogic}`);
            const tileId = (forcedTileId !== null && forcedTileId !== undefined) ? forcedTileId : nextTileId++;
            if (forcedTileId !== null && forcedTileId !== undefined) {
                nextTileId = Math.max(nextTileId, forcedTileId + 1);
            }
            console.log(`   Assigned tileId: ${tileId}`);
            let tilePlayerIndex = null; // Will be set if this is a player tile
            const tileGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            tileGroup.setAttribute('class', isPlayerTile ? 'placed-tile player-tile' : 'placed-tile');
            tileGroup.setAttribute('data-tile-id', tileId);
            tileGroup.setAttribute('transform', `translate(${x}, ${y})`);

            const tile = createTileGroup(TILE_SIZE, rotation, flipped);
            tileGroup.appendChild(tile);

            // Draw from deck if shrine type not provided
            if (shrineType === null) {
                shrineType = drawNextTileFromDeck();
                if (shrineType === null) {
                    // No more tiles in deck
                    return null;
                }
            }

            // Tag revealed tiles with shrine type so CSS hover matches element color.
            // Hidden (flipped) tiles stay untagged — their element is unknown to the player.
            if (!flipped && shrineType !== 'player') {
                tileGroup.setAttribute('data-shrine', shrineType);
            }

            // Hidden (face-down) tiles show a generic "unflipped" overlay — never the
            // real shrine art, so the element stays unknown to the player until revealed.
            if (flipped && shrineType !== 'player') {
                addTileOverlay(tileGroup, 'unflipped');
            }

            // Check if this is the player tile
            let tilePlayerColorName = null;
            if (shrineType === 'player') {
                isPlayerTile = true;

                const playerIndex = playerPositions.length;
                let assignedColor;

                // In multiplayer, use the pre-assigned playerColor
                // In local mode, assign colors in rank order
                // skipMultiplayerLogic = true means playerColor is already hex (from placePlayerTileVisually),
                // so skip the name→hex lookup to avoid PLAYER_COLORS[hexValue] = undefined.
                if (isMultiplayer && playerColor && !skipMultiplayerLogic) {
                    assignedColor = PLAYER_COLORS[playerColor];
                    playerColor = assignedColor; // Normalise to hex so placePlayer always gets a hex value
                    console.log(`🎨 Multiplayer - Using assigned color: ${playerColor}`);
                } else if (isMultiplayer && playerColor && skipMultiplayerLogic) {
                    assignedColor = playerColor; // already hex
                    console.log(`🎨 Multiplayer (visual-only) - Color already hex: ${playerColor}`);
                } else {
                    // Local game - assign next color in rank order
                    const colorRankOrder = ['purple', 'yellow', 'red', 'blue', 'green'];
                    if (playerIndex < 5) {
                        const colorName = colorRankOrder[playerIndex];
                        assignedColor = PLAYER_COLORS[colorName];
                        gameSessionColors.add(colorName);
                        playerColor = assignedColor;
                        console.log(`🎨 Local game - Player ${playerIndex + 1} color assigned: ${colorName} (${assignedColor})`);
                    } else {
                        console.warn('⚠️ Maximum 5 players reached!');
                        assignedColor = '#fff'; // Fallback to white
                        playerColor = assignedColor;
                    }
                }

                // Each player color gets its own tile-image overlay (see window.tileOverlaySettings).
                tilePlayerColorName = Object.keys(PLAYER_COLORS).find(name => PLAYER_COLORS[name] === assignedColor) || null;
                if (tilePlayerColorName) {
                    addTileOverlay(tileGroup, `player_${tilePlayerColorName}`);
                }

                // Add color tint overlay to player tile
                const tintOverlay = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
                tintOverlay.setAttribute('cx', 0);
                tintOverlay.setAttribute('cy', 0);
                tintOverlay.setAttribute('r', TILE_SIZE * 2); // Cover the whole tile
                tintOverlay.setAttribute('fill', assignedColor);
                tintOverlay.setAttribute('opacity', '0.38'); // owner 2026-10-01: was 0.15, too faint
                tintOverlay.setAttribute('pointer-events', 'none'); // Don't interfere with clicks
                tileGroup.appendChild(tintOverlay);

                // Border around the whole tile in the player's color (owner 2026-10-01)
                const border = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                border.setAttribute('class', 'player-tile-border');
                border.setAttribute('d', playerTileOutlinePath(TILE_SIZE));
                if (rotation) border.setAttribute('transform', `rotate(${rotation * 60})`);
                border.setAttribute('stroke', assignedColor);
                border.setAttribute('pointer-events', 'none');
                tileGroup.appendChild(border);

                // Store the player index for later use
                tilePlayerIndex = playerIndex;
                
                // Add a group for element symbols on the player tile
                const symbolsGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
                symbolsGroup.setAttribute('class', 'player-tile-element-symbols');
                tileGroup.appendChild(symbolsGroup);
            }

            // Only add shrine marker if NOT flipped and NOT player tile (revealed tiles show shrine)
            if (!flipped && shrineType !== 'player') {
                const shrineMarker = createShrineMarker(shrineType);
                tileGroup.appendChild(shrineMarker);
            }

            tileGroup.addEventListener('mousedown', (e) => {
                // Don't interfere with player dragging
                if (isDraggingPlayer) return;

            if (shouldDebugLog('tileClicked', 500)) {
                console.log(`🖱️ Tile clicked: tileId=${tileId}, position=(${x.toFixed(1)}, ${y.toFixed(1)}), shrine=${shrineType}, flipped=${flipped}, isPlayerTile=${isPlayerTile}, tileMoveMode=${tileMoveMode}`);
            }

                // Player tiles cannot be dragged once placed
                if (isPlayerTile) {
                    console.log(`   ✗ Cannot drag: player tiles are locked in place`);
                    return;
                }

                // Only allow dragging placed tiles if tileMoveMode is enabled
                if (!tileMoveMode) {
                    console.log(`   ✗ Cannot drag: tile move mode is OFF`);
                    return;
                }

                // During Telekinesis, block tiles with 2+ players (one player
                // is carried along, Shifting-Sands style) or that would strand a neighbor
                const tkActive = window.telekinesisState && window.telekinesisState.active;
                const tkBlockPlayer = tkActive && playerCountOnTileById(tileId) >= 2;
                const tkBlockBridge = tkActive && tileIsBridge(tileId);

                if (e.button === 0 && !tileHasStones(tileId) && !tkBlockPlayer && !tkBlockBridge && !isPanning && !isDraggingStone && !isDraggingPlayer) {
                    console.log(`   ✓ Starting drag for tile ${tileId} at (${x.toFixed(1)}, ${y.toFixed(1)})`);
                    e.stopPropagation();
                    e.preventDefault();
                    startTileDrag(tileId, e);
                } else {
                    if (tkBlockPlayer) {
                        console.log(`   ✗ Cannot drag: tile has 2+ players on it`);
                        updateStatus('Cannot move a tile with more than one player on it!');
                    } else if (tkBlockBridge) {
                        console.log(`   ✗ Cannot drag: removing tile would strand a neighbor`);
                        updateStatus('Cannot move this tile - it would strand an adjacent tile!');
                    } else {
                        console.log(`   ✗ Cannot drag: hasStones=${tileHasStones(tileId)}, isPanning=${isPanning}, isDraggingStone=${isDraggingStone}`);
                    }
                }
            });

            // Touch support: start tile drag on tap/drag
            tileGroup.addEventListener('touchstart', (e) => {
                // Don't interfere with player dragging
                if (isDraggingPlayer) return;
                // Player tiles cannot be dragged once placed
                if (isPlayerTile) return;
                // Only allow dragging if tileMoveMode is enabled
                if (!tileMoveMode) return;
                if (tileHasStones(tileId) || isPanning || isDraggingStone || isDraggingPlayer) return;
                // During Telekinesis, block tiles with 2+ players or that would strand a neighbor
                if (window.telekinesisState && window.telekinesisState.active) {
                    if (playerCountOnTileById(tileId) >= 2 || tileIsBridge(tileId)) return;
                }

                if (e.touches && e.touches.length === 1) {
                    e.stopPropagation();
                    e.preventDefault();
                    const t = e.touches[0];
                    startTileDrag(tileId, {
                        clientX: t.clientX,
                        clientY: t.clientY,
                        button: 0,
                        preventDefault: () => {},
                        stopPropagation: () => {}
                    });
                }
            }, { passive: false });


            viewport.insertBefore(tileGroup, snapIndicator);

            placedTiles.push({
                id: tileId,
                x: x,
                y: y,
                rotation: rotation,
                flipped: flipped,
                element: tileGroup,
                shrineType: shrineType,
                isPlayerTile: isPlayerTile,
                playerIndex: isPlayerTile ? tilePlayerIndex : null, // Track which player owns this tile
                playerColorName: isPlayerTile ? tilePlayerColorName : null // For tile-overlay lookups
            });

            updateTileClasses();

            // Player tile: draw its element row (empty rings) right away. Next
            // tick, after callers have fixed the tile's playerIndex.
            if (isPlayerTile) {
                const placed = placedTiles[placedTiles.length - 1];
                setTimeout(() => { try { if (placed.element.isConnected) updatePlayerElementSymbols(placed.playerIndex); } catch (e) {} }, 0);
            }

            // A re-placed REVEALED elemental tile (Telekinesis move, or a
            // snap-back from an invalid Telekinesis drag) is rebuilt here
            // without its element-texture overlay — placeTile only adds
            // overlays for face-down ('unflipped') and player tiles; the
            // shrine texture is otherwise only ever added by revealTile().
            // Rebuild all tile overlays so the moved tile keeps its art.
            if (!flipped && shrineType && shrineType !== 'player'
                    && forcedTileId !== null && forcedTileId !== undefined
                    && typeof window.refreshAllTileOverlays === 'function') {
                window.refreshAllTileOverlays();
            }

            // Place player marker on player tile
            if (isPlayerTile) {
                // Create new player pawn at this tile's position.
                // playerColor is always hex by this point (normalised above for both
                // multiplayer and local paths), so playerPositions stores hex values
                // and COLOR_RANK lookups in game-ui.js work correctly.
                placePlayer(x, y, playerColor);

                // In multiplayer, ensure this player's pawn ends up at playerPositions[myPlayerIndex]
                // regardless of simultaneous placements by other players.  placePlayer() always
                // push()es to the end; if another player's broadcast arrived first, the index is wrong.
                if (isMultiplayer && !skipMultiplayerLogic &&
                        myPlayerIndex !== null && myPlayerIndex !== undefined) {
                    const placed = playerPositions.pop();
                    if (placed) {
                        placed.index = myPlayerIndex;
                        while (playerPositions.length < myPlayerIndex) playerPositions.push(null);
                        playerPositions[myPlayerIndex] = placed;
                        console.log(`🔧 Relocated local pawn to playerPositions[${myPlayerIndex}]`);
                    }
                    // Same correction for the tile record: placeTile captured
                    // playerPositions.length as the owner index, which is wrong
                    // if a remote tile arrived first. The shrine-return win
                    // condition looks tiles up by playerIndex, so fix it here.
                    const ownTile = placedTiles[placedTiles.length - 1];
                    if (ownTile && ownTile.isPlayerTile) {
                        ownTile.playerIndex = myPlayerIndex;
                    }
                    // tilePlayerIndex itself was captured from the SAME stale
                    // playerPositions.length snapshot, and is what actually
                    // gets broadcast + tracked in playerTilesPlaced below —
                    // the two corrections above didn't touch it. Left
                    // uncorrected, a race (a remote placement broadcast
                    // arriving between this client's own placePlayer() call
                    // and this point) permanently attributes THIS placement
                    // to the WRONG player index: playerTilesPlaced gets the
                    // wrong index marked (never reaching totalPlayers with
                    // the real index included), and every other client
                    // advances activePlayerIndex/waits based on the wrong
                    // color too — the true owner's placement phase never
                    // completes, freezing the game waiting on a player who
                    // in fact already placed.
                    tilePlayerIndex = myPlayerIndex;
                }

                // In multiplayer, broadcast tile placement and track placement phase
                // Skip this logic if we're just placing visually from a broadcast
                if (isMultiplayer && !skipMultiplayerLogic) {
                    console.log(`🎮 Player ${tilePlayerIndex} placed tile. Before: activePlayerIndex=${activePlayerIndex}, placed=${Array.from(playerTilesPlaced)}`);
                    playerTilesPlaced.add(tilePlayerIndex);

                    // Broadcast that this player placed their tile
                    broadcastGameAction('player-tile-placed', {
                        playerIndex: tilePlayerIndex
                    });

                    // Check if all players have placed tiles
                    if (playerTilesPlaced.size === totalPlayers) {
                        isPlacementPhase = false;
                        activePlayerIndex = 0; // Reset to first player for normal gameplay
                        console.log('✅ All players have placed their tiles. Game begins!');

                        // Broadcast placement phase end and turn reset
                        const startedAt = window.serverNow();
                        turnStartedAtMs = startedAt;
                        broadcastGameAction('placement-complete', {
                            playerIndex: 0,
                            turnStartedAt: startedAt
                        });
                        if (typeof persistCurrentTurnIndex === 'function') persistCurrentTurnIndex(0);

                        if (isMyTurn()) {
                            updateStatus(`All tiles placed! It's your turn!`);
                        } else {
                            const nextColorName = getPlayerColorName(activePlayerIndex);
                            updateStatus(`All tiles placed! Waiting for ${nextColorName}'s turn...`);
                        }
                    } else {
                        // Advance to next player in turn order
                        const oldIndex = activePlayerIndex;
                        activePlayerIndex = (activePlayerIndex + 1) % totalPlayers;
                        console.log(`📄 Advancing turn: ${oldIndex} -> ${activePlayerIndex} (total: ${totalPlayers})`);

                        // Broadcast turn change during placement phase
                        const startedAt = window.serverNow();
                    turnStartedAtMs = startedAt;
                    currentTurnNumber++;
                    broadcastGameAction('turn-change', {
                        playerIndex: activePlayerIndex,
                        turnStartedAt: startedAt,
                        turnNumber: currentTurnNumber,
                        revealedTiles: placedTiles.filter(t => !t.flipped && !t.isPlayerTile).map(t => ({ id: t.id, shrineType: t.shrineType }))
                    });
                    if (typeof persistCurrentTurnIndex === 'function') persistCurrentTurnIndex(activePlayerIndex);
                        console.log(`📡 Broadcasted turn-change to player ${activePlayerIndex}`);

                        if (canPlaceTile()) {
                            updateStatus(`Your turn! Place your player tile (${playerTilesPlaced.size}/${totalPlayers} placed)`);
                        setInventoryOpen(true);
                            console.log(`✅ My turn to place (myPlayerIndex=${myPlayerIndex})`);
                        } else {
                            const nextColorName = getPlayerColorName(activePlayerIndex);
                            updateStatus(`Waiting for ${nextColorName} to place their tile... (${playerTilesPlaced.size}/${totalPlayers})`);
                            console.log(`⏳ Waiting for player ${activePlayerIndex} (myPlayerIndex=${myPlayerIndex})`);
                        }
                    }
                } else {
                    updateStatus(`Player ${tilePlayerIndex + 1} tile placed!`);
                }

                // Tutorial hook: advance when the local player places their tile on the board
                if (!skipMultiplayerLogic &&
                        window.isTutorialMode && window.TutorialMode?.onPlayerTilePlaced) {
                    window.TutorialMode.onPlayerTilePlaced();
                }
            }

            return tileId;
        }

        // Find the tile at a given world position
        function findTileAtPosition(worldX, worldY) {
            // A tile covers 19 hexes; use a large radius so clicking anywhere on the tile counts
            // TILE_SIZE * 5.5 ensures the whole tile (including edges) is clickable
            const tileRadius = TILE_SIZE * 5.5;
            let closestTile = null;
            let closestDist = Infinity;

            for (const tile of placedTiles) {
                if (tile.isPlayerTile) continue; // Skip player tiles
                const dist = Math.sqrt(Math.pow(tile.x - worldX, 2) + Math.pow(tile.y - worldY, 2));
                if (dist < tileRadius && dist < closestDist) {
                    closestTile = tile;
                    closestDist = dist;
                }
            }
            return closestTile;
        }

        // Handle board clicks when in selection mode (for scroll effects like tile swap/flip)
        function handleSelectionModeClick(worldX, worldY) {
            if (!spellSystem || !spellSystem.scrollEffects) return false;
            const selectionMode = spellSystem.scrollEffects.selectionMode;
            if (!selectionMode) return false;

            // Check if this is a stone selection mode (e.g., Water V - Control the Current)
            if (selectionMode.handleStoneClick) {
                // Find the stone at the click position
                const stone = findStoneAtPosition(worldX, worldY);
                if (stone) {
                    selectionMode.handleStoneClick(stone);
                    return true; // Click was handled
                }
                return false; // No stone at click — don't consume the event, allow panning
            }

            // Check if this is a hex selection mode (e.g., Excavate teleport — any hex, not just tile center)
            if (selectionMode.handleHexClick) {
                const allHexes = getAllHexagonPositions();
                let closestHex = null;
                let minDist = Infinity;
                allHexes.forEach(hexPos => {
                    const dist = Math.sqrt(Math.pow(hexPos.x - worldX, 2) + Math.pow(hexPos.y - worldY, 2));
                    if (dist < minDist) {
                        minDist = dist;
                        closestHex = hexPos;
                    }
                });
                if (closestHex && minDist < TILE_SIZE * 1.5) {
                    selectionMode.handleHexClick(closestHex);
                } else {
                    updateStatus('No hex at that position.');
                }
                return true;
            }

            // Check if this is a tile selection mode
            if (selectionMode.handleTileClick) {
                // Find the tile at the click position
                const tile = findTileAtPosition(worldX, worldY);
                if (!tile) {
                    updateStatus('No tile at that position.');
                    return true; // Still consumed the click
                }

                // Pass to selection mode handler
                selectionMode.handleTileClick(tile);
            }
            return true; // Click was handled
        }

        // Find a stone at a world position
        function findStoneAtPosition(worldX, worldY) {
            if (typeof placedStones === 'undefined') return null;

            // Increased radius for more permissive stone clicking
            const stoneRadius = typeof HEX_SIZE !== 'undefined' ? HEX_SIZE * 2.5 : 50;
            let closestStone = null;
            let closestDist = Infinity;

            for (const stone of placedStones) {
                const dist = Math.sqrt(Math.pow(stone.x - worldX, 2) + Math.pow(stone.y - worldY, 2));
                if (dist < stoneRadius && dist < closestDist) {
                    closestStone = stone;
                    closestDist = dist;
                }
            }
            return closestStone;
        }

        // ── Tile Image Overlay System ─────────────────────────────────────────
        // Per-element image overlays rendered as SVG <image> clipped to hex shape.
        // Settings are stored in window.tileOverlaySettings and persist across reveals.

        window.tileOverlaySettings = window.tileOverlaySettings || {
            earth:    { src: 'images/Tiles/pixelearth.webp',    x: 0, y: 0,   rotation: 60,  scale: 1.05, opacity: 0.41, tintOpacity: 0.22 },
            fire:     { src: 'images/Tiles/pixelfire.webp',     x: 0, y: 0,   rotation: 0,   scale: 1.2,  opacity: 0.6,  tintOpacity: 0.22 },
            water:    { src: 'images/Tiles/pixelwater.webp',    x: 0, y: 0,   rotation: 233, scale: 1.25, opacity: 0.49, tintOpacity: 0.22 },
            wind:     { src: 'images/Tiles/pixelwind.webp',     x: 0, y: 0,   rotation: 0,   scale: 1.2,  opacity: 0.6,  tintOpacity: 0.22 },
            void:     { src: 'images/Tiles/pixelvoid.webp',     x: 0, y: 0,   rotation: 31,  scale: 1.2,  opacity: 0.6,  tintOpacity: 0.22 },
            catacomb: { src: 'images/Tiles/pixelcatacomb.webp', x: 3, y: -1,  rotation: 0,   scale: 1,    opacity: 0.6,  tintOpacity: 1.0 },
            // Hidden (unrevealed) tile back — shown while a tile is face-down, before it is flipped.
            unflipped: { src: 'images/Tiles/unflippedtile.webp', x: 0, y: 3, rotation: 90, scale: 1.8, opacity: 0.41, tintOpacity: 0 },
            // Player tiles — one entry per player color, each can carry its own unique image.
            player_purple: { src: '', x: 0, y: 0, rotation: 0, scale: 1, opacity: 0.6, tintOpacity: 0 },
            player_yellow: { src: '', x: 0, y: 0, rotation: 0, scale: 1, opacity: 0.6, tintOpacity: 0 },
            player_red:    { src: '', x: 0, y: 0, rotation: 0, scale: 1, opacity: 0.6, tintOpacity: 0 },
            player_blue:   { src: '', x: 0, y: 0, rotation: 0, scale: 1, opacity: 0.6, tintOpacity: 0 },
            player_green:  { src: '', x: 0, y: 0, rotation: 0, scale: 1, opacity: 0.6, tintOpacity: 0 },
        };

        const ELEMENT_TINTS = {
            earth: '#4a8a2a', fire: '#cc2200', water: '#1a6ab5',
            wind:  '#c8a800', void: '#6a30b0', catacomb: '#888888',
            unflipped: '#333333',
            player_purple: PLAYER_COLORS.purple, player_yellow: PLAYER_COLORS.yellow,
            player_red: PLAYER_COLORS.red, player_blue: PLAYER_COLORS.blue, player_green: PLAYER_COLORS.green,
        };

        function makeTileHexPoints(R) {
            const pts = [];
            for (let i = 0; i < 6; i++) {
                const a = (Math.PI / 3) * i - Math.PI / 6;
                pts.push(`${(R * Math.cos(a)).toFixed(2)},${(R * Math.sin(a)).toFixed(2)}`);
            }
            return pts.join(' ');
        }

        function addTileOverlay(tileGroup, shrineType) {
            if (!shrineType || !window.tileOverlaySettings) return;
            const settings = window.tileOverlaySettings[shrineType];
            if (!settings || !settings.src) return;

            const tileId = tileGroup.getAttribute('data-tile-id');
            const clipId = `tile-overlay-clip-${tileId}`;
            const R = TILE_SIZE * 4.0; // 80 units — matches tile boundary for clean hex crop

            // Per-tile clipPath inside the tile group — coordinates are unambiguously tile-local
            const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
            const clip = document.createElementNS('http://www.w3.org/2000/svg', 'clipPath');
            clip.setAttribute('id', clipId);
            const clipHex = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
            clipHex.setAttribute('points', makeTileHexPoints(R));
            clip.appendChild(clipHex);
            defs.appendChild(clip);
            tileGroup.appendChild(defs);

            // Wrapper: clip acts as a fixed hex viewport; image moves freely inside it
            const wrapper = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            wrapper.setAttribute('class', 'tile-overlay');
            wrapper.setAttribute('data-element', shrineType);
            wrapper.setAttribute('clip-path', `url(#${clipId})`);

            // Elemental tint layer (colored hex fill behind the image)
            if (ELEMENT_TINTS[shrineType]) {
                const tint = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
                tint.setAttribute('points', makeTileHexPoints(R));
                tint.setAttribute('fill', ELEMENT_TINTS[shrineType]);
                tint.setAttribute('opacity', settings.tintOpacity ?? 0.22);
                tint.setAttribute('stroke', 'none');
                wrapper.appendChild(tint);
            }

            // Image layer — freely transforms within the clipped viewport
            const img = document.createElementNS('http://www.w3.org/2000/svg', 'image');
            img.setAttributeNS('http://www.w3.org/1999/xlink', 'href', settings.src);
            img.setAttribute('href', settings.src);
            img.setAttribute('x', -R);
            img.setAttribute('y', -R);
            img.setAttribute('width', R * 2);
            img.setAttribute('height', R * 2);
            img.setAttribute('preserveAspectRatio', 'xMidYMid slice');
            img.setAttribute('opacity', settings.opacity);
            img.setAttribute('transform',
                `translate(${settings.x},${settings.y}) rotate(${settings.rotation}) scale(${settings.scale})`);

            wrapper.appendChild(img);
            tileGroup.appendChild(wrapper);
        }

        // Clone a tileGraphic group with fills removed — used to render hex lines on top of overlay
        function createStrokeOnlyClone(tileGraphic) {
            const clone = tileGraphic.cloneNode(true);
            clone.setAttribute('class', 'tile-overlay-lines');
            clone.querySelectorAll('polygon').forEach(p => {
                p.setAttribute('fill', 'none');
                p.style.fill = 'none';
            });
            return clone;
        }

        function refreshAllTileOverlays() {
            document.querySelectorAll('.tile-overlay, .tile-overlay-lines').forEach(el => el.remove());
            document.querySelectorAll('[id^="tile-overlay-clip-"]').forEach(el => el.closest('defs')?.remove());
            if (typeof placedTiles !== 'undefined') {
                placedTiles.forEach(tile => {
                    if (!tile.element) return;
                    // Resolve which overlay key applies: player tiles use their own
                    // per-color key, hidden tiles use the generic 'unflipped' back,
                    // and revealed shrine tiles use their element key.
                    let overlayKey = null;
                    if (tile.isPlayerTile) {
                        overlayKey = tile.playerColorName ? `player_${tile.playerColorName}` : null;
                    } else if (tile.flipped) {
                        overlayKey = 'unflipped';
                    } else if (tile.shrineType) {
                        overlayKey = tile.shrineType;
                    }
                    if (!overlayKey) return;

                    const shrineMarker = tile.element.querySelector('.shrine-marker');
                    const tileGraphic = tile.element.querySelector('g[transform^="rotate"]');
                    // addTileOverlay appends to end; move overlay right after the base tile
                    // graphic to get correct order: tileGraphic → overlay → strokeClone → shrineMarker/tint/symbols
                    addTileOverlay(tile.element, overlayKey);
                    const overlay = tile.element.querySelector('.tile-overlay');
                    if (overlay && tileGraphic) tile.element.insertBefore(overlay, tileGraphic.nextSibling);
                    if (tileGraphic) {
                        const strokeClone = createStrokeOnlyClone(tileGraphic);
                        tile.element.insertBefore(strokeClone, overlay ? overlay.nextSibling : (shrineMarker || null));
                    }
                });
            }
        }
        window.refreshAllTileOverlays = refreshAllTileOverlays;
        window.addTileOverlay = addTileOverlay;

        function revealTile(tileId, silent = false) {
            const tile = placedTiles.find(t => t.id === tileId);
            if (!tile || !tile.flipped) {
                console.log(`⚠️ revealTile called for tile ${tileId}, but tile is ${tile ? 'already revealed' : 'not found'}`);
                return; // Already revealed or doesn't exist
            }

            console.log(`📡 Broadcasting tile flip: tileId=${tileId}, shrineType=${tile.shrineType}`);
            // Broadcast tile flip to other players
            broadcastGameAction('tile-flip', {
                tileId: tileId,
                shrineType: tile.shrineType
            });

            // Tutorial pre-reveal hook: runs BEFORE the visual is built so the
            // tutorial can override tile.shrineType and the visual + scroll both reflect it.
            if (window.isTutorialMode && window.TutorialMode?.onTilePreReveal) {
                window.TutorialMode.onTilePreReveal(tile);
            }

            // Remove the old tile element
            tile.element.remove();

            // Create new revealed tile group
            const tileGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            tileGroup.setAttribute('class', 'placed-tile');
            tileGroup.setAttribute('data-tile-id', tileId);
            tileGroup.setAttribute('data-shrine', tile.shrineType);
            tileGroup.setAttribute('transform', `translate(${tile.x}, ${tile.y})`);

            const tileGraphic = createTileGroup(TILE_SIZE, tile.rotation, false);
            tileGroup.appendChild(tileGraphic);

            // Layer order: base fills → overlay image → hex lines → shrine symbol
            addTileOverlay(tileGroup, tile.shrineType);
            tileGroup.appendChild(createStrokeOnlyClone(tileGraphic));
            const shrineMarker = createShrineMarker(tile.shrineType);
            tileGroup.appendChild(shrineMarker);

            tileGroup.addEventListener('mousedown', (e) => {
                if (!tileMoveMode) return;
                // During Telekinesis: 2+ players or a strand-causing move blocks the pickup
                if (window.telekinesisState && window.telekinesisState.active) {
                    if (playerCountOnTileById(tileId) >= 2 || tileIsBridge(tileId)) return;
                }
                if (e.button === 0 && !tileHasStones(tileId) && !isPanning && !isDraggingStone) {
                    e.stopPropagation();
                    e.preventDefault();
                    startTileDrag(tileId, e);
                }
            });

            viewport.insertBefore(tileGroup, snapIndicator);

            // Update tile data
            tile.flipped = false;
            tile.element = tileGroup;

            // Tile reveal is irreversible: clear undo history
            clearUndo();

            // Sound
            if (!silent) window.SoundSystem?.play('tilereveal');

            // Catacomb tile reveal: refund 1 AP
            const isCatacombReveal = tile.shrineType === 'catacomb';
            if (isCatacombReveal) {
                console.log(`⚡ Catacomb tile revealed - refunding 1 AP`);
                addAP(1);
            }

            // Tutorial hook: let tutorial pre-arrange the scroll deck before we draw
            if (window.isTutorialMode && window.TutorialMode?.onTileRevealed) {
                window.TutorialMode.onTileRevealed(tile, spellSystem);
            }

            // Scroll discovery: use effective element (Wandering River) so transformed tiles give the chosen element's scroll
            const effectiveType = spellSystem.scrollEffects?.getEffectiveTileElement?.(tile) ?? tile.shrineType;
            const scrollInfo = spellSystem.onTileRevealed(effectiveType);

            // Adaptive music: grow the Joytone playlist with this element's theme.
            // Uses the raw shrineType (not effectiveType) because that's what the
            // tile-flip broadcast carries — keeps the sequence identical on all clients.
            window.JoytoneBridge?.onTileRevealed(tile.shrineType, tile.id);

            // Call to Adventure: immediately draw shrine stones when revealing a tile
            const ctaBuff = spellSystem.scrollEffects?.activeBuffs?.callToAdventure;
            const elementalTypes = ['earth', 'water', 'fire', 'wind', 'void'];
            let ctaDrawn = 0;
            if (ctaBuff && ctaBuff.playerIndex === activePlayerIndex && elementalTypes.includes(effectiveType)) {
                const STONE_RANK = { 'void': 1, 'wind': 2, 'fire': 3, 'water': 4, 'earth': 5 };
                const amount = STONE_RANK[effectiveType] || 0;
                ctaDrawn = spellSystem.scrollEffects.drawStonesToPool(effectiveType, amount, activePlayerIndex);
                if (ctaDrawn > 0) {
                    syncPlayerState();
                    console.log(`🗺️ Call to Adventure: drew ${ctaDrawn} ${effectiveType} stones on tile reveal`);
                }
            }

            const apBonus = isCatacombReveal ? ' +1 AP!' : '';
            if (scrollInfo && ctaDrawn > 0) {
                updateStatus(`Revealed ${effectiveType} shrine! Found ${scrollInfo.name}! Call to Adventure: +${ctaDrawn} ${effectiveType} stone${ctaDrawn > 1 ? 's' : ''}!${apBonus}`);
            } else if (scrollInfo) {
                updateStatus(`Revealed ${effectiveType} shrine! Found ${scrollInfo.name}!${apBonus}`);
            } else if (ctaDrawn > 0) {
                updateStatus(`Revealed ${effectiveType} shrine! Call to Adventure: +${ctaDrawn} ${effectiveType} stone${ctaDrawn > 1 ? 's' : ''}!${apBonus}`);
            } else {
                updateStatus(`Revealed ${effectiveType} shrine!${apBonus}`);
            }

            // Re-apply Wandering River indicator on the new element (reveal replaced tile.element)
            const wr = spellSystem.scrollEffects?.activeBuffs?.wanderingRiver;
            if (Array.isArray(wr)) {
                const entry = wr.find(e => Number(e.tileId) === Number(tile.id));
                if (entry && entry.newElement && typeof spellSystem.scrollEffects.applyWanderingRiverIndicator === 'function') {
                    spellSystem.scrollEffects.applyWanderingRiverIndicator(tile, entry.newElement);
                }
            }
        }

        // Make revealTile available globally for scroll effects
        window.revealTile = revealTile;

        // Read-only check, same hex-matching as revealFlippedTilesAlongPath
        // below: would committing this movement path step onto any hidden
        // (still face-down, non-player) tile? Used by game-ui.js's movement
        // handlers to reject the move itself — not just skip the reveal —
        // when the tutorial isn't currently expecting a flip, so the pawn
        // never ends up standing on a tile that stays hidden underneath it.
        function pathHasHiddenTile(steps) {
            if (!steps || steps.length === 0) return false;
            const allHexes = getAllHexagonPositions();
            return steps.some(step => {
                let hex = null, minDist = Infinity;
                allHexes.forEach(hexPos => {
                    const dist = Math.hypot(hexPos.x - step.x, hexPos.y - step.y);
                    if (dist < minDist) { minDist = dist; hex = hexPos; }
                });
                if (!hex || minDist >= 5 || !hex.tiles) return false;
                return hex.tiles.some(t => t.flipped && !t.isPlayerTile);
            });
        }
        window.pathHasHiddenTile = pathHasHiddenTile;

        // A single movement action can cross several hexes in one go (a
        // dragged path, a tap-to-move hop, or the keyboard move preview).
        // Only checking the hex the pawn STOPS on misses any face-down tile
        // the path merely passed through on the way to an already-revealed
        // tile — this walks every hex actually stepped on (in path order,
        // origin excluded) and reveals any face-down tile found there.
        // `steps` matches playerPath.slice(1)'s shape: an array of {x, y}.
        // Returns the number of tiles revealed, so a caller can tell whether
        // its own "Moved N hexes" status would just get overwritten by
        // revealTile()'s own "Revealed X shrine!" status anyway.
        function revealFlippedTilesAlongPath(steps) {
            if (!steps || steps.length === 0) return 0;
            let revealedCount = 0;
            let tutorialFlipBlockedAlerted = false; // one alert per path, not one per hidden tile crossed
            const allHexes = getAllHexagonPositions();
            steps.forEach(step => {
                let hex = null, minDist = Infinity;
                allHexes.forEach(hexPos => {
                    const dist = Math.hypot(hexPos.x - step.x, hexPos.y - step.y);
                    if (dist < minDist) { minDist = dist; hex = hexPos; }
                });
                if (!hex || minDist >= 5 || !hex.tiles) return;

                const flippedTiles = hex.tiles.filter(t => t.flipped && !t.isPlayerTile);
                if (flippedTiles.length === 0) return;

                // Tutorial: block revealing a tile before the current step
                // actually expects one — otherwise exploring ahead could draw
                // an extra scroll early or eat a later step's forced shrine
                // tile before the tutorial is ready for it.
                if (window.isTutorialMode && window.TutorialMode?.isTileFlipExpected
                    && !window.TutorialMode.isTileFlipExpected()) {
                    if (!tutorialFlipBlockedAlerted) {
                        tutorialFlipBlockedAlerted = true;
                        alert("Sorry, we can't let you do that yet, it breaks the tutorial!");
                    }
                    return;
                }

                // If multiple flipped tiles share this hex, reveal the one
                // whose centre is closest to the point actually stepped on.
                let tileToReveal = flippedTiles[0];
                if (flippedTiles.length > 1) {
                    let minTileDist = Infinity;
                    flippedTiles.forEach(tile => {
                        const tileDist = Math.hypot(tile.x - step.x, tile.y - step.y);
                        if (tileDist < minTileDist) { minTileDist = tileDist; tileToReveal = tile; }
                    });
                }
                revealTile(tileToReveal.id);
                revealedCount++;
            });
            return revealedCount;
        }
        window.revealFlippedTilesAlongPath = revealFlippedTilesAlongPath;
        // Expose placePlayer and movePlayerVisually for scroll effects (e.g. Take Flight)
        window.placePlayer = placePlayer;
        window.movePlayerVisually = movePlayerVisually;
        // Expose placeTile and spellSystem for tutorial mode
        window.placeTile  = placeTile;
        window.spellSystem = spellSystem;
        // Expose placeStoneVisually and placedStones for tutorial scripted AI trap sequence
        window.placeStoneVisually = placeStoneVisually;
        window.placedStones = placedStones;
        // Expose stone interaction pipeline for scroll effects (e.g. Control the Current transformation)
        window.applyStoneInteractionsAfterTransform = function(x, y, newType) {
            processStoneInteractions(x, y, newType);
            recheckAllStoneInteractions();
            updateAllWaterStoneVisuals();
            updateAllVoidNullificationVisuals();
        };

        // Visual-only water stone transformation — called on receiving client in multiplayer
        window.transformWaterStoneVisually = function(stoneX, stoneY, newElement) {
            const stone = placedStones.find(s => Math.abs(s.x - stoneX) < 1 && Math.abs(s.y - stoneY) < 1);
            if (!stone) return;

            // Pool swap (mirrors what caster's client does in transformWaterStone)
            stonePools.water = (stonePools.water || 0) + 1;
            stonePools[newElement] = (stonePools[newElement] || 0) - 1;
            if (typeof updateStoneCount === 'function') {
                updateStoneCount('water');
                updateStoneCount(newElement);
            }

            stone.type = newElement;

            // Remove water-specific indicators
            stone.element?.querySelector('.mimicry-indicator')?.remove();
            stone.element?.querySelector('.chain-indicator')?.remove();

            // Re-render circle and symbol to new element
            if (stone.element && STONE_TYPES[newElement]) {
                const newColor = STONE_TYPES[newElement].color;
                // the stone's own circle: with 3D pieces on, the first circle is the bead's shadow
                const circle = stone.element.querySelector('circle.stone-piece') || stone.element.querySelector('circle');
                if (circle) {
                    circle.setAttribute('fill', darkenHex(newColor, 0.55));
                    circle.setAttribute('stroke', newColor);
                }
                const img = stone.element.querySelector(':scope > image');
                if (img) img.setAttribute('href', STONE_TYPES[newElement].img);
            }

            window.applyStoneInteractionsAfterTransform(stoneX, stoneY, newElement);
        };
        // Expose tileMoveMode for scroll effects (e.g. Telekinesis)
        Object.defineProperty(window, 'tileMoveMode', {
            get() { return tileMoveMode; },
            set(v) { tileMoveMode = v; },
            configurable: true
        });

        // Visual-only tile flip (called when receiving broadcast from other players)
        function flipTileVisually(tileElement, shrineType) {
            const tileId = parseInt(tileElement.getAttribute('data-tile-id'));
            const tile = placedTiles.find(t => t.id === tileId);
            if (!tile || !tile.flipped) return;

            // Same visual logic as revealTile but without broadcasting
            tile.element.remove();

            const tileGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            tileGroup.setAttribute('class', 'placed-tile');
            tileGroup.setAttribute('data-tile-id', tileId);
            tileGroup.setAttribute('data-shrine', shrineType);
            tileGroup.setAttribute('transform', `translate(${tile.x}, ${tile.y})`);

            const tileGraphic = createTileGroup(TILE_SIZE, tile.rotation, false);
            tileGroup.appendChild(tileGraphic);

            // Layer order: base fills → overlay image → hex lines → shrine symbol
            addTileOverlay(tileGroup, shrineType);
            tileGroup.appendChild(createStrokeOnlyClone(tileGraphic));
            const shrineMarker = createShrineMarker(shrineType);
            tileGroup.appendChild(shrineMarker);

            tileGroup.addEventListener('mousedown', (e) => {
                if (!tileMoveMode) return;
                // During Telekinesis: 2+ players or a strand-causing move blocks the pickup
                if (window.telekinesisState && window.telekinesisState.active) {
                    if (playerCountOnTileById(tileId) >= 2 || tileIsBridge(tileId)) return;
                }
                if (e.button === 0 && !tileHasStones(tileId) && !isPanning && !isDraggingStone) {
                    e.stopPropagation();
                    e.preventDefault();
                    startTileDrag(tileId, e);
                }
            });

            viewport.insertBefore(tileGroup, snapIndicator);

            tile.flipped = false;
            tile.element = tileGroup;
            tile.shrineType = shrineType; // Update the tile's shrine type to match the revealed type
            console.log(`📄 flipTileVisually: Updated tile ${tileId} shrineType to ${shrineType}`);
            window.SoundSystem?.play('tilereveal');
        }

        // Recreate a revealed tile as flipped (hidden) - used by Heavy Stomp scroll effect
        function recreateTileAsFlipped(tile) {
            if (!tile || tile.flipped) return; // Already flipped

            const tileId = tile.id;
            console.log(`🙈 recreateTileAsFlipped: Hiding tile ${tileId} (${tile.shrineType})`);

            // Remove old tile element
            if (tile.element) {
                tile.element.remove();
            }

            // Create new flipped tile group
            const tileGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            tileGroup.setAttribute('class', 'placed-tile');
            tileGroup.setAttribute('data-tile-id', tileId);
            tileGroup.setAttribute('transform', `translate(${tile.x}, ${tile.y})`);

            // Create flipped (hidden) tile graphic
            const tileGraphic = createTileGroup(TILE_SIZE, tile.rotation, true);
            tileGroup.appendChild(tileGraphic);
            addTileOverlay(tileGroup, 'unflipped');

            // Add mousedown handler for tile dragging
            tileGroup.addEventListener('mousedown', (e) => {
                if (e.button === 0 && !tileHasStones(tileId) && !isPanning && !isDraggingStone) {
                    e.stopPropagation();
                    e.preventDefault();
                    startTileDrag(tileId, e);
                }
            });

            viewport.insertBefore(tileGroup, snapIndicator);

            // Update tile data
            tile.flipped = true;
            tile.element = tileGroup;
            window.SoundSystem?.play('placetile');
        }

        // Make it available globally for scroll effects
        window.recreateTileAsFlipped = recreateTileAsFlipped;

        function startTileDrag(tileId, e) {
            if (tileHasStones(tileId)) return;
            isDraggingTile = true;
            draggedTileId = tileId;
            draggedTileShrineType = null;
            draggedTileOriginalPos = null;
            const tile = placedTiles.find(t => t.id === tileId);
            if (tile) {
                draggedTileRotation = tile.rotation;
                draggedTileFlipped = tile.flipped || false;
                draggedTileShrineType = tile.shrineType; // Preserve shrine type
                draggedTileOriginalPos = { x: tile.x, y: tile.y }; // Store original position
                tile.element.remove();
                placedTiles = placedTiles.filter(t => t.id !== tileId);
            }

            const { x: screenX, y: screenY } = getBoardScreenXY(e.clientX, e.clientY);
            const world = screenToWorld(screenX, screenY);

            ghostTile = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            ghostTile.setAttribute('class', 'ghost-tile');
            ghostTile.setAttribute('transform', `translate(${world.x}, ${world.y})`);
            const tileContent = createTileGroup(TILE_SIZE, draggedTileRotation, draggedTileFlipped);
            ghostTile.appendChild(tileContent);
            viewport.appendChild(ghostTile);
            // Telekinesis: mark the tile being moved and where it came from
            if (window.telekinesisState?.active && window.TileMark) {
                window.TileMark.mark(ghostTile, { color: '#e8c84d' });
                ghostTile.style.opacity = '0.85'; // the moving tile itself stays easy to see (ghost default 0.4)
                if (draggedTileOriginalPos) window.TileMark.fromMark(draggedTileOriginalPos.x, draggedTileOriginalPos.y, '#e8c84d');
            }

            // The tile has already been removed from placedTiles above, so the
            // board is already in its "post-move" state — no excludeTileId needed.
            // White, not a player color: Telekinesis moves an existing board
            // tile, which has no player-identity meaning the way a player tile
            // placement does.
            showLegalPlacementHighlights('telekinesis', null, '#ffffff');
        }

        let isDraggingPlayer = false;
        let ghostPlayer = null;
        let playerPath = [];
        let pathLine = null;
        let pathCostLabels = [];

        
        // Finalize a pawn move based on the currently drawn playerPath (used by touch + mouse).
        function movePlayerAlongPath() {
            if (!isDraggingPlayer || !ghostPlayer || playerPath.length < 2) return;

            const activePlayer = playerPositions[activePlayerIndex];
            if (!activePlayer) return;

            const finalPos = playerPath[playerPath.length - 1];

            // Basic legality check for destination (revealed/unrevealed rules are enforced in canPlayerMoveToHex)
            const canMoveCheck = canPlayerMoveToHex(finalPos.x, finalPos.y, true);
            if (!canMoveCheck.canMove) {
                console.log(`❌ Invalid move end: ${canMoveCheck.reason || 'cannot move there'}`);
                // cleanup happens below
            } else {
                // Total cost for the selected path (Steam Vents discount applied inside)
                const totalCost = calculatePathCost();

                // Make sure player has enough AP
                const availableAP = getCurrentAP ? getCurrentAP() : currentAP;
                if (totalCost > availableAP) {
                    console.log(`❌ Not enough AP: need ${totalCost}, have ${availableAP}`);
                } else {
                    // Update Steam Vents alternation state before spending AP
                    commitSteamVentsState(playerPath);
                    // Spend AP and apply the move
                    if (typeof spendAP === 'function') spendAP(totalCost);

                    // Move pawn visually + state
                    activePlayer.x = finalPos.x;
                    activePlayer.y = finalPos.y;
                    activePlayer.element.setAttribute('transform', `translate(${finalPos.x}, ${finalPos.y})`);
                    if (ghostPlayer) ghostPlayer.setAttribute('transform', `translate(${finalPos.x}, ${finalPos.y})`);

                    console.log(`✅ Movement successful: ${playerPath.length - 1} hexes, cost ${totalCost} AP`);

                    // Record activity + broadcast movement (multiplayer)
                    try {
                        recordActivity && recordActivity('move', { x: finalPos.x, y: finalPos.y, apSpent: totalCost });
                    } catch (e) {}

                    if (typeof broadcastPlayerMovement === 'function' && !isSpectator) {
                        try {
                            broadcastPlayerMovement(activePlayerIndex, finalPos.x, finalPos.y, totalCost);
                        } catch (e) {}
                    }

                    // Tile reveal / shrine resolution (reuse existing landing handler if present)
                    try {
                        if (typeof handlePlayerLanding === 'function') {
                            handlePlayerLanding(finalPos.x, finalPos.y);
                        } else if (typeof checkTileRevealsAtPosition === 'function') {
                            checkTileRevealsAtPosition(finalPos.x, finalPos.y);
                        }
                    } catch (e) {
                        console.warn('Landing/reveal handler error:', e);
                    }
                }
            }

            // Cleanup (match mouseup behavior)
            isDraggingPlayer = false;
            clearPlayerPath();
            if (ghostPlayer) {
                ghostPlayer.remove();
                ghostPlayer = null;
            }
        }

function clearPlayerPath() {
            // Remove polyline
            if (pathLine) {
                pathLine.remove();
                pathLine = null;
            }
            // Remove step/cost labels
            if (pathCostLabels && pathCostLabels.length) {
                pathCostLabels.forEach(label => {
                    try { label.remove(); } catch (e) {}
                });
            }
            pathCostLabels = [];
            playerPath = [];
            snapIndicator.classList.remove('active');
        }


        function placePlayer(x, y, color = null) {
            if (color) {
                // Creating a NEW player pawn with this color
                console.log(`🎨 Creating new player ${playerPositions.length + 1} at (${x.toFixed(1)}, ${y.toFixed(1)}) with color ${color}`);

                const playerGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
                playerGroup.setAttribute('class', 'player');
                playerGroup.setAttribute('transform', `translate(${x}, ${y})`);
                playerGroup.style.pointerEvents = 'all';
                playerGroup.style.touchAction = 'none';

                // Invisible larger hit area for easier touch targeting
                const hitArea = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
                hitArea.setAttribute('cx', 0);
                hitArea.setAttribute('cy', 0);
                hitArea.setAttribute('r', TILE_SIZE * 0.8); // Much larger touch target
                hitArea.setAttribute('fill', 'transparent');
                hitArea.setAttribute('stroke', 'none');
                hitArea.style.pointerEvents = 'all';
                playerGroup.appendChild(hitArea);

                const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
                circle.setAttribute('cx', 0);
                circle.setAttribute('cy', 0);
                circle.setAttribute('r', TILE_SIZE * 0.4);
                circle.setAttribute('class', 'player-marker');
                circle.setAttribute('fill', color);
                circle.setAttribute('stroke', '#000');
                circle.setAttribute('stroke-width', '2');

                playerGroup.appendChild(circle);

                // Store the player index for this group
                const playerIndex = playerPositions.length;

                // Add drag handler
                playerGroup.addEventListener('mousedown', (e) => {
                    // Only draggable if this is the active player (check dynamically)
                    const thisPlayerIndex = playerPositions.findIndex(p => p && p.element === playerGroup);
                    const tf = (typeof window !== 'undefined') ? window.takeFlightState : null;
                    if (tf && tf.active && tf.targetPlayerIndex === thisPlayerIndex) {
                        e.stopPropagation();
                        e.preventDefault();
                        startPlayerDrag(e, { playerIndex: thisPlayerIndex, ignoreTurnCheck: true, isTakeFlight: true });
                        return;
                    }
                    if (thisPlayerIndex === activePlayerIndex) {
                        e.stopPropagation();
                        e.preventDefault();
                        startPlayerDrag(e);
                    }
                });

            // Touch support: start player drag on tap/drag
	            playerGroup.addEventListener('touchstart', (e) => {
	                console.log('👆 Player pawn touchstart detected!', {touches: e.touches?.length, target: e.target});
	                if (!(e.touches && e.touches.length === 1)) return;
	                // Mirror mousedown behavior: only the active player pawn can be dragged
	                const thisPlayerIndex = playerPositions.findIndex(p => p && p.element === playerGroup);
	                console.log(`   thisPlayerIndex=${thisPlayerIndex}, activePlayerIndex=${activePlayerIndex}`);
                    const tf = (typeof window !== 'undefined') ? window.takeFlightState : null;
                    if (tf && tf.active && tf.targetPlayerIndex === thisPlayerIndex) {
                        // Set flag IMMEDIATELY to prevent other handlers from interfering
                        isDraggingPlayer = true;
                        e.stopPropagation();
                        e.preventDefault();
                        const t = e.touches[0];
                        console.log('   ✅ Starting take-flight drag from touch');
                        startPlayerDrag({
                            clientX: t.clientX,
                            clientY: t.clientY,
                            button: 0,
                            preventDefault: () => {},
                            stopPropagation: () => {}
                        }, { playerIndex: thisPlayerIndex, ignoreTurnCheck: true, isTakeFlight: true });
                        return;
                    }
	                if (thisPlayerIndex === activePlayerIndex) {
                    // Set flag IMMEDIATELY to prevent other handlers from interfering
                    isDraggingPlayer = true;
                    e.stopPropagation();
                    e.preventDefault();
                    const t = e.touches[0];
                    console.log('   ✅ Starting player drag from touch');
                    startPlayerDrag({
                        clientX: t.clientX,
                        clientY: t.clientY,
                        button: 0,
                        preventDefault: () => {},
                        stopPropagation: () => {}
                    });
                } else {
                    console.log('   ❌ Not active player, ignoring touch');
                }
            }, { passive: false });

                playerGroup.addEventListener('mouseenter', (e) => {
                    e.stopPropagation();
                });

                playerGroup.addEventListener('mouseleave', (e) => {
                    e.stopPropagation();
                });

                viewport.appendChild(playerGroup);
                playerPositions.push({ x, y, element: playerGroup, color, index: playerIndex });

            } else {
                // Moving the ACTIVE player
                const activePlayer = playerPositions[activePlayerIndex];
                if (!activePlayer) {
                    console.error('No active player to move!');
                    return;
                }
                
                activePlayer.element.remove();

                const playerGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
                playerGroup.setAttribute('class', 'player');
                playerGroup.setAttribute('transform', `translate(${x}, ${y})`);
                playerGroup.style.pointerEvents = 'all';
                playerGroup.style.touchAction = 'none';

                // Invisible larger hit area for easier touch targeting
                const hitArea = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
                hitArea.setAttribute('cx', 0);
                hitArea.setAttribute('cy', 0);
                hitArea.setAttribute('r', TILE_SIZE * 0.8);
                hitArea.setAttribute('fill', 'transparent');
                hitArea.setAttribute('stroke', 'none');
                hitArea.style.pointerEvents = 'all';
                playerGroup.appendChild(hitArea);

                const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
                circle.setAttribute('cx', 0);
                circle.setAttribute('cy', 0);
                circle.setAttribute('r', TILE_SIZE * 0.4);
                circle.setAttribute('class', 'player-marker');
                circle.setAttribute('fill', activePlayer.color);
                circle.setAttribute('stroke', '#000');
                circle.setAttribute('stroke-width', '2');

                playerGroup.appendChild(circle);

                // Store the player index for event handlers
                const thisPlayerIdx = activePlayerIndex;

                playerGroup.addEventListener('mousedown', (e) => {
                    // Only draggable if this is the active player
                    const currentIdx = playerPositions.findIndex(p => p && p.element === playerGroup);
                    if (currentIdx === activePlayerIndex) {
                        e.stopPropagation();
                        e.preventDefault();
                        startPlayerDrag(e);
                    }
                });

	            // Touch support: start player drag on tap/drag
	            playerGroup.addEventListener('touchstart', (e) => {
	                console.log('👆 Player pawn touchstart (path2) detected!', {touches: e.touches?.length});
	                if (!(e.touches && e.touches.length === 1)) return;
	                // Mirror mousedown behavior: only active player can be dragged
	                const currentIdx = playerPositions.findIndex(p => p && p.element === playerGroup);
	                console.log(`   currentIdx=${currentIdx}, activePlayerIndex=${activePlayerIndex}`);
	                if (currentIdx === activePlayerIndex) {
                    // Set flag IMMEDIATELY to prevent other handlers from interfering
                    isDraggingPlayer = true;
                    e.stopPropagation();
                    e.preventDefault();
                    const t = e.touches[0];
                    console.log('   ✅ Starting player drag from touch (path2)');
                    startPlayerDrag({
                        clientX: t.clientX,
                        clientY: t.clientY,
                        button: 0,
                        preventDefault: () => {},
                        stopPropagation: () => {}
                    });
                } else {
                    console.log('   ❌ Not active player, ignoring touch (path2)');
                }
            }, { passive: false });

                playerGroup.addEventListener('mouseenter', (e) => {
                    e.stopPropagation();
                });

                playerGroup.addEventListener('mouseleave', (e) => {
                    e.stopPropagation();
                });

                viewport.appendChild(playerGroup);

                activePlayer.x = x;
                activePlayer.y = y;
                activePlayer.element = playerGroup;

                // Control the Current: update which water stones are highlighted after move
                if (spellSystem && spellSystem.scrollEffects && typeof spellSystem.scrollEffects.refreshWaterTransformHighlights === 'function') {
                    spellSystem.scrollEffects.refreshWaterTransformHighlights();
                }

                // Shrine-return win: arriving home with all five elements activated wins
                checkWinCondition(activePlayerIndex);
            }

            // Update catacomb teleport indicators
            updateCatacombIndicators();
        }

        // Visual-only player tile placement (called when receiving broadcast from other players)
        function placePlayerTileVisually(x, y, playerIndex, colorName, cosmetics) {
            // Normalize to hex so COLOR_RANK lookups never get a string name like 'purple'
            const hexColor = colorName?.startsWith('#') ? colorName : (PLAYER_COLORS[colorName] || colorName);
            console.log(`📄 Placing other player's tile: player ${playerIndex}, color ${hexColor}, at (${x.toFixed(1)}, ${y.toFixed(1)})`);

            // Temporarily set playerColor to the other player's color
            const originalColor = playerColor;
            playerColor = hexColor;

            // Place the player tile - skip multiplayer logic since this is visual-only
            placeTile(x, y, 0, false, 'player', true, true);

            // Relocate the newly pushed pawn from the end of playerPositions to the
            // correct slot.  placeTile → placePlayer always push()es, so simultaneous
            // local placement means index .length is wrong.
            const placed = playerPositions.pop();
            if (placed) {
                placed.index = playerIndex;
                while (playerPositions.length < playerIndex) playerPositions.push(null);
                playerPositions[playerIndex] = placed;
                console.log(`🔧 Relocated remote pawn to playerPositions[${playerIndex}]`);
            }

            // Fix placedTiles entry — placeTile captured playerPositions.length (wrong for
            // remote tiles); patch it to the correct playerIndex so tooltips are right.
            const lastTile = placedTiles[placedTiles.length - 1];
            if (lastTile && lastTile.isPlayerTile) {
                lastTile.playerIndex = playerIndex;
            }

            // Restore our color
            playerColor = originalColor;

            console.log(`✅ Other player's tile placed successfully (visual only)`);
        }

        // Visual-only player movement (called when receiving broadcast from other players)
        function movePlayerVisually(playerIndex, x, y, apSpent) {
            const player = playerPositions[playerIndex];
            if (!player) {
                console.error(`Cannot move player ${playerIndex} - not found`);
                return;
            }

            // Remove old player element
            player.element.remove();

            // Create new player element at new position
            const playerGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            playerGroup.setAttribute('class', 'player');
            playerGroup.setAttribute('transform', `translate(${x}, ${y})`);
            playerGroup.style.pointerEvents = 'all';
            playerGroup.style.touchAction = 'none';

            // Invisible larger hit area for easier touch targeting
            const hitArea = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            hitArea.setAttribute('cx', 0);
            hitArea.setAttribute('cy', 0);
            hitArea.setAttribute('r', TILE_SIZE * 0.8);
            hitArea.setAttribute('fill', 'transparent');
            hitArea.setAttribute('stroke', 'none');
            hitArea.style.pointerEvents = 'all';
            playerGroup.appendChild(hitArea);

            const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            circle.setAttribute('cx', 0);
            circle.setAttribute('cy', 0);
            circle.setAttribute('r', TILE_SIZE * 0.4);
            circle.setAttribute('class', 'player-marker');
            circle.setAttribute('fill', player.color);
            circle.setAttribute('stroke', '#000');
            circle.setAttribute('stroke-width', '2');

            playerGroup.appendChild(circle);

            playerGroup.addEventListener('mousedown', (e) => {
                const tf = (typeof window !== 'undefined') ? window.takeFlightState : null;
                if (tf && tf.active && tf.targetPlayerIndex === playerIndex) {
                    e.stopPropagation();
                    e.preventDefault();
                    startPlayerDrag(e, { playerIndex, ignoreTurnCheck: true, isTakeFlight: true });
                    return;
                }
                if (activePlayerIndex === playerIndex) {
                    e.stopPropagation();
                    e.preventDefault();
                    startPlayerDrag(e);
                }
            });

	            // Touch support: start player drag on tap/drag
	            playerGroup.addEventListener('touchstart', (e) => {
	                console.log('👆 Player pawn touchstart (path3) detected!', {touches: e.touches?.length, playerIndex});
	                if (!(e.touches && e.touches.length === 1)) return;
                    const tf = (typeof window !== 'undefined') ? window.takeFlightState : null;
                    if (tf && tf.active && tf.targetPlayerIndex === playerIndex) {
                        // Set flag IMMEDIATELY to prevent other handlers from interfering
                        isDraggingPlayer = true;
                        e.stopPropagation();
                        e.preventDefault();
                        const t = e.touches[0];
                        console.log('   ✅ Starting take-flight drag from touch (path3)');
                        startPlayerDrag({
                            clientX: t.clientX,
                            clientY: t.clientY,
                            button: 0,
                            preventDefault: () => {},
                            stopPropagation: () => {}
                        }, { playerIndex, ignoreTurnCheck: true, isTakeFlight: true });
                        return;
                    }
	                // Mirror mousedown behavior: only active player can be dragged
	                console.log(`   playerIndex=${playerIndex}, activePlayerIndex=${activePlayerIndex}`);
	                if (activePlayerIndex === playerIndex) {
                    // Set flag IMMEDIATELY to prevent other handlers from interfering
                    isDraggingPlayer = true;
                    e.stopPropagation();
                    e.preventDefault();
                    const t = e.touches[0];
                    console.log('   ✅ Starting player drag from touch (path3)');
                    startPlayerDrag({
                        clientX: t.clientX,
                        clientY: t.clientY,
                        button: 0,
                        preventDefault: () => {},
                        stopPropagation: () => {}
                    });
                } else {
                    console.log('   ❌ Not active player, ignoring touch (path3)');
                }
            }, { passive: false });

            viewport.appendChild(playerGroup);

            // Update player position
            player.x = x;
            player.y = y;
            player.element = playerGroup;

            console.log(`📄 Moved player ${playerIndex} to (${x.toFixed(1)}, ${y.toFixed(1)}), spent ${apSpent} AP`);

            // Shrine-return win: a remote player arriving home with all five
            // elements activated wins (redundant with the winner's own client's
            // game-over broadcast, but keeps observers correct if it's lost).
            checkWinCondition(playerIndex);
        }

        // Visual-only stone break (called when receiving broadcast from other players)
        function breakStoneVisually(stoneId) {
            const stone = placedStones.find(s => s.id === stoneId);
            if (!stone) {
                console.log(`⚠️ Cannot break stone ${stoneId} - not found`);
                return;
            }

            console.log(`🔨 Breaking stone visually: id=${stoneId}, type=${stone.type}`);

            // Remove stone from board (crack-and-shatter animation: js/piece-3d.js)
            const stoneElement = stone.element;
            if (stoneElement && stoneElement.parentNode) {
                window.playStoneBreak?.(stoneElement);
                stoneElement.remove();
            }

            // Remove from placedStones array
            const index = placedStones.findIndex(s => s.id === stoneId);
            if (index !== -1) {
                placedStones.splice(index, 1);
            }

            // Return stone to source pool
            returnStoneToPool(stone.type);

            // Update interactions since a stone was removed
            updateTileClasses();
            recheckAllStoneInteractions();
            updateAllWaterStoneVisuals();
            updateAllVoidNullificationVisuals();

            // Bot diplomacy reads this as "this player broke a stone" (js/bot-diplomacy.js HARM_CAUSES)
            window.ActionLog?.record('breakStone', { x: +stone.x.toFixed(1), y: +stone.y.toFixed(1), stoneType: stone.type });
            console.log(`✅ Stone ${stoneId} broken visually`);
        }

        // Record player activity (kept for analytics/debug; NOT used for kicking)
        function recordActivity() {
            if (!myPlayerId) return;
            myLastActivity = Date.now();
            playerLastActivity[myPlayerId] = myLastActivity;
            // Turn timeout is based on turn start time, not activity.
            console.log('📡 Activity recorded locally');
        }


        // Update turn timer display (shared by everyone; enforced by host)
        function updateTimerDisplay() {
            const timerElement = document.getElementById('inactivity-timer');
            const hudTimer = document.getElementById('hud-timer');
            const hudTimerValue = document.getElementById('hud-timer-value');

            if (!gameInactivityTimeout || gameInactivityTimeout === 0) {
                if (timerElement) timerElement.style.display = 'none';
                if (hudTimer) hudTimer.style.display = 'none';
                return;
            }

            // Only show timer when it's my turn (during placement phase, this means "canPlaceTile()")
            const isMyActiveTurn = isPlacementPhase ? canPlaceTile() : isMyTurn();
            if (!isMyActiveTurn) {
                if (timerElement) timerElement.style.display = 'none';
                // Keep HUD timer visible but show waiting state
                if (hudTimerValue) hudTimerValue.textContent = '--:--';
                if (hudTimer) hudTimer.classList.remove('warning');
                return;
            }

            // Paused (game-pause.js): keep showing the last value.
            if (window.isGamePaused?.()) return;

            const now = window.serverNow();
            const elapsed = now - (turnStartedAtMs || now);
            const timeRemaining = gameInactivityTimeout - elapsed;

            if (timeRemaining <= 0) {
                if (timerElement) timerElement.style.display = 'none';
                if (hudTimerValue) hudTimerValue.textContent = '0:00';
                return;
            }

            // Show timer
            if (timerElement) timerElement.style.display = 'inline-block';

            // Calculate percentage remaining
            const percentRemaining = (timeRemaining / gameInactivityTimeout) * 100;

            // Format time
            const secondsRemaining = Math.ceil(timeRemaining / 1000);
            const minutes = Math.floor(secondsRemaining / 60);
            const seconds = secondsRemaining % 60;
            const timeText = minutes > 0 ? `${minutes}:${seconds.toString().padStart(2, '0')}` : `${seconds}s`;

            // Update HUD timer
            if (hudTimerValue) hudTimerValue.textContent = timeText;
            if (hudTimer) {
                if (percentRemaining <= 25) {
                    hudTimer.classList.add('warning');
                } else {
                    hudTimer.classList.remove('warning');
                }
            }

            // Color-code old timer based on time remaining
            let color, bgColor, label;
            if (percentRemaining > 75) {
                color = '#fff';
                bgColor = '#4CAF50';
                label = '⚠️';
            } else if (percentRemaining > 50) {
                color = '#000';
                bgColor = '#FFEB3B';
                label = '⚠️';
            } else if (percentRemaining > 25) {
                color = '#fff';
                bgColor = '#FF9800';
                label = '⚠️';
            } else {
                color = '#fff';
                bgColor = '#f44336';
                label = '💎';
            }

            if (timerElement) {
                timerElement.style.backgroundColor = bgColor;
                timerElement.style.color = color;
                timerElement.textContent = `${label} ${timeText}`;
            }
        }

        // Start timer display updates
        function startTimerDisplay() {
            // Clear any existing interval
            if (timerDisplayInterval) {
                clearInterval(timerDisplayInterval);
            }

            // Update display every second
            timerDisplayInterval = setInterval(updateTimerDisplay, 1000);
            updateTimerDisplay(); // Initial update
        }

        // Stop timer display
        function stopTimerDisplay() {
            if (timerDisplayInterval) {
                clearInterval(timerDisplayInterval);
                timerDisplayInterval = null;
            }
            const timerElement = document.getElementById('inactivity-timer');
            if (timerElement) {
                timerElement.style.display = 'none';
            }
        }

        // Turn timeout enforcement (host only)
        async function checkTurnTimeout() {
            if (!isMultiplayer) return;
            if (!isHost) return;
            if (!gameInactivityTimeout || gameInactivityTimeout === 0) return; // disabled

            // PERF: this used to `await supabase.from('game_room').select('status')`
            // on every single tick of a 1-second interval — a full network round
            // trip, every second, for the entire duration of every hosted game,
            // purely to re-check something that changes rarely. hostTrackedRoomStatus
            // (game-core.js state, kept fresh by lobby.js's gameRoomSubscription
            // postgres_changes handler, which fires on every real status change from
            // any source) gives the same answer with zero network cost on the
            // common path — a real DB write still happens below whenever this
            // function actually decides to kick/reset someone.
            if (hostTrackedRoomStatus !== 'playing') return;

            // Skip enforcement entirely while the connection looks unhealthy —
            // "elapsed" time and hostTrackedRoomStatus are only as trustworthy as
            // the realtime feed keeping them fresh, and kicking/resetting players
            // off a host-side connectivity blip is exactly the kind of confusing,
            // seemingly-random breakage this exists to prevent.
            if (window.ConnectionMonitor && !window.ConnectionMonitor.isWorkable()) return;
            // Game paused (a player's connection dropped, or the host paused):
            // no timeouts. game-pause.js gives the paused time back.
            if (window.isGamePaused?.()) return;
            if (window.SaveGame?.isRebuilding?.()) return; // js/save-game.js: board being rebuilt

            const now = window.serverNow();
            const elapsed = now - (turnStartedAtMs || now);
            if (elapsed < gameInactivityTimeout) return;

            // Time is up — either kick active player or auto-advance
            console.log('⏰ Turn timer expired. kickOnTurnTimeout:', kickOnTurnTimeout, 'activePlayerIndex:', activePlayerIndex, 'isPlacementPhase:', isPlacementPhase);

            // SPECIAL CASE: During placement phase, timeout should kick all players back to lobby
            if (isPlacementPhase) {
                console.log('⏰ Turn timeout during placement phase - resetting game to lobby');
                updateStatus('⏰ Player tile placement timed out - returning all players to lobby');

                // First, kick the AFK player from the lobby
                const { data: allPlayers } = await supabase
                    .from('players')
                    .select('id, username, player_index');

                const afkPlayer = allPlayers?.find(p => p.player_index === activePlayerIndex);

                if (afkPlayer) {
                    console.log(`👢 Kicking AFK player: ${afkPlayer.username} (index ${afkPlayer.player_index})`);
                    const { error: kickErr } = await supabase
                        .from('players')
                        .delete()
                        .eq('id', afkPlayer.id);

                    if (kickErr) {
                        console.error('❌ Failed to kick AFK player:', kickErr);
                    } else {
                        console.log(`✅ AFK player ${afkPlayer.username} removed from lobby`);
                    }
                }

                // Reset game room to waiting status
                const { error: resetErr } = await supabase
                    .from('game_room')
                    .update({ status: 'waiting' })
                    .eq('id', currentGameId);

                if (resetErr) {
                    console.error('❌ Failed to reset game room:', resetErr);
                } else {
                    // Update the local cache immediately rather than waiting on the
                    // realtime echo — otherwise a tick landing before that echo
                    // arrives would still see 'playing' and re-enter this branch.
                    hostTrackedRoomStatus = 'waiting';
                }

                // Wait a moment for DELETE event to propagate to all clients
                await new Promise(resolve => setTimeout(resolve, 500));

                // Broadcast game-reset event to all players
                if (typeof broadcastGameAction === 'function') {
                    broadcastGameAction('game-reset', {
                        reason: 'placement-timeout',
                        kickedPlayerIndex: activePlayerIndex
                    });
                }

                // Reset local game state (host)
                if (typeof resetToLobby === 'function') {
                    resetToLobby();
                }
                return;
            }

            // SPECIAL CASE: If the active player has an unresolved scroll cascade, they forfeit.
            // (They must place the overflowing scroll before ending their turn; if time runs out, they lose.)
            const hasCascade = typeof spellSystem !== 'undefined' && spellSystem.hasPendingCascade(activePlayerIndex);
            if (hasCascade) {
                const forfeiterName = typeof getPlayerColorName === 'function'
                    ? getPlayerColorName(activePlayerIndex) : `Player ${activePlayerIndex + 1}`;
                console.log(`⏰ Cascade forfeit: ${forfeiterName} ran out of time with unresolved cascade`);
                updateStatus(`⏰ ${forfeiterName} ran out of time with an unresolved scroll cascade - forfeiting!`);
                if (typeof broadcastGameAction === 'function') {
                    broadcastGameAction('cascade-forfeit', { playerIndex: activePlayerIndex });
                }
                // Remove the forfeiting player from the game (same as kick path)
                const { data: forfeitPlayers } = await supabase
                    .from('players')
                    .select('id, username, player_index')
                    .eq('game_id', currentGameId);
                const forfeitPlayer = forfeitPlayers?.find(p => p.player_index === activePlayerIndex);
                if (forfeitPlayer) {
                    await supabase.rpc('remove_player', { p_player_id: forfeitPlayer.id });
                }
                await hostAdvanceToNextPlayerAndRestartTimer();
                return;
            }

            // NORMAL GAME PHASE: Use existing kick/auto-advance logic
            if (kickOnTurnTimeout) {
                // Kick active player
                const { data: allPlayers } = await supabase
                    .from('players')
                    .select('id, username, player_index')
                    .eq('game_id', currentGameId);

                const activePlayer = allPlayers?.find(p => p.player_index === activePlayerIndex);

                if (activePlayer) {
                    const { error: kickErr } = await supabase
                        .rpc('remove_player', { p_player_id: activePlayer.id });

                    if (kickErr) {
                        console.error('❌ Failed to kick player (turn timeout):', kickErr);
                        return;
                    }

                    const kickedName = typeof displayUsername === 'function' ? displayUsername(activePlayer.username) : activePlayer.username;
                    updateStatus(`⏰ ${kickedName} was kicked (turn timer expired)`);
                } else {
                    console.warn('⚠️ Turn timeout expired but active player not found in DB');
                }
            } else {
                updateStatus('⏰ Turn timer expired - auto-passing turn.');
            }

            // Advance to next available player and restart the timer
            await hostAdvanceToNextPlayerAndRestartTimer();
        }

        async function hostAdvanceToNextPlayerAndRestartTimer() {
            // Fetch remaining players and choose the next index based on player_index ordering
            const { data: remainingPlayers, error } = await supabase
                .from('players')
                .select('player_index')
                .eq('game_id', currentGameId)
                .order('player_index', { ascending: true });

            if (error) {
                console.error('❌ Failed to read players to advance turn:', error);
                return;
            }

            const indices = (remainingPlayers || [])
                .map(p => p.player_index)
                .filter(i => i !== null && i !== undefined)
                .sort((a, b) => a - b);

            if (indices.length === 0) return;

            // Last player standing — they win
            if (indices.length === 1 && typeof handleGameOver === 'function') {
                console.log('🏆 Last player standing after kick/forfeit:', indices[0]);
                await handleGameOver(indices[0], 'last_standing');
                return;
            }

            // Find next index after current; wrap around
            let nextIndex = indices.find(i => i > activePlayerIndex);
            if (nextIndex === undefined) nextIndex = indices[0];

            activePlayerIndex = nextIndex;

            // Restart timer anchored to host time (server clock)
            const started = window.serverNow();
            turnStartedAtMs = started;
            currentTurnNumber++;

            // Broadcast turn change with shared turn start timestamp and turn number
            broadcastGameAction('turn-change', {
                playerIndex: activePlayerIndex,
                turnStartedAt: started,
                turnNumber: currentTurnNumber,
                revealedTiles: placedTiles.filter(t => !t.flipped && !t.isPlayerTile).map(t => ({ id: t.id, shrineType: t.shrineType }))
            });
            if (typeof persistCurrentTurnIndex === 'function') persistCurrentTurnIndex(activePlayerIndex);

            // Update local display as host
            if (isPlacementPhase) {
                // During placement phase, turn display is handled in the turn-change receiver
            } else {
                updateTurnDisplay();
            }
        }

        // Start turn timer monitoring (host enforcement + local display)
        function startTurnTimerMonitoring() {
            // Stop any existing
            stopTurnTimerMonitoring();

            // Ensure we have a baseline turn start
            if (!turnStartedAtMs) turnStartedAtMs = window.serverNow();

            // Monitoring only ever starts once a game is genuinely underway —
            // seed the local cache so checkTurnTimeout() has a correct answer
            // before the first gameRoomSubscription update arrives.
            hostTrackedRoomStatus = 'playing';

            // Host enforces every second
            if (isHost) {
                turnTimeoutInterval = setInterval(() => {
                    // avoid unhandled promise rejections
                    checkTurnTimeout().catch(err => console.error('Turn timeout check failed:', err));
                }, 1000);

                // Host also broadcasts periodic sync every 5 seconds
                turnSyncInterval = setInterval(() => {
                    if (isMultiplayer && typeof broadcastGameAction === 'function') {
                        broadcastGameAction('turn-sync', {
                            playerIndex: activePlayerIndex,
                            turnNumber: currentTurnNumber,
                            turnStartedAt: turnStartedAtMs
                        });
                        console.log(`🔄 Turn sync broadcast: turn ${currentTurnNumber}, player ${activePlayerIndex}`);
                    }
                }, 5000);

                // Host also broadcasts common area sync every 10 seconds
                commonAreaSyncInterval = setInterval(() => {
                    if (isMultiplayer && typeof broadcastGameAction === 'function' && typeof spellSystem !== 'undefined') {
                        // Get current common area state
                        const commonAreaState = {};
                        Object.keys(spellSystem.commonArea).forEach(element => {
                            commonAreaState[element] = spellSystem.commonArea[element];
                        });

                        broadcastGameAction('common-area-sync', {
                            commonArea: commonAreaState
                        });
                        console.log(`🔄 Common area sync broadcast:`, commonAreaState);
                    }
                }, 10000);
            }

            // Everyone updates display every second
            startTimerDisplay();
        }

        // Stop turn timer monitoring
        function stopTurnTimerMonitoring() {
            if (turnTimeoutInterval) {
                clearInterval(turnTimeoutInterval);
                turnTimeoutInterval = null;
            }
            if (turnSyncInterval) {
                clearInterval(turnSyncInterval);
                turnSyncInterval = null;
            }
            if (commonAreaSyncInterval) {
                clearInterval(commonAreaSyncInterval);
                commonAreaSyncInterval = null;
            }
            stopTimerDisplay();
        }

        // Sync current player state (AP and resources) in multiplayer
        function syncPlayerState() {
            // Local per-player AP tracking runs regardless of multiplayer — it's
            // what lets response-window.js's getPlayerAP()/spendPlayerAP() find a
            // NON-active responder's real AP (needed for response scrolls cast by
            // anyone but the active player: local hot-seat, arena bots, and real
            // multiplayer bots that have no client of their own). In local/
            // hot-seat/arena play there's only one client running every player's
            // turn, so currentAP/voidAP genuinely belong to activePlayerIndex
            // whenever this runs — same as the isMyTurn === true multiplayer case.
            const isMyTurn = !isMultiplayer || (myPlayerIndex === activePlayerIndex);
            if (!playerAPs[activePlayerIndex]) {
                playerAPs[activePlayerIndex] = { currentAP: 5, voidAP: 0 };
            }
            if (isMyTurn) {
                playerAPs[activePlayerIndex].currentAP = currentAP;
                playerAPs[activePlayerIndex].voidAP = voidAP;
            }

            if (!isMultiplayer) return;

            // Record activity
            recordActivity();

            // Use global currentAP/voidAP only when we ARE the active player;
            // otherwise fall back to last-known stored values for that player.
            const apToSend = isMyTurn ? currentAP : (playerAPs[activePlayerIndex]?.currentAP ?? 5);
            const voidApToSend = isMyTurn ? voidAP : (playerAPs[activePlayerIndex]?.voidAP ?? 0);

            // Only broadcast resources when it's our own turn.
            // When it's not our turn, we must not broadcast the other player's
            // resource pool — we may have modified it locally (e.g. during
            // processPsychicPending), and broadcasting those values would cause
            // the active player's client to double-apply pool changes (e.g.
            // Respirate drawing wind stones twice).
            const activeResources = isMyTurn
                ? (playerPools[activePlayerIndex] || { ...INITIAL_PLAYER_STONES })
                : null;
            // The shared source pools, from the active player (the one drawing and
            // returning stones this turn). Before, only the player's own pool was
            // sent, so each browser had its own source counts and the empty-source
            // rule could pass on one board and fail on another (match 43).
            const sourceSnapshot = isMyTurn ? { ...sourcePool } : null;
            broadcastGameAction('player-state-update', {
                playerIndex: activePlayerIndex,
                currentAP: apToSend,
                voidAP: voidApToSend,
                resources: activeResources,
                source: sourceSnapshot
            });
        }

        // ============================================================
        // WIN CONDITION — activate all 5 elements AND return the pawn
        // to the centre of your own player tile (the "player shrine").
        // Every code path that can complete the win (scroll activation,
        // movement, state sync, broadcasts) funnels through
        // checkWinCondition() below.
        // ============================================================

        function getPlayerShrineTile(playerIndex) {
            return placedTiles.find(t => t.isPlayerTile && t.playerIndex === playerIndex) || null;
        }

        function isPlayerAtOwnShrine(playerIndex) {
            const pos = playerPositions[playerIndex];
            const tile = getPlayerShrineTile(playerIndex);
            if (!pos || !tile) return false;
            return Math.hypot(pos.x - tile.x, pos.y - tile.y) < 5;
        }

        // Rule: a player may not MOVE ONTO the centre hex of another player's
        // tile (their OWN tile's centre is required for the win condition —
        // see isPlayerAtOwnShrine above — so that one stays reachable).
        // Deliberately narrower than "the whole player tile": a player tile's
        // other hexes and bridge hexes are unaffected, only its single centre
        // point (same point isPlayerAtOwnShrine/getPlayerShrineTile checks).
        function isOpponentTileCenter(x, y, forPlayerIndex) {
            return placedTiles.some(t =>
                t.isPlayerTile && t.playerIndex !== null && t.playerIndex !== forPlayerIndex &&
                Math.hypot(t.x - x, t.y - y) < 5);
        }

        // Rule: a hex with a stone on it is transit-only, never a resting
        // place. canPlayerMoveToHex() still lets a pawn move ONTO a
        // stone-occupied hex (with the stone's usual AP cost/blocking rules)
        // so it can be crossed — but once there, only another 'move' is
        // legal. Every position-dependent action (cast, place a stone, break
        // a stone, end turn) checks this and refuses until the pawn moves
        // off onto an empty hex — see castSpell(), attemptBreakStone(),
        // isInPlacementRange() (game-core.js), the end-turn click handler
        // (game-ui.js), and legalActions()/applyAction() (bot-state.js).
        function isPlayerRestingOnStone(playerIndex) {
            const pos = playerPositions[playerIndex];
            if (!pos) return false;
            return placedStones.some(s => Math.hypot(s.x - pos.x, s.y - pos.y) < 5);
        }

        // Rule (owner 2026-10-06): you may walk across another player's tile,
        // but you may never END your turn on any hex of it. "On it" = within
        // TILE_SIZE * 4 of its centre: the tile's 13 hexes plus its bridge
        // hexes (every board hex at most 2 steps from the centre; the nearest
        // hex 3 steps away is ~92 px off, the farthest 2-step hex ~69 px).
        // Same radius bot-sim.js uses for "pawn on a tile". Checked by the
        // end-turn button (game-ui.js), bot-state.js and bot-sim.js.
        function isPlayerOnOpponentTile(playerIndex) {
            const pos = playerPositions[playerIndex];
            if (!pos) return false;
            return placedTiles.some(t =>
                t.isPlayerTile && t.playerIndex !== null && t.playerIndex !== undefined &&
                t.playerIndex !== playerIndex &&
                Math.hypot(t.x - pos.x, t.y - pos.y) < TILE_SIZE * 4);
        }

        // Stranded = resting on a stone with no legal move to escape it (0 AP
        // with nothing free/affordable adjacent). isPlayerRestingOnStone's ban
        // on ending the turn there would otherwise hard-deadlock the game —
        // no move, no cast/place/break (also banned while resting), no end
        // turn. endTurn alone gets this escape hatch; every other
        // position-dependent action stays banned regardless of AP, since
        // being stranded doesn't make casting/placing/breaking legitimate.
        // Also covers standing on another player's tile with no move left
        // (isPlayerOnOpponentTile): ending the turn there is banned too, so it
        // needs the same escape hatch.
        function isPlayerStrandedOnStone(playerIndex) {
            if (!isPlayerRestingOnStone(playerIndex) && !isPlayerOnOpponentTile(playerIndex)) return false;
            const pos = playerPositions[playerIndex];
            const ap = (playerIndex === activePlayerIndex && typeof getTotalAP === 'function') ? getTotalAP() : 0;
            // Mirrors legalActions()'s own move enumeration (bot-state.js),
            // which gates the WHOLE move block on ap > 0 — even a free (0
            // cost) wind-stone move isn't offered at exactly 0 AP. Matching
            // that here means this never reports "has an escape" when the
            // actual action list would offer none.
            const hexes = ap > 0 ? getAllHexagonPositions() : [];
            const hasEscape = hexes.some(h => {
                const d = Math.hypot(h.x - pos.x, h.y - pos.y);
                if (d <= 5 || d >= 40) return false;
                const mv = canPlayerMoveToHex(h.x, h.y, false);
                return mv.canMove && mv.cost <= ap;
            });
            return !hasEscape;
        }

        // ============================================================
        // DYNAMIC MUSIC TENSION — drives Joytone's BPM + BITS/RATE/DEREZ
        // ============================================================
        // Each player has 6 progress steps: up to 5 for activated scrolls
        // (objectives — same count checkWinCondition below requires), +1 for
        // having returned to their own shrine once all 5 are done (the
        // "return trip" leg of the win condition, via isPlayerAtOwnShrine).
        function getPlayerProgressScore(playerIndex) {
            const scrolls = (typeof spellSystem !== 'undefined' && spellSystem)
                ? spellSystem.playerScrolls?.[playerIndex] : null;
            const objectives = Math.min(scrolls?.activated?.size || 0, 5);
            const returned = (objectives >= 5 && isPlayerAtOwnShrine(playerIndex)) ? 1 : 0;
            return objectives + returned; // 0-6
        }

        // leaderScore (furthest-along player, 0-6) and partyAverage (mean of
        // everyone's 0-6 score) are both already per-player scales, so
        // tension never depends on headcount — a 2-player and a 5-player
        // game with the same leader progress land on close to the same
        // tension/BPM. Forwarded to js/joytone-bridge.js, which threads it
        // into the iframe's JoytoneAPI.setTension().
        function updateMusicTension() {
            if (!window.JoytoneBridge || !totalPlayers || totalPlayers < 1) return;
            let leaderScore = 0, sum = 0;
            for (let i = 0; i < totalPlayers; i++) {
                const score = getPlayerProgressScore(i);
                if (score > leaderScore) leaderScore = score;
                sum += score;
            }
            const partyAverage = sum / totalPlayers;
            const tension = Math.max(0, Math.min(1, (leaderScore * 6 + partyAverage * 2) / 48));
            window.JoytoneBridge.setTension(tension);
        }
        window.updateMusicTension = updateMusicTension;

        // Single win-condition gate. Returns true when the win fired.
        // Safe to call repeatedly from any path: showLevelComplete and
        // handleGameOver both guard against double-fire.
        // opts.announce — when the elements are complete but the pawn is
        // not home yet, prompt the local player to return to their shrine
        // (used by activation-time callers; movement callers stay quiet).
        // Also the single connection point for updateMusicTension() above:
        // this already fires after every scroll activation (objective
        // complete) AND after every move (catches the return-trip leg
        // arriving home), so recomputing tension here — before the early
        // returns below — covers both trigger points the task calls for
        // without scattering calls across every activation/movement site.
        function checkWinCondition(playerIndex, opts = {}) {
            updateMusicTension();
            if (playerIndex === null || playerIndex === undefined) return false;
            const scrolls = (typeof spellSystem !== 'undefined' && spellSystem)
                ? spellSystem.playerScrolls?.[playerIndex] : null;
            if (!scrolls || !scrolls.activated || scrolls.activated.size < 5) return false;

            if (!isPlayerAtOwnShrine(playerIndex)) {
                // Elements complete, pawn not home — beacon the shrine (public
                // info, like the element pips) and nudge the local player.
                updateShrineReturnBeacon(playerIndex, true);
                if (opts.announce) notifyReturnToShrine(playerIndex);
                return false;
            }

            updateShrineReturnBeacon(playerIndex, false);
            const isLocalWinner = !isMultiplayer ||
                (typeof myPlayerIndex !== 'undefined' && playerIndex === myPlayerIndex);
            if (isLocalWinner) {
                spellSystem.showLevelComplete(playerIndex);
            }
            // Solo games have no handleGameOver() call (multiplayer-only) — upload
            // the session log here instead, gated on the same consent flag.
            // Multiplayer relies solely on handleGameOver() below to avoid a
            // double-fire race between this branch and that one.
            if (!isMultiplayer && typeof window.uploadSessionLogIfConsented === 'function') {
                window.uploadSessionLogIfConsented({ isMultiplayer: false });
            }
            if (isMultiplayer && typeof handleGameOver === 'function') {
                handleGameOver(playerIndex);
            }
            return true;
        }

        function notifyReturnToShrine(playerIndex) {
            const isLocal = !isMultiplayer ||
                (typeof myPlayerIndex !== 'undefined' && playerIndex === myPlayerIndex);
            if (!isLocal) return;
            updateStatus('🏠 All five elements activated! Return to the centre of your player shrine to win!');
        }

        // Pulsing ring on the player's shrine centre while they still need
        // to walk home to claim the win. Removed once the win fires.
        function updateShrineReturnBeacon(playerIndex, show) {
            const tile = getPlayerShrineTile(playerIndex);
            if (!tile || !tile.element) return;
            const existing = tile.element.querySelector('.shrine-return-beacon');
            if (!show) {
                if (existing) existing.remove();
                return;
            }
            if (existing) return;
            const ring = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            ring.setAttribute('class', 'shrine-return-beacon');
            ring.setAttribute('cx', 0);
            ring.setAttribute('cy', 0);
            ring.setAttribute('r', TILE_SIZE);
            ring.setAttribute('fill', 'none');
            ring.setAttribute('stroke', playerPositions[playerIndex]?.color || '#f0c040');
            ring.setAttribute('stroke-width', '3');
            ring.style.pointerEvents = 'none';
            const animR = document.createElementNS('http://www.w3.org/2000/svg', 'animate');
            animR.setAttribute('attributeName', 'r');
            animR.setAttribute('values', `${TILE_SIZE * 0.6};${TILE_SIZE * 1.4};${TILE_SIZE * 0.6}`);
            animR.setAttribute('dur', '1.6s');
            animR.setAttribute('repeatCount', 'indefinite');
            ring.appendChild(animR);
            const animO = document.createElementNS('http://www.w3.org/2000/svg', 'animate');
            animO.setAttribute('attributeName', 'stroke-opacity');
            animO.setAttribute('values', '0.9;0.3;0.9');
            animO.setAttribute('dur', '1.6s');
            animO.setAttribute('repeatCount', 'indefinite');
            ring.appendChild(animO);
            tile.element.appendChild(ring);
        }

        // Expose for modules outside the shared lexical scope (bot files, handlers)
        window.checkWinCondition = checkWinCondition;
        window.isPlayerAtOwnShrine = isPlayerAtOwnShrine;
        window.getPlayerShrineTile = getPlayerShrineTile;

        // Show tooltip with player's AP and resources
        function updatePlayerElementSymbols(playerIndex = null) {
            // If no player index specified, use active player
            if (playerIndex === null) {
                playerIndex = activePlayerIndex;
            }
            
            // Find THIS player's tile
            const playerTile = placedTiles.find(t => t.isPlayerTile && t.playerIndex === playerIndex);
            if (!playerTile) {
                console.log(`No player tile found for player ${playerIndex}`);
                return;
            }

            const symbolsGroup = playerTile.element.querySelector('.player-tile-element-symbols');
            if (!symbolsGroup) return;

            // Clear existing symbols
            symbolsGroup.innerHTML = '';

            // Get activated elements for THIS specific player
            const playerScrollData = spellSystem.playerScrolls[playerIndex];
            if (!playerScrollData) return;
            
            const activated = playerScrollData.activated;
            const activatedElements = Array.from(activated);

            // One row, always earth, water, fire, wind, void from left to right
            // (owner 2026-10-01; was a pentagon around the pawn). Below the
            // center hex so the pawn never covers it. Not-yet-won elements are
            // faint empty rings so the order is always clear. The group is kept
            // level when the map is turned (updateViewport).
            const elementOrder = ['earth', 'water', 'fire', 'wind', 'void'];
            const R = 7.5, GAP = 17, ROW_Y = TILE_SIZE * 1.5;
            elementOrder.forEach((element, index) => {
                const x = (index - 2) * GAP;
                const y = ROW_Y;
                const won = activated.has(element);

                // Outline ring so the pip is visible against any background
                const symbolBg = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
                symbolBg.setAttribute('cx', x);
                symbolBg.setAttribute('cy', y);
                symbolBg.setAttribute('r', R);
                symbolBg.setAttribute('fill', won ? '#000' : 'rgba(0,0,0,0.35)');
                symbolBg.setAttribute('stroke', STONE_TYPES[element].color);
                symbolBg.setAttribute('stroke-width', won ? '1.5' : '1');
                if (!won) symbolBg.setAttribute('stroke-opacity', '0.45');
                symbolsGroup.appendChild(symbolBg);
                if (!won) return;

                // Element image (screen blend so black bg is transparent)
                const imgEl = document.createElementNS('http://www.w3.org/2000/svg', 'image');
                imgEl.setAttribute('href', STONE_TYPES[element].img);
                imgEl.setAttribute('x', x - R);
                imgEl.setAttribute('y', y - R);
                imgEl.setAttribute('width', R * 2);
                imgEl.setAttribute('height', R * 2);
                imgEl.setAttribute('clip-path', `circle(${R}px at center)`);
                imgEl.style.mixBlendMode = 'screen';
                symbolsGroup.appendChild(imgEl);
            });
            levelPlayerTileSymbols();

            console.log(`🎨 Updated player ${playerIndex}'s TILE with ${activatedElements.length} element symbol(s): ${activatedElements.join(', ')}`);

            // Refresh Players panel win-condition progress
            if (typeof updateOpponentPanel === 'function') updateOpponentPanel();
        }

        // Expose on window so scroll-effects.js (outside this IIFE) can call it
        window.updatePlayerElementSymbols = updatePlayerElementSymbols;

        function startPlayerDrag(e, options = {}) {
            const takeFlight = !!options.isTakeFlight || ((typeof window !== 'undefined') && window.takeFlightState?.active);
            const playerIndex = (typeof options.playerIndex === 'number') ? options.playerIndex : activePlayerIndex;

            // Check if it's this player's turn (unless Take Flight drag)
            if (!takeFlight && !isMyTurn()) {
                notYourTurn();
                return;
            }

            const draggedPlayer = playerPositions[playerIndex];
            if (!draggedPlayer) {
                console.warn('startPlayerDrag: player not found', playerIndex);
                return;
            }

            isDraggingPlayer = true;
            playerPath = [{ x: draggedPlayer.x, y: draggedPlayer.y, cost: 0 }];
            lastAttemptedHex = null; // Reset logging state
            draggedPlayer.element.remove();

            const { x: screenX, y: screenY } = getBoardScreenXY(e.clientX, e.clientY);
            const world = screenToWorld(screenX, screenY);

            ghostPlayer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            ghostPlayer.setAttribute('class', 'player stone-ghost');
            ghostPlayer.setAttribute('transform', `translate(${world.x}, ${world.y})`);

            const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            circle.setAttribute('cx', 0);
            circle.setAttribute('cy', 0);
            circle.setAttribute('r', TILE_SIZE * 0.4);
            circle.setAttribute('class', 'player-marker');

            ghostPlayer.appendChild(circle);
            viewport.appendChild(ghostPlayer);

            // Create path line (normal movement only)
            if (!takeFlight) {
                pathLine = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
                pathLine.setAttribute('id', 'player-path');
                pathLine.setAttribute('fill', 'none');
                pathLine.setAttribute('stroke', '#58a4f4');
                pathLine.setAttribute('stroke-width', '3');
                pathLine.setAttribute('stroke-dasharray', '5,5');
                pathLine.setAttribute('opacity', '0.7');
                viewport.insertBefore(pathLine, ghostPlayer);
            }
        }

        let lastAttemptedHex = null;

        // Find if target is reachable through a chain of wind stones/water-with-wind
        function findWindPath(startX, startY, targetX, targetY) {
            // BFS to find path through wind stones
            const queue = [{x: startX, y: startY, path: []}];
            const visited = new Set();
            visited.add(`${startX.toFixed(1)},${startY.toFixed(1)}`);

            while (queue.length > 0) {
                const current = queue.shift();

                // Get all wind stones and water-with-wind adjacent to current position
                const windStones = getAdjacentWindStones(current.x, current.y);

                // Also check water with chained wind
                const neighbors = getNeighborStones(current.x, current.y);
                const waterWithWind = neighbors.filter(n => {
                    if (n.type !== 'water') return false;
                    const chainedAbility = getChainedAbility(n.x, n.y);
                    return chainedAbility === 'wind';
                });

                const allWindSources = [...windStones, ...waterWithWind];

                for (const windSource of allWindSources) {
                    const key = `${windSource.x.toFixed(1)},${windSource.y.toFixed(1)}`;

                    // Skip if nullified by void
                    const hasVoid = hasAdjacentStoneType(windSource.x, windSource.y, 'void');
                    if (hasVoid) continue;

                    // Check if target is adjacent to this wind source
                    const windNeighbors = getNeighborHexPositions(windSource.x, windSource.y);
                    const canReachTarget = windNeighbors.some(n =>
                        Math.sqrt(Math.pow(n.x - targetX, 2) + Math.pow(n.y - targetY, 2)) < 5
                    );

                    if (canReachTarget) {
                        // Found a path!
                        return [...current.path, windSource];
                    }

                    // Continue searching through this wind source
                    if (!visited.has(key)) {
                        visited.add(key);
                        queue.push({
                            x: windSource.x,
                            y: windSource.y,
                            path: [...current.path, windSource]
                        });
                    }
                }
            }

            return null; // No path found
        }

        function findGeneralPath(startX, startY, targetX, targetY, maxCost) {
            // A* pathfinding to find cheapest path through any hex
            const openSet = [{x: startX, y: startY, path: [], cost: 0, priority: 0}];
            const visited = new Map();

            while (openSet.length > 0) {
                // Get node with lowest priority (cost + heuristic)
                openSet.sort((a, b) => a.priority - b.priority);
                const current = openSet.shift();

                const key = `${current.x.toFixed(1)},${current.y.toFixed(1)}`;

                // Skip if we've visited this with lower cost
                if (visited.has(key) && visited.get(key) <= current.cost) continue;
                visited.set(key, current.cost);

                // Check if we reached the target
                const distToTarget = Math.sqrt(Math.pow(current.x - targetX, 2) + Math.pow(current.y - targetY, 2));
                if (distToTarget < 5) {
                    return { path: current.path, cost: current.cost };
                }

                // Explore neighbors
                const neighbors = getNeighborHexPositions(current.x, current.y);
                for (const neighbor of neighbors) {
                    const moveCheck = canPlayerMoveToHex(neighbor.x, neighbor.y);

                    if (moveCheck.canMove) {
                        const newCost = current.cost + moveCheck.cost;

                        // Skip if would exceed max cost
                        if (newCost > maxCost) continue;

                        const neighborKey = `${neighbor.x.toFixed(1)},${neighbor.y.toFixed(1)}`;

                        // Skip if already visited with lower cost
                        if (visited.has(neighborKey) && visited.get(neighborKey) <= newCost) continue;

                        // Calculate heuristic (straight-line distance to target)
                        const heuristic = Math.sqrt(Math.pow(neighbor.x - targetX, 2) + Math.pow(neighbor.y - targetY, 2)) / TILE_SIZE;

                        openSet.push({
                            x: neighbor.x,
                            y: neighbor.y,
                            path: [...current.path, {x: neighbor.x, y: neighbor.y, cost: moveCheck.cost}],
                            cost: newCost,
                            priority: newCost + heuristic
                        });
                    }
                }
            }

            return null; // No path found
        }

        function getAdjacentWindStones(x, y) {
            const neighbors = getNeighborHexPositions(x, y);
            const windStones = [];

            neighbors.forEach(neighborPos => {
                const stone = placedStones.find(s => {
                    const dist = Math.sqrt(Math.pow(s.x - neighborPos.x, 2) + Math.pow(s.y - neighborPos.y, 2));
                    if (dist >= 5) return false;

                    // Check if it's wind or water mimicking wind
                    const effectiveType = getEffectiveStoneType(s);
                    return effectiveType === 'wind';
                });
                if (stone) {
                    windStones.push(stone);
                }
            });

            return windStones;
        }

        function getAdjacentEarthStones(x, y) {
            const neighbors = getNeighborHexPositions(x, y);
            const earthStones = [];

            neighbors.forEach(neighborPos => {
                const stone = placedStones.find(s => {
                    const dist = Math.sqrt(Math.pow(s.x - neighborPos.x, 2) + Math.pow(s.y - neighborPos.y, 2));
                    if (dist >= 5) return false;

                    // Check if it's earth or water mimicking earth
                    const effectiveType = getEffectiveStoneType(s);
                    return effectiveType === 'earth';
                });
                if (stone) {
                    earthStones.push(stone);
                }
            });

            return earthStones;
        }

        // Get the chained ability for a water stone by flood-filling through connected water
        function getChainedAbility(x, y) {
            // Only water stones can receive chained abilities
            const stone = placedStones.find(s => {
                const dist = Math.sqrt(Math.pow(s.x - x, 2) + Math.pow(s.y - y, 2));
                return dist < 5;
            });

            if (!stone || stone.type !== 'water') {
                return null; // Not a water stone
            }

            // Check if THIS water stone is nullified by void
            const waterNullified = hasAdjacentStoneType(x, y, 'void');
            if (waterNullified) {
                return null; // Water's chaining ability is nullified by adjacent void
            }

            // Flood fill through connected water to find wind/earth sources
            const visited = new Set();
            const queue = [{x, y}];
            visited.add(`${x.toFixed(1)},${y.toFixed(1)}`);

            let hasWind = false;
            let hasEarth = false;

            while (queue.length > 0) {
                const current = queue.shift();
                const neighbors = getNeighborStones(current.x, current.y);

                for (const neighbor of neighbors) {
                    const key = `${neighbor.x.toFixed(1)},${neighbor.y.toFixed(1)}`;

                    // Check if this neighbor is a source stone (wind or earth, not nullified by void)
                    if (neighbor.type === 'wind') {
                        const voidNullified = hasAdjacentStoneType(neighbor.x, neighbor.y, 'void');
                        if (!voidNullified) {
                            hasWind = true;
                        }
                    } else if (neighbor.type === 'earth') {
                        const voidNullified = hasAdjacentStoneType(neighbor.x, neighbor.y, 'void');
                        if (!voidNullified) {
                            hasEarth = true;
                        }
                    }

                    // If neighbor is water and not visited, add to queue to continue flood fill
                    if (neighbor.type === 'water' && !visited.has(key)) {
                        // Check if this water is nullified by void
                        const neighborWaterNullified = hasAdjacentStoneType(neighbor.x, neighbor.y, 'void');
                        if (!neighborWaterNullified) {
                            visited.add(key);
                            queue.push({x: neighbor.x, y: neighbor.y});
                        }
                    }
                }
            }

            // Wind outranks earth
            if (hasWind) return 'wind';
            if (hasEarth) return 'earth';
            return null; // No chained ability
        }

        function updatePlayerPath(x, y) {
            const targetPos = findNearestHexPosition(x, y);
            if (!targetPos.valid) return;

            const startPos = playerPath[0];
            if (!startPos) return;

            const targetKey = `${Math.round(targetPos.x)},${Math.round(targetPos.y)}`;

            // No-op if cursor hasn't moved to a different hex
            if (targetKey === lastAttemptedHex) return;
            lastAttemptedHex = targetKey;

            // Cursor on start hex → reset path to just the origin
            if (Math.hypot(targetPos.x - startPos.x, targetPos.y - startPos.y) < 5) {
                playerPath = [{ x: startPos.x, y: startPos.y, cost: 0 }];
                _applyPathToLine();
                updatePathLabels();
                return;
            }

            // Cursor is on an existing path node → backtrack to that point
            for (let i = playerPath.length - 1; i >= 1; i--) {
                if (Math.hypot(playerPath[i].x - targetPos.x, playerPath[i].y - targetPos.y) < 5) {
                    playerPath = playerPath.slice(0, i + 1);
                    _applyPathToLine();
                    updatePathLabels();
                    return;
                }
            }

            // Cursor is already at the end of the path → nothing to do
            const lastPos = playerPath[playerPath.length - 1];
            if (Math.hypot(lastPos.x - targetPos.x, lastPos.y - targetPos.y) < 5) return;

            // Find the shortest affordable path from start to the cursor hex using Dijkstra
            const newPath = _dijkstraPath(startPos, targetPos);
            if (newPath) playerPath = newPath;

            _applyPathToLine();
            updatePathLabels();
        }

        /**
         * Dijkstra shortest-path from startPos to targetPos across placed hexes.
         * Returns a playerPath array [{x, y, cost}] or null if unreachable / unaffordable.
         */
        function _dijkstraPath(startPos, targetPos) {
            const hexes = getAllHexagonPositions();
            const SNAP_R = TILE_SIZE * 0.6;
            const key = (x, y) => `${Math.round(x)},${Math.round(y)}`;
            const startKey = key(startPos.x, startPos.y);
            const targetKey = key(targetPos.x, targetPos.y);
            const totalAP = getTotalAP();

            // Snap a theoretical neighbour position to the nearest actual placed hex
            const snapNeighbor = (nx, ny) => {
                let best = null, bestD = SNAP_R;
                for (const h of hexes) {
                    const d = Math.hypot(h.x - nx, h.y - ny);
                    if (d < bestD) { bestD = d; best = h; }
                }
                return best;
            };

            const dist     = new Map([[startKey, 0]]);
            const prev     = new Map([[startKey, null]]);
            const costMap  = new Map([[startKey, 0]]);
            const posMap   = new Map([[startKey, startPos]]);
            const queue    = [{ cost: 0, key: startKey }];

            while (queue.length) {
                // Simple priority queue — board is small so this is fast enough
                queue.sort((a, b) => a.cost - b.cost);
                const curr = queue.shift();
                if (curr.key === targetKey) break;
                if (curr.cost > (dist.get(curr.key) ?? Infinity)) continue;

                const currPos = posMap.get(curr.key);
                for (const nb of getNeighborHexPositions(currPos.x, currPos.y)) {
                    const snapped = snapNeighbor(nb.x, nb.y);
                    if (!snapped) continue;

                    const nKey = key(snapped.x, snapped.y);
                    const moveCheck = canPlayerMoveToHex(snapped.x, snapped.y);
                    if (!moveCheck.canMove) continue;

                    const newDist = curr.cost + moveCheck.cost;
                    if (newDist > totalAP) continue;
                    if (newDist >= (dist.get(nKey) ?? Infinity)) continue;

                    dist.set(nKey, newDist);
                    prev.set(nKey, curr.key);
                    costMap.set(nKey, moveCheck.cost);
                    posMap.set(nKey, snapped);
                    queue.push({ cost: newDist, key: nKey });
                }
            }

            if (!dist.has(targetKey)) return null;

            // Reconstruct path by following parent pointers
            const path = [];
            let k = targetKey;
            while (k !== null) {
                const p = posMap.get(k);
                path.unshift({ x: p.x, y: p.y, cost: costMap.get(k) });
                k = prev.get(k);
            }
            return path;
        }

        /** Sync the SVG polyline to the current playerPath */
        function _applyPathToLine() {
            if (!pathLine) return;
            if (playerPath.length > 1) {
                pathLine.setAttribute('points', playerPath.map(p => `${p.x},${p.y}`).join(' '));
            } else {
                pathLine.setAttribute('points', '');
            }
        }

        function updatePathLabels() {
            // Remove old labels
            pathCostLabels.forEach(label => label.remove());
            pathCostLabels = [];

            if (playerPath.length < 2) return;

            // Calculate cumulative costs and remaining AP for each segment.
            // The number is the AP left after that step, void AP included
            // (owner, 2026-10-01: it used to ignore void AP). Void AP is spent
            // first (spendAP), so steps paid with it are purple, the rest green,
            // and steps you can't afford red.
            const steamBuff = getSteamVentsBuff();
            let cumulativeCost = 0;
            let banked = steamBuff ? steamBuff.freeStepBanked : false;
            const totalAP = getTotalAP();
            // Keep the numbers upright and above the line on screen when the
            // map is rotated (they used to turn with the board).
            const rot = viewportRotation || 0;
            const rad = rot * Math.PI / 180;
            const offX = -8 * Math.sin(rad), offY = -8 * Math.cos(rad);

            for (let i = 1; i < playerPath.length; i++) {
                const currentSegment = playerPath[i];
                const stepCost = currentSegment.cost;
                if (steamBuff && stepCost > 0 && banked) {
                    banked = false; // free step
                } else {
                    cumulativeCost += stepCost;
                    if (steamBuff && stepCost > 0) banked = true;
                }
                const remainingAP = totalAP - cumulativeCost;
                const fill = remainingAP < 0 ? '#e74c3c'
                    : (voidAP > 0 && cumulativeCost <= voidAP && stepCost > 0) ? '#b48cff'
                    : '#2ecc71';

                // Calculate midpoint between this segment and previous
                const prevSegment = playerPath[i - 1];
                const midX = (currentSegment.x + prevSegment.x) / 2;
                const midY = (currentSegment.y + prevSegment.y) / 2;
                const lx = midX + offX, ly = midY + offY;

                // Create label
                const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
                label.setAttribute('x', lx);
                label.setAttribute('y', ly);
                if (rot) label.setAttribute('transform', `rotate(${-rot} ${lx} ${ly})`);
                label.setAttribute('text-anchor', 'middle');
                label.setAttribute('dominant-baseline', 'middle');
                label.setAttribute('fill', fill);
                label.setAttribute('font-size', '14');
                label.setAttribute('font-weight', 'bold');
                label.setAttribute('stroke', '#000');
                label.setAttribute('stroke-width', '0.5');
                label.setAttribute('paint-order', 'stroke');
                label.textContent = remainingAP;

                viewport.appendChild(label);
                pathCostLabels.push(label);
            }
        }

        function getNeighborHexPositions(x, y) {
            const neighbors = [];
            const s = TILE_SIZE;
            const dirs = [
                { q: 1, r: 0 }, { q: 1, r: -1 }, { q: 0, r: -1 },
                { q: -1, r: 0 }, { q: -1, r: 1 }, { q: 0, r: 1 }
            ];

            for (const dir of dirs) {
                const pos = hexToPixel(dir.q, dir.r, s);
                neighbors.push({ x: x + pos.x, y: y + pos.y });
            }
            return neighbors;
        }

        function calculatePathCost() {
            let totalCost = 0;
            const steamBuff = getSteamVentsBuff();
            if (steamBuff) {
                // Steam Vents: every other AP-costing step is free
                // Start from the buff's current banked state
                let banked = steamBuff.freeStepBanked;
                for (let i = 1; i < playerPath.length; i++) {
                    const stepCost = playerPath[i].cost;
                    if (stepCost > 0 && banked) {
                        // This step is free (banked from previous paid step)
                        banked = false;
                    } else {
                        totalCost += stepCost;
                        if (stepCost > 0) banked = true; // Bank a free step for next
                    }
                }
            } else {
                for (let i = 1; i < playerPath.length; i++) {
                    totalCost += playerPath[i].cost;
                }
            }
            return totalCost;
        }

        function getSteamVentsBuff() {
            const buff = spellSystem?.scrollEffects?.activeBuffs?.steamVents;
            return (buff && buff.playerIndex === activePlayerIndex) ? buff : null;
        }

        function hasSteamVentsBuff() {
            return !!getSteamVentsBuff();
        }

        // After committing movement, update the Steam Vents banked state
        // so future moves in the same turn remember the alternation
        function commitSteamVentsState(path) {
            const buff = getSteamVentsBuff();
            if (!buff) return;
            let banked = buff.freeStepBanked;
            for (let i = 1; i < path.length; i++) {
                const stepCost = path[i].cost;
                if (stepCost > 0 && banked) {
                    banked = false;
                } else if (stepCost > 0) {
                    banked = true;
                }
            }
            buff.freeStepBanked = banked;
            console.log(`♨️ Steam Vents: freeStepBanked now = ${banked}`);
        }
        if (typeof window !== 'undefined') window.commitSteamVentsState = commitSteamVentsState;

        // Calculate movement cost for tap-to-move (simple BFS pathfinding)
        function calculateTapMoveCost(startPos, endPos) {
            const allHexes = getAllHexagonPositions();
            if (allHexes.length === 0) return -1;

            // Find start and end hexes
            let startHex = null, endHex = null;
            allHexes.forEach(hex => {
                const startDist = Math.sqrt(Math.pow(hex.x - startPos.x, 2) + Math.pow(hex.y - startPos.y, 2));
                const endDist = Math.sqrt(Math.pow(hex.x - endPos.x, 2) + Math.pow(hex.y - endPos.y, 2));
                if (startDist < 5) startHex = hex;
                if (endDist < 5) endHex = hex;
            });

            if (!startHex || !endHex) return -1;
            if (startHex.key === endHex.key) return 0;

            // BFS to find shortest path
            const visited = new Set();
            const steamBuff = getSteamVentsBuff();
            const startBanked = steamBuff ? steamBuff.freeStepBanked : false;
            const queue = [{ hex: startHex, cost: 0, banked: startBanked }];
            visited.add(startHex.key);

            while (queue.length > 0) {
                const { hex, cost, banked } = queue.shift();

                // Find adjacent hexes (within ~35 units - one hex step)
                const neighbors = allHexes.filter(h => {
                    if (visited.has(h.key)) return false;
                    const dist = Math.sqrt(Math.pow(h.x - hex.x, 2) + Math.pow(h.y - hex.y, 2));
                    return dist > 5 && dist < 40; // Adjacent hex distance
                });

                for (const neighbor of neighbors) {
                    const moveCheck = canPlayerMoveToHex(neighbor.x, neighbor.y, false);
                    if (!moveCheck.canMove) continue;

                    let newCost = cost;
                    let newBanked = banked;
                    const stepCost = moveCheck.cost ?? 1;
                    if (steamBuff && stepCost > 0 && newBanked) {
                        newBanked = false; // free step
                    } else {
                        newCost += stepCost;
                        if (steamBuff && stepCost > 0) newBanked = true;
                    }
                    visited.add(neighbor.key);

                    if (neighbor.key === endHex.key) {
                        return newCost;
                    }

                    queue.push({ hex: neighbor, cost: newCost, banked: newBanked });
                }
            }

            return -1; // No path found
        }

        let nextStoneId = 1; // Global counter for unique stone IDs

        // Returns a darkened version of a hex color (factor 0–1)
        function darkenHex(hex, factor) {
            const c = hex.replace('#', '');
            const r = Math.round(parseInt(c.slice(0, 2), 16) * factor);
            const g = Math.round(parseInt(c.slice(2, 4), 16) * factor);
            const b = Math.round(parseInt(c.slice(4, 6), 16) * factor);
            return `rgb(${r},${g},${b})`;
        }

        function placeStone(x, y, type) {
            const stoneId = nextStoneId++;
            console.log(`   Placing stone: id=${stoneId}, type=${type}, position=(${x.toFixed(1)}, ${y.toFixed(1)})`);

            // Broadcast stone placement to other players
            broadcastGameAction('stone-place', {
                x: x,
                y: y,
                stoneType: type
            });

            const stoneGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            stoneGroup.setAttribute('class', 'stone');
            stoneGroup.setAttribute('data-stone-id', stoneId);
            stoneGroup.setAttribute('transform', `translate(${x}, ${y})`);

            const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            circle.setAttribute('cx', 0);
            circle.setAttribute('cy', 0);
            circle.setAttribute('r', STONE_SIZE);
            circle.setAttribute('class', 'stone-piece');
            circle.setAttribute('fill', darkenHex(STONE_TYPES[type].color, 0.55));
            circle.setAttribute('stroke', STONE_TYPES[type].color);
            circle.setAttribute('stroke-width', '1.5');

            const stoneImg = document.createElementNS('http://www.w3.org/2000/svg', 'image');
            stoneImg.setAttribute('href', STONE_TYPES[type].img);
            stoneImg.setAttribute('x', -STONE_SIZE);
            stoneImg.setAttribute('y', -STONE_SIZE);
            stoneImg.setAttribute('width', STONE_SIZE * 2);
            stoneImg.setAttribute('height', STONE_SIZE * 2);
            // No opacity reduction — symbol renders at full strength

            stoneGroup.appendChild(circle);
            stoneGroup.appendChild(stoneImg);

            stoneGroup.addEventListener('mousedown', (e) => {
                e.stopPropagation();
                e.preventDefault();
                if (e.button !== 0) return;

                const currentPlayerIdx = (typeof myPlayerIndex !== 'undefined' && myPlayerIndex !== null)
                    ? myPlayerIndex
                    : activePlayerIndex;
                const canMoveStone = spellSystem
                    && spellSystem.scrollEffects
                    && typeof spellSystem.scrollEffects.hasWindStoneMove === 'function'
                    && spellSystem.scrollEffects.hasWindStoneMove(currentPlayerIdx);

                if (canMoveStone) {
                    startStoneDrag(stoneId, e);
                    return;
                }

                // Stone dragging disabled - stones can only be placed from pool or broken (right-click)
                updateStatus('Right-click to break this stone (costs AP based on rank)');
            });

            // Touch support: long-press to break stone
            stoneGroup.addEventListener('touchstart', (e) => {
                e.stopPropagation();
                e.preventDefault();

                const currentPlayerIdx = (typeof myPlayerIndex !== 'undefined' && myPlayerIndex !== null)
                    ? myPlayerIndex
                    : activePlayerIndex;
                const canMoveStone = spellSystem
                    && spellSystem.scrollEffects
                    && typeof spellSystem.scrollEffects.hasWindStoneMove === 'function'
                    && spellSystem.scrollEffects.hasWindStoneMove(currentPlayerIdx);

                if (canMoveStone && e.touches && e.touches.length === 1) {
                    const t = e.touches[0];
                    startStoneDrag(stoneId, {
                        clientX: t.clientX,
                        clientY: t.clientY,
                        button: 0,
                        preventDefault: () => {},
                        stopPropagation: () => {}
                    });
                    return;
                }

                updateStatus('Long-press to break this stone (costs AP based on rank)');
                clearTimeout(stoneLongPressTimer);
                stoneLongPressTimer = setTimeout(() => {
                    attemptBreakStone(stoneId);
                }, 650);
            }, { passive: false });

            stoneGroup.addEventListener('touchend', (e) => {
                clearTimeout(stoneLongPressTimer);
                stoneLongPressTimer = null;
            });

            stoneGroup.addEventListener('contextmenu', (e) => {
                e.stopPropagation();
                e.preventDefault();
                attemptBreakStone(stoneId);
            });

            stoneGroup.addEventListener('mouseenter', (e) => {
                e.stopPropagation();
                
                // Check if stone is adjacent to player and show break cost
                const stone = placedStones.find(s => s.id === stoneId);
                if (stone && playerPosition && isAdjacentToPlayer(stone.x, stone.y)) {
                    const STONE_RANK = { 'void': 1, 'wind': 2, 'fire': 3, 'water': 4, 'earth': 5 };
                    const breakCost = STONE_RANK[stone.type];
                    const canAffordBreak = getTotalAP() >= breakCost;
                    
                    stoneGroup.style.cursor = 'pointer';
                    stoneGroup.style.filter = canAffordBreak ? 'brightness(1.3)' : 'brightness(0.7)';
                    
                    updateStatus(`Right-click to break ${stone.type} stone (${breakCost} AP)${canAffordBreak ? '' : ' - Not enough AP!'}`);
                }
            });

            stoneGroup.addEventListener('mouseleave', (e) => {
                e.stopPropagation();
                stoneGroup.style.filter = '';
            });

            viewport.appendChild(stoneGroup);

            placedStones.push({
                id: stoneId,
                x: x,
                y: y,
                type: type,
                element: stoneGroup
            });

            // Tutorial hook — fires after stone added to placedStones
            if (window.isTutorialMode && window.TutorialMode?.onStonePlaced) {
                window.TutorialMode.onStonePlaced(type, x, y);
            }

            // Track for Burning Motivation: grant AP per stone placed (until end of turn, stacks)
            if (typeof spellSystem !== 'undefined' && spellSystem.scrollEffects) {
                const buff = spellSystem.scrollEffects.activeBuffs?.burningMotivation;
                if (buff && buff.playerIndex === activePlayerIndex && buff.stacks > 0) {
                    const apGain = buff.stacks * 2;
                    if (apGain > 0 && typeof addAP === 'function') {
                        addAP(apGain);
                        if (typeof updateStatus === 'function') {
                            updateStatus(`Burning Motivation! +${apGain} AP for placing a stone.`);
                        }
                    }
                }
            }

            updateTileClasses();
            processStoneInteractions(x, y, type);

            // Re-check all fire stones in case void was moved away
            recheckAllStoneInteractions();

            // Update visuals for all water stones (mimicry indicators)
            updateAllWaterStoneVisuals();

            // Control the Current: if a water stone was just placed during water-transform mode,
            // refresh highlights so the new stone gets its click handler attached immediately
            if (type === 'water' &&
                spellSystem?.scrollEffects?.selectionMode?.type === 'water-transform') {
                spellSystem.scrollEffects.refreshWaterTransformHighlights();
            }

            // Update void nullification indicators
            updateAllVoidNullificationVisuals();

            return stoneId;
        }

        // Place a moved stone without broadcasting or pool changes
        function placeMovedStone(x, y, type, stoneId) {
            const resolvedId = (stoneId != null) ? stoneId : nextStoneId++;
            if (resolvedId >= nextStoneId) nextStoneId = resolvedId + 1;

            const stoneGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            stoneGroup.setAttribute('class', 'stone');
            stoneGroup.setAttribute('data-stone-id', resolvedId);
            stoneGroup.setAttribute('transform', `translate(${x}, ${y})`);

            const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            circle.setAttribute('cx', 0);
            circle.setAttribute('cy', 0);
            circle.setAttribute('r', STONE_SIZE);
            circle.setAttribute('class', 'stone-piece');
            circle.setAttribute('fill', darkenHex(STONE_TYPES[type].color, 0.55));
            circle.setAttribute('stroke', STONE_TYPES[type].color);
            circle.setAttribute('stroke-width', '1.5');

            const stoneImg = document.createElementNS('http://www.w3.org/2000/svg', 'image');
            stoneImg.setAttribute('href', STONE_TYPES[type].img);
            stoneImg.setAttribute('x', -STONE_SIZE);
            stoneImg.setAttribute('y', -STONE_SIZE);
            stoneImg.setAttribute('width', STONE_SIZE * 2);
            stoneImg.setAttribute('height', STONE_SIZE * 2);
            // No opacity reduction — symbol renders at full strength

            stoneGroup.appendChild(circle);
            stoneGroup.appendChild(stoneImg);

            stoneGroup.addEventListener('mousedown', (e) => {
                e.stopPropagation();
                e.preventDefault();
                if (e.button !== 0) return;

                const currentPlayerIdx = (typeof myPlayerIndex !== 'undefined' && myPlayerIndex !== null)
                    ? myPlayerIndex
                    : activePlayerIndex;
                const canMoveStone = spellSystem
                    && spellSystem.scrollEffects
                    && typeof spellSystem.scrollEffects.hasWindStoneMove === 'function'
                    && spellSystem.scrollEffects.hasWindStoneMove(currentPlayerIdx);

                if (canMoveStone) {
                    startStoneDrag(resolvedId, e);
                    return;
                }

                updateStatus('Right-click to break this stone (costs AP based on rank)');
            });

            // Touch support: long-press to break stone (or drag if Wind II is active)
            stoneGroup.addEventListener('touchstart', (e) => {
                e.stopPropagation();
                e.preventDefault();

                const currentPlayerIdx = (typeof myPlayerIndex !== 'undefined' && myPlayerIndex !== null)
                    ? myPlayerIndex
                    : activePlayerIndex;
                const canMoveStone = spellSystem
                    && spellSystem.scrollEffects
                    && typeof spellSystem.scrollEffects.hasWindStoneMove === 'function'
                    && spellSystem.scrollEffects.hasWindStoneMove(currentPlayerIdx);

                if (canMoveStone && e.touches && e.touches.length === 1) {
                    const t = e.touches[0];
                    startStoneDrag(resolvedId, {
                        clientX: t.clientX,
                        clientY: t.clientY,
                        button: 0,
                        preventDefault: () => {},
                        stopPropagation: () => {}
                    });
                    return;
                }

                updateStatus('Long-press to break this stone (costs AP based on rank)');
                clearTimeout(stoneLongPressTimer);
                stoneLongPressTimer = setTimeout(() => {
                    attemptBreakStone(resolvedId);
                }, 650);
            }, { passive: false });

            stoneGroup.addEventListener('touchend', (e) => {
                clearTimeout(stoneLongPressTimer);
                stoneLongPressTimer = null;
            });

            stoneGroup.addEventListener('contextmenu', (e) => {
                e.stopPropagation();
                e.preventDefault();
                attemptBreakStone(resolvedId);
            });

            viewport.appendChild(stoneGroup);

            placedStones.push({
                id: resolvedId,
                x: x,
                y: y,
                type: type,
                element: stoneGroup
            });

            updateTileClasses();
            processStoneInteractions(x, y, type);
            recheckAllStoneInteractions();
            updateAllWaterStoneVisuals();
            updateAllVoidNullificationVisuals();

            return resolvedId;
        }

        // Bot-only: atomically move an existing board stone to a different
        // hex, with none of the drag-and-drop UI (ghost stone, mouse
        // tracking). Mirrors startStoneDrag()'s removal step +
        // placeMovedStone()'s placement step exactly, run back-to-back with
        // no user input in between — used by BotState.applyAction('moveStone')
        // to drive Breath of Power (WIND_SCROLL_2), which has no
        // selectionMode/modal for waitForQuiescence to drive (see
        // hasWindStoneMove — it just re-enables the ordinary drag handler).
        function moveStoneTo(stoneId, x, y) {
            const stone = placedStones.find(s => s.id === stoneId);
            if (!stone) return false;
            const type = stone.type;
            stone.element.remove();
            placedStones = placedStones.filter(s => s.id !== stoneId);
            updateTileClasses();
            recheckAllStoneInteractions();
            updateAllWaterStoneVisuals();
            updateAllVoidNullificationVisuals();

            placeMovedStone(x, y, type, stoneId);
            clearUndo(); // a stone move can't be undone (see game-ui.js stone drop)

            if (typeof isMultiplayer !== 'undefined' && isMultiplayer && typeof broadcastGameAction === 'function') {
                broadcastGameAction('stone-move', { stoneId, x, y, stoneType: type });
            }
            return true;
        }
        window.moveStoneTo = moveStoneTo;

        // Visual-only stone move (called when receiving broadcast from other players)
        function moveStoneVisually(stoneId, x, y, stoneType) {
            const stone = placedStones.find(s => s.id === stoneId);
            if (stone) {
                stone.x = x;
                stone.y = y;
                if (stone.element) {
                    stone.element.setAttribute('transform', `translate(${x}, ${y})`);
                }
                updateTileClasses();
                processStoneInteractions(x, y, stone.type);
                recheckAllStoneInteractions();
                updateAllWaterStoneVisuals();
                updateAllVoidNullificationVisuals();
                return;
            }

            if (stoneType) {
                placeMovedStone(x, y, stoneType, stoneId);
            } else {
                console.log(`⚠️ Cannot move stone ${stoneId} - not found`);
            }
        }

        // Visual-only stone placement (called when receiving broadcast from other players)
        function placeStoneVisually(x, y, stoneType) {
            // Same logic as placeStone but without broadcasting
            const stoneId = nextStoneId++;
            const stoneGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            stoneGroup.setAttribute('class', 'stone');
            stoneGroup.setAttribute('data-stone-id', stoneId);
            stoneGroup.setAttribute('transform', `translate(${x}, ${y})`);

            const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            circle.setAttribute('cx', 0);
            circle.setAttribute('cy', 0);
            circle.setAttribute('r', STONE_SIZE);
            circle.setAttribute('class', 'stone-piece');
            circle.setAttribute('fill', darkenHex(STONE_TYPES[stoneType].color, 0.55));
            circle.setAttribute('stroke', STONE_TYPES[stoneType].color);
            circle.setAttribute('stroke-width', '1.5');

            const stoneImg = document.createElementNS('http://www.w3.org/2000/svg', 'image');
            stoneImg.setAttribute('href', STONE_TYPES[stoneType].img);
            stoneImg.setAttribute('x', -STONE_SIZE);
            stoneImg.setAttribute('y', -STONE_SIZE);
            stoneImg.setAttribute('width', STONE_SIZE * 2);
            stoneImg.setAttribute('height', STONE_SIZE * 2);
            // No opacity reduction — symbol renders at full strength

            stoneGroup.appendChild(circle);
            stoneGroup.appendChild(stoneImg);

            stoneGroup.addEventListener('mousedown', (e) => {
                e.stopPropagation();
                e.preventDefault();
                if (e.button !== 0) return;

                const currentPlayerIdx = (typeof myPlayerIndex !== 'undefined' && myPlayerIndex !== null)
                    ? myPlayerIndex
                    : activePlayerIndex;
                const canMoveStone = spellSystem
                    && spellSystem.scrollEffects
                    && typeof spellSystem.scrollEffects.hasWindStoneMove === 'function'
                    && spellSystem.scrollEffects.hasWindStoneMove(currentPlayerIdx);

                if (canMoveStone) {
                    startStoneDrag(stoneId, e);
                    return;
                }

                updateStatus('Right-click to break this stone (costs AP based on rank)');
            });

            // Touch support: long-press to break stone
            stoneGroup.addEventListener('touchstart', (e) => {
                e.stopPropagation();
                e.preventDefault();

                const currentPlayerIdx = (typeof myPlayerIndex !== 'undefined' && myPlayerIndex !== null)
                    ? myPlayerIndex
                    : activePlayerIndex;
                const canMoveStone = spellSystem
                    && spellSystem.scrollEffects
                    && typeof spellSystem.scrollEffects.hasWindStoneMove === 'function'
                    && spellSystem.scrollEffects.hasWindStoneMove(currentPlayerIdx);

                if (canMoveStone && e.touches && e.touches.length === 1) {
                    const t = e.touches[0];
                    startStoneDrag(stoneId, {
                        clientX: t.clientX,
                        clientY: t.clientY,
                        button: 0,
                        preventDefault: () => {},
                        stopPropagation: () => {}
                    });
                    return;
                }

                updateStatus('Long-press to break this stone (costs AP based on rank)');
                clearTimeout(stoneLongPressTimer);
                stoneLongPressTimer = setTimeout(() => {
                    attemptBreakStone(stoneId);
                }, 650);
            }, { passive: false });

            stoneGroup.addEventListener('touchend', (e) => {
                clearTimeout(stoneLongPressTimer);
                stoneLongPressTimer = null;
            });

            stoneGroup.addEventListener('contextmenu', (e) => {
                e.stopPropagation();
                e.preventDefault();
                attemptBreakStone(stoneId);
            });

            viewport.appendChild(stoneGroup);

            placedStones.push({
                id: stoneId,
                x: x,
                y: y,
                type: stoneType,
                element: stoneGroup
            });

            updateTileClasses();
            processStoneInteractions(x, y, stoneType);
            recheckAllStoneInteractions();
            updateAllWaterStoneVisuals();
            updateAllVoidNullificationVisuals();
        }

        function updateAllWaterStoneVisuals() {
            // Update all water stones to show what they're mimicking
            placedStones.forEach(stone => {
                if (stone.type === 'water') {
                    updateWaterStoneVisual(stone);
                }
            });
        }

        function updateAllVoidNullificationVisuals() {
            // Snapshot which stones already show a nullification indicator
            const prevNullified = new Set();
            placedStones.forEach(stone => {
                if (stone.element.querySelector('.void-nullification-indicator')) {
                    prevNullified.add(stone.id);
                }
            });

            // Void stones that cancel a neighbour are using their ability:
            // class stone-active (js/piece-3d.js makes them glow brighter).
            placedStones.forEach(s => { if (s.type === 'void') s.element?.classList.toggle('stone-active',
                getNeighborStones(s.x, s.y).some(n => n.type === 'fire' || n.type === 'wind' || n.type === 'earth')); });

            // Update all stones to show if they're nullified by void
            let anyNewNullification = false;
            placedStones.forEach(stone => {
                // Remove any existing nullification indicator
                const existingNullIndicator = stone.element.querySelector('.void-nullification-indicator');
                if (existingNullIndicator) {
                    existingNullIndicator.remove();
                }

                // Check if this stone is nullified by adjacent void
                // (Only fire, wind, and earth have abilities that can be nullified)
                if (stone.type === 'fire' || stone.type === 'wind' || stone.type === 'earth') {
                    const hasVoid = hasAdjacentStoneType(stone.x, stone.y, 'void');
                    if (hasVoid) {
                        // Add nullification indicator (X or crossed-out effect)
                        const nullIndicator = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
                        nullIndicator.setAttribute('cx', 0);
                        nullIndicator.setAttribute('cy', 0);
                        nullIndicator.setAttribute('r', STONE_SIZE + 3.5); // close around the stone (owner 2026-10-07; was + 7)
                        nullIndicator.setAttribute('class', 'void-nullification-indicator');
                        nullIndicator.setAttribute('fill', 'none');
                        nullIndicator.setAttribute('stroke', STONE_TYPES['void'].color);
                        nullIndicator.setAttribute('stroke-width', '2');
                        nullIndicator.style.animation = `mimicryGlow 7s ease-in-out infinite`;

                        // Append last so it renders on top of the stone circle
                        stone.element.appendChild(nullIndicator);

                        // Track if this is a newly-nullified stone
                        if (!prevNullified.has(stone.id)) {
                            anyNewNullification = true;
                        }

                        console.log(`✨ ${stone.type} at (${stone.x.toFixed(1)}, ${stone.y.toFixed(1)}) is nullified by void`);

                        // Tutorial hook — fires with the actual nullified stone,
                        // not a proxy "any non-void neighbor" guess.
                        if (window.isTutorialMode && window.TutorialMode?.onStoneNullified) {
                            window.TutorialMode.onStoneNullified(stone);
                        }
                    }
                }
            });

            // Play sound once if any stone became newly nullified
            if (anyNewNullification) {
                window.SoundSystem?.play('voidactivates');
            }
        }

        function updateWaterStoneVisual(waterStone) {
            const effectiveType = getEffectiveStoneType(waterStone);
            const chainedAbility = getChainedAbility(waterStone.x, waterStone.y);

            // Tutorial hook — fires with the water stone's actual, authoritative
            // resolved mimicry type (same value that drives the ring indicator
            // below), not a proxy adjacency guess.
            if (window.isTutorialMode && window.TutorialMode?.onWaterMimicUpdated) {
                window.TutorialMode.onWaterMimicUpdated(waterStone, effectiveType);
            }

            // Remember whether an adoption indicator existed BEFORE we clear it
            const hadIndicator = !!(
                waterStone.element.querySelector('.mimicry-indicator') ||
                waterStone.element.querySelector('.chain-indicator')
            );

            // Remove any existing indicators
            const existingIndicator = waterStone.element.querySelector('.mimicry-indicator');
            if (existingIndicator) {
                existingIndicator.remove();
            }
            const existingChainIndicator = waterStone.element.querySelector('.chain-indicator');
            if (existingChainIndicator) {
                existingChainIndicator.remove();
            }

            // Determine what to show: chained ability takes precedence over mimicry
            // because chaining uses wind-outranks-earth logic
            const displayAbility = chainedAbility || (effectiveType !== 'water' ? effectiveType : null);

            if (displayAbility) {
                const isChained = !!chainedAbility;
                const indicator = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
                indicator.setAttribute('cx', 0);
                indicator.setAttribute('cy', 0);
                // close around the stone (owner 2026-10-07; was + 7, outside the old highlight stroke)
                indicator.setAttribute('r', STONE_SIZE + 3.5);
                indicator.setAttribute('class', isChained ? 'chain-indicator' : 'mimicry-indicator');
                indicator.setAttribute('fill', 'none');
                indicator.setAttribute('stroke', STONE_TYPES[displayAbility].color);
                indicator.setAttribute('stroke-width', '2');
                // Solid ring — no dasharray for any indicator type

                indicator.style.animation = `mimicryGlow 7s ease-in-out infinite`;

                // Inject keyframes once
                if (!document.getElementById('mimicry-glow-style')) {
                    const style = document.createElement('style');
                    style.id = 'mimicry-glow-style';
                    style.textContent = `
                        @keyframes mimicryGlow {
                            0%, 100% { stroke-width: 1.8px; opacity: 0.6; }
                            50%       { stroke-width: 2.4px; opacity: 0.8; }
                        }
                    `;
                    document.head.appendChild(style);
                }

                // Append last so it renders on top of the stone circle and symbol
                waterStone.element.appendChild(indicator);

                // Play adoption sound the first time this water stone gains an ability
                if (!hadIndicator) {
                    window.SoundSystem?.play('wateractivates');
                }

                if (isChained) {
                    console.log(`💧 Water at (${waterStone.x.toFixed(1)}, ${waterStone.y.toFixed(1)}) has chained ${displayAbility} ability`);
                } else {
                    console.log(`💧 Water at (${waterStone.x.toFixed(1)}, ${waterStone.y.toFixed(1)}) is mimicking ${displayAbility}`);
                }
            }
        }

        function getNeighborStones(x, y) {
            const neighbors = [];
            const hexPositions = getAllHexagonPositions();

            hexPositions.forEach(pos => {
                const dist = Math.sqrt(Math.pow(x - pos.x, 2) + Math.pow(y - pos.y, 2));
                if (dist > 5 && dist < TILE_SIZE * 2.5) {
                    const stone = placedStones.find(s => {
                        const stoneDist = Math.sqrt(Math.pow(s.x - pos.x, 2) + Math.pow(s.y - pos.y, 2));
                        return stoneDist < 5;
                    });
                    if (stone) {
                        neighbors.push(stone);
                    }
                }
            });

            return neighbors;
        }

        function hasAdjacentStoneType(x, y, type) {
            const neighbors = getNeighborStones(x, y);
            return neighbors.some(s => s.type === type);
        }

        // Stone rank for water mimicry priority (lower = higher priority)
        const STONE_RANK = {
            'void': 1,
            'wind': 2,
            'fire': 3,
            'water': 4,
            'earth': 5
        };

        // Get the effective type of a stone (considering water mimicry)
        // Is there a wind stone at (x, y), or a water stone using wind's
        // ability (copying or chained)? js/piece-3d.js speeds pawn steps there.
        window.windStoneAt = function (x, y) {
            const st = placedStones.find(s => Math.hypot(s.x - x, s.y - y) < 5);
            if (!st) return false;
            if (st.type === 'wind') return true;
            if (st.type !== 'water') return false;
            try { return getEffectiveStoneType(st) === 'wind' || getChainedAbility(st.x, st.y) === 'wind'; } catch (e) { return false; }
        };
        // Should board animations play? Sound is off (SoundSystem null) in muted
        // bot training and quiet test games, so effects skip there, except
        // when training is switched to Watchable speed (someone is watching).
        window.fxOn = function () {
            if (window.SoundSystem) return true;
            return !!(window.BotArena?.isRunning?.() && (window.BotSystem?.speedScale ?? 0) >= 1);
        };
        // The ability a stone shows (a water stone takes its neighbour's or a
        // chained one, unless a void stone next to it blocks that). Used by
        // js/stone-drop-fx.js to pick the drop animation.
        window.stoneAbilityAt = function (x, y) {
            const st = placedStones.find(s => Math.hypot(s.x - x, s.y - y) < 5);
            if (!st) return null;
            if (st.type !== 'water') return st.type;
            try {
                if (hasAdjacentStoneType(st.x, st.y, 'void')) return 'water';
                return getChainedAbility(st.x, st.y) || getEffectiveStoneType(st);
            } catch (e) { return 'water'; }
        };
        function getEffectiveStoneType(stone) {
            if (stone.type !== 'water') {
                return stone.type;
            }

            // Water mimics adjacent stones
            const neighbors = getNeighborStones(stone.x, stone.y);
            if (neighbors.length === 0) {
                return 'water'; // No neighbors, just water
            }

            // Find highest-ranked adjacent stone (lowest rank number)
            let bestRank = Infinity;
            let mimicType = 'water';

            neighbors.forEach(neighbor => {
                const rank = STONE_RANK[neighbor.type] || 999;
                if (rank < bestRank && neighbor.type !== 'water') {
                    bestRank = rank;
                    mimicType = neighbor.type;
                }
            });

            return mimicType;
        }

        function recheckAllStoneInteractions() {
            // Re-check interactions for all fire stones on the board
            // This ensures fire destroys adjacent stones when void is removed
            const fireStones = placedStones.filter(s => s.type === 'fire');

            fireStones.forEach(stone => {
                const fireHasVoid = hasAdjacentStoneType(stone.x, stone.y, 'void');
                if (!fireHasVoid) {
                    // Fire is not nullified, check what it should destroy
                    const neighbors = getNeighborStones(stone.x, stone.y);
                    const stonesToDestroy = [];
                    neighbors.forEach(neighbor => {
                        // Fire destroys ALL stones except void and fire
                        // (Water is NOT protected - fire destroys water)
                        if (neighbor.type !== 'void' && neighbor.type !== 'fire') {
                            stonesToDestroy.push(neighbor.id);
                        }
                    });

                    // Destroy adjacent stones (using direct removal to avoid recursion)
                    stonesToDestroy.forEach(targetId => {
                        const target = placedStones.find(s => s.id === targetId);
                        if (target) {
                            fireBurnFx(target.x, target.y);
                            target.element.remove();
                            placedStones = placedStones.filter(s => s.id !== targetId);
                            returnStoneToPool(target.type);
                            updateStatus(`Fire destroyed ${target.type} stone!`);
                        }
                    });
                }
            });
        }

        // Fire burning a stone: the short SVG burn (js/stone-drop-fx.js), or
        // the old sprite if that is not loaded. Call before the stone's element
        // is removed.
        function fireBurnFx(x, y) {
            if (window.StoneDropFx?.burn) { window.StoneDropFx.burn(x, y); return; }
            window.effectsSystem?.play('fire_effect', x, y);
        }

        function processStoneInteractions(x, y, type) {
            const neighbors = getNeighborStones(x, y);

            // Special case: water stone placed with both fire and a higher-priority stone
            // Water mimics the higher-priority stone, then gets destroyed by fire
            if (type === 'water') {
                const hasActiveFire = neighbors.some(n => n.type === 'fire' && !hasAdjacentStoneType(n.x, n.y, 'void'));
                if (hasActiveFire) {
                    // Check what the water would mimic
                    const effectiveType = getEffectiveStoneType({ x, y, type: 'water' });
                    // If water is mimicking something other than water or fire, it gets destroyed
                    if (effectiveType !== 'water' && effectiveType !== 'fire') {
                        const stoneToRemove = placedStones.find(s => s.x === x && s.y === y);
                        if (stoneToRemove) {
                            setTimeout(() => {
                                removeStone(stoneToRemove.id);
                                updateStatus(`Water mimicked ${effectiveType}, then was destroyed by fire!`);
                            }, 100);
                        }
                        return; // Stop processing other interactions
                    }
                }
            }

            // Fire destroys adjacent non-void, non-fire stones
            // But only if fire itself is not nullified by an adjacent void
            if (type === 'fire') {
                const fireHasVoid = hasAdjacentStoneType(x, y, 'void');

                if (!fireHasVoid) {
                    const stonesToDestroy = [];
                    neighbors.forEach(neighbor => {
                        // Don't destroy void or fire
                        // Fire destroys ALL other stones, even if they're voided
                        if (neighbor.type !== 'void' && neighbor.type !== 'fire') {
                            stonesToDestroy.push(neighbor);
                        }
                    });

                    // Destroy all adjacent stones (voided or not)
                    if (stonesToDestroy.length > 0) {
                        window.SoundSystem?.play('fireactivates');
                    }
                    stonesToDestroy.forEach(stone => {
                        // Collect for undo (game-ui.js attaches this to lastMove after placeStone returns)
                        if (Array.isArray(window._pendingFireDestroys)) {
                            window._pendingFireDestroys.push({ x: stone.x, y: stone.y, type: stone.type });
                        }
                        fireBurnFx(stone.x, stone.y);
                        removeStone(stone.id);
                        updateStatus(`Fire destroyed ${stone.type} stone!`);
                    });
                }
            }

            // Fire also checks incoming threats
            neighbors.forEach(neighbor => {
                if (neighbor.type === 'fire' && type !== 'void' && type !== 'fire') {
                    const hasVoid = hasAdjacentStoneType(neighbor.x, neighbor.y, 'void');
                    if (!hasVoid) {
                        const stoneToRemove = placedStones.find(s => s.x === x && s.y === y);
                        if (stoneToRemove) {
                            fireBurnFx(x, y);
                            removeStone(stoneToRemove.id);
                            updateStatus(`Fire destroyed ${type} stone!`);
                        }
                    }
                }
            });
        }

        function removeStone(stoneId) {
            const stone = placedStones.find(s => s.id === stoneId);
            if (stone) {
                stone.element.remove();
                placedStones = placedStones.filter(s => s.id !== stoneId);
                returnStoneToPool(stone.type);
                updateTileClasses();

                // Re-check all fire stones to see if they should activate
                recheckAllStoneInteractions();

                // Update all water stone visuals since chaining may have changed
                updateAllWaterStoneVisuals();

                // Update void nullification indicators
                updateAllVoidNullificationVisuals();
            }
        }

        
        function isHexOccupiedByOtherPlayer(x, y) {
            if (!Array.isArray(playerPositions) || typeof activePlayerIndex !== 'number') return false;
            return playerPositions.some((p, idx) => {
                if (!p) return false;
                if (idx === activePlayerIndex) return false; // ignore self
                const dist = Math.hypot(p.x - x, p.y - y);
                return dist < 5; // same positional threshold used elsewhere
            });
        }

        function canPlayerMoveToHex(x, y, logBlocked = false) {
            // Block movement onto hexes occupied by other players (prevents moving "through" players as pathing is step-wise)
            if (isHexOccupiedByOtherPlayer(x, y)) {
                if (logBlocked) console.log(`❌ Cannot move to (${x.toFixed(1)}, ${y.toFixed(1)}): occupied by another player`);
                return { canMove: false, cost: Infinity };
            }

            // Block entering the centre hex of ANOTHER player's tile (your
            // own stays reachable — required for the win condition).
            if (isOpponentTileCenter(x, y, activePlayerIndex)) {
                if (logBlocked) console.log(`❌ Cannot move to (${x.toFixed(1)}, ${y.toFixed(1)}): another player's tile centre`);
                return { canMove: false, cost: Infinity };
            }

            const stone = placedStones.find(s => {
                const dist = Math.sqrt(Math.pow(s.x - x, 2) + Math.pow(s.y - y, 2));
                return dist < 5;
            });

            if (!stone) return { canMove: true, cost: 1 };

            // This function is re-run for every neighbour hex on every
            // pathfinding sweep — Dijkstra recalculates on each mousemove
            // while dragging the pawn. Near a stone, that fires the branch
            // logs below dozens of times a second with nothing actually
            // happening, so they're throttled (shouldDebugLog, same pattern
            // used elsewhere in this file) rather than printed every call.
            const logMoveCost = shouldDebugLog('moveCostChain', 500);

            // Mudslide buff: earth and water stones act as wind stones (free movement)
            const mudslideBuff = spellSystem?.scrollEffects?.activeBuffs?.mudslide;
            if (mudslideBuff && mudslideBuff.playerIndex === activePlayerIndex) {
                if (stone.type === 'earth' || stone.type === 'water') {
                    // Treat as wind stone — free movement, unless nullified by void
                    const hasVoid = hasAdjacentStoneType(x, y, 'void');
                    if (hasVoid) return { canMove: true, cost: 1 };
                    if (logMoveCost) console.log(`🌊 Mudslide: ${stone.type} stone at (${x.toFixed(1)}, ${y.toFixed(1)}) acts as wind (free movement)`);
                    return { canMove: true, cost: 0 };
                }
            }

            // Handle water stones with chaining
            if (stone.type === 'water') {
                const chainedAbility = getChainedAbility(x, y);
                if (logMoveCost) console.log(`💧 Water at (${x.toFixed(1)}, ${y.toFixed(1)}) has chained ability: ${chainedAbility || 'none'}`);

                if (chainedAbility === 'wind') {
                    // Wind chains through water - free movement
                    if (logMoveCost) console.log(`✓ Wind chaining active - water becomes free movement`);
                    return { canMove: true, cost: 0 };
                } else if (chainedAbility === 'earth') {
                    // Earth chains through water - blocks movement
                    if (logMoveCost) console.log(`✓ Earth chaining active - water blocks movement`);
                    if (logBlocked) console.log(`❌ Cannot move to (${x.toFixed(1)}, ${y.toFixed(1)}): Water has chained Earth ability (blocks movement)`);
                    return { canMove: false, cost: Infinity };
                }

                // No chaining effects, normal water cost
                if (logMoveCost) console.log(`💧 No chaining - normal water cost (2 AP)`);
                return { canMove: true, cost: 2 };
            }

            // Handle non-water stones based on their ACTUAL type, not mimicry
            // (Mimicry is visual only, doesn't affect movement)

            // Earth blocks movement (unless nullified by void)
            if (stone.type === 'earth') {
                const hasVoid = hasAdjacentStoneType(x, y, 'void');
                if (hasVoid) return { canMove: true, cost: 1 }; // Nullified by void, reverts to baseline
                if (logBlocked) console.log(`❌ Cannot move to (${x.toFixed(1)}, ${y.toFixed(1)}): Earth stone blocks movement (needs adjacent Void to nullify)`);
                return { canMove: false, cost: Infinity };
            }

            // Wind is free (0 cost) - ability overrides baseline
            if (stone.type === 'wind') {
                const hasVoid = hasAdjacentStoneType(x, y, 'void');
                if (hasVoid) return { canMove: true, cost: 1 }; // Nullified by void, reverts to baseline
                return { canMove: true, cost: 0 }; // Wind ability: free movement
            }

            // All other stones (void, fire, etc.) cost 1 AP (baseline)
            return { canMove: true, cost: 1 };
        }

        function startStoneDrag(stoneId, e) {
            // Check if it's this player's turn and no pending cascade
            if (!canTakeAction()) {
                notYourTurn();
                return;
            }

            const stone = placedStones.find(s => s.id === stoneId);
            if (!stone) {
                console.log('❌ Stone not found for dragging');
                return;
            }

            // Check if stone is adjacent to player
            if (!playerPosition) {
                updateStatus('No player on board!');
                return;
            }

            if (!isAdjacentToPlayer(stone.x, stone.y)) {
                updateStatus('Can only move stones adjacent to player!');
                console.log(`❌ Cannot drag stone id=${stoneId}: not adjacent to player`);
                return;
            }

            console.log(`✅ Starting drag for stone id=${stoneId}, type=${stone.type} (adjacent to player)`);

            // Clean up any pre-existing ghost (prevents orphaned stamps)
            if (ghostStone) {
                ghostStone.remove();
                ghostStone = null;
            }

            isDraggingStone = true;
            draggedStoneId = stoneId;
            draggedStoneType = stone.type;
            draggedStoneOriginalPos = { x: stone.x, y: stone.y };
            stone.element.remove();
            placedStones = placedStones.filter(s => s.id !== stoneId);
            updateTileClasses();

            // Re-check all fire stones to see if they should activate/deactivate
            recheckAllStoneInteractions();

            // Update all water stone visuals since chaining may have changed
            updateAllWaterStoneVisuals();

            // Update void nullification indicators
            updateAllVoidNullificationVisuals();

            const { x: screenX, y: screenY } = getBoardScreenXY(e.clientX, e.clientY);
            const world = screenToWorld(screenX, screenY);

            ghostStone = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            ghostStone.setAttribute('class', 'stone stone-ghost');
            ghostStone.setAttribute('transform', `translate(${world.x}, ${world.y})`);

            const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            circle.setAttribute('cx', 0);
            circle.setAttribute('cy', 0);
            circle.setAttribute('r', STONE_SIZE);
            circle.setAttribute('class', 'stone-piece');
            circle.setAttribute('fill', darkenHex(STONE_TYPES[draggedStoneType].color, 0.55));
            circle.setAttribute('stroke', STONE_TYPES[draggedStoneType].color);
            circle.setAttribute('stroke-width', '1.5');

            const ghostImg = document.createElementNS('http://www.w3.org/2000/svg', 'image');
            ghostImg.setAttribute('href', STONE_TYPES[draggedStoneType].img);
            ghostImg.setAttribute('x', -STONE_SIZE);
            ghostImg.setAttribute('y', -STONE_SIZE);
            ghostImg.setAttribute('width', STONE_SIZE * 2);
            ghostImg.setAttribute('height', STONE_SIZE * 2);
            // No opacity reduction — symbol renders at full strength

            ghostStone.appendChild(circle);
            ghostStone.appendChild(ghostImg);
            viewport.appendChild(ghostStone);
        }

        function updateStoneCount(type) {
            // Update old UI
            const oldEl = document.getElementById(type + '-count');
            if (oldEl) oldEl.textContent = stoneCounts[type] + '/' + stoneCapacity[type];
            updateSourceCount(type);

            // Update new UI
            const newCountEl = document.getElementById('new-' + type + '-count');
            if (newCountEl) newCountEl.textContent = stoneCounts[type] + '/' + stoneCapacity[type];
            const newSourceEl = document.getElementById('new-' + type + '-source');
            if (newSourceEl) newSourceEl.textContent = sourcePool[type] + '/' + (sourcePoolCapacity[type] ?? 25);

            // Refresh Players panel so self-card stone counts stay in sync
            if (typeof updateOpponentPanel === 'function') updateOpponentPanel();

            // Update void AP whenever void stones change
            if (type === 'void') {
                // If Transmute is open, suppress void AP auto-sync for that player
                const displayIndex = (typeof isMultiplayer !== 'undefined' && isMultiplayer && myPlayerIndex !== null)
                    ? myPlayerIndex : activePlayerIndex;
                const suppress = spellSystem?.scrollEffects?.activeBuffs?.suppressVoidAPSync;
                if (suppress && suppress.playerIndex === displayIndex) {
                    console.log(`💨 Void stones changed to ${playerPool.void}, suppressing void AP sync`);
                } else {
                    console.log(`💨 Void stones changed to ${playerPool.void}, updating void AP to match`);
                    updateVoidAP();
                }
            }
        }

        // Expose updateStoneCount for scroll effects system
        window.updateStoneCount = updateStoneCount;

        // Reset all per-game state so a new game starts clean (no leftover resources)
        function resetGameResources() {
            // Remove any leftover game-over overlays from a previous game
            document.querySelectorAll('.game-over-overlay').forEach(el => el.remove());

            // Remove all stone SVG elements still on the board from the previous game
            document.querySelectorAll('.stone').forEach(el => el.remove());
            placedStones.length = 0;

            // Stone pools
            playerPools.length = 0;
            sourcePool.earth = 20;
            sourcePool.water = 20;
            sourcePool.fire  = 20;
            sourcePool.wind  = 20;
            sourcePool.void  = 20;

            // AP
            currentAP = 5;
            voidAP    = 0;
            playerAPs.length = 0;

            // Scroll state (hands, activated elements)
            spellSystem.playerScrolls = [];

            // Reset common area (clear stale cards from previous game)
            spellSystem.commonArea = { earth: null, water: null, fire: null, wind: null, void: null, catacomb: null };

            // Reset scroll decks to full from definitions (or fallback)
            if (typeof SCROLL_DECKS !== 'undefined') {
                spellSystem.scrollDecks = {};
                Object.keys(SCROLL_DECKS).forEach(element => {
                    spellSystem.scrollDecks[element] = [...SCROLL_DECKS[element]];
                });
            } else {
                spellSystem.scrollDecks = {
                    earth: ['EARTH_SCROLL_1','EARTH_SCROLL_2','EARTH_SCROLL_3','EARTH_SCROLL_4','EARTH_SCROLL_5'],
                    water: ['WATER_SCROLL_1','WATER_SCROLL_2','WATER_SCROLL_3','WATER_SCROLL_4','WATER_SCROLL_5'],
                    fire:  ['FIRE_SCROLL_1','FIRE_SCROLL_2','FIRE_SCROLL_3','FIRE_SCROLL_4','FIRE_SCROLL_5'],
                    wind:  ['WIND_SCROLL_1','WIND_SCROLL_2','WIND_SCROLL_3','WIND_SCROLL_4','WIND_SCROLL_5'],
                    void:  ['VOID_SCROLL_1','VOID_SCROLL_2','VOID_SCROLL_3','VOID_SCROLL_4','VOID_SCROLL_5'],
                    catacomb: ['CATACOMB_SCROLL_1','CATACOMB_SCROLL_2','CATACOMB_SCROLL_3','CATACOMB_SCROLL_4','CATACOMB_SCROLL_5']
                };
            }
            spellSystem.shuffleAllDecks();

            // Scroll effect buffs and interactive-scroll states
            if (spellSystem.scrollEffects) {
                spellSystem.scrollEffects.activeBuffs = {};
            }
            window.telekinesisState = null;
            window.takeFlightState  = null;

            console.log('🔄 Game resources reset (scroll decks and common area cleared)');
        }
        window.resetGameResources = resetGameResources;

