import { describe, expect, it } from "vitest";
import { ModelManager, type ModelState } from "../../src/model/manager";
import { cardJson } from "../helpers/cards";
import { envOf, fakeFetch, FakeCaches, sha256, streamed } from "../helpers/fakeBrowser";

const model = new Uint8Array(400).map((_, i) => (i * 11) % 253);
const entry = { id: "m1", path: "models/m1/model.onnx", sha256: sha256(model) };
const other = new Uint8Array(300).map((_, i) => (i * 5) % 241);
const second = { id: "m2", path: "models/m2/model.onnx", sha256: sha256(other) };
const index = (bots: Record<string, string>, models = [entry]) => JSON.stringify({ models, bots });

function setup(options: { files?: Record<string, (signal?: AbortSignal) => Response>; start?: (bytes: ArrayBuffer) => Promise<void>; stallMs?: number } = {}) {
  const { fetch, requested } = fakeFetch({
    "models/index.json": () => new Response(index({ 5: "m1", 9: "m1" })),
    "models/m1/model.onnx": () => streamed(model, 4),
    "models/m1/card.json": () => new Response(JSON.stringify(cardJson("m1", {}, entry.sha256))),
    ...options.files,
  });
  const started: ArrayBuffer[] = [];
  const changes: ModelState[] = [];
  let manager!: ModelManager;
  manager = new ModelManager(
    envOf(fetch, new FakeCaches(), options.stallMs),
    options.start ?? (async (bytes) => void started.push(bytes)),
    () => changes.push(manager.state(9)),
  );
  return { manager, started, changes, requested };
}

describe("ModelManager", () => {
  it("starts out checking, then downloads with progress and hands the bytes to the worker", async () => {
    const { manager, started, changes } = setup();
    expect(manager.state(9)).toEqual({ status: "checking" });
    await manager.select(9);
    expect(manager.state(9)).toEqual({ status: "ready", model: "m1", fromCache: false, saved: true });
    expect(started).toHaveLength(1);
    expect(new Uint8Array(started[0]!)).toEqual(model);
    const downloading = changes.filter((s) => s.status === "downloading");
    expect(downloading.at(-1)).toEqual({ status: "downloading", loaded: 400, total: 400 });
    expect(changes.at(-1)?.status).toBe("ready");
  });

  it("has no network for a size without a bot, or without any index, and never breaks", async () => {
    const { manager, requested } = setup();
    await manager.select(7);
    expect(manager.state(7)).toEqual({ status: "unavailable", reason: "none-published" });
    expect(requested.some((url) => url.endsWith(".onnx"))).toBe(false);

    const none = setup({ files: { "models/index.json": () => new Response("nope", { status: 404 }) } });
    await none.manager.select(9);
    expect(none.manager.state(9)).toEqual({ status: "unavailable", reason: "none-published" });
    expect(none.started).toEqual([]);
  });

  it('treats a size the index sets to "heuristic" as not offered, and downloads nothing for it', async () => {
    const { manager, requested, started } = setup({ files: { "models/index.json": () => new Response(index({ 5: "heuristic", 9: "m1" })) } });
    await manager.select(5);
    expect(manager.state(5)).toEqual({ status: "unavailable", reason: "not-offered" });
    expect(requested.some((url) => url.endsWith(".onnx"))).toBe(false);
    expect(started).toEqual([]);
    await manager.select(9);
    expect(manager.state(9).status).toBe("ready");
    expect(manager.state(5)).toEqual({ status: "unavailable", reason: "not-offered" });
  });

  it("downloads once for every size the model plays", async () => {
    const { manager, started, requested } = setup();
    await manager.select(9);
    await manager.select(5);
    expect(manager.state(5).status).toBe("ready");
    expect(started).toHaveLength(1);
    expect(requested.filter((url) => url.endsWith(".onnx"))).toHaveLength(1);
  });

  it("reports a model that fails its checksum, does not start it, and recovers on retry", async () => {
    const bad = model.slice();
    bad[0] = bad[0]! ^ 1;
    let serve = bad;
    const { manager, started } = setup({ files: { "models/m1/model.onnx": () => streamed(serve, 2) } });
    await manager.select(9);
    expect(manager.state(9)).toMatchObject({ status: "failed", kind: "hash", message: expect.stringContaining("does not match") });
    expect(started).toEqual([]);
    serve = model;
    await manager.retry(9);
    expect(manager.state(9).status).toBe("ready");
    expect(started).toHaveLength(1);
  });

  it("reports an interrupted download and retries it", async () => {
    let broken = true;
    const { manager } = setup({ files: { "models/m1/model.onnx": () => streamed(model, 4, broken ? { breakAfter: 1 } : {}) } });
    await manager.select(9);
    expect(manager.state(9)).toMatchObject({ status: "failed", message: expect.stringContaining("interrupted") });
    broken = false;
    await manager.retry(9);
    expect(manager.state(9).status).toBe("ready");
  });

  it("gives up on a download that stalls, and a retry starts it over", async () => {
    let stall = true;
    const { manager, started } = setup({
      stallMs: 40,
      files: { "models/m1/model.onnx": (signal) => (stall ? streamed(model, 4, signal ? { stallAfter: 1, signal } : { stallAfter: 1 }) : streamed(model, 4)) },
    });
    await manager.select(9);
    expect(manager.state(9)).toMatchObject({ status: "failed", kind: "stalled" });
    stall = false;
    await manager.retry(9);
    expect(manager.state(9).status).toBe("ready");
    expect(started).toHaveLength(1);
  });

  it("aborts a hanging download when Retry is pressed, and ignores what the aborted one reports", async () => {
    let stall = true;
    const { manager, started } = setup({
      stallMs: 5000,
      files: { "models/m1/model.onnx": (signal) => (stall ? streamed(model, 4, signal ? { stallAfter: 1, signal } : { stallAfter: 1 }) : streamed(model, 4)) },
    });
    const hanging = manager.select(9);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(manager.state(9).status).toBe("downloading");
    stall = false;
    await manager.retry(9);
    await hanging;
    expect(manager.state(9)).toMatchObject({ status: "ready" });
    expect(started).toHaveLength(1);
  });

  it("reports a network the worker could not start", async () => {
    const { manager } = setup({
      start: async () => {
        throw new Error("no wasm");
      },
    });
    await manager.select(9);
    expect(manager.state(9)).toMatchObject({ status: "failed", kind: "start", message: "The network could not be started (no wasm)." });
  });

  it("does not start a second download while one is running", async () => {
    const { manager, requested } = setup();
    await Promise.all([manager.select(9), manager.select(9), manager.select(5)]);
    expect(requested.filter((url) => url.endsWith(".onnx"))).toHaveLength(1);
  });
});

