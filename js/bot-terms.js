// bot-terms.js: window.BotTerms, "formula terms" for the bot brain.
//
// The bot scores a position with a fixed list of measurements times weights
// (bot.js evaluateSnapshot). A term adds a NEW measurement built from safe
// building blocks: a small formula over public game facts, times a weight.
//
//   { text: '(leaderActivated - myActivated) * distHome', w: 2.5,
//     note: 'hurry home when behind', src: 'claude' }
//
// Terms live in a weight table as `terms: [...]` (plain data, never code),
// so they travel with the champion in bot_champion_weights. Older game
// versions just ignore the key. Training can add, remove and change terms
// (mutateTerms); the hermit's Formula Lab (game-ui.js) feeds in hand-written
// or Claude-suggested ones.
//
// Safety: a formula can only use the INPUTS below (public information about
// the board, never another player's hand or the deck) and the operators
// + - * / min max gt lt abs. No loops, no calls, no strings. Limits: 8 terms
// per table, 25 nodes and 200 characters per formula, each term's value is
// clamped to +-10000. A bad formula is ignored (scores 0), never thrown.
(function () {
    'use strict';

    const MAX_TERMS = 8;
    const MAX_NODES = 25;
    const MAX_TEXT = 200;
    const CLAMP = 10000;
    const STEP_PX = 35; // one hex step in board pixels (same as bot.js)
    const ELEMENTS = ['earth', 'water', 'fire', 'wind', 'void'];

    const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by) / STEP_PX;

    // ---------------------------------------------------------------
    // Inputs: public facts about the position, from the view of player i.
    // Each is computed at most once per scoring call (see makeCtx).
    // ---------------------------------------------------------------
    const INPUTS = {
        myActivated:     { label: 'elements I have activated (0-5)',
            fn: (s, i) => s.players[i].activated.length },
        leaderActivated: { label: 'most elements any opponent has activated',
            fn: (s, i) => Math.max(0, ...s.players.map((p, j) => (j !== i && p) ? p.activated.length : 0)) },
        allActivated:    { label: '1 if I have all 5 elements, else 0',
            fn: (s, i) => s.players[i].activated.length >= 5 ? 1 : 0 },
        myStones:        { label: 'stones I hold (not counting void)',
            fn: (s, i) => ELEMENTS.slice(0, 4).reduce((a, el) => a + (s.players[i].pool[el] || 0), 0) },
        neededStones:    { label: 'stones I hold of elements I still need',
            fn: (s, i) => { const p = s.players[i]; return ELEMENTS.slice(0, 4).reduce((a, el) => a + (p.activated.includes(el) ? 0 : (p.pool[el] || 0)), 0); } },
        voidHeld:        { label: 'void stones I hold',
            fn: (s, i) => s.players[i].pool.void || 0 },
        myAP:            { label: 'action points left (0 when it is not my turn)',
            fn: (s, i) => (s.turn.activePlayerIndex === i && !(s.sim?.turnsEnded > 0)) ? (s.turn.ap || 0) : 0 },
        handCount:       { label: 'scrolls in my hand',
            fn: (s, i) => s.players[i].handCount || 0 },
        activeCount:     { label: 'scrolls in my active area',
            fn: (s, i) => s.players[i].activeCount || 0 },
        commonCount:     { label: 'scrolls in the common area',
            fn: (s) => (s.commonArea || []).length },
        hiddenTiles:     { label: 'tiles not yet revealed',
            fn: (s) => s.tiles.filter(t => !t.revealed && !t.isPlayerTile).length },
        distHome:        { label: 'steps from my pawn to my home shrine (straight line)',
            fn: (s, i) => { const p = s.players[i]; const h = s.tiles.find(t => t.isPlayerTile && t.playerIndex === i); return h ? dist(p.x, p.y, h.x, h.y) : 0; } },
        distHidden:      { label: 'steps to the nearest unrevealed tile (0 if none)',
            fn: (s, i) => { const p = s.players[i]; const hs = s.tiles.filter(t => !t.revealed && !t.isPlayerTile); return hs.length ? Math.min(...hs.map(t => dist(p.x, p.y, t.x, t.y))) : 0; } },
        oppDistHome:     { label: 'steps the closest opponent is from their own home',
            fn: (s, i) => { let best = 0, found = false; s.players.forEach((p, j) => { if (j === i || !p) return; const h = s.tiles.find(t => t.isPlayerTile && t.playerIndex === j); if (!h) return; const d = dist(p.x, p.y, h.x, h.y); best = found ? Math.min(best, d) : d; found = true; }); return best; } },
        boardStones:     { label: 'stones placed on the board',
            fn: (s) => (s.stones || []).length },
        sourceLeft:      { label: 'stones left in the shared supply',
            fn: (s) => Object.values(s.sourcePool || {}).reduce((a, n) => a + (n || 0), 0) },
        players:         { label: 'number of players',
            fn: (s) => s.players.filter(Boolean).length },
        // Roads (2026-09-27): wind is free to walk on, and water touching wind
        // (or touching water that does) copies it, much cheaper than wind.
        homeCost:        { label: 'real walking cost from my pawn to my home (steps; a free hex counts 0.5, walls go around)',
            fn: (s, i) => window.BotSystem?.homeCost ? window.BotSystem.homeCost(s, i) : 0 },
        freeStones:      { label: 'free-to-walk stones on the board (wind, and water chained to wind)',
            fn: (s) => s.stones.filter(st => window.BotSim?.isFreeStone?.(s, st)).length },
        freeWater:       { label: 'water stones copying wind (free to walk on)',
            fn: (s) => s.stones.filter(st => st.type === 'water' && window.BotSim?.isFreeStone?.(s, st)).length },
        freeNearHome:    { label: 'free-to-walk stones within 3 steps of my home',
            fn: (s, i) => { const h = s.tiles.find(t => t.isPlayerTile && t.playerIndex === i); if (!h) return 0;
                return s.stones.filter(st => dist(st.x, st.y, h.x, h.y) <= 3.2 && window.BotSim?.isFreeStone?.(s, st)).length; } },
    };
    const INPUT_NAMES = Object.keys(INPUTS);

    // Inputs that take element names: adjacent(water, wind), myPool(fire)...
    const touching = (a, b) => { const d = Math.hypot(a.x - b.x, a.y - b.y); return d > 5 && d < 50; };
    const PARAM_INPUTS = {
        adjacent:   { args: 2, sig: 'adjacent(a, b)', label: 'stones of element a touching a stone of element b (whole board)',
            fn: (s, i, a, b) => s.stones.filter(st => st.type === a && s.stones.some(o => o !== st && o.type === b && touching(st, o))).length },
        stonesOf:   { args: 1, sig: 'stonesOf(el)', label: 'stones of that element on the board',
            fn: (s, i, a) => s.stones.filter(st => st.type === a).length },
        myPool:     { args: 1, sig: 'myPool(el)', label: 'stones of that element I hold',
            fn: (s, i, a) => s.players[i].pool[a] || 0 },
        oppNeeds:   { args: 1, sig: 'oppNeeds(el)', label: 'opponents who still need that element',
            fn: (s, i, a) => s.players.filter((p, j) => p && j !== i && !p.activated.includes(a)).length },
        commonFor:  { args: 1, sig: 'commonFor(el)', label: 'scrolls of that element in the common area',
            fn: (s, i, a) => (s.commonArea || []).filter(n => window.SCROLL_DEFINITIONS?.[n]?.element === a).length },
    };
    const PARAM_NAMES = Object.keys(PARAM_INPUTS);

    const BINARY = {
        '+':  (a, b) => a + b,
        '-':  (a, b) => a - b,
        '*':  (a, b) => a * b,
        '/':  (a, b) => (b === 0 ? 0 : a / b),
        min:  (a, b) => Math.min(a, b),
        max:  (a, b) => Math.max(a, b),
        gt:   (a, b) => (a > b ? 1 : 0),
        lt:   (a, b) => (a < b ? 1 : 0),
    };
    const UNARY = { abs: a => Math.abs(a), neg: a => -a };

    // ---------------------------------------------------------------
    // Parser: text -> tree. Grammar:
    //   expr   = term (('+'|'-') term)*
    //   term   = factor (('*'|'/') factor)*
    //   factor = number | input | fn '(' expr (',' expr)? ')' | '(' expr ')' | '-' factor
    // Trees: ['n', 3] | ['in', 'myAP'] | [op, a, b] | ['abs'|'neg', a]
    // ---------------------------------------------------------------
    function parse(text) {
        if (typeof text !== 'string') throw new Error('formula must be text');
        if (text.length > MAX_TEXT) throw new Error(`formula too long (max ${MAX_TEXT} characters)`);
        const toks = text.match(/\d+(?:\.\d+)?|[A-Za-z_]\w*|[()+\-*/,]|\S/g) || [];
        let pos = 0;
        const peek = () => toks[pos];
        const take = (want) => {
            const t = toks[pos++];
            if (want && t !== want) throw new Error(`expected "${want}" but found "${t ?? 'end'}"`);
            return t;
        };
        function expr() {
            let n = term();
            while (peek() === '+' || peek() === '-') { const op = take(); n = [op, n, term()]; }
            return n;
        }
        function term() {
            let n = factor();
            while (peek() === '*' || peek() === '/') { const op = take(); n = [op, n, factor()]; }
            return n;
        }
        function factor() {
            const t = peek();
            if (t === undefined) throw new Error('formula ends too early');
            if (t === '(') { take(); const n = expr(); take(')'); return n; }
            if (t === '-') { take(); return ['neg', factor()]; }
            if (/^\d/.test(t)) { take(); return ['n', parseFloat(t)]; }
            if (/^[A-Za-z_]/.test(t)) {
                take();
                if (INPUTS[t]) return ['in', t];
                if (PARAM_INPUTS[t]) {
                    const need = PARAM_INPUTS[t].args, els = [];
                    take('(');
                    for (let k = 0; k < need; k++) {
                        if (k) take(',');
                        const el = take();
                        if (!ELEMENTS.includes(el)) throw new Error(`${t} needs an element (earth, water, fire, wind, void), not "${el ?? 'end'}"`);
                        els.push(el);
                    }
                    take(')');
                    return ['pin', t, ...els];
                }
                if (BINARY[t] && /^[a-z]/.test(t)) { take('('); const a = expr(); take(','); const b = expr(); take(')'); return [t, a, b]; }
                if (t === 'abs') { take('('); const a = expr(); take(')'); return ['abs', a]; }
                throw new Error(`unknown name "${t}"`);
            }
            throw new Error(`unexpected "${t}"`);
        }
        const tree = expr();
        if (pos < toks.length) throw new Error(`unexpected "${toks[pos]}"`);
        if (countNodes(tree) > MAX_NODES) throw new Error(`formula too big (max ${MAX_NODES} parts)`);
        return tree;
    }

    // A formula that reads no input is the same number everywhere, so it
    // cannot change any choice: evolution drops those.
    function hasInput(n) {
        if (n[0] === 'in' || n[0] === 'pin') return true;
        if (n[0] === 'n') return false;
        return n.slice(1).some(hasInput);
    }

    function countNodes(n) {
        if (n[0] === 'n' || n[0] === 'in' || n[0] === 'pin') return 1;
        return 1 + n.slice(1).reduce((a, c) => a + countNodes(c), 0);
    }

    // Tree -> canonical text (so evolved formulas read like hand-written ones).
    function toText(n, parentPrec = 0) {
        const PREC = { '+': 1, '-': 1, '*': 2, '/': 2 };
        switch (n[0]) {
            case 'n':  return String(+n[1].toFixed(3));
            case 'in': return n[1];
            case 'pin': return `${n[1]}(${n.slice(2).join(', ')})`;
            case 'neg': return '-' + toText(n[1], 3);
            case 'abs': return `abs(${toText(n[1])})`;
            default:
                if (PREC[n[0]]) {
                    const p = PREC[n[0]];
                    const s = `${toText(n[1], p)} ${n[0]} ${toText(n[2], p + (n[0] === '-' || n[0] === '/' ? 1 : 0))}`;
                    return p < parentPrec ? `(${s})` : s;
                }
                return `${n[0]}(${toText(n[1])}, ${toText(n[2])})`;
        }
    }

    // Tree -> fast closure over a lazy input context.
    function compileTree(n) {
        switch (n[0]) {
            case 'n':  { const v = n[1]; return () => v; }
            case 'in': { const k = n[1]; return ctx => ctx.get(k); }
            case 'pin': { const name = n[1], args = n.slice(2), k = `${name}(${args.join(',')})`; return ctx => ctx.getP(k, name, args); }
            case 'neg': { const a = compileTree(n[1]); return ctx => -a(ctx); }
            case 'abs': { const a = compileTree(n[1]); return ctx => Math.abs(a(ctx)); }
            default: {
                const f = BINARY[n[0]], a = compileTree(n[1]), b = compileTree(n[2]);
                return ctx => f(a(ctx), b(ctx));
            }
        }
    }

    // text -> {fn, tree} or {error}; cached (formulas repeat millions of times)
    const _cache = new Map();
    function compile(text) {
        let c = _cache.get(text);
        if (!c) {
            try { const tree = parse(text); c = { tree, fn: compileTree(tree) }; }
            catch (e) { c = { error: e.message }; }
            if (_cache.size > 500) _cache.clear();
            _cache.set(text, c);
        }
        return c;
    }

    function makeCtx(snap, i) {
        const memo = {};
        return {
            get(k) {
                if (k in memo) return memo[k];
                let v = 0;
                try { v = INPUTS[k].fn(snap, i); } catch (e) { v = 0; }
                if (!Number.isFinite(v)) v = 0;
                return (memo[k] = v);
            },
            getP(k, name, args) {
                if (k in memo) return memo[k];
                let v = 0;
                try { v = PARAM_INPUTS[name].fn(snap, i, ...args); } catch (e) { v = 0; }
                if (!Number.isFinite(v)) v = 0;
                return (memo[k] = v);
            },
        };
    }

    // Sum of w * formula over a table's terms. Never throws.
    function score(terms, snap, i) {
        if (!Array.isArray(terms) || !terms.length || !snap?.players?.[i]) return 0;
        const ctx = makeCtx(snap, i);
        let v = 0;
        for (let k = 0; k < terms.length && k < MAX_TERMS; k++) {
            const t = terms[k];
            if (!t || typeof t.w !== 'number' || !t.w) continue;
            const c = compile(t.text);
            if (!c.fn) continue;
            let x = c.fn(ctx);
            if (!Number.isFinite(x)) continue;
            if (x > CLAMP) x = CLAMP; else if (x < -CLAMP) x = -CLAMP;
            v += t.w * x;
        }
        return v;
    }

    // Each term's value right now (for tests and the Formula Lab).
    function explain(terms, snap, i) {
        const ctx = makeCtx(snap, i);
        return (terms || []).map(t => {
            const c = compile(t.text);
            const x = c.fn ? c.fn(ctx) : null;
            return { text: t.text, w: t.w, value: x, contribution: c.fn && Number.isFinite(x) ? t.w * Math.max(-CLAMP, Math.min(CLAMP, x)) : 0, error: c.error || null };
        });
    }

    // ---------------------------------------------------------------
    // Lab text format: one term per line
    //   weight: formula   # optional note
    // Returns {terms, errors:[{line, message}]}.
    // ---------------------------------------------------------------
    function parseLines(src, source) {
        const terms = [], errors = [];
        String(src || '').split('\n').forEach((raw, idx) => {
            const line = raw.trim();
            if (!line || line.startsWith('#')) return;
            const hash = line.indexOf('#');
            const body = (hash >= 0 ? line.slice(0, hash) : line).trim();
            const note = hash >= 0 ? line.slice(hash + 1).trim() : '';
            const m = body.match(/^(-?\d+(?:\.\d+)?)\s*:\s*(.+)$/);
            if (!m) { errors.push({ line: idx + 1, message: 'write it as  weight: formula' }); return; }
            const c = compile(m[2].trim());
            if (c.error) { errors.push({ line: idx + 1, message: c.error }); return; }
            terms.push({ text: toText(c.tree), w: parseFloat(m[1]), note: note.slice(0, 120), src: source || 'hermit' });
        });
        return { terms, errors };
    }

    function toLines(terms) {
        return (terms || []).map(t => `${+(+t.w).toFixed(3)}: ${t.text}${t.note ? '   # ' + t.note : ''}`).join('\n');
    }

    // ---------------------------------------------------------------
    // Mutation (bot-arena.js mutate / crossover).
    // Always: nudge every term's weight like any other weight.
    // With opts.structural: sometimes add a random term, drop one, or
    // change one part of a formula (swap an input, an operator, a number).
    // ---------------------------------------------------------------
    const pick = (arr, rng) => arr[Math.floor(rng() * arr.length)];
    function randomLeaf(rng) {
        const r = rng();
        if (r < 0.55) return ['in', pick(INPUT_NAMES, rng)];
        if (r < 0.75) { const name = pick(PARAM_NAMES, rng); return ['pin', name, ...Array.from({ length: PARAM_INPUTS[name].args }, () => pick(ELEMENTS, rng))]; }
        return ['n', 1 + Math.floor(rng() * 10)];
    }
    function randomTree(rng, depth) {
        if (depth <= 0 || rng() < 0.3) return randomLeaf(rng);
        const ops = Object.keys(BINARY);
        return [ops[Math.floor(rng() * ops.length)], randomTree(rng, depth - 1), randomTree(rng, depth - 1)];
    }
    function allNodes(n, out = []) {
        out.push(n);
        if (n[0] !== 'n' && n[0] !== 'in' && n[0] !== 'pin') n.slice(1).forEach(c => allNodes(c, out));
        return out;
    }
    function tweakTree(tree, rng) {
        const t = JSON.parse(JSON.stringify(tree));
        const nodes = allNodes(t);
        const n = nodes[Math.floor(rng() * nodes.length)];
        if (n[0] === 'in') n[1] = INPUT_NAMES[Math.floor(rng() * INPUT_NAMES.length)];
        else if (n[0] === 'pin') n[2 + Math.floor(rng() * (n.length - 2))] = pick(ELEMENTS, rng);
        else if (n[0] === 'n') n[1] = Math.max(0, +(n[1] + (rng() - 0.5) * Math.max(2, n[1])).toFixed(2));
        else if (BINARY[n[0]]) { const ops = Object.keys(BINARY); n[0] = ops[Math.floor(rng() * ops.length)]; }
        else if (n[0] === 'neg' || n[0] === 'abs') n[0] = n[0] === 'neg' ? 'abs' : 'neg';
        return countNodes(t) <= MAX_NODES ? t : tree;
    }

    function gauss(rng) {
        const u1 = Math.max(rng(), 1e-9), u2 = rng();
        return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    }

    function mutateTerms(terms, rng, sigma = 0.2, opts = {}) {
        let out = (Array.isArray(terms) ? terms : []).map(t => ({ ...t }));
        for (const t of out) {
            if (typeof t.w === 'number') t.w = +(t.w + gauss(rng) * sigma * Math.max(1, Math.abs(t.w))).toFixed(3);
        }
        if (opts.structural) {
            const r = rng();
            if (r < 0.25 && out.length < MAX_TERMS) {
                const tree = randomTree(rng, 2);
                out.push({ text: toText(tree), w: +((rng() < 0.5 ? -1 : 1) * (0.2 + rng())).toFixed(3), src: 'evolved' });
            } else if (r < 0.35 && out.length) {
                out.splice(Math.floor(rng() * out.length), 1);
            } else if (r < 0.55 && out.length) {
                const k = Math.floor(rng() * out.length);
                const c = compile(out[k].text);
                if (c.tree) out[k] = { ...out[k], text: toText(tweakTree(c.tree, rng)), src: 'evolved' };
            }
        }
        out = out.filter(t => { if (!t || typeof t.text !== 'string') return false; const c = compile(t.text); return !c.error && hasInput(c.tree); });
        return out;
    }

    // Child terms for crossover: each parent's terms kept or dropped by coin.
    function crossTerms(a, b, rng) {
        const pool = [...(a || []), ...(b || [])];
        const seen = new Set();
        const out = [];
        for (const t of pool) {
            if (seen.has(t.text) || rng() < 0.5) continue;
            seen.add(t.text);
            out.push({ ...t });
            if (out.length >= MAX_TERMS) break;
        }
        return out;
    }

    window.BotTerms = {
        INPUTS, MAX_TERMS, MAX_NODES,
        inputList: () => [...INPUT_NAMES.map(k => ({ name: k, label: INPUTS[k].label })),
            ...PARAM_NAMES.map(k => ({ name: PARAM_INPUTS[k].sig, label: PARAM_INPUTS[k].label }))],
        parse, toText, compile, score, explain,
        parseLines, toLines,
        mutateTerms, crossTerms,
    };
})();
