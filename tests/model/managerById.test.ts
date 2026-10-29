import { describe, expect, it } from "vitest";
import { ModelManager, type StartInfo } from "../../src/model/manager";
import { cardJson, fcCardJson } from "../helpers/cards";
import { envOf, fakeFetch, FakeCaches, sha256, streamed } from "../helpers/fakeBrowser";

const bytesOf = (length: number, step: number, modulus: number): Uint8Array => new Uint8Array(length).map((_, i) => (i * step) % modulus);
const m1 = bytesOf(400, 11, 253);
const m2 = bytesOf(300, 5, 241);
const m3 = bytesOf(200, 3, 199);
const entry = (id: string, bytes: Uint8Array) => ({ id, path: `models/${id}/model.onnx`, sha256: sha256(bytes) });
const models = [entry("m1", m1), entry("m2", m2), entry("m3", m3)];

type Files = Record<string, (signal?: AbortSignal) => Response>;

const files = (extra: Files = {}, indexJson: object = { models, bots: { 9: "m1" }, gallery: ["m2", "m3", "m2", "heuristic", "ghost"] }): Files => ({
  "models/index.json": () => new Response(JSON.stringify(indexJson)),
  "models/m1/model.onnx": () => streamed(m1, 4),
  "models/m2/model.onnx": () => streamed(m2, 3),
  "models/m3/model.onnx": () => streamed(m3, 2),
  "models/m1/card.json": () => new Response(JSON.stringify(cardJson("m1", {}, models[0]!.sha256))),
  "models/m2/card.json": () => new Response(JSON.stringify(cardJson("m2", {}, models[1]!.sha256))),
  "models/m3/card.json": () => new Response(JSON.stringify(fcCardJson("m3", models[2]!.sha256))),
  ...extra,
});

function build(extra: Files = {}, indexJson?: object, caches = new FakeCaches(), begin?: (info: StartInfo) => Promise<void>) {
  const { fetch, requested } = fakeFetch(files(extra, indexJson));
  const infos: StartInfo[] = [];
  const stopped: string[] = [];
  const manager = new ModelManager(
    envOf(fetch, caches),
    async (_bytes, info) => {
      infos.push(info);
      await begin?.(info);
    },
    () => {},
    async (id) => void stopped.push(id),
  );
  return { manager, infos, stopped, requested, caches };
}

