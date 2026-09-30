        // ========================================
        // AUTH SYSTEM (Supabase Auth)
        // ========================================

        // On page load: restore an existing session so the user doesn't have to log in again
        async function checkAuthSession() {
            const { data: { session } } = await supabase.auth.getSession();
            if (session) {
                onAuthSuccess(session.user);
            }
        }

        async function authLogin() {
            const username = document.getElementById('auth-username').value.trim();
            const password = document.getElementById('auth-password').value;
            if (!username || !password) { showAuthError('Please enter a username and password.'); return; }

            setAuthLoading(true);
            const email = username.toLowerCase() + '@godaigo.game';
            const { data, error } = await supabase.auth.signInWithPassword({ email, password });
            setAuthLoading(false);

            if (error) { showAuthError(error.message); return; }
            onAuthSuccess(data.user);
        }

        // Sign In screen <-> Create Account screen. The Create Account screen
        // adds the optional email + news-email box and hides Log In, Forgot
        // password, Guest and Tutorial (.auth-login-only / .auth-register-only,
        // css/paper-ui-lobby.css).
        function setAuthMode(mode) {
            const screen = document.getElementById('auth-screen');
            const register = mode === 'register';
            screen?.classList.toggle('mode-register', register);
            const title = document.getElementById('auth-title');
            if (title) title.textContent = register ? 'Create Account' : 'Sign In';
            const regBtn = document.getElementById('auth-register-btn');
            if (regBtn) regBtn.textContent = register ? 'Create Account' : 'Register';
            const err = document.getElementById('auth-error');
            if (err) err.style.display = 'none';
            document.getElementById('auth-username')?.focus();
        }
        window.setAuthMode = setAuthMode;

        async function authRegister() {
            // On the Sign In screen, "Register" opens the Create Account screen.
            if (!document.getElementById('auth-screen')?.classList.contains('mode-register')) {
                setAuthMode('register');
                return;
            }
            const username = document.getElementById('auth-username').value.trim();
            const password = document.getElementById('auth-password').value;
            const recoveryEmail = (document.getElementById('auth-email')?.value || '').trim();
            const newsletter = !!document.getElementById('auth-newsletter')?.checked;
            if (recoveryEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recoveryEmail)) {
                showAuthError('That email does not look right. Fix it, or leave it empty.');
                return;
            }
            if (newsletter && !recoveryEmail) {
                showAuthError('Add your email to get the news emails, or untick the box.');
                return;
            }
            if (!username) { showAuthError('Please enter a username.'); return; }
            if (password.length < 6) { showAuthError('Password must be at least 6 characters.'); return; }
            if (!/^[a-zA-Z0-9_\-\.]+$/.test(username)) {
                showAuthError('Username may only contain letters, numbers, _, -, .');
                return;
            }

            setAuthLoading(true);
            const email = username.toLowerCase() + '@godaigo.game';
            const { data, error } = await supabase.auth.signUp({
                email,
                password,
                options: { data: { username } }
            });
            setAuthLoading(false);

            if (error) {
                // Replace the internal fake email with just the username in error messages
                showAuthError(error.message.replace(email, username));
                return;
            }
            if (data.session) {
                onAuthSuccess(data.user);
                // Optional extras from the register form (js/account-recovery.js):
                // the recovery email gets a confirmation link; the newsletter
                // only sends to confirmed addresses (sql/mailing-list.sql).
                if (recoveryEmail) window.AccountRecovery?.setEmailAfterRegister(recoveryEmail);
                if (newsletter) supabase.rpc('set_mailing_list', { p_opt_in: true }).then(() => {}, () => {});
            } else {
                // Email confirmation is still enabled in Supabase dashboard
                showAuthError('Registration failed: email confirmation is required. Please disable it in your Supabase Authentication settings.');
            }
        }

        // Guest login: create a throwaway account with a random username/password
        // so a first-time visitor can join real multiplayer games without going
        // through Register. Reuses the exact same signUp() path as authRegister()
        // — nothing downstream (user_profiles, the lobby, gamification) needs to
        // know or care that the account is a guest one.
        async function authGuestLogin() {
            setAuthLoading(true);

            const MAX_ATTEMPTS = 5;
            let lastError = null;

            for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
                const suffix = Math.random().toString(36).slice(2, 8).toUpperCase();
                const username = `Guest${suffix}`;
                const email = username.toLowerCase() + '@godaigo.game';
                // Never shown to or needed by the guest again — they're not
                // expected to sign back in as this account.
                const password = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);

                const { data, error } = await supabase.auth.signUp({
                    email,
                    password,
                    options: { data: { username } }
                });

                if (!error) {
                    setAuthLoading(false);
                    if (data.session) {
                        onAuthSuccess(data.user);
                    } else {
                        // Email confirmation is still enabled in Supabase dashboard
                        showAuthError('Guest login failed: email confirmation is required. Please disable it in your Supabase Authentication settings.');
                    }
                    return;
                }

                lastError = error;
                // Only worth retrying on a username collision (astronomically
                // unlikely, but the suffix IS randomly generated) — anything else
                // (rate limit, signups disabled, network) fails identically every time.
                if (!/already registered|already exists/i.test(error.message || '')) break;
            }

            setAuthLoading(false);
            showAuthError(lastError?.message || 'Guest login failed. Please try again.');
        }

        // Is the currently signed-in account the developer account ("TheHermit")?
        // All hidden cheat/dev tooling is gated on this. Identity comes from the
        // Supabase-derived username captured in onAuthSuccess (auth metadata /
        // user_profiles.display_name), so no one else can reach these screens.
        window.isHermit = function () {
            // Case-insensitive so the login-email fallback ("thehermit") matches
            // the registered display username ("TheHermit") just the same.
            return (window.currentUsername || '').trim().toLowerCase() === 'thehermit';
        };

        // Host is "the oldest player row in the room" — but bots have no client
        // of their own to ever act as host, so a bot row must never be picked.
        // If the original human host leaves and a bot happens to be the oldest
        // surviving row, every client's naive `players[0]` check would compute
        // the bot as host, and since nobody's isHost flag ever matches a bot's
        // id, the room gets stuck forever (no one can click Start). Callers
        // must pass `players` already ordered by created_at ascending.
        function determineHostRow(players) {
            if (!Array.isArray(players) || !players.length) return null;
            return players.find(p => !window.isBotUsername?.(p.username)) || players[0];
        }

        async function authSignOut() {
            await supabase.auth.signOut();
            window.currentUsername = null;
            if (typeof window.updateHermitUI === 'function') window.updateHermitUI();
            if (window.crtOverlay) window.crtOverlay.loadForUser(null);
            document.getElementById('multiplayer-lobby').style.display = 'none';
            document.getElementById('auth-screen').style.display = 'block';
            document.getElementById('auth-bar').style.display = 'none';
            // Stop browser auto-refresh and hide panels so the next user starts fresh
            stopBrowserRefresh();
            const browserPanel = document.getElementById('game-browser-panel');
            const waitingPanel = document.getElementById('waiting-room-panel');
            if (browserPanel) browserPanel.style.display = 'none';
            if (waitingPanel) waitingPanel.style.display = 'none';
            const readyControls = document.getElementById('ready-controls');
            if (readyControls) readyControls.style.display = 'none';
            document.getElementById('auth-password').value = '';
            document.getElementById('auth-error').style.display = 'none';
        }

        function onAuthSuccess(user) {
            // Derive display username from metadata (set on register) or from synthetic email
            const username = user.user_metadata?.username
                || user.email?.replace('@godaigo.game', '')
                || 'Player';

            // Store globally so all lobby functions use it without reading the DOM
            lobbyUsername = username;

            // Expose the signed-in username globally (Supabase-derived, from auth
            // metadata) so the developer/cheat tooling can gate itself to a single
            // account — see window.isHermit() below. Refresh the Hermit-only menu.
            window.currentUsername = username;
            if (typeof window.updateHermitUI === 'function') window.updateHermitUI();

            // Keep the hidden input in sync (some code paths still read it as a fallback)
            const usernameInput = document.getElementById('username-input');
            if (usernameInput) usernameInput.value = username;

            // Show signed-in bar inside the lobby
            const authBar = document.getElementById('auth-bar');
            const authBarName = document.getElementById('auth-bar-name');
            if (authBarName) authBarName.textContent = `Signed in as ${username}`;
            if (authBar) authBar.style.display = 'flex';

            // Swap screens
            document.getElementById('auth-screen').style.display = 'none';
            document.getElementById('multiplayer-lobby').style.display = 'block';

            // Show the game browser (Panel A)
            showGameBrowser();

            // Initialise gamification profile and award daily login gold
            if (window.gami) {
                window.gami.init(user.id, username).then(() => {
                    window.gami.onDailyLogin();
                    window.loadMainLeaderboard?.();
                });
            }

            // Load CRT settings for this user
            if (window.crtOverlay) {
                window.crtOverlay.loadForUser(user.id);
            }
        }

        function showAuthError(msg) {
            const el = document.getElementById('auth-error');
            if (!el) return;
            el.textContent = msg;
            el.style.display = 'block';
        }

        function setAuthLoading(on) {
            const loading = document.getElementById('auth-loading');
            const loginBtn = document.getElementById('auth-login-btn');
            const regBtn = document.getElementById('auth-register-btn');
            const guestBtn = document.getElementById('auth-guest-btn');
            if (loading) loading.style.display = on ? 'block' : 'none';
            if (loginBtn) loginBtn.disabled = on;
            if (regBtn) regBtn.disabled = on;
            if (guestBtn) guestBtn.disabled = on;
        }

        // ========================================
        // MULTIPLAYER LOBBY FUNCTIONS
        // ========================================

        let isHost = false; // Track if this player is the host

        let isJoining = false; // Prevent double-joins

        let lobbyUsername = ''; // Username from auth — set in onAuthSuccess, read everywhere instead of the hidden input
        let localReadyState = false; // Tracked locally to avoid re-reading from DB in toggleReady

        // ========================================
        // GAME BROWSER & ROOM MANAGEMENT
        // ========================================

        // --- Panel toggle helpers ---

        function showGameBrowser() {
            const browserPanel = document.getElementById('game-browser-panel');
            const waitingPanel = document.getElementById('waiting-room-panel');
            if (browserPanel) browserPanel.style.display = 'block';
            if (waitingPanel) waitingPanel.style.display = 'none';
            refreshGameBrowser();
            startBrowserRefresh(); // auto-refresh every 5 seconds
            // Reload the leaderboard each time the lobby is shown, so it is
            // up to date after a game ends (not only at login).
            window.loadMainLeaderboard?.();
        }

        function showWaitingRoom(gameId, joinCode, isPrivate, roomName) {
            currentGameId = gameId;
            currentJoinCode = joinCode || null;
            const browserPanel = document.getElementById('game-browser-panel');
            const waitingPanel = document.getElementById('waiting-room-panel');
            if (browserPanel) browserPanel.style.display = 'none';
            if (waitingPanel) waitingPanel.style.display = 'block';
            // Room name: the host can rename it here (rename_room RPC,
            // sql/rename-room.sql); everyone else sees it as text, kept up to
            // date by the room subscription.
            const roomNameValue = document.getElementById('room-name-value');
            if (roomNameValue) roomNameValue.textContent = roomName || 'Game Room';
            const roomNameEdit = document.getElementById('room-name-edit');
            if (roomNameEdit && roomNameValue) {
                roomNameEdit.value = roomName || 'Game Room';
                roomNameEdit.style.display = isHost ? '' : 'none';
                roomNameValue.style.display = isHost ? 'none' : '';
                const save = async () => {
                    const name = roomNameEdit.value.trim();
                    if (!name || name === roomNameValue.textContent || !currentGameId) {
                        roomNameEdit.value = roomNameValue.textContent;
                        return;
                    }
                    const { data, error } = await supabase.rpc('rename_room', { p_room_id: currentGameId, p_name: name });
                    if (error) { roomNameEdit.value = roomNameValue.textContent; updateStatus('Could not rename the room.'); return; }
                    roomNameValue.textContent = data || name;
                    roomNameEdit.value = data || name;
                };
                roomNameEdit.onblur = save;
                roomNameEdit.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); roomNameEdit.blur(); } };
            }
            // Show/hide room code section
            const codeDisplay = document.getElementById('room-code-display');
            if (isPrivate && joinCode) {
                codeDisplay.style.display = 'block';
                document.getElementById('room-code-value').textContent = joinCode;
            } else {
                if (codeDisplay) codeDisplay.style.display = 'none';
            }
            // Update badge
            const badge = document.getElementById('room-type-badge');
            if (badge) badge.textContent = isPrivate ? 'PRIVATE' : 'PUBLIC';
            // hostStartGame() disables Start on click and only re-enables it on
            // failure. Leave Game returns here without a page reload, so without
            // this the next room's Start button stayed grayed out.
            const startBtn = document.getElementById('host-start-button');
            if (startBtn) startBtn.disabled = false;
            stopBrowserRefresh();
        }

        function copyRoomCode() {
            if (currentJoinCode) navigator.clipboard?.writeText(currentJoinCode);
            updateStatus('Room code copied!');
        }

        function setBrowserStatus(msg) {
            const el = document.getElementById('browser-status');
            if (el) el.textContent = msg;
        }

        // --- Create room ---

        async function hostPublicGame()    { await createRoom(false); }
        async function createPrivateRoom() { await createRoom(true);  }

        // Quick Play: a private room with 2-4 bots that starts right away.
        // Uses the normal online path (createRoom -> addBotPlayer ->
        // hostStartGame), so the game is recorded and XP / ladder rules apply
        // as in any game with bots.
        async function quickPlay() {
            const btn = document.getElementById('quick-play-btn');
            if (btn?.disabled) return;
            if (btn) btn.disabled = true;
            try {
                await createRoom(true);
                if (!isHost || !currentGameId) return; // createRoom showed why
                setBrowserStatus('Adding bots…');
                const bots = 2 + Math.floor(Math.random() * 3); // 2, 3 or 4
                for (let i = 0; i < bots; i++) await addBotPlayer();
                await hostStartGame();
            } catch (e) {
                console.error('Quick Play failed:', e);
                alert('Quick Play could not start: ' + (e?.message || e));
            } finally {
                if (btn) btn.disabled = false;
            }
        }
        window.quickPlay = quickPlay;

        // "Play Again Together" (js/social.js, after the game-over reload):
        // a private room with the same number of bots. With no humans to wait
        // for it starts at once, like Quick Play. Returns true when the room
        // is up.
        async function playAgainRoom(botCount, startNow) {
            await createRoom(true);
            if (!isHost || !currentGameId) return false;
            for (let i = 0; i < Math.min(4, botCount || 0); i++) await addBotPlayer();
            if (startNow) await hostStartGame();
            return true;
        }
        window.playAgainRoom = playAgainRoom;

        async function createRoom(isPrivate) {
            const username = lobbyUsername;
            if (!username) { alert('Not signed in - please sign in first'); return; }

            // Default name; the host can rename the room in the waiting room.
            const roomName = (username + "'s Game").slice(0, 30);

            // --- Auto-clean stale player entries for this username ---
            const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000).toISOString();
            const { data: existingPlayers } = await supabase
                .from('players')
                .select('id, game_id, created_at')
                .eq('username', username);
            if (existingPlayers?.length) {
                const gameIds = existingPlayers.map(p => p.game_id).filter(Boolean);
                if (gameIds.length) {
                    const { data: waitingRooms } = await supabase
                        .from('game_room')
                        .select('id')
                        .in('id', gameIds)
                        .eq('status', 'waiting');
                    if (waitingRooms?.length) {
                        // Only auto-clean entries older than 2 minutes (stale sessions)
                        const staleIds = existingPlayers
                            .filter(p => p.created_at < twoMinutesAgo)
                            .map(p => p.id);
                        if (staleIds.length) {
                            await supabase.rpc('remove_players', { p_player_ids: staleIds });
                            console.log('🧹 Auto-cleaned stale player entries:', staleIds);
                        } else {
                            setBrowserStatus('You\'re already in a waiting room. Leave it first before creating a new one.');
                            return;
                        }
                    }
                }
            }

            setBrowserStatus('Creating room…');
            await supabase.rpc('cleanup_stale_rooms');
            const { data, error } = await supabase.rpc('create_game_room',
                { p_is_private: isPrivate, p_host_name: roomName });
            if (error || !data?.length) {
                console.error('❌ create_game_room RPC failed:', error);
                setBrowserStatus('Error creating room: ' + (error?.message || 'no data returned - see Supabase SQL Editor'));
                return;
            }
            const { room_id, join_code } = data[0];

            const ok = await joinRoomAsPlayer(room_id, username);
            if (!ok) return;
            isHost = true;
            showWaitingRoom(room_id, join_code, isPrivate, roomName);
        }

        // --- Join by code ---

        async function joinByCode() {
            const code = document.getElementById('join-code-input').value.trim().toUpperCase();
            if (code.length !== 6) { setBrowserStatus('Enter a 6-character room code'); return; }
            setBrowserStatus('Looking up room…');
            const { data: room } = await supabase
                .from('game_room')
                .select('id,status,is_private,join_code,host_name')
                .eq('join_code', code)
                .single();
            if (!room) { setBrowserStatus('Room not found - check the code and try again'); return; }
            if (room.status !== 'waiting') { setBrowserStatus('That game has already started'); return; }
            const username = lobbyUsername;
            if (!username) { alert('Not signed in - please sign in first'); return; }
            const ok = await joinRoomAsPlayer(room.id, username);
            if (!ok) return;
            showWaitingRoom(room.id, room.join_code, room.is_private, room.host_name);
        }

        // --- Join a public game from browser ---

        async function joinPublicGame(gameId) {
            const username = lobbyUsername;
            if (!username) { alert('Not signed in - please sign in first'); return; }
            const { data: room } = await supabase
                .from('game_room')
                .select('id,status,is_private,join_code,host_name')
                .eq('id', gameId)
                .single();
            if (!room || room.status !== 'waiting') { refreshGameBrowser(); return; }
            const ok = await joinRoomAsPlayer(gameId, username);
            if (!ok) return;
            showWaitingRoom(gameId, null, false, room.host_name);
        }

        // --- Shared join helper ---

        async function joinRoomAsPlayer(gameId, username) {
            // Auto-clean stale entries for this username; block only if last_seen is recent (active session)
            // A player is considered active if their heartbeat fired within the last 90 seconds.
            // last_seen may be NULL for a brand-new row that hasn't heartbeated yet — treat NULL as stale
            // unless the row was created within the last 30 seconds (to avoid stomping a fresh join).
            const ninetySecondsAgo = new Date(Date.now() - 90 * 1000).toISOString();
            const thirtySecondsAgo = new Date(Date.now() - 30 * 1000).toISOString();
            // user_id ties this seat to the auth account so game results can
            // move the positional ladder (null for guests - they just don't
            // anchor ladder movement).
            const authUid = (await supabase.auth.getSession())?.data?.session?.user?.id || null;
            const { data: existing } = await supabase
                .from('players')
                .select('id, username, user_id, created_at, last_seen')
                .eq('game_id', gameId);
            const match = existing?.filter(p => p.username === username) || [];
            if (match.length) {
                const stale = match.filter(p => {
                    // Same signed-in account: this is our own old seat from a
                    // reload or closed tab (its heartbeat can still look fresh
                    // for up to 90s). Replace it instead of blocking the rejoin.
                    if (authUid && p.user_id === authUid) return true;
                    // Active = last_seen is recent, OR row is brand-new (< 30s) with no last_seen yet
                    if (p.last_seen && p.last_seen > ninetySecondsAgo) return false; // active
                    if (!p.last_seen && p.created_at > thirtySecondsAgo) return false; // brand-new
                    return true; // stale
                });
                const active = match.filter(p => !stale.includes(p));
                if (stale.length) {
                    await supabase.rpc('remove_players', { p_player_ids: stale.map(p => p.id) });
                    console.log('🧹 Auto-cleaned stale entry for', username);
                }
                if (active.length) {
                    setBrowserStatus('That username is already in this room');
                    return false;
                }
            }
            const { data, error } = await supabase
                .from('players')
                .insert([{ username, is_ready: false, game_id: gameId, user_id: authUid }])
                .select()
                .single();
            if (error) { setBrowserStatus('Could not join: ' + error.message); return false; }
            myPlayerId = data.id;
            localReadyState = false;
            updateReadyButton(false);
            currentGameId = gameId;  // must be set BEFORE subscribeToLobby so filters use the correct room ID
            isMultiplayer = true;
            // Determine host: oldest non-bot player by creation time
            const { data: all } = await supabase
                .from('players')
                .select('*')
                .eq('game_id', gameId)
                .order('created_at', { ascending: true });
            isHost = determineHostRow(all)?.id === myPlayerId;
            // Host is implicitly ready — their action is clicking Start, not toggling ready
            if (isHost) {
                localReadyState = true;
                await supabase.from('players').update({ is_ready: true }).eq('id', myPlayerId);
            }
            document.getElementById('ready-controls').style.display = 'block';
            updateReadyButton(localReadyState);
            subscribeToLobby();
            updateHeartbeat();
            startLobbyPoll();
            updatePlayerList();
            console.log('✅ Joined room', gameId, 'as', username, isHost ? '(HOST)' : '');
            return true;
        }

        // --- Leave room (return to game browser) ---

        async function leaveRoom() {
            const leavingRoomId = currentGameId; // capture before we null it out
            const leavingAsHost = isHost;

            // Host: delete the room FIRST, while our seat still exists. The
            // database only lets the room's host (oldest human seat) or the
            // hermit delete a room, so this must run before resetToLobby() or
            // remove_player below take our seat away. delete_game_room also
            // removes every seat in the room, ours included.
            // Must go through an RPC: game_room/players both have "no client
            // delete" RLS policies, so a direct .from(...).delete() silently
            // deletes 0 rows and returns no error.
            let roomDeleted = false;
            if (leavingAsHost && leavingRoomId) {
                const { error: roomDeleteErr } = await supabase
                    .rpc('delete_game_room', { p_room_id: leavingRoomId });
                if (roomDeleteErr) {
                    console.warn('⚠️ Could not delete game_room on host leave:', roomDeleteErr.message);
                } else {
                    roomDeleted = true;
                    console.log('🗑️ Deleted game_room', leavingRoomId, '(host left)');
                }
            }

            // If we're mid-game, reset game state first before returning to lobby
            const gameContainer = document.querySelector('.game-container');
            const inGame = gameContainer && gameContainer.style.display !== 'none';
            if (inGame && typeof resetToLobby === 'function') {
                resetToLobby();
            }

            if (myPlayerId && !roomDeleted) {
                await supabase.rpc('remove_player', { p_player_id: myPlayerId });
            }

            myPlayerId = null;
            currentGameId = null;
            currentJoinCode = null;
            isHost = false;
            isMultiplayer = false;
            isJoining = false;
            stopLobbyPoll();
            if (playersSubscription) { playersSubscription.unsubscribe(); playersSubscription = null; }
            if (gameRoomSubscription) { gameRoomSubscription.unsubscribe(); gameRoomSubscription = null; }
            if (gameChannel) { gameChannel.unsubscribe(); gameChannel = null; }
            stopScrollStateSync();
            document.getElementById('ready-controls').style.display = 'none';
            showGameBrowser();
        }

        // --- Public game browser ---

        let browserRefreshInterval = null;
        // The cleanup RPCs are server writes. Every lobby tab ran them every 5 s,
        // so a crowd of idle lobby tabs (a stream night) meant a steady write
        // load. The server only removes players after minutes, so every 30 s is enough.
        const BROWSER_CLEANUP_MS = 30 * 1000;
        let lastBrowserCleanup = 0;

        async function refreshGameBrowser() {
            const doCleanup = Date.now() - lastBrowserCleanup >= BROWSER_CLEANUP_MS;
            if (doCleanup) {
                lastBrowserCleanup = Date.now();
                // Sweep stale players via server-side RPC (client DELETE is blocked by RLS)
                await supabase.rpc('cleanup_inactive_players');
            }

            const { data: rooms } = await supabase
                .from('game_room')
                .select('id,host_name,created_at')
                .eq('status', 'waiting')
                .eq('is_private', false)
                .order('created_at', { ascending: false });

            const list = document.getElementById('public-games-list');
            if (!list) return;

            if (!rooms?.length) {
                list.innerHTML = '<p style="color:#ccc;font-style:italic;text-align:center;padding:20px 0;margin:0;">No public games open. Host one!</p>';
                return;
            }

            // Fetch player counts and heartbeats for each room in one query
            const ids = rooms.map(r => r.id);
            const { data: players } = await supabase
                .from('players')
                .select('game_id,username,last_seen')
                .in('game_id', ids);
            const counts = {};
            const newestSeen = {}; // newest heartbeat from a HUMAN seat only
            (players || []).forEach(p => {
                counts[p.game_id] = (counts[p.game_id] || 0) + 1;
                // Bots are heartbeated by the host's client, so a bot's
                // last_seen says nothing about whether any human is still here.
                if (window.isBotUsername?.(p.username)) return;
                if (p.last_seen && (!newestSeen[p.game_id] || p.last_seen > newestSeen[p.game_id])) {
                    newestSeen[p.game_id] = p.last_seen;
                }
            });

            // Auto-delete ghost rooms via RPC (client DELETE blocked by RLS)
            if (doCleanup) supabase.rpc('cleanup_ghost_rooms').then(() => {
                const ghostCount = rooms.filter(r => !counts[r.id]).length;
                if (ghostCount) console.log('🗑️ Cleaned up', ghostCount, 'empty ghost room(s)');
            });

            // Only show rooms that have players AND a human still checking in.
            // Every client heartbeats every 15s (bots don't count, see above),
            // so a room whose newest human last_seen is over 90s old was
            // abandoned without a clean leave (tab crash, phone sleep). The
            // server only deletes those players after 5 minutes, so without this
            // a dead room stayed listed and joinable for up to 5 minutes.
            // 90s = the same "active" window joinRoomAsPlayer uses, and leaves
            // room for background-tab timer throttling (about 1 beat a minute).
            const now = Date.now();
            const isLive = r => {
                if (!(counts[r.id] > 0)) return false;
                const seen = newestSeen[r.id];
                if (seen) return now - new Date(seen).getTime() < 90 * 1000;
                // No heartbeat yet: only trust a room created in the last 30s
                return now - new Date(r.created_at).getTime() < 30 * 1000;
            };
            const liveRooms = rooms.filter(isLive);
            if (!liveRooms.length) {
                list.innerHTML = '<p style="color:#ccc;font-style:italic;text-align:center;padding:20px 0;margin:0;">No public games open. Host one!</p>';
                return;
            }

            list.innerHTML = liveRooms.map(r => `
                <div class="game-room-card" onclick="joinPublicGame(${r.id})">
                    <div class="game-room-host">${_esc(r.host_name || 'Unnamed Game')}</div>
                    <div class="game-room-count">${counts[r.id]} / 5</div>
                    <button class="game-room-join-btn">Join</button>
                </div>`).join('');
        }

        function startBrowserRefresh() {
            stopBrowserRefresh();
            // A hidden tab (for example behind OBS) does not need the list.
            browserRefreshInterval = setInterval(() => { if (!document.hidden) refreshGameBrowser(); }, 5000);
        }
        // Coming back to the tab: show a fresh list at once.
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden && browserRefreshInterval) refreshGameBrowser();
        });
        function stopBrowserRefresh() {
            clearInterval(browserRefreshInterval);
            browserRefreshInterval = null;
        }

        // Simple HTML escape helper
        function _esc(str) {
            return String(str)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;');
        }

        // ── Retro dialog helpers ──────────────────────────────────
        /**
         * Show a retro-styled confirm dialog.
         * onOk is called if the player clicks OK; nothing happens on Cancel.
         */
        function showRetroConfirm(title, lines, onOk) {
            const id = 'retro-confirm-overlay';
            if (document.getElementById(id)) return; // prevent duplicates

            const bodyLines = lines.map(l => `<div class="retro-dlg-line">${l}</div>`).join('');
            const el = document.createElement('div');
            el.id        = id;
            el.className = 'retro-dlg-overlay';
            el.innerHTML = `
                <div class="retro-dlg-box">
                    <div class="retro-dlg-title">${title}</div>
                    <div class="retro-dlg-body">${bodyLines}</div>
                    <div class="retro-dlg-btns">
                        <button class="retro-dlg-btn ok"     id="retro-confirm-ok">OK</button>
                        <button class="retro-dlg-btn cancel" id="retro-confirm-cancel">Cancel</button>
                    </div>
                </div>`;

            document.body.appendChild(el);

            document.getElementById('retro-confirm-ok').onclick = () => {
                el.remove();
                onOk();
            };
            document.getElementById('retro-confirm-cancel').onclick = () => el.remove();
        }

        // One-time "may we store your session's game log?" consent prompt —
        // shown once per browser (godaigo_log_consent unset), on match launch
        // (startGame()/startMultiplayerGame() below, each after a short delay
        // so it doesn't cover the board's own intro animation) rather than
        // right after login, since a player may log in and just browse the
        // lobby without starting a match. Revisitable later via Settings →
        // Privacy (js/gamification-ui.js's _gami_toggleLogConsent), which
        // reuses setLogConsent() so both write paths share one function.
        function promptLogConsentIfNeeded() {
            try {
                if (localStorage.getItem('godaigo_log_consent')) return; // already answered
            } catch (e) { return; }

            showRetroConfirm(
                'Help Improve Godaigo?',
                [
                    "We'd like to store this session's game log (your moves and card plays) to help balance and improve the game.",
                    'No personal info beyond your username is included.',
                    "In multiplayer, this only happens if the game's HOST has opted in.",
                    'You can change this anytime in Settings.',
                ],
                () => setLogConsent('granted')
            );

            // showRetroConfirm's Cancel button only closes the dialog (.onclick).
            // Adding a listener here (rather than editing showRetroConfirm itself,
            // which is shared by other confirm dialogs) also records the decline —
            // both the existing onclick and this listener fire on click.
            const cancelBtn = document.getElementById('retro-confirm-cancel');
            if (cancelBtn) cancelBtn.addEventListener('click', () => setLogConsent('declined'), { once: true });

            // Relabel buttons for this specific prompt — showRetroConfirm hardcodes "OK"/"Cancel".
            const okBtn = document.getElementById('retro-confirm-ok');
            if (okBtn) okBtn.textContent = 'Allow';
            if (cancelBtn) cancelBtn.textContent = 'Not Now';
        }

        function setLogConsent(value) {
            try { localStorage.setItem('godaigo_log_consent', value); } catch (e) { /* ignore */ }
        }
        window.setLogConsent = setLogConsent; // reused by the Settings → Privacy toggle

        // ========================================
        // END GAME BROWSER & ROOM MANAGEMENT
        // ========================================

        // Sequence tracking for detecting out-of-order messages and deduplication
        let scrollEventSequence = 0;
        const receivedSequences = new Set();

        // Periodically clean old sequence IDs (keep last 1000 to prevent memory leak)
        setInterval(() => {
            if (receivedSequences.size > 1000) {
                const arr = Array.from(receivedSequences);
                receivedSequences.clear();
                // Keep most recent 500
                arr.slice(-500).forEach(id => receivedSequences.add(id));
                console.log('🧹 Cleaned old event IDs from deduplication cache');
            }
        }, 30000); // Every 30 seconds

        // Join the lobby
        async function joinLobby() {
            // Prevent double-joins
            if (isJoining) {
                console.log('Already joining, please wait...');
                return;
            }

            const username = lobbyUsername;

            if (!username) {
                alert('Not signed in - please sign in first');
                return;
            }

            // Disable input and button, show loading spinner
            isJoining = true;
            const joinButton = document.getElementById('join-button');
            const loadingDiv = document.getElementById('join-loading');
            joinButton.disabled = true;
            usernameInput.disabled = true;
            loadingDiv.style.display = 'block';

            try {
                // First, clean up any stale players (older than 10 minutes)
                // Increased timeout for development - players won't be kicked while debugging
                await supabase
                    .from('players')
                    .delete()
                    .lt('last_seen', new Date(Date.now() - 600000).toISOString());

                // Check game room status — only reset if truly abandoned (no players left)
                const { data: room } = await supabase
                    .from('game_room')
                    .select('status')
                    .eq('id', 1)
                    .single();

                if (room && (room.status === 'playing' || room.status === 'finished')) {
                    // Count how many players are still in the DB
                    const { data: activePlayers } = await supabase
                        .from('players')
                        .select('id');

                    if (activePlayers && activePlayers.length > 0) {
                        // Game is in progress with real players — don't nuke it
                        alert('A game is currently in progress with other players.\n\nPlease wait for it to finish, or use "Reset Lobby" to force-clear.');
                        isJoining = false;
                        joinButton.disabled = false;
                        usernameInput.disabled = false;
                        loadingDiv.style.display = 'none';
                        return;
                    }

                    // No players left — safe to reset this abandoned game
                    await supabase
                        .from('game_room')
                        .update({ status: 'waiting', current_turn_index: 0 })
                        .eq('id', 1);
                }

                // Check if username is already taken
                const { data: existingPlayers } = await supabase
                    .from('players')
                    .select('*')
                    .order('created_at', { ascending: true });

                const usernameTaken = existingPlayers && existingPlayers.some(p => p.username === username);
                if (usernameTaken) {
                    alert('Username already taken! Please choose a different name.');
                    // Re-enable inputs
                    isJoining = false;
                    joinButton.disabled = false;
                    usernameInput.disabled = false;
                    loadingDiv.style.display = 'none';
                    return;
                }

                // Insert player into database (user_id ties the seat to the
                // auth account so game results can move the positional ladder)
                const joinAuthUid = (await supabase.auth.getSession())?.data?.session?.user?.id || null;
                const { data, error } = await supabase
                    .from('players')
                    .insert([{ username, is_ready: false, user_id: joinAuthUid }])
                    .select()
                    .single();

                if (error) throw error;

                myPlayerId = data.id;
                isMultiplayer = true;
                localReadyState = false;
                updateReadyButton(false);

                // After insertion, check if we're the first player (host)
                // The host is the oldest non-bot player by created_at timestamp
                const { data: allPlayersAfterInsert } = await supabase
                    .from('players')
                    .select('*')
                    .order('created_at', { ascending: true });

                // We're host if we're the oldest non-bot player (by creation time)
                isHost = determineHostRow(allPlayersAfterInsert)?.id === myPlayerId;

                // Host is implicitly ready — their action is clicking Start, not toggling ready
                if (isHost) {
                    localReadyState = true;
                    await supabase.from('players').update({ is_ready: true }).eq('id', myPlayerId);
                }

                console.log('✅ Joined lobby as:', username, 'ID:', myPlayerId, isHost ? '(HOST)' : '');

                // Hide join form, show ready controls
                document.getElementById('join-form').style.display = 'none';
                document.getElementById('ready-controls').style.display = 'block';
                updateReadyButton(localReadyState);

                // Start listening for updates
                subscribeToLobby();
                updateHeartbeat();
                startLobbyPoll(); // Auto-refresh player list every 10s while in lobby
                updatePlayerList(); // Initial update to show host controls

            } catch (error) {
                console.error('Error joining lobby:', error);
                alert('Failed to join lobby: ' + error.message);

                // Re-enable inputs on error
                isJoining = false;
                joinButton.disabled = false;
                usernameInput.disabled = false;
                loadingDiv.style.display = 'none';
            }
        }

        // Leave the current game
        function leaveGame() {
            if (!myPlayerId) return;

            showRetroConfirm(
                'Leave Game?',
                ['You will be removed from this game', 'and cannot rejoin.'],
                _doLeaveGame
            );
        }

        async function _doLeaveGame() {
            try {
                console.log('👋 Leaving game...');

                // Delete myself from players table via RPC (direct DELETE blocked by RLS)
                const { error } = await supabase
                    .rpc('remove_player', { p_player_id: myPlayerId });

                if (error) throw error;

                // Reset local state
                myPlayerId = null;
                myPlayerIndex = null;
                isHost = false;
                isMultiplayer = false;

                // Stop polling and subscriptions
                stopLobbyPoll();
                stopLastManStandingPoll();

                // Unsubscribe from channels
                if (playersSubscription) {
                    playersSubscription.unsubscribe();
                    playersSubscription = null;
                }
                if (gameRoomSubscription) {
                    gameRoomSubscription.unsubscribe();
                    gameRoomSubscription = null;
                }
                if (gameChannel) {
                    gameChannel.unsubscribe();
                    gameChannel = null;
                }
                stopScrollStateSync();

                // Reset UI state
                const readyCtrl = document.getElementById('ready-controls');
                if (readyCtrl) readyCtrl.style.display = 'none';
                currentGameId = null;
                currentJoinCode = null;

                // resetToLobby handles: clearBoard, stopTurnTimerMonitoring,
                // hiding game-layout, showing lobby-wrapper, hiding leave/end-turn buttons
                resetToLobby();

                // Return to game browser panel
                showGameBrowser();

                console.log('✅ Left game successfully');

            } catch (error) {
                console.error('Error leaving game:', error);
                showRetroConfirm('Leave Failed', [error.message], () => {});
            }
        }

        // Reset the entire lobby (clear all players and reset game room)
        function resetLobby() {
            showRetroConfirm(
                'Reset Lobby?',
                ['Remove all players', 'Reset room to waiting state', 'Clear the board'],
                _doResetLobby
            );
        }

        async function _doResetLobby() {
            try {
                console.log('📄 Resetting lobby...');

                // Delete all players in the current room. Must go through an RPC —
                // players has a "no client delete" RLS policy (qual: false), so a
                // direct .from('players').delete() silently deletes 0 rows and
                // returns no error, leaving stale players behind.
                const { error: playersError } = await supabase
                    .rpc('clear_room_players', { p_room_id: currentGameId });

                if (playersError) throw playersError;

                // Reset game room status
                const { error: roomError } = await supabase
                    .from('game_room')
                    .update({ status: 'waiting', current_turn_index: 0 })
                    .eq('id', currentGameId);

                if (roomError) throw roomError;

                // Reset local state
                myPlayerId = null;
                currentGameId = null;
                currentJoinCode = null;
                isHost = false;
                isJoining = false;
                isMultiplayer = false;

                // Stop lobby polling
                stopLobbyPoll();

                // Unsubscribe from channels
                if (playersSubscription) {
                    playersSubscription.unsubscribe();
                    playersSubscription = null;
                }
                if (gameRoomSubscription) {
                    gameRoomSubscription.unsubscribe();
                    gameRoomSubscription = null;
                }

                // Reset UI — return to game browser
                document.getElementById('ready-controls').style.display = 'none';

                // Hide game, show lobby
                document.querySelector('.game-container').style.display = 'none';
                document.getElementById('multiplayer-lobby').style.display = 'block';

                // Clear the board if it was started
                clearBoard(true);

                // Return to the game browser
                showGameBrowser();

                console.log('✅ Lobby reset complete!');
                alert('Lobby has been reset! You can now host or join again.');

            } catch (error) {
                console.error('Error resetting lobby:', error);
                alert('Failed to reset lobby: ' + error.message);
            }
        }

        // Guard: XP is awarded once per game session — prevents double-award from
        // multiple handleGameOver calls (game-core direct + broadcast echo + DB subscription)
        let _gameOverXpAwarded = false;
        let _gameLogUploaded = false; // same once-per-game guard, for the session-log upload

        // Handle game over - mark game as finished and show win screen
        // Real winner check for XP crediting / win-screen "you won" framing —
        // NOT just "does this player index match mine". Guards the
        // host-impersonation edge case: while bot-driver.js's asBot()
        // impersonates a bot, myPlayerIndex briefly equals that bot's OWN
        // index, so a naive `winnerPlayerIndex === myPlayerIndex` check can be
        // true on the HOST's client when their own bot wins — not them
        // personally — which would wrongly credit them victory-tier XP and
        // offer them a capture of a bot they didn't actually just beat.
        function isGenuineLocalWinner(winnerPlayerIndex) {
            const winnerRow = (typeof allPlayersData !== 'undefined' && Array.isArray(allPlayersData))
                ? allPlayersData.find(p => p.player_index === winnerPlayerIndex) : null;
            if (window.isBotUsername?.(winnerRow?.username)) return false;
            return winnerPlayerIndex === myPlayerIndex;
        }

        async function handleGameOver(winnerPlayerIndex, winType = 'scrolls') {
            if (!isMultiplayer) return;

            try {
                console.log('🏆 Game Over! Winner:', winnerPlayerIndex, 'Type:', winType);
                stopLastManStandingPoll();

                // Tell the other players first. The room update below reaches
                // them too, but without the win type, and the host records
                // whichever arrives first (match 5 was saved with no win type).
                // Their witness check also starts sooner this way.
                broadcastGameAction('game-over', { winnerIndex: winnerPlayerIndex, winType });

                // Mark the room finished with the winner's index FIRST. The
                // server's claim_game_win() only pays XP for a finished room
                // whose recorded winner is the caller's own seat.
                const { error: finishErr } = await supabase
                    .from('game_room')
                    .update({
                        status: 'finished',
                        current_turn_index: winnerPlayerIndex
                    })
                    .eq('id', currentGameId);
                if (finishErr) {
                    console.error('Error updating game over state:', finishErr);
                }

                // Close the match recording (host only; no-op elsewhere).
                window.MatchRecorder?.finish(winnerPlayerIndex, winType);

                // Then award XP, before showing the overlay, so the async RPC
                // completes before any page reload triggered by "Return to Lobby" can cancel it
                if (!_gameOverXpAwarded) {
                    _gameOverXpAwarded = true;
                    const isWinner = isGenuineLocalWinner(winnerPlayerIndex);
                    console.log(`[XP] Attempting to award XP - isWinner=${isWinner}, userId=${window.gami?.userId}, totalPlayers=${totalPlayers}`);
                    if (window.gami?.userId) {
                        await window.gami.onGameComplete(isWinner, totalPlayers, currentGameId);
                    } else {
                        console.warn('[XP] gami.userId not set - XP skipped. gami object:', window.gami);
                    }
                } else {
                    console.log('[XP] handleGameOver called again - XP already awarded this session, skipping.');
                }

                // Positional ladder: moved by the SERVER now, from the recorded
                // game, when a win is paid (or, for a bot winner, when a human of
                // the game confirms it). The browser no longer reports ladder
                // results: that let anyone claim any result (sql/ladder-secure.sql).

                // Upload this game's session log if the host consented — only the
                // host's client writes (one shared log per game, not per player).
                if (!_gameLogUploaded) {
                    _gameLogUploaded = true;
                    window.uploadSessionLogIfConsented?.({ isMultiplayer: true, isHostCall: isHost });
                }

                // Show win screen after XP is secured
                showGameOverToAll(winnerPlayerIndex, winType);

            } catch (error) {
                console.error('Error handling game over:', error);
            }
        }

        // Show game over notification to all players
        function showGameOverToAll(winnerPlayerIndex, winType = 'scrolls') {
            console.log('Game over for winner index:', winnerPlayerIndex, 'Type:', winType);

            // Witness report: this browser checks the winner against its own
            // board and tells the server (js/match-witness.js). Once per game.
            window.MatchWitness?.onGameOver(winnerPlayerIndex, winType);

            // Check if notification already exists
            const existingNotification = document.getElementById('game-over-notification');
            if (existingNotification) {
                return; // Don't show duplicate
            }

            const overlay = document.createElement('div');
            overlay.id = 'game-over-notification';
            overlay.className = 'game-over-overlay';

            const box = document.createElement('div');
            box.className = 'game-over-box';

            const title = document.createElement('div');
            title.textContent = 'GAME OVER';
            title.className = 'game-over-title';
            box.appendChild(title);

            const winnerName = getPlayerColorName(winnerPlayerIndex);
            const playerName = document.createElement('div');
            playerName.textContent = `${winnerName} wins!`;
            playerName.className = 'game-over-winner';
            playerName.style.color = '#d9b08c';
            box.appendChild(playerName);

            const msg = document.createElement('div');
            msg.textContent = winType === 'last_standing'
                ? 'Every other player left. You win!'
                : 'All five elements have been mastered!';
            msg.className = 'game-over-msg';
            box.appendChild(msg);

            if (winType === 'scrolls') {
                const elements = document.createElement('div');
                elements.className = 'game-over-elements';
                elements.innerHTML = ['earth','water','fire','wind','void'].map(el =>
                    `<img src="images/${el === 'earth' ? 'mountainsymbol' : el === 'water' ? 'watersymbol' : el === 'fire' ? 'firesymbol' : el === 'wind' ? 'windsymbol' : 'voidsymbol'}.webp" class="element-icon-sm" alt="${el}">`
                ).join(' ');
                box.appendChild(elements);
            }

            const subtitle = document.createElement('div');
            subtitle.textContent = 'The path of balance is complete.';
            subtitle.className = 'game-over-subtitle';
            box.appendChild(subtitle);

            // XP reward line — shown after onGameComplete resolves
            const xpLine = document.createElement('div');
            xpLine.id = 'game-over-xp-line';
            xpLine.style.cssText = `
                font-family: var(--font-pixel, monospace); font-size: 11px;
                color: #f0c040; letter-spacing: 1px; margin: 8px 0 4px;
                min-height: 16px;
            `;
            const isWinner = isGenuineLocalWinner(winnerPlayerIndex);
            const n = Math.max(2, totalPlayers || 2);
            const xpAmt = isWinner ? 75 + (n - 1) * 25 : 20 + (n - 1) * 10;
            xpLine.textContent = isWinner ? `+${xpAmt} XP  -  VICTORY` : `+${xpAmt} XP  -  GAME COMPLETE`;
            // A replay viewer earns nothing (js/replay-viewer.js).
            if (window.Replay?.state) xpLine.textContent = 'END OF REPLAY';
            box.appendChild(xpLine);

            // (The personal-bot "capture a bot" picker was removed with the
            // Bot Tycoon economy — bots are now the five fixed elemental
            // bots, not something you collect. See js/bot-elements.js.)

            const lobbyBtn = document.createElement('button');
            lobbyBtn.textContent = 'Return to Lobby';
            lobbyBtn.className = 'retro-dlg-btn ok';
            lobbyBtn.onclick = async () => {
                try {
                    const roomId = currentGameId;
                    if (roomId) {
                        const { data: allP } = await supabase.from('players').select('id').eq('game_id', roomId);
                        if (allP && allP.length > 0) {
                            const ids = allP.map(p => p.id);
                            // remove_players resolves with {error} rather than throwing on an
                            // RPC-level failure (RLS denial, etc.) — this table has hit that
                            // exact silent-failure shape before (see git history: "route player
                            // deletes through RPC to bypass RLS"). If we don't verify the delete
                            // actually happened, a failure here still flips status to 'waiting'
                            // below, so the room LOOKS clean while stale player rows linger —
                            // and the next join attempt from any of those usernames gets wrongly
                            // blocked as "already in this room" by joinRoomAsPlayer's staleness
                            // check (which only auto-cleans rows older than ~90s).
                            let { error: removeErr } = await supabase.rpc('remove_players', { p_player_ids: ids });
                            if (removeErr) {
                                console.warn('⚠️ remove_players failed, retrying once:', removeErr);
                                ({ error: removeErr } = await supabase.rpc('remove_players', { p_player_ids: ids }));
                            }
                            if (removeErr) console.error('❌ Post-game player cleanup failed twice - stale rows may remain:', removeErr);
                        }
                        await supabase.from('game_room').update({ status: 'waiting', current_turn_index: 0 }).eq('id', roomId);
                    }
                } catch (err) {
                    console.error('Post-game cleanup error:', err);
                }
                window.location.reload();
            };
            // Play Again Together (js/social.js): same people and bots in a new
            // private room. Online games only; not for replays or the tutorial.
            if (isMultiplayer && !window.Replay?.state && !window.isTutorialMode && window.Social?.playAgain) {
                const againBtn = document.createElement('button');
                againBtn.textContent = 'Play Again Together';
                againBtn.className = 'retro-dlg-btn ok game-over-again';
                againBtn.onclick = () => {
                    againBtn.disabled = true;
                    window.Social.playAgain(typeof allPlayersData !== 'undefined' ? allPlayersData : []);
                    lobbyBtn.onclick();
                };
                box.appendChild(againBtn);
            }
            box.appendChild(lobbyBtn);

            overlay.appendChild(box);
            document.body.appendChild(overlay);
        }

        // Update the ready button to reflect current state clearly
        function updateReadyButton(isReady) {
            const readyButton = document.getElementById('ready-button');
            if (!readyButton) return;
            // The host's action is starting the game, not toggling ready — hide it for them
            if (isHost) {
                readyButton.style.display = 'none';
                return;
            }
            readyButton.style.display = '';
            readyButton.classList.toggle('is-ready', isReady);
            if (isReady) {
                readyButton.textContent = '✓ Ready';
                readyButton.title = 'Click to cancel ready';
            } else {
                readyButton.textContent = 'Not Ready';
                readyButton.title = 'Click to mark yourself ready';
            }
        }

        // Toggle ready status
        async function toggleReady() {
            if (!myPlayerId) return;

            try {
                const newReadyState = !localReadyState;

                // Update ready state
                const { error } = await supabase
                    .from('players')
                    .update({ is_ready: newReadyState })
                    .eq('id', myPlayerId);

                if (error) throw error;

                localReadyState = newReadyState;
                updateReadyButton(newReadyState);

            } catch (error) {
                console.error('Error toggling ready:', error);
            }
        }

        // Debounces the players-subscription handler's "who's host + refresh
        // list" tail (below). Found via live log analysis (2026-08-21, a
        // connectivity/performance audit investigating a broken playtest):
        // Supabase Realtime's postgres_changes fires once PER ROW a statement
        // touches, not once per statement. updateHeartbeat()'s host-only bot
        // sweep (`players.update(...).like('username', BOT_PREFIX+'%')`) is a
        // single PATCH that can touch several bot rows at once — every ~15s,
        // for the entire session — and each row generates its own separate
        // event here, each re-running two full `select *` queries. Live logs
        // from an actual playtest showed 13-16 near-identical queries firing
        // within ~600ms of a single heartbeat tick, repeating for the whole
        // session, entirely independent of connection quality. A trailing
        // debounce collapses any such burst (regardless of its cause — this
        // fixes the general amplification, not just the bot-sweep case) into
        // exactly one refresh, ~300ms after the burst quiets down.
        let _playerListRefreshDebounce = null;
        function scheduleHostAndListRefresh() {
            if (_playerListRefreshDebounce) clearTimeout(_playerListRefreshDebounce);
            _playerListRefreshDebounce = setTimeout(async () => {
                _playerListRefreshDebounce = null;
                // Update our local isHost status when players change.
                // Check if we're now the oldest non-bot player (host) within this room
                if (myPlayerId) {
                    const { data: allPlayers } = await supabase
                        .from('players')
                        .select('*')
                        .eq('game_id', currentGameId)
                        .order('created_at', { ascending: true });

                    if (allPlayers && allPlayers.length > 0) {
                        const wasHost = isHost;
                        isHost = determineHostRow(allPlayers)?.id === myPlayerId;

                        // Notify if we became host
                        if (!wasHost && isHost) {
                            console.log('You are now the host.');
                            startDisconnectMonitor();
                            window.MatchRecorder?.adopt();
                        }
                    }
                }

                updatePlayerList();
            }, 300);
        }

        // Subscribe to lobby updates
        function subscribeToLobby() {
            // Unsubscribe from any existing channels first
            if (playersSubscription) {
                playersSubscription.unsubscribe();
            }
            if (gameRoomSubscription) {
                gameRoomSubscription.unsubscribe();
            }
            
            // Subscribe to players table (scoped to this room)
            playersSubscription = supabase
                .channel('players-' + currentGameId + '-' + Math.random())
                .on('postgres_changes',
                    { event: '*', schema: 'public', table: 'players',
                      filter: `game_id=eq.${currentGameId}` },
                    async (payload) => {
                        console.log('Players update:', payload);

                        // Handle our own player being deleted (kicked or lobby reset)
                        if (payload.eventType === 'DELETE' && payload.old.id === myPlayerId) {
                            console.log('📄 You were removed from the lobby (kicked or reset detected)');

                            // Check if we're in a game - if so, need to reset game state first
                            const gameContainer = document.querySelector('.game-container');
                            const inGame = gameContainer && gameContainer.style.display !== 'none';

                            if (inGame) {
                                console.log('⏰ Kicked during game - resetting to lobby');
                                // Call resetToLobby to properly clean up game state
                                if (typeof resetToLobby === 'function') {
                                    resetToLobby();
                                }
                            }

                            // Reset local state
                            myPlayerId = null;
                            myPlayerIndex = null;
                            isHost = false;
                            isMultiplayer = false;

                            // Unsubscribe from channels
                            if (playersSubscription) {
                                playersSubscription.unsubscribe();
                                playersSubscription = null;
                            }
                            if (gameRoomSubscription) {
                                gameRoomSubscription.unsubscribe();
                                gameRoomSubscription = null;
                            }
                            if (gameChannel) {
                                gameChannel.unsubscribe();
                                gameChannel = null;
                            }

                            // Show alert and reload the page to fully reset
                            alert('You were kicked from the game (timeout). The page will refresh.');

                            // Reload the page to return to a clean state
                            setTimeout(() => {
                                window.location.reload();
                            }, 500);

                            return; // Don't update player list since we're no longer in lobby
                        }

                        // Handle other players leaving during game
                        if (payload.eventType === 'DELETE' && payload.old.id !== myPlayerId) {
                            console.log('👋 Another player left:', payload.old);

                            // Show notification if game is in progress
                            const { data: room } = await supabase
                                .from('game_room')
                                .select('status')
                                .eq('id', currentGameId)
                                .single();

                            if (room && room.status === 'playing') {
                                const leftPlayer = allPlayersData.find(p => p.id === payload.old.id);
                                const playerName = leftPlayer ? getPlayerColorName(leftPlayer.player_index) : 'A player';
                                updateStatus(`${playerName} left the game`);

                                // Check if I'm the only player left (scoped to this room)
                                // NOTE: bot_weights/bot_source_id are included so a mid-game
                                // disconnect/removal doesn't silently strip per-bot identity
                                // out of allPlayersData for the rest of the game (bot-driver.js
                                // asBot() reads them fresh from this array every bot turn).
                                const { data: remainingPlayers } = await supabase
                                    .from('players')
                                    .select('id, username, player_index, color, bot_weights, bot_source_id, user_id')
                                    .eq('game_id', currentGameId);

                                console.log('💥 Remaining players after deletion:', remainingPlayers);
                                console.log('📍 My player ID:', myPlayerId);

                                if (remainingPlayers && remainingPlayers.length === 1 && remainingPlayers[0].id === myPlayerId) {
                                    console.log('I am the last player remaining - win by default!');
                                    console.log('My player index:', myPlayerIndex);

                                    // Mark game as finished with me as winner
                                    if (myPlayerIndex !== null && myPlayerIndex !== undefined) {
                                        console.log('Calling handleGameOver with index:', myPlayerIndex);
                                        await handleGameOver(myPlayerIndex, 'last_standing');
                                    } else {
                                        console.error('Cannot win - myPlayerIndex is null/undefined');
                                    }
                                } else {
                                    console.log('Still', remainingPlayers?.length || 0, 'players in game');
                                }

                                // Update placement-phase tracking if a player was kicked/left
                                if (remainingPlayers) {
                                    totalPlayers = remainingPlayers.length;
                                    allPlayersData = remainingPlayers;

                                    if (isPlacementPhase) {
                                        const remainingIndices = new Set(
                                            remainingPlayers
                                                .map(p => p.player_index)
                                                .filter(i => i !== null && i !== undefined)
                                        );

                                        // Drop placements for players that left
                                        playerTilesPlaced = new Set(
                                            Array.from(playerTilesPlaced).filter(idx => remainingIndices.has(idx))
                                        );

                                        // If all remaining players have placed, complete placement phase (host only)
                                        if (isHost && playerTilesPlaced.size >= totalPlayers && totalPlayers > 0) {
                                            isPlacementPhase = false;
                                            const sorted = Array.from(remainingIndices).sort((a, b) => a - b);
                                            activePlayerIndex = sorted[0];
                                            const startedAt = Date.now();
                                            turnStartedAtMs = startedAt;
                                            broadcastGameAction('placement-complete', {
                                                playerIndex: activePlayerIndex,
                                                turnStartedAt: startedAt
                                            });
                                            updateTurnDisplay();
                                        }
                                    }
                                }
                            }
                        }

                        // Debounced — see scheduleHostAndListRefresh()'s own comment for why
                        // this can't just run inline here anymore.
                        scheduleHostAndListRefresh();
                    }
                )
                .subscribe();
            
            // Subscribe to game_room table (scoped to this room)
            gameRoomSubscription = supabase
                .channel('game-room-sub-' + currentGameId + '-' + Math.random())
                .on('postgres_changes',
                    { event: '*', schema: 'public', table: 'game_room',
                      filter: `id=eq.${currentGameId}` },
                    (payload) => {
                        console.log('Game room update:', payload);
                        // Keep game-core.js's local cache fresh so checkTurnTimeout()'s
                        // once-a-second host loop never has to hit the DB just to read
                        // this — see hostTrackedRoomStatus's declaration for why.
                        if (payload.new && payload.new.status) {
                            hostTrackedRoomStatus = payload.new.status;
                        }
                        // The host renamed the room (rename_room): show it to everyone.
                        if (payload.new && payload.new.host_name) {
                            const rn = document.getElementById('room-name-value');
                            const re = document.getElementById('room-name-edit');
                            if (rn) rn.textContent = payload.new.host_name;
                            if (re && document.activeElement !== re) re.value = payload.new.host_name;
                        }
                        if (payload.new && payload.new.status === 'playing') {
                            handleGameStart();
                        } else if (payload.new && payload.new.status === 'finished') {
                            // Game ended - show win screen to all players who didn't trigger it themselves
                            console.log('🏁 Game finished!');
                            const winnerIndex = payload.new.current_turn_index ?? 0;
                            window.MatchRecorder?.finish(winnerIndex, null);
                            // Only show if we're not the winner (winner already saw it via handleGameOver)
                            if (winnerIndex !== myPlayerIndex) {
                                showGameOverToAll(winnerIndex, 'scrolls');
                            }
                        }
                    }
                )
                .subscribe();

            // Initial update
            updatePlayerList();

            // Fallback: poll once after subscription is established in case we missed
            // the status='playing' update while the Realtime channel was connecting
            setTimeout(async () => {
                if (!currentGameId) return;
                if (document.getElementById('game-layout')?.classList.contains('active')) return;
                const { data: room } = await supabase
                    .from('game_room')
                    .select('status')
                    .eq('id', currentGameId)
                    .single();
                if (room?.status === 'playing') {
                    console.log('🔄 Fallback poll: detected game already started - joining now');
                    handleGameStart();
                }
            }, 2000);
        }

        // Update player list display
        async function updatePlayerList() {
            if (!currentGameId) return; // Not in a room yet
            try {
                const { data: players, error } = await supabase
                    .from('players')
                    .select('*')
                    .eq('game_id', currentGameId)
                    .order('created_at', { ascending: true });

                if (error) throw error;

                const container = document.getElementById('players-container');
                if (!players || players.length === 0) {
                    container.innerHTML = '<p style="font-style: italic;">No players yet...</p>';
                    return;
                }

                const hostRow = determineHostRow(players);
                container.innerHTML = players.map((p) => {
                    const isMe = p.id === myPlayerId;
                    const readyIcon = p.is_ready ? '✓' : '○';
                    const readyClass = p.is_ready ? 'pp-player-ready-yes' : 'pp-player-ready-no';
                    const meLabel = isMe ? ' <span class="pp-player-you">(You)</span>' : '';
                    // Oldest non-bot player is the host (bots can never be host — no client to drive it)
                    const hostLabel = hostRow && p.id === hostRow.id ? ' <span class="pp-player-host">Host</span>' : '';
                    // Everyone's equipped name colour (bots have no user_id: plain)
                    const nameStyle = window.cosmeticsSystem?.styleForUser(p.user_id) || '';

                    return `
                        <div class="pp-player-row${isMe ? ' is-me' : ''}">
                            <span><span${p.user_id ? ` class="player-card-link" data-player-card="${p.user_id}" title="View player"` : ''} style="${nameStyle}">${typeof displayUsername === 'function' ? displayUsername(p.username) : p.username}</span>${hostLabel}${meLabel}</span>
                            <span class="${readyClass}" style="font-size: 20px;">${readyIcon}</span>
                        </div>
                    `;
                }).join('');

                // Load the other players' name colours; draw again once they arrive.
                window.cosmeticsSystem?.loadNameColors(players.map(p => p.user_id))
                    .then(changed => { if (changed) updatePlayerList(); });

                // Update room player count in the info bar
                const playerCountEl = document.getElementById('room-player-count');
                if (playerCountEl) playerCountEl.textContent = `${players.length} / 5`;

                // Show/hide host settings panel
                const hostSettings = document.getElementById('host-settings');
                const totalCount = players.length;

                // Host settings (and Start button) appear as soon as there are enough players
                if (isHost && totalCount >= 2 && totalCount <= 5) {
                    hostSettings.style.display = 'block';
                } else {
                    hostSettings.style.display = 'none';
                }

                // Host-only bot controls — visible even when the host is alone
                // (adding a bot is how a solo host reaches the 2-player minimum).
                // Any number of bots up to the room's 5-player cap; Add/Remove
                // are separate buttons (not a 0/1 toggle) so the host can stack
                // multiple bots into one room.
                const botControls   = document.getElementById('bot-controls');
                const addBotBtn     = document.getElementById('add-bot-button');
                const removeBotBtn  = document.getElementById('remove-bot-button');
                if (botControls && addBotBtn && removeBotBtn) {
                    const botCount = players.filter(p => window.isBotUsername?.(p.username)).length;
                    botControls.style.display = (isHost && (botCount > 0 || totalCount < 5)) ? 'block' : 'none';
                    addBotBtn.style.display = totalCount < 5 ? 'inline-block' : 'none';
                    removeBotBtn.style.display = botCount > 0 ? 'inline-block' : 'none';
                    addBotBtn.textContent = botCount > 0 ? `Add Bot (${botCount})` : 'Add Bot';
                }

                // Update status
                const statusDiv = document.getElementById('lobby-status');

                if (totalCount < 2) {
                    statusDiv.textContent = 'Waiting for more players... (need at least 2)';
                    statusDiv.style.color = '#9f34ad';
                } else if (totalCount > 5) {
                    statusDiv.textContent = 'Too many players! Maximum is 5.';
                    statusDiv.style.color = '#f44336';
                } else if (isHost) {
                    statusDiv.textContent = `${totalCount} players in lobby. Ready to start!`;
                    statusDiv.style.color = '#4CAF50';
                } else {
                    statusDiv.textContent = `${totalCount} players in lobby. Waiting for host to start...`;
                    statusDiv.style.color = '#4CAF50';
                }
                
            } catch (error) {
                console.error('Error updating player list:', error);
            }
        }

        // ── Bot players (host-only) ──────────────────────────────────
        // A bot is a plain `players` row whose username carries the bot
        // prefix (window.BOT_USERNAME_PREFIX, set by js/bot-driver.js).
        // It has no client of its own: the HOST's browser drives its
        // placement and turns (see js/bot-driver.js). From the lobby's
        // perspective it counts as a player for everything — player count,
        // colors, turn order, start conditions. bot-driver.js's watcher
        // already drives WHICHEVER bot is active off a live-queried set of
        // bot indices, so any number of bots (up to the room's 5-player
        // cap) works with no changes there.
        //
        // Each bot's ELEMENTAL identity (name + weights) is decided at game
        // start, not here: a seat rolls its colour in hostStartGame() and the
        // colour picks the element (js/bot-elements.js). So the lobby row is
        // just a placeholder "🤖 Bot N" with no weights; hostStartGame()
        // rewrites username / bot_weights / bot_source_id per rolled colour.
        async function addBotPlayer() {
            if (!isHost || !currentGameId) return;
            try {
                const { data: players, error } = await supabase
                    .from('players')
                    .select('id, username')
                    .eq('game_id', currentGameId);
                if (error) throw error;

                if ((players || []).length >= 5) { alert('Room is full!'); return; }
                const botCount = (players || []).filter(p => window.isBotUsername?.(p.username)).length;

                const username = `${window.BOT_USERNAME_PREFIX || '🤖'} Bot ${botCount + 1}`;

                await supabase.from('players').insert([{
                    username,
                    is_ready: true, // bots are always ready
                    game_id: currentGameId,
                    bot_weights: null,
                    bot_source_id: null,
                }]);
                console.log(`🤖 Bot added to lobby as "${username}"`);
                updatePlayerList();
            } catch (e) {
                console.error('Add bot failed:', e);
                alert('Could not add bot: ' + e.message);
            }
        }
        window.addBotPlayer = addBotPlayer;

        async function removeBotPlayer() {
            if (!isHost || !currentGameId) return;
            try {
                const { data: players, error } = await supabase
                    .from('players')
                    .select('id, username')
                    .eq('game_id', currentGameId);
                if (error) throw error;

                const bots = (players || []).filter(p => window.isBotUsername?.(p.username));
                if (!bots.length) return;
                // Remove the most recently added bot (direct DELETE is blocked by RLS)
                await supabase.rpc('remove_player', { p_player_id: bots[bots.length - 1].id });
                console.log('🤖 Bot removed from lobby');
                updatePlayerList();
            } catch (e) {
                console.error('Remove bot failed:', e);
                alert('Could not remove bot: ' + e.message);
            }
        }
        window.removeBotPlayer = removeBotPlayer;

        // Host starts the game manually
        async function hostStartGame() {
            if (!isHost) {
                alert('Only the host can start the game!');
                return;
            }

            // Connection gate: the host is the single worst place to start a game
            // from with a bad connection — every enforcement loop that follows
            // (turn timer, disconnect sweep, scroll-state sync) is host-only, so
            // a struggling host connection breaks the game for everyone in the
            // room, not just themselves. See js/connection-monitor.js.
            if (window.ConnectionMonitor && !window.ConnectionMonitor.isWorkable()) {
                const connStatus = window.ConnectionMonitor.getStatus();
                if (!connStatus.browserOnline || connStatus.quality === 'offline') {
                    alert('⚠️ You appear to be offline right now, so the game can\'t start. Check your connection and try again.');
                    return;
                }
                const proceed = await new Promise((resolve) => {
                    showRetroConfirm(
                        '⚠️ Weak Connection',
                        [
                            'Your connection looks unstable right now' + (connStatus.lastError ? ' (' + _esc(connStatus.lastError) + ')' : '') + '.',
                            'Starting a game like this often causes desyncs, false kicks, or stuck turns for everyone in the room.',
                            'Start anyway?'
                        ],
                        () => resolve(true)
                    );
                });
                if (!proceed) return; // Cancel just closes the dialog — nothing to clean up
            }

            // Disable the button immediately to prevent double-clicks
            const startBtn = document.getElementById('host-start-button');
            if (startBtn) startBtn.disabled = true;

            try {
                const { data: players, error } = await supabase
                    .from('players')
                    .select('*')
                    .eq('game_id', currentGameId);

                if (error) throw error;

                // Validate player count
                if (players.length < 2) {
                    if (startBtn) startBtn.disabled = false;
                    alert('Need at least 2 players to start!');
                    return;
                }

                if (players.length > 5) {
                    if (startBtn) startBtn.disabled = false;
                    alert('Too many players! Maximum is 5.');
                    return;
                }

                console.log('🎮 Host starting game with', players.length, 'players...');

                // Get turn timer settings
                const timeoutSelect = document.getElementById('timeout-setting');
                const turnTimeLimit = parseInt(timeoutSelect.value, 10) * 1000; // seconds -> ms
                const kickCheckbox = document.getElementById('kick-on-timeout');
                const kickMode = !!(kickCheckbox && kickCheckbox.checked);
                // Scarce Tiles Mode (N-1 tiles per element) is the only mode now —
                // the checkbox that used to toggle it is gone (see index.html).
                const scarceTiles = true;

                console.log('⚠️ Turn time limit set to:', turnTimeLimit / 1000, 'seconds');
                console.log('👢 Kick on turn timeout:', kickMode);

                // Randomly assign player indices and colors
                const colorRankOrder = ['purple', 'yellow', 'red', 'blue', 'green'];
                const shuffledIndices = [...Array(players.length).keys()].sort(() => Math.random() - 0.5);

                // Elemental bots: a bot seat's ROLLED COLOUR picks its element
                // (js/bot-elements.js COLOR_ELEMENT). Resolve the shared brain
                // (community champion) once and the five deployed_bots row ids,
                // then each bot seat below gets its elemental name + a gentle
                // per-element weight overlay. Must never throw — a failure here
                // would abort game start; fall back to the plain placeholder.
                let elementalBase = null;
                let elementalOk = false;
                if (window.BotElements) {
                    try {
                        const champRes = await supabase.from('bot_champion_weights')
                            .select('weights').order('promoted', { ascending: false }).order('created_at', { ascending: false }).limit(1); // current champion, sql/champion-promoted.sql
                        elementalBase = champRes?.data?.[0]?.weights || null;
                    } catch (e) { elementalBase = null; }
                    if (!elementalBase) {
                        console.warn('[elemental] champion fetch failed at game start - using local WEIGHTS');
                        elementalBase = window.BotSystem?.WEIGHTS || window.BotSystem?.DEFAULT_WEIGHTS || {};
                    }
                    try { await window.BotElements.resolveIds(); } catch (e) {}
                    elementalOk = true;
                }

                // Assign colors and indices to players BEFORE flipping game_room.status
                // to 'playing'. The status flip fires the game_room Realtime subscription
                // immediately — including on the HOST'S OWN tab, which races its own direct
                // handleGameStart() call below (see the _gameStartInFlight comment). That
                // racing call only waits for the LOCAL player's own player_index, not
                // everyone else's, so if indices were still being assigned when it read
                // `allPlayers`, bot rows not yet updated got frozen into allPlayersData
                // with player_index=null for the rest of the game — bot-driver.js's
                // botIndexSet() then silently never drives them (the reported "bots
                // appear gray and never act" bug). Assigning indices first guarantees no
                // subscriber can ever observe status='playing' while a row is unassigned.
                for (let i = 0; i < players.length; i++) {
                    const player = players[i];
                    const assignedIndex = shuffledIndices[i];
                    const assignedColor = colorRankOrder[assignedIndex];

                    const update = { player_index: assignedIndex, color: assignedColor };

                    if (elementalOk && window.isBotUsername?.(player.username)) {
                        const el = window.BotElements.COLOR_ELEMENT[assignedColor];
                        if (el) {
                            update.username = `${window.BOT_USERNAME_PREFIX || '🤖'} ${window.BotElements.NAMES[el]}`;
                            update.bot_weights = window.BotElements.elementalOverlay(elementalBase, el);
                            const rowId = window.BotElements.idFor(el);
                            if (rowId != null) update.bot_source_id = rowId;

                            // HERMIT-ONLY: js/bot-imitation.js's "🧠 Learn from
                            // my play" toggle. When it's the HOST's own toggle
                            // that's on, every bot in the room plays with the
                            // host's learned delta layered on top of its
                            // normal elemental base — not a separate bot, the
                            // same ones already in the room. Off (or someone
                            // else hosting): bots play the plain base,
                            // unchanged, exactly as today.
                            if (typeof window.isHermit === 'function' && window.isHermit() &&
                                window.BotImitation && typeof window.BotImitation.isEnabled === 'function' &&
                                window.BotImitation.isEnabled()) {
                                const before = update.bot_weights;
                                update.bot_weights = window.BotImitation.applyDeltas(before);
                                const delta = window.BotImitation.getDeltas();
                                const changedKeys = Object.keys(delta).filter(k => typeof before[k] === 'number' && before[k] !== update.bot_weights[k]);
                                console.log(`🧠 [Imitation] applied your learned delta to ${update.username}'s weights ` +
                                    `(${changedKeys.length} key(s) changed${changedKeys.length ? ': ' + changedKeys.join(', ') : ''})`);
                            }
                        }
                    }

                    const { error: assignError } = await supabase
                        .from('players')
                        .update(update)
                        .eq('id', player.id);

                    if (assignError) {
                        console.error(`❌ Failed to assign player_index/color to player ${player.id}:`, assignError);
                        throw assignError;
                    }
                }

                // Update game room status to trigger game start and store turn-timer settings
                const startedAtIso = new Date().toISOString();

                // Try writing extended fields; if the DB schema doesn't have them, fall back gracefully.
                let { error: roomError } = await supabase
                    .from('game_room')
                    .update({
                        status: 'playing',
                        current_turn_index: 0,
                        inactivity_timeout: turnTimeLimit,        // reused as turn time limit (ms)
                        kick_on_turn_timeout: kickMode,
                        turn_started_at: startedAtIso,
                        scarce_tiles: scarceTiles
                    })
                    .eq('id', currentGameId);

                if (roomError) {
                    console.warn('⚠️ Failed to write extended turn timer fields to game_room. Trying without optional fields...', roomError);
                    // Try without kick_on_turn_timeout, turn_started_at and scarce_tiles
                    let fallback = await supabase
                        .from('game_room')
                        .update({
                            status: 'playing',
                            current_turn_index: 0,
                            inactivity_timeout: turnTimeLimit
                        })
                        .eq('id', currentGameId);

                    if (fallback.error) {
                        console.warn('⚠️ Second fallback failed, trying minimal update...', fallback.error);
                        // Minimal fallback - just status and turn index
                        fallback = await supabase
                            .from('game_room')
                            .update({
                                status: 'playing',
                                current_turn_index: 0
                            })
                            .eq('id', currentGameId);
                    }

                    roomError = fallback.error;
                }

                if (roomError) throw roomError;

                // Also set local host timer baseline immediately
                gameInactivityTimeout = turnTimeLimit;
                kickOnTurnTimeout = kickMode;
                turnStartedAtMs = Date.now();

                console.log('✅ Game started by host!');

                // Host transitions immediately; non-host players receive the trigger via Realtime
                await handleGameStart();

            } catch (error) {
                console.error('Error starting game:', error);
                if (startBtn) startBtn.disabled = false; // allow retry
                alert('Failed to start game: ' + error.message);
            }
        }

        // Handle game start
        // Synchronous re-entrancy guard for handleGameStart. The 'active'-class
        // check below cannot stop CONCURRENT calls: the class is only added near
        // the END of the function, after several awaited Supabase round-trips,
        // and the host always triggers handleGameStart twice inside that window
        // (its own direct call after starting the game + the game_room Realtime
        // callback). Both used to run the full init — double UI init, every tile
        // placed twice, duplicate broadcast-channel subscriptions. Cleared in
        // finally (not on success only) so a FAILED start can still be retried
        // by the Realtime/fallback-poll paths, and a leave-then-rejoin (which
        // removes the class) is never blocked by stale state.
        let _gameStartInFlight = false;

        async function handleGameStart() {
            // Guard against duplicate calls (host's direct call + Realtime subscription racing)
            if (document.getElementById('game-layout').classList.contains('active')) {
                console.log('🔁 handleGameStart: game already active - skipping duplicate call');
                return;
            }
            if (_gameStartInFlight) {
                console.log('🔁 handleGameStart: start already in flight - skipping duplicate call');
                return;
            }
            _gameStartInFlight = true;
            try {
                // Wait for player_index to be assigned (retry up to 10 times)
                let myPlayer = null;
                let attempts = 0;
                
                while (attempts < 10) {
                    const { data, error } = await supabase
                        .from('players')
                        .select('*')
                        .eq('id', myPlayerId)
                        .single();
                    
                    if (error) throw error;
                    
                    if (data.player_index !== null && data.player_index !== undefined) {
                        myPlayer = data;
                        break;
                    }
                    
                    console.log(`⏳ Waiting for player index assignment (attempt ${attempts + 1}/10)...`);
                    await new Promise(resolve => setTimeout(resolve, 300));
                    attempts++;
                }
                
                if (!myPlayer || myPlayer.player_index === null) {
                    throw new Error('Player index was not assigned');
                }
                
                myPlayerIndex = myPlayer.player_index;

                // Get all players in this room. This snapshot is frozen into
                // allPlayersData for the rest of the game (see startMultiplayerGame),
                // so retry if any row's player_index hasn't landed yet — reading it
                // early (e.g. this call racing the host's own index-assignment loop
                // in hostStartGame) used to permanently freeze bot rows as
                // player_index=null, leaving them undriven for the whole game.
                let allPlayers = null;
                for (let attempt = 0; attempt < 10; attempt++) {
                    const { data, error: allPlayersError } = await supabase
                        .from('players')
                        .select('*')
                        .eq('game_id', currentGameId)
                        .order('player_index', { ascending: true });

                    if (allPlayersError) throw allPlayersError;

                    if (data && data.every(p => p.player_index !== null && p.player_index !== undefined)) {
                        allPlayers = data;
                        break;
                    }

                    console.log(`⏳ Waiting for all players' index assignment (attempt ${attempt + 1}/10)...`);
                    allPlayers = data; // keep the latest snapshot in case we exhaust retries
                    await new Promise(resolve => setTimeout(resolve, 300));
                }

                console.log('🎮 Starting multiplayer game!');
                console.log('My index:', myPlayerIndex);
                console.log('My color:', myPlayer.color);
                console.log('All players:', allPlayers);
                
                // Get game room settings (turn timer)
                // We select '*' for forward/backward compatibility if columns are missing.
                const { data: room } = await supabase
                    .from('game_room')
                    .select('*')
                    .eq('id', currentGameId)
                    .single();

                if (room && room.inactivity_timeout !== null && room.inactivity_timeout !== undefined) {
                    gameInactivityTimeout = room.inactivity_timeout; // reused as turn time limit (ms)
                    console.log('⚠️ Loaded turn time limit:', gameInactivityTimeout / 1000, 'seconds');
                }

                if (room && room.kick_on_turn_timeout !== null && room.kick_on_turn_timeout !== undefined) {
                    kickOnTurnTimeout = !!room.kick_on_turn_timeout;
                    console.log('👢 kickOnTurnTimeout:', kickOnTurnTimeout);
                }

                // Always on now — see hostStartGame()'s own scarceTiles for why.
                const scarceTiles = true;

                // Set turn started time
                if (room && room.turn_started_at) {
                    const ts = new Date(room.turn_started_at).getTime();
                    if (!Number.isNaN(ts)) {
                        turnStartedAtMs = ts;
                    } else {
                        turnStartedAtMs = Date.now();
                    }
                } else {
                    turnStartedAtMs = Date.now();
                }

                // Derive deck seed from player IDs - this is deterministic and shared
                // Sort player IDs and hash them to get a consistent seed
                const sortedPlayerIds = allPlayers.map(p => p.id).sort().join('');
                let gameDeckSeed = 0;
                for (let i = 0; i < sortedPlayerIds.length; i++) {
                    gameDeckSeed = ((gameDeckSeed << 5) - gameDeckSeed + sortedPlayerIds.charCodeAt(i)) | 0;
                }
                gameDeckSeed = Math.abs(gameDeckSeed);
                console.log('🎴 Derived deck seed from player IDs:', gameDeckSeed);

                // Hide lobby, show new game layout
                document.getElementById('lobby-wrapper').style.display = 'none';
                document.getElementById('game-layout').classList.add('active');
                updateDeckIndicatorVisibility();

                // Show leave game and end turn buttons in multiplayer
                document.getElementById('leave-game').style.display = 'inline-block';
                document.getElementById('end-turn').style.display = 'inline-block';

                // Show timer HUD element
                document.getElementById('hud-timer').style.display = 'flex';

                // Initialize new UI elements
                initializeNewUI();

                // Start turn timer monitoring (turn-based timeout)
                startTurnTimerMonitoring();

                // Host monitors for disconnected players (stale last_seen)
                if (isHost) startDisconnectMonitor();

                // All players poll every 5 s — bulletproof fallback for last-man-standing
                startLastManStandingPoll();

                // Initialize game with multiplayer players and shared deck seed
                startMultiplayerGame(allPlayers, gameDeckSeed, scarceTiles);

                // Host records the match (replays, cheat checks, stats).
                if (isHost) {
                    window.MatchRecorder?.start(gameDeckSeed, allPlayers, {
                        scarce_tiles: scarceTiles,
                        turn_time_ms: gameInactivityTimeout,
                        kick_on_timeout: !!kickOnTurnTimeout,
                    });
                }
                
            } catch (error) {
                console.error('Error handling game start:', error);
                alert('Failed to start game: ' + error.message);
            } finally {
                _gameStartInFlight = false;
            }
        }

        // Update heartbeat — keeps last_seen current in both lobby and active game
        let _heartbeatInterval = null;
        function updateHeartbeat() {
            if (!myPlayerId) return;
            if (_heartbeatInterval) clearInterval(_heartbeatInterval);
            const beat = async () => {
                if (!myPlayerId) { clearInterval(_heartbeatInterval); return; }
                try {
                    await supabase
                        .from('players')
                        .update({ last_seen: new Date().toISOString() })
                        .eq('id', myPlayerId);
                    // Bots have no client — the host heartbeats them so cleanup
                    // sweeps never mistake them for disconnected players.
                    if (isHost && currentGameId && typeof window.BOT_USERNAME_PREFIX === 'string') {
                        await supabase
                            .from('players')
                            .update({ last_seen: new Date().toISOString() })
                            .eq('game_id', currentGameId)
                            .like('username', window.BOT_USERNAME_PREFIX + '%');
                    }
                } catch (e) { /* ignore */ }
            };
            beat(); // Fire immediately so last_seen is never NULL
            _heartbeatInterval = setInterval(beat, 15000); // Every 15 seconds
        }

        // Host-only: periodically sweep disconnected players (stale last_seen).
        // Deletion triggers the existing players DELETE handler on all clients,
        // which shows "player left" notifications and handles turn skipping.
        // During an active game (status=playing) we do NOT evict — the last-man-standing
        // poll handles genuine disconnects, and idle-but-present players must not be removed.
        let _disconnectMonitorInterval = null;
        function startDisconnectMonitor() {
            if (_disconnectMonitorInterval) clearInterval(_disconnectMonitorInterval);
            _disconnectMonitorInterval = setInterval(async () => {
                if (!isHost || !currentGameId) return;
                try {
                    // Check current room status — never evict from an active game
                    const { data: room } = await supabase
                        .from('game_room')
                        .select('status')
                        .eq('id', currentGameId)
                        .single();
                    if (!room || room.status === 'playing') return;

                    const staleThreshold = new Date(Date.now() - 45 * 1000).toISOString();
                    const { data: allPlayers } = await supabase
                        .from('players')
                        .select('id, username, last_seen, created_at')
                        .eq('game_id', currentGameId)
                        .neq('id', myPlayerId); // never self-evict
                    const stalePlayers = (allPlayers || []).filter(p => {
                        // Bots have no client of their own — never evict them
                        if (window.isBotUsername?.(p.username)) return false;
                        // Use last_seen if available, fall back to created_at
                        const ref = p.last_seen || p.created_at;
                        return ref < staleThreshold;
                    });
                    for (const p of stalePlayers) {
                        console.log(`⚠️ Disconnect: ${p.username} (last_seen=${p.last_seen}) - removing`);
                        await supabase.rpc('remove_player', { p_player_id: p.id });
                    }
                } catch (e) { /* ignore network errors */ }
            }, 15000); // Check every 15 seconds
        }
        function stopDisconnectMonitor() {
            if (_disconnectMonitorInterval) {
                clearInterval(_disconnectMonitorInterval);
                _disconnectMonitorInterval = null;
            }
        }

        // Clean up on page unload (reload, tab close). Direct DELETE is blocked
        // by RLS, so this goes through the same RPCs as the Leave buttons.
        // A HOST leaving a WAITING room deletes the whole room, exactly like
        // leaveRoom() does. Before, only the host's own seat was removed, so
        // the room and its bots stayed listed (and the host was told "already
        // in this room" on rejoin) until the server cleanup ran minutes later.
        // In a game in progress only our own seat goes, so the other players
        // keep playing. pagehide also covers mobile, where beforeunload often
        // never fires; the flag stops the double call when both fire.
        let _unloadCleanupSent = false;
        // The unload fetch can't await getSession(), so keep the signed-in
        // user's access token cached here (refreshed on every auth change).
        // delete_game_room only works for the room's host, so the request
        // must carry the user's token, not just the anon key.
        let _accessToken = null;
        try {
            supabase.auth.getSession().then(r => { _accessToken = r?.data?.session?.access_token || null; }).catch(() => {});
            supabase.auth.onAuthStateChange((_event, session) => { _accessToken = session?.access_token || null; });
        } catch (e) { /* no Supabase client (offline): unload falls back to the anon key */ }
        function _cleanupOnUnload() {
            if (_unloadCleanupSent || !myPlayerId) return;
            _unloadCleanupSent = true;
            const inGame = document.getElementById('game-layout')?.classList.contains('active');
            const deleteRoom = isHost && currentGameId && !inGame;
            fetch(`${SUPABASE_URL}/rest/v1/rpc/${deleteRoom ? 'delete_game_room' : 'remove_player'}`, {
                method: 'POST',
                headers: {
                    'apikey': SUPABASE_ANON_KEY,
                    'Authorization': `Bearer ${_accessToken || SUPABASE_ANON_KEY}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(deleteRoom ? { p_room_id: currentGameId } : { p_player_id: myPlayerId }),
                keepalive: true
            });
        }
        window.addEventListener('beforeunload', _cleanupOnUnload);
        window.addEventListener('pagehide', _cleanupOnUnload);

        // Auto-refresh player list when tab becomes visible again
        // (catches missed real-time events while tab was in background)
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible' && myPlayerId) {
                console.log('🔄 Tab visible - refreshing player list');
                updatePlayerList();
            }
        });

        // Periodic lobby poll — re-fetch player list every 10s while in lobby (not in-game)
        let lobbyPollInterval = null;

        function startLobbyPoll() {
            stopLobbyPoll(); // Clear any existing interval
            lobbyPollInterval = setInterval(() => {
                if (!myPlayerId) {
                    stopLobbyPoll();
                    return;
                }
                // Only poll while in lobby phase (not during an active game)
                const lobbyVisible = document.getElementById('multiplayer-lobby').style.display !== 'none';
                if (lobbyVisible) {
                    updatePlayerList();
                } else {
                    // Game started — stop polling
                    stopLobbyPoll();
                }
            }, 10000);
        }

        function stopLobbyPoll() {
            if (lobbyPollInterval) {
                clearInterval(lobbyPollInterval);
                lobbyPollInterval = null;
            }
        }


        // Secret keyboard sequence "reset" to reveal the Reset Lobby button.
        // (The old unguarded "nuke" secret sequence lived here too — it had no
        // isHermit() check at all, so any player who happened to type "nuke"
        // while the lobby was visible could wipe every room/player in the DB.
        // It's now the hermit-only "☢️ Nuke All Rooms" button in the TH dev
        // menu — see game-ui.js's initHermitMenu — and nuke_all_rooms() itself
        // is now gated server-side with is_hermit() too, so it's safe even if
        // someone calls the RPC directly from devtools.)
        (function() {
            const SECRET = 'reset';
            let buffer = '';
            document.addEventListener('keydown', (e) => {
                // Only listen while lobby is visible
                const lobbyEl = document.getElementById('multiplayer-lobby');
                if (!lobbyEl || lobbyEl.style.display === 'none') return;
                // Ignore if user is typing in an input field
                if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

                buffer += e.key.toLowerCase();
                if (buffer.length > SECRET.length) buffer = buffer.slice(-SECRET.length);

                if (buffer.endsWith(SECRET)) {
                    const btn = document.getElementById('reset-lobby-btn');
                    if (btn) {
                        btn.style.display = btn.style.display === 'none' ? '' : 'none';
                        buffer = '';
                    }
                }
            });
        })();

        let gameChannel = null; // Global reference to the game broadcast channel
        let _gameChannelReconnectAttempts = 0; // Backoff counter for the auto-reconnect below; reset on a fresh join or a successful SUBSCRIBED

        // Set up broadcast channel for real-time game synchronization
        // Scroll-state validation interval — one per game channel. Must be
        // tracked and cleared: setupGameBroadcast() runs once per game joined
        // in this tab, and an untracked interval here permanently stacks
        // (N games = N validators + N duplicate sync broadcasts every 3s).
        let scrollStateSyncInterval = null;
        // Last snapshot actually SENT (not just computed) — lets the interval
        // below skip broadcasting when nothing changed since last tick instead
        // of unconditionally re-sending the full scroll state to every client
        // every 3 seconds for the entire game. Reset per game so a stale
        // snapshot from a previous game can never suppress game 2's first sync.
        let _lastBroadcastScrollSnapshot = null;
        let _scrollSyncTicksSinceBroadcast = 0;
        function stopScrollStateSync() {
            if (scrollStateSyncInterval) {
                clearInterval(scrollStateSyncInterval);
                scrollStateSyncInterval = null;
            }
            _lastBroadcastScrollSnapshot = null;
            _scrollSyncTicksSinceBroadcast = 0;
        }

        // isReconnectAttempt: true only when THIS function's own auto-reconnect
        // (below, in the subscribe() status callback) is rebuilding a dropped
        // channel — every other caller is a genuine fresh join, which should
        // reset the backoff counter. Keeping this as a param (not touching the
        // one pre-existing call site) means the normal join path is unchanged.
        function setupGameBroadcast(isReconnectAttempt) {
            if (!isReconnectAttempt) _gameChannelReconnectAttempts = 0;
            stopScrollStateSync();
            if (gameChannel) {
                gameChannel.unsubscribe();
            }

            // Create a channel scoped to this specific game room
            gameChannel = supabase.channel('game-room-' + currentGameId, {
                config: {
                    broadcast: { self: false } // Don't receive our own broadcasts
                }
            });

            // Match recording (host only): every message from the others.
            gameChannel.on('broadcast', { event: '*' }, (msg) => {
                const p = msg?.payload;
                window.MatchRecorder?.record(msg?.event, p,
                    typeof p?.playerIndex === 'number' ? p.playerIndex : null);
            });

            // Listen for tile flip events
            gameChannel.on('broadcast', { event: 'tile-flip' }, ({ payload }) => {
                console.log('📄 Received tile flip broadcast:', payload);
                const { tileId, shrineType } = payload;
                // Find the tile and flip it
                const tile = document.querySelector(`[data-tile-id="${tileId}"]`);
                if (tile) {
                    console.log(`✅ Found tile ${tileId}, flipping to ${shrineType}`);
                    flipTileVisually(tile, shrineType);
                    // Adaptive music: remote flip grows the same Joytone sequence locally
                    window.JoytoneBridge?.onTileRevealed(shrineType, tileId);
                    // Re-apply Wandering River indicator if this tile was transformed (flip replaced the element)
                    if (typeof placedTiles !== 'undefined' && spellSystem && spellSystem.scrollEffects) {
                        const tileObj = placedTiles.find(t => Number(t.id) === Number(tileId));
                        const wr = spellSystem.scrollEffects.activeBuffs.wanderingRiver;
                        const entry = Array.isArray(wr) ? wr.find(e => Number(e.tileId) === Number(tileId)) : null;
                        if (tileObj && entry && entry.newElement) {
                            spellSystem.scrollEffects.applyWanderingRiverIndicator(tileObj, entry.newElement);
                        }
                    }
                } else {
                    console.error(`❌ Could not find tile with id ${tileId} in DOM`);
                }
            });

            // Wandering River: other players see and are affected by the transformation (clear at caster's next turn)
            gameChannel.on('broadcast', { event: 'wandering-river-apply' }, ({ payload }) => {
                console.log('📄 Received wandering-river-apply:', payload);
                const { tileId, newElement, playerIndex } = payload;
                if (!spellSystem || !spellSystem.scrollEffects) return;
                spellSystem.scrollEffects.activeBuffs.wanderingRiver = spellSystem.scrollEffects.activeBuffs.wanderingRiver || [];
                spellSystem.scrollEffects.activeBuffs.wanderingRiver.push({
                    tileId: tileId,
                    newElement: newElement,
                    playerIndex: playerIndex,
                    expiresNextTurn: true
                });
                if (typeof placedTiles !== 'undefined') {
                    const tile = placedTiles.find(t => Number(t.id) === Number(tileId));
                    if (tile && tile.element) {
                        spellSystem.scrollEffects.applyWanderingRiverIndicator(tile, newElement);
                    }
                }
            });

            // Take Flight (Wind IV): teleport a player to a new position
            gameChannel.on('broadcast', { event: 'take-flight' }, ({ payload }) => {
                console.log('📄 Received take-flight:', payload);
                const { casterIndex: tfCaster, targetPlayerIndex, x, y } = payload;

                // Move the pawn
                if (typeof movePlayerVisually === 'function') {
                    movePlayerVisually(targetPlayerIndex, x, y, 0);
                } else {
                    const target = playerPositions[targetPlayerIndex];
                    if (target) {
                        target.x = x;
                        target.y = y;
                        if (target.element) {
                            target.element.setAttribute('transform', `translate(${x}, ${y})`);
                        }
                    }
                }
                console.log(`🌬️ Take Flight: player ${targetPlayerIndex} teleported to (${x.toFixed(1)}, ${y.toFixed(1)})`);

                // No scroll disposition sync needed — Take Flight always stays
                // in the caster's active area, regardless of who was targeted.

                // If I'm the caster and was waiting on the target to choose
                // their own landing hex (real-multiplayer opponent-target
                // hand-off), this result IS that choice — finish the effect
                // on my side now (see enterTakeFlightMode's handOffToTarget).
                const pendingTF = window.pendingTakeFlightCompletion;
                if (typeof myPlayerIndex !== 'undefined' && myPlayerIndex === tfCaster &&
                    pendingTF && pendingTF.targetPlayerIndex === targetPlayerIndex) {
                    window.pendingTakeFlightCompletion = null;
                    if (spellSystem?.scrollEffects?.selectionMode?.type === 'take-flight-await-remote') {
                        spellSystem.scrollEffects.selectionMode.cleanup?.();
                        spellSystem.scrollEffects.selectionMode = null;
                    }
                    if (pendingTF.completionPayload && spellSystem && typeof spellSystem.onSelectionEffectComplete === 'function') {
                        spellSystem.onSelectionEffectComplete(
                            pendingTF.completionPayload.scrollName,
                            pendingTF.completionPayload.effectName,
                            pendingTF.completionPayload.spell
                        );
                    }
                }
            });

            // Take Flight: caster targeted ME with an opponent-target — my own
            // client drives the destination choice (see
            // ScrollEffects.enterTakeFlightChoiceAsTarget). If the target is
            // a bot instead (added via the lobby's Add Bot button), it has no
            // client of its own to receive this — the host's BotDriver
            // resolves it on the bot's behalf instead (see
            // BotDriver.resolveTakeFlightChoice in bot-driver.js).
            gameChannel.on('broadcast', { event: 'take-flight-choose-request' }, ({ payload }) => {
                console.log('📄 Received take-flight-choose-request:', payload);
                const { casterIndex: tfCaster, targetPlayerIndex, scrollName: tfScroll } = payload;
                if (typeof myPlayerIndex !== 'undefined' && myPlayerIndex !== null && myPlayerIndex === targetPlayerIndex) {
                    if (spellSystem?.scrollEffects?.enterTakeFlightChoiceAsTarget) {
                        spellSystem.scrollEffects.enterTakeFlightChoiceAsTarget(tfCaster, targetPlayerIndex, tfScroll);
                    }
                    return;
                }
                if (window.BotDriver?.resolveTakeFlightChoice) {
                    window.BotDriver.resolveTakeFlightChoice(tfCaster, targetPlayerIndex, tfScroll);
                }
            });

            // Take Flight: either side (caster waiting, or target mid-drag)
            // cancelled — tear down locally on whichever end is still open.
            gameChannel.on('broadcast', { event: 'take-flight-cancel-request' }, ({ payload }) => {
                console.log('📄 Received take-flight-cancel-request:', payload);
                const { targetPlayerIndex } = payload;
                if (window.takeFlightState?.targetPlayerIndex === targetPlayerIndex) {
                    window.takeFlightState.onCancel?.();
                } else if (spellSystem?.scrollEffects?.selectionMode?.type === 'take-flight-await-remote' &&
                           spellSystem.scrollEffects.selectionMode.targetPlayerIndex === targetPlayerIndex) {
                    window.pendingTakeFlightCompletion = null;
                    spellSystem.scrollEffects.cancelSelectionMode();
                    updateStatus('Take Flight cancelled.');
                }
            });

            // Catacomb/Freedom teleport: sync shrine teleports
            gameChannel.on('broadcast', { event: 'catacomb-teleport' }, ({ payload }) => {
                console.log('📄 Received catacomb-teleport:', payload);
                const { playerIndex, x, y } = payload;
                if (typeof movePlayerVisually === 'function') {
                    movePlayerVisually(playerIndex, x, y, 0);
                } else {
                    const target = playerPositions[playerIndex];
                    if (target) {
                        target.x = x;
                        target.y = y;
                        if (target.element) {
                            target.element.setAttribute('transform', `translate(${x}, ${y})`);
                        }
                    }
                }
                console.log(`🔅 Catacomb teleport: player ${playerIndex} to (${x.toFixed(1)}, ${y.toFixed(1)})`);
            });

            // Freedom (Wind III): other players receive the buff so shrine teleport works for everyone
            gameChannel.on('broadcast', { event: 'freedom-apply' }, ({ payload }) => {
                console.log('📄 Received freedom-apply:', payload);
                const { playerIndex } = payload;
                if (!spellSystem || !spellSystem.scrollEffects) return;
                spellSystem.scrollEffects.activeBuffs.freedom = {
                    playerIndex: playerIndex,
                    expiresNextTurn: true
                };
                if (typeof updateCatacombIndicators === 'function') {
                    updateCatacombIndicators();
                }
            });

            // Listen for stone placement events
            gameChannel.on('broadcast', { event: 'stone-place' }, ({ payload }) => {
                console.log('📄 Received stone placement:', payload);
                const { x, y, stoneType } = payload;
                placeStoneVisually(x, y, stoneType);
                // No playerIndex in this payload (stones are always placed by
                // the active player) — record() falls back to activePlayerIndex.
                window.ActionLog?.record('placeStone', { x: +x.toFixed(1), y: +y.toFixed(1), stoneType });
            });

            // Listen for stone move events
            gameChannel.on('broadcast', { event: 'stone-move' }, ({ payload }) => {
                console.log('📄 Received stone move:', payload);
                const { stoneId, x, y, stoneType } = payload;
                moveStoneVisually(stoneId, x, y, stoneType);
            });

            // Listen for stone break events
            gameChannel.on('broadcast', { event: 'stone-break' }, ({ payload }) => {
                console.log('📄 Received stone break:', payload);
                const { stoneId } = payload;
                breakStoneVisually(stoneId);
            });

            // Listen for water stone transformation (Control the Current)
            gameChannel.on('broadcast', { event: 'water-stone-transformed' }, ({ payload }) => {
                console.log('📄 Received water stone transformation:', payload);
                const { stoneX, stoneY, newElement } = payload;
                if (typeof window.transformWaterStoneVisually === 'function') {
                    window.transformWaterStoneVisually(stoneX, stoneY, newElement);
                }
            });

            // Listen for player tile placement events
            gameChannel.on('broadcast', { event: 'player-tile-place' }, ({ payload }) => {
                console.log('📄 Received player tile placement:', payload);
                const { x, y, playerIndex, color, cosmetics } = payload;
                placePlayerTileVisually(x, y, playerIndex, color, cosmetics || null);
            });

            // Listen for player movement events
            gameChannel.on('broadcast', { event: 'player-move' }, ({ payload }) => {
                console.log('📄 Received player movement:', payload);
                const { playerIndex, x, y, apSpent, cosmetics } = payload;
                // Cache remote cosmetics so movePlayerVisually can apply landing effects
                if (cosmetics) {
                    window._remotePlayerCosmetics = window._remotePlayerCosmetics || {};
                    window._remotePlayerCosmetics[playerIndex] = cosmetics;
                }
                movePlayerVisually(playerIndex, x, y, apSpent);
                // Explicit playerIndex from the payload, not the ambient
                // activePlayerIndex — see the override note in action-log.js.
                window.ActionLog?.record('move', { x: +x.toFixed(1), y: +y.toFixed(1), apSpent }, playerIndex);
                // Defensively flip any hidden tiles at the destination.
                // This ensures tile reveals are visible even if the tile-flip broadcast
                // arrives out of order or is lost. Uses the shared deck state to determine
                // shrine type (both clients drew from the same seed, so shrineType matches).
                if (typeof getAllHexagonPositions === 'function' && typeof placedTiles !== 'undefined') {
                    const allHexes = getAllHexagonPositions();
                    let nearestHex = null;
                    let nearestDist = Infinity;
                    allHexes.forEach(hexPos => {
                        const d = Math.sqrt(Math.pow(hexPos.x - x, 2) + Math.pow(hexPos.y - y, 2));
                        if (d < nearestDist) { nearestDist = d; nearestHex = hexPos; }
                    });
                    if (nearestHex && nearestDist < 5 && nearestHex.tiles) {
                        nearestHex.tiles
                            .filter(t => t.flipped && !t.isPlayerTile)
                            .forEach(t => {
                                const el = document.querySelector(`[data-tile-id="${t.id}"]`);
                                if (el && typeof flipTileVisually === 'function') {
                                    console.log(`🔄 Proactively flipping tile ${t.id} at received player position`);
                                    flipTileVisually(el, t.shrineType);
                                }
                            });
                    }
                }
            });

            // Listen for turn change events
            gameChannel.on('broadcast', { event: 'turn-change' }, ({ payload }) => {
                console.log('📄 Received turn-change:', payload.playerIndex, 'turnNumber:', payload.turnNumber, 'myPlayerIndex:', myPlayerIndex, 'isPlacementPhase:', isPlacementPhase);

                // Validate turn number for desync detection
                if (typeof payload.turnNumber === 'number') {
                    const expectedTurn = lastReceivedTurnNumber + 1;

                    if (payload.turnNumber > expectedTurn) {
                        // We missed some turns! Log warning
                        console.warn(`⚠️ DESYNC DETECTED: Expected turn ${expectedTurn}, received turn ${payload.turnNumber}. Missed ${payload.turnNumber - expectedTurn} turn(s).`);
                        updateStatus(`Turn sync issue detected - auto-correcting...`);
                    } else if (payload.turnNumber < lastReceivedTurnNumber) {
                        // Received an old turn? Ignore it
                        console.warn(`⚠️ Received outdated turn ${payload.turnNumber} (current: ${lastReceivedTurnNumber}). Ignoring.`);
                        return;
                    }

                    lastReceivedTurnNumber = payload.turnNumber;
                    // Found via a real playtest's godaigoTest.diag() output (2026-08-21):
                    // this receiver corrected lastReceivedTurnNumber (used only for the
                    // desync-detection math above) but never wrote the same correction into
                    // currentTurnNumber — the variable action-log.js actually tags each
                    // logged action with. Left unfixed, a non-host client's own Game Log
                    // panel silently drifts to the wrong turn-number header the moment it's
                    // no longer the one advancing turns itself (e.g. after a host handoff).
                    // Not gameplay-affecting — nothing in win-condition/AP/placement logic
                    // reads currentTurnNumber — just a stale label.
                    currentTurnNumber = payload.turnNumber;
                }

                activePlayerIndex = payload.playerIndex;
                if (payload.turnStartedAt) {
                    turnStartedAtMs = payload.turnStartedAt;
                } else {
                    turnStartedAtMs = Date.now();
                }
                // Wandering River clears at the beginning of the caster's next turn
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
                // Clear all turn-based buffs (expiresThisTurn) on every client when the turn changes.
                // This is a defensive cleanup: reflect-triggered / psychic-triggered execute() on
                // ALL clients, so non-caster clients can end up with stale activeBuffs entries
                // (e.g. steamVents set for the reflect caster). Without this call those entries
                // linger until the next time clearTurnBuffs() fires on that client.
                // Safe to call multiple times — idempotent (no-op if already cleared).
                if (spellSystem?.scrollEffects?.clearTurnBuffs) {
                    spellSystem.scrollEffects.clearTurnBuffs();
                }
                // Excavate teleport: if it's my turn and I have a pending teleport, trigger it
                if (activePlayerIndex === myPlayerIndex && spellSystem?.scrollEffects?.processExcavateTeleport) {
                    spellSystem.scrollEffects.processExcavateTeleport(activePlayerIndex);
                }

                // AP resets at the start of the new player's turn
                if (activePlayerIndex === myPlayerIndex) {
                    currentAP = 5;
                    document.getElementById('ap-count').textContent = currentAP;
                    if (typeof refreshVoidAP === 'function') refreshVoidAP();
                    if (typeof syncPlayerState === 'function') syncPlayerState();
                }

                updateEndTurnButtonVisibility();
            updateDeckIndicatorVisibility();
                updateOpponentPanel(); // Update opponent panel on turn change

                if (isPlacementPhase) {
                    // During placement, update status for tile placement
                    if (canPlaceTile()) {
                        updateStatus(`Your turn! Place your player tile (${playerTilesPlaced.size}/${totalPlayers} placed)`);
                        setInventoryOpen(true);
                        console.log(`✅ My turn to place tile`);
                    } else {
                        const nextColorName = getPlayerColorName(activePlayerIndex);
                        updateStatus(`Waiting for ${nextColorName} to place their tile... (${playerTilesPlaced.size}/${totalPlayers})`);
                        console.log(`⏳ Waiting for player ${activePlayerIndex} to place`);
                    }
                } else {
                    // Normal gameplay turn display
                    updateTurnDisplay();
                }

                // Clean up telekinesis UI if the caster's turn ended without them clicking Done
                // (covers timer auto-advance and other paths that bypass cancelSelectionMode)
                if (window.telekinesisState) { window.telekinesisState = null; window.tileMoveMode = false; }
                if (window.finishTelekinesis) { window.finishTelekinesis = null; }
                const _tkDone = document.getElementById('telekinesis-done-btn');
                if (_tkDone && _tkDone.parentNode) _tkDone.parentNode.removeChild(_tkDone);

                // Reconcile any tile flips that were dropped by the network.
                // The broadcaster includes every currently-revealed tile; if our local
                // placedTiles still has any of those as flipped, we missed the broadcast.
                if (Array.isArray(payload.revealedTiles) && typeof placedTiles !== 'undefined') {
                    payload.revealedTiles.forEach(({ id, shrineType }) => {
                        const tile = placedTiles.find(t => t.id === id);
                        if (tile && tile.flipped) {
                            const el = document.querySelector(`[data-tile-id="${id}"]`);
                            if (el && typeof flipTileVisually === 'function') {
                                console.log(`🔄 turn-change sync: catching missed tile-flip for tile ${id} (${shrineType})`);
                                flipTileVisually(el, shrineType);
                                // Adaptive music: catch the missed riff too (deduped by tileId)
                                window.JoytoneBridge?.onTileRevealed(shrineType, id);
                            }
                        }
                    });
                }
            });

            // Listen for player tile placement during placement phase
            gameChannel.on('broadcast', { event: 'player-tile-placed' }, ({ payload }) => {
                console.log('📄 Player tile placed:', payload);
                const { playerIndex } = payload;
                playerTilesPlaced.add(playerIndex);

                // Don't check completion here - let placement-complete event handle it
                if (isPlacementPhase && playerTilesPlaced.size < totalPlayers) {
                    // Update status during placement phase
                    if (canPlaceTile()) {
                        updateStatus(`Your turn! Place your player tile (${playerTilesPlaced.size}/${totalPlayers} placed)`);
                        setInventoryOpen(true);
                    } else {
                        const nextColorName = getPlayerColorName(activePlayerIndex);
                        updateStatus(`Waiting for ${nextColorName} to place their tile... (${playerTilesPlaced.size}/${totalPlayers})`);
                    }
                }
            });

            // Listen for placement phase completion
            gameChannel.on('broadcast', { event: 'placement-complete' }, ({ payload }) => {
                console.log('📄 Placement phase complete');
                isPlacementPhase = false;
                activePlayerIndex = payload.playerIndex; // Set to first player
                if (payload.turnStartedAt) {
                    turnStartedAtMs = payload.turnStartedAt;
                } else {
                    turnStartedAtMs = Date.now();
                }

                if (isMyTurn()) {
                    updateStatus(`All tiles placed! It's your turn!`);
                } else {
                    const firstPlayerColorName = getPlayerColorName(activePlayerIndex);
                    updateStatus(`All tiles placed! Waiting for ${firstPlayerColorName}'s turn...`);
                }

                // Ensure standard turn UI becomes visible after placement phase
                updateTurnDisplay();
                updateDeckIndicatorVisibility();

            });

            // Listen for spell cast events
            gameChannel.on('broadcast', { event: 'spell-cast' }, ({ payload }) => {
                console.log('📄 Received spell cast:', payload);
                const { playerIndex, spellName, element, elements, level, isCatacomb } = payload;

                // Update that player's activated elements display
                spellSystem.ensurePlayerScrollsStructure(playerIndex);
                const playerScrollData = spellSystem.playerScrolls[playerIndex];

                if (isCatacomb) {
                    // Catacomb activates multiple elements
                    elements.forEach(el => {
                        playerScrollData.activated.add(el);
                    });
                } else {
                    // Regular spell activates one element
                    playerScrollData.activated.add(element);
                }

                // Update the element symbols display for that player
                updatePlayerElementSymbols(playerIndex);

                // Show notification
                const playerName = getPlayerColorName(playerIndex);
                if (isCatacomb) {
                    updateStatus(`${playerName} activated ${spellName}! Activated: ${elements.join(', ')}`);
                } else {
                    updateStatus(`${playerName} activated ${spellName}! Activated ${element} (level ${level})`);
                }
            });

            // Listen for scroll effect broadcasts (for scrolls with special effects)
            gameChannel.on('broadcast', { event: 'scroll-effect' }, ({ payload }) => {
                console.log('📄 Received scroll-effect:', payload);
                const { playerIndex, scrollName, effectName, element, activatedElements } = payload;

                // Update that player's activated elements
                spellSystem.ensurePlayerScrollsStructure(playerIndex);
                const playerScrollData = spellSystem.playerScrolls[playerIndex];

                if (activatedElements && Array.isArray(activatedElements)) {
                    // Add all activated elements (for catacomb scrolls or multi-element effects)
                    activatedElements.forEach(el => {
                        playerScrollData.activated.add(el);
                    });
                } else if (element) {
                    // Single element activation
                    playerScrollData.activated.add(element);
                }

                // Update the element symbols display for that player
                updatePlayerElementSymbols(playerIndex);

                // Show notification
                const playerName = getPlayerColorName(playerIndex);
                const activatedStr = activatedElements ? activatedElements.join(', ') : element;
                updateStatus(`${playerName} used ${effectName}! Activated: ${activatedStr}`);

                // Check win condition — all 5 elements activated + returned to own shrine.
                // checkWinCondition handles observer clients too: handleGameOver →
                // showGameOverToAll shows the win screen, and both are double-fire safe.
                if (typeof checkWinCondition === 'function' && checkWinCondition(playerIndex)) {
                    console.log(`🏆 Win condition met for player ${playerIndex} (detected via scroll-effect broadcast)`);
                }
            });

            // Simplify applied by opponent
            gameChannel.on('broadcast', { event: 'simplify-applied' }, ({ payload }) => {
                const { playerIndex } = payload;
                if (spellSystem?.scrollEffects) {
                    spellSystem.scrollEffects.activeBuffs.simplify = { expiresThisTurn: true, playerIndex };
                }
                const playerName = getPlayerColorName(playerIndex);
                updateStatus(`Simplify: ${playerName}'s scrolls cost 1 AP to activate until their next turn.`);
            });

            // Reflect triggered at start of turn: run the reflected scroll's effect and update activated elements.
            // Multiple reflect-triggered events for the same player are queued and processed one at a time
            // so that interactive scrolls fully resolve before the next one starts.
            {
                const reflectQueue = []; // pending { playerIndex, scrollName } entries
                let reflectRunning = false;

                const runNextReflectTrigger = () => {
                    if (reflectRunning || reflectQueue.length === 0) return;
                    const { playerIndex, scrollName } = reflectQueue.shift();
                    reflectRunning = true;

                    const advance = () => {
                        reflectRunning = false;
                        runNextReflectTrigger();
                    };

                    // Record for the Game Log on THIS client too — this is the
                    // receiving side of the broadcast game-ui.js's endTurn flow
                    // sends (see processReflectPending's matching call in
                    // scroll-effects.js), so every client watching, not just
                    // the one that drove the turn change, needs its own entry.
                    window.logScrollEvent?.('reflect_triggered', { casterIndex: playerIndex, scrollName });

                    // Execute the reflected scroll's effect on this client.
                    // Interactive scrolls (requiresSelection) should only run on the Reflect caster's
                    // own client (playerIndex === myPlayerIndex). On other clients, skip execute() —
                    // the caster's client handles the UI selection and syncs state via syncPlayerState.
                    let wasInteractive = false;
                    if (spellSystem.scrollEffects && scrollName) {
                        const definition = spellSystem.patterns?.[scrollName];
                        if (definition) {
                            const isCaster = (playerIndex === myPlayerIndex);
                            console.log(`🪞 Running reflected scroll effect locally: ${scrollName} for player ${playerIndex} (isCaster=${isCaster})`);
                            const result = spellSystem.scrollEffects.execute(scrollName, playerIndex, {
                                spell: definition,
                                scrollName: scrollName,
                                onComplete: advance,
                                // Flag so interactive scroll effects skip UI on non-caster clients
                                psychicRemoteClient: !isCaster
                            });
                            wasInteractive = !!(result?.requiresSelection);
                            if (wasInteractive && !isCaster) {
                                console.log(`🪞 Interactive scroll on non-caster client - advancing queue immediately`);
                                wasInteractive = false;
                            }
                        }
                    }

                    // Update activated elements (Reflect only counts as water, not the reflected scroll's elements)
                    spellSystem.ensurePlayerScrollsStructure(playerIndex);
                    const activated = spellSystem.playerScrolls[playerIndex].activated;
                    activated.add('water');
                    console.log(`🪞 Reflect activated water for player ${playerIndex}:`, Array.from(activated));
                    updatePlayerElementSymbols(playerIndex);

                    if (playerIndex === myPlayerIndex) {
                        Object.keys(stoneCounts).forEach(updateStoneCount);
                    }

                    const playerName = getPlayerColorName(playerIndex);
                    const displayName = scrollName ? (scrollName.replace(/_/g, ' ').toLowerCase()) : 'scroll';
                    updateStatus(`🪞 ${playerName}'s Reflect triggered: activated ${displayName} (counts as water only).`);

                    if (playerIndex === myPlayerIndex && typeof checkWinCondition === 'function') {
                        checkWinCondition(playerIndex, { announce: true });
                    }

                    // For non-interactive scrolls, advance the queue immediately
                    if (!wasInteractive) advance();
                };

                gameChannel.on('broadcast', { event: 'reflect-triggered' }, ({ payload }) => {
                    console.log('📄 Received reflect-triggered:', payload);
                    const { playerIndex, scrollName, eventId } = payload;
                    if (typeof spellSystem === 'undefined') return;

                    // This entry was just consumed on whichever client owns turn-start
                    // processing for playerIndex — clear our own bystander copy so it
                    // doesn't linger and get replayed later (e.g. after a disconnect
                    // changes which client processes the next turn change).
                    spellSystem.scrollEffects?.removePendingBuff?.('reflect', playerIndex, scrollName, eventId || null);

                    // Enqueue and start processing if not already running
                    reflectQueue.push({ playerIndex, scrollName });
                    runNextReflectTrigger();
                });
            }

            // Psychic triggered at start of turn: run the stolen scroll's effect and update activated elements.
            // Multiple psychic-triggered events for the same player are queued and processed one at a time
            // so that interactive scrolls (e.g. Heavy Stomp) fully resolve before the next one starts.
            {
                const psychicQueue = []; // pending { playerIndex, scrollName } entries
                let psychicRunning = false;

                const runNextPsychicTrigger = () => {
                    if (psychicRunning || psychicQueue.length === 0) return;
                    const { playerIndex, scrollName } = psychicQueue.shift();
                    psychicRunning = true;

                    const advance = () => {
                        psychicRunning = false;
                        runNextPsychicTrigger();
                    };

                    // Record for the Game Log on THIS client too — receiving
                    // side of the broadcast, mirrors reflect_triggered above.
                    window.logScrollEvent?.('psychic_triggered', { casterIndex: playerIndex, scrollName });

                    // Execute the stolen scroll's effect on this client.
                    // Interactive scrolls (requiresSelection) should only run on the Psychic caster's
                    // own client (playerIndex === myPlayerIndex). On other clients, skip execute() —
                    // the caster's client handles the UI selection and broadcasts state changes via syncPlayerState.
                    let wasInteractive = false;
                    if (spellSystem.scrollEffects && scrollName) {
                        const definition = spellSystem.patterns?.[scrollName];
                        if (definition) {
                            const isCaster = (playerIndex === myPlayerIndex);
                            console.log(`🔮 Running psychic scroll effect locally: ${scrollName} for player ${playerIndex} (isCaster=${isCaster})`);
                            const result = spellSystem.scrollEffects.execute(scrollName, playerIndex, {
                                spell: definition,
                                scrollName: scrollName,
                                // onComplete advances the queue when interactive effects finish
                                onComplete: advance,
                                // Flag so interactive scroll effects can skip UI on non-caster clients
                                psychicRemoteClient: !isCaster
                            });
                            wasInteractive = !!(result?.requiresSelection);
                            // If the scroll is interactive but we're not the caster, the execute()
                            // should have returned early (due to psychicRemoteClient flag) without
                            // opening any UI. Treat as non-interactive so the queue advances immediately.
                            if (wasInteractive && !isCaster) {
                                console.log(`🔮 Interactive scroll on non-caster client - advancing queue immediately (state synced via syncPlayerState)`);
                                wasInteractive = false;
                            }
                        }
                    }

                    // Update activated elements (Psychic only counts as void, not the stolen scroll's elements)
                    spellSystem.ensurePlayerScrollsStructure(playerIndex);
                    const activated = spellSystem.playerScrolls[playerIndex].activated;
                    activated.add('void');
                    console.log(`🔮 Psychic activated void for player ${playerIndex}:`, Array.from(activated));
                    updatePlayerElementSymbols(playerIndex);

                    if (playerIndex === myPlayerIndex) {
                        Object.keys(stoneCounts).forEach(updateStoneCount);
                    }

                    const playerName = getPlayerColorName(playerIndex);
                    const displayName = scrollName ? (scrollName.replace(/_/g, ' ').toLowerCase()) : 'scroll';
                    updateStatus(`🔮 ${playerName}'s Psychic triggered: activated ${displayName} (counts as void only).`);

                    if (playerIndex === myPlayerIndex && typeof checkWinCondition === 'function') {
                        checkWinCondition(playerIndex, { announce: true });
                    }

                    // For non-interactive scrolls, advance the queue immediately
                    if (!wasInteractive) advance();
                };

                gameChannel.on('broadcast', { event: 'psychic-triggered' }, ({ payload }) => {
                    console.log('📄 Received psychic-triggered:', payload);
                    const { playerIndex, scrollName, eventId } = payload;
                    if (typeof spellSystem === 'undefined') return;

                    // This entry was just consumed on whichever client owns turn-start
                    // processing for playerIndex — clear our own bystander copy so it
                    // doesn't linger and get replayed later (e.g. after a disconnect
                    // changes which client processes the next turn change).
                    spellSystem.scrollEffects?.removePendingBuff?.('psychic', playerIndex, scrollName, eventId || null);

                    // Enqueue and start processing if not already running
                    psychicQueue.push({ playerIndex, scrollName });
                    runNextPsychicTrigger();
                });
            }

            // Listen for undo move events
            gameChannel.on('broadcast', { event: 'undo-move' }, ({ payload }) => {
                console.log('📄 Received undo move:', payload);
                const { playerIndex, x, y, apRestored } = payload;

                // Visually move the player back
                movePlayerVisually(playerIndex, x, y, -apRestored); // Negative to show AP restored

                // Note: AP update will come via player-state-update broadcast (from syncPlayerState)
                // which is sent right after the undo-move broadcast

                const playerName = getPlayerColorName(playerIndex);
                updateStatus(`⟲ ${playerName} undid their move (restored ${apRestored} AP)`);
            });

            // Listen for player state updates (AP and resources)
            gameChannel.on('broadcast', { event: 'player-state-update' }, ({ payload }) => {
                console.log('📄 Received player state update:', payload);
                const { playerIndex, currentAP, voidAP, resources } = payload;

                // Update tracked state for this player
                if (!playerAPs[playerIndex]) {
                    playerAPs[playerIndex] = { currentAP: 5, voidAP: 0 };
                }
                playerAPs[playerIndex].currentAP = currentAP;
                playerAPs[playerIndex].voidAP = voidAP;

                // Update resources only when provided (null means sender is not the
                // active player and should not overwrite our own pool values)
                if (resources != null) {
                    if (!playerPools[playerIndex]) {
                        playerPools[playerIndex] = { earth: 0, water: 0, fire: 0, wind: 0, void: 0 };
                    }
                    Object.assign(playerPools[playerIndex], resources);
                }
                updateOpponentPanel(); // Update opponent panel when player state changes
            });

            // Listen for scroll collection events (with deduplication)
            gameChannel.on('broadcast', { event: 'scroll-collected' }, ({ payload }) => {
                console.log('📄 Received scroll collection:', payload);
                const { playerIndex, scrollName, shrineType, _seq, _timestamp } = payload;

                // DEDUPLICATION: Check if we've already processed this event
                const eventId = `scroll-collected-${playerIndex}-${scrollName}-${_timestamp || Date.now()}`;
                if (receivedSequences.has(eventId)) {
                    console.warn('⚠️  Duplicate scroll-collected event ignored:', eventId);
                    return;
                }
                receivedSequences.add(eventId);

                // Check if scroll is already in player's hand (idempotency check)
                spellSystem.ensurePlayerScrollsStructure(playerIndex);
                if (spellSystem.playerScrolls[playerIndex].hand.has(scrollName)) {
                    console.warn('⚠️  Scroll already in hand, skipping:', scrollName);
                    return;
                }

                // Remove from the deck (scroll was drawn by the other player)
                const deckIndex = spellSystem.scrollDecks[shrineType]?.indexOf(scrollName);
                if (deckIndex > -1) {
                    spellSystem.scrollDecks[shrineType].splice(deckIndex, 1);
                } else {
                    console.warn(`⚠️  Scroll ${scrollName} not found in ${shrineType} deck (might have been removed already)`);
                }

                // Add to that player's hand
                spellSystem.playerScrolls[playerIndex].hand.add(scrollName);
                spellSystem.validateScrollState();
                spellSystem.updateScrollCount();

                const playerName = getPlayerColorName(playerIndex);
                updateStatus(`${playerName} collected a ${shrineType} scroll!`);
                updateOpponentPanel();
                if (typeof updateScrollDeckUI === 'function') updateScrollDeckUI();
            });

            // Listen for Scholar's Insight (Void IV) — remote player searched a deck
            gameChannel.on('broadcast', { event: 'scholars-insight' }, ({ payload }) => {
                console.log("📄 Received Scholar's Insight:", payload);
                const { playerIndex, element, scrollName } = payload;

                // Remove chosen scroll from the deck
                const deck = spellSystem.scrollDecks[element];
                if (deck) {
                    const idx = deck.indexOf(scrollName);
                    if (idx > -1) {
                        deck.splice(idx, 1);
                    }
                    // Shuffle the deck (same as the caster did)
                    if (spellSystem.shuffleDeck) {
                        spellSystem.shuffleDeck(deck);
                    }
                }

                // Add to that player's hand
                spellSystem.ensurePlayerScrollsStructure(playerIndex);
                spellSystem.playerScrolls[playerIndex].hand.add(scrollName);
                spellSystem.validateScrollState();
                spellSystem.updateScrollCount();

                const playerName = getPlayerColorName(playerIndex);
                updateStatus(`${playerName} used Scholar's Insight to search the ${element} deck!`);
                updateOpponentPanel();
                if (typeof updateScrollDeckUI === 'function') updateScrollDeckUI();
            });

            // Listen for Create (Void V) — remote player drew stones
            gameChannel.on('broadcast', { event: 'create-stones' }, ({ payload }) => {
                console.log('📄 Received Create stones:', payload);
                const { playerIndex, element, count } = payload;

                // Update source pool (stones were drawn from source)
                if (typeof stonePools !== 'undefined' && stonePools[element] !== undefined) {
                    stonePools[element] = Math.max(0, stonePools[element] - count);
                }

                // If this is OUR player, the stones are already drawn locally
                // For remote players, update their pool display
                if (playerIndex !== myPlayerIndex) {
                    const playerName = getPlayerColorName(playerIndex);
                    updateStatus(`${playerName} used Create to draw ${count} ${element} stone${count === 1 ? '' : 's'}!`);
                } else {
                    // Our action — already handled locally, just sync source pool
                }

                if (typeof updateSourcePoolDisplay === 'function') updateSourcePoolDisplay();
                updateOpponentPanel();
            });

            // Listen for Quick Reflexes deck search — remote player found a level 1 scroll
            gameChannel.on('broadcast', { event: 'quick-reflexes-search' }, ({ payload }) => {
                console.log('📄 Received Quick Reflexes search:', payload);
                const { playerIndex, element, scrollName, stonesDrawn, buffActive } = payload;

                // Remove chosen scroll from that element's deck and shuffle
                const deck = spellSystem.scrollDecks?.[element];
                if (deck) {
                    const idx = deck.indexOf(scrollName);
                    if (idx > -1) deck.splice(idx, 1);
                    if (spellSystem.shuffleDeck) spellSystem.shuffleDeck(deck);
                }

                // Add scroll to that player's hand
                spellSystem.ensurePlayerScrollsStructure(playerIndex);
                spellSystem.playerScrolls[playerIndex].hand.add(scrollName);
                spellSystem.validateScrollState();
                spellSystem.updateScrollCount();

                // Update source pool (stones were drawn from it)
                if (typeof stonePools !== 'undefined' && stonePools[element] !== undefined) {
                    stonePools[element] = Math.max(0, stonePools[element] - (stonesDrawn || 0));
                }

                // Update remote player's stone pool display
                if (playerIndex !== myPlayerIndex) {
                    if (!playerPools[playerIndex]) playerPools[playerIndex] = { earth: 0, water: 0, fire: 0, wind: 0, void: 0 };
                    playerPools[playerIndex][element] = Math.min(5, (playerPools[playerIndex][element] || 0) + (stonesDrawn || 0));
                }

                // Apply the quickReflexes buff on this client so that getSpellCost()
                // correctly prices level-1 scrolls at 0 AP during affordability checks
                // in the response window (canAnyPlayerRespond / canPlayerRespond).
                if (buffActive && spellSystem.scrollEffects) {
                    spellSystem.scrollEffects.activeBuffs.quickReflexes = {
                        playerIndex: playerIndex
                    };
                    console.log(`⚡ Applied quickReflexes buff for player ${playerIndex} on remote client`);
                }

                const playerName = getPlayerColorName(playerIndex);
                const scrollDef = spellSystem.patterns?.[scrollName];
                const displayName = scrollDef?.name || scrollName;
                updateStatus(`⚡ ${playerName} used Quick Reflexes: found "${displayName}", drew ${stonesDrawn || 0} ${element} stone${stonesDrawn === 1 ? '' : 's'}.`);

                if (typeof updateSourcePoolDisplay === 'function') updateSourcePoolDisplay();
                if (typeof updateScrollDeckUI === 'function') updateScrollDeckUI();
                updateOpponentPanel();
            });

            // Listen for scroll move events (hand <-> active)
            gameChannel.on('broadcast', { event: 'scroll-move' }, ({ payload }) => {
                console.log('📄 Received scroll move:', payload);
                const { playerIndex, scrollName, toLocation } = payload;

                spellSystem.ensurePlayerScrollsStructure(playerIndex);
                const scrolls = spellSystem.playerScrolls[playerIndex];
                if (toLocation === 'active') {
                    scrolls.hand.delete(scrollName);
                    scrolls.active.add(scrollName);
                    console.log(`📜 ${getPlayerColorName(playerIndex)} moved ${scrollName} to active area`);
                } else {
                    scrolls.active.delete(scrollName);
                    scrolls.hand.add(scrollName);
                    console.log(`📜 ${getPlayerColorName(playerIndex)} moved ${scrollName} back to hand`);
                }
                spellSystem.validateScrollState();
                spellSystem.updateScrollCount();
                updateOpponentPanel();
                if (typeof updateScrollDeckUI === 'function') updateScrollDeckUI();
            });

            // Listen for scroll discard events
            gameChannel.on('broadcast', { event: 'scroll-discard' }, ({ payload }) => {
                console.log('📄 Received scroll discard:', payload);
                const { playerIndex, scrollName } = payload;

                spellSystem.ensurePlayerScrollsStructure(playerIndex);
                const scrolls = spellSystem.playerScrolls[playerIndex];
                scrolls.hand.delete(scrollName);
                scrolls.active.delete(scrollName);
                spellSystem.validateScrollState();
                spellSystem.updateScrollCount();
                console.log(`📜 ${getPlayerColorName(playerIndex)} discarded ${scrollName}`);
                updateOpponentPanel();
                if (typeof updateScrollDeckUI === 'function') updateScrollDeckUI();
            });

            // Listen for common area updates
            gameChannel.on('broadcast', { event: 'common-area-update' }, ({ payload }) => {
                console.log('📄 Received common area update:', payload);
                const { element, scrollName, replacedScroll, _timestamp } = payload;

                // DEDUPLICATION: Check if we've already processed this event
                const eventId = `common-area-${element}-${scrollName}-${_timestamp || Date.now()}`;
                if (receivedSequences.has(eventId)) {
                    console.warn('⚠️  Duplicate common-area-update event ignored:', eventId);
                    return;
                }
                receivedSequences.add(eventId);

                // IDEMPOTENCY: Check if common area already has this scroll
                if (spellSystem.commonArea[element] === scrollName) {
                    console.warn('⚠️  Common area already has this scroll, skipping update');
                    return;
                }

                // If there was a scroll being replaced, put it back in the deck
                if (replacedScroll) {
                    // Check if it's not already in the deck (avoid duplicates)
                    if (!spellSystem.scrollDecks[element]?.includes(replacedScroll)) {
                        spellSystem.scrollDecks[element].push(replacedScroll);
                        console.log(`📜 Common area: ${replacedScroll} returned to deck`);
                    } else {
                        console.warn(`⚠️  ${replacedScroll} already in deck, not adding again`);
                    }
                }

                spellSystem.commonArea[element] = scrollName;
                console.log(`📜 Common area: ${scrollName} now in ${element} slot`);
                spellSystem.validateScrollState();
                spellSystem.updateScrollCount();

                if (typeof updateCommonAreaUI === 'function') updateCommonAreaUI();
                if (typeof updateScrollDeckUI === 'function') updateScrollDeckUI();
                updateOpponentPanel();
            });

            // Listen for a scroll-move undo ("Undo Step" after Move to Active/Common Area).
            // Mirrors spellSystem._undoScrollMove()'s local logic, applied to the acting
            // player's remote-tracked state — without this, remote clients never learn the
            // move was reversed and keep showing the scroll in the common area, while it's
            // actually back in the actor's hand. The next host common-area-sync then blanks
            // that slot everywhere, and the scroll becomes unfindable until something else
            // forces a resync.
            gameChannel.on('broadcast', { event: 'scroll-move-undo' }, ({ payload }) => {
                console.log('📄 Received scroll move undo:', payload);
                const { playerIndex, scrollName, from, to, displacedScroll } = payload;

                spellSystem.ensurePlayerScrollsStructure(playerIndex);
                const scrolls = spellSystem.playerScrolls[playerIndex];
                const element = spellSystem.getScrollElement(scrollName);

                if (to === 'active') {
                    scrolls.active.delete(scrollName);
                    scrolls.hand.add(scrollName);
                } else if (to === 'common') {
                    if (element && spellSystem.commonArea[element] === scrollName) {
                        spellSystem.commonArea[element] = null;
                        if (displacedScroll) {
                            const deck = spellSystem.scrollDecks[element];
                            const idx = deck ? deck.lastIndexOf(displacedScroll) : -1;
                            if (idx !== -1) deck.splice(idx, 1);
                            spellSystem.commonArea[element] = displacedScroll;
                        }
                    }
                    if (from === 'hand') scrolls.hand.add(scrollName);
                    else if (from === 'active') scrolls.active.add(scrollName);
                }

                console.log(`📜 ${getPlayerColorName(playerIndex)} undid scroll move: ${scrollName} back to ${from}`);
                spellSystem.validateScrollState();
                spellSystem.updateScrollCount();

                if (typeof updateCommonAreaUI === 'function') updateCommonAreaUI();
                if (typeof updateScrollDeckUI === 'function') updateScrollDeckUI();
                updateOpponentPanel();
            });

            // Response window events for scroll responses
            gameChannel.on('broadcast', { event: 'response-window-opened' }, ({ payload }) => {
                console.log('📄 Received response window opened:', payload);
                const { scrollName, casterIndex, commonArea: commonAreaSnapshot } = payload;

                // Only show response window if I'm NOT the caster
                if (myPlayerIndex !== casterIndex && spellSystem.responseWindow) {
                    // Apply the common area snapshot from the caster's client before
                    // checking canPlayerRespond — prevents a race condition where a
                    // preceding common-area-update (e.g. Psychic moving there) hasn't
                    // arrived yet, causing the response check to miss available scrolls.
                    if (commonAreaSnapshot) {
                        const elements = ['earth', 'water', 'fire', 'wind', 'void', 'catacomb'];
                        elements.forEach(el => {
                            const incomingScroll = commonAreaSnapshot[el] ?? null;
                            if (spellSystem.commonArea[el] !== incomingScroll) {
                                console.log(`📜 Applying common area snapshot: ${el} = ${incomingScroll}`);
                                spellSystem.commonArea[el] = incomingScroll;
                            }
                        });
                    }

                    const scrollDef = spellSystem.patterns[scrollName];
                    const scrollData = { name: scrollName, spell: scrollDef };

                    // Show the response window for this player
                    spellSystem.responseWindow.showResponseModalForOtherPlayer(scrollData, casterIndex);
                }
            });

            gameChannel.on('broadcast', { event: 'response-pass' }, ({ payload }) => {
                console.log('📄 Received response pass:', payload);
                const { playerIndex } = payload;

                // Update response window state
                if (spellSystem.responseWindow) {
                    spellSystem.responseWindow.handleRemotePass(playerIndex);
                }
            });

            gameChannel.on('broadcast', { event: 'scroll-response' }, ({ payload }) => {
                console.log('📄 Received scroll response:', payload);
                const { scrollName, playerIndex, isCounter, fromHand, viaSacrificialPyre } = payload;

                // Update response window state (passes fromHand so hand→active move is synced;
                // viaSacrificialPyre so hand→common is synced instead)
                if (spellSystem.responseWindow) {
                    spellSystem.responseWindow.handleRemoteResponse(scrollName, playerIndex, isCounter, fromHand ?? false, viaSacrificialPyre ?? false);
                }
            });

            gameChannel.on('broadcast', { event: 'scroll-countered' }, ({ payload }) => {
                console.log('📄 Received scroll countered:', payload);
                const { scrollName, casterIndex } = payload;
                updateStatus(`${getPlayerColorName(casterIndex)}'s scroll was countered!`);
            });

            // Cascade forfeit: active player timed out with an unresolved scroll cascade
            gameChannel.on('broadcast', { event: 'cascade-forfeit' }, ({ payload }) => {
                console.log('📄 Received cascade-forfeit:', payload);
                const { playerIndex } = payload;
                const playerName = getPlayerColorName(playerIndex);
                updateStatus(`⏰ ${playerName} ran out of time with an unresolved scroll cascade - they forfeit!`);
            });

            gameChannel.on('broadcast', { event: 'response-resolved' }, ({ payload }) => {
                console.log('📄 Received response resolved:', payload);
                // Close the response window on this client
                if (spellSystem.responseWindow) {
                    spellSystem.responseWindow.handleRemoteResolved();
                }

                // Sync the one-per-turn response guard on non-arbitrator clients: if any
                // resolved result is a oncePerTurn scroll, lock out further response scrolls
                // for the rest of this turn (matches the arbitrator's resolveResponseStack).
                if (spellSystem.scrollEffects && Array.isArray(payload.results)) {
                    const usedOncePerTurn = payload.results.some(r =>
                        (r.result === 'response-resolved' || r.result === 'countered-original') &&
                        spellSystem.patterns?.[r.scrollName]?.oncePerTurn
                    );
                    if (usedOncePerTurn) {
                        spellSystem.scrollEffects.responseScrollUsedThisTurn = true;
                    }
                }

                // Process response scroll effects (like Unbidden Lamplight / Reflect)
                if (payload.results && payload.triggeringScroll) {
                    for (const result of payload.results) {
                        if (result.result === 'response-resolved' && result.isResponse) {
                            console.log(`ℹ️ Processing remote response scroll: ${result.scrollName}`);

                            if (spellSystem.scrollEffects) {
                                const scrollDef = spellSystem.patterns?.[result.scrollName];
                                // Ensure triggeringScroll has its definition (resolve from
                                // broadcast payload or local patterns)
                                const trigScroll = { ...payload.triggeringScroll };
                                if (!trigScroll.definition && trigScroll.name) {
                                    trigScroll.definition = spellSystem.patterns?.[trigScroll.name];
                                }

                                // Execute on ALL clients receiving this broadcast — response effects
                                // like Lamplight set pendingHandRedirect which must be set before we
                                // call handleScrollDisposition for the triggering scroll below.
                                spellSystem.scrollEffects.execute(result.scrollName, result.casterIndex, {
                                    spell: scrollDef,
                                    triggeringScroll: trigScroll
                                });

                                // Element tracking + broadcast only on the responder's own client
                                if (result.casterIndex === myPlayerIndex) {
                                    // Track activated element for win condition (response scrolls count too!)
                                    spellSystem.ensurePlayerScrollsStructure(result.casterIndex);
                                    const activatedEls = (scrollDef?.element === 'catacomb' && scrollDef?.patterns?.[0])
                                        ? [...new Set(scrollDef.patterns[0].map(pos => pos.type))]
                                        : scrollDef?.element ? [scrollDef.element] : [];
                                    activatedEls.forEach(el => {
                                        spellSystem.playerScrolls[result.casterIndex].activated.add(el);
                                    });
                                    if (typeof updatePlayerElementSymbols === 'function') {
                                        updatePlayerElementSymbols(result.casterIndex);
                                    }

                                    // Response scroll can be this player's 5th element — and this
                                    // client never receives its own scroll-effect broadcast
                                    if (typeof checkWinCondition === 'function') {
                                        checkWinCondition(result.casterIndex, { announce: true });
                                    }

                                    // Broadcast activation so the caster's client (and any others)
                                    // updates this player's shrine win-condition symbols
                                    if (activatedEls.length > 0 && typeof broadcastGameAction === 'function') {
                                        broadcastGameAction('scroll-effect', {
                                            playerIndex: result.casterIndex,
                                            scrollName: result.scrollName,
                                            effectName: scrollDef?.name || result.scrollName,
                                            element: scrollDef?.element,
                                            activatedElements: activatedEls
                                        });
                                    }
                                }
                            }
                        } else if (result.result === 'countered-original') {
                            // Counter scroll (like Psychic or Iron Stance) resolved on the non-caster client.
                            //
                            // DO NOT re-execute the counter scroll's effect here.
                            // The flow is:
                            //   1. Caster's client runs resolveResponseStack() → fires scroll-resolved event
                            //   2. multiplayer-state.js listener executes the counter effect (e.g. Psychic)
                            //      and broadcasts psychic-buff-applied / scroll-effect
                            //   3. Non-caster clients receive those broadcasts and apply state (psychicPending, etc.)
                            //
                            // Re-executing here caused a double psychicPending entry for the counter-caster,
                            // which made the stolen scroll fire TWICE on the counter-caster's next turn —
                            // appearing as if the original caster's scroll ability was still activating.
                            console.log(`ℹ️ Processing remote counter scroll: ${result.scrollName}, counter-caster: ${result.casterIndex}`);

                            // If this is MY counter scroll, remove it from my active scrolls.
                            // Psychic goes to common area (arrives via common-area-update broadcast from caster).
                            // Iron Stance stays in active (nothing to remove).
                            if (result.casterIndex === myPlayerIndex) {
                                spellSystem.ensurePlayerScrollsStructure(myPlayerIndex);
                                const myScrolls = spellSystem.playerScrolls[myPlayerIndex];
                                if (myScrolls.active.has(result.scrollName)) {
                                    myScrolls.active.delete(result.scrollName);
                                    console.log(`📜 Removed ${result.scrollName} from my active scrolls (counter sent to common area)`);
                                }
                                spellSystem.updateScrollCount();
                            }
                        } else if (result.result === 'counter-negated') {
                            // Psychic was negated (ransom paid) on the non-caster client.
                            // Same disposition-only handling as countered-original above —
                            // DO NOT re-execute anything here — but there's no psychicPending
                            // entry to worry about duplicating in the first place, since
                            // resolveResponseStack() never called execute() for a negated
                            // Psychic (no steal was ever queued).
                            console.log(`ℹ️ Processing remote negated counter: ${result.scrollName}, counter-caster: ${result.casterIndex}`);

                            if (result.casterIndex === myPlayerIndex) {
                                spellSystem.ensurePlayerScrollsStructure(myPlayerIndex);
                                const myScrolls = spellSystem.playerScrolls[myPlayerIndex];
                                if (myScrolls.active.has(result.scrollName)) {
                                    myScrolls.active.delete(result.scrollName);
                                    console.log(`📜 Removed ${result.scrollName} from my active scrolls (negated Psychic sent to common area)`);
                                }
                                spellSystem.updateScrollCount();
                            }
                        }
                    }

                    // Consume any pending hand redirect (e.g. set by Unbidden Lamplight above).
                    // On non-caster clients, the original scroll's handleScrollDisposition never
                    // fires via the CustomEvent chain, so we call it explicitly here to redirect
                    // the triggering scroll to the Lamplight caster's hand.
                    const rd = spellSystem.scrollEffects?.pendingHandRedirect;
                    if (rd && payload.triggeringScroll?.name && rd.scrollName === payload.triggeringScroll.name) {
                        console.log(`🔀 Consuming pendingHandRedirect: ${rd.scrollName} → player ${rd.redirectToPlayerIndex}'s hand`);
                        spellSystem.handleScrollDisposition(
                            payload.triggeringScroll.name,
                            payload.triggeringScroll.fromCommonArea ?? false
                        );
                    }
                }
            });

            // Listen for tile swap events (Shifting Sands scroll effect)
            gameChannel.on('broadcast', { event: 'tile-swap' }, ({ payload }) => {
                console.log('📄 Received tile swap:', payload);
                const { tile1Id, tile2Id, tile1NewPos, tile2NewPos, movedPlayers } = payload;

                const tile1 = placedTiles.find(t => t.id === tile1Id);
                const tile2 = placedTiles.find(t => t.id === tile2Id);

                if (tile1 && tile2) {
                    // Update positions
                    tile1.x = tile1NewPos.x;
                    tile1.y = tile1NewPos.y;
                    tile2.x = tile2NewPos.x;
                    tile2.y = tile2NewPos.y;

                    // Update visuals
                    if (tile1.element) {
                        tile1.element.setAttribute('transform', `translate(${tile1.x}, ${tile1.y}) rotate(${tile1.rotation || 0})`);
                    }
                    if (tile2.element) {
                        tile2.element.setAttribute('transform', `translate(${tile2.x}, ${tile2.y}) rotate(${tile2.rotation || 0})`);
                    }

                    // Recenter any player that was carried along with its tile
                    if (movedPlayers && movedPlayers.length > 0) {
                        movedPlayers.forEach(mp => {
                            if (typeof movePlayerVisually === 'function') {
                                movePlayerVisually(mp.playerIndex, mp.newX, mp.newY, 0);
                            } else if (typeof window !== 'undefined' && typeof window.movePlayerVisually === 'function') {
                                window.movePlayerVisually(mp.playerIndex, mp.newX, mp.newY, 0);
                            }
                        });
                    }

                    // Safety: clear any stuck tile-swap selectionMode on this client —
                    // the authoritative swap just arrived via broadcast, so no local selection needed.
                    if (spellSystem?.scrollEffects?.selectionMode?.type === 'tile-swap') {
                        spellSystem.scrollEffects.selectionMode.cleanup?.();
                        spellSystem.scrollEffects.selectionMode = null;
                    }

                    updateStatus('Tiles were swapped by Shifting Sands!');
                }
            });

            // Listen for Telekinesis tile moves (Void III)
            gameChannel.on('broadcast', { event: 'telekinesis-move' }, ({ payload }) => {
                console.log('📄 Received telekinesis move:', payload);
                const { tileId, newPos, movedPlayers } = payload;

                const tile = placedTiles.find(t => t.id === tileId);
                if (tile) {
                    tile.x = newPos.x;
                    tile.y = newPos.y;
                    if (tile.element) {
                        tile.element.setAttribute('transform', `translate(${newPos.x}, ${newPos.y}) rotate(${tile.rotation || 0})`);
                    }
                }

                // Move players that were on the tile
                if (movedPlayers && movedPlayers.length > 0) {
                    movedPlayers.forEach(mp => {
                        if (typeof movePlayerVisually === 'function') {
                            movePlayerVisually(mp.playerIndex, mp.newX, mp.newY, 0);
                        } else if (typeof window !== 'undefined' && typeof window.movePlayerVisually === 'function') {
                            window.movePlayerVisually(mp.playerIndex, mp.newX, mp.newY, 0);
                        }
                    });
                }

                // Refresh catacomb indicators in case shrine positions changed
                if (typeof updateCatacombIndicators === 'function') {
                    updateCatacombIndicators();
                }

                updateStatus('A tile was moved by Telekinesis!');
            });

            // Listen for tile hide events (Heavy Stomp scroll effect)
            gameChannel.on('broadcast', { event: 'tile-hide' }, ({ payload }) => {
                console.log('📄 Received tile hide:', payload);
                const { tileId } = payload;

                const tile = placedTiles.find(t => t.id === tileId);
                if (tile && !tile.flipped) {
                    recreateTileAsFlipped(tile);
                    updateStatus(`${tile.shrineType} shrine was hidden by Heavy Stomp!`);
                }
            });

            // Note: scroll-effect handling (activated tracking, symbols, win check, status) is
            // handled by the earlier scroll-effect listener above. No duplicate handler here.

            // Listen for Arson stone destruction on opponent's client
            // Listen for Plunder scroll events (Catacomb Scroll 8)
            gameChannel.on('broadcast', { event: 'scroll-plundered' }, ({ payload }) => {
                console.log('📄 Received scroll-plundered:', payload);
                const { casterIndex, targetIndex, scrollName } = payload;

                // Remove the scroll from the target's active area
                spellSystem.ensurePlayerScrollsStructure(targetIndex);
                const targetScrolls = spellSystem.playerScrolls[targetIndex];
                if (targetScrolls) {
                    targetScrolls.active.delete(scrollName);
                }

                // Common area update is handled by the separate common-area-update broadcast
                spellSystem.validateScrollState();
                spellSystem.updateScrollCount();
                updateOpponentPanel();
                if (typeof updateScrollDeckUI === 'function') updateScrollDeckUI();

                // If I'm the target, notify me
                if (targetIndex === myPlayerIndex) {
                    const scrollDef = SCROLL_DEFINITIONS?.[scrollName];
                    const scrollDisplayName = scrollDef?.name || scrollName;
                    const casterName = getPlayerColorName(casterIndex);
                    updateStatus(`🏴‍☠️ ${casterName} used Plunder: sent your ${scrollDisplayName} to the common area!`);
                    // Refresh my scroll UI
                    Object.keys(stoneCounts).forEach(updateStoneCount);
                }
            });

            // Listen for Excavate teleport events (Catacomb Scroll 4)
            gameChannel.on('broadcast', { event: 'excavate-teleport' }, ({ payload }) => {
                console.log('📄 Received excavate-teleport:', payload);
                const { playerIndex, x, y } = payload;
                if (typeof movePlayerVisually === 'function') {
                    movePlayerVisually(playerIndex, x, y, 0);
                } else {
                    const target = playerPositions[playerIndex];
                    if (target) {
                        target.x = x;
                        target.y = y;
                        if (target.element) {
                            target.element.setAttribute('transform', `translate(${x}, ${y})`);
                        }
                    }
                }
                console.log(`⛏️ Excavate teleport: player ${playerIndex} to (${x.toFixed(1)}, ${y.toFixed(1)})`);
                // Record for the Game Log on THIS client too — receiving side
                // of the broadcast, mirrors reflect_triggered/psychic_triggered.
                window.logScrollEvent?.('excavate_teleport_used', { casterIndex: playerIndex });
            });

            // Listen for Excavate immunity buff (so other clients know player is immune)
            gameChannel.on('broadcast', { event: 'excavate-immunity' }, ({ payload }) => {
                console.log('📄 Received excavate-immunity:', payload);
                const { playerIndex } = payload;
                if (spellSystem?.scrollEffects) {
                    spellSystem.scrollEffects.activeBuffs.excavate = {
                        playerIndex: playerIndex
                    };
                    spellSystem.scrollEffects.activeBuffs.excavateTeleport = {
                        playerIndex: playerIndex
                    };
                    spellSystem.scrollEffects.activeBuffs.excavateNoResponse = {
                        playerIndex: playerIndex
                    };
                }
            });

            gameChannel.on('broadcast', { event: 'opponent-stone-destroyed' }, ({ payload }) => {
                console.log('📄 Received opponent-stone-destroyed:', payload);
                const { opponentIndex, stoneType } = payload;

                // Update the local pool for the targeted player
                if (playerPools[opponentIndex] && playerPools[opponentIndex][stoneType] > 0) {
                    playerPools[opponentIndex][stoneType]--;
                    // Mirror the caster's returnStoneToPool() call so every client's
                    // source pool count agrees — without this only the caster's source
                    // pool went up, leaving it desynced from everyone else's.
                    if (typeof returnStoneToPool === 'function') returnStoneToPool(stoneType);
                }

                // If I'm the targeted opponent, refresh my stone UI
                if (opponentIndex === myPlayerIndex) {
                    Object.keys(stoneCounts).forEach(updateStoneCount);
                    const casterName = getPlayerColorName(activePlayerIndex);
                    updateStatus(`🔥 ${casterName} used Arson: destroyed 1 ${stoneType} stone from your pool!`);
                }

                if (typeof updateOpponentPanel === 'function') updateOpponentPanel();
            });

            // Listen for scroll-used: handles scroll disposition on remote clients
            // Only handles forceToCommonArea=true (e.g. Arson forcing itself into the common area).
            // fromCommonArea=true events are intentionally ignored — common area scrolls are permanent
            // shared resources and stay after being cast; they're only replaced by a new scroll of the
            // same element type being discarded to the common area.
            gameChannel.on('broadcast', { event: 'scroll-used' }, ({ payload }) => {
                const { playerIndex, scrollName, fromCommonArea, forceToCommonArea } = payload;
                if (playerIndex === myPlayerIndex) return; // Caster already handled it locally

                spellSystem.ensurePlayerScrollsStructure(playerIndex);

                if (fromCommonArea) {
                    // Common area scrolls persist after casting — nothing to clear
                    return;
                }

                if (!forceToCommonArea) return; // Nothing to do for normal active-area disposition

                // forceToCommonArea=true: scroll pushed itself to common area (e.g. Arson)
                const playerScrolls = spellSystem.playerScrolls[playerIndex];
                if (playerScrolls && playerScrolls.active.has(scrollName)) {
                    playerScrolls.active.delete(scrollName);
                    console.log(`📜 Remote scroll-used: moved ${scrollName} from player ${playerIndex}'s active to common area`);
                }
                spellSystem.discardToCommonArea(scrollName);
                spellSystem.updateScrollCount();
                if (typeof updateCommonAreaUI === 'function') updateCommonAreaUI();
            });


            // Listen for stones destroyed (Combust - Catacomb X)
            gameChannel.on('broadcast', { event: 'stones-destroyed' }, ({ payload }) => {
                console.log('📄 Received stones-destroyed:', payload);
                const { tileId, stoneIds } = payload;

                // Remove the destroyed stones from the board
                if (typeof placedStones !== 'undefined' && stoneIds && stoneIds.length > 0) {
                    stoneIds.forEach(stoneId => {
                        const stoneIndex = placedStones.findIndex(s => s.id === stoneId);
                        if (stoneIndex !== -1) {
                            const stone = placedStones[stoneIndex];

                            // Remove visual element
                            if (stone.element && stone.element.parentNode) {
                                stone.element.parentNode.removeChild(stone.element);
                            }

                            // Remove from array
                            placedStones.splice(stoneIndex, 1);
                            console.log(`💥 Removed stone ${stoneId} from board`);
                        }
                    });

                    console.log(`🔥 Combust destroyed ${stoneIds.length} stone${stoneIds.length === 1 ? '' : 's'} on tile ${tileId}`);
                }
            });

            // Listen for periodic turn sync from host (for desync recovery)
            gameChannel.on('broadcast', { event: 'turn-sync' }, ({ payload }) => {
                const { playerIndex, turnNumber, turnStartedAt } = payload;

                // Check if we're desynced
                if (activePlayerIndex !== playerIndex) {
                    console.warn(`⚠️ DESYNC CORRECTED: Local activePlayerIndex was ${activePlayerIndex}, host says ${playerIndex}`);
                    activePlayerIndex = playerIndex;
                    updateTurnDisplay();
                }

                if (typeof turnNumber === 'number' && lastReceivedTurnNumber !== turnNumber) {
                    console.warn(`⚠️ DESYNC CORRECTED: Local turn was ${lastReceivedTurnNumber}, host says ${turnNumber}`);
                    lastReceivedTurnNumber = turnNumber;
                    currentTurnNumber = turnNumber; // see the matching turn-change handler's comment above for why

                    // If it's now our turn, reset AP — the normal turn-change broadcast
                    // that does this was missed due to the reconnect
                    if (playerIndex === myPlayerIndex) {
                        console.warn('⚠️ DESYNC: Resetting AP for recovered turn');
                        currentAP = maxAP;
                        if (typeof refreshVoidAP === 'function') refreshVoidAP();
                        if (typeof updateAPDisplay === 'function') updateAPDisplay();
                    }
                }

                if (turnStartedAt && Math.abs(turnStartedAtMs - turnStartedAt) > 2000) {
                    console.warn(`⚠️ Turn timer desync corrected (diff: ${Math.abs(turnStartedAtMs - turnStartedAt)}ms)`);
                    turnStartedAtMs = turnStartedAt;
                }
            });

            // Listen for periodic common area sync from host (for desync recovery)
            gameChannel.on('broadcast', { event: 'common-area-sync' }, ({ payload }) => {
                const { commonArea } = payload;

                if (!commonArea || typeof spellSystem === 'undefined') return;

                // Build a set of scrolls already in local play (hand or active).
                // If the host's broadcast still shows a scroll in the common area but we have
                // it in a player's hand/active, the host state is stale — do NOT restore it.
                const inLocalPlay = new Set();
                for (const p of spellSystem.playerScrolls) {
                    if (!p) continue;
                    p.hand.forEach(s => inLocalPlay.add(s));
                    p.active.forEach(s => inLocalPlay.add(s));
                }

                // Compare and auto-correct any differences
                let corrected = false;
                Object.keys(commonArea).forEach(element => {
                    const hostScroll = commonArea[element];
                    const localScroll = spellSystem.commonArea[element];

                    if (hostScroll !== localScroll) {
                        // Don't restore a scroll that's already been drawn into play locally
                        if (hostScroll && inLocalPlay.has(hostScroll)) {
                            console.log(`[common-area-sync] Skipping restore of ${hostScroll} in ${element} - already in local play`);
                            return;
                        }
                        console.warn(`⚠️ COMMON AREA DESYNC CORRECTED: ${element} slot was "${localScroll}", host says "${hostScroll}"`);
                        spellSystem.commonArea[element] = hostScroll;
                        corrected = true;
                    }
                });

                if (corrected) {
                    // Update UI after corrections
                    if (typeof updateCommonAreaUI === 'function') updateCommonAreaUI();
                    if (typeof updateScrollDeckUI === 'function') updateScrollDeckUI();
                    spellSystem.validateScrollState();
                    spellSystem.updateScrollCount();
                }
            });

            // Listen for Reflect buff applied (passive buff for next turn)
            gameChannel.on('broadcast', { event: 'reflect-buff-applied' }, ({ payload }) => {
                console.log('📄 Received reflect-buff-applied:', payload);
                const { playerIndex, scrollName, scrollDefinition, eventId } = payload;

                // Queue via the central helper — dedups if this entry already arrived
                // through another path (e.g. this same client also ran the local execute())
                if (typeof spellSystem !== 'undefined' && spellSystem.scrollEffects) {
                    const added = spellSystem.scrollEffects.addPendingBuff('reflect', playerIndex, scrollName, scrollDefinition, eventId || null);
                    if (added) {
                        console.log(`🛡️ Reflect buff applied to player ${playerIndex}: will reflect "${scrollName}" on their next turn`);
                    }
                }
            });

            // Listen for Psychic buff applied (passive buff for next turn)
            gameChannel.on('broadcast', { event: 'psychic-buff-applied' }, ({ payload }) => {
                console.log('📄 Received psychic-buff-applied:', payload);
                const { playerIndex, scrollName, scrollDefinition, eventId } = payload;

                // Queue via the central helper — dedups if this entry already arrived
                // through another path (e.g. this same client also ran the local execute())
                if (typeof spellSystem !== 'undefined' && spellSystem.scrollEffects) {
                    const added = spellSystem.scrollEffects.addPendingBuff('psychic', playerIndex, scrollName, scrollDefinition, eventId || null);
                    if (added) {
                        console.log(`🔮 Psychic buff applied to player ${playerIndex}: will activate "${scrollName}" at start of their next turn`);
                    }
                }
            });

            // Listen for scroll state sync from host (authoritative source)
            gameChannel.on('broadcast', { event: 'scroll-state-sync' }, ({ payload }) => {
                if (typeof spellSystem !== 'undefined' && spellSystem.applyScrollStateSnapshot) {
                    const corrected = spellSystem.applyScrollStateSnapshot(payload.snapshot);
                    // Only log if corrections were made
                    if (corrected) {
                        console.log('📊 Scroll state synchronized with host (corrections applied)');
                    }
                }
            });

            // Listen for scroll state sync requests (from clients who detected issues)
            gameChannel.on('broadcast', { event: 'scroll-state-sync-request' }, ({ payload }) => {
                // Only host responds to sync requests
                if (myPlayerIndex === 0 && typeof spellSystem !== 'undefined') {
                    console.log(`⚠️  Sync request from player ${payload.playerIndex} - sending authoritative state`);
                    const snapshot = spellSystem.getScrollStateSnapshot();
                    broadcastGameAction('scroll-state-sync', { snapshot });
                }
            });

            // Scroll state validation every 3 seconds (host is authoritative).
            // PERF: this used to broadcast the full scroll-state snapshot to
            // every client UNCONDITIONALLY on every tick, forever, for the
            // entire game — real network traffic (a Realtime message every
            // client must receive and parse) even on turns where nothing
            // whatsoever changed. Now it only broadcasts when the snapshot
            // actually differs from the last one sent, with a slower (every
            // 5th tick, ~15s) unconditional resend kept as a heartbeat safety
            // net in case a client missed the change-triggered broadcast —
            // preserves the original "eventually consistent even under
            // message loss" guarantee while cutting the common-case chatter.
            scrollStateSyncInterval = setInterval(() => {
                if (!isMultiplayer || !spellSystem) return;

                // Validate current state (only logs if errors found)
                const hasErrors = spellSystem.validateScrollState();

                // If I'm the host (player 0), broadcast authoritative state
                if (myPlayerIndex === 0) {
                    const snapshot = spellSystem.getScrollStateSnapshot();
                    const snapshotJSON = JSON.stringify(snapshot);
                    _scrollSyncTicksSinceBroadcast++;
                    const changed = snapshotJSON !== _lastBroadcastScrollSnapshot;
                    if (changed || _scrollSyncTicksSinceBroadcast >= 5) {
                        broadcastGameAction('scroll-state-sync', { snapshot });
                        _lastBroadcastScrollSnapshot = snapshotJSON;
                        _scrollSyncTicksSinceBroadcast = 0;
                    }
                }

                // If errors found and I'm not the host, immediately request sync
                if (hasErrors && myPlayerIndex !== 0) {
                    console.warn('⚠️  Errors detected - immediately requesting sync from host');
                    broadcastGameAction('scroll-state-sync-request', { playerIndex: myPlayerIndex });
                }
            }, 3000);

            // Listen for game reset (placement timeout or other critical errors)
            gameChannel.on('broadcast', { event: 'game-reset' }, ({ payload }) => {
                console.log('📄 Received game-reset:', payload);
                const { reason, kickedPlayerIndex } = payload;

                // If I'm the kicked player, skip this - I'll handle it via DELETE event
                if (typeof kickedPlayerIndex !== 'undefined' && kickedPlayerIndex === myPlayerIndex) {
                    console.log('⏰ I am the kicked player - waiting for DELETE event to handle reset');
                    return;
                }

                if (reason === 'placement-timeout') {
                    const kickedPlayerName = typeof kickedPlayerIndex !== 'undefined'
                        ? getPlayerColorName(kickedPlayerIndex)
                        : 'A player';
                    updateStatus(`⏰ ${kickedPlayerName} timed out during tile placement - returning to lobby`);
                } else {
                    updateStatus('🔄 Game reset - returning to lobby');
                }

                // Reset to lobby (for non-kicked players)
                if (typeof resetToLobby === 'function') {
                    setTimeout(() => {
                        resetToLobby();
                        // Refresh player list to show updated lobby without the kicked player
                        if (typeof refreshPlayerList === 'function') {
                            refreshPlayerList();
                        }
                    }, 1000);
                }
            });

            // ── Emoji reactions ──────────────────────────────────────────
            // Received when another player fires an emoji.
            // Show it floating above their pawn on every client except the sender
            // (sender already called showEmojiOverPawn locally before broadcasting).
            gameChannel.on('broadcast', { event: 'emoji' }, ({ payload }) => {
                const { playerIndex, display, isText, sprite, talk } = payload;
                if (typeof window.emojiSystem !== 'undefined') {
                    const dur = typeof payload.dur === 'number' ? payload.dur : undefined;
                    window.emojiSystem.showEmojiOverPawn(playerIndex, display, !!isText, sprite, dur ? { dur } : undefined);
                }
                // Bot alliance talk (js/bot-diplomacy.js): the first emote of a
                // sentence carries its Game Log line.
                if (typeof talk === 'string' && talk.length < 200) {
                    window.ActionLog?.record?.('botTalk', { text: talk }, playerIndex);
                }
            });

            // Game over broadcast — carries win type so non-winner clients show the correct message
            gameChannel.on('broadcast', { event: 'game-over' }, ({ payload }) => {
                // Someone else won: the host still has to close the recording.
                window.MatchRecorder?.finish(payload.winnerIndex, payload.winType || 'scrolls');
                showGameOverToAll(payload.winnerIndex, payload.winType || 'scrolls');
            });

            // Presence: detect disconnects instantly via WebSocket leave events.
            // More reliable than DB polling — fires as soon as the connection drops.
            gameChannel.on('presence', { event: 'leave' }, ({ leftPresences }) => {
                if (!isMultiplayer || !currentGameId) return;
                leftPresences.forEach(p => {
                    if (p.playerIndex === myPlayerIndex) return; // ignore our own leave echo
                    const isOurGame = allPlayersData.some(ap => ap.player_index === p.playerIndex);
                    if (!isOurGame) return;
                    console.log('Presence: player', p.playerIndex, 'disconnected');
                    const state = gameChannel.presenceState();
                    const connectedIndices = Object.values(state).flat().map(s => s.playerIndex);
                    const othersStillConnected = connectedIndices.filter(i => i !== myPlayerIndex);
                    if (othersStillConnected.length === 0 && myPlayerIndex !== null && myPlayerIndex !== undefined) {
                        handleGameOver(myPlayerIndex, 'last_standing');
                    } else {
                        const playerName = getPlayerColorName(p.playerIndex);
                        updateStatus(`${playerName} disconnected`);
                    }
                });
            });

            // Subscribe to the channel, then announce our presence.
            // Reports every status (not just SUBSCRIBED) to ConnectionMonitor and
            // retries with backoff on an unexpected drop. Previously CHANNEL_ERROR/
            // TIMED_OUT/CLOSED did nothing at all here — no log, no UI signal, no
            // retry — the game channel just went silently dead until a player
            // noticed nothing was syncing anymore.
            const thisChannel = gameChannel;
            gameChannel.subscribe((status) => {
                if (window.ConnectionMonitor) window.ConnectionMonitor.reportChannelStatus('game', status);
                if (status === 'SUBSCRIBED') {
                    console.log('Connected to game broadcast channel');
                    _gameChannelReconnectAttempts = 0;
                    gameChannel.track({ playerIndex: myPlayerIndex, playerId: myPlayerId });
                } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
                    console.warn('⚠️ Game broadcast channel status:', status);
                    // Only react if this callback still belongs to the CURRENTLY
                    // active channel. setupGameBroadcast() always replaces the
                    // module-level `gameChannel` wholesale — including as part of
                    // ITS OWN reconnect retry below — and that replacement's own
                    // unsubscribe() of the old channel can itself surface as a
                    // 'CLOSED' status here. Without this identity check, that
                    // ordinary teardown would look identical to an unexpected drop
                    // and schedule a redundant second reconnect on top of a channel
                    // that's already being rebuilt. Also covers a deliberate leave
                    // (gameChannel set to null or reassigned elsewhere) for free.
                    if (!isMultiplayer || gameChannel !== thisChannel) return;
                    if (_gameChannelReconnectAttempts >= 5) {
                        updateStatus('⚠️ Lost connection to the game and couldn\'t reconnect. Your view may be out of sync - try refreshing.');
                        return;
                    }
                    const delay = Math.min(30000, 2000 * Math.pow(2, _gameChannelReconnectAttempts));
                    _gameChannelReconnectAttempts++;
                    updateStatus(`⚠️ Connection to game dropped - reconnecting (attempt ${_gameChannelReconnectAttempts})…`);
                    setTimeout(() => {
                        if (!isMultiplayer || gameChannel !== thisChannel) return;
                        setupGameBroadcast(true);
                    }, delay);
                }
            });
        }

        // ----------------------------------------------------------------
        // Last-man-standing poll — bulletproof fallback for disconnect win.
        // Runs every 20 s for every player (not just host) — this is a
        // fallback path (Presence's 'leave' event, below, is the fast path
        // and fires near-instantly), so it doesn't need to be aggressive;
        // it previously ran every 5s, meaning every connected client queried
        // the `players` table 12x/minute each for the entire game, for a
        // condition that changes at most a handful of times per game.
        // Independent of Presence / Realtime subscription delivery.
        // ----------------------------------------------------------------
        let _lmsInterval = null;

        function startLastManStandingPoll() {
            stopLastManStandingPoll();
            _lmsInterval = setInterval(async () => {
                if (!isMultiplayer || !currentGameId || !myPlayerId) return;
                try {
                    const { data: remaining } = await supabase
                        .from('players')
                        .select('id')
                        .eq('game_id', currentGameId);
                    if (!remaining) return;
                    if (remaining.length === 1 && remaining[0].id === myPlayerId) {
                        console.log('📊 Poll: I am the last player remaining - triggering win.');
                        stopLastManStandingPoll();
                        if (myPlayerIndex !== null && myPlayerIndex !== undefined) {
                            await handleGameOver(myPlayerIndex, 'last_standing');
                        }
                    }
                } catch (e) { /* ignore transient network errors */ }
            }, 20000);
        }

        function stopLastManStandingPoll() {
            if (_lmsInterval) { clearInterval(_lmsInterval); _lmsInterval = null; }
        }

        // ----------------------------------------------------------------
        // Multiplayer hooks called by game-core.js
        // ----------------------------------------------------------------

        // Called by game-core.js executeMovement() after a successful move.
        // game-ui.js drag/tap handlers broadcast directly, but game-core.js uses
        // this function as a named hook so it is safe to define it once here.
        function broadcastPlayerMovement(playerIndex, x, y, apSpent) {
            broadcastGameAction('player-move', { playerIndex, x, y, apSpent });
            // Shrine-return win check for the movement paths that funnel through
            // here (bot moves, path-based movement). Drag/tap moves are covered
            // by the same check inside placePlayer().
            if (typeof checkWinCondition === 'function') checkWinCondition(playerIndex);
        }

        // Called by game-core.js executeMovement() after landing on a hex.
        // Mirrors the tile-reveal logic in game-ui.js drag/tap handlers so that
        // the game-core.js movement path also reveals hidden tiles correctly.
        function handlePlayerLanding(x, y) {
            if (typeof getAllHexagonPositions !== 'function' || typeof placedTiles === 'undefined') return;
            const allHexes = getAllHexagonPositions();
            let nearestHex = null;
            let nearestDist = Infinity;
            allHexes.forEach(hexPos => {
                const d = Math.sqrt(Math.pow(hexPos.x - x, 2) + Math.pow(hexPos.y - y, 2));
                if (d < nearestDist) { nearestDist = d; nearestHex = hexPos; }
            });
            if (nearestHex && nearestDist < 5 && nearestHex.tiles) {
                nearestHex.tiles
                    .filter(t => t.flipped && !t.isPlayerTile)
                    .forEach(t => {
                        if (typeof revealTile === 'function') revealTile(t.id);
                    });
            }
        }

        // Reset game back to lobby (used for placement timeout or critical errors)
        function resetToLobby() {
            console.log('🔄 Resetting game back to lobby');

            // Close all floating scroll panels so they don't bleed into the lobby
            // (all six — gamelog/opponents/elementalstones joined hand/active/common
            // on this same FSP system later and were missing from this list, which
            // is why they kept showing over the lobby after leaving a game).
            if (typeof ScrollPanelSystem !== 'undefined') {
                ['hand', 'active', 'common', 'gamelog', 'opponents', 'elementalstones'].forEach(id => ScrollPanelSystem.closePanel(id));
            }

            // Remove self from DB and stop heartbeat — prevents ghost rooms
            if (myPlayerId) {
                supabase.rpc('remove_player', { p_player_id: myPlayerId }).catch(() => {});
                myPlayerId = null;
            }

            // Stop turn timer monitoring
            if (typeof stopTurnTimerMonitoring === 'function') {
                stopTurnTimerMonitoring();
            }

            stopDisconnectMonitor();
            stopLastManStandingPoll();
            window.MatchRecorder?.stop();

            // Clear the board
            if (typeof clearBoard === 'function') {
                clearBoard(true);
            }

            // Reset viewport to default position
            if (typeof viewportX !== 'undefined') viewportX = 0;
            if (typeof viewportY !== 'undefined') viewportY = 0;
            if (typeof viewportScale !== 'undefined') viewportScale = 1;
            if (typeof updateViewport === 'function') {
                updateViewport();
            }

            // Hide game, show lobby
            document.getElementById('lobby-wrapper').style.display = 'block';
            document.getElementById('game-layout').classList.remove('active');

            // Hide leave game and end turn buttons
            const leaveBtn = document.getElementById('leave-game');
            const endTurnBtn = document.getElementById('end-turn');
            if (leaveBtn) leaveBtn.style.display = 'none';
            if (endTurnBtn) endTurnBtn.style.display = 'none';

            // Hide timer HUD
            const timerHud = document.getElementById('hud-timer');
            if (timerHud) timerHud.style.display = 'none';

            // Reset game state variables
            isPlacementPhase = false;
            playerTilesPlaced.clear();
            activePlayerIndex = 0;
            currentTurnNumber = 0;
            lastReceivedTurnNumber = 0;

            updateStatus('🏠 Returned to lobby');

            // Refresh player list to show updated lobby (e.g., without kicked player)
            if (typeof refreshPlayerList === 'function') {
                setTimeout(() => refreshPlayerList(), 500);
            }
        }

        // Broadcast a game action to all other players
        function broadcastGameAction(event, payload) {
            if (!gameChannel || !isMultiplayer) return;

            // Add sequence number for scroll-related events to detect out-of-order delivery
            const isScrollEvent = event.includes('scroll') || event.includes('shrine') || event.includes('common-area');
            if (isScrollEvent) {
                scrollEventSequence++;
                payload._seq = scrollEventSequence;
                payload._timestamp = Date.now();
            }

            // .send() resolves 'ok' | 'timed out' | 'error' — every call site here
            // treats this as fire-and-forget (matches the rest of this codebase's
            // broadcast usage), but a failed send is exactly the kind of thing that
            // should move the connection badge instead of vanishing into the void.
            const sendResult = gameChannel.send({
                type: 'broadcast',
                event: event,
                payload: payload
            });
            // Match recording (host only): our own and our bots' moves.
            // self:false means we never hear these back, so record here.
            window.MatchRecorder?.record(event, payload,
                typeof myPlayerIndex === 'number' ? myPlayerIndex : null);
            if (sendResult && typeof sendResult.then === 'function' && window.ConnectionMonitor) {
                sendResult.then(result => {
                    if (result === 'ok') window.ConnectionMonitor.reportSendSuccess();
                    else window.ConnectionMonitor.reportSendFailure(event, result);
                }).catch(() => {});
            }
        }

        // R2 (docs/bot-roadmap.md, Runtime Track): persist whose turn it is so a
        // backend validator has something real to check against. Turn-passing
        // itself still runs entirely on the broadcastGameAction realtime channel
        // above — this is an additive, fire-and-forget side write, never gates
        // gameplay if it fails.
        function persistCurrentTurnIndex(playerIndex) {
            if (!isMultiplayer || typeof supabase === 'undefined' || !currentGameId) return;
            supabase.from('game_room')
                .update({ current_turn_index: playerIndex })
                .eq('id', currentGameId)
                .then(({ error }) => {
                    if (error) console.warn('⚠️ Failed to persist current_turn_index:', error);
                });
        }

        // Start multiplayer game
        // scarceTiles defaults true — it's the only mode now, no UI toggle left.
        function startMultiplayerGame(allPlayers, sharedDeckSeed = null, scarceTiles = true) {
            // Reset all per-game resources so leftover state from a previous session doesn't carry over
            if (typeof window.resetGameResources === 'function') {
                window.resetGameResources();
            }

            // Reset XP dedup flag so the next game can award XP fresh
            _gameOverXpAwarded = false;
            _gameLogUploaded = false;
            window.resetSessionLogUploadGuard?.();

            // Clear the board first (skip confirmation in multiplayer)
            clearBoard(true);

            // Reset color assignments for this game
            gameSessionColors.clear();

            // Store player data globally for color name lookups
            allPlayersData = allPlayers;
            // Players' name colours (opponent panel, turn display, Game Log)
            window.cosmeticsSystem?.loadNameColors(allPlayers.map(p => p.user_id)).then(() => {
                if (typeof updateOpponentPanel === 'function') updateOpponentPanel();
                if (typeof updateTurnDisplay === 'function') updateTurnDisplay();
            });

            const numPlayers = allPlayers.length;
            console.log(`🎮 Starting multiplayer game with ${numPlayers} players`);
            console.log('All players:', allPlayers);

            // Find my player data
            const myPlayer = allPlayers.find(p => p.id === myPlayerId);
            if (!myPlayer) {
                console.error('Could not find my player data!');
                return;
            }

            // Set my assigned color
            playerColor = myPlayer.color;
            console.log(`🎨 I am player ${myPlayer.player_index + 1} (${playerColor})`);

            // Set activePlayerIndex to first player (player_index 0 = purple/void)
            activePlayerIndex = 0;

            // Initialize placement phase tracking
            totalPlayers = numPlayers;
            playerTilesPlaced = new Set();
            isPlacementPhase = true;
            console.log(`🎮 Placement phase initialized: activePlayerIndex=${activePlayerIndex}, totalPlayers=${totalPlayers}, myPlayerIndex=${myPlayer.player_index}`);

            // Reset dynamic music tension to its game-start baseline (94 BPM,
            // clean BITS/RATE/DEREZ) now that totalPlayers is known — every
            // player's progress score is 0 at this point, so this just makes
            // that explicit rather than waiting for the first checkWinCondition().
            if (typeof updateMusicTension === 'function') updateMusicTension();

            // Set up broadcast channel for game actions
            setupGameBroadcast();

            // Initialize deck with shared seed for multiplayer synchronization
            initializeDeck(numPlayers, sharedDeckSeed, scarceTiles);
            console.log(`🎴 Deck initialized with seed: ${sharedDeckSeed}${scarceTiles ? ' (scarce tiles mode)' : ''}`);

            // In multiplayer, only show MY player tile
            initializeMyPlayerTile(myPlayer.player_index, myPlayer.color);

            Object.keys(stoneCounts).forEach(updateStoneCount);
            updateVoidAP(); // Initialize void AP display
            drawDeckTile();
            updateViewport();
            boardSvg.style.cursor = 'grab';

            // Number of tiles actually in the deck (6 per player normally, 6 per
            // (player-1) in scarce tiles mode) — read from tileDeck itself rather
            // than recomputing the formula, so spiral positions always match deck size.
            const numTiles = tileDeck.length;

            // Place hidden tiles in spiral pattern
            const spiralPositions = generateSpiralPositions(numTiles);
            console.log(`Placing ${numTiles} tiles for ${numPlayers} player(s)`);
            spiralPositions.forEach((pos, index) => {
                console.log(`Tile ${index + 1}: (${pos.x.toFixed(1)}, ${pos.y.toFixed(1)})`);
                placeTile(pos.x, pos.y, 0, true); // Place as flipped (hidden)
            });

            // Center and fit the board to view
            fitBoardToView();

            // Show appropriate message based on turn order
            if (myPlayer.player_index === 0) {
                updateStatus(`You are Player ${myPlayer.player_index + 1} (${playerColor}). Drag your player tile to the board to start!`);
            } else {
                updateStatus(`You are Player ${myPlayer.player_index + 1} (${playerColor}). Waiting for other players to place their tiles...`);
            }

            // Initialize opponent panel
            updateOpponentPanel();

            // Delayed so the consent dialog doesn't cover the board's own
            // intro (tiles dropping into their spiral, camera fitting to view).
            setTimeout(promptLogConsentIfNeeded, 1500);
        }


        // Start game with selected number of players (local mode)
        // scarceTiles defaults true — it's the only mode now, no UI toggle left.
        function startGame(numPlayers, scarceTiles = true) {
            // Reset the session-log upload guard so a second solo game in the
            // same tab still uploads (startMultiplayerGame resets it separately —
            // solo games don't go through that function).
            window.resetSessionLogUploadGuard?.();

            // Clear the board first (skip confirmation — startGame is always intentional)
            clearBoard(true);

            // Reset color assignments for this game
            gameSessionColors.clear();
            playerColor = null;
            console.log(`🎨 Starting game with ${numPlayers} player(s). Colors will be assigned as player tiles are placed.`);

            // Hide lobby, show new game layout
            document.getElementById('lobby-wrapper').style.display = 'none';
            document.getElementById('game-layout').classList.add('active');
            updateDeckIndicatorVisibility();

            // Initialize new UI elements
            initializeNewUI();

            // Initialize
            initializeDeck(numPlayers, null, scarceTiles); // Shuffle the tile deck
            initializePlayerTiles(numPlayers); // Create player tiles

            // Number of tiles actually in the deck (6 per player normally, 6 per
            // (player-1) in scarce tiles mode) — read from tileDeck itself rather
            // than recomputing the formula, so spiral positions always match deck size.
            const numTiles = tileDeck.length;
            Object.keys(stoneCounts).forEach(updateStoneCount);
            updateVoidAP(); // Initialize void AP display
            drawDeckTile();
            updateViewport();
            boardSvg.style.cursor = 'grab';

            // Place hidden tiles in spiral pattern
            const spiralPositions = generateSpiralPositions(numTiles);
            console.log(`Placing ${numTiles} tiles for ${numPlayers} player(s)`);
            spiralPositions.forEach((pos, index) => {
                console.log(`Tile ${index + 1}: (${pos.x.toFixed(1)}, ${pos.y.toFixed(1)})`);
                placeTile(pos.x, pos.y, 0, true); // Place as flipped (hidden)
            });

            // Center and fit the board to view
            fitBoardToView();

            updateStatus(`Game started with ${numPlayers} player(s) (${numTiles} tiles). Drag a player tile from the Player Tiles deck to start.`);

            // Initialize / refresh mobile UI based on current viewport (supports devtools device toolbar)
            updateIsMobile();
            window.addEventListener('resize', updateIsMobile);
            try { window.matchMedia('(max-width: 768px)').addEventListener('change', updateIsMobile); } catch (e) {}

            // startGame() is also how tutorial-mode.js builds its scripted board
            // (see the comment right below) — that never touches Supabase, so
            // skip the consent prompt there. Delayed so it doesn't cover the
            // board's own intro (tiles dropping into their spiral, camera
            // fitting to view).
            if (!window.isTutorialMode) {
                setTimeout(promptLogConsentIfNeeded, 1500);
            }
        }

        // Expose startGame globally so tutorial-mode.js can call it without auth
        window.startGame = startGame;

        // Mobile UI initialization and tab switching
        function initializeMobileUI() {
            const tabButtons = document.querySelectorAll('.mobile-tab-btn');
            const tilesPanel = document.getElementById('mobile-tiles-panel');
            const stonesPanel = document.getElementById('mobile-stones-panel');
            let currentTab = 'tiles';

            // Tab switching logic
            tabButtons.forEach(btn => {
                btn.addEventListener('click', () => {
                    const tab = btn.dataset.tab;

                    // Update active tab button
                    tabButtons.forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');

                    // Show/hide panels
                    if (tab === 'tiles') {
                        tilesPanel.classList.add('active');
                        stonesPanel.classList.remove('active');
                        currentTab = 'tiles';
                        syncMobileTileDeck();
                    } else {
                        stonesPanel.classList.add('active');
                        tilesPanel.classList.remove('active');
                        currentTab = 'stones';
                        syncMobileStoneDeck();
                    }
                });
            });

            // Swipe gesture for tab switching
            let touchStartX = 0;
            let touchEndX = 0;

            const mobileContainer = document.querySelector('.mobile-deck-container');

            mobileContainer.addEventListener('touchstart', (e) => {
                touchStartX = e.changedTouches[0].screenX;
            }, { passive: true });

            mobileContainer.addEventListener('touchend', (e) => {
                touchEndX = e.changedTouches[0].screenX;
                handleSwipe();
            }, { passive: true });

            function handleSwipe() {
                const swipeThreshold = 50;
                const diff = touchStartX - touchEndX;

                if (Math.abs(diff) > swipeThreshold) {
                    if (diff > 0 && currentTab === 'tiles') {
                        // Swiped left - switch to stones
                        tabButtons[1].click();
                    } else if (diff < 0 && currentTab === 'stones') {
                        // Swiped right - switch to tiles
                        tabButtons[0].click();
                    }
                }
            }

            // Initialize with tiles tab active
            syncMobileTileDeck();
            syncMobileStoneDeck();
        }

        
        // Programmatically open a mobile deck tab (tiles/stones)
        function openMobileTab(tab) {
            if (!isMobile) return;
            const tabButtons = document.querySelectorAll('.mobile-tab-btn');
            const tilesPanel = document.getElementById('mobile-tiles-panel');
            const stonesPanel = document.getElementById('mobile-stones-panel');

            tabButtons.forEach(b => b.classList.remove('active'));
            const btn = Array.from(tabButtons).find(b => b.dataset.tab === tab);
            if (btn) btn.classList.add('active');

            if (tab === 'tiles') {
                tilesPanel.classList.add('active');
                stonesPanel.classList.remove('active');
                syncMobileTileDeck();
            } else {
                stonesPanel.classList.add('active');
                tilesPanel.classList.remove('active');
                syncMobileStoneDeck();
            }
        }

        function setMobileDeckCollapsed(collapsed) {
            const container = document.querySelector('.mobile-deck-container');
            if (!container) return;
            if (collapsed) container.classList.add('collapsed');
            else container.classList.remove('collapsed');
        }


