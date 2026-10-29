import { element } from "./dom";
import { type GameHistory, resultText, seatNames } from "./history";

/** How long "Clear history" waits for its second press, in milliseconds. */
const ARMED_MS = 5000;

const cell = (tag: "td" | "th", text: string, scope?: "row" | "col"): HTMLTableCellElement => {
  const node = document.createElement(tag);
  node.textContent = text;
  if (scope !== undefined) node.scope = scope;
  return node;
};

const percent = (share: number): string => `${Math.round(share * 100)}%`;

/** The "Games" card: the tally per player, then a table of the games finished this visit. Shown once there is one. Built with text nodes only. */
export class GamesCard {
  private readonly card = element("games", HTMLElement);
  private readonly tally = element("games-tally", HTMLUListElement);
  private readonly body = element("games-rows", HTMLTableSectionElement);
  private readonly scroller = element("games-scroll", HTMLElement);
  private readonly clearButton = element("games-clear", HTMLButtonElement);
  private drawn = "";
  private armed = false;
  private disarm: ReturnType<typeof setTimeout> | null = null;

  /** `cleared` is called after the history was cleared, so the page can put the keyboard somewhere that still exists. */
  constructor(
    private readonly history: GameHistory,
    private readonly announce: (text: string) => void,
    private readonly cleared: () => void,
  ) {
    this.clearButton.addEventListener("click", () => this.press());
    this.clearButton.addEventListener("blur", () => this.setArmed(false));
  }

  /** Redraws if the games changed. Safe to call after every change to the page. */
  draw(): void {
    const games = this.history.games;
    this.card.hidden = games.length === 0;
    const last = games[games.length - 1];
    const signature = `${games.length}|${last?.id ?? 0}`;
    if (signature === this.drawn) return;
    this.drawn = signature;
    this.tally.replaceChildren(
      ...this.history.tallies().map((t) => {
        const item = document.createElement("li");
        item.textContent = `${t.name}: ${t.wins} won, ${t.losses} lost, ${t.draws} drawn (score ${percent(t.score)})`;
        return item;
      }),
    );
    this.body.replaceChildren(
      ...games.map((game) => {
        const names = seatNames(game);
        const row = document.createElement("tr");
        const link = document.createElement("a");
        link.href = `#n=${game.size}&m=${game.moves}`;
        link.textContent = "Open";
        link.setAttribute("aria-label", `Open game ${game.id}, on a ${game.size} by ${game.size} board`);
        const open = document.createElement("td");
        open.append(link);
        row.append(cell("th", String(game.id), "row"), cell("td", names.p1), cell("td", names.p2), cell("td", resultText(game.winner, game.reason)), cell("td", String(game.moves.split(".").length)), open);
        return row;
      }),
    );
    // The newest game is in view.
    this.scroller.scrollTop = this.scroller.scrollHeight;
  }

  private press(): void {
    if (!this.armed) {
      this.setArmed(true);
      this.announce("Press Clear history again to delete the list of games.");
      return;
    }
    this.setArmed(false);
    this.history.clear();
    this.draw();
    this.announce("History cleared.");
    this.cleared();
  }

  private setArmed(on: boolean): void {
    this.armed = on;
    if (this.disarm !== null) clearTimeout(this.disarm);
    this.disarm = on ? setTimeout(() => this.setArmed(false), ARMED_MS) : null;
    this.clearButton.textContent = on ? "Press again to clear" : "Clear history";
    this.clearButton.classList.toggle("armed", on);
  }
}
