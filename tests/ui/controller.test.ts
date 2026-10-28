import { afterEach, describe, expect, it, vi } from "vitest";
import type { SearchResponse } from "../../src/ai/protocol";
import type { SearchParams } from "../../src/ai/searchClient";
import { playerAction } from "../../src/engine/actions";
import { Game } from "../../src/engine/game";
import { formatAction, parseMove } from "../../src/engine/notation";
import { GameState } from "../../src/engine/state";
import { GameController, HUMAN, isOfferedSize, type Players, type SearchPort, SPEEDS, type Speed } from "../../src/ui/controller";
import { LEVELS } from "../../src/ui/levels";

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

  /** Answers the oldest search with `move`. */
  answer(move: string, value = 0): void {
    this.waiting.shift()!(result(move, value));
  }

  fail(message: string): void {
    this.waiting.shift()!(new Error(message));
  }

  /** Answers the oldest search the way the worker answers a cancelled one. */
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

function setup(size = 5, players: Players = { p1: HUMAN, p2: NORMAL }) {
  const engine = new FakeEngine();
  const controller = new GameController(engine, () => {}, () => 0.5);
  controller.setNetworkReady(true);
  controller.newGame(size, players);
  const play = (move: string): boolean => controller.playHuman(parseMove(controller.state, move));
  /** The person plays `mine`, the engine answers `theirs`. */
  const turn = async (mine: string, theirs: string): Promise<void> => {
    play(mine);
    engine.answer(theirs);
    await settle();
  };
  return { engine, controller, play, turn };
}

/** Two bots on 5x5, paused, at the given speed. */
function bots(speed: Speed = "instant", players: Players = { p1: STRONG, p2: NORMAL }) {
  const { engine, controller } = setup(5, players);
  controller.setSpeed(speed);
  return { engine, controller };
}

afterEach(() => vi.useRealTimers());

