# Bot alliances: temporary coalitions and reciprocity

Owner's design (2026-09-27), mapped onto the code. Only bots use this system.
Bots can target human players and are slightly biased against them. Bots talk
through the emote system. Status: **Phases 1-3 built (2026-09-27); 4 (personalities) planned.**

## The idea in one rule

Bots reward meaningful help, remember meaningful harm, gang up for a short time
on a player who is close to winning, and stop helping as soon as that help would
mostly make someone else win.

## What each bot remembers (per game)

For every other player, each bot keeps:

| Value | Meaning | Update |
|---|---|---|
| Favor | Has this player helped or hurt MY progress? | `F = 0.9 F + dF`, once per full round |
| Trust | Do they keep pacts? (bots only; humans cannot make pacts) | `T = clamp(0.95 T + dT, -1, 1)` |
| Threat | How dangerous is it to help them now? | Worked out fresh from the board each time |

Threat comes from the progress tracker (elements activated, 1-5, and 6 = all five
and home, the win): 2+ behind low, 1 behind low-moderate, tied moderate, 1 ahead
high, 2+ ahead very high, and critical when `oppCanWinNextTurn` (bot-terms.js)
says they could win on their next turn.

**Human bias:** a human counts as a bit more threatening than a bot at the same
tracker value (a personality weight, start around +0.5 of a step).

## How help and harm are measured

Measured by **effect**, not by what the move looks like. The bot already has a
"how good is this position for player X" score (`BotSystem.evaluateSnapshot`).
After every action (`ActionLog.onRecord`, which sees human and bot actions, in
local and online games), each bot compares every player's score before and after:

- The actor's move changed my score: that is `dF` toward the actor.
- Scaled down when the actor mainly helped itself (incidental help or harm).
- Scaled up when it hit something scarce, or happened just before I could finish
  a pattern or activate a shrine.

Named hostile scrolls also count as intent even when the measured effect is
small: Arson, Plunder, and Shifting Sands / Telekinesis / Take Flight used on a
player. Starting sizes come from the owner's event table (for example: pattern
broken -0.30 to -0.60, needed shape built +0.20 to +0.40, pact broken -0.45 Trust).

**Personal versus global:** when B burns A's pattern while A is at 5, A records B
as very harmful. C records that B hurt A, but also that B helped stop a shared
loss (a small plus toward B).

## What bots do with it

1. **Pick a target.** For each opponent: `AllyPreference = wF*F + wT*T - wH*Threat`.
   The leader (by tracker, with the human bias) becomes the preferred target of
   blocking, burning, stealing and pushing. Low-preference players are targets
   before high-preference ones.
2. **Leader response.** No clear leader: play normally. Clear leader: prefer
   actions that slow the leader. Leader at 5: urgent, form a short pact. Leader
   can win next turn: spend big (best scrolls) if the bot still has a real chance.
   The leader pulled back into the pack: the coalition ends.
3. **Hard safeguard.** A bot never takes an action that lets another player win
   on their next turn, unless the same action wins the game for the bot.

In code: bot.js already scores "opponent threat" with the single most advanced
opponent, and blocks the opponent paths it can see. Both become weighted per
opponent by the target preference, and scroll target choices (Arson, Plunder,
tile moves) pick by it.

## Pacts and talk (bots only)

All bots in a game run in one browser (the host online, or the arena), so the
pact itself is agreed inside the code. The emotes are the visible story, for
players and replays:

Bots speak in short **emote sentences**: what they mean, then who it is about.
Chosen by the owner (2026-09-27):

**Who (player symbols)**

| Player | Emote |
|---|---|
| The leader (whoever it is) | Crown |
| Green | Square |
| Blue | Cross |
| Red | Circle |
| Yellow | Triangle |
| Purple | Dizzy Swirl |

**What (messages)**

| Message | Emote |
|---|---|
| WARNING (someone is close to winning) | Exclamation |
| PACT offer (short pact against someone) | Bread, then Question ("those who control the bread govern") |
| ACCEPT | Fist |
| DECLINE | Squint |
| COMMIT (acting on the pact now) | one of Twinkle, Chomp or Hammer, at random |
| WITHDRAW (leaving the pact) | Peace Sign |
| THANKS (real help) | Flower |
| GRUDGE (real harm) and BETRAYAL (pact broken) | one of Rage Spikes, Broken Heart or Angry Vein, at random |

