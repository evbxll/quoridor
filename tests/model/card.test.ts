import { describe, expect, it } from "vitest";
import { inputOf, parseCard, supportsSize } from "../../src/model/card";
import { cardJson, fcCardJson } from "../helpers/cards";

describe("parseCard", () => {
  it("reads a conv card into typed fields", () => {
    const card = parseCard(cardJson("m1"));
    expect(card).toMatchObject({
      id: "m1",
      sizes: [5, 7, 9, 11],
      trainedSize: 9,
      license: "CC-BY-4.0",
      parameters: 2474767,
      network: { head: "conv", inputPlanes: 10, channels: 128, blocks: 8, poolEvery: 3, headChannels: 32, boardSize: null },
      source: { run: "s9-conv-paths", generation: 1 },
    });
    expect(card.planeNames).toHaveLength(10);
    expect(card.strength).toEqual([
      expect.objectContaining({ size: 9, simulations: 25, elo: 557.8, interval: [518, 597.5], intervalLevel: 0.95, ladderGames: 560, measured: null }),
    ]);
  });

  it("reads an fc card with six planes", () => {
    const card = parseCard(fcCardJson("m3"));
    expect(card.network).toMatchObject({ head: "fc", inputPlanes: 6, poolEvery: null, headChannels: null, boardSize: 9 });
    expect(inputOf(card)).toEqual({ planes: 6, fixedSize: 9 });
    expect(inputOf(parseCard(cardJson("m1")))).toEqual({ planes: 10, fixedSize: null });
  });

  it("reads the real cards of the published models", async () => {
    const { readFileSync } = await import("node:fs");
    const card = parseCard(JSON.parse(readFileSync("public/models/s9-conv-paths-g105/card.json", "utf8")));
    expect(card).toMatchObject({ id: "s9-conv-paths-g105", sizes: [5, 7, 9, 11], network: { head: "conv", inputPlanes: 10 } });
  });

  it.each([
    ["not an object", [] as unknown],
    ["null", null],
    ["no network", cardJson("m1", { network: undefined })],
    ["an unknown head", cardJson("m1", { network: { head: "rnn", input_planes: 10, channels: 1, blocks: 1 } })],
    ["a plane count the site cannot encode", cardJson("m1", { network: { head: "conv", input_planes: 12, channels: 1, blocks: 1 } })],
    ["plane names that do not match the planes", cardJson("m1", { plane_names: ["a", "b"] })],
    ["no sizes", cardJson("m1", { sizes: [] })],
    ["a size that is not a number", cardJson("m1", { sizes: [9, "9"] })],
    ["a fractional trained size", cardJson("m1", { trained_size: 9.5 })],
    ["an fc model offered at several sizes", { ...fcCardJson("m3"), sizes: [7, 9] }],
    ["an fc model offered at another size than it was trained on", { ...fcCardJson("m3"), sizes: [7] }],
    ["a bad checksum", cardJson("m1", { sha256: "XYZ" })],
    ["an id that is a number", cardJson("m1", { id: 5 })],
    ["a very long text", cardJson("m1", { display_name: "x".repeat(10_000) })],
  ])("refuses a card with %s", (_name, json) => {
    expect(() => parseCard(json)).toThrow();
  });

  it("leaves out a strength entry that is malformed and keeps the rest", () => {
    const good = (cardJson("m1")["strength"] as Record<string, unknown>[])[0]!;
    const card = parseCard(cardJson("m1", { strength: [{ ...good, elo: "high" }, good, null, { ...good, interval: [1] }, { ...good, size: 7 }] }));
    expect(card.strength.map((entry) => entry.size)).toEqual([9, 7]);
    expect(parseCard(cardJson("m1", { strength: "none" })).strength).toEqual([]);
  });

  it("keeps hostile strings as plain text and drops fields it does not know", () => {
    const hostile = '<img src=x onerror="alert(1)"> `${process.exit()}` __proto__';
    const card = parseCard({ ...cardJson("m1", { display_name: hostile }), __proto__: { polluted: true }, constructor: "x", extra: { deep: [1] } });
    expect(card.displayName).toBe(hostile);
    expect(Object.keys(card)).not.toContain("extra");
    expect(({} as Record<string, unknown>)["polluted"]).toBeUndefined();
  });

  it("does not take a number as text or text as a number", () => {
    expect(() => parseCard(cardJson("m1", { license: 3 }))).toThrow();
    expect(() => parseCard(cardJson("m1", { parameters: "2474767" }))).toThrow();
    expect(() => parseCard(cardJson("m1", { parameters: Number.NaN }))).toThrow();
  });
});

describe("supportsSize", () => {
  it("lets a conv model play every size its card lists and no other", () => {
    const card = parseCard(cardJson("m1"));
    expect([5, 7, 9, 11, 13].map((size) => supportsSize(card, size))).toEqual([true, true, true, true, false]);
  });

  it("lets an fc model play only the size it was trained on", () => {
    const card = parseCard(fcCardJson("m3"));
    expect([5, 7, 9, 11].map((size) => supportsSize(card, size))).toEqual([false, false, true, false]);
  });
});
