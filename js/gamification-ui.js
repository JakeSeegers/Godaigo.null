// ============================================================
// GAMIFICATION UI  (js/gamification-ui.js)
// Vanilla JS modal panels: Profile (Stats, Badges, Leaderboard, Settings) and
// Shop (Names and Pawns, Emojis)
//
// Entry point: gami_openPanel()
//   Called from the "👤 Profile" button in the auth bar (index.html).
// ============================================================

// Two windows share this modal: Profile (stats, badges, board, settings)
// and Shop (everything you can buy). A tab id picks its window.
const GAMI_PROFILE_TABS = [['profile', 'Stats'], ['badges', 'Badges'], ['leaderboard', 'Board'], ['settings', 'Settings']];
const GAMI_SHOP_TABS    = [['cosmetics', 'Names and Pawns'], ['emojis', 'Emojis'], ['features', 'Features']];
function _gami_isShopTab(tab) { return GAMI_SHOP_TABS.some(([id]) => id === tab); }

/** Toggle the profile panel open / closed, optionally landing on a given tab
 *  (defaults to 'profile'). A shop tab ('cosmetics' / 'emojis') opens the
 *  Shop window instead. Only ever renders once per open. */
function gami_openPanel(tab = 'profile') {
    const existing = document.getElementById('gami-panel');
    if (existing) { existing.remove(); return; }
    if (!window.gami?.userId) return;

    const shop  = _gami_isShopTab(tab);
    const tabs  = shop ? GAMI_SHOP_TABS : GAMI_PROFILE_TABS;
    const title = shop ? 'Shop' : 'Profile';
    const overlay = document.createElement('div');
    overlay.id        = 'gami-panel';
    overlay.className = 'gami-overlay';
    overlay.dataset.window = shop ? 'shop' : 'profile';
    overlay.innerHTML = `
        <div class="gami-modal" role="dialog" aria-label="${title} panel">
            <div class="gami-header">
                <h2 class="gami-title">${title}</h2>
                <button class="gami-close" aria-label="Close" onclick="document.getElementById('gami-panel').remove()">×</button>
            </div>
            <div class="gami-tabs" role="tablist">
                ${tabs.map(([id, label]) => `<button class="gami-tab" role="tab" data-tab="${id}" onclick="gami_switchTab('${id}')">${label}</button>`).join('')}
            </div>
            <div id="gami-content" class="gami-content pp-fresh-open">
                <div class="gami-loading">Loading…</div>
            </div>
        </div>
    `;

    overlay.addEventListener('click', e => {
        if (e.target === overlay) overlay.remove();
    });

    document.body.appendChild(overlay);
    gami_switchTab(tab);
}

/** Lobby "Shop" button: name styles, pawn items and emojis. */
function gami_openShop(tab = 'cosmetics') {
    gami_openPanelOnTab(tab);
}

/** Open the panel directly on the Settings tab (usable from in-game HUD) */
function gami_openSettings() {
    gami_openPanelOnTab('settings');
}

/** Open the right window directly on a given tab. Toggles closed if already
 *  open on that same tab; switches window if the other one is open. */
function gami_openPanelOnTab(tab) {
    const existing = document.getElementById('gami-panel');
    if (existing) {
        const active = existing.querySelector('.gami-tab.active')?.dataset.tab;
        const sameWindow = existing.dataset.window === (_gami_isShopTab(tab) ? 'shop' : 'profile');
        if (active === tab) { existing.remove(); return; }
        if (sameWindow) { gami_switchTab(tab); return; }
        existing.remove();
    }
    gami_openPanel(tab);
}

/** Switch the active tab and load its content */
async function gami_switchTab(tab) {
    const panel = document.getElementById('gami-panel');
    if (!panel) return;

    panel.querySelectorAll('.gami-tab').forEach(btn => btn.classList.toggle('active', btn.dataset.tab === tab));

    const content = document.getElementById('gami-content');
    content.innerHTML = '<div class="gami-loading">Loading…</div>';

    try {
        if      (tab === 'profile')     await _renderProfile(content);
        else if (tab === 'cosmetics')        _renderCosmetics(content);
        else if (tab === 'emojis')           _renderEmojis(content);
        else if (tab === 'features')         _renderFeatures(content);
        else if (tab === 'badges')      await _renderBadges(content);
        else if (tab === 'settings')         _renderSettings(content);
        else                            await _renderLeaderboard(content);
    } catch (err) {
        console.error('[gami-ui] render error:', err);
        content.innerHTML = '<div class="gami-loading">Failed to load. Please try again.</div>';
    }

    // The fresh-open unfold + staggered reveal (see paper-ui-profile.css)
    // should only ever play once, for the tab gami_openPanel() lands on
    // when the modal is first created — not on every later tab click.
    content.classList.remove('pp-fresh-open');
}

// ── Profile tab ──────────────────────────────────────────────

async function _renderProfile(content) {
    const profile = await window.gami.getProfile();
    if (!profile) {
        content.innerHTML = '<div class="gami-loading">Could not load profile.</div>';
        return;
    }

    const xpIntoLevel = profile.total_xp % 1000;
    const xpPercent   = Math.round(xpIntoLevel / 10);
    const stats       = profile.stats || {};
    const winRate     = stats.games_played > 0
        ? Math.round((stats.games_won / stats.games_played) * 100)
        : 0;
    const earnedCount = (profile.badges_earned || []).length;

    content.innerHTML = `
        <div class="gami-profile-row">
            <div class="gami-level-badge">
                <span class="gami-level-num">${profile.current_level}</span>
                <span class="gami-level-label">Level</span>
            </div>
            <div class="gami-profile-info">
                <div class="gami-display-name">${_esc(profile.display_name)}</div>
                <div class="gami-xp-bar-wrap">
                    <div class="gami-xp-bar" style="width:${xpPercent}%"></div>
                </div>
                <div class="gami-xp-text">${xpIntoLevel.toLocaleString()} / 1,000 XP to next level</div>
            </div>
        </div>

        <div class="gami-stats-grid">
            <div class="gami-stat">
                <span class="gami-stat-val">${(profile.total_xp || 0).toLocaleString()}</span>
                <span class="gami-stat-lbl">Total XP</span>
            </div>
            <div class="gami-stat">
                <span class="gami-stat-val">${(profile.gold || 0).toLocaleString()}</span>
                <span class="gami-stat-lbl">Gold</span>
            </div>
            <div class="gami-stat">
                <span class="gami-stat-val">${stats.games_played || 0}</span>
                <span class="gami-stat-lbl">Games Played</span>
            </div>
            <div class="gami-stat">
                <span class="gami-stat-val">${stats.games_won || 0}</span>
                <span class="gami-stat-lbl">Games Won</span>
            </div>
            <div class="gami-stat">
                <span class="gami-stat-val">${winRate}%</span>
                <span class="gami-stat-lbl">Win Rate</span>
            </div>
            <div class="gami-stat">
                <span class="gami-stat-val">${earnedCount}</span>
                <span class="gami-stat-lbl">Badges Earned</span>
            </div>
        </div>
    `;
}

