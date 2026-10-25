import type { GlobalAction } from "../engine/actions";
import { parseMove } from "../engine/notation";
import { GameState } from "../engine/state";
import type { SearchResponse } from "../ai/protocol";
import type { GameController, SearchPort } from "./controller";
import { LEVELS } from "./levels";

/** Analysis searches with the network at the Strong budget (design doc section 8). */
export const ANALYSIS_SIMULATIONS = LEVELS.find((level) => level.id === "strong")!.simulations;

/** How many of the most visited moves are listed. */
const TOP_MOVES = 3;
const MAX_REMEMBERED = 300;

/** What the network thinks of one position. */
export interface Reading {
  /** Player 1's expected score, from 0 (player 2 wins) to 1 (player 1 wins). */
  readonly p1Share: number;
  /** The most visited moves with their share of the searches; empty for a finished position. */
  readonly lines: readonly { move: string; share: number }[];
}

export type AnalysisView =
  | { readonly status: "off" }
  | { readonly status: "unavailable" }
  | { readonly status: "searching" }
  | { readonly status: "ready"; readonly reading: Reading }
  | { readonly status: "failed"; readonly message: string };

/** The position after the first `ply` of `moves`, and where the last of them landed. */
export function replay(size: number, moves: readonly string[], ply: number): { state: GameState; last: GlobalAction | null } {
  const state = GameState.initial(size);
  let last: GlobalAction | null = null;
  for (const move of moves.slice(0, ply)) {
    const action = parseMove(state, move);
    last = state.globalAction(action);
    state.play(action);
  }
  return { state, last };
}

/** Turns a search answer, which is from the view of the player to move, into a reading. */
export function readingOf(state: GameState, response: SearchResponse): Reading {
  const mover = (response.value + 1) / 2;
  const total = response.visits.reduce((a, b) => a + b, 0);
  const ranked = response.moves
    .map((move, i) => ({ move, share: total > 0 ? response.visits[i]! / total : 0 }))
    .sort((a, b) => b.share - a.share)
    .slice(0, TOP_MOVES);
  return { p1Share: state.p1Turn ? mover : 1 - mover, lines: ranked.filter((line) => line.share > 0) };
}

/** The eval bar: drawn only for a ready reading in analysis mode, never in play. */
export function evalBar(view: AnalysisView): { percent: number; label: string } | null {
  if (view.status !== "ready") return null;
  const percent = Math.round(view.reading.p1Share * 100);
  return { percent, label: `Player 1 ${percent}%, player 2 ${100 - percent}%` };
}

/**
 * Analysis mode: step through the game's positions and ask the network what it
 * thinks of each. It searches only when the bot is not, because a new search
 * cancels the one in flight and the bot's move comes first.
 */
export class Analysis {
  private on = false;
  private viewed = 0;
  private following = true;
  private readonly readings = new Map<string, Reading>();
  private requested: string | null = null;
  /** Why the search of a position failed, by position; a failure belongs to its position only. */
  private readonly failures = new Map<string, string>();
  private spoken = "";
  private epoch = 0;

  constructor(
    private readonly controller: GameController,
    private readonly port: SearchPort,
    private readonly networkReady: () => boolean,
    private readonly onChange: () => void,
  ) {}

  get enabled(): boolean {
    return this.on;
  }

  /** The move number being viewed: 0 is the start, the number of moves played is the latest position. */
  get ply(): number {
    return this.viewed;
  }

  /** True while an earlier position than the latest is shown. */
  get viewingPast(): boolean {
    return this.on && this.viewed < this.controller.moves.length;
  }

  get view(): AnalysisView {
    if (!this.on) return { status: "off" };
    if (!this.networkReady()) return { status: "unavailable" };
    const key = this.key(this.viewed);
    const failure = this.failures.get(key);
    if (failure !== undefined) return { status: "failed", message: failure };
    const reading = this.readings.get(key);
    return reading ? { status: "ready", reading } : { status: "searching" };
  }

  setEnabled(on: boolean): void {
    this.on = on;
    this.viewed = this.controller.moves.length;
    this.following = true;
    this.failures.clear();
    this.update();
  }

  /** Shows the position after `ply` moves (kept within the game). Coming back to a position whose search failed tries it again. */
  goTo(ply: number): void {
    this.viewed = Math.min(Math.max(Math.trunc(ply), 0), this.controller.moves.length);
    this.following = this.viewed === this.controller.moves.length;
    this.failures.delete(this.key(this.viewed));
    this.update();
  }

  step(delta: number): void {
    this.goTo(this.viewed + delta);
  }

  /** The position being viewed in words: "the start", or "move 3 of 8 (e5)". */
  get where(): string {
    const moves = this.controller.moves;
    return this.viewed === 0 ? "the start" : `move ${this.viewed} of ${moves.length} (${moves[this.viewed - 1]})`;
  }

  /** What to say aloud about the reading on screen, once: null if it is not ready or was already said. */
  takeAnnouncement(): string | null {
    const bar = evalBar(this.view);
    const view = this.view;
    if (!bar || view.status !== "ready") return null;
    const said = `${this.key(this.viewed)}|${bar.percent}`;
    if (said === this.spoken) return null;
    this.spoken = said;
    const best = view.reading.lines.map((line) => line.move).join(", ");
    return `After ${this.where}: ${bar.label}.${best ? ` Best moves: ${best}.` : ""}`;
  }

  /** Starts over for a new game. */
  reset(): void {
    this.epoch++;
    this.readings.clear();
    this.requested = null;
    this.failures.clear();
    this.spoken = "";
    this.viewed = this.controller.moves.length;
    this.following = true;
  }

  /** Call after the game changed: keeps up with the latest position if that is where the view was. */
  update(): void {
    const length = this.controller.moves.length;
    this.viewed = this.following ? length : Math.min(this.viewed, length);
    this.following = this.viewed === length;
    this.onChange();
    this.request();
  }

  private key(ply: number): string {
    return `${this.controller.size}|${this.controller.moves.slice(0, ply).join(".")}`;
  }

  private request(): void {
    if (!this.on || !this.networkReady()) return;
    const key = this.key(this.viewed);
    if (this.readings.has(key) || this.requested === key) return;
    const { state } = replay(this.controller.size, this.controller.moves, this.viewed);
    if (state.isEnd() || (this.viewed === this.controller.moves.length && this.controller.result !== null)) {
      this.remember(key, { p1Share: state.isEnd() ? (state.winner() === 1 ? 1 : 0) : 0.5, lines: [] });
      this.onChange();
      return;
    }
    // The bot's search comes first; the end of its turn calls update() again.
    if (this.controller.thinking) return;
    const epoch = this.epoch;
    this.requested = key;
    this.port
      .search({
        engine: "network",
        size: this.controller.size,
        moves: this.controller.moves.slice(0, this.viewed),
        simulations: ANALYSIS_SIMULATIONS,
        temperature: 0,
        seed: 0,
        // A fresh tree, so the reading comes from exactly these simulations and the game's tree is left alone.
        reuseTree: false,
      })
      .then((response) => {
        if (epoch !== this.epoch) return;
        if (response) this.remember(key, readingOf(state, response));
      })
      .catch((error: unknown) => {
        if (epoch === this.epoch) this.failures.set(key, error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (epoch !== this.epoch) return;
        if (this.requested === key) this.requested = null;
        this.onChange();
      });
  }

  private remember(key: string, reading: Reading): void {
    if (this.readings.size >= MAX_REMEMBERED) this.readings.delete(this.readings.keys().next().value as string);
    this.readings.set(key, reading);
  }
}
