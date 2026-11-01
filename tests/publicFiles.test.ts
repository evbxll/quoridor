import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const root = new URL("..", import.meta.url);

/** Built from parts so that this file does not contain what it forbids. */
const FORBIDDEN: [string, RegExp][] = [
  ["a private commit field", new RegExp("private_" + "git_sha")],
  ["a private repo's package name", new RegExp("quoridor_" + "python")],
  ["a Windows user path", new RegExp("C:[\\/]+Users", "i")],
];
const GIT_SHA = /(?<![0-9a-f])[0-9a-f]{40}(?![0-9a-f])/i;

/** Binary files, and the vendored licence notices, which quote upstream commit ids of third-party projects. */
const SKIPPED = /\.(?:onnx|png|ico|woff2?)$|^public\/THIRD-PARTY-NOTICES\.txt$/;

const tracked = execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" })
  .split("\0")
  .filter((path) => path !== "" && !SKIPPED.test(path));

describe("tracked public files", () => {
  it("are found", () => {
    expect(tracked).toContain("package.json");
    expect(tracked).toContain("fixtures/search.json");
  });

  it("name nothing of the private repository", () => {
    const hits = tracked.flatMap((path) => {
      const text = readFileSync(new URL(path, root), "utf8");
      const found = FORBIDDEN.filter(([, pattern]) => pattern.test(text)).map(([name]) => name);
      if (GIT_SHA.test(text)) found.push("a 40-hex git commit id");
      return found.map((name) => `${path}: ${name}`);
    });
    expect(hits).toEqual([]);
  });
});