// ── Cosmetics tab ────────────────────────────────────────────

function _renderCosmetics(content) {
    const cs = window.cosmeticsSystem;
    if (!cs) { content.innerHTML = '<div class="gami-loading">Cosmetics not loaded.</div>'; return; }

    const data     = cs.getData();
    const equipped = data.equipped || {};
    const owned    = data.owned || [];
    // Secret items (Hermit rewards, no price) only show to players who own them.
    const items    = cs.getItems().filter(i => !i.hidden || owned.includes(i.id));
    const gold     = window.gami?.profile?.gold || 0;

    content.innerHTML = `
        <div class="gami-cos-header">
            <span style="color:var(--pp-ink);font-size:15px;font-weight:bold;">Name Styles and Pawns</span>
            <span style="color:var(--pp-gold);font-size:14px;">${gold}g</span>
        </div>
        <div class="gami-cos-list">
            ${items.map((item, n) => {
                const isOwned    = owned.includes(item.id);
                const isEquipped = equipped[cs.slotOf(item)] === item.id;
                const canAfford  = gold >= item.cost;

                const heading = (n === 0 || items[n - 1].group !== item.group)
                    ? `<div class="gami-cos-group">${item.group}</div>` : '';

                let actionHTML;
                if (isOwned) {
                    actionHTML = `<button class="gami-cos-btn${isEquipped ? ' equipped' : ''}"
                        onclick="_gami_cosmeticsEquip('${item.id}')">
                        ${isEquipped ? '✓ On' : 'Equip'}
                    </button>`;
                } else {
                    actionHTML = `<button class="gami-cos-btn buy${canAfford ? '' : ' cant-afford'}"
                        onclick="_gami_cosmeticsBuy('${item.id}')">
                        ${item.cost}g
                    </button>`;
                }

                return heading + `
                    <div class="gami-cos-item${isEquipped ? ' active' : ''}">
                        <div class="gami-cos-preview">${cs.previewHtml(item, 18)}</div>
                        <div class="gami-cos-name">${item.name}</div>
                        <div class="gami-cos-action">${actionHTML}</div>
                    </div>`;
            }).join('')}
        </div>`;
}

// ── Emojis tab ───────────────────────────────────────────────

function _renderEmojis(content) {
    const es = window.emojiSystem;
    if (!es) { content.innerHTML = '<div class="gami-loading">Emoji system not loaded.</div>'; return; }

    es.reloadInventory();
    const inventory = es.getInventory();
    const items     = es.getItems();
    const tiers     = es.getTiers();
    const gold      = window.gami?.profile?.gold || 0;
    const inGame    = !!document.getElementById('game-layout')?.classList.contains('active');

    const owned = items.filter(e => inventory.has(e.id));

    let html = '<div class="gami-section-title">My Emojis</div>';

    if (owned.length === 0) {
        html += `<div style="color:var(--pp-ink-soft);font-style:italic;padding:8px 0 16px;">No emojis yet - buy some below!</div>`;
    } else {
        html += `<div class="gami-emoji-grid">`;
        for (const item of owned) {
            const cls = 'gami-emoji-btn' + (item.isText ? ' text-emoji' : '');
            if (inGame) {
                html += `<button class="${cls}" onclick="_gami_emojisUse('${item.id}')" title="${_esc(item.name)}">${es.displayHtml(item)}</button>`;
            } else {
                html += `<div class="${cls} inactive" title="${_esc(item.name)} (join a game to use)">${es.displayHtml(item)}</div>`;
            }
        }
        html += `</div>`;
        if (!inGame) html += `<div style="color:var(--pp-ink-soft);font-size:12px;padding:4px 0 14px;">Join a game to use emojis</div>`;
    }

    html += `<div class="gami-section-title" style="margin-top:4px;">Shop <span style="color:var(--pp-gold);float:right;">${gold}g</span></div>`;

    for (const tier of tiers) {
        const tierItems = items.filter(e => e.tier === tier.id);
        html += `
            <div class="gami-tier-section">
                <div class="gami-tier-header" style="border-left-color:${tier.color};">
                    <span style="color:${tier.color};font-weight:bold;font-size:11px;">${tier.badge}</span>
                    <span style="color:var(--pp-ink-soft);margin-left:6px;font-size:13px;">${tier.name}</span>
                    <span style="color:${tier.color};margin-left:auto;font-size:12px;">${tier.cost}g</span>
                </div>
                <div class="gami-emoji-shop-grid">`;
        for (const item of tierItems) {
            const isOwned = inventory.has(item.id);
            const cls = 'gami-shop-emoji' + (item.isText ? ' text-emoji' : '');
            if (isOwned) {
                html += `
                    <div class="gami-shop-item owned" title="${_esc(item.name)}">
                        <span class="${cls}">${es.displayHtml(item)}</span>
                        <div class="gami-shop-name">${_esc(item.name)}</div>
                        <div class="gami-shop-owned">✓</div>
                    </div>`;
            } else {
                html += `
                    <div class="gami-shop-item" title="${_esc(item.name)} - ${item.cost}g">
                        <button class="${cls}" onclick="_gami_emojisBuy('${item.id}')">${es.displayHtml(item)}</button>
                        <div class="gami-shop-name">${_esc(item.name)}</div>
                        <button class="gami-shop-buy-btn" style="border-color:${tier.color};color:${tier.color};"
                                onclick="_gami_emojisBuy('${item.id}')">${item.cost}g</button>
                    </div>`;
            }
        }
        html += `</div></div>`;
    }

    content.innerHTML = html;
}

// ── Badges tab ───────────────────────────────────────────────

