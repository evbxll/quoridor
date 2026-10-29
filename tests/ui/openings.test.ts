import { describe, expect, it } from "vitest";
import { GameState } from "../../src/engine/state";
import { parseMove } from "../../src/engine/notation";
import { OPENING_PLIES, openingFor, openingGame, openingPool } from "../../src/ui/openings";

describe("openings", () => {
  for (const size of [5, 7, 9, 11]) {
    it(`plays ${OPENING_PLIES} legal pawn plies on ${size}x${size}, each to a different position`, () => {
      const pool = openingPool(size);
      expect(pool.length).toBeGreaterThan(10);
      const positions = new Set<string>();
      for (const moves of pool) {
        expect(moves).toHaveLength(OPENING_PLIES);
        const state = GameState.initial(size);
        for (const move of moves) {
          expect(move).toMatch(/^[a-z][0-9]+$/);
          state.play(parseMove(state, move));
        }
        expect(state.isEnd()).toBe(false);
        positions.add(state.positionKey());
      }
      expect(positions.size).toBe(pool.length);
    });
  }

  it("has the number of openings the page's note states, on every size", () => {
    expect(openingPool(9)).toHaveLength(35);
    expect(openingPool(7)).toHaveLength(35);
    expect(openingPool(11)).toHaveLength(35);
    expect(openingPool(5)).toHaveLength(35);
  });

  it("is the same for the same seed and differs between games until the pool is used up", () => {
    const size = 9;
    const pool = openingPool(size).length;
    const first = Array.from({ length: pool }, (_, index) => openingFor(size, 7, index).join("."));
    expect(Array.from({ length: pool }, (_, index) => openingFor(size, 7, index).join("."))).toEqual(first);
    expect(new Set(first).size).toBe(pool);
    expect(openingFor(size, 7, pool)).toEqual(openingFor(size, 7, 0));
    expect(Array.from({ length: pool }, (_, index) => openingFor(size, 8, index).join("."))).not.toEqual(first);
  });

  it("makes a game whose moves are the opening, not over", () => {
    const game = openingGame(7, 3, 2);
    expect(game.moves).toEqual(openingFor(7, 3, 2));
    expect(game.result).toBeNull();
    expect(game.toHash()).toBe(`#n=7&m=${openingFor(7, 3, 2).join(".")}`);
  });
});
