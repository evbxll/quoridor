import { describe, expect, it } from "vitest";
import type { Evaluation, Evaluator } from "../../src/ai/evaluator";
import type { EngineSpec, Request, Response } from "../../src/ai/protocol";
import { LoopbackWorker } from "../helpers/loopback";
import { SearchClient } from "../../src/ai/searchClient";
import { createSearchService } from "../../src/ai/searchService";
import { actionCount } from "../../src/engine/constants";
import type { GameState } from "../../src/engine/state";

/** A uniform evaluator that counts its calls and answers on a later task, as a network would. */
class FakeEvaluator implements Evaluator {
  calls = 0;
  disposed = 0;

  dispose(): void {
    this.disposed++;
  }

  async evaluate(state: GameState): Promise<Evaluation> {
    this.calls++;
    await new Promise((resolve) => setImmediate(resolve));
    return { policy: new Float64Array(actionCount(state.size)).fill(1), value: 0 };
  }
}

const engine: EngineSpec = { kind: "heuristic" };

type SearchRequest = Extract<Request, { type: "search" }>;

function search(id: number, moves: string[], extra: Partial<SearchRequest> = {}): Request {
  return { type: "search", id, engine: "heuristic", size: 5, moves, simulations: 10, temperature: 0, seed: 1, ...extra };
}

