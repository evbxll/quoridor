import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { describeArchitecture, parametersText, parseArchitecture } from "../../src/ui/architecture";
import { forbiddenIn } from "../../scripts/verify-dist.mjs";

const published = JSON.parse(readFileSync("public/models/s9-conv-paths-g105/arch.json", "utf8")) as Record<string, unknown>;

describe("the network in the About card", () => {
  it("reads the published model's arch.json", () => {
    const arch = parseArchitecture(published);
    expect(arch.planes).toHaveLength(10);
    expect(arch.channels).toBe(128);
    expect(arch.blocks).toEqual([false, false, true, false, false, true, false, false]);
    expect(arch.parameters).toBe(2474767);
  });

  it("says each stage in plain words, with no word about how the network was made or rated", () => {
    const lines = describeArchitecture(parseArchitecture(published));
    expect(lines).toEqual([
      "Input: the board as 10 pictures of N × N squares: horizontal walls, vertical walls, mover pawn, opponent pawn, mover walls left, opponent walls left, mover goal distance, opponent goal distance, mover shortest-path cells, opponent shortest-path cells.",
      "A first 3 × 3 convolution turns them into 128 feature maps.",
      "8 blocks of two 3 × 3 convolutions each, with a shortcut around every block; 2 of them also sum up the whole board.",
      "Policy head: a score for every move, pawn steps and every wall slot.",
      "Value head: one number, how likely the player to move is to win.",
    ]);
    for (const line of lines) expect(forbiddenIn(line)).toEqual([]);
    expect(parametersText(2474767)).toBe("2.5 million");
  });

  it.each([
    ["not an object", null],
    ["no input planes", { ...published, input: { planes: [] } }],
    ["no layers", { ...published, layers: "none" }],
    ["no blocks", { ...published, layers: (published["layers"] as { kind: string }[]).filter((layer) => !layer.kind.endsWith("block")) }],
    ["no heads", { ...published, layers: (published["layers"] as { kind: string }[]).filter((layer) => layer.kind !== "value_head") }],
    ["no parameter count", { ...published, parameters: "many" }],
    ["a plane name that is too long", { ...published, input: { planes: ["x".repeat(81)] } }],
  ])("refuses a file with %s, so the card keeps its words alone", (_name, json) => {
    expect(() => parseArchitecture(json)).toThrow();
  });
});
