import { describe, expect, it } from "vitest";
import type { SearchResponse } from "../../src/ai/protocol";
import type { SearchParams } from "../../src/ai/searchClient";
import { botOf, setModelLabel, withModel } from "../../src/ui/bots";
import { GameController, HUMAN, type Players, type SearchPort } from "../../src/ui/controller";
import { botKind, markerBlurb } from "../../src/ui/evalTip";

class FakeEngine implements SearchPort {
  readonly requests: SearchParams[] = [];
  cancels = 0;
  private waiting: ((reply: SearchResponse | null) => void)[] = [];

  search(params: SearchParams): Promise<SearchResponse | null> {
    this.requests.push(params);
    return new Promise((resolve) => this.waiting.push(resolve));
  }

  cancel(): void {
    this.cancels++;
  }

  answer(move: string): void {
    this.waiting.shift()!({ type: "result", id: 0, move, moves: [move], visits: [1], value: 0, principalVariation: [move] });
  }
}

const settle = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));
const OLD = "s9-conv-paths-g050";
const OTHER = "s9-conv-paths-g010";
const strong = botOf("strong");
const withOld = withModel(strong, OLD);

function setup(players: Players) {
  const engine = new FakeEngine();
  const controller = new GameController(engine, () => {}, () => 0.5);
  controller.setNetworkReady(true);
  controller.newGame(5, players);
  return { engine, controller };
}

describe("a seat with a gallery model", () => {
  it("names the model in the search and leaves the field out for the main model", () => {
    const { engine, controller } = setup({ p1: withOld, p2: HUMAN });
    controller.setReadyModels(new Set([OLD]));
    expect(engine.requests).toHaveLength(1);
    expect(engine.requests[0]).toMatchObject({ engine: "network", model: OLD, simulations: 32 });

    const main = setup({ p1: strong, p2: HUMAN });
    expect("model" in main.engine.requests[0]!).toBe(false);
  });

  it("waits for its model and does not skip its turn, then moves when the model is ready", async () => {
    const { engine, controller } = setup({ p1: withOld, p2: HUMAN });
    expect(engine.requests).toHaveLength(0);
    expect(controller.waiting).toBe(true);
    expect(controller.waitingModel).toBe(OLD);
    expect(controller.moves).toEqual([]);
    controller.setReadyModels(new Set([OLD]));
    expect(controller.waiting).toBe(false);
    engine.answer("c2");
    await settle();
    expect(controller.moves).toEqual(["c2"]);
  });

  it("does not take the main model being ready as its model being ready, nor the reverse", () => {
    const { engine, controller } = setup({ p1: withOld, p2: HUMAN });
    expect(controller.waiting).toBe(true);
    const main = new GameController(new FakeEngine(), () => {});
    main.newGame(5, { p1: strong, p2: HUMAN });
    main.setReadyModels(new Set([OLD]));
    expect(main.waiting).toBe(true);
    expect(main.waitingModel).toBeNull();
    expect(engine.requests).toHaveLength(0);
  });

  it("lets the other seat wait on its own model: one model failing leaves the other seat's alone", async () => {
    const { engine, controller } = setup({ p1: withOld, p2: withModel(strong, OTHER) });
    controller.setSpeed("instant");
    controller.setReadyModels(new Set([OTHER]));
    controller.start();
    expect(controller.waitingModel).toBe(OLD);
    controller.setReadyModels(new Set([OTHER, OLD]));
    engine.answer("c2");
    await settle();
    expect(engine.requests.map((r) => r.model)).toEqual([OLD, OTHER]);
  });

  it("restarts the mover's search when its model changes", async () => {
    const { engine, controller } = setup({ p1: withOld, p2: HUMAN });
    controller.setReadyModels(new Set([OLD, OTHER]));
    expect(engine.requests).toHaveLength(1);
    controller.setPlayers({ p1: withModel(strong, OTHER), p2: HUMAN });
    expect(engine.cancels).toBe(1);
    expect(engine.requests.map((r) => r.model)).toEqual([OLD, OTHER]);
    engine.answer("a2");
    engine.answer("c2");
    await settle();
    expect(controller.moves).toEqual(["c2"]);
  });

  it("does not restart a search when the other seat's model changes", () => {
    const { engine, controller } = setup({ p1: withOld, p2: withModel(strong, OTHER) });
    controller.setReadyModels(new Set([OLD, OTHER]));
    controller.setSpeed("instant");
    controller.setPlayers({ p1: withOld, p2: strong });
    expect(engine.cancels).toBe(0);
  });

  it("names the model in the marker blurb, and tells a model change from the same bot", () => {
    setModelLabel(OLD, "Conv, gen 50");
    expect(botKind(withOld)).toBe("Strong, network (Conv, gen 50), 32 simulations");
    expect(botKind(strong)).toBe("Strong, network, 32 simulations");
    const blurb = markerBlurb({ side: "p1", seat: withModel(strong, OTHER), p1Percent: 60, source: { move: 1, bot: withOld }, viewingPast: false });
    expect(blurb).toContain("previous bot (Strong, network (Conv, gen 50), 32 simulations)");
  });
});
