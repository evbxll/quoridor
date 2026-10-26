import { renderBoard } from "./board";
import type { SearchPort } from "./controller";
import { element, onPress, renderTray, setEnabled } from "./dom";
import { boardSpan, PAD } from "./geometry";
import type { Level } from "./levels";
import { moveRows } from "./status";
import { describeLevel, evalBar, type Speed, WatchController, watchStatus } from "./watch";

/** What the Watch panel needs from the page around it. */
export interface WatchHost {
  /** The board size chosen in the toolbar. */
  size(): number;
  /** The level chosen in a bot's select, replaced by Normal (and said so) when the network it needs is not ready. */
  level(select: HTMLSelectElement): Level;
  announce(text: string): void;
}

/** The Watch panel's two bots, buttons, eval bar and move list, drawn on the page's board. */
export function startWatch(port: SearchPort, host: WatchHost): { restart(): void; pause(): void } {
  const board = element("board", SVGSVGElement);
  const selects = { p1: element("watch-p1", HTMLSelectElement), p2: element("watch-p2", HTMLSelectElement) };
  const speedSelect = element("watch-speed", HTMLSelectElement);
  const toggle = element("watch-toggle", HTMLButtonElement);
  const stepButton = element("watch-step", HTMLButtonElement);
  const swap = element("watch-swap", HTMLInputElement);
  const list = element("watch-moves", HTMLOListElement);
  let boardDrawn = "";
  let movesDrawn = "";

  const watch = new WatchController(port, render);

  function render(): void {
    const state = watch.state;
    const markup = renderBoard(state, { targets: [], ghost: null, cursor: null, last: watch.lastMove });
    if (markup !== boardDrawn) {
      boardDrawn = markup;
      const span = boardSpan(watch.size) + 2 * PAD;
      board.setAttribute("viewBox", `0 0 ${span} ${span}`);
      board.innerHTML = markup;
    }
    board.setAttribute("aria-label", `Quoridor, two bots playing. ${watch.moves.length} moves so far.`);
    board.classList.remove("can-click");
    renderTray("p1", `Player 1, ${watch.levels.p1.label}`, state);
    renderTray("p2", `Player 2, ${watch.levels.p2.label}`, state);
    const status = watchStatus(watch);
    const statusLine = element("status", HTMLElement);
    if (statusLine.textContent !== status) statusLine.textContent = status;
    toggle.textContent = watch.running ? "Pause" : watch.moves.length > 0 && watch.canMove ? "Resume" : "Start";
    setEnabled(toggle, watch.running || watch.canMove);
    setEnabled(stepButton, !watch.running && !watch.thinking && watch.canMove);
    element("watch-bots", HTMLElement).textContent = `Player 1: ${describeLevel(watch.levels.p1)}. Player 2: ${describeLevel(watch.levels.p2)}.`;
    renderMoves();
    renderBar();
  }

  function renderMoves(): void {
    const moves = watch.moves;
    const signature = moves.join(".");
    if (signature === movesDrawn) return;
    movesDrawn = signature;
    list.replaceChildren(
      ...moveRows(moves).map((row) => {
        const item = document.createElement("li");
        for (const move of row) {
          const cell = document.createElement("span");
          cell.textContent = move;
          item.append(cell);
        }
        return item;
      }),
    );
    list.scrollTop = list.scrollHeight;
  }

  function renderBar(): void {
    const bar = evalBar(watch);
    const meter = element("watch-eval", HTMLElement);
    meter.hidden = bar === null;
    if (bar === null) return;
    meter.setAttribute("aria-valuenow", String(bar.percent));
    meter.setAttribute("aria-valuetext", bar.label);
    element("watch-fill", HTMLElement).style.width = `${bar.percent}%`;
    element("watch-text-p1", HTMLElement).textContent = `Player 1: ${bar.percent}%`;
    element("watch-text-p2", HTMLElement).textContent = `Player 2: ${100 - bar.percent}%`;
    for (const side of ["p1", "p2"] as const) {
      const mark = element(`watch-mark-${side}`, HTMLElement);
      mark.hidden = bar.marks[side] === null;
      if (bar.marks[side] !== null) mark.style.left = `${bar.marks[side]}%`;
    }
    const said = (side: "p1" | "p2"): string => (bar.marks[side] === null ? "no reading yet" : `${bar.marks[side]}% for player 1`);
    element("watch-opinions", HTMLElement).textContent =
      `Bar: the stronger bot's latest reading. Ticks, top to bottom: player 1's bot (${said("p1")}), player 2's bot (${said("p2")}).`;
  }

  function restart(swapSides: boolean): void {
    if (swapSides) [selects.p1.value, selects.p2.value] = [selects.p2.value, selects.p1.value];
    watch.restart(host.size(), { p1: host.level(selects.p1), p2: host.level(selects.p2) });
  }

  onPress(toggle, () => (watch.running ? watch.pause() : watch.start()));
  onPress(stepButton, () => watch.step());
  element("watch-restart", HTMLButtonElement).addEventListener("click", () => restart(swap.checked));
  speedSelect.addEventListener("change", () => watch.setSpeed(speedSelect.value as Speed));
  for (const side of ["p1", "p2"] as const) selects[side].addEventListener("change", () => watch.setLevel(side, host.level(selects[side])));

  return {
    /** Starts a fresh game on the toolbar's board size; the page calls this when Watch is chosen and when the size changes there. */
    restart: () => restart(false),
    pause: () => {
      watch.pause();
      boardDrawn = "";
    },
  };
}
