// Game language (English / Spanish). window.I18n
//
// The game code keeps writing English. When the player picks Spanish, this
// file loads js/i18n-es.js (English -> Spanish table) and swaps the text the
// player sees: text in the page, the title / placeholder / aria-label
// attributes, and alert / confirm / prompt messages. A MutationObserver
// translates new text as the game adds it. In English nothing is loaded and
// no observer runs.
//
// Table keys with {0}, {1}, ... are patterns: "{0}'s Turn" matches "Ana's
// Turn"; the matched parts are translated too when the table has them (so a
// scroll name inside a sentence becomes Spanish).
//
// Code that READS button text to find a button (the bots in bot-effects.js,
// bot-state.js, bot.js) must use I18n.src(el): it gives back the English
// text. Element with translate="no" or class "no-i18n": left alone (player
// names, codes). The choice is saved in localStorage godaigo_lang.
(function () {
    'use strict';
    var KEY = 'godaigo_lang';
    var LANGS = { en: 'English', es: 'Español' };
    var ATTRS = ['title', 'placeholder', 'aria-label'];
    var SKIP_TAGS = { SCRIPT: 1, STYLE: 1, TEXTAREA: 1, NOSCRIPT: 1, CODE: 1, svg: 1, SVG: 1, IFRAME: 1, CANVAS: 1 };

    function readLang() {
        try { var v = localStorage.getItem(KEY); return LANGS[v] ? v : 'en'; } catch (e) { return 'en'; }
    }
    var lang = readLang();
    var dict = null, patterns = null;
    var cache = new Map();
    var textOrig = new WeakMap();   // text node -> { src, out }
    var attrOrig = new WeakMap();   // element -> { attr: { src, out } }
    var observer = null;
    var listeners = [];

    function escRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

    function build() {
        var table = window.I18N_ES;
        if (!table) return false;
        dict = new Map();
        patterns = [];
        Object.keys(table).forEach(function (k) {
            if (!/\{\d+\}/.test(k)) { dict.set(k, table[k]); return; }
            var order = [];
            var parts = k.split(/(\{\d+\})/);
            var lits = [];
            var re = '^' + parts.map(function (p) {
                var m = /^\{(\d+)\}$/.exec(p);
                if (m) { order.push(+m[1]); return '([\\s\\S]*?)'; }
                if (p) lits.push(p);
                return escRe(p);
            }).join('') + '$';
            // Longest fixed piece: a quick includes() check before the regex.
            var need = lits.sort(function (a, b) { return b.length - a.length; })[0] || '';
            // A pattern that ends in {n} ("Player {0}") loses a tie to one that
            // does not ("{0}'s Turn"), so "Player 1's Turn" reads as a turn line.
            var weight = lits.join('').length - (/\}$/.test(k) ? 0.5 : 0);
            patterns.push({ re: new RegExp(re), order: order, out: table[k], need: need, weight: weight });
        });
        // More fixed text first: "{0} wins ({1}%)" before "{0} wins".
        patterns.sort(function (a, b) { return b.weight - a.weight; });
        return true;
    }

    function part(s, depth) {
        if (!s) return s;
        var t = dict.get(s);
        if (t != null) return t;
        var lower = dict.get(s.toLowerCase());
        if (lower != null) return lower;
        // "earth, water" -> each piece.
        if (s.indexOf(', ') > 0) return s.split(', ').map(function (x) { var y = dict.get(x) || dict.get(x.toLowerCase()); return y != null ? y : x; }).join(', ');
        // "Player 1" inside "{0}'s Turn": one more pattern pass.
        if (!depth) { var inner = line(s, 1); if (inner != null) return inner; }
        return s;
    }

    // One line, whitespace already folded. null = no translation.
    function line(s, depth) {
        if (!s || !/[A-Za-z]/.test(s)) return null;
        var t = dict.get(s);
        if (t != null) return t;
        for (var i = 0; i < patterns.length; i++) {
            var p = patterns[i];
            if (p.need && s.indexOf(p.need) < 0) continue;
            var m = p.re.exec(s);
            if (!m) continue;
            var vals = {};
            for (var j = 0; j < p.order.length; j++) vals[p.order[j]] = part(m[j + 1], depth);
            return p.out.replace(/\{(\d+)\}/g, function (_, n) { return vals[n] != null ? vals[n] : ''; });
        }
        return null;
    }

    // Translate a string, keeping its outer whitespace. null = unchanged.
    function tr(s) {
        if (!dict || typeof s !== 'string' || !s) return null;
        if (cache.has(s)) return cache.get(s);
        var lead = /^\s*/.exec(s)[0], trail = /\s*$/.exec(s)[0];
        var core = s.slice(lead.length, s.length - trail.length).replace(/\s+/g, ' ');
        var out = line(core);
        if (out == null && s.indexOf('\n') >= 0) {
            // Multi-line messages (alerts): line by line.
            var changed = false;
            out = s.split('\n').map(function (l) {
                var x = tr(l);
                if (x != null) { changed = true; return x; }
                return l;
            }).join('\n');
            if (!changed) out = null;
            else { lead = ''; trail = ''; }
        }
        var res = out == null ? null : lead + out + trail;
        if (cache.size > 4000) cache.clear();
        cache.set(s, res);
        return res;
    }

    function skipEl(el) {
        for (var e = el; e && e.nodeType === 1; e = e.parentNode) {
            if (SKIP_TAGS[e.tagName] || e.namespaceURI === 'http://www.w3.org/2000/svg') return true;
            if (e.isContentEditable) return true;
            if (e.getAttribute('translate') === 'no' || (e.classList && e.classList.contains('no-i18n'))) return true;
        }
        return false;
    }

    function doText(n) {
        var v = n.nodeValue;
        var rec = textOrig.get(n);
        if (rec && v === rec.out) return;
        if (!v || !/[A-Za-z]/.test(v)) { if (rec) textOrig.delete(n); return; }
        if (n.parentNode && skipEl(n.parentNode)) return;
        var out = tr(v);
        if (out == null || out === v) { if (rec) textOrig.delete(n); return; }
        textOrig.set(n, { src: v, out: out });
        n.nodeValue = out;
    }

    function doAttrs(el) {
        if (!el.getAttribute) return;
        var recs = attrOrig.get(el);
        for (var i = 0; i < ATTRS.length; i++) {
            var a = ATTRS[i];
            var v = el.getAttribute(a);
            if (!v) continue;
            var r = recs && recs[a];
            if (r && v === r.out) continue;
            var out = tr(v);
            if (out == null || out === v) { if (r) delete recs[a]; continue; }
            if (!recs) { recs = {}; attrOrig.set(el, recs); }
            recs[a] = { src: v, out: out };
            el.setAttribute(a, out);
        }
    }

    function walk(root) {
        if (!root) return;
        if (root.nodeType === 3) { doText(root); return; }
        if (root.nodeType !== 1 && root.nodeType !== 9 && root.nodeType !== 11) return;
        if (root.nodeType === 1 && skipEl(root)) return;
        if (root.nodeType === 1) doAttrs(root);
        var w = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
            acceptNode: function (n) {
                if (n.nodeType === 1 && (SKIP_TAGS[n.tagName] || n.namespaceURI === 'http://www.w3.org/2000/svg' ||
                    n.getAttribute('translate') === 'no' || n.classList.contains('no-i18n'))) return NodeFilter.FILTER_REJECT;
                return NodeFilter.FILTER_ACCEPT;
            }
        });
        var n;
        while ((n = w.nextNode())) {
            if (n.nodeType === 3) doText(n); else doAttrs(n);
        }
    }

    function onMutations(list) {
        for (var i = 0; i < list.length; i++) {
            var m = list[i];
            if (m.type === 'characterData') doText(m.target);
            else if (m.type === 'attributes') { if (!skipEl(m.target)) doAttrs(m.target); }
            else for (var j = 0; j < m.addedNodes.length; j++) {
                var a = m.addedNodes[j];
                if (a.nodeType === 1 && a.namespaceURI === 'http://www.w3.org/2000/svg') continue;
                walk(a);
            }
        }
    }

    function startTranslate() {
        if (observer || !dict || !document.body) return;
        walk(document.body);
        observer = new MutationObserver(onMutations);
        observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
    }

    // Spanish -> English for exact table lines (no patterns). Used after a
    // switch back to English: code that saved a label while Spanish was on
    // (Smart UI fit's short labels did) can write that Spanish copy back
    // later, as a new text node this file never translated. Spanish values
    // that belong to two English lines ("Vacío") are left out.
    var reverse = null;
    function buildReverse() {
        if (reverse || !dict) return;
        reverse = new Map();
        var twice = new Set();
        dict.forEach(function (es, en) {
            if (!es || es === en) return;
            if (reverse.has(es) && reverse.get(es) !== en) twice.add(es);
            else reverse.set(es, en);
        });
        twice.forEach(function (es) { reverse.delete(es); });
    }
    function backToEnglish(s) {
        if (!reverse || !s || !/[A-Za-zÀ-ÿ]/.test(s)) return null;
        var lead = /^\s*/.exec(s)[0], trail = /\s*$/.exec(s)[0];
        var en = reverse.get(s.slice(lead.length, s.length - trail.length).replace(/\s+/g, ' '));
        return en == null ? null : lead + en + trail;
    }
    function revertNode(n) {
        if (n.nodeType === 3) {
            if (n.parentNode && skipEl(n.parentNode)) return;
            var t = backToEnglish(n.nodeValue);
            if (t != null && t !== n.nodeValue) n.nodeValue = t;
        } else if (n.nodeType === 1 && n.getAttribute) {
            if (skipEl(n)) return;
            ATTRS.forEach(function (a) {
                var v = n.getAttribute(a);
                var t = v && backToEnglish(v);
                if (t != null && t !== v) n.setAttribute(a, t);
            });
        }
    }
    function revertTree(root) {
        if (!root) return;
        revertNode(root);
        if (root.nodeType !== 1 && root.nodeType !== 9) return;
        var w = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
        var n;
        while ((n = w.nextNode())) revertNode(n);
    }
    var reverseObserver = null;

    function stop() {
        if (observer) { observer.disconnect(); observer = null; }
        // Put the English back.
        if (!document.body) return;
        var w = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
        var n;
        while ((n = w.nextNode())) {
            if (n.nodeType === 3) {
                var r = textOrig.get(n);
                if (r && n.nodeValue === r.out) n.nodeValue = r.src;
                textOrig.delete(n);
            } else {
                var recs = attrOrig.get(n);
                if (!recs) continue;
                Object.keys(recs).forEach(function (a) { if (n.getAttribute(a) === recs[a].out) n.setAttribute(a, recs[a].src); });
                attrOrig.delete(n);
            }
        }
        // Then catch Spanish copies that code wrote back, now and for the rest
        // of this page load (only after Spanish was on here; costs nothing otherwise).
        buildReverse();
        revertTree(document.body);
        if (!reverseObserver && reverse) {
            reverseObserver = new MutationObserver(function (list) {
                for (var i = 0; i < list.length; i++) {
                    var m = list[i];
                    if (m.type === 'characterData' || m.type === 'attributes') revertNode(m.target);
                    else for (var j = 0; j < m.addedNodes.length; j++) {
                        var a = m.addedNodes[j];
                        if (a.nodeType === 1 && a.namespaceURI === 'http://www.w3.org/2000/svg') continue;
                        revertTree(a);
                    }
                }
            });
            reverseObserver.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
        }
    }

    function start() {
        if (reverseObserver) { reverseObserver.disconnect(); reverseObserver = null; }
        startTranslate();
    }

    function loadTable() {
        if (window.I18N_ES) return Promise.resolve(build());
        return new Promise(function (resolve) {
            var s = document.createElement('script');
            s.src = 'js/i18n-es.js?v=' + encodeURIComponent(window.GAME_VERSION || '');
            s.charset = 'UTF-8';
            s.onload = function () { resolve(build()); };
            s.onerror = function () { resolve(false); };
            document.head.appendChild(s);
        });
    }

    // alert / confirm / prompt messages.
    ['alert', 'confirm', 'prompt'].forEach(function (fn) {
        var orig = window[fn];
        if (typeof orig !== 'function') return;
        window[fn] = function (msg) {
            var args = Array.prototype.slice.call(arguments);
            if (lang !== 'en' && typeof msg === 'string') { var t = tr(msg); if (t != null) args[0] = t; }
            return orig.apply(window, args);
        };
    });

    function markPickers() {
        var els = document.querySelectorAll('[data-lang-pick]');
        for (var i = 0; i < els.length; i++) {
            els[i].classList.toggle('active', els[i].getAttribute('data-lang-pick') === lang);
            els[i].setAttribute('aria-pressed', els[i].getAttribute('data-lang-pick') === lang ? 'true' : 'false');
        }
    }

    function setLang(next) {
        if (!LANGS[next]) next = 'en';
        try { localStorage.setItem(KEY, next); } catch (e) {}
        if (next === lang) { markPickers(); return Promise.resolve(); }
        lang = next;
        document.documentElement.lang = lang;
        cache.clear();
        var done;
        if (lang === 'en') { stop(); done = Promise.resolve(); }
        else done = loadTable().then(function (ok) { if (ok) start(); });
        return done.then(function () {
            markPickers();
            listeners.forEach(function (f) { try { f(lang); } catch (e) {} });
        });
    }

    // English text of an element, even when it is shown in Spanish.
    function src(el) {
        if (!el) return '';
        if (lang === 'en' || !dict) return el.textContent;
        if (el.nodeType === 3) { var r0 = textOrig.get(el); return r0 && el.nodeValue === r0.out ? r0.src : el.nodeValue; }
        var out = '';
        var w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        var n;
        while ((n = w.nextNode())) {
            var r = textOrig.get(n);
            out += r && n.nodeValue === r.out ? r.src : n.nodeValue;
        }
        return out;
    }

    // Small "English | Español" switch (login screen, Settings).
    function pickerHtml() {
        return '<div class="lang-picker" translate="no" role="group" aria-label="Language / Idioma">' +
            Object.keys(LANGS).map(function (k) {
                return '<button type="button" class="lang-pick-btn' + (k === lang ? ' active' : '') + '" data-lang-pick="' + k +
                    '" aria-pressed="' + (k === lang) + '" onclick="window.I18n.setLang(\'' + k + '\')">' + LANGS[k] + '</button>';
            }).join('') + '</div>';
    }

    window.I18n = {
        get lang() { return lang; },
        languages: LANGS,
        setLang: setLang,
        // Translate a string from code (returns the input when there is no translation).
        t: function (s) { if (lang === 'en') return s; var x = tr(s); return x == null ? s : x; },
        src: src,
        pickerHtml: pickerHtml,
        onChange: function (f) { if (typeof f === 'function') listeners.push(f); }
    };
    window.srcText = src;

    document.documentElement.lang = lang;
    if (lang !== 'en') {
        if (document.readyState === 'loading') {
            // Load the table now (same-origin, while the page is still being read)
            // so the first screen already shows Spanish.
            document.write('<script src="js/i18n-es.js?v=' + encodeURIComponent(window.GAME_VERSION || '') + '" charset="UTF-8"><\/script>');
            document.addEventListener('DOMContentLoaded', function () { if (build()) start(); markPickers(); });
        } else {
            loadTable().then(function (ok) { if (ok) start(); markPickers(); });
        }
    } else {
        document.addEventListener('DOMContentLoaded', markPickers);
    }
})();
