/**
 * Response Window System for Godaigo
 *
 * When a player casts a scroll, a "response window" opens allowing ALL other players
 * with valid response scrolls to respond simultaneously. After all eligible players
 * have either responded or passed, the winner is determined by element rank:
 *   Void (5) > Wind (4) > Fire (3) > Water (2) > Earth (1)
 * Only the highest-ranked response executes. Ties are impossible because each scroll
 * exists only once in the game.
 *
 * New rule: A response scroll that is in a player's HAND can be moved to their active
 * area during the response window, but only if they have an open active slot. The
 * response window includes these hand scrolls as clickable options with a badge.
 *
 * Rules:
 * - Response costs normal 2 AP
 * - Responder must have valid scroll (active, common, or hand+open-slot) AND valid pattern
 * - Earth I (Iron Stance) / Void I (Psychic) are counter scrolls — they cancel the original
 * - All other response scrolls execute alongside the original
 * - All non-caster HUMAN players submit (respond or pass) before resolution begins
 * - The window only OPENS when at least one opponent could respond (canPlayerRespond)
 *   or plausibly bluff a response (canPlayerBluff: matching formation + hand scroll of
 *   that element + open active slot + enough AP). Otherwise the cast resolves instantly.
 *   Bots CAN respond (via window.BotEffects.decideResponse(), see isBotPlayer() below) —
 *   they're only excluded from the BLUFF branch, since they decide deterministically
 *   rather than performatively.
 */

// Element rank for response arbitration: higher = wins over lower
const ELEMENT_RANK = { void: 5, wind: 4, fire: 3, water: 2, earth: 1 };

/**
 * Get the element rank for a scroll name like 'WIND_SCROLL_1' → 4
 */
function getScrollElementRank(scrollName) {
    const element = (scrollName || '').split('_')[0].toLowerCase();
    return ELEMENT_RANK[element] ?? 0;
}

class ResponseWindowSystem {
    constructor(spellSystem) {
        this.spellSystem = spellSystem;
        this.isResponseWindowOpen = false;
        this.responseStack = []; // Stack of pending scroll casts
        this.currentCaster = null; // Player who initiated the current scroll
        this.pendingScrollData = null; // Data about the scroll being responded to
        this.respondingPlayers = new Set(); // Players who have passed or responded
        this.responseTimeout = null;
        this.RESPONSE_TIMEOUT_MS = 15000; // 15 seconds to respond
        this.PSYCHIC_RANSOM_AP = 2; // AP the original caster may pay to negate Psychic
        // True from the moment resolveResponseStack() starts (including while the
        // Psychic ransom prompt is open, waiting on the original caster's decision)
        // until finishResponseResolution() actually finishes. Guards playerResponds/
        // playerPasses/handleRemoteResponse/handleRemotePass against a stray late
        // submission — a real one, or a bot's own decideResponse() call, since
        // isResponseWindowOpen deliberately stays true for that whole stretch —
        // corrupting a resolution that's already committed to its outcome. Reset
        // whenever a fresh response window opens for the next cast.
        this._resolving = false;
        this.responseModalElement = null;
        // True while the local player is browsing the Sacrificial Pyre
        // hand-scroll picker (a sub-modal on top of the response window).
        // Guards showResponseModal() against getting rebuilt underneath/on
        // top of the picker by a re-entrant call (e.g. a duplicate
        // 'response-window-opened' broadcast) while they're mid-pick.
        this.sacrificialPyrePicking = false;
    }

    // ── Bot-aware identity helpers ─────────────────────────────────────────
    // When the HOST is driving a bot player, BotDriver temporarily swaps the
    // shared `myPlayerIndex` to the bot's index for the whole bot turn. For the
    // response window that produces two distinct roles on ONE client:
    //   • the *responder* is the human sitting at this screen (the driver), who
    //     must still be able to react to the bot's spell, and
    //   • the *arbitrator* (caster client) is still this client, because it runs
    //     the bot that cast the scroll and no one else can resolve the stack.
    // For every non-bot client both helpers fall back to plain `myPlayerIndex`,
    // so human-vs-human play is unchanged.

    /** The human player acting at this screen (the driver when impersonating a bot). */
    localResponderIndex() {
        const driverIdx = (typeof window !== 'undefined' && window.BotDriver
            && typeof window.BotDriver.driverRealIndex === 'function')
            ? window.BotDriver.driverRealIndex() : null;
        if (driverIdx != null) return driverIdx;
        return (typeof myPlayerIndex !== 'undefined' && myPlayerIndex != null)
            ? myPlayerIndex : activePlayerIndex;
    }

    /** Whether this client is responsible for arbitrating/resolving the stack. */
    isArbitratorClient() {
        if (!(typeof isMultiplayer !== 'undefined' && isMultiplayer)) return true;
        const mine = (typeof myPlayerIndex !== 'undefined' && myPlayerIndex != null)
            ? myPlayerIndex : activePlayerIndex;
        return mine === this.currentCaster;
    }

    /**
     * Present the response opportunity to the local human responder.
     * Shows the response modal (or bluff window) if they have something to play,
     * otherwise submits a pass immediately so the stack resolves without forcing
     * everyone to sit through the full countdown.
     */
    presentResponderView(scrollData, casterIndex) {
        const myIndex = this.localResponderIndex();
        const responseCheck = this.canPlayerRespond(myIndex);
        if (responseCheck.canRespond) {
            this.showResponseModal();
            this.startResponseTimeout();
        } else if (this.canPlayerBluff(myIndex)) {
            this.showBluffModal();
            this.startResponseTimeout();
        } else {
            // Nothing playable — auto-pass so we don't block on the timer.
            this.respondingPlayers.add(myIndex);
            if (typeof isMultiplayer !== 'undefined' && isMultiplayer) {
                this.broadcastPass(myIndex);
            }
            this.checkAllPlayersResponded();
        }
    }

    /**
     * Check if a player can respond to a scroll
     * @param {number} playerIndex - The player to check
     * @returns {object} { canRespond: boolean, validScrolls: array, reason: string }
     */
    canPlayerRespond(playerIndex) {
        // Determine player's available AP (responses may be free with buffs)
        const playerAP = this.getPlayerAP(playerIndex);

        // Get player's active scrolls and common area scrolls
        const playerScrolls = this.spellSystem.playerScrolls[playerIndex];
        if (!playerScrolls) {
            return { canRespond: false, validScrolls: [], reason: 'No scrolls available' };
        }

        const activeScrolls = Array.from(playerScrolls.active || []);
        const commonScrolls = this.spellSystem.getCommonAreaScrolls();
        const allCastableScrolls = [...activeScrolls, ...commonScrolls];
        // Note: do NOT early-return here when allCastableScrolls is empty —
        // the player may still have a response scroll in their hand (checked below).

        // Check which scrolls have valid patterns on the board
        const validScrolls = [];
        const playerPos = this.getPlayerPosition(playerIndex);

        if (!playerPos) {
            return { canRespond: false, validScrolls: [], reason: 'Player position not found' };
        }

        // One-per-turn guard: once any oncePerTurn response scroll has resolved this
        // turn (by anyone), no further oncePerTurn scrolls may be cast until next turn.
        const responseLimitReached = !!this.spellSystem?.scrollEffects?.responseScrollUsedThisTurn;

        for (const scrollName of allCastableScrolls) {
            const patternOk = this.checkPatternForPlayer(scrollName, playerIndex);
            if (patternOk) {
                const scrollDef = this.spellSystem.patterns[scrollName];
                const isCounter = scrollDef?.canCounter === 'any';
                const isResponse = scrollDef?.isResponse === true;

                // Skip scrolls locked out by the one-per-turn limit
                if (responseLimitReached && scrollDef?.oncePerTurn) {
                    console.log(`  ↳ ${scrollName}: skipped - a response scroll was already cast this turn`);
                    continue;
                }

                // Only include scrolls that are counter scrolls OR response scrolls
                // Regular scrolls can't be cast as responses
                if (isCounter || isResponse) {
                    const cost = this.spellSystem?.getSpellCost ? this.spellSystem.getSpellCost(scrollDef, playerIndex) : 2;
                    if (playerAP < cost) {
                        console.log(`  ↳ ${scrollName}: pattern OK, isResponse=${isResponse} but can't afford (AP=${playerAP}, cost=${cost})`);
                        continue;
                    }
                    validScrolls.push({
                        name: scrollName,
                        definition: scrollDef,
                        isCounter: isCounter,
                        isResponse: isResponse,
                        fromCommonArea: commonScrolls.includes(scrollName),
                        cost: cost
                    });
                } else {
                    console.log(`  ↳ ${scrollName}: pattern OK but not a counter/response scroll`);
                }
            } else {
                console.log(`  ↳ ${scrollName}: pattern NOT matched for player ${playerIndex}`);
            }
        }

        // Also check hand scrolls — usable if active area has an open slot
        // (new rule: response scrolls in hand can be moved to active during the response window)
        const hasOpenActiveSlot = (playerScrolls.active?.size ?? 0) < (this.spellSystem.MAX_ACTIVE_SIZE ?? 2);
        if (hasOpenActiveSlot) {
            for (const scrollName of (playerScrolls.hand || new Set())) {
                const patternOk = this.checkPatternForPlayer(scrollName, playerIndex);
                if (patternOk) {
                    const scrollDef = this.spellSystem.patterns[scrollName];
                    const isCounter = scrollDef?.canCounter === 'any';
                    const isResponse = scrollDef?.isResponse === true;
                    // Skip scrolls locked out by the one-per-turn limit
                    if (responseLimitReached && scrollDef?.oncePerTurn) {
                        console.log(`  ↳ ${scrollName} (hand): skipped - a response scroll was already cast this turn`);
                        continue;
                    }
                    if (isCounter || isResponse) {
                        const cost = this.spellSystem?.getSpellCost ? this.spellSystem.getSpellCost(scrollDef, playerIndex) : 2;
                        if (playerAP < cost) {
                            console.log(`  ↳ ${scrollName} (hand): pattern OK, isResponse=${isResponse} but can't afford (AP=${playerAP}, cost=${cost})`);
                            continue;
                        }
                        validScrolls.push({
                            name: scrollName,
                            definition: scrollDef,
                            isCounter,
                            isResponse,
                            fromCommonArea: false,
                            fromHand: true,
                            cost
                        });
                        console.log(`  ↳ ${scrollName} (hand): valid response - will move to active on use`);
                    }
                }
            }
        }

        // Sacrificial Pyre (FIRE_SCROLL_3): "Activate any scroll in your hand
        // (ignoring pattern)." If the player can cast Pyre itself (own pattern
        // formed, sitting in active/common, affordable) and has a Level I
        // response/counter scroll sitting in hand, offer Pyre as a special
        // response option — picking it lets them activate that hand scroll as
        // their real response, ignoring ITS pattern requirement. The chosen
        // scroll is free (Pyre's own cost covers it), matching the main-phase
        // sacrifice flow (enterScrollSacrificeMode in scroll-effects.js).
        const SACRIFICIAL_PYRE = 'FIRE_SCROLL_3';
        if (allCastableScrolls.includes(SACRIFICIAL_PYRE) && this.checkPatternForPlayer(SACRIFICIAL_PYRE, playerIndex)) {
            const pyreDef = this.spellSystem.patterns[SACRIFICIAL_PYRE];
            const pyreCost = this.spellSystem?.getSpellCost ? this.spellSystem.getSpellCost(pyreDef, playerIndex) : 2;
            if (pyreDef && playerAP >= pyreCost) {
                const reactionOptions = [...(playerScrolls.hand || new Set())].filter(s => {
                    const d = this.spellSystem.patterns[s];
                    return d && (d.canCounter === 'any' || d.isResponse === true);
                });
                if (reactionOptions.length > 0) {
                    validScrolls.push({
                        name: SACRIFICIAL_PYRE,
                        definition: pyreDef,
                        isCounter: false,
                        isResponse: false,
                        isSacrificeVehicle: true,
                        reactionOptions,
                        fromCommonArea: commonScrolls.includes(SACRIFICIAL_PYRE),
                        cost: pyreCost
                    });
                }
            }
        }

        if (validScrolls.length === 0) {
            return { canRespond: false, validScrolls: [], reason: `No valid responses you can afford (AP=${playerAP})` };
        }

        return { canRespond: true, validScrolls, reason: null };
    }

