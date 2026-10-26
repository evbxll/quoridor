import type { GlobalAction, PlayerAction } from "../engine/actions";
import { Game, type Result } from "../engine/game";
import { parseMove } from "../engine/notation";
import { GameState } from "../engine/state";
import type { SearchResponse } from "../ai/protocol";
import type { SearchParams } from "../ai/searchClient";
import { LEVELS, type Level } from "./levels";

/** The part of the search client the game flow uses. */
export interface SearchPort {
  search(params: SearchParams): Promise<SearchResponse | null>;
  cancel(): void;
}

export type Side = "p1" | "p2";

/** The board sizes the site offers. */
export const BOARD_SIZES = [5, 7, 9, 11] as const;

/** Where each of `moves` landed on the board, in order. */
function replayTargets(size: number, moves: readonly string[]): GlobalAction[] {
  const state = GameState.initial(size);
  return moves.map((move) => {
    const action = parseMove(state, move);
    const target = state.globalAction(action);
    state.play(action);
    return target;
  });
}

/** How often a search the worker cancelled without being asked is tried again before it is reported. */
const RETRIES_AFTER_CANCEL = 2;

/** Seeds for the bot's sampling are drawn from this range. */
const SEED_RANGE = 2 ** 32;

/**
 * One game of a person against the bot: whose turn it is, the bot's reply
 * (searched in the worker), undo, and what the page needs to show. It has no
 * DOM; `onChange` is called after every change.
 */
export class GameController {
  private game = new Game(9);
  private humanSide: Side = "p1";
  private currentLevel: Level = LEVELS[1]!;
  /** Where each move so far landed, kept so the board need not replay the game to show the last one. */
  private targets: GlobalAction[] = [];
  private searching = false;
  private failure: string | null = null;
  /** Counts games and takebacks, so a reply to a position that no longer exists is dropped. */
  private epoch = 0;

  constructor(
    private readonly port: SearchPort,
    private readonly onChange: () => void,
    private readonly random: () => number = Math.random,
  ) {}

  get size(): number {
    return this.game.size;
  }

  get human(): Side {
    return this.humanSide;
  }

  get level(): Level {
    return this.currentLevel;
  }

  /** A copy of the current position. */
  get state(): GameState {
    return this.game.state;
  }

  /** Moves so far, in standard notation. */
  get moves(): readonly string[] {
    return this.game.moves;
  }

  get result(): Result | null {
    return this.game.result;
  }

  /** True while the bot is choosing its move. */
  get thinking(): boolean {
    return this.searching;
  }

  /** Why the bot could not move, if it could not. */
  get error(): string | null {
    return this.failure;
  }

  /** Where the last move landed, or null before any move. */
  get lastMove(): GlobalAction | null {
    return this.targets[this.targets.length - 1] ?? null;
  }

  /** The game as a URL hash. */
  get hash(): string {
    return this.game.toHash();
  }

  /** Whether the person may move now. */
  get humanToMove(): boolean {
    return this.game.result === null && !this.searching && this.failure === null && this.state.p1Turn === (this.humanSide === "p1");
  }

  /** Whether there is a move of the person's to take back. */
  get canUndo(): boolean {
    return this.lastHumanPly() !== null;
  }

  /** Starts a game; the bot moves first when the person plays second. Throws for a size the site does not offer. */
  newGame(size: number, human: Side, level: Level): void {
    if (!BOARD_SIZES.some((offered) => offered === size)) throw new RangeError(`The site has no ${size}x${size} board`);
    this.reset(new Game(size), human, level);
  }

  /** Continues a game made elsewhere (a link): the person plays the side to move, or player 1 if it is over. Throws for a size the site does not offer. */
  load(game: Game, level: Level): void {
    if (!BOARD_SIZES.some((offered) => offered === game.size)) throw new RangeError(`The site has no ${game.size}x${game.size} board`);
    this.reset(game, game.result === null && !game.state.p1Turn ? "p2" : "p1", level);
  }

  /** Sets the level for the bot's next move. */
  setLevel(level: Level): void {
    this.currentLevel = level;
    this.onChange();
  }

  /** Plays the person's move. Returns false (and does nothing) when it is not their turn. */
  playHuman(action: PlayerAction): boolean {
    if (!this.humanToMove) return false;
    this.targets.push(this.state.globalAction(action));
    this.game.play(action);
    this.failure = null;
    this.notifyOrSearch();
    return true;
  }

  /** Takes back the person's last move and everything after it, cancelling a search in flight. */
  undo(): void {
    const ply = this.lastHumanPly();
    if (ply === null) return;
    this.stopSearch();
    this.game.undo(this.game.moves.length - ply);
    this.targets.length = ply;
    this.failure = null;
    this.onChange();
  }

  /** Stops the bot's search so the shared worker is free (Watch mode); `retry` picks the game up again. */
  halt(): void {
    this.stopSearch();
    this.onChange();
  }

  /** Asks the bot for its move again after a failure. */
  retry(): void {
    this.failure = null;
    this.notifyOrSearch();
  }

  private reset(game: Game, human: Side, level: Level): void {
    this.stopSearch();
    this.game = game;
    this.targets = replayTargets(game.size, game.moves);
    this.humanSide = human;
    this.currentLevel = level;
    this.failure = null;
    this.notifyOrSearch();
  }

  private stopSearch(): void {
    this.epoch++;
    if (this.searching) this.port.cancel();
    this.searching = false;
  }

  /** Index of the person's latest move, or null if they have made none. */
  private lastHumanPly(): number | null {
    const parity = this.humanSide === "p1" ? 0 : 1;
    for (let ply = this.game.moves.length - 1; ply >= 0; ply--) if (ply % 2 === parity) return ply;
    return null;
  }

  /** Starts the bot's move if it is due, else just reports the change. Either way there is one notice, sent once `thinking` is up to date. */
  private notifyOrSearch(): void {
    if (this.game.result === null && this.state.p1Turn === (this.humanSide === "p2")) void this.botMove();
    else this.onChange();
  }

  private async botMove(): Promise<void> {
    const epoch = ++this.epoch;
    const level = this.currentLevel;
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
      this.targets.push(this.state.globalAction(action));
      this.game.play(action);
    } catch (error) {
      if (epoch !== this.epoch) return;
      this.failure = error instanceof Error ? error.message : String(error);
    }
    this.searching = false;
    this.onChange();
  }
}
