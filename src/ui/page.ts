import type { GlobalAction } from "../engine/actions";
import { Game } from "../engine/game";
import type { GameState } from "../engine/state";
import { ANALYSIS_SIMULATIONS, Analysis, replay } from "./analysis";
import { type Bot, botLabel, botOf, capFor, modelName, setModelLabel, TIME_SOURCES, withModel } from "./bots";
import { describeBoard, renderBoard, wallOwners } from "./board";
import { closePopoverOnEscapeOrOutside, element, onPress, setEnabled } from "./dom";
import { AutoControls } from "./autoControls";
import { type AutoHost, AutoPlay } from "./autoplay";
import { GamesCard } from "./gamesCard";
import { botOfSeat, type GameRecord, GameHistory, type StorageLike } from "./history";
import { ModelManager, type ModelState, type StartInfo } from "../model/manager";
import type { ModelEnv } from "../model/store";
import { GameController, HUMAN, isOfferedSize, type Players, samePlayer, type SearchPort, type Side, sideOf, type Speed } from "./controller";
import { evalBar } from "./evalBar";
import { buildModelOptions, extraModels, modelTitle } from "./modelInfo";
import { barBlurb, markerBlurb } from "./evalTip";
import { boardSpan, cellAt, PAD, wallAt } from "./geometry";
import { WallPreview } from "./pointer";
import { Tooltips } from "./tooltip";
import { visibleControls } from "./visibility";
import { SeatControls, type SeatContext, type ModelsView } from "./seatControls";
import { dropUnplayable, droppedSentence, SeatModels, setSeatPlayers } from "./seatModels";
import { supportsSize } from "../model/card";
import { botsArePlaying, moveRows, playerName, statusIsMuted, statusText } from "./status";
import { describeTarget, findAction, moveCursor, pawnTargets } from "./targets";

/** How the page gets the network: where to fetch it from, and how to give it to the search worker. */
export interface NetworkSource {
  readonly env: ModelEnv;
  readonly start: (model: ArrayBuffer, info: StartInfo) => Promise<void>;
  /** Frees the worker's session for a model that is no longer used. */
  readonly stop?: (id: string) => Promise<void>;
}

const SIDES = ["p1", "p2"] as const;
/** How many suggested moves the analysis lists; matches the three rows reserved for them. */
const TOP_LINES = 3;
const NORMAL = botOf("normal");
/** A visitor plays player 1 against Strong, the network at 32 searches, unless they choose otherwise. */
const DEFAULT_PLAYERS: Players = { p1: HUMAN, p2: botOf("strong") };

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

/** The browser's storage, or null where it is blocked. */
function savedStorage(): StorageLike | null {
  try {
    return localStorage;
  } catch {
    return null;
  }
}

const megabytes = (bytes: number): string => (bytes / 1e6).toFixed(1);

