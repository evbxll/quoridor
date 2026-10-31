// Board geometry in SVG units (same author, MIT).

import { HORIZONTAL, type Orientation, VERTICAL } from "../engine/actions";

export const CELL = 56; // cell side
export const GAP = 12; // groove width
export const PAD = 40; // margin for coordinate labels
export const PITCH = CELL + GAP;

export const cellX = (col: number): number => PAD + col * PITCH;
export const cellY = (row: number): number => PAD + row * PITCH;
export const center = (row: number, col: number): [number, number] => [cellX(col) + CELL / 2, cellY(row) + CELL / 2];

/** Side of the board's grid of cells and grooves, without the margin. */
export const boardSpan = (size: number): number => size * PITCH - GAP;

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** The rectangle of the wall anchored at GLOBAL (row, col): two cells and the groove between them. */
export function wallRect(row: number, col: number, orientation: Orientation): Rect {
  return orientation === HORIZONTAL
    ? { x: cellX(col), y: cellY(row + 1) - GAP, w: 2 * CELL + GAP, h: GAP }
    : { x: cellX(col + 1) - GAP, y: cellY(row), w: GAP, h: 2 * CELL + GAP };
}

export interface WallSlot {
  readonly row: number;
  readonly col: number;
  readonly orientation: Orientation;
}

/** The wall slot (anchor and orientation) under board point (x, y), or null over a cell or off the grid. */
export function wallAt(x: number, y: number, size: number): WallSlot | null {
  const span = boardSpan(size);
  if (x < PAD || y < PAD || x > PAD + span || y > PAD + span) return null; // the border and labels
  const fx = (x - PAD) / PITCH;
  const fy = (y - PAD) / PITCH;
  const inVertical = fx - Math.floor(fx) > CELL / PITCH; // in a vertical groove
  const inHorizontal = fy - Math.floor(fy) > CELL / PITCH; // in a horizontal groove
  if (!inVertical && !inHorizontal) return null;
  const horizontal = inHorizontal; // where two grooves cross, prefer horizontal
  const clamp = (v: number): number => Math.min(Math.max(v, 0), size - 2);
  // A wall spans two cells; anchor it at the slot nearest the pointer.
  return {
    row: horizontal ? clamp(Math.floor(fy)) : clamp(Math.round(fy - 1)),
    col: horizontal ? clamp(Math.round(fx - 1)) : clamp(Math.floor(fx)),
    orientation: horizontal ? HORIZONTAL : VERTICAL,
  };
}

/** The cell under board point (x, y), or null over a groove or off the board. */
export function cellAt(x: number, y: number, size: number): { row: number; col: number } | null {
  const col = Math.floor((x - PAD) / PITCH);
  const row = Math.floor((y - PAD) / PITCH);
  const inside = x - PAD - col * PITCH < CELL && y - PAD - row * PITCH < CELL;
  return inside && row >= 0 && col >= 0 && row < size && col < size ? { row, col } : null;
}
