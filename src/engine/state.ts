import {
  decodeAction,
  flipAnchor,
  type GlobalAction,
  HORIZONTAL,
  MOVE_MAPPING,
  type Orientation,
  type PlayerAction,
  playerAction,
  squareName,
  VERTICAL,
  wallName,
} from "./actions";
import { NUM_PAWN_MOVES, wallCount } from "./constants";

/** Scratch buffers for path searches, shared by a state and its clones (single-threaded). */
interface Scratch {
  readonly queue: Int32Array;
  readonly visited: Uint8Array;
}

const STEPS = [
  [-1, 0],
  [0, -1],
  [0, 1],
  [1, 0],
] as const;

/**
 * A Quoridor position: pawns, walls, walls left and the side to move.
 *
 * Players are 0 (player 1, starts on the last row, goal row 0) and 1 (player 2,
 * goal on the last row). Cells are GLOBAL (row, col). A horizontal wall anchored
 * at (r, c) blocks movement between rows r and r + 1 in columns c and c + 1; a
 * vertical wall blocks movement between columns c and c + 1 in rows r and r + 1.
 * Actions are PlayerActions: indices in the frame of the player to move.
 */
export class GameState {
  readonly size: number;
  /** True while player 1 is to move. Read-only outside the class. */
  p1Turn = true;
  private readonly pawns: Int32Array; // [row0, col0, row1, col1]
  private readonly left: Int32Array; // walls left per player
  private readonly walls: Uint8Array; // [(r * (size - 1) + c) * 2 + orientation]
  private readonly scratch: Scratch;

  private constructor(size: number, pawns: Int32Array, left: Int32Array, walls: Uint8Array, scratch: Scratch) {
    this.size = size;
    this.pawns = pawns;
    this.left = left;
    this.walls = walls;
    this.scratch = scratch;
  }

  /** The starting position. */
  static initial(size: number): GameState {
    const walls = wallCount(size);
    return new GameState(
      size,
      Int32Array.of(size - 1, size >> 1, 0, size >> 1),
      Int32Array.of(walls, walls),
      new Uint8Array(2 * (size - 1) ** 2),
      { queue: new Int32Array(size * size), visited: new Uint8Array(size * size) },
    );
  }

  /** Rebuilds a position from its `positionKey` text. The legality of what it describes is not checked. */
  static fromKey(key: string): GameState {
    const [sizeText, turn, p1, p2, left, wallText] = key.split("|");
    const size = Number(sizeText);
    const state = GameState.initial(size);
    const cell = (name: string): [number, number] => [size - Number(name.slice(1)), name.charCodeAt(0) - 97];
    state.p1Turn = turn === "1";
    state.pawns.set([...cell(p1!), ...cell(p2!)]);
    state.left.set(left!.split(",").map(Number));
    for (const name of wallText ? wallText.split(",") : []) {
      const [intersectionRow, col] = cell(name.slice(0, -1));
      const orientation = name.endsWith("h") ? HORIZONTAL : VERTICAL;
      state.walls[((intersectionRow - 1) * (size - 1) + col) * 2 + orientation] = 1;
    }
    return state;
  }

  clone(): GameState {
    const copy = new GameState(this.size, this.pawns.slice(), this.left.slice(), this.walls.slice(), this.scratch);
    copy.p1Turn = this.p1Turn;
    return copy;
  }

  /** Row of a player's pawn (GLOBAL). */
  row(player: 0 | 1): number {
    return this.pawns[2 * player]!;
  }

  /** Column of a player's pawn (GLOBAL). */
  col(player: 0 | 1): number {
    return this.pawns[2 * player + 1]!;
  }

  /** Walls a player has left. */
  wallsLeft(player: 0 | 1): number {
    return this.left[player]!;
  }

  /** Whether a wall is placed at the GLOBAL anchor (row, col). */
  hasWall(row: number, col: number, orientation: Orientation): boolean {
    return this.walls[(row * (this.size - 1) + col) * 2 + orientation] === 1;
  }

