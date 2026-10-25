import type { PlayerAction } from "./actions";
import { maxPlies } from "./constants";
import { formatAction, parseMove } from "./notation";
import { GameState } from "./state";

/** Occurrences of one position that make the game a draw. */
const REPETITIONS_FOR_DRAW = 3;

/** Largest board size a URL hash may ask for. */
const MAX_HASH_SIZE = 13;

export type Reason = "goal" | "repetition" | "cap";
export type Winner = "p1" | "p2" | "draw";
export interface Result {
  readonly winner: Winner;
  readonly reason: Reason;
}

/**
 * A game under our rules: standard Quoridor plus a draw on the third
 * occurrence of a position (the start counts) and a draw at `maxPlies`
 * plies unless the last move won.
 */
export class Game {
  readonly size: number;
  private readonly history: GameState[];
  private readonly moveNames: string[] = [];
  private readonly counts = new Map<string, number>();
  private outcome: Result | null = null;

  constructor(size: number) {
    this.size = size;
    this.history = [GameState.initial(size)];
    this.count(this.current.positionKey(), 1);
  }

  /** A copy of the current position; changing it does not affect the game. */
  get state(): GameState {
    return this.current.clone();
  }

  private get current(): GameState {
    return this.history[this.history.length - 1]!;
  }

  /** Moves played so far, in standard notation. */
  get moves(): readonly string[] {
    return this.moveNames.slice();
  }

  /** The result, or null while the game is on. */
  get result(): Result | null {
    return this.outcome;
  }

  /** Plays an action. Throws if the game is over or the action is illegal. */
  play(action: PlayerAction): void {
    if (this.outcome) throw new Error("The game is over");
    const before = this.current;
    const next = before.clone();
    next.play(action);
    this.moveNames.push(formatAction(before, action));
    this.history.push(next);
    const repeats = this.count(next.positionKey(), 1);
    if (next.isEnd()) this.outcome = { winner: next.winner() === 1 ? "p1" : "p2", reason: "goal" };
    else if (repeats >= REPETITIONS_FOR_DRAW) this.outcome = { winner: "draw", reason: "repetition" };
    else if (this.moveNames.length >= maxPlies(this.size)) this.outcome = { winner: "draw", reason: "cap" };
  }

  /** Plays a move given in standard notation. Throws if it is not legal. */
  playMove(text: string): void {
    this.play(parseMove(this.current, text));
  }

  /** Takes back the last `plies` moves (a whole number, default one). Throws if fewer were played. */
  undo(plies = 1): void {
    if (!Number.isInteger(plies) || plies < 1) throw new Error("plies must be a whole number of at least 1");
    if (plies > this.moveNames.length) throw new Error("Nothing to undo");
    for (let i = 0; i < plies; i++) {
      this.count(this.current.positionKey(), -1);
      this.history.pop();
      this.moveNames.pop();
      this.outcome = null;
    }
  }

  /** The game as a URL hash, `#n=9&m=e2.e8.d4h`. */
  toHash(): string {
    return `#n=${this.size}&m=${this.moveNames.join(".")}`;
  }

  /** Replays a hash made by `toHash`. Throws on a malformed hash or an illegal move. */
  static fromHash(hash: string): Game {
    const params = new URLSearchParams(hash.replace(/^#/, ""));
    if (params.getAll("n").length > 1 || params.getAll("m").length > 1) throw new Error("The hash repeats a parameter");
    const sizeText = params.get("n") ?? "";
    const size = /^[0-9]+$/.test(sizeText) ? Number(sizeText) : 0;
    if (size < 3 || size > MAX_HASH_SIZE) throw new Error("The hash has no valid board size");
    const game = new Game(size);
    const moves = params.get("m");
    for (const move of moves ? moves.split(".") : []) game.playMove(move);
    return game;
  }

  private count(key: string, delta: number): number {
    const total = (this.counts.get(key) ?? 0) + delta;
    this.counts.set(key, total);
    return total;
  }
}
