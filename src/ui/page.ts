import type { GlobalAction } from "../engine/actions";
import { Game } from "../engine/game";
import { Analysis } from "./analysis";
import { copyLink, recordHash, syncAddress } from "./address";
import { liveAnnouncer } from "./announce";
import { type Bot, botLabel, botOf, capFor, modelName, setModelLabel, TIME_SOURCES, withModel } from "./bots";
import { closePopoverOnEscapeOrOutside, element, onPress } from "./dom";
import { AutoControls } from "./autoControls";
import { type AutoHost, AutoPlay } from "./autoplay";
import { GamesCard } from "./gamesCard";
import { SeatWatch } from "./seatWatch";
import { botOfSeat, type GameRecord, GameHistory } from "./history";
import { ModelManager, type ModelState, type StartInfo } from "../model/manager";
import type { ModelEnv } from "../model/store";
import { GameController, HUMAN, isOfferedSize, type Players, samePlayer, type SearchPort, type Side, type Speed } from "./controller";
import { buildModelOptions, extraModels, modelTitle } from "./modelInfo";
import { describeNetwork } from "./networkText";
import { saveShowEval, savedShowEval, savedStorage } from "./persistence";
import { cellAt, wallAt } from "./geometry";
import { WallPreview } from "./pointer";
import { Tooltips } from "./tooltip";
import { visibleControls } from "./visibility";
import { SeatControls, type SeatContext, type ModelsView } from "./seatControls";
import { dropUnplayable, droppedSentence, SeatModels, setSeatPlayers } from "./seatModels";
import { supportsSize } from "../model/card";
import { statusIsMuted, statusText } from "./status";
import { describeTarget, findAction, moveCursor } from "./targets";
import { drawAnalysis } from "./view/analysis";
import { BoardView } from "./view/board";
import { drawControls } from "./view/controls";
import { EvalView } from "./view/eval";
import { drawViewing, MovesView } from "./view/moves";
import { drawNetwork } from "./view/network";
import { drawSeats } from "./view/seats";

/** How the page gets the network: where to fetch it from, and how to give it to the search worker. */
export interface NetworkSource {
  readonly env: ModelEnv;
  readonly start: (model: ArrayBuffer, info: StartInfo) => Promise<void>;
  /** Frees the worker's session for a model that is no longer used. */
  readonly stop?: (id: string) => Promise<void>;
}

const SIDES = ["p1", "p2"] as const;
const NORMAL = botOf("normal");
/** A visitor plays player 1 against Strong, the network at 32 searches, unless they choose otherwise. */
const DEFAULT_PLAYERS: Players = { p1: HUMAN, p2: botOf("strong") };