    /**
     * Check whether a player qualifies for the bluff response window.
     *
     * A player can bluff when they have a hand scroll with a matching formation and
     * enough AP to theoretically respond — even if their specific scroll is not a
     * response or counter type. Showing the window lets them appear to consider a
     * response without leaking that they actually cannot play one.
     *
     * Only meaningful in multiplayer (no hidden information in single-player).
     *
     * @param {number} playerIndex
     * @returns {boolean}
     */
    canPlayerBluff(playerIndex) {
        // Bluffing only matters in multiplayer — in single-player scroll contents are known
        if (typeof isMultiplayer === 'undefined' || !isMultiplayer) return false;

        const playerAP = this.getPlayerAP(playerIndex);
        if (playerAP < 2) return false;

        const playerScrolls = this.spellSystem.playerScrolls[playerIndex];
        if (!playerScrolls) return false;

        const playerPos = this.getPlayerPosition(playerIndex);
        if (!playerPos) return false;

        // Must have an open active slot (same condition as the hand-deploy rule, so
        // the deception is plausible — they could theoretically move a scroll from hand)
        const hasOpenActiveSlot = (playerScrolls.active?.size ?? 0) < (this.spellSystem.MAX_ACTIVE_SIZE ?? 2);
        if (!hasOpenActiveSlot) return false;

        // Collect elements of scrolls in this player's hand
        const handScrolls = [...(playerScrolls.hand || new Set())];
        if (handScrolls.length === 0) return false;

        const handElements = new Set(
            handScrolls.map(s => this.spellSystem.patterns?.[s]?.element).filter(Boolean)
        );

        // The bluff is plausible when:
        //   (a) the player has a hand scroll whose element matches a known response/counter scroll, AND
        //   (b) that response/counter scroll's board pattern is currently formed for this player.
        //
        // Opponents see: "they have a [element] scroll in hand + that element's response formation is up."
        // They cannot tell the specific scroll — hence the deception.
        // Once the one-per-turn limit is reached, no oncePerTurn scroll can be played,
        // so a bluff built on one is not credible — skip those below.
        const responseLimitReached = !!this.spellSystem?.scrollEffects?.responseScrollUsedThisTurn;

        for (const [scrollName, scrollDef] of Object.entries(this.spellSystem.patterns || {})) {
            const isCounter  = scrollDef?.canCounter === 'any';
            const isResponse = scrollDef?.isResponse  === true;
            if (!isCounter && !isResponse) continue;
            if (responseLimitReached && scrollDef?.oncePerTurn) continue;
            if (!handElements.has(scrollDef.element)) continue;
            if (this.checkPatternForPlayer(scrollName, playerIndex)) {
                return true;
            }
        }
        return false;
    }

    /**
     * Is this player slot a bot? Used to skip bluff consideration (bots
     * decide deterministically, not performatively — see
     * canAnyPlayerRespondOrBluff) and by bot-driver.js's watcher to know
     * which player indices it's responsible for deciding respond/pass for
     * via window.BotEffects.decideResponse().
     */
    isBotPlayer(playerIndex) {
        try {
            if (typeof allPlayersData !== 'undefined' && Array.isArray(allPlayersData)) {
                const p = allPlayersData.find(p => p.player_index === playerIndex);
                if (p && typeof window.isBotUsername === 'function') {
                    return window.isBotUsername(p.username);
                }
            }
        } catch (e) { /* solo/tutorial mode has no allPlayersData */ }
        return false;
    }

    /**
     * Check if any opponent could respond — or plausibly bluff a response
     * (used to skip the response window entirely when neither is possible).
     *
     * A player holds the window open when they are in the right formation for
     * a response scroll AND can afford it AND either:
     *   • actually have a response/counter scroll castable (active area,
     *     common area, or hand + open active slot) → canPlayerRespond, or
     *   • have a hand scroll of the matching element + open active slot, so
     *     opponents can't rule out a response → canPlayerBluff.
     *
     * @param {number} excludePlayer - The caster (cannot respond to their own scroll)
     * @returns {boolean}
     */
    canAnyPlayerRespondOrBluff(excludePlayer = -1) {
        const numPlayers = typeof playerPositions !== 'undefined' ? playerPositions.length : 0;
        console.log(`Response window: checking ${numPlayers} players for valid responses/bluffs (excluding player ${excludePlayer})`);

        for (let i = 0; i < numPlayers; i++) {
            // Skip the caster - you cannot respond to your own scroll
            if (i === excludePlayer) {
                console.log(`  Player ${i}: skipped (caster)`);
                continue;
            }
            if (typeof playerPositions !== 'undefined' && !playerPositions[i]) {
                console.log(`  Player ${i}: skipped (no pawn)`);
                continue;
            }
            const result = this.canPlayerRespond(i);
            console.log(`  Player ${i}: canRespond=${result.canRespond}, reason=${result.reason || 'can respond'}, validScrolls=${result.validScrolls.length}`);
            if (result.canRespond) {
                return true;
            }
            if (this.isBotPlayer(i)) {
                // Bots decide deterministically via BotEffects — no reason to
                // open the window "in case they bluff" the way a human might.
                continue;
            }
            if (this.canPlayerBluff(i)) {
                console.log(`  Player ${i}: can bluff (matching formation + hand element + AP)`);
                return true;
            }
        }
        return false;
    }

    /**
     * Open response window after a scroll is cast
     * @param {object} scrollData - Data about the cast scroll
     * @param {number} casterIndex - Index of the player who cast the scroll
     * @param {function} onComplete - Callback when response window closes
     */
    openResponseWindow(scrollData, casterIndex, onComplete) {
        // Scroll definition opts out of response window entirely (e.g. Excavate)
        const _castDef = this.spellSystem?.patterns?.[scrollData.name];
        if (_castDef?.skipResponseWindow) {
            console.log(`Response window skipped - ${scrollData.name} has skipResponseWindow`);
            if (onComplete) onComplete({ skipped: true, responses: [] });
            return;
        }

        const numPlayers = typeof playerPositions !== 'undefined' ? playerPositions.length : 0;
        const hasOtherPlayer = numPlayers > 1;
        if (!hasOtherPlayer) {
            console.log('Response window skipped - only one player');
            if (onComplete) onComplete({ skipped: true, responses: [] });
            return;
        }

        // Skip the window entirely unless at least one opponent could actually
        // respond — or plausibly bluff a response (right formation + matching
        // hand element + open active slot + enough AP). This runs on the
        // caster's client using its local mirror of opponent state (positions,
        // active/hand scrolls, AP), which the broadcasts keep in sync. Bots are
        // excluded — they cannot respond. Without this gate the caster sat
        // through the "waiting for other players to respond" screen after
        // every single cast.
        if (!this.canAnyPlayerRespondOrBluff(casterIndex)) {
            console.log('Response window skipped - no opponent can respond or bluff');
            if (onComplete) onComplete({ skipped: true, responses: [] });
            return;
        }

        // Excavate: caster's scrolls cannot be responded to this turn
        if (window.spellSystem?.scrollEffects?.hasExcavateNoResponse?.(casterIndex)) {
            console.log('Response window skipped - caster has Excavate no-response buff');
            if (onComplete) onComplete({ skipped: true, responses: [] });
            return;
        }

        this._resolving = false;
        this.isResponseWindowOpen = true;
        this.currentCaster = casterIndex;
        this.pendingScrollData = scrollData;
        this.respondingPlayers.clear();
        // The caster counts as already having "responded" (they cast the spell)
        this.respondingPlayers.add(casterIndex);
        this.responseStack = [{
            scrollData,
            casterIndex,
            isOriginal: true
        }];

        // Store callback
        this.onCompleteCallback = onComplete;

        // Broadcast in multiplayer FIRST so other players see the window
        if (typeof isMultiplayer !== 'undefined' && isMultiplayer) {
            this.broadcastResponseWindowOpened(scrollData, casterIndex);
        }

        // Decide what THIS client shows. Normally the caster's own client waits
        // for others. But when the caster is a bot driven from this client, the
        // human at this screen (the driver) is a responder, not the caster — so
        // present the response opportunity to them instead of a dead wait screen.
        const responderIndex = this.localResponderIndex();
        if (responderIndex === casterIndex) {
            // This client's human actually cast the scroll — wait for others.
            this.showWaitingForResponses(scrollData);
            this.startResponseTimeout();
        } else {
            // Host driving the bot caster: the human here can respond.
            this.presentResponderView(scrollData, casterIndex);
        }
    }