/** Where the network stands, in words: the chip in the top bar with its popover, and the short form for a bot that waits for it. */
function describeNetwork(state: ModelState, size: number): { line: string; short: string; chip: string; tone: "ok" | "busy" | "off" | "bad" } {
  switch (state.status) {
    case "checking":
      return { line: "Network: looking for it…", short: "looking for it", chip: "checking", tone: "busy" };
    case "idle":
      return { line: "Network: not loaded.", short: "not loaded", chip: "not loaded", tone: "off" };
    case "unavailable":
      if (state.reason === "bad-card" || state.reason === "unknown-model" || state.reason === "unsupported-size") {
        return { line: `Network: not usable. ${state.message ?? ""}`.trim(), short: "not usable", chip: "not usable", tone: "bad" };
      }
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
  const tooltips = new Tooltips(document);

  const preview = new WallPreview();
  let cursor: GlobalAction | null = null; // shown only once the keyboard is in use on the board
  let drawn = "";
  let ownersKey = "";
  let owners = new Map<string, 0 | 1>();
  /** The eval bar's last fresh percentage, kept (dimmed) while the next position is read. */
  let shownPercent: number | null = null;
  /** Whether the viewer has picked a seat, or opened a link that did: until then the seats are the site's default, which follows the network. */
  let seatsChosen = false;
  /** The game whose end was last put in the history, so a finished game is listed once, and not one that was only opened. */
  let recordedHash = "";
  /** The game whose end was last announced, so a finished game of two bots is announced once. */
  let announcedEnd = "";
  /** The status line is not read aloud for a moment after a seat change, which announces itself; it is polite again after. */
  let quietStatus = false;
  const quietForSeatChange = (): void => {
    quietStatus = true;
    setTimeout(() => {
      quietStatus = false;
      render();
    }, 300);
  };

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
  }, network.stop);
  const modelState = (): ModelState => models.state(controller.size);
  /** Gallery models the seats of the game on the board search with. */
  const seatModelIds = (): string[] => SIDES.flatMap((side) => {
    const seat = controller.players[side];
    return seat !== HUMAN && seat.model !== undefined ? [seat.model] : [];
  });
  const modelStatusSaid = (id: string, state: ModelState): void => {
    const title = modelName(id);
    const why = state.status === "failed" || state.status === "unavailable" ? (state.message ?? "") : "";
    announce(state.status === "ready" ? `${title} is ready.` : `${title} could not be loaded. ${why}`.trim());
  };
  const seatModels = new SeatModels(models, modelStatusSaid);
  /** Cards are read once, only when there is a model to choose beyond the main bot; their labels name the models in summaries and blurbs. */
  const cardsAsked = new Set<string>();
  const cardsFailed = new Set<string>();
  const askForCards = (): void => {
    const main = models.mainIdFor(controller.size);
    const extras = extraModels(main, models.gallery);
    if (extras.length === 0) return;
    for (const id of main === null ? extras : [main, ...extras]) {
      if (cardsAsked.has(id)) continue;
      cardsAsked.add(id);
      models.card(id).then(
        (card) => {
          setModelLabel(id, modelTitle(id, card));
          reconcileModels();
          render();
        },
        () => {
          cardsFailed.add(id);
          render();
        },
      );
    }
  };
  const modelsView = (): ModelsView => {
    const mainId = models.mainIdFor(controller.size);
    return {
      mainId,
      options: buildModelOptions({ mainId, gallery: models.gallery, card: (id) => models.cardIfLoaded(id), size: controller.size, cardFailed: (id) => cardsFailed.has(id) }),
      card: (id) => models.cardIfLoaded(id),
      state: (id) => models.stateFor(id, controller.size),
      offered: (id, size) => {
        if (models.publishesAny === null) return true;
        const card = models.cardIfLoaded(id);
        return models.gallery.includes(id) && id !== models.mainIdFor(size) && (card === null || supportsSize(card, size));
      },
    };
  };
  /** False once the model index is read and publishes no network at any size; true while that is not known yet. */
  const networkPublished = (): boolean => models.publishesAny !== false;
  /** The evaluation is shown: a network is published, and either two bots play or the viewer left "Show evaluation" on. */
  const controlsNow = () => visibleControls(controller.players, { networkPublished: networkPublished(), showEvaluation: showEval.checked, gameOver: controller.result !== null });
  const evalVisible = (): boolean => controlsNow().evalBar;
  const analysisOpen = (): boolean => networkPublished() && analysisToggle.checked;
  // Readings cost searches: they are made only for the eval bar or the Analysis list, when one of them is showing.
  const analysis = new Analysis(controller, port, () => modelState().status === "ready", render, () => evalVisible() || analysisOpen());

  const gameLog = new GameHistory(savedStorage());
  const games = new GamesCard(gameLog, announce, () => statusLine.focus(), () => (controller.moves.length > 0 && controller.result === null) || autoplay.active, openRecord);
  const autoHost: AutoHost = {
    get size() {
      return controller.size;
    },
    get players() {
      return controller.players;
    },
    get hasHuman() {
      return controller.hasHuman;
    },
    get running() {
      return controller.running;
    },
    get result() {
      return controller.result;
    },
    get moves() {
      return controller.moves;
    },
    load(game, players) {
      preview.clear();
      analysis.reset();
      shownPercent = null;
      showPlayers(players);
      controller.setNetworkReady(models.state(game.size).status === "ready");
      controller.load(game, players);
      networkChanged();
      void models.select(controller.size);
    },
    start: () => controller.start(),
  };
  const autoplay = new AutoPlay(autoHost, Math.random, () => render());
  const autoControls = new AutoControls(autoplay, () => toggleButton.focus());

  /** The bot a game opened from the history was played by, kept until the address change opens it. */
  let carriedBot: Bot | null = null;
  /** The bot fitted to the board it will play: simulations within the board's cap, and its model only if that model plays there. */
  const fitCarried = (bot: Bot, size: number): Bot => {
    const model = bot.model !== undefined && modelsView().offered(bot.model, size) ? bot.model : undefined;
    return withModel({ ...bot, simulations: Math.min(bot.simulations, capFor(bot.engine, size)) }, model);
  };
  /** Opens a game from the Games card as a link would, with the bot that played it (the person takes the other side). */
  function openRecord(record: GameRecord): void {
    const hash = `#n=${record.size}&m=${record.moves}`;
    if (location.hash === hash) return;
    const seat = record.p2.kind === "bot" ? record.p2 : record.p1.kind === "bot" ? record.p1 : null;
    carriedBot = seat === null ? null : botOfSeat(seat);
    location.hash = hash;
  }

  /** A person may move: it is a person's turn, and the position on the board is the latest. */
  const canPlay = (): boolean => controller.humanToMove && !analysis.viewingPast;

  const seatContext = (side: Side) => (): SeatContext => {
    const state = modelState();
    return { size: controller.size, networkOff: state.status === "unavailable", model: state.status === "ready" ? state.model : null, moveTime: controller.moveTime(side), models: modelsView() };
  };
  /** A change to one seat's controls reaches the game at once; the board size alone waits for New game. */
  const seatEdited = (side: Side) => (announcement: string | null): void => {
    seatsChosen = true;
    const hadHuman = controller.hasHuman;
    // The sentence below says it; the status line stays quiet for this change, so a toggle is read once.
    quietForSeatChange();
    setSeatPlayers(controller, { ...controller.players, [side]: controls[side].player }, syncSeatModels);
    render();
    if (hadHuman !== controller.hasHuman) announce(controller.hasHuman ? `${announcement ?? ""} Undo and How to move are shown; Start is hidden.`.trim() : "Both players are bots: press Start to watch.");
    else if (announcement !== null) announce(announcement);
  };
  const retryModel = (id: string): void => {
    seatModels.retry(id);
  };
  const controls = { p1: new SeatControls("p1", seatContext("p1"), seatEdited("p1"), retryModel), p2: new SeatControls("p2", seatContext("p2"), seatEdited("p2"), retryModel) };
  const chosenPlayers = (): Players => ({ p1: controls.p1.player, p2: controls.p2.player });
  const showPlayers = (players: Players): void => {
    for (const side of SIDES) controls[side].set(players[side]);
  };

  /**
   * After the network changed: the bots that wait for it may move, the choices
   * it cannot play at this size are switched off, and a seat that had one of
   * them goes to Normal (said aloud).
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
        const chosen = controls[side].player;
        const lost = seat !== HUMAN && seat.engine === "network" ? seat : chosen !== HUMAN && chosen.engine === "network" ? chosen : null;
        if (seat !== HUMAN && seat.engine === "network") players[side] = NORMAL;
        if (chosen !== HUMAN && chosen.engine === "network") controls[side].set(NORMAL);
        if (lost !== null && !silent) {
          const why = state.reason === "none-published" ? "which is not published yet" : "which is not offered at this board size";
          announce(`${botLabel(lost)} needs the network, ${why}, so player ${side === "p1" ? 1 : 2} plays ${botLabel(NORMAL)}.`);
        }
      }
      if (!samePlayer(players.p1, controller.players.p1) || !samePlayer(players.p2, controller.players.p2)) controller.setPlayers(players);
    }
    if (state.status !== announcedModel) {
      announcedModel = state.status;
      if (state.status === "downloading") announce("Downloading the network for Strong and Max.");
      else if (state.status === "ready" || state.status === "failed") announce(describeNetwork(state, controller.size).line);
    }
    controller.setNetworkReady(state.status === "ready");
    askForCards();
    reconcileModels();
    syncSeatModels();
    analysis.update();
  }

  /** A seat whose model the board does not offer (its card was read after it was picked, or the board changed) plays the main bot, said aloud. */
  function reconcileModels(): void {
    const { players, dropped } = dropUnplayable(controller.players, modelsView().offered, controller.size);
    const sentence = droppedSentence(dropped, controller.size, modelName);
    if (sentence === null) return;
    for (const { side } of dropped) controls[side].set(players[side]);
    setSeatPlayers(controller, players, syncSeatModels);
    announce(sentence);
  }

  /** Loads the gallery models the seats hold and frees those no seat holds; tells the controller which are ready. */
  function syncSeatModels(): void {
    seatModels.sync(seatModelIds(), (id) => models.stateFor(id, controller.size));
    controller.setReadyModels(new Set(seatModelIds().filter((id) => models.stateFor(id, controller.size).status === "ready")));
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
    const waitingModel = controller.waitingModel;
    const text =
      waitingModel === null
        ? statusText(controller, describeNetwork(modelState(), controller.size).short)
        : statusText(controller, describeNetwork(models.stateFor(waitingModel, controller.size), controller.size).short, modelName(waitingModel));
    if (statusLine.textContent !== text) statusLine.textContent = text;
    // Two bots playing on change the line with every move; keep it quiet, also after the end, and say the end of the game once through #live.
    statusLine.setAttribute("aria-live", statusIsMuted(controller) || quietStatus ? "off" : "polite");
    const result = controller.result;
    if (result === null) {
      recordedHash = "";
      announcedEnd = "";
    } else if (recordedHash !== controller.hash) {
      recordedHash = controller.hash;
      gameLog.add({ size: controller.size, p1: controller.players.p1, p2: controller.players.p2, winner: result.winner, reason: result.reason, moves: controller.moves });
    }
    autoplay.update();
    // The end of a game and the countdown that follows it are one sentence, read once.
    const sentences: string[] = [];
    if (!controller.hasHuman && result !== null && announcedEnd !== controller.hash) {
      announcedEnd = controller.hash;
      sentences.push(text);
    }
    const countdown = autoplay.takeAnnouncement();
    if (countdown !== null) sentences.push(countdown);
    if (sentences.length > 0) announce(sentences.join(" "));
    renderSeats(state);
    renderControls();
    games.draw();
    autoControls.draw();
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
            ? "Thinking…"
            : toMove && controller.waiting
              ? controller.waitingModel === null
                ? `Waiting for the network: ${describeNetwork(modelState(), controller.size).short}.`
                : `Waiting for ${modelName(controller.waitingModel)}: ${describeNetwork(models.stateFor(controller.waitingModel, controller.size), controller.size).short}.`
              : "";
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

  function renderControls(): void {
    const shown = controlsNow();
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
    toggleButton.textContent = shown.startBlocked ? (autoplay.countdown !== null ? "Game over: next game starting" : "Game over: press New game") : controller.running ? "Pause" : controller.moves.length > 0 ? "Resume" : "Start";
    setEnabled(toggleButton, !shown.startBlocked);
    setEnabled(stepButton, controller.canStep);
    setEnabled(undoButton, controller.canUndo);
    // The row is about to go; keep the keyboard on the page instead of dropping it to the top.
    if (controller.error === null && document.activeElement === retryButton) statusLine.focus();
    element("retry-row", HTMLElement).hidden = controller.error === null;
  }

  /** Sets a blurb's text; one that is open updates in place, and nothing is announced. */
  function setTip(id: string, text: string): void {
    const tip = element(id, HTMLElement);
    if (tip.textContent !== text) tip.textContent = text;
  }

  function renderEval(): void {
    const container = element("eval", HTMLElement);
    const meter = element("eval-meter", HTMLElement);
    // A person may hide the evaluation so as not to lean on it; two bots playing always show it.
    const visible = evalVisible();
    const ticks = visible && (!controller.hasHuman || analysisToggle.checked);
    const bar = evalBar(analysis.view, shownPercent, ticks ? controller.opinions(analysis.ply) : null);
    container.classList.toggle("off", !visible);
    container.setAttribute("aria-hidden", String(!visible));
    if (!bar.stale) shownPercent = bar.percent;
    container.classList.toggle("empty", bar.percent === null);
    container.classList.toggle("stale", bar.stale);
    if (bar.percent === null) meter.removeAttribute("aria-valuenow");
    else meter.setAttribute("aria-valuenow", String(bar.percent));
    meter.setAttribute("aria-valuetext", bar.label);
    element("eval-fill", HTMLElement).style.height = `${bar.percent ?? 0}%`;
    element("eval-p1", HTMLElement).textContent = bar.percent === null ? "–" : `${bar.percent}%`;
    element("eval-p2", HTMLElement).textContent = bar.percent === null ? "–" : `${100 - bar.percent}%`;
    const sources = ticks ? controller.opinionSources(analysis.ply) : null;
    for (const side of SIDES) {
      const tick = element(`tick-${side}`, HTMLElement);
      const value = bar.ticks[side];
      tick.hidden = value === null;
      if (value !== null) tick.style.bottom = `${value}%`;
      setTip(`tip-${side}`, markerBlurb({ side, seat: controller.players[side], p1Percent: value, source: sources?.[side] ?? null, viewingPast: analysis.viewingPast }));
    }
    const status = analysis.view.status;
    setTip("tip-bar", barBlurb({ percent: bar.percent, stale: bar.stale, unavailable: status === "unavailable", failed: status === "failed", ply: analysis.ply, moves: controller.moves.length, simulations: ANALYSIS_SIMULATIONS }));
    tooltips.refresh();
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
      // While two bots play on, a new reading arrives with every move; it stays on screen but is not read aloud.
      const sentence = botsArePlaying(controller) ? null : analysis.takeAnnouncement();
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
    autoplay.interrupt();
    preview.clear();
    analysis.reset();
    shownPercent = null;
    const size = Number(sizeSelect.value);
    // Before the game starts, so a bot that moves first does not search with another size's network.
    controller.setNetworkReady(models.state(size).status === "ready");
    const chosen: Players = { p1: controls.p1.playerFor(size), p2: controls.p2.playerFor(size) };
    // A model that does not play the new board (an fc model off its size) gives way to the main bot, said once for both seats.
    const { dropped } = dropUnplayable(chosenPlayers(), modelsView().offered, size);
    const sentence = droppedSentence(dropped, size, modelName);
    if (sentence !== null) announce(sentence);
    for (const { side } of dropped) controls[side].set(chosen[side]);
    controller.newGame(size, chosen);
    networkChanged();
    void models.select(controller.size);
  }

  /** Opens the game in the address bar's hash if it is one the site offers; otherwise says so. Returns whether it did. */
  function openHash(): boolean {
    try {
      const game = Game.fromHash(location.hash);
      // Before anything changes: a link may name a size the engine reads and the site does not offer.
      if (!isOfferedSize(game.size)) throw new RangeError(`The site has no ${game.size}x${game.size} board`);
      const chosen: Players = { p1: controls.p1.playerFor(game.size), p2: controls.p2.playerFor(game.size) };
      const carried = carriedBot;
      carriedBot = null;
      // A game opened from the history keeps the bot that played it, model included.
      const bot = carried !== null ? fitCarried(carried, game.size) : chosen.p1 !== HUMAN ? chosen.p1 : chosen.p2 !== HUMAN ? chosen.p2 : DEFAULT_PLAYERS.p2;
      // The person plays the side to move, or player 1 if the game is over.
      const human: Side = game.result === null && !game.state.p1Turn ? "p2" : "p1";
      autoplay.interrupt();
      // A game that is already over is shown, not played, so it is not listed again.
      if (game.result !== null) recordedHash = game.toHash();
      preview.clear();
      analysis.reset();
      shownPercent = null;
      controller.setNetworkReady(models.state(game.size).status === "ready");
      // The bot is fitted to the link's board size.
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
    const size = Number(sizeSelect.value);
    const lowered = SIDES.flatMap((side) => {
      const was = controls[side].player;
      const now = controls[side].playerFor(size);
      return was !== HUMAN && now !== HUMAN && now.simulations < was.simulations ? [`player ${side === "p1" ? 1 : 2} to ${now.simulations}`] : [];
    });
    const limit = lowered.length === 0 ? "" : ` Limit ${capFor("network", size)} on ${size} × ${size}: simulations will be lowered, ${lowered.join(" and ")}.`;
    announce(`Board size chosen. It applies when you press New game.${limit}`);
  });
  element("swap", HTMLButtonElement).addEventListener("click", () => {
    const { p1, p2 } = chosenPlayers();
    showPlayers({ p1: p2, p2: p1 });
    seatsChosen = true;
    quietForSeatChange();
    setSeatPlayers(controller, { p1: p2, p2: p1 }, syncSeatModels);
    render();
    announce("Sides swapped.");
  });
  showEval.addEventListener("change", () => {
    saveShowEval(showEval.checked);
    analysis.update();
  });
  onPress(toggleButton, () => {
    if (!controller.running) autoplay.start();
    else {
      autoplay.pause();
      controller.pause();
    }
  });
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
    else carriedBot = null;
  });

  element("time-sources", HTMLElement).textContent = `Times for the main network and models made like it: ${TIME_SOURCES.network}. ${TIME_SOURCES.others.map((source) => `${source}. `).join("")}Times for the heuristic: ${TIME_SOURCES.heuristic}. "On this device" is the page's own clock for the bot's latest move.`;
  showPlayers(DEFAULT_PLAYERS);
  if (location.hash.length <= 1 || !openHash()) newGame();
  return controller;
}