describe("ModelManager.publishesAny", () => {
  it("is unknown until the index is read, then says whether any size has a network", async () => {
    const some = setup();
    expect(some.manager.publishesAny).toBeNull();
    await some.manager.select(7);
    expect(some.manager.publishesAny).toBe(true);

    const missing = setup({ files: { "models/index.json": () => new Response("nope", { status: 404 }) } });
    await missing.manager.select(9);
    expect(missing.manager.publishesAny).toBe(false);

    const withheld = setup({ files: { "models/index.json": () => new Response(index({ 5: "heuristic", 9: "heuristic" })) } });
    await withheld.manager.select(9);
    expect(withheld.manager.publishesAny).toBe(false);

    const broken = setup({ files: { "models/index.json": () => new Response("x", { status: 500 }) } });
    await broken.manager.select(9);
    expect(broken.manager.publishesAny).toBeNull();
  });
});

describe("ModelManager and the index", () => {
  it("shows a failed index read as a failure with a retry, not as no model, and reads again on retry", async () => {
    let down = true;
    const { manager, started } = setup({ files: { "models/index.json": () => (down ? new Response("down", { status: 503 }) : new Response(index({ 9: "m1" }))) } });
    await manager.select(9);
    expect(manager.state(9)).toMatchObject({ status: "failed", kind: "http", message: expect.stringContaining("503") });
    expect(manager.state(5).status).toBe("failed");
    down = false;
    await manager.retry(9);
    expect(manager.state(9).status).toBe("ready");
    expect(started).toHaveLength(1);
  });

  it("tells a missing index (nothing published) from one that could not be read", async () => {
    const { manager } = setup({ files: { "models/index.json": () => new Response("", { status: 404 }) } });
    await manager.select(9);
    expect(manager.state(9)).toEqual({ status: "unavailable", reason: "none-published" });
  });
});

describe("ModelManager with two models", () => {
  const files = {
    "models/index.json": () => new Response(index({ 5: "m1", 9: "m2" }, [entry, second])),
    "models/m2/model.onnx": () => streamed(other, 3),
    "models/m1/card.json": () => new Response(JSON.stringify(cardJson("m1", {}, entry.sha256))),
    "models/m2/card.json": () => new Response(JSON.stringify(cardJson("m2", {}, second.sha256))),
  };

  it("keeps the model of the size selected last active, even when the other finishes starting later", async () => {
    let releaseFirst: () => void = () => {};
    const gate = new Promise<void>((resolve) => (releaseFirst = resolve));
    const started: ArrayBuffer[] = [];
    const { fetch } = fakeFetch({ ...files, "models/m1/model.onnx": () => streamed(model, 2) });
    let manager!: ModelManager;
    manager = new ModelManager(
      envOf(fetch, new FakeCaches()),
      async (bytes) => {
        started.push(bytes);
        if (bytes.byteLength === model.length) await gate;
      },
      () => {},
    );
    const first = manager.select(5);
    await new Promise((resolve) => setTimeout(resolve, 20));
    await manager.select(9);
    releaseFirst();
    await first;
    expect(manager.state(9).status).toBe("ready");
    // The worker is told in call order, so the model of the size chosen last is the one it ends with.
    expect(started.map((b) => b.byteLength)).toEqual([model.length, other.length]);
    expect(manager.state(5).status).toBe("checking");
    await manager.select(5);
    expect(manager.state(5).status).toBe("ready");
    expect(manager.state(9).status).toBe("checking");
  });
});
