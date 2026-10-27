import { describe, expect, it } from "vitest";
import { HORIZONTAL } from "../../src/engine/actions";
import { GameState } from "../../src/engine/state";
import { replay } from "../../src/ui/analysis";
import { describeBoard, renderBoard, wallOwners } from "../../src/ui/board";

/** Plies: e2 (player 1), e8 (player 2), c3h (player 1), d7v (player 2). */
const GAME = ["e2", "e8", "c3h", "d7v"];
const count = (markup: string, pattern: RegExp): number => markup.match(pattern)?.length ?? 0;

describe("renderBoard", () => {
  it("draws every cell, both pawns with their numbers, and labels the files and ranks", () => {
    for (const size of [5, 9, 11]) {
      const markup = renderBoard(GameState.initial(size));
      expect(count(markup, /class="cell"/g)).toBe(size * size);
      expect(count(markup, /class="pawn p[12]/g)).toBe(2);
      expect(count(markup, /class="pawn-mark"/g)).toBe(2);
      expect(count(markup, /class="label"/g)).toBe(2 * size);
      expect(markup).toContain(">a<");
      expect(markup).toContain(`>${size}<`);
    }
  });

  it("marks the player to move, and nobody once the game is over", () => {
    expect(renderBoard(GameState.initial(5))).toMatch(/pawn p1 to-move/);
    expect(renderBoard(GameState.fromKey("5|1|c5|c2|3,3|"))).not.toMatch(/to-move/);
  });

  it("draws placed walls", () => {
    const markup = renderBoard(GameState.fromKey("5|1|c1|c5|2,3|b3h"));
    expect(count(markup, /class="wall"/g)).toBe(1);
  });

  it("tints each wall by the player who placed it", () => {
    const { state } = replay(9, GAME, GAME.length);
    const markup = renderBoard(state, { targets: [], ghost: null, cursor: null, last: null, owners: wallOwners(9, GAME) });
    expect(count(markup, /class="wall p1"/g)).toBe(1);
    expect(count(markup, /class="wall p2"/g)).toBe(1);
  });

  it("draws targets, the last move, a ghost wall (dashed when illegal in the stylesheet) and the cursor", () => {
    const state = GameState.initial(5);
    const markup = renderBoard(state, {
      targets: [{ row: 3, col: 2 }],
      ghost: { wall: { kind: "wall", row: 1, col: 1, orientation: HORIZONTAL }, legal: false },
      cursor: { target: { kind: "move", row: 4, col: 2 }, legal: true },
      last: { kind: "wall", row: 0, col: 0, orientation: HORIZONTAL },
    });
    expect(markup).toContain('class="target"');
    expect(markup).toContain('class="ghost bad"');
    expect(markup).toContain('class="cursor"');
    expect(markup).toContain('class="last-wall"');
    expect(renderBoard(state, { targets: [], ghost: null, cursor: null, last: { kind: "move", row: 3, col: 2 } })).toContain('class="last"');
  });

  it("draws the keyboard cursor on a wall like the pointer's ghost, and marks an illegal one", () => {
    const state = GameState.initial(5);
    const wall = { kind: "wall", row: 1, col: 1, orientation: HORIZONTAL } as const;
    const marks = { targets: [], ghost: null, last: null };
    const legal = renderBoard(state, { ...marks, cursor: { target: wall, legal: true } });
    expect(legal).toContain('class="ghost ok"');
    expect(legal).toContain('class="cursor"');
    const illegal = renderBoard(state, { ...marks, cursor: { target: wall, legal: false } });
    expect(illegal).toContain('class="ghost bad"');
    expect(illegal).toContain('class="cursor bad"');
    expect(renderBoard(state, { ...marks, cursor: { target: { kind: "move", row: 0, col: 0 }, legal: false } })).toContain('class="cursor bad"');
  });
});

describe("describeBoard", () => {
  it("states size, pawns, walls left and walls placed", () => {
    expect(describeBoard(GameState.fromKey("5|1|c1|c5|2,3|b3h"))).toBe(
      "5 by 5 board. Player 1 on c1 with 2 walls left. Player 2 on c5 with 3 walls left. 1 walls placed.",
    );
  });
});

describe("wallOwners", () => {
  it("gives each wall to the player whose ply placed it, and ignores pawn moves", () => {
    const owners = wallOwners(9, GAME);
    expect([...owners.values()]).toEqual([0, 1]);
    expect(owners.size).toBe(2);
  });

  it("is empty before any wall", () => {
    expect(wallOwners(5, []).size).toBe(0);
    expect(wallOwners(5, ["c2"]).size).toBe(0);
  });
});
