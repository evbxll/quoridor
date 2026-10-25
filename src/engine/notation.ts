import { HORIZONTAL, type PlayerAction, squareName, wallName } from "./actions";
import type { GameState } from "./state";

/**
 * Names an action in standard notation: a pawn move is its destination cell
 * (`e2`, jumps too), a wall is the center intersection plus `h` or `v`
 * (`d4h`). Legality is not checked.
 */
export function formatAction(state: GameState, action: PlayerAction): string {
  const target = state.globalAction(action);
  if (target.kind === "move") return squareName(target.row, target.col, state.size);
  return wallName(target.row, target.col, target.orientation, state.size);
}

/**
 * The legal action written exactly as `text`. Only the standard spelling is
 * accepted: no surrounding whitespace, no capitals.
 * Throws if `text` names no legal action.
 */
export function parseMove(state: GameState, text: string): PlayerAction {
  for (const action of state.legalActions()) {
    if (formatAction(state, action) === text) return action;
  }
  throw new Error(`"${text}" is not a legal move here in standard notation`);
}
