import type { GlobalAction } from "../engine/actions";
import { Game } from "../engine/game";
import type { GameState } from "../engine/state";
import { describeBoard, renderBoard } from "./board";
import { GameController, type SearchPort, type Side } from "./controller";
import { boardSpan, cellAt, PAD, wallAt } from "./geometry";
import { isAvailable, type Level, LEVELS } from "./levels";
import { WallPreview } from "./pointer";
import { moveRows, statusText } from "./status";
import { describeTarget, findAction, moveCursor, pawnTargets } from "./targets";

/** No model is published yet; the network levels stay disabled until the page can load one. */
const MODEL_READY = false;

function element<T extends Element>(id: string, type: abstract new () => T): T {
  const found = document.getElementById(id);
  if (!(found instanceof type)) throw new Error(`The page has no #${id} of the expected kind`);
  return found;
}

/** Wires the controller to the page: draws the position and turns clicks and keys into moves. */
export function startPage(port: SearchPort): GameController {
  const board = element("board", SVGSVGElement);
  const sizeSelect = element("size", HTMLSelectElement);
  const levelSelect = element("level", HTMLSelectElement);
  const sideSelect = element("side", HTMLSelectElement);
  const live = element("live", HTMLElement);
  const statusLine = element("status", HTMLElement);
  const retryButton = element("retry", HTMLButtonElement);
  const undoButton = element("undo", HTMLButtonElement);

  const preview = new WallPreview();
  let cursor: GlobalAction | null = null; // shown only once the keyboard is in use on the board
  let drawn = "";

  const announce = (text: string): void => {
    live.textContent = text === live.textContent ? `${text} ` : text;
  };

  const controller = new GameController(port, () => render());

  for (const level of LEVELS) {
    const option = document.createElement("option");
    option.value = level.id;
    option.disabled = !isAvailable(level, MODEL_READY);
    option.textContent = option.disabled ? `${level.label} (model not available yet)` : level.label;
    levelSelect.append(option);
  }
  levelSelect.value = LEVELS[1]!.id;
  const selectedLevel = (): Level => LEVELS.find((l) => l.id === levelSelect.value) ?? LEVELS[1]!;

  /** Shows the controller's board size, side and level in the selects (after a game is opened from a link). */
  function syncSelects(): void {
    sizeSelect.value = String(controller.size);
    sideSelect.value = controller.human;
    levelSelect.value = controller.level.id;
  }

  function render(): void {
    const state: GameState = controller.state;
    const canMove = controller.humanToMove;
    const wall = canMove ? preview.wall : null;
    const targets = canMove ? pawnTargets(state) : [];
    const markup = renderBoard(state, {
      targets,
      ghost: wall ? { wall, legal: findAction(state, wall) !== null } : null,
      cursor: cursor ? { target: cursor, legal: findAction(state, cursor) !== null } : null,
      last: controller.lastMove,
    });
    if (markup !== drawn) {
      drawn = markup;
      const span = boardSpan(controller.size) + 2 * PAD;
      board.setAttribute("viewBox", `0 0 ${span} ${span}`);
      board.innerHTML = markup;
    }
    board.setAttribute("aria-label", `Quoridor. ${describeBoard(state)}`);
    board.classList.toggle("can-click", canMove);
    renderTrays(state);
    renderMoves();
    const text = statusText(controller);
    if (statusLine.textContent !== text) statusLine.textContent = text;
    retryButton.hidden = controller.error === null;
    undoButton.disabled = !controller.canUndo;
    history.replaceState(null, "", controller.hash);
  }

  function renderTrays(state: GameState): void {
    for (const [player, side] of [[0, "p1"], [1, "p2"]] as const) {
      const walls = state.wallsLeft(player);
      const who = controller.human === side ? "You" : "Bot";
      const tray = element(`tray-${side}`, HTMLElement);
      tray.setAttribute("role", "group");
      tray.setAttribute("aria-label", `${who}, player ${player + 1}: ${walls} walls left`);
      tray.innerHTML =
        `<span aria-hidden="true">${who} (P${player + 1}) walls</span>` +
        `<span class="pieces" aria-hidden="true">${"<i></i>".repeat(walls)}</span>` +
        `<span class="count">${walls}</span>`;
    }
  }

  function renderMoves(): void {
    const moves = controller.moves;
    const list = element("moves", HTMLOListElement);
    list.replaceChildren(
      ...moveRows(moves).map((row, i) => {
        const item = document.createElement("li");
        row.forEach((move, k) => {
          const cell = document.createElement("span");
          cell.textContent = move;
          if (i * 2 + k === moves.length - 1) cell.className = "latest";
          item.append(cell);
        });
        return item;
      }),
    );
    list.scrollTop = list.scrollHeight;
    element("moves-empty", HTMLElement).hidden = moves.length > 0;
  }

  /** The cell or groove under the pointer. */
  function targetAt(event: PointerEvent): GlobalAction | null {
    const point = board.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    const { x, y } = point.matrixTransform(board.getScreenCTM()!.inverse());
    const cell = cellAt(x, y, controller.size);
    if (cell) return { kind: "move", ...cell };
    const slot = wallAt(x, y, controller.size);
    return slot ? { kind: "wall", ...slot } : null;
  }

  function play(target: GlobalAction): void {
    const action = findAction(controller.state, target);
    if (action === null) {
      announce(`${describeTarget(controller.state, target)}.`);
      return;
    }
    preview.clear();
    controller.playHuman(action);
  }

  board.addEventListener("pointerdown", () => {
    if (cursor !== null) {
      cursor = null;
      render();
    }
  });
  board.addEventListener("pointermove", (event) => {
    if (controller.humanToMove && preview.move(event.pointerType, targetAt(event))) render();
  });
  board.addEventListener("pointerleave", (event) => {
    if (preview.leave(event.pointerType)) render();
  });
  board.addEventListener("pointerup", (event) => {
    const target = targetAt(event);
    if (!controller.humanToMove) return;
    const release = preview.release(event.pointerType, target);
    if (release === "play") play(target!);
    else if (release === "preview") {
      render();
      announce(`${describeTarget(controller.state, target!)}. Tap again to place it.`);
    } else render();
  });

  /** Puts the keyboard cursor on the person's pawn the first time the keyboard is used. */
  function startCursor(): GlobalAction {
    const state = controller.state;
    const mine = controller.human === "p1" ? 0 : 1;
    return { kind: "move", row: state.row(mine), col: state.col(mine) };
  }

  board.addEventListener("focus", () => {
    // A focus that came from a click or tap is not keyboard use; it draws no cursor.
    if (!board.matches(":focus-visible")) return;
    cursor = cursor ?? startCursor();
    render();
    announce(`${describeTarget(controller.state, cursor)}.`);
  });
  board.addEventListener("blur", () => {
    cursor = null;
    render();
  });
  board.addEventListener("keydown", (event) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
    if (cursor === null) {
      if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "h", "v", "p", "Enter", " "].includes(key)) return;
      event.preventDefault();
      cursor = startCursor();
      render();
      announce(`${describeTarget(controller.state, cursor)}.`);
      return;
    }
    if (key === "Enter" || key === " ") {
      event.preventDefault();
      if (controller.humanToMove) play(cursor);
      else announce("It is not your move.");
      return;
    }
    const next = moveCursor(cursor, key, controller.size);
    if (next === null) return;
    event.preventDefault();
    cursor = next;
    render();
    announce(`${describeTarget(controller.state, next)}.`);
  });

  /** Starts the game the selects ask for. */
  function newGame(): void {
    preview.clear();
    controller.newGame(Number(sizeSelect.value), sideSelect.value as Side, selectedLevel());
  }

  /** Opens the game in the address bar's hash if it is one the site offers; otherwise says so. Returns whether it did. */
  function openHash(): boolean {
    try {
      preview.clear();
      controller.load(Game.fromHash(location.hash), selectedLevel());
      syncSelects();
      return true;
    } catch {
      announce("That link could not be opened, so it was ignored.");
      history.replaceState(null, "", controller.hash);
      return false;
    }
  }

  element("new", HTMLButtonElement).addEventListener("click", newGame);
  levelSelect.addEventListener("change", () => controller.setLevel(selectedLevel()));
  undoButton.addEventListener("click", () => controller.undo());
  retryButton.addEventListener("click", () => controller.retry());
  element("copy", HTMLButtonElement).addEventListener("click", () => {
    navigator.clipboard.writeText(location.href).then(
      () => announce("Link copied."),
      () => announce("Could not copy; the link is in the address bar."),
    );
  });
  window.addEventListener("hashchange", () => {
    if (location.hash !== controller.hash) openHash();
  });

  if (location.hash.length <= 1 || !openHash()) newGame();
  return controller;
}
