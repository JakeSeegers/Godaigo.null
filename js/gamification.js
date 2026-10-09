// ============================================================
// GAMIFICATION SERVICE  (js/gamification.js)
// Adapted from Gamify/gamification_service.js for Godaigo.
//
// Uses the global `supabase` client (config.js).
// Exposes window.gami for lobby.js / game-core.js to call.
//
// XP rewards:
//   game_complete     : 20 + (numPlayers-1)×10  (loss)
//   game_win          : 75 + (numPlayers-1)×25  (win)
//
// Gold rewards (no leaderboard impact):
//   daily_login       : +20 gold (once per calendar day)
//   level_up          : +50 gold per level (handled in DB function)
// ============================================================

window.gami = (function () {

    // ── Internal state ────────────────────────────────────────
    let _userId  = null;
    let _profile = null;   // cached user_profiles row

    // ── Helpers ───────────────────────────────────────────────

    function _log(...args) {
        console.log('[gami]', ...args);
    }

    /** Fire-and-forget INSERT into user_activities */
    function _logActivity(activityType, xpAwarded, goldAwarded, description, metadata) {
        if (!_userId) return;
        supabase.from('user_activities').insert({
            user_id:       _userId,
            activity_type: activityType,
            xp_awarded:    xpAwarded    || 0,
            gold_awarded:  goldAwarded  || 0,
            description:   description  || activityType,
            metadata:      metadata     || {}
        }).then(({ error }) => {
            if (error) console.error('[gami] activity log error:', error);
        });
    }

    /** Update a subset of profile.stats in the DB (fire-and-forget) */
    function _patchStats(patch) {
        if (!_userId || !_profile) return;
        const stats = Object.assign({}, _profile.stats || {}, patch);
        _profile.stats = stats;
        supabase.from('user_profiles')
            .update({ stats, updated_at: new Date().toISOString() })
            .eq('user_id', _userId)
            .then(({ error }) => {
                if (error) console.error('[gami] stats patch error:', error);
            });
    }

    // ── Public API ────────────────────────────────────────────

    const api = {

        // Expose userId for UI (read-only intent)
        get userId() { return _userId; },
        get profile() { return _profile; },

        // Info pop-ups the player ticked "do not show on this account again" (2026-10-09).
        // Saved in user_profiles.stats.hidden_tips (follows the account) and mirrored in
        // localStorage godaigo_hidden_tips (works signed out / before the profile loads).
        tipHidden(id) {
            const acct = _profile?.stats?.hidden_tips;
            if (Array.isArray(acct)) return acct.includes(id);
            try { return JSON.parse(localStorage.getItem('godaigo_hidden_tips') || '[]').includes(id); } catch (e) { return false; }
        },
        hideTip(id) {
            try {
                const local = JSON.parse(localStorage.getItem('godaigo_hidden_tips') || '[]');
                if (!local.includes(id)) local.push(id);
                localStorage.setItem('godaigo_hidden_tips', JSON.stringify(local));
            } catch (e) {}
            const acct = Array.isArray(_profile?.stats?.hidden_tips) ? _profile.stats.hidden_tips.slice() : [];
            if (!acct.includes(id)) { acct.push(id); _patchStats({ hidden_tips: acct }); }
        },
        resetTips() {
            try { localStorage.removeItem('godaigo_hidden_tips'); } catch (e) {}
            if (_profile) _patchStats({ hidden_tips: [] });
        },

        /**
         * init(userId, displayName)
         * Called from onAuthSuccess in lobby.js.
         * Gets or creates the user_profiles row.
         */
        async init(userId, displayName) {
            _userId = userId;

            let { data: profile, error } = await supabase
                .from('user_profiles')
                .select('*')
                .eq('user_id', userId)
                .single();

            if (error && error.code === 'PGRST116') {
                // Profile doesn't exist yet — create it
                const { data: newProfile, error: createErr } = await supabase
                    .from('user_profiles')
                    .insert({
                        user_id:      userId,
                        display_name: displayName || 'Player',
                        total_xp:     0,
                        current_level: 1,
                        gold:         0,
                        badges_earned: [],
                        inventory:    [],
                        stats: {
                            games_played:      0,
                            games_won:         0,
                            scrolls_cast:      0,
                            elements_activated: 0,
                            streak:            0,
                            last_active:       null
                        }
                    })
                    .select()
                    .single();

                if (createErr) {
                    console.error('[gami] profile create error:', createErr);
                    return;
                }
                profile = newProfile;
                _log('new profile created for', displayName);
            } else if (error) {
                console.error('[gami] profile fetch error:', error);
                return;
            }

            _profile = profile;
            _log('init complete - level', profile.current_level, 'xp', profile.total_xp);
        },

        /**
         * onDailyLogin()
         * Awards 20 gold once per calendar day.
         * Does NOT award XP (login is not a meaningful game action).
         */
        async onDailyLogin() {
            if (!_userId || !_profile) return;

            // Wins still waiting for a witness from earlier games: paid now if
            // nobody is left who could confirm them (sql/match-witness-v3.sql).
            supabase.rpc('retry_pending_wins').then(({ data }) => {
                if (data?.xp > 0) {
                    if (_profile) _profile.total_xp = (_profile.total_xp || 0) + data.xp;
                    api.notify(`Earlier win confirmed! +${data.xp} XP`, data.xp, 'xp');
                }
            }).catch(() => {});

            const today     = new Date().toDateString();
            const lastActive = _profile.stats?.last_active;
            if (lastActive === today) return; // Already collected today

            // The server decides: 20 gold once per (UTC) day, and it logs the
            // daily_login activity for the "Dedicated" badge itself.
            const { data: claim, error } = await supabase.rpc('claim_daily_login');
            if (error) { console.error('[gami] daily login gold error:', error); return; }
            if (!claim?.awarded) {
                _patchStats({ last_active: today });
                return; // already claimed today (maybe on another device)
            }

            // Update streak and last_active in stats
            const yesterday = new Date(Date.now() - 86_400_000).toDateString();
            const streak    = (lastActive === yesterday)
                ? (_profile.stats?.streak || 0) + 1
                : 1;

            _patchStats({ last_active: today, streak });
            if (_profile) _profile.gold = (_profile.gold || 0) + 20;

            api.notify('Daily reward! +20', 20, 'gold');
            _log('daily login gold awarded');
        },

        /**
         * onScrollCast(scrollName, element)
         * Called via window.logScrollEvent (already fired from game-core.js).
         * Tracks count for badge purposes only — no XP.
         */
        onScrollCast(scrollName, element) {
            if (!_userId) return;
            // Fire-and-forget
            _logActivity('scroll_cast', 0, 0, `Cast ${scrollName || element || 'scroll'}`);
            _patchStats({ scrolls_cast: (_profile?.stats?.scrolls_cast || 0) + 1 });
        },

        /**
         * onElementActivated(element, allActivated)
         * Tracks activations for badge purposes only — no XP.
         */
        onElementActivated(element, allActivated) {
            if (!_userId) return;
            _logActivity('element_activated', 0, 0, `Activated ${element}`, { element });
            _patchStats({ elements_activated: (_profile?.stats?.elements_activated || 0) + 1 });
        },

        /**
         * onGameComplete(isWinner, numPlayers)
         * XP scales with player count:
         *   Loss: 20 + (n-1)*10   →  2p=30, 3p=40, 4p=50, 5p=60
         *   Win:  75 + (n-1)*25   →  2p=100, 3p=125, 4p=150, 5p=175
         */
        async onGameComplete(isWinner, numPlayers, roomId) {
            _log(`onGameComplete called - userId=${_userId}, isWinner=${isWinner}, numPlayers=${numPlayers}, room=${roomId}`);
            if (!_userId) { console.warn('[gami] onGameComplete: no userId, XP skipped'); return; }
            if (!isWinner) { _log('no XP awarded - only winners earn XP'); return; }
            if (!roomId) { console.warn('[gami] onGameComplete: no room id, XP skipped'); return; }

            try {
                // The server checks the room is finished with our seat as the
                // winner, decides the XP, and logs the game_complete / game_win
                // activities (badges) itself. Once per game.
                const { data: xpData, error: xpErr } = await supabase.rpc('claim_game_win', { p_room_id: roomId });
                if (xpErr) { console.error('[gami] claim_game_win RPC error:', xpErr); return; }
                if (xpData?.reason === 'awaiting_witness') {
                    // Another player's game must confirm the win first; the
                    // server pays it the moment they do, even if we leave.
                    api.notify('Victory! Your XP arrives once the game is confirmed.', 0, 'xp');
                    _log('win claim waiting for a witness');
                    // In the background: handleGameOver awaits this function
                    // before showing the win screen, so never block it.
                    const before = _profile?.total_xp || 0;
                    (async () => {
                        // A witness usually confirms within seconds. If nobody
                        // can (e.g. last player standing), the server pays it
                        // once no other player is left (retry_pending_wins,
                        // sql/match-witness-v3.sql), so ask again later too.
                        for (const wait of [4000, 8000, 15000, 50000, 90000]) {
                            await new Promise(r => setTimeout(r, wait));
                            if (wait >= 50000) { try { await supabase.rpc('retry_pending_wins'); } catch (e) {} }
                            const fresh = await api.getProfile();
                            const gained = (fresh?.total_xp || 0) - before;
                            if (gained > 0) { api.notify(`Win confirmed! +${gained} XP`, gained, 'xp'); break; }
                        }
                    })().catch(() => {});
                    return;
                }
                if (!xpData?.success) {
                    _log('no XP awarded:', xpData?.reason);
                    if (xpData?.reason === 'too_short') {
                        api.notify('This game was too short to count for XP or the ladder.', 0, 'xp');
                    }
                    return;
                }
                _log('claim_game_win success, result:', xpData);
                const xp = xpData.xp;

                // Update stats
                const stats = Object.assign({}, _profile?.stats || {});
                stats.games_played = (stats.games_played || 0) + 1;
                if (isWinner) stats.games_won = (stats.games_won || 0) + 1;
                _patchStats(stats);
                if (_profile) _profile.total_xp = (_profile.total_xp || 0) + xp;

                const msg = `Victory! +${xp} XP`;
                api.notify(msg, xp, 'xp');
                _log('game complete -', msg);
            } catch (err) {
                console.error('[gami] onGameComplete error:', err);
            }
        },

        /** Fetch a fresh profile from the DB */
        async getProfile() {
            if (!_userId) return null;
            const { data, error } = await supabase
                .from('user_profiles')
                .select('*')
                .eq('user_id', _userId)
                .single();
            if (error) { console.error('[gami] getProfile error:', error); return _profile; }
            _profile = data;
            return data;
        },

        /** Top N players ordered by total XP */
        async getLeaderboard(limit) {
            const { data, error } = await supabase
                .from('user_profiles')
                .select('display_name, total_xp, current_level, user_id')
                .order('total_xp', { ascending: false })
                .limit(limit || 10);
            if (error) { console.error('[gami] leaderboard error:', error); return []; }
            return data || [];
        },

        /** All badges merged with the current user's earned status */
        async getBadgesWithStatus() {
            const { data: badges, error } = await supabase
                .from('badges')
                .select('*')
                .eq('is_active', true)
                .order('xp_reward', { ascending: true });
            if (error) { console.error('[gami] badges error:', error); return []; }

            const earnedIds = _profile?.badges_earned || [];
            return (badges || []).map(b => ({
                ...b,
                earned: earnedIds.includes(b.id)
            }));
        },

        /**
         * Show a slide-in toast at the bottom-right.
         * type: 'xp' | 'gold'
         */
        notify(message, amount, type) {
            const toast = document.createElement('div');
            toast.className = 'gami-toast';
            toast.innerHTML =
                `<span class="gami-toast-icon">${type === 'gold' ? '[G]' : '[XP]'}</span>${message}`;
            document.body.appendChild(toast);

            requestAnimationFrame(() => toast.classList.add('gami-toast-show'));

            setTimeout(() => {
                toast.classList.remove('gami-toast-show');
                setTimeout(() => toast.remove(), 400);
            }, 3000);
        }
    };

    return api;
})();

// ── Hook into window.logScrollEvent (already called by game-core.js executeSpell) ──
// This intercepts scroll casts with zero changes to game-core.js.
window.logScrollEvent = function (eventType, data) {
    if (eventType === 'cast_execute' && window.gami?.userId) {
        window.gami.onScrollCast(data?.scrollName, data?.element);
    }
};
