import type { GameController } from "../controller";
import { element, setEnabled } from "../dom";
import type { Visible } from "../visibility";

/** Draws the buttons and rows under the board: which are shown, which are enabled, and what Start says. `countdown` is whether auto-play is counting down to the next game. */
export function drawControls(shown: Visible, controller: GameController, countdown: boolean): void {
  const sizeSelect = element("size", HTMLSelectElement);
  const newButton = element("new", HTMLButtonElement);
  const toggleButton = element("toggle", HTMLButtonElement);
  element("bot-controls", HTMLElement).hidden = !shown.botControls;
  element("person-controls", HTMLElement).hidden = !shown.undo;
  element("how-to-move", HTMLElement).hidden = !shown.howToMove;
  const published = shown.analysis;
  // Hidden by visibility, not removed, so the status line below does not move.
  element("eval-toggle", HTMLElement).classList.toggle("off", !shown.evaluationToggle);
  // Without a network there is nothing to analyse; the note takes the checkbox's place, so the card does not change size.
  element("analysis-label", HTMLElement).hidden = !published;
  element("analysis-off", HTMLElement).hidden = published;
  // The board size waits for New game; the button says so while it differs from the game on the board.
  const pending = Number(sizeSelect.value) !== controller.size;
  newButton.classList.toggle("pending", pending);
  newButton.title = pending ? "The board size you chose starts when you press New game" : "";
  toggleButton.classList.toggle("blocked", shown.startBlocked);
  toggleButton.textContent = shown.startBlocked ? (countdown ? "Game over: next game starting" : "Game over: press New game") : controller.running ? "Pause" : controller.moves.length > 0 ? "Resume" : "Start";
  setEnabled(toggleButton, !shown.startBlocked);
  setEnabled(element("step", HTMLButtonElement), controller.canStep);
  setEnabled(element("undo", HTMLButtonElement), controller.canUndo);
  // The row is about to go; keep the keyboard on the page instead of dropping it to the top.
  if (controller.error === null && document.activeElement === element("retry", HTMLButtonElement)) element("status", HTMLElement).focus();
  element("retry-row", HTMLElement).hidden = controller.error === null;
}
