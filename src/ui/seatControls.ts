import type { ModelCard } from "../model/card";
import type { ModelState } from "../model/manager";
import { type Bot, botLabel, botOf, botSummary, describeEstimate, estimateMs, fitTo, formatMs, PRESETS, presetOf, sameBot, stepsFor, timeModelOf, withModel } from "./bots";
import { HUMAN, type MoveTime, type Player, type Side } from "./controller";
import { playableModel } from "./seatModels";
import { choiceOf, CUSTOM, ENGINE_GROUPS, seatAfterChoice } from "./seatChoice";
import { describeModelStatus, FIRST_USE_NOTE, MAIN_MODEL, type ModelOption, modelTitle, offSizeNote, strengthDetail, strengthLine } from "./modelInfo";

const DEFAULT_BOT: Bot = botOf("strong");

/** What the seats know about the published models. */
export interface ModelsView {
  /** The entries of the Network select for the board; empty when there is only one network, and the select is then not shown. */
  readonly options: readonly ModelOption[];
  /** The model that plays the board as the main bot, or null before it is known. */
  readonly mainId: string | null;
  readonly card: (id: string) => ModelCard | null;
  readonly state: (id: string) => ModelState;
  /** Whether the gallery has the model and it plays this board size (a card not read yet cannot say no). */
  readonly offered: (id: string, size: number) => boolean;
}

/** What a seat's controls need to know about the page when they are drawn. */
export interface SeatContext {
  /** The board size of the game on the board; the seats are fitted to it. */
  readonly size: number;
  /** True when no network can play at this size, so the choices that need it are off. */
  readonly networkOff: boolean;
  /** The network that would play, if known; the measured times belong to one network only. */
  readonly model: string | null;
  /** The seat's latest bot move in the game on the board, by the page's clock. */
  readonly moveTime: MoveTime | null;
  readonly models: ModelsView;
}

/** Creates an element with the given properties and appends it to `parent`. */
function make<K extends keyof HTMLElementTagNameMap>(tag: K, parent: Element, props: Partial<Record<"id" | "className" | "textContent" | "htmlFor", string>> = {}): HTMLElementTagNameMap[K] {
  const created = document.createElement(tag);
  Object.assign(created, props);
  parent.append(created);
  return created;
}

function setText(target: HTMLElement, text: string): void {
  if (target.textContent !== text) target.textContent = text;
}

/**
 * The controls of one seat. One select says what the player is: Human, a heuristic level (Beginner, Normal)
 * or a neural-network level (Strong, Max), each engine with a Custom entry that names settings no preset has.
 * A network bot has a Network select when more than one network is published. The simulations and "Vary
 * moves" sit in a disclosure whose one-line summary gives the budget and the time a move. The page reads the
 * seat with `player`. `onEdit` is called after each change, with a sentence to announce or null when the
 * control already announces itself (the slider); the page applies the change to the game at once.
 */
export class SeatControls {
  private human = true;
  private bot: Bot = DEFAULT_BOT;
  /** The simulations the person last chose (0: none yet), restored when a larger board's cap no longer lowers them. */
  private wanted = 0;
  /** Whether the bot had a preset's name at the last drawing, to open the settings when it becomes Custom. */
  private wasNamed = true;
  /** The gallery model a network bot searches with; undefined is the main model. A heuristic bot has none: choosing one clears it. */
  private model: string | undefined;
  private readonly choice: HTMLSelectElement;
  private readonly networkGroup: HTMLOptGroupElement;
  private readonly settings: HTMLElement;
  private readonly more: HTMLDetailsElement;
  private readonly summary: HTMLElement;
  private readonly slider: HTMLInputElement;
  private readonly value: HTMLOutputElement;
  private readonly estimate: HTMLElement;
  private readonly vary: HTMLInputElement;
  private readonly modelBox: HTMLElement;
  private readonly modelSelect: HTMLSelectElement;
  private readonly modelStatus: HTMLElement;
  private readonly modelProgress: HTMLProgressElement;
  private readonly modelRetry: HTMLButtonElement;
  private readonly modelOffSize: HTMLElement;
  private readonly modelStrength: HTMLElement;
  private readonly modelDetail: HTMLElement;
  private readonly modelDetailBox: HTMLElement;

