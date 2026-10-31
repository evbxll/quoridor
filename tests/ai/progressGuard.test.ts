import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { type RecordedEvaluation, TableEvaluator } from "../../src/ai/evaluator";
import type { Evaluator } from "../../src/ai/evaluator";
import { HeuristicEvaluator } from "../../src/ai/heuristic";
import { Mcts, selectAction } from "../../src/ai/mcts";
import { keepProgress } from "../../src/ai/progressGuard";
import type { Request, Response, SearchResponse } from "../../src/ai/protocol";
import { seededRandom } from "../../src/ai/random";
import { createSearchService } from "../../src/ai/searchService";
import { actionCount, NUM_PAWN_MOVES } from "../../src/engine/constants";
import { formatAction, parseMove } from "../../src/engine/notation";
import { GameState } from "../../src/engine/state";
import { openingFor } from "../../src/ui/openings";

/** The owner's link: player 1 (heuristic, 1600 searches) is to move at the end, and h2 takes it nowhere while h4 gets it nearer. */
const REPRO = "d1.d9.e1.c9.b8h.d9.d8h.e9.e8v.d9.a1h.c9.c1h.b9.e2.a9.e1h.a8.g1h.a7.e3.a6.a5h.b6.b6v.b7.b7h.a7.e4.a8.f4.b8.f3.c8.g3.d8.h3.d7".split(".");

function positionOf(moves: readonly string[], size = 9): GameState {
  const state = GameState.initial(size);
  for (const move of moves) state.play(parseMove(state, move));
  return state;
}

/** The mover's shortest path to its goal after playing `move` at `state`. */
function pathAfter(state: GameState, move: string): number {
  const next = state.clone();
  next.play(parseMove(state, move));
  return next.pathDists()[state.p1Turn ? 0 : 1]!;
}

/** A result over the legal actions of `state` with the visits named in `visits` (others unvisited). */
function resultWith(state: GameState, visits: Record<string, number>) {
  const actions = state.legalActions();
  return { actions, visits: actions.map((a) => visits[formatAction(state, a)] ?? 0), qValues: actions.map(() => 0), value: 0, principalVariation: [] };
}

type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;

/** What a search service answers; heuristic searches only. */
function searcher() {
  const waiting = new Map<number, (r: Response) => void>();
  const handle = createSearchService((r) => waiting.get(r.id)?.(r), async () => new HeuristicEvaluator());
  let nextId = 1;
  const request = (r: DistributiveOmit<Request, "id">): Promise<Response> =>
    new Promise((resolve) => {
      const id = nextId++;
      waiting.set(id, resolve);
      handle({ ...r, id } as Request);
    });
  const ready = request({ type: "configure", engine: { kind: "heuristic" } });
  return {
    async search(size: number, moves: readonly string[], simulations: number, temperature = 0, seed = 1): Promise<SearchResponse> {
      await ready;
      const reply = await request({ type: "search", engine: "heuristic", size, moves, simulations, temperature, seed, reuseTree: false });
      if (reply.type !== "result") throw new Error(JSON.stringify(reply));
      return reply;
    },
  };
}

describe("keepProgress", () => {
  const state = positionOf(REPRO);
  // The 1600-simulation root of the repro: the sideways h2 (it does not shorten the path) has the most visits.
  const visits = { h2: 821, h4: 456, i3: 220, g3: 103 };

  it("sees the repro as a position where h2 does not shorten the path and h4 does", () => {
    const distance = state.pathDists()[0]!;
    expect(pathAfter(state, "h2")).toBeGreaterThanOrEqual(distance);
    expect(pathAfter(state, "h4")).toBeLessThan(distance);
  });

  it("replaces a non-shortening pawn move by the most visited shortening pawn move", () => {
    const result = resultWith(state, visits);
    expect(formatAction(state, keepProgress(state, result, parseMove(state, "h2")))).toBe("h4");
  });

  it("leaves a shortening choice alone, whatever the other moves' visits", () => {
    const result = resultWith(state, { ...visits, h4: 1 });
    expect(keepProgress(state, result, parseMove(state, "h4"))).toBe(parseMove(state, "h4"));
  });

  it("never touches a wall, with a shortening pawn move legal", () => {
    const start = GameState.initial(7);
    const wall = start.legalActions().find((a) => a >= NUM_PAWN_MOVES)!;
    const forward = parseMove(start, "d2");
    expect(pathAfter(start, "d2")).toBeLessThan(start.pathDists()[0]!);
    const result = resultWith(start, { d2: 10, [formatAction(start, wall)]: 5 });
    expect(keepProgress(start, result, wall)).toBe(wall);
    expect(keepProgress(start, result, forward)).toBe(forward);
  });

  it("leaves the choice untouched where no legal pawn move shortens the path", () => {
    // Two pawns face each other with the jump blocked, so every pawn move for the mover (player 2) is sideways or back.
    const stuck = GameState.fromKey("5|2|c4|b4|0,0|a1h,a3h,a4v,d2h,d3h,d4v");
    const distance = stuck.pathDists()[1]!;
    const pawns = stuck.legalActions().filter((a) => a < NUM_PAWN_MOVES);
    expect(pawns.length).toBeGreaterThan(1);
    for (const action of pawns) {
      const next = stuck.clone();
      next.play(action);
      expect(next.pathDists()[1]!).toBeGreaterThanOrEqual(distance);
    }
    for (const action of pawns) {
      const result = { ...resultWith(stuck, {}), visits: stuck.legalActions().map((a) => (a === action ? 7 : 1)) };
      expect(keepProgress(stuck, result, action)).toBe(action);
    }
  });
});

