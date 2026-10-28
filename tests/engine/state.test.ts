import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { playerAction } from "../../src/engine/actions";
import { actionCount, maxPlies, wallCount } from "../../src/engine/constants";
import { GameState } from "../../src/engine/state";

function fixture<T>(name: string): T {
  return JSON.parse(readFileSync(new URL(`../../fixtures/${name}.json`, import.meta.url), "utf8")) as T;
}

interface Game {
  size: number;
  actions: number[];
  legal: number[][];
  dists: [number, number][];
  keys: string[];
  winner: string;
}

interface Case {
  name: string;
  key: string;
  legal: number[];
  dists: [number, number];
  play?: { action: number; winner: string };
}

interface Perft {
  starts: Record<string, number[]>;
  positions: { size: number; key: string; counts: number[] }[];
}

/** Leaf counts of move sequences of length `depth`, counted the way the fixtures count them. */
function perft(state: GameState, depth: number): number {
  const actions = state.legalActions();
  if (depth === 1) return actions.length;
  let total = 0;
  for (const action of actions) {
    const child = state.clone();
    child.play(action);
    total += perft(child, depth - 1);
  }
  return total;
}

describe("constants", () => {
  it("pins the hybrid wall count for every size a link can name", () => {
    expect([5, 6, 7, 8, 9, 10, 11, 12, 13].map(wallCount)).toEqual([3, 4, 6, 8, 10, 11, 12, 13, 14]);
    expect(GameState.initial(11).wallsLeft(0)).toBe(12);
    expect(GameState.initial(11).wallsLeft(1)).toBe(12);
  });

  it("match the design table", () => {
    expect([5, 7, 9, 11].map(wallCount)).toEqual([3, 6, 10, 12]);
    expect([5, 7, 9, 11].map(maxPlies)).toEqual([63, 123, 203, 303]);
    expect([5, 7, 9, 11].map(actionCount)).toEqual([44, 84, 140, 212]);
  });
});

describe("games.json", () => {
  const { games, cases } = fixture<{ games: Game[]; cases: Case[] }>("games");

  it("replays every game with the same legal actions, distances and keys", () => {
    expect(games.length).toBeGreaterThan(100);
    for (const game of games) {
      const state = GameState.initial(game.size);
      expect(state.positionKey()).toBe(game.keys[0]);
      expect(state.pathDists()).toEqual(game.dists[0]);
      game.actions.forEach((action, ply) => {
        expect(state.legalActions()).toEqual(game.legal[ply]);
        state.play(playerAction(action));
        expect(state.positionKey()).toBe(game.keys[ply + 1]);
        expect(state.pathDists()).toEqual(game.dists[ply + 1]);
      });
    }
  });

  it("agrees on who won the games that ended on a goal row", () => {
    for (const game of games.filter((g) => g.winner !== "draw")) {
      const state = GameState.initial(game.size);
      for (const action of game.actions) state.play(playerAction(action));
      expect(state.isEnd()).toBe(true);
      expect(`p${state.winner()}`).toBe(game.winner);
    }
  });

  it("handles the hand-built cases", () => {
    expect(cases.length).toBeGreaterThan(0);
    for (const c of cases) {
      const state = GameState.fromKey(c.key);
      expect(state.positionKey(), c.name).toBe(c.key);
      expect(state.legalActions(), c.name).toEqual(c.legal);
      expect(state.pathDists(), c.name).toEqual(c.dists);
      if (c.play) {
        state.play(playerAction(c.play.action));
        expect(`p${state.winner()}`, c.name).toBe(c.play.winner);
      }
    }
  });
});

describe("play", () => {
  it("rejects illegal actions and moves after the end", () => {
    const state = GameState.initial(5);
    expect(() => state.play(playerAction(1))).toThrow("Illegal pawn move");
    expect(() => state.play(playerAction(1000))).toThrow(RangeError);
    expect(() => GameState.fromKey("5|1|c5|a1|3,3|").play(playerAction(0))).toThrow("The game is over");
  });

  it("allows no walls when none are left", () => {
    const state = GameState.fromKey("5|1|c1|c5|0,3|");
    expect(state.legalActions().every((a) => a < 12)).toBe(true);
    expect(() => state.play(playerAction(12))).toThrow("No walls left");
  });

  it("refuses the wall that would seal a pawn into its corner", () => {
    // Player 2 on a5 under wall a4h: b4v (action 29) would close the corner.
    const state = GameState.fromKey("5|1|c1|a5|3,3|a4h");
    expect(state.legalActions()).not.toContain(29);
    expect(state.legalActions()).toContain(30);
    expect(() => state.play(playerAction(29))).toThrow("Illegal wall");
  });
});

describe("perft.json", () => {
  const data = fixture<Perft>("perft");

  it("matches the counts from the mid-game positions", () => {
    expect(data.positions).toHaveLength(8);
    for (const position of data.positions) {
      const state = GameState.fromKey(position.key);
      expect(state.positionKey()).toBe(position.key);
      position.counts.forEach((count, i) => expect(perft(state, i + 1)).toBe(count));
    }
  }, 120_000);

  it("matches the start counts to depth 3 on 5, 7, 9 and 11", () => {
    for (const size of [5, 7, 9, 11]) {
      const expected = data.starts[String(size)]!;
      expected.forEach((count, i) => expect(perft(GameState.initial(size), i + 1)).toBe(count));
    }
    expect(data.starts["9"]).toEqual([131, 16677, 2062264]);
    expect(data.starts["11"]).toEqual([203, 40445, 7907200]);
  }, 60_000);
});
