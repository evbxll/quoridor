import type { GlobalAction } from "../engine/actions";
import { Game } from "../engine/game";
import type { GameState } from "../engine/state";
import { Analysis, replay } from "./analysis";
import { describeBoard, renderBoard, wallOwners } from "./board";
import { closePopoverOnEscapeOrOutside, element, onPress, setEnabled } from "./dom";
import { ModelManager, type ModelState } from "../model/manager";
import type { ModelEnv } from "../model/store";
import { GameController, HUMAN, isOfferedSize, type Player, type Players, type SearchPort, type Side, sideOf, type Speed } from "./controller";
import { evalBar } from "./evalBar";
import { boardSpan, cellAt, PAD, wallAt } from "./geometry";
import { isAvailable, type Level, LEVELS, levelSummary } from "./levels";
import { WallPreview } from "./pointer";
import { moveRows, playerName, statusIsMuted, statusText } from "./status";
import { describeTarget, findAction, moveCursor, pawnTargets } from "./targets";

/** How the page gets the network: where to fetch it from, and how to give it to the search worker. */
export interface NetworkSource {
  readonly env: ModelEnv;
  readonly start: (model: ArrayBuffer) => Promise<void>;
}

const SIDES = ["p1", "p2"] as const;
/** How many suggested moves the analysis lists; matches the three rows reserved for them. */
const TOP_LINES = 3;
const NORMAL = LEVELS.find((level) => level.id === "normal")!;
const STRONG = LEVELS.find((level) => level.id === "strong")!;
/** A visitor plays player 1 against Strong, the network at 32 searches, unless they choose otherwise. */
const DEFAULT_PLAYERS: Players = { p1: HUMAN, p2: STRONG };

const SHOW_EVAL_KEY = "quoridor.showEval";

/** Whether the viewer last chose to see the evaluation in games with a person; on until switched off. Storage can be blocked. */
function savedShowEval(): boolean {
  try {
    return localStorage.getItem(SHOW_EVAL_KEY) !== "off";
  } catch {
    return true;
  }
}

function saveShowEval(on: boolean): void {
  try {
    localStorage.setItem(SHOW_EVAL_KEY, on ? "on" : "off");
  } catch {
    // The choice then lasts for this visit only.
  }
}

const megabytes = (bytes: number): string => (bytes / 1e6).toFixed(1);

/** Where the network stands, in words: the chip in the top bar with its popover, and the short form for a bot that waits for it. */
function describeNetwork(state: ModelState, size: number): { line: string; short: string; chip: string; tone: "ok" | "busy" | "off" | "bad" } {
  switch (state.status) {
    case "checking":
      return { line: "Network: looking for it…", short: "looking for it", chip: "checking", tone: "busy" };
    case "unavailable":
      return state.reason === "not-offered"
        ? { line: `Network: not offered at ${size} × ${size}. Strong and Max are off; Beginner and Normal play.`, short: "not offered at this size", chip: "not offered here", tone: "off" }
        : { line: "Network: none is published yet. Strong and Max are off; Beginner and Normal play.", short: "none published", chip: "not published", tone: "off" };
    case "downloading": {
      const percent = state.total === null ? null : Math.floor((state.loaded / state.total) * 100);
      const done = state.total === null ? `${megabytes(state.loaded)} MB` : `${megabytes(state.loaded)} of ${megabytes(state.total)} MB`;
      return { line: `Network: downloading, ${done}.`, short: percent === null ? `downloading, ${done}` : `downloading, ${percent}%`, chip: percent === null ? "downloading" : `downloading ${percent}%`, tone: "busy" };
    }
    case "ready":
      return {
        line: `Network: ready (${state.model}${state.fromCache ? ", loaded from this device" : ""}).${state.saved ? "" : " It could not be saved for offline use."}`,
        short: "ready",
        chip: "ready",
        tone: "ok",
      };
    case "failed":
      return { line: `Network: failed. ${state.message}`, short: "the download failed; choose Retry download", chip: "failed", tone: "bad" };
  }
}

