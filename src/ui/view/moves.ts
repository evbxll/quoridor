import type { Analysis } from "../analysis";
import { type GameController, sideOf } from "../controller";
import { element, setEnabled } from "../dom";
import { moveRows } from "../status";

/** Says which position is on the board: the latest, or an earlier one with the way back. Not read aloud with each change; the board's label carries it. */
export function drawViewing(controller: GameController, analysis: Analysis): void {
  const count = controller.moves.length;
  const past = analysis.viewingPast;
  const note = element("viewing", HTMLElement);
  note.classList.toggle("past", past);
  note.textContent = past ? `Viewing ${analysis.where}` : count === 0 ? "The start of the game." : `Live: move ${count} of ${count}.`;
  element("step-live", HTMLButtonElement).classList.toggle("live", !past);
  setEnabled(element("step-first", HTMLButtonElement), analysis.ply > 0);
  setEnabled(element("step-prev", HTMLButtonElement), analysis.ply > 0);
  setEnabled(element("step-next", HTMLButtonElement), analysis.ply < count);
  setEnabled(element("step-last", HTMLButtonElement), analysis.ply < count);
}

/** Draws the move list, one button per move that shows that position. */
export class MovesView {
  private drawn = "";

  draw(controller: GameController, analysis: Analysis): void {
    const moves = controller.moves;
    const list = element("moves", HTMLOListElement);
    const signature = moves.join(".");
    if (signature !== this.drawn) {
      this.drawn = signature;
      // Rebuilding must not take keyboard focus away from the move being used.
      const focused = document.activeElement;
      const focusedPly = focused instanceof HTMLElement && list.contains(focused) ? focused.dataset["ply"] : undefined;
      list.replaceChildren(
        ...moveRows(moves).map((row, i) => {
          const item = document.createElement("li");
          row.forEach((move, k) => {
            const ply = i * 2 + k + 1;
            const cell = document.createElement("button");
            cell.type = "button";
            cell.textContent = move;
            cell.dataset["ply"] = String(ply);
            cell.className = sideOf(ply - 1);
            cell.setAttribute("aria-label", `Show the position after move ${ply}, ${move}`);
            cell.addEventListener("click", () => analysis.goTo(ply));
            item.append(cell);
          });
          return item;
        }),
      );
      if (focusedPly !== undefined) list.querySelector<HTMLElement>(`[data-ply="${focusedPly}"]`)?.focus();
    }
    // The viewed move is marked in place; the entries themselves stay.
    let viewed: HTMLElement | null = null;
    for (const cell of list.querySelectorAll<HTMLElement>("[data-ply]")) {
      const current = Number(cell.dataset["ply"]) === analysis.ply;
      cell.classList.toggle("latest", current);
      if (current) cell.setAttribute("aria-current", "step");
      else cell.removeAttribute("aria-current");
      if (current) viewed = cell;
    }
    if (!analysis.viewingPast) list.scrollTop = list.scrollHeight;
    else if (viewed) {
      // Keep the viewed move in sight without pulling the list to the end.
      if (viewed.offsetTop < list.scrollTop) list.scrollTop = viewed.offsetTop;
      else if (viewed.offsetTop + viewed.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = viewed.offsetTop + viewed.offsetHeight - list.clientHeight;
    }
    element("moves-empty", HTMLElement).hidden = moves.length > 0;
  }
}