async function _renderBadges(content) {
    const badges = await window.gami.getBadgesWithStatus();
    await window.Rewards?.loadCatalog?.();
    const R = window.Rewards;
    // Special (Hermit) badges only show once you have them.
    const list = badges.filter(b => b.earned || !R?.isSpecial(b));
    if (!list.length) {
        content.innerHTML = '<div class="gami-loading">No badges available.</div>';
        return;
    }
    const shown = R ? R.shownFor(window.gami.userId) : [];
    const slots = R ? R.slots() : 1;

    const cards = list.map(b => {
        const icon = b.earned ? (b.image && R ? R.iconHtml(b.id, 'gami-badge-img') : b.icon) : '?';
        const isShown = shown.includes(b.id);
        const btn = b.earned && R
            ? `<button class="gami-badge-show ${isShown ? 'on' : ''}" onclick="_gami_toggleBadge('${_esc(b.id)}')">${isShown ? '✓ By my name' : 'Show by my name'}</button>`
            : '';
        return `
        <div class="gami-badge-card ${b.earned ? 'earned' : 'locked'}${isShown ? ' shown' : ''}" title="${_esc(b.description)}">
            <div class="gami-badge-icon">${icon}</div>
            <div class="gami-badge-name">${_esc(b.name)}</div>
            <div class="gami-badge-desc">${_esc(b.description)}</div>
            ${b.gold_reward ? `<div class="gami-badge-reward">+${b.gold_reward}g</div>` : ''}
            ${btn}
        </div>`;
    }).join('');

    const head = R ? `
        <div class="gami-badge-slots">
            Badges by your name: <b>${shown.length} / ${slots}</b> slots used.
            ${slots < R.MAX_SLOTS ? `<button class="gami-link-btn" onclick="gami_openShop('features')">Get more slots</button>` : ''}
        </div>` : '';
    content.innerHTML = head + `<div class="gami-badges-grid">${cards}</div>`;
}

async function _gami_toggleBadge(id) {
    const R = window.Rewards;
    if (!R) return;
    const on = R.shownFor(window.gami.userId).includes(id);
    await (on ? R.hideBadge(id) : R.showBadge(id));
    const content = document.getElementById('gami-content');
    if (content) _renderBadges(content);
}

// ── Features tab (Shop) ──────────────────────────────────────

function _renderFeatures(content) {
    const R = window.Rewards;
    const prof = window.gami?.profile || {};
    const slots = R ? R.slots() : 1;
    const max = R ? R.MAX_SLOTS : 3;
    const price = R ? R.SLOT_PRICE : 700;
    const full = slots >= max;
    const phrases = R ? R.GIFT_PHRASES : [];
    const streamOwned = !!window.StreamVotes?.owned?.();
    const bountyOwned = !!window.PlayerBounty?.owned?.();
    const bountyPrice = window.PlayerBounty?.PRICE ?? 300;
    const streamPrice = window.StreamVotes?.PRICE ?? 500;
    content.innerHTML = `
        <div class="gami-feature">
            <div class="gami-feature-title">Send a gift</div>
            <div class="gami-feature-desc">A gift costs <b>100g</b>. The player gets a surprise <b>25 to 100g</b>; the rest goes into the pot.
                Each player can get one gift a day.</div>
            <input class="gami-gift-name" placeholder="Player name" maxlength="40" list="gami-gift-names" autocomplete="off">
            <datalist id="gami-gift-names"></datalist>
            <select class="gami-gift-phrase">${phrases.map((t, i) => `<option value="${i}">${_esc(t)}</option>`).join('')}</select>
            <button class="gami-shop-buy-btn gami-feature-buy gami-gift-send" onclick="_gami_sendGift()">Send gift (100g)</button>
            <div class="gami-gift-result"></div>
        </div>
        <div class="gami-feature gami-pot">
            <div class="gami-feature-title">The pot: <span class="gami-pot-amount">...</span></div>
            <div class="gami-feature-desc gami-pot-desc">When a game with 2 or more players (not guests) ends, the pot may pay out. Everyone in that game gets an equal share.</div>
        </div>
        <div class="gami-feature">
            <div class="gami-feature-title">Badge slot</div>
            <div class="gami-feature-desc">Show one more badge next to your name (in games, the waiting room and the leaderboard).
                You have <b>${slots} / ${max}</b> slots. Pick the badges in Profile > Badges.</div>
            <button class="gami-shop-buy-btn gami-feature-buy" ${full ? 'disabled' : ''} onclick="_gami_buyBadgeSlot()">
                ${full ? 'All slots owned' : `Buy for ${price}g`}</button>
        </div>
        <div class="gami-feature">
            <div class="gami-feature-title">Bounties</div>
            <div class="gami-feature-desc">Put gold on your room: whoever beats you wins it. If you win, everyone gets their gold back.
                Unlock once to start bounties (anyone can add to one that is already up).</div>
            <button class="gami-shop-buy-btn gami-feature-buy" ${bountyOwned ? 'disabled' : ''} onclick="_gami_buyBounty()">
                ${bountyOwned ? 'Unlocked' : `Unlock for ${bountyPrice}g`}</button>
        </div>
        <div class="gami-feature">
            <div class="gami-feature-title">Stream mode</div>
            <div class="gami-feature-desc">Streaming on Twitch? Your chat votes on what the bots do in your games:
                who they go after or help, team-ups and betrayals, and which scrolls they cast. Turn it on with the lobby Stream button.</div>
            <button class="gami-shop-buy-btn gami-feature-buy" ${streamOwned ? 'disabled' : ''} onclick="_gami_buyStream()">
                ${streamOwned ? 'Unlocked' : `Unlock for ${streamPrice}g`}</button>
        </div>
        <div class="gami-feature-gold">You have ${prof.gold ?? 0}g</div>`;
    _gami_fillPot(content);
    _gami_fillGiftNames(content);
}

async function _gami_fillPot(content) {
    const pot = await window.Rewards?.getPot?.();
    const amt = content.querySelector('.gami-pot-amount');
    const desc = content.querySelector('.gami-pot-desc');
    if (!pot || !amt) return;
    amt.textContent = `${pot.amount}g`;
    const pct = Math.round((pot.chance || 0) * 100);
    const state = pot.paid_today ? 'It already paid out today; next chance tomorrow (UTC).'
        : pot.amount < pot.min ? `It can pay out once it holds at least ${pot.min}g.`
        : `Right now that is ${pot.coins} coins, about a ${pct}% chance per game. Pays out once a day.`;
    desc.innerHTML = `When a game with 2 or more players (not guests) ends, the pot drops: every 10g is a coin (at most 70) falling through a board of pegs. Each coin has about a 1 in 100 chance to fall into the treasure. One coin in, and everyone in that game gets an equal share. ${_esc(state)}`;
}

