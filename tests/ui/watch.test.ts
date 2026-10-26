import { afterEach, describe, expect, it, vi } from "vitest";
import type { SearchResponse } from "../../src/ai/protocol";
import type { SearchParams } from "../../src/ai/searchClient";
import { formatAction, parseMove } from "../../src/engine/notation";
import { GameState } from "../../src/engine/state";
import type { SearchPort } from "../../src/ui/controller";
import { LEVELS } from "../../src/ui/levels";
import { barShare, describeLevel, evalBar, SPEEDS, toPercent, WatchController, watchStatus } from "../../src/ui/watch";

const [BEGINNER, NORMAL, STRONG, MAX] = [LEVELS[0]!, LEVELS[1]!, LEVELS[2]!, LEVELS[3]!];

const result = (move: string, value = 0): SearchResponse => ({ type: "result", id: 0, move, moves: [move], visits: [1], value, principalVariation: [move] });

/** An engine the test answers by hand: each search waits until `answer`, `fail` or `cancelled`. */
class FakeEngine implements SearchPort {
  readonly requests: SearchParams[] = [];
  cancels = 0;
  private waiting: ((reply: SearchResponse | null | Error) => void)[] = [];

  search(params: SearchParams): Promise<SearchResponse | null> {
    this.requests.push(params);
    return new Promise((resolve, reject) => {
      this.waiting.push((reply) => (reply instanceof Error ? reject(reply) : resolve(reply)));
    });
  }

  cancel(): void {
    this.cancels++;
  }

  answer(move: string, value = 0): void {
    this.waiting.shift()!(result(move, value));
  }

  fail(message: string): void {
    this.waiting.shift()!(new Error(message));
  }

  cancelled(): void {
    this.waiting.shift()!(null);
  }
}

/** An engine that answers at once with the first legal move. */
class FirstMoveEngine implements SearchPort {
  searches = 0;

  async search(params: SearchParams): Promise<SearchResponse | null> {
    this.searches++;
    const state = GameState.initial(params.size);
    for (const move of params.moves) state.play(parseMove(state, move));
    return result(formatAction(state, state.legalActions()[0]!));
  }

  cancel(): void {}
}

const settle = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

function setup(speed: keyof typeof SPEEDS = "instant", size = 5) {
  const engine = new FakeEngine();
  const watch = new WatchController(engine, () => {}, () => 0.5);
  watch.restart(size, { p1: STRONG, p2: NORMAL });
  watch.setSpeed(speed);
  return { engine, watch };
}

/** Plays a whole game with the first-move engine. */
async function playOut(levels: { p1: typeof NORMAL; p2: typeof NORMAL }) {
  const engine = new FirstMoveEngine();
  const watch = new WatchController(engine, () => {});
  watch.restart(5, levels);
  watch.setSpeed("instant");
  watch.start();
  while (watch.running) await settle();
  return { engine, watch };
}

afterEach(() => vi.useRealTimers());

