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
