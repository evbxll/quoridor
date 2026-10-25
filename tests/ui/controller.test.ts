import { describe, expect, it } from "vitest";
import type { SearchResponse } from "../../src/ai/protocol";
import type { SearchParams } from "../../src/ai/searchClient";
import { playerAction } from "../../src/engine/actions";
import { Game } from "../../src/engine/game";
import { parseMove } from "../../src/engine/notation";
import { GameController, type SearchPort } from "../../src/ui/controller";
import { LEVELS } from "../../src/ui/levels";

const [BEGINNER, NORMAL] = [LEVELS[0]!, LEVELS[1]!];

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
  answer(move: string): void {
    this.waiting.shift()!({ type: "result", id: 0, move, moves: [move], visits: [1], value: 0, principalVariation: [move] });
  }

  fail(message: string): void {
    this.waiting.shift()!(new Error(message));
  }

  /** Answers the oldest search the way the worker answers a cancelled one. */
  cancelled(): void {
    this.waiting.shift()!(null);
  }
}

const settle = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

function setup(size = 5, human: "p1" | "p2" = "p1", level = NORMAL) {
  const engine = new FakeEngine();
  const controller = new GameController(engine, () => {}, () => 0.5);
  controller.newGame(size, human, level);
  const play = (move: string): boolean => controller.playHuman(parseMove(controller.state, move));
  /** The person plays `mine`, the engine answers `theirs`. */
  const turn = async (mine: string, theirs: string): Promise<void> => {
    play(mine);
    engine.answer(theirs);
    await settle();
  };
  return { engine, controller, play, turn };
}

describe("GameController", () => {
  it("plays the person's move, asks the engine for a reply at the level's budget, and plays it", async () => {
    const { engine, controller, play } = setup(5, "p1", BEGINNER);
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
    const { engine, controller, play } = setup(5, "p2");
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
    const { engine, controller, turn } = setup(5, "p2");
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
    const { engine, controller, turn } = setup(5, "p2");
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
    controller.newGame(7, "p1", BEGINNER);
    expect(engine.cancels).toBe(1);
    expect(controller.size).toBe(7);
    expect(controller.moves).toEqual([]);
    engine.answer("c4"); // a late reply for the old 5x5 game
    await settle();
    expect(controller.moves).toEqual([]);
    expect(controller.level).toBe(BEGINNER);
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
    const { engine, controller, play } = setup(5, "p1", LEVELS[2]!);
    play("c2");
    expect(engine.requests[0]).toMatchObject({ engine: "network", simulations: 32, temperature: 0 });
    controller.setLevel(LEVELS[3]!);
    controller.undo();
    play("c2");
    expect(engine.requests[1]).toMatchObject({ engine: "network", simulations: 200 });
    controller.setLevel(NORMAL);
    controller.undo();
    play("c2");
    expect(engine.requests[2]).toMatchObject({ engine: "heuristic", simulations: 100 });
  });

  it("uses a new level on the bot's next move", () => {
    const { engine, controller, play } = setup();
    controller.setLevel(BEGINNER);
    play("c2");
    expect(engine.requests[0]).toMatchObject({ simulations: 5, temperature: 1 });
  });

  it("continues a game from a link as the side to move, and writes the link back", () => {
    const engine = new FakeEngine();
    const controller = new GameController(engine, () => {}, () => 0);
    controller.load(Game.fromHash("#n=5&m=c2.c4.c3"), NORMAL);
    expect(controller.human).toBe("p2");
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
    controller.load(Game.fromHash("#n=5&m=c2.c4.b3h"), NORMAL);
    expect(controller.lastMove).toEqual({ kind: "wall", row: 1, col: 1, orientation: 0 });
    expect(engine.requests).toHaveLength(2);
  });

  it("refuses a board size the site does not offer", () => {
    const { controller } = setup();
    for (const size of [0, 3, 6, 13]) expect(() => controller.newGame(size, "p1", NORMAL)).toThrow("no ");
    expect(() => controller.load(Game.fromHash("#n=13"), NORMAL)).toThrow("13x13");
    expect(controller.size).toBe(5);
  });

  it("does not search a game loaded as already over", () => {
    const engine = new FakeEngine();
    const controller = new GameController(engine, () => {}, () => 0);
    controller.load(Game.fromHash("#n=5&m=c2.b5.c3.a5.c4.b5.c5"), NORMAL);
    expect(controller.result?.winner).toBe("p1");
    expect(controller.human).toBe("p1");
    expect(controller.humanToMove).toBe(false);
    expect(engine.requests).toHaveLength(0);
  });
});
