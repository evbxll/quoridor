import type { PlayerAction } from "../engine/actions";
import { formatAction, parseMove } from "../engine/notation";
import { GameState } from "../engine/state";
import type { Evaluator } from "./evaluator";
import { C_PUCT, FPU_REDUCTION, Mcts, selectAction } from "./mcts";
import { type EngineSpec, type Request, type Response, slotOf } from "./protocol";
import { seededRandom } from "./random";
import { createYielder } from "./yielder";

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
  /** The evaluator's slot (`slotOf`), known once the run starts: the default network is the one configured by then. */
  slot: string | null;
  /** Whether the run uses the game's kept tree. */
  readonly reuse: boolean;
  cancelled: boolean;
}

/**
 * The search worker's logic, apart from the `Worker` plumbing so tests can
 * drive it directly. Returns the handler for page messages; answers go to
 * `post`. Requests run one after another; a new search, or a configure, cancels
 * the searches queued or running. The tree is kept between searches of the same game.
 */
export function createSearchService(post: (response: Response) => void, makeEvaluator: EvaluatorFactory): (request: Request) => void {
  const evaluators = new Map<string, Evaluator>();
  const trees = new Map<string, Tree>();
  /** The model that searches naming none use. */
  let defaultModel: string | undefined;
  const runs = new Set<Run>();
  let queue: Promise<void> = Promise.resolve();

  const fail = (id: number, error: unknown): void => {
    post({ type: "error", id, message: error instanceof Error ? error.message : String(error) });
  };

  /** The tree for this game: advanced when `moves` extends the last search's and the settings match, rebuilt otherwise. */
  const treeFor = async (request: Extract<Request, { type: "search" }>, slot: string, current: Evaluator): Promise<Tree> => {
    const { size, moves } = request;
    const cPuct = request.cPuct ?? C_PUCT;
    const fpuReduction = request.fpuReduction ?? FPU_REDUCTION;
    if (request.reuseTree === false) {
      const state = GameState.initial(size);
      for (const move of moves) state.play(parseMove(state, move));
      return { mcts: await Mcts.create(current, state, cPuct, fpuReduction), size, moves, evaluator: current, settings: "" };
    }
    const tree = trees.get(slot);
    const settings = [request.simulations, request.temperature, cPuct, fpuReduction].join("|");
    if (tree && tree.evaluator === current && tree.size === size && tree.settings === settings && tree.moves.length <= moves.length && tree.moves.every((m, i) => m === moves[i])) {
      let kept: Tree = tree;
      for (const move of moves.slice(tree.moves.length)) {
        await kept.mcts.advance(parseMove(kept.mcts.rootState, move));
        // Recorded move by move, so a later illegal move leaves the tree and its moves in step.
        kept = { ...kept, moves: [...kept.moves, move] };
        trees.set(slot, kept);
      }
      return kept;
    }
    trees.delete(slot);
    const state = GameState.initial(size);
    for (const move of moves) state.play(parseMove(state, move));
    const fresh: Tree = { mcts: await Mcts.create(current, state, cPuct, fpuReduction), size, moves, evaluator: current, settings };
    trees.set(slot, fresh);
    return fresh;
  };

  /** A cancelled search leaves a partly searched tree, which a later search of the same position must not inherit. */
  const abandon = (run: Run): void => {
    if (run.reuse && run.slot !== null) trees.delete(run.slot);
    post({ type: "cancelled", id: run.id });
  };

  const search = async (request: Extract<Request, { type: "search" }>, mine: Run): Promise<void> => {
    const slot = slotOf(request.engine, request.model ?? defaultModel);
    mine.slot = slot;
    const evaluator = evaluators.get(slot);
    if (!evaluator) throw new Error(request.model === undefined ? `The ${request.engine} engine is not configured` : `The model ${request.model} is not configured`);
    const { mcts } = await treeFor(request, slot, evaluator);
    if (mcts.rootState.isEnd()) throw new Error("The game is over");
    const yielder = createYielder();
    try {
      let sliceStart = performance.now();
      for (let done = 0; done < request.simulations; done++) {
        if (mine.cancelled) return abandon(mine);
        await mcts.search(1);
        if (performance.now() - sliceStart >= SLICE_MS) {
          await yielder.next();
          sliceStart = performance.now();
        }
      }
    } finally {
      yielder.close();
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

  const enqueue = (id: number, task: () => Promise<void>, keepsTrees = true): void => {
    queue = queue.then(task).catch((error: unknown) => {
      if (keepsTrees) trees.clear();
      fail(id, error);
    });
  };

  return (request) => {
    if (request.type === "cancel") {
      for (const run of runs) if (run.id === request.id) run.cancelled = true;
      return;
    }
    const id = request.id;
    // Configuring waits its turn: a search in flight (the bot's move, say) finishes with the evaluator it started with.
    if (request.type === "configure") {
      const spec = request.engine;
      enqueue(id, async () => {
        const slot = slotOf(spec.kind, spec.kind === "network" ? spec.modelId : undefined);
        const replaced = evaluators.get(slot);
        evaluators.set(slot, await makeEvaluator(spec));
        if (spec.kind === "network" && spec.asDefault) defaultModel = spec.modelId;
        trees.delete(slot);
        await replaced?.dispose?.();
        post({ type: "configured", id });
      });
      return;
    }
    if (request.type === "release") {
      const slot = slotOf("network", request.model);
      enqueue(id, async () => {
        const released = evaluators.get(slot);
        evaluators.delete(slot);
        trees.delete(slot);
        if (defaultModel === request.model) defaultModel = undefined;
        await released?.dispose?.();
        post({ type: "released", id });
      });
      return;
    }
    for (const run of runs) run.cancelled = true;
    const reuse = request.reuseTree !== false;
    const mine: Run = { id, slot: null, reuse, cancelled: false };
    runs.add(mine);
    enqueue(id, async () => {
      try {
        if (mine.cancelled) post({ type: "cancelled", id });
        else await search(request, mine);
      } finally {
        runs.delete(mine);
      }
    }, reuse);
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
