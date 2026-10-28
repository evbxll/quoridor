import type { GlobalAction, PlayerAction } from "../engine/actions";
import { Game, type Result } from "../engine/game";
import { parseMove } from "../engine/notation";
import { GameState } from "../engine/state";
import type { SearchResponse } from "../ai/protocol";
import type { SearchParams } from "../ai/searchClient";
import { type Bot, botOf, capFor, sameBot, temperatureOf } from "./bots";

/** The part of the search client the game flow uses. */
export interface SearchPort {
  search(params: SearchParams): Promise<SearchResponse | null>;
  cancel(): void;
}

export type Side = "p1" | "p2";

/** A seat at the board: a person, or a bot with its settings. */
export const HUMAN = "human";
export type Player = Bot | typeof HUMAN;

/** Whether two seats hold the same player (a person, or bots with the same settings). */
export const samePlayer = (a: Player, b: Player): boolean => (a === HUMAN || b === HUMAN ? a === b : sameBot(a, b));
export type Players = Readonly<Record<Side, Player>>;

/** The board sizes the site offers. */
export const BOARD_SIZES = [5, 7, 9, 11] as const;

/** Whether the site offers a board of this size (a link can name others, which the engine reads but the page does not play). */
export const isOfferedSize = (size: number): boolean => BOARD_SIZES.some((offered) => offered === size);

/** The pause between one move and the next while two bots play, in milliseconds. */
export const SPEEDS = { slow: 1500, normal: 600, fast: 150, instant: 0 } as const;
export type Speed = keyof typeof SPEEDS;

/** Each bot's own reading of the position at its latest move: player 1's expected score, 0 to 1. */
export type Opinions = Readonly<Record<Side, number | null>>;

/** Where a bot's reading came from: the move its search chose (from 1) and the bot, as it was then. */
export interface OpinionSource {
  readonly move: number;
  readonly bot: Bot;
}

/** A bot's value for the position it searched (player 1's share), kept with the bot that made it, since seats can change hands. */
interface Reading {
  readonly share: number;
  readonly bot: Bot;
}

export const sideOf = (ply: number): Side => (ply % 2 === 0 ? "p1" : "p2");

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

/** A search answer is from the view of the player to move; this is player 1's share. */
function p1ShareOf(mover: Side, response: SearchResponse): number {
  const moverShare = (response.value + 1) / 2;
  return mover === "p1" ? moverShare : 1 - moverShare;
}

/** How long a bot's move took on this device, and what it played with. */
export interface MoveTime {
  readonly ms: number;
  readonly bot: Bot;
  readonly size: number;
}

/** How often a search the worker cancelled without being asked is tried again before it is reported. */
const RETRIES_AFTER_CANCEL = 2;

/** Seeds for the bot's sampling are drawn from this range. */
const SEED_RANGE = 2 ** 32;

/**
 * One game with a player in each seat, a person or a bot. With a person in
 * either seat a bot replies as soon as it is its turn; between two bots the
 * game plays on only after `start` (or one move per `step`). A bot whose engine
 * needs the network waits for `setNetworkReady(true)`. It has no DOM;
 * `onChange` is called after every change.
 */
export class GameController {
  private game = new Game(9);
  private seats: Record<Side, Player> = { p1: HUMAN, p2: botOf("normal") };
  /** How long each side's latest bot move took by the page's clock, with the settings and board it was made with. */
  private durations: Record<Side, MoveTime | null> = { p1: null, p2: null };
  /** Where each move so far landed, kept so the board need not replay the game to show the last one. */
  private targets: GlobalAction[] = [];
  /** Per move, the reading of the bot that made it (player 1's share), or null for a person's move. */
  private readings: (Reading | null)[] = [];
  private searching = false;
  private failure: string | null = null;
  private playing = false;
  private network = false;
  private delayMs: number = SPEEDS.normal;
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** Counts searches, games, takebacks and pauses, so a reply to a position that no longer exists is dropped. */
  private epoch = 0;

  constructor(
    private readonly port: SearchPort,
    private readonly onChange: () => void,
    private readonly random: () => number = Math.random,
    private readonly clock: () => number = () => performance.now(),
  ) {}

  /** How long the latest move of a bot on `side` took here (search and reply), or null before it has moved this game. */
  moveTime(side: Side): MoveTime | null {
    return this.durations[side];
  }

  get size(): number {
    return this.game.size;
  }