    /**
     * Show the response window modal overlay
     */
    showResponseModal() {
        // Don't rebuild the response window out from under an in-progress
        // Sacrificial Pyre pick — a re-entrant call here (e.g. a duplicate
        // 'response-window-opened' broadcast landing while the player is
        // browsing the hand-scroll picker) would otherwise render a fresh
        // copy of this modal on top of the picker, making it look like the
        // response window "reset" with no way back to the picker.
        if (this.sacrificialPyrePicking) {
            console.log('Skipping response modal rebuild - Sacrificial Pyre picker is open');
            return;
        }

        // Remove existing modal if present
        if (this.responseModalElement) {
            this.responseModalElement.remove();
        }

        // Create overlay backdrop
        const overlay = document.createElement('div');
        overlay.id = 'response-window-overlay';
        Object.assign(overlay.style, {
            position: 'fixed',
            top: '0',
            left: '0',
            right: '0',
            bottom: '0',
            backgroundColor: 'rgba(0, 0, 0, 0.7)',
            zIndex: '2000',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center'
        });

        // Create modal
        const modal = document.createElement('div');
        modal.id = 'response-window-modal';
        Object.assign(modal.style, {
            backgroundColor: '#1a1a2e',
            border: '3px solid #e94560',
            borderRadius: '15px',
            padding: '25px',
            minWidth: '450px',
            maxWidth: '600px',
            maxHeight: '80vh',
            overflowY: 'auto',
            color: 'white',
            boxShadow: '0 0 30px rgba(233, 69, 96, 0.5)'
        });

        // Header
        const header = document.createElement('div');
        header.style.textAlign = 'center';
        header.style.marginBottom = '20px';

        const title = document.createElement('h2');
        title.textContent = 'RESPONSE WINDOW';
        title.style.color = '#e94560';
        title.style.margin = '0 0 10px 0';
        title.style.textTransform = 'uppercase';
        title.style.letterSpacing = '3px';
        header.appendChild(title);

        // Show what scroll was cast
        const scrollInfo = document.createElement('div');
        const scrollDef = this.spellSystem.patterns[this.pendingScrollData.name];
        scrollInfo.innerHTML = `<strong>${this.getPlayerName(this.currentCaster)}</strong> activated <span style="color: ${this.getElementColor(scrollDef?.element)}">${scrollDef?.name || this.pendingScrollData.name}</span>`;
        scrollInfo.style.fontSize = '16px';
        scrollInfo.style.marginBottom = '10px';
        header.appendChild(scrollInfo);

        // Timer display
        const timerDiv = document.createElement('div');
        timerDiv.id = 'response-timer';
        timerDiv.style.fontSize = '24px';
        timerDiv.style.fontWeight = 'bold';
        timerDiv.style.color = '#f39c12';
        timerDiv.textContent = `${Math.ceil(this.RESPONSE_TIMEOUT_MS / 1000)}s`;
        header.appendChild(timerDiv);

        modal.appendChild(header);

        // Check if current player can respond (the driver's human when running a bot)
        const myIndex = this.localResponderIndex();
        const responseCheck = this.canPlayerRespond(myIndex);

        if (responseCheck.canRespond) {
            // Split into active/common scrolls vs hand scrolls
            const activeScrolls = responseCheck.validScrolls.filter(s => !s.fromHand);
            const handScrolls   = responseCheck.validScrolls.filter(s =>  s.fromHand);

            // Sort highest-rank first within each group
            const sortByRank = arr => [...arr].sort((a, b) => getScrollElementRank(b.name) - getScrollElementRank(a.name));

            // ── Active / common scrolls ───────────────────────────────────
            if (activeScrolls.length > 0) {
                const scrollsSection = document.createElement('div');
                scrollsSection.style.marginBottom = '20px';

                const scrollsHeader = document.createElement('h3');
                scrollsHeader.textContent = 'Your Available Responses:';
                scrollsHeader.style.color = '#16a085';
                scrollsHeader.style.marginBottom = '15px';
                scrollsSection.appendChild(scrollsHeader);

                sortByRank(activeScrolls).forEach(si => scrollsSection.appendChild(this.createScrollCard(si)));
                modal.appendChild(scrollsSection);
            }

            // ── Hand scrolls (deployable to active) ──────────────────────
            if (handScrolls.length > 0) {
                const handSection = document.createElement('div');
                handSection.style.marginBottom = '20px';

                const handHeader = document.createElement('h3');
                handHeader.style.color = '#e67e22';
                handHeader.style.marginBottom = '8px';
                handHeader.textContent = handScrolls.length === 1
                    ? 'You have a response scroll in your Hand:'
                    : 'You have response scrolls in your Hand:';
                handSection.appendChild(handHeader);

                const handNote = document.createElement('p');
                handNote.style.cssText = 'font-size:12px; color:#bdc3c7; margin:0 0 12px 0;';
                handNote.textContent = 'You have an open Active Area slot - you may move one of these to your Active Area and respond with it.';
                handSection.appendChild(handNote);

                sortByRank(handScrolls).forEach(si => handSection.appendChild(this.createScrollCard(si)));
                modal.appendChild(handSection);
            }
        } else {
            // Show why player can't respond
            const noResponseDiv = document.createElement('div');
            noResponseDiv.style.textAlign = 'center';
            noResponseDiv.style.padding = '20px';
            noResponseDiv.style.color = '#95a5a6';
            noResponseDiv.innerHTML = `<p>You cannot respond:</p><p><em>${responseCheck.reason}</em></p>`;
            modal.appendChild(noResponseDiv);
        }

        // Pass button
        const buttonContainer = document.createElement('div');
        buttonContainer.style.display = 'flex';
        buttonContainer.style.justifyContent = 'center';
        buttonContainer.style.gap = '15px';
        buttonContainer.style.marginTop = '20px';

        const passBtn = document.createElement('button');
        passBtn.textContent = 'Pass (No Response)';
        Object.assign(passBtn.style, {
            padding: '12px 30px',
            fontSize: '16px',
            backgroundColor: '#7f8c8d',
            color: 'white',
            border: 'none',
            borderRadius: '8px',
            cursor: 'pointer',
            fontWeight: 'bold'
        });
        passBtn.onmouseenter = () => passBtn.style.backgroundColor = '#95a5a6';
        passBtn.onmouseleave = () => passBtn.style.backgroundColor = '#7f8c8d';
        passBtn.onclick = () => this.playerPasses(myIndex);
        buttonContainer.appendChild(passBtn);

        modal.appendChild(buttonContainer);

        overlay.appendChild(modal);
        document.body.appendChild(overlay);

        this.responseModalElement = overlay;
    }

    /**
     * Show a minimal response window for a player who qualifies for a bluff.
     *
     * Externally identical to the real response window — same header, timer, and
     * Pass button — but with no scroll cards. Only the private note (visible only
     * on this player's screen) reveals that there is nothing to actually play.
     * The player can sit here as long as they like before clicking Pass, making
     * opponents think they may be considering a response.
     */
    showBluffModal() {
        if (this.responseModalElement) {
            this.responseModalElement.remove();
        }

        // Overlay — visually identical to the real response window overlay
        const overlay = document.createElement('div');
        overlay.id = 'response-window-overlay';
        Object.assign(overlay.style, {
            position: 'fixed',
            top: '0', left: '0', right: '0', bottom: '0',
            backgroundColor: 'rgba(0, 0, 0, 0.7)',
            zIndex: '2000',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center'
        });

        // Modal — same appearance as the real response modal
        const modal = document.createElement('div');
        modal.id = 'response-window-modal';
        Object.assign(modal.style, {
            backgroundColor: '#1a1a2e',
            border: '3px solid #e94560',
            borderRadius: '15px',
            padding: '25px',
            minWidth: '450px',
            maxWidth: '600px',
            maxHeight: '80vh',
            overflowY: 'auto',
            color: 'white',
            boxShadow: '0 0 30px rgba(233, 69, 96, 0.5)'
        });

        // Header — identical to real window so observers can't distinguish
        const header = document.createElement('div');
        header.style.textAlign = 'center';
        header.style.marginBottom = '20px';

        const title = document.createElement('h2');
        title.textContent = 'RESPONSE WINDOW';
        title.style.color = '#e94560';
        title.style.margin = '0 0 10px 0';
        title.style.textTransform = 'uppercase';
        title.style.letterSpacing = '3px';
        header.appendChild(title);

        const scrollDef = this.spellSystem.patterns[this.pendingScrollData?.name];
        const scrollInfo = document.createElement('div');
        scrollInfo.innerHTML = `<strong>${this.getPlayerName(this.currentCaster)}</strong> activated <span style="color: ${this.getElementColor(scrollDef?.element)}">${scrollDef?.name || this.pendingScrollData?.name}</span>`;
        scrollInfo.style.fontSize = '16px';
        scrollInfo.style.marginBottom = '10px';
        header.appendChild(scrollInfo);

        const timerDiv = document.createElement('div');
        timerDiv.id = 'response-timer';
        timerDiv.style.fontSize = '24px';
        timerDiv.style.fontWeight = 'bold';
        timerDiv.style.color = '#f39c12';
        timerDiv.textContent = `${Math.ceil(this.RESPONSE_TIMEOUT_MS / 1000)}s`;
        header.appendChild(timerDiv);

        modal.appendChild(header);

        // Private note — only this player sees it; no scroll cards are shown
        const note = document.createElement('p');
        note.style.cssText = 'text-align:center; color:#7f8c8d; font-style:italic; margin: 10px 0 20px 0; font-size:14px;';
        note.textContent = 'You have no response scrolls - pass when ready.';
        modal.appendChild(note);

        // Pass button — wired to the same playerPasses path as the real window
        const myIndex = this.localResponderIndex();
        const buttonContainer = document.createElement('div');
        buttonContainer.style.cssText = 'display:flex; justify-content:center; margin-top:10px;';

        const passBtn = document.createElement('button');
        passBtn.textContent = 'Pass (No Response)';
        Object.assign(passBtn.style, {
            padding: '12px 30px',
            fontSize: '16px',
            backgroundColor: '#7f8c8d',
            color: 'white',
            border: 'none',
            borderRadius: '8px',
            cursor: 'pointer',
            fontWeight: 'bold'
        });
        passBtn.onmouseenter = () => passBtn.style.backgroundColor = '#95a5a6';
        passBtn.onmouseleave = () => passBtn.style.backgroundColor = '#7f8c8d';
        passBtn.onclick = () => this.playerPasses(myIndex);
        buttonContainer.appendChild(passBtn);
        modal.appendChild(buttonContainer);

        overlay.appendChild(modal);
        document.body.appendChild(overlay);

        this.responseModalElement = overlay;
    }


