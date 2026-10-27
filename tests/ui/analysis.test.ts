import { describe, expect, it } from "vitest";
import type { SearchResponse } from "../../src/ai/protocol";
import type { SearchParams } from "../../src/ai/searchClient";
import { Game } from "../../src/engine/game";
import { Analysis, ANALYSIS_SIMULATIONS, readingOf, replay } from "../../src/ui/analysis";
import { GameController, HUMAN, type SearchPort } from "../../src/ui/controller";
import { LEVELS } from "../../src/ui/levels";
import { formatAction } from "../../src/engine/notation";
import { GameState } from "../../src/engine/state";

const NORMAL = LEVELS[1]!;

/** A network the test answers by hand. */
class FakeNetwork implements SearchPort {
  readonly requests: SearchParams[] = [];
  private waiting: ((reply: SearchResponse | null | Error) => void)[] = [];

  search(params: SearchParams): Promise<SearchResponse | null> {
    this.requests.push(params);
    return new Promise((resolve, reject) => this.waiting.push((reply) => (reply instanceof Error ? reject(reply) : resolve(reply))));
  }

  cancel(): void {}

  answer(value: number, moves: string[], visits: number[]): void {
    this.waiting.shift()!({ type: "result", id: 0, move: moves[0]!, moves, visits, value, principalVariation: [] });
  }

  fail(message: string): void {
    this.waiting.shift()!(new Error(message));
  }

  cancelled(): void {
    this.waiting.shift()!(null);
  }
}

const settle = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

function setup(hash: string, ready = true) {
  const botPort = new FakeNetwork();
  const controller = new GameController(botPort, () => analysis.update());
  const network = new FakeNetwork();
  let changes = 0;
  let isReady = ready;
  const analysis: Analysis = new Analysis(controller, network, () => isReady, () => changes++);
  // The person plays the side to move, as the page seats them for a link.
  const game = Game.fromHash(hash);
  controller.load(game, game.result === null && !game.state.p1Turn ? { p1: NORMAL, p2: HUMAN } : { p1: HUMAN, p2: NORMAL });
  return { controller, analysis, network, botPort, changes: () => changes, setReady: (value: boolean) => (isReady = value) };
}

describe("readingOf", () => {
  it("turns the mover's value into player 1's share, and ranks the most visited moves", () => {
    const start = GameState.initial(5);
    const response = { type: "result", id: 0, move: "c2", moves: ["b1", "c2", "d1", "c1"], visits: [5, 20, 4, 0], value: 0.5, principalVariation: [] } as SearchResponse;
    const reading = readingOf(start, response);
    expect(reading.p1Share).toBeCloseTo(0.75);
    expect(reading.lines.map((l) => l.move)).toEqual(["c2", "b1", "d1"]);
    expect(reading.lines[0]!.share).toBeCloseTo(20 / 29);
    const second = replay(5, ["c2"], 1).state;
    expect(readingOf(second, response).p1Share).toBeCloseTo(0.25);
  });
});

