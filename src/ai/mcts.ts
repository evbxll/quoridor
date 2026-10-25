import type { PlayerAction } from "../engine/actions";
import type { GameState } from "../engine/state";
import type { Evaluation, Evaluator } from "./evaluator";
import { numpySum } from "./numpySum";

/** Value of a finished game for the player to move: the previous mover just won. */
const TERMINAL_VALUE = -1;
export const C_PUCT = 1.5;
export const FPU_REDUCTION = 0.25;

/**
 * A searched position with statistics per legal action. Per-action arrays are
 * indexed by position in `actions`. `valueSums` are from the view of the
 * player choosing at this node.
 */
class Node {
  readonly children = new Map<number, Node>();
  readonly terminal: boolean;
  readonly value: number;
  readonly actions: readonly PlayerAction[];
  readonly priors: Float64Array;
  readonly visits: Int32Array;
  readonly valueSums: Float64Array;
  readonly q: Float64Array;
  totalVisits = 0;

  /** `actions` are the legal actions of `state`; `evaluation` is null for a finished game. */
  constructor(
    readonly state: GameState,
    actions: PlayerAction[],
    evaluation: Evaluation | null,
  ) {
    this.actions = actions;
    this.terminal = evaluation === null;
    if (evaluation === null) {
      this.value = TERMINAL_VALUE;
      this.priors = new Float64Array(0);
    } else {
      this.value = evaluation.value;
      const priors = Float64Array.from(this.actions, (action) => evaluation.policy[action]!);
      const total = numpySum(priors);
      // A policy with no mass on legal moves falls back to uniform.
      this.priors = total > 0 ? priors.map((p) => p / total) : new Float64Array(priors.length).fill(1 / priors.length);
    }
    this.visits = new Int32Array(this.actions.length);
    this.valueSums = new Float64Array(this.actions.length);
    this.q = new Float64Array(this.actions.length);
  }
}

export interface SearchResult {
  /** Legal actions at the root, ascending. */
  readonly actions: readonly PlayerAction[];
  /** Visits per action. */
  readonly visits: readonly number[];
  /** Mean result per action for the root mover (0 if unvisited). */
  readonly qValues: readonly number[];
  /** Mean result over all root visits for the root mover (the evaluation if none). */
  readonly value: number;
  /** The most-visited line from the root. */
  readonly principalVariation: readonly PlayerAction[];
}

type Step = readonly [node: Node, where: number];

/**
 * PUCT search over one game's tree, a port of `ai/mcts.py`.
 *
 * Selection is `Q + c_puct * P * sqrt(1 + N) / (1 + n)`; an unvisited action
 * takes the first-play urgency as its Q: the mean value of the node minus
 * `fpuReduction * sqrt(visited prior mass)`. Values are from the view of the
 * player to move; backpropagation negates once per step. There is no
 * repetition or cap inside the tree.
 */
export class Mcts {
  private root: Node;

  /** Starts a tree at a copy of `state`, evaluating it. */
  constructor(
    private readonly evaluator: Evaluator,
    state: GameState,
    private readonly cPuct = C_PUCT,
    private readonly fpuReduction = FPU_REDUCTION,
  ) {
    this.root = this.evaluatedNode(state.clone());
  }

  /** The root position. Do not mutate it. */
  get rootState(): GameState {
    return this.root.state;
  }

  /** Plays `action` at the root, keeping that child's subtree. Throws if the action is illegal there. */
  advance(action: PlayerAction): void {
    const where = this.root.actions.indexOf(action);
    if (where < 0) throw new Error(`Action ${action} is not legal at the root`);
    let child = this.root.children.get(where);
    if (!child) {
      child = this.evaluatedNode(this.childState(this.root, where));
      this.root.children.set(where, child);
    }
    this.root = child;
  }

  /** Runs simulations from the root, adding to any statistics already there. Throws at a finished game. */
  search(simulations: number): SearchResult {
    if (this.root.terminal) throw new Error("Cannot search a finished game");
    for (let i = 0; i < simulations; i++) {
      const path: Step[] = [];
      const leaf = this.descend(path);
      this.backpropagate(path, leaf.value);
    }
    return this.result();
  }