// Suggest friends and recent players (js/social.js) in the name box.
async function _gami_fillGiftNames(content) {
    const list = content.querySelector('#gami-gift-names');
    if (!list) return;
    const names = new Set();
    try {
        const [f, r] = await Promise.all([supabase.rpc('my_friends'), supabase.rpc('my_recent_players')]);
        (f.data || []).forEach(x => x.name && names.add(x.name));
        (r.data || []).forEach(x => x.name && names.add(x.name));
    } catch (e) {}
    list.innerHTML = [...names].filter(n => !/^Guest[A-Z0-9]{6}$/.test(n)).map(n => `<option value="${_esc(n)}">`).join('');
}

async function _gami_sendGift() {
    const content = document.getElementById('gami-content');
    const R = window.Rewards;
    if (!content || !R) return;
    const name = content.querySelector('.gami-gift-name').value.trim();
    const phrase = parseInt(content.querySelector('.gami-gift-phrase').value, 10) || 0;
    const out = content.querySelector('.gami-gift-result');
    if (!name) { out.textContent = 'Type a player name first.'; return; }
    if (!window.confirm(`Send a gift to ${name} for 100g?`)) return;
    const btn = content.querySelector('.gami-gift-send');
    btn.disabled = true;
    const res = await R.sendGift(name, phrase);
    btn.disabled = false;
    if (!res.ok) { out.textContent = res.msg; return; }
    _renderFeatures(content);
    const out2 = content.querySelector('.gami-gift-result');
    if (out2) out2.textContent = `Sent! ${res.to} got ${res.received}g, and ${res.toPot}g went into the pot.`;
    window.gami?.notify(`Gift sent to ${res.to}`, 0, 'gold');
}

async function _gami_buyBadgeSlot() {
    const R = window.Rewards;
    if (!R) return;
    const res = await R.buySlot();
    window.gami?.notify(res.ok ? 'New badge slot! Pick a badge in Profile > Badges.' : res.msg, 0, 'gold');
    const content = document.getElementById('gami-content');
    if (content) _renderFeatures(content);
}

async function _gami_buyBounty() {
    const PB = window.PlayerBounty;
    if (!PB) return;
    if (!window.confirm(`Unlock bounties for ${PB.PRICE}g?`)) return;
    const res = await PB.buy();
    window.gami?.notify(res.ok ? 'Bounties unlocked! Start one from any waiting room.' : res.msg, 0, 'gold');
    const content = document.getElementById('gami-content');
    if (content) _renderFeatures(content);
}

async function _gami_buyStream() {
    const SV = window.StreamVotes;
    if (!SV) return;
    if (!window.confirm(`Unlock Stream mode for ${SV.PRICE}g?`)) return;
    const res = await SV.buy();
    window.gami?.notify(res.ok ? 'Stream mode unlocked! Turn it on with the Stream button in the lobby.' : res.msg, 0, 'gold');
    const content = document.getElementById('gami-content');
    if (content) _renderFeatures(content);
}

// ── Train Bot (public) ───────────────────────────────────────
// Replaces the old Shop / Stable / capture economy. Any logged-in player
// can open the Bot Training panel from the auth bar and try to improve the
// single shared community bot brain (Supabase `bot_champion_weights`). A
// run that produces a brain which beats the current champion in the
// confirmation series is submitted for everyone and pays 25 gold — see
// runHillClimbTraining() in js/game-ui.js.
function _gami_openTrainBot() {
    if (!window.gami?.userId) { window.gami?.notify('Log in to train the community bot.', 0, 'gold'); return; }
    if (typeof isMultiplayer !== 'undefined' && isMultiplayer) { window.gami?.notify('Leave your online game first - training runs locally.', 0, 'gold'); return; }
    // bot-arena.js is lazy-loaded (js/asset-preloader.js § Lazy scripts).
    if (!window.BotArena && window.LazyScripts) {
        window.LazyScripts.load('bot-arena').then(_gami_openTrainBot,
            () => window.gami?.notify('Bot training is not available right now.', 0, 'gold'));
        return;
    }
    if (!window.BotArena) { window.gami?.notify('Bot training is not available right now.', 0, 'gold'); return; }
    if (window.BotArena.isRunning()) { window.gami?.notify('A bot job is already running - stop it first.', 0, 'gold'); return; }
    if (typeof window._openBotTrainingPanel !== 'function') { window.gami?.notify('Bot training is not available right now.', 0, 'gold'); return; }
    window._botTrainingPublic = true;
    document.getElementById('gami-panel')?.remove();
    window._openBotTrainingPanel();
}

// ── Stable tab (removed with the personal-bot economy) ───────

// ── Leaderboard tab ──────────────────────────────────────────

// Two SEPARATE sections (Players by XP, Bots by win rate), not one
// interleaved list — bots have no XP, only a win/loss/draw record, so
// there's no shared unit to sort them against players without inventing a
// conversion factor. docs/bot-tycoon-proposal.md build-order step 3;
// choice confirmed with the user rather than assumed.

// Fetch the unified positional ladder (players AND bots, one ranked list —
// design 2026-07-23) and resolve display names. The bots are the five fixed
// elemental bots (system-owned, owner = NULL — js/bot-elements.js); benched
// rows keep their rank but are filtered from display.
async function _gami_fetchLadder(limit) {
    const { data: rows, error } = await supabase.from('ladder')
        .select('rank, entity_type, user_id, bot_id')
        .order('rank', { ascending: true }).limit(limit || 20);
    if (error || !rows?.length) return [];
    const userIds = [...new Set(rows.filter(r => r.entity_type === 'player').map(r => r.user_id))];
    const botIds = rows.filter(r => r.entity_type === 'bot').map(r => r.bot_id);
    const [profRes, botRes] = await Promise.all([
        userIds.length ? supabase.from('user_profiles').select('user_id, display_name, name_color, shown_badges').in('user_id', userIds) : Promise.resolve({ data: [] }),
        botIds.length ? supabase.from('deployed_bots').select('id, nickname, owner, is_active').in('id', botIds) : Promise.resolve({ data: [] }),
    ]);
    const profs = new Map((profRes.data || []).map(p => [p.user_id, p]));
    if ((profRes.data || []).some(p => p.shown_badges?.length)) await window.Rewards?.loadCatalog?.();
    const bots = new Map((botRes.data || []).map(b => [b.id, b]));
    const ownerIds = [...new Set((botRes.data || []).map(b => b.owner).filter(Boolean))];
    let owners = new Map();
    if (ownerIds.length) {
        const { data: o } = await supabase.from('user_profiles').select('user_id, display_name').in('user_id', ownerIds);
        owners = new Map((o || []).map(x => [x.user_id, x.display_name]));
    }
    const me = window.gami?.userId || null;
    return rows.map(r => {
        if (r.entity_type === 'bot') {
            const b = bots.get(r.bot_id);
            if (!b) return null;
            // Elemental bots are system-owned (owner === null). A leftover
            // personally-owned row (pre-rework) still renders "bot by <owner>".
            const isElemental = b.owner == null;
            return {
                rank: r.rank, isBot: true, isElemental,
                isMe: !isElemental && b.owner === me,
                name: b.nickname,
                ownerName: isElemental ? null : (owners.get(b.owner) || 'Unknown'),
                botId: b.id, active: b.is_active,
            };
        }
        const prof = profs.get(r.user_id);
        return { rank: r.rank, isBot: false, isMe: r.user_id === me, userId: r.user_id, name: prof?.display_name || 'Unknown',
                 nameColor: prof?.name_color || null, badges: prof?.shown_badges || [], active: true };
    }).filter(Boolean);
}

