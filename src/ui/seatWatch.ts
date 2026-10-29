import { type Players, samePlayer } from "./controller";

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
