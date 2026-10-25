import { describe, expect, it } from "vitest";
import { type GlobalAction, HORIZONTAL, VERTICAL } from "../../src/engine/actions";
import { WallPreview } from "../../src/ui/pointer";

const wall = { kind: "wall", row: 1, col: 1, orientation: HORIZONTAL } as const;
const other = { kind: "wall", row: 2, col: 1, orientation: VERTICAL } as const;
const cell = { kind: "move", row: 3, col: 2 } as const;

describe("WallPreview with a mouse", () => {
  it("previews the groove under the pointer, drops it over a cell and when the pointer leaves, and plays on release", () => {
    const preview = new WallPreview();
    expect(preview.move("mouse", wall)).toBe(true);
    expect(preview.wall).toEqual(wall);
    expect(preview.move("mouse", wall)).toBe(false);
    expect(preview.move("mouse", cell)).toBe(true);
    expect(preview.wall).toBeNull();
    preview.move("mouse", wall);
    expect(preview.release("mouse", wall)).toBe("play");
    expect(preview.leave("mouse")).toBe(true);
    expect(preview.wall).toBeNull();
    expect(preview.release("mouse", null)).toBe("none");
  });
});

describe("WallPreview with a finger", () => {
  /** What a browser sends for one tap: pointerdown, pointerup, pointerleave, then click. */
  const tap = (preview: WallPreview, target: GlobalAction | null) => {
    const outcome = preview.release("touch", target);
    preview.leave("touch");
    return outcome;
  };

  it("previews on the first tap, keeps the preview through pointerleave, and plays on the second tap", () => {
    const preview = new WallPreview();
    expect(tap(preview, wall)).toBe("preview");
    expect(preview.wall).toEqual(wall);
    expect(tap(preview, wall)).toBe("play");
  });

  it("moves the preview when another groove is tapped, and a cell plays straight away", () => {
    const preview = new WallPreview();
    tap(preview, wall);
    expect(tap(preview, other)).toBe("preview");
    expect(preview.wall).toEqual(other);
    expect(tap(preview, wall)).toBe("preview");
    expect(tap(preview, cell)).toBe("play");
  });

  it("ignores touch moves, and a tap off the board clears the preview", () => {
    const preview = new WallPreview();
    tap(preview, wall);
    expect(preview.move("touch", other)).toBe(false);
    expect(preview.wall).toEqual(wall);
    expect(tap(preview, null)).toBe("none");
    expect(preview.wall).toBeNull();
    expect(tap(preview, wall)).toBe("preview");
  });

  it("forgets a preview on clear (after a move is played or a game starts)", () => {
    const preview = new WallPreview();
    tap(preview, wall);
    preview.clear();
    expect(tap(preview, wall)).toBe("preview");
  });
});
