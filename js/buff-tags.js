// Buff tags + teleport-marker refresh (owner 2026-10-09).
//
// 1) Buff tags: a row of small tags under the top bar shows every active
//    scroll buff to all players: owner colour, scroll name, how long it lasts,
//    and the scroll's text on hover. Read from spellSystem.scrollEffects.activeBuffs
//    every 400 ms; nothing in the game calls this file.
// 2) Teleport markers: game-ui.js updateCatacombIndicators() used to run only
//    when the pawn moved or a buff was cast, so a buff that started at the top
//    of a turn (Freedom stolen with Psychic runs then) showed no shrine markers
//    until the pawn was picked up and put back. The same watcher redraws the
//    markers whenever the turn, the teleport buffs, the "can act" state or the
//    active pawn's spot changes.
(function () {
    'use strict';

    // buff key -> scroll name (as in scroll-effects.js). Keys not listed are
    // internal (suppressVoidAPSync, excavateTeleport, excavateNoResponse, ...).
    const BUFFS = {
        earthExtendedPlacement: 'Shifting Sands',
        globalPlacement: 'Avalanche',
        controlTheCurrent: 'Control the Current',
        burningMotivation: 'Burning Motivation',
        breathOfPower: 'Breath of Power',
        respirateWind: 'Respirate',
        freedom: 'Freedom',
        simplify: 'Simplify',
        mine: 'Mine',
        callToAdventure: 'Call to Adventure',
        steamVents: 'Steam Vents',
        waterWindGlobalPlacement: 'Seed the Skies',
        reflectingPool: 'Reflecting Pool',
        mudslide: 'Mudslide',
        excavate: 'Excavate',
        quickReflexes: 'Quick Reflexes',
    };
    let byName = null;          // scroll name -> { id, description }
    function scrollInfo(name) {
        if (!byName) {
            byName = {};
            const fx = window.spellSystem?.scrollEffects?.effects || {};
            for (const id in fx) if (fx[id]?.name) byName[fx[id].name] = { id, description: fx[id].description || '' };
        }
        return byName[name] || { id: null, description: '' };
    }
    function inGame() {
        return !!document.getElementById('game-layout')?.classList.contains('active');
    }
    function ownerColor(i) {
        try {
            const p = (typeof allPlayersData !== 'undefined' ? allPlayersData : []).find(q => q.player_index === i);
            if (p && typeof PLAYER_COLORS !== 'undefined' && PLAYER_COLORS[p.color]) return PLAYER_COLORS[p.color];
            const pos = (typeof playerPositions !== 'undefined') ? playerPositions[i] : null;
            if (pos?.color) return pos.color;
        } catch (e) {}
        return '#bbb';
    }
    function ownerName(i) {
        try {
            if (typeof getPlayerColorName === 'function') return getPlayerColorName(i);
        } catch (e) {}
        return `Player ${i + 1}`;
    }

    function collect() {
        const out = [];
        const ab = window.spellSystem?.scrollEffects?.activeBuffs;
        if (!ab) return out;
        for (const key in BUFFS) {
            const b = ab[key];
            if (!b || typeof b !== 'object' || b.playerIndex == null) continue;
            let when = b.expiresNextTurn || key === 'freedom' || key === 'excavate' || key === 'quickReflexes'
                ? 'until their next turn' : 'this turn';
            let extra = '';
            if (key === 'burningMotivation' && b.stacks > 1) extra = ` x${b.stacks}`;
            if (key === 'mine' && b.shrineType) extra = ` (${b.shrineType})`;
            out.push({ key, name: BUFFS[key], extra, owner: b.playerIndex, when });
        }
        // scrolls a Psychic took, cast at the start of the thief's next turn
        if (Array.isArray(ab.psychicPending)) {
            ab.psychicPending.forEach(p => {
                if (p?.playerIndex == null) return;
                const def = window.spellSystem?.patterns?.[p.scrollName];
                out.push({ key: 'psychic', name: 'Psychic', extra: def?.name ? `: ${def.name}` : '', owner: p.playerIndex,
                           when: 'at the start of their turn', desc: 'This stolen scroll is cast at the start of their next turn.' });
            });
        }
        return out;
    }

    let box = null, lastSig = '';
    function render() {
        const list = inGame() ? collect() : [];
        const sig = JSON.stringify(list);
        if (sig === lastSig) return;
        lastSig = sig;
        if (!list.length) { if (box) box.style.display = 'none'; return; }
        if (!box) {
            box = document.createElement('div');
            box.id = 'buff-tags';
            document.body.appendChild(box);
        }
        box.style.display = '';
        box.innerHTML = '';
        list.forEach(t => {
            const info = scrollInfo(t.name);
            const look = info.id && window.ScrollLook ? window.ScrollLook.colors(info.id)[0] : null;
            const tag = document.createElement('div');
            tag.className = 'buff-tag';
            if (look) tag.style.setProperty('--buff-color', look);
            const who = ownerName(t.owner);
            tag.title = `${who}: ${t.name}${t.extra} (${t.when})\n${t.desc || info.description}`;
            const dot = document.createElement('span');
            dot.className = 'buff-tag-dot';
            dot.style.background = ownerColor(t.owner);
            const name = document.createElement('span');
            name.className = 'buff-tag-name';
            name.textContent = t.name + t.extra;
            const when = document.createElement('span');
            when.className = 'buff-tag-when';
            when.textContent = t.when === 'this turn' ? 'this turn' : (t.key === 'psychic' ? 'next turn' : 'until next turn');
            tag.append(dot, name, when);
            box.appendChild(tag);
        });
    }

    // teleport markers: redraw when anything they depend on changes
    let lastTpKey = '';
    function refreshTeleportMarkers() {
        if (!inGame() || typeof window.updateCatacombIndicators !== 'function') return;
        let key = '';
        try {
            const ab = window.spellSystem?.scrollEffects?.activeBuffs || {};
            const pos = (typeof playerPositions !== 'undefined') ? playerPositions[activePlayerIndex] : null;
            const can = typeof canTakeAction === 'function' ? canTakeAction() : true;
            key = [activePlayerIndex, typeof currentTurnNumber !== 'undefined' ? currentTurnNumber : '',
                   ab.freedom?.playerIndex ?? '', ab.excavateTeleport?.playerIndex ?? '', can,
                   pos ? Math.round(pos.x) + ',' + Math.round(pos.y) : ''].join('|');
        } catch (e) { return; }
        if (key === lastTpKey) return;
        lastTpKey = key;
        try { window.updateCatacombIndicators(); } catch (e) {}
    }

    setInterval(() => { render(); refreshTeleportMarkers(); }, 400);
    window.BuffTags = { refresh: () => { lastSig = ''; render(); } };
})();
