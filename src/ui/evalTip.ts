import { type Bot, botLabel } from "./bots";
import { type Player, type Side, HUMAN } from "./controller";

const NUMBER: Readonly<Record<Side, number>> = { p1: 1, p2: 2 };

const plural = (count: number, noun: string): string => `${count} ${noun}${count === 1 ? "" : "s"}`;

/** A bot in words for a blurb: "Strong, network, 32 simulations". */
export function botKind(bot: Bot): string {
  return `${botLabel(bot)}, ${bot.engine === "network" ? "network" : "heuristic"}, ${plural(bot.simulations, "simulation")}`;
}

/** A player 1 share in whole percent as both players' numbers: "41% for Player 2 (59% for Player 1)", the named side first. */
function bothWays(side: Side, p1Percent: number): string {
  const own = side === "p1" ? p1Percent : 100 - p1Percent;
  const other = 100 - own;
  return `${own}% for Player ${NUMBER[side]} (${other}% for Player ${NUMBER[side === "p1" ? "p2" : "p1"]})`;
}

/** What a bot's marker beside the eval bar says. */
export interface MarkerInput {
  readonly side: Side;
  /** Who holds the seat now. */
  readonly seat: Player;
  /** The marker's value: player 1's share in whole percent, from the bot's last search; null before it has searched. */
  readonly p1Percent: number | null;
  /** The number of the move that search chose, counting from 1; null when there is no reading. */
  readonly move: number | null;
  /** The position on the board is an earlier one, so the reading is the latest up to it. */
  readonly viewingPast: boolean;
}

/**
 * The blurb for a bot's marker. The marker's number is the bot's own value from
 * the root of its last search, which looked at the position before the move it
 * then played, so it is one ply older than the position the bar reads.
 */
export function markerBlurb(input: MarkerInput): string {
  const { side, seat, p1Percent, move, viewingPast } = input;
  const who = `Player ${NUMBER[side]}`;
  if (p1Percent === null || move === null) {
    return seat === HUMAN ? `No reading: ${who} is a person, not a bot.` : `No reading yet: ${who} has not searched.`;
  }
  const rated = `rated the position at ${bothWays(side, p1Percent)} when it searched for its move ${move}, before playing it`;
  const upTo = viewingPast ? " (the latest search up to the position you are viewing)" : "";
  if (seat === HUMAN) return `Before a person took over ${who}, its bot ${rated}${upTo}.`;
  return `${who} (${botKind(seat)}) ${rated}${upTo}.`;
}

/** What the eval bar itself says. */
export interface BarInput {
  /** Player 1's share in whole percent; null when there is nothing to show. */
  readonly percent: number | null;
  /** The percentage is an earlier position's, kept while this one is read. */
  readonly stale: boolean;
  /** The network is not ready, so no reading is coming. */
  readonly unavailable: boolean;
  /** The reading failed. */
  readonly failed: boolean;
  /** Moves played before the position the bar reads (0 is the start). */
  readonly ply: number;
  /** Moves played in the game, so a reading of the latest position can be said so. */
  readonly moves: number;
  /** Simulations of the analysis search. */
  readonly simulations: number;
}

function positionName(ply: number, moves: number): string {
  if (ply === 0) return moves === 0 ? "the starting position" : "the starting position (before move 1)";
  return ply === moves ? `the current position (after move ${ply})` : `the position after move ${ply}`;
}

/**
 * The blurb for the eval bar and its percentages. The bar is the Analysis
 * search: the network reads the position on the board with its own search,
 * apart from the searches the players make for their moves.
 */
export function barBlurb(input: BarInput): string {
  const { percent, stale, unavailable, failed, ply, moves, simulations } = input;
  const where = positionName(ply, moves);
  if (unavailable) return "No network reading: the network is not ready.";
  if (percent === null) return failed ? `No network reading for ${where}: the search failed.` : `No network reading yet: the network is reading ${where}.`;
  const numbers = `${percent}% for Player 1, ${100 - percent}% for Player 2`;
  if (stale) {
    const reason = failed ? "could not read" : "is reading";
    return `Network reading (Analysis) of the previous position: ${numbers}. It ${reason} ${where}.`;
  }
  return `Network reading (Analysis) of ${where}: ${numbers}. Made by the analysis search with the network (${plural(simulations, "simulation")}), apart from the players' own searches.`;
}
