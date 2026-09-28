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
- Faster response (2026-09-27, after the owner's test game where a human
  went from 1 to 5 elements and home while the bots only warned): a big lead
  counts as danger too (2+ elements ahead of everyone else = push 2, 3+ =
  2.5), so warnings and pacts start earlier and warnings only come at push 2+.
  A pact now holds for another round while the target is still a danger to
  every member, and when the leader has all five a new pact needs no wait.
  The search now counts the real path cost of an opponent's way home (not
  straight-line distance), so walls in the way count as slowing them. (A
  "walk into the runner's way" goal was tried and dropped: owner, weak.)
- Harming the leader (owner's list, 2026-09-27; bot.js `harmContext`), only
  against the coalition target at push 2+, all scores x push:
  - Break its fresh pattern stones: stones it placed in the last round
    (public; BotDiplomacy `recentStones`) of elements it still needs.
    breakLeaderPattern 25; a bot up to 3 AP away walks over (moveToBreak 25).
  - Camp a scarce shrine: a revealed shrine of an element the leader still
    needs, supply 3 or less, the leader holding under 3 of that stone. Walk
    there (moveCamp 60, up to 8 AP), stay (campLeave -40), end the turn on
    it (endTurnCamp 20). Also added at the search root.
- Helping pact partners (bot.js `helpContext`, bots in the same pact only):
  - Gift: discard a scroll (level 2+) to the common area when a partner still
    needs its element, the pact's target already has it (no win for them) and
    I have it too (discardForAlly 30). Tested: 2 gifts in three 4-bot games.
  - Road: wind on the way home of a partner with all five (placeAllyRoad 15
    x push). kingmakerFilter still blocks bringing anyone within 5 AP of
    home, so this help stays small. Rare in tests (partners seldom have five).
  Owner's list, still to do: building a shape a partner needs (their hand is
  hidden, patterns sit around their own pawn), Shifting Sands / Telekinesis /
  Take Flight to move the leader somewhere bad, and pushing a scroll to the
  common area on purpose to deny.
- Guarding against the final cast (2026-09-28, owner's aggression list step 1+2).
  A test of 40 games showed pacts had no effect on the leader's win rate, and
  bots never countered: responses cost 2 AP paid from AP kept from your own
  turn, and bots always spent it all. Now, from public info only (elements
  won, active area, hand scroll elements, common area), `oneCastFromWin` /
  `alertOn` flag a player one cast from winning; that player counts as push
  2 (STAGE.five) at least. Guard mode (bot.js `guardWanted`): keep Iron Stance
  and Psychic, build their pattern, keep 2 AP (`guardKeepAp`), fetch one with
  Quick Reflexes or Scholar's Insight when none is in reach (`castGuardFetch`).
  decideResponse counters the cast giving the caster their last element first.
  Test (6 games each, same seeds): leader won 2/6 with diplomacy on and off
  (3 bots), 3/6 on and off (4 bots). Guard mode ran on about 30% of turns
  and fetched 8 times, but only 1 counter fired: a counter needs the scroll,
  2 kept AP AND the leader's cast to land on that exact turn.
- Element difficulty and earlier engagement (owner, 2026-09-28). Void is the
  hardest element to activate, then wind, fire, water, earth. Won elements
  count void 1.15, wind 1.07, fire 1, water 0.93, earth 0.85 (bot.js
  ELEMENT_THREAT) in the diplomacy tracker and in every bot's opponentProgress,
  so void + wind + fire is a bit more dangerous than earth + water + fire.
  A clear leader is now 0.75 (weighted) ahead of everyone else; push 2
  (warnings, pacts) starts when the leader has 3 elements, not 4 (4 = 2.25);
  a lead mostly in hard elements pushes up to x1.15. Harm (harmContext) now
  starts at push 1.5, any clear leader, scaled by push.
- Touchy bots and grudge pacts (owner, 2026-09-28: walls and denial tools
  would add little; focus on how bots react to each other). New hurt parts in
  `parts()`: `plan` (stones of the bot's own build plan, BotSystem.planOf),
  `common` (common-area scrolls level 2+ for an element it needs) and `path`
  (real path cost to its next wanted shrine, BotSystem.goalCost, measured
  only at turn ends). Losses count extra (DISRUPT: plan, common, path x2,
  ready, shrines x1.5). Favor now moves push more (1 - 0.6 favor, up to 1.7),
  so a strong grudge alone reaches push 1.5 and harm starts. Grudge pact
  (`proposeGrudge`, 3+ players): a bot with favor <= -0.25 toward someone
  (-0.15 if it has a friend) asks the others for help against them at once,
  leader or not (not against a player 1.5+ behind it; after a no, not about the same player for 2 rounds). Others join on
  dislike of the target + 0.6 x liking of the proposer + 0.5 x threat. It
  holds while every member still dislikes the target (favor <= -0.2);
  the target gets push 1.6 at least. Leader pacts go first. A friend of
  the proposer (liking >= 0.2) also joins a leader pact it had not chosen.
- Intentions (owner, 2026-09-28): `BotDiplomacy.intend(o, kind, target)`
  says what a bot just did as an emote sentence + Game Log line: break
  (leader's new stones), camp (holds a shrine the target needs), gift, road,
  fetch (looks for a counter), watch (guard mode), counter (bot-effects.js
  response), idea (stuck tool), home (runs home with all five), think / playout (Calculating / Counting emote, no log line, once every 2 rounds, from bot.js signalBrainMode when look-ahead or playouts decide). Camp = open hand + book + target, gift = gift + book + the partner who needs it. Called from
  bot.js `announceIntent` after each applied action. Once a round per
  intention and target; home once a game; watch once per target stage.
  Emotes (js/emoji-system.js): pinned to the board (an invisible marker rect
  in the board where the pawn stood; the float follows its screen box each
  frame, so pan, zoom and tilt all apply), outlined in the player's colour,
  and a new bot sentence over the same pawn fades out the previous one.
- More harm moves (owner's list, 2026-09-28; bot.js `harmChoices` +
  `harmCastBonus`, all x push, only with a harm target):
  - Heavy Stomp: reveal a face-down tile next to the leader (closer to it
    than to me) so I take the scroll draw it would have explored for
    (castHarmChoice 40 x 0.8). Hiding a shrine was tried and dropped: a
    human remembers it and revealing it again gives them a free draw.
  - Wandering River: a key shrine of the leader (an element it needs, one
    of at most 2 open shrines of it, near it) counts as an element it
    already has until my next turn (x 0.6).
  - Shifting Sands: swap the leader's tile (only it on it, no stones) with
    the free tile farthest from where it is heading (home with five, else
    its key shrines), when that is 2+ tiles farther (up to x 1.5).
  - Mason's Savvy: cast when the leader's route (home or nearest key shrine)
    passes within 5 hexes (castHarmWall 30); the earth wall placements
    themselves were already scored (tacticalContext, x push).
  - Control the Current: cast next to the leader's fresh water stones of an
    element it needs (castHarmCurrent 25); the driver turns those first.
  Choices go through BotSim.castChoices, so search sees them too. Take
  Flight on the leader was left out: the target chooses where it lands.
  Bot talk: scout, river, shove, wall, current intentions.
  Open question (owner): bots forget the element of a tile flipped face-down
  again (the snapshot masks it); a memory of seen tiles would fix that.

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