/** Wires the controller to the page: draws the position, the players and the eval bar, and turns clicks and keys into moves. */
export function startPage(port: SearchPort, network: NetworkSource): GameController {
  const board = element("board", SVGSVGElement);
  const sizeSelect = element("size", HTMLSelectElement);
  const seatSelects = { p1: element("player-p1", HTMLSelectElement), p2: element("player-p2", HTMLSelectElement) };
  const speedSelect = element("speed", HTMLSelectElement);
  const live = element("live", HTMLElement);
  const statusLine = element("status", HTMLElement);
  const retryButton = element("retry", HTMLButtonElement);
  const undoButton = element("undo", HTMLButtonElement);
  const toggleButton = element("toggle", HTMLButtonElement);
  const stepButton = element("step", HTMLButtonElement);
  const analysisToggle = element("analysis-toggle", HTMLInputElement);
  const networkRetry = element("network-retry", HTMLButtonElement);
  const networkProgress = element("network-progress", HTMLProgressElement);
  const showEval = element("show-eval", HTMLInputElement);
  const newButton = element("new", HTMLButtonElement);
  showEval.checked = savedShowEval();
  closePopoverOnEscapeOrOutside(element("network", HTMLDetailsElement), document);

  const preview = new WallPreview();
  let cursor: GlobalAction | null = null; // shown only once the keyboard is in use on the board
  let drawn = "";
  let ownersKey = "";
  let owners = new Map<string, 0 | 1>();
  /** The eval bar's last fresh percentage, kept (dimmed) while the next position is read. */
  let shownPercent: number | null = null;
  /** Whether the viewer has picked a seat, or opened a link that did: until then the seats are the site's default, which follows the network. */
  let seatsChosen = false;
  /** The game whose end was last announced, so a finished game of two bots is announced once. */
  let announcedEnd = "";

  const announce = (text: string): void => {
    live.textContent = text === live.textContent ? `${text} ` : text;
  };

  const controller = new GameController(port, () => analysis.update());
  let progressFrame = false;
  let announcedModel = "";
  const models = new ModelManager(network.env, network.start, () => {
    // Progress arrives with every chunk of the download; draw it at most once a frame. Other changes draw at once.
    if (announcedModel === "downloading" && models.state(controller.size).status === "downloading") {
      if (!progressFrame) {
        progressFrame = true;
        requestAnimationFrame(() => {
          progressFrame = false;
          networkChanged();
        });
      }
      return;
    }
    networkChanged();
  });
  const modelState = (): ModelState => models.state(controller.size);
  /** False once the model index is read and publishes no network at any size; true while that is not known yet. */
  const networkPublished = (): boolean => models.publishesAny !== false;
  /** The evaluation is shown: a network is published, and either two bots play or the viewer left "Show evaluation" on. */
  const evalVisible = (): boolean => networkPublished() && (!controller.hasHuman || showEval.checked);
  const analysisOpen = (): boolean => networkPublished() && analysisToggle.checked;
  // Readings cost searches: they are made only for the eval bar or the Analysis list, when one of them is showing.
  const analysis = new Analysis(controller, port, () => modelState().status === "ready", render, () => evalVisible() || analysisOpen());

  /** A person may move: it is a person's turn, and the position on the board is the latest. */
  const canPlay = (): boolean => controller.humanToMove && !analysis.viewingPast;

  for (const select of Object.values(seatSelects)) {
    const human = document.createElement("option");
    human.value = HUMAN;
    human.textContent = "Human";
    select.append(human);
    for (const level of LEVELS) {
      const option = document.createElement("option");
      option.value = level.id;
      option.textContent = level.label;
      select.append(option);
    }
  }
  const playerOf = (select: HTMLSelectElement): Player => LEVELS.find((level) => level.id === select.value) ?? HUMAN;
  const chosenPlayers = (): Players => ({ p1: playerOf(seatSelects.p1), p2: playerOf(seatSelects.p2) });
  const showPlayers = (players: Players): void => {
    for (const side of SIDES) seatSelects[side].value = players[side] === HUMAN ? HUMAN : (players[side] as Level).id;
  };

  /**
   * After the network changed: the bots that wait for it may move, levels it
   * cannot play at this size are switched off, and a seat that had one of them
   * goes to Normal (said aloud).
   */
  function networkChanged(): void {
    const state = modelState();
    const off = state.status === "unavailable";
    if (off) {
      // With no network published the default seat is Normal from the start; nothing was lost, so nothing is said.
      const silent = !seatsChosen && state.reason === "none-published";
      const players = { ...controller.players };
      for (const side of SIDES) {
        const seat = players[side];
        if (seat !== HUMAN && !isAvailable(seat, false)) {
          players[side] = NORMAL;
          seatSelects[side].value = NORMAL.id;
          if (!silent) {
            const why = state.reason === "none-published" ? "which is not published yet" : "which is not offered at this board size";
            announce(`${seat.label} needs the network, ${why}, so player ${side === "p1" ? 1 : 2} plays ${NORMAL.label}.`);
          }
        }
      }
      if (players.p1 !== controller.players.p1 || players.p2 !== controller.players.p2) controller.setPlayers(players);
    }
    for (const select of Object.values(seatSelects)) {
      for (const option of select.options) {
        const level = LEVELS.find((l) => l.id === option.value);
        option.disabled = level !== undefined && off && !isAvailable(level, false);
        option.textContent = level === undefined ? "Human" : option.disabled ? `${level.label} (no network)` : level.label;
      }
    }
    if (state.status !== announcedModel) {
      announcedModel = state.status;
      if (state.status === "downloading") announce("Downloading the network for Strong and Max.");
      else if (state.status === "ready" || state.status === "failed") announce(describeNetwork(state, controller.size).line);
    }
    controller.setNetworkReady(state.status === "ready");
    analysis.update();
  }

  function renderNetwork(): void {
    const state = modelState();
    const { line, chip, tone } = describeNetwork(state, controller.size);
    const text = element("network-text", HTMLElement);
    if (text.textContent !== line) text.textContent = line;
    element("network-chip", HTMLElement).textContent = `Network: ${chip}`;
    element("network-dot", HTMLElement).dataset["tone"] = tone;
    if (state.status === "downloading") {
      networkProgress.hidden = false;
      if (state.total === null) networkProgress.removeAttribute("value");
      else {
        networkProgress.max = state.total;
        networkProgress.value = state.loaded;
      }
    } else networkProgress.hidden = true;
    if (state.status !== "failed" && document.activeElement === networkRetry) element("network-summary", HTMLElement).focus();
    networkRetry.hidden = state.status !== "failed";
  }

  function render(): void {
    const past = analysis.viewingPast ? replay(controller.size, controller.moves, analysis.ply) : null;
    const state: GameState = past ? past.state : controller.state;
    const canMove = canPlay();
    const wall = canMove ? preview.wall : null;
    const ply = past ? analysis.ply : controller.moves.length;
    const key = `${controller.size}|${controller.moves.slice(0, ply).join(".")}`;
    if (key !== ownersKey) {
      ownersKey = key;
      owners = wallOwners(controller.size, controller.moves.slice(0, ply));
    }
    const markup = renderBoard(state, {
      owners,
      targets: canMove ? pawnTargets(state) : [],
      ghost: wall ? { wall, legal: findAction(state, wall) !== null } : null,
      cursor: cursor ? { target: cursor, legal: findAction(state, cursor) !== null } : null,
      last: past ? past.last : controller.lastMove,
    });
    if (markup !== drawn) {
      drawn = markup;
      const span = boardSpan(controller.size);
      board.setAttribute("viewBox", `0 0 ${span + 2 * PAD} ${span + 2 * PAD}`);
      board.innerHTML = markup;
      // The eval bar's track spans the board's drawn square (its margin is PAD - 6 units), so its ends line up with the board's.
      element("eval", HTMLElement).style.gridTemplateRows = `minmax(0, ${PAD - 6}fr) minmax(0, ${span + 12}fr) minmax(0, ${PAD - 6}fr)`;
    }
    const viewing = past ? ` Showing the position after move ${analysis.ply} of ${controller.moves.length}.` : "";
    board.setAttribute("aria-label", `Quoridor. ${describeBoard(state)}${viewing}`);
    renderViewing();
    board.classList.toggle("can-click", canMove);
    const text = statusText(controller, describeNetwork(modelState(), controller.size).short);
    if (statusLine.textContent !== text) statusLine.textContent = text;
    // Two bots playing on change the line with every move; keep it quiet and say the end of the game once.
    statusLine.setAttribute("aria-live", statusIsMuted(controller) ? "off" : "polite");
    if (!controller.hasHuman && controller.result !== null && announcedEnd !== controller.hash) {
      announcedEnd = controller.hash;
      announce(text);
    }
    renderSeats(state);
    renderControls();
    renderMoves();
    renderEval();
    renderAnalysis();
    renderNetwork();
    // Some browsers throw if the address is rewritten too often, and a progress bar needs no new address.
    if (location.hash !== controller.hash) history.replaceState(null, "", controller.hash);
  }

  function renderSeats(state: GameState): void {
    const players = controller.players;
    for (const side of SIDES) {
      const seat = players[side];
      const toMove = controller.result === null && controller.mover === side && !analysis.viewingPast;
      const note =
        seat === HUMAN
          ? playerName(players, side) === "You"
            ? "You play this side."
            : "A person plays this side."
          : toMove && controller.thinking
            ? `Thinking… ${levelSummary(seat)}.`
            : toMove && controller.waiting
              ? `Waiting for the network: ${describeNetwork(modelState(), controller.size).short}.`
              : `${levelSummary(seat)}.`;
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

  function renderControls(): void {
    const bots = !controller.hasHuman;
    element("bot-controls", HTMLElement).hidden = !bots;
    const published = networkPublished();
    const evalToggle = element("eval-toggle", HTMLElement);
    evalToggle.hidden = bots;
    evalToggle.classList.toggle("off", !published); // keeps its row, so the status line below does not move
    // Without a network there is nothing to analyse; the note takes the checkbox's place, so the card does not change size.
    element("analysis-label", HTMLElement).hidden = !published;
    element("analysis-off", HTMLElement).hidden = published;
    // Choices of board size and players wait for New game; the button says so while they differ from the game on the board.
    const pending = Number(sizeSelect.value) !== controller.size || SIDES.some((side) => playerOf(seatSelects[side]) !== controller.players[side]);
    newButton.classList.toggle("pending", pending);
    newButton.title = pending ? "Your choices of board size and players start when you press New game" : "";
    toggleButton.textContent = controller.running ? "Pause" : controller.moves.length > 0 && controller.result === null ? "Resume" : "Start";
    setEnabled(toggleButton, controller.running || controller.result === null);
    setEnabled(stepButton, controller.canStep);
    undoButton.hidden = bots;
    setEnabled(undoButton, controller.canUndo);
    retryButton.hidden = controller.error === null;
  }

  function renderEval(): void {
    const meter = element("eval", HTMLElement);
    // A person may hide the evaluation so as not to lean on it; two bots playing always show it.
    const visible = evalVisible();
    const ticks = visible && (!controller.hasHuman || analysisToggle.checked);
    const bar = evalBar(analysis.view, shownPercent, ticks ? controller.opinions(analysis.ply) : null);
    meter.classList.toggle("off", !visible);
    meter.setAttribute("aria-hidden", String(!visible));
    if (!bar.stale) shownPercent = bar.percent;
    meter.classList.toggle("empty", bar.percent === null);
    meter.classList.toggle("stale", bar.stale);
    if (bar.percent === null) meter.removeAttribute("aria-valuenow");
    else meter.setAttribute("aria-valuenow", String(bar.percent));
    meter.setAttribute("aria-valuetext", bar.label);
    element("eval-fill", HTMLElement).style.height = `${bar.percent ?? 0}%`;
    element("eval-p1", HTMLElement).textContent = bar.percent === null ? "–" : `${bar.percent}%`;
    element("eval-p2", HTMLElement).textContent = bar.percent === null ? "–" : `${100 - bar.percent}%`;
    for (const side of SIDES) {
      const tick = element(`tick-${side}`, HTMLElement);
      const value = bar.ticks[side];
      tick.hidden = value === null;
      if (value !== null) {
        tick.style.bottom = `${value}%`;
        tick.title = `${playerName(controller.players, side)}'s own estimate: player 1 ${value}%`;
      }
    }
  }

  /** Says which position is on the board: the latest, or an earlier one with the way back. Not read aloud with each change; the board's label carries it. */
  function renderViewing(): void {
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

  function renderAnalysis(): void {
    element("analysis-box", HTMLElement).hidden = !analysisOpen();
    if (!analysisOpen()) return;
    const view = analysis.view;
    const lines = element("analysis-lines", HTMLOListElement);
    const note = element("analysis-note", HTMLElement);
    const reading = view.status === "ready" ? view.reading.lines : [];
    const rows: HTMLLIElement[] = [];
    for (let i = 0; i < TOP_LINES; i++) {
      const line = reading[i];
      const item = document.createElement("li");
      if (line === undefined) item.className = "blank";
      else {
        const percent = Math.round(line.share * 100);
        item.className = i === 0 ? "best" : "";
        item.innerHTML = `<span class="rank">${i + 1}</span><span class="move"></span><span class="share"><span style="width:${percent}%"></span></span><span class="percent">${percent}%</span>`;
        item.querySelector(".move")!.textContent = line.move;
      }
      rows.push(item);
    }
    lines.replaceChildren(...rows);
    if (view.status === "ready") {
      note.textContent = reading.length > 0 ? "The player to move would choose these most often." : "The game is over here.";
      const sentence = analysis.takeAnnouncement();
      if (sentence) announce(sentence);
    } else {
      note.textContent =
        view.status === "unavailable"
          ? "Analysis needs the network, which is not ready."
          : view.status === "searching"
            ? "The network is reading this position."
            : `The analysis failed (${view.message}).`;
    }
  }

  let movesDrawn = "";

  function renderMoves(): void {
    const moves = controller.moves;
    const list = element("moves", HTMLOListElement);
    const signature = moves.join(".");
    if (signature !== movesDrawn) {
      movesDrawn = signature;
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
    if (canPlay() && preview.move(event.pointerType, targetAt(event))) render();
  });
  board.addEventListener("pointerleave", (event) => {
    if (preview.leave(event.pointerType)) render();
  });
  board.addEventListener("pointerup", (event) => {
    const target = targetAt(event);
    if (!canPlay()) return;
    const release = preview.release(event.pointerType, target);
    if (release === "play") play(target!);
    else if (release === "preview") {
      render();
      announce(`${describeTarget(controller.state, target!)}. Tap again to place it.`);
    } else render();
  });

  /** Steps through the game for a key (`back` and `forward` name the two arrows; Home and End jump to the ends); returns whether it was one. */
  function review(key: string, back: string, forward: string): boolean {
    if (key === back) analysis.step(-1);
    else if (key === forward) analysis.step(1);
    else if (key === "Home") analysis.goTo(0);
    else if (key === "End") analysis.goTo(controller.moves.length);
    else return false;
    return true;
  }

  /** Puts the keyboard cursor on the pawn of the side to move the first time the keyboard is used. */
  function startCursor(): GlobalAction {
    const state = controller.state;
    const mover = controller.mover === "p1" ? 0 : 1;
    return { kind: "move", row: state.row(mover), col: state.col(mover) };
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
    if (review(key, "PageUp", "PageDown")) {
      event.preventDefault();
      return;
    }
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
      if (canPlay()) play(cursor);
      else if (analysis.viewingPast) announce(`Viewing ${analysis.where}; choose Back to live to play.`);
      else announce(controller.hasHuman ? "It is not your move." : "Two bots are playing; choose Human for a side to play it.");
      return;
    }
    const next = moveCursor(cursor, key, controller.size);
    if (next === null) return;
    event.preventDefault();
    cursor = next;
    render();
    announce(`${describeTarget(controller.state, next)}.`);
  });

  /** Starts a game on the chosen board size with the chosen players. */
  function newGame(): void {
    preview.clear();
    analysis.reset();
    shownPercent = null;
    const size = Number(sizeSelect.value);
    // Before the game starts, so a bot that moves first does not search with another size's network.
    controller.setNetworkReady(models.state(size).status === "ready");
    controller.newGame(size, chosenPlayers());
    networkChanged();
    void models.select(controller.size);
  }

  /** Opens the game in the address bar's hash if it is one the site offers; otherwise says so. Returns whether it did. */
  function openHash(): boolean {
    try {
      const game = Game.fromHash(location.hash);
      // Before anything changes: a link may name a size the engine reads and the site does not offer.
      if (!isOfferedSize(game.size)) throw new RangeError(`The site has no ${game.size}x${game.size} board`);
      const chosen = chosenPlayers();
      const bot = chosen.p1 !== HUMAN ? chosen.p1 : chosen.p2 !== HUMAN ? chosen.p2 : STRONG;
      // The person plays the side to move, or player 1 if the game is over.
      const human: Side = game.result === null && !game.state.p1Turn ? "p2" : "p1";
      preview.clear();
      analysis.reset();
      shownPercent = null;
      controller.setNetworkReady(models.state(game.size).status === "ready");
      controller.load(game, human === "p1" ? { p1: HUMAN, p2: bot } : { p1: bot, p2: HUMAN });
      sizeSelect.value = String(controller.size);
      showPlayers(controller.players);
      seatsChosen = true;
      networkChanged();
      void models.select(controller.size);
      return true;
    } catch {
      announce("That link could not be opened, so it was ignored.");
      networkChanged();
      if (location.hash !== controller.hash) history.replaceState(null, "", controller.hash);
      return false;
    }
  }

  newButton.addEventListener("click", newGame);
  sizeSelect.addEventListener("change", () => {
    render();
    announce("Board size chosen. It applies when you press New game.");
  });
  for (const side of SIDES) {
    seatSelects[side].addEventListener("change", () => {
      seatsChosen = true;
      render();
      const seat = playerOf(seatSelects[side]);
      announce(`Player ${side === "p1" ? 1 : 2}: ${seat === HUMAN ? "a person" : `${seat.label}, ${levelSummary(seat)}`}. It applies when you press New game.`);
    });
  }
  element("swap", HTMLButtonElement).addEventListener("click", () => {
    const { p1, p2 } = chosenPlayers();
    showPlayers({ p1: p2, p2: p1 });
    seatsChosen = true;
    render();
    announce("Sides swapped. They apply when you press New game.");
  });
  showEval.addEventListener("change", () => {
    saveShowEval(showEval.checked);
    analysis.update();
  });
  onPress(toggleButton, () => (controller.running ? controller.pause() : controller.start()));
  onPress(stepButton, () => controller.step());
  speedSelect.addEventListener("change", () => controller.setSpeed(speedSelect.value as Speed));
  onPress(undoButton, () => controller.undo());
  retryButton.addEventListener("click", () => controller.retry());
  analysisToggle.addEventListener("change", () => analysis.update());
  onPress(element("step-live", HTMLButtonElement), () => analysis.goTo(controller.moves.length));
  // Left and Right step through the game from the move list and its buttons; Home and End jump to the ends.
  element("moves-title", HTMLElement).closest("section")!.addEventListener("keydown", (event) => {
    if (event.ctrlKey || event.metaKey || event.altKey || event.target instanceof HTMLInputElement) return;
    if (review(event.key, "ArrowLeft", "ArrowRight")) event.preventDefault();
  });
  onPress(element("step-first", HTMLButtonElement), () => analysis.goTo(0));
  onPress(element("step-prev", HTMLButtonElement), () => analysis.step(-1));
  onPress(element("step-next", HTMLButtonElement), () => analysis.step(1));
  onPress(element("step-last", HTMLButtonElement), () => analysis.goTo(controller.moves.length));
  networkRetry.addEventListener("click", () => void models.retry(controller.size));
  element("copy", HTMLButtonElement).addEventListener("click", () => {
    navigator.clipboard.writeText(location.href).then(
      () => announce("Link copied."),
      () => announce("Could not copy; the link is in the address bar."),
    );
  });
  window.addEventListener("hashchange", () => {
    if (location.hash !== controller.hash) openHash();
  });

  showPlayers(DEFAULT_PLAYERS);
  if (location.hash.length <= 1 || !openHash()) newGame();
  return controller;
}