  constructor(
    private readonly side: Side,
    private readonly context: () => SeatContext,
    onEdit: (announcement: string | null) => void,
    onRetry: (model: string) => void,
  ) {
    const id = (name: string): string => `${name}-${side}`;
    this.choice = document.getElementById(id("player")) as HTMLSelectElement;
    this.settings = document.getElementById(id("bot"))!;
    make("option", this.choice, { textContent: "Human" }).value = HUMAN;
    const groups = ENGINE_GROUPS.map(({ engine, label }) => {
      const group = make("optgroup", this.choice);
      group.label = label;
      for (const preset of PRESETS.filter((candidate) => candidate.engine === engine)) make("option", group, { textContent: preset.label }).value = preset.id;
      make("option", group, { textContent: "Custom" }).value = CUSTOM[engine];
      return group;
    });
    this.networkGroup = groups[ENGINE_GROUPS.findIndex((group) => group.engine === "network")]!;

    // The network comes first: it is the choice that decides who the opponent is, so it is not tucked away.
    this.modelBox = make("div", this.settings, { className: "model-box" });
    this.modelBox.hidden = true;
    const modelField = make("label", this.modelBox, { className: "field", textContent: "Network" });
    this.modelSelect = make("select", modelField, { id: id("model") });
    const statusRow = make("div", this.modelBox, { className: "model-status-row" });
    this.modelStatus = make("p", statusRow, { id: id("model-status"), className: "seat-hint model-status" });
    const actions = make("div", statusRow, { className: "model-actions" });
    this.modelProgress = make("progress", actions, { className: "model-progress" });
    this.modelProgress.setAttribute("aria-label", `Player ${side === "p1" ? 1 : 2} network download`);
    this.modelRetry = make("button", actions, { className: "model-retry", textContent: "Retry download" });
    this.modelRetry.type = "button";
    this.modelOffSize = make("p", this.modelBox, { id: id("model-offsize"), className: "seat-hint model-offsize" });
    this.modelStrength = make("p", this.modelBox, { id: id("model-strength"), className: "seat-hint model-strength" });
    this.modelDetailBox = make("details", this.modelBox, { className: "model-detail" });
    make("summary", this.modelDetailBox, { textContent: "How this was measured" });
    this.modelDetail = make("p", this.modelDetailBox, { className: "seat-hint" });
    this.modelSelect.setAttribute("aria-describedby", `${this.modelStatus.id} ${this.modelOffSize.id} ${this.modelStrength.id}`);

    this.more = make("details", this.settings, { className: "seat-more" });
    this.summary = make("summary", this.more);
    const body = make("div", this.more, { className: "seat-more-body" });
    const simulations = make("div", body, { className: "sims-row" });
    make("label", simulations, { htmlFor: id("sims"), textContent: "Simulations" });
    this.slider = make("input", simulations, { id: id("sims") });
    this.slider.type = "range";
    this.slider.step = "1";
    this.slider.min = "0";
    this.value = make("output", simulations, { id: id("sims-value") });
    this.value.htmlFor = this.slider.id;
    // The slider's aria-valuetext says the value; an output is a live region and would say it again.
    this.value.setAttribute("aria-hidden", "true");
    const varyLabel = make("label", body, { className: "check" });
    this.vary = make("input", varyLabel, { id: id("vary") });
    this.vary.type = "checkbox";
    varyLabel.append(" Vary moves");
    const varyNote = make("span", varyLabel, { id: id("vary-note"), className: "seat-hint", textContent: "so games differ" });
    this.vary.setAttribute("aria-describedby", varyNote.id);
    this.estimate = make("p", body, { id: id("estimate"), className: "seat-hint estimate" });
    this.slider.setAttribute("aria-describedby", this.estimate.id);

    /** Applies a change to the bot; `remember` keeps its simulations as the person's choice. */
    const edit = (bot: Bot, announce: boolean, remember: boolean): void => {
      if (remember) this.wanted = bot.simulations;
      this.bot = fitTo(bot, this.context().size);
      this.draw();
      onEdit(announce ? this.describe() : null);
    };
    this.choice.addEventListener("change", () => {
      const next = seatAfterChoice({ human: this.human, bot: this.bot, model: this.model }, this.choice.value);
      if (next === null) {
        this.draw();
        return;
      }
      ({ human: this.human, model: this.model } = next);
      if (!next.human) {
        edit(next.bot, true, true);
        return;
      }
      this.draw();
      onEdit(this.describe());
    });
    // Dragging only previews the value (label, estimate); the game gets it when the slider is released or a key step is made.
    this.slider.addEventListener("input", () => {
      const step = stepsFor(this.bot.engine, this.context().size)[Number(this.slider.value)];
      if (step === undefined) return;
      this.wanted = step;
      this.bot = fitTo({ ...this.bot, simulations: step }, this.context().size);
      this.draw();
    });
    this.slider.addEventListener("change", () => onEdit(null));
    this.vary.addEventListener("change", () => edit({ ...this.bot, vary: this.vary.checked }, true, false));
    this.modelSelect.addEventListener("change", () => {
      this.model = this.modelSelect.value === MAIN_MODEL ? undefined : this.modelSelect.value;
      edit(this.bot, true, false);
    });
    this.modelRetry.addEventListener("click", () => {
      if (this.model !== undefined) onRetry(this.model);
    });
  }

