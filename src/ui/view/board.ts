import type { GlobalAction } from "../../engine/actions";
import type { GameState } from "../../engine/state";
import { type Analysis, replay } from "../analysis";
import { describeBoard, renderBoard, wallOwners } from "../board";
import type { GameController } from "../controller";
import { element } from "../dom";
import { boardSpan, PAD } from "../geometry";
import type { WallTarget } from "../pointer";
import { findAction, pawnTargets } from "../targets";

/** Draws the position on the board's SVG, only when its markup changed. */
export class BoardView {
  private drawn = "";
  private ownersKey = "";
  private owners = new Map<string, 0 | 1>();

  constructor(private readonly board: SVGSVGElement) {}

  /** Draws the position on view (the latest, or an earlier one) and returns it. `wall` is the preview behind the pointer; `cursor` is the keyboard's. */
  draw(controller: GameController, analysis: Analysis, canMove: boolean, wall: WallTarget | null, cursor: GlobalAction | null): GameState {
    const board = this.board;
    const past = analysis.viewingPast ? replay(controller.size, controller.moves, analysis.ply) : null;
    const state: GameState = past ? past.state : controller.state;
    const ghost = canMove ? wall : null;
    const ply = past ? analysis.ply : controller.moves.length;
    const key = `${controller.size}|${controller.moves.slice(0, ply).join(".")}`;
    if (key !== this.ownersKey) {
      this.ownersKey = key;
      this.owners = wallOwners(controller.size, controller.moves.slice(0, ply));
    }
    const markup = renderBoard(state, {
      owners: this.owners,
      targets: canMove ? pawnTargets(state) : [],
      ghost: ghost ? { wall: ghost, legal: findAction(state, ghost) !== null } : null,
      cursor: cursor ? { target: cursor, legal: findAction(state, cursor) !== null } : null,
      last: past ? past.last : controller.lastMove,
    });
    if (markup !== this.drawn) {
      this.drawn = markup;
      const span = boardSpan(controller.size);
      board.setAttribute("viewBox", `0 0 ${span + 2 * PAD} ${span + 2 * PAD}`);
      board.innerHTML = markup;
      // The eval bar's track spans the board's drawn square (its margin is PAD - 6 units), so its ends line up with the board's.
      element("eval", HTMLElement).style.gridTemplateRows = `minmax(0, ${PAD - 6}fr) minmax(0, ${span + 12}fr) minmax(0, ${PAD - 6}fr)`;
    }
    const viewing = past ? ` Showing the position after move ${analysis.ply} of ${controller.moves.length}.` : "";
    board.setAttribute("aria-label", `Quoridor. ${describeBoard(state)}${viewing}`);
    board.classList.toggle("can-click", canMove);
    return state;
  }
}