No other messages for now (owner: only if needed).

**Examples**

- Exclamation, Dizzy Swirl: "Warning, purple is close to winning."
- Bread, Question, Crown: "Pact against the leader?"
- Fist: "I'm in." Squint: "No."
- Hammer, Circle: "Acting on the pact: going after red."
- Flower, Square: "Thank you, green."
- Rage Spikes, Cross: "Blue, you hurt me."

A sentence shows its emotes side by side over the speaking bot, popping in
one after another (0.45 s apart); sentences follow about 2 s apart. Every message also gets a short Game Log line, for example "Tidewarden
offers Galewalker a pact against Purple".

Emotes are rate-limited (at most one per bot per turn, pacts only at the start
of a turn), so a game does not turn into emote spam.

Pact rules: short and concrete ("this turn and next, we do not harm each other;
both of us oppose the leader"). After it ends the game records for each member:
kept, withdrew, could not act, or broke it. Declining is fine, withdrawing costs
a little, accepting then acting against it costs a lot of Trust.

## Phases

Built so far (js/bot-diplomacy.js, bot.js, bot-effects.js, bot-mind.js):
- Phase 1: favor per bot per player (trust waits for pacts), threat, ally.
- Phase 2: `pressures(o)` per opponent: 1 normally; the clear leader (ahead of
  me and everyone else by 1+ element, humans +0.5) 1.5, at 4 elements 2, at 5
  elements 2.5, can win next turn 4; times 1 - 0.4 * favor (0.6 to 1.4). Used
  in evaluateSnapshot (opponent progress), tacticalContext (blocking paths and
  shrines) and Arson / Plunder victim choice. Safeguard `kingmakerFilter` (bot.js)
  drops actions that bring an opponent with all five within 5 AP of home.
  Tested: coalitions form on the clear leader and end when tied; the safeguard
  blocked a paving move (6 -> 3.5 steps); 3-player games change (one of three
  seeded games had a different winner), about 6% slower.
- Phase 3: talk and pacts. `say(o, emotes, text)` writes the Game Log line at
  once (ActionLog 'botTalk', text with {pN} player tokens, rendered by
  game-log-ui.js without a turn header) and shows the emotes side by side over
  the bot as one float (sprite array, queue of 3, oldest dropped); online the broadcast
  carries `talk` so every client logs it (lobby.js), replays too. Silent in
  muted training (pacts still run). Pacts: at a bot's turn start, if it has a
  coalition target with push >= 2 and no pact for 2 rounds: warn (once per
  leader stage), offer; each other bot accepts when it also targets the leader
  and its favor + 0.5 trust toward the proposer > -0.5. Pact: one round;
  members push the target x1.3 and each other x0.7. Strike (target loses 20+
  progress on a member's turn) = Commit emote; a member that no longer targets
  the leader withdraws (-0.05 trust); hurting a fellow member breaks it (-0.45
  trust, -0.15 favor, betrayal emote). Kept: +0.15 trust (+0.1 more if it
  struck). Thanks (favor change >= +0.1) and grudges (<= -0.25) outside pacts:
  one sentence per bot per turn, same pair once per round.

1. **Memory only.** Favor / Trust / Threat per bot, updated from real actions. No
   behaviour change. The Bot Mind viewer (hermit) shows each bot's view of every
   player, so we can check it reads the game correctly.
2. **Target choice + leader response + safeguard.** Bots start ganging up on the
   leader and preferring players who helped them. Human bias.
3. **Pacts + emotes.** Offers, accepts, commits, betrayals, thanks and grudges.
4. **Personalities and tuning.** Per elemental bot (for example a loyal Terran
   Sentinel and a vindictive Emberkin), weights tunable by training in 3-5 player
   games.

## Owner decisions (2026-09-27)

- Bot talk: emotes plus a short Game Log line.
- Memory: this game only (no grudges carried between games).
- Personalities: yes, one per elemental bot (phase 4).
- Human bias: mild (about half a tracker step).
- Emote vocabulary: see "Pacts and talk" above.