describe("the search service's heuristic move", () => {
  it("is a path-shortening move in the repro at 1600 searches (it was h2)", { timeout: 120_000 }, async () => {
    const reply = await searcher().search(9, REPRO, 1600);
    const state = positionOf(REPRO);
    expect(pathAfter(state, reply.move)).toBeLessThan(state.pathDists()[0]!);
    // The visits are the search's own and still favour h2: only the move changed.
    expect(reply.visits[reply.moves.indexOf("h2")]).toBeGreaterThan(reply.visits[reply.moves.indexOf(reply.move)]!);
  });

  it("is the unguarded search's move, move for move, in 100-search games from several openings", { timeout: 120_000 }, async () => {
    const { search } = searcher();
    for (const opening of [0, 1, 2].map((index) => openingFor(7, 5, index))) {
      const moves = [...opening];
      const state = positionOf(moves, 7);
      while (!state.isEnd() && moves.length < 70) {
        const mcts = await Mcts.create(new HeuristicEvaluator(), state);
        const unguarded = formatAction(state, selectAction(await mcts.search(100), 0, Math.random));
        const { move } = await search(7, moves, 100);
        expect(move, moves.join(".")).toBe(unguarded);
        state.play(parseMove(state, move));
        moves.push(move);
      }
    }
  });

  it("is the sampled move, unguarded, for a varied bot (Beginner's sideways steps stay)", async () => {
    // A uniform evaluator spreads the few visits, so sampling often picks a pawn move that does not shorten the path.
    const uniform: Evaluator = { evaluate: async (state) => ({ policy: new Float64Array(actionCount(state.size)).fill(1), value: 0 }) };
    const waiting = new Map<number, (r: Response) => void>();
    const handle = createSearchService((r) => waiting.get(r.id)?.(r), async () => uniform);
    const request = (r: Request): Promise<Response> => new Promise((resolve) => { waiting.set(r.id, resolve); handle(r); });
    await request({ type: "configure", id: 1, engine: { kind: "heuristic" } });
    const state = GameState.initial(7);
    const distance = state.pathDists()[0]!;
    let sideways = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const mcts = await Mcts.create(uniform, state);
      const sampled = formatAction(state, selectAction(await mcts.search(8), 1, seededRandom(seed)));
      const reply = await request({ type: "search", id: 1 + seed, engine: "heuristic", size: 7, moves: [], simulations: 8, temperature: 1, seed, reuseTree: false });
      if (reply.type !== "result") throw new Error(JSON.stringify(reply));
      expect(reply.move).toBe(sampled);
      if (!/[hv]$/.test(sampled) && pathAfter(state, sampled) >= distance) sideways++;
    }
    expect(sideways).toBeGreaterThan(0);
  });
});

describe("search.json", () => {
  interface Search {
    key: string;
    simulations: number;
    c_puct: number;
    fpu_reduction: number;
    evaluations: RecordedEvaluation[];
    best_move: string;
  }
  const { searches } = JSON.parse(readFileSync(new URL("../../fixtures/search.json", import.meta.url), "utf8")) as { searches: Search[] };

  it("has the recorded best move of every search after the guard, as before", async () => {
    expect(searches.length).toBeGreaterThanOrEqual(12);
    for (const s of searches) {
      const state = GameState.fromKey(s.key);
      const mcts = await Mcts.create(new TableEvaluator(s.evaluations), state, s.c_puct, s.fpu_reduction);
      const result = await mcts.search(s.simulations);
      const chosen = selectAction(result, 0, Math.random);
      expect(formatAction(state, keepProgress(state, result, chosen)), s.key).toBe(s.best_move);
    }
  });
});
