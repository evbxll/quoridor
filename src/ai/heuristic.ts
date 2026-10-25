import { flipAnchor, type PlayerAction, HORIZONTAL, MOVE_MAPPING, type Orientation, VERTICAL } from "../engine/actions";
import { actionCount, NUM_PAWN_MOVES } from "../engine/constants";
import type { GameState } from "../engine/state";
import type { Evaluation, Evaluator } from "./evaluator";

/** Prior weight of a pawn move that shortens the mover's path. */
const STEP_WEIGHT = 1;
/** Prior weight per step a wall adds to the opponent's shortest path. */
const LENGTHEN_WEIGHT = 1;
/** Prior weight of a wall that cuts the opponent's shortest paths without lengthening them. */
const CUT_WEIGHT = 0.05;
/** Prior weight of any other legal action. */
const OTHER_WEIGHT = 0.01;
/** How fast the value saturates. */
const VALUE_SCALE = 0.3;

/**
 * A network-free evaluator, a port of `ai/heuristic.py`.
 *
 * Value (mover's view): `tanh(0.3 * (opponent distance - own distance + 0.5))`.
 * Priors: pawn moves along a shortest path, and walls in proportion to the
 * steps they add to the opponent's shortest path; walls that only cut a
 * shortest path keep a little more than the rest.
 */
export class HeuristicEvaluator implements Evaluator {
  evaluate(state: GameState, legal: readonly PlayerAction[]): Evaluation {
    const size = state.size;
    const mover = state.p1Turn ? 0 : 1;
    const opponent = state.p1Turn ? 1 : 0;
    const ownGoal = state.p1Turn ? 0 : size - 1;
    const oppGoal = state.p1Turn ? size - 1 : 0;
    const own = state.row(mover) * size + state.col(mover);
    const opp = state.row(opponent) * size + state.col(opponent);
    const goalCells = (row: number): number[] => Array.from({ length: size }, (_, c) => row * size + c);
    const ownToGoal = state.distanceField(goalCells(ownGoal));
    const oppToGoal = state.distanceField(goalCells(oppGoal));
    const oppFrom = state.distanceField([opp]);
    const total = oppToGoal[opp]!;

    // A wall cuts a shortest path if it blocks an edge that some shortest path uses.
    const usedByShortestPath = (from: number, to: number): boolean =>
      oppFrom[from]! >= 0 && oppToGoal[to]! >= 0 && oppFrom[from]! + 1 + oppToGoal[to]! === total;
    const onShortestEdge = (a: number, b: number): boolean => usedByShortestPath(a, b) || usedByShortestPath(b, a);

    const sign = state.p1Turn ? 1 : -1;
    const span = size - 1;
    const weights = new Float32Array(actionCount(size));
    for (const action of legal) {
      if (action < NUM_PAWN_MOVES) {
        const [dRow, dCol] = MOVE_MAPPING[action]!;
        const target = (state.row(mover) + sign * dRow) * size + state.col(mover) + sign * dCol;
        weights[action] = ownToGoal[target]! < ownToGoal[own]! ? STEP_WEIGHT : OTHER_WEIGHT;
        continue;
      }
      const index = action - NUM_PAWN_MOVES;
      const orientation: Orientation = index < span * span ? HORIZONTAL : VERTICAL;
      let row = Math.floor((index % (span * span)) / span);
      let col = index % span;
      if (!state.p1Turn) {
        row = flipAnchor(row, size);
        col = flipAnchor(col, size);
      }
      let cuts = false;
      for (let k = 0; k < 2; k++) {
        cuts ||=
          orientation === HORIZONTAL
            ? onShortestEdge(row * size + col + k, (row + 1) * size + col + k)
            : onShortestEdge((row + k) * size + col, (row + k) * size + col + 1);
      }
      if (!cuts) {
        weights[action] = OTHER_WEIGHT;
        continue;
      }
      const added = state.distanceField(goalCells(oppGoal), { row, col, orientation })[opp]! - total;
      weights[action] = added > 0 ? LENGTHEN_WEIGHT * added : CUT_WEIGHT;
    }
    const lead = total - ownToGoal[own]! + 0.5;
    return { policy: weights, value: Math.tanh(VALUE_SCALE * lead) };
  }
}
