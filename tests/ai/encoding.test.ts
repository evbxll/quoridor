import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BASIC_PLANES, encodeState, INPUT_PLANES } from "../../src/ai/encoding";
import { Game } from "../../src/engine/game";
import { GameState } from "../../src/engine/state";

interface Position {
  size: number;
  moves: string[];
  key: string;
  to_move: number;
  planes: number[];
}

const { positions } = JSON.parse(
  readFileSync(new URL("../../fixtures/encoding.json", import.meta.url), "utf8"),
) as { positions: Position[] };

/** The float32 bit patterns, so that -0, NaN and last-bit differences all count. */
function bits(values: Float32Array): number[] {
  return Array.from(new Uint32Array(values.buffer, values.byteOffset, values.length));
}

describe("encodeState against encoding.json", () => {
  it("covers every size, both movers and cut-off cells", () => {
    expect(new Set(positions.map((p) => p.size))).toEqual(new Set([5, 7, 9, 11]));
    expect(new Set(positions.map((p) => p.to_move))).toEqual(new Set([1, 2]));
    const cutOff = (p: Position): boolean => p.planes.slice(6 * p.size * p.size, 8 * p.size * p.size).includes(4);
    expect(positions.some(cutOff)).toBe(true);
  });

  it("matches the Python planes bit for bit from the position key", () => {
    for (const p of positions) {
      const planes = encodeState(GameState.fromKey(p.key));
      expect(planes).toHaveLength(INPUT_PLANES * p.size * p.size);
      expect(bits(planes), p.key).toEqual(bits(new Float32Array(p.planes)));
    }
  });

  it("produces a 6-plane model's input as the first six planes of Python's ten, bit for bit", () => {
    for (const p of positions) {
      const cells = p.size * p.size;
      const planes = encodeState(GameState.fromKey(p.key), BASIC_PLANES);
      expect(planes).toHaveLength(BASIC_PLANES * cells);
      expect(bits(planes), p.key).toEqual(bits(new Float32Array(p.planes.slice(0, BASIC_PLANES * cells))));
      // The same as slicing this encoder's own ten planes.
      expect(bits(planes)).toEqual(bits(encodeState(GameState.fromKey(p.key)).subarray(0, BASIC_PLANES * cells)));
    }
  });

  it("refuses a plane count it cannot produce", () => {
    for (const planes of [0, 5, 7, 11]) expect(() => encodeState(GameState.initial(5), planes)).toThrow("Cannot encode");
  });

  it("matches when the position is reached by playing its moves", () => {
    for (const p of positions) {
      const game = new Game(p.size);
      for (const move of p.moves) game.playMove(move);
      expect(game.state.positionKey()).toBe(p.key);
      expect(bits(encodeState(game.state)), p.key).toEqual(bits(new Float32Array(p.planes)));
    }
  });
});