describe("WatchController", () => {
  it("starts paused and asks the level of the side to move", async () => {
    const { engine, watch } = setup();
    expect(watch.running).toBe(false);
    expect(engine.requests).toEqual([]);
    watch.step();
    expect(engine.requests[0]).toMatchObject({ engine: "network", simulations: 32, temperature: 0, size: 5, moves: [] });
    engine.answer("c2");
    await settle();
    watch.step();
    expect(engine.requests[1]).toMatchObject({ engine: "heuristic", simulations: 100, moves: ["c2"] });
  });

  it("plays one move on step and stays paused", async () => {
    const { engine, watch } = setup();
    watch.step();
    expect(watch.thinking).toBe(true);
    engine.answer("c2");
    await settle();
    expect(watch.moves).toEqual(["c2"]);
    expect(watch.thinking).toBe(false);
    expect(watch.running).toBe(false);
    expect(engine.requests).toHaveLength(1);
  });

  it("ignores step while a search is running or the game plays by itself", async () => {
    const { engine, watch } = setup();
    watch.step();
    watch.step();
    expect(engine.requests).toHaveLength(1);
    engine.answer("c2");
    await settle();
    watch.start();
    watch.step();
    expect(engine.requests).toHaveLength(2);
  });

  it("keeps each bot's own reading as player 1's share", async () => {
    const { engine, watch } = setup();
    watch.step();
    engine.answer("c2", 0.5);
    await settle();
    expect(watch.opinions).toEqual({ p1: 0.75, p2: null });
    watch.step();
    engine.answer("c4", 0.5);
    await settle();
    expect(watch.opinions).toEqual({ p1: 0.75, p2: 0.25 });
  });

  it("plays on after each move once started, waiting the speed's pause", async () => {
    vi.useFakeTimers();
    const { engine, watch } = setup("normal");
    watch.start();
    engine.answer("c2");
    await vi.advanceTimersByTimeAsync(0);
    expect(watch.moves).toEqual(["c2"]);
    expect(engine.requests).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(SPEEDS.normal - 1);
    expect(engine.requests).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(engine.requests).toHaveLength(2);
  });

  it("applies a new speed to a wait already under way", async () => {
    vi.useFakeTimers();
    const { engine, watch } = setup("slow");
    watch.start();
    engine.answer("c2");
    await vi.advanceTimersByTimeAsync(0);
    watch.setSpeed("fast");
    await vi.advanceTimersByTimeAsync(SPEEDS.fast);
    expect(engine.requests).toHaveLength(2);
  });

  it("pausing during a wait stops the next search", async () => {
    vi.useFakeTimers();
    const { engine, watch } = setup("normal");
    watch.start();
    engine.answer("c2");
    await vi.advanceTimersByTimeAsync(0);
    watch.pause();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(engine.requests).toHaveLength(1);
    expect(watch.running).toBe(false);
  });

  it("pausing during a search cancels it, drops a late answer, and searches again on start", async () => {
    const { engine, watch } = setup();
    watch.start();
    watch.pause();
    expect(engine.cancels).toBe(1);
    expect(watch.thinking).toBe(false);
    engine.answer("c2");
    await settle();
    expect(watch.moves).toEqual([]);
    expect(watch.opinions).toEqual({ p1: null, p2: null });
    watch.start();
    expect(engine.requests).toHaveLength(2);
    engine.answer("b1");
    await settle();
    expect(watch.moves).toEqual(["b1"]);
  });

  it("restarting during a search drops its answer for the old game", async () => {
    const { engine, watch } = setup();
    watch.start();
    watch.restart(7, { p1: NORMAL, p2: MAX });
    engine.answer("c2");
    await settle();
    expect(watch.moves).toEqual([]);
    expect(watch.size).toBe(7);
    expect(watch.running).toBe(false);
    watch.step();
    engine.answer("d2");
    await settle();
    expect(watch.moves).toEqual(["d2"]);
  });

  it("does not let a stale answer land after a pause and a new search", async () => {
    const { engine, watch } = setup();
    watch.step();
    watch.pause();
    watch.step();
    engine.cancelled();
    await settle();
    expect(watch.moves).toEqual([]);
    engine.answer("c2");
    await settle();
    expect(watch.moves).toEqual(["c2"]);
  });

  it("asks again after a search the worker cancelled on its own, and reports it after repeated cancels", async () => {
    const { engine, watch } = setup();
    watch.step();
    engine.cancelled();
    await settle();
    expect(engine.requests).toHaveLength(2);
    engine.answer("c2");
    await settle();
    expect(watch.moves).toEqual(["c2"]);
    watch.start();
    for (let i = 0; i < 3; i++) {
      engine.cancelled();
      await settle();
    }
    expect(watch.error).toBe("The search was cancelled");
    expect(watch.running).toBe(false);
  });

  it("stops and reports when a search fails, and tries again on start", async () => {
    const { engine, watch } = setup();
    watch.start();
    engine.fail("boom");
    await settle();
    expect(watch.error).toBe("boom");
    expect(watch.running).toBe(false);
    expect(watchStatus(watch)).toContain("boom");
    watch.start();
    expect(watch.error).toBeNull();
    expect(engine.requests).toHaveLength(2);
  });

  it("stops and reports an answer that is not a legal move", async () => {
    const { engine, watch } = setup();
    watch.start();
    engine.answer("a9");
    await settle();
    expect(watch.moves).toEqual([]);
    expect(watch.error).toMatch(/not a legal move/);
  });

  it("plays a whole game to its end by the site's rules, then stops", async () => {
    const { engine, watch } = await playOut({ p1: BEGINNER, p2: NORMAL });
    expect(watch.result).not.toBeNull();
    expect(watch.canMove).toBe(false);
    expect(engine.searches).toBe(watch.moves.length);
    watch.start();
    watch.step();
    expect(engine.searches).toBe(watch.moves.length);
    expect(watchStatus(watch)).toMatch(/Draw|wins/);
  });

  it("changes a side's level from its next move", () => {
    const { engine, watch } = setup();
    watch.setLevel("p1", MAX);
    watch.step();
    expect(engine.requests[0]).toMatchObject({ engine: "network", simulations: 200 });
  });

  it("reports its status in words", async () => {
    const { engine, watch } = setup();
    expect(watchStatus(watch)).toBe("Paused.");
    watch.step();
    expect(watchStatus(watch)).toBe("Player 1 is thinking.");
    engine.answer("c2");
    await settle();
    expect(watchStatus(watch)).toBe("Player 1 played c2. Paused.");
  });
});