describe("GameController with a person playing", () => {
  it("plays the person's move, asks the engine for a reply at the level's budget, and plays it", async () => {
    const { engine, controller, play } = setup(5, { p1: HUMAN, p2: BEGINNER });
    expect(controller.humanToMove).toBe(true);
    expect(play("c2")).toBe(true);
    expect(controller.thinking).toBe(true);
    expect(engine.requests).toEqual([{ engine: "heuristic", size: 5, moves: ["c2"], simulations: 5, temperature: 1, seed: 2147483648 }]);
    engine.answer("c4");
    await settle();
    expect(controller.moves).toEqual(["c2", "c4"]);
    expect(controller.thinking).toBe(false);
    expect(controller.humanToMove).toBe(true);
  });

  it("lets the bot open when the person plays second", async () => {
    const { engine, controller, play } = setup(5, { p1: NORMAL, p2: HUMAN });
    expect(controller.thinking).toBe(true);
    expect(controller.humanToMove).toBe(false);
    expect(engine.requests[0]).toMatchObject({ moves: [], simulations: 100, temperature: 0 });
    engine.answer("c2");
    await settle();
    expect(controller.moves).toEqual(["c2"]);
    expect(play("c4")).toBe(true);
    expect(engine.requests[1]!.moves).toEqual(["c2", "c4"]);
  });

  it("refuses a move while the bot thinks, and after the game has ended", async () => {
    const { engine, controller, play, turn } = setup();
    play("c2");
    expect(controller.playHuman(playerAction(0))).toBe(false);
    engine.answer("b5");
    await settle();
    await turn("c3", "a5");
    await turn("c4", "b5");
    play("c5");
    expect(controller.result).toEqual({ winner: "p1", reason: "goal" });
    expect(controller.playHuman(playerAction(0))).toBe(false);
    expect(controller.thinking).toBe(false);
    expect(engine.requests).toHaveLength(3);
  });

  it("takes back the person's move and the bot's reply together", async () => {
    const { controller, turn } = setup();
    await turn("c2", "c4");
    await turn("c3", "b4");
    expect(controller.canUndo).toBe(true);
    controller.undo();
    expect(controller.moves).toEqual(["c2", "c4"]);
    expect(controller.humanToMove).toBe(true);
    controller.undo();
    expect(controller.moves).toEqual([]);
    expect(controller.canUndo).toBe(false);
    controller.undo();
    expect(controller.moves).toEqual([]);
  });

  it("cancels a search in flight on undo and drops its late reply", async () => {
    const { engine, controller, play } = setup();
    play("c2");
    controller.undo();
    expect(engine.cancels).toBe(1);
    expect(controller.moves).toEqual([]);
    expect(controller.thinking).toBe(false);
    expect(controller.humanToMove).toBe(true);
    engine.answer("c4"); // the worker answers anyway
    await settle();
    expect(controller.moves).toEqual([]);
    expect(play("d1")).toBe(true);
    expect(engine.requests[1]!.moves).toEqual(["d1"]);
    engine.answer("c4");
    await settle();
    expect(controller.moves).toEqual(["d1", "c4"]);
  });

  it("has nothing to undo for a person playing second until they have moved", async () => {
    const { engine, controller, turn } = setup(5, { p1: NORMAL, p2: HUMAN });
    engine.answer("c2");
    await settle();
    expect(controller.canUndo).toBe(false);
    await turn("c4", "c3");
    expect(controller.canUndo).toBe(true);
    controller.undo();
    expect(controller.moves).toEqual(["c2"]);
  });

  it("takes back a winning move of the person's", async () => {
    const { controller, play, turn } = setup();
    await turn("c2", "b5");
    await turn("c3", "a5");
    await turn("c4", "b5");
    play("c5");
    expect(controller.result?.winner).toBe("p1");
    controller.undo();
    expect(controller.result).toBeNull();
    expect(controller.moves).toHaveLength(6);
  });

  it("takes back a game the bot's move ended, along with the person's move before it", async () => {
    const { engine, controller, turn } = setup(5, { p1: NORMAL, p2: HUMAN });
    engine.answer("c2");
    await settle();
    await turn("b5", "c3");
    await turn("a5", "c4");
    await turn("b5", "c5");
    expect(controller.result).toEqual({ winner: "p1", reason: "goal" });
    controller.undo();
    expect(controller.moves).toHaveLength(5);
    expect(controller.result).toBeNull();
    expect(controller.humanToMove).toBe(true);
  });

  it("ends in a draw by repetition and stops asking the engine", async () => {
    const { engine, controller, turn } = setup();
    await turn("c2", "c4");
    await turn("c1", "c5");
    await turn("c2", "c4");
    await turn("c1", "c5");
    expect(controller.result).toEqual({ winner: "draw", reason: "repetition" });
    expect(controller.humanToMove).toBe(false);
    expect(engine.requests).toHaveLength(4);
  });

  it("starts a new game over a search in flight", async () => {
    const { engine, controller, play } = setup();
    play("c2");
    controller.newGame(7, { p1: HUMAN, p2: BEGINNER });
    expect(engine.cancels).toBe(1);
    expect(controller.size).toBe(7);
    expect(controller.moves).toEqual([]);
    engine.answer("c4"); // a late reply for the old 5x5 game
    await settle();
    expect(controller.moves).toEqual([]);
    expect(controller.players.p2).toBe(BEGINNER);
  });

  it("shows the engine's failure and tries again on request", async () => {
    const { engine, controller, play } = setup();
    play("c2");
    engine.fail("boom");
    await settle();
    expect(controller.error).toBe("boom");
    expect(controller.thinking).toBe(false);
    expect(controller.playHuman(playerAction(0))).toBe(false);
    controller.retry();
    expect(controller.error).toBeNull();
    engine.answer("c4");
    await settle();
    expect(controller.moves).toEqual(["c2", "c4"]);
  });

  it("carries on a game of two bots after a failure when asked to try again", async () => {
    const { engine, controller } = setup(5, { p1: NORMAL, p2: NORMAL });
    controller.setSpeed("instant");
    controller.start();
    engine.fail("boom");
    await settle();
    expect(controller.error).toBe("boom");
    expect(controller.running).toBe(false);
    controller.retry();
    expect(controller.running).toBe(true);
    expect(controller.thinking).toBe(true);
    controller.pause();
    controller.retry();
    expect(controller.running).toBe(true);
  });

  it("asks again when the worker cancels a search nobody cancelled", async () => {
    const { engine, controller, play } = setup();
    play("c2");
    engine.cancelled();
    await settle();
    expect(controller.error).toBeNull();
    expect(controller.thinking).toBe(true);
    expect(engine.requests).toHaveLength(2);
    expect(engine.requests[1]!.moves).toEqual(["c2"]);
    engine.answer("c4");
    await settle();
    expect(controller.moves).toEqual(["c2", "c4"]);
  });

  it("treats a cancelled answer that nobody asked for as a failure, once it keeps happening", async () => {
    const { engine, controller, play } = setup();
    play("c2");
    for (let i = 0; i < 3; i++) {
      engine.cancelled();
      await settle();
    }
    expect(controller.error).toContain("cancelled");
    expect(engine.requests).toHaveLength(3);
  });

  it("asks the network for a network level and the heuristic for the others", () => {
    const { engine, controller, play } = setup(5, { p1: HUMAN, p2: STRONG });
    play("c2");
    expect(engine.requests[0]).toMatchObject({ engine: "network", simulations: 32, temperature: 0 });
    controller.undo();
    controller.setPlayers({ p1: HUMAN, p2: MAX });
    play("c2");
    expect(engine.requests[1]).toMatchObject({ engine: "network", simulations: 200 });
    controller.undo();
    controller.setPlayers({ p1: HUMAN, p2: NORMAL });
    play("c2");
    expect(engine.requests[2]).toMatchObject({ engine: "heuristic", simulations: 100 });
  });

  it("drops the search of a bot whose level changes and searches again at the new level", () => {
    const { engine, controller, play } = setup();
    play("c2");
    controller.setPlayers({ p1: HUMAN, p2: BEGINNER });
    expect(engine.cancels).toBe(1);
    expect(engine.requests[1]).toMatchObject({ simulations: 5, temperature: 1, moves: ["c2"] });
    // A change to the other side leaves the search alone.
    controller.setPlayers({ p1: HUMAN, p2: BEGINNER });
    expect(engine.requests).toHaveLength(2);
  });

  it("swaps sides: the bot takes the side to move and moves at once", () => {
    const { engine, controller } = setup(5, { p1: HUMAN, p2: STRONG });
    expect(engine.requests).toHaveLength(0);
    controller.setPlayers({ p1: STRONG, p2: HUMAN });
    expect(controller.thinking).toBe(true);
    expect(engine.requests[0]).toMatchObject({ engine: "network", moves: [] });
  });

  it("lets two people take turns on one device, and undoes one move at a time", () => {
    const { engine, controller, play } = setup(5, { p1: HUMAN, p2: HUMAN });
    expect(play("c2")).toBe(true);
    expect(controller.humanToMove).toBe(true);
    expect(play("c4")).toBe(true);
    controller.undo();
    expect(controller.moves).toEqual(["c2"]);
    expect(engine.requests).toHaveLength(0);
  });

  it("continues a game from a link with the players it is given, and writes the link back", () => {
    const engine = new FakeEngine();
    const controller = new GameController(engine, () => {}, () => 0);
    controller.load(Game.fromHash("#n=5&m=c2.c4.c3"), { p1: NORMAL, p2: HUMAN });
    expect(controller.humanToMove).toBe(true);
    expect(controller.hash).toBe("#n=5&m=c2.c4.c3");
    expect(engine.requests).toHaveLength(0);
  });

  it("keeps where the last move landed, through replies, undo and a loaded game", async () => {
    const { engine, controller, turn } = setup();
    expect(controller.lastMove).toBeNull();
    await turn("c2", "c4");
    expect(controller.lastMove).toEqual({ kind: "move", row: 1, col: 2 });
    await turn("b3h", "c3");
    controller.undo();
    expect(controller.lastMove).toEqual({ kind: "move", row: 1, col: 2 });
    controller.undo();
    controller.undo();
    expect(controller.lastMove).toBeNull();
    controller.load(Game.fromHash("#n=5&m=c2.c4.b3h"), { p1: NORMAL, p2: HUMAN });
    expect(controller.lastMove).toEqual({ kind: "wall", row: 1, col: 1, orientation: 0 });
    expect(engine.requests).toHaveLength(2);
  });

  it("refuses a board size the site does not offer", () => {
    const { controller } = setup();
    for (const size of [0, 3, 6, 13]) expect(() => controller.newGame(size, { p1: HUMAN, p2: NORMAL })).toThrow("no ");
    expect(() => controller.load(Game.fromHash("#n=13"), { p1: HUMAN, p2: NORMAL })).toThrow("13x13");
    expect([3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13].filter(isOfferedSize)).toEqual([5, 7, 9, 11]);
    expect(controller.size).toBe(5);
  });

  it("does not search a game loaded as already over", () => {
    const engine = new FakeEngine();
    const controller = new GameController(engine, () => {}, () => 0);
    controller.load(Game.fromHash("#n=5&m=c2.b5.c3.a5.c4.b5.c5"), { p1: HUMAN, p2: NORMAL });
    expect(controller.result?.winner).toBe("p1");
    expect(controller.humanToMove).toBe(false);
    expect(engine.requests).toHaveLength(0);
  });
});

