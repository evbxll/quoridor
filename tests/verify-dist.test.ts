import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { verifyDist } from "../scripts/verify-dist.mjs";

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
    write("models/m1/card.json", JSON.stringify({ sha256: sha }));
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
      write("models/m1/card.json", JSON.stringify({ sha256: sha }));
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

  it("reports a model file that is missing", () => {
    write("models/index.json", JSON.stringify({ models: [{ id: "m1", path: "models/m1/model.onnx", sha256: "a".repeat(64) }], bots: {} }));
    expect(verifyDist(dist, root)).toEqual(["model m1: models/m1/model.onnx is missing"]);
  });
});
