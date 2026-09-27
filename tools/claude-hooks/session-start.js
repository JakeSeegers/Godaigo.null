#!/usr/bin/env node
// SessionStart hook (see .claude/settings.json).
// 1. Records the commit this session started from, so stop-check.js can see
//    everything the session changed, even after it commits and pushes.
// 2. Prints a short reminder of the house rules. SessionStart stdout is added
//    to Claude's context.
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function git(cmd) {
    return execSync('git ' + cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
}

let input = {};
try { input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}'); } catch (e) {}

try {
    const gitDir = git('rev-parse --git-dir');
    const baseFile = path.join(gitDir, 'claude-session-base');
    // New session (or /clear): start a fresh base. Resume/compact: keep it.
    const fresh = input.source === 'startup' || input.source === 'clear' || !fs.existsSync(baseFile);
    if (fresh) fs.writeFileSync(baseFile, git('rev-parse HEAD') + '\n');
} catch (e) {
    // Not a git checkout: skip the base, still print the rules.
}

// The game repo is JakeSeegers/Godaigo.null (private). The old name
// Godaigo.Elements is now the tiny PUBLIC redirect repo, but sessions set up
// before the rename may still clone and push to it. Warn loudly.
let remoteWarning = '';
try {
    const url = git('remote get-url origin');
    if (/\/godaigo\.elements(\.git)?\/?$/i.test(url)) {
        remoteWarning = 'WARNING: git origin is ' + url + ', the PUBLIC redirect repo. The game lives in '
            + 'JakeSeegers/Godaigo.null. Do NOT push there. Ask the owner before switching origin to '
            + 'https://github.com/JakeSeegers/Godaigo.null (they approved this on 2026-09-27).';
    }
} catch (e) {}

console.log([
    ...(remoteWarning ? [remoteWarning, ''] : []),
    'GODAIGO HOUSE RULES (full list: "HOUSE RULES" in CLAUDE.md). Short version:',
    '- Never use em dashes in anything you write (code, comments, docs, commit messages, game text).',
    '- Release notes (changelog.json): at most ONE entry per day, max 5 lines. Same day = rewrite that day\'s summary, never add a second entry. Only changes players notice; small fixes go in one "Small fixes and polish" line.',
    '- Changed files the browser loads (js/, css/, index.html, changelog.json)? Run node tools/bump-version.js and commit js/version.js too.',
    '- Start from planning/current.md and the INDEX.md files before reading source.',
    'A Stop hook (tools/claude-hooks/stop-check.js) checks these rules before you finish.'
].join('\n'));