describe("ModelManager keyed by model id", () => {
  it("is idle for a gallery model until it is asked for, and fetches nothing for it", async () => {
    const { manager, requested } = build();
    expect(manager.stateOf("m2")).toEqual({ status: "checking" });
    await manager.select(9);
    expect(manager.gallery).toEqual(["m2", "m3"]);
    expect(manager.stateOf("m2")).toEqual({ status: "idle" });
    expect(manager.stateOf("ghost")).toEqual({ status: "unavailable", reason: "unknown-model" });
    expect(requested.filter((url) => /m2|m3/.test(url))).toEqual([]);
  });

  it("loads two ids at once, each with the plane count and size of its own card, and keeps both ready", async () => {
    const { manager, infos } = build();
    await manager.select(9);
    await Promise.all([manager.ensure("m2"), manager.ensure("m3")]);
    expect(manager.stateOf("m2")).toMatchObject({ status: "ready", model: "m2" });
    expect(manager.stateOf("m3")).toMatchObject({ status: "ready", model: "m3" });
    expect(manager.state(9)).toMatchObject({ status: "ready", model: "m1" });
    expect(infos.find((info) => info.id === "m1")).toEqual({ id: "m1", planes: 10, fixedSize: null, asDefault: true });
    expect(infos.find((info) => info.id === "m2")).toEqual({ id: "m2", planes: 10, fixedSize: null, asDefault: false });
    expect(infos.find((info) => info.id === "m3")).toEqual({ id: "m3", planes: 6, fixedSize: 9, asDefault: false });
  });

  it("loads one id once however many ask for it at the same time", async () => {
    const { manager, requested, infos } = build();
    await Promise.all([manager.ensure("m2"), manager.ensure("m2"), manager.ensure("m2")]);
    expect(manager.stateOf("m2").status).toBe("ready");
    expect(requested.filter((url) => url.endsWith("m2/model.onnx"))).toHaveLength(1);
    expect(infos).toHaveLength(1);
  });

  it("reports download progress for an id on its own", async () => {
    const seen: string[] = [];
    const { fetch } = fakeFetch(files());
    const manager = new ModelManager(
      envOf(fetch, new FakeCaches()),
      async () => {},
      () => {
        const state = manager.stateOf("m2");
        if (state.status === "downloading") seen.push(`${state.loaded}/${state.total}`);
      },
    );
    await manager.ensure("m2");
    expect(seen).toContain("0/null");
    expect(seen.at(-1)).toBe("300/300");
    expect(manager.stateOf("m3")).toEqual({ status: "idle" });
  });

  it("fails one model on its checksum without touching another", async () => {
    const bad = m2.slice();
    bad[0] = bad[0]! ^ 1;
    const { manager, infos } = build({ "models/m2/model.onnx": () => streamed(bad, 3) });
    await Promise.all([manager.ensure("m2"), manager.ensure("m3")]);
    expect(manager.stateOf("m2")).toMatchObject({ status: "failed", kind: "hash" });
    expect(manager.stateOf("m3").status).toBe("ready");
    expect(infos.map((info) => info.id)).toEqual(["m3"]);
  });

  it("makes a model unavailable, with the reason, when its card is missing, malformed, hostile or another model's", async () => {
    const sum = models[1]!.sha256;
    const card = (json: unknown) => () => new Response(typeof json === "string" ? json : JSON.stringify(json));
    const bad = [
      () => new Response("", { status: 404 }),
      card("{ nope"),
      card(cardJson("m2", { network: { head: "conv", input_planes: 7 } }, sum)),
      card(cardJson("m2", { display_name: "<img src=x onerror=alert(1)>".repeat(40) }, sum)),
      card(cardJson("m1", {}, sum)),
      card(cardJson("m2", {}, "b".repeat(64))),
    ];
    for (const reply of bad) {
      const { manager, infos } = build({ "models/m2/card.json": reply });
      await manager.ensure("m2");
      expect(manager.stateOf("m2")).toMatchObject({ status: "unavailable", reason: "bad-card", message: expect.stringContaining("m2") });
      expect(infos).toEqual([]);
    }
  });

  it("fails, to retry, when the card cannot be reached, and works from a remembered card offline", async () => {
    let online = true;
    const base = fakeFetch(files());
    const flaky = ((input: RequestInfo | URL, init?: RequestInit) =>
      !online && String(input).endsWith("card.json") ? Promise.reject(new TypeError("offline")) : base.fetch(input, init)) as typeof fetch;
    const caches = new FakeCaches();
    const first = new ModelManager(envOf(flaky, caches), async () => {}, () => {});
    await first.ensure("m2");
    expect(first.stateOf("m2").status).toBe("ready");
    online = false;
    const again = new ModelManager(envOf(flaky, caches), async () => {}, () => {});
    await again.ensure("m2");
    expect(again.stateOf("m2").status).toBe("ready");
    await again.ensure("m3");
    expect(again.stateOf("m3")).toMatchObject({ status: "failed", kind: "network" });
  });

  it("reads a card on demand, once, and says which sizes a model plays", async () => {
    const { manager, requested } = build();
    expect(manager.cardIfLoaded("m3")).toBeNull();
    const [a, b] = await Promise.all([manager.card("m3"), manager.card("m3")]);
    expect(a).toBe(b);
    expect(requested.filter((url) => url.endsWith("m3/card.json"))).toHaveLength(1);
    expect(requested.some((url) => url.endsWith("m3/model.onnx"))).toBe(false);
    expect(manager.stateFor("m3", 9)).toEqual({ status: "idle" });
    expect(manager.stateFor("m3", 7)).toEqual({ status: "unavailable", reason: "unsupported-size" });
    await manager.card("m2");
    expect([5, 7, 9, 11].map((size) => manager.stateFor("m2", size).status)).toEqual(["idle", "idle", "idle", "idle"]);
    expect(manager.stateFor("m2", 13).status).toBe("unavailable");
    await expect(manager.card("ghost")).rejects.toThrow("no model ghost");
  });

  it("stops the network a size selected before, but not one a seat asked for, and a seat can release its own", async () => {
    const { manager, stopped } = build({}, { models, bots: { 5: "m1", 9: "m2" }, gallery: ["m1", "m2"] });
    await manager.select(5);
    await manager.ensure("m2");
    await manager.select(9);
    expect(stopped).toEqual(["m1"]);
    await manager.select(5);
    expect(stopped).toEqual(["m1"]);
    expect(manager.stateOf("m2").status).toBe("ready");
    await manager.release("m2");
    expect(stopped).toEqual(["m1", "m2"]);
    expect(manager.stateOf("m2")).toEqual({ status: "idle" });
  });

  it("leaves an index without a gallery exactly as it was", async () => {
    const { manager, requested } = build({}, { models, bots: { 9: "m1" } });
    await manager.select(9);
    expect(manager.gallery).toEqual([]);
    expect(manager.state(9)).toMatchObject({ status: "ready", model: "m1" });
    expect(requested.filter((url) => url.endsWith(".onnx") || url.endsWith("card.json")).sort()).toHaveLength(2);
  });

  /** A gate a test opens when it wants a worker start to finish. */
  const gate = () => {
    let open: () => void = () => {};
    const opened = new Promise<void>((resolve) => (open = resolve));
    return { opened, open };
  };
  const settle = () => new Promise((resolve) => setTimeout(resolve, 20));
  const twoBots = { models, bots: { 9: "m1", 7: "m2" }, gallery: [] };

  it("keeps the network of the selected size when a seat that had asked for it lets it go", async () => {
    const { manager, stopped } = build();
    await manager.select(9);
    await manager.ensure("m1");
    await manager.release("m1");
    expect(stopped).toEqual([]);
    expect(manager.state(9)).toMatchObject({ status: "ready", model: "m1" });
  });

  it("frees the session of a model a seat released while the worker was starting it", async () => {
    const hold = gate();
    const { manager, stopped } = build({}, undefined, undefined, (info) => (info.id === "m2" ? hold.opened : Promise.resolve()));
    const loading = manager.ensure("m2");
    await settle();
    await manager.release("m2");
    hold.open();
    await loading;
    expect(stopped).toEqual(["m2"]);
    expect(manager.stateOf("m2")).toEqual({ status: "idle" });
  });

  it("frees the session of the network of a size that was left while the worker was starting it", async () => {
    const hold = gate();
    const { manager, stopped } = build({}, twoBots, undefined, (info) => (info.id === "m1" ? hold.opened : Promise.resolve()));
    const first = manager.select(9);
    await settle();
    await manager.select(7);
    hold.open();
    await first;
    expect(stopped).toEqual(["m1"]);
    expect(manager.state(9)).toEqual({ status: "checking" });
    expect(manager.state(7)).toMatchObject({ status: "ready", model: "m2" });
  });

  it("starts a model a seat asked for as the default when its size is chosen while it starts", async () => {
    const hold = gate();
    const { manager, infos, stopped } = build({}, twoBots, undefined, (info) => (info.id === "m2" && !info.asDefault ? hold.opened : Promise.resolve()));
    await manager.select(9);
    const seat = manager.ensure("m2");
    await settle();
    await manager.select(7);
    hold.open();
    await seat;
    expect(infos.filter((info) => info.id === "m2").map((info) => info.asDefault)).toEqual([false, true]);
    expect(stopped).toEqual(["m1"]);
    expect(manager.state(7)).toMatchObject({ status: "ready", model: "m2" });
  });

  it("stops downloading the model when its card cannot be used", async () => {
    let seen: AbortSignal | undefined;
    const { manager } = build({
      "models/m2/card.json": () => new Response("{ nope"),
      "models/m2/model.onnx": (signal) => {
        seen = signal;
        return streamed(m2, 3, signal ? { stallAfter: 1, signal } : { stallAfter: 1 });
      },
    });
    await manager.ensure("m2");
    await settle();
    expect(manager.stateOf("m2")).toMatchObject({ status: "unavailable", reason: "bad-card" });
    // The download either never started or was aborted; it is not left running (or stalled) behind the failure.
    expect(seen === undefined || seen.aborted).toBe(true);
  });

  it("saves the card for offline use", async () => {
    const { manager, caches } = build();
    await manager.ensure("m2");
    expect([...caches.stored.keys()].some((url) => url.endsWith("models/m2/card.json"))).toBe(true);
  });

  it("names the main model of a size, and none where the index withholds the network or publishes none", async () => {
    const { manager } = build({}, { models, bots: { 9: "m1", 7: "heuristic" }, gallery: [] });
    expect(manager.mainIdFor(9)).toBeNull();
    await manager.select(9);
    expect(manager.mainIdFor(9)).toBe("m1");
    expect(manager.mainIdFor(7)).toBeNull();
    expect(manager.mainIdFor(11)).toBeNull();
  });
});
