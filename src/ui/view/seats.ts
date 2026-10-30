import type { GameState } from "../../engine/state";
import type { GameController, Side } from "../controller";
import { element } from "../dom";
import type { SeatControls } from "../seatControls";
import { seatNote } from "../status";

const SIDES = ["p1", "p2"] as const;

/**
 * Draws both seats: the choices, the note under them (who plays, thinking, waiting), whose turn it is and the walls left.
 * `network` says where the network, or the gallery model with that id, stands, for a bot that waits for it.
 */
export function drawSeats(
  state: GameState,
  controller: GameController,
  viewingPast: boolean,
  controls: Readonly<Record<Side, SeatControls>>,
  network: (modelId: string | null) => string,
): void {
  for (const side of SIDES) {
    const toMove = controller.result === null && controller.mover === side && !viewingPast;
    const note = seatNote(controller, side, toMove, network);
    controls[side].draw();
    const noteElement = element(`note-${side}`, HTMLElement);
    if (noteElement.textContent !== note) noteElement.textContent = note;
    const seatElement = element(`seat-${side}`, HTMLElement);
    seatElement.classList.toggle("to-move", toMove);
    seatElement.classList.toggle("thinking", toMove && controller.thinking);
    const walls = state.wallsLeft(side === "p1" ? 0 : 1);
    const wallsElement = element(`walls-${side}`, HTMLElement);
    wallsElement.innerHTML = `<b>${walls}</b> ${walls === 1 ? "wall" : "walls"} left`;
  }
}