function _gami_ladderRowsHTML(rows, hideBots) {
    const shown = rows.filter(r => r.active && (!hideBots || !r.isBot));
    if (!shown.length) return '<div class="gami-loading">No ranked entrants yet.</div>';
    // Light "reigning champion" framing: the top VISIBLE elemental bot.
    const champBotId = (shown.find(r => r.isElemental) || {}).botId;
    return shown.map(r => {
        let tag = '';
        if (r.isBot) {
            const label = r.isElemental
                ? (r.botId === champBotId ? 'elemental bot · champion' : 'elemental bot')
                : `bot by ${_esc(r.ownerName)}`;
            tag = ` <span style="font-size:11px;color:var(--pp-ink-soft);font-weight:normal;">${label}</span>`;
        }
        return `
        <div class="gami-lb-row ${r.isMe ? 'gami-lb-me' : ''}"${r.isBot ? ` style="cursor:pointer;" title="View this bot's elemental attributes" onclick="_gami_showBotPetals(${r.botId})"` : ''}>
            <span class="gami-lb-rank">#${r.rank}</span>
            <span class="gami-lb-name"><span${!r.isBot && r.userId ? ` class="player-card-link" data-player-card="${_esc(r.userId)}" title="View player"` : ''} style="${r.nameColor ? (window.cosmeticsSystem?.getNameColorStyle(r.nameColor) || '') : ''}">${_esc(r.name)}</span>${r.badges?.length ? (window.Rewards?.badgesHtml(r.badges) || '') : ''}${tag}</span>
        </div>`;
    }).join('');
}

async function _renderLeaderboard(content) {
    content.innerHTML = '<div class="gami-loading">Loading…</div>';
    // Join the ladder on first view (idempotent server-side) so new players
    // enter at the bottom, per the design.
    if (window.gami?.userId) {
        try { await supabase.rpc('ladder_ensure_player', { p_user: window.gami.userId }); } catch (e) {}
    }
    const ladderRows = await _gami_fetchLadder(25);
    const hideBots = localStorage.getItem('godaigo_hide_bots') === '1';

    content.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
            <span class="section-label" style="margin:0;">Ladder</span>
            <label style="font-size:11px;color:var(--pp-ink-soft);cursor:pointer;user-select:none;">
                <input type="checkbox" id="gami-hide-bots"${hideBots ? ' checked' : ''}> Hide bots
            </label>
        </div>
        <div class="gami-leaderboard">${_gami_ladderRowsHTML(ladderRows, hideBots)}</div>
        <div style="font-size:10px;color:var(--pp-ink-soft);margin-top:6px;">Players and the five elemental bots share one ladder. Beat someone ranked above you in a real game and take their spot.</div>
    `;
    const hideToggle = document.getElementById('gami-hide-bots');
    if (hideToggle) hideToggle.onchange = () => {
        try { localStorage.setItem('godaigo_hide_bots', hideToggle.checked ? '1' : '0'); } catch (e) {}
        gami_switchTab('leaderboard');
    };
}

// ── The Void Knight: challenge & train (removed) ──────────────
// The Void Knight is now simply the void-element member of the five-bot
// elemental roster (js/bot-elements.js). The dethrone-for-gold bounty and
// the leader-mode training entry point were removed with the personal-bot
// economy — training now runs through the public "Train Bot" button
// (_gami_openTrainBot above) against the single shared community champion.
// ── Bot detail: the five-element "petals" view ────────────────
// Each bot's personality shown as five petals — one per element — scored by
// how far its weights deviate from stock DEFAULT_WEIGHTS along the
// per-element weight-key directions. Purely descriptive (a lens on the
// weight table); 50 = stock, higher = leans into that element's
// personality. The direction maps now live in js/bot-elements.js
// (BotElements.LEAN) — this is a thin adapter to the shape the scoring
// code below already expects ({ color, keys }).
const GAMI_PETAL_BUNDLES = (function () {
    const BE = window.BotElements;
    const els = BE ? BE.ELEMENTS : ['earth', 'water', 'fire', 'wind', 'void'];
    const out = {};
    els.forEach(function (el) {
        out[el] = { color: (BE && BE.PETAL_COLORS[el]) || '#888', keys: (BE && BE.LEAN[el]) || {} };
    });
    return out;
})();

function _gami_petalScores(weights) {
    const defaults = window.BotSystem?.DEFAULT_WEIGHTS || {};
    const scores = {};
    for (const [el, bundle] of Object.entries(GAMI_PETAL_BUNDLES)) {
        let sum = 0, n = 0;
        for (const [k, dir] of Object.entries(bundle.keys)) {
            if (typeof weights?.[k] !== 'number' || typeof defaults[k] !== 'number') continue;
            const rel = (weights[k] - defaults[k]) / (Math.abs(defaults[k]) || 1);
            sum += dir * rel; n++;
        }
        // 0.5 = stock; tanh squash keeps wildly-mutated tables on the dial
        scores[el] = n ? Math.min(1, Math.max(0, 0.5 + 0.5 * Math.tanh((sum / n) * 1.5))) : 0.5;
    }
    return scores;
}

async function _gami_showBotPetals(botId) {
    // deployed_bots is public-select — fetch the row directly.
    const { data } = await supabase.from('deployed_bots')
        .select('id, nickname, weights, wins, losses, draws, is_active, owner')
        .eq('id', botId).limit(1);
    const bot = data?.[0];
    if (!bot) { window.gami?.notify('Could not find that bot - try refreshing.', 0, 'gold'); return; }
    document.getElementById('gami-petals-overlay')?.remove();

    // For an elemental bot (system-owned) the stored weights are only a
    // stale display snapshot — show the LIVE lean off the current champion
    // so the petals stay honest as training moves the shared brain.
    let petalWeights = bot.weights || {};
    const el = (window.BotElements && bot.owner == null) ? window.BotElements.elementForId(bot.id) : null;
    if (el && window.BotElements) {
        petalWeights = window.BotElements.elementalOverlay(
            (window.BotSystem && window.BotSystem.WEIGHTS) || window.BotElements.baseBrain(), el);
    }
    const scores = _gami_petalScores(petalWeights);
    const order = ['earth', 'water', 'fire', 'wind', 'void'];
    const cx = 110, cy = 112, rMax = 82;
    const petals = order.map((el, i) => {
        const angle = -90 + i * 72 + 90; // earth at the top, clockwise
        const len = 18 + scores[el] * (rMax - 18);
        const c = GAMI_PETAL_BUNDLES[el].color;
        return `<g transform="rotate(${angle} ${cx} ${cy})">
            <ellipse cx="${cx}" cy="${cy - len / 2}" rx="15" ry="${len / 2}" fill="${c}" fill-opacity="0.5" stroke="${c}" stroke-width="1.5"/>
        </g>`;
    }).join('');
    const labels = order.map((el, i) => {
        const a = (-90 + i * 72 + 90) * Math.PI / 180;
        const lx = cx + Math.sin(a) * (rMax + 16);
        const ly = cy - Math.cos(a) * (rMax + 16);
        return `<text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" fill="${GAMI_PETAL_BUNDLES[el].color}" font-size="10" font-weight="bold" text-anchor="middle" dominant-baseline="middle">${el.toUpperCase()} ${(scores[el] * 100).toFixed(0)}</text>`;
    }).join('');

    const decided = bot.wins + bot.losses;
    const pct = decided ? Math.round((bot.wins / decided) * 100) : 0;
    const overlay = document.createElement('div');
    overlay.id = 'gami-petals-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.65);z-index:10001;display:flex;align-items:center;justify-content:center;';
    overlay.innerHTML = `
        <div style="background:#1a1a2e;border:1px solid #444;border-radius:10px;padding:16px 20px;max-width:320px;text-align:center;box-shadow:0 8px 32px rgba(0,0,0,0.7);">
            <div style="font-weight:bold;color:var(--pp-ink);font-size:14px;margin-bottom:2px;">${_esc(bot.nickname)}</div>
            <div style="font-size:11px;color:var(--pp-ink-soft);margin-bottom:6px;">${bot.wins}-${bot.losses}${bot.draws ? `-${bot.draws}` : ''} (${pct}%) · ${bot.is_active ? 'Active on the leaderboard' : 'Benched'}</div>
            <svg viewBox="0 0 220 224" width="240" height="244" xmlns="http://www.w3.org/2000/svg">
                <circle cx="${cx}" cy="${cy}" r="${rMax}" fill="none" stroke="#333" stroke-dasharray="3 3"/>
                ${petals}
                <circle cx="${cx}" cy="${cy}" r="10" fill="#1a1a2e" stroke="#666"/>
                ${labels}
            </svg>
            <div style="font-size:10px;color:var(--pp-ink-soft);margin-top:4px;">50 = stock weights. Petals show how this bot's tuning leans across the five elements.</div>
            <button class="gami-stable-btn" style="margin-top:10px;" onclick="document.getElementById('gami-petals-overlay').remove()">Close</button>
        </div>`;
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);
}

