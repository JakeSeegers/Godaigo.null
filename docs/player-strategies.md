# Player strategies to teach the bots

Strategies the owner described (2026-10-11), to build into bots as hand-taught
plans. Each one must prove itself against the champion before bots use it for
real (same idea as the combo screening: 8 fast games, then a trial challenger).
Not built yet: collect them first, then build together.

## 1. Mason's Savvy trap (clear)

Earth stones block movement (a void next to them cancels that).

1. Best when an opponent happens to be near.
2. Pick an opponent with no fire, wind or void stones near them (those would
   let them get out: void cancels earth, wind gives free movement, fire burns).
3. Walk toward them and place an earth stone right next to them.
4. Place the other two earth stones to complete Mason's Savvy's pattern.
5. Cast Mason's Savvy (draw up to 5 earth, place earth within 5 hexes this turn).
6. Use those earth stones to surround the opponent so they cannot move.

Bot pieces: a target picker (near opponent, no fire / wind / void around), a
build plan that starts the pattern next to the target, and a placement driver
for the 5-hex earth placement that closes every exit.

## 2. Shifting Sands travel (positioning NOT understood yet)

Owner: "if you set it up correctly you can use it to fly across the board."
"You move yourself if you put the stones on two tiles that have the casting
location on a half hex with one or both of those tiles empty of stones or
players."

What the code says (js/scrolls/effects/scroll-effects.js):
- Shifting Sands swaps two tiles with no stones and at most one player; a lone
  player on a swapped tile moves with it (to its center).
- tileHasStones / getPlayersOnTile measure distance from the tile center
  (TILE_SIZE * 4), so a pawn on a half hex (shared tile edge) counts as on
  both tiles.

My reading (owner says it is still wrong): cast from a half hex, keep the
pattern stones off one of the two tiles under you, swap that tile far away.

Next step: the owner pulls it off once in a recorded online game (vs bots is
fine) and names the turn; read only that cast from match_moves (pawn spot,
pattern stones, the two tiles swapped, landing spot) and derive the rule.

Bot gap found: bot-effects.js driveTileSwap picks the two closest eligible
tiles ("least disruptive"), so bots never travel with Shifting Sands.

## 3. Call to Adventure + Heavy Stomp (to confirm order and tile choice)

Owner: "Heavy Stomp combos with Call to Adventure."
- Call to Adventure (CATACOMB_SCROLL_3): flip one unoccupied tile; until end of
  turn, revealing a tile draws elemental stones as if you ended your turn on
  its center.
- Heavy Stomp (EARTH_SCROLL_4): flip a tile; a hidden tile revealed = draw a
  scroll.
My reading: cast Call to Adventure first, then Heavy Stomp a face-down tile in
the same turn (scroll + that shrine's stones); walking onto face-down tiles
that turn also pays out stones. Asked the owner: always this order? which tile?

Bot gap: both scrolls already work (bot-effects.js driveTileFlip: nearest
face-down tile), but nothing pairs them in one turn. Teach: holding both ->
cast together, Call to Adventure first.

## 4. Burning Motivation + Mason's Savvy (big AP turn)

Owner: "Burning Motivation plus Mason's Savvy = infinite AP?" (first said with
Avalanche; corrected: just these two).
- Burning Motivation (FIRE_SCROLL_2): until end of turn, +2 AP per stone
  placed; stacks (game-core.js after a stone is placed: buff.stacks * 2).
- Placing a stone costs no AP. Mason's Savvy (EARTH_SCROLL_3): draw up to 5
  earth, place earth within 5 hexes this turn (so no Avalanche needed).
- Not infinite by the code: AP stops when your pool is empty. Breaking a stone
  costs AP (earth 5) and returns it to the SOURCE pool, not yours. Asked the
  owner if they know a way to get stones back (that would be a bug).
Order: Burning Motivation first, then Mason's Savvy, then place every earth
stone (+10 AP, +20 with two Burning Motivations). Pattern stones placed after
Burning Motivation count too. The earth left on the board can wall in an
opponent (ties into #1).
Bot teach: holding both -> Burning Motivation first, Mason's Savvy, dump stones.
Fire (owner): fire destroys adjacent earth, but removeStone -> returnStoneToPool
puts it back in the SHARED source pool, not the player's (game-ui.js; dragging a
board stone back to your own pool was closed 2026-10-01). So no loop by itself;
it adds +2 AP per fire stone placed and refills the shared earth so Mason's
Savvy draws a full 5, and a second Mason's Savvy (second copy or Reflect,
WATER_SCROLL_1) draws the burnt earth back. Asked the owner if they have seen
it go on forever in a real game (that would mean a bug).

### 4b. The infinite AP loop (owner, confirmed by the code) - KEPT, teachable
Scrolls stay in the Active Area after casting and Burning Motivation / Mason's
Savvy have no once-per-turn limit; a cast costs 2 AP (game-core.js
SPELL_AP_COST). Earth placed next to an active fire stone is destroyed at once
(processStoneInteractions "incoming threats") and returns to the shared pool,
which Mason's Savvy draws from. Burning Motivation pays on placement, even for
a stone that burns right away.
Loop: cast Mason's Savvy (-2), place 5 earth next to the fire stone (+10, all
burn back) = +8 AP per loop, unlimited; re-casting Burning Motivation stacks
the payout. Fix options given to the owner: (1) burnt-on-placement stones pay
nothing (recommended), (2) Mason's Savvy once per turn, (3) cap Burning
Motivation AP per turn, (4) keep it. Owner 2026-10-11: KEEP IT, it's a fun
combo (rare to hold both; Iron Stance can counter it). Bots may learn it.
Bot teach: keep a fire stone placed where the Mason's Savvy pattern stays
intact, then loop Mason's Savvy + 5 earth next to the fire while it pays.
Not an instant win (owner): AP alone gives no other stones. Each element needs
its own pattern from its own stones, which come from shrines; the loop only
recycles earth. A bot should spend the AP on what it can use: reaching needed
shrines, breaking opponents' patterns, walling someone in (#1), casting what it
already can.
General rule (owner): ANY recastable draw-stones scroll + Burning Motivation +
an active fire stone to burn on = an AP loop.
- Mason's Savvy (5 earth): +8 AP per loop.
- Seed the Skies (CATACOMB_SCROLL_6, 5 water, place water / wind anywhere): +8.
- Respirate (WIND_SCROLL_3, 3 wind; all wind returns at end of turn anyway): +4.
Water next to fire has special rules (water copies a neighbour's ability,
processStoneInteractions); by the code it still burns, least sure of this one.
