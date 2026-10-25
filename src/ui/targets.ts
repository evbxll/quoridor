import { HORIZONTAL, type GlobalAction, type PlayerAction, squareName, VERTICAL, wallName } from "../engine/actions";
import type { GameState } from "../engine/state";

/** The legal action that lands exactly on `target`, or null if there is none. */
export function findAction(state: GameState, target: GlobalAction): PlayerAction | null {
  for (const action of state.legalActions()) {
    const where = state.globalAction(action);
    if (where.kind !== target.kind || where.row !== target.row || where.col !== target.col) continue;
    if (where.kind === "wall" && target.kind === "wall" && where.orientation !== target.orientation) continue;
    return action;
  }
  return null;
}

/** The cells the player to move may step to. */
export function pawnTargets(state: GameState): { row: number; col: number }[] {
  const cells: { row: number; col: number }[] = [];
  for (const action of state.legalActions()) {
    const where = state.globalAction(action);
    if (where.kind === "move") cells.push({ row: where.row, col: where.col });
  }
  return cells;
}

/** Arrow keys move the keyboard cursor; `h` and `v` pick a wall of that orientation, `p` goes back to pawn moves. */
export function moveCursor(cursor: GlobalAction, key: string, size: number): GlobalAction | null {
  const limit = cursor.kind === "move" ? size - 1 : size - 2;
  const step = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[key];
  if (step) {
    const row = Math.min(Math.max(cursor.row + step[0]!, 0), limit);
    const col = Math.min(Math.max(cursor.col + step[1]!, 0), limit);
    return { ...cursor, row, col };
  }
  if (key === "h" || key === "v") {
    const clamp = (v: number): number => Math.min(v, size - 2);
    return { kind: "wall", row: clamp(cursor.row), col: clamp(cursor.col), orientation: key === "h" ? HORIZONTAL : VERTICAL };
  }
  if (key === "p") return { kind: "move", row: cursor.row, col: cursor.col };
  return null;
}

/** The cursor's target in words for a screen reader: its standard name and whether the move is legal. */
export function describeTarget(state: GameState, target: GlobalAction): string {
  const legal = findAction(state, target) !== null;
  if (target.kind === "move") {
    const name = squareName(target.row, target.col, state.size);
    for (const player of [0, 1] as const) {
      if (state.row(player) === target.row && state.col(player) === target.col) return `${name}, player ${player + 1}'s pawn`;
    }
    return `${name}, ${legal ? "legal pawn move" : "not a legal pawn move"}`;
  }
  const name = wallName(target.row, target.col, target.orientation, state.size);
  return `Wall ${name}, ${target.orientation === HORIZONTAL ? "horizontal" : "vertical"}, ${legal ? "legal" : "not legal"}`;
}
