import { afterEach, describe, expect, it, vi } from "vitest";
import type { Evaluation, Evaluator } from "../../src/ai/evaluator";
import type { EngineSpec, Response } from "../../src/ai/protocol";
import { createSearchService } from "../../src/ai/searchService";
import { createYielder } from "../../src/ai/yielder";
import { actionCount } from "../../src/engine/constants";
import type { GameState } from "../../src/engine/state";

/** Answers at once, with no wait of its own, so a search yields only through its yield point. */
class InstantEvaluator implements Evaluator {
  async evaluate(state: GameState): Promise<Evaluation> {
    return { policy: new Float64Array(actionCount(state.size)).fill(1), value: 0 };
  }
}

describe("createYielder", () => {
  it("resolves on a later task, after the microtasks already queued", async () => {
    const yielder = createYielder();
    const order: string[] = [];
    queueMicrotask(() => order.push("microtask"));
    const yielded = yielder.next().then(() => order.push("yielded"));
    queueMicrotask(() => order.push("microtask after"));
    expect(order).toEqual([]);
    await yielded;
    expect(order).toEqual(["microtask", "microtask after", "yielded"]);
    yielder.close();
  });

  it("resolves overlapping yields in the order they were asked for", async () => {
    const yielder = createYielder();
    const order: number[] = [];
    await Promise.all([1, 2, 3].map((n) => yielder.next().then(() => order.push(n))));
    expect(order).toEqual([1, 2, 3]);
    yielder.close();
  });

  it("can be used again after an earlier yield", async () => {
    const yielder = createYielder();
    for (let i = 0; i < 100; i++) await yielder.next();
    yielder.close();
  });
});

describe("a search that yields", () => {
  const engine: EngineSpec = { kind: "heuristic" };

  afterEach(() => vi.restoreAllMocks());

  /**
   * A clock that jumps past the slice on every reading, so the search yields after each simulation.
   * Node serves a port's messages in batches of up to 1000 before it returns to its timers, so with
   * real 15 ms slices a message from outside would wait 15 s here; a browser takes each message as its own task.
   */
  function fastClock(): void {
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => (now += 20));
  }

  function start() {
    const outbox: Response[] = [];
    const handle = createSearchService(
      (response) => outbox.push(response),
      async () => new InstantEvaluator(),
    );
    handle({ type: "configure", id: 1, engine });
    const reply = async (id: number): Promise<Response> => {
      for (;;) {
        const found = outbox.find((response) => response.id === id && response.type !== "configured");
        if (found) return found;
        await new Promise((resolve) => setTimeout(resolve, 1));
      }
    };
    return { handle, reply };
  }

  it("handles a cancel posted during a long search within a bounded time", async () => {
    fastClock();
    const { handle, reply } = start();
    handle({ type: "search", id: 2, engine: "heuristic", size: 5, moves: [], simulations: 10_000_000, temperature: 0, seed: 1 });
    // The cancel arrives as the worker's message would: a task of its own, while the search is in the middle of its slices.
    const posted = await new Promise<number>((resolve) =>
      setTimeout(() => {
        handle({ type: "cancel", id: 2 });
        resolve(Date.now());
      }, 20),
    );
    expect(await reply(2)).toEqual({ type: "cancelled", id: 2 });
    expect(Date.now() - posted).toBeLessThan(1000);
  });

  it("still serves the next search after a cancel", async () => {
    fastClock();
    const { handle, reply } = start();
    handle({ type: "search", id: 2, engine: "heuristic", size: 5, moves: [], simulations: 10_000_000, temperature: 0, seed: 1 });
    await new Promise((resolve) => setTimeout(resolve, 50));
    handle({ type: "cancel", id: 2 });
    handle({ type: "search", id: 3, engine: "heuristic", size: 5, moves: [], simulations: 40, temperature: 0, seed: 1 });
    expect(await reply(2)).toEqual({ type: "cancelled", id: 2 });
    expect((await reply(3)).type).toBe("result");
  });
});