describe("GameController and the network", () => {
  it("makes a network bot wait until the network is ready, then moves; the heuristic never waits", async () => {
    const engine = new FakeEngine();
    const controller = new GameController(engine, () => {}, () => 0.5);
    controller.newGame(5, { p1: STRONG, p2: HUMAN });
    expect(controller.waiting).toBe(true);
    expect(controller.thinking).toBe(false);
    expect(engine.requests).toHaveLength(0);
    controller.setNetworkReady(true);
    expect(controller.waiting).toBe(false);
    expect(engine.requests[0]).toMatchObject({ engine: "network", simulations: 32 });
    const heuristic = new GameController(new FakeEngine(), () => {});
    heuristic.newGame(5, { p1: NORMAL, p2: HUMAN });
    expect(heuristic.waiting).toBe(false);
    expect(heuristic.thinking).toBe(true);
  });

  it("keeps each bot's reading, as player 1's share, with the move it made", async () => {
    const { engine, controller } = bots();
    controller.step();
    engine.answer("c2", 0.5);
    await settle();
    expect(controller.opinions()).toEqual({ p1: 0.75, p2: null });
    controller.step();
    engine.answer("c4", 0.5);
    await settle();
    expect(controller.opinions()).toEqual({ p1: 0.75, p2: 0.25 });
    expect(controller.opinions(1)).toEqual({ p1: 0.75, p2: null });
    expect(controller.opinions(0)).toEqual({ p1: null, p2: null });
  });

  it("forgets the readings of moves taken back", async () => {
    const { engine, controller, play } = setup(5, { p1: HUMAN, p2: STRONG });
    play("c2");
    engine.answer("c4", 0.2);
    await settle();
    expect(controller.opinions().p2).toBeCloseTo(0.4);
    controller.undo();
    expect(controller.opinions()).toEqual({ p1: null, p2: null });
  });
});

