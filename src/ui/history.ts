import type { Reason, Winner } from "../engine/game";
import { type Bot, botLabel, type EngineKind } from "./bots";
import { HUMAN, type Player } from "./controller";

/** Most games kept; the oldest is dropped first, and the tallies count the kept games only. */
export const MAX_GAMES = 200;
/** Most characters the saved history may take; more is cut from the oldest games (and never read back). */
export const MAX_SAVED_CHARS = 400_000;
/** The storage key; the number in it changes with the saved layout, so an old layout is left alone and ignored. */
export const HISTORY_KEY = "quoridor.history.v1";

/** The part of `localStorage` the history uses. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** Who sat in a seat: a person, or a bot with its settings. */
export type Seat = { readonly kind: "human" } | ({ readonly kind: "bot" } & Bot);

/** A finished game. */
export interface GameRecord {
  /** Counts games since the history was last cleared. */
  readonly id: number;
  readonly size: number;
  readonly p1: Seat;
  readonly p2: Seat;
  readonly winner: Winner;
  readonly reason: Reason;
  /** The moves in standard notation, joined by dots (the `m` of the link). */
  readonly moves: string;
}

/** What the page knows about a game when it ends. */
export interface FinishedGame {
  readonly size: number;
  readonly p1: Player;
  readonly p2: Player;
  readonly winner: Winner;
  readonly reason: Reason;
  readonly moves: readonly string[];
}

export const seatOf = (player: Player): Seat => (player === HUMAN ? { kind: "human" } : { kind: "bot", engine: player.engine, simulations: player.simulations, vary: player.vary });

/** A seat's identity: two seats with the same key are the same player for the tally. */
export const seatKey = (seat: Seat): string => (seat.kind === "human" ? "human" : `${seat.engine}:${seat.simulations}:${seat.vary ? "varied" : "fixed"}`);

/** A bot in words: "Strong (network, 32)", or "Beginner (heuristic, 5, varied)". */
export const botName = (bot: Bot): string => `${botLabel(bot)} (${bot.engine}, ${bot.simulations}${bot.vary ? ", varied" : ""})`;

/** The names of a game's two seats: a person is "You" against a bot, "Person" against another person. */
export function seatNames(record: Pick<GameRecord, "p1" | "p2">): { p1: string; p2: string } {
  const both = record.p1.kind === "human" && record.p2.kind === "human";
  const name = (seat: Seat): string => (seat.kind === "bot" ? botName(seat) : both ? "Person" : "You");
  return { p1: name(record.p1), p2: name(record.p2) };
}

/** The result in words, which the table shows as text and not by colour. */
export function resultText(winner: Winner, reason: Reason): string {
  if (winner === "p1") return "Player 1 wins";
  if (winner === "p2") return "Player 2 wins";
  return reason === "repetition" ? "Draw: repetition" : "Draw: move limit";
}

/** Whether both seats hold the same player (a bot with the same settings, or two people): such a game says nothing about either. */
export const isMirror = (record: Pick<GameRecord, "p1" | "p2">): boolean => seatKey(record.p1) === seatKey(record.p2);

/** One identity's record over the kept games. */
export interface Tally {
  readonly key: string;
  readonly name: string;
  readonly wins: number;
  readonly losses: number;
  readonly draws: number;
  /** Wins plus half the draws, as a share of the games played, from 0 to 1. */
  readonly score: number;
}

const ENGINES: readonly EngineKind[] = ["heuristic", "network"];
const WINNERS: readonly Winner[] = ["p1", "p2", "draw"];
const REASONS: readonly Reason[] = ["goal", "repetition", "cap"];

function readSeat(value: unknown): Seat | null {
  if (typeof value !== "object" || value === null) return null;
  const seat = value as Record<string, unknown>;
  if (seat["kind"] === "human") return { kind: "human" };
  const { engine, simulations, vary } = seat;
  if (seat["kind"] !== "bot" || !ENGINES.includes(engine as EngineKind) || typeof vary !== "boolean") return null;
  if (typeof simulations !== "number" || !Number.isInteger(simulations) || simulations < 1 || simulations > 100_000) return null;
  return { kind: "bot", engine: engine as EngineKind, simulations, vary };
}

