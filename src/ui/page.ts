import type { GlobalAction } from "../engine/actions";
import { Game } from "../engine/game";
import type { GameState } from "../engine/state";
import { describeBoard, renderBoard } from "./board";
import { ModelManager, type ModelState } from "../model/manager";
import type { ModelEnv } from "../model/store";
import { GameController, type SearchPort, type Side } from "./controller";
import { boardSpan, cellAt, PAD, wallAt } from "./geometry";
import { isAvailable, type Level, LEVELS } from "./levels";
import { WallPreview } from "./pointer";
import { moveRows, statusText } from "./status";
import { describeTarget, findAction, moveCursor, pawnTargets } from "./targets";

/** How the page gets the network: where to fetch it from, and how to give it to the search worker. */
export interface NetworkSource {
  readonly env: ModelEnv;
  readonly start: (model: ArrayBuffer) => Promise<void>;
}

const megabytes = (bytes: number): string => (bytes / 1e6).toFixed(1);

/** The model note under the board, and the words that go after a disabled level. */
function describeModel(state: ModelState): { note: string; level: string } {
  switch (state.status) {
    case "checking":
      return { note: "Looking for the network that plays Strong and Max.", level: "model not available yet" };
    case "unavailable":
      return state.reason === "not-offered"
        ? { note: "The network is not offered at this board size. Beginner and Normal play with the heuristic.", level: "network not offered at this size" }
        : { note: "Strong and Max play with a trained network, which is not available yet.", level: "model not available yet" };
    case "downloading": {
      const done = state.total === null ? `${megabytes(state.loaded)} MB` : `${megabytes(state.loaded)} of ${megabytes(state.total)} MB`;
      return { note: `Downloading the network for Strong and Max: ${done}. Beginner and Normal can be played meanwhile.`, level: "downloading the model" };
    }
    case "ready":
      return {
        note: `Strong and Max are ready.${state.fromCache ? " The network was loaded from this device." : ""}${state.saved ? "" : " It could not be saved for offline use."}`,
        level: "",
      };
    case "failed":
      return { note: state.message, level: state.kind === "hash" ? "model failed its checksum" : "model failed to load" };
  }
}

function element<T extends Element>(id: string, type: abstract new () => T): T {
  const found = document.getElementById(id);
  if (!(found instanceof type)) throw new Error(`The page has no #${id} of the expected kind`);
  return found;
}

/** Wires the controller to the page: draws the position and turns clicks and keys into moves. */
export function startPage(port: SearchPort, network: NetworkSource): GameController {
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
  let progressFrame = false;
  const models = new ModelManager(network.env, network.start, () => {
    // Progress arrives with every chunk of the download; draw it at most once a frame. Other changes draw at once.
    if (announcedModel === "downloading" && models.state(Number(sizeSelect.value)).status === "downloading") {
      if (!progressFrame) {
        progressFrame = true;
        requestAnimationFrame(() => {
          progressFrame = false;
          renderModel();
        });
      }
      return;
    }
    renderModel();
  });
  const modelNote = element("model-note", HTMLElement);
  const modelProgress = element("model-progress", HTMLProgressElement);
  const modelRetry = element("model-retry", HTMLButtonElement);
  const modelBanner = element("model-banner", HTMLElement);
  const modelBannerText = element("model-banner-text", HTMLElement);
  let announcedModel = "";

  /** If `hiding` has keyboard focus and is about to go away, moves focus to `fallback` so it is not lost to the page. */
  const keepFocus = (hiding: HTMLElement, fallback: HTMLElement): void => {
    if (document.activeElement === hiding) fallback.focus();
  };

  for (const level of LEVELS) {
    const option = document.createElement("option");
    option.value = level.id;
    levelSelect.append(option);
  }
  levelSelect.value = LEVELS[1]!.id;
  const selectedLevel = (): Level => LEVELS.find((l) => l.id === levelSelect.value) ?? LEVELS[1]!;

  /**
   * Shows where the network stands for the board size in the select: the note,
   * the progress bar, and which levels can be chosen. A game in progress keeps
   * its opponent; the new levels apply from the next game or level change.
   */
  function renderModel(): void {
    const state = models.state(Number(sizeSelect.value));
    const { note, level } = describeModel(state);
    if (modelNote.textContent !== note) modelNote.textContent = note;
    if (state.status === "downloading") {
      modelProgress.hidden = false;
      if (state.total === null) modelProgress.removeAttribute("value");
      else {
        modelProgress.max = state.total;
        modelProgress.value = state.loaded;
      }
    } else modelProgress.hidden = true;
    // Below the board on a phone the note would be out of sight, so a download or a failure also shows up here.
    const banner = state.status === "downloading" || state.status === "failed";
    if (!banner) keepFocus(modelRetry, levelSelect);
    else if (state.status !== "failed") keepFocus(modelRetry, modelBannerText);
    modelRetry.hidden = state.status !== "failed";
    modelBanner.hidden = !banner;
    modelBannerText.textContent = note;
    for (const option of levelSelect.options) {
      const found = LEVELS.find((l) => l.id === option.value)!;
      option.disabled = !isAvailable(found, state.status === "ready");
      option.textContent = option.disabled ? `${found.label} (${level})` : found.label;
    }
    if (state.status !== announcedModel) {
      announcedModel = state.status;
      if (state.status === "downloading") announce("Downloading the network for Strong and Max.");
      else if (state.status === "ready" || state.status === "failed") announce(note);
    }
  }

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
    // Some browsers throw if the address is rewritten too often, and a progress bar needs no new address.
    if (location.hash !== controller.hash) history.replaceState(null, "", controller.hash);
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
    const size = Number(sizeSelect.value);
    const wanted = selectedLevel();
    // The network levels need the network of this size; without it the game is played at Normal, and the select says so.
    const level = isAvailable(wanted, models.state(size).status === "ready") ? wanted : LEVELS[1]!;
    if (level !== wanted) {
      levelSelect.value = level.id;
      announce(`${wanted.label} is not available at this board size, so the game is played at ${level.label}.`);
    }
    controller.newGame(size, sideSelect.value as Side, level);
  }

  /** Opens the game in the address bar's hash if it is one the site offers; otherwise says so. Returns whether it did. */
  function openHash(): boolean {
    try {
      preview.clear();
      controller.load(Game.fromHash(location.hash), selectedLevel());
      syncSelects();
      renderModel();
      void models.select(controller.size);
      return true;
    } catch {
      announce("That link could not be opened, so it was ignored.");
      if (location.hash !== controller.hash) history.replaceState(null, "", controller.hash);
      return false;
    }
  }

  element("new", HTMLButtonElement).addEventListener("click", newGame);
  levelSelect.addEventListener("change", () => {
    controller.setLevel(selectedLevel());
    announce(`The bot plays at ${selectedLevel().label} from its next move.`);
  });
  sizeSelect.addEventListener("change", () => {
    renderModel();
    void models.select(Number(sizeSelect.value));
  });
  modelRetry.addEventListener("click", () => void models.retry(Number(sizeSelect.value)));
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

  renderModel();
  if (location.hash.length <= 1 || !openHash()) newGame();
  void models.select(controller.size);
  return controller;
}