describe("GameController with two bots", () => {
  it("starts paused and asks the level of the side to move", async () => {
    const { engine, controller } = bots();
    expect(controller.running).toBe(false);
    expect(controller.hasHuman).toBe(false);
    expect(engine.requests).toEqual([]);
    controller.step();
    expect(engine.requests[0]).toMatchObject({ engine: "network", simulations: 32, temperature: 0, size: 5, moves: [] });
    engine.answer("c2");
    await settle();
    controller.step();
    expect(engine.requests[1]).toMatchObject({ engine: "heuristic", simulations: 100, moves: ["c2"] });
  });

  it("plays one move on step and stays paused; step is ignored while searching or running", async () => {
    const { engine, controller } = bots();
    controller.step();
    controller.step();
    expect(engine.requests).toHaveLength(1);
    engine.answer("c2");
    await settle();
    expect(controller.moves).toEqual(["c2"]);
    expect(controller.running).toBe(false);
    controller.start();
    controller.step();
    expect(engine.requests).toHaveLength(2);
  });

  it("cannot step a network bot before the network is ready", () => {
    const engine = new FakeEngine();
    const controller = new GameController(engine, () => {});
    controller.newGame(5, { p1: STRONG, p2: NORMAL });
    expect(controller.canStep).toBe(false);
    controller.step();
    expect(engine.requests).toHaveLength(0);
    controller.start();
    expect(controller.waiting).toBe(true);
    controller.setNetworkReady(true);
    expect(engine.requests).toHaveLength(1);
  });

  it("plays on after each move once started, waiting the speed's pause", async () => {
    vi.useFakeTimers();
    const { engine, controller } = bots("normal");
    controller.start();
    engine.answer("c2");
    await vi.advanceTimersByTimeAsync(0);
    expect(controller.moves).toEqual(["c2"]);
    expect(engine.requests).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(SPEEDS.normal - 1);
    expect(engine.requests).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(engine.requests).toHaveLength(2);
  });

  it("applies a new speed to a wait already under way", async () => {
    vi.useFakeTimers();
    const { engine, controller } = bots("slow");
    controller.start();
    engine.answer("c2");
    await vi.advanceTimersByTimeAsync(0);
    controller.setSpeed("fast");
    await vi.advanceTimersByTimeAsync(SPEEDS.fast);
    expect(engine.requests).toHaveLength(2);
  });

  it("does not move twice when the other side changes during the pause between moves", async () => {
    vi.useFakeTimers();
    const { engine, controller } = bots("normal");
    controller.start();
    engine.answer("c2");
    await vi.advanceTimersByTimeAsync(0);
    controller.setPlayers({ p1: MAX, p2: NORMAL });
    expect(engine.requests).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(SPEEDS.normal);
    expect(engine.requests).toHaveLength(2);
    expect(controller.running).toBe(true);
  });

  it("pausing during a wait stops the next search", async () => {
    vi.useFakeTimers();
    const { engine, controller } = bots("normal");
    controller.start();
    engine.answer("c2");
    await vi.advanceTimersByTimeAsync(0);
    controller.pause();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(engine.requests).toHaveLength(1);
    expect(controller.running).toBe(false);
  });

  it("pausing during a search cancels it, drops a late answer, and searches again on start", async () => {
    const { engine, controller } = bots();
    controller.start();
    controller.pause();
    expect(engine.cancels).toBe(1);
    expect(controller.thinking).toBe(false);
    engine.answer("c2");
    await settle();
    expect(controller.moves).toEqual([]);
    controller.start();
    expect(engine.requests).toHaveLength(2);
    engine.answer("b1");
    await settle();
    expect(controller.moves).toEqual(["b1"]);
  });

  it("stops and reports when a search fails, and tries again on start", async () => {
    const { engine, controller } = bots();
    controller.start();
    engine.fail("boom");
    await settle();
    expect(controller.error).toBe("boom");
    expect(controller.running).toBe(false);
    controller.start();
    expect(controller.error).toBeNull();
    expect(engine.requests).toHaveLength(2);
  });

  it("stops and reports an answer that is not a legal move", async () => {
    const { engine, controller } = bots();
    controller.start();
    engine.answer("a9");
    await settle();
    expect(controller.moves).toEqual([]);
    expect(controller.error).toMatch(/not a legal move/);
  });

  it("pauses when the last person leaves, and plays on by itself when a person sits down", async () => {
    const { engine, controller, play } = setup(5, { p1: HUMAN, p2: NORMAL });
    play("c2");
    engine.answer("c4");
    await settle();
    controller.setPlayers({ p1: BEGINNER, p2: NORMAL });
    expect(controller.running).toBe(false);
    expect(engine.requests).toHaveLength(1);
    controller.setPlayers({ p1: BEGINNER, p2: HUMAN });
    expect(engine.requests[1]).toMatchObject({ simulations: 5, moves: ["c2", "c4"] });
  });

  it("plays a whole game to its end by the site's rules, then stops", async () => {
    const engine = new FirstMoveEngine();
    const controller = new GameController(engine, () => {});
    controller.newGame(5, { p1: BEGINNER, p2: NORMAL });
    controller.setSpeed("instant");
    controller.start();
    while (controller.running) await settle();
    expect(controller.result).not.toBeNull();
    expect(engine.searches).toBe(controller.moves.length);
    controller.start();
    controller.step();
    expect(engine.searches).toBe(controller.moves.length);
  });
});
