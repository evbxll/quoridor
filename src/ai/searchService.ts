import type { PlayerAction } from "../engine/actions";
import { formatAction, parseMove } from "../engine/notation";
import { GameState } from "../engine/state";
import type { Evaluator } from "./evaluator";
import { C_PUCT, FPU_REDUCTION, Mcts, selectAction } from "./mcts";
import type { EngineSpec, Request, Response } from "./protocol";
import { seededRandom } from "./random";

/** Milliseconds of uninterrupted search before the worker lets its message queue run. */
const SLICE_MS = 15;

/** Builds the evaluator for an engine spec. */
export type EvaluatorFactory = (engine: EngineSpec) => Promise<Evaluator>;

interface Tree {
  readonly mcts: Mcts;
  readonly size: number;
  readonly moves: readonly string[];
  readonly evaluator: Evaluator;
  /** What the tree's statistics were gathered under; a search under other settings starts afresh. */
  readonly settings: string;
}

/** A search that is queued or running. */
interface Run {
  readonly id: number;
  cancelled: boolean;
}

/** Lets pending messages run: a promise that is already resolved would not. */
function nextTask(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * The search worker's logic, apart from the `Worker` plumbing so tests can
 * drive it directly. Returns the handler for page messages; answers go to
 * `post`. Requests run one after another; a new search, or a configure, cancels
 * the searches queued or running. The tree is kept between searches of the same game.
 */
export function createSearchService(post: (response: Response) => void, makeEvaluator: EvaluatorFactory): (request: Request) => void {
  let evaluator: Evaluator | null = null;
  let tree: Tree | null = null;
  const runs = new Set<Run>();
  let queue: Promise<void> = Promise.resolve();

  const fail = (id: number, error: unknown): void => {
    post({ type: "error", id, message: error instanceof Error ? error.message : String(error) });
  };

  /** The tree for this game: advanced when `moves` extends the last search's and the settings match, rebuilt otherwise. */
  const treeFor = async (request: Extract<Request, { type: "search" }>, current: Evaluator): Promise<Tree> => {
    const { size, moves } = request;
    const cPuct = request.cPuct ?? C_PUCT;
    const fpuReduction = request.fpuReduction ?? FPU_REDUCTION;
    const settings = [request.simulations, request.temperature, cPuct, fpuReduction].join("|");
    if (tree && tree.evaluator === current && tree.size === size && tree.settings === settings && tree.moves.length <= moves.length && tree.moves.every((m, i) => m === moves[i])) {
      for (const move of moves.slice(tree.moves.length)) {
        await tree.mcts.advance(parseMove(tree.mcts.rootState, move));
        // Recorded move by move, so a later illegal move leaves the tree and its moves in step.
        tree = { ...tree, moves: [...tree.moves, move] };
      }
      return tree;
    }
    tree = null;
    const state = GameState.initial(size);
    for (const move of moves) state.play(parseMove(state, move));
    tree = { mcts: await Mcts.create(current, state, cPuct, fpuReduction), size, moves, evaluator: current, settings };
    return tree;
  };

  /** A cancelled search leaves a partly searched tree, which a later search of the same position must not inherit. */
  const abandon = (run: Run): void => {
    tree = null;
    post({ type: "cancelled", id: run.id });
  };

  const search = async (request: Extract<Request, { type: "search" }>, mine: Run): Promise<void> => {
    if (!evaluator) throw new Error("The worker is not configured");
    const { mcts } = await treeFor(request, evaluator);
    if (mcts.rootState.isEnd()) throw new Error("The game is over");
    let sliceStart = performance.now();
    for (let done = 0; done < request.simulations; done++) {
      if (mine.cancelled) return abandon(mine);
      await mcts.search(1);
      if (performance.now() - sliceStart >= SLICE_MS) {
        await nextTask();
        sliceStart = performance.now();
      }
    }
    if (mine.cancelled) return abandon(mine);
    const result = await mcts.search(0);
    const state = mcts.rootState;
    const action = selectAction(result, request.temperature, seededRandom(request.seed));
    post({
      type: "result",
      id: mine.id,
      move: formatAction(state, action),
      moves: result.actions.map((a) => formatAction(state, a)),
      visits: result.visits,
      value: result.value,
      principalVariation: principalMoves(state, result.principalVariation),
    });
  };

  const enqueue = (id: number, task: () => Promise<void>): void => {
    queue = queue.then(task).catch((error: unknown) => {
      tree = null;
      fail(id, error);
    });
  };

  return (request) => {
    if (request.type === "cancel") {
      for (const run of runs) if (run.id === request.id) run.cancelled = true;
      return;
    }
    for (const run of runs) run.cancelled = true;
    const id = request.id;
    if (request.type === "configure") {
      enqueue(id, async () => {
        evaluator = await makeEvaluator(request.engine);
        tree = null;
        post({ type: "configured", id });
      });
      return;
    }
    const mine: Run = { id, cancelled: false };
    runs.add(mine);
    enqueue(id, async () => {
      try {
        if (mine.cancelled) post({ type: "cancelled", id });
        else await search(request, mine);
      } finally {
        runs.delete(mine);
      }
    });
  };
}

function principalMoves(root: GameState, line: readonly PlayerAction[]): string[] {
  const state = root.clone();
  return line.map((action) => {
    const name = formatAction(state, action);
    state.play(action);
    return name;
  });
}
