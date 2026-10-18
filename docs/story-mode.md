# Story Mode and Level Editor: plan

> Status: PLAN ONLY (owner 2026-10-18). Nothing is built yet. Continue later, step by step.
> Parent index: [docs/INDEX.md](INDEX.md)

## Goal

A story mode for players: chapters of levels, each level a challenge wrapped in
story (characters, dialogue, events). Levels get harder and teach the game step
by step, up to advanced moves. The owner builds the levels in a drag-and-drop
editor inside the game, with dialogue, character scripts and events.

Side benefit: every level goal is also a skill test for the bots (see "Bots").

## Parts

| Part | What it is |
|------|------------|
| Story | Chapters, each a list of levels. Progress per player: done, stars, unlocked. |
| Level | One challenge: board setup, characters, dialogue, events, goals, turn limit, story text, hints. |
| Board setup | Tiles (element, face up or down, position), stones, pawns, player shrines. Each seat's hand, active scrolls, stones, AP. Scroll decks and the tile deck (order or "stacked", like the tutorial). |
| Characters (NPCs) | Name, portrait, seat colour. How they play: `script` (a fixed list of moves per turn), `bot` (a normal bot, optionally an elemental bot or a weight table), or `none` (story only). |
| Dialogue | Lines: speaker, portrait, English text, Spanish text. Shown as a box; click or Space to go on. |
| Events | When ... If ... Then ... (below). |
| Goals | Checked by the game: win, element X activated, pawn on hex / at home, scroll X cast (or X then Y), stones of a type held, survive N turns, an NPC did not win. Optional: turn limit, star levels (for example done in 3 turns = 3 stars). |

### Events: When / If / Then

- **When (trigger):** level start, turn start (whose turn, which turn), player steps on a hex
  or tile, tile revealed, scroll cast (which), element activated, stone placed or broken,
  NPC turn, goal done, dialogue ended, a timer.
- **If (optional conditions):** turn number, stones held, scrolls held, elements activated,
  pawn position, a story flag set earlier.
- **Then (actions):** show dialogue, give or take a scroll / stones / AP, place or remove a
  stone, reveal or flip a tile, set a story flag, change an NPC's plan, move the camera to a
  hex, show a hint arrow, mark a goal done, win or lose the level, wait N seconds.

## Level file format (first draft)

One JSON object per level, the same for the player mode, the editor and the bot runner:

```json
{
  "id": "ch1-l1", "version": 1,
  "title": { "en": "Meet the Hermit", "es": "Conoce al Ermitano" },
  "intro": [{ "speaker": "hermit", "en": "Walk to the earth shrine.", "es": "Camina al santuario de tierra." }],
  "board": {
    "tiles": [{ "q": 0, "r": 1, "type": "earth", "faceUp": false }],
    "playerTiles": [{ "seat": 0, "q": 0, "r": 0 }],
    "stones": [{ "q": 1, "r": 0, "type": "wind" }],
    "decks": { "earth": ["EARTH_SCROLL_1"], "tiles": "default" }
  },
  "seats": [
    { "seat": 0, "who": "player", "hand": [], "stones": { "earth": 0 }, "ap": 5 },
    { "seat": 1, "who": "npc", "character": "rival", "plays": "script",
      "script": [{ "turn": 1, "do": "move", "q": 2, "r": -1 }] }
  ],
  "characters": { "hermit": { "name": "The Hermit", "portrait": "images/..." } },
  "events": [
    { "when": { "type": "tileRevealed", "tileType": "earth" },
      "then": [{ "do": "dialogue", "lines": [{ "speaker": "hermit", "en": "Good!", "es": "Bien!" }] }] }
  ],
  "goals": [{ "type": "elementActivated", "element": "earth" }],
  "turnLimit": 6,
  "hints": [{ "en": "Stand in the pattern and cast.", "es": "..." }]
}
```

Positions use hex coordinates (q, r); the loader turns them into board pixels with
`hexToPixel`. Exact names will settle in step 1.

## Steps (each one usable on its own)

1. **Level format + Story Player.** A loader that starts a single-player game from a
   level file (custom board instead of the normal setup), shows the intro dialogue and
   checks one goal. One tiny hand-written level ("Meet the Hermit: activate earth").
   *Hardest technical part:* the game starts only the normal way today (`startGame`,
   `initializeDeck`, spiral tile placement). The tutorial already overrides parts
   (`window.tutorialDeckOverride`, `TutorialMode.onTilePreReveal`, stacked scroll deck);
   step 1 turns this into one clean "load this setup" path.
2. **Events + scripted NPCs.** When / If / Then from a small set of triggers and actions,
   NPC scripts, story flags. Hooks on the existing action log (`ActionLog.onRecord`) for
   most triggers.
3. **Editor, part 1:** drag-and-drop board (tiles, stones, pawns), seat setup, goal picker,
   "Play test" button, save (Supabase table for levels + export / import of the file).
4. **Editor, part 2:** dialogue editor (English + Spanish per line, speaker, portrait),
   event editor as simple forms (When / If / Then), NPC script editor (record moves by
   clicking on the board).
5. **Story mode for players:** chapter menu, progress saved per account, unlock the next
   level, rewards (gold, badges) through server functions like other rewards.
6. **Bot exam:** a bot attempts every level goal N times; the Training Lab shows a table
   (passes / fails per level). Also a "Let the bot try" button in the editor to check a
   level is solvable and to estimate its difficulty.

## Bots

- Level goals are clean skill tests: same position every time, a clear yes or no. A failed
  level tells exactly what to fix in the bot's code.
- Use them to **judge** bots (exam, safety check for a change, level difficulty), not as
  training games: too few, and tuning to hand-made tests can make real play worse.
- Reuses: arena games (`BotArena`), stacked deals (`opts.stack`), the replay puzzle
  runner, Bot Mind, the Bad move report.

## Decisions to make later

- Where levels live: Supabase table (editable live, shared) and / or files in the repo.
- Who can build levels: hermit only at first; maybe players later (sharing, ratings).
- Portraits and art: existing pixel art or new.
- Rewards per level and per chapter.
- Online: single player only at first.

## Rules that apply

- Every player-facing line needs Spanish (house rule; dialogue has both fields).
- No em dashes in any text.
- Change log line when story mode reaches players.
