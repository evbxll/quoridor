import type { GameController } from "../controller";
import { element, setEnabled } from "../dom";
import type { Visible } from "../visibility";

/** Draws the game controls and the View menu's choices: which are shown, which are enabled, and what Start says. `countdown` is whether auto-play is counting down to the next game. */
export function drawControls(shown: Visible, controller: GameController, countdown: boolean): void {
  const sizeSelect = element("size", HTMLSelectElement);
  const newButton = element("new", HTMLButtonElement);
  const toggleButton = element("toggle", HTMLButtonElement);
  element("bot-controls", HTMLElement).hidden = !shown.botControls;
  element("person-controls", HTMLElement).hidden = !shown.undo;
  element("how-to-move", HTMLElement).hidden = !shown.howToMove;
  const published = shown.analysis;
  // The View menu keeps both choices in place and greys out one that does not apply, with the reason under it.
  element("show-eval", HTMLInputElement).disabled = !shown.evaluationToggle;
  const evalNote = element("show-eval-note", HTMLElement);
  const evalReason = !published ? "The evaluation needs the network." : shown.evaluationToggle ? "" : "Always shown while two bots play.";
  if (evalNote.textContent !== evalReason) evalNote.textContent = evalReason;
  evalNote.hidden = evalReason === "";
  element("analysis-toggle", HTMLInputElement).disabled = !published;
  element("analysis-off", HTMLElement).hidden = published;
  // The board size waits for New game; the button says so while it differs from the game on the board.
  const pending = Number(sizeSelect.value) !== controller.size;
  newButton.classList.toggle("pending", pending);
  newButton.title = pending ? "The board size you chose starts when you press New game" : "";
  toggleButton.classList.toggle("blocked", shown.startBlocked);
  toggleButton.textContent = shown.startBlocked ? (countdown ? "Next game starting" : "Game over") : controller.running ? "Pause" : controller.moves.length > 0 ? "Resume" : "Start";
  setEnabled(toggleButton, !shown.startBlocked);
  setEnabled(element("step", HTMLButtonElement), controller.canStep);
  setEnabled(element("undo", HTMLButtonElement), controller.canUndo);
  // The row is about to go; keep the keyboard on the page instead of dropping it to the top.
  if (controller.error === null && document.activeElement === element("retry", HTMLButtonElement)) element("status", HTMLElement).focus();
  element("retry-row", HTMLElement).hidden = controller.error === null;
}