  /** Where `action` lands on the board, in GLOBAL coordinates. Legality is not checked. */
  globalAction(action: PlayerAction): GlobalAction {
    const decoded = decodeAction(action, this.size);
    if (decoded.kind === "move") {
      const mover = this.p1Turn ? 0 : 1;
      const sign = this.p1Turn ? 1 : -1;
      return {
        kind: "move",
        row: this.row(mover) + sign * decoded.dRow,
        col: this.col(mover) + sign * decoded.dCol,
      };
    }
    if (this.p1Turn) return decoded;
    return {
      kind: "wall",
      row: flipAnchor(decoded.row, this.size),
      col: flipAnchor(decoded.col, this.size),
      orientation: decoded.orientation,
    };
  }

  isEnd(): boolean {
    return this.row(0) === 0 || this.row(1) === this.size - 1;
  }

  /** The winner (1 or 2) of a finished game; throws if the game is not over. */
  winner(): 1 | 2 {
    if (this.row(0) === 0) return 1;
    if (this.row(1) === this.size - 1) return 2;
    throw new Error("The game is not over");
  }

  /** Both players' shortest-path lengths to their goal rows, ignoring pawns; -1 if cut off. */
  pathDists(): [number, number] {
    return [
      this.distance(this.row(0), this.col(0), 0),
      this.distance(this.row(1), this.col(1), this.size - 1),
    ];
  }

  /** Legal action indices for the player to move, ascending. */
  legalActions(): PlayerAction[] {
    const out: PlayerAction[] = [];
    const mover = this.p1Turn ? 0 : 1;
    const opponent = this.p1Turn ? 1 : 0;
    const sign = this.p1Turn ? 1 : -1;
    const row = this.row(mover);
    const col = this.col(mover);
    for (let i = 0; i < NUM_PAWN_MOVES; i++) {
      const [dRow, dCol] = MOVE_MAPPING[i]!;
      if (this.isPawnMoveLegal(row, col, row + sign * dRow, col + sign * dCol, this.row(opponent), this.col(opponent))) {
        out.push(playerAction(i));
      }
    }
    if (this.left[mover]! > 0) {
      const grid = this.size - 1;
      const block = grid * grid;
      for (const orientation of [HORIZONTAL, VERTICAL] as const) {
        for (let k = 0; k < block; k++) {
          const anchor = this.p1Turn ? k : block - 1 - k;
          if (this.isWallLegal(Math.floor(anchor / grid), anchor % grid, orientation)) {
            out.push(playerAction(NUM_PAWN_MOVES + orientation * block + k));
          }
        }
      }
    }
    return out;
  }

  /** Plays an action and passes the turn. Throws if the game is over or the action is illegal. */
  play(action: PlayerAction): void {
    if (this.isEnd()) throw new Error("The game is over");
    const target = this.globalAction(action);
    const mover = this.p1Turn ? 0 : 1;
    if (target.kind === "move") {
      const opponent = this.p1Turn ? 1 : 0;
      const { row, col } = target;
      if (!this.isPawnMoveLegal(this.row(mover), this.col(mover), row, col, this.row(opponent), this.col(opponent))) {
        throw new Error("Illegal pawn move");
      }
      this.pawns[2 * mover] = row;
      this.pawns[2 * mover + 1] = col;
    } else {
      if (this.left[mover]! <= 0) throw new Error("No walls left");
      if (!this.isWallLegal(target.row, target.col, target.orientation)) throw new Error("Illegal wall");
      this.walls[(target.row * (this.size - 1) + target.col) * 2 + target.orientation] = 1;
      this.left[mover] = this.left[mover]! - 1;
    }
    this.p1Turn = !this.p1Turn;
  }

