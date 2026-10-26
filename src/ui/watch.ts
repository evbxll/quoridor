import type { GlobalAction } from "../engine/actions";
import { maxPlies } from "../engine/constants";
import { Game, type Result } from "../engine/game";
import { parseMove } from "../engine/notation";
import type { GameState } from "../engine/state";
import type { SearchResponse } from "../ai/protocol";
import type { SearchPort, Side } from "./controller";
import { type Level, LEVELS } from "./levels";

/** The pause between one move and the next while a watched game runs, in milliseconds. */
export const SPEEDS = { slow: 1500, normal: 600, fast: 150, instant: 0 } as const;
export type Speed = keyof typeof SPEEDS;

/** How often a search the worker cancelled without being asked is tried again before it is reported. */
const RETRIES_AFTER_CANCEL = 2;
const SEED_RANGE = 2 ** 32;

/** Each bot's own reading of the position: player 1's expected score (0 to 1) from its latest search. */
export type Opinions = Readonly<Record<Side, number | null>>;

/** A search answer is from the view of the player to move; this is player 1's share. */
function p1ShareOf(mover: Side, response: SearchResponse): number {
  const moverShare = (response.value + 1) / 2;
  return mover === "p1" ? moverShare : 1 - moverShare;
}

/** A share from 0 to 1 as a whole percentage. */
export function toPercent(share: number): number {
  return Math.round(Math.min(1, Math.max(0, share)) * 100);
}

/**
 * What the eval bar's fill shows: the stronger bot's latest reading (a Strong
 * network outranks Normal's heuristic), or the average when both are equal.
 * Null before any search.
 */
export function barShare(opinions: Opinions, levels: Readonly<Record<Side, Level>>): number | null {
  const [a, b] = [opinions.p1, opinions.p2];
  if (a === null || b === null) return a ?? b;
  const [rankA, rankB] = [LEVELS.indexOf(levels.p1), LEVELS.indexOf(levels.p2)];
  return rankA === rankB ? (a + b) / 2 : rankA > rankB ? a : b;
}

/** The eval bar: the fill's percentage of player 1, and where each bot's own reading puts its marker. Null before any search. */
export function evalBar(watch: WatchController): { percent: number; label: string; marks: Readonly<Record<Side, number | null>> } | null {
  const result = watch.result;
  const final = result === null ? null : result.reason === "goal" ? (result.winner === "p1" ? 1 : 0) : 0.5;
  const share = final ?? barShare(watch.opinions, watch.levels);
  if (share === null) return null;
  const percent = toPercent(share);
  const mark = (side: Side): number | null => (watch.opinions[side] === null ? null : toPercent(watch.opinions[side]!));
  return { percent, label: `Player 1 ${percent}%, player 2 ${100 - percent}%`, marks: { p1: mark("p1"), p2: mark("p2") } };
}

/** A level in words, with what it searches with. */
export function describeLevel(level: Level): string {
  return `${level.label} (${level.engine === "network" ? "network" : "heuristic"}, ${level.simulations} searches)`;
}

/** The status line under the board in Watch mode. */
export function watchStatus(watch: WatchController): string {
  const moves = watch.moves;
  const last = moves.length > 0 ? `Player ${moves.length % 2 === 1 ? 1 : 2} played ${moves[moves.length - 1]}. ` : "";
  const result = watch.result;
  if (result) {
    if (result.reason === "repetition") return `${last}Draw by threefold repetition.`;
    if (result.reason === "cap") return `${last}Draw: the limit of ${maxPlies(watch.size)} moves was reached.`;
    return `${last}Player ${result.winner === "p1" ? 1 : 2} wins by reaching the goal row.`;
  }
  if (watch.error !== null) return `${last}A bot could not move (${watch.error}). Choose Start to try again.`;
  const next = watch.state.p1Turn ? 1 : 2;
  if (watch.thinking) return `${last}Player ${next} is thinking.`;
  return `${last}${watch.running ? `Player ${next} moves next.` : "Paused."}`;
}

/**
 * A game between two bots that the page watches: the moves are searched in the
 * worker one after another. It has no DOM; `onChange` is called after every
 * change. Pausing or restarting drops a search in flight, so a late answer
 * never reaches a game it was not asked for.
 */
