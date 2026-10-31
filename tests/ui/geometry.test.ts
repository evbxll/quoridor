import { describe, expect, it } from "vitest";
import { HORIZONTAL, VERTICAL } from "../../src/engine/actions";
import { CELL, GAP, PAD, PITCH, boardSpan, cellAt, center, wallAt, wallRect } from "../../src/ui/geometry";

const cellMid = (i: number): number => PAD + i * PITCH + CELL / 2; // middle of cell i along an axis
const groove = (i: number): number => PAD + (i + 1) * PITCH - GAP / 2; // middle of the groove after cell i

describe("cellAt", () => {
  it("finds the cell under a point, and nothing in a groove or off the board", () => {
    expect(cellAt(cellMid(2), cellMid(3), 5)).toEqual({ row: 3, col: 2 });
    expect(cellAt(groove(1), cellMid(3), 5)).toBeNull();
    expect(cellAt(cellMid(5), cellMid(0), 5)).toBeNull(); // a sixth column of a 5x5 board
    expect(cellAt(PAD - 10, cellMid(0), 5)).toBeNull();
  });
});

describe("wallAt", () => {
  it("anchors a horizontal wall at the slot nearest the pointer", () => {
    const y = groove(1); // between rows 1 and 2
    expect(wallAt(PAD + 2 * PITCH + 10, y, 5)).toEqual({ row: 1, col: 1, orientation: HORIZONTAL });
    expect(wallAt(PAD + 2 * PITCH + CELL - 10, y, 5)).toEqual({ row: 1, col: 2, orientation: HORIZONTAL });
    expect(wallAt(cellMid(4), y, 5)).toEqual({ row: 1, col: 3, orientation: HORIZONTAL }); // clamped
  });

  it("anchors a vertical wall, prefers horizontal where grooves cross, and skips cells", () => {
    expect(wallAt(groove(1), cellMid(2), 5)).toEqual({ row: 1, col: 1, orientation: VERTICAL });
    expect(wallAt(groove(1), groove(1), 5)).toEqual({ row: 1, col: 1, orientation: HORIZONTAL });
    expect(wallAt(cellMid(2), cellMid(2), 5)).toBeNull();
  });

  it("ignores the board's border and the label margin", () => {
    const span = boardSpan(5);
    expect(wallAt(PAD - 4, cellMid(2), 5)).toBeNull(); // left border
    expect(wallAt(PAD + span + 6, cellMid(2), 5)).toBeNull(); // right border
    expect(wallAt(cellMid(2), PAD - 4, 5)).toBeNull(); // top border
    expect(wallAt(PAD - 70, cellMid(2), 5)).toBeNull(); // label margin
  });
});

describe("wallRect and center", () => {
  it("spans two cells and the groove between them", () => {
    expect(wallRect(0, 0, HORIZONTAL)).toEqual({ x: PAD, y: PAD + CELL, w: 2 * CELL + GAP, h: GAP });
    expect(wallRect(0, 0, VERTICAL)).toEqual({ x: PAD + CELL, y: PAD, w: GAP, h: 2 * CELL + GAP });
  });

  it("puts a cell's center in the middle of the cell", () => {
    expect(center(1, 2)).toEqual([cellMid(2), cellMid(1)]);
  });
});
