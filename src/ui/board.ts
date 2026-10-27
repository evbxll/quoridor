import { HORIZONTAL, type GlobalAction, squareName, VERTICAL } from "../engine/actions";
import { parseMove } from "../engine/notation";
import { GameState } from "../engine/state";
import { CELL, GAP, PAD, boardSpan, cellX, cellY, center, wallRect } from "./geometry";

/** What to draw on the board besides the position itself. */
export interface BoardMarks {
  /** Cells the player to move may step to. */
  readonly targets: readonly { row: number; col: number }[];
  /** The wall under the pointer and whether it can be placed. */
  readonly ghost: { readonly wall: GlobalAction & { kind: "wall" }; readonly legal: boolean } | null;
  /** The keyboard cursor and whether its move can be played, drawn only while the keyboard is in use. */
  readonly cursor: { readonly target: GlobalAction; readonly legal: boolean } | null;
  /** The last move played. */
  readonly last: GlobalAction | null;
  /** Who placed each wall, from {@link wallOwners}; walls missing from it are drawn without a player's tint. */
  readonly owners?: ReadonlyMap<string, 0 | 1>;
}

const NO_MARKS: BoardMarks = { targets: [], ghost: null, cursor: null, last: null };

const wallKey = (row: number, col: number, orientation: number): string => `${row},${col},${orientation}`;

/** Who placed each wall of the game after `moves`, keyed by anchor and orientation: player 1 moves on the even plies. */
export function wallOwners(size: number, moves: readonly string[]): Map<string, 0 | 1> {
  const state = GameState.initial(size);
  const owners = new Map<string, 0 | 1>();
  moves.forEach((move, ply) => {
    const action = parseMove(state, move);
    const target = state.globalAction(action);
    if (target.kind === "wall") owners.set(wallKey(target.row, target.col, target.orientation), ply % 2 === 0 ? 0 : 1);
    state.play(action);
  });
  return owners;
}

function slot(className: string, target: GlobalAction & { kind: "wall" }, extra = ""): string {
  const b = wallRect(target.row, target.col, target.orientation);
  return `<rect class="${className}" x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="3"${extra}/>`;
}

function ring(className: string, row: number, col: number, grow: number): string {
  return `<rect class="${className}" x="${cellX(col) - grow}" y="${cellY(row) - grow}" width="${CELL + 2 * grow}" height="${CELL + 2 * grow}" rx="${5 + grow}"/>`;
}

/**
 * The inside of the board's `<svg>`: cells, labels, walls, pawns and marks.
 * Information never rests on color alone: pawns carry their player's number,
 * a placed wall is tinted by its player and also differs in lightness,
 * a wall or cell that cannot be played is dashed, and the cursor and the last move are
 * outlines.
 */
export function renderBoard(state: GameState, marks: BoardMarks = NO_MARKS): string {
  const n = state.size;
  const span = boardSpan(n);
  const out = [`<rect x="${PAD - 6}" y="${PAD - 6}" width="${span + 12}" height="${span + 12}" rx="10" fill="var(--board)"/>`];
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      out.push(`<rect class="cell" x="${cellX(c)}" y="${cellY(r)}" width="${CELL}" height="${CELL}" rx="5"/>`);
    }
  }
  for (let r = 0; r < n - 1; r++) {
    for (let c = 0; c < n - 1; c++) {
      out.push(`<circle class="dot" cx="${cellX(c + 1) - GAP / 2}" cy="${cellY(r + 1) - GAP / 2}" r="2.2"/>`);
    }
  }
  // Larger boards are drawn smaller on screen, so their labels and pawn numbers get more board units.
  const font = n >= 11 ? 28 : n >= 9 ? 24 : 17;
  const markFont = n >= 9 ? 30 : 24;
  for (let i = 0; i < n; i++) {
    out.push(`<text class="label" style="font-size:${font}px" x="${cellX(i) + CELL / 2}" y="${PAD + span + 24}">${String.fromCharCode(97 + i)}</text>`);
    out.push(`<text class="label" style="font-size:${font}px" x="${PAD - 24}" y="${cellY(i) + CELL / 2}">${n - i}</text>`);
  }
  for (let r = 0; r < n - 1; r++) {
    for (let c = 0; c < n - 1; c++) {
      for (const orientation of [HORIZONTAL, VERTICAL] as const) {
        if (!state.hasWall(r, c, orientation)) continue;
        const owner = marks.owners?.get(wallKey(r, c, orientation));
        out.push(slot(owner === undefined ? "wall" : `wall p${owner + 1}`, { kind: "wall", row: r, col: c, orientation }));
      }
    }
  }
  if (marks.last) {
    out.push(marks.last.kind === "move" ? ring("last", marks.last.row, marks.last.col, 3) : slot("last-wall", marks.last));
  }
  for (const t of marks.targets) {
    const [x, y] = center(t.row, t.col);
    out.push(`<circle class="target" cx="${x}" cy="${y}" r="9"/>`);
  }
  for (const player of [0, 1] as const) {
    const [x, y] = center(state.row(player), state.col(player));
    const toMove = (player === 0) === state.p1Turn && !state.isEnd();
    out.push(`<circle class="pawn p${player + 1}${toMove ? " to-move" : ""}" cx="${x}" cy="${y}" r="${CELL / 2 - 9}"/>`);
    out.push(`<text class="pawn-mark" style="font-size:${markFont}px" x="${x}" y="${y}">${player + 1}</text>`);
  }
  if (marks.ghost) out.push(slot(marks.ghost.legal ? "ghost ok" : "ghost bad", marks.ghost.wall));
  if (marks.cursor) {
    const { target, legal } = marks.cursor;
    // A wall under the cursor looks like the pointer's ghost wall, so legal and illegal differ in more than color.
    if (target.kind === "wall") out.push(slot(legal ? "ghost ok" : "ghost bad", target));
    out.push(target.kind === "move" ? ring(legal ? "cursor" : "cursor bad", target.row, target.col, 5) : slot(legal ? "cursor" : "cursor bad", target));
  }
  return out.join("");
}

/** The board in words (the `<svg>`'s label): size, pawns, walls placed and walls left. */
export function describeBoard(state: GameState): string {
  const n = state.size;
  let placed = 0;
  for (let r = 0; r < n - 1; r++) {
    for (let c = 0; c < n - 1; c++) {
      for (const orientation of [HORIZONTAL, VERTICAL] as const) if (state.hasWall(r, c, orientation)) placed++;
    }
  }
  const pawn = (p: 0 | 1): string => squareName(state.row(p), state.col(p), n);
  return `${n} by ${n} board. Player 1 on ${pawn(0)} with ${state.wallsLeft(0)} walls left. Player 2 on ${pawn(1)} with ${state.wallsLeft(1)} walls left. ${placed} walls placed.`;
}
