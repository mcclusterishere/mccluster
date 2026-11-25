/* PRIM3 tactics — the one scale every level and renderer shares.

   Owner, 2026-11-03: "make a grid a little larger ... instead of 1.6, make it like 3.54". One grid tile
   is 3.54 m on a side. Everything that is a real thing (an operative, a container, a crate, a railing)
   keeps its real size in metres and is drawn at metres / TILE_M world units; only the grid is bigger.
   Rules data stays in tiles (positions, ranges) and metres (heights), as the resolver expects.

   An operative stands OPERATOR_HEIGHT_M tall in every renderer: no renderer picks its own figure
   height. A renderer whose world is not on this grid (the 10 × 10 preview courtyard, built in metres)
   passes its own metres per world unit to operatorHeight(). */
export const TILE_M = 3.54;
export const OPERATOR_HEIGHT_M = 1.75;

// metres → world units for a world where one unit is `tileM` metres
export const metres = (m, tileM = TILE_M) => m / tileM;
// an operative's standing height in world units
export const operatorHeight = (tileM = TILE_M) => OPERATOR_HEIGHT_M / tileM;