// ── Main-page leaderboard widget ──────────────────────────────

async function loadMainLeaderboard() {
    const el = document.getElementById('main-leaderboard-body');
    if (!el) return;
    el.innerHTML = '<div class="gami-loading">Loading…</div>';

    // The unified positional ladder (players + bots, one ranked list) is THE
    // leaderboard now — XP lives on in the profile Stats tab (design
    // 2026-07-23). Benched bots and (optionally) all bots are filtered from
    // display; rank numbers are the stored ladder positions, so gaps are real.
    const hideBots = localStorage.getItem('godaigo_hide_bots') === '1';
    const rows = await _gami_fetchLadder(30);
    const shown = rows.filter(r => r.active && (!hideBots || !r.isBot)).slice(0, 10);
    if (!shown.length) {
        el.innerHTML = '<div class="gami-loading" style="padding:12px;">No ranked entrants yet.</div>';
        return;
    }
    el.innerHTML = _gami_ladderRowsHTML(shown, hideBots);
}

window.loadMainLeaderboard = loadMainLeaderboard;

// ── Profile modal action helpers (called from onclick) ────────

async function _gami_cosmeticsBuy(id) {
    await window.cosmeticsSystem.handleBuy(id);
    gami_switchTab('cosmetics');
}

async function _gami_cosmeticsEquip(id) {
    await window.cosmeticsSystem.handleEquip(id);
    gami_switchTab('cosmetics');
}

function _gami_emojisUse(id) {
    window.emojiSystem.useEmoji(id);
    document.getElementById('gami-panel')?.remove();
}

async function _gami_emojisBuy(id) {
    await window.emojiSystem.purchaseEmoji(id);
    gami_switchTab('emojis');
}

// ── Settings tab ─────────────────────────────────────────────
// Renders as a category MENU (Display / Audio / Controls) that opens into a
// sub-panel per category — mirrors the Paper UI pack's own Pause/Settings
// reference layout (see css/paper-ui-profile.css) rather than one long
// scrolling list. _gamiSettingsCategory is module state, reset to the menu
// every time the Settings tab is (re)opened; navigating between the menu
// and a sub-panel re-renders in place without resetting it.
let _gamiSettingsCategory = null;

function _renderSettings(content) {
    _gamiSettingsCategory = null;
    _renderSettingsView(content);
}

function _gami_setSettingsCategory(cat) {
    _gamiSettingsCategory = cat;
    _renderSettingsView(document.getElementById('gami-content'));
}

function _gami_backToSettingsMenu() {
    _gamiSettingsCategory = null;
    _renderSettingsView(document.getElementById('gami-content'));
}

