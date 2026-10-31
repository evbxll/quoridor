import { describe, expect, it } from "vitest";
import type { ModelState } from "../../src/model/manager";
import { botOf, withModel } from "../../src/ui/bots";
import { HUMAN, type Players } from "../../src/ui/controller";
import { dropUnplayable, droppedSentence, playableModel, SeatModels, setSeatPlayers } from "../../src/ui/seatModels";

const READY: ModelState = { status: "ready", model: "m", fromCache: false, saved: true };
const FAILED: ModelState = { status: "failed", message: "Offline.", kind: "network" };
const DOWNLOADING: ModelState = { status: "downloading", loaded: 1, total: 10 };

function setup() {
  const calls: string[] = [];
  const said: string[] = [];
  const states = new Map<string, ModelState>();
  const port = {
    ensure: async (id: string) => void calls.push(`ensure ${id}`),
    release: async (id: string) => void calls.push(`release ${id}`),
  };
  const models = new SeatModels(port, (id, state) => said.push(`${id} ${state.status}`));
  const sync = (used: string[]): void => models.sync(used, (id) => states.get(id) ?? { status: "idle" });
  return { calls, said, states, models, sync };
}

describe("SeatModels", () => {
  it("loads a model when a seat takes it, once however often it is synced", () => {
    const { calls, sync } = setup();
    sync(["a"]);
    sync(["a"]);
    sync(["a", "a"]);
    expect(calls).toEqual(["ensure a"]);
  });

  it("releases a model when no seat holds it any more, and keeps one that a seat still holds", () => {
    const { calls, sync } = setup();
    sync(["a", "b"]);
    sync(["b"]);
    expect(calls).toEqual(["ensure a", "ensure b", "release a"]);
    sync([]);
    expect(calls.slice(3)).toEqual(["release b"]);
  });

  it("holds one session for two seats that use the same model", () => {
    const { calls, sync } = setup();
    sync(["a", "a"]);
    sync(["a"]);
    expect(calls).toEqual(["ensure a"]);
  });

  it("holds at most the models of the two seats", () => {
    const { calls, sync } = setup();
    sync(["a", "b"]);
    sync(["c", "b"]);
    expect(calls).toEqual(["ensure a", "ensure b", "release a", "ensure c"]);
  });

  it("says once when a model becomes ready or fails, and not for loading", () => {
    const { said, states, sync } = setup();
    sync(["a", "b"]);
    states.set("a", DOWNLOADING);
    sync(["a", "b"]);
    states.set("a", READY);
    states.set("b", FAILED);
    sync(["a", "b"]);
    sync(["a", "b"]);
    expect(said).toEqual(["a ready", "b failed"]);
  });

  it("keeps a failure of one model apart from the other, and says a second failure after a retry", () => {
    const { said, calls, states, models, sync } = setup();
    sync(["a", "b"]);
    states.set("b", FAILED);
    states.set("a", READY);
    sync(["a", "b"]);
    models.retry("b");
    expect(calls.at(-1)).toBe("ensure b");
    states.set("b", DOWNLOADING);
    sync(["a", "b"]);
    states.set("b", FAILED);
    sync(["a", "b"]);
    expect(said).toEqual(["a ready", "b failed", "b failed"]);
  });

  it("says a model again after it was released and taken anew", () => {
    const { said, states, sync } = setup();
    sync(["a"]);
    states.set("a", READY);
    sync(["a"]);
    sync([]);
    sync(["a"]);
    expect(said).toEqual(["a ready", "a ready"]);
  });
});

describe("a model the board does not offer", () => {
  const offered = (id: string, size: number): boolean => id !== "fc" || size === 9;
  const strong = botOf("strong");
  const players = (p1: string | undefined, p2: string | undefined): Players => ({ p1: withModel(strong, p1), p2: withModel(strong, p2) });

  it("is not kept by a seat: only a model offered at the size stays", () => {
    expect(playableModel("fc", offered, 7)).toBeUndefined();
    expect(playableModel("fc", offered, 9)).toBe("fc");
    expect(playableModel("conv", offered, 7)).toBe("conv");
    expect(playableModel(undefined, offered, 7)).toBeUndefined();
  });

  it("is taken from the seats that hold it, leaving the others as they are", () => {
    const { players: next, dropped } = dropUnplayable(players("fc", "conv"), offered, 7);
    expect(next).toEqual(players(undefined, "conv"));
    expect(dropped).toEqual([{ side: "p1", model: "fc" }]);
    expect(dropUnplayable(players("fc", "conv"), offered, 9).dropped).toEqual([]);
    expect(dropUnplayable({ p1: HUMAN, p2: strong }, offered, 7).dropped).toEqual([]);
  });

  it("is said in one sentence for both seats", () => {
    const { dropped } = dropUnplayable(players("fc", "fc"), offered, 7);
    expect(droppedSentence(dropped, 7, (id) => `Model ${id}`)).toBe(
      "Model fc is not offered on 7 × 7, so player 1 plays the main network; Model fc is not offered on 7 × 7, so player 2 plays the main network.",
    );
    expect(droppedSentence([], 7, (id) => id)).toBeNull();
  });
});

describe("setSeatPlayers", () => {
  it("gives the players to the game and then loads the models they hold", () => {
    const order: string[] = [];
    setSeatPlayers({ setPlayers: () => void order.push("players") }, { p1: HUMAN, p2: HUMAN }, () => order.push("sync"));
    expect(order).toEqual(["players", "sync"]);
  });
});
