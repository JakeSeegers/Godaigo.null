# Twitch votes: chat steers the bots (2026-10-01)

Status: BUILT (js/stream-votes.js). Tested locally with a fake chat (votes, moods, a chosen cast,
another player's view). Not yet tested against real Twitch chat. Server: sql/stream-games.sql part B
(ladder Twitchbot mapping, stream flag on matches) still to apply. Owner idea after Plunge87's stream.

## Goal
A streamer plays Godaigo with bots in the game. Twitch chat votes on what the bots do at the
big moments (which scroll to cast, who to hit) and sets each bot's mood once a round.
The bots still play well between votes. If nobody votes, the bot does what it would have done.

## Who runs it
The streamer's browser. It already drives every bot:
- online: the host drives bot seats (js/bot-driver.js), so the streamer must be the host;
- local game vs bots: the bots run in the same browser (game-ui.js calls BotSystem.turn()).
Both paths go through `BotSystem.turn()` (js/bot.js botTurn), so the hook goes there and works
for both. Other players' browsers only show the vote box (sent as a game message).

## 1. Reading chat (no Twitch app, no login)
New `js/stream-votes.js` (`window.StreamVotes`):
- Anonymous read-only Twitch chat: WebSocket `wss://irc-ws.chat.twitch.tv:443`,
  `PASS SCHMOOPIIE`, `NICK justinfan<random>`, `CAP REQ :twitch.tv/tags`, `JOIN #<channel>`.
  Answer `PING` with `PONG`, reconnect with backoff. No token, nothing sent to chat.
- Votes: a message that is exactly `!1`, `!2`, `!3` (also `1`, `2`, `3`). One vote per
  user-id per vote; a later vote replaces the earlier one. Everything else is ignored.
- Settings (localStorage `godaigo_stream`): channel name, vote length (default 20 s, 10 to 45),
  which votes are on (cast votes, mood votes), on/off.

## 2. Turning it on
- Waiting room (host only) and local game setup: "Stream game" box + Twitch channel field,
  with a status dot (connected / not connected), like the Test game switch (js/test-game.js).
- New room flag `game_room.stream_mode` (sql/stream-games.sql). Lobby room card shows a small
  pixel emote badge "Stream" (no Unicode emoji).
- Stream games pay rewards as normal (owner, 2026-10-01). Every chat-steered bot seat is named
  "Twitchbot (<element bot>)" and counts as ONE leaderboard bot, Twitchbot (deployed_bots row,
  owner null). `_ladder_apply_match` maps those seats to it and never lets it lose to itself.
  `start_match` copies the room flag into `matches.stream_mode`; the combo miner skips those
  matches. SQL: sql/stream-games.sql.

## 3. Mood vote (once per round, per bot)
At the start of a bot's turn, if its mood vote is due:
- Options: `1 Rush home` (race for elements and home), `2 Block the leader`,
  `3 Pick on <player>` (the player chat dislikes, cycles through the humans/bots not this bot).
- Result lasts until the bot's next mood vote. It is a gentle overlay, the same way
  js/bot-elements.js applies element "leans": Rush = more weight on own progress and home
  path, less on harm; Block = BotDiplomacy pressure on the current leader up; Pick on X =
  a favor penalty toward X in BotDiplomacy (new `BotDiplomacy.nudge(o, j, df)` helper), so
  harm scrolls, blocking and pact targets lean toward X.
- Mood votes run while the bot waits for its turn to start (about 20 s). To keep games moving,
  a mood vote opens at most once per round for all bots together (one vote, bot picked in turn).

## 4. Cast vote (the big moments)
In botTurn's loop, before `botAct()`: `await StreamVotes.beforeAct(idx)`.
- It asks `BotSystem.rankActions()` for cast options, keeps distinct ones (scroll + target),
  drops ones that score far below the best (so chat never picks a pointless cast), and needs
  at least 2. Options are worded with the existing `explainAction()` ("Cast Arson: burn one of
  Blue's fire stones"). Option 3 is always "Let <bot> decide".
- At most one cast vote per bot turn, and only when the bot is about to cast.
- The winner is handed back with `BotSystem.setNextChoice(idx, action)`: botActCore applies it
  first (if still legal) through the normal cast path, so plan, combo and credit bookkeeping
  stays right. A tie or no votes = the bot's own pick.
- Response windows (counters on someone else's turn) are NOT voted: they have short timers.

## 5. On screen
- Vote box over the board (top right, Paper UI style): bot name and color, question, 3 options
  with live counts and bars, a timer bar, "Type !1 !2 !3 in chat". Big and readable for stream.
- Result line in the Game Log: "Chat chose: Cast Arson on Blue (12 votes)". Bot says a short
  line with a pixel emote (BotDiplomacy.say) like "As chat wishes!".
- Host broadcasts `stream-vote` (open, counts every 2 s, result) so other players see the box;
  the match recorder keeps them, so replays show the votes too.
- Bot turns pause during a vote: the turn timer is not running for bot seats, and the host's
  driver already awaits `BotSystem.turn()`, so nothing times out. Status text "Chat is voting...".

## 6. Testing
- Local: a fake chat (`StreamVotes.fakeChat(['!1','!2', ...])` and a Playwright run with a
  mocked WebSocket) and a local game vs 3 bots: votes open, counts, the chosen cast happens,
  no-vote = bot's own pick, game finishes, no page errors.
- Arena / training: votes are always off there (muted training never waits).
- Live: owner connects to a real channel (any live channel works for reading) and checks votes
  count.

## Ship
`node tools/bump-version.js`, changelog line ("Stream games: Twitch chat can vote on what the
bots do"), docs (CLAUDE.md script list + game_room row, js/INDEX.md, planning/current.md),
Credits unchanged. Push to `fixes/all-consolidated`.

## Later (only if this is fun)
Channel points / bits ("500 points: make Emberkin angry at someone"). Needs a Twitch app,
the streamer's sign-in and an edge function for EventSub. Not part of this plan.

## Update 2026-10-02: better votes (owner: "the questions are a little boring")
- Chat picks the PLAYER (any seat, humans and bots; several humans can play): "Who should X go
  after?", "Who should X help?" (help = gifts to the common area, wind on their road home, never
  harmed), "X and Y: team up against who?" (forced pact), and for pact members "Keep or BETRAY?".
- A target choice holds for N rounds (Stream panel, default 3); the bot gets no new target vote
  until it runs out ("Chat's order for X ran out." in the Game Log).
- Cast: 2 different casts = pick one; one cast the bot is about to make = Allow / VETO.
- The old Rush / Block / Pick on mood vote is gone.