function _renderSettingsView(content) {
    const uiSound   = localStorage.getItem('godaigo_ui_sound')   !== 'false';
    const gameSound = localStorage.getItem('godaigo_game_sound') !== 'false';
    const music     = localStorage.getItem('godaigo_music')       !== 'false';
    const joytoneMuted = window.JoytoneBridge ? window.JoytoneBridge.isMuted()
                                              : localStorage.getItem('godaigo_joytone_muted') === 'true';
    const joytoneVol   = Math.round((window.JoytoneBridge ? window.JoytoneBridge.getVolume() : 1) * 100);
    const crt = window.crtOverlay ? window.crtOverlay.getOptions()
                                  : { scanlines: true, vignette: true, grain: true, flicker: true };

    const audioHtml = `
        <div class="gami-settings-row">
            <div class="gami-settings-label">
                <div class="gami-settings-name">UI Sounds</div>
                <div class="gami-settings-desc">Button click sound effects</div>
            </div>
            <button class="gami-toggle ${uiSound ? 'on' : 'off'}"
                    onclick="_gami_toggleSetting('ui_sound', this)">${uiSound ? 'ON' : 'OFF'}</button>
        </div>
        <div class="gami-settings-row">
            <div class="gami-settings-label">
                <div class="gami-settings-name">Game Sounds</div>
                <div class="gami-settings-desc">In-game audio effects</div>
            </div>
            <button class="gami-toggle ${gameSound ? 'on' : 'off'}"
                    onclick="_gami_toggleSetting('game_sound', this)">${gameSound ? 'ON' : 'OFF'}</button>
        </div>
        <div class="gami-settings-row">
            <div class="gami-settings-label">
                <div class="gami-settings-name">Music</div>
                <div class="gami-settings-desc">Login screen background music</div>
            </div>
            <button class="gami-toggle ${music ? 'on' : 'off'}"
                    onclick="_gami_toggleSetting('music', this)">${music ? 'ON' : 'OFF'}</button>
        </div>
        <div class="gami-settings-row">
            <div class="gami-settings-label">
                <div class="gami-settings-name">Adaptive Music</div>
                <div class="gami-settings-desc">In-game Joytone soundtrack (grows as tiles flip) - only affects you</div>
            </div>
            <button class="gami-toggle ${joytoneMuted ? 'off' : 'on'}"
                    onclick="_gami_toggleJoytoneMute(this)">${joytoneMuted ? 'OFF' : 'ON'}</button>
        </div>
        <div class="gami-settings-row">
            <div class="gami-settings-label">
                <div class="gami-settings-name">Adaptive Music Volume</div>
                <div class="gami-settings-desc">Your personal volume for the Joytone soundtrack</div>
            </div>
            <input type="range" min="0" max="100" step="1" value="${joytoneVol}"
                   class="gami-pip-range"
                   oninput="_gami_joytoneVolume(this)">
        </div>
    `;

    const pieces3d = window.Piece3D ? window.Piece3D.isOn() : true;
    const displayHtml = `
        <div class="gami-settings-row">
            <div class="gami-settings-label">
                <div class="gami-settings-name">3D Pieces</div>
                <div class="gami-settings-desc">Pawns and stones look like thick pucks</div>
            </div>
            <button class="gami-toggle ${pieces3d ? 'on' : 'off'}"
                    onclick="window.Piece3D?.toggle(this)">${pieces3d ? 'ON' : 'OFF'}</button>
        </div>
        <div class="gami-settings-row">
            <div class="gami-settings-label">
                <div class="gami-settings-name">Scanlines</div>
                <div class="gami-settings-desc">Horizontal CRT scan-line overlay</div>
            </div>
            <button class="gami-toggle ${crt.scanlines ? 'on' : 'off'}"
                    onclick="_gami_toggleCrt('scanlines', this)">${crt.scanlines ? 'ON' : 'OFF'}</button>
        </div>
        <div class="gami-settings-row">
            <div class="gami-settings-label">
                <div class="gami-settings-name">Vignette</div>
                <div class="gami-settings-desc">Dark edges around the screen</div>
            </div>
            <button class="gami-toggle ${crt.vignette ? 'on' : 'off'}"
                    onclick="_gami_toggleCrt('vignette', this)">${crt.vignette ? 'ON' : 'OFF'}</button>
        </div>
        <div class="gami-settings-row">
            <div class="gami-settings-label">
                <div class="gami-settings-name">Film Grain</div>
                <div class="gami-settings-desc">Animated noise texture</div>
            </div>
            <button class="gami-toggle ${crt.grain ? 'on' : 'off'}"
                    onclick="_gami_toggleCrt('grain', this)">${crt.grain ? 'ON' : 'OFF'}</button>
        </div>
        <div class="gami-settings-row">
            <div class="gami-settings-label">
                <div class="gami-settings-name">Flicker</div>
                <div class="gami-settings-desc">Subtle screen brightness variation</div>
            </div>
            <button class="gami-toggle ${crt.flicker ? 'on' : 'off'}"
                    onclick="_gami_toggleCrt('flicker', this)">${crt.flicker ? 'ON' : 'OFF'}</button>
        </div>
    `;

    const logConsent = localStorage.getItem('godaigo_log_consent') === 'granted';
    const privacyHtml = `
        <div class="gami-settings-row">
            <div class="gami-settings-label">
                <div class="gami-settings-name">Share Game Logs</div>
                <div class="gami-settings-desc">Log this session's gameplay to help improve the game. In multiplayer, only the host's setting matters.</div>
            </div>
            <button class="gami-toggle ${logConsent ? 'on' : 'off'}"
                    onclick="_gami_toggleLogConsent(this)">${logConsent ? 'ON' : 'OFF'}</button>
        </div>
    `;

    const controlsHtml = `
        <div class="gami-keybind-guide">
            <div class="gami-keybind-group">
                <div class="gami-keybind-group-title">Board Actions</div>
                <div class="gami-keybind-row"><kbd>X</kbd><span>End turn</span></div>
                <div class="gami-keybind-row"><kbd>Enter</kbd><span>Place tile or move pawn (start / confirm)</span></div>
                <div class="gami-keybind-row"><kbd>1</kbd><span>Void stone preview</span></div>
                <div class="gami-keybind-row"><kbd>2</kbd><span>Wind stone preview</span></div>
                <div class="gami-keybind-row"><kbd>3</kbd><span>Fire stone preview</span></div>
                <div class="gami-keybind-row"><kbd>4</kbd><span>Water stone preview</span></div>
                <div class="gami-keybind-row"><kbd>5</kbd><span>Earth stone preview</span></div>
                <div class="gami-keybind-row"><kbd>T</kbd><span>Catacomb teleport preview (T again to confirm)</span></div>
                <div class="gami-keybind-row"><kbd>← →</kbd><span>Cycle positions or scroll cards</span></div>
                <div class="gami-keybind-row"><kbd>Esc</kbd><span>Cancel any active preview or navigation</span></div>
            </div>
            <div class="gami-keybind-group">
                <div class="gami-keybind-group-title">Panel Toggles</div>
                <div class="gami-keybind-row"><kbd>H</kbd><span>Toggle Hand panel</span></div>
                <div class="gami-keybind-row"><kbd>A</kbd><span>Toggle Active panel</span></div>
                <div class="gami-keybind-row"><kbd>C</kbd><span>Toggle Common panel</span></div>
                <div class="gami-keybind-row"><kbd>Shift+J+T</kbd><span>Toggle Joytone music sequencer</span></div>
            </div>
            <div class="gami-keybind-group">
                <div class="gami-keybind-group-title">Scroll Navigation</div>
                <div class="gami-keybind-row"><kbd>Q</kbd><span>Navigate Hand scrolls</span></div>
                <div class="gami-keybind-row"><kbd>W</kbd><span>Navigate Active scrolls</span></div>
                <div class="gami-keybind-row"><kbd>E</kbd><span>Navigate Common scrolls</span></div>
                <div class="gami-keybind-row"><kbd>← →</kbd><span>Cycle cards while in nav mode</span></div>
                <div class="gami-keybind-row"><kbd>Enter</kbd><span>Move Hand card → Active</span></div>
                <div class="gami-keybind-row"><kbd>Tab</kbd><span>Move card → Common Area</span></div>
                <div class="gami-keybind-row"><kbd>Space</kbd><span>Activate selected scroll</span></div>
                <div class="gami-keybind-row"><kbd>Esc</kbd><span>Exit navigation</span></div>
            </div>
        </div>
    `;

    if (!_gamiSettingsCategory) {
        content.innerHTML = `
            <div class="gami-settings-list gami-settings-menu">
                <div class="pp-flanked-label"><span>Settings</span></div>
                <div class="gami-settings-row gami-lang-row">
                    <div class="gami-settings-label">
                        <div class="gami-settings-name">Language</div>
                        <div class="gami-settings-desc">Choose the game language</div>
                    </div>
                    ${window.I18n ? I18n.pickerHtml() : ''}
                </div>
                <button class="pp-menu-btn" onclick="_gami_setSettingsCategory('display')">Display</button>
                <button class="pp-menu-btn" onclick="_gami_setSettingsCategory('audio')">Audio</button>
                <button class="pp-menu-btn" onclick="_gami_setSettingsCategory('controls')">Controls</button>
                <button class="pp-menu-btn" onclick="_gami_setSettingsCategory('privacy')">Privacy</button>
                <button class="pp-menu-btn" onclick="_gami_setSettingsCategory('account')">Account</button>
            </div>
        `;
        return;
    }

    // Account is filled in async by js/account-recovery.js (recovery email).
    const accountHtml = '<div id="acct-settings-slot"></div>';
    const titles = { display: 'Display', audio: 'Audio', controls: 'Controls', privacy: 'Privacy', account: 'Account' };
    const bodies  = { display: displayHtml, audio: audioHtml, controls: controlsHtml, privacy: privacyHtml, account: accountHtml };
    content.innerHTML = `
        <div class="gami-settings-list gami-settings-detail">
            <div class="pp-flanked-label pp-flanked-label--back">
                <button class="pp-back-btn" onclick="_gami_backToSettingsMenu()" aria-label="Back to Settings menu"></button>
                <span>${titles[_gamiSettingsCategory]}</span>
            </div>
            ${bodies[_gamiSettingsCategory]}
        </div>
    `;
    if (_gamiSettingsCategory === 'account') {
        window.AccountRecovery?.renderSettings(document.getElementById('acct-settings-slot'));
    }
}

