import { describe, expect, it } from "vitest";
import { HORIZONTAL, VERTICAL } from "../../src/engine/actions";
import { formatAction } from "../../src/engine/notation";
import { GameState } from "../../src/engine/state";
import { describeTarget, findAction, moveCursor, pawnTargets } from "../../src/ui/targets";

const start = GameState.initial(5);

describe("findAction", () => {
  it("finds the pawn move onto a cell and the wall at a slot, as either player", () => {
    const step = findAction(start, { kind: "move", row: 3, col: 2 });
    expect(formatAction(start, step!)).toBe("c2");
    const wall = findAction(start, { kind: "wall", row: 1, col: 1, orientation: HORIZONTAL });
    expect(formatAction(start, wall!)).toBe("b3h");

    const second = start.clone();
    second.play(step!);
    const reply = findAction(second, { kind: "move", row: 1, col: 2 });
    expect(formatAction(second, reply!)).toBe("c4");
    const flipped = findAction(second, { kind: "wall", row: 1, col: 1, orientation: VERTICAL });
    expect(formatAction(second, flipped!)).toBe("b3v");
  });

  it("returns null for a cell too far away, an occupied cell and a wall slot out of range", () => {
    expect(findAction(start, { kind: "move", row: 0, col: 0 })).toBeNull();
    expect(findAction(start, { kind: "move", row: 4, col: 2 })).toBeNull();
    expect(findAction(start, { kind: "wall", row: 4, col: 4, orientation: HORIZONTAL })).toBeNull();
  });
});

describe("pawnTargets", () => {
  it("lists the steps from the start position", () => {
    expect(pawnTargets(start)).toEqual(expect.arrayContaining([{ row: 3, col: 2 }, { row: 4, col: 1 }, { row: 4, col: 3 }]));
    expect(pawnTargets(start)).toHaveLength(3);
  });
});

describe("moveCursor", () => {
  it("moves with the arrows and stops at the edge", () => {
    expect(moveCursor({ kind: "move", row: 4, col: 2 }, "ArrowUp", 5)).toEqual({ kind: "move", row: 3, col: 2 });
    expect(moveCursor({ kind: "move", row: 4, col: 2 }, "ArrowDown", 5)).toEqual({ kind: "move", row: 4, col: 2 });
    expect(moveCursor({ kind: "wall", row: 3, col: 3, orientation: HORIZONTAL }, "ArrowRight", 5)).toEqual({ kind: "wall", row: 3, col: 3, orientation: HORIZONTAL });
  });

  it("switches between pawn and wall with h, v and p, keeping the place on the board", () => {
    expect(moveCursor({ kind: "move", row: 4, col: 4 }, "h", 5)).toEqual({ kind: "wall", row: 3, col: 3, orientation: HORIZONTAL });
    expect(moveCursor({ kind: "wall", row: 1, col: 2, orientation: HORIZONTAL }, "v", 5)).toEqual({ kind: "wall", row: 1, col: 2, orientation: VERTICAL });
    expect(moveCursor({ kind: "wall", row: 1, col: 2, orientation: VERTICAL }, "p", 5)).toEqual({ kind: "move", row: 1, col: 2 });
  });

  it("leaves other keys alone", () => {
    expect(moveCursor({ kind: "move", row: 0, col: 0 }, "Enter", 5)).toBeNull();
  });
});

describe("describeTarget", () => {
  it("names the cell or wall and says whether it is legal", () => {
    expect(describeTarget(start, { kind: "move", row: 3, col: 2 })).toBe("c2, legal pawn move");
    expect(describeTarget(start, { kind: "move", row: 0, col: 0 })).toBe("a5, not a legal pawn move");
    expect(describeTarget(start, { kind: "move", row: 4, col: 2 })).toBe("c1, player 1's pawn");
    expect(describeTarget(start, { kind: "wall", row: 1, col: 1, orientation: HORIZONTAL })).toBe("Wall b3h, horizontal, legal");
  });
});
