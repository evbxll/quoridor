import { actionCount } from "../engine/constants";
import type { PlayerAction } from "../engine/actions";
import type { GameState } from "../engine/state";

/** A policy over the full action space (PLAYER frame of the mover) and a value in [-1, 1] for the mover. */
export interface Evaluation {
  readonly policy: ArrayLike<number>;
  readonly value: number;
}

export interface Evaluator {
  /**
   * Evaluates an unfinished position; `legal` is its legal actions, ascending (the search already has them).
   * A network runs asynchronously (onnxruntime-web has no synchronous call); the table and the heuristic
   * answer at once, and their concrete signatures say so.
   */
  evaluate(state: GameState, legal: readonly PlayerAction[]): Evaluation | Promise<Evaluation>;
}

/** One recorded evaluation: the policy at the position's legal actions, ascending, and the value. */
export interface RecordedEvaluation {
  readonly key: string;
  readonly policy: readonly number[];
  readonly value: number;
}

/**
 * Replays recorded evaluations by position key. Tests use it to run the
 * search on exactly the numbers Python's search saw, which isolates the
 * search from floating-point differences in a network.
 */
export class TableEvaluator implements Evaluator {
  private readonly table = new Map<string, RecordedEvaluation>();

  constructor(recorded: readonly RecordedEvaluation[]) {
    for (const entry of recorded) this.table.set(entry.key, entry);
  }

  evaluate(state: GameState, legal: readonly PlayerAction[]): Evaluation {
    const key = state.positionKey();
    const entry = this.table.get(key);
    if (!entry) throw new Error(`No recorded evaluation for ${key}`);
    if (legal.length !== entry.policy.length) throw new Error(`Recorded policy does not fit the legal actions of ${key}`);
    const policy = new Float64Array(actionCount(state.size));
    legal.forEach((action, i) => {
      policy[action] = entry.policy[i]!;
    });
    return { policy, value: entry.value };
  }
}