function setup() {
  const evaluator = new FakeEvaluator();
  const outbox: Response[] = [];
  const configured: EngineSpec[] = [];
  const handle = createSearchService(
    (response) => outbox.push(response),
    async (spec) => {
      configured.push(spec);
      return evaluator;
    },
  );
  /** The first response to request `id`. */
  const reply = async (id: number): Promise<Response> => {
    for (let i = 0; i < 3000; i++) {
      const found = outbox.find((r) => r.id === id);
      if (found) return found;
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    throw new Error(`no response to ${id}`);
  };
  const resultOf = async (id: number) => {
    const response = await reply(id);
    if (response.type !== "result") throw new Error(`expected a result, got ${JSON.stringify(response)}`);
    return response;
  };
  return { evaluator, outbox, configured, handle, reply, resultOf };
}

const total = (visits: readonly number[]): number => visits.reduce((a, b) => a + b, 0);

describe("search service", () => {
  it("refuses a search before it is configured", async () => {
    const { handle, reply } = setup();
    handle(search(1, []));
    expect(await reply(1)).toMatchObject({ type: "error", message: "The heuristic engine is not configured" });
  });

  it("answers with a legal move, visits for every legal move and the principal variation", async () => {
    const { handle, reply, resultOf, configured } = setup();
    handle({ type: "configure", id: 1, engine });
    expect(await reply(1)).toEqual({ type: "configured", id: 1 });
    expect(configured).toEqual([engine]);
    handle(search(2, []));
    const result = await resultOf(2);
    expect(result.moves).toContain(result.move);
    expect(result.visits).toHaveLength(result.moves.length);
    expect(total(result.visits)).toBe(10);
    expect(result.moves[result.visits.indexOf(Math.max(...result.visits))]).toBe(result.move);
    expect(result.principalVariation[0]).toBe(result.move);
  });

  it("keeps the tree when the moves extend the last search, and rebuilds after an undo", async () => {
    const { handle, resultOf } = setup();
    handle({ type: "configure", id: 1, engine });
    handle(search(2, [], { simulations: 30 }));
    const first = await resultOf(2);

    // The bot's move was the most visited, so a search that kept the tree starts with that child's visits.
    handle(search(3, [first.move], { simulations: 30 }));
    expect(total((await resultOf(3)).visits)).toBe(Math.max(...first.visits) - 1 + 30);

    // Back to the start (an undo): the tree is rebuilt, so nothing has been visited.
    handle(search(4, [], { simulations: 0 }));
    expect(total((await resultOf(4)).visits)).toBe(0);
  });

  it("starts afresh when the budget or temperature changes (another level)", async () => {
    const { handle, resultOf } = setup();
    handle({ type: "configure", id: 1, engine });
    handle(search(2, [], { simulations: 30 }));
    const first = await resultOf(2);
    handle(search(3, [first.move], { simulations: 5, temperature: 1 }));
    expect(total((await resultOf(3)).visits)).toBe(5);
  });

  it("does not keep what a cancelled search gathered: cancel then search equals a fresh search", async () => {
    const { handle, reply, resultOf, evaluator } = setup();
    handle({ type: "configure", id: 1, engine });
    handle(search(2, ["c2"], { simulations: 100000 }));
    while (evaluator.calls < 20) await new Promise((resolve) => setTimeout(resolve, 1));
    handle({ type: "cancel", id: 2 });
    expect(await reply(2)).toEqual({ type: "cancelled", id: 2 });
    handle(search(3, ["c2"], { simulations: 25 }));
    const again = await resultOf(3);

    const fresh = setup();
    fresh.handle({ type: "configure", id: 1, engine });
    fresh.handle(search(2, ["c2"], { simulations: 25 }));
    const reference = await fresh.resultOf(2);
    expect(total(again.visits)).toBe(25);
    expect(again.visits).toEqual(reference.visits);
  });

  it("does not keep a tree after a failed request", async () => {
    const { handle, reply, resultOf } = setup();
    handle({ type: "configure", id: 1, engine });
    handle(search(2, [], { simulations: 30 }));
    await resultOf(2);
    handle(search(3, ["a9"]));
    expect((await reply(3)).type).toBe("error");
    handle(search(4, [], { simulations: 30 }));
    expect(total((await resultOf(4)).visits)).toBe(30);
  });

  it("samples with a seed: the same seed gives the same move", async () => {
    const { handle, resultOf } = setup();
    handle({ type: "configure", id: 1, engine });
    const moves: string[] = [];
    for (const id of [2, 3, 4]) {
      handle(search(id, [], { temperature: 1, seed: 7, simulations: 15 }));
      moves.push((await resultOf(id)).move);
    }
    expect(new Set(moves).size).toBe(1);
  });

  it("cancels a running search and then serves the next one", async () => {
    const { handle, reply, resultOf, evaluator, outbox } = setup();
    handle({ type: "configure", id: 1, engine });
    handle(search(2, [], { simulations: 100000 }));
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(evaluator.calls).toBeGreaterThan(0);
    handle({ type: "cancel", id: 2 });
    expect(await reply(2)).toEqual({ type: "cancelled", id: 2 });
    handle(search(3, []));
    await resultOf(3);
    expect(outbox.filter((r) => r.id === 2)).toHaveLength(1);
  });

  it("lets a newer search supersede the one in flight", async () => {
    const { handle, reply, resultOf } = setup();
    handle({ type: "configure", id: 1, engine });
    handle(search(2, [], { simulations: 100000 }));
    handle(search(3, ["c2"]));
    expect(await reply(2)).toEqual({ type: "cancelled", id: 2 });
    await resultOf(3);
  });

  it("cancels a search that has not started when a newer one arrives", async () => {
    const { handle, reply, resultOf } = setup();
    handle({ type: "configure", id: 1, engine });
    handle(search(2, [], { simulations: 100000 }));
    handle(search(3, [], { simulations: 100000 }));
    handle(search(4, []));
    expect(await reply(3)).toEqual({ type: "cancelled", id: 3 });
    await resultOf(4);
  });

  it("ignores a cancel for a search that is not running", async () => {
    const { handle, resultOf } = setup();
    handle({ type: "configure", id: 1, engine });
    handle({ type: "cancel", id: 99 });
    handle(search(2, []));
    await resultOf(2);
  });

  it("reports an illegal move and a finished game, and keeps working", async () => {
    const { handle, reply, resultOf } = setup();
    handle({ type: "configure", id: 1, engine });
    handle(search(2, ["a9"]));
    expect(await reply(2)).toMatchObject({ type: "error" });
    // Player 1 walks up the c file while player 2 steps aside, and wins on the seventh ply.
    handle(search(3, ["c2", "b5", "c3", "a5", "c4", "b5", "c5"]));
    expect(await reply(3)).toMatchObject({ type: "error", message: "The game is over" });
    handle(search(4, ["c2"]));
    await resultOf(4);
  });

  it("drops the tree when it is configured again", async () => {
    const { handle, reply, resultOf, configured } = setup();
    handle({ type: "configure", id: 1, engine });
    handle(search(2, [], { simulations: 30 }));
    await resultOf(2);
    handle({ type: "configure", id: 3, engine });
    await reply(3);
    handle(search(4, [], { simulations: 0 }));
    expect(total((await resultOf(4)).visits)).toBe(0);
    expect(configured).toHaveLength(2);
  });
});

describe("search service with two engines", () => {
  const network: EngineSpec = { kind: "network", model: new ArrayBuffer(8), threads: 1, modelId: "m1", planes: 10, fixedSize: null, asDefault: true };

  function twoEngines() {
    const evaluators = { heuristic: new FakeEvaluator(), network: new FakeEvaluator() };
    const outbox: Response[] = [];
    const handle = createSearchService(
      (response) => outbox.push(response),
      async (spec) => evaluators[spec.kind],
    );
    const reply = async (id: number): Promise<Response> => {
      for (let i = 0; i < 3000; i++) {
        const found = outbox.find((r) => r.id === id);
        if (found) return found;
        await new Promise((resolve) => setTimeout(resolve, 1));
      }
      throw new Error(`no response to ${id}`);
    };
    return { evaluators, handle, reply };
  }

  it("searches with the engine the request names, and refuses one that is not configured", async () => {
    const { evaluators, handle, reply } = twoEngines();
    handle({ type: "configure", id: 1, engine });
    handle(search(2, [], { engine: "network" }));
    expect(await reply(2)).toMatchObject({ type: "error", message: "The network engine is not configured" });
    handle({ type: "configure", id: 3, engine: network });
    handle(search(4, [], { engine: "network" }));
    expect((await reply(4)).type).toBe("result");
    expect(evaluators.network.calls).toBeGreaterThan(0);
    expect(evaluators.heuristic.calls).toBe(0);
  });

  it("does not cancel a search in flight when an engine is configured: the model arriving mid-move leaves the bot's move alone", async () => {
    const { handle, reply } = twoEngines();
    handle({ type: "configure", id: 1, engine });
    handle(search(2, [], { simulations: 30 }));
    handle({ type: "configure", id: 3, engine: network });
    expect((await reply(2)).type).toBe("result");
    expect(await reply(3)).toEqual({ type: "configured", id: 3 });
    handle(search(4, [], { engine: "network" }));
    expect((await reply(4)).type).toBe("result");
  });

  it("configures a replacement the same way, and frees the evaluator it replaces", async () => {
    const { evaluators, handle, reply } = twoEngines();
    handle({ type: "configure", id: 1, engine: network });
    await reply(1);
    expect(evaluators.network.disposed).toBe(0);
    handle({ type: "configure", id: 2, engine: network });
    await reply(2);
    expect(evaluators.network.disposed).toBe(1);
  });

  it("answers an analysis request (no tree reuse) from exactly its own simulations, leaving the bot's tree alone", async () => {
    const { handle, reply } = twoEngines();
    handle({ type: "configure", id: 1, engine: network });
    handle(search(2, [], { engine: "network", simulations: 30 }));
    const first = await reply(2);
    if (first.type !== "result") throw new Error("no result");

    handle(search(3, [], { engine: "network", simulations: 32, reuseTree: false }));
    const first32 = await reply(3);
    handle(search(4, [], { engine: "network", simulations: 32, reuseTree: false }));
    const second32 = await reply(4);
    if (first32.type !== "result" || second32.type !== "result") throw new Error("no result");
    expect(first32.visits.reduce((a, b) => a + b, 0)).toBe(32);
    expect(second32.visits).toEqual(first32.visits);

    handle(search(5, [first.move], { engine: "network", simulations: 30 }));
    const next = await reply(5);
    if (next.type !== "result") throw new Error("no result");
    expect(next.visits.reduce((a, b) => a + b, 0)).toBe(Math.max(...first.visits) - 1 + 30);
  });

  it("keeps a tree for each engine, so a search with one does not disturb the other", async () => {
    const { handle, reply } = twoEngines();
    handle({ type: "configure", id: 1, engine });
    handle({ type: "configure", id: 2, engine: network });
    handle(search(3, [], { simulations: 30 }));
    const first = await reply(3);
    handle(search(4, [], { engine: "network", simulations: 10 }));
    await reply(4);
    if (first.type !== "result") throw new Error("no result");
    handle(search(5, [first.move], { simulations: 30 }));
    const again = await reply(5);
    if (again.type !== "result") throw new Error("no result");
    expect(again.visits.reduce((a, b) => a + b, 0)).toBe(Math.max(...first.visits) - 1 + 30);
  });
});

/** A worker stand-in wired straight to a search service. */
function loopback() {
  const evaluator = new FakeEvaluator();
  const configured: EngineSpec[] = [];
  const workers: LoopbackWorker[] = [];
  const client = new SearchClient(() => {
    const worker = new LoopbackWorker((post) =>
      createSearchService(post, async (spec) => {
        configured.push(spec);
        return evaluator;
      }),
    );
    workers.push(worker);
    return worker;
  });
  return { client, configured, workers };
}

describe("search client", () => {
  const params = { engine: "heuristic" as const, size: 5, moves: [] as string[], simulations: 10, temperature: 0, seed: 1 };

  it("turns requests into promises", async () => {
    const { client, configured } = loopback();
    await client.configure(engine);
    const result = await client.search(params);
    expect(configured).toEqual([engine]);
    expect(total(result!.visits)).toBe(10);
  });

  it("rejects a search that failed", async () => {
    const { client } = loopback();
    await expect(client.search(params)).rejects.toThrow("not configured");
  });

  it("resolves a cancelled or superseded search to null", async () => {
    const { client } = loopback();
    await client.configure(engine);
    const cancelled = client.search({ ...params, simulations: 100000 });
    await new Promise((resolve) => setTimeout(resolve, 30));
    client.cancel();
    expect(await cancelled).toBeNull();
    const old = client.search({ ...params, simulations: 100000 });
    const latest = client.search(params);
    expect(await old).toBeNull();
    expect((await latest)!.moves.length).toBeGreaterThan(0);
  });

  it("rejects what is waiting when the worker fails, and starts a fresh worker for the next request", async () => {
    const { client, configured, workers } = loopback();
    await client.configure(engine);
    const waiting = client.search({ ...params, simulations: 100000 });
    await new Promise((resolve) => setTimeout(resolve, 20));
    workers[0]!.fail("boom");
    await expect(waiting).rejects.toThrow("boom");
    expect(workers[0]!.terminated).toBe(true);
    const result = await client.search(params);
    expect(workers).toHaveLength(2);
    expect(workers[1]!.received[0]).toMatchObject({ type: "configure", engine });
    expect(configured).toHaveLength(2);
    expect(total(result!.visits)).toBe(10);
  });

  it("configures a replacement worker with every engine it had", async () => {
    const { client, workers } = loopback();
    const network: EngineSpec = { kind: "network", model: new ArrayBuffer(8), threads: 1, modelId: "m1", planes: 10, fixedSize: null, asDefault: true };
    await client.configure(engine);
    await client.configure(network);
    workers[0]!.fail("boom");
    await client.search(params);
    expect(workers[1]!.received.slice(0, 2).map((r) => (r.type === "configure" ? r.engine.kind : r.type))).toEqual(["heuristic", "network"]);
  });

  it("rejects when the worker cannot be created or sends something unreadable", async () => {
    const broken = new SearchClient(() => {
      throw new Error("no workers here");
    });
    await expect(broken.configure(engine)).rejects.toThrow("no workers here");

    const { client, workers } = loopback();
    await client.configure(engine);
    const waiting = client.search({ ...params, simulations: 100000 });
    await new Promise((resolve) => setTimeout(resolve, 20));
    workers[0]!.onmessageerror?.(new MessageEvent("messageerror"));
    await expect(waiting).rejects.toThrow("could not be read");
  });

  it("ignores the error of a worker it has already dropped", async () => {
    const { client, workers } = loopback();
    await client.configure(engine);
    workers[0]!.fail("first");
    await client.configure(engine);
    workers[0]!.fail("late");
    expect((await client.search(params))!.moves.length).toBeGreaterThan(0);
    expect(workers).toHaveLength(2);
  });
});

describe("search service with several networks", () => {
  const spec = (modelId: string, asDefault: boolean): EngineSpec => ({ kind: "network", model: new ArrayBuffer(8), threads: 1, modelId, planes: 10, fixedSize: null, asDefault });

  function networks() {
    const made = new Map<string, FakeEvaluator>();
    const outbox: Response[] = [];
    const handle = createSearchService(
      (response) => outbox.push(response),
      async (engine) => {
        const evaluator = new FakeEvaluator();
        made.set(engine.kind === "network" ? engine.modelId : "heuristic", evaluator);
        return evaluator;
      },
    );
    const reply = async (id: number): Promise<Response> => {
      for (let i = 0; i < 3000; i++) {
        const found = outbox.find((r) => r.id === id);
        if (found) return found;
        await new Promise((resolve) => setTimeout(resolve, 1));
      }
      throw new Error(`no response to ${id}`);
    };
    return { made, handle, reply };
  }

  it("holds one session per model id and searches with the one the request names", async () => {
    const { made, handle, reply } = networks();
    handle({ type: "configure", id: 1, engine: spec("m1", true) });
    handle({ type: "configure", id: 2, engine: spec("m2", false) });
    await reply(2);
    handle(search(3, [], { engine: "network", model: "m2" }));
    expect((await reply(3)).type).toBe("result");
    expect(made.get("m2")!.calls).toBeGreaterThan(0);
    expect(made.get("m1")!.calls).toBe(0);
    expect(made.get("m1")!.disposed).toBe(0);
  });

  it("searches without a model with the default network, which a later non-default configure does not change", async () => {
    const { made, handle, reply } = networks();
    handle({ type: "configure", id: 1, engine: spec("m1", true) });
    handle({ type: "configure", id: 2, engine: spec("m2", false) });
    handle(search(3, [], { engine: "network" }));
    expect((await reply(3)).type).toBe("result");
    expect(made.get("m1")!.calls).toBeGreaterThan(0);
    expect(made.get("m2")!.calls).toBe(0);
  });

  it("keeps a tree per model: alternating models does not rebuild either", async () => {
    const { made, handle, reply } = networks();
    handle({ type: "configure", id: 1, engine: spec("m1", true) });
    handle({ type: "configure", id: 2, engine: spec("m2", false) });
    handle(search(3, ["c2"], { engine: "network", model: "m1", simulations: 10 }));
    await reply(3);
    handle(search(4, ["c2"], { engine: "network", model: "m2", simulations: 10 }));
    await reply(4);
    const before = made.get("m1")!.calls;
    handle(search(5, ["c2"], { engine: "network", model: "m1", simulations: 10 }));
    await reply(5);
    // The m1 tree already holds 10 simulations; asking for 10 more adds 10 evaluations at most, none for the root.
    expect(made.get("m1")!.calls - before).toBeLessThanOrEqual(10);
  });

  it("frees one session on release, refuses to search it, and leaves the others", async () => {
    const { made, handle, reply } = networks();
    handle({ type: "configure", id: 1, engine: spec("m1", true) });
    handle({ type: "configure", id: 2, engine: spec("m2", false) });
    handle({ type: "release", id: 3, model: "m2" });
    expect(await reply(3)).toEqual({ type: "released", id: 3 });
    expect(made.get("m2")!.disposed).toBe(1);
    expect(made.get("m1")!.disposed).toBe(0);
    handle(search(4, [], { engine: "network", model: "m2" }));
    expect(await reply(4)).toMatchObject({ type: "error", message: "The model m2 is not configured" });
    handle(search(5, [], { engine: "network", model: "m1" }));
    expect((await reply(5)).type).toBe("result");
  });
});