describe("the eval bar", () => {
  const levels = { p1: STRONG, p2: NORMAL };

  it("maps shares to whole percentages within 0 to 100", () => {
    expect([toPercent(0.5), toPercent(0.004), toPercent(0.996), toPercent(-1), toPercent(2)]).toEqual([50, 0, 100, 0, 100]);
  });

  it("follows the stronger bot, averages equals, and uses the one reading it has", () => {
    expect(barShare({ p1: 0.8, p2: 0.4 }, levels)).toBe(0.8);
    expect(barShare({ p1: 0.8, p2: 0.4 }, { p1: NORMAL, p2: MAX })).toBe(0.4);
    expect(barShare({ p1: 0.8, p2: 0.4 }, { p1: NORMAL, p2: NORMAL })).toBeCloseTo(0.6);
    expect(barShare({ p1: null, p2: 0.4 }, levels)).toBe(0.4);
    expect(barShare({ p1: null, p2: null }, levels)).toBeNull();
  });

  it("is absent before a search, then shows the fill and both markers", async () => {
    const { engine, watch } = setup();
    expect(evalBar(watch)).toBeNull();
    watch.step();
    engine.answer("c2", 0.5);
    await settle();
    expect(evalBar(watch)).toEqual({ percent: 75, label: "Player 1 75%, player 2 25%", marks: { p1: 75, p2: null } });
    watch.step();
    engine.answer("c4", 0.5);
    await settle();
    expect(evalBar(watch)?.marks).toEqual({ p1: 75, p2: 25 });
    expect(evalBar(watch)?.percent).toBe(75);
  });

  it("shows the result when the game has ended", async () => {
    const { watch } = await playOut({ p1: BEGINNER, p2: BEGINNER });
    const winner = watch.result!.winner;
    expect(evalBar(watch)!.percent).toBe(winner === "p1" ? 100 : winner === "p2" ? 0 : 50);
  });

  it("describes a level with what it searches with", () => {
    expect(describeLevel(STRONG)).toBe("Strong (network, 32 searches)");
    expect(describeLevel(NORMAL)).toBe("Normal (heuristic, 100 searches)");
  });
});