  /** Who the next game seats here. */
  get player(): Player {
    return this.human ? HUMAN : withModel(this.bot, this.model);
  }

  /** Who a game on a board of `size` seats here: the bot as last chosen, fitted to that board. */
  playerFor(size: number): Player {
    if (this.human) return HUMAN;
    return withModel(fitTo(this.wanted > 0 ? { ...this.bot, simulations: this.wanted } : this.bot, size), playableModel(this.model, this.context().models.offered, size));
  }

  /** Shows `player`. A heuristic bot or a person clears the network model, as choosing one does. */
  set(player: Player): void {
    this.human = player === HUMAN;
    this.model = player === HUMAN ? undefined : player.model;
    if (player !== HUMAN) {
      this.wanted = player.simulations;
      this.bot = fitTo(withModel(player, undefined), this.context().size);
    }
    this.draw();
  }

  /** What the seat holds, in words, for an announcement. */
  describe(): string {
    return `Player ${this.side === "p1" ? 1 : 2}: ${this.human ? "a person" : `${botLabel(this.bot)}, ${botSummary(withModel(this.bot, this.model))}`}.`;
  }

  /** Brings every control in line with the settings and the page: caps for the board size, choices that need the network, the estimate. */
  draw(): void {
    const { size, networkOff, model: mainModel, moveTime, models } = this.context();
    this.bot = fitTo(this.wanted > 0 ? { ...this.bot, simulations: this.wanted } : this.bot, size);
    const bot = this.bot;
    const chosen = choiceOf(this.player);
    for (const option of this.choice.options) {
      // A Custom entry is shown greyed out unless it names the seat's settings; it cannot be chosen.
      option.disabled = (option.value === CUSTOM.heuristic || option.value === CUSTOM.network) && option.value !== chosen;
      if (option.parentElement === this.networkGroup && networkOff) option.disabled = true;
    }
    this.networkGroup.label = networkOff ? "Neural network (not available)" : "Neural network";
    if (this.choice.value !== chosen) this.choice.value = chosen;
    this.settings.hidden = this.human;
    if (this.human) return;

    const named = presetOf(bot);
    if (named === null && this.wasNamed) this.more.open = true;
    this.wasNamed = named !== null;

    const steps = stepsFor(bot.engine, size);
    const max = String(steps.length - 1);
    if (this.slider.max !== max) this.slider.max = max;
    const index = String(steps.indexOf(bot.simulations));
    if (this.slider.value !== index) this.slider.value = index;
    this.slider.setAttribute("aria-valuetext", `${bot.simulations.toLocaleString("en-US")} simulations`);
    setText(this.value, bot.simulations.toLocaleString("en-US"));

    const card = this.model === undefined ? null : models.card(this.model);
    // The time table belongs to a make of network: a gallery model of the same make as the measured one uses it, another is unmeasured.
    const model = bot.engine !== "network" ? null : this.model === undefined ? mainModel : card === null ? this.model : timeModelOf(card);
    const found = estimateMs(bot, size, model);
    const time = found === null ? "time unmeasured" : `≈ ${formatMs(found.ms)} a move`;
    setText(this.summary, `${bot.simulations.toLocaleString("en-US")} simulations · ${time}${bot.vary ? " · varied" : ""}`);
    const here = moveTime !== null && moveTime.size === size && sameBot(moveTime.bot, withModel(bot, this.model)) ? ` On this device: ${formatMs(moveTime.ms)}.` : "";
    setText(this.estimate, describeEstimate(bot, size, model) + here);
    if (this.vary.checked !== bot.vary) this.vary.checked = bot.vary;
    this.drawModel(bot.engine === "network", size, models);
  }

