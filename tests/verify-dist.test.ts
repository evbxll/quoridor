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
    write("models/index.json", JSON.stringify({ models: [{ id: "m1", path: "m1/model.onnx", sha256: sha }] }));
    expect(verifyDist(dist, root)).toEqual([]);

    write("models/m1/model.onnx", "tampered");
    expect(verifyDist(dist, root)).toHaveLength(2);
  });

  it("reports a model file that is missing", () => {
    write("models/index.json", JSON.stringify({ models: [{ id: "m1", path: "m1/model.onnx", sha256: "x" }] }));
    expect(verifyDist(dist, root)).toEqual(["model m1: m1/model.onnx is missing"]);
  });
});
