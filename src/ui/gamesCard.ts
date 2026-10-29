import { element } from "./dom";
import { OpenConfirm } from "./confirmOpen";
import { type GameHistory, isMirror, resultText, seatNames } from "./history";

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
  private readonly ask = element("games-ask", HTMLElement);
  private readonly askText = element("games-ask-text", HTMLElement);
  private readonly yes = element("games-yes", HTMLButtonElement);
  private readonly no = element("games-no", HTMLButtonElement);
  private readonly confirm: OpenConfirm;

  /** `cleared` puts the keyboard somewhere that still exists, after the history was cleared or a game was opened. `inProgress` says whether opening a game would replace one being played. */
  constructor(
    private readonly history: GameHistory,
    private readonly announce: (text: string) => void,
    private readonly cleared: () => void,
    inProgress: () => boolean,
  ) {
    this.confirm = new OpenConfirm(inProgress, (id) => this.open(id), () => this.drawAsk());
    this.card.addEventListener("click", (event) => {
      const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[data-game]") : null;
      if (link === null || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      if (this.confirm.request(Number(link.dataset["game"])) === "asking") {
        this.announce(`Replace the current game with game ${link.dataset["game"]}? Choose Yes, open, or Cancel.`);
        this.yes.focus();
      }
    });
    this.yes.addEventListener("click", () => this.confirm.confirm());
    this.no.addEventListener("click", () => this.dismiss());
    this.ask.addEventListener("keydown", (event) => {
      if (event.key === "Escape") this.dismiss();
    });
    this.ask.addEventListener("focusout", (event) => {
      if (!(event.relatedTarget instanceof Node && this.ask.contains(event.relatedTarget))) this.confirm.cancel();
    });
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
        link.dataset["game"] = String(game.id);
        link.textContent = "Open";
        link.setAttribute("aria-label", `Open game ${game.id}, on a ${game.size} by ${game.size} board`);
        const open = document.createElement("td");
        open.append(link);
        row.append(cell("th", String(game.id), "row"), cell("td", names.p1), cell("td", names.p2), cell("td", isMirror(game) ? `${resultText(game.winner, game.reason)} (mirror match)` : resultText(game.winner, game.reason)), cell("td", String(game.moves.split(".").length)), open);
        return row;
      }),
    );
    // The newest game is in view.
    this.scroller.scrollTop = this.scroller.scrollHeight;
  }

  /** Puts the game on the board the way a link does, and lets the keyboard go to the page. */
  private open(id: number): void {
    const game = this.history.games.find((candidate) => candidate.id === id);
    if (game === undefined) return;
    this.cleared();
    location.hash = `#n=${game.size}&m=${game.moves}`;
  }

  /** Cancel or Escape: the question goes and the keyboard returns to the Open link it came from. */
  private dismiss(): void {
    const state = this.confirm.state;
    this.confirm.cancel();
    if (state.phase === "confirming") this.card.querySelector<HTMLAnchorElement>(`a[data-game="${state.id}"]`)?.focus();
  }

  private drawAsk(): void {
    const state = this.confirm.state;
    // The line keeps its room when no question is up, so nothing around it moves.
    this.ask.classList.toggle("off", state.phase !== "confirming");
    this.askText.textContent = state.phase === "confirming" ? `Replace the current game with game ${state.id}?` : "";
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
