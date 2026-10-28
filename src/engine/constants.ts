/** Number of pawn moves at the start of the action space. */
export const NUM_PAWN_MOVES = 12;

/**
 * Walls each player starts with, the Python engine's hybrid rule in integers: up to 9x9 it is
 * round(5x(x-1)/36), which gives 3, 4, 6, 8 and 10 on 5x5 to 9x9; above 9x9 it is x + 1
 * (11, 12, 13 and 14 on 10x10 to 13x13). The earlier cubic fit gave 16 on 11x11 and 26 on 13x13.
 */
export function wallCount(size: number): number {
  const x = size;
  return x <= 9 ? Math.floor((10 * x * (x - 1) + 36) / 72) : x + 1;
}

/** Plies at which a game is drawn: 2.5 * N^2, rounded up. */
export function maxPlies(size: number): number {
  return Math.ceil((5 * size * size) / 2);
}

/** Size of the action space: 12 pawn moves, then horizontal and vertical walls. */
export function actionCount(size: number): number {
  return NUM_PAWN_MOVES + 2 * (size - 1) ** 2;
}
