import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkCard, SUPPORTED_PLANES as SCRIPT_PLANES, verifyDist } from "../scripts/verify-dist.mjs";
import { SUPPORTED_PLANES } from "../src/ai/encoding";
import { parseCard } from "../src/model/card";
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

    it("refuses a card with no display_name or a 500-character license", () => {
      publish("m1", "onnx", cardJson("m1", {}, sha));
      publish("m2", "two", cardJson("m2", { display_name: undefined }, other));
      index({ gallery: ["m2"] });
      expect(verifyDist(dist, root)).toEqual(["model m2: its card's display_name is not a short text"]);
      publish("m2", "two", cardJson("m2", { license: "x".repeat(500) }, other));
      expect(verifyDist(dist, root)).toEqual(["model m2: its card's license is not a short text"]);
    });

    it("refuses exactly the cards the page refuses", () => {
      const long = "x".repeat(401);
      const network = (over: object) => ({ head: "conv", input_planes: 10, channels: 128, blocks: 8, pool_every: 3, head_channels: 32, board_size: null, ...over });
      const cards: [string, Record<string, unknown>][] = [
        ["a good conv card", cardJson("m1", {}, sha)],
        ["a good fc card", fcCardJson("m1", sha)],
        ["a text of 400 characters", cardJson("m1", { display_name: "x".repeat(400) }, sha)],
        ["a text of 401 characters", cardJson("m1", { display_name: long }, sha)],
        ["a license that is a number", cardJson("m1", { license: 3 }, sha)],
        ["no parameters", cardJson("m1", { parameters: undefined }, sha)],
        ["fractional parameters", cardJson("m1", { parameters: 1.5 }, sha)],
        ["no channels", cardJson("m1", { network: network({ channels: undefined }) }, sha)],
        ["zero channels", cardJson("m1", { network: network({ channels: 0 }) }, sha)],
        ["blocks as text", cardJson("m1", { network: network({ blocks: "8" }) }, sha)],
        ["a pool_every of 0", cardJson("m1", { network: network({ pool_every: 0 }) }, sha)],
        ["a head_channels of text", cardJson("m1", { network: network({ head_channels: "32" }) }, sha)],
        ["a board_size of 1", cardJson("m1", { network: network({ board_size: 1 }) }, sha)],
        ["33 sizes", cardJson("m1", { sizes: Array.from({ length: 33 }, (_, i) => i + 2) }, sha)],
        ["32 sizes", cardJson("m1", { sizes: Array.from({ length: 32 }, (_, i) => i + 2) }, sha)],
        ["a plane name that is a number", cardJson("m1", { plane_names: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] }, sha)],
        ["a plane name of 401 characters", cardJson("m1", { plane_names: new Array(10).fill(long) }, sha)],
        ["6 planes with 10 names", cardJson("m1", { network: network({ input_planes: 6 }) }, sha)],
      ];
      for (const [name, card] of cards) {
        const json = JSON.parse(JSON.stringify(card));
        let refusedByPage = false;
        try {
          parseCard(json);
        } catch {
          refusedByPage = true;
        }
        expect(checkCard("m1", json, sha).length > 0, name).toBe(refusedByPage);
      }
    });

    it("accepts every card published in public/models, which the page reads as well", () => {
      const published = JSON.parse(readFileSync("public/models/index.json", "utf8")) as { models: { id: string; sha256: string }[] };
      expect(published.models.length).toBeGreaterThan(0);
      for (const { id, sha256 } of published.models) {
        const card = JSON.parse(readFileSync(`public/models/${id}/card.json`, "utf8"));
        expect(() => parseCard(card), id).not.toThrow();
        expect(checkCard(id, card, sha256), id).toEqual([]);
      }
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
        publish("m2", "two", cardJson("m2", { network: { head: "conv", input_planes: planes, channels: 128, blocks: 8 }, plane_names: new Array(planes).fill("p") }, other));
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