  /** Follows PUCT to a terminal node or an unexpanded action, which is expanded and returned. */
  private descend(path: Step[]): Node {
    let node = this.root;
    for (;;) {
      const where = this.select(node);
      path.push([node, where]);
      const child = node.children.get(where);
      if (!child) {
        const created = this.evaluatedNode(this.childState(node, where));
        node.children.set(where, created);
        return created;
      }
      if (child.terminal) return child;
      node = child;
    }
  }

  /** The first position in `node.actions` that maximizes the PUCT score. */
  private select(node: Node): number {
    const { q, priors, visits, valueSums } = node;
    let visitedMass = 0;
    let valueTotal = node.value;
    for (let i = 0; i < q.length; i++) {
      if (visits[i]! > 0) {
        visitedMass += priors[i]!;
        valueTotal += valueSums[i]!;
      }
    }
    const fpu = valueTotal / (1 + node.totalVisits) - this.fpuReduction * Math.sqrt(visitedMass);
    const scale = Math.sqrt(1 + node.totalVisits);
    let best = 0;
    let bestScore = -Infinity;
    for (let i = 0; i < q.length; i++) {
      const value = visits[i]! > 0 ? q[i]! : fpu;
      const score = value + this.cPuct * priors[i]! * (scale / (1 + visits[i]!));
      if (score > bestScore) {
        best = i;
        bestScore = score;
      }
    }
    return best;
  }

  /** Adds one result to every (node, action) on the path; `leafValue` is for the player to move at the leaf. */
  private backpropagate(path: readonly Step[], leafValue: number): void {
    let value = leafValue;
    for (let i = path.length - 1; i >= 0; i--) {
      const [node, where] = path[i]!;
      value = -value;
      node.visits[where] = node.visits[where]! + 1;
      node.valueSums[where] = node.valueSums[where]! + value;
      node.q[where] = node.valueSums[where]! / node.visits[where]!;
      node.totalVisits++;
    }
  }

  private result(): SearchResult {
    const root = this.root;
    const total = root.totalVisits;
    return {
      actions: root.actions.slice(),
      visits: Array.from(root.visits),
      qValues: Array.from(root.q),
      value: total > 0 ? numpySum(root.valueSums) / total : root.value,
      principalVariation: this.principalVariation(),
    };
  }

  private principalVariation(maxLength = 20): PlayerAction[] {
    const line: PlayerAction[] = [];
    let node: Node | undefined = this.root;
    while (node && line.length < maxLength && !node.terminal && node.totalVisits > 0) {
      const where = mostVisited(node.visits);
      line.push(node.actions[where]!);
      node = node.children.get(where);
    }
    return line;
  }

  private childState(node: Node, where: number): GameState {
    const state = node.state.clone();
    state.play(node.actions[where]!);
    return state;
  }

  private evaluatedNode(state: GameState): Node {
    if (state.isEnd()) return new Node(state, [], null);
    const legal = state.legalActions();
    return new Node(state, legal, this.evaluator.evaluate(state, legal));
  }
}

/** Index of the first maximum. */
function mostVisited(visits: ArrayLike<number>): number {
  let best = 0;
  for (let i = 1; i < visits.length; i++) if (visits[i]! > visits[best]!) best = i;
  return best;
}

/**
 * Chooses a move from a search result. Temperature 0 plays the most visited
 * action (ties to the lowest index); otherwise it samples among the visited
 * actions in proportion to `visits ** (1 / temperature)` using `random`, a
 * function returning floats in [0, 1).
 *
 * Unlike Python, which gives an unvisited action a tiny weight of 1e-12 before
 * the power, this never picks an unvisited action. The two agree to within
 * 1e-6 relative weight for temperatures up to 2; above that Python starts to
 * play moves the search never looked at.
 */
export function selectAction(result: SearchResult, temperature: number, random: () => number): PlayerAction {
  const best = mostVisited(result.visits);
  if (temperature <= 0) return result.actions[best]!;
  const logits = result.visits.map((v) => (v > 0 ? Math.log(v) / temperature : -Infinity));
  const top = Math.max(...logits);
  const weights = logits.map((l) => Math.exp(l - top));
  let remaining = random() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < weights.length; i++) {
    remaining -= weights[i]!;
    if (remaining < 0) return result.actions[i]!;
  }
  return result.actions[best]!;
}
