import { describe, expect, it } from "vitest";
import { botFor, galleryEntries, networkWithheld, parseIndex } from "../../src/model/index";
import { loadIndex, loadModel, ModelError, type Progress, sha256Hex } from "../../src/model/store";
import { BASE, envOf, fakeFetch, FakeCaches, sha256, streamed } from "../helpers/fakeBrowser";

const model = new Uint8Array(1000).map((_, i) => (i * 7) % 251);
const entry = { id: "m1", path: "models/m1/model.onnx", sha256: sha256(model) };
const indexJson = JSON.stringify({ models: [entry], bots: { 5: "m1", 9: "m1" } });
const noProgress = (): void => {};

function server(overrides: Record<string, (signal?: AbortSignal) => Response> = {}) {
  return fakeFetch({ "models/m1/model.onnx": () => streamed(model, 4), "models/index.json": () => new Response(indexJson), ...overrides });
}

describe("parseIndex and botFor", () => {
  it("reads the index quoridor-publish writes and names the bot per size", () => {
    const index = parseIndex(JSON.parse(indexJson));
    expect(botFor(index, 9)).toEqual(entry);
    expect(botFor(index, 7)).toBeNull();
    expect(botFor(null, 9)).toBeNull();
  });

  it("drops entries that are malformed or unsafe, and bots that name a missing model", () => {
    const index = parseIndex({
      models: [entry, { id: "../x", path: "p", sha256: entry.sha256 }, { id: "m2", path: "p", sha256: "ABC" }, null, { id: "m3" }],
      bots: { 5: "m1", 7: "m2", 9: "nope", x: "m1" },
    });
    expect(index.models).toEqual([entry]);
    expect(index.bots).toEqual({ 5: "m1" });
  });

  it("lets the index say a size has no network, keeps the first of a repeated id, and keeps the reserved id for that", () => {
    const index = parseIndex({
      models: [entry, { ...entry, sha256: "b".repeat(64) }, { ...entry, id: "heuristic" }],
      bots: { 5: "heuristic", 9: "m1", 11: "nobody" },
    });
    expect(index.models).toEqual([entry]);
    expect(index.bots).toEqual({ 5: "heuristic", 9: "m1" });
    expect(botFor(index, 5)).toBeNull();
    expect(networkWithheld(index, 5)).toBe(true);
    expect(networkWithheld(index, 9)).toBe(false);
    expect(networkWithheld(index, 7)).toBe(false);
  });

  it("reads the optional gallery: ordered, only listed models, once each, never the reserved id", () => {
    const second = { ...entry, id: "m2", sha256: "b".repeat(64) };
    const index = parseIndex({
      models: [entry, second],
      bots: { 9: "m1" },
      gallery: ["m2", "nope", "m1", "m2", "heuristic", 7, null, { id: "m1" }],
      extra: "ignored",
    });
    expect(index.gallery).toEqual(["m2", "m1"]);
    expect(galleryEntries(index)).toEqual([second, entry]);
    expect(index.bots).toEqual({ 9: "m1" });
  });

  it("has an empty gallery when there is none or it is not a list, as before", () => {
    for (const gallery of [undefined, "m1", { 0: "m1" }, 3]) {
      const index = parseIndex({ models: [entry], bots: { 9: "m1" }, gallery });
      expect(index).toEqual({ models: [entry], bots: { 9: "m1" }, gallery: [] });
      expect(galleryEntries(index)).toEqual([]);
    }
    expect(galleryEntries(null)).toEqual([]);
  });

  it("rejects what is not an index", () => {
    expect(() => parseIndex(null)).toThrow();
    expect(() => parseIndex({ models: {} })).toThrow();
    expect(() => parseIndex("x")).toThrow();
  });
});