// Sync mobile tile deck with desktop deck
        function syncMobileTileDeck() {
            if (!isMobile) return;

            const mobileGrid = document.getElementById('mobile-tile-grid');
            mobileGrid.innerHTML = '';

            // Add player tiles
            playerTileElements.forEach((tileElement, index) => {
                const clone = tileElement.cloneNode(true);
                clone.style.touchAction = 'none';
                clone.addEventListener('touchstart', (e) => {
                    if (playerTilesAvailable <= 0) return;
                    if (isMultiplayer && isPlacementPhase && !canPlaceTile()) {
                        notYourTurn();
                        return;
                    }
                    e.preventDefault();
                    startPlayerTileDrag(index, e);
                }, { passive: false });

                mobileGrid.appendChild(clone);
            });

            // Update count
            document.getElementById('mobile-tile-count').textContent = playerTilesAvailable;
        }

        // Sync mobile stone deck with desktop deck
        function syncMobileStoneDeck() {
            if (!isMobile) return;

            const mobileGrid = document.getElementById('mobile-stone-grid');
            mobileGrid.innerHTML = '';

            ['earth', 'water', 'fire', 'wind', 'void'].forEach(type => {
                const stoneItem = document.createElement('div');
                stoneItem.className = 'stone-deck-item';
                stoneItem.style.touchAction = 'none';

                stoneItem.innerHTML = `
                    <svg width="40" height="40">
                        <circle cx="20" cy="20" r="12" fill="${STONE_TYPES[type].color}" class="stone-piece"/>
                        <image href="${STONE_TYPES[type].img}" x="8" y="8" width="24" height="24" style="mix-blend-mode:screen"/>
                    </svg>
                    <div class="stone-count">${playerPool[type]}/${stoneCapacity}</div>
                    <div class="source-count">${stoneCounts[type]}/25</div>
                `;

                stoneItem.addEventListener('touchstart', (e) => {
                    if (stoneCounts[type] <= 0) return;
                    e.preventDefault();

                    isDraggingFromDeck = true;
                    isDraggingStone = true;
                    draggedStoneId = null;
                    draggedStoneType = type;

                    const rect = boardSvg.getBoundingClientRect();
                    const coords = getEventCoords(e);
                    const screenX = coords.x - rect.left;
                    const screenY = coords.y - rect.top;
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
                }, { passive: false });

                mobileGrid.appendChild(stoneItem);
            });
        }

        // Lock screen orientation to portrait on mobile (if supported)
        if (isMobile && screen.orientation && screen.orientation.lock) {
            screen.orientation.lock('portrait').catch(err => {
                console.log('Could not lock orientation:', err);
            });
        }
    
        // Initialize button visibility on load
        try { updateEndTurnButtonVisibility(); } catch (e) {}

        // ── Auth init ──────────────────────────────────────────────────
        // Wire Enter key on auth fields to trigger login
        ['auth-username', 'auth-password'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.addEventListener('keydown', e => { if (e.key === 'Enter') authLogin(); });
        });

        // Restore an existing Supabase Auth session (auto-login on page reload)
        checkAuthSession();
