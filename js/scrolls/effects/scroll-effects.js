/**
 * Scroll Effects System
 *
 * This file contains the effect definitions and execution logic for all scrolls.
 * Each scroll has an execute() function that performs its effect.
 */

// ============================================================
// Shared "decision modal" chrome — every scroll-effect popup below
// (Scholar's Insight, Quick Reflexes, Transmute, Take Flight's target
// picker, Arson/Plunder's opponent picker, the deck/element/scroll pickers,
// …) used to be a full-screen dark overlay fixed dead-centre: it hid the
// board entirely, so a decision like "who should I target" or "which
// stones do I have nearby" had to be made blind. Fixed once, here, for all
// of them:
//   - the backdrop (`overlay`) is invisible and click-through
//     (pointer-events:none) — the board stays lit and interactive
//     everywhere except the modal box itself
//   - the modal box anchors near the top-right by default (out of the
//     board's centre) instead of dead-centre, and is draggable by its
//     title bar to wherever the player actually needs it clear
// Call styleDecisionOverlay(overlay) where the old dark-backdrop
// Object.assign used to go, and makeDecisionModalMovable(modal, titleEl,
// overlay) right after the modal is built (its own border/color styling
// can still run first — this only adds position/drag behavior on top).
// ============================================================
function styleDecisionOverlay(overlay) {
    Object.assign(overlay.style, {
        position: 'fixed',
        top: '0', left: '0', right: '0', bottom: '0',
        zIndex: '3000',
        pointerEvents: 'none',
    });
}

