import { describe, expect, it } from "vitest";
import { describeIsolation, searchThreads } from "../src/isolation";

describe("searchThreads", () => {
  it("uses one thread without cross-origin isolation", () => {
    expect(searchThreads(false, 16)).toBe(1);
  });

  it("caps at four threads and leaves a core for the page", () => {
    expect(searchThreads(true, 16)).toBe(4);
    expect(searchThreads(true, 4)).toBe(3);
  });

  it("never returns fewer than one thread", () => {
    expect(searchThreads(true, 1)).toBe(1);
    expect(searchThreads(true, 2)).toBe(1);
  });
});

describe("describeIsolation", () => {
  it("states the isolation result", () => {
    expect(describeIsolation(true, 4)).toContain("yes");
    expect(describeIsolation(false, 1)).toContain("no");
  });
});
