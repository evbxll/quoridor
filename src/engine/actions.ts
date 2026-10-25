import { NUM_PAWN_MOVES } from "./constants";

/**
 * An action index in PLAYER coordinates: the board as the player to move sees
 * it, so "forward" is always toward row 0. For player 1 PLAYER equals GLOBAL
 * coordinates; for player 2 the board is rotated 180 degrees.
 */
export type PlayerAction = number & { readonly __frame: "player" };

export function playerAction(index: number): PlayerAction {
  return index as PlayerAction;
}

export const HORIZONTAL = 0;
export const VERTICAL = 1;
export type Orientation = typeof HORIZONTAL | typeof VERTICAL;

/** Pawn moves as [row delta, column delta], in action-index order (negative row is forward). */
export const MOVE_MAPPING: readonly (readonly [number, number])[] = [
  [-1, 0], // single forward
  [1, 0], // single back
  [0, -1], // single left
  [0, 1], // single right
  [-2, 0], // jump forward
  [2, 0], // jump back
  [0, -2], // jump left
  [0, 2], // jump right
  [-1, -1], // diagonal forward-left
  [-1, 1], // diagonal forward-right
  [1, -1], // diagonal back-left
  [1, 1], // diagonal back-right
];

/** An action decoded in PLAYER coordinates. */
export type DecodedAction =
  | { readonly kind: "move"; readonly dRow: number; readonly dCol: number }
  | { readonly kind: "wall"; readonly row: number; readonly col: number; readonly orientation: Orientation };

/** An action located on the board in GLOBAL coordinates: a destination cell or a wall anchor. */
export type GlobalAction =
  | { readonly kind: "move"; readonly row: number; readonly col: number }
  | { readonly kind: "wall"; readonly row: number; readonly col: number; readonly orientation: Orientation };

/** Decodes an action index; throws RangeError outside the action space. */
export function decodeAction(action: PlayerAction, size: number): DecodedAction {
  const anchors = (size - 1) ** 2;
  if (!Number.isInteger(action) || action < 0 || action >= NUM_PAWN_MOVES + 2 * anchors) {
    throw new RangeError(`Action index ${action} out of range`);
  }
  if (action < NUM_PAWN_MOVES) {
    const [dRow, dCol] = MOVE_MAPPING[action]!;
    return { kind: "move", dRow, dCol };
  }
  const wall = action - NUM_PAWN_MOVES;
  const orientation = wall < anchors ? HORIZONTAL : VERTICAL;
  const anchor = wall % anchors;
  return { kind: "wall", row: Math.floor(anchor / (size - 1)), col: anchor % (size - 1), orientation };
}

/** Mirrors a wall anchor 180 degrees; converts between player 2's frame and GLOBAL either way. */
export function flipAnchor(index: number, size: number): number {
  return size - 2 - index;
}

/** Name of the cell at GLOBAL (row, col): file letter and rank from player 1's start row. */
export function squareName(row: number, col: number, size: number): string {
  return `${String.fromCharCode(97 + col)}${size - row}`;
}

/** Name of the wall anchored at GLOBAL (row, col): its center intersection plus "h" or "v". */
export function wallName(row: number, col: number, orientation: Orientation, size: number): string {
  return `${String.fromCharCode(97 + col)}${size - row - 1}${orientation === HORIZONTAL ? "h" : "v"}`;
}
