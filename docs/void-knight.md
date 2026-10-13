# The Void Knight — public leader bot (v1, shipped 2026-07-23)

> STATUS: REMOVED. The Void Knight economy is gone from the client; its tables are dropped by sql/drop-bot-tycoon.sql (2026-10-13). The Void Knight lives on only as one of the five elemental bots. History below.
> Old status: v1 LIVE. Built in one pass from the design conversation of
> 2026-07-23; extends (and partially supersedes) docs/bot-tycoon-proposal.md.
> The decisions below were made explicitly by the user — do not re-litigate
> them without asking.

## Concept

**The Void Knight** is the system-owned public leader bot. It replaces the
anonymous `bot_champion_weights` top row as the player-facing "champion".
Everyone can see it on the Leaderboard tab and do two things to it:

- **Challenge** — pure evaluation, no training. Your ACTIVE deployed bot
  plays a mirror-paired local series against it (20 games, ≥55% of decided
  games to win, ≥10 decided). Win → the Knight **copies your bot's weights**
  (a fork — you keep evolving yours independently), you take the
  reigning-champion accolade shown on its card + 50 gold. **No XP** — XP is
  only ever awarded for winning games.
- **Train** — public good. Routes to the Bot Training panel in leader mode:
  a hill climb anchored to the Knight's OWN weights. A confirmed improvement
  appends a stronger Knight for everyone and pays a 25 gold bounty. The
  trainer's local weights/bots are untouched either way.

The champion **title is historical**: it names the last bot to dethrone the
Knight, and holds even after community training pushes the Knight past that
bot's strength — until someone else dethrones it.

## Data model

`public.void_knight` (append-only; the CURRENT Knight = newest row / max id):
`weights jsonb`, `update_type` ('seed'|'training'|'dethrone'), `updated_by`,
`champion_name`/`champion_owner` (the accolade, set on dethrone),
`confirm_wins/losses/draws`, `created_at`. RLS: public SELECT,
authenticated INSERT with `auth.uid() = updated_by`. Seeded from the
strongest `bot_champion_weights` row.

## Anchor-follows-button (training rework)

Which weights a hill climb starts from and must beat is decided by WHERE the
run was launched, not by the method (`runHillClimbTraining` in game-ui.js):

| Entry point | Anchor / confirm vs | On success |
|---|---|---|
| Stable "Train" (`opts.sourceBotId`) | the bot's OWN weights | written to that bot's row only — no champion share, no XP/gold |
| Leaderboard "Train" (`opts.leaderWeights`) | the Void Knight's weights | new `void_knight` row + 25 gold; local weights restored |
| Ambient (cheat panel, no opts) | online champion (legacy) | unchanged: apply + share to `bot_champion_weights` |

The old "Stable hill climb dethrones the online champion for 250 XP + 50
gold" behavior is REMOVED — dethroning now lives exclusively on the
leaderboard's Challenge button, gold-only.

## Bot identity rules (shipped alongside)

- **Globally unique nicknames** (case-insensitive) via DB unique index;
  existing cross-owner duplicates were suffixed. Client flows surface the
  "taken by another player" case. Names matching /void\s*knight/i are
  reserved.
- **One leaderboard bot per player**: `is_active` = visible on the
  leaderboard. Activating a bot (Stable toggle) or deploying a new one
  benches all your others. All owned bots stay trainable regardless.
- **Hide bots** viewer-side toggle on the Leaderboard tab (localStorage
  `godaigo_hide_bots`).

## Petals (bot attribute view)

Clicking a bot's name in the Stable opens a five-petal flower — one petal
per element, scored by how far the bot's weights deviate from
`DEFAULT_WEIGHTS` along the pre-validated elemental bundles from
bot-tycoon-proposal § ELEMENTAL WEIGHT-BUNDLE ITEMS (tanh-squashed;
50 = stock). Purely descriptive. `GAMI_PETAL_BUNDLES` in gamification-ui.js
is the single source of the bundle definitions — the future elemental
consumable items should reuse it.

## Positional ladder (shipped 2026-07-23, same day)

`public.ladder`: ONE ranked list of players AND bots, replacing XP as the
leaderboard ordering (XP stays for profile Stats). Seeded once from XP with
active bots at the bottom; new entrants (players via `ladder_ensure_player`
on first Board view, bots via `ladder_ensure_bot` on deploy) join at the
bottom. Positions move two ways, both "winner takes the loser's position,
everyone between shifts down one" (deferred unique rank constraint makes the
shift atomic; losses, draws, and downward wins are no-ops):
(1) Stable bot-challenges via RPC `ladder_bot_challenge`;
(2) REAL multiplayer games via RPC `ladder_game_result` — the winner (human
OR bot) takes the position of the highest-ranked opponent they beat.
Human seats are mapped via `players.user_id` (stamped on join; guests stay
null and don't anchor movement), bots via `players.bot_source_id`. Reported
once per game from `handleGameOver`: by the winning human's own client (the
RPC rejects claiming a win for anyone else), or by the HOST when a bot won. No client write
policies — rank arithmetic cannot be forged directly, though results are
still client-reported (see item 3 below). Rendered on the FIRST PAGE
(`loadMainLeaderboard`) and the profile Board tab, with the hide-bots
viewer toggle; benched bots keep their rank but are hidden, so visible rank
numbers can have gaps. Known v1 nuance: challenges fight with your live
WEIGHTS but the ladder entity that moves is your active DEPLOYED bot.