describe("loadModel", () => {
  it("downloads with progress, checks the hash and saves the model", async () => {
    const { fetch, requested } = server();
    const caches = new FakeCaches();
    const events: Progress[] = [];
    const loaded = await loadModel(envOf(fetch, caches), entry, (p) => events.push(p));
    expect(new Uint8Array(loaded.bytes)).toEqual(model);
    expect(loaded).toMatchObject({ fromCache: false, saved: true });
    expect(events.map((e) => e.loaded)).toEqual([250, 500, 750, 1000]);
    expect(events.every((e) => e.total === 1000)).toBe(true);
    expect(requested).toEqual([`${BASE}models/m1/model.onnx`]);
    expect(caches.stored.size).toBe(1);
  });

  it("uses the saved copy next time without touching the network", async () => {
    const caches = new FakeCaches();
    await loadModel(envOf(server().fetch, caches), entry, noProgress);
    const second = server();
    const loaded = await loadModel(envOf(second.fetch, caches), entry, noProgress);
    expect(loaded.fromCache).toBe(true);
    expect(new Uint8Array(loaded.bytes)).toEqual(model);
    expect(second.requested).toEqual([]);
  });

  it("refuses a download that does not match its checksum, and does not save it", async () => {
    const tampered = model.slice();
    tampered[10] = tampered[10]! ^ 1;
    const caches = new FakeCaches();
    const failure = await loadModel(envOf(server({ "models/m1/model.onnx": () => streamed(tampered, 2) }).fetch, caches), entry, noProgress).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(ModelError);
    expect(failure).toMatchObject({ kind: "hash", message: expect.stringContaining("does not match") });
    expect(caches.stored.size).toBe(0);
  });

  it("deletes a saved copy that no longer matches and downloads again", async () => {
    const caches = new FakeCaches();
    await loadModel(envOf(server().fetch, caches), entry, noProgress);
    const [key] = [...caches.stored.keys()];
    caches.stored.set(key!, new Uint8Array(1000));
    const again = server();
    const loaded = await loadModel(envOf(again.fetch, caches), entry, noProgress);
    expect(loaded.fromCache).toBe(false);
    expect(again.requested).toHaveLength(1);
    expect(new Uint8Array(caches.stored.get(key!)!)).toEqual(model);
  });

  it("never uses a saved copy of another version: the key holds the hash", async () => {
    const caches = new FakeCaches();
    await loadModel(envOf(server().fetch, caches), entry, noProgress);
    const newer = new Uint8Array(500).fill(3);
    const next = { id: "m1", path: entry.path, sha256: sha256(newer) };
    const loaded = await loadModel(envOf(server({ "models/m1/model.onnx": () => streamed(newer, 1) }).fetch, caches), next, noProgress);
    expect(new Uint8Array(loaded.bytes)).toEqual(newer);
    expect(loaded.fromCache).toBe(false);
    expect(caches.stored.size).toBe(1); // the older copy is removed
  });

  it("reports an interrupted download and one that ends early", async () => {
    const interrupted = server({ "models/m1/model.onnx": () => streamed(model, 4, { breakAfter: 2 }) });
    await expect(loadModel(envOf(interrupted.fetch, new FakeCaches()), entry, noProgress)).rejects.toMatchObject({ kind: "network", message: expect.stringContaining("interrupted") });
    const short = server({ "models/m1/model.onnx": () => streamed(model.slice(0, 600), 2, { contentLength: 1000 }) });
    await expect(loadModel(envOf(short.fetch, new FakeCaches()), entry, noProgress)).rejects.toMatchObject({ kind: "network", message: expect.stringContaining("expected size") });
  });

  it("does not mistake an error in the progress callback for a network error", async () => {
    const failure = await loadModel(envOf(server().fetch, new FakeCaches()), entry, () => {
      throw new Error("the page broke");
    }).catch((e: unknown) => e);
    expect(failure).toMatchObject({ message: "the page broke" });
    expect(failure).not.toBeInstanceOf(ModelError);
  });

  it("copes with a body compressed in transit: its length is not the model's, progress has no total", async () => {
    const events: Progress[] = [];
    const encoded = server({ "models/m1/model.onnx": () => streamed(model, 4, { contentLength: 600, contentEncoding: "gzip" }) });
    const loaded = await loadModel(envOf(encoded.fetch, new FakeCaches()), entry, (p) => events.push(p));
    expect(new Uint8Array(loaded.bytes)).toEqual(model);
    expect(events.every((e) => e.total === null)).toBe(true);
    expect(events.at(-1)!.loaded).toBe(1000);
  });

  it("never reports more than the expected size, and refuses a body of the wrong size", async () => {
    const events: Progress[] = [];
    const long = server({ "models/m1/model.onnx": () => streamed(model, 4, { contentLength: 900 }) });
    await expect(loadModel(envOf(long.fetch, new FakeCaches()), entry, (p) => events.push(p))).rejects.toMatchObject({ kind: "network" });
    expect(events.every((e) => e.loaded <= 900)).toBe(true);
  });

  it("gives up on a download that stalls, and on one the caller aborts", async () => {
    const stalled = server({ "models/m1/model.onnx": (signal) => streamed(model, 4, signal ? { stallAfter: 2, signal } : { stallAfter: 2 }) });
    await expect(loadModel(envOf(stalled.fetch, new FakeCaches(), 40), entry, noProgress)).rejects.toMatchObject({ kind: "stalled", message: expect.stringContaining("stalled") });

    const abort = new AbortController();
    const waiting = loadModel(envOf(stalled.fetch, new FakeCaches(), 5000), entry, noProgress, abort.signal);
    setTimeout(() => abort.abort(), 20);
    await expect(waiting).rejects.toMatchObject({ kind: "cancelled" });
    const already = new AbortController();
    already.abort();
    await expect(loadModel(envOf(stalled.fetch, new FakeCaches(), 5000), entry, noProgress, already.signal)).rejects.toMatchObject({ kind: "cancelled" });
  });

  it("falls through to the network when a saved copy cannot be read, and replaces it", async () => {
    const caches = new FakeCaches();
    await loadModel(envOf(server().fetch, caches), entry, noProgress);
    caches.unreadable = true;
    const again = server();
    const loaded = await loadModel(envOf(again.fetch, caches), entry, noProgress);
    expect(loaded).toMatchObject({ fromCache: false, saved: true });
    expect(again.requested).toHaveLength(1);
  });

  it("removes only older copies of the same model when it saves, not another model's", async () => {
    const caches = new FakeCaches();
    const other = new Uint8Array(300).fill(9);
    const second = { id: "m2", path: "models/m2/model.onnx", sha256: sha256(other) };
    await loadModel(envOf(server().fetch, caches), entry, noProgress);
    await loadModel(envOf(server({ "models/m2/model.onnx": () => streamed(other, 1) }).fetch, caches), second, noProgress);
    expect(caches.stored.size).toBe(2);
    const newer = new Uint8Array(500).fill(3);
    await loadModel(envOf(server({ "models/m1/model.onnx": () => streamed(newer, 1) }).fetch, caches), { ...entry, sha256: sha256(newer) }, noProgress);
    expect([...caches.stored.keys()].map((url) => new URL(url).pathname).sort()).toEqual(["/quoridor/models/m1/model.onnx", "/quoridor/models/m2/model.onnx"]);
  });

  it("reports a server error, and works with no known length", async () => {
    const missing = fakeFetch({});
    await expect(loadModel(envOf(missing.fetch, new FakeCaches()), entry, noProgress)).rejects.toMatchObject({ kind: "http", message: expect.stringContaining("404") });
    const events: Progress[] = [];
    const open = server({ "models/m1/model.onnx": () => streamed(model, 2, { contentLength: null }) });
    await loadModel(envOf(open.fetch, new FakeCaches()), entry, (p) => events.push(p));
    expect(events.at(-1)).toEqual({ loaded: 1000, total: null });
  });

  it("works offline from the saved copy, and says so when there is none", async () => {
    const caches = new FakeCaches();
    await loadModel(envOf(server().fetch, caches), entry, noProgress);
    const offline = (async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch;
    expect((await loadModel(envOf(offline, caches), entry, noProgress)).fromCache).toBe(true);
    await expect(loadModel(envOf(offline, new FakeCaches()), entry, noProgress)).rejects.toMatchObject({ kind: "network" });
  });

  it("still returns a good model when the storage quota is full or there is no storage", async () => {
    const full = new FakeCaches();
    full.quotaFull = true;
    expect(await loadModel(envOf(server().fetch, full), entry, noProgress)).toMatchObject({ fromCache: false, saved: false });
    expect(await loadModel(envOf(server().fetch, undefined), entry, noProgress)).toMatchObject({ fromCache: false, saved: false });
  });

  it("refuses an address that leaves the site's models folder", async () => {
    const { fetch, requested } = server();
    for (const path of ["https://evil.example/models/m1/model.onnx", "//evil.example/models/x", "../model.onnx", "models/../../x", "other/m1/model.onnx"]) {
      await expect(loadModel(envOf(fetch, new FakeCaches()), { ...entry, path }, noProgress)).rejects.toMatchObject({ kind: "address" });
    }
    expect(requested).toEqual([]);
  });
});

describe("loadIndex", () => {
  const offline = (async () => {
    throw new TypeError("Failed to fetch");
  }) as unknown as typeof fetch;

  it("reads the index, and is null when none is published or what is served is not an index", async () => {
    expect((await loadIndex(envOf(server().fetch, new FakeCaches())))?.bots).toEqual({ 5: "m1", 9: "m1" });
    expect(await loadIndex(envOf(fakeFetch({}).fetch, new FakeCaches()))).toBeNull();
    expect(await loadIndex(envOf(server({ "models/index.json": () => new Response("<html>") }).fetch, new FakeCaches()))).toBeNull();
    expect(await loadIndex(envOf(server({ "models/index.json": () => new Response("{}") }).fetch, new FakeCaches()))).toBeNull();
  });

  it("fails, so that it can be retried, when the server cannot be reached or errs and nothing is remembered", async () => {
    await expect(loadIndex(envOf(offline, new FakeCaches()))).rejects.toMatchObject({ kind: "network" });
    const broken = server({ "models/index.json": () => new Response("down", { status: 503 }) });
    await expect(loadIndex(envOf(broken.fetch, new FakeCaches()))).rejects.toMatchObject({ kind: "http", message: expect.stringContaining("503") });
  });

  it("remembers a good index for a visit that cannot reach the server", async () => {
    const caches = new FakeCaches();
    await loadIndex(envOf(server().fetch, caches));
    expect((await loadIndex(envOf(offline, caches)))?.models).toEqual([entry]);
    const broken = server({ "models/index.json": () => new Response("down", { status: 503 }) });
    expect((await loadIndex(envOf(broken.fetch, caches)))?.models).toEqual([entry]);
  });

  it("is null when the server says the index is gone, even if one was remembered", async () => {
    const caches = new FakeCaches();
    await loadIndex(envOf(server().fetch, caches));
    expect(await loadIndex(envOf(fakeFetch({}).fetch, caches))).toBeNull();
  });
});

describe("sha256Hex", () => {
  it("matches node's digest", async () => {
    expect(await sha256Hex(model.buffer)).toBe(sha256(model));
  });
});