export class WatchController {
  private game = new Game(7);
  private botLevels: Record<Side, Level> = { p1: LEVELS[1]!, p2: LEVELS[1]! };
  private targets: GlobalAction[] = [];
  private shares: Record<Side, number | null> = { p1: null, p2: null };
  private playing = false;
  private searching = false;
  private failure: string | null = null;
  private delayMs: number = SPEEDS.normal;
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** Counts restarts and pauses, so an answer to a search that was dropped is ignored. */
  private epoch = 0;

  constructor(
    private readonly port: SearchPort,
    private readonly onChange: () => void,
    private readonly random: () => number = Math.random,
  ) {}

  get size(): number {
    return this.game.size;
  }

  get levels(): Readonly<Record<Side, Level>> {
    return this.botLevels;
  }

  /** A copy of the current position. */
  get state(): GameState {
    return this.game.state;
  }

  get moves(): readonly string[] {
    return this.game.moves;
  }

  get result(): Result | null {
    return this.game.result;
  }

  /** Where the last move landed, or null before any move. */
  get lastMove(): GlobalAction | null {
    return this.targets[this.targets.length - 1] ?? null;
  }

  /** Each bot's reading from its latest search. */
  get opinions(): Opinions {
    return this.shares;
  }

  /** True while the game plays on by itself. */
  get running(): boolean {
    return this.playing;
  }

  /** True while a bot is choosing its move. */
  get thinking(): boolean {
    return this.searching;
  }

  /** Why a bot could not move, if it could not. */
  get error(): string | null {
    return this.failure;
  }

  /** Whether another move can be made: the game is not over. */
  get canMove(): boolean {
    return this.game.result === null;
  }

  /** Begins a new game, paused. */
  restart(size: number, levels: Readonly<Record<Side, Level>>): void {
    this.stop();
    this.game = new Game(size);
    this.botLevels = { ...levels };
    this.targets = [];
    this.shares = { p1: null, p2: null };
    this.failure = null;
    this.onChange();
  }

  /** Sets the level of one side from its next move. */
  setLevel(side: Side, level: Level): void {
    this.botLevels = { ...this.botLevels, [side]: level };
    this.onChange();
  }

  setSpeed(speed: Speed): void {
    this.delayMs = SPEEDS[speed];
    // A wait already under way is cut or stretched to the new speed.
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.wait();
    }
  }

  /** Plays on by itself until the game ends or `pause`. */
  start(): void {
    if (this.playing || !this.canMove) return;
    this.playing = true;
    this.failure = null;
    if (this.searching) this.onChange();
    else void this.turn();
  }

  /** Stops; a search in flight is dropped and made again on `start` or `step`. */
  pause(): void {
    this.stop();
    this.onChange();
  }

  /** Plays one move and stays paused. Does nothing while running or searching. */
  step(): void {
    if (this.playing || this.searching || !this.canMove) return;
    this.failure = null;
    void this.turn();
  }

  private stop(): void {
    this.epoch++;
    this.playing = false;
    if (this.searching) this.port.cancel();
    this.searching = false;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  private wait(): void {
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.turn();
    }, this.delayMs);
  }

  private async turn(): Promise<void> {
    const epoch = this.epoch;
    const mover: Side = this.game.state.p1Turn ? "p1" : "p2";
    const level = this.botLevels[mover];
    this.searching = true;
    this.onChange();
    try {
      let reply: SearchResponse | null = null;
      // A null answer that nobody asked for (the worker was reconfigured, say) is not a failure: ask again.
      for (let attempt = 0; attempt <= RETRIES_AFTER_CANCEL && reply === null; attempt++) {
        reply = await this.port.search({
          engine: level.engine,
          size: this.game.size,
          moves: this.game.moves,
          simulations: level.simulations,
          temperature: level.temperature,
          seed: Math.floor(this.random() * SEED_RANGE),
        });
        if (epoch !== this.epoch) return;
      }
      if (reply === null) throw new Error("The search was cancelled");
      const action = parseMove(this.game.state, reply.move);
      this.targets.push(this.game.state.globalAction(action));
      this.game.play(action);
      this.shares = { ...this.shares, [mover]: p1ShareOf(mover, reply) };
      if (!this.canMove) this.playing = false;
    } catch (error) {
      if (epoch !== this.epoch) return;
      this.failure = error instanceof Error ? error.message : String(error);
      this.playing = false;
    }
    this.searching = false;
    this.onChange();
    if (!this.playing || !this.canMove) return;
    if (this.delayMs === 0) void this.turn();
    else this.wait();
  }
}
