import { seededRandom } from "../ai/random";
import { NUM_PAWN_MOVES } from "../engine/constants";
import { Game } from "../engine/game";
import { formatAction } from "../engine/notation";
import { GameState } from "../engine/state";

/** How many plies a varied opening plays: two pawn moves for each side, so no walls and no early win. */
export const OPENING_PLIES = 4;

const pools = new Map<number, readonly (readonly string[])[]>();

/**
 * Every way to play `OPENING_PLIES` pawn moves from the start of a `size` board that ends in a position
 * no other way reaches and never returns to an earlier position, one sequence per position, in a fixed order.
 */
export function openingPool(size: number): readonly (readonly string[])[] {
  const known = pools.get(size);
  if (known !== undefined) return known;
  const found = new Map<string, string[]>();
  const walk = (state: GameState, moves: string[], seen: ReadonlySet<string>): void => {
    if (moves.length === OPENING_PLIES) {
      const key = state.positionKey();
      if (!found.has(key)) found.set(key, moves);
      return;
    }
    for (const action of state.legalActions()) {
      if (action >= NUM_PAWN_MOVES) continue;
      const next = state.clone();
      next.play(action);
      const key = next.positionKey();
      if (next.isEnd() || seen.has(key)) continue;
      walk(next, [...moves, formatAction(state, action)], new Set([...seen, key]));
    }
  };
  const start = GameState.initial(size);
  walk(start, [], new Set([start.positionKey()]));
  const pool = [...found.values()];
  pools.set(size, pool);
  return pool;
}

/**
 * The opening for game number `index` (from 0) of a run with this `seed`: the pool is shuffled by the
 * seed and read in turn, so openings differ from game to game until the pool is used up, and the same
 * seed always gives the same openings.
 */
export function openingFor(size: number, seed: number, index: number): readonly string[] {
  const order = openingPool(size).slice();
  const random = seededRandom(seed);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [order[i], order[j]] = [order[j]!, order[i]!];
  }
  return order[index % order.length]!;
}

/** A new game with the opening for game `index` already played, as real moves. */
export function openingGame(size: number, seed: number, index: number): Game {
  const game = new Game(size);
  for (const move of openingFor(size, seed, index)) game.playMove(move);
  return game;
}