    /**
     * Create a scroll card for the response modal
     */
    createScrollCard(scrollInfo) {
        const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V'];
        const def = scrollInfo.definition;
        const element = def?.element || 'earth';
        const elementColor = this.getElementColor(element);
        const iconSrc = window.STONE_TYPES?.[element]?.img || '';
        const elLabel = element ? element.charAt(0).toUpperCase() + element.slice(1) : '';
        const lvLabel = def?.level ? 'Lv. ' + (ROMAN[def.level] || def.level) : '';
        const metaText = [elLabel, lvLabel].filter(Boolean).join(' · ');

        // Determine border color based on scroll type
        let borderColor = elementColor;
        if (scrollInfo.isCounter) borderColor = '#e74c3c';
        else if (scrollInfo.isResponse) borderColor = '#f39c12';

        const card = document.createElement('div');
        Object.assign(card.style, {
            backgroundColor: '#2d2d44',
            border: '2px solid ' + borderColor,
            borderRadius: '10px',
            padding: '14px',
            marginBottom: '10px',
            cursor: 'pointer',
            transition: 'all 0.2s'
        });
        card.onmouseenter = () => { card.style.backgroundColor = '#3d3d54'; card.style.transform = 'scale(1.02)'; };
        card.onmouseleave = () => { card.style.backgroundColor = '#2d2d44'; card.style.transform = 'scale(1)'; };

        // ── Header: icon · name + meta · badges ──────────────────────────
        const headerDiv = document.createElement('div');
        Object.assign(headerDiv.style, { display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' });

        if (iconSrc) {
            const icon = document.createElement('img');
            icon.src = iconSrc;
            Object.assign(icon.style, { width: '26px', height: '26px', flexShrink: '0' });
            headerDiv.appendChild(icon);
        }

        const titleWrap = document.createElement('div');
        Object.assign(titleWrap.style, { flex: '1', minWidth: '0' });

        const nameSpan = document.createElement('div');
        nameSpan.textContent = def?.name || scrollInfo.name;
        Object.assign(nameSpan.style, { fontWeight: 'bold', color: elementColor, fontSize: '15px' });
        titleWrap.appendChild(nameSpan);

        if (metaText) {
            const metaSpan = document.createElement('div');
            metaSpan.textContent = metaText;
            Object.assign(metaSpan.style, { fontSize: '11px', color: '#95a5a6', marginTop: '2px' });
            titleWrap.appendChild(metaSpan);
        }
        headerDiv.appendChild(titleWrap);

        // Badges (counter / response / common)
        const badgesWrap = document.createElement('div');
        Object.assign(badgesWrap.style, { display: 'flex', flexDirection: 'column', gap: '3px', flexShrink: '0' });
        const makeBadge = (text, bg) => {
            const b = document.createElement('span');
            b.textContent = text;
            Object.assign(b.style, { backgroundColor: bg, color: 'white', padding: '2px 7px', borderRadius: '4px', fontSize: '10px', fontWeight: 'bold', textAlign: 'center' });
            return b;
        };
        if (scrollInfo.isCounter)        badgesWrap.appendChild(makeBadge('COUNTER',  '#e74c3c'));
        if (scrollInfo.isResponse)       badgesWrap.appendChild(makeBadge('RESPONSE', '#f39c12'));
        if (scrollInfo.fromCommonArea)   badgesWrap.appendChild(makeBadge('COMMON',   '#9b59b6'));
        if (scrollInfo.isSacrificeVehicle) badgesWrap.appendChild(makeBadge('IGNORES PATTERN', '#ed1b43'));
        if (badgesWrap.children.length) headerDiv.appendChild(badgesWrap);

        card.appendChild(headerDiv);

        // ── Description ───────────────────────────────────────────────────
        const descText = scrollInfo.isSacrificeVehicle
            ? 'Activate a Level I scroll from your hand as your response, ignoring its pattern. That scroll goes to the common area.'
            : def?.description;
        if (descText) {
            const descDiv = document.createElement('div');
            descDiv.textContent = descText;
            Object.assign(descDiv.style, { fontSize: '12px', color: '#bdc3c7', marginBottom: '8px' });
            card.appendChild(descDiv);
        }

        // ── Pattern visual ────────────────────────────────────────────────
        const sp = window.spellSystem;
        if (def?.patterns && sp && typeof sp.createPatternVisual === 'function') {
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

        // ── AP cost ───────────────────────────────────────────────────────
        const displayCost = (scrollInfo && typeof scrollInfo.cost === 'number') ? scrollInfo.cost : 2;
        const costDiv = document.createElement('div');
        costDiv.textContent = `${displayCost} AP`;
        Object.assign(costDiv.style, { fontSize: '12px', color: '#f39c12', marginTop: '6px' });
        card.appendChild(costDiv);

        // Click to respond — Sacrificial Pyre opens a picker for which hand
        // scroll to activate instead of responding with itself directly.
        card.onclick = () => {
            if (scrollInfo.isSacrificeVehicle) {
                this.showSacrificialPyreResponsePicker(scrollInfo);
            } else {
                this.playerResponds(scrollInfo);
            }
        };

        return card;
    }

    /**
     * Handle player choosing to respond with a scroll.
     * If the scroll is fromHand, it is moved to the active area first.
     * Resolution is deferred until ALL eligible players have responded or passed.
     */
    playerResponds(scrollInfo, responderIndexOverride) {
        if (this._resolving) {
            console.warn(`playerResponds: ignored - resolution already in progress (player ${responderIndexOverride ?? this.localResponderIndex()}, scroll ${scrollInfo?.name})`);
            return;
        }
        const myIndex = responderIndexOverride ?? this.localResponderIndex();
        console.log(`playerResponds called: myIndex=${myIndex}, scroll=${scrollInfo.name}, fromHand=${scrollInfo.fromHand}`);

        // Double check they can still afford it
        const myAP = this.getPlayerAP(myIndex);
        const cost = (scrollInfo && typeof scrollInfo.cost === 'number')
            ? scrollInfo.cost
            : (this.spellSystem?.getSpellCost ? this.spellSystem.getSpellCost(scrollInfo.definition, myIndex) : 2);
        console.log(`  Player AP: ${myAP}, cost=${cost}`);
        if (myAP < cost) {
            this.showResponseError(`Not enough AP! Need ${cost}, have ${myAP}`);
            return;
        }

        // If scroll is in hand, move it to active area now
        if (scrollInfo.fromHand && this.spellSystem) {
            const pScrolls = this.spellSystem.playerScrolls[myIndex];
            if (pScrolls) {
                pScrolls.hand.delete(scrollInfo.name);
                pScrolls.active.add(scrollInfo.name);
                this.spellSystem.updateScrollCount();
                console.log(`  Moved ${scrollInfo.name} from hand to active area`);
            }
        }

        // Spend the AP for the response
        this.spendPlayerAP(myIndex, cost);
        console.log(`  Spent ${cost} AP for response`);

        // Badges (sql/more-badges.sql "Scroll Master"): a response scroll played by
        // the human at this screen counts as a cast. Normal casts are logged through
        // window.logScrollEvent('cast_execute'); responses never went through it.
        if (myIndex === this.localResponderIndex() && !this.isBotPlayer(myIndex) &&
            !window.isTutorialMode && !window.BotArena?.isRunning?.() && !window.Replay?.state) {
            try { window.gami?.onScrollCast?.(scrollInfo.name); } catch (e) {}
        }

        // Add response to stack
        this.responseStack.push({
            scrollData: {
                name: scrollInfo.name,
                definition: scrollInfo.definition,
                fromCommonArea: scrollInfo.fromCommonArea || false
            },
            casterIndex: myIndex,
            isCounter: scrollInfo.isCounter,
            isResponse: scrollInfo.isResponse,
            fromCommonArea: scrollInfo.fromCommonArea || false,
            isOriginal: false
        });
        console.log(`  Added to response stack, stack size: ${this.responseStack.length}`);

        // Mark this player as submitted (same pool as passes)
        this.respondingPlayers.add(myIndex);

        // Broadcast response in multiplayer (includes fromHand so receiver can sync state)
        if (typeof isMultiplayer !== 'undefined' && isMultiplayer) {
            this.broadcastResponse(scrollInfo, myIndex);
            console.log(`  Broadcasted response`);
        }

        // Only tear down THIS screen's modal when the human at this screen is
        // the one who responded. When the host's client submits on behalf of a
        // BOT (BotEffects.decideResponse via bot-driver's respondForBots), the
        // host's own response window must stay open — they haven't decided yet.
        const isLocalHuman = myIndex === this.localResponderIndex();
        if (isLocalHuman) this.closeResponseModal();

        const isCasterClient = this.isArbitratorClient();
        if (isCasterClient) {
            // Wait for all other eligible players before arbitrating
            console.log(`  Response submitted (caster client) - waiting for all players`);
            this.checkAllPlayersResponded();
        } else if (isLocalHuman) {
            // Non-caster: sent our response, wait for caster to arbitrate and broadcast result
            console.log(`  Response sent, waiting for caster to resolve`);
            this.clearResponseTimeout();
        }
    }

    /**
     * Sacrificial Pyre chosen as a response: let the player pick a Level I
     * scroll from their hand to actually respond with, ignoring its pattern.
     */
    showSacrificialPyreResponsePicker(pyreScrollInfo, responderIndexOverride) {
        const se = this.spellSystem?.scrollEffects;
        if (!se || typeof se.showScrollSelectionModal !== 'function') return;
        if (typeof window !== 'undefined' && window.logScrollEvent) {
            window.logScrollEvent('sacrificial_pyre_response_opened', {
                playerIndex: responderIndexOverride ?? this.localResponderIndex(),
                triggeringScroll: this.pendingScrollData?.name || null,
                reactionOptions: pyreScrollInfo.reactionOptions
            });
        }
        this.sacrificialPyrePicking = true;
        // Distinct modal id (NOT the shared 'scroll-select-modal') — that id is
        // in ScrollEffects.EFFECT_MODAL_IDS, which bot.js's waitForQuiescence()
        // treats as generic "bot selection UI" to drive-or-cancel every ~250ms
        // while a bot's turn is in flight. In multiplayer with a bot in the
        // game, the human's own browser IS the bot's driver (bot-driver.js
        // impersonates the bot on the host's client), so that watchdog runs
        // alongside the human's own response window. It doesn't recognize this
        // picker's heading text, so it was repeatedly cancelling it out from
        // under the player — the actual cause of the "glitching back to the
        // first response window" symptom, not the duplicate-broadcast issue
        // fixed earlier (that was real too, just not the whole story). A
        // private id keeps this picker invisible to that sweep entirely.
        se.showScrollSelectionModal(
            pyreScrollInfo.reactionOptions,
            'Sacrificial Pyre: choose a Level I scroll from your hand to activate as your response (pattern ignored):',
            (chosenScrollName) => {
                this.sacrificialPyrePicking = false;
                this.respondWithSacrificialPyre(pyreScrollInfo, chosenScrollName, responderIndexOverride);
            },
            () => { this.sacrificialPyrePicking = false; }, // cancelled — back to the response window
            'sacrificial-pyre-response-modal'
        );
    }

    /**
     * Resolve the Sacrificial Pyre response: spend Pyre's own AP cost, send
     * the chosen hand scroll straight to the common area (its normal
     * disposition), and push IT — not Pyre — onto the response stack so it
     * resolves with its real counter/response effect against the live cast.
     */
    respondWithSacrificialPyre(pyreScrollInfo, chosenScrollName, responderIndexOverride) {
        const myIndex = responderIndexOverride ?? this.localResponderIndex();
        const myAP = this.getPlayerAP(myIndex);
        if (myAP < pyreScrollInfo.cost) {
            this.showResponseError(`Not enough AP! Need ${pyreScrollInfo.cost}, have ${myAP}`);
            return;
        }

        const chosenDef = this.spellSystem?.patterns?.[chosenScrollName];
        if (!chosenDef) return;

        // Move the chosen scroll from hand straight to the common area —
        // Sacrificial Pyre's own disposition rule, same as the main-phase
        // sacrifice flow (enterScrollSacrificeMode).
        const pScrolls = this.spellSystem.playerScrolls[myIndex];
        if (pScrolls) {
            pScrolls.hand.delete(chosenScrollName);
        }
        if (this.spellSystem.discardToCommonArea) {
            this.spellSystem.discardToCommonArea(chosenScrollName);
        }
        this.spellSystem.updateScrollCount();
        if (typeof updateCommonAreaUI === 'function') updateCommonAreaUI();

        // Spend Pyre's own cost — the sacrificed scroll itself is free,
        // matching the main-phase flow.
        this.spendPlayerAP(myIndex, pyreScrollInfo.cost);
        console.log(`  Spent ${pyreScrollInfo.cost} AP for Sacrificial Pyre response`);

        // Base stone reward for the sacrificed scroll — same conversion value
        // as the main-phase flow (enterScrollSacrificeMode). Level I scrolls
        // are never catacomb, so this is always the single-element case.
        const pools = typeof playerPools !== 'undefined' ? playerPools : [];
        const poolCaps = typeof playerPoolCapacity !== 'undefined' ? playerPoolCapacity : {};
        if (pools[myIndex] && poolCaps) {
            pools[myIndex][chosenDef.element] = Math.min(
                poolCaps[chosenDef.element] || 5,
                (pools[myIndex][chosenDef.element] || 0) + chosenDef.level
            );
        }
        if (typeof updateStoneCount === 'function') updateStoneCount(chosenDef.element);

        // Using Sacrificial Pyre itself activates fire for the responder — this
        // flow bypasses the normal executeSpell/applyScrollEffects pipeline for
        // FIRE_SCROLL_3 (there's no live cast of Pyre to run it through), which
        // is what handles fire crediting for the main-phase sacrifice. The
        // sacrificed scroll's own element is credited separately once it
        // resolves off the response stack below (existing resolveResponseStack
        // → scroll-resolved → multiplayer-state.js path, unchanged).
        this.spellSystem.ensurePlayerScrollsStructure(myIndex);
        this.spellSystem.playerScrolls[myIndex].activated.add('fire');
        if (typeof updatePlayerElementSymbols === 'function') updatePlayerElementSymbols(myIndex);
        if (typeof isMultiplayer !== 'undefined' && isMultiplayer && typeof broadcastGameAction === 'function') {
            broadcastGameAction('scroll-effect', {
                playerIndex: myIndex,
                scrollName: 'FIRE_SCROLL_3',
                effectName: 'Sacrificial Pyre',
                element: 'fire',
                activatedElements: ['fire']
            });
        }
        if (typeof checkWinCondition === 'function' && checkWinCondition(myIndex, { announce: true })) {
            console.log(`🏆 Win condition met for player ${myIndex} (Sacrificial Pyre response - fire)`);
        }
        if (typeof updateStatus === 'function') {
            // withStatusActor: this response can only be initiated by a local human
            // clicking through this picker (no bot AI drives Sacrificial Pyre yet),
            // so force this through even if this client happens to be impersonating
            // an unrelated bot's turn right now.
            const show = () => updateStatus(`Sacrificial Pyre! Activated ${chosenDef.name} as your response (+${chosenDef.level} ${chosenDef.element} stones).`);
            if (typeof window !== 'undefined' && typeof window.withStatusActor === 'function') {
                window.withStatusActor(myIndex, show);
            } else {
                show();
            }
        }

        const isCounter = chosenDef.canCounter === 'any';
        const isResponse = chosenDef.isResponse === true;

        if (typeof window !== 'undefined' && window.logScrollEvent) {
            window.logScrollEvent('sacrificial_pyre_response_submitted', {
                playerIndex: myIndex,
                scrollName: chosenScrollName,
                isCounter,
                isResponse,
                triggeringScroll: this.pendingScrollData?.name || null
            });
        }

        this.responseStack.push({
            scrollData: { name: chosenScrollName, definition: chosenDef, fromCommonArea: false },
            casterIndex: myIndex,
            isCounter,
            isResponse,
            fromCommonArea: false,
            isOriginal: false,
            // Only fire counts toward win condition for a Sacrificial-Pyre
            // response (credited above) — the activated scroll's own element
            // does not, same rule as the main-phase sacrifice. Read by the
            // 'scroll-resolved' listener (multiplayer-state.js) to skip its
            // element-crediting for this entry while still running the
            // scroll's real mechanical effect (e.g. Iron Stance still cancels
            // the original cast; only the extra earth credit is suppressed).
            viaSacrificialPyre: true
        });
        console.log(`  Added ${chosenScrollName} to response stack via Sacrificial Pyre`);

        this.respondingPlayers.add(myIndex);

        if (typeof isMultiplayer !== 'undefined' && isMultiplayer) {
            this.broadcastResponse({ name: chosenScrollName, isCounter, fromHand: false, viaSacrificialPyre: true }, myIndex);
        }

        const isLocalHuman = myIndex === this.localResponderIndex();
        if (isLocalHuman) this.closeResponseModal();

        const isCasterClient = this.isArbitratorClient();
        if (isCasterClient) {
            console.log(`  Sacrificial Pyre response submitted (caster client) - waiting for all players`);
            this.checkAllPlayersResponded();
        } else if (isLocalHuman) {
            console.log(`  Sacrificial Pyre response sent, waiting for caster to resolve`);
            this.clearResponseTimeout();
        }
    }

    /**
     * Handle player passing (no response)
     */
    playerPasses(playerIndex) {
        if (this._resolving) {
            console.warn(`playerPasses: ignored - resolution already in progress (player ${playerIndex})`);
            return;
        }
        this.respondingPlayers.add(playerIndex);

        // Broadcast pass in multiplayer
        if (typeof isMultiplayer !== 'undefined' && isMultiplayer) {
            this.broadcastPass(playerIndex);
        }

        const isCasterClient = this.isArbitratorClient();

        if (isCasterClient) {
            // Caster's client: check if all non-casters have submitted
            this.checkAllPlayersResponded();
        } else if (playerIndex === this.localResponderIndex()) {
            // Non-caster's client, and it's the human at this screen who
            // passed: close the modal and wait for the caster to resolve and
            // broadcast 'response-resolved'. A pass submitted on behalf of a
            // BOT (host's respondForBots watcher) must NOT tear down the
            // host's own still-open response window or its countdown.
            this.closeResponseModal();
            this.clearResponseTimeout();
        }
    }

    /**
     * Show waiting message while other players decide
     */
    showWaitingForOthers() {
        const modal = document.getElementById('response-window-modal');
        if (!modal) return;

        // Update modal content
        modal.innerHTML = '';

        const waitDiv = document.createElement('div');
        waitDiv.style.textAlign = 'center';
        waitDiv.style.padding = '40px';

        const spinner = document.createElement('div');
        spinner.innerHTML = '&#x21bb;'; // Circular arrow
        spinner.style.fontSize = '48px';
        spinner.style.animation = 'spin 1s linear infinite';
        waitDiv.appendChild(spinner);

        const text = document.createElement('p');
        text.textContent = 'Waiting for other players...';
        text.style.fontSize = '18px';
        text.style.marginTop = '20px';
        waitDiv.appendChild(text);

        modal.appendChild(waitDiv);

        // Add spin animation if not already present
        if (!document.getElementById('response-spin-style')) {
            const style = document.createElement('style');
            style.id = 'response-spin-style';
            style.textContent = '@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }';
            document.head.appendChild(style);
        }
    }

    /**
     * Show waiting screen for the caster while others respond
     */
    showWaitingForResponses(scrollData) {
        // Remove existing modal if present
        if (this.responseModalElement) {
            this.responseModalElement.remove();
        }

        // Create overlay backdrop
        const overlay = document.createElement('div');
        overlay.id = 'response-window-overlay';
        Object.assign(overlay.style, {
            position: 'fixed',
            top: '0',
            left: '0',
            right: '0',
            bottom: '0',
            backgroundColor: 'rgba(0, 0, 0, 0.7)',
            zIndex: '2000',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center'
        });

        // Create modal
        const modal = document.createElement('div');
        modal.id = 'response-window-modal';
        Object.assign(modal.style, {
            backgroundColor: '#1a1a2e',
            border: '3px solid #27ae60',
            borderRadius: '15px',
            padding: '25px',
            minWidth: '400px',
            maxWidth: '500px',
            color: 'white',
            textAlign: 'center',
            boxShadow: '0 0 30px rgba(39, 174, 96, 0.5)'
        });

        const title = document.createElement('h2');
        title.textContent = 'SCROLL ACTIVATED';
        title.style.color = '#27ae60';
        title.style.margin = '0 0 15px 0';
        modal.appendChild(title);

        const scrollName = document.createElement('div');
        const scrollDef = this.spellSystem?.patterns?.[scrollData.name];
        scrollName.textContent = scrollDef?.name || scrollData.name;
        scrollName.style.fontSize = '20px';
        scrollName.style.fontWeight = 'bold';
        scrollName.style.color = this.getElementColor(scrollDef?.element);
        scrollName.style.marginBottom = '20px';
        modal.appendChild(scrollName);

        const waitDiv = document.createElement('div');
        waitDiv.style.padding = '20px';

        const spinner = document.createElement('div');
        spinner.innerHTML = '&#x21bb;';
        spinner.style.fontSize = '36px';
        spinner.style.animation = 'spin 1s linear infinite';
        waitDiv.appendChild(spinner);

        const text = document.createElement('p');
        text.textContent = 'Waiting for other players to respond...';
        text.style.fontSize = '16px';
        text.style.marginTop = '15px';
        text.style.color = '#bdc3c7';
        waitDiv.appendChild(text);

        modal.appendChild(waitDiv);

        // Timer display
        const timerDiv = document.createElement('div');
        timerDiv.id = 'response-timer';
        timerDiv.style.fontSize = '20px';
        timerDiv.style.fontWeight = 'bold';
        timerDiv.style.color = '#f39c12';
        timerDiv.style.marginTop = '10px';
        timerDiv.textContent = `${Math.ceil(this.RESPONSE_TIMEOUT_MS / 1000)}s`;
        modal.appendChild(timerDiv);

        overlay.appendChild(modal);
        document.body.appendChild(overlay);
        this.responseModalElement = overlay;

        // Add spin animation if not already present
        if (!document.getElementById('response-spin-style')) {
            const style = document.createElement('style');
            style.id = 'response-spin-style';
            style.textContent = '@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }';
            document.head.appendChild(style);
        }
    }

    /**
     * Generate a unique id for one resolved response/counter event. The same
     * logical event reaches clients via several broadcast paths, so the id
     * lets ScrollEffects.addPendingBuff dedup echoes without collapsing a
     * genuine repeat (e.g. the same scroll Psychic'd twice in one turn).
     */
    generateEventId() {
        return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
    }

    /**
     * Whether playerIndex is bot-controlled right now — either a bot added via
     * the lobby's "Add Bot" button (host-driven, BotDriver.isBot) or any player
     * during a headless/self-play BotArena match (every seat is a bot there).
     * Used to skip the Psychic ransom UI, which no bot can click through.
     */
    isBotControlledCaster(playerIndex) {
        if (typeof window === 'undefined') return false;
        if (typeof window.BotDriver?.isBot === 'function' && window.BotDriver.isBot(playerIndex)) return true;
        if (typeof window.BotArena?.isRunning === 'function' && window.BotArena.isRunning()) return true;
        return false;
    }

    /**
     * Ask the original caster whether to pay AP to negate Psychic.
     * Runs only on the original caster's client (the one that arbitrates and
     * resolves the stack), so no extra multiplayer round-trip is needed.
     * Defaults to declining (counter + steal proceed) when the timer expires.
     */
    showPsychicRansomPrompt(psychicEntry, originalScroll, onDecision) {
        const cost = this.PSYCHIC_RANSOM_AP;
        const responderName = this.getPlayerName(psychicEntry.casterIndex);
        const origDef = originalScroll.scrollData?.definition
            || this.spellSystem?.patterns?.[originalScroll.scrollData?.name];
        const origName = origDef?.name || originalScroll.scrollData?.name;

        const overlay = document.createElement('div');
        overlay.id = 'psychic-ransom-overlay';
        Object.assign(overlay.style, {
            position: 'fixed',
            top: '0', left: '0', right: '0', bottom: '0',
            backgroundColor: 'rgba(0, 0, 0, 0.7)',
            zIndex: '2100',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center'
        });

        const modal = document.createElement('div');
        Object.assign(modal.style, {
            backgroundColor: '#1a1a2e',
            border: '3px solid #9458f4',
            borderRadius: '15px',
            padding: '25px',
            minWidth: '400px',
            maxWidth: '550px',
            color: 'white',
            textAlign: 'center',
            boxShadow: '0 0 30px rgba(148, 88, 244, 0.5)'
        });

        const title = document.createElement('h2');
        title.textContent = 'PSYCHIC!';
        title.style.color = '#9458f4';
        title.style.margin = '0 0 15px 0';
        modal.appendChild(title);

        const info = document.createElement('div');
        info.style.fontSize = '16px';
        info.style.marginBottom = '15px';
        info.innerHTML = `<strong>${responderName}</strong> cast Psychic to counter and steal <span style="color: ${this.getElementColor(origDef?.element)}">${origName}</span>.<br><br>Pay <strong>${cost} AP</strong> to negate Psychic? Your scroll will resolve normally.`;
        modal.appendChild(info);

        const timerDiv = document.createElement('div');
        timerDiv.style.fontSize = '20px';
        timerDiv.style.fontWeight = 'bold';
        timerDiv.style.color = '#f39c12';
        timerDiv.textContent = `${Math.ceil(this.RESPONSE_TIMEOUT_MS / 1000)}s`;
        modal.appendChild(timerDiv);

        let decided = false;
        let remaining = this.RESPONSE_TIMEOUT_MS;
        let timerInterval = null;

        const decide = (paid) => {
            if (decided) return;
            decided = true;
            if (timerInterval) clearInterval(timerInterval);
            overlay.remove();
            if (paid) {
                // This client belongs to the original caster, so the global
                // spendAP inside spendPlayerAP charges the right player
                this.spendPlayerAP(originalScroll.casterIndex, cost);
                if (typeof isMultiplayer !== 'undefined' && isMultiplayer && typeof syncPlayerState === 'function') {
                    syncPlayerState();
                }
                if (typeof updateStatus === 'function') {
                    updateStatus(`Paid ${cost} AP - Psychic negated! Your scroll resolves.`);
                }
            }
            onDecision(paid);
        };

        timerInterval = setInterval(() => {
            remaining -= 1000;
            timerDiv.textContent = `${Math.ceil(remaining / 1000)}s`;
            if (remaining <= 5000) timerDiv.style.color = '#e74c3c';
            if (remaining <= 0) decide(false); // timeout = decline
        }, 1000);

        const buttonRow = document.createElement('div');
        Object.assign(buttonRow.style, {
            display: 'flex',
            justifyContent: 'center',
            gap: '15px',
            marginTop: '20px'
        });

        const payBtn = document.createElement('button');
        payBtn.textContent = `Pay ${cost} AP - Negate Psychic`;
        Object.assign(payBtn.style, {
            padding: '12px 24px',
            fontSize: '15px',
            backgroundColor: '#27ae60',
            color: 'white',
            border: 'none',
            borderRadius: '8px',
            cursor: 'pointer',
            fontWeight: 'bold'
        });
        payBtn.onclick = () => decide(true);
        buttonRow.appendChild(payBtn);

        const declineBtn = document.createElement('button');
        declineBtn.textContent = 'Decline - let it be stolen';
        Object.assign(declineBtn.style, {
            padding: '12px 24px',
            fontSize: '15px',
            backgroundColor: '#7f8c8d',
            color: 'white',
            border: 'none',
            borderRadius: '8px',
            cursor: 'pointer',
            fontWeight: 'bold'
        });
        declineBtn.onclick = () => decide(false);
        buttonRow.appendChild(declineBtn);

        modal.appendChild(buttonRow);
        overlay.appendChild(modal);
        document.body.appendChild(overlay);
    }

    /**
     * Resolve the response stack (LIFO order)
     * FIFO for resolution: responses resolve first, then original scroll
     */
    resolveResponseStack() {
        // Re-entrancy guard: the timeout force-resolve and a late response/pass
        // can both trigger resolution — only the first may proceed. Also covers
        // the window where the Psychic ransom prompt is open (resolution started
        // but not finished). Reset when a new response window opens.
        if (this._resolving) {
            console.warn('resolveResponseStack: resolution already in progress - ignoring duplicate trigger');
            return;
        }
        this._resolving = true;
        this.clearResponseTimeout();
        this.closeResponseModal();

        // Separate responses from original
        let originalScroll = null;
        const responses = [];
        while (this.responseStack.length > 0) {
            const entry = this.responseStack.pop();
            if (entry.isOriginal) {
                originalScroll = entry;
            } else {
                responses.push(entry);
            }
        }

        // Psychic ransom: the original caster may pay AP to negate Psychic so
        // their scroll resolves normally. Only the original caster's client
        // resolves the stack, so the prompt is purely local — other clients
        // just keep waiting for the response-resolved broadcast. No prompt if
        // the caster can't afford it (the counter + steal proceed as normal).
        const psychicEntry = responses.find(e => e.isCounter && e.scrollData?.name === 'VOID_SCROLL_1');
        if (psychicEntry && originalScroll && this.getPlayerAP(originalScroll.casterIndex) >= this.PSYCHIC_RANSOM_AP) {
            if (this.isBotControlledCaster(originalScroll.casterIndex)) {
                // Bots always pay if they can afford it — no UI, no timer.
                this.spendPlayerAP(originalScroll.casterIndex, this.PSYCHIC_RANSOM_AP);
                if (typeof isMultiplayer !== 'undefined' && isMultiplayer && typeof syncPlayerState === 'function') {
                    syncPlayerState();
                }
                this.finishResponseResolution(responses, originalScroll, true);
                return;
            }
            this.showPsychicRansomPrompt(psychicEntry, originalScroll, (paid) => {
                this.finishResponseResolution(responses, originalScroll, paid);
            });
            return;
        }

        this.finishResponseResolution(responses, originalScroll, false);
    }

    /**
     * Apply the resolution decided by resolveResponseStack (and by the Psychic
     * ransom prompt, when one was shown).
     * @param {boolean} ransomPaid - The original caster paid to negate Psychic
     */
    finishResponseResolution(responses, originalScroll, ransomPaid) {
        const results = [];
        let cancelled = false;

        // Process responses first (FIFO - they were added in order)
        for (const entry of responses) {
            const scrollDef = entry.scrollData?.definition || this.spellSystem?.patterns?.[entry.scrollData?.name];

            // A oncePerTurn response/counter scroll is resolving — lock out further
            // response scrolls for the rest of this turn (one total per turn).
            if (scrollDef?.oncePerTurn && this.spellSystem?.scrollEffects) {
                this.spellSystem.scrollEffects.responseScrollUsedThisTurn = true;
            }

            if (ransomPaid && entry.isCounter && entry.scrollData?.name === 'VOID_SCROLL_1') {
                // Ransom paid: Psychic is negated — no counter, no steal, and its
                // effect is never executed (so no pending steal gets queued).
                // The scroll still moves to the common area: it was cast.
                const negatedEntry = {
                    ...entry,
                    result: 'counter-negated',
                    eventId: this.generateEventId()
                };
                results.push(negatedEntry);

                if (typeof window !== 'undefined' && window.logScrollEvent) {
                    window.logScrollEvent('counter_negated', {
                        casterIndex: entry.casterIndex,
                        scrollName: entry.scrollData?.name,
                        triggeringScroll: originalScroll?.scrollData?.name || null,
                        ransomAP: this.PSYCHIC_RANSOM_AP
                    });
                }

                // Dispatch so the scroll-resolved listener moves Psychic to the
                // common area WITHOUT running its effect
                this.executeScrollEffect(negatedEntry, originalScroll);
            } else if (entry.isCounter) {
                // This is a counter - it cancels the original scroll
                cancelled = true;
                const counterEntry = {
                    ...entry,
                    result: 'countered-original',
                    eventId: this.generateEventId()
                };
                results.push(counterEntry);

                // AP was already spent when the counter was played (line ~439)
                // Do NOT spend again here — spendPlayerAP ignores playerIndex
                // and would charge the original caster's AP instead

                if (typeof window !== 'undefined' && window.logScrollEvent) {
                    window.logScrollEvent('response_counter', {
                        casterIndex: entry.casterIndex,
                        scrollName: entry.scrollData?.name,
                        triggeringScroll: originalScroll?.scrollData?.name || null
                    });
                }

                // Execute the counter's effect (if any) — must pass counterEntry so
                // the scroll-resolved listener sees result === 'countered-original'
                this.executeScrollEffect(counterEntry, originalScroll);
            } else if (entry.isResponse || scrollDef?.isResponse) {
                // This is a response scroll (like Unbidden Lamplight)
                // It executes but does NOT cancel the original
                const resolvedEntry = {
                    ...entry,
                    result: 'response-resolved',
                    eventId: this.generateEventId()
                };
                results.push(resolvedEntry);

                // AP was already spent when the response was played (line ~439)
                // Do NOT spend again here — spendPlayerAP ignores playerIndex
                // and would charge the original caster's AP instead

                if (typeof window !== 'undefined' && window.logScrollEvent) {
                    window.logScrollEvent('response_resolved', {
                        casterIndex: entry.casterIndex,
                        scrollName: entry.scrollData?.name,
                        triggeringScroll: originalScroll?.scrollData?.name || null
                    });
                }

                // Execute the response scroll's effect, passing the original scroll info
                this.executeScrollEffect(resolvedEntry, originalScroll);
            }
        }

        // Now resolve the original scroll (if not cancelled)
        if (originalScroll) {
            if (cancelled) {
                if (typeof window !== 'undefined' && window.logScrollEvent) {
                    window.logScrollEvent('original_countered', {
                        casterIndex: originalScroll.casterIndex,
                        scrollName: originalScroll.scrollData?.name
                    });
                }
                results.push({
                    ...originalScroll,
                    result: 'countered'
                });
            } else {
                if (typeof window !== 'undefined' && window.logScrollEvent) {
                    window.logScrollEvent('original_resolved', {
                        casterIndex: originalScroll.casterIndex,
                        scrollName: originalScroll.scrollData?.name
                    });
                }
                const originalResolvedEntry = { ...originalScroll, result: 'resolved' };
                results.push(originalResolvedEntry);
                this.executeScrollEffect(originalResolvedEntry, null);
            }
        }

        // Close response window state
        this.isResponseWindowOpen = false;
        this.pendingScrollData = null;
        this.currentCaster = null;

        // Defensive: cross-effect coupling flags must not survive the resolution
        // that set them — a stale flag would mis-redirect a future cast of the
        // same scroll. All consumers ran synchronously above (the scroll-resolved
        // dispatch), so anything still set here is an unconsumed leftover.
        const fx = this.spellSystem?.scrollEffects;
        if (fx?.pendingForceCommonArea) {
            console.warn('Clearing unconsumed pendingForceCommonArea:', fx.pendingForceCommonArea);
            delete fx.pendingForceCommonArea;
        }
        if (fx?.pendingHandRedirect) {
            console.warn('Clearing unconsumed pendingHandRedirect:', fx.pendingHandRedirect);
            fx.pendingHandRedirect = null;
        }

        // Broadcast resolution to all clients so they close their windows
        if (typeof isMultiplayer !== 'undefined' && isMultiplayer) {
            this.broadcastResponseResolved(results, originalScroll);
        }

        // Call completion callback exactly once — a stale callback re-invoked by
        // a duplicate resolution would re-apply the original scroll's effects
        const onComplete = this.onCompleteCallback;
        this.onCompleteCallback = null;
        if (onComplete) {
            onComplete({
                skipped: false,
                responses: results
            });
        }
    }

    /**
     * Execute a scroll's effect
     * @param {object} entry - The scroll entry to execute
     * @param {object} triggeringScroll - For response scrolls, the original scroll that triggered this response
     */
    executeScrollEffect(entry, triggeringScroll = null) {
        // This delegates back to the main spell system
        // The actual effect execution is handled there
        if (this.spellSystem && typeof this.spellSystem.executeSpell === 'function') {
            // Note: We don't call executeSpell directly here because that would
            // open another response window. Instead, we'll emit an event that
            // the main game loop handles to apply effects without re-triggering responses.
            if (typeof window !== 'undefined') {
                // Resolve the scroll definition from scrollData: it may be stored
                // as .definition OR .spell depending on the source.
                const trigDef = triggeringScroll
                    ? (triggeringScroll.scrollData?.definition
                       || triggeringScroll.scrollData?.spell
                       || this.spellSystem.patterns?.[triggeringScroll.scrollData?.name])
                    : null;

                window.dispatchEvent(new CustomEvent('scroll-resolved', {
                    detail: {
                        ...entry,
                        // Promote fromCommonArea to top-level so the listener can access it directly
                        fromCommonArea: entry.fromCommonArea ?? entry.scrollData?.fromCommonArea ?? false,
                        triggeringScroll: triggeringScroll ? {
                            name: triggeringScroll.scrollData?.name,
                            casterIndex: triggeringScroll.casterIndex,
                            definition: trigDef
                        } : null
                    }
                }));
            }
        }
    }

    /**
     * Close the response modal
     */
    closeResponseModal() {
        if (this.responseModalElement) {
            this.responseModalElement.remove();
            this.responseModalElement = null;
        }
    }

    /**
     * Start the response timeout timer
     */
    startResponseTimeout() {
        this.clearResponseTimeout();

        let remaining = this.RESPONSE_TIMEOUT_MS;
        const timerEl = document.getElementById('response-timer');

        this.responseTimeout = setInterval(() => {
            remaining -= 1000;
            if (timerEl) {
                timerEl.textContent = `${Math.ceil(remaining / 1000)}s`;
                if (remaining <= 5000) {
                    timerEl.style.color = '#e74c3c';
                }
            }

            if (remaining <= 0) {
                this.clearResponseTimeout();
                // Time's up - force resolve
                const myIndex = typeof myPlayerIndex !== 'undefined' ? myPlayerIndex : activePlayerIndex;
                const isCasterClient = !(typeof isMultiplayer !== 'undefined' && isMultiplayer) || myIndex === this.currentCaster;
                if (isCasterClient) {
                    // Caster: all remaining players are treated as passes — force resolve
                    console.log('⏰ Response timeout on caster client - force resolving');
                    this.resolveResponseStack();
                } else {
                    // Non-caster: auto-pass
                    this.playerPasses(myIndex);
                }
            }
        }, 1000);
    }

    /**
     * Clear the response timeout
     */
    clearResponseTimeout() {
        if (this.responseTimeout) {
            clearInterval(this.responseTimeout);
            this.responseTimeout = null;
        }
    }

    /**
     * Show error message in response modal
     */
    showResponseError(message) {
        const modal = document.getElementById('response-window-modal');
        if (!modal) return;

        const errorDiv = document.createElement('div');
        Object.assign(errorDiv.style, {
            backgroundColor: '#e74c3c',
            color: 'white',
            padding: '10px',
            borderRadius: '5px',
            textAlign: 'center',
            marginBottom: '10px'
        });
        errorDiv.textContent = message;
        modal.insertBefore(errorDiv, modal.firstChild);

        setTimeout(() => errorDiv.remove(), 3000);
    }

    // Helper methods that interface with the game state
    getPlayerAP(playerIndex) {
        // Host driving a bot: while impersonating, the shared `currentAP` belongs
        // to the BOT, not to the host. The host's own response AP is preserved by
        // BotDriver — read it from there so the host can afford (and correctly
        // spend) responses to the bot's spells.
        const driverIdx = (typeof window !== 'undefined' && window.BotDriver
            && typeof window.BotDriver.driverRealIndex === 'function')
            ? window.BotDriver.driverRealIndex() : null;
        if (driverIdx != null && playerIndex === driverIdx
                && typeof window.BotDriver.getDriverAP === 'function') {
            return window.BotDriver.getDriverAP();
        }

        // For the local player, currentAP is always the live authoritative value.
        // playerAPs[myPlayerIndex] can be a stale snapshot (e.g. from the start of their
        // last turn), which would let the affordability check pass even when currentAP is 0
        // and cause spendAP to drive AP negative.
        if (typeof myPlayerIndex !== 'undefined' && playerIndex === myPlayerIndex
                && typeof currentAP !== 'undefined') {
            const localVoidAP = typeof voidAP !== 'undefined' ? voidAP : 0;
            return currentAP + localVoidAP;
        }
        // For other players, use the synced playerAPs snapshot
        if (typeof playerAPs !== 'undefined' && playerAPs[playerIndex]) {
            const ap = playerAPs[playerIndex];
            return (ap.currentAP || 0) + (ap.voidAP || 0);
        }
        // Fallback
        if (typeof currentAP !== 'undefined') {
            return currentAP;
        }
        return 0;
    }

    spendPlayerAP(playerIndex, amount) {
        // Host driving a bot: spend from the host's preserved response AP so the
        // global spendAP (which mutates the impersonated bot's currentAP) is not
        // charged for the host's response.
        const driverIdx = (typeof window !== 'undefined' && window.BotDriver
            && typeof window.BotDriver.driverRealIndex === 'function')
            ? window.BotDriver.driverRealIndex() : null;
        if (driverIdx != null && playerIndex === driverIdx
                && typeof window.BotDriver.spendDriverAP === 'function') {
            window.BotDriver.spendDriverAP(amount);
            return;
        }

        // A responder with no live client of their own on THIS browser — a bot
        // (it never has its own tab) or, in local/hot-seat/arena play, any
        // player who isn't the one currently active (currentAP only ever holds
        // ONE player's value at a time on a single client — see
        // game-core.js's syncPlayerState). Genuine remote human opponents in
        // real multiplayer keep the plain spendAP() path below: on their OWN
        // client, currentAP is unambiguously theirs regardless of whose turn
        // it officially is.
        const isMultiplayerNow = typeof isMultiplayer !== 'undefined' && isMultiplayer;
        const isUnclientedBot = typeof window !== 'undefined' && window.BotDriver
            && typeof window.BotDriver.isBot === 'function' && window.BotDriver.isBot(playerIndex);
        const isActive = typeof activePlayerIndex !== 'undefined' && playerIndex === activePlayerIndex;
        if (!isActive && (!isMultiplayerNow || isUnclientedBot) && typeof playerAPs !== 'undefined') {
            if (!playerAPs[playerIndex]) playerAPs[playerIndex] = { currentAP: 5, voidAP: 0 };
            const p = playerAPs[playerIndex];
            const fromVoid = Math.min(p.voidAP || 0, amount);
            p.voidAP = (p.voidAP || 0) - fromVoid;
            p.currentAP = Math.max(0, (p.currentAP || 0) - (amount - fromVoid));
            return;
        }

        if (typeof spendAP === 'function') {
            spendAP(amount);
        }
    }

    getPlayerPosition(playerIndex) {
        if (typeof playerPositions !== 'undefined' && playerPositions[playerIndex]) {
            return playerPositions[playerIndex];
        }
        return null;
    }

    getPlayerName(playerIndex) {
        if (typeof playerPositions !== 'undefined' && playerPositions[playerIndex]?.username) {
            const raw = playerPositions[playerIndex].username;
            return typeof displayUsername === 'function' ? displayUsername(raw) : raw;
        }
        return `Player ${playerIndex + 1}`;
    }

    getElementColor(element) {
        const colors = {
            earth: '#69d83a',
            water: '#5894f4',
            fire: '#ed1b43',
            wind: '#ffce00',
            void: '#9458f4',
            catacomb: '#9b59b6'
        };
        return colors[element] || '#ffffff';
    }

    checkPatternForPlayer(scrollName, playerIndex) {
        // Delegate to spell system's pattern check for specific player
        if (this.spellSystem && typeof this.spellSystem.checkPatternForPlayer === 'function') {
            return this.spellSystem.checkPatternForPlayer(scrollName, playerIndex);
        }
        // Fallback to basic check if method doesn't exist
        if (this.spellSystem && typeof this.spellSystem.checkPattern === 'function') {
            return this.spellSystem.checkPattern(scrollName);
        }
        return false;
    }

    // Multiplayer broadcast methods
    broadcastResponseWindowOpened(scrollData, casterIndex) {
        if (typeof broadcastGameAction === 'function') {
            // Include the current common area state so receiving clients can apply it
            // before checking canPlayerRespond — avoids a race condition where
            // common-area-update (e.g. Psychic moving there) hasn't arrived yet.
            const commonAreaSnapshot = this.spellSystem?.commonArea
                ? { ...this.spellSystem.commonArea }
                : null;
            broadcastGameAction('response-window-opened', {
                scrollName: scrollData.name,
                casterIndex: casterIndex,
                commonArea: commonAreaSnapshot
            });
        }
    }

    broadcastResponse(scrollInfo, playerIndex) {
        if (typeof broadcastGameAction === 'function') {
            broadcastGameAction('scroll-response', {
                scrollName: scrollInfo.name,
                playerIndex: playerIndex,
                isCounter: scrollInfo.isCounter,
                fromHand: scrollInfo.fromHand ?? false,
                viaSacrificialPyre: scrollInfo.viaSacrificialPyre ?? false
            });
        }
    }

    broadcastPass(playerIndex) {
        if (typeof broadcastGameAction === 'function') {
            broadcastGameAction('response-pass', {
                playerIndex: playerIndex
            });
        }
    }

    broadcastResponseResolved(results, originalScroll = null) {
        if (typeof broadcastGameAction === 'function') {
            // Resolve the original scroll's definition for the broadcast so remote
            // clients can store it (e.g. for Reflect's deferred activation).
            let trigDef = null;
            if (originalScroll) {
                trigDef = originalScroll.scrollData?.definition
                    || originalScroll.scrollData?.spell
                    || this.spellSystem?.patterns?.[originalScroll.scrollData?.name]
                    || null;
            }
            broadcastGameAction('response-resolved', {
                results: results.map(r => ({
                    scrollName: r.scrollData?.name,
                    casterIndex: r.casterIndex,
                    result: r.result,
                    isResponse: r.isResponse,
                    eventId: r.eventId || null
                })),
                triggeringScroll: originalScroll ? {
                    name: originalScroll.scrollData?.name,
                    casterIndex: originalScroll.casterIndex,
                    definition: trigDef,
                    fromCommonArea: originalScroll.scrollData?.fromCommonArea ?? originalScroll.fromCommonArea ?? false
                } : null
            });
        }
    }

    /**
     * Handle remote response resolution - close window on all clients
     */
    handleRemoteResolved() {
        console.log('Remote response window resolved');
        this.clearResponseTimeout();
        this.closeResponseModal();
        this.isResponseWindowOpen = false;
        this.pendingScrollData = null;
        this.currentCaster = null;
        this.respondingPlayers.clear();
    }

    // Methods for handling remote multiplayer events

    /**
     * Show response modal for a non-casting player (called when receiving broadcast)
     */
    showResponseModalForOtherPlayer(scrollData, casterIndex) {
        // Guard against a duplicate/replayed 'response-window-opened' broadcast
        // for a cast this player is already actively handling — whether they've
        // already responded/passed, or are still mid-decision (e.g. browsing the
        // Sacrificial Pyre hand-scroll picker, which takes a few extra seconds
        // and widens the window for a duplicate to land). Once a response window
        // is open for a given cast it should stay open in whatever sub-state
        // it's in until IT resolves — re-running the reset below for the SAME
        // cast would otherwise wipe an in-flight response, or yank the picker
        // out from under the player and dump them back at the main response
        // list, which is exactly the "keeps glitching back" symptom this fixes.
        if (this.isResponseWindowOpen && this.currentCaster === casterIndex
                && this.pendingScrollData?.name === scrollData?.name) {
            console.log('Ignoring duplicate response-window-opened broadcast for a cast already being handled');
            return;
        }

        this._resolving = false;
        this.isResponseWindowOpen = true;
        this.currentCaster = casterIndex;
        this.pendingScrollData = scrollData;
        this.respondingPlayers.clear();
        // The caster is already considered to have "responded" (they cast the spell)
        this.respondingPlayers.add(casterIndex);
        this.responseStack = [{
            scrollData,
            casterIndex,
            isOriginal: true
        }];

        // Determine what this player can do:
        //   canRespond → show the real response window with scroll options
        //   canBluff   → show a minimal window (no scroll options) so they can pass
        //                at their leisure without leaking that they have nothing to play
        //   neither    → auto-pass instantly
        this.presentResponderView(scrollData, casterIndex);
    }

    /**
     * Handle a remote player passing
     */
    handleRemotePass(playerIndex) {
        console.log(`Remote player ${playerIndex} passed`);

        // Late arrival after resolution started — nothing left to count
        if (this._resolving) {
            console.warn(`Late pass from player ${playerIndex} ignored - resolution already in progress`);
            return;
        }
        this.respondingPlayers.add(playerIndex);

        // Check if all non-caster players have responded
        this.checkAllPlayersResponded();
    }

    /**
     * Handle a remote player responding with a scroll.
     * Defers resolution until all eligible players have submitted.
     * @param {string} scrollName
     * @param {number} playerIndex
     * @param {boolean} isCounter
     * @param {boolean} fromHand - if true, move scroll from hand to active on this client
     * @param {boolean} viaSacrificialPyre - if true, scroll came from hand straight to
     *   the common area (the sender already broadcast that move via discardToCommonArea's
     *   own 'common-area-update' event) — just sync the hand removal here, no active add.
     */
    handleRemoteResponse(scrollName, playerIndex, isCounter, fromHand = false, viaSacrificialPyre = false) {
        console.log(`Remote player ${playerIndex} responded with ${scrollName} (fromHand=${fromHand}, viaSacrificialPyre=${viaSacrificialPyre})`);

        // Late arrival: resolution already started (e.g. timeout force-resolve
        // crossed with this broadcast) — do not mutate the stack mid-resolution
        if (this._resolving) {
            console.warn(`Late response from player ${playerIndex} ignored - resolution already in progress`);
            return;
        }

        if (viaSacrificialPyre && this.spellSystem) {
            const pScrolls = this.spellSystem.playerScrolls[playerIndex];
            if (pScrolls) {
                pScrolls.hand.delete(scrollName);
                this.spellSystem.updateScrollCount();
            }
        } else if (fromHand && this.spellSystem) {
            // If scroll came from hand, sync the hand→active move on this client
            const pScrolls = this.spellSystem.playerScrolls[playerIndex];
            if (pScrolls) {
                pScrolls.hand.delete(scrollName);
                pScrolls.active.add(scrollName);
                this.spellSystem.updateScrollCount();
                if (typeof updateCommonAreaUI === 'function') updateCommonAreaUI();
            }
        }

        const scrollDef = this.spellSystem.patterns[scrollName];
        this.responseStack.push({
            scrollData: { name: scrollName, definition: scrollDef },
            casterIndex: playerIndex,
            isCounter: isCounter,
            isResponse: scrollDef?.isResponse || false,
            fromCommonArea: false,
            isOriginal: false
        });

        // Mark this player as submitted
        this.respondingPlayers.add(playerIndex);

        // Only the caster's client arbitrates. Non-caster clients wait for 'response-resolved'.
        const myIndex = typeof myPlayerIndex !== 'undefined' ? myPlayerIndex : null;
        const isCasterClient = !(typeof isMultiplayer !== 'undefined' && isMultiplayer) || myIndex === this.currentCaster;
        if (isCasterClient) {
            // Wait for all other eligible players before resolving
            console.log(`  Response from player ${playerIndex} received (caster client) - checking all submitted`);
            this.checkAllPlayersResponded();
        } else {
            console.log(`  Response received, waiting for caster to resolve`);
            this.clearResponseTimeout();
        }
    }

    /**
     * Check if all non-caster players have submitted (responded or passed).
     * Only the caster's client calls this; non-casters wait for 'response-resolved'.
     * When all have submitted, arbitrates by element rank and resolves.
     */
    checkAllPlayersResponded() {
        const myIndex = typeof myPlayerIndex !== 'undefined' ? myPlayerIndex : null;
        const isCasterClient = !(typeof isMultiplayer !== 'undefined' && isMultiplayer) || myIndex === this.currentCaster;
        if (!isCasterClient) {
            return; // Non-caster: do nothing, wait for broadcast
        }

        const numPlayers = typeof playerPositions !== 'undefined' ? playerPositions.length : 1;

        // All non-caster players must submit (respond or pass) before we
        // arbitrate — including bots (BotEffects.decideResponse, driven from
        // bot-driver.js's watcher, submits on their behalf). If a bot's host
        // never gets to it for some reason, the 15s response timeout still
        // force-resolves the stack as a safety net (startResponseTimeout).
        let expectedResponders = 0;
        for (let i = 0; i < numPlayers; i++) {
            if (i === this.currentCaster) continue;
            if (typeof playerPositions !== 'undefined' && !playerPositions[i]) continue;
            expectedResponders++;
        }
        const requiredResponders = expectedResponders + 1; // +1 for caster (already in set)
        console.log(`Response check: ${this.respondingPlayers.size} submitted, ${requiredResponders} expected`);

        if (this.respondingPlayers.size >= requiredResponders) {
            // All players have submitted — arbitrate by element rank
            this._arbitrateAndResolve();
        } else if (this.respondingPlayers.has(this.localResponderIndex())) {
            // Still waiting — show the waiting screen, but ONLY once the human
            // at this screen has submitted. On a host arbitrating for a bot
            // caster, other players' passes/responses land here while the
            // host's own response window is still open — swapping in the
            // waiting spinner would wipe their response options mid-decision.
            this.showWaitingForOthers();
        }
    }

    /**
     * Sort submitted responses by element rank (Void > Wind > Fire > Water > Earth).
     * Only the highest-ranked response executes; others' AP is already spent.
     * Then delegates to resolveResponseStack() for effect execution and broadcast.
     */
    _arbitrateAndResolve() {
        // Separate responses from original
        const responses = this.responseStack.filter(e => !e.isOriginal);
        const original  = this.responseStack.find(e => e.isOriginal);

        if (responses.length > 1) {
            // Sort descending by element rank
            responses.sort((a, b) =>
                getScrollElementRank(b.scrollData?.name) - getScrollElementRank(a.scrollData?.name)
            );
            const winner  = responses[0];
            const losers  = responses.slice(1);
            console.log(`⚖️ Arbitration: winner = ${winner.scrollData?.name} (rank ${getScrollElementRank(winner.scrollData?.name)})`);
            losers.forEach(l => console.log(`  ✗ Loser (AP spent, no effect): ${l.scrollData?.name}`));
            // Rebuild stack: original first, then winner (pop() is LIFO → winner resolved first)
            this.responseStack = [];
            if (original) this.responseStack.push(original);
            this.responseStack.push(winner);
        }
        // If 0 or 1 responses, stack is already correct — just resolve
        this.resolveResponseStack();
    }
}

// Export for use
if (typeof window !== 'undefined') {
    window.ResponseWindowSystem = ResponseWindowSystem;
}