  /** The Network select and the notes under it; shown for a network bot when there is a network to choose. */
  private drawModel(network: boolean, size: number, models: ModelsView): void {
    const show = network && models.options.length > 0;
    this.modelBox.hidden = !show;
    if (!show) return;
    syncOptions(this.modelSelect, models.options);
    const value = this.model ?? MAIN_MODEL;
    if (this.modelSelect.value !== value) this.modelSelect.value = value;
    const id = this.model ?? models.mainId;
    const card = id === null ? null : models.card(id);

    const state = this.model === undefined ? null : models.state(this.model);
    const status = this.model === undefined || state === null ? null : describeModelStatus(modelTitle(this.model, card), state);
    // One line for both the download note and the model's state, so the row is the same height whichever it says; the progress bar and Retry keep their room when not shown.
    setText(this.modelStatus, status?.text ?? FIRST_USE_NOTE);
    this.modelProgress.style.visibility = status?.downloading ? "visible" : "hidden";
    if (status?.percent != null) {
      this.modelProgress.max = 100;
      this.modelProgress.value = status.percent;
    } else this.modelProgress.removeAttribute("value");
    const failed = state?.status === "failed";
    if (!failed && document.activeElement === this.modelRetry) this.modelSelect.focus();
    this.modelRetry.style.visibility = failed ? "visible" : "hidden";
    this.modelRetry.disabled = !failed;

    setText(this.modelOffSize, id !== null && card !== null ? (offSizeNote(id, card, size) ?? "") : "");
    this.modelOffSize.hidden = this.modelOffSize.textContent === "";
    setText(this.modelStrength, card === null ? "" : strengthLine(card, size));
    this.modelStrength.hidden = card === null;
    const detail = card === null ? null : strengthDetail(card, size);
    setText(this.modelDetail, detail ?? "");
    this.modelDetailBox.hidden = detail === null;
  }
}

/** Brings a select's options in line with `options`: in place when the values are the same, so an open list and focus stay. */
function syncOptions(select: HTMLSelectElement, options: readonly ModelOption[]): void {
  const same = select.options.length === options.length && options.every((option, i) => select.options[i]!.value === option.value);
  if (!same) {
    select.replaceChildren(
      ...options.map((option) => {
        const created = document.createElement("option");
        created.value = option.value;
        return created;
      }),
    );
  }
  options.forEach((option, i) => {
    const target = select.options[i]!;
    setText(target, option.label);
    target.disabled = option.disabled;
  });
}
