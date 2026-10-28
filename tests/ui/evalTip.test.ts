import { describe, expect, it } from "vitest";
import { botOf, type Bot } from "../../src/ui/bots";
import { HUMAN } from "../../src/ui/controller";
import { barBlurb, botKind, markerBlurb, type BarInput, type MarkerInput } from "../../src/ui/evalTip";

const marker = (over: Partial<MarkerInput>): MarkerInput => ({ side: "p2", seat: botOf("strong"), p1Percent: 59, move: 14, viewingPast: false, ...over });
const bar = (over: Partial<BarInput>): BarInput => ({ percent: 62, stale: false, unavailable: false, failed: false, ply: 14, moves: 14, simulations: 32, ...over });

describe("a marker's blurb", () => {
  it("names the bot, its kind and simulations, and gives both players' numbers", () => {
    expect(markerBlurb(marker({}))).toBe(
      "Player 2 (Strong, network, 32 simulations) rated the position at 41% for Player 2 (59% for Player 1) when it searched for its move 14, before playing it.",
    );
  });

  it("gives the named player's number first, whichever side it is", () => {
    expect(markerBlurb(marker({ side: "p1", seat: botOf("normal"), p1Percent: 75, move: 13 }))).toBe(
      "Player 1 (Normal, heuristic, 100 simulations) rated the position at 75% for Player 1 (25% for Player 2) when it searched for its move 13, before playing it.",
    );
  });

  it("says Custom for settings no preset has, and a single simulation in the singular", () => {
    const custom: Bot = { engine: "heuristic", simulations: 1, vary: false };
    expect(botKind(custom)).toBe("Custom, heuristic, 1 simulation");
    expect(markerBlurb(marker({ seat: custom }))).toContain("Player 2 (Custom, heuristic, 1 simulation) rated");
  });

  it("handles the extremes", () => {
    expect(markerBlurb(marker({ p1Percent: 0 }))).toContain("100% for Player 2 (0% for Player 1)");
    expect(markerBlurb(marker({ p1Percent: 100 }))).toContain("0% for Player 2 (100% for Player 1)");
  });

  it("says when the reading is the latest up to an earlier position being viewed", () => {
    expect(markerBlurb(marker({ viewingPast: true }))).toMatch(/before playing it \(the latest search up to the position you are viewing\)\.$/);
  });

  it("says there is no reading yet before the bot has searched", () => {
    expect(markerBlurb(marker({ p1Percent: null, move: null }))).toBe("No reading yet: Player 2 has not searched.");
  });

  it("says a person has no reading, and credits an earlier bot's reading", () => {
    expect(markerBlurb(marker({ seat: HUMAN, p1Percent: null, move: null }))).toBe("No reading: Player 2 is a person, not a bot.");
    expect(markerBlurb(marker({ seat: HUMAN }))).toBe(
      "Before a person took over Player 2, its bot rated the position at 41% for Player 2 (59% for Player 1) when it searched for its move 14, before playing it.",
    );
  });
});

describe("the eval bar's blurb", () => {
  it("gives both players' numbers for the current position and says what made them", () => {
    expect(barBlurb(bar({}))).toBe(
      "Network reading (Analysis) of the current position (after move 14): 62% for Player 1, 38% for Player 2. Made by the analysis search with the network (32 simulations), apart from the players' own searches.",
    );
  });

  it("names an earlier position being viewed, and the start", () => {
    expect(barBlurb(bar({ ply: 6 }))).toContain("of the position after move 6:");
    expect(barBlurb(bar({ ply: 0, moves: 0, percent: 50 }))).toContain("of the starting position: 50% for Player 1, 50% for Player 2.");
    expect(barBlurb(bar({ ply: 0 }))).toContain("the starting position (before move 1)");
  });

  it("handles the extremes", () => {
    expect(barBlurb(bar({ percent: 0 }))).toContain("0% for Player 1, 100% for Player 2");
    expect(barBlurb(bar({ percent: 100 }))).toContain("100% for Player 1, 0% for Player 2");
  });

  it("says the kept percentage is from the previous position while this one is read or after a failure", () => {
    expect(barBlurb(bar({ stale: true }))).toBe("Network reading (Analysis) of the previous position: 62% for Player 1, 38% for Player 2. It is reading the current position (after move 14).");
    expect(barBlurb(bar({ stale: true, failed: true }))).toContain("It could not read the current position");
  });

  it("says when there is nothing to show", () => {
    expect(barBlurb(bar({ percent: null }))).toBe("No network reading yet: the network is reading the current position (after move 14).");
    expect(barBlurb(bar({ percent: null, failed: true }))).toBe("No network reading for the current position (after move 14): the search failed.");
    expect(barBlurb(bar({ percent: null, unavailable: true }))).toBe("No network reading: the network is not ready.");
  });
});
