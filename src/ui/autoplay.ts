import { Game, type Result } from "../engine/game";
import { openingGame } from "./openings";
import type { Players } from "./controller";

/** Seconds between the end of a game and the start of the next. */
export const COUNTDOWN_SECONDS = 3;
/** Most games one run plays. A fixed cap keeps the control simple; a run that long is a benchmark, which the bench script is for. */
export const MAX_AUTO_GAMES = 100;

/** What auto-play needs of the page: the game on the board, and a way to put a new one there and start it. */
export interface AutoHost {
  readonly size: number;
  readonly players: Players;
  readonly hasHuman: boolean;
  readonly running: boolean;
  readonly result: Result | null;
  readonly moves: readonly string[];
  /** Puts a game on the board with these seats (the seat controls follow). */
  load(game: Game, players: Players): void;
  /** Lets the two bots play on. */
  start(): void;
}

/** Calls `fn` after `ms` milliseconds; the returned function cancels it. */
export type Schedule = (fn: () => void, ms: number) => () => void;

export const timeout: Schedule = (fn, ms) => {
  const id = setTimeout(fn, ms);
  return () => clearTimeout(id);
};

const flipped = (players: Players): Players => ({ p1: players.p2, p2: players.p1 });

/**
 * Plays game after game between two bots: when a game ends it counts down, then starts the next with the
 * same board size and bots, the sides swapped and a varied opening if those are on. It stops on Pause, on
 * Cancel, when the box is unticked, when a person takes a seat, and after `MAX_AUTO_GAMES`. It has no DOM.
 */
export class AutoPlay {
  /** The viewer's choices: the checkbox, and its two options. */
  enabled = false;
  swapSides = true;
  variedOpenings = true;

  private running = false;
  private seconds: number | null = null;
  private note = "";
  private spoken: string | null = null;
  private played = 0;
  private opened = 0;
  private seed = 0;
  private handled = false;
  private cancelTimer: (() => void) | null = null;

  constructor(
    private readonly host: AutoHost,
    private readonly random: () => number,
    private readonly onChange: () => void,
    private readonly schedule: Schedule = timeout,
  ) {}

  /** Seconds left before the next game, or null when none is due. */
  get countdown(): number | null {
    return this.seconds;
  }

  /** Whether a run is on: games follow one another until it stops. */
  get active(): boolean {
    return this.running;
  }

  /** Why the last run stopped, or what is happening, for the line under the options; empty when there is nothing to say. */
  get message(): string {
    return this.seconds !== null ? `Next game in ${this.seconds} s` : this.note;
  }

  /** A sentence for the page to say aloud, once, or null. */
  takeAnnouncement(): string | null {
    const text = this.spoken;
    this.spoken = null;
    return text;
  }

  /** The checkbox changed. Ticking it during a game that two bots are playing makes the run begin; unticking ends it. */
  setEnabled(on: boolean): void {
    this.enabled = on;
    if (!on) this.stop("");
    else if (this.host.running && !this.host.hasHuman) this.begin();
    this.onChange();
  }

  /**
   * Start or Resume was pressed. With the box ticked the run begins (a fresh game gets its varied opening);
   * either way the bots play on.
   */
  start(): void {
    this.note = "";
    if (this.enabled && !this.host.hasHuman && this.host.result === null) {
      this.begin();
      if (this.host.moves.length === 0 && this.variedOpenings) {
        this.host.load(this.nextGame(), this.host.players);
      }
    }
    this.host.start();
  }

  /** Pause was pressed: the run ends. */
  pause(): void {
    if (this.running) this.stop("Auto-play paused.");
  }

  /** Cancel was pressed during the countdown. */
  cancel(): void {
    this.stop("Auto-play cancelled.");
    this.onChange();
  }

  /** The viewer started another game or opened one by hand: the run ends without comment. */
  interrupt(): void {
    this.stop("");
  }

  /** Called after every change to the page: notices the end of a game, and a person taking a seat. */
  update(): void {
    if (this.host.result === null) {
      this.handled = false;
      if (this.seconds !== null) this.stop("");
    }
    if (!this.running) return;
    if (this.host.hasHuman) {
      this.stop("Auto-play stopped: a person plays a side.", true);
      return;
    }
    if (this.host.result === null || this.handled) return;
    this.handled = true;
    this.played++;
    if (this.played >= MAX_AUTO_GAMES) {
      this.stop(`Auto-play stopped after ${MAX_AUTO_GAMES} games.`, true);
      return;
    }
    this.seconds = COUNTDOWN_SECONDS;
    this.spoken = `Next game in ${COUNTDOWN_SECONDS} seconds. Choose Cancel to stop.`;
    this.tickLater();
  }

  private begin(): void {
    if (this.running) return;
    this.running = true;
    this.note = "";
    this.played = 0;
    this.opened = 0;
    this.seed = Math.floor(this.random() * 2 ** 32);
    this.handled = this.host.result !== null;
  }

  /** The next game of the run; the end of the game it follows has been dealt with. */
  private nextGame(): Game {
    this.handled = false;
    const index = this.opened++;
    return this.variedOpenings ? openingGame(this.host.size, this.seed, index) : new Game(this.host.size);
  }

  private stop(note: string, say = false): void {
    this.running = false;
    this.seconds = null;
    this.note = note;
    if (say) this.spoken = note;
    this.cancelTimer?.();
    this.cancelTimer = null;
  }

  private tickLater(): void {
    this.cancelTimer = this.schedule(() => {
      this.cancelTimer = null;
      if (this.seconds === null) return;
      this.seconds--;
      if (this.seconds > 0) {
        this.tickLater();
        this.onChange();
        return;
      }
      this.seconds = null;
      this.startNext();
    }, 1000);
  }

  private startNext(): void {
    const host = this.host;
    // Whatever happened in the last second, a game that is on or a person at the board is left alone.
    if (!this.running || host.hasHuman || host.running || host.result === null) {
      this.stop("");
      this.onChange();
      return;
    }
    host.load(this.nextGame(), this.swapSides ? flipped(host.players) : host.players);
    host.start();
  }
}
