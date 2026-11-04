// Proves that publishing another model needs no code or test change.
//
// Copies the repo to a temporary folder, replaces the published model there by a copy of its files under a new id
// (a card that lists 13 x 13 and rates the model +744 Elo against Normal, the index naming it for every size), and
// runs the type check, the tests, the build and verify-dist against that copy. The repo itself is not touched.
//
// Usage: node scripts/simulate-model-swap.mjs [newId]

import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const newId = process.argv[2] ?? "convolutional-v2";
const sizes = [5, 7, 9, 11, 13];

const copy = mkdtempSync(join(tmpdir(), "quoridor-swap-"));

/**
 * Runs git in the copy and throws if it fails.
 * @param {string[]} args
 */
function git(args) {
  const run = spawnSync("git", args, { cwd: copy, stdio: "inherit" });
  if (run.status !== 0) throw new Error(`git ${args.join(" ")} failed`);
}
cpSync(repo, copy, { recursive: true, filter: (path) => !/^(node_modules|\.git|dist|\.bench)([\\/]|$)/.test(relative(repo, path)) });
symlinkSync(join(repo, "node_modules"), join(copy, "node_modules"), "junction");
// tests/publicFiles.test.ts lists the repo's files with git.
git(["init", "-q"]);

const models = join(copy, "public", "models");
/** @type {{models: {id: string, sha256: string}[]}} */
const index = JSON.parse(readFileSync(join(models, "index.json"), "utf8"));
const oldIds = index.models.map((model) => model.id);
const old = index.models[0];
if (old === undefined) throw new Error("No published model to swap");
cpSync(join(models, old.id), join(models, newId), { recursive: true });
for (const id of oldIds) rmSync(join(models, id), { recursive: true });

const card = JSON.parse(readFileSync(join(models, newId, "card.json"), "utf8"));
Object.assign(card, { id: newId, sizes, strength: [{ size: 9, elo_vs_normal: 744 }] });
writeFileSync(join(models, newId, "card.json"), JSON.stringify(card, null, 2) + "\n");
writeFileSync(
  join(models, "index.json"),
  JSON.stringify({ models: [{ id: newId, path: `models/${newId}/model.onnx`, sha256: old.sha256 }], bots: Object.fromEntries(sizes.map((size) => [size, newId])) }, null, 2) + "\n",
);
const written = JSON.parse(readFileSync(join(models, newId, "card.json"), "utf8"));
if (written.strength?.[0]?.elo_vs_normal !== 744 || !written.sizes.includes(13) || written.id !== newId) throw new Error("The simulated card is not the one intended");
git(["add", "-A"]);
console.log(`Swapped ${oldIds.join(", ")} for ${newId} in ${copy}`);

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
let failed = false;
for (const args of [["run", "typecheck"], ["test"], ["run", "build"], ["run", "verify-dist"]]) {
  console.log(`\n$ npm ${args.join(" ")}`);
  const run = spawnSync(npm, args, { cwd: copy, stdio: "inherit", shell: process.platform === "win32" });
  if (run.status !== 0) {
    failed = true;
    console.log(`FAILED: npm ${args.join(" ")}`);
    break;
  }
}
rmSync(copy, { recursive: true, force: true });
console.log(failed ? "\nSwap simulation: FAILED" : "\nSwap simulation: all passed");
process.exit(failed ? 1 : 0);
