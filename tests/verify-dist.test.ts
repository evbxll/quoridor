import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SUPPORTED_PLANES as SCRIPT_PLANES, verifyDist } from "../scripts/verify-dist.mjs";
import { SUPPORTED_PLANES } from "../src/ai/encoding";
import { cardJson, fcCardJson } from "./helpers/cards";

let root: string;
let dist: string;

function write(relativePath: string, content: string): void {
  const path = join(dist, relativePath);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, content);
}

function writePackage(dependencies: Record<string, string>): void {
  writeFileSync(join(root, "package.json"), JSON.stringify({ dependencies }));
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "verify-dist-"));
  dist = join(root, "dist");
  writePackage({});
  write("index.html", '<script src="/quoridor/assets/a.js"></script>');
  write("coi-serviceworker.js", "// worker");
  write("coi-config.js", "// config");
  write("THIRD-PARTY-NOTICES.txt", "notices");
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("verifyDist", () => {
  it("accepts a minimal valid dist", () => {
    expect(verifyDist(dist, root)).toEqual([]);
  });

  it("requires the service worker", () => {
    rmSync(join(dist, "coi-serviceworker.js"));
    expect(verifyDist(dist, root)).toEqual(["coi-serviceworker.js is missing"]);
  });

  it("requires the third-party notices", () => {
    rmSync(join(dist, "THIRD-PARTY-NOTICES.txt"));
    expect(verifyDist(dist, root)).toEqual(["THIRD-PARTY-NOTICES.txt is missing"]);
  });

  it("requires a wasm file only when onnxruntime-web is a dependency", () => {
    writePackage({ "onnxruntime-web": "1.30.0" });
    expect(verifyDist(dist, root)).toHaveLength(1);
    write("assets/ort-wasm-simd-threaded.wasm", "wasm");
    expect(verifyDist(dist, root)).toEqual([]);
  });

  it("rejects references outside the base path", () => {
    write("index.html", '<script src="https://cdn.example.com/x.js"></script><link href="/other/a.css">');
    expect(verifyDist(dist, root)).toHaveLength(2);
  });

  it("checks model hashes against the index and the card", () => {
    const sha = createHash("sha256").update("onnx").digest("hex");
    write("models/m1/model.onnx", "onnx");
    write("models/m1/card.json", JSON.stringify(cardJson("m1", {}, sha)));
    write("models/index.json", JSON.stringify({ models: [{ id: "m1", path: "models/m1/model.onnx", sha256: sha }], bots: {} }));
    expect(verifyDist(dist, root)).toEqual([]);

    write("models/m1/model.onnx", "tampered");
    expect(verifyDist(dist, root)).toHaveLength(2);
  });

  it("reports a bot that names a model the index does not have", () => {
    write("models/index.json", JSON.stringify({ models: [], bots: { 9: "gone" } }));
    expect(verifyDist(dist, root)).toEqual(["bot for 9x9 names gone, which is not in the index"]);
  });

  describe("an index the page would refuse or partly ignore", () => {
    const sha = createHash("sha256").update("onnx").digest("hex");
    const good = { id: "m1", path: "models/m1/model.onnx", sha256: sha };
    const check = (index: unknown): string[] => {
      write("models/m1/model.onnx", "onnx");
      write("models/m1/card.json", JSON.stringify(cardJson("m1", {}, sha)));
      write("models/index.json", typeof index === "string" ? index : JSON.stringify(index));
      return verifyDist(dist, root);
    };

    it("accepts an index written the way quoridor-publish writes it", () => {
      expect(check({ models: [good], bots: { 5: "m1", 7: "m1", 9: "m1", 11: "m1" } })).toEqual([]);
    });

    it("accepts a bot that says no network at a size", () => {
      expect(check({ models: [good], bots: { 5: "heuristic", 9: "m1" } })).toEqual([]);
    });

    it("refuses what is not an index, with a message instead of a crash", () => {
      for (const index of ["not json", { models: "abc", bots: {} }, { models: [], bots: [] }, { bots: {} }, null, []]) {
        expect(check(index), JSON.stringify(index)).toHaveLength(1);
      }
    });

    it("refuses a root-absolute or outside path, an odd id, a bad checksum and a duplicate", () => {
      expect(check({ models: [{ ...good, path: "/models/m1/model.onnx" }], bots: {} })[0]).toContain("relative path");
      expect(check({ models: [{ ...good, path: "models/../m1/model.onnx" }], bots: {} })[0]).toContain("relative path");
      expect(check({ models: [{ ...good, path: "https://x.example/models/m1/model.onnx" }], bots: {} })[0]).toContain("relative path");
      expect(check({ models: [{ ...good, path: "other/m1/model.onnx" }], bots: {} })[0]).toContain("relative path");
      expect(check({ models: [{ ...good, id: "my model" }], bots: {} })[0]).toContain("plain id");
      expect(check({ models: [{ ...good, id: "heuristic" }], bots: {} })[0]).toContain("plain id");
      expect(check({ models: [{ ...good, sha256: sha.toUpperCase() }], bots: {} })[0]).toContain("64 lowercase");
      expect(check({ models: [good, good], bots: {} })).toEqual(["model m1: listed twice"]);
      expect(check({ models: [good], bots: { five: "m1" } })[0]).toContain("not a number");
    });
  });

  describe("the gallery and the cards", () => {
    const sha = createHash("sha256").update("onnx").digest("hex");
    const other = createHash("sha256").update("two").digest("hex");
    const entry = (id: string, sum: string) => ({ id, path: `models/${id}/model.onnx`, sha256: sum });
    const publish = (id: string, bytes: string, card: unknown): void => {
      write(`models/${id}/model.onnx`, bytes);
      write(`models/${id}/card.json`, typeof card === "string" ? card : JSON.stringify(card));
    };
    const index = (extra: object = {}) => write("models/index.json", JSON.stringify({ models: [entry("m1", sha), entry("m2", other)], bots: { 9: "m1" }, ...extra }));

    it("keeps the page's list of encodable plane counts", () => {
      expect([...SCRIPT_PLANES]).toEqual([...SUPPORTED_PLANES]);
    });

    it("accepts a gallery with a conv and a 6-plane fc model", () => {
      publish("m1", "onnx", cardJson("m1", {}, sha));
      publish("m2", "two", fcCardJson("m2", other));
      index({ gallery: ["m2", "m1"] });
      expect(verifyDist(dist, root)).toEqual([]);
    });

    it("refuses a gallery that the page would partly ignore", () => {
      publish("m1", "onnx", cardJson("m1", {}, sha));
      publish("m2", "two", cardJson("m2", {}, other));
      index({ gallery: ["m2", "ghost", "m2", "heuristic"] });
      expect(verifyDist(dist, root)).toEqual([
        'gallery entry 1 names "ghost", which is not in the index',
        "gallery lists m2 twice",
        'gallery entry 3 names "heuristic", which is not in the index',
      ]);
      index({ gallery: "m2" });
      expect(verifyDist(dist, root)).toEqual(["gallery must be a list of model ids"]);
    });

    it("refuses a card for another model, with another checksum, or without a usable network", () => {
      publish("m1", "onnx", cardJson("m1", {}, sha));
      publish("m2", "two", cardJson("m1", {}, other));
      index({ gallery: ["m2"] });
      expect(verifyDist(dist, root)).toEqual(['model m2: its card is for "m1"']);
      publish("m2", "two", cardJson("m2", {}, sha));
      expect(verifyDist(dist, root)).toEqual(["model m2: sha256 differs from the one its card states"]);
      publish("m2", "two", cardJson("m2", { network: { head: "rnn" } }, other));
      expect(verifyDist(dist, root)).toEqual(["model m2: its card has no network with a head of fc or conv"]);
      publish("m2", "two", "{ nope");
      expect(verifyDist(dist, root)).toEqual(["model m2: card.json is not valid JSON"]);
    });

    it("refuses a gallery model whose card has a plane count the page cannot slice", () => {
      publish("m1", "onnx", cardJson("m1", {}, sha));
      for (const planes of [4, 8, 12]) {
        publish("m2", "two", cardJson("m2", { network: { head: "conv", input_planes: planes }, plane_names: new Array(planes).fill("p") }, other));
        index({ gallery: ["m2"] });
        expect(verifyDist(dist, root)).toEqual([`model m2: its card says ${planes} input planes; the page can build 6 or 10`]);
      }
      publish("m2", "two", cardJson("m2", { plane_names: ["a"] }, other));
      expect(verifyDist(dist, root)).toEqual(["model m2: its card's plane_names does not match input_planes"]);
    });

    it("refuses an fc card that lists several sizes, and a bot at a size its model does not play", () => {
      publish("m1", "onnx", cardJson("m1", {}, sha));
      publish("m2", "two", { ...fcCardJson("m2", other), sizes: [7, 9] });
      index();
      expect(verifyDist(dist, root)).toEqual(["model m2: an fc model plays its trained size only, so its card must list that size alone"]);
      publish("m2", "two", fcCardJson("m2", other));
      index({ bots: { 9: "m2", 7: "m2", 5: "m1" } });
      expect(verifyDist(dist, root)).toEqual(["bot for 7x7 names m2, whose card says it does not play that size"]);
      publish("m1", "onnx", cardJson("m1", { sizes: [5, 7] }, sha));
      index({ bots: { 9: "m1" } });
      expect(verifyDist(dist, root)).toEqual(["bot for 9x9 names m1, whose card says it does not play that size"]);
    });
  });

  it("reports a model file that is missing", () => {
    write("models/index.json", JSON.stringify({ models: [{ id: "m1", path: "models/m1/model.onnx", sha256: "a".repeat(64) }], bots: {} }));
    expect(verifyDist(dist, root)).toEqual(["model m1: models/m1/model.onnx is missing"]);
  });
});
