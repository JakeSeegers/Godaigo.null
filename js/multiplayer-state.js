// ========================================
// SUPABASE MULTIPLAYER SETUP
// ========================================
const SUPABASE_URL = 'https://lovybwpypkaarstnvkbz.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imxvdnlid3B5cGthYXJzdG52a2J6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjkwMzI4NTgsImV4cCI6MjA4NDYwODg1OH0.lqobDTaopRJ5sA0yZQvzDwudq2x4zz9HMtTkSuJulFU';

// A password reset link lands with "#...type=recovery". The client below
// reads and clears that hash on its own, so remember it first for
// js/account-recovery.js (which loads later) to show "Choose a new password".
window.__godaigoRecoveryLink = /(^|[#&])type=recovery(&|$)/.test(location.hash);
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Multiplayer state
let myPlayerId = null;
let myPlayerIndex = null;
let totalPlayers = 0; // Total number of players in the game
let playerTilesPlaced = new Set(); // Track which player indices have placed tiles
let isPlacementPhase = false;
// Mobile deck initial state is set later after isMobile is computed
let allPlayersData = []; // Store all player data from database (id, player_index, color, username)

// Multi-room state
let currentGameId = null;    // ID of the game_room row we have joined
let currentJoinCode = null;  // 6-char code for private rooms, null for public games

// Turn synchronization
let currentTurnNumber = 0; // Increments with each turn change (for desync detection)
let lastReceivedTurnNumber = 0; // Last turn number received from broadcast

// Strip the bot marker prefix (window.BOT_USERNAME_PREFIX, e.g. "🤖 ", set by
// js/bot-driver.js) from a username for DISPLAY only. The raw prefixed value
// must stay in the actual username field/DB — window.isBotUsername() and
// bot-driver.js's botIndexSet() depend on that prefix to identify which
// player rows are bot-controlled.
function displayUsername(username) {
    if (typeof username !== 'string') return username;
    const prefix = (typeof window !== 'undefined' && typeof window.BOT_USERNAME_PREFIX === 'string')
        ? window.BOT_USERNAME_PREFIX : '🤖';
    return username.startsWith(prefix) ? username.slice(prefix.length).trim() : username;
}

// Helper function to get player display name (Username (Color))
function getPlayerColorName(playerIndex) {
    const colorNames = {
        'purple': 'Purple',
        'yellow': 'Yellow',
        'red': 'Red',
        'blue': 'Blue',
        'green': 'Green'
    };

    let username = null;
    let colorName = null;

    // Try to get from database player data first
    if (allPlayersData.length > 0) {
        const player = allPlayersData.find(p => p.player_index === playerIndex);
        if (player) {
            username = displayUsername(player.username);
            if (player.color) {
                colorName = colorNames[player.color] || player.color;
            }
        }
    }

    // Fallback to playerPositions if player tile is placed
    if (!colorName && typeof playerPositions !== 'undefined' && playerPositions[playerIndex]) {
        const hexColorNames = {
            '#9458f4': 'Purple',
            '#ffce00': 'Yellow',
            '#ed1b43': 'Red',
            '#5894f4': 'Blue',
            '#69d83a': 'Green'
        };
        colorName = hexColorNames[playerPositions[playerIndex].color] || 'Player ' + (playerIndex + 1);
    }

    // Build display name: "Username (Color)" or just "Color" or "Player X"
    if (username && colorName) {
        return username + ' (' + colorName + ')';
    } else if (colorName) {
        return colorName;
    } else if (username) {
        return username;
    } else {
        return 'Player ' + (playerIndex + 1);
    }
}

// Check if it's the current player's turn (for multiplayer)
// This is for GAME ACTIONS (moving, placing stones, etc), NOT tile placement
function isMyTurn() {
    if (!isMultiplayer) return true; // In local mode, always allow actions
    if (isPlacementPhase) return false; // During placement phase, no game actions allowed
    return myPlayerIndex === activePlayerIndex;
}

// Show/hide End Turn button based on whose turn it is
function updateEndTurnButtonVisibility() {
    const btn = document.getElementById('end-turn');
    if (!btn) return;

    // Always show the button, but disable when not your turn
    btn.style.display = '';
    if (!isMultiplayer) {
        btn.disabled = false;
        btn.style.opacity = '';
        btn.style.cursor = '';
        return;
    }

    const canEnd = isMyTurn();
    btn.disabled = !canEnd;
    btn.style.opacity = canEnd ? '' : '0.5';
    btn.style.cursor = canEnd ? '' : 'not-allowed';
}

// Hide deck indicators during play (keep deck panel for stones/player pool)
function updateDeckIndicatorVisibility() {
    const gameContainer = document.querySelector('.game-container');
    const inGame = gameContainer && gameContainer.style.display !== 'none';
    const hide = inGame && !isPlacementPhase; // hide during main play

    const tileDeckHeader = document.getElementById('tile-deck-header');
    const tileDeckContainer = document.getElementById('tile-deck-container');
    const playerTilesHeader = document.getElementById('player-tiles-header');

    if (tileDeckHeader) tileDeckHeader.style.display = hide ? 'none' : '';
    if (tileDeckContainer) tileDeckContainer.style.display = hide ? 'none' : '';
    if (playerTilesHeader) playerTilesHeader.style.display = hide ? 'none' : '';
}

// Inventory panel toggle (unified for desktop + mobile)
let isInventoryOpen = false;

function setInventoryOpen(open) {
    isInventoryOpen = !!open;
    const gameContainer = document.querySelector('.game-container');
    if (!gameContainer) return;

    gameContainer.classList.toggle('inventory-open', isInventoryOpen);
    gameContainer.classList.toggle('inventory-collapsed', !isInventoryOpen);

    const btn = document.getElementById('inventory-toggle');
    if (btn) {
        btn.textContent = isInventoryOpen ? '🎒 Inventory (hide)' : '🎒 Inventory';
    }
}

function toggleInventory() {
    setInventoryOpen(!isInventoryOpen);
}

// Close button inside inventory (useful on mobile where bottom controls may be off-screen)
document.addEventListener('DOMContentLoaded', () => {
    const closeBtn = document.getElementById('inventory-close');
    if (closeBtn) closeBtn.addEventListener('click', () => setInventoryOpen(false));

    // Listen for scroll-resolved events from response window system
    window.addEventListener('scroll-resolved', (event) => {
        const entry = event.detail;
        if (entry && entry.scrollData) {
            // Apply the scroll effects for scrolls that resolved from the response stack
            if (typeof spellSystem !== 'undefined') {
                const scrollName = entry.scrollData.name;
                // Resolve scrollDef: may be stored as .definition, .spell, or looked up from patterns
                const scrollDef = entry.scrollData.definition
                    || entry.scrollData.spell
                    || spellSystem.patterns[scrollName];
                const fromCommonArea = entry.fromCommonArea ?? entry.scrollData?.fromCommonArea ?? false;

                // For response scrolls (like Unbidden Lamplight / Reflect / Sigh of Recollection),
                // pass the triggering scroll context
                if (entry.result === 'response-resolved' && entry.triggeringScroll) {
                    console.log(`Applying response scroll effects: ${scrollName} (triggered by ${entry.triggeringScroll.name})`);

                    // In multiplayer, only execute the response effect on the responder's own client.
                    // The caster's client resolves the stack but shouldn't modify another player's pools.
                    // Non-caster/non-responder clients receive the effect via the 'response-resolved' broadcast.
                    // When the host is driving a bot it impersonates the bot's myPlayerIndex; if the HOST
                    // itself responded (as the driver), match on the driver's real index so its own
                    // response scroll is still tracked locally.
                    const _localIdx = (typeof window !== 'undefined' && window.BotDriver
                        && typeof window.BotDriver.driverRealIndex === 'function'
                        && window.BotDriver.driverRealIndex() != null)
                        ? window.BotDriver.driverRealIndex()
                        : (typeof myPlayerIndex !== 'undefined' ? myPlayerIndex : undefined);
                    const isLocalPlayer = !isMultiplayer || (typeof _localIdx !== 'undefined' && _localIdx === entry.casterIndex);

                    if (spellSystem.scrollEffects) {
                        const effect = spellSystem.scrollEffects.getEffect(scrollName);
                        if (effect) {
                            // Execute on ALL clients — response effects like Lamplight set global state
                            // (pendingHandRedirect) that must exist on the caster's client before the
                            // original scroll's handleScrollDisposition runs.
                            // withStatusActor: this responder may be a bot deciding on its own (no
                            // impersonation involved), so gate its status text on the REAL responder
                            // index rather than whatever this client happens to be impersonating.
                            window.withStatusActor(entry.casterIndex, () => {
                                spellSystem.scrollEffects.execute(scrollName, entry.casterIndex, {
                                    spell: scrollDef,
                                    triggeringScroll: entry.triggeringScroll,
                                    eventId: entry.eventId || null
                                });
                            });

                            if (isLocalPlayer && !entry.viaSacrificialPyre) {
                                // Track activated element(s) for win condition (response scrolls count too!)
                                // Skipped when activated via Sacrificial Pyre — only fire counts then
                                // (credited separately in respondWithSacrificialPyre), same rule as the
                                // main-phase sacrifice flow.
                                spellSystem.ensurePlayerScrollsStructure(entry.casterIndex);
                                // Catacomb scrolls activate each component element. Same
                                // empty-source rule as a normal cast (grantElements).
                                const grantedEls = spellSystem.grantElements(entry.casterIndex,
                                    (scrollDef.element === 'catacomb' && scrollDef.patterns && scrollDef.patterns[0])
                                        ? [...new Set(scrollDef.patterns[0].map(pos => pos.type))]
                                        : [scrollDef.element]);
                                if (typeof updatePlayerElementSymbols === 'function') {
                                    updatePlayerElementSymbols(entry.casterIndex);
                                }

                                // Broadcast the activation in multiplayer
                                if (isMultiplayer && typeof broadcastGameAction === 'function') {
                                    const activatedElements = grantedEls;
                                    broadcastGameAction('scroll-effect', {
                                        playerIndex: entry.casterIndex,
                                        scrollName: scrollName,
                                        effectName: effect.name,
                                        element: scrollDef.element,
                                        activatedElements: activatedElements
                                    });
                                }

                                // Win-condition check for the responder (a non-counter response
                                // scroll like Lamplight/Reflect can be a player's 5th element).
                                // The responder's own client added to `activated` above but does
                                // not receive its own scroll-effect broadcast (self: false), so
                                // check here — mirroring the counter-scroll branch below.
                                if (typeof checkWinCondition === 'function' &&
                                    checkWinCondition(entry.casterIndex, { announce: true })) {
                                    console.log(`🏆 Win condition met for responder player ${entry.casterIndex} (response scroll)`);
                                }
                            }
                        }
                    }

                    // Handle scroll disposition for the response scroll
                    spellSystem.handleScrollDisposition(scrollName, fromCommonArea);
                } else if (entry.result === 'resolved' && entry.isOriginal) {
                    // Original scroll resolved (after response window) - apply its full effect
                    console.log(`Original scroll resolved: ${scrollName} - applying effects`);
                    spellSystem.applyScrollEffects(scrollName, scrollDef, fromCommonArea);
                } else if (entry.result === 'resolved' && !entry.isOriginal) {
                    // Regular resolved scroll (non-original)
                    console.log(`Applying resolved scroll effects: ${scrollName}`);
                    spellSystem.applyScrollEffects(scrollName, scrollDef);
                } else if (entry.result === 'countered') {
                    // Original scroll was countered - do NOT apply its effects
                    console.log(`Original scroll countered: ${scrollName} - skipping execution`);
                    // Still handle scroll disposition (remove from active scrolls, etc.)
                    spellSystem.handleScrollDisposition(scrollName, fromCommonArea);
                } else if (entry.result === 'countered-original') {
                    // Counter scroll was cast - execute its effect (e.g. Psychic stores the stolen scroll)
                    const counterCasterIdx = entry.casterIndex;
                    console.log(`Counter scroll resolved: ${scrollName}, counter-caster: ${counterCasterIdx}`);
                    if (spellSystem.scrollEffects) {
                        const effect = spellSystem.scrollEffects.getEffect(scrollName);
                        if (effect) {
                            // withStatusActor: gate this counter's status text on the REAL
                            // counter-caster index — covers a bot responding on its own (no
                            // impersonation) as well as a bot's own turn.
                            window.withStatusActor(counterCasterIdx, () => {
                                spellSystem.scrollEffects.execute(scrollName, counterCasterIdx, {
                                    spell: scrollDef,
                                    scrollName: scrollName,
                                    triggeringScroll: entry.triggeringScroll,
                                    eventId: entry.eventId || null
                                });
                            });

                            // Track activated element(s) for win condition (counter scrolls count too!)
                            // Skipped when activated via Sacrificial Pyre — only fire counts then
                            // (credited separately in respondWithSacrificialPyre), same rule as the
                            // main-phase sacrifice flow. The counter's actual effect (e.g. Iron Stance
                            // cancelling the original, decided earlier in resolveResponseStack) still
                            // applies regardless — only this extra win-condition credit is suppressed.
                            if (!entry.viaSacrificialPyre) {
                                spellSystem.ensurePlayerScrollsStructure(counterCasterIdx);
                                // Catacomb scrolls activate each component element. Same
                                // empty-source rule as a normal cast (grantElements).
                                const grantedEls = spellSystem.grantElements(counterCasterIdx,
                                    (scrollDef.element === 'catacomb' && scrollDef.patterns && scrollDef.patterns[0])
                                        ? [...new Set(scrollDef.patterns[0].map(pos => pos.type))]
                                        : [scrollDef.element]);
                                if (typeof updatePlayerElementSymbols === 'function') {
                                    updatePlayerElementSymbols(counterCasterIdx);
                                }

                                // Broadcast the activation in multiplayer
                                if (isMultiplayer && typeof broadcastGameAction === 'function') {
                                    const activatedElements = grantedEls;
                                    broadcastGameAction('scroll-effect', {
                                        playerIndex: counterCasterIdx,
                                        scrollName: scrollName,
                                        effectName: effect.name,
                                        element: scrollDef.element,
                                        activatedElements: activatedElements
                                    });
                                }

                                // Win-condition check for the counter-caster (e.g. Iron Stance is
                                // Player B's 5th scroll). The caster's client (which runs resolveResponseStack)
                                // doesn't receive its own scroll-effect broadcast (self: false), so we must
                                // check here. The receiving client also checks via the scroll-effect handler.
                                if (typeof checkWinCondition === 'function' &&
                                    checkWinCondition(counterCasterIdx, { announce: true })) {
                                    console.log(`🏆 Win condition met for counter-caster player ${counterCasterIdx} (Iron Stance / counter scroll)`);
                                }
                            }
                        }
                    }
                    // Check if the effect flagged this scroll to go to common area (e.g. Psychic)
                    const forceCommon = spellSystem.scrollEffects?.pendingForceCommonArea;
                    const shouldForceCommon = forceCommon && forceCommon.scrollName === scrollName;
                    if (shouldForceCommon) {
                        delete spellSystem.scrollEffects.pendingForceCommonArea;
                    }
                    // Handle disposition using the COUNTER-CASTER's scrolls (not the
                    // active player's, since the counter scroll belongs to the responder)
                    spellSystem.ensurePlayerScrollsStructure(counterCasterIdx);
                    const counterScrolls = spellSystem.playerScrolls[counterCasterIdx];
                    if (shouldForceCommon) {
                        // Guard: only discard if scroll is still in active — Lamplight may have
                        // already redirected it to hand, in which case we must not override.
                        if (counterScrolls.active.has(scrollName)) {
                            counterScrolls.active.delete(scrollName);
                            spellSystem.discardToCommonArea(scrollName);
                        }
                    }
                    spellSystem.updateScrollCount();
                    if (typeof updateCommonAreaUI === 'function') updateCommonAreaUI();
                } else if (entry.result === 'counter-negated') {
                    // Psychic was negated — the original caster paid the ransom to
                    // keep their scroll. No effect executes (no steal is queued —
                    // resolveResponseStack() never called execute() for this entry),
                    // and it does NOT count as a void activation (judgment call, easy
                    // to flip — see response-window.js's ransom prompt). Psychic was
                    // still legitimately cast, so it moves to the common area same as
                    // a normal counter would.
                    const counterCasterIdx = entry.casterIndex;
                    console.log(`Counter negated (ransom paid): ${scrollName}, counter-caster: ${counterCasterIdx}`);
                    spellSystem.ensurePlayerScrollsStructure(counterCasterIdx);
                    const counterScrolls = spellSystem.playerScrolls[counterCasterIdx];
                    if (counterScrolls.active.has(scrollName)) {
                        counterScrolls.active.delete(scrollName);
                        spellSystem.discardToCommonArea(scrollName);
                    }
                    spellSystem.updateScrollCount();
                    if (typeof updateCommonAreaUI === 'function') updateCommonAreaUI();
                }
            }
        }
    });
});



// Check if current player can place their tile during placement phase
// This is ONLY for player tile placement
function canPlaceTile() {
    if (!isMultiplayer) return true;
    if (!isPlacementPhase) return false; // Player tiles can only be placed during placement phase
    // During placement phase, only the active player can place their tile
    return myPlayerIndex === activePlayerIndex && !playerTilesPlaced.has(myPlayerIndex);
}

// Check if player can take actions (turn AND no pending cascade AND no pending end-turn overflow)
function canTakeAction() {
    if (!isMyTurn()) return false;
    // Check for pending cascade
    const playerIdx = isMultiplayer ? myPlayerIndex : activePlayerIndex;
    if (typeof spellSystem !== 'undefined' && spellSystem.hasPendingCascade(playerIdx)) {
        return false;
    }
    // Check for a pending end-of-turn scroll-overflow discard (see
    // showEndTurnOverflowModal) — the turn isn't actually over yet at this
    // point (activePlayerIndex hasn't advanced), so this must keep blocking
    // other actions until the player discards down to size.
    if (typeof spellSystem !== 'undefined' && spellSystem.hasPendingEndTurnOverflow(playerIdx)) {
        return false;
    }
    return true;
}

// Show "not your turn" or "cascade pending" message
function notYourTurn() {
    window.SoundSystem?.play('error');
    // First check for pending cascade
    const playerIdx = isMultiplayer ? myPlayerIndex : activePlayerIndex;
    if (typeof spellSystem !== 'undefined' && spellSystem.hasPendingCascade(playerIdx)) {
        updateStatus(`You must cascade a scroll before taking other actions!`);
        // Re-show the cascade prompt
        spellSystem.showPendingCascadePrompt(playerIdx);
        return;
    }

    if (typeof spellSystem !== 'undefined' && spellSystem.hasPendingEndTurnOverflow(playerIdx)) {
        updateStatus(`Discard down to your hand/active limits before your turn can end!`);
        return;
    }

    if (isPlacementPhase) {
        const activeColor = getPlayerColorName(activePlayerIndex);
        updateStatus(`Waiting for ${activeColor} to place their tile... (${playerTilesPlaced.size}/${totalPlayers})`);
    } else {
        const activeColor = getPlayerColorName(activePlayerIndex);
        updateStatus(`Not your turn. Waiting for ${activeColor}...`);
    }
}

// Update turn display when turn changes
function updateTurnDisplay() {
    if (!isMultiplayer) return;

    updateEndTurnButtonVisibility();
    updateDeckIndicatorVisibility();

    const myColorName     = getPlayerColorName(myPlayerIndex);
    const activeColorName = getPlayerColorName(activePlayerIndex);
    const myTurn          = isMyTurn();

    console.log(`[turn] updateTurnDisplay: myPlayerIndex=${myPlayerIndex} activePlayerIndex=${activePlayerIndex} isMyTurn=${myTurn} isPlacementPhase=${isPlacementPhase}`);

    // Update HUD player name + dot immediately (don't wait for render loop)
    const hudPlayerName = document.getElementById('hud-player-name');
    const hudPlayerDot  = document.getElementById('hud-player-dot');
    const hudPlayer     = hudPlayerName?.closest('.hud-player');
    if (hudPlayerName) {
        if (myTurn) hudPlayerName.textContent = 'Your Turn';
        else if (window.cosmeticsSystem?.seatNameHtml) hudPlayerName.innerHTML = `${window.cosmeticsSystem.seatNameHtml(activePlayerIndex)}'s Turn`;
        else hudPlayerName.textContent = `${activeColorName}'s Turn`;
    }
    if (hudPlayer) {
        hudPlayer.classList.toggle('your-turn', myTurn);
    }
    // Sync dot color to active player
    if (hudPlayerDot && typeof allPlayersData !== 'undefined') {
        const colorMap = { purple:'#9458f4', yellow:'#ffce00', red:'#ed1b43', blue:'#5894f4', green:'#69d83a' };
        const activeData = allPlayersData.find(p => p.player_index === activePlayerIndex);
        const key = activeData?.color;
        if (key && colorMap[key]) hudPlayerDot.style.background = colorMap[key];
    }

    if (myTurn) {
        updateStatus(`Your turn!`);
        console.log('My turn now!');
    } else {
        updateStatus(`Waiting for ${activeColorName}...`);
        console.log(`Waiting for player ${activePlayerIndex + 1}`);
    }

    // Note: Each player always sees their own inventory (stones/scrolls/AP)
    // We don't update inventory here - it stays showing the local player's resources
}

let isMultiplayer = false;
let gameRoomSubscription = null;
let playersSubscription = null;
let gameStateSubscription = null;