function _gami_toggleCrt(key, btn) {
    if (!window.crtOverlay) return;
    const newVal = !window.crtOverlay.getOptions()[key];
    window.crtOverlay.setOption(key, newVal);
    window.crtOverlay.saveForUser(window.gami?.userId || null);
    btn.textContent = newVal ? 'ON' : 'OFF';
    btn.className   = `gami-toggle ${newVal ? 'on' : 'off'}`;
}

function _gami_toggleJoytoneMute(btn) {
    const newMuted = !window.JoytoneBridge?.isMuted();
    window.JoytoneBridge?.setMuted(newMuted);
    btn.textContent = newMuted ? 'OFF' : 'ON';
    btn.className   = `gami-toggle ${newMuted ? 'off' : 'on'}`;
}

// Called by joytone-bridge.js when the Joytone popup's OWN ⏻ power button
// changes state, so this toggle reflects it even though the click didn't
// come from here. No-op if the Settings tab (or a different tab within it)
// isn't currently open — there's nothing to repaint.
window._gami_refreshJoytoneToggle = function () {
    const btn = document.querySelector('#gami-panel [onclick^="_gami_toggleJoytoneMute"]');
    if (!btn) return;
    const m = window.JoytoneBridge?.isMuted();
    btn.textContent = m ? 'OFF' : 'ON';
    btn.className   = `gami-toggle ${m ? 'off' : 'on'}`;
};

function _gami_joytoneVolume(input) {
    window.JoytoneBridge?.setVolume((+input.value || 0) / 100);
}

// Not built on _gami_toggleSetting: that helper's "unset means ON" default
// is wrong here — this flag must default to declined/OFF until the player
// actually answers the consent prompt (js/lobby.js). Goes through
// window.setLogConsent so the prompt and this toggle share one write path.
function _gami_toggleLogConsent(btn) {
    const current = localStorage.getItem('godaigo_log_consent') === 'granted';
    const newVal  = !current;
    if (typeof window.setLogConsent === 'function') {
        window.setLogConsent(newVal ? 'granted' : 'declined');
    } else {
        localStorage.setItem('godaigo_log_consent', newVal ? 'granted' : 'declined');
    }
    btn.textContent = newVal ? 'ON' : 'OFF';
    btn.className   = `gami-toggle ${newVal ? 'on' : 'off'}`;
}

function _gami_toggleSetting(key, btn) {
    const current = localStorage.getItem(`godaigo_${key}`) !== 'false';
    const newVal  = !current;
    localStorage.setItem(`godaigo_${key}`, newVal ? 'true' : 'false');
    if (key === 'ui_sound')   window.uiSoundEnabled   = newVal;
    if (key === 'game_sound') window.gameSoundEnabled = newVal;
    if (key === 'music') {
        window.musicEnabled = newVal;
        if (!newVal) {
            window.SoundSystem?.fadeOutLoginMusic();
        } else {
            // Only restart if currently on the lobby/login screen
            const lw = document.getElementById('lobby-wrapper');
            if (lw && lw.style.display !== 'none') {
                window.SoundSystem?.startLoginMusic();
            }
        }
    }
    btn.textContent = newVal ? 'ON' : 'OFF';
    btn.className   = `gami-toggle ${newVal ? 'on' : 'off'}`;
}

// ── Utility ───────────────────────────────────────────────────

function _esc(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