  /**
   * The canonical text of the position, `size|turn|p1|p2|walls left|walls`,
   * for example `9|1|e1|e9|10,10|d4h,e5v`. Walls are sorted names.
   */
  positionKey(): string {
    const names: string[] = [];
    for (const orientation of [HORIZONTAL, VERTICAL] as const) {
      for (let r = 0; r < this.size - 1; r++) {
        for (let c = 0; c < this.size - 1; c++) {
          if (this.hasWall(r, c, orientation)) names.push(wallName(r, c, orientation, this.size));
        }
      }
    }
    return [
      this.size,
      this.p1Turn ? 1 : 2,
      squareName(this.row(0), this.col(0), this.size),
      squareName(this.row(1), this.col(1), this.size),
      `${this.left[0]},${this.left[1]}`,
      names.sort().join(","),
    ].join("|");
  }

  /** Whether a single step between adjacent cells is on the board and not walled off. */
  private isStepOpen(row: number, col: number, newRow: number, newCol: number): boolean {
    const size = this.size;
    if (newRow < 0 || newRow >= size || newCol < 0 || newCol >= size) return false;
    if (row === newRow) {
      if (col === newCol) return false;
      const c = Math.min(col, newCol);
      return !((row > 0 && this.hasWall(row - 1, c, VERTICAL)) || (row < size - 1 && this.hasWall(row, c, VERTICAL)));
    }
    if (col === newCol) {
      const r = Math.min(row, newRow);
      return !((col > 0 && this.hasWall(r, col - 1, HORIZONTAL)) || (col < size - 1 && this.hasWall(r, col, HORIZONTAL)));
    }
    return true;
  }

  /**
   * Pawn-move legality in GLOBAL coordinates: a step to a free cell, a
   * straight jump over the adjacent opponent, or a diagonal jump when the
   * straight jump is blocked by a wall or the edge.
   */
  private isPawnMoveLegal(
    row: number,
    col: number,
    newRow: number,
    newCol: number,
    oppRow: number,
    oppCol: number,
  ): boolean {
    const dRow = newRow - row;
    const dCol = newCol - col;
    if (Math.abs(dRow) + Math.abs(dCol) === 1) {
      return this.isStepOpen(row, col, newRow, newCol) && !(newRow === oppRow && newCol === oppCol);
    }
    if (Math.abs(dRow) === 1 && Math.abs(dCol) === 1) {
      // Onto the opponent's cell vertically then sideways, or sideways then vertically.
      return (
        this.isCornerLegal(row, col, row + dRow, col, newRow, newCol, oppRow, oppCol) ||
        this.isCornerLegal(row, col, row, col + dCol, newRow, newCol, oppRow, oppCol)
      );
    }
    if ((Math.abs(dRow) === 2 && dCol === 0) || (dRow === 0 && Math.abs(dCol) === 2)) {
      const midRow = row + dRow / 2;
      const midCol = col + dCol / 2;
      return (
        midRow === oppRow &&
        midCol === oppCol &&
        this.isStepOpen(row, col, midRow, midCol) &&
        this.isStepOpen(midRow, midCol, newRow, newCol)
      );
    }
    return false;
  }

  /** A diagonal move through the opponent's cell (midRow, midCol); legal only if the straight jump is blocked. */
  private isCornerLegal(
    row: number,
    col: number,
    midRow: number,
    midCol: number,
    newRow: number,
    newCol: number,
    oppRow: number,
    oppCol: number,
  ): boolean {
    return (
      midRow === oppRow &&
      midCol === oppCol &&
      this.isStepOpen(row, col, midRow, midCol) &&
      this.isStepOpen(midRow, midCol, newRow, newCol) &&
      !this.isStepOpen(midRow, midCol, 2 * midRow - row, 2 * midCol - col)
    );
  }

