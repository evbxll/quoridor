import { maxPlies } from "../engine/constants";
import type { GameController } from "./controller";

/** Who played the last move and what it was ("Bot played e8."), or an empty string before any move. */
function lastMoveText(controller: GameController): string {
  const moves = controller.moves;
  if (moves.length === 0) return "";
  const mover = moves.length % 2 === 1 ? "p1" : "p2";
  return `${mover === controller.human ? "You" : "The bot"} played ${moves[moves.length - 1]}. `;
}

/**
 * The status line under the board, also read out by screen readers: the last
 * move, then whose turn it is or how the game ended and why.
 */
export function statusText(controller: GameController): string {
  const played = lastMoveText(controller);
  const result = controller.result;
  if (result) {
    if (result.reason === "repetition") return `${played}Draw by threefold repetition.`;
    if (result.reason === "cap") return `${played}Draw: the limit of ${maxPlies(controller.size)} moves was reached.`;
    return `${played}${result.winner === controller.human ? "You win by reaching the goal row." : "The bot wins by reaching the goal row."}`;
  }
  if (controller.error !== null) return `${played}The bot could not move (${controller.error}). Choose Retry.`;
  if (controller.thinking) return `${played}The bot is thinking.`;
  const state = controller.state;
  const mine = controller.human === "p1" ? 0 : 1;
  return `${played}Your move. Walls left: you ${state.wallsLeft(mine)}, bot ${state.wallsLeft(mine === 0 ? 1 : 0)}.`;
}

/** The move list as rows of one move per player: `[["e2", "e8"], ["e3"]]`. */
export function moveRows(moves: readonly string[]): string[][] {
  const rows: string[][] = [];
  for (let i = 0; i < moves.length; i += 2) rows.push(moves.slice(i, i + 2));
  return rows;
}
