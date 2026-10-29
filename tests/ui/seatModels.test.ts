import { describe, expect, it } from "vitest";
import type { ModelState } from "../../src/model/manager";
import { SeatModels } from "../../src/ui/seatModels";

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
    const { calls, sync, models } = setup();
    sync(["a", "a"]);
    sync(["a"]);
    expect(calls).toEqual(["ensure a"]);
    expect([...models.ids]).toEqual(["a"]);
  });

  it("holds at most the models of the two seats", () => {
    const { models, sync } = setup();
    sync(["a", "b"]);
    sync(["c", "b"]);
    expect(models.ids.size).toBe(2);
    expect([...models.ids].sort()).toEqual(["b", "c"]);
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