function makeDecisionModalMovable(modal, handle, overlay) {
    Object.assign(modal.style, {
        position: 'fixed',
        top: '70px',
        right: '20px',
        pointerEvents: 'auto',
        boxShadow: '0 4px 24px rgba(0,0,0,0.6)',
        maxHeight: 'calc(100vh - 100px)',
        overflowY: modal.style.overflowY || 'auto',
    });
    handle.style.cursor = 'grab';
    handle.title = 'Drag to move';
    let ox, oy, ol, ot, active = false;
    handle.addEventListener('mousedown', e => {
        if (e.button !== 0) return;
        active = true;
        ox = e.clientX; oy = e.clientY;
        const rect = modal.getBoundingClientRect();
        ol = rect.left; ot = rect.top;
        modal.style.right = 'auto'; // switch from right-anchored to left-anchored once dragged
        modal.style.left = ol + 'px';
        modal.style.top = ot + 'px';
        handle.style.cursor = 'grabbing';
        document.body.style.userSelect = 'none';
        e.preventDefault();
    });
    const onMove = e => {
        if (!active) return;
        const nx = Math.max(0, Math.min(window.innerWidth - 60, ol + (e.clientX - ox)));
        const ny = Math.max(0, Math.min(window.innerHeight - 40, ot + (e.clientY - oy)));
        modal.style.left = nx + 'px';
        modal.style.top = ny + 'px';
    };
    const onUp = () => {
        if (!active) return;
        active = false;
        handle.style.cursor = 'grab';
        document.body.style.userSelect = '';
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    // Every call site closes its modal by calling overlay.remove() — hook
    // that one shared exit point instead of touching each of the many
    // button/cancel handlers that call it.
    if (overlay && !overlay._decisionCleanupWired) {
        overlay._decisionCleanupWired = true;
        const originalRemove = overlay.remove.bind(overlay);
        overlay.remove = () => {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            originalRemove();
        };
    }
}

const ScrollEffects = {
    // Active buffs that persist during a turn
    activeBuffs: {},

    // Current selection mode state
    selectionMode: null,

    // One-per-turn response scroll guard. Set true when a scroll flagged
    // `oncePerTurn` (all response/counter scrolls) actually resolves during a
    // turn; blocks any further response-scroll casts until the turn changes.
    // Reset by clearTurnBuffs(), which fires on every client at each turn
    // transition (local End Turn + remote turn-change handler).
    responseScrollUsedThisTurn: false,

    // Caster of whichever scroll effect is currently resolving — set at the
    // top of every execute() call (the single funnel all scroll effects run
    // through, human or bot). Used only by the bot-modal flash guard below
    // to tell whether the modal that's about to appear belongs to a bot.
    _activeCasterIndex: null,

    // Initialize the effects system
    init(spellSystem) {
        this.spellSystem = spellSystem;
        this.activeBuffs = {};
        this.selectionMode = null;
        this.responseScrollUsedThisTurn = false;
        this._installBotModalFlashGuard();
        console.log('📜 Scroll Effects system initialized');
    },

    // Is this player slot a bot? Same check as ResponseWindowSystem.isBotPlayer —
    // duplicated locally rather than reached-into, since scroll-effects.js
    // doesn't otherwise depend on response-window.js.
    isBotCaster(playerIndex) {
        if (playerIndex === null || playerIndex === undefined) return false;
        try {
            if (typeof allPlayersData !== 'undefined' && Array.isArray(allPlayersData)) {
                const p = allPlayersData.find(p => p.player_index === playerIndex);
                if (p && typeof window.isBotUsername === 'function') {
                    return window.isBotUsername(p.username);
                }
            }
        } catch (e) { /* solo/tutorial mode has no allPlayersData */ }
        return false;
    },

    // Suppresses the on-screen flash of a bot's own choice modal (Create,
    // Scholar's Insight, element/opponent pickers, Transmute, etc. — every
    // id in EFFECT_MODAL_IDS). bot-effects.js drives these by finding the
    // REAL DOM elements a human would click and calling their real click
    // handlers — it doesn't reimplement scroll rules — so the modal
    // genuinely mounts to document.body and, without this, genuinely
    // paints for a frame before the bot's synchronous drive-then-cancel
    // cycle tears it down again. That's especially visible to the host,
    // who is usually the one rendering the bot's turn, and it gives away
    // what the bot is about to pick.
    //
    // A MutationObserver on document.body catches each modal the instant
    // it's appended — its callback runs as a microtask, flushed before the
    // next paint — and hides it (display:none, not removal) when the
    // scroll being resolved belongs to a bot (_activeCasterIndex). Hiding
    // rather than removing keeps every id/selector bot-effects.js looks
    // up intact, and HTMLElement.click() fires its handlers regardless of
    // display:none, so the bot still drives the modal exactly as before —
    // it's just never visible while it does.
    _installBotModalFlashGuard() {
        if (this._modalFlashObserver || typeof document === 'undefined' || !document.body) return;
        const self = this;
        this._modalFlashObserver = new MutationObserver((mutations) => {
            if (!self.isBotCaster(self._activeCasterIndex)) return;
            for (const mutation of mutations) {
                for (const node of mutation.addedNodes) {
                    if (node.nodeType === 1 && self.EFFECT_MODAL_IDS.includes(node.id)) {
                        node.style.display = 'none';
                    }
                }
            }
        });
        this._modalFlashObserver.observe(document.body, { childList: true });
    },

    // Clear turn-based buffs (called on End Turn)
    clearTurnBuffs() {
        // Reset the one-per-turn response guard for the incoming turn.
        this.responseScrollUsedThisTurn = false;
        Object.keys(this.activeBuffs).forEach(key => {
            if (this.activeBuffs[key]?.expiresThisTurn) {
                if (key === 'controlTheCurrent' && this.selectionMode?.type === 'water-transform') {
                    this.selectionMode.cleanup();
                    this.selectionMode = null;
                }
                if (key === 'respirateWind') {
                    const buff = this.activeBuffs.respirateWind;
                    const pools = typeof playerPools !== 'undefined' ? playerPools : (typeof window !== 'undefined' && window.playerPools);
                    const source = typeof stonePools !== 'undefined' ? stonePools : (typeof window !== 'undefined' && window.stonePools);
                    const capacity = typeof sourcePoolCapacity !== 'undefined'
                        ? sourcePoolCapacity
                        : (typeof window !== 'undefined' && window.sourcePoolCapacity);
                    if (buff && pools && source) {
                        const pool = pools[buff.playerIndex];
                        if (pool && typeof pool.wind === 'number' && pool.wind > 0) {
                            const amount = pool.wind;
                            pool.wind = 0;
                            if (capacity && typeof capacity.wind === 'number') {
                                source.wind = Math.min(capacity.wind, (source.wind || 0) + amount);
                            } else {
                                source.wind = (source.wind || 0) + amount;
                            }
                            if (typeof updateStoneCount === 'function') {
                                updateStoneCount('wind');
                            }
                            if (typeof updateStatus === 'function') {
                                updateStatus('Respirate: returned all wind stones to the source pool.');
                            }
                            console.log(`🌬️ Respirate returned ${amount} wind stones to source`);
                        }
                    }
                }
                delete this.activeBuffs[key];
                console.log(`📜 Cleared buff: ${key}`);
            }
        });
    },

    // Clear Freedom buff for a player when their next turn starts
    clearFreedomForPlayer(playerIndex) {
        const buff = this.activeBuffs.freedom;
        if (!buff || buff.playerIndex !== playerIndex) return;
        delete this.activeBuffs.freedom;
        if (typeof updateCatacombIndicators === 'function') {
            updateCatacombIndicators();
        }
    },

    // Clear Quick Reflexes buff for a player when their next turn starts
    clearQuickReflexesForPlayer(playerIndex) {
        const buff = this.activeBuffs.quickReflexes;
        if (!buff || buff.playerIndex !== playerIndex) return;
        delete this.activeBuffs.quickReflexes;
    },

    // Cancel any active selection mode
    // Every modal overlay an effect can open. cancelSelectionMode sweeps
    // these away; the bot's quiescence loop also checks the list directly,
    // because modal-based effects don't always register a selectionMode.
    // (Deliberately NOT listed: response-window-modal — own timer/lifecycle —
    // and scroll-inventory-popup — the general inventory UI.)
    EFFECT_MODAL_IDS: [
        'scholars-insight-modal', 'create-stone-modal', 'quick-reflexes-modal',
        'water-transform-modal', 'take-flight-player-modal', 'arson-element-modal',
        'scroll-select-modal', 'deck-select-modal', 'element-select-modal',
        'opponent-select-modal', 'plunder-player-modal', 'excavate-teleport-modal',
        'transmute-modal',
    ],

    cancelSelectionMode() {
        if (this.selectionMode) window.SoundSystem?.play('zipclick');
        if (this.selectionMode) {
            if (typeof this.selectionMode.cleanup === 'function') {
                this.selectionMode.cleanup();
            } else if (this.selectionMode.cancelBtn && this.selectionMode.cancelBtn.parentNode) {
                this.selectionMode.cancelBtn.parentNode.removeChild(this.selectionMode.cancelBtn);
            }
            this.selectionMode = null;
            updateStatus('Selection cancelled.');
        }

        // Safety: remove any orphaned cancel / telekinesis-done buttons
        const cancelEl = document.getElementById('scroll-cancel-btn');
        if (cancelEl && cancelEl.parentNode) cancelEl.parentNode.removeChild(cancelEl);
        const doneEl = document.getElementById('telekinesis-done-btn');
        if (doneEl && doneEl.parentNode) doneEl.parentNode.removeChild(doneEl);
        // Safety: remove any orphaned effect modals (bot cancels and end-turn
        // cleanup both land here; a modal left behind blocks the board view)
        for (const id of this.EFFECT_MODAL_IDS) {
            const el = document.getElementById(id);
            if (el && el.parentNode) el.parentNode.removeChild(el);
        }
        // Safety: clear telekinesis state in case turn auto-advanced without cleanup
        if (window.telekinesisState) { window.telekinesisState = null; window.tileMoveMode = false; }
        if (window.finishTelekinesis) { window.finishTelekinesis = null; }
        if (typeof clearLegalPlacementHighlights === 'function') clearLegalPlacementHighlights();
    },

    // Get the effect handler for a scroll
    getEffect(scrollName) {
        return this.effects[scrollName] || null;
    },

    // Hard ceiling for synchronous effect→effect chains (Reflect duplicating a
    // scroll, Sacrificial Pyre activating one, etc.). Anything deeper than this
    // is a loop bug, not a legitimate play. User-paced chains (modal clicks)
    // start a fresh call stack, so they are not limited by this.
    MAX_EFFECT_CHAIN_DEPTH: 4,
    _chainDepth: 0,

    // Execute a scroll's effect
    execute(scrollName, casterIndex, context = {}) {
        // See _installBotModalFlashGuard: tracks who any choice modal that
        // appears next belongs to, so it can be hidden if that's a bot.
        this._activeCasterIndex = casterIndex;
        const effect = this.getEffect(scrollName);
        if (!effect) {
            console.warn(`No effect defined for scroll: ${scrollName}`);
            return { success: false, reason: 'No effect defined' };
        }

        this._chainDepth++;
        try {
            if (this._chainDepth > this.MAX_EFFECT_CHAIN_DEPTH) {
                console.error(`Effect chain too deep (${this._chainDepth}) while executing ${scrollName} - aborting to prevent a loop`);
                return { success: false, reason: 'Effect chain too deep' };
            }
            return effect.execute(casterIndex, context, this);
        } catch (err) {
            console.error(`Error executing scroll effect ${scrollName}:`, err);
            return { success: false, reason: err.message };
        } finally {
            this._chainDepth--;
        }
    },

    // Effect definitions for each scroll
    effects: {
        // ============================================
        // EARTH SCROLLS
        // ============================================

        /**
         * Earth Scroll I - Iron Stance
         * Counter the most recently cast scroll.
         */
        EARTH_SCROLL_1: {
            name: 'Iron Stance',
            description: 'Counter the most recently activated scroll. That scroll is cancelled.',
            isCounter: true,
            priority: 1,

            execute(casterIndex, context, system) {
                // This scroll's effect is handled by the response window system
                // When used as a counter, it marks the target scroll as cancelled
                console.log(`🛡️ Iron Stance activated by player ${casterIndex}`);

                // The actual counter logic is in response-window.js resolveResponseStack
                // This just needs to signal that it's a counter
                return {
                    success: true,
                    isCounter: true,
                    message: 'Iron Stance counters the scroll!'
                };
            }
        },

        /**
         * Earth Scroll II - Shifting Sands
         * Swap two tiles on the board.
         */
        EARTH_SCROLL_2: {
            name: 'Shifting Sands',
            description: "Select two tiles to swap their positions. Tile must be unoccupied by stones. If there is one player on that tile, move them to the center of the tile. Cannot target a tile with multiple players on it.",
            isCounter: false,
            priority: 2,

            execute(casterIndex, context, system) {
                console.log(`🔀 Shifting Sands activated by player ${casterIndex}`);

                // If triggered via Psychic on a non-caster client, skip interactive UI
                if (context?.psychicRemoteClient) {
                    console.log(`🔀 Shifting Sands: skipping tile-swap UI on non-caster remote client`);
                    return { success: true, requiresSelection: true, message: 'Skipped on remote client' };
                }

                // Enter tile selection mode; pass payload so we can call onSelectionEffectComplete when done
                const payload = {
                    scrollName: context.scrollName || 'EARTH_SCROLL_2',
                    spell: context.spell,
                    effectName: 'Shifting Sands'
                };
                system.enterTileSwapMode(casterIndex, payload);

                return {
                    success: true,
                    requiresSelection: true,
                    message: 'Select two tiles to swap...'
                };
            }
        },

        /**
         * Earth Scroll III - Mason's Savvy
         * Draw earth stones and enable extended placement range.
         */
        EARTH_SCROLL_3: {
            name: "Mason's Savvy",
            description: 'Draw up to 5 earth stones. This turn, place earth stones within 5 hexes of player.',
            isCounter: false,
            priority: 3,

            execute(casterIndex, context, system) {
                console.log(`🪨 Mason's Savvy activated by player ${casterIndex}`);

                // Draw up to 5 earth stones
                const drawn = system.drawStonesToPool('earth', 5, casterIndex);

                // Activate extended placement buff
                system.activeBuffs.earthExtendedPlacement = {
                    range: 5,
                    expiresThisTurn: true,
                    playerIndex: casterIndex
                };

                const message = `Drew ${drawn} earth stones! Extended placement (5 hex range) active this turn.`;
                updateStatus(message);

                return {
                    success: true,
                    stonesDrawn: drawn,
                    message: message
                };
            }
        },

        /**
         * Earth Scroll IV - Heavy Stomp
         * Flip a tile (reveal hidden or hide revealed).
         */
        EARTH_SCROLL_4: {
            name: 'Heavy Stomp',
            description: 'Select a tile to flip. Hidden tiles are revealed (draw scroll). Revealed tiles become hidden.',
            isCounter: false,
            priority: 4,

            execute(casterIndex, context, system) {
                console.log(`👣 Heavy Stomp activated by player ${casterIndex}`);

                // If triggered via Psychic on a non-caster client, skip the interactive UI.
                // The Psychic caster's client handles the tile selection and syncs state.
                if (context?.psychicRemoteClient) {
                    console.log(`👣 Heavy Stomp: skipping tile-flip UI on non-caster remote client`);
                    return { success: true, requiresSelection: true, message: 'Skipped on remote client' };
                }

                // Pass completionPayload and onComplete so interactive chaining works
                // (needed when multiple Heavy Stomps are queued via Psychic)
                const completionPayload = context?.scrollName ? {
                    scrollName: context.scrollName,
                    effectName: 'Heavy Stomp',
                    spell: context.spell
                } : null;
                system.enterTileFlipMode(casterIndex, completionPayload, context?.onComplete);

                return {
                    success: true,
                    requiresSelection: true,
                    message: 'Select a tile to flip...'
                };
            }
        },

        /**
         * Earth Scroll V - Avalanche
         * Enable global stone placement for this turn.
         */
        EARTH_SCROLL_5: {
            name: 'Avalanche',
            description: 'This turn, place any stones anywhere on the board (not just adjacent).',
            isCounter: false,
            priority: 5,

            execute(casterIndex, context, system) {
                console.log(`🏔️ Avalanche activated by player ${casterIndex}`);

                // Activate global placement buff
                system.activeBuffs.globalPlacement = {
                    expiresThisTurn: true,
                    playerIndex: casterIndex
                };

                const message = 'Avalanche! Place stones anywhere this turn.';
                updateStatus(message);

                return {
                    success: true,
                    message: message
                };
            }
        },

        // ============================================
        // WATER SCROLLS
        // ============================================

        /**
         * Water Scroll I - Reflect
         * Duplicate the effect of the scroll that was last cast this turn.
         */
        WATER_SCROLL_1: {
            name: 'Reflect',
            description: 'Duplicate the effect of the scroll that was last activated this turn.',
            isCounter: false,
            priority: 1,

            execute(casterIndex, context, system) {
                console.log(`🪞 Reflect activated by player ${casterIndex}`);

                // When cast as a response: defer effect to beginning of caster's next turn
                const triggeringScroll = context?.triggeringScroll;
                if (triggeringScroll && triggeringScroll.name) {
                    if (triggeringScroll.name === 'WATER_SCROLL_1') {
                        updateStatus('Reflect failed: Cannot reflect Reflect!');
                        return { success: false, reason: 'Cannot reflect Reflect' };
                    }
                    // Queue via the central helper — dedups if this entry already
                    // arrived through another path (e.g. a reflect-buff-applied
                    // broadcast, or a double resolution)
                    const added = system.addPendingBuff('reflect', casterIndex, triggeringScroll.name, triggeringScroll.definition, context?.eventId || null);
                    updateStatus(`Reflect: At the beginning of your next turn, you will activate ${triggeringScroll.definition?.name || triggeringScroll.name}.`);

                    // Broadcast Reflect buff in multiplayer — only from the execution that
                    // actually queued the entry, never from a broadcast-driven re-execution
                    if (added && !context?.fromRemote && typeof isMultiplayer !== 'undefined' && isMultiplayer && typeof broadcastGameAction === 'function') {
                        broadcastGameAction('reflect-buff-applied', {
                            playerIndex: casterIndex,
                            scrollName: triggeringScroll.name,
                            scrollDefinition: triggeringScroll.definition,
                            eventId: context?.eventId || null
                        });
                    }

                    return { success: true, deferred: true };
                }

                // Get the last scroll cast this turn (main-phase Reflect).
                // Use context.previousScrollCast — captured by applyScrollEffects()
                // BEFORE this very cast overwrote system.lastScrollCastThisTurn to
                // Reflect itself. Reading system.lastScrollCastThisTurn directly here
                // (as this used to) always sees Reflect itself at this point, so the
                // self-check below fired on EVERY main-phase cast — same fix Sigh of
                // Recollection (Wind I) already has for the identical ordering issue.
                const selfScrollName = context?.scrollName || 'WATER_SCROLL_1';
                let lastScroll = null;
                if (context?.previousScrollCast && context.previousScrollCast.name !== selfScrollName) {
                    lastScroll = context.previousScrollCast;
                } else if (system.lastScrollCastThisTurn && system.lastScrollCastThisTurn.name !== selfScrollName) {
                    lastScroll = system.lastScrollCastThisTurn;
                }

                if (!lastScroll || !lastScroll.name) {
                    updateStatus('Reflect failed: No scroll was activated this turn!');
                    return { success: false, reason: 'No scroll cast this turn' };
                }

                // Cannot reflect itself (defensive — the lookup above already excludes it)
                if (lastScroll.name === 'WATER_SCROLL_1') {
                    updateStatus('Reflect failed: Cannot reflect Reflect!');
                    return { success: false, reason: 'Cannot reflect Reflect' };
                }

                const scrollDef = lastScroll.definition;
                const scrollName = lastScroll.name;

                // Execute the reflected scroll's effect
                const displayName = scrollDef?.name || scrollName;
                updateStatus(`Reflecting ${displayName}!`);

                // Check if the reflected scroll has a special effect
                const effect = system.getEffect(scrollName);
                if (effect) {
                    console.log(`🪞 Reflecting special effect: ${effect.name}`);
                    // Determine if we are the Reflect caster on this client.
                    // If not, interactive scrolls should skip their UI (same as Psychic remote client behavior).
                    // myPlayerIndex can be mid-impersonation (a bot's own turn — see
                    // bot-driver.js's asBot()), which is a DIFFERENT identity than the
                    // real human driving this browser. Resolve through
                    // BotDriver.driverRealIndex() when impersonating, same fallback
                    // multiplayer-state.js's 'response-resolved' listener already uses
                    // for this exact ambiguity.
                    const _reflectDriverIdx = (typeof window !== 'undefined' && window.BotDriver
                        && typeof window.BotDriver.driverRealIndex === 'function'
                        && window.BotDriver.driverRealIndex() != null)
                        ? window.BotDriver.driverRealIndex()
                        : (typeof myPlayerIndex !== 'undefined' ? myPlayerIndex : undefined);
                    const isReflectCaster = (typeof _reflectDriverIdx === 'undefined' || _reflectDriverIdx === null || _reflectDriverIdx === casterIndex);
                    // Execute the reflected scroll's special effect
                    const result = system.execute(scrollName, casterIndex, {
                        ...context,
                        psychicRemoteClient: context?.psychicRemoteClient || !isReflectCaster
                    });
                    return {
                        success: true,
                        reflected: scrollName,
                        message: `Reflected ${displayName}!`,
                        ...result
                    };
                }

                // No special effect - give base stone rewards
                if (scrollDef) {
                    const level = scrollDef.level || 1;
                    const element = scrollDef.element;

                    if (element && element !== 'catacomb') {
                        // Give stones based on scroll level
                        if (typeof stonePools !== 'undefined') {
                            const currentPlayerStones = typeof playerStoneCounts !== 'undefined'
                                ? playerStoneCounts[casterIndex]
                                : null;

                            if (currentPlayerStones) {
                                currentPlayerStones[element] = (currentPlayerStones[element] || 0) + level;
                                updateStatus(`Reflect! Gained +${level} ${element} stones from ${displayName}!`);

                                // Update UI
                                if (typeof updateStoneCountsUI === 'function') {
                                    updateStoneCountsUI();
                                }
                            }
                        }
                    } else if (element === 'catacomb' && scrollDef.patterns && scrollDef.patterns[0]) {
                        // Catacomb scroll - give +2 of each element in pattern
                        const elementCounts = {};
                        scrollDef.patterns[0].forEach(pos => {
                            elementCounts[pos.type] = (elementCounts[pos.type] || 0) + 1;
                        });

                        const currentPlayerStones = typeof playerStoneCounts !== 'undefined'
                            ? playerStoneCounts[casterIndex]
                            : null;

                        if (currentPlayerStones) {
                            Object.entries(elementCounts).forEach(([elem, count]) => {
                                currentPlayerStones[elem] = (currentPlayerStones[elem] || 0) + 2;
                            });
                            updateStatus(`Reflect! Gained catacomb scroll stones from ${displayName}!`);

                            if (typeof updateStoneCountsUI === 'function') {
                                updateStoneCountsUI();
                            }
                        }
                    }
                }

                return {
                    success: true,
                    reflected: scrollName,
                    message: `Reflected ${displayName}!`
                };
            }
        },

        /**
         * Water Scroll II - Refreshing Thought
         * Draw a Catacomb scroll.
         */
        WATER_SCROLL_2: {
            name: 'Refreshing Thought',
            description: 'Draw a Catacomb scroll.',
            isCounter: false,
            priority: 2,

            execute(casterIndex, context, system) {
                console.log(`💧 Refreshing Thought activated by player ${casterIndex}`);

                // Draw a catacomb scroll from the catacomb deck
                let drawnScroll = null;
                if (system.spellSystem && typeof system.spellSystem.drawFromDeck === 'function') {
                    drawnScroll = system.spellSystem.drawFromDeck('catacomb');
                }

                if (drawnScroll) {
                    system.spellSystem.ensurePlayerScrollsStructure(casterIndex);
                    system.spellSystem.playerScrolls[casterIndex].hand.add(drawnScroll);
                    system.spellSystem.updateScrollCount();

                    const drawnDef = system.spellSystem.patterns?.[drawnScroll];
                    const drawnName = drawnDef?.name || drawnScroll;
                    console.log(`💧 Refreshing Thought: drew ${drawnName} from catacomb deck`);

                    // Broadcast in multiplayer so other clients update their deck/hand state
                    if (typeof isMultiplayer !== 'undefined' && isMultiplayer && typeof broadcastGameAction === 'function') {
                        broadcastGameAction('scroll-collected', {
                            playerIndex: casterIndex,
                            scrollName: drawnScroll,
                            shrineType: 'catacomb'
                        });
                    }

                    if (typeof updateScrollDeckUI === 'function') {
                        try { updateScrollDeckUI(); } catch (e) {}
                    }

                    updateStatus(`Drew a Catacomb scroll: ${drawnName}!`);
                } else {
                    console.log(`💧 Refreshing Thought: no catacomb scrolls left in deck`);
                    updateStatus('No Catacomb scrolls left in deck!');
                }

                return {
                    success: true,
                    requiresSelection: false,
                    message: drawnScroll ? `Drew a Catacomb scroll!` : 'No Catacomb scrolls left in deck.'
                };
            }
        },

        /**
         * Water Scroll III - Inspiring Draught
         * Draw 2 scrolls from any decks, put 1 back and shuffle.
         */
        WATER_SCROLL_3: {
            name: 'Inspiring Draught',
            description: 'Draw 2 scrolls from any decks, then put 1 back and shuffle that deck.',
            isCounter: false,
            priority: 3,

            execute(casterIndex, context, system) {
                console.log(`🍵 Inspiring Draught activated by player ${casterIndex}`);

                // If triggered via Reflect/Psychic on a non-caster client, skip
                // interactive UI — same convention every other interactive scroll
                // in this file uses. This used to instead compare raw
                // myPlayerIndex to casterIndex directly, which is unreliable
                // when this runs from inside a bot's own end-turn (bot-driver.js's
                // asBot() still impersonating it — see the isReflectCaster fix
                // above for the full explanation): a bot handing off to the real
                // human caster would wrongly read as "remote" and silently skip.
                if (context?.psychicRemoteClient) {
                    console.log(`🍵 Inspiring Draught: skipping deck-pick UI on non-caster remote client`);
                    return { success: true, requiresSelection: true, message: 'Skipped on remote client' };
                }

                // Draw 2 from one deck, then put 1 back (show all scrolls of that element)
                system.enterInspiringDraughtMode(casterIndex, context);

                return {
                    success: true,
                    requiresSelection: true,
                    message: 'Select a deck, then choose one scroll to put back.'
                };
            }
        },

        /**
         * Water Scroll IV - Wandering River
         * A tile becomes any element type until next turn.
         */
        WATER_SCROLL_4: {
            name: 'Wandering River',
            description: 'Select a tile. Until your next turn, that tile counts as any element type you choose.',
            isCounter: false,
            priority: 4,

            execute(casterIndex, context, system) {
                console.log(`🌊 Wandering River activated by player ${casterIndex}`);

                // If triggered via Psychic on a non-caster client, skip interactive UI
                if (context?.psychicRemoteClient) {
                    console.log(`🌊 Wandering River: skipping tile-element UI on non-caster remote client`);
                    return { success: true, requiresSelection: true, message: 'Skipped on remote client' };
                }

                // Enter tile selection mode for element change
                system.enterTileElementChangeMode(casterIndex);

                return {
                    success: true,
                    requiresSelection: true,
                    message: 'Select a tile to change its element...'
                };
            }
        },

        /**
         * Water Scroll V - Control the Current
         * Click adjacent water stones to transform them into any element (free, no AP cost).
         */
        WATER_SCROLL_5: {
            name: 'Control the Current',
            description: 'This turn, click adjacent water stones to transform them into any other element (free).',
            isCounter: false,
            priority: 5,

            execute(casterIndex, context, system) {
                console.log(`🌀 Control the Current activated by player ${casterIndex}`);

                // If triggered via Psychic on a non-caster client, skip interactive UI
                if (context?.psychicRemoteClient) {
                    console.log(`🌀 Control the Current: skipping water-transform UI on non-caster remote client`);
                    return { success: true, requiresSelection: true, message: 'Skipped on remote client' };
                }

                // Activate water transformation buff - enables clicking water stones to transform
                system.activeBuffs.controlTheCurrent = {
                    expiresThisTurn: true,
                    playerIndex: casterIndex
                };

                // Enter water stone selection mode with completion payload
                const payload = {
                    scrollName: context.scrollName || 'WATER_SCROLL_5',
                    spell: context.spell,
                    effectName: 'Control the Current'
                };
                system.enterWaterTransformMode(casterIndex, payload);

                return {
                    success: true,
                    requiresSelection: true,
                    message: 'Click adjacent water stones to transform them!'
                };
            }
        },

        // ============================================
        // FIRE SCROLLS
        // ============================================

        /**
         * Fire Scroll I - Unbidden Lamplight
         * Response scroll - when opponent casts a scroll, send it to common area.
         * This is a response scroll (like Iron Stance) but doesn't cancel the scroll.
         */
        FIRE_SCROLL_1: {
            name: 'Unbidden Lamplight',
            description: 'Response: Send the triggering scroll to the common area (scroll still resolves).',
            isCounter: false, // Doesn't cancel the scroll, just redirects it
            isResponseOnly: true, // Can only be cast as a response
            priority: 1,

            execute(casterIndex, context, system) {
                console.log(`🕯️ Unbidden Lamplight activated by player ${casterIndex}`);

                // The context should contain the triggering scroll info
                const triggeringScroll = context?.triggeringScroll;

                if (triggeringScroll) {
                    // Mark the triggering scroll to go to lamplight caster's hand
                    system.pendingHandRedirect = {
                        scrollName: triggeringScroll.name,
                        originalCasterIndex: triggeringScroll.casterIndex,
                        redirectToPlayerIndex: casterIndex
                    };

                    const scrollDef = system.spellSystem?.patterns?.[triggeringScroll.name];
                    const scrollDisplayName = scrollDef?.name || triggeringScroll.name;
                    const message = `Unbidden Lamplight! ${scrollDisplayName} will go to your hand after resolving.`;
                    updateStatus(message);

                    // Count as activating fire for win-condition indicator on player tile
                    if (system.spellSystem) {
                        system.spellSystem.ensurePlayerScrollsStructure(casterIndex);
                        system.spellSystem.playerScrolls[casterIndex].activated.add('fire');
                        if (typeof updatePlayerElementSymbols === 'function') {
                            updatePlayerElementSymbols(casterIndex);
                        }
                    }

                    return {
                        success: true,
                        redirectToHand: triggeringScroll.name,
                        message: message
                    };
                }

                // Fallback if no triggering scroll (shouldn't happen in normal play)
                const message = 'Unbidden Lamplight activated!';
                updateStatus(message);
                if (system.spellSystem) {
                    system.spellSystem.ensurePlayerScrollsStructure(casterIndex);
                    system.spellSystem.playerScrolls[casterIndex].activated.add('fire');
                    if (typeof updatePlayerElementSymbols === 'function') {
                        updatePlayerElementSymbols(casterIndex);
                    }
                }
                return {
                    success: true,
                    message: message
                };
            }
        },

        /**
         * Fire Scroll II - Burning Motivation
         * Until end of turn, gain 2 AP for each stone you place. Stacks if activated multiple times.
         */
        FIRE_SCROLL_2: {
            name: 'Burning Motivation',
            description: 'Until end of turn, gain 2 AP for each stone you place. Stacks if activated multiple times.',
            isCounter: false,
            priority: 2,

            execute(casterIndex, context, system) {
                console.log(`🔥 Burning Motivation activated by player ${casterIndex}`);

                const existing = system.activeBuffs.burningMotivation;
                if (existing && existing.playerIndex === casterIndex) {
                    existing.stacks = (existing.stacks || 1) + 1;
                    updateStatus(`Burning Motivation! Stacks to ${existing.stacks} (gain ${existing.stacks * 2} AP per stone placed this turn).`);
                } else {
                    system.activeBuffs.burningMotivation = {
                        playerIndex: casterIndex,
                        stacks: 1,
                        expiresThisTurn: true
                    };
                    updateStatus('Burning Motivation! Gain 2 AP for each stone you place until end of turn (stacks if activated again).');
                }

                return {
                    success: true,
                    message: 'Burning Motivation active until end of turn.'
                };
            }
        },

        /**
         * Fire Scroll III - Sacrificial Pyre
         * Activate any scroll in hand ignoring pattern.
         */
        FIRE_SCROLL_3: {
            name: 'Sacrificial Pyre',
            description: 'Activate any scroll in your hand (ignoring pattern). The scroll goes to the common area.',
            isCounter: false,
            priority: 3,

            execute(casterIndex, context, system) {
                console.log(`🔥 Sacrificial Pyre activated by player ${casterIndex}`);

                // If triggered via Psychic on a non-caster client, skip interactive UI
                if (context?.psychicRemoteClient) {
                    console.log(`🔥 Sacrificial Pyre: skipping sacrifice UI on non-caster remote client`);
                    return { success: true, requiresSelection: true, message: 'Skipped on remote client' };
                }

                // Check if player has any scrolls in hand to sacrifice
                const playerScrolls = system.spellSystem
                    ? system.spellSystem.playerScrolls?.[casterIndex]
                    : null;
                if (!playerScrolls || playerScrolls.hand.size === 0) {
                    console.log(`🔥 Sacrificial Pyre: no scrolls in hand - cancelling`);
                    if (typeof updateStatus === 'function') updateStatus('No scrolls in hand to sacrifice!');
                    // cancelled: true prevents win-condition tracking in applyScrollEffects
                    return { success: false, requiresSelection: false, cancelled: true, message: 'No scrolls to sacrifice!' };
                }

                // Enter scroll selection mode for sacrificial activation
                system.enterScrollSacrificeMode(casterIndex, context?.onComplete);

                return {
                    success: true,
                    requiresSelection: true,
                    message: 'Select a scroll to sacrifice and activate...'
                };
            }
        },

        /**
         * Fire Scroll IV - Transmute
         * Discard stones or scrolls to regain AP.
         */
        FIRE_SCROLL_4: {
            name: 'Transmute',
            description: 'Discard any number of stones or scrolls to regain 2 AP each.',
            isCounter: false,
            priority: 4,

            execute(casterIndex, context, system) {
                console.log(`🔥 Transmute activated by player ${casterIndex}`);

                // If triggered via Reflect/Psychic on a non-caster client, skip
                // interactive UI — same convention every other interactive scroll
                // in this file uses. This used to instead compare raw
                // myPlayerIndex to casterIndex directly, which is unreliable
                // when this runs from inside a bot's own end-turn (see the
                // isReflectCaster fix above for the full explanation).
                if (context?.psychicRemoteClient) {
                    console.log(`🔥 Transmute: skipping discard UI on non-caster remote client`);
                    return { success: true, requiresSelection: true, message: 'Skipped on remote client' };
                }

                // Belt-and-suspenders: track the fire element win condition HERE, before opening the
                // modal, so it registers even if enterTransmuteMode encounters an error.
                // applyScrollEffects will also do this tracking after execute() returns, which is
                // idempotent (Set.add is safe to call twice). This early tracking ensures the symbol
                // appears on the shrine tile regardless of what happens inside the modal.
                system.spellSystem.ensurePlayerScrollsStructure(casterIndex);
                system.spellSystem.playerScrolls[casterIndex].activated.add('fire');
                if (typeof window !== 'undefined' && typeof window.updatePlayerElementSymbols === 'function') {
                    window.updatePlayerElementSymbols(casterIndex);
                }

                // Suppress void AP auto-sync while Transmute is open
                system.activeBuffs.suppressVoidAPSync = {
                    playerIndex: casterIndex
                };

                system.enterTransmuteMode(casterIndex, context);

                return {
                    success: true,
                    // Missing before — without this, a Reflect/Psychic replay's
                    // runNext() treated Transmute as already-resolved and
                    // immediately advanced to the next queued reflect/psychic
                    // (or chained into Psychic) while the discard modal was
                    // still open for the player.
                    requiresSelection: true,
                    message: 'Select stones or scrolls to transmute into AP.'
                };
            }
        },

        /**
         * Fire Scroll V - Arson
         * Destroy a stone from opponent's pool.
         */
        FIRE_SCROLL_5: {
            name: 'Arson',
            description: "Destroy one elemental stone from an opponent's pool. Move Arson to the common area.",
            isCounter: false,
            priority: 5,

            execute(casterIndex, context, system) {
                console.log(`🔥 Arson activated by player ${casterIndex}`);

                // If triggered via Psychic on a non-caster client, skip interactive UI
                if (context?.psychicRemoteClient) {
                    console.log(`🔥 Arson: skipping arson UI on non-caster remote client`);
                    return { success: true, requiresSelection: true, message: 'Skipped on remote client' };
                }

                // Enter opponent pool selection mode with completion payload
                system.enterArsonMode(casterIndex, {
                    scrollName: context?.scrollName || 'FIRE_SCROLL_5',
                    effectName: 'Arson',
                    spell: context?.spell
                });

                return {
                    success: true,
                    requiresSelection: true,
                    message: 'Select an opponent and a stone type to destroy...'
                };
            }
        },

        // ============================================
        // WIND SCROLLS
        // ============================================

        /**
         * Wind Scroll I - Sigh of Recollection
         * Draw a scroll and a stone of the type that was just activated.
         * Draw one stone of each element if it was a Catacomb scroll.
         */
        WIND_SCROLL_1: {
            name: 'Sigh of Recollection',
            description: 'Draw a scroll and a stone of the type that was just activated, if available. Draw one stone of each if it was a Catacomb scroll.',
            isCounter: false,
            priority: 1,

            execute(casterIndex, context, system) {
                console.log(`🌬️ Sigh of Recollection activated by player ${casterIndex}`);

                // Determine the "activated" scroll:
                // - Response mode: use the triggering scroll
                // - Main phase: use the last scroll cast this turn
                let activatedName = null;
                let activatedDef = null;

                const triggeringScroll = context?.triggeringScroll;
                const scrollName = context?.scrollName || 'WIND_SCROLL_1';

                if (triggeringScroll && triggeringScroll.name) {
                    // Response mode: use the scroll that triggered this response
                    activatedName = triggeringScroll.name;
                    activatedDef = triggeringScroll.definition
                        || system.spellSystem?.patterns?.[triggeringScroll.name];
                    console.log(`🌬️ Using triggering scroll: ${activatedName}`);
                } else if (context?.previousScrollCast && context.previousScrollCast.name !== scrollName) {
                    // Main phase: use the scroll cast before this one (not ourselves)
                    activatedName = context.previousScrollCast.name;
                    activatedDef = context.previousScrollCast.definition
                        || system.spellSystem?.patterns?.[context.previousScrollCast.name];
                    console.log(`🌬️ Using previous scroll cast this turn: ${activatedName}`);
                } else if (system.lastScrollCastThisTurn && system.lastScrollCastThisTurn.name !== scrollName) {
                    // Fallback: use lastScrollCastThisTurn (only if it's not this scroll itself)
                    activatedName = system.lastScrollCastThisTurn.name;
                    activatedDef = system.lastScrollCastThisTurn.definition
                        || system.spellSystem?.patterns?.[system.lastScrollCastThisTurn.name];
                    console.log(`🌬️ Using lastScrollCastThisTurn fallback: ${activatedName}`);
                }

                if (!activatedName || !activatedDef) {
                    console.log(`🌬️ No valid scroll to recall (previousScrollCast=${context?.previousScrollCast?.name || 'none'}, lastScrollCast=${system.lastScrollCastThisTurn?.name || 'none'}, self=${scrollName})`);
                    updateStatus('Sigh of Recollection: No other scroll was activated to recall!');
                    return { success: false, reason: 'No scroll activated this turn' };
                }

                const activatedElement = activatedDef.element;
                const displayName = activatedDef.name || activatedName;
                console.log(`🌬️ Recalling: ${displayName} (element: ${activatedElement})`);

                // --- Draw a scroll from the activated element's deck ---
                let drawnScrollName = null;
                const deckElement = activatedElement === 'catacomb' ? 'catacomb' : activatedElement;
                if (system.spellSystem && typeof system.spellSystem.drawFromDeck === 'function') {
                    drawnScrollName = system.spellSystem.drawFromDeck(deckElement);
                }

                if (drawnScrollName) {
                    // Add to caster's hand
                    system.spellSystem.ensurePlayerScrollsStructure(casterIndex);
                    system.spellSystem.playerScrolls[casterIndex].hand.add(drawnScrollName);
                    system.spellSystem.updateScrollCount();

                    const drawnDef = system.spellSystem.patterns?.[drawnScrollName];
                    console.log(`🌬️ Drew scroll: ${drawnDef?.name || drawnScrollName} from ${deckElement} deck`);

                    // Broadcast in multiplayer
                    if (typeof isMultiplayer !== 'undefined' && isMultiplayer && typeof broadcastGameAction === 'function') {
                        broadcastGameAction('scroll-collected', {
                            playerIndex: casterIndex,
                            scrollName: drawnScrollName,
                            shrineType: deckElement
                        });
                    }

                    // Update scroll deck UI
                    if (typeof updateScrollDeckUI === 'function') {
                        try { updateScrollDeckUI(); } catch (e) {}
                    }
                } else {
                    console.log(`🌬️ No scrolls left in ${deckElement} deck to draw`);
                }

                // --- Draw stone(s) based on activated element ---
                let stonesDrawn = {};
                if (activatedElement === 'catacomb' && activatedDef.patterns?.[0]) {
                    // Catacomb: draw 1 stone of each unique element in the pattern
                    const uniqueElements = [...new Set(activatedDef.patterns[0].map(p => p.type))];
                    uniqueElements.forEach(el => {
                        const drawn = system.drawStonesToPool(el, 1, casterIndex);
                        if (drawn > 0) stonesDrawn[el] = drawn;
                    });
                } else if (activatedElement) {
                    // Regular element: draw 1 stone of that type
                    const drawn = system.drawStonesToPool(activatedElement, 1, casterIndex);
                    if (drawn > 0) stonesDrawn[activatedElement] = drawn;
                }

                // Build status message
                const parts = [];
                if (drawnScrollName) {
                    const drawnDef = system.spellSystem?.patterns?.[drawnScrollName];
                    parts.push(`drew ${drawnDef?.name || drawnScrollName}`);
                }
                const stoneList = Object.entries(stonesDrawn).map(([el, n]) => `${n} ${el}`).join(', ');
                if (stoneList) {
                    parts.push(`+${stoneList} stone${Object.values(stonesDrawn).reduce((a, b) => a + b, 0) > 1 ? 's' : ''}`);
                }
                if (parts.length === 0) {
                    parts.push('nothing available to draw');
                }

                const message = `Sigh of Recollection (${displayName}): ${parts.join(', ')}!`;
                updateStatus(message);

                return {
                    success: true,
                    scrollDrawn: drawnScrollName,
                    stonesDrawn: stonesDrawn,
                    message: message
                };
            }
        },
        /**
         * Wind Scroll II - Respirate
         * Draw two wind stones. At end of turn, return all wind stones to the source.
         */
        WIND_SCROLL_2: {
            name: 'Respirate',
            description: 'Draw 2 wind stones. At end of turn, return all your wind stones to the source pool.',
            isCounter: false,
            priority: 2,

            execute(casterIndex, context, system) {
                console.log(`🌬️ Respirate activated by player ${casterIndex}`);

                const drawn = system.drawStonesToPool('wind', 2, casterIndex);
                system.activeBuffs.respirateWind = {
                    expiresThisTurn: true,
                    playerIndex: casterIndex
                };

                const message = `Respirate: drew ${drawn} wind stone${drawn === 1 ? '' : 's'}. All wind stones return to source at end of turn.`;
                updateStatus(message);

                return {
                    success: true,
                    stonesDrawn: drawn,
                    message: message
                };
            }
        },
        /**
         * Wind Scroll III - Freedom
         * Until your next turn, you may teleport for free between elemental
         * shrine centers, the same way a catacomb tile lets you teleport.
         */
        WIND_SCROLL_3: {
            name: 'Breath of Power',
            description: 'Until end of turn, you may move adjacent stones to another adjacent empty space.',
            isCounter: false,
            priority: 3,

            execute(casterIndex, context, system) {
                console.log(`🌬️ Breath of Power activated by player ${casterIndex}`);

                system.activeBuffs.breathOfPower = {
                    expiresThisTurn: true,
                    playerIndex: casterIndex
                };

                const message = 'Breath of Power: move adjacent stones to adjacent empty spaces this turn.';
                updateStatus(message);

                return {
                    success: true,
                    message: message
                };
            }
        },
        /**
         * Wind Scroll IV - Take Flight
         * Teleport target player to an unoccupied space. Move this scroll to common area.
         */
        WIND_SCROLL_4: {
            name: 'Take Flight',
            description: "Select a player to teleport. If you target yourself, you choose where to land; if you target another player, they choose instead. Destination must be an unoccupied hex on a tile occupied by another player. Cannot target player tiles. Cancels if no valid destination exists.",
            isCounter: false,
            priority: 4,

            execute(casterIndex, context, system) {
                console.log(`🌬️ Take Flight activated by player ${casterIndex}`);

                // If triggered via Psychic on a non-caster client, skip interactive UI
                if (context?.psychicRemoteClient) {
                    console.log(`🌬️ Take Flight: skipping flight UI on non-caster remote client`);
                    return { success: true, requiresSelection: true, message: 'Skipped on remote client' };
                }

                system.enterTakeFlightMode(casterIndex, {
                    scrollName: context?.scrollName || 'WIND_SCROLL_4',
                    effectName: 'Take Flight',
                    spell: context?.spell
                });

                return {
                    success: true,
                    requiresSelection: true,
                    message: 'Select a player to teleport...'
                };
            }
        },

        /**
         * Wind Scroll V - Breath of Power
         * Move adjacent stones to another adjacent empty space until end of turn.
         */
        WIND_SCROLL_5: {
            name: 'Freedom',
            description: 'Until your next turn, you may teleport for free between elemental shrine centers, the same way a catacomb tile lets you teleport (only applies to you).',
            isCounter: false,
            priority: 5,

            execute(casterIndex, context, system) {
                console.log(`🌬️ Freedom activated by player ${casterIndex}`);

                system.activeBuffs.freedom = {
                    playerIndex: casterIndex,
                    expiresNextTurn: true
                };

                if (typeof updateCatacombIndicators === 'function') {
                    updateCatacombIndicators();
                }

                const message = 'Freedom: teleport freely between elemental shrine centers until your next turn.';
                updateStatus(message);

                return {
                    success: true,
                    message: message
                };
            }
        },

        // ============================================
        // VOID SCROLLS
        // ============================================

        /**
         * Void Scroll I - Psychic
         * Counter the previous scroll (like Iron Stance), then play it during
         * your turn (like Reflect). Move Psychic to the common area.
         */
        VOID_SCROLL_5: {
            name: 'Create',
            description: 'Choose a stone type and draw stones equal to that stone\'s rank (Earth 5, Water 4, Fire 3, Wind 2, Void 1). Cannot exceed 5 of that type.',
            isCounter: false,
            priority: 5,
            execute(casterIndex, context, system) {
                console.log(`🔮 Create activated by player ${casterIndex}`);

                // If triggered via Psychic on a non-caster client, skip the interactive UI.
                // The Psychic caster's client handles the stone selection and syncs state.
                if (context?.psychicRemoteClient) {
                    console.log(`🔮 Create: skipping stone modal on non-caster remote client`);
                    return { success: true, requiresSelection: true, message: 'Skipped on remote client' };
                }

                system.showCreateStoneModal(casterIndex);

                return {
                    success: true,
                    requiresSelection: true,
                    message: 'Choose a stone type to create...'
                };
            }
        },

        VOID_SCROLL_3: {
            name: 'Simplify',
            description: 'Scrolls cost 1 AP for you to activate until the beginning of your next turn.',
            isCounter: false,
            priority: 3,
            execute(casterIndex, context, system) {
                console.log(`🔮 Simplify activated by player ${casterIndex}`);
                system.activeBuffs.simplify = {
                    expiresThisTurn: true,
                    playerIndex: casterIndex
                };
                const playerName = typeof getPlayerColorName === 'function' ? getPlayerColorName(casterIndex) : `Player ${casterIndex + 1}`;
                const message = `Simplify: ${playerName}'s scrolls cost 1 AP to activate until their next turn.`;
                updateStatus(message);

                if (typeof isMultiplayer !== 'undefined' && isMultiplayer && typeof broadcastGameAction === 'function') {
                    broadcastGameAction('simplify-applied', { playerIndex: casterIndex });
                }

                return { success: true, message: message };
            }
        },

        VOID_SCROLL_2: {
            name: 'Telekinesis',
            description: 'Move a tile that has no stones on it. If one player is on the tile, they move to its center. Cannot move a tile with multiple players on it. It must be touching 1 other tile. Cannot move a tile if it would strand an adjacent tile.',
            isCounter: false,
            priority: 2,
            execute(casterIndex, context, system) {
                console.log(`🔮 Telekinesis activated by player ${casterIndex}`);

                // If triggered via Psychic on a non-caster client, skip interactive UI
                if (context?.psychicRemoteClient) {
                    console.log(`🔮 Telekinesis: skipping telekinesis UI on non-caster remote client`);
                    return { success: true, requiresSelection: true, message: 'Skipped on remote client' };
                }

                system.enterTelekinesisMode(casterIndex, {
                    scrollName: context?.scrollName || 'VOID_SCROLL_2',
                    effectName: 'Telekinesis',
                    spell: context?.spell
                });

                return {
                    success: true,
                    requiresSelection: true,
                    message: 'Select a tile to move (0/3)...'
                };
            }
        },

        VOID_SCROLL_4: {
            name: "Scholar's Insight",
            description: 'Search through a Scroll Deck and add a scroll of your choice to your hand. Shuffle that deck afterwards.',
            isCounter: false,
            priority: 4,
            execute(casterIndex, context, system) {
                console.log(`🔮 Scholar's Insight activated by player ${casterIndex}`);

                // If triggered via Psychic on a non-caster client, skip interactive UI
                if (context?.psychicRemoteClient) {
                    console.log(`🔮 Scholar's Insight: skipping deck-search UI on non-caster remote client`);
                    return { success: true, requiresSelection: true, message: 'Skipped on remote client' };
                }

                system.enterScholarsInsightMode(casterIndex, {
                    scrollName: context?.scrollName || 'VOID_SCROLL_4',
                    effectName: "Scholar's Insight",
                    spell: context?.spell
                });

                return {
                    success: true,
                    requiresSelection: true,
                    message: 'Choose a scroll deck to search...'
                };
            }
        },

        VOID_SCROLL_1: {
            name: 'Psychic',
            description: "Counter the previous scroll, then play it during your turn - unless its caster pays 2 AP to negate Psychic. Move Psychic to the common area.",
            isCounter: true,
            priority: 1,

            execute(casterIndex, context, system) {
                console.log(`🔮 Psychic activated by player ${casterIndex}`);

                // When used as a counter in the response window, context.triggeringScroll
                // contains the scroll that was cancelled. (If the original caster paid the
                // ransom, response-window.js never calls this at all — see the
                // 'counter-negated' result path — so everything below only runs when the
                // steal actually goes through.)
                const triggeringScroll = context?.triggeringScroll;

                if (triggeringScroll && triggeringScroll.name) {
                    // Cannot psychic yourself (edge case)
                    if (triggeringScroll.name === 'VOID_SCROLL_1') {
                        updateStatus('Psychic failed: Cannot psychic Psychic!');
                        return { success: false, reason: 'Cannot psychic Psychic' };
                    }

                    // Store the countered scroll to be played at the beginning of the
                    // caster's next turn. Queue via the central helper — dedups if this
                    // entry already arrived through another path (e.g. the
                    // psychic-buff-applied broadcast or a double resolution).
                    const added = system.addPendingBuff('psychic', casterIndex, triggeringScroll.name, triggeringScroll.definition, context?.eventId || null);

                    // Broadcast Psychic buff in multiplayer — only from the execution that
                    // actually queued the entry, never from a broadcast-driven re-execution
                    if (added && !context?.fromRemote && typeof isMultiplayer !== 'undefined' && isMultiplayer && typeof broadcastGameAction === 'function') {
                        broadcastGameAction('psychic-buff-applied', {
                            playerIndex: casterIndex,
                            scrollName: triggeringScroll.name,
                            scrollDefinition: triggeringScroll.definition,
                            eventId: context?.eventId || null
                        });
                    }

                    // Mark Psychic itself to go to common area.
                    // The disposition handler in multiplayer-state.js handles
                    // "countered-original" entries; we set a flag so it knows
                    // to force-common-area on the next handleScrollDisposition call.
                    system.pendingForceCommonArea = {
                        scrollName: context?.scrollName || 'VOID_SCROLL_1',
                        playerIndex: casterIndex
                    };

                    const displayName = triggeringScroll.definition?.name || triggeringScroll.name;
                    updateStatus(`Psychic! Countered ${displayName}. You will play it at the start of your next turn.`);

                    return {
                        success: true,
                        isCounter: true,
                        message: `Psychic countered ${displayName}!`
                    };
                }

                // Fallback: main-phase cast (no triggering scroll — just acts as counter signal)
                return {
                    success: true,
                    isCounter: true,
                    message: 'Psychic counters the scroll!'
                };
            }
        },

        // ========================================
        // CATACOMB SCROLL EFFECTS
        // ========================================

        CATACOMB_SCROLL_2: {
            name: 'Mine',
            description: 'If the center of this pattern is an elemental shrine, that shrine produces twice as many stones this turn (cannot exceed 5).',
            isCounter: false,
            priority: 2,
            execute(casterIndex, context, system) {
                console.log(`⛏️ Mine activated by player ${casterIndex}`);

                // Check if the caster is standing on an elemental shrine
                const playerPos = (typeof playerPositions !== 'undefined' && playerPositions[casterIndex])
                    ? playerPositions[casterIndex] : null;

                if (!playerPos) {
                    updateStatus('Mine: no player position found.');
                    return { success: true, message: 'Mine: no player position found.' };
                }

                const shrine = (typeof findShrineAtPosition === 'function')
                    ? findShrineAtPosition(playerPos.x, playerPos.y) : null;

                const elementalTypes = ['earth', 'water', 'fire', 'wind', 'void'];
                if (shrine && elementalTypes.includes(shrine.shrineType)) {
                    system.activeBuffs.mine = {
                        expiresThisTurn: true,
                        playerIndex: casterIndex,
                        shrineType: shrine.shrineType
                    };
                    const message = `Mine: ${shrine.shrineType} shrine will produce double stones this turn!`;
                    updateStatus(message);
                    return { success: true, message: message };
                } else {
                    const message = 'Mine: pattern center is not on an elemental shrine. No bonus applied.';
                    updateStatus(message);
                    return { success: true, message: message };
                }
            }
        },

        CATACOMB_SCROLL_3: {
            name: 'Call to Adventure',
            description: 'You may flip one unoccupied tile. Until end of turn, when you reveal a tile, immediately draw Elemental Stones as if you had ended your turn on that tile\'s center.',
            isCounter: false,
            priority: 3,
            execute(casterIndex, context, system) {
                console.log(`🗺️ Call to Adventure activated by player ${casterIndex}`);

                // Buff persists for the rest of the turn
                system.activeBuffs.callToAdventure = {
                    expiresThisTurn: true,
                    playerIndex: casterIndex
                };

                updateStatus('Call to Adventure: choose a tile to flip, then revealing tiles will grant shrine stones!');

                // Reuse Heavy Stomp tile-flip mechanic (filters for unoccupied tiles)
                const completionPayload = context?.scrollName ? {
                    scrollName: context.scrollName,
                    effectName: 'Call to Adventure',
                    spell: context.spell
                } : null;
                system.enterTileFlipMode(casterIndex, completionPayload, context?.onComplete);

                return {
                    success: true,
                    requiresSelection: true,
                    message: 'Select a tile to flip...'
                };
            }
        },

        CATACOMB_SCROLL_5: {
            name: 'Steam Vents',
            description: 'Until end of turn, spending an AP to move allows you to move two spaces instead of one.',
            isCounter: false,
            priority: 5,
            execute(casterIndex, context, system) {
                console.log(`♨️ Steam Vents activated by player ${casterIndex}`);

                system.activeBuffs.steamVents = {
                    expiresThisTurn: true,
                    playerIndex: casterIndex,
                    freeStepBanked: true // first step is always free (every other step costs AP)
                };

                const message = 'Steam Vents: each AP spent on movement moves you two spaces this turn!';
                updateStatus(message);

                return {
                    success: true,
                    message: message
                };
            }
        },

        CATACOMB_SCROLL_6: {
            name: 'Seed the Skies',
            description: 'Gather up to 5 water stones. This turn, you may place water and wind stones on any valid hex (not just adjacent).',
            isCounter: false,
            priority: 6,
            execute(casterIndex, context, system) {
                console.log(`🌧️ Seed the Skies activated by player ${casterIndex}`);

                const drawn = system.drawStonesToPool('water', 5, casterIndex);

                system.activeBuffs.waterWindGlobalPlacement = {
                    expiresThisTurn: true,
                    playerIndex: casterIndex
                };

                const message = `Seed the Skies: drew ${drawn} water stone${drawn === 1 ? '' : 's'}. Water and wind placement is global this turn.`;
                updateStatus(message);

                return {
                    success: true,
                    stonesDrawn: drawn,
                    message: message
                };
            }
        },

        CATACOMB_SCROLL_7: {
            name: 'Reflecting Pool',
            description: 'Regain 2 AP for each different stone type within 5 spaces of you. This can be used once per turn.',
            isCounter: false,
            priority: 7,
            execute(casterIndex, context, system) {
                console.log(`💧 Reflecting Pool activated by player ${casterIndex}`);

                // Once per turn guard
                const existing = system.activeBuffs.reflectingPool;
                if (existing && existing.playerIndex === casterIndex) {
                    const msg = 'Reflecting Pool already used this turn.';
                    updateStatus(msg);
                    return { success: false, message: msg };
                }

                const playerPos = (typeof playerPositions !== 'undefined' && playerPositions[casterIndex])
                    ? playerPositions[casterIndex] : null;
                if (!playerPos || typeof pixelToHex !== 'function') {
                    const msg = 'Reflecting Pool failed: player position not found.';
                    updateStatus(msg);
                    return { success: false, message: msg };
                }

                const playerHex = pixelToHex(playerPos.x, playerPos.y, TILE_SIZE);
                const types = new Set();
                if (Array.isArray(placedStones)) {
                    placedStones.forEach(stone => {
                        const stoneHex = pixelToHex(stone.x, stone.y, TILE_SIZE);
                        const dq = Math.abs(playerHex.q - stoneHex.q);
                        const dr = Math.abs(playerHex.r - stoneHex.r);
                        const ds = Math.abs((-playerHex.q - playerHex.r) - (-stoneHex.q - stoneHex.r));
                        const hexDistance = Math.max(dq, dr, ds);
                        if (hexDistance <= 5) types.add(stone.type);
                    });
                }

                const apGain = types.size * 2;
                if (typeof addAP === 'function') {
                    addAP(apGain);
                }

                system.activeBuffs.reflectingPool = {
                    expiresThisTurn: true,
                    playerIndex: casterIndex
                };

                const message = `Reflecting Pool: regained ${apGain} AP.`;
                updateStatus(message);

                return { success: true, message: message, apGained: apGain };
            }
        },

        CATACOMB_SCROLL_1: {
            name: 'Mudslide',
            description: 'Until end of turn, earth and water stones act as wind stones for movement (free movement).',
            isCounter: false,
            priority: 1,
            execute(casterIndex, context, system) {
                console.log(`🌊 Mudslide activated by player ${casterIndex}`);

                system.activeBuffs.mudslide = {
                    expiresThisTurn: true,
                    playerIndex: casterIndex
                };

                const message = 'Mudslide: earth and water stones grant free movement this turn!';
                updateStatus(message);

                return {
                    success: true,
                    message: message
                };
            }
        },

        CATACOMB_SCROLL_4: {
            name: 'Excavate',
            description: 'You, your scrolls, and stones cannot be the target of any scroll until your next turn. Your scrolls cannot be responded to this turn. At the beginning of your next turn, you may teleport to any unoccupied hex.',
            isCounter: false,
            skipResponseWindow: true,
            priority: 4,
            execute(casterIndex, context, system) {
                console.log(`⛏️ Excavate activated by player ${casterIndex}`);

                // Set immunity buff (persists until caster's next turn — NOT expiresThisTurn)
                system.activeBuffs.excavate = {
                    playerIndex: casterIndex
                };

                // Set pending teleport for the start of caster's next turn
                system.activeBuffs.excavateTeleport = {
                    playerIndex: casterIndex
                };

                // Scrolls cast this turn cannot be responded to
                system.activeBuffs.excavateNoResponse = {
                    playerIndex: casterIndex
                };

                const message = 'Excavate! You are immune to scrolls until your next turn. Your scrolls cannot be responded to this turn.';
                updateStatus(message);

                // Broadcast immunity buff to other clients
                if (typeof isMultiplayer !== 'undefined' && isMultiplayer && typeof broadcastGameAction === 'function') {
                    broadcastGameAction('excavate-immunity', {
                        playerIndex: casterIndex
                    });
                }

                return {
                    success: true,
                    message: message
                };
            }
        },

        CATACOMB_SCROLL_8: {
            name: 'Plunder',
            description: 'Choose a target player. Select one of their active scrolls and discard it to the common area.',
            isCounter: false,
            priority: 8,
            execute(casterIndex, context, system) {
                console.log(`🏴‍☠️ Plunder activated by player ${casterIndex}`);

                // If triggered via Psychic on a non-caster client, skip interactive UI
                if (context?.psychicRemoteClient) {
                    console.log(`🏴‍☠️ Plunder: skipping plunder UI on non-caster remote client`);
                    return { success: true, requiresSelection: true, message: 'Skipped on remote client' };
                }

                system.enterPlunderMode(casterIndex, {
                    scrollName: context?.scrollName || 'CATACOMB_SCROLL_8',
                    effectName: 'Plunder',
                    spell: context?.spell
                });

                return {
                    success: true,
                    requiresSelection: true,
                    message: 'Select a target player to plunder an active scroll from...'
                };
            }
        },

        CATACOMB_SCROLL_9: {
            name: 'Quick Reflexes',
            description: 'Search for an available level 1 scroll and add it to your hand. Draw 2 stones of that type. Until your next turn, level 1 scrolls cost 0 AP to activate. Shuffle the deck searched.',
            isCounter: false,
            priority: 9,
            execute(casterIndex, context, system) {
                console.log(`⚡ Quick Reflexes activated by player ${casterIndex}`);

                // If triggered via Psychic on a non-caster client, skip interactive UI
                if (context?.psychicRemoteClient) {
                    console.log(`⚡ Quick Reflexes: skipping search UI on non-caster remote client`);
                    return { success: true, requiresSelection: true, message: 'Skipped on remote client' };
                }

                // Activate the buff: level 1 scrolls cost 0 AP until next turn
                system.activeBuffs.quickReflexes = {
                    playerIndex: casterIndex
                };

                // Enter deck-search mode to find a level 1 scroll
                system.enterQuickReflexesMode(casterIndex, {
                    scrollName: context?.scrollName || 'CATACOMB_SCROLL_9',
                    effectName: 'Quick Reflexes',
                    spell: context?.spell,
                    // Reflect/Psychic chains pass onComplete; see finishQuickReflexes
                    onComplete: context?.onComplete
                });

                return {
                    success: true,
                    requiresSelection: true,
                    message: 'Quick Reflexes: searching for a level 1 scroll...'
                };
            }
        },

        CATACOMB_SCROLL_10: {
            name: 'Combust',
            description: 'Select a tile and destroy all stones on it. Cannot target player tiles.',
            isCounter: false,
            priority: 10,
            execute(casterIndex, context, system) {
                console.log(`🔥 Combust activated by player ${casterIndex}`);

                // If triggered via Psychic on a non-caster client, skip interactive UI
                if (context?.psychicRemoteClient) {
                    console.log(`🔥 Combust: skipping combust UI on non-caster remote client`);
                    return { success: true, requiresSelection: true, message: 'Skipped on remote client' };
                }

                system.enterScorchedEarthMode(casterIndex);

                return {
                    success: true,
                    requiresSelection: true,
                    message: 'Select a tile to destroy all stones on it...'
                };
            }
        },
    },

    // ============================================
    // TELEKINESIS MODE (Void Scroll III)
    // ============================================

    enterTelekinesisMode(casterIndex, completionPayload) {
        const self = this;
        const MAX_MOVES = 1;

        console.log(`🔮 Entering Telekinesis mode for player ${casterIndex}`);

        // Inject wind-drift animation once
        if (!document.getElementById('telekinesis-style')) {
            const style = document.createElement('style');
            style.id = 'telekinesis-style';
            style.textContent = `
                @keyframes telekinesisFloat {
                    0%,  100% { opacity: 1; }
                    30%       { opacity: 0.75; }
                    70%       { opacity: 0.85; }
                }
            `;
            document.head.appendChild(style);
        }

        // Highlight all eligible (draggable) tiles in wind yellow so it's clear
        // which can move. Telekinesis uses the Shifting-Sands rule now: no
        // stones, and at most one player (that player is carried along and
        // recentered on the tile). Bridge tiles still highlight but error on
        // pickup (strand rule enforced at drag-start, same as before).
        const eligibleTiles = this.getEligibleTilesForShiftingSands();
        eligibleTiles.forEach(tile => {
            this.highlightTile(tile, '#e8c84d', 3);
            if (tile.element) tile.element.style.animation = 'telekinesisFloat 2.2s ease-in-out infinite';
        });

        // Set up the telekinesis state so game-core/game-ui know about the rules
        window.telekinesisState = {
            active: true,
            movesLeft: MAX_MOVES,
            maxMoves: MAX_MOVES,
            casterIndex: casterIndex,
            movedTiles: []
        };

        // Enable tile dragging
        window.tileMoveMode = true;

        const unhighlightAll = () => eligibleTiles.forEach(tile => self.unhighlightTile(tile));

        // Finish handler — turn off tile move mode and clean up
        const finishTelekinesis = () => {
            window.tileMoveMode = false;
            const movesDone = MAX_MOVES - (window.telekinesisState?.movesLeft ?? 0);
            window.telekinesisState = null;

            unhighlightAll();

            // Remove buttons
            const doneEl = document.getElementById('telekinesis-done-btn');
            if (doneEl && doneEl.parentNode) doneEl.parentNode.removeChild(doneEl);
            const cancelEl = document.getElementById('scroll-cancel-btn');
            if (cancelEl && cancelEl.parentNode) cancelEl.parentNode.removeChild(cancelEl);

            self.selectionMode = null;

            updateStatus(`Telekinesis complete! Moved ${movesDone} tile${movesDone === 1 ? '' : 's'}.`);

            // Signal that selection effect is complete
            if (completionPayload && self.spellSystem && typeof self.spellSystem.onSelectionEffectComplete === 'function') {
                self.spellSystem.onSelectionEffectComplete(completionPayload.scrollName, completionPayload.effectName, completionPayload.spell);
            }
        };

        // Expose so the tile-drop handler in game-ui can call it when moves run out
        window.finishTelekinesis = finishTelekinesis;

        // Create cancel button
        const cancelBtn = this.createCancelButton('Cancel', () => {
            window.tileMoveMode = false;
            window.telekinesisState = null;
            window.finishTelekinesis = null;
            unhighlightAll();
            const doneEl = document.getElementById('telekinesis-done-btn');
            if (doneEl && doneEl.parentNode) doneEl.parentNode.removeChild(doneEl);
            self.cancelSelectionMode();
        });

        // Create done button — styled in wind yellow to match the tile highlights
        const doneBtn = document.createElement('button');
        doneBtn.id = 'telekinesis-done-btn';
        doneBtn.textContent = `Done (0/${MAX_MOVES})`;
        Object.assign(doneBtn.style, {
            position: 'fixed',
            bottom: '60px',
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: '2001',
            padding: '10px 24px',
            backgroundColor: '#c8a800',
            color: 'white',
            border: 'none',
            borderRadius: '8px',
            cursor: 'pointer',
            fontSize: '16px',
            fontWeight: 'bold',
            boxShadow: '0 4px 12px rgba(0,0,0,0.5)'
        });
        doneBtn.onclick = () => finishTelekinesis();
        document.body.appendChild(doneBtn);

        // Minimal selection mode — just for cleanup if cancelSelectionMode is called
        this.selectionMode = {
            type: 'telekinesis',
            casterIndex: casterIndex,
            completionPayload: completionPayload,
            cleanup() {
                window.tileMoveMode = false;
                window.telekinesisState = null;
                window.finishTelekinesis = null;
                unhighlightAll();
                const d = document.getElementById('telekinesis-done-btn');
                if (d && d.parentNode) d.parentNode.removeChild(d);
                const c = document.getElementById('scroll-cancel-btn');
                if (c && c.parentNode) c.parentNode.removeChild(c);
            }
        };

        updateStatus(`Telekinesis: drag a highlighted tile to move it. Tiles must touch 2+ others after moving.`);
    },

    // ============================================
    // SCHOLAR'S INSIGHT MODE (Void Scroll II)
    // ============================================

    enterScholarsInsightMode(casterIndex, completionPayload) {
        const self = this;
        const STONE_TYPES_LOCAL = {
            earth: { color: '#69d83a', symbol: '▲' },
            water: { color: '#5894f4', symbol: '◯' },
            fire: { color: '#ed1b43', symbol: '♦' },
            wind: { color: '#ffce00', symbol: '≋' },
            void: { color: '#9458f4', symbol: '✺' }
        };

        // Step 1: Show deck picker (which element deck to search)
        const showDeckPicker = () => {
            const existing = document.getElementById('scholars-insight-modal');
            if (existing) existing.remove();

            const overlay = document.createElement('div');
            overlay.id = 'scholars-insight-modal';
            styleDecisionOverlay(overlay);

            const modal = document.createElement('div');
            Object.assign(modal.style, {
                backgroundColor: '#1a1a2e',
                border: '2px solid #9458f4',
                borderRadius: '10px',
                padding: '20px',
                color: 'white',
                minWidth: '250px',
                maxWidth: '350px'
            });

            const titleEl = document.createElement('h3');
            titleEl.textContent = "Scholar's Insight: Choose a Deck";
            titleEl.style.marginBottom = '15px';
            titleEl.style.textAlign = 'center';
            titleEl.style.color = '#9458f4';
            modal.appendChild(titleEl);
            makeDecisionModalMovable(modal, titleEl, overlay);

            const subtitle = document.createElement('div');
            subtitle.textContent = 'Select an element deck to search through.';
            subtitle.style.color = '#bdc3c7';
            subtitle.style.fontSize = '13px';
            subtitle.style.marginBottom = '15px';
            subtitle.style.textAlign = 'center';
            modal.appendChild(subtitle);

            ['earth', 'water', 'fire', 'wind', 'void'].forEach(element => {
                const deck = self.spellSystem?.scrollDecks?.[element];
                const deckSize = deck ? deck.length : 0;
                const info = STONE_TYPES_LOCAL[element];

                const btn = document.createElement('button');
                btn.textContent = `${info.symbol} ${element.charAt(0).toUpperCase() + element.slice(1)} (${deckSize} scrolls)`;
                Object.assign(btn.style, {
                    display: 'block',
                    width: '100%',
                    padding: '10px',
                    margin: '5px 0',
                    backgroundColor: '#2d2d44',
                    color: info.color,
                    border: `1px solid ${info.color}`,
                    borderRadius: '5px',
                    cursor: deckSize > 0 ? 'pointer' : 'not-allowed',
                    fontSize: '14px',
                    fontWeight: 'bold',
                    opacity: deckSize > 0 ? '1' : '0.4'
                });
                if (deckSize > 0) {
                    btn.onmouseenter = () => btn.style.backgroundColor = '#3d3d55';
                    btn.onmouseleave = () => btn.style.backgroundColor = '#2d2d44';
                    btn.onclick = () => {
                        overlay.remove();
                        showDeckBrowser(element);
                    };
                }
                modal.appendChild(btn);
            });

            // Cancel button
            const cancelBtn = document.createElement('button');
            cancelBtn.textContent = 'Cancel';
            Object.assign(cancelBtn.style, {
                display: 'block',
                width: '100%',
                padding: '10px',
                margin: '10px 0 0 0',
                backgroundColor: '#e74c3c',
                color: 'white',
                border: 'none',
                borderRadius: '5px',
                cursor: 'pointer',
                fontSize: '14px'
            });
            cancelBtn.onclick = () => {
                overlay.remove();
                self.cancelSelectionMode();
            };
            modal.appendChild(cancelBtn);

            overlay.appendChild(modal);
            document.body.appendChild(overlay);
        };

        // Step 2: Show scrolls in chosen deck for selection
        const showDeckBrowser = (element) => {
            const deck = self.spellSystem?.scrollDecks?.[element];
            if (!deck || deck.length === 0) {
                updateStatus(`The ${element} scroll deck is empty!`);
                self.cancelSelectionMode();
                return;
            }

            const info = STONE_TYPES_LOCAL[element];
            const existing = document.getElementById('scholars-insight-modal');
            if (existing) existing.remove();

            const overlay = document.createElement('div');
            overlay.id = 'scholars-insight-modal';
            styleDecisionOverlay(overlay);

            const modal = document.createElement('div');
            Object.assign(modal.style, {
                backgroundColor: '#1a1a2e',
                border: `2px solid ${info.color}`,
                borderRadius: '10px',
                padding: '20px',
                color: 'white',
                minWidth: '300px',
                maxWidth: '450px',
                maxHeight: '80vh',
                overflowY: 'auto'
            });

            const titleEl = document.createElement('h3');
            titleEl.textContent = `${element.charAt(0).toUpperCase() + element.slice(1)} Deck (${deck.length} scrolls)`;
            titleEl.style.marginBottom = '5px';
            titleEl.style.textAlign = 'center';
            titleEl.style.color = info.color;
            modal.appendChild(titleEl);
            makeDecisionModalMovable(modal, titleEl, overlay);

            const subtitle = document.createElement('div');
            subtitle.textContent = 'Click a scroll to add it to your hand.';
            subtitle.style.color = '#bdc3c7';
            subtitle.style.fontSize = '13px';
            subtitle.style.marginBottom = '15px';
            subtitle.style.textAlign = 'center';
            modal.appendChild(subtitle);

            deck.forEach((scrollName, index) => {
                const scrollInfo = self.spellSystem?.patterns?.[scrollName];
                if (!scrollInfo) return;

                const card = document.createElement('div');
                Object.assign(card.style, {
                    backgroundColor: '#34495e',
                    border: '1px solid #555',
                    borderRadius: '8px',
                    padding: '12px',
                    marginBottom: '8px',
                    cursor: 'pointer',
                    transition: 'border-color 0.15s'
                });
                card.onmouseenter = () => card.style.borderColor = info.color;
                card.onmouseleave = () => card.style.borderColor = '#555';

                const nameEl = document.createElement('div');
                nameEl.textContent = scrollInfo.name || scrollName;
                nameEl.style.fontWeight = 'bold';
                nameEl.style.color = info.color;
                nameEl.style.marginBottom = '4px';
                card.appendChild(nameEl);

                const descEl = document.createElement('div');
                descEl.textContent = scrollInfo.description || 'No description';
                descEl.style.fontSize = '12px';
                descEl.style.color = '#95a5a6';
                card.appendChild(descEl);

                const levelEl = document.createElement('div');
                levelEl.textContent = `Level ${scrollInfo.level || '?'}`;
                levelEl.style.fontSize = '11px';
                levelEl.style.color = '#7f8c8d';
                levelEl.style.marginTop = '4px';
                card.appendChild(levelEl);

                card.onclick = () => {
                    overlay.remove();
                    selectScroll(element, scrollName, index);
                };

                modal.appendChild(card);
            });

            // Back button
            const backBtn = document.createElement('button');
            backBtn.textContent = '← Back to Decks';
            Object.assign(backBtn.style, {
                display: 'inline-block',
                padding: '8px 14px',
                margin: '10px 8px 0 0',
                backgroundColor: '#2d2d44',
                color: 'white',
                border: '1px solid #555',
                borderRadius: '5px',
                cursor: 'pointer',
                fontSize: '13px'
            });
            backBtn.onclick = () => {
                overlay.remove();
                showDeckPicker();
            };
            modal.appendChild(backBtn);

            // Cancel button
            const cancelBtn = document.createElement('button');
            cancelBtn.textContent = 'Cancel';
            Object.assign(cancelBtn.style, {
                display: 'inline-block',
                padding: '8px 14px',
                margin: '10px 0 0 0',
                backgroundColor: '#e74c3c',
                color: 'white',
                border: 'none',
                borderRadius: '5px',
                cursor: 'pointer',
                fontSize: '13px'
            });
            cancelBtn.onclick = () => {
                overlay.remove();
                self.cancelSelectionMode();
            };
            modal.appendChild(cancelBtn);

            overlay.appendChild(modal);
            document.body.appendChild(overlay);
        };

        // Step 3: Handle selection — add to hand (or trigger cascade), shuffle deck, broadcast
        const selectScroll = (element, scrollName, index) => {
            const sp = self.spellSystem;
            const deck = sp.scrollDecks[element];
            if (!deck) return;

            // Remove chosen scroll from deck
            deck.splice(index, 1);

            // Shuffle the deck afterwards
            if (sp.shuffleDeck) {
                sp.shuffleDeck(deck);
                console.log(`🔮 Scholar's Insight: ${element} deck shuffled after search`);
            }

            const scrolls = sp.getPlayerScrolls(false);
            const scrollInfo = sp.patterns?.[scrollName];

            // Always add to hand — end-of-turn overflow handles cascade if needed
            scrolls.hand.add(scrollName);
            sp.updateScrollCount();

            if (typeof updateScrollDeckUI === 'function') updateScrollDeckUI();
            if (typeof updateHUD === 'function') updateHUD();

            // Open Hand panel + show toast (same as finding a scroll on a shrine)
            if (typeof sp.showScrollNotification === 'function') {
                sp.showScrollNotification(scrollInfo, element, scrollName);
            }

            const displayName = scrollInfo?.name || scrollName;
            updateStatus(`Scholar's Insight: added "${displayName}" to your hand!`);

            // Broadcast in multiplayer
            if (typeof isMultiplayer !== 'undefined' && isMultiplayer && typeof broadcastGameAction === 'function') {
                broadcastGameAction('scholars-insight', {
                    playerIndex: casterIndex,
                    element: element,
                    scrollName: scrollName
                });
            }

            // Clean up selection mode
            self.selectionMode = null;
        };

        // Set selection mode (allows cancellation)
        this.selectionMode = {
            type: 'scholars-insight',
            casterIndex: casterIndex,
            cleanup: () => {
                const modal = document.getElementById('scholars-insight-modal');
                if (modal) modal.remove();
            }
        };

        // Start by showing the deck picker
        showDeckPicker();
    },

    // ============================================
    // CREATE MODAL (Void Scroll V)
    // ============================================

    showCreateStoneModal(casterIndex) {
        const self = this;
        const STONE_RANKS = {
            earth: { rank: 5, color: '#69d83a', symbol: '▲' },
            water: { rank: 4, color: '#5894f4', symbol: '◯' },
            fire:  { rank: 3, color: '#ed1b43', symbol: '♦' },
            wind:  { rank: 2, color: '#ffce00', symbol: '≋' },
            void:  { rank: 1, color: '#9458f4', symbol: '✺' }
        };

        const existing = document.getElementById('create-stone-modal');
        if (existing) existing.remove();

        const overlay = document.createElement('div');
        overlay.id = 'create-stone-modal';
        styleDecisionOverlay(overlay);

        const modal = document.createElement('div');
        Object.assign(modal.style, {
            backgroundColor: '#1a1a2e',
            border: '2px solid #9458f4',
            borderRadius: '10px',
            padding: '20px',
            color: 'white',
            minWidth: '250px',
            maxWidth: '350px'
        });

        const titleEl = document.createElement('h3');
        titleEl.textContent = 'Create: Choose a Stone Type';
        titleEl.style.marginBottom = '15px';
        titleEl.style.textAlign = 'center';
        titleEl.style.color = '#9458f4';
        modal.appendChild(titleEl);
        makeDecisionModalMovable(modal, titleEl, overlay);

        const subtitle = document.createElement('div');
        subtitle.textContent = 'Draw stones equal to that element\'s rank (max 5 in pool).';
        subtitle.style.color = '#bdc3c7';
        subtitle.style.fontSize = '13px';
        subtitle.style.marginBottom = '15px';
        subtitle.style.textAlign = 'center';
        modal.appendChild(subtitle);

        ['earth', 'water', 'fire', 'wind', 'void'].forEach(element => {
            const info = STONE_RANKS[element];
            const currentCount = (typeof stoneCounts !== 'undefined' ? stoneCounts[element] : 0) || 0;
            const capacity = 5;
            const room = capacity - currentCount;

            const btn = document.createElement('button');
            btn.textContent = `${info.symbol} ${element.charAt(0).toUpperCase() + element.slice(1)} - rank ${info.rank} (${currentCount}/${capacity})`;
            Object.assign(btn.style, {
                display: 'block',
                width: '100%',
                padding: '10px',
                margin: '5px 0',
                backgroundColor: '#2d2d44',
                color: info.color,
                border: `1px solid ${info.color}`,
                borderRadius: '5px',
                cursor: room > 0 ? 'pointer' : 'not-allowed',
                fontSize: '14px',
                fontWeight: 'bold',
                opacity: room > 0 ? '1' : '0.4'
            });

            if (room > 0) {
                btn.onmouseenter = () => btn.style.backgroundColor = '#3d3d55';
                btn.onmouseleave = () => btn.style.backgroundColor = '#2d2d44';
                btn.onclick = () => {
                    overlay.remove();
                    const drawn = self.drawStonesToPool(element, info.rank, casterIndex);
                    const message = `Create: drew ${drawn} ${element} stone${drawn === 1 ? '' : 's'} (rank ${info.rank})!`;
                    updateStatus(message);
                    console.log(`🔮 Create: drew ${drawn} ${element} stones (rank ${info.rank}) for player ${casterIndex}`);

                    // Broadcast in multiplayer
                    if (typeof broadcastGameAction === 'function') {
                        broadcastGameAction('create-stones', {
                            playerIndex: casterIndex,
                            element: element,
                            count: drawn
                        });
                    }
                };
            }
            modal.appendChild(btn);
        });

        // Cancel button
        const cancelBtn = document.createElement('button');
        cancelBtn.textContent = 'Cancel';
        Object.assign(cancelBtn.style, {
            display: 'block',
            width: '100%',
            padding: '10px',
            margin: '10px 0 0 0',
            backgroundColor: '#e74c3c',
            color: 'white',
            border: 'none',
            borderRadius: '5px',
            cursor: 'pointer',
            fontSize: '14px'
        });
        cancelBtn.onclick = () => {
            overlay.remove();
            updateStatus('Create cancelled.');
        };
        modal.appendChild(cancelBtn);

        overlay.appendChild(modal);
        document.body.appendChild(overlay);
    },

    // ============================================
    // TILE SWAP MODE (Earth Scroll II)
    // ============================================

    enterTileSwapMode(casterIndex, completionPayload) {
        const self = this;
        console.log(`🔀 Entering tile swap mode for player ${casterIndex}`);

        // Get eligible tiles (no stones, at most one player, not player tiles).
        // Note: this is Shifting-Sands-specific — Telekinesis/Heavy Stomp still use
        // the stricter getEligibleTilesForSwap()/getEligibleTilesForFlip() (no players at all).
        const eligibleTiles = this.getEligibleTilesForShiftingSands();
        console.log(`   Found ${eligibleTiles.length} eligible tiles for swap`);

        if (eligibleTiles.length < 2) {
            updateStatus('Not enough eligible tiles to swap!');
            return;
        }

        // Highlight eligible tiles
        this.highlightTiles(eligibleTiles, '#69d83a');

        // Create cancel button
        const cancelBtn = this.createCancelButton('Cancel Swap', () => {
            self.cancelSelectionMode();
        });

        // Track selected tiles
        let selectedTiles = [];

        // Store selection mode state (completionPayload: { scrollName, spell, effectName } for onSelectionEffectComplete)
        this.selectionMode = {
            type: 'tile-swap',
            casterIndex: casterIndex,
            eligibleTiles: eligibleTiles,
            selectedTiles: selectedTiles,
            cancelBtn: cancelBtn,
            completionPayload: completionPayload || null,

            handleTileClick(tile) {
                console.log(`🔀 Tile clicked for swap: ${tile.id}`);

                // Re-validate at click time: no stones, and at most one player
                if (!self.isTileEligibleForShiftingSands(tile)) {
                    console.log(`   Tile ${tile.id} has stones or multiple players - cannot swap`);
                    updateStatus('Cannot swap: tile has stones or multiple players on it.');
                    return;
                }

                // Must also be in initial eligible set (e.g. not a player tile)
                if (!eligibleTiles.find(t => t.id === tile.id)) {
                    console.log(`   Tile ${tile.id} is NOT eligible`);
                    updateStatus('Cannot swap: tile has stones or multiple players on it.');
                    return;
                }

                // Check if already selected
                const existingIndex = selectedTiles.findIndex(t => t.id === tile.id);
                if (existingIndex >= 0) {
                    // Deselect
                    selectedTiles.splice(existingIndex, 1);
                    self.unhighlightTile(tile);
                    self.highlightTile(tile, '#69d83a'); // Back to eligible highlight
                    updateStatus(`Deselected tile. Select ${2 - selectedTiles.length} more.`);
                    return;
                }

                // Select tile
                selectedTiles.push(tile);
                self.highlightTile(tile, '#2ecc71', 4); // Selected highlight
                console.log(`   Tile ${tile.id} selected. Total selected: ${selectedTiles.length}`);

                if (selectedTiles.length === 1) {
                    updateStatus('First tile selected. Select second tile to swap.');
                } else if (selectedTiles.length === 2) {
                    // Re-validate both tiles before swapping (state may have changed)
                    const t1 = selectedTiles[0], t2 = selectedTiles[1];
                    if (!self.isTileEligibleForShiftingSands(t1)) {
                        updateStatus('Cannot swap: first tile now has stones or multiple players on it.');
                        selectedTiles.length = 0;
                        self.selectionMode.cleanup();
                        self.selectionMode = null;
                        return;
                    }
                    if (!self.isTileEligibleForShiftingSands(t2)) {
                        updateStatus('Cannot swap: second tile now has stones or multiple players on it.');
                        selectedTiles.length = 0;
                        self.selectionMode.cleanup();
                        self.selectionMode = null;
                        return;
                    }
                    // Capture payload and cleanup FIRST (remove highlights while tile refs are still valid)
                    const payload = self.selectionMode.completionPayload;
                    self.selectionMode.cleanup();
                    self.selectionMode = null;

                    // Then perform swap (no DOM re-use of tile elements; highlights already cleared)
                    console.log(`   Performing swap between ${t1.id} and ${t2.id}`);
                    self.performTileSwap(t1, t2);

                    // Signal that selection effect is complete so game exits "waiting for tiles" phase
                    if (payload && self.spellSystem && typeof self.spellSystem.onSelectionEffectComplete === 'function') {
                        self.spellSystem.onSelectionEffectComplete(payload.scrollName, payload.effectName, payload.spell);
                    }
                }
            },

            cleanup() {
                // Remove highlights
                eligibleTiles.forEach(tile => self.unhighlightTile(tile));
                // Remove cancel button
                if (cancelBtn && cancelBtn.parentNode) {
                    cancelBtn.parentNode.removeChild(cancelBtn);
                }
            }
        };

        updateStatus('Select two tiles to swap (any distance).');
    },

    performTileSwap(tile1, tile2) {
        // Only swap tiles with no stones and at most one player on them
        if (!this.isTileEligibleForShiftingSands(tile1) || !this.isTileEligibleForShiftingSands(tile2)) {
            updateStatus('Cannot swap: a tile has stones or multiple players on it.');
            return;
        }

        // Capture each tile's lone occupant (if any) BEFORE positions change, so they can
        // travel with their tile and be recentered on it once it lands in its new spot.
        const carriedPlayers = [];
        [tile1, tile2].forEach(tile => {
            const occupants = this.getPlayersOnTile(tile);
            if (occupants.length === 1) carriedPlayers.push({ playerIndex: occupants[0], tile });
        });

        // Swap positions
        const tempX = tile1.x;
        const tempY = tile1.y;

        tile1.x = tile2.x;
        tile1.y = tile2.y;
        tile2.x = tempX;
        tile2.y = tempY;

        // Update visual transforms
        if (tile1.element) {
            tile1.element.setAttribute('transform', `translate(${tile1.x}, ${tile1.y}) rotate(${tile1.rotation || 0})`);
        }
        if (tile2.element) {
            tile2.element.setAttribute('transform', `translate(${tile2.x}, ${tile2.y}) rotate(${tile2.rotation || 0})`);
        }

        // Recenter any carried player onto their tile's new position
        const movedPlayers = carriedPlayers.map(({ playerIndex, tile }) => {
            this.recenterPlayerOnTile(playerIndex, tile);
            return { playerIndex, newX: tile.x, newY: tile.y };
        });

        // Broadcast in multiplayer
        if (typeof isMultiplayer !== 'undefined' && isMultiplayer && typeof broadcastGameAction === 'function') {
            broadcastGameAction('tile-swap', {
                tile1Id: tile1.id,
                tile2Id: tile2.id,
                tile1NewPos: { x: tile1.x, y: tile1.y },
                tile2NewPos: { x: tile2.x, y: tile2.y },
                movedPlayers: movedPlayers
            });
        }

        window.SoundSystem?.play('placetile');

        // Ensure pulse is cleared on the two swapped tiles
        this.unhighlightTile(tile1);
        this.unhighlightTile(tile2);

        updateStatus(movedPlayers.length > 0 ? 'Tiles swapped! A player was carried along and recentered.' : 'Tiles swapped!');
        console.log(`🔀 Swapped tiles: ${tile1.id} <-> ${tile2.id}`);
    },

    // ============================================
    // TILE FLIP MODE (Earth Scroll IV)
    // ============================================

    enterTileFlipMode(casterIndex, completionPayload, onComplete) {
        const self = this;

        // Get eligible tiles (no stones, no players, not player tiles)
        const eligibleTiles = this.getEligibleTilesForFlip();

        if (eligibleTiles.length === 0) {
            updateStatus('No eligible tiles to flip!');
            // Still signal completion so the next queued Psychic scroll can run
            if (typeof onComplete === 'function') onComplete();
            else if (completionPayload && self.spellSystem?.onSelectionEffectComplete) {
                self.spellSystem.onSelectionEffectComplete(completionPayload.scrollName, completionPayload.effectName, completionPayload.spell);
            }
            return;
        }

        // Highlight eligible tiles
        this.highlightTiles(eligibleTiles, '#69d83a');

        // Create cancel button
        const cancelBtn = this.createCancelButton('Cancel Flip', () => {
            self.cancelSelectionMode();
            if (typeof onComplete === 'function') onComplete();
        });

        // Store selection mode state
        this.selectionMode = {
            type: 'tile-flip',
            casterIndex: casterIndex,
            eligibleTiles: eligibleTiles,
            cancelBtn: cancelBtn,

            handleTileClick(tile) {
                // Check if tile is eligible
                if (!eligibleTiles.find(t => t.id === tile.id)) {
                    updateStatus('Cannot flip: tile has stones or players on it.');
                    return;
                }

                // Perform flip
                self.performTileFlip(tile, casterIndex);
                self.selectionMode.cleanup();
                self.selectionMode = null;

                // Signal completion (for normal casts via onSelectionEffectComplete,
                // or for Psychic-chained casts via the onComplete callback)
                if (typeof onComplete === 'function') {
                    onComplete();
                } else if (completionPayload && self.spellSystem?.onSelectionEffectComplete) {
                    self.spellSystem.onSelectionEffectComplete(completionPayload.scrollName, completionPayload.effectName, completionPayload.spell);
                }
            },

            cleanup() {
                // Remove highlights
                eligibleTiles.forEach(tile => self.unhighlightTile(tile));
                // Remove cancel button
                if (cancelBtn && cancelBtn.parentNode) {
                    cancelBtn.parentNode.removeChild(cancelBtn);
                }
            }
        };

        updateStatus('Select a tile to flip (reveal/hide).');
    },

    performTileFlip(tile, casterIndex) {
        if (tile.flipped) {
            // Currently hidden -> reveal it
            if (typeof revealTile === 'function') {
                window.SoundSystem?.play('placetile');
                revealTile(tile.id, true); // silent — Heavy Stomp uses placetile
                // revealTile() sets its own status (including AP bonus message for catacomb tiles)
            } else {
                // Manual reveal
                tile.flipped = false;
                // The revealTile function should handle scroll drawing
                console.log(`👣 Revealed tile: ${tile.id} (${tile.shrineType})`);
            }
        } else {
            // Currently revealed -> hide it
            // Note: recreateTileAsFlipped sets tile.flipped = true internally;
            // do NOT set it here first or recreateTileAsFlipped's guard will bail early.
            if (typeof recreateTileAsFlipped === 'function') {
                recreateTileAsFlipped(tile);
            } else {
                tile.flipped = true;
            }

            // Tile flip is irreversible — clear undo history
            lastMove = null;
            window.lastScrollAction = null;

            // Broadcast
            if (typeof isMultiplayer !== 'undefined' && isMultiplayer && typeof broadcastGameAction === 'function') {
                broadcastGameAction('tile-hide', {
                    tileId: tile.id
                });
            }

            updateStatus(`Hid ${tile.shrineType} shrine tile.`);
            console.log(`👣 Hid tile: ${tile.id}`);
        }
    },

    // ============================================
    // HELPER FUNCTIONS
    // ============================================

    // Used by Telekinesis (drag highlighting) and Heavy Stomp (via getEligibleTilesForFlip).
    // Keeps the strict "no players at all" rule — Shifting Sands has its own looser rule below.
    getEligibleTilesForSwap() {
        if (typeof placedTiles === 'undefined') return [];

        return placedTiles.filter(tile => {
            // Not a player tile
            if (tile.isPlayerTile) return false;

            // No stones on tile
            if (this.tileHasStones(tile)) return false;

            // No players on tile
            if (this.tileHasPlayers(tile)) return false;

            return true;
        });
    },

    getEligibleTilesForFlip() {
        // Same criteria as swap
        return this.getEligibleTilesForSwap();
    },

    // Shifting Sands (Earth II) only: a tile is a valid swap target if it has no stones
    // and at most one player on it. A single occupant is carried along with the tile and
    // recentered on it (see performTileSwap); a tile with 2+ players cannot be targeted.
    // Deliberately separate from getEligibleTilesForSwap(), which Telekinesis and Heavy
    // Stomp still use with the stricter "no players at all" rule.
    isTileEligibleForShiftingSands(tile) {
        if (tile.isPlayerTile) return false;
        if (this.tileHasStones(tile)) return false;
        return this.getPlayersOnTile(tile).length <= 1;
    },

    getEligibleTilesForShiftingSands() {
        if (typeof placedTiles === 'undefined') return [];
        return placedTiles.filter(tile => this.isTileEligibleForShiftingSands(tile));
    },

    // Wandering River: any non-player tile (revealed or unrevealed) can be transformed
    getEligibleTilesForWanderingRiver() {
        if (typeof placedTiles === 'undefined') return [];
        return placedTiles.filter(tile => {
            if (tile.isPlayerTile || tile.shrineType === 'player') return false;
            return true;
        });
    },

    tileHasStones(tile) {
        if (typeof placedStones === 'undefined') return false;

        // Use same radius as findTileAtPosition (game-core): TILE_SIZE * 4 covers full tile
        // TILE_SIZE * 2.5 was too small and missed stones on outer hexes
        const tileRadius = typeof TILE_SIZE !== 'undefined' ? TILE_SIZE * 4 : 80;

        return placedStones.some(stone => {
            const dist = Math.sqrt(Math.pow(stone.x - tile.x, 2) + Math.pow(stone.y - tile.y, 2));
            return dist < tileRadius;
        });
    },

    tileHasPlayers(tile) {
        return this.getPlayersOnTile(tile).length > 0;
    },

    // Indices (into playerPositions) of every player standing on this tile
    getPlayersOnTile(tile) {
        if (typeof playerPositions === 'undefined') return [];

        // Match tileHasStones / findTileAtPosition radius
        const tileRadius = typeof TILE_SIZE !== 'undefined' ? TILE_SIZE * 4 : 80;

        const indices = [];
        playerPositions.forEach((pos, index) => {
            if (!pos) return;
            const dist = Math.sqrt(Math.pow(pos.x - tile.x, 2) + Math.pow(pos.y - tile.y, 2));
            if (dist < tileRadius) indices.push(index);
        });
        return indices;
    },

    // Snap a player's pawn to a tile's center (e.g. after Shifting Sands carries them along)
    recenterPlayerOnTile(playerIndex, tile) {
        if (typeof playerPositions === 'undefined') return;
        const player = playerPositions[playerIndex];
        if (!player) return;

        player.x = tile.x;
        player.y = tile.y;
        if (player.element) {
            player.element.setAttribute('transform', `translate(${tile.x}, ${tile.y})`);
        }
    },

    highlightTiles(tiles, color) {
        tiles.forEach(tile => this.highlightTile(tile, color));
    },

    highlightTile(tile, color, strokeWidth = 3) {
        if (!tile.element) return;

        // Try multiple selectors to find hex elements
        let hexes = tile.element.querySelectorAll('.hex-tile');
        if (hexes.length === 0) {
            hexes = tile.element.querySelectorAll('polygon');
        }

        hexes.forEach(hex => {
            hex.setAttribute('data-original-stroke', hex.getAttribute('stroke') || 'none');
            hex.setAttribute('data-original-stroke-width', hex.getAttribute('stroke-width') || '1');
            hex.setAttribute('stroke', color);
            hex.setAttribute('stroke-width', strokeWidth);
        });

        // Also add a pulsing animation
        tile.element.style.animation = 'tilePulse 1s ease-in-out infinite';

        // Add pulse animation if not already in DOM
        if (!document.getElementById('tile-pulse-style')) {
            const style = document.createElement('style');
            style.id = 'tile-pulse-style';
            style.textContent = `
                @keyframes tilePulse {
                    0%, 100% { opacity: 1; }
                    50% { opacity: 0.7; }
                }
            `;
            document.head.appendChild(style);
        }
    },

    unhighlightTile(tile) {
        if (!tile.element) return;

        let hexes = tile.element.querySelectorAll('.hex-tile');
        if (hexes.length === 0) {
            hexes = tile.element.querySelectorAll('polygon');
        }

        hexes.forEach(hex => {
            const origStroke = hex.getAttribute('data-original-stroke') || 'none';
            const origWidth = hex.getAttribute('data-original-stroke-width') || '1';
            hex.setAttribute('stroke', origStroke);
            hex.setAttribute('stroke-width', origWidth);
        });

        tile.element.style.animation = '';
    },

    createCancelButton(text, onClick) {
        const btn = document.createElement('button');
        btn.textContent = text;
        btn.id = 'scroll-cancel-btn';
        Object.assign(btn.style, {
            position: 'fixed',
            bottom: '20px',
            left: '50%',
            transform: 'translateX(-50%)',
            padding: '10px 20px',
            backgroundColor: '#e74c3c',
            color: 'white',
            border: 'none',
            borderRadius: '5px',
            cursor: 'pointer',
            fontSize: '16px',
            fontWeight: 'bold',
            zIndex: '1000'
        });
        btn.onclick = onClick;
        document.body.appendChild(btn);
        return btn;
    },

    drawStonesToPool(stoneType, count, playerIndex) {
        // Draw stones from source pool to player pool
        if (typeof stonePools === 'undefined') {
            console.warn('Stone pools not available');
            return 0;
        }

        // Determine the target player pool.
        // If an explicit playerIndex is given, use playerPools[playerIndex] directly
        // so that response scrolls (cast by a non-active player) modify the correct pool.
        let targetPool = null;
        const pools = typeof playerPools !== 'undefined' ? playerPools : (typeof window !== 'undefined' && window.playerPools);
        if (playerIndex !== undefined && playerIndex !== null && pools && pools[playerIndex]) {
            targetPool = pools[playerIndex];
        } else if (typeof stoneCounts !== 'undefined') {
            targetPool = stoneCounts;
        }

        if (!targetPool) {
            console.warn('No target player pool available');
            return 0;
        }

        // Get player pool capacity (default 5)
        const capacity = (typeof playerPoolCapacity !== 'undefined' && playerPoolCapacity[stoneType])
            ? playerPoolCapacity[stoneType]
            : 5;
        const currentCount = targetPool[stoneType] || 0;
        const roomInPool = capacity - currentCount;

        // Can only draw up to: min(requested, available in source, room in player pool)
        const sourceAvailable = stonePools[stoneType] || 0;
        const toDraw = Math.min(count, sourceAvailable, roomInPool);

        if (toDraw > 0) {
            stonePools[stoneType] -= toDraw;
            targetPool[stoneType] += toDraw;

            // Update UI
            if (typeof updateStoneCount === 'function') {
                updateStoneCount(stoneType);
            }

            console.log(`📜 Drew ${toDraw} ${stoneType} stones to player ${playerIndex ?? 'active'} pool (had ${currentCount}/${capacity})`);
        } else if (roomInPool <= 0) {
            console.log(`📜 Cannot draw ${stoneType} stones - pool is full (${currentCount}/${capacity})`);
        }

        return toDraw;
    },

    // Quick Reflexes: search for a level 1 scroll, add to hand, draw 2 stones of that type
    enterQuickReflexesMode(casterIndex, completionPayload) {
        const self = this;
        const STONE_TYPES_LOCAL = {
            earth: { color: '#69d83a', symbol: '▲' },
            water: { color: '#5894f4', symbol: '◯' },
            fire: { color: '#ed1b43', symbol: '♦' },
            wind: { color: '#ffce00', symbol: '≋' },
            void: { color: '#9458f4', symbol: '✺' }
        };

        const sp = self.spellSystem;

        // Collect all available level-1 scrolls across elemental decks (catacomb excluded)
        const level1Elements = ['earth', 'water', 'fire', 'wind', 'void'];
        const available = []; // [{ element, scrollName, index }]
        level1Elements.forEach(element => {
            const deck = sp?.scrollDecks?.[element];
            if (!deck) return;
            deck.forEach((scrollName, index) => {
                const def = sp?.patterns?.[scrollName];
                if (def && def.level === 1) {
                    available.push({ element, scrollName, index });
                }
            });
        });

        // Signal that Quick Reflexes is done, the same way the other
        // selection scrolls do: a Reflect/Psychic chain gets its onComplete
        // (so the chain moves on), a normal cast gets onSelectionEffectComplete,
        // which broadcasts 'scroll-effect' with the activated elements. Quick
        // Reflexes used to skip both, so other players never marked its
        // elements as activated and their boards drifted out of sync
        // (seen in match 4, turn 17).
        const finishQuickReflexes = () => {
            if (typeof completionPayload?.onComplete === 'function') {
                completionPayload.onComplete();
            } else if (completionPayload?.spell && sp?.onSelectionEffectComplete) {
                sp.onSelectionEffectComplete(completionPayload.scrollName, completionPayload.effectName, completionPayload.spell);
            }
        };

        if (available.length === 0) {
            if (typeof updateStatus === 'function') {
                updateStatus('Quick Reflexes: no level 1 scrolls available in any deck!');
            }
            self.selectionMode = null;
            finishQuickReflexes();
            return;
        }

        // Build and show modal
        const showPicker = () => {
            const existing = document.getElementById('quick-reflexes-modal');
            if (existing) existing.remove();

            const overlay = document.createElement('div');
            overlay.id = 'quick-reflexes-modal';
            styleDecisionOverlay(overlay);

            const modal = document.createElement('div');
            Object.assign(modal.style, {
                backgroundColor: '#1a1a2e',
                border: '2px solid #ffce00',
                borderRadius: '10px',
                padding: '20px',
                color: 'white',
                minWidth: '340px',
                maxWidth: '500px',
                maxHeight: '80vh',
                overflowY: 'auto'
            });

            const titleEl = document.createElement('h3');
            titleEl.textContent = '⚡ Quick Reflexes: Choose a Level 1 Scroll';
            titleEl.style.marginBottom = '5px';
            titleEl.style.textAlign = 'center';
            titleEl.style.color = '#ffce00';
            modal.appendChild(titleEl);
            makeDecisionModalMovable(modal, titleEl, overlay);

            const subtitle = document.createElement('div');
            subtitle.textContent = 'Add it to your hand and draw 2 stones of its type.';
            subtitle.style.color = '#bdc3c7';
            subtitle.style.fontSize = '13px';
            subtitle.style.marginBottom = '15px';
            subtitle.style.textAlign = 'center';
            modal.appendChild(subtitle);

            const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V'];
            available.forEach(({ element, scrollName, index }) => {
                const def = sp?.patterns?.[scrollName];
                if (!def) return;
                const elColor = (STONE_TYPES_LOCAL[element] || {}).color || '#fff';
                const iconSrc = window.STONE_TYPES?.[element]?.img || '';
                const elLabel = element.charAt(0).toUpperCase() + element.slice(1);
                const lvLabel = def.level ? 'Lv. ' + (ROMAN[def.level] || def.level) : '';
                const metaText = [elLabel, lvLabel].filter(Boolean).join(' · ');

                const card = document.createElement('div');
                Object.assign(card.style, {
                    backgroundColor: '#2d2d44',
                    border: `2px solid ${elColor}`,
                    borderRadius: '10px',
                    padding: '14px',
                    marginBottom: '10px',
                    cursor: 'pointer',
                    transition: 'background-color 0.15s, transform 0.15s'
                });
                card.onmouseenter = () => { card.style.backgroundColor = '#3d3d55'; card.style.transform = 'scale(1.02)'; };
                card.onmouseleave = () => { card.style.backgroundColor = '#2d2d44'; card.style.transform = 'scale(1)'; };

                // ── Header: icon · name + meta ──────────────────────────
                const hdr = document.createElement('div');
                Object.assign(hdr.style, { display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' });

                if (iconSrc) {
                    const icon = document.createElement('img');
                    icon.src = iconSrc;
                    Object.assign(icon.style, { width: '26px', height: '26px', flexShrink: '0' });
                    hdr.appendChild(icon);
                }

                const titleWrap = document.createElement('div');
                const nameEl = document.createElement('div');
                nameEl.textContent = def.name || scrollName;
                Object.assign(nameEl.style, { fontWeight: 'bold', color: elColor, fontSize: '15px' });
                titleWrap.appendChild(nameEl);

                if (metaText) {
                    const metaEl = document.createElement('div');
                    metaEl.textContent = metaText;
                    Object.assign(metaEl.style, { fontSize: '11px', color: '#95a5a6', marginTop: '2px' });
                    titleWrap.appendChild(metaEl);
                }
                hdr.appendChild(titleWrap);
                card.appendChild(hdr);

                // ── Description ─────────────────────────────────────────
                if (def.description) {
                    const descEl = document.createElement('div');
                    descEl.textContent = def.description;
                    Object.assign(descEl.style, { fontSize: '12px', color: '#bdc3c7', marginBottom: '8px' });
                    card.appendChild(descEl);
                }

                // ── Pattern visual ───────────────────────────────────────
                if (def.patterns && typeof sp.createPatternVisual === 'function') {
                    try {
                        const visual = sp.createPatternVisual(def, element);
                        if (visual) {
                            const patWrap = document.createElement('div');
                            Object.assign(patWrap.style, {
                                display: 'flex', justifyContent: 'center',
                                margin: '8px 0', padding: '6px',
                                backgroundColor: '#1a1a2e', borderRadius: '6px'
                            });
                            patWrap.appendChild(visual);
                            card.appendChild(patWrap);
                        }
                    } catch (e) { /* skip if pattern rendering fails */ }
                }

                // ── Bonus line ───────────────────────────────────────────
                const bonusEl = document.createElement('div');
                bonusEl.textContent = `Draws 2 ${elLabel} stones`;
                Object.assign(bonusEl.style, { fontSize: '11px', color: elColor, marginTop: '6px', fontStyle: 'italic' });
                card.appendChild(bonusEl);

                card.onclick = () => {
                    overlay.remove();
                    selectScroll(element, scrollName, index);
                };

                modal.appendChild(card);
            });

            // Cancel button
            const cancelBtn = document.createElement('button');
            cancelBtn.textContent = 'Cancel';
            Object.assign(cancelBtn.style, {
                display: 'block',
                width: '100%',
                padding: '10px',
                margin: '10px 0 0 0',
                backgroundColor: '#e74c3c',
                color: 'white',
                border: 'none',
                borderRadius: '5px',
                cursor: 'pointer',
                fontSize: '14px'
            });
            cancelBtn.onclick = () => {
                overlay.remove();
                self.cancelSelectionMode();
            };
            modal.appendChild(cancelBtn);

            overlay.appendChild(modal);
            document.body.appendChild(overlay);
        };

        // Handle scroll selection
        const selectScroll = (element, scrollName, deckIndex) => {
            const deck = sp.scrollDecks[element];
            if (!deck) return;

            // Remove from deck and shuffle
            deck.splice(deckIndex, 1);
            if (sp.shuffleDeck) {
                sp.shuffleDeck(deck);
                console.log(`⚡ Quick Reflexes: ${element} deck shuffled after search`);
            }

            // Add scroll to hand. If this puts the hand over the limit, the
            // end-of-turn overflow banner makes the player cascade (same as a
            // normal shrine pickup, no separate cascade popup).
            // scrollInfo is used again below (status line), so it must live
            // at this level, not inside the over-limit check.
            const scrollInfo = sp.patterns?.[scrollName];
            const scrolls = sp.getPlayerScrolls(false);
            scrolls.hand.add(scrollName);
            sp.updateScrollCount();
            if (scrolls.hand.size > sp.MAX_HAND_SIZE) {
                updateStatus(`Picked up "${scrollInfo?.name || scrollName}". Your hand is over the limit. Cascade a scroll before ending your turn!`);
            }

            // Draw 2 stones of the scroll's element type
            const drawn = self.drawStonesToPool(element, 2, casterIndex);

            if (typeof updateScrollDeckUI === 'function') updateScrollDeckUI();
            if (typeof updateHUD === 'function') updateHUD();
            if (typeof syncPlayerState === 'function') syncPlayerState();

            const displayName = scrollInfo?.name || scrollName;
            if (typeof updateStatus === 'function') {
                updateStatus(`⚡ Quick Reflexes: added "${displayName}" to hand, drew ${drawn} ${element} stone${drawn === 1 ? '' : 's'}. Level 1 scrolls cost 0 AP this turn.`);
            }

            // Multiplayer broadcast — includes buffActive flag so the remote client
            // can set activeBuffs.quickReflexes and correctly price level-1 scrolls
            // in the response window affordability check.
            if (typeof isMultiplayer !== 'undefined' && isMultiplayer && typeof broadcastGameAction === 'function') {
                broadcastGameAction('quick-reflexes-search', {
                    playerIndex: casterIndex,
                    element: element,
                    scrollName: scrollName,
                    stonesDrawn: drawn,
                    buffActive: true
                });
            }

            self.selectionMode = null;
            finishQuickReflexes();
        };

        // Register selection mode for cancellation support
        this.selectionMode = {
            type: 'quick-reflexes',
            casterIndex: casterIndex,
            cleanup: () => {
                const modal = document.getElementById('quick-reflexes-modal');
                if (modal) modal.remove();
            }
        };

        showPicker();
    },

    // Check if extended placement is active for a stone type
    hasExtendedPlacement(stoneType, playerIndex) {
        // Earth extended placement (5 hex range for earth stones)
        if (stoneType === 'earth' && this.activeBuffs.earthExtendedPlacement) {
            const buff = this.activeBuffs.earthExtendedPlacement;
            if (buff.playerIndex === playerIndex) {
                return { active: true, range: buff.range };
            }
        }
        return { active: false, range: 1 };
    },

    // Check if global placement is active
    hasGlobalPlacement(playerIndex) {
        if (this.activeBuffs.globalPlacement) {
            return this.activeBuffs.globalPlacement.playerIndex === playerIndex;
        }
        return false;
    },

    // Check if Breath of Power allows moving stones this turn
    hasWindStoneMove(playerIndex) {
        if (this.activeBuffs.breathOfPower) {
            return this.activeBuffs.breathOfPower.playerIndex === playerIndex;
        }
        return false;
    },

    // Check if Freedom is active for a specific player
    hasFreedomActive(playerIndex) {
        return this.activeBuffs.freedom?.playerIndex === playerIndex;
    },

    // Track last scroll cast this turn (for Reflect)
    lastScrollCastThisTurn: null,
    stonesPlacedThisTurn: 0,

    // Called when a scroll is cast - track it for Reflect
    recordScrollCast(scrollName, scrollDefinition) {
        this.lastScrollCastThisTurn = {
            name: scrollName,
            definition: scrollDefinition
        };
    },

    // Called when a stone is placed - track for Burning Motivation
    recordStonePlaced() {
        this.stonesPlacedThisTurn++;
    },

    // Clear turn tracking (called on End Turn)
    clearTurnTracking() {
        this.lastScrollCastThisTurn = null;
        this.stonesPlacedThisTurn = 0;
    },

    // Single entry point for queueing a deferred Psychic/Reflect activation.
    // ALL writers (effect execution and multiplayer broadcast handlers) must go
    // through here: the same logical event can reach a client via multiple paths
    // (local execute, psychic/reflect-buff-applied broadcast, or a double
    // resolution caused by the response-timeout race). Each resolution is
    // stamped with a unique eventId by the response window, so echoes of one
    // event are deduped by id while a genuine repeat (the same player
    // countering the same scroll name twice before their turn) gets a fresh id
    // and queues normally. Entries arriving without an id (unexpected path)
    // fall back to {playerIndex, scrollName} dedup, which errs on dropping.
    // Returns true if a new entry was queued, false if it was a duplicate.
    addPendingBuff(kind, playerIndex, scrollName, definition, eventId = null) {
        const key = kind === 'psychic' ? 'psychicPending' : 'reflectPending';
        if (!Array.isArray(this.activeBuffs[key])) {
            this.activeBuffs[key] = [];
        }
        const queue = this.activeBuffs[key];
        const existing = eventId
            ? queue.find(p => p.eventId === eventId)
            : queue.find(p => p.playerIndex === playerIndex && p.scrollName === scrollName);
        if (existing) {
            // Keep the more complete definition if the echo carries one
            if (!existing.definition && definition) {
                existing.definition = definition;
            }
            console.warn(`📜 addPendingBuff: skipped duplicate ${kind} entry for player ${playerIndex}: ${scrollName} (eventId=${eventId || 'none'})`);
            return false;
        }
        queue.push({ playerIndex, scrollName, definition, eventId });
        console.log(`📜 addPendingBuff: queued ${kind} activation for player ${playerIndex}: ${scrollName} (eventId=${eventId || 'none'})`);
        return true;
    },

    // Remove a pending entry that another client just consumed (replayed at the
    // start of the owner's turn). Only one client runs processPsychicPending/
    // processReflectPending per turn change; every other client clears its copy
    // here when the psychic/reflect-triggered broadcast arrives, so queues stay
    // in sync and a later consumer (e.g. after a disconnect changes which client
    // processes the turn change) cannot replay long-consumed entries.
    removePendingBuff(kind, playerIndex, scrollName, eventId = null) {
        const key = kind === 'psychic' ? 'psychicPending' : 'reflectPending';
        const queue = this.activeBuffs[key];
        if (!Array.isArray(queue) || queue.length === 0) return;
        let idx = eventId ? queue.findIndex(p => p.eventId === eventId) : -1;
        if (idx === -1) {
            idx = queue.findIndex(p => p.playerIndex === playerIndex && p.scrollName === scrollName);
        }
        if (idx !== -1) {
            queue.splice(idx, 1);
            console.log(`📜 removePendingBuff: cleared consumed ${kind} entry for player ${playerIndex}: ${scrollName}`);
        }
    },

    // At start of a player's turn: if they have pending Reflects, run all stored scrolls and count as water activation.
    // Returns array of { triggered: true, playerIndex, scrollName, definition } for all reflects processed so caller can broadcast.
    // Interactive scrolls (requiresSelection) are chained sequentially via onComplete callbacks.
    // onAllComplete: optional callback fired after the last reflect fully resolves.
    // Use this to chain processPsychicPending after all reflects finish.
    processReflectPending(playerIndex, onAllComplete) {
        const pendingArray = this.activeBuffs.reflectPending;
        if (!Array.isArray(pendingArray) || pendingArray.length === 0) {
            if (typeof onAllComplete === 'function') onAllComplete();
            return null;
        }

        // Filter to only this player's reflects
        const myReflects = pendingArray.filter(p => p.playerIndex === playerIndex);
        if (myReflects.length === 0) {
            if (typeof onAllComplete === 'function') onAllComplete();
            return null;
        }

        console.log(`🪞 processReflectPending for player ${playerIndex}: ${myReflects.length} reflects queued:`, myReflects.map(r => r.scrollName));

        // Remove this player's reflects from the array
        this.activeBuffs.reflectPending = pendingArray.filter(p => p.playerIndex !== playerIndex);

        const results = [];
        let waterActivated = false;
        const self = this;

        // Store original active player so we can restore it after interactive selections
        const originalActivePlayer = (typeof activePlayerIndex !== 'undefined') ? activePlayerIndex : null;

        // Run each pending reflect one at a time. Interactive scrolls (requiresSelection) chain
        // via onComplete so they fully resolve before the next one starts.
        // When all are done, calls onAllComplete so Psychic (or other follow-up) can begin.
        const runNext = (index) => {
            if (index >= myReflects.length) {
                // All reflects finished — fire the completion callback (starts Psychic, etc.)
                if (typeof onAllComplete === 'function') onAllComplete();
                return;
            }

            const pending = myReflects[index];
            console.log(`🪞 Processing reflect #${index + 1}/${myReflects.length}: ${pending.scrollName}`);
            const scrollName = pending.scrollName;
            const definition = pending.definition;
            const displayName = definition?.name || scrollName;
            updateStatus(`Reflect triggers: activating ${displayName}!`);
            // Record for the Game Log — the deferred trigger fires at the
            // start of the caster's OWN turn (not when Reflect was cast), so
            // without this it's easy to miss entirely: the transient status
            // line above gets overwritten within the same tick by the rest
            // of the turn-start sequence (AP reset, "Your turn!", etc.).
            if (typeof window !== 'undefined' && window.logScrollEvent) {
                window.logScrollEvent('reflect_triggered', { casterIndex: playerIndex, scrollName });
            }

            // Broadcast reflect-triggered for this scroll immediately before executing,
            // so remote clients receive them in order and can queue them sequentially.
            if (typeof isMultiplayer !== 'undefined' && isMultiplayer && typeof broadcastGameAction === 'function') {
                const fullDef = definition?.element ? definition : (self.spellSystem?.patterns?.[scrollName] || definition);
                broadcastGameAction('reflect-triggered', {
                    playerIndex: playerIndex,
                    scrollName: scrollName,
                    eventId: pending.eventId || null,
                    element: fullDef?.element,
                    elements: fullDef?.element === 'catacomb' ? fullDef?.patterns?.[0]?.map(p => p.type) : null,
                    isCatacomb: fullDef?.element === 'catacomb'
                });
            }

            // Run the reflected scroll's ability with full context.
            // On non-caster clients, pass psychicRemoteClient=true so interactive scrolls
            // (e.g. Shifting Sands tile-swap) skip their UI — the caster's client handles
            // selection and syncs state via broadcast.
            //
            // myPlayerIndex is not reliable here: this whole call can run from
            // INSIDE a bot's own end-turn (bot-driver.js's asBot() impersonates
            // the bot for its entire turn, including clicking #end-turn, which is
            // exactly what fires processReflectPending for the INCOMING player).
            // When a bot hands off to the real human, myPlayerIndex is still the
            // bot's index at this point — not reverted until asBot()'s finally
            // block runs, well after this call returns (driveBotTurn's own
            // post-asBot() AP-reset fixup exists for this identical gap). That
            // made every reflected scroll needing a UI (Heavy Stomp, Create,
            // Shifting Sands, Scholar's Insight, ...) look like "nothing
            // happened": this client wrongly saw itself as a remote bystander
            // and silently skipped — but in a bot-only game this IS the only
            // real client, so no one else ever picks up the broadcast either.
            // Resolve through BotDriver.driverRealIndex() when impersonating,
            // same fallback multiplayer-state.js's 'response-resolved' listener
            // already uses for this exact ambiguity.
            const _reflectDriverIdx = (typeof window !== 'undefined' && window.BotDriver
                && typeof window.BotDriver.driverRealIndex === 'function'
                && window.BotDriver.driverRealIndex() != null)
                ? window.BotDriver.driverRealIndex()
                : (typeof myPlayerIndex !== 'undefined' ? myPlayerIndex : undefined);
            const isReflectCaster = (typeof _reflectDriverIdx === 'undefined' || _reflectDriverIdx === null || _reflectDriverIdx === playerIndex);
            const result = self.execute(scrollName, playerIndex, {
                spell: definition,
                scrollName,
                psychicRemoteClient: !isReflectCaster,
                onComplete: () => {
                    // Restore activePlayerIndex after interactive selection resolves
                    if (originalActivePlayer !== null && typeof activePlayerIndex !== 'undefined') {
                        activePlayerIndex = originalActivePlayer;
                    }
                    if (typeof syncPlayerState === 'function') syncPlayerState();
                    runNext(index + 1);
                }
            });

            // Restore activePlayerIndex immediately for non-interactive scrolls
            if (!result?.requiresSelection) {
                if (originalActivePlayer !== null && typeof activePlayerIndex !== 'undefined') {
                    activePlayerIndex = originalActivePlayer;
                }
            }

            // Only mark water as activated ONCE (even if multiple reflects trigger)
            if (result.success && self.spellSystem && !waterActivated) {
                self.spellSystem.ensurePlayerScrollsStructure(playerIndex);
                const activated = self.spellSystem.playerScrolls[playerIndex].activated;
                activated.add('water');
                waterActivated = true;
                console.log(`🪞 processReflectPending activated water for player ${playerIndex}:`, Array.from(activated));
                if (typeof updatePlayerElementSymbols === 'function') {
                    updatePlayerElementSymbols(playerIndex);
                }
                // Win check: if water was the reflecting player's 5th element
                // and they're already standing on their own shrine, this needs
                // checking NOW, not later. The usual place this happens
                // (lobby.js's reflect-triggered broadcast RECEIVER) never runs
                // in a single-host bot game — the sender's own gameChannel is
                // broadcast:{self:false}, so a bot-only room (host is the only
                // real client) never receives its own broadcast back, and the
                // win would otherwise sit undetected until the player's next
                // move happens to re-trigger it. checkWinCondition is a pure
                // read (idempotent, no side effect beyond the win UI it's
                // meant to trigger), so calling it defensively here alongside
                // the receiver's own call is safe — same reasoning as the
                // other "doesn't receive its own broadcast" checks elsewhere
                // in this codebase (see multiplayer-state.js's response
                // handler and lobby.js's counter-caster branch).
                if (typeof checkWinCondition === 'function') {
                    checkWinCondition(playerIndex, { announce: true });
                }
            }

            const fullDef = definition?.element ? definition : (self.spellSystem?.patterns?.[scrollName] || definition);
            results.push({ triggered: true, playerIndex, scrollName, definition: fullDef });

            // For non-interactive scrolls, immediately advance to the next
            if (!result?.requiresSelection) {
                if (typeof syncPlayerState === 'function') syncPlayerState();
                runNext(index + 1);
            }
            // Interactive scrolls will call runNext via onComplete when the player finishes
        };

        runNext(0);

        return results.length > 0 ? results : null;
    },

    // At start of a player's turn: if they have pending Psychics, run all stolen scrolls and count as void activation.
    // Returns array of { triggered: true, playerIndex, scrollName, definition } for all psychics processed so caller can broadcast.
    // Interactive scrolls (requiresSelection) are chained sequentially via onComplete callbacks.
    processPsychicPending(playerIndex) {
        const pendingArray = this.activeBuffs.psychicPending;
        if (!Array.isArray(pendingArray) || pendingArray.length === 0) return null;

        // Filter to only this player's psychics
        const myPsychics = pendingArray.filter(p => p.playerIndex === playerIndex);
        if (myPsychics.length === 0) return null;

        console.log(`🔮 processPsychicPending for player ${playerIndex}: ${myPsychics.length} psychics queued:`, myPsychics.map(r => r.scrollName));

        // Remove this player's psychics from the array
        this.activeBuffs.psychicPending = pendingArray.filter(p => p.playerIndex !== playerIndex);

        const results = [];
        let voidActivated = false;
        const self = this;

        // Run each pending psychic scroll one at a time. If the scroll is interactive
        // (requiresSelection), the next one only starts after the player finishes the
        // selection (via the onComplete callback). Non-interactive scrolls run immediately
        // and advance to the next in the same tick.
        const runNext = (index) => {
            if (index >= myPsychics.length) return; // All done

            const pending = myPsychics[index];
            console.log(`🔮 Processing psychic #${index + 1}/${myPsychics.length}: ${pending.scrollName}`);
            const scrollName = pending.scrollName;
            const definition = pending.definition;
            const displayName = definition?.name || scrollName;
            updateStatus(`Psychic triggers: activating ${displayName}!`);
            // Record for the Game Log — same reasoning as Reflect's identical
            // call above: the deferred trigger fires at the start of the
            // caster's OWN turn, and the transient status line gets
            // overwritten within the same tick by the rest of turn-start.
            if (typeof window !== 'undefined' && window.logScrollEvent) {
                window.logScrollEvent('psychic_triggered', { casterIndex: playerIndex, scrollName });
            }

            const fullDef = definition?.element ? definition : (self.spellSystem?.patterns?.[scrollName] || definition);

            // Broadcast this trigger to remote clients immediately (before interactive selection starts)
            // so they can queue it on their side. This replaces the broadcast loop in game-ui.js.
            if (typeof isMultiplayer !== 'undefined' && isMultiplayer && typeof broadcastGameAction === 'function') {
                broadcastGameAction('psychic-triggered', {
                    playerIndex,
                    scrollName,
                    eventId: pending.eventId || null,
                    element: fullDef?.element,
                    elements: fullDef?.element === 'catacomb' ? fullDef?.patterns?.[0]?.map(p => p.type) : null,
                    isCatacomb: fullDef?.element === 'catacomb'
                });
            }

            // CRITICAL: Temporarily set activePlayerIndex to the Psychic caster
            // so the stolen scroll executes with the correct player context
            const originalActivePlayer = typeof activePlayerIndex !== 'undefined' ? activePlayerIndex : null;
            if (typeof activePlayerIndex !== 'undefined') {
                activePlayerIndex = playerIndex;
            }

            // Run the stolen scroll's ability (with flag to prevent marking its elements as activated)
            // Pass onComplete so interactive scrolls (e.g. Heavy Stomp) can chain the next one
            const result = self.execute(scrollName, playerIndex, {
                spell: definition,
                scrollName,
                skipActivationTracking: true,  // Only void counts toward win condition
                onComplete: () => {
                    // Restore activePlayerIndex after interactive selection resolves
                    if (originalActivePlayer !== null && typeof activePlayerIndex !== 'undefined') {
                        activePlayerIndex = originalActivePlayer;
                    }
                    if (typeof syncPlayerState === 'function') syncPlayerState();
                    runNext(index + 1);
                }
            });

            // Restore activePlayerIndex immediately for non-interactive scrolls
            // (interactive ones restore it inside the onComplete callback above)
            if (!result?.requiresSelection) {
                if (originalActivePlayer !== null && typeof activePlayerIndex !== 'undefined') {
                    activePlayerIndex = originalActivePlayer;
                }
            }

            // Only mark void as activated ONCE (even if multiple psychics trigger)
            if (result.success && self.spellSystem && !voidActivated) {
                self.spellSystem.ensurePlayerScrollsStructure(playerIndex);
                const activated = self.spellSystem.playerScrolls[playerIndex].activated;
                activated.add('void');
                voidActivated = true;
                console.log(`🔮 processPsychicPending activated void for player ${playerIndex}:`, Array.from(activated));
                if (typeof updatePlayerElementSymbols === 'function') {
                    updatePlayerElementSymbols(playerIndex);
                }
                // Win check — same reasoning as processReflectPending's
                // identical call: the usual place this happens (lobby.js's
                // psychic-triggered broadcast receiver) never runs in a
                // single-host bot game, since that room's only real client
                // never receives its own broadcast back.
                if (typeof checkWinCondition === 'function') {
                    checkWinCondition(playerIndex, { announce: true });
                }
            }

            results.push({ triggered: true, playerIndex, scrollName, definition: fullDef });

            // For non-interactive scrolls, immediately advance to the next
            if (!result?.requiresSelection) {
                if (typeof syncPlayerState === 'function') syncPlayerState();
                runNext(index + 1);
            }
            // Interactive scrolls will call runNext via onComplete when the player finishes
        };

        runNext(0);

        return results.length > 0 ? results : null;
    },

    // ============================================
    // WATER SCROLL MODES
    // ============================================

    // Water V - Control the Current: This turn, transform water stones that are adjacent to you (no Done button; eligibility updates when you move)
    enterWaterTransformMode(casterIndex, completionPayload) {
        const self = this;

        const playerPos = typeof playerPositions !== 'undefined' ? playerPositions[casterIndex] : (typeof playerPosition !== 'undefined' ? playerPosition : null);
        if (!playerPos) {
            updateStatus('Cannot find player position!');
            return;
        }

        const initialAdjacent = this.getAdjacentWaterStones(playerPos, casterIndex);
        this.highlightStones(initialAdjacent, '#5894f4');

        this.selectionMode = {
            type: 'water-transform',
            casterIndex: casterIndex,
            highlightedStones: initialAdjacent,
            completionPayload: completionPayload || null,

            handleStoneClick(stone) {
                if (stone.type !== 'water') {
                    updateStatus('Only water stones can be transformed.');
                    return;
                }
                const pos = typeof playerPositions !== 'undefined' ? playerPositions[self.selectionMode.casterIndex] : (typeof playerPosition !== 'undefined' ? playerPosition : null);
                if (!pos) return;
                if (!self.isStoneAdjacentToPosition(stone.x, stone.y, pos.x, pos.y)) {
                    updateStatus('That water stone is not adjacent to you. Move next to it to transform it.');
                    return;
                }
                self.showWaterTransformPopup(stone, self.selectionMode.casterIndex, () => {
                    self.refreshWaterTransformHighlights();
                });
            },

            cleanup() {
                // Unhighlight tracked stones
                if (self.selectionMode && self.selectionMode.highlightedStones) {
                    self.selectionMode.highlightedStones.forEach(s => self.unhighlightStone(s));
                }
                // Safety sweep: clear the stonePulse animation from any stone circle
                // that slipped through (stale tracking, moved player, destroyed stones, etc.)
                if (typeof placedStones !== 'undefined') {
                    placedStones.forEach(s => {
                        if (!s.element) return;
                        const circle = s.element.querySelector('circle');
                        if (circle && circle.style.animation && circle.style.animation.includes('stonePulse')) {
                            self.unhighlightStone(s);
                        }
                    });
                }
            }
        };

        updateStatus('Control the Current: transform adjacent water stones this turn. Move next to water stones to transform them.');
    },

    // Update which stones are highlighted based on current player position (call after move or after a transform)
    refreshWaterTransformHighlights() {
        if (!this.selectionMode || this.selectionMode.type !== 'water-transform') return;
        const casterIndex = this.selectionMode.casterIndex;
        const playerPos = typeof playerPositions !== 'undefined' ? playerPositions[casterIndex] : (typeof playerPosition !== 'undefined' ? playerPosition : null);
        if (!playerPos) return;
        const prev = this.selectionMode.highlightedStones || [];
        prev.forEach(s => this.unhighlightStone(s));
        const next = this.getAdjacentWaterStones(playerPos, casterIndex);
        this.highlightStones(next, '#5894f4');
        this.selectionMode.highlightedStones = next;
    },

    // Get water stones adjacent to player (same rule as break/place: exactly one hex step away)
    getAdjacentWaterStones(playerPos, playerIndex) {
        if (typeof placedStones === 'undefined') return [];

        return placedStones.filter(stone => {
            if (stone.type !== 'water') return false;
            return this.isStoneAdjacentToPosition(stone.x, stone.y, playerPos.x, playerPos.y);
        });
    },

    // Same hex-adjacency logic as game-core isAdjacentToPlayer (one hex step only)
    isStoneAdjacentToPosition(stoneX, stoneY, playerX, playerY) {
        const tileSize = typeof TILE_SIZE !== 'undefined' ? TILE_SIZE : 20;
        const playerHex = this.pixelToHex(playerX, playerY, tileSize);
        const targetHex = this.pixelToHex(stoneX, stoneY, tileSize);
        const dq = Math.abs(playerHex.q - targetHex.q);
        const dr = Math.abs(playerHex.r - targetHex.r);
        const ds = Math.abs((-playerHex.q - playerHex.r) - (-targetHex.q - targetHex.r));
        const hexDistance = Math.max(dq, dr, ds);
        return hexDistance === 1;
    },

    pixelToHex(x, y, s) {
        const q = (x * Math.sqrt(3) / 3 - y / 3) / s;
        const r = (y * 2 / 3) / s;
        return this.hexRound(q, r);
    },

    hexRound(q, r) {
        const s = -q - r;
        let rq = Math.round(q);
        let rr = Math.round(r);
        const rs = Math.round(s);
        const qDiff = Math.abs(rq - q);
        const rDiff = Math.abs(rr - r);
        const sDiff = Math.abs(rs - s);
        if (qDiff > rDiff && qDiff > sDiff) rq = -rr - rs;
        else if (rDiff > sDiff) rr = -rq - rs;
        return { q: rq, r: rr };
    },

    // Show popup to transform water stone
    showWaterTransformPopup(stone, casterIndex, onComplete) {
        const existing = document.getElementById('water-transform-modal');
        if (existing) existing.remove();

        const overlay = document.createElement('div');
        overlay.id = 'water-transform-modal';
        styleDecisionOverlay(overlay);

        const modal = document.createElement('div');
        Object.assign(modal.style, {
            backgroundColor: '#1a1a2e',
            border: '2px solid #5894f4',
            borderRadius: '10px',
            padding: '20px',
            color: 'white',
            minWidth: '300px'
        });

        const titleEl = document.createElement('h3');
        titleEl.textContent = 'Transform Water Stone';
        titleEl.style.marginBottom = '10px';
        titleEl.style.textAlign = 'center';
        modal.appendChild(titleEl);
        makeDecisionModalMovable(modal, titleEl, overlay);

        const descEl = document.createElement('p');
        descEl.textContent = 'Choose an element to transform this water stone into:';
        descEl.style.marginBottom = '15px';
        descEl.style.fontSize = '14px';
        descEl.style.color = '#bdc3c7';
        modal.appendChild(descEl);

        const elements = ['earth', 'fire', 'wind', 'void']; // Not water - we're transforming FROM water
        const elementColors = {
            earth: '#69d83a',
            fire: '#ed1b43',
            wind: '#ffce00',
            void: '#9458f4'
        };

        elements.forEach(element => {
            // Check if source pool has stones available
            const available = typeof stonePools !== 'undefined' ? (stonePools[element] || 0) : 0;

            const btn = document.createElement('button');
            btn.textContent = available > 0
                ? `${element.charAt(0).toUpperCase() + element.slice(1)} (${available} available)`
                : `${element.charAt(0).toUpperCase() + element.slice(1)} (source pool empty)`;
            btn.disabled = available <= 0;
            Object.assign(btn.style, {
                display: 'block',
                width: '100%',
                padding: '12px',
                margin: '8px 0',
                backgroundColor: available > 0 ? '#2d2d44' : '#1a1a1a',
                color: available > 0 ? elementColors[element] : '#555',
                border: `2px solid ${available > 0 ? elementColors[element] : '#333'}`,
                borderRadius: '5px',
                cursor: available > 0 ? 'pointer' : 'not-allowed',
                fontSize: '14px',
                fontWeight: 'bold'
            });

            if (available > 0) {
                btn.onmouseenter = () => btn.style.backgroundColor = '#3d3d54';
                btn.onmouseleave = () => btn.style.backgroundColor = '#2d2d44';
                btn.onclick = () => {
                    overlay.remove();
                    this.transformWaterStone(stone, element, casterIndex);
                    if (onComplete) onComplete();
                };
            }
            modal.appendChild(btn);
        });

        const cancelBtn = document.createElement('button');
        cancelBtn.textContent = 'Cancel';
        Object.assign(cancelBtn.style, {
            marginTop: '15px',
            padding: '10px 20px',
            backgroundColor: '#7f8c8d',
            color: 'white',
            border: 'none',
            borderRadius: '5px',
            cursor: 'pointer',
            width: '100%'
        });
        cancelBtn.onclick = () => overlay.remove();
        modal.appendChild(cancelBtn);

        overlay.appendChild(modal);
        document.body.appendChild(overlay);
    },

    // Transform a water stone into another element
    transformWaterStone(stone, newElement, casterIndex) {
        // Return water stone to source pool
        if (typeof stonePools !== 'undefined') {
            stonePools.water = (stonePools.water || 0) + 1;
        }

        // Take stone from new element's source pool
        if (typeof stonePools !== 'undefined') {
            stonePools[newElement] = (stonePools[newElement] || 0) - 1;
        }

        // Refresh HUD so pool counts reflect the swap immediately
        if (typeof updateStoneCount === 'function') {
            updateStoneCount('water');
            updateStoneCount(newElement);
        }

        // Update the stone's type and visual
        stone.type = newElement;

        // Remove any water stone indicators (mimicry/chain rings) before transformation
        if (stone.element) {
            const mimicryIndicator = stone.element.querySelector('.mimicry-indicator');
            if (mimicryIndicator) {
                mimicryIndicator.remove();
            }
            const chainIndicator = stone.element.querySelector('.chain-indicator');
            if (chainIndicator) {
                chainIndicator.remove();
            }
        }

        // Update the stone's visual appearance — re-render as the new element type
        if (stone.element && typeof STONE_TYPES !== 'undefined' && STONE_TYPES[newElement]) {
            const newColor = STONE_TYPES[newElement].color;
            const circle = stone.element.querySelector('circle');
            if (circle) {
                const darkFill = typeof darkenHex === 'function'
                    ? darkenHex(newColor, 0.55)
                    : newColor;
                circle.setAttribute('fill', darkFill);
                circle.setAttribute('stroke', newColor);
            }
            const stoneImg = stone.element.querySelector('image');
            if (stoneImg) {
                stoneImg.setAttribute('href', STONE_TYPES[newElement].img);
            }
        }

        // Trigger fire destruction, void nullification, and water mimicry refresh
        if (typeof window.applyStoneInteractionsAfterTransform === 'function') {
            window.applyStoneInteractionsAfterTransform(stone.x, stone.y, newElement);
        }

        updateStatus(`Transformed water stone into ${newElement}!`);

        // Broadcast in multiplayer
        if (typeof isMultiplayer !== 'undefined' && isMultiplayer && typeof broadcastGameAction === 'function') {
            broadcastGameAction('water-stone-transformed', {
                stoneX: stone.x,
                stoneY: stone.y,
                newElement: newElement
            });
        }

        // Signal completion to trigger win condition broadcast
        // Note: Control the Current allows multiple transforms per turn, so we call this after each transform
        // The win condition is only activated once (when the scroll is first cast), but we need to broadcast it
        if (this.selectionMode && this.selectionMode.completionPayload) {
            const payload = this.selectionMode.completionPayload;
            if (this.spellSystem && typeof this.spellSystem.onSelectionEffectComplete === 'function') {
                this.spellSystem.onSelectionEffectComplete(payload.scrollName, payload.effectName, payload.spell);
            }
        }
    },

    // Highlight stones with click handlers
    highlightStones(stones, color) {
        stones.forEach(stone => this.highlightStone(stone, color));
    },

    highlightStone(stone, color) {
        if (!stone.element) return;
        const circle = stone.element.querySelector('circle');
        if (circle) {
            circle.setAttribute('data-original-stroke', circle.getAttribute('stroke') || 'none');
            circle.setAttribute('data-original-stroke-width', circle.getAttribute('stroke-width') || '0');
            circle.setAttribute('stroke', color);
            circle.setAttribute('stroke-width', '4');

            // Add pulsing animation class
            circle.style.animation = 'stonePulse 1s ease-in-out infinite';

            // Make clickable with cursor change
            stone.element.style.cursor = 'pointer';
            stone.element.style.pointerEvents = 'all';

            // Add direct click handler to stone element for more reliable clicking
            const self = this;
            stone._clickHandler = function(e) {
                e.preventDefault();
                e.stopPropagation();
                if (self.selectionMode && self.selectionMode.handleStoneClick) {
                    self.selectionMode.handleStoneClick(stone);
                }
            };
            stone.element.addEventListener('click', stone._clickHandler);

            // Also handle touch for mobile
            stone._touchHandler = function(e) {
                e.preventDefault();
                if (self.selectionMode && self.selectionMode.handleStoneClick) {
                    self.selectionMode.handleStoneClick(stone);
                }
            };
            stone.element.addEventListener('touchend', stone._touchHandler);
        }

        // Add pulse animation if not already in DOM
        if (!document.getElementById('stone-pulse-style')) {
            const style = document.createElement('style');
            style.id = 'stone-pulse-style';
            style.textContent = `
                @keyframes stonePulse {
                    0%, 100% { stroke-width: 4px; opacity: 1; }
                    50% { stroke-width: 6px; opacity: 0.8; }
                }
            `;
            document.head.appendChild(style);
        }
    },

    unhighlightStone(stone) {
        if (!stone.element) return;
        const circle = stone.element.querySelector('circle');
        if (circle) {
            const origStroke = circle.getAttribute('data-original-stroke') || 'none';
            const origWidth = circle.getAttribute('data-original-stroke-width') || '0';
            circle.setAttribute('stroke', origStroke);
            circle.setAttribute('stroke-width', origWidth);
            circle.style.animation = '';
        }

        // Remove click handlers
        if (stone._clickHandler) {
            stone.element.removeEventListener('click', stone._clickHandler);
            delete stone._clickHandler;
        }
        if (stone._touchHandler) {
            stone.element.removeEventListener('touchend', stone._touchHandler);
            delete stone._touchHandler;
        }

        // Reset cursor
        stone.element.style.cursor = '';
        stone.element.style.pointerEvents = '';
    },

    // Water III - Inspiring Draught: Select 1 deck, draw 2, keep 1, put 1 back and shuffle.
    enterInspiringDraughtMode(casterIndex, context) {
        const spellSystem = this.spellSystem;
        if (!spellSystem) return;

        const notifyComplete = () => {
            if (context?.spell && typeof spellSystem.onSelectionEffectComplete === 'function') {
                spellSystem.onSelectionEffectComplete(context.scrollName, 'Inspiring Draught', context.spell);
            }
            // Advance Psychic queue (and any other onComplete chain) now that selection is done
            if (typeof context?.onComplete === 'function') {
                context.onComplete();
            }
        };

        // Helper: broadcast a kept scroll to other clients so the host's state stays in sync.
        // Without this, the 3-second scroll-state-sync would overwrite the non-host player's
        // hand with the host's stale snapshot (which doesn't include the newly drawn scroll).
        const broadcastKept = (scrollName, deckType) => {
            if (typeof isMultiplayer !== 'undefined' && isMultiplayer && typeof broadcastGameAction === 'function') {
                broadcastGameAction('scroll-collected', {
                    playerIndex: casterIndex,
                    scrollName,
                    shrineType: deckType
                });
            }
        };

        this.showDeckSelectionModal(1, (selectedDecks) => {
            if (!selectedDecks || selectedDecks.length === 0) {
                updateStatus('No deck selected.');
                notifyComplete();
                return;
            }
            const deckType = selectedDecks[0];
            const deck = spellSystem.scrollDecks?.[deckType];
            if (!deck || deck.length === 0) {
                updateStatus('That deck has no scrolls!');
                notifyComplete();
                return;
            }

            // Draw up to 2 — don't add to hand yet
            const drawnScrolls = [];
            for (let i = 0; i < 2 && deck.length > 0; i++) {
                drawnScrolls.push(deck.pop());
            }

            if (drawnScrolls.length === 0) {
                updateStatus('No scrolls available to draw!');
                notifyComplete();
                return;
            }

            const elementName = deckType.charAt(0).toUpperCase() + deckType.slice(1);

            // Only drew 1 — keep it automatically
            if (drawnScrolls.length === 1) {
                this.ensurePlayerScrollsStructure(casterIndex);
                spellSystem.playerScrolls[casterIndex].hand.add(drawnScrolls[0]);
                updateStatus(`Drew 1 ${elementName} scroll (kept it).`);
                if (spellSystem.updateScrollCount) spellSystem.updateScrollCount();
                broadcastKept(drawnScrolls[0], deckType);
                notifyComplete();
                return;
            }

            // Drew 2 — show modal to choose which to put back
            this.showScrollSelectionModal(
                drawnScrolls,
                `Choose one ${elementName} scroll to put back (the other goes to your hand):`,
                (selectedToReturn) => {
                    this.ensurePlayerScrollsStructure(casterIndex);
                    const playerScrolls = spellSystem.playerScrolls[casterIndex];
                    let keptScroll = null;
                    drawnScrolls.forEach(scroll => {
                        if (scroll === selectedToReturn) {
                            spellSystem.scrollDecks[deckType].push(scroll);
                            this.shuffleDeck(spellSystem.scrollDecks[deckType]);
                        } else {
                            playerScrolls.hand.add(scroll);
                            keptScroll = scroll;
                        }
                    });
                    updateStatus(`Drew 2 ${elementName} scrolls, put 1 back and shuffled.`);
                    if (spellSystem.updateScrollCount) spellSystem.updateScrollCount();
                    if (keptScroll) broadcastKept(keptScroll, deckType);
                    notifyComplete();
                }
            );
        });
    },

    ensurePlayerScrollsStructure(playerIndex) {
        if (this.spellSystem && typeof this.spellSystem.ensurePlayerScrollsStructure === 'function') {
            this.spellSystem.ensurePlayerScrollsStructure(playerIndex);
        }
    },

    // Generic deck draw mode (e.g. other effects: select N decks, draw 1 from each)
    enterDeckDrawMode(casterIndex, drawCount) {
        const self = this;
        const drawnScrolls = [];
        const deckSources = [];

        this.showDeckSelectionModal(drawCount, (selectedDecks) => {
            selectedDecks.forEach(deckType => {
                if (this.spellSystem?.scrollDecks?.[deckType]?.length > 0) {
                    const scroll = this.spellSystem.scrollDecks[deckType].pop();
                    drawnScrolls.push({ scroll, deckType });
                }
            });

            if (drawnScrolls.length === 0) {
                updateStatus('No scrolls available to draw!');
                return;
            }

            if (drawnScrolls.length === 1) {
                const playerScrolls = this.spellSystem?.playerScrolls?.[casterIndex];
                if (playerScrolls) {
                    this.ensurePlayerScrollsStructure(casterIndex);
                    playerScrolls.hand.add(drawnScrolls[0].scroll);
                }
                updateStatus(`Drew 1 scroll (kept it).`);
                if (this.spellSystem?.updateScrollCount) this.spellSystem.updateScrollCount();
                return;
            }

            this.showScrollSelectionModal(
                drawnScrolls.map(d => d.scroll),
                'Select one scroll to put back:',
                (selectedToReturn) => {
                    const playerScrolls = this.spellSystem?.playerScrolls?.[casterIndex];
                    drawnScrolls.forEach(({ scroll, deckType }) => {
                        if (scroll === selectedToReturn) {
                            this.spellSystem.scrollDecks[deckType].push(scroll);
                            this.shuffleDeck(this.spellSystem.scrollDecks[deckType]);
                        } else {
                            if (playerScrolls) playerScrolls.hand.add(scroll);
                        }
                    });
                    updateStatus('Drew 2 scrolls, put 1 back.');
                    if (this.spellSystem?.updateScrollCount) this.spellSystem.updateScrollCount();
                }
            );
        });
    },

    // Water IV - Wandering River: Change tile element (any non-player tile)
    enterTileElementChangeMode(casterIndex) {
        const self = this;

        // Any tile except player tiles
        const eligibleTiles = this.getEligibleTilesForWanderingRiver();

        if (eligibleTiles.length === 0) {
            updateStatus('No tiles to modify!');
            return;
        }

        this.highlightTiles(eligibleTiles, '#5894f4');

        const cancelBtn = this.createCancelButton('Cancel', () => {
            self.cancelSelectionMode();
        });

        this.selectionMode = {
            type: 'tile-element-change',
            casterIndex: casterIndex,
            eligibleTiles: eligibleTiles,
            cancelBtn: cancelBtn,

            handleTileClick(tile) {
                if (!eligibleTiles.find(t => t.id === tile.id)) {
                    updateStatus('Cannot modify this tile.');
                    return;
                }

                // Show element selection
                self.showElementSelectionModal((selectedElement) => {
                    // Apply temporary element change (affects all players: anyone who reveals draws that element's scroll)
                    self.activeBuffs.wanderingRiver = self.activeBuffs.wanderingRiver || [];
                    const entry = {
                        tileId: tile.id,
                        originalElement: tile.shrineType,
                        newElement: selectedElement,
                        expiresNextTurn: true,
                        playerIndex: casterIndex
                    };
                    self.activeBuffs.wanderingRiver.push(entry);

                    // Visual indicator: tile looks like the chosen element (symbol + color)
                    self.applyWanderingRiverIndicator(tile, selectedElement);

                    // Broadcast so other players see and are affected by the transformation
                    if (typeof isMultiplayer !== 'undefined' && isMultiplayer && typeof broadcastGameAction === 'function') {
                        broadcastGameAction('wandering-river-apply', {
                            tileId: tile.id,
                            newElement: selectedElement,
                            playerIndex: casterIndex
                        });
                    }

                    updateStatus(`Tile now counts as ${selectedElement} until your next turn!`);
                    self.selectionMode.cleanup();
                    self.selectionMode = null;
                });
            },

            cleanup() {
                eligibleTiles.forEach(tile => self.unhighlightTile(tile));
                if (cancelBtn && cancelBtn.parentNode) {
                    cancelBtn.parentNode.removeChild(cancelBtn);
                }
            }
        };

        updateStatus('Select a tile to change its element.');
    },

    // Effective tile element for game logic (Wandering River override)
    getEffectiveTileElement(tile) {
        if (!tile || !this.activeBuffs.wanderingRiver || !Array.isArray(this.activeBuffs.wanderingRiver)) return tile ? tile.shrineType : null;
        const id = Number(tile.id);
        const entry = this.activeBuffs.wanderingRiver.find(e => Number(e.tileId) === id);
        return entry ? entry.newElement : (tile.shrineType || null);
    },

    // Add visual indicator: tile looks like the chosen element (symbol image + color)
    applyWanderingRiverIndicator(tile, newElement) {
        if (!tile || !tile.element) return;
        const stoneTypes = (typeof STONE_TYPES !== 'undefined') ? STONE_TYPES : {};
        const info = stoneTypes[newElement] || { color: '#888', img: null };
        tile.element.classList.add('wandering-river-transformed', 'wandering-river-' + newElement);
        tile.element.setAttribute('data-wandering-river-element', newElement);
        // Also update data-shrine so the elemental hover tint applies
        tile.element.setAttribute('data-shrine', newElement);

        let label = tile.element.querySelector('.wandering-river-label');
        if (label) label.remove();

        // Use the updated stone symbol image instead of a text character
        const imgSrc = info.img || null;
        if (imgSrc) {
            label = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            label.setAttribute('class', 'wandering-river-label');
            // Circular background in element color
            const bg = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            bg.setAttribute('cx', '0'); bg.setAttribute('cy', '-8');
            bg.setAttribute('r', '9');
            bg.setAttribute('fill', info.color);
            bg.setAttribute('opacity', '0.7');
            bg.setAttribute('stroke', '#000'); bg.setAttribute('stroke-width', '1');
            label.appendChild(bg);
            const img = document.createElementNS('http://www.w3.org/2000/svg', 'image');
            img.setAttribute('href', imgSrc);
            img.setAttribute('x', '-9'); img.setAttribute('y', '-17');
            img.setAttribute('width', '18'); img.setAttribute('height', '18');
            img.style.mixBlendMode = newElement === 'catacomb' ? 'normal' : 'screen';
            label.appendChild(img);
        } else {
            // Fallback: text symbol
            label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            label.setAttribute('class', 'wandering-river-label');
            label.setAttribute('x', 0); label.setAttribute('y', -8);
            label.setAttribute('text-anchor', 'middle');
            label.setAttribute('dominant-baseline', 'middle');
            label.setAttribute('fill', info.color);
            label.setAttribute('font-size', '16'); label.setAttribute('font-weight', 'bold');
            label.setAttribute('stroke', '#000'); label.setAttribute('stroke-width', '1');
            label.textContent = newElement.charAt(0).toUpperCase();
        }
        tile.element.appendChild(label);
    },

    // Remove Wandering River indicator when buff expires
    removeWanderingRiverIndicator(tile) {
        if (!tile || !tile.element) return;
        const el = tile.element.getAttribute('data-wandering-river-element');
        if (el) tile.element.classList.remove('wandering-river-' + el);
        tile.element.classList.remove('wandering-river-transformed');
        tile.element.removeAttribute('data-wandering-river-element');
        const label = tile.element.querySelector('.wandering-river-label');
        if (label) label.remove();
        // Restore data-shrine to the tile's actual element
        if (tile.shrineType && tile.shrineType !== 'player') {
            tile.element.setAttribute('data-shrine', tile.shrineType);
        } else {
            tile.element.removeAttribute('data-shrine');
        }
    },

    // Clear Wandering River buffs for a player when their next turn starts
    clearWanderingRiverForPlayer(playerIndex) {
        if (!this.activeBuffs.wanderingRiver || !Array.isArray(this.activeBuffs.wanderingRiver)) return;
        const removed = this.activeBuffs.wanderingRiver.filter(e => e.playerIndex === playerIndex);
        this.activeBuffs.wanderingRiver = this.activeBuffs.wanderingRiver.filter(e => e.playerIndex !== playerIndex);
        if (typeof placedTiles !== 'undefined') {
            removed.forEach(e => {
                const tid = Number(e.tileId);
                const tile = placedTiles.find(t => Number(t.id) === tid);
                if (tile) this.removeWanderingRiverIndicator(tile);
            });
        }
    },

    // ============================================
    // FIRE SCROLL MODES
    // ============================================

    // Fire III - Sacrificial Pyre: Activate scroll from hand ignoring pattern.
    // onComplete: optional — mirrors enterTileFlipMode's pattern so a
    // Reflect/Psychic-chained cast still signals completion (and lets the
    // next queued reflect/psychic run) even on an early "nothing to
    // sacrifice" return, not just after a real selection.
    enterScrollSacrificeMode(casterIndex, onComplete) {
        const self = this;

        // Get player's scrolls
        const playerScrolls = this.spellSystem?.playerScrolls?.[casterIndex];
        if (!playerScrolls || playerScrolls.hand.size === 0) {
            updateStatus('No scrolls to sacrifice!');
            if (typeof onComplete === 'function') onComplete();
            return;
        }

        // Only show the modal on the caster's client (in multiplayer).
        // NOTE: this used to read window.isMultiplayer/window.myPlayerIndex —
        // neither is ever actually assigned on window (isMultiplayer/
        // myPlayerIndex are plain top-level `let`s in multiplayer-state.js,
        // which does NOT create a same-named window property), so that read
        // always came back undefined and this check was permanently inert.
        // Also resolve through BotDriver.driverRealIndex() when this browser
        // is mid-impersonation (driving a bot's turn) — same reasoning as
        // the isReflectCaster check in WATER_SCROLL_1's execute(): the bare
        // myPlayerIndex can be a bot's index here, not the real human
        // driving this browser.
        const _pyreDriverIdx = (typeof window !== 'undefined' && window.BotDriver
            && typeof window.BotDriver.driverRealIndex === 'function'
            && window.BotDriver.driverRealIndex() != null)
            ? window.BotDriver.driverRealIndex()
            : (typeof myPlayerIndex !== 'undefined' ? myPlayerIndex : null);
        const _pyreIsMultiplayer = typeof isMultiplayer !== 'undefined' && isMultiplayer;
        if (_pyreIsMultiplayer && _pyreDriverIdx !== null && casterIndex !== _pyreDriverIdx) {
            console.log(`🔥 Sacrificial Pyre: Skipping modal for non-local player ${casterIndex} (I am player ${_pyreDriverIdx})`);
            if (typeof onComplete === 'function') onComplete();
            return;
        }

        // Level I response/counter scrolls can't be activated this way on your
        // own turn — they have nothing to respond to here. They're only
        // activatable via Sacrificial Pyre during an opponent's response
        // window (see ResponseWindowSystem.showSacrificialPyreResponsePicker),
        // where a real triggering scroll exists for them to act on.
        const scrollArray = Array.from(playerScrolls.hand).filter(s => {
            const d = this.spellSystem?.patterns?.[s];
            return !(d && (d.canCounter === 'any' || d.isResponse === true));
        });
        if (scrollArray.length === 0) {
            updateStatus('No scrolls to sacrifice! (Level I response scrolls can only be activated this way as a response on an opponent\'s turn.)');
            if (typeof onComplete === 'function') onComplete();
            return;
        }
        this.showScrollSelectionModal(scrollArray, 'Select a scroll to sacrifice and activate:', (selectedScroll) => {
            // Remove from hand
            playerScrolls.hand.delete(selectedScroll);

            // Add to common area (not discard) using proper method
            if (this.spellSystem.discardToCommonArea) {
                this.spellSystem.discardToCommonArea(selectedScroll);
            }

            // Get the scroll definition
            const scrollDef = this.spellSystem?.patterns?.[selectedScroll];
            if (!scrollDef) {
                updateStatus(`Error: Could not find scroll definition for ${selectedScroll}`);
                return;
            }

            // Activate the scroll: add stones to pool and track element
            if (scrollDef.element === 'catacomb') {
                // Catacomb scrolls: count how many of each element and add stones
                const elementCounts = {};
                if (scrollDef.patterns && scrollDef.patterns[0]) {
                    scrollDef.patterns[0].forEach(pos => {
                        elementCounts[pos.type] = (elementCounts[pos.type] || 0) + 1;
                    });
                }

                const rewards = [];
                Object.entries(elementCounts).forEach(([element, count]) => {
                    const pools = typeof playerPools !== 'undefined' ? playerPools : [];
                    const poolCaps = typeof playerPoolCapacity !== 'undefined' ? playerPoolCapacity : {};
                    if (pools[casterIndex] && poolCaps) {
                        pools[casterIndex][element] = Math.min(
                            poolCaps[element] || 5,
                            (pools[casterIndex][element] || 0) + count
                        );
                        rewards.push(`+${count} ${element}`);
                    }
                    if (typeof updateStoneCount === 'function') updateStoneCount(element);
                });
                updateStatus(`Sacrificed ${scrollDef.name}! Added ${rewards.join(', ')} stones!`);
            } else {
                // Regular element scrolls: add stones based on level
                const pools = typeof playerPools !== 'undefined' ? playerPools : [];
                const poolCaps = typeof playerPoolCapacity !== 'undefined' ? playerPoolCapacity : {};
                if (pools[casterIndex] && poolCaps) {
                    pools[casterIndex][scrollDef.element] = Math.min(
                        poolCaps[scrollDef.element] || 5,
                        (pools[casterIndex][scrollDef.element] || 0) + scrollDef.level
                    );
                }
                if (typeof updateStoneCount === 'function') updateStoneCount(scrollDef.element);

                updateStatus(`Sacrificed ${scrollDef.name}! Added +${scrollDef.level} ${scrollDef.element} stones!`);
            }

            // NOTE: Only FIRE is marked as activated (from casting Sacrificial Pyre itself)
            // The sacrificed scroll's elements do NOT count toward win condition
            // Fire activation is already handled by the normal executeSpell flow for FIRE_SCROLL_3

            // If the scroll has a special effect, execute it too
            const effect = self.getEffect(selectedScroll);
            if (effect) {
                self.execute(selectedScroll, casterIndex, {});
            }

            // Broadcast stone gains to other players (for resource tracking only, not win condition)
            if (typeof isMultiplayer !== 'undefined' && isMultiplayer && typeof syncPlayerState === 'function') {
                syncPlayerState();
            }

            if (this.spellSystem?.updateScrollCount) {
                this.spellSystem.updateScrollCount();
            }
            if (typeof updateCommonAreaUI === 'function') {
                updateCommonAreaUI();
            }

            // Signal completion (for Reflect/Psychic-chained casts — see the
            // onComplete param note above; enterTileFlipMode does the same).
            if (typeof onComplete === 'function') onComplete();
        }, () => {
            // Cancelled — still signal completion so a Reflect/Psychic chain
            // doesn't hang waiting on a selection that will never come.
            if (typeof onComplete === 'function') onComplete();
        });
    },

        // Fire IV - Combust: Destroy stones on a tile
    enterScorchedEarthMode(casterIndex) {
        const self = this;

        // Get tiles that have stones on them (but not player tiles)
        const tilesWithStones = (typeof placedTiles !== 'undefined' ? placedTiles : []).filter(tile => {
            if (tile.isPlayerTile) return false;
            return this.tileHasStones(tile);
        });

        if (tilesWithStones.length === 0) {
            updateStatus('No tiles with stones to combust!');
            return;
        }

        this.highlightTiles(tilesWithStones, '#ed1b43');

        const cancelBtn = this.createCancelButton('Cancel', () => {
            self.cancelSelectionMode();
        });

        this.selectionMode = {
            type: 'scorched-earth',
            casterIndex: casterIndex,
            eligibleTiles: tilesWithStones,
            cancelBtn: cancelBtn,

            handleTileClick(tile) {
                if (!tilesWithStones.find(t => t.id === tile.id)) {
                    updateStatus('No stones on this tile to destroy.');
                    return;
                }

                // Destroy all stones on this tile
                self.destroyStonesOnTile(tile);
                updateStatus('Combust! All stones on the tile destroyed.');

                self.selectionMode.cleanup();
                self.selectionMode = null;
            },

            cleanup() {
                tilesWithStones.forEach(tile => self.unhighlightTile(tile));
                if (cancelBtn && cancelBtn.parentNode) {
                    cancelBtn.parentNode.removeChild(cancelBtn);
                }
            }
        };

        updateStatus('Select a tile to destroy all stones on it.');
    },

    // Fire IV - Transmute: discard stones/scrolls for AP.
    // context: optional — carries onComplete, called once the modal actually
    // closes (Done, Cancel, or a forced cancelSelectionMode() sweep) via the
    // existing close-observer below, so a Reflect/Psychic-chained cast can
    // advance to the next queued entry once the player is actually done.
    enterTransmuteMode(casterIndex, context) {
        const self = this;
        const overlayId = 'transmute-modal';
        const existing = document.getElementById(overlayId);
        if (existing) existing.remove();

        const pools = typeof playerPools !== 'undefined' ? playerPools : (typeof window !== 'undefined' && window.playerPools);
        const source = typeof stonePools !== 'undefined' ? stonePools : (typeof window !== 'undefined' && window.stonePools);
        const sourceCap = typeof sourcePoolCapacity !== 'undefined' ? sourcePoolCapacity : (typeof window !== 'undefined' && window.sourcePoolCapacity);

        const playerScrolls = this.spellSystem?.playerScrolls?.[casterIndex];
        if (!playerScrolls) {
            updateStatus('Transmute failed: no scroll data for player.');
            return;
        }

        let totalGained = 0;
        const getMaxTotalAP = () => {
            const voidCap = pools?.[casterIndex]?.void || 0;
            return 5 + voidCap;
        };
        const getCurrentTotalAP = () => {
            return (typeof currentAP !== 'undefined' ? currentAP : 0) + (typeof voidAP !== 'undefined' ? voidAP : 0);
        };
        const clampVoidAPToPool = () => {
            if (typeof voidAP === 'undefined' || !pools?.[casterIndex]) return;
            const maxVoid = pools[casterIndex].void || 0;
            const oldVoid = voidAP;
            voidAP = Math.min(voidAP, maxVoid);
            if (oldVoid !== voidAP) {
                const display = document.getElementById('void-ap-display');
                if (display) {
                    if (voidAP > 0) {
                        display.textContent = `(+${voidAP} Void AP)`;
                        display.style.display = 'inline';
                    } else {
                        display.style.display = 'none';
                    }
                }
            }
        };

        const gainAPCapped = (amount) => {
            const maxTotal = getMaxTotalAP();
            const currentTotal = getCurrentTotalAP();
            const room = Math.max(0, maxTotal - currentTotal);
            const gain = Math.min(amount, room);
            if (gain <= 0) {
                updateStatus('Transmute: AP is already at max.');
                return 0;
            }
            if (typeof addAP === 'function') addAP(gain);
            return gain;
        };
        const atMaxAP = () => getCurrentTotalAP() >= getMaxTotalAP();

        const overlay = document.createElement('div');
        overlay.id = overlayId;
        styleDecisionOverlay(overlay);

        const modal = document.createElement('div');
        Object.assign(modal.style, {
            backgroundColor: '#1a1a2e',
            border: '2px solid #ed1b43',
            borderRadius: '10px',
            padding: '20px',
            color: 'white',
            minWidth: '320px',
            maxWidth: '420px'
        });

        const titleEl = document.createElement('h3');
        titleEl.textContent = 'Transmute';
        titleEl.style.marginBottom = '10px';
        titleEl.style.textAlign = 'center';
        titleEl.style.color = '#ed1b43';
        modal.appendChild(titleEl);
        makeDecisionModalMovable(modal, titleEl, overlay);

        const subtitle = document.createElement('div');
        subtitle.textContent = 'Discard stones or scrolls to gain 2 AP each.';
        subtitle.style.color = '#bdc3c7';
        subtitle.style.fontSize = '13px';
        subtitle.style.marginBottom = '10px';
        subtitle.style.textAlign = 'center';
        modal.appendChild(subtitle);

        const gainedEl = document.createElement('div');
        gainedEl.textContent = 'AP gained: 0';
        gainedEl.style.textAlign = 'center';
        gainedEl.style.marginBottom = '10px';
        modal.appendChild(gainedEl);

        const clearSuppress = () => {
            const sup = self.activeBuffs.suppressVoidAPSync;
            if (sup && sup.playerIndex === casterIndex) {
                delete self.activeBuffs.suppressVoidAPSync;
            }
        };

        const updateGained = () => {
            gainedEl.textContent = `AP gained: ${totalGained}`;
        };

        const sectionHeader = (text) => {
            const h = document.createElement('div');
            h.textContent = text;
            h.style.marginTop = '10px';
            h.style.marginBottom = '6px';
            h.style.fontWeight = 'bold';
            h.style.color = '#f39c12';
            return h;
        };

        // Stones
        modal.appendChild(sectionHeader('Stones'));
        const stoneTypes = ['earth', 'water', 'fire', 'wind', 'void'];
        stoneTypes.forEach(type => {
            const count = pools?.[casterIndex]?.[type] || 0;
            const btn = document.createElement('button');
            btn.textContent = `Discard 1 ${type} (${count})`;
            Object.assign(btn.style, {
                display: 'block',
                width: '100%',
                padding: '8px',
                margin: '4px 0',
                backgroundColor: '#2d2d44',
                color: 'white',
                border: '1px solid #444',
                borderRadius: '5px',
                cursor: count > 0 ? 'pointer' : 'not-allowed',
                opacity: count > 0 ? '1' : '0.4'
            });
            btn.onclick = () => {
                const available = pools?.[casterIndex]?.[type] || 0;
                if (atMaxAP()) {
                    updateStatus('Transmute: AP is already at max.');
                    return;
                }
                if (available <= 0) return;
                pools[casterIndex][type] = available - 1;
                if (source && sourceCap && typeof source[type] === 'number') {
                    source[type] = Math.min(sourceCap[type], source[type] + 1);
                }
                if (typeof updateStoneCount === 'function') updateStoneCount(type);
                if (type === 'void') clampVoidAPToPool();
                const gained = gainAPCapped(2);
                totalGained += gained;
                btn.textContent = `Discard 1 ${type} (${pools[casterIndex][type]})`;
                updateGained();
                if (typeof syncPlayerState === 'function') syncPlayerState();
            };
            modal.appendChild(btn);
        });

        // Scrolls
        modal.appendChild(sectionHeader('Scrolls'));
        const renderScrollButtons = (label, scrollSet) => {
            const arr = Array.from(scrollSet || []);
            if (arr.length === 0) {
                const empty = document.createElement('div');
                empty.textContent = `No ${label} scrolls`;
                empty.style.color = '#7f8c8d';
                empty.style.fontSize = '12px';
                empty.style.marginBottom = '4px';
                modal.appendChild(empty);
                return;
            }
            arr.forEach(scrollName => {
                const def = self.spellSystem?.patterns?.[scrollName];
                const btn = document.createElement('button');
                btn.textContent = `Discard ${def?.name || scrollName} (${label})`;
                Object.assign(btn.style, {
                    display: 'block',
                    width: '100%',
                    padding: '8px',
                    margin: '4px 0',
                    backgroundColor: '#2d2d44',
                    color: 'white',
                    border: '1px solid #444',
                    borderRadius: '5px',
                    cursor: 'pointer'
                });
                btn.onclick = () => {
                    if (atMaxAP()) {
                        updateStatus('Transmute: AP is already at max.');
                        return;
                    }
                    if (label === 'hand') playerScrolls.hand.delete(scrollName);
                    if (label === 'active') playerScrolls.active.delete(scrollName);
                    if (self.spellSystem?.discardToCommonArea) {
                        self.spellSystem.discardToCommonArea(scrollName);
                    }
                    if (self.spellSystem?.updateScrollCount) self.spellSystem.updateScrollCount();
                    if (typeof updateCommonAreaUI === 'function') updateCommonAreaUI();
                    const gained = gainAPCapped(2);
                    totalGained += gained;
                    btn.disabled = true;
                    btn.style.opacity = '0.5';
                    updateGained();
                    if (typeof syncPlayerState === 'function') syncPlayerState();
                };
                modal.appendChild(btn);
            });
        };

        renderScrollButtons('hand', playerScrolls.hand);
        renderScrollButtons('active', playerScrolls.active);

        // Done button
        const doneBtn = document.createElement('button');
        doneBtn.textContent = 'Done';
        Object.assign(doneBtn.style, {
            display: 'block',
            width: '100%',
            padding: '10px',
            margin: '10px 0 0 0',
            backgroundColor: '#27ae60',
            color: 'white',
            border: 'none',
            borderRadius: '5px',
            cursor: 'pointer',
            fontSize: '14px'
        });
        // Helper: close the scroll inventory popup (if open) and reopen it to reflect Transmute changes
        const refreshInventoryPopup = () => {
            const openInv = document.getElementById('scroll-inventory-popup');
            if (openInv && self.spellSystem?.showInventory) {
                openInv.remove();
                self.spellSystem.showInventory();
            }
        };

        doneBtn.onclick = () => {
            overlay.remove();
            // Refresh inventory popup so discarded scrolls no longer appear in hand/active lists
            refreshInventoryPopup();
        };
        modal.appendChild(doneBtn);

        // Cancel button
        const cancelBtn = document.createElement('button');
        cancelBtn.textContent = 'Cancel';
        Object.assign(cancelBtn.style, {
            display: 'block',
            width: '100%',
            padding: '10px',
            margin: '8px 0 0 0',
            backgroundColor: '#e74c3c',
            color: 'white',
            border: 'none',
            borderRadius: '5px',
            cursor: 'pointer',
            fontSize: '14px'
        });
        cancelBtn.onclick = () => {
            overlay.remove();
            // Refresh inventory even on Cancel — some items may have been discarded before cancelling
            refreshInventoryPopup();
        };
        modal.appendChild(cancelBtn);

        overlay.appendChild(modal);
        document.body.appendChild(overlay);

        // Cleanup suppress flag when modal closes (Done, Cancel, or a forced
        // cancelSelectionMode() sweep) — and signal completion the same way,
        // so a Reflect/Psychic-chained cast can advance once the player is
        // actually done, not the instant the modal opens.
        const observer = new MutationObserver(() => {
            if (!document.body.contains(overlay)) {
                observer.disconnect();
                clearSuppress();
                if (typeof context?.onComplete === 'function') context.onComplete();
            }
        });
        observer.observe(document.body, { childList: true, subtree: true });
    },

    // Wind IV - Take Flight: Teleport any player to an unoccupied hex of your choice
    enterTakeFlightMode(casterIndex, completionPayload) {
        const self = this;
        const numPlayers = typeof playerPositions !== 'undefined' ? playerPositions.length : 1;

        // Build list of all players (self + opponents, skip Excavate-immune opponents)
        const allPlayers = [];
        for (let i = 0; i < numPlayers; i++) {
            if (i !== casterIndex && this.hasExcavateImmunity(i)) continue;
            allPlayers.push(i);
        }

        if (allPlayers.length === 0) {
            updateStatus('No players to target!');
            return;
        }

        // Step 1: Select target player
        const showPlayerModal = () => {
            const existing = document.getElementById('take-flight-player-modal');
            if (existing) existing.remove();

            const overlay = document.createElement('div');
            overlay.id = 'take-flight-player-modal';
            styleDecisionOverlay(overlay);

            const modal = document.createElement('div');
            Object.assign(modal.style, {
                backgroundColor: '#1a1a2e',
                border: '2px solid #ffce00',
                borderRadius: '10px',
                padding: '20px',
                color: 'white',
                minWidth: '200px'
            });

            const titleEl = document.createElement('h3');
            titleEl.textContent = 'Take Flight: Select a player to teleport';
            titleEl.style.marginBottom = '15px';
            modal.appendChild(titleEl);
            makeDecisionModalMovable(modal, titleEl, overlay);

            allPlayers.forEach(playerIdx => {
                const name = (typeof getPlayerColorName === 'function')
                    ? getPlayerColorName(playerIdx)
                    : `Player ${playerIdx + 1}`;

                const btn = document.createElement('button');
                btn.textContent = playerIdx === casterIndex ? `${name} (you)` : name;
                btn.dataset.playerIndex = String(playerIdx); // bots pick by index (bot-effects.js)
                Object.assign(btn.style, {
                    display: 'block',
                    width: '100%',
                    padding: '10px',
                    margin: '5px 0',
                    backgroundColor: '#2d2d44',
                    color: 'white',
                    border: 'none',
                    borderRadius: '5px',
                    cursor: 'pointer',
                    fontSize: '14px'
                });
                btn.onclick = () => {
                    overlay.remove();
                    enterHexSelectionForPlayer(playerIdx);
                };
                modal.appendChild(btn);
            });

            // Cancel button
            const cancelBtn = document.createElement('button');
            cancelBtn.textContent = 'Cancel';
            Object.assign(cancelBtn.style, {
                display: 'block',
                width: '100%',
                padding: '10px',
                margin: '10px 0 0 0',
                backgroundColor: '#e74c3c',
                color: 'white',
                border: 'none',
                borderRadius: '5px',
                cursor: 'pointer',
                fontSize: '14px'
            });
            cancelBtn.onclick = () => {
                overlay.remove();
                self.cancelSelectionMode();
            };
            modal.appendChild(cancelBtn);

            overlay.appendChild(modal);
            document.body.appendChild(overlay);
        };

        // Step 2: the CHOOSER drags a pawn to a valid hex. Self-target: the
        // caster always chooses (here, directly). Opponent-target: the target
        // chooses instead — in real multiplayer that means handing control to
        // the target's own client (see enterTakeFlightChoiceAsTarget below and
        // the 'take-flight-choose-request' broadcast); outside multiplayer
        // (solo/hotseat, only one client exists) this same client just drives
        // the drag on the target's behalf, same as self-target.
        const enterHexSelectionForPlayer = (targetPlayerIndex) => {
            const targetPlayer = (typeof playerPositions !== 'undefined') ? playerPositions[targetPlayerIndex] : null;
            if (!targetPlayer) {
                updateStatus('Take Flight: target player not found.');
                return;
            }

            const targetName = (typeof getPlayerColorName === 'function')
                ? getPlayerColorName(targetPlayerIndex)
                : `Player ${targetPlayerIndex + 1}`;

            const validDestinations = self.getValidTakeFlightDestinations(targetPlayerIndex);
            if (validDestinations.length === 0) {
                updateStatus(`Take Flight cancelled: no unoccupied hex on a tile occupied by another player exists for ${targetName}.`);
                return;
            }

            // A bot added via the lobby's Add Bot button has no client of its
            // own — THIS client (if it's the host) already drives it via
            // BotDriver's asBot() impersonation. Resolving that case through
            // the broadcast hand-off below would never work: lobby.js's
            // gameChannel is configured with broadcast:{self:false} (it
            // doesn't receive its own sends), so a request this same client
            // sent to itself would never come back. Treat it like a local
            // pick instead — see the driveTakeFlightDrag() call below.
            const targetIsBotIDrive = typeof isHost !== 'undefined' && isHost &&
                typeof isMultiplayer !== 'undefined' && isMultiplayer &&
                typeof window.BotDriver?.isBot === 'function' && window.BotDriver.isBot(targetPlayerIndex);

            const handOffToTarget = !targetIsBotIDrive && targetPlayerIndex !== casterIndex &&
                typeof isMultiplayer !== 'undefined' && isMultiplayer;

            if (handOffToTarget) {
                const cancelBtn = self.createCancelButton('Cancel Take Flight', () => {
                    if (typeof broadcastGameAction === 'function') {
                        broadcastGameAction('take-flight-cancel-request', { casterIndex, targetPlayerIndex });
                    }
                    window.pendingTakeFlightCompletion = null;
                    self.cancelSelectionMode();
                });

                self.selectionMode = {
                    type: 'take-flight-await-remote',
                    casterIndex,
                    targetPlayerIndex,
                    cancelBtn,
                    cleanup() {
                        if (cancelBtn && cancelBtn.parentNode) cancelBtn.parentNode.removeChild(cancelBtn);
                    }
                };

                // Stashed so the 'take-flight' result broadcast we get back
                // (sent by the target once they choose) can finish this
                // effect on OUR side — see lobby.js's 'take-flight' handler.
                window.pendingTakeFlightCompletion = { casterIndex, targetPlayerIndex, completionPayload };

                if (typeof broadcastGameAction === 'function') {
                    broadcastGameAction('take-flight-choose-request', {
                        casterIndex,
                        targetPlayerIndex,
                        scrollName: completionPayload?.scrollName || 'WIND_SCROLL_4'
                    });
                }

                updateStatus(`Take Flight: waiting for ${targetName} to choose where to land...`);
                return;
            }

            self._enterTakeFlightDrag(casterIndex, targetPlayerIndex, targetPlayer, {
                onDone: (destX, destY) => {
                    const scrollName = completionPayload?.scrollName || 'WIND_SCROLL_4';
                    self.finalizeTakeFlightChoice(casterIndex, targetPlayerIndex, scrollName, destX, destY);
                    if (completionPayload && self.spellSystem && typeof self.spellSystem.onSelectionEffectComplete === 'function') {
                        self.spellSystem.onSelectionEffectComplete(completionPayload.scrollName, completionPayload.effectName, completionPayload.spell);
                    }
                },
                onCancelled: () => updateStatus('Take Flight cancelled.')
            });

            // Nobody is going to manually drag a bot's pawn — resolve it
            // immediately via the bot driver instead of sitting in the
            // "drag to choose" state forever. driveSelection() dispatches on
            // selectionMode.type — 'take-flight-drag', just set up above —
            // to bot-effects.js's driveTakeFlightDrag(), which reads
            // window.takeFlightState, rolls a random valid destination, and
            // calls its onComplete (== onDone above) synchronously, so this
            // still goes through the exact same finalize +
            // onSelectionEffectComplete path as a human's own self-target pick.
            if (targetIsBotIDrive && typeof window.BotEffects?.driveSelection === 'function') {
                window.BotEffects.driveSelection();
            }
        };

        showPlayerModal();
    },

    // Shared drag setup for whichever client is actually picking the
    // destination: the caster (self-target, or opponent-target outside real
    // multiplayer) or the target themselves (enterTakeFlightChoiceAsTarget,
    // real-multiplayer opponent-target). The mouseup handler in game-ui.js
    // reads window.takeFlightState and validates drops via
    // isValidTakeFlightDestination() regardless of who set it up.
    // Draws a pulsing indicator (same visual language as the catacomb/
    // Freedom teleport markers — see updateCatacombIndicators in
    // game-ui.js, .teleport-indicator in board.css) on every hex
    // getValidTakeFlightDestinations() allows, and makes each one clickable
    // as a one-click alternative to dragging the pawn. This was the main
    // reason the scroll was hard to use well: the old flow only told the
    // player the destination RULE in a status-line sentence ("an unoccupied
    // hex on a tile occupied by another player") with nothing on the board
    // showing WHICH hexes actually qualify — a genuinely non-obvious set to
    // work out by eye on a multi-tile board. Clicking mirrors the real drop
    // handler's own sequence exactly (game-ui.js's take-flight mouseup
    // branch): move the pawn first, THEN call takeFlightState.onComplete —
    // never just onComplete alone, which does not move the pawn.
    // The current indicator set lives on window.takeFlightState.indicators
    // (not a local closure variable) so both this function's own redraw
    // path and _enterTakeFlightDrag's cleanup() always agree on which
    // elements are live — a redraw (destination invalidated between render
    // and click) replaces that shared list in place rather than losing
    // track of the new set. Requires window.takeFlightState to already
    // exist (see _enterTakeFlightDrag, which sets it up before drawing).
    _showTakeFlightIndicators(targetPlayerIndex) {
        const viewport = document.getElementById('viewport');
        if (window.takeFlightState?.indicators) {
            window.takeFlightState.indicators.forEach(ind => ind.remove());
        }
        if (!viewport || typeof this.getValidTakeFlightDestinations !== 'function') return [];
        const destinations = this.getValidTakeFlightDestinations(targetPlayerIndex);
        const indicators = destinations.map(pos => {
            const indicator = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            indicator.setAttribute('cx', pos.x);
            indicator.setAttribute('cy', pos.y);
            indicator.setAttribute('r', '11');
            indicator.setAttribute('fill', '#ffce00');
            indicator.setAttribute('opacity', '0.55');
            indicator.setAttribute('stroke', '#fff');
            indicator.setAttribute('stroke-width', '2');
            indicator.setAttribute('class', 'teleport-indicator');
            indicator.style.animation = 'catacomb-teleport-pulse 3s ease-in-out infinite';
            indicator.addEventListener('click', e => {
                e.stopPropagation();
                e.preventDefault();
                const tf = window.takeFlightState;
                if (!tf || !tf.active) return;
                // Re-validate fresh — board state may have shifted (a stone
                // placed, a player moved) since the indicator was drawn.
                if (!this.isValidTakeFlightDestination(targetPlayerIndex, pos.x, pos.y)) {
                    updateStatus('Take Flight: that hex is no longer valid - board changed.');
                    tf.indicators = this._showTakeFlightIndicators(targetPlayerIndex); // redraw against current state
                    return;
                }
                if (targetPlayerIndex === activePlayerIndex) {
                    placePlayer(pos.x, pos.y);
                } else if (typeof movePlayerVisually === 'function') {
                    movePlayerVisually(targetPlayerIndex, pos.x, pos.y, 0);
                }
                tf.onComplete(pos.x, pos.y);
            });
            viewport.appendChild(indicator);
            return indicator;
        });
        if (window.takeFlightState) window.takeFlightState.indicators = indicators;
        return indicators;
    },

    _enterTakeFlightDrag(casterIndex, targetPlayerIndex, targetPlayer, { onDone, onCancelled }) {
        const self = this;
        const cancelBtn = this.createCancelButton('Cancel Take Flight', () => {
            if (window.takeFlightState?.onCancel) window.takeFlightState.onCancel();
        });

        const cleanup = () => {
            if (cancelBtn && cancelBtn.parentNode) {
                cancelBtn.parentNode.removeChild(cancelBtn);
            }
            window.takeFlightState?.indicators?.forEach(ind => ind.remove());
            if (window.takeFlightState) {
                window.takeFlightState.active = false;
                window.takeFlightState = null;
            }
            self.selectionMode = null;
        };

        window.takeFlightState = {
            active: true,
            casterIndex,
            targetPlayerIndex,
            indicators: [],
            startPos: { x: targetPlayer.x, y: targetPlayer.y },
            onComplete: (destX, destY) => {
                cleanup();
                if (typeof onDone === 'function') onDone(destX, destY);
            },
            onCancel: () => {
                cleanup();
                if (typeof onCancelled === 'function') onCancelled();
            }
        };
        window.takeFlightState.indicators = this._showTakeFlightIndicators(targetPlayerIndex);

        this.selectionMode = {
            type: 'take-flight-drag',
            casterIndex,
            targetPlayerIndex,
            cancelBtn,
            cleanup
        };

        const targetName = (typeof getPlayerColorName === 'function')
            ? getPlayerColorName(targetPlayerIndex)
            : `Player ${targetPlayerIndex + 1}`;
        updateStatus(`Take Flight: click a glowing hex to teleport ${targetName} there, or drag ${targetName} onto one.`);
    },

    // Runs on the TARGET's own client when a caster targets them for Take
    // Flight in real multiplayer (received via 'take-flight-choose-request' —
    // see lobby.js). Mirrors enterTakeFlightMode's step 2, but here the LOCAL
    // player is the chooser, not the caster.
    enterTakeFlightChoiceAsTarget(casterIndex, targetPlayerIndex, scrollName) {
        const targetPlayer = (typeof playerPositions !== 'undefined') ? playerPositions[targetPlayerIndex] : null;
        if (!targetPlayer) return;

        // Board state could in principle have shifted since the caster's own
        // check (which already gates the "cancel if nothing valid" case) —
        // re-check defensively rather than assume.
        if (this.getValidTakeFlightDestinations(targetPlayerIndex).length === 0) {
            updateStatus('Take Flight: no valid destination available.');
            return;
        }

        this._enterTakeFlightDrag(casterIndex, targetPlayerIndex, targetPlayer, {
            onDone: (destX, destY) => {
                this.finalizeTakeFlightChoice(casterIndex, targetPlayerIndex, scrollName, destX, destY);
            },
            onCancelled: () => {
                updateStatus('Take Flight cancelled.');
                if (typeof isMultiplayer !== 'undefined' && isMultiplayer && typeof broadcastGameAction === 'function') {
                    broadcastGameAction('take-flight-cancel-request', { casterIndex, targetPlayerIndex });
                }
            }
        });
    },

    // Moves the pawn and broadcasts the result. Used by whichever client
    // actually picked the destination. The scroll itself always stays in the
    // caster's active area regardless of who was targeted — no hand/common-area
    // disposition change. Does NOT resolve the caster's onSelectionEffectComplete
    // itself — the self-target caller does that right after calling this; the
    // remote-target case is resolved on the caster's client when this
    // broadcast arrives (see lobby.js's 'take-flight' handler).
    finalizeTakeFlightChoice(casterIndex, targetPlayerIndex, scrollName, destX, destY) {
        const targetName = (typeof getPlayerColorName === 'function')
            ? getPlayerColorName(targetPlayerIndex)
            : `Player ${targetPlayerIndex + 1}`;
        updateStatus(`Take Flight! Teleported ${targetName} to a new location.`);
        console.log(`🌬️ Take Flight: player ${targetPlayerIndex} teleported to (${destX.toFixed(1)}, ${destY.toFixed(1)})`);

        // Broadcast teleport in multiplayer
        if (typeof isMultiplayer !== 'undefined' && isMultiplayer && typeof broadcastGameAction === 'function') {
            broadcastGameAction('take-flight', {
                casterIndex: casterIndex,
                targetPlayerIndex: targetPlayerIndex,
                scrollName: scrollName,
                x: destX,
                y: destY
            });
        }
    },

    // Every unoccupied hex that lies on a tile currently occupied by some
    // OTHER player (not targetPlayerIndex themselves), excluding player tiles
    // and face-down tiles. This is Take Flight's destination rule regardless
    // of who's choosing (self or the target) — also used by game-ui.js's
    // drop-handler validation and by the bot's take-flight driver.
    getValidTakeFlightDestinations(targetPlayerIndex) {
        if (typeof getAllHexagonPositions !== 'function' || typeof playerPositions === 'undefined') return [];
        const hexPositions = getAllHexagonPositions();

        // Tiles with at least one player OTHER than the mover standing on them
        const occupiedTiles = new Set();
        playerPositions.forEach((p, idx) => {
            if (!p || idx === targetPlayerIndex) return;
            const matching = hexPositions.find(pos => {
                const dist = Math.sqrt(Math.pow(pos.x - p.x, 2) + Math.pow(pos.y - p.y, 2));
                return dist < 5;
            });
            if (matching?.tiles) matching.tiles.forEach(t => occupiedTiles.add(t));
        });
        if (occupiedTiles.size === 0) return [];

        return hexPositions.filter(pos => {
            if (!pos.tiles || !pos.tiles.some(t => occupiedTiles.has(t))) return false;
            if (typeof isPositionOnPlayerTile === 'function' && isPositionOnPlayerTile(pos.x, pos.y, hexPositions)) return false;
            if (typeof isPositionOnFlippedTile === 'function' && isPositionOnFlippedTile(pos.x, pos.y, hexPositions)) return false;

            const hasStone = typeof placedStones !== 'undefined' && placedStones.some(s => {
                const dist = Math.sqrt(Math.pow(s.x - pos.x, 2) + Math.pow(s.y - pos.y, 2));
                return dist < 5;
            });
            if (hasStone) return false;

            const hasPlayer = playerPositions.some(p => {
                if (!p) return false;
                const dist = Math.sqrt(Math.pow(p.x - pos.x, 2) + Math.pow(p.y - pos.y, 2));
                return dist < 5;
            });
            if (hasPlayer) return false;

            return true;
        });
    },

    isValidTakeFlightDestination(targetPlayerIndex, x, y) {
        return this.getValidTakeFlightDestinations(targetPlayerIndex).some(pos => {
            const dist = Math.sqrt(Math.pow(pos.x - x, 2) + Math.pow(pos.y - y, 2));
            return dist < 5;
        });
    },

    // Fire V - Arson: Destroy stone from opponent pool
    enterArsonMode(casterIndex, completionPayload = null) {
        const self = this;

        // Get opponents (exclude Excavate-immune players)
        const numPlayers = typeof playerPositions !== 'undefined' ? playerPositions.length : 1;
        const opponents = [];
        for (let i = 0; i < numPlayers; i++) {
            if (i !== casterIndex && !this.hasExcavateImmunity(i)) {
                opponents.push(i);
            }
        }

        if (opponents.length === 0) {
            updateStatus('No opponents to target!');
            return;
        }

        // Show opponent selection modal
        this.showOpponentSelectionModal(opponents, (selectedOpponent) => {
            // Get the stone types this opponent actually has (playerPools is per-player pool from game-core)
            const pools = typeof playerPools !== 'undefined' ? playerPools : (typeof window !== 'undefined' && window.playerPools);
            const opponentStones = pools && pools[selectedOpponent] ? pools[selectedOpponent] : null;
            if (!opponentStones) {
                updateStatus('Cannot access opponent stone pool!');
                return;
            }

            // Filter to only elements the opponent has > 0 stones
            const availableElements = ['earth', 'water', 'fire', 'wind', 'void'].filter(element =>
                opponentStones[element] && opponentStones[element] > 0
            );

            if (availableElements.length === 0) {
                const name = (typeof playerPositions !== 'undefined' && playerPositions[selectedOpponent]?.username)
                    ? playerPositions[selectedOpponent].username
                    : `Player ${selectedOpponent + 1}`;
                updateStatus(`${name} has no stones in their pool to destroy!`);
                return;
            }

            // Show element selection with only available elements
            self.showArsonElementModal(availableElements, opponentStones, (selectedElement) => {
                // Destroy one stone from opponent's pool
                self.destroyOpponentStone(selectedOpponent, selectedElement, completionPayload);
            });
        });
    },

    // Special element modal for Arson that shows only elements the opponent has
    showArsonElementModal(availableElements, opponentStones, onSelect) {
        const existing = document.getElementById('arson-element-modal');
        if (existing) existing.remove();

        const overlay = document.createElement('div');
        overlay.id = 'arson-element-modal';
        styleDecisionOverlay(overlay);

        const modal = document.createElement('div');
        Object.assign(modal.style, {
            backgroundColor: '#1a1a2e',
            border: '2px solid #ed1b43',
            borderRadius: '10px',
            padding: '20px',
            color: 'white',
            minWidth: '280px'
        });

        const titleEl = document.createElement('h3');
        titleEl.textContent = 'Select a stone type to destroy:';
        titleEl.style.marginBottom = '15px';
        titleEl.style.color = '#ed1b43';
        modal.appendChild(titleEl);
        makeDecisionModalMovable(modal, titleEl, overlay);

        const elementColors = {
            earth: '#69d83a',
            water: '#5894f4',
            fire: '#ed1b43',
            wind: '#ffce00',
            void: '#9458f4'
        };

        availableElements.forEach(element => {
            const count = opponentStones[element] || 0;
            const btn = document.createElement('button');
            btn.textContent = `${element.charAt(0).toUpperCase() + element.slice(1)} (${count} in pool)`;
            Object.assign(btn.style, {
                display: 'block',
                width: '100%',
                padding: '12px',
                margin: '8px 0',
                backgroundColor: '#2d2d44',
                color: elementColors[element],
                border: `2px solid ${elementColors[element]}`,
                borderRadius: '5px',
                cursor: 'pointer',
                fontSize: '14px',
                fontWeight: 'bold'
            });
            btn.onmouseenter = () => btn.style.backgroundColor = '#3d3d54';
            btn.onmouseleave = () => btn.style.backgroundColor = '#2d2d44';
            btn.onclick = () => {
                overlay.remove();
                onSelect(element);
            };
            modal.appendChild(btn);
        });

        const cancelBtn = document.createElement('button');
        cancelBtn.textContent = 'Cancel';
        Object.assign(cancelBtn.style, {
            marginTop: '15px',
            padding: '10px 20px',
            backgroundColor: '#7f8c8d',
            color: 'white',
            border: 'none',
            borderRadius: '5px',
            cursor: 'pointer',
            width: '100%'
        });
        cancelBtn.onclick = () => overlay.remove();
        modal.appendChild(cancelBtn);

        overlay.appendChild(modal);
        document.body.appendChild(overlay);
    },

    // ============================================
    // HELPER MODAL FUNCTIONS
    // ============================================

    showScrollSelectionModal(scrollNames, title, onSelect, onCancel, modalId = 'scroll-select-modal') {
        // Remove existing modal
        const existing = document.getElementById(modalId);
        if (existing) existing.remove();

        const overlay = document.createElement('div');
        overlay.id = modalId;
        styleDecisionOverlay(overlay);

        const modal = document.createElement('div');
        Object.assign(modal.style, {
            backgroundColor: '#1a1a2e',
            border: '2px solid #5894f4',
            borderRadius: '10px',
            padding: '20px',
            maxWidth: '500px',
            color: 'white'
        });

        const titleEl = document.createElement('h3');
        titleEl.textContent = title;
        titleEl.style.marginBottom = '15px';
        modal.appendChild(titleEl);
        makeDecisionModalMovable(modal, titleEl, overlay);

        scrollNames.forEach(scrollName => {
            const scrollDef = this.spellSystem?.patterns?.[scrollName];
            const btn = document.createElement('button');
            btn.textContent = scrollDef?.name || scrollName;
            Object.assign(btn.style, {
                display: 'block',
                width: '100%',
                padding: '10px',
                margin: '5px 0',
                backgroundColor: '#2d2d44',
                color: 'white',
                border: 'none',
                borderRadius: '5px',
                cursor: 'pointer'
            });
            btn.onmouseenter = () => btn.style.backgroundColor = '#3d3d54';
            btn.onmouseleave = () => btn.style.backgroundColor = '#2d2d44';
            btn.onclick = () => {
                overlay.remove();
                onSelect(scrollName);
            };
            modal.appendChild(btn);
        });

        const cancelBtn = document.createElement('button');
        cancelBtn.textContent = 'Cancel';
        Object.assign(cancelBtn.style, {
            marginTop: '15px',
            padding: '10px 20px',
            backgroundColor: '#e74c3c',
            color: 'white',
            border: 'none',
            borderRadius: '5px',
            cursor: 'pointer'
        });
        cancelBtn.onclick = () => {
            overlay.remove();
            if (typeof onCancel === 'function') onCancel();
        };
        modal.appendChild(cancelBtn);

        overlay.appendChild(modal);
        document.body.appendChild(overlay);
    },

    showDeckSelectionModal(count, onSelect) {
        const existing = document.getElementById('deck-select-modal');
        if (existing) existing.remove();

        const overlay = document.createElement('div');
        overlay.id = 'deck-select-modal';
        styleDecisionOverlay(overlay);

        const modal = document.createElement('div');
        Object.assign(modal.style, {
            backgroundColor: '#1a1a2e',
            border: '2px solid #5894f4',
            borderRadius: '10px',
            padding: '20px',
            color: 'white'
        });

        const titleEl = document.createElement('h3');
        titleEl.textContent = count === 1
            ? 'Select 1 deck to draw 2 scrolls from:'
            : `Select ${count} deck(s) to draw from:`;
        titleEl.style.marginBottom = '15px';
        modal.appendChild(titleEl);
        makeDecisionModalMovable(modal, titleEl, overlay);

        const selected = [];
        const elements = ['earth', 'water', 'fire', 'wind', 'void'];
        const elementColors = {
            earth: '#69d83a',
            water: '#5894f4',
            fire: '#ed1b43',
            wind: '#ffce00',
            void: '#9458f4'
        };

        elements.forEach(element => {
            const deckSize = this.spellSystem?.scrollDecks?.[element]?.length || 0;
            const btn = document.createElement('button');
            btn.textContent = `${element.charAt(0).toUpperCase() + element.slice(1)} (${deckSize} left)`;
            btn.disabled = deckSize === 0;
            Object.assign(btn.style, {
                display: 'block',
                width: '100%',
                padding: '10px',
                margin: '5px 0',
                backgroundColor: deckSize > 0 ? '#2d2d44' : '#1a1a1a',
                color: deckSize > 0 ? elementColors[element] : '#555',
                border: 'none',
                borderRadius: '5px',
                cursor: deckSize > 0 ? 'pointer' : 'not-allowed'
            });

            if (deckSize > 0) {
                btn.onclick = () => {
                    if (selected.includes(element)) {
                        selected.splice(selected.indexOf(element), 1);
                        btn.style.backgroundColor = '#2d2d44';
                    } else if (selected.length < count) {
                        selected.push(element);
                        btn.style.backgroundColor = '#3d5a3d';
                    }
                };
            }
            modal.appendChild(btn);
        });

        const confirmBtn = document.createElement('button');
        confirmBtn.textContent = 'Confirm';
        Object.assign(confirmBtn.style, {
            marginTop: '15px',
            padding: '10px 20px',
            backgroundColor: '#27ae60',
            color: 'white',
            border: 'none',
            borderRadius: '5px',
            cursor: 'pointer'
        });
        confirmBtn.onclick = () => {
            overlay.remove();
            onSelect(selected);
        };
        modal.appendChild(confirmBtn);

        overlay.appendChild(modal);
        document.body.appendChild(overlay);
    },

    showElementSelectionModal(onSelect) {
        const existing = document.getElementById('element-select-modal');
        if (existing) existing.remove();

        const overlay = document.createElement('div');
        overlay.id = 'element-select-modal';
        styleDecisionOverlay(overlay);

        const modal = document.createElement('div');
        Object.assign(modal.style, {
            backgroundColor: '#1a1a2e',
            border: '2px solid #5894f4',
            borderRadius: '10px',
            padding: '20px',
            color: 'white'
        });

        const titleEl = document.createElement('h3');
        titleEl.textContent = 'Select an element:';
        titleEl.style.marginBottom = '15px';
        modal.appendChild(titleEl);
        makeDecisionModalMovable(modal, titleEl, overlay);

        const elements = ['earth', 'water', 'fire', 'wind', 'void'];
        const elementColors = {
            earth: '#69d83a',
            water: '#5894f4',
            fire: '#ed1b43',
            wind: '#ffce00',
            void: '#9458f4'
        };

        elements.forEach(element => {
            const btn = document.createElement('button');
            btn.textContent = element.charAt(0).toUpperCase() + element.slice(1);
            Object.assign(btn.style, {
                display: 'block',
                width: '100%',
                padding: '10px',
                margin: '5px 0',
                backgroundColor: '#2d2d44',
                color: elementColors[element],
                border: `2px solid ${elementColors[element]}`,
                borderRadius: '5px',
                cursor: 'pointer'
            });
            btn.onclick = () => {
                overlay.remove();
                onSelect(element);
            };
            modal.appendChild(btn);
        });

        overlay.appendChild(modal);
        document.body.appendChild(overlay);
    },

    showOpponentSelectionModal(opponents, onSelect) {
        const existing = document.getElementById('opponent-select-modal');
        if (existing) existing.remove();

        const overlay = document.createElement('div');
        overlay.id = 'opponent-select-modal';
        styleDecisionOverlay(overlay);

        const modal = document.createElement('div');
        Object.assign(modal.style, {
            backgroundColor: '#1a1a2e',
            border: '2px solid #ed1b43',
            borderRadius: '10px',
            padding: '20px',
            color: 'white',
            minWidth: '220px'
        });

        const titleEl = document.createElement('h3');
        titleEl.textContent = 'Select an opponent:';
        titleEl.style.marginBottom = '15px';
        titleEl.style.color = '#ed1b43';
        modal.appendChild(titleEl);
        makeDecisionModalMovable(modal, titleEl, overlay);

        opponents.forEach(opponentIndex => {
            // Get display name with username and color
            const name = (typeof getPlayerColorName === 'function')
                ? getPlayerColorName(opponentIndex)
                : (typeof playerPositions !== 'undefined' && playerPositions[opponentIndex]?.username)
                    ? playerPositions[opponentIndex].username
                    : `Player ${opponentIndex + 1}`;

            // Get the player's hex color for styling
            const playerHexColor = (typeof playerPositions !== 'undefined' && playerPositions[opponentIndex]?.color)
                ? playerPositions[opponentIndex].color
                : '#ffffff';

            const btn = document.createElement('button');
            btn.textContent = name;
            Object.assign(btn.style, {
                display: 'block',
                width: '100%',
                padding: '12px',
                margin: '6px 0',
                backgroundColor: '#2d2d44',
                color: playerHexColor,
                border: `1px solid ${playerHexColor}`,
                borderRadius: '5px',
                cursor: 'pointer',
                fontSize: '14px',
                fontWeight: 'bold'
            });
            btn.onmouseenter = () => btn.style.backgroundColor = '#3d3d54';
            btn.onmouseleave = () => btn.style.backgroundColor = '#2d2d44';
            btn.onclick = () => {
                overlay.remove();
                onSelect(opponentIndex);
            };
            modal.appendChild(btn);
        });

        overlay.appendChild(modal);
        document.body.appendChild(overlay);
    },

    // ============================================
    // STONE DESTRUCTION HELPERS
    // ============================================

    destroyStonesOnTile(tile) {
        if (typeof placedStones === 'undefined') return;

        // Use same radius as tileHasStones and findTileAtPosition: TILE_SIZE * 4
        const tileRadius = typeof TILE_SIZE !== 'undefined' ? TILE_SIZE * 4 : 80;

        // Track which stones we're removing for multiplayer sync
        const removedStoneIds = [];

        // Find and remove ALL stones on this tile (iterate backwards for safe splice)
        for (let i = placedStones.length - 1; i >= 0; i--) {
            const stone = placedStones[i];
            const dist = Math.sqrt(Math.pow(stone.x - tile.x, 2) + Math.pow(stone.y - tile.y, 2));
            if (dist < tileRadius) {
                // Track stone ID for broadcast
                removedStoneIds.push(stone.id);

                // Remove stone from DOM
                if (stone.element && stone.element.parentNode) {
                    stone.element.parentNode.removeChild(stone.element);
                }
                // Remove from array
                placedStones.splice(i, 1);
            }
        }

        // Broadcast in multiplayer
        if (typeof isMultiplayer !== 'undefined' && isMultiplayer && typeof broadcastGameAction === 'function') {
            broadcastGameAction('stones-destroyed', {
                tileId: tile.id,
                stoneIds: removedStoneIds
            });
        }
    },

    destroyOpponentStone(opponentIndex, stoneType, completionPayload = null) {
        const pools = typeof playerPools !== 'undefined' ? playerPools : (typeof window !== 'undefined' && window.playerPools);
        const opponentStones = pools && pools[opponentIndex] ? pools[opponentIndex] : null;
        if (!opponentStones) {
            updateStatus('Cannot access opponent stone pools.');
            return;
        }
        if (opponentStones[stoneType] > 0) {
            opponentStones[stoneType]--;
            // A destroyed stone returns to the shared SOURCE pool — same invariant
            // every other stone-destruction path uses (fire kills on the board,
            // etc.). Without this the stone just vanished: not in the opponent's
            // pool, never credited back to the source.
            if (typeof returnStoneToPool === 'function') returnStoneToPool(stoneType);
            const name = (typeof playerPositions !== 'undefined' && playerPositions[opponentIndex]?.username)
                ? playerPositions[opponentIndex].username
                : `Player ${opponentIndex + 1}`;
            updateStatus(`Arson! Destroyed 1 ${stoneType} stone from ${name}'s pool.`);

            if (typeof updateOpponentPanel === 'function') updateOpponentPanel();

            if (typeof isMultiplayer !== 'undefined' && isMultiplayer && typeof broadcastGameAction === 'function') {
                broadcastGameAction('opponent-stone-destroyed', {
                    opponentIndex,
                    stoneType
                });
            }

            // Send Arson to common area after use
            if (completionPayload && this.spellSystem) {
                const scrollName = completionPayload.scrollName || 'FIRE_SCROLL_5';
                this.spellSystem.handleScrollDisposition(scrollName, false, true);
            }

            // Signal selection effect complete (triggers win check, broadcast)
            if (completionPayload && this.spellSystem && typeof this.spellSystem.onSelectionEffectComplete === 'function') {
                this.spellSystem.onSelectionEffectComplete(completionPayload.scrollName, completionPayload.effectName, completionPayload.spell);
            }
        } else {
            updateStatus(`${stoneType} pool is empty!`);
        }
    },

    // Catacomb Scroll 8 - Plunder: Discard a target player's active scroll to common area
    enterPlunderMode(casterIndex, completionPayload = null) {
        const self = this;
        // The scroll currently being cast — exclude it from plunderable lists
        // (it's still in the caster's active set until handleScrollDisposition runs)
        const castingScrollName = completionPayload?.scrollName || null;

        // Get all players (including self, but exclude Excavate-immune opponents)
        const numPlayers = typeof playerPositions !== 'undefined' ? playerPositions.length : 1;
        const targets = [];
        for (let i = 0; i < numPlayers; i++) {
            // Allow self-targeting, but skip immune opponents
            if (i !== casterIndex && this.hasExcavateImmunity(i)) continue;
            targets.push(i);
        }

        if (targets.length === 0) {
            updateStatus('No players to target!');
            return;
        }

        // Step 1: Select target player
        this.showPlunderPlayerModal(targets, casterIndex, castingScrollName, (targetPlayerIndex) => {
            // Step 2: Get target's active scrolls
            if (!self.spellSystem) {
                updateStatus('Plunder: scroll system unavailable.');
                return;
            }
            self.spellSystem.ensurePlayerScrollsStructure(targetPlayerIndex);
            const targetScrolls = self.spellSystem.playerScrolls[targetPlayerIndex];

            // Build plunderable list, excluding the scroll being cast if targeting self
            let activeScrollArray = targetScrolls ? Array.from(targetScrolls.active) : [];
            if (targetPlayerIndex === casterIndex && castingScrollName) {
                activeScrollArray = activeScrollArray.filter(s => s !== castingScrollName);
            }

            if (activeScrollArray.length === 0) {
                const name = (typeof playerPositions !== 'undefined' && playerPositions[targetPlayerIndex]?.username)
                    ? playerPositions[targetPlayerIndex].username
                    : `Player ${targetPlayerIndex + 1}`;
                updateStatus(`${name} has no active scrolls to plunder!`);
                // Still signal completion so scroll disposition happens
                if (completionPayload && self.spellSystem && typeof self.spellSystem.onSelectionEffectComplete === 'function') {
                    self.spellSystem.onSelectionEffectComplete(completionPayload.scrollName, completionPayload.effectName, completionPayload.spell);
                }
                return;
            }

            // Step 3: Show target's active scrolls for caster to choose
            self.showScrollSelectionModal(activeScrollArray, 'Select an active scroll to plunder:', (selectedScroll) => {
                // Remove from target's active area
                targetScrolls.active.delete(selectedScroll);

                // Discard to common area
                if (self.spellSystem.discardToCommonArea) {
                    self.spellSystem.discardToCommonArea(selectedScroll);
                }

                const scrollDef = self.spellSystem?.patterns?.[selectedScroll];
                const scrollDisplayName = scrollDef?.name || selectedScroll;
                const targetName = (typeof playerPositions !== 'undefined' && playerPositions[targetPlayerIndex]?.username)
                    ? playerPositions[targetPlayerIndex].username
                    : `Player ${targetPlayerIndex + 1}`;
                updateStatus(`Plunder! Sent ${scrollDisplayName} from ${targetName}'s active area to the common area.`);
                console.log(`🏴‍☠️ Plunder: moved ${selectedScroll} from player ${targetPlayerIndex}'s active to common area`);

                // Update UI
                if (self.spellSystem?.updateScrollCount) {
                    self.spellSystem.updateScrollCount();
                }
                if (typeof updateOpponentPanel === 'function') updateOpponentPanel();

                // Broadcast in multiplayer
                if (typeof isMultiplayer !== 'undefined' && isMultiplayer && typeof broadcastGameAction === 'function') {
                    broadcastGameAction('scroll-plundered', {
                        casterIndex: casterIndex,
                        targetIndex: targetPlayerIndex,
                        scrollName: selectedScroll
                    });
                }

                if (typeof syncPlayerState === 'function') syncPlayerState();

                // Signal selection effect complete
                if (completionPayload && self.spellSystem && typeof self.spellSystem.onSelectionEffectComplete === 'function') {
                    self.spellSystem.onSelectionEffectComplete(completionPayload.scrollName, completionPayload.effectName, completionPayload.spell);
                }
            });
        });
    },

    // Plunder: player selection modal (allows targeting any player including self)
    showPlunderPlayerModal(targets, casterIndex, castingScrollName, onSelect) {
        const existing = document.getElementById('plunder-player-modal');
        if (existing) existing.remove();

        const overlay = document.createElement('div');
        overlay.id = 'plunder-player-modal';
        styleDecisionOverlay(overlay);

        const modal = document.createElement('div');
        Object.assign(modal.style, {
            backgroundColor: '#1a1a2e',
            border: '2px solid #ff8c00',
            borderRadius: '10px',
            padding: '20px',
            color: 'white',
            minWidth: '200px'
        });

        const titleEl = document.createElement('h3');
        titleEl.textContent = 'Plunder: Select a target player';
        titleEl.style.marginBottom = '15px';
        titleEl.style.color = '#ff8c00';
        modal.appendChild(titleEl);
        makeDecisionModalMovable(modal, titleEl, overlay);

        targets.forEach(playerIdx => {
            const name = (typeof getPlayerColorName === 'function')
                ? getPlayerColorName(playerIdx)
                : (typeof playerPositions !== 'undefined' && playerPositions[playerIdx]?.username)
                    ? playerPositions[playerIdx].username
                    : `Player ${playerIdx + 1}`;

            // Get the player's hex color for styling
            const playerHexColor = (typeof playerPositions !== 'undefined' && playerPositions[playerIdx]?.color)
                ? playerPositions[playerIdx].color
                : '#ffffff';

            // Check if this player has plunderable active scrolls
            // Exclude the scroll being cast if this is the caster
            const sp = this.spellSystem;
            let activeCount = 0;
            if (sp) {
                sp.ensurePlayerScrollsStructure(playerIdx);
                const activeSet = sp.playerScrolls[playerIdx]?.active;
                if (activeSet) {
                    activeCount = activeSet.size;
                    if (playerIdx === casterIndex && castingScrollName && activeSet.has(castingScrollName)) {
                        activeCount--;
                    }
                }
            }

            const btn = document.createElement('button');
            btn.textContent = playerIdx === casterIndex ? `${name} (you) - ${activeCount} active` : `${name} - ${activeCount} active`;
            Object.assign(btn.style, {
                display: 'block',
                width: '100%',
                padding: '12px',
                margin: '6px 0',
                backgroundColor: activeCount > 0 ? '#2d2d44' : '#1a1a22',
                color: activeCount > 0 ? playerHexColor : '#666',
                border: activeCount > 0 ? `1px solid ${playerHexColor}` : '1px solid #333',
                borderRadius: '5px',
                cursor: activeCount > 0 ? 'pointer' : 'not-allowed',
                opacity: activeCount > 0 ? '1' : '0.5',
                fontSize: '14px',
                fontWeight: 'bold'
            });
            if (activeCount > 0) {
                btn.onmouseenter = () => btn.style.backgroundColor = '#3d3d54';
                btn.onmouseleave = () => btn.style.backgroundColor = '#2d2d44';
                btn.onclick = () => {
                    overlay.remove();
                    onSelect(playerIdx);
                };
            }
            modal.appendChild(btn);
        });

        const cancelBtn = document.createElement('button');
        cancelBtn.textContent = 'Cancel';
        Object.assign(cancelBtn.style, {
            marginTop: '15px',
            padding: '10px 20px',
            backgroundColor: '#7f8c8d',
            color: 'white',
            border: 'none',
            borderRadius: '5px',
            cursor: 'pointer',
            width: '100%'
        });
        cancelBtn.onclick = () => overlay.remove();
        modal.appendChild(cancelBtn);

        overlay.appendChild(modal);
        document.body.appendChild(overlay);
    },

    shuffleDeck(deck) {
        for (let i = deck.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [deck[i], deck[j]] = [deck[j], deck[i]];
        }
    },

    // Check if water transformation buff is active (for Water V)
    hasWaterTransformation(playerIndex) {
        return this.activeBuffs.waterTransformation?.playerIndex === playerIndex;
    },

    // Check if Unbidden Lamplight is active (for Fire I)
    hasUnbiddenLamplight(casterIndex) {
        // Returns true if any OTHER player has lamplight active
        if (this.activeBuffs.unbiddenLamplight) {
            return this.activeBuffs.unbiddenLamplight.playerIndex !== casterIndex;
        }
        return false;
    },

    // Check if a player has Excavate immunity (cannot be targeted by scrolls)
    hasExcavateImmunity(playerIndex) {
        const buff = this.activeBuffs.excavate;
        return buff && buff.playerIndex === playerIndex;
    },

    // Returns true if the given caster's scrolls cannot be responded to this turn
    hasExcavateNoResponse(playerIndex) {
        const buff = this.activeBuffs.excavateNoResponse;
        return buff && buff.playerIndex === playerIndex;
    },

    // Clear Excavate immunity and trigger teleport option when a player's turn starts
    clearExcavateForPlayer(playerIndex) {
        const buff = this.activeBuffs.excavate;
        if (buff && buff.playerIndex === playerIndex) {
            delete this.activeBuffs.excavate;
            console.log(`⛏️ Excavate immunity cleared for player ${playerIndex}`);
        }
        // Also clear the no-response buff (it only applied to the previous turn)
        const nrBuff = this.activeBuffs.excavateNoResponse;
        if (nrBuff && nrBuff.playerIndex === playerIndex) {
            delete this.activeBuffs.excavateNoResponse;
            console.log(`⛏️ Excavate no-response buff cleared for player ${playerIndex}`);
        }
    },

    // Process Excavate teleport at start of turn (returns true if teleport is pending)
    processExcavateTeleport(playerIndex) {
        const buff = this.activeBuffs.excavateTeleport;
        if (!buff || buff.playerIndex !== playerIndex) return false;

        // Only trigger for the local player in multiplayer. Resolve through
        // BotDriver.driverRealIndex() when this browser is mid-impersonation
        // (driving a bot's turn) — same reasoning as the isReflectCaster fix
        // above: this runs from inside the #end-turn click handler, and when
        // a BOT ends its own turn (asBot() still impersonating it) and hands
        // off to the real human, raw myPlayerIndex is still the bot's index
        // here, not the human's — so the teleport prompt was silently
        // dropped as "not the local player" every time a bot's turn handed
        // off to the Excavate caster.
        const _excavateDriverIdx = (typeof window !== 'undefined' && window.BotDriver
            && typeof window.BotDriver.driverRealIndex === 'function'
            && window.BotDriver.driverRealIndex() != null)
            ? window.BotDriver.driverRealIndex()
            : (typeof myPlayerIndex !== 'undefined' ? myPlayerIndex : null);
        const localPlayer = (typeof isMultiplayer !== 'undefined' && isMultiplayer && _excavateDriverIdx != null)
            ? _excavateDriverIdx : (typeof activePlayerIndex !== 'undefined' ? activePlayerIndex : -1);
        if (playerIndex !== localPlayer) {
            // Not the local player — just clear the buff silently
            delete this.activeBuffs.excavateTeleport;
            return false;
        }

        delete this.activeBuffs.excavateTeleport;
        console.log(`⛏️ Excavate teleport available for player ${playerIndex}`);
        // Record for the Game Log — same reasoning as Reflect/Psychic's
        // matching calls: this deferred option appears amid a turn-start
        // flurry of other status text with no lasting trace otherwise.
        if (typeof window !== 'undefined' && window.logScrollEvent) {
            window.logScrollEvent('excavate_triggered', { casterIndex: playerIndex });
        }

        // Show teleport prompt modal
        this.showExcavateTeleportModal(playerIndex);
        return true;
    },

    // Excavate: modal asking if player wants to teleport
    showExcavateTeleportModal(playerIndex) {
        const self = this;

        const existing = document.getElementById('excavate-teleport-modal');
        if (existing) existing.remove();

        const overlay = document.createElement('div');
        overlay.id = 'excavate-teleport-modal';
        styleDecisionOverlay(overlay);

        const modal = document.createElement('div');
        Object.assign(modal.style, {
            backgroundColor: '#1a1a2e',
            border: '2px solid #8b4513',
            borderRadius: '10px',
            padding: '20px',
            color: 'white',
            minWidth: '280px',
            textAlign: 'center'
        });

        const titleEl = document.createElement('h3');
        titleEl.textContent = 'Excavate';
        titleEl.style.marginBottom = '10px';
        titleEl.style.color = '#8b4513';
        modal.appendChild(titleEl);
        makeDecisionModalMovable(modal, titleEl, overlay);

        const descEl = document.createElement('p');
        descEl.textContent = 'You emerge from the catacombs! You may teleport to any unoccupied hex on a revealed tile.';
        descEl.style.marginBottom = '15px';
        descEl.style.fontSize = '14px';
        modal.appendChild(descEl);

        const teleportBtn = document.createElement('button');
        teleportBtn.textContent = 'Teleport';
        Object.assign(teleportBtn.style, {
            display: 'block',
            width: '100%',
            padding: '12px',
            margin: '8px 0',
            backgroundColor: '#2d2d44',
            color: '#8b4513',
            border: '2px solid #8b4513',
            borderRadius: '5px',
            cursor: 'pointer',
            fontSize: '14px',
            fontWeight: 'bold'
        });
        teleportBtn.onmouseenter = () => teleportBtn.style.backgroundColor = '#3d3d54';
        teleportBtn.onmouseleave = () => teleportBtn.style.backgroundColor = '#2d2d44';
        teleportBtn.onclick = () => {
            overlay.remove();
            self.enterExcavateTeleportMode(playerIndex);
        };
        modal.appendChild(teleportBtn);

        const stayBtn = document.createElement('button');
        stayBtn.textContent = 'Stay Here';
        Object.assign(stayBtn.style, {
            display: 'block',
            width: '100%',
            padding: '12px',
            margin: '8px 0',
            backgroundColor: '#2d2d44',
            color: '#999',
            border: '1px solid #555',
            borderRadius: '5px',
            cursor: 'pointer',
            fontSize: '14px'
        });
        stayBtn.onmouseenter = () => stayBtn.style.backgroundColor = '#3d3d54';
        stayBtn.onmouseleave = () => stayBtn.style.backgroundColor = '#2d2d44';
        stayBtn.onclick = () => {
            overlay.remove();
            updateStatus('Your turn begins!');
        };
        modal.appendChild(stayBtn);

        overlay.appendChild(modal);
        document.body.appendChild(overlay);
    },

    // Excavate: hex selection for teleport at start of turn
    enterExcavateTeleportMode(playerIndex) {
        const self = this;

        updateStatus('Excavate: Click any unoccupied hex on a revealed tile to teleport there.');

        this.selectionMode = {
            type: 'excavate-teleport',
            casterIndex: playerIndex,

            handleHexClick(hexPos) {
                const destX = hexPos.x;
                const destY = hexPos.y;

                // Check hex is on at least one revealed (non-player) tile
                const hasRevealedTile = hexPos.tiles && hexPos.tiles.some(t => !t.flipped && !t.isPlayerTile);
                if (!hasRevealedTile) {
                    updateStatus('Cannot teleport there - not on a revealed tile!');
                    return;
                }

                // Check not occupied by a stone
                const hasStone = (typeof placedStones !== 'undefined') && placedStones.some(s => {
                    const dist = Math.sqrt(Math.pow(s.x - destX, 2) + Math.pow(s.y - destY, 2));
                    return dist < 5;
                });
                if (hasStone) {
                    updateStatus('Cannot teleport there - a stone is on that space!');
                    return;
                }

                // Check not occupied by a player
                const hasPlayer = (typeof playerPositions !== 'undefined') && playerPositions.some(p => {
                    if (!p) return false;
                    const dist = Math.sqrt(Math.pow(p.x - destX, 2) + Math.pow(p.y - destY, 2));
                    return dist < 5;
                });
                if (hasPlayer) {
                    updateStatus('Cannot teleport there - a player is on that space!');
                    return;
                }

                // Teleport the player
                if (typeof placePlayer === 'function') {
                    placePlayer(destX, destY);
                }

                updateStatus(`Excavate: Teleported! Your turn begins.`);
                console.log(`⛏️ Excavate teleport: player ${playerIndex} to (${destX.toFixed(1)}, ${destY.toFixed(1)})`);
                if (typeof window !== 'undefined' && window.logScrollEvent) {
                    window.logScrollEvent('excavate_teleport_used', { casterIndex: playerIndex });
                }

                // Broadcast in multiplayer
                if (typeof isMultiplayer !== 'undefined' && isMultiplayer && typeof broadcastGameAction === 'function') {
                    broadcastGameAction('excavate-teleport', {
                        playerIndex: playerIndex,
                        x: destX,
                        y: destY
                    });
                }

                if (typeof syncPlayerState === 'function') syncPlayerState();

                self.selectionMode = null;
            },

            cleanup() {
                // No cancel button to clean up
            }
        };
    }
};

// Export for use
if (typeof window !== 'undefined') {
    window.ScrollEffects = ScrollEffects;
}
