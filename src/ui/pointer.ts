import type { GlobalAction } from "../engine/actions";

export type WallTarget = GlobalAction & { kind: "wall" };

/** What a pointer release asks the page to do. */
export type Release = "play" | "preview" | "none";

/**
 * The wall preview behind the pointer: a mouse previews the groove it hovers
 * over; a finger cannot hover, so its first tap on a groove previews the wall
 * and a second tap on the same groove places it. A touch also sends
 * `pointerleave` right after `pointerup`; that must not take the preview away.
 */
export class WallPreview {
  private current: WallTarget | null = null;

  /** The wall to draw as a ghost, if any. */
  get wall(): WallTarget | null {
    return this.current;
  }

  /** The pointer moved over `target`; true if the preview changed. */
  move(pointerType: string, target: GlobalAction | null): boolean {
    if (pointerType === "touch") return false;
    return this.set(target?.kind === "wall" ? target : null);
  }

  /** The pointer left the board; true if the preview changed. */
  leave(pointerType: string): boolean {
    return pointerType === "touch" ? false : this.set(null);
  }

  /** The pointer was released over `target` (null: not over a cell or groove). */
  release(pointerType: string, target: GlobalAction | null): Release {
    if (target === null) {
      this.current = null;
      return "none";
    }
    if (pointerType !== "touch" || target.kind === "move") return "play";
    if (this.current !== null && sameWall(this.current, target)) return "play";
    this.current = target;
    return "preview";
  }

  clear(): void {
    this.current = null;
  }

  private set(next: WallTarget | null): boolean {
    const changed = !(next === null ? this.current === null : this.current !== null && sameWall(this.current, next));
    this.current = next;
    return changed;
  }
}

function sameWall(a: WallTarget, b: WallTarget): boolean {
  return a.row === b.row && a.col === b.col && a.orientation === b.orientation;
}
