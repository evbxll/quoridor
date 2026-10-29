import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cardJson, fcCardJson } from "../helpers/cards";
import { discoverModels } from "../helpers/models";

const sha = "a".repeat(64);
let root = "";

function site(): string {
  root = mkdtempSync(join(tmpdir(), "quoridor-models-"));
  mkdirSync(join(root, "public", "models"), { recursive: true });
  return root;
}

function publish(id: string, files: string[]): void {
  mkdirSync(join(root, "public", "models", id), { recursive: true });
  for (const file of files) {
    writeFileSync(join(root, "public", "models", id, file), file === "card.json" ? JSON.stringify(id === "fc" ? fcCardJson(id) : cardJson(id)) : "stand-in, not a model");
  }
}

function index(models: string[]): void {
  const entries = models.map((id) => ({ id, path: `models/${id}/model.onnx`, sha256: sha }));
  writeFileSync(join(root, "public", "models", "index.json"), JSON.stringify({ models: entries, bots: {} }));
}

afterEach(() => root && rmSync(root, { recursive: true, force: true }));

describe("discoverModels", () => {
  it("finds nothing when no model is published", () => {
    site();
    expect(discoverModels(root, undefined)).toEqual([]);
    index([]);
    expect(discoverModels(root, undefined)).toEqual([]);
  });

  it("finds every published model whose files are all there", () => {
    site();
    publish("a", ["model.onnx", "golden.json", "card.json"]);
    publish("b", ["model.onnx", "golden.json"]);
    publish("c", ["model.onnx"]);
    index(["a", "b", "c", "d"]);
    expect(discoverModels(root, undefined).map((m) => m.id)).toEqual(["a", "b"]);
  });

  it("takes each model's plane count and fixed size from its card, 10 and free without one", () => {
    site();
    publish("a", ["model.onnx", "golden.json", "card.json"]);
    publish("fc", ["model.onnx", "golden.json", "card.json"]);
    publish("b", ["model.onnx", "golden.json"]);
    index(["a", "fc", "b"]);
    expect(discoverModels(root, undefined).map((m) => [m.id, m.planes, m.fixedSize])).toEqual([
      ["a", 10, null],
      ["fc", 6, 9],
      ["b", 10, null],
    ]);
  });

  it("prefers the folder the setting names, and does not fall back to the published models when it is empty", () => {
    site();
    publish("a", ["model.onnx", "golden.json"]);
    index(["a"]);
    const own = join(root, "own");
    mkdirSync(own);
    expect(discoverModels(root, own)).toEqual([]);
    writeFileSync(join(own, "model.onnx"), "x");
    writeFileSync(join(own, "golden.json"), "{}");
    expect(discoverModels(root, own)).toEqual([{ id: "from QUORIDOR_TEST_MODEL_DIR", dir: own, planes: 10, fixedSize: null }]);
  });

  it("uses test-data/model next, and survives an unreadable index", () => {
    site();
    mkdirSync(join(root, "test-data", "model"), { recursive: true });
    writeFileSync(join(root, "test-data", "model", "model.onnx"), "x");
    writeFileSync(join(root, "test-data", "model", "golden.json"), "{}");
    expect(discoverModels(root, undefined)[0]!.id).toBe("from test-data/model");
    rmSync(join(root, "test-data"), { recursive: true });
    writeFileSync(join(root, "public", "models", "index.json"), "{ not json");
    expect(discoverModels(root, undefined)).toEqual([]);
  });
});
