import { wallCount } from "../engine/constants";
import { HORIZONTAL, VERTICAL } from "../engine/actions";
import type { GameState } from "../engine/state";

/** Planes in the full network input: 6 basic and 4 path planes. */
export const INPUT_PLANES = 10;
/** Planes of a network that gets the basic planes only. */
export const BASIC_PLANES = 6;
/** The plane counts `encodeState` can produce: the basic planes are the first six of the ten, so a 6-plane model's input is a prefix. */
export const SUPPORTED_PLANES: readonly number[] = [BASIC_PLANES, INPUT_PLANES];
/** Distance-plane value for cells cut off from the goal row. */
const DISCONNECTED = 4;

/**
 * The network input for a position: float32 `[planes, N, N]` (10 by default) in the frame of the
 * player to move (for player 2 the board is rotated 180 degrees).
 *
 * Planes: 0 horizontal walls and 1 vertical walls (in the top-left
 * (N-1) x (N-1) corner); 2 the mover's pawn; 3 the opponent's pawn; 4 and 5
 * walls left as fractions of the starting walls (mover, opponent); 6 and 7
 * distance to the goal row divided by N (mover to row 0, opponent to row
 * N-1; 4 where cut off); 8 and 9 one on cells of some shortest path from the
 * pawn to the goal (mover, opponent). Pawns do not block paths. With `planes`
 * 6 only planes 0 to 5 are produced (the path planes are not computed).
 */
export function encodeState(state: GameState, planes: number = INPUT_PLANES): Float32Array {
  if (!SUPPORTED_PLANES.includes(planes)) throw new RangeError(`Cannot encode ${planes} planes; the site encodes ${SUPPORTED_PLANES.join(" or ")}`);
  const size = state.size;
  const cells = size * size;
  const frame = state.moverFrame();
  const out = new Float32Array(planes * cells);
  for (let r = 0; r < size - 1; r++) {
    for (let c = 0; c < size - 1; c++) {
      if (frame.hasWall(r, c, HORIZONTAL)) out[r * size + c] = 1;
      if (frame.hasWall(r, c, VERTICAL)) out[cells + r * size + c] = 1;
    }
  }
  const wallsAtStart = wallCount(size);
  for (const player of [0, 1] as const) {
    const pawn = frame.row(player) * size + frame.col(player);
    out[(2 + player) * cells + pawn] = 1;
    out.fill(frame.wallsLeft(player) / wallsAtStart, (4 + player) * cells, (5 + player) * cells);
    if (planes === BASIC_PLANES) continue;
    const goalRow = player === 0 ? 0 : size - 1;
    const toGoal = frame.distanceField(Array.from({ length: size }, (_, c) => goalRow * size + c));
    const fromPawn = frame.distanceField([pawn]);
    const total = toGoal[pawn]!;
    for (let cell = 0; cell < cells; cell++) {
      const distance = toGoal[cell]!;
      out[(6 + player) * cells + cell] = distance < 0 ? DISCONNECTED : distance / size;
      const onPath = fromPawn[cell]! >= 0 && distance >= 0 && fromPawn[cell]! + distance === total;
      if (onPath) out[(8 + player) * cells + cell] = 1;
    }
  }
  return out;
}
