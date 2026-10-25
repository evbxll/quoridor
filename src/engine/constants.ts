/** Number of pawn moves at the start of the action space. */
export const NUM_PAWN_MOVES = 12;

/** Walls each player starts with: the cubic fit of the Python engine, truncated. */
export function wallCount(size: number): number {
  const x = size;
  return Math.trunc(-6.4276 + 3.4745 * x - 0.4058 * x * x + 0.0255 * x * x * x);
}

/** Plies at which a game is drawn: 2.5 * N^2, rounded up. */
export function maxPlies(size: number): number {
  return Math.ceil((5 * size * size) / 2);
}

/** Size of the action space: 12 pawn moves, then horizontal and vertical walls. */
export function actionCount(size: number): number {
  return NUM_PAWN_MOVES + 2 * (size - 1) ** 2;
}