describe("Analysis", () => {
  it("says it needs the network when none is ready, without searching", () => {
    const { analysis, network } = setup("#n=5&m=c2.c4", false);
    expect(analysis.view).toEqual({ status: "unavailable" });
    expect(network.requests).toEqual([]);
  });

  it("searches the latest position with the network at the Strong budget and shows the reading", async () => {
    const { analysis, network } = setup("#n=5&m=c2.c4");
    expect(analysis.view).toEqual({ status: "searching" });
    expect(network.requests).toEqual([{ engine: "network", size: 5, moves: ["c2", "c4"], simulations: ANALYSIS_SIMULATIONS, temperature: 0, seed: 0, reuseTree: false }]);
    expect(ANALYSIS_SIMULATIONS).toBe(32);
    network.answer(0.2, ["b3h", "c3"], [10, 22]);
    await settle();
    expect(analysis.view).toMatchObject({ status: "ready", reading: { p1Share: 0.6 } });
  });

  it("steps through the game, searching each position once", async () => {
    const { analysis, network } = setup("#n=5&m=c2.c4.c3");
    network.answer(0, ["c4"], [1]);
    await settle();
    analysis.step(-1);
    expect(analysis.ply).toBe(2);
    expect(network.requests.at(-1)!.moves).toEqual(["c2", "c4"]);
    network.answer(0.4, ["c3"], [1]);
    await settle();
    analysis.goTo(0);
    network.answer(0.1, ["c2"], [1]);
    await settle();
    expect(analysis.view).toMatchObject({ status: "ready", reading: { p1Share: 0.55 } });
    expect(network.requests).toHaveLength(3);
    analysis.step(1);
    network.answer(0, ["c4"], [1]);
    await settle();
    analysis.step(1);
    analysis.step(1);
    analysis.step(1);
    expect(analysis.ply).toBe(3);
    expect(network.requests).toHaveLength(4); // every position was read once
    expect(analysis.viewingPast).toBe(false);
    analysis.goTo(-5);
    expect(analysis.ply).toBe(0);
    expect(analysis.viewingPast).toBe(true);
  });

  it("follows new moves while on the latest position, and stays put on an earlier one", async () => {
    const { analysis, controller, network, botPort } = setup("#n=5&m=c2.c4");
    network.answer(0, ["c3"], [1]);
    await settle();
    controller.playHuman(controller.state.legalActions()[0]!);
    botPort.cancelled();
    await settle();
    expect(analysis.ply).toBe(3);

    analysis.goTo(1);
    const before = network.requests.length;
    controller.undo();
    expect(analysis.ply).toBe(1);
    expect(network.requests.length).toBeGreaterThanOrEqual(before);
  });

  it("does not search while the bot is thinking, and does afterwards", async () => {
    const { analysis, controller, network, botPort } = setup("#n=5&m=c2.c4");
    network.answer(0, ["c3"], [1]);
    await settle();
    const move = controller.state.legalActions().find((a) => a !== undefined)!;
    controller.playHuman(move);
    expect(controller.thinking).toBe(true);
    expect(network.requests).toHaveLength(1);
    const reply = formatAction(controller.state, controller.state.legalActions()[0]!);
    botPort.answer(0, [reply], [1]);
    await settle();
    expect(controller.thinking).toBe(false);
    expect(network.requests.length).toBe(2);
    expect(network.requests[1]!.moves).toHaveLength(4);
  });

  it("reads a finished game without searching", () => {
    const { analysis, network } = setup("#n=5&m=c2.b5.c3.a5.c4.b5.c5");
    expect(analysis.view).toMatchObject({ status: "ready", reading: { p1Share: 1, lines: [] } });
    analysis.goTo(6);
    expect(network.requests).toHaveLength(1);
    const drawn = setup("#n=5&m=c2.c4.c1.c5.c2.c4.c1.c5");
    expect(drawn.analysis.view).toMatchObject({ status: "ready", reading: { p1Share: 0.5 } });
    expect(drawn.network.requests).toEqual([]);
  });

  it("shows a failure, and treats a cancelled search as no failure", async () => {
    const { analysis, network } = setup("#n=5&m=c2.c4");
    network.cancelled();
    await settle();
    expect(analysis.view).toEqual({ status: "searching" });
    analysis.step(-1);
    network.fail("no network");
    await settle();
    expect(analysis.view).toEqual({ status: "failed", message: "no network" });
  });

  it("keeps a failure with the position it happened at, and tries that position again when it is visited again", async () => {
    const { analysis, network } = setup("#n=5&m=c2.c4");
    network.answer(0, ["c3"], [1]);
    await settle();
    analysis.step(-1);
    network.fail("no network");
    await settle();
    expect(analysis.view).toEqual({ status: "failed", message: "no network" });
    analysis.step(1);
    expect(analysis.view).toMatchObject({ status: "ready" });
    analysis.step(-1);
    expect(analysis.view).toEqual({ status: "searching" });
    expect(network.requests).toHaveLength(3);
    network.answer(0.2, ["c2"], [1]);
    await settle();
    expect(analysis.view).toMatchObject({ status: "ready" });
  });

  it("says each reading once, in words with the position", async () => {
    const { analysis, network } = setup("#n=5&m=c2.c4");
    expect(analysis.takeAnnouncement()).toBeNull();
    network.answer(0.2, ["b3h", "c3"], [10, 22]);
    await settle();
    expect(analysis.takeAnnouncement()).toBe("After move 2 of 2 (c4): Player 1 60%, player 2 40%. Best moves: c3, b3h.");
    expect(analysis.takeAnnouncement()).toBeNull();
    analysis.goTo(0);
    expect(analysis.where).toBe("the start");
    expect(analysis.takeAnnouncement()).toBeNull();
    network.answer(0, ["c2"], [1]);
    await settle();
    expect(analysis.takeAnnouncement()).toBe("After the start: Player 1 50%, player 2 50%. Best moves: c2.");
    analysis.goTo(2);
    expect(analysis.takeAnnouncement()).toMatch(/^After move 2 of 2/);
    expect(analysis.takeAnnouncement()).toBeNull();
  });

  it("starts over for a new game", async () => {
    const { analysis, controller, network } = setup("#n=5&m=c2.c4");
    network.answer(0, ["c3"], [1]);
    await settle();
    controller.newGame(5, { p1: HUMAN, p2: NORMAL });
    analysis.reset();
    analysis.update();
    expect(analysis.ply).toBe(0);
    expect(analysis.view).toEqual({ status: "searching" });
    expect(network.requests.at(-1)!.moves).toEqual([]);
  });
});

describe("replay", () => {
  it("returns the position after some moves and where the last one landed", () => {
    expect(replay(5, ["c2", "c4"], 0)).toMatchObject({ last: null });
    expect(replay(5, ["c2", "c4"], 1).last).toEqual({ kind: "move", row: 3, col: 2 });
    expect(replay(5, ["c2", "c4", "b3h"], 9).state.positionKey()).toBe(replay(5, ["c2", "c4", "b3h"], 3).state.positionKey());
  });
});