/** Wires the controller to the page: draws the position, the players and the eval bar, and turns clicks and keys into moves. */
export function startPage(port: SearchPort, network: NetworkSource): GameController {
  const board = element("board", SVGSVGElement);
  const sizeSelect = element("size", HTMLSelectElement);
  const speedSelect = element("speed", HTMLSelectElement);
  const statusLine = element("status", HTMLElement);
  const retryButton = element("retry", HTMLButtonElement);
  const undoButton = element("undo", HTMLButtonElement);
  const toggleButton = element("toggle", HTMLButtonElement);
  const stepButton = element("step", HTMLButtonElement);
  const analysisToggle = element("analysis-toggle", HTMLInputElement);
  const networkRetry = element("network-retry", HTMLButtonElement);
  const showEval = element("show-eval", HTMLInputElement);
  const newButton = element("new", HTMLButtonElement);
  showEval.checked = savedShowEval();
  closePopoverOnEscapeOrOutside(element("network", HTMLDetailsElement), document);
  closePopoverOnEscapeOrOutside(element("view", HTMLDetailsElement), document);
  const tooltips = new Tooltips(document);

  const preview = new WallPreview();
  let cursor: GlobalAction | null = null; // shown only once the keyboard is in use on the board
  const boardView = new BoardView(board);
  const evalView = new EvalView();
  const movesView = new MovesView();
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

  const announce = liveAnnouncer(element("live", HTMLElement));

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
  /** The evaluation is shown: a network is published, and either two bots play or the viewer left "Evaluation bar" on in the View menu. */
  const controlsNow = () => visibleControls(controller.players, { networkPublished: networkPublished(), showEvaluation: showEval.checked, gameOver: controller.result !== null });
  const evalVisible = (): boolean => controlsNow().evalBar;
  const analysisOpen = (): boolean => networkPublished() && analysisToggle.checked;
  // Readings cost searches: they are made only for the eval bar or the Analysis list, when one of them is showing.
  const analysis = new Analysis(controller, port, () => modelState().status === "ready", render, () => evalVisible() || analysisOpen());

  const gameLog = new GameHistory(savedStorage());
  const seatWatch = new SeatWatch();
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
      evalView.reset();
      showPlayers(players);
      controller.setNetworkReady(models.state(game.size).status === "ready");
      controller.load(game, players);
      seatWatch.begin(players);
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
    const hash = recordHash(record);
    const seat = record.p2.kind === "bot" ? record.p2 : record.p1.kind === "bot" ? record.p1 : null;
    carriedBot = seat === null ? null : botOfSeat(seat);
    if (location.hash !== hash) {
      location.hash = hash;
      return;
    }
    // The game is already on the board, so the address will not change: open it here, which ends auto-play and gives a person a seat.
    const wasAuto = autoplay.active;
    openHash();
    announce(`${wasAuto ? "Auto-play stopped. " : ""}Game ${record.id} is on the board; you play it.`);
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

  const networkShort = (id: string | null): string => describeNetwork(id === null ? modelState() : models.stateFor(id, controller.size), controller.size).short;

  function render(): void {
    const canMove = canPlay();
    const state = boardView.draw(controller, analysis, canMove, preview.wall, cursor);
    drawViewing(controller, analysis);
    const waitingModel = controller.waitingModel;
    const text = statusText(controller, networkShort(waitingModel), waitingModel === null ? undefined : modelName(waitingModel));
    if (statusLine.textContent !== text) statusLine.textContent = text;
    // Two bots playing on change the line with every move; keep it quiet, also after the end, and say the end of the game once through #live.
    statusLine.setAttribute("aria-live", statusIsMuted(controller) || quietStatus ? "off" : "polite");
    const result = controller.result;
    seatWatch.observe(controller.players, controller.moves.length);
    if (result === null) {
      recordedHash = "";
      announcedEnd = "";
    } else if (recordedHash !== controller.hash) {
      recordedHash = controller.hash;
      const seats = seatWatch.seats ?? controller.players;
      gameLog.add({ size: controller.size, p1: seats.p1, p2: seats.p2, winner: result.winner, reason: result.reason, moves: controller.moves, seatChanged: seatWatch.changed });
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
    drawSeats(state, controller, analysis.viewingPast, controls, networkShort);
    drawControls(controlsNow(), controller, autoplay.countdown !== null);
    games.draw();
    autoControls.draw();
    movesView.draw(controller, analysis);
    evalView.draw(controller, analysis, evalVisible(), analysisToggle.checked, tooltips);
    drawAnalysis(controller, analysis, analysisOpen(), announce);
    drawNetwork(modelState(), controller.size);
    syncAddress(controller.hash);
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
    evalView.reset();
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
      evalView.reset();
      controller.setNetworkReady(models.state(game.size).status === "ready");
      // The bot is fitted to the link's board size.
      const seats: Players = human === "p1" ? { p1: HUMAN, p2: bot } : { p1: bot, p2: HUMAN };
      controller.load(game, seats);
      seatWatch.begin(seats);
      sizeSelect.value = String(controller.size);
      showPlayers(controller.players);
      seatsChosen = true;
      networkChanged();
      void models.select(controller.size);
      return true;
    } catch {
      announce("That link could not be opened, so it was ignored.");
      networkChanged();
      syncAddress(controller.hash);
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
    copyLink(announce);
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