  get players(): Players {
    return this.seats;
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

  /** The side whose turn it is. */
  get mover(): Side {
    return sideOf(this.game.moves.length);
  }

  /** Whether a person plays either side; if not, two bots play and `start`, `pause` and `step` drive the game. */
  get hasHuman(): boolean {
    return this.seats.p1 === HUMAN || this.seats.p2 === HUMAN;
  }

  /** True while a bot is choosing its move. */
  get thinking(): boolean {
    return this.searching;
  }

  /** Why the bot could not move, if it could not. */
  get error(): string | null {
    return this.failure;
  }

  /** True while two bots play on by themselves. */
  get running(): boolean {
    return this.playing;
  }

  /** A bot is due to move but its engine needs the network, which is not ready. */
  get waiting(): boolean {
    const seat = this.seats[this.mover];
    return seat !== HUMAN && seat.engine === "network" && !this.network && this.due();
  }

  /** Where the last move landed, or null before any move. */
  get lastMove(): GlobalAction | null {
    return this.targets[this.targets.length - 1] ?? null;
  }

  /** The game as a URL hash. */
  get hash(): string {
    return this.game.toHash();
  }

  /** Whether a person may move now. */
  get humanToMove(): boolean {
    return this.game.result === null && !this.searching && this.failure === null && this.seats[this.mover] === HUMAN;
  }

  /** Whether there is a move of a person's to take back. */
  get canUndo(): boolean {
    return this.lastHumanPly() !== null;
  }

  /** Whether `step` would play a move: two bots, paused, and the game is not over. */
  get canStep(): boolean {
    const seat = this.seats[this.mover];
    return !this.hasHuman && !this.playing && !this.searching && this.game.result === null && seat !== HUMAN && (seat.engine !== "network" || this.network);
  }

  /** Each bot's reading at its latest move among the first `ply` moves (all of them by default). */
  opinions(ply = this.readings.length): Opinions {
    return { p1: this.latestReading("p1", ply)?.reading.share ?? null, p2: this.latestReading("p2", ply)?.reading.share ?? null };
  }

  /** The number (from 1) of the move each reading in `opinions` was made for, and the bot that made it (who held the seat then, not now). */
  opinionSources(ply = this.readings.length): Readonly<Record<Side, OpinionSource | null>> {
    const source = (side: Side): OpinionSource | null => {
      const found = this.latestReading(side, ply);
      return found === null ? null : { move: found.index + 1, bot: found.reading.bot };
    };
    return { p1: source("p1"), p2: source("p2") };
  }

  private latestReading(side: Side, ply: number): { index: number; reading: Reading } | null {
    for (let i = Math.min(ply, this.readings.length) - 1; i >= 0; i--) if (sideOf(i) === side && this.readings[i] !== null) return { index: i, reading: this.readings[i]! };
    return null;
  }

  /** Starts a game; a bot that moves first starts at once if a person plays. Throws for a size the site does not offer. */
  newGame(size: number, players: Players): void {
    if (!isOfferedSize(size)) throw new RangeError(`The site has no ${size}x${size} board`);
    this.reset(new Game(size), players);
  }

  /** Continues a game made elsewhere (a link). Throws for a size the site does not offer. */
  load(game: Game, players: Players): void {
    if (!isOfferedSize(game.size)) throw new RangeError(`The site has no ${game.size}x${game.size} board`);
    this.reset(game, players);
  }

  /**
   * Changes who plays in the game under way, at once. A search for the side to
   * move is dropped (its late answer ignored) when that seat's player changed,
   * and made again by the new one; a bot that gave its seat to a person never
   * moves. When the last person leaves, the two bots wait for `start`; when a
   * person joins, the run of two bots ends.
   */
  setPlayers(players: Players): void {
    const hadHuman = this.hasHuman;
    // With two bots and no run, a search in flight is a step; if its seat changes the step is made again by the new player.
    const stepping = this.searching && !this.playing && !hadHuman;
    const dropped = !samePlayer(players[this.mover], this.seats[this.mover]);
    if (dropped) this.dropSearch();
    this.seats = { ...players };
    if (hadHuman && !this.hasHuman) this.stop();
    else if (this.hasHuman) this.playing = false;
    this.advance(stepping && dropped && !this.hasHuman);
  }

  /** Tells the controller whether the network can search; a bot that waited for it moves now. */
  setNetworkReady(ready: boolean): void {
    if (ready === this.network) return;
    this.network = ready;
    if (this.searching) this.onChange();
    else this.advance();
  }

  setSpeed(speed: Speed): void {
    this.delayMs = SPEEDS[speed];
    // A wait already under way is cut or stretched to the new speed.
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.wait();
    }
  }

  /** Lets two bots play on by themselves until the game ends or `pause`. */
  start(): void {
    if (this.hasHuman || this.playing || this.game.result !== null) return;
    this.playing = true;
    this.failure = null;
    if (this.searching) this.onChange();
    else this.advance();
  }

