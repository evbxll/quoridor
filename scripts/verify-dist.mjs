// Checks a built `dist/` before it is deployed (design doc section 9.1).
//
// Usage: node scripts/verify-dist.mjs [distDir]

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const BASE = "/quoridor/";

/**
 * Lists files under a directory, recursively.
 * @param {string} dir
 * @returns {string[]} Absolute paths.
 */
function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

/**
 * @param {string} path
 * @returns {string} Hex sha256 of the file.
 */
function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

/**
 * Checks every model in `models/index.json`. A dist without the index has no
 * published models, which is valid until the first model is published.
 * @param {string} distDir
 * @returns {string[]} Error messages.
 */
function checkModels(distDir) {
  const indexPath = join(distDir, "models", "index.json");
  if (!existsSync(indexPath)) {
    return [];
  }
  const errors = [];
  const index = JSON.parse(readFileSync(indexPath, "utf8"));
  for (const model of index.models ?? []) {
    const file = join(distDir, "models", model.path);
    if (!existsSync(file)) {
      errors.push(`model ${model.id}: ${model.path} is missing`);
      continue;
    }
    const actual = sha256(file);
    if (actual !== model.sha256) {
      errors.push(`model ${model.id}: sha256 ${actual} differs from the index`);
    }
    const cardPath = join(dirname(file), "card.json");
    if (!existsSync(cardPath)) {
      errors.push(`model ${model.id}: card.json is missing`);
    } else if (JSON.parse(readFileSync(cardPath, "utf8")).sha256 !== actual) {
      errors.push(`model ${model.id}: sha256 differs from the one its card states`);
    }
  }
  return errors;
}

/**
 * Checks that the service worker and, once onnxruntime-web is a dependency,
 * its WebAssembly binary are present.
 * @param {string} distDir
 * @param {string} projectDir
 * @returns {string[]} Error messages.
 */
function checkRuntimeFiles(distDir, projectDir) {
  const errors = [];
  for (const name of ["coi-serviceworker.js", "coi-config.js"]) {
    if (!existsSync(join(distDir, name))) {
      errors.push(`${name} is missing`);
    }
  }
  const pkg = JSON.parse(readFileSync(join(projectDir, "package.json"), "utf8"));
  if (pkg.dependencies?.["onnxruntime-web"] !== undefined) {
    const hasWasm = walk(distDir).some((file) => file.endsWith(".wasm"));
    if (!hasWasm) {
      errors.push("onnxruntime-web is a dependency but dist has no .wasm file");
    }
  }
  return errors;
}

/**
 * Finds references in HTML and CSS that point outside `BASE`: absolute URLs,
 * protocol-relative URLs and root-relative paths. Bundled JS is not scanned,
 * because it legitimately contains strings such as XML namespaces.
 * @param {string} distDir
 * @returns {string[]} Error messages.
 */
function checkExternalUrls(distDir) {
  const errors = [];
  const reference = /(?:src|href|action)\s*=\s*["']([^"']+)["']|url\(\s*["']?([^"')]+)["']?\s*\)/g;
  for (const file of walk(distDir)) {
    if (!/\.(html|css)$/.test(file)) {
      continue;
    }
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(reference)) {
      const url = match[1] ?? match[2] ?? "";
      const isAbsolute = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(url);
      if (url.startsWith("data:") || url.startsWith("#")) {
        continue;
      }
      if (isAbsolute || (url.startsWith("/") && !url.startsWith(BASE))) {
        errors.push(`${relative(distDir, file).replaceAll("\\", "/")}: ${url} points outside ${BASE}`);
      }
    }
  }
  return errors;
}

/**
 * Verifies a built site.
 * @param {string} distDir The build output.
 * @param {string} projectDir The project root, for package.json.
 * @returns {string[]} Error messages; empty when the dist is valid.
 */
export function verifyDist(distDir, projectDir) {
  if (!existsSync(join(distDir, "index.html"))) {
    return [`${distDir} has no index.html; run the build first`];
  }
  return [
    ...checkRuntimeFiles(distDir, projectDir),
    ...checkModels(distDir),
    ...checkExternalUrls(distDir),
  ];
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const projectDir = join(dirname(fileURLToPath(import.meta.url)), "..");
  const errors = verifyDist(process.argv[2] ?? join(projectDir, "dist"), projectDir);
  if (errors.length > 0) {
    console.error(errors.map((e) => `verify-dist: ${e}`).join("\n"));
    process.exit(1);
  }
  console.log("verify-dist: ok");
}
