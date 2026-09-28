// moved-notice.js: the game moved from GitHub Pages to playgodaigo.com.
// On the OLD address (jakeseegers.github.io/Godaigo.Elements/...) this sends
// the browser straight to the same place on the new site, keeping the query
// and #hash (so old recovery / reset links still work there). Accounts live
// in Supabase, so they carry over; players just sign in again.
// Loaded first in <head>. ?movedtest=1 only computes the target (tests).
// Remove this file once the old address is switched off.
(function () {
    'use strict';
    const NEW_ORIGIN = 'https://playgodaigo.com';
    const OLD_HOST = 'jakeseegers.github.io';
    const OLD_BASE = '/Godaigo.Elements';

    const testing = /[?&]movedtest=1\b/.test(location.search);
    // Only the OLD project path: other GitHub Pages sites on the same host
    // (e.g. /Godaigo.null/ published for a test, 2026-09-28) must load.
    if (!testing && (location.hostname !== OLD_HOST || !location.pathname.startsWith(OLD_BASE))) return;

    let path = location.pathname;
    if (path.startsWith(OLD_BASE)) path = path.slice(OLD_BASE.length);
    if (!path.startsWith('/')) path = '/' + path;
    const target = NEW_ORIGIN + path + location.search + location.hash;

    if (testing) { window.__movedTarget = target; return; }
    location.replace(target);
})();