  /**
   * Whether a wall at the GLOBAL anchor is on the board, neither overlaps nor
   * crosses a placed wall, and leaves both players a path to their goal.
   * Walls left are not checked.
   */
  private isWallLegal(row: number, col: number, orientation: Orientation): boolean {
    const grid = this.size - 1;
    if (row < 0 || row >= grid || col < 0 || col >= grid) return false;
    if (this.hasWall(row, col, HORIZONTAL) || this.hasWall(row, col, VERTICAL)) return false;
    if (orientation === HORIZONTAL) {
      if ((col > 0 && this.hasWall(row, col - 1, HORIZONTAL)) || (col < grid - 1 && this.hasWall(row, col + 1, HORIZONTAL))) {
        return false;
      }
    } else if ((row > 0 && this.hasWall(row - 1, col, VERTICAL)) || (row < grid - 1 && this.hasWall(row + 1, col, VERTICAL))) {
      return false;
    }
    // Hot path: a wall can only cut a path by closing a loop with the border
    // or other walls, which needs two of its three grid points to touch them.
    if (this.contactPoints(row, col, orientation) < 2) return true;
    const index = (row * grid + col) * 2 + orientation;
    this.walls[index] = 1;
    const connected = this.distance(this.row(0), this.col(0), 0) >= 0 && this.distance(this.row(1), this.col(1), this.size - 1) >= 0;
    this.walls[index] = 0;
    return connected;
  }

  /** How many of a wall's three grid points lie on the border or on a placed wall. */
  private contactPoints(row: number, col: number, orientation: Orientation): number {
    let count = 0;
    for (let i = 0; i < 3; i++) {
      const touches =
        orientation === HORIZONTAL ? this.pointTouchesObstacle(row + 1, col + i) : this.pointTouchesObstacle(row + i, col + 1);
      if (touches) count++;
    }
    return count;
  }

  /**
   * Whether grid point (pointRow, pointCol), one of the (size + 1)^2 cell
   * corners, is on the border or on a placed wall. A horizontal wall at
   * anchor (a, b) covers points (a + 1, b..b + 2); a vertical wall covers
   * points (a..a + 2, b + 1).
   */
  private pointTouchesObstacle(pointRow: number, pointCol: number): boolean {
    const size = this.size;
    if (pointRow === 0 || pointCol === 0 || pointRow === size || pointCol === size) return true;
    const grid = size - 1;
    const anchorRow = pointRow - 1;
    for (let b = Math.max(pointCol - 2, 0); b <= Math.min(pointCol, grid - 1); b++) {
      if (this.hasWall(anchorRow, b, HORIZONTAL)) return true;
    }
    const anchorCol = pointCol - 1;
    for (let a = Math.max(pointRow - 2, 0); a <= Math.min(pointRow, grid - 1); a++) {
      if (this.hasWall(a, anchorCol, VERTICAL)) return true;
    }
    return false;
  }

  /** Breadth-first distance in steps from (row, col) to `goalRow` through open steps; -1 if unreachable. */
  private distance(row: number, col: number, goalRow: number): number {
    const { queue, visited } = this.scratch;
    const size = this.size;
    if (row === goalRow) return 0;
    visited.fill(0);
    visited[row * size + col] = 1;
    queue[0] = row * size + col;
    let head = 0;
    let tail = 1;
    let level = 0;
    let levelEnd = 1;
    while (head < tail) {
      if (head === levelEnd) {
        level++;
        levelEnd = tail;
      }
      const cell = queue[head++]!;
      const r = Math.floor(cell / size);
      const c = cell % size;
      for (const [dr, dc] of STEPS) {
        const nr = r + dr;
        const nc = c + dc;
        if (nr < 0 || nr >= size || nc < 0 || nc >= size) continue;
        if (visited[nr * size + nc] || !this.isStepOpen(r, c, nr, nc)) continue;
        if (nr === goalRow) return level + 1;
        visited[nr * size + nc] = 1;
        queue[tail++] = nr * size + nc;
      }
    }
    return -1;
  }
}
