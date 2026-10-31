import type { Result } from "../engine/game";
import { type Players, samePlayer } from "./controller";
import type { FinishedGame } from "./history";

/** What the page knows about the game on the board when it ends. */
export interface EndedGame {
  readonly size: number;
  /** The seats at the end, which may differ from those the game began with. */
  readonly players: Players;
  readonly result: Result;
  readonly moves: readonly string[];
}

/**
 * Remembers who sat at the board when a game began and whether either seat was edited since, so a game is
 * listed with the bots that started it and one whose seats changed part-way is not credited to anyone.
 * Before the first move the seats are simply the current ones; a game that begins with moves already
 * played (an opening, a link) calls `begin`. It has no DOM.
 */
export class SeatWatch {
  private start: Players | null = null;
  private edited = false;

  /** The seats as the game began. */
  get seats(): Players | null {
    return this.start;
  }

  /** Whether a seat was edited after the game began. */
  get changed(): boolean {
    return this.edited;
  }

  /** The ended game as the history lists it: with the seats it began with (the ones at the end if none were seen), and whether one changed. */
  finished(game: EndedGame): FinishedGame {
    const seats = this.seats ?? game.players;
    return { size: game.size, p1: seats.p1, p2: seats.p2, winner: game.result.winner, reason: game.result.reason, moves: game.moves, seatChanged: this.changed };
  }

  /** A game began with these seats. */
  begin(players: Players): void {
    this.start = { ...players };
    this.edited = false;
  }

  /** Called after every change to the page with the seats now and the number of moves played. */
  observe(players: Players, moves: number): void {
    if (this.start === null || moves === 0) this.begin(players);
    else if (!samePlayer(players.p1, this.start.p1) || !samePlayer(players.p2, this.start.p2)) this.edited = true;
  }
}