## UI rules learned here

NO emojis anywhere in user-facing text (user: "it's corny"); new UI must
reuse existing component classes (gami-lb-row, gami-stable-btn,
section-label), not one-off styled cards.

## Explicitly deferred (design settled, not built)

1. **Stable self-training (target + gauntlet)**: pick one bot to improve,
   your other bots form the opponent field — needs the CLI hall-of-fame
   gauntlet ported into in-browser `hillClimb()`.
3. **Challenge trust**: results are client-run and self-reported. Cheap v2:
   commit-then-play (register seed+weights before the series) + random
   deterministic replay audits. Noted, deliberately not in v1.

## Imitation learning — DONE, hermit-only (`js/bot-imitation.js`)

Item 2 above ("Practice vs my bot" → imitation learning) shipped, but built
against a REAL online game that already has a bot in it (the personal-bot
economy this file describes was itself later removed — see CLAUDE.md's
"Dormant / unused now" note — so there's no per-player Stable to launch a
local practice game FROM any more; the existing "🤖 Add Bot" real-multiplayer
flow already does what a new local mode would have, so no new mode was
built). Gated behind `window.isHermit()` (developer account only) AND an
explicit opt-in toggle in the hermit menu, off by default.

While watching your own turns in such a game: `bot.js`'s `scoreAction()`
gained an optional, purely additive trace channel (`ctx.trace` /
`contrib()`) wired into exactly two branches — `endTurn` and
`discardScroll` — and `rankActions()` gained an optional `opts.withTrace`
that attaches each candidate's trace without changing any existing call
site's behavior (verified via a same-seed headless regression: identical
win/draw/fitness/turn-count numbers before and after). Every real decision
still counts toward "did the human agree with the bot's overall top pick"
(catches "the bot wanted to end the turn but I kept playing" either
direction), but only endTurn/discardScroll get a feature-level nudge —
move/cast/placeStone comparisons are a natural follow-up, deliberately left
out of v1 to keep the first pass small and low-risk against the heavily-tuned
scorer. Nudges land in a small additive DELTA table
(`localStorage['godaigo_bot_weight_deltas']`) — never a copy of the base
weights, never the shared community champion. A small on-screen badge
(bottom-left, hermit-only) shows a live tally.

**Verified end-to-end (2026-09-05):** a real online smoke test confirmed the
badge/toggle/logging actually fire during a real game. That same test
surfaced a real design flaw, fixed the same session: "should I have ended my
turn" was being judged against a single frozen snapshot, which flagged
"disagreement" on nearly every turn the player kept playing toward a
multi-step plan the snapshot can't see — teaching a systematic bias, not a
real instinct mismatch. Fixed by judging that specific question with
`searchPick()` (already-existing lookahead, several actions ahead within
the turn) instead of the raw one-step ranking; the feature-level trace used
for the actual weight nudge still comes from the immediate scoreAction()
trace of that position — only the "was continuing actually the better type
of move" verdict is now plan-aware.

**Closing the loop — applied to the SAME bots you already face, not a
separate one (revised 2026-09-05).** A first version added a distinct
"🤖 Apprentice" bot seat holding a snapshot of the learned weights — the
learned delta was otherwise write-only, nudged after every game but never
actually faced. Replaced per explicit design feedback: the delta should
apply to whichever bot(s) are already in the room, automatically, whenever
the HOST is the hermit with the toggle on — no separate bot, no manual
step, and the base weights those bots would normally get (community
champion + elemental lean) are untouched and keep tracking live community
training. `hostStartGame()`'s existing per-seat elemental-lean stamping
(the thing that names/weights every bot) now has one extra line: when the
host is the hermit and `BotImitation.isEnabled()`, it calls
`window.BotImitation.applyDeltas(update.bot_weights)` on the freshly-computed
elemental base before writing it. Toggle off, or someone else hosting: that
line never runs, and bots play the plain base exactly as before. Uses the
existing `players.bot_weights` column and `bot-driver.js`'s existing
per-bot-weights mechanism (`docs/bot-tycoon-proposal.md` step 6) — no new
schema, no changes to how a bot's turn is actually driven.
