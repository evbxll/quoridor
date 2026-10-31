import type { ModelCard } from "../model/card";
import type { ModelState } from "../model/manager";
import { type Bot, botLabel, botOf, botSummary, describeEstimate, fitTo, formatMs, PRESETS, sameBot, stepsFor, timeModelOf, withModel } from "./bots";
import { HUMAN, type MoveTime, type Player, type Side } from "./controller";
import { playableModel } from "./seatModels";
import { choiceOf, CUSTOM, ENGINE_GROUPS, seatAfterChoice } from "./seatChoice";
import { describeModelStatus, FIRST_USE_NOTE, MAIN_MODEL, type ModelOption, modelTitle, seatStrength } from "./modelInfo";

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
 * or a neural-network level (Strong, Max). A bot whose settings match no preset is shown as "Custom (engine)" in
 * the select, as a disabled entry that is there only while it is Custom. Dragging the simulations is the way to make it so.
 * A network bot has a Network select when more than one network is published. Always shown under it: the simulations
 * slider with its value, one line on the time a move, the seat's latest time on this device, and "Vary moves". The page reads the
 * seat with `player`. `onEdit` is called after each change, with a sentence to announce or null when the
 * control already announces itself (the slider); the page applies the change to the game at once.
 */
export class SeatControls {
  private human = true;
  private bot: Bot = DEFAULT_BOT;
  /** The simulations the person last chose (0: none yet), restored when a larger board's cap no longer lowers them. */
  private wanted = 0;
  /** The gallery model a network bot searches with; undefined is the main model. A heuristic bot has none: choosing one clears it. */
  private model: string | undefined;
  private readonly choice: HTMLSelectElement;
  private readonly groups: readonly HTMLOptGroupElement[];
  private readonly networkGroup: HTMLOptGroupElement;
  /** The entry that names settings no preset has: in the select only while the bot is Custom, and never pickable. */
  private customOption: HTMLOptionElement | null = null;
  /** The bot's name when its settings were last committed (a pick, a released slider, a toggle), to announce a change of level. */
  private settled = botLabel(DEFAULT_BOT);
  private readonly settings: HTMLElement;
  private readonly slider: HTMLInputElement;
  private readonly value: HTMLOutputElement;
  private readonly estimate: HTMLElement;
  /** The seat's latest move time on this device: a line of its own, kept when empty, so the first move of a game moves nothing below it. */
  private readonly measured: HTMLElement;
  private readonly vary: HTMLInputElement;
  private readonly modelBox: HTMLElement;
  private readonly modelSelect: HTMLSelectElement;
  private readonly modelStatus: HTMLElement;
  private readonly modelProgress: HTMLProgressElement;
  private readonly modelRetry: HTMLButtonElement;
  private readonly strength: HTMLElement;

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
      for (const preset of PRESETS.filter((candidate) => candidate.engine === engine)) make("option", group, { textContent: botLabel(preset) }).value = preset.id;
      return group;
    });
    this.groups = groups;
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
    this.modelSelect.setAttribute("aria-describedby", this.modelStatus.id);
    // One line of strength against Normal, in words a player needs; its line is kept when empty, so changing the level moves nothing below it.
    this.strength = make("p", this.settings, { id: id("strength"), className: "seat-hint strength" });
    this.choice.setAttribute("aria-describedby", this.strength.id);

    // The simulations slider is always in view, so that its label says how to customise a bot without opening anything.
    const simulations = make("div", this.settings, { className: "sims-row" });
    make("label", simulations, { htmlFor: id("sims"), className: "sims-label", textContent: "Simulations — drag to customise" });
    this.slider = make("input", simulations, { id: id("sims") });
    this.slider.type = "range";
    this.slider.step = "1";
    this.slider.min = "0";
    this.value = make("output", simulations, { id: id("sims-value") });
    this.value.htmlFor = this.slider.id;
    // The slider's aria-valuetext says the value; an output is a live region and would say it again.
    this.value.setAttribute("aria-hidden", "true");
    this.estimate = make("p", this.settings, { id: id("estimate"), className: "seat-hint estimate" });
    this.measured = make("p", this.settings, { id: id("measured"), className: "seat-hint measured" });
    this.slider.setAttribute("aria-describedby", `${this.estimate.id} ${this.measured.id}`);
    const varyLabel = make("label", this.settings, { className: "check" });
    this.vary = make("input", varyLabel, { id: id("vary") });
    this.vary.type = "checkbox";
    varyLabel.append(" Vary moves");
    const varyNote = make("span", varyLabel, { id: id("vary-note"), className: "seat-hint", textContent: "so games differ" });
    this.vary.setAttribute("aria-describedby", varyNote.id);

    /** Applies a change to the bot; `remember` keeps its simulations as the person's choice. */
    const edit = (bot: Bot, announce: boolean, remember: boolean): void => {
      if (remember) this.wanted = bot.simulations;
      this.bot = fitTo(bot, this.context().size);
      this.settled = botLabel(this.bot);
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
    // The slider announces its value itself; a change of level (to Custom, or back to a preset) is said as well.
    this.slider.addEventListener("change", () => {
      const renamed = botLabel(this.bot) !== this.settled;
      this.settled = botLabel(this.bot);
      onEdit(renamed ? this.describe() : null);
    });
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
      this.settled = botLabel(this.bot);
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
    this.drawCustom(chosen);
    for (const option of this.choice.options) {
      option.disabled = option === this.customOption || (option.parentElement === this.networkGroup && networkOff);
    }
    this.networkGroup.label = networkOff ? "Neural network (not available)" : "Neural network";
    if (this.choice.value !== chosen) this.choice.value = chosen;
    this.settings.hidden = this.human;
    if (this.human) return;

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
    const here = moveTime !== null && moveTime.size === size && sameBot(moveTime.bot, withModel(bot, this.model)) ? `On this device: ${formatMs(moveTime.ms)}.` : "";
    setText(this.estimate, describeEstimate(bot, size, model));
    setText(this.measured, here);
    if (this.vary.checked !== bot.vary) this.vary.checked = bot.vary;
    const rated = bot.engine === "network" ? (this.model ?? models.mainId) : null;
    setText(this.strength, seatStrength(bot, rated === null ? null : models.card(rated), size));
    this.drawModel(bot.engine === "network", size, models);
  }

  /** Puts the Custom entry in the select, in its engine's group, while `chosen` is one, and takes it out otherwise. */
  private drawCustom(chosen: string): void {
    const engine = ENGINE_GROUPS.findIndex((group) => CUSTOM[group.engine] === chosen);
    if (engine < 0) {
      this.customOption?.remove();
      this.customOption = null;
      return;
    }
    if (this.customOption !== null && this.customOption.value !== chosen) {
      this.customOption.remove();
      this.customOption = null;
    }
    if (this.customOption === null) {
      this.customOption = make("option", this.groups[engine]!);
      this.customOption.value = chosen;
    }
    setText(this.customOption, botLabel(this.bot));
  }

  /** The Network select and the notes under it; shown for a network bot when there is a network to choose. */
  private drawModel(network: boolean, size: number, models: ModelsView): void {
    const show = network && models.options.length > 0;
    this.modelBox.hidden = !show;
    if (!show) return;
    syncOptions(this.modelSelect, models.options);
    const value = this.model ?? MAIN_MODEL;
    if (this.modelSelect.value !== value) this.modelSelect.value = value;
    const state = this.model === undefined ? null : models.state(this.model);
    const status = this.model === undefined || state === null ? null : describeModelStatus(modelTitle(models.card(this.model)), state);
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
