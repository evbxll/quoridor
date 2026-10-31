import type { PlayerAction } from "../engine/actions";
import { NUM_PAWN_MOVES } from "../engine/constants";
import type { GameState } from "../engine/state";
import type { SearchResult } from "./mcts";

/**
 * Keeps a search from choosing a pawn move that does not shorten the mover's shortest path to the goal
 * while another pawn move that does is legal: it then returns the most visited of those (ties to the lowest
 * index). Any other choice, a wall in particular, is returned as it is.
 *
 * The heuristic's value ignores walls in hand, and a deep search of the forward move can collapse its
 * value, so a long heuristic search sometimes steps sideways or back for nothing.
 */
export function keepProgress(root: GameState, result: SearchResult, chosen: PlayerAction): PlayerAction {
  if (chosen >= NUM_PAWN_MOVES) return chosen;
  const mover = root.p1Turn ? 0 : 1;
  const distance = root.pathDists()[mover]!;
  const pathAfter = (action: PlayerAction): number => {
    const next = root.clone();
    next.play(action);
    return next.pathDists()[mover]!;
  };
  if (pathAfter(chosen) < distance) return chosen;
  let best: PlayerAction | null = null;
  let bestVisits = -1;
  for (let i = 0; i < result.actions.length; i++) {
    const action = result.actions[i]!;
    if (action >= NUM_PAWN_MOVES || result.visits[i]! <= bestVisits || pathAfter(action) >= distance) continue;
    best = action;
    bestVisits = result.visits[i]!;
  }
  return best ?? chosen;
}
