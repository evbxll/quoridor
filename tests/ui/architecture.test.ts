import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { architectureUrl, describeArchitecture, parametersText, parseArchitecture } from "../../src/ui/architecture";
import { forbiddenIn } from "../../scripts/verify-dist.mjs";
import { publishedBot } from "../helpers/models";

const main = publishedBot(9)!;
const published = JSON.parse(readFileSync(join(main.dir, "arch.json"), "utf8")) as Record<string, unknown>;

describe("the network in the About card", () => {
  it("reads the published model's arch.json", () => {
    const arch = parseArchitecture(published);
    expect(arch.planes).toHaveLength(main.card.network.inputPlanes);
    expect(arch.channels).toBe(main.card.network.channels);
    expect(arch.blocks).toHaveLength(main.card.network.blocks);
    expect(arch.parameters).toBe(main.card.parameters);
  });

  it("says each stage in plain words for a fixed example, with no word about how the network was made or rated", () => {
    const layer = (kind: string, out = 16) => ({ kind, out });
    const example = {
      input: { planes: ["walls", "pawn"] },
      layers: [layer("stem"), layer("residual_block"), layer("global_pooling_block"), layer("policy_head"), layer("value_head")],
      parameters: 2474767,
    };
    const lines = describeArchitecture(parseArchitecture(example));
    expect(lines).toEqual([
      "Input: the board as 2 pictures of N × N squares: walls, pawn.",
      "A first 3 × 3 convolution turns them into 16 feature maps.",
      "2 blocks of two 3 × 3 convolutions each, with a shortcut around every block; 1 of them also sum up the whole board.",
      "Policy head: a score for every move, pawn steps and every wall slot.",
      "Value head: one number, how likely the player to move is to win.",
    ]);
    expect(parametersText(2474767)).toBe("2.5 million");
  });

  it("says the published network in words that pass the public text audit", () => {
    for (const line of describeArchitecture(parseArchitecture(published))) expect(forbiddenIn(line)).toEqual([]);
  });

  it("draws up to 64 blocks", () => {
    const many = { ...published, layers: [...(published["layers"] as { kind: string }[]), ...Array.from({ length: 56 }, () => ({ kind: "residual_block" }))] };
    expect(parseArchitecture(many).blocks).toHaveLength(64);
  });

  it("reads the file beside the model, under the site's base", () => {
    expect(architectureUrl("https://example.org/quoridor/", "test-model").href).toBe("https://example.org/quoridor/models/test-model/arch.json");
  });

  it.each([
    ["not an object", null],
    ["no input planes", { ...published, input: { planes: [] } }],
    ["no layers", { ...published, layers: "none" }],
    ["no blocks", { ...published, layers: (published["layers"] as { kind: string }[]).filter((layer) => !layer.kind.endsWith("block")) }],
    ["no heads", { ...published, layers: (published["layers"] as { kind: string }[]).filter((layer) => layer.kind !== "value_head") }],
    ["no parameter count", { ...published, parameters: "many" }],
    ["more blocks than the card draws (64)", { ...published, layers: [...(published["layers"] as { kind: string }[]), ...Array.from({ length: 57 }, () => ({ kind: "residual_block" }))] }],
    ["a plane name that is too long", { ...published, input: { planes: ["x".repeat(81)] } }],
  ])("refuses a file with %s, so the card keeps its words alone", (_name, json) => {
    expect(() => parseArchitecture(json)).toThrow();
  });
});
