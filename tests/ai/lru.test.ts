import { describe, expect, it } from "vitest";
import { LruCache } from "../../src/ai/lru";

describe("LruCache", () => {
  it("drops the least recently used entry when full", () => {
    const cache = new LruCache<number>(2);
    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("c", 3);
    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")).toBe(2);
    expect(cache.get("c")).toBe(3);
    expect(cache.size).toBe(2);
  });

  it("counts a read as a use", () => {
    const cache = new LruCache<number>(2);
    cache.set("a", 1);
    cache.set("b", 2);
    cache.get("a");
    cache.set("c", 3);
    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("a")).toBe(1);
  });

  it("replaces a value in place without growing", () => {
    const cache = new LruCache<number>(2);
    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("a", 10);
    cache.set("c", 3);
    expect(cache.get("a")).toBe(10);
    expect(cache.get("b")).toBeUndefined();
    expect(cache.size).toBe(2);
  });

  it("rejects a capacity that is not a positive whole number", () => {
    expect(() => new LruCache(0)).toThrow("capacity");
    expect(() => new LruCache(1.5)).toThrow("capacity");
  });
});