/** A saved game if every field is as the page writes it, else null. */
function readRecord(value: unknown): GameRecord | null {
  if (typeof value !== "object" || value === null) return null;
  const row = value as Record<string, unknown>;
  const { id, size, winner, reason, moves } = row;
  const p1 = readSeat(row["p1"]);
  const p2 = readSeat(row["p2"]);
  if (p1 === null || p2 === null) return null;
  if (typeof id !== "number" || !Number.isInteger(id) || id < 1) return null;
  if (typeof size !== "number" || !Number.isInteger(size) || size < 3 || size > 13) return null;
  if (!WINNERS.includes(winner as Winner) || !REASONS.includes(reason as Reason)) return null;
  if ((winner === "draw") === (reason === "goal")) return null;
  if (typeof moves !== "string" || moves.length > 20_000 || !/^[a-z0-9]+(\.[a-z0-9]+)*$/.test(moves)) return null;
  return { id, size, p1, p2, winner: winner as Winner, reason: reason as Reason, moves };
}

/** The games finished this visit, newest last; kept in memory and, where the browser allows, saved. */
export class GameHistory {
  private list: GameRecord[] = [];
  private next = 1;

  /** `storage` is null where the browser gives none. Saved games are read at once; anything wrong with them is ignored. */
  constructor(private readonly storage: StorageLike | null = null) {
    this.load();
  }

  get games(): readonly GameRecord[] {
    return this.list;
  }

  /** Adds a finished game and drops the oldest ones beyond `MAX_GAMES`. */
  add(game: FinishedGame): GameRecord {
    const record: GameRecord = { id: this.next++, size: game.size, p1: seatOf(game.p1), p2: seatOf(game.p2), winner: game.winner, reason: game.reason, moves: game.moves.join(".") };
    this.list.push(record);
    if (this.list.length > MAX_GAMES) this.list.splice(0, this.list.length - MAX_GAMES);
    this.save();
    return record;
  }

  clear(): void {
    this.list = [];
    this.next = 1;
    try {
      this.storage?.removeItem(HISTORY_KEY);
    } catch {
      // Nothing was saved that could be shown again.
    }
  }

  /**
   * Each identity's wins, losses and draws over the kept games, the most games first. Mirror matches
   * (the same player in both seats) are left out: a win and a loss for one player says nothing.
   */
  tallies(): Tally[] {
    const totals = new Map<string, { name: string; wins: number; losses: number; draws: number }>();
    const count = (seat: Seat, outcome: "wins" | "losses" | "draws"): void => {
      const key = seatKey(seat);
      const entry = totals.get(key) ?? { name: seat.kind === "bot" ? botName(seat) : "You", wins: 0, losses: 0, draws: 0 };
      entry[outcome]++;
      totals.set(key, entry);
    };
    for (const game of this.list) {
      if (isMirror(game)) continue;
      count(game.p1, game.winner === "draw" ? "draws" : game.winner === "p1" ? "wins" : "losses");
      count(game.p2, game.winner === "draw" ? "draws" : game.winner === "p2" ? "wins" : "losses");
    }
    return [...totals.entries()]
      .map(([key, t]) => ({ key, ...t, score: (t.wins + t.draws / 2) / (t.wins + t.losses + t.draws) }))
      .sort((a, b) => b.wins + b.losses + b.draws - (a.wins + a.losses + a.draws) || a.name.localeCompare(b.name));
  }

  private load(): void {
    try {
      const text = this.storage?.getItem(HISTORY_KEY);
      if (typeof text !== "string" || text.length > MAX_SAVED_CHARS) return;
      const data: unknown = JSON.parse(text);
      if (typeof data !== "object" || data === null || (data as { v?: unknown }).v !== 1) return;
      const rows = (data as { games?: unknown }).games;
      if (!Array.isArray(rows)) return;
      const kept = rows.map(readRecord).filter((record): record is GameRecord => record !== null);
      this.list = kept.slice(-MAX_GAMES);
      this.next = this.list.reduce((high, record) => Math.max(high, record.id), 0) + 1;
    } catch {
      this.list = [];
    }
  }

  private save(): void {
    if (this.storage === null) return;
    try {
      let text = JSON.stringify({ v: 1, games: this.list });
      // Over the size limit the oldest games go, from the saved copy and the shown list alike, so a reload shows what was.
      while (text.length > MAX_SAVED_CHARS && this.list.length > 1) {
        this.list.shift();
        text = JSON.stringify({ v: 1, games: this.list });
      }
      this.storage.setItem(HISTORY_KEY, text);
    } catch {
      // Storage is full or blocked: the history then lasts for this visit only.
    }
  }
}