  /** Stops two bots; a search in flight is dropped and made again on `start` or `step`. */
  pause(): void {
    this.stop();
    this.onChange();
  }

  /** Plays one move of two paused bots. */
  step(): void {
    if (!this.canStep) return;
    this.failure = null;
    this.advance(true);
  }

  /** Plays a person's move. Returns false (and does nothing) when it is not a person's turn. */
  playHuman(action: PlayerAction): boolean {
    if (!this.humanToMove) return false;
    this.record(action, null);
    this.failure = null;
    this.advance();
    return true;
  }

  /** Takes back the last move of a person's and everything after it, cancelling a search in flight. */
  undo(): void {
    const ply = this.lastHumanPly();
    if (ply === null) return;
    this.stop();
    this.game.undo(this.game.moves.length - ply);
    this.targets.length = ply;
    this.readings.length = ply;
    this.failure = null;
    this.advance();
  }

  /** Asks the bot for its move again after a failure. */
  retry(): void {
    this.failure = null;
    // A failure stops two bots; asking again carries on the game they were playing.
    if (!this.hasHuman && this.game.result === null) this.playing = true;
    this.advance();
  }

  private reset(game: Game, players: Players): void {
    this.stop();
    this.game = game;
    this.targets = replayTargets(game.size, game.moves);
    this.readings = game.moves.map(() => null);
    this.durations = { p1: null, p2: null };
    this.seats = { ...players };
    this.failure = null;
    this.advance();
  }

  private record(action: PlayerAction, reading: Reading | null): void {
    this.targets.push(this.state.globalAction(action));
    this.readings.push(reading);
    this.game.play(action);
  }

  private stop(): void {
    this.playing = false;
    this.dropSearch();
  }

  /** Drops a search in flight, or the wait before the next one; its late answer is ignored. */
  private dropSearch(): void {
    this.epoch++;
    if (this.searching) this.port.cancel();
    this.searching = false;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  /** Index of a person's latest move, or null if no person has moved. */
  private lastHumanPly(): number | null {
    for (let ply = this.game.moves.length - 1; ply >= 0; ply--) if (this.seats[sideOf(ply)] === HUMAN) return ply;
    return null;
  }

  /** A bot is to move and nothing holds it back but, perhaps, the network. A pending pause between two bots' moves holds it back. */
  private due(): boolean {
    return (
      this.game.result === null &&
      this.failure === null &&
      !this.searching &&
      this.timer === null &&
      this.seats[this.mover] !== HUMAN &&
      (this.hasHuman || this.playing)
    );
  }

  /** Starts the bot's move if it is due and can search, else just reports the change. Either way there is one notice. */
  private advance(stepping = false): void {
    const seat = this.seats[this.mover];
    const due = this.due() || (stepping && this.game.result === null && seat !== HUMAN);
    if (due && seat !== HUMAN && (seat.engine !== "network" || this.network)) void this.botMove(seat);
    else this.onChange();
  }

  private wait(): void {
    this.timer = setTimeout(() => {
      this.timer = null;
      this.advance();
    }, this.delayMs);
  }

  private async botMove(bot: Bot): Promise<void> {
    const epoch = ++this.epoch;
    const mover = this.mover;
    this.searching = true;
    const started = this.clock();
    this.onChange();
    try {
      let reply: SearchResponse | null = null;
      // A null answer that nobody asked for (the worker was reconfigured, say) is not a failure: ask again.
      for (let attempt = 0; attempt <= RETRIES_AFTER_CANCEL && reply === null; attempt++) {
        reply = await this.port.search({
          engine: bot.engine,
          size: this.game.size,
          moves: this.game.moves,
          // The seat form fits a bot to its board size, but a link or a seat set elsewhere may not have: the cap holds here.
          simulations: Math.min(bot.simulations, capFor(bot.engine, this.game.size)),
          temperature: temperatureOf(bot),
          seed: Math.floor(this.random() * SEED_RANGE),
        });
        if (epoch !== this.epoch) return;
      }
      if (reply === null) throw new Error("The search was cancelled");
      this.durations[mover] = { ms: this.clock() - started, bot, size: this.game.size };
      this.record(parseMove(this.game.state, reply.move), { share: p1ShareOf(mover, reply), bot: { ...bot } });
    } catch (error) {
      if (epoch !== this.epoch) return;
      this.failure = error instanceof Error ? error.message : String(error);
      this.playing = false;
    }
    this.searching = false;
    if (this.game.result !== null) this.playing = false;
    if (this.playing && this.delayMs > 0) {
      this.onChange();
      this.wait();
    } else this.advance();
  }
}
