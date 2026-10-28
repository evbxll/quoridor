import { type Bot, botLabel, botOf, botSummary, calibrationNote, capFor, capReason, describeEstimate, type EngineKind, estimateMs, fitTo, formatMs, PRESETS, presetOf, sameBot, stepsFor } from "./bots";
import { HUMAN, type MoveTime, type Player, type Side } from "./controller";

const CUSTOM = "custom";
const DEFAULT_BOT: Bot = botOf("strong");

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
 * The controls of one seat: Human or Bot, and for a bot its preset, engine,
 * stepped simulations, "Vary moves", the limit and the time estimate. The page
 * reads the seat with `player`. `onEdit` is called after each change, with a
 * sentence to announce or null when the control already announces itself (the
 * slider); the page applies the change to the game at once.
 */
export class SeatControls {
  private human = true;
  private bot: Bot = DEFAULT_BOT;
  /** The simulations the person last chose per engine (0: none yet), restored when a larger board's cap no longer lowers them. */
  private readonly wanted: Record<EngineKind, number> = { heuristic: 0, network: 0 };
  /** Whether the bot had a preset's name at the last drawing, to open the settings when it becomes Custom. */
  private wasNamed = true;
  private readonly pick: HTMLElement;
  private readonly more: HTMLDetailsElement;
  private readonly summary: HTMLElement;
  private readonly type: HTMLSelectElement;
  private readonly settings: HTMLElement;
  private readonly preset: HTMLSelectElement;
  private readonly engine: HTMLSelectElement;
  private readonly slider: HTMLInputElement;
  private readonly value: HTMLOutputElement;
  private readonly limit: HTMLElement;
  private readonly estimate: HTMLElement;
  private readonly vary: HTMLInputElement;
  private readonly calibration: HTMLElement;

  constructor(
    private readonly side: Side,
    private readonly context: () => SeatContext,
    onEdit: (announcement: string | null) => void,
  ) {
    const id = (name: string): string => `${name}-${side}`;
    this.type = document.getElementById(id("player")) as HTMLSelectElement;
    this.settings = document.getElementById(id("bot"))!;
    for (const [value, label] of [[HUMAN, "Human"], ["bot", "Bot"]] as const) make("option", this.type, { textContent: label }).value = value;

    // Human or Bot and the preset share a row; the rest of a bot's settings sit in a disclosure under it.
    this.pick = document.createElement("div");
    this.pick.className = "pick";
    this.type.before(this.pick);
    this.pick.append(this.type);
    this.preset = make("select", this.pick, { id: id("preset") });
    this.preset.setAttribute("aria-label", `Player ${side === "p1" ? 1 : 2} preset`);
    for (const preset of PRESETS) make("option", this.preset, { textContent: preset.label }).value = preset.id;
    make("option", this.preset, { textContent: "Custom" }).value = CUSTOM;

    this.more = make("details", this.settings, { className: "seat-more" });
    this.summary = make("summary", this.more);
    const body = make("div", this.more, { className: "seat-more-body" });

    const engineField = make("label", body, { className: "field", textContent: "Engine" });
    this.engine = make("select", engineField, { id: id("engine") });
    for (const [value, label] of [["heuristic", "Heuristic"], ["network", "Network"]] as const) make("option", this.engine, { textContent: label }).value = value;

    const simulations = make("div", body, { className: "field" });
    make("label", simulations, { htmlFor: id("sims"), textContent: "Simulations" });
    const row = make("div", simulations, { className: "sims-row" });
    this.slider = make("input", row, { id: id("sims") });
    this.slider.type = "range";
    this.slider.step = "1";
    this.slider.min = "0";
    this.value = make("output", row, { id: id("sims-value") });
    this.value.htmlFor = this.slider.id;
    // The slider's aria-valuetext says the value; an output is a live region and would say it again.
    this.value.setAttribute("aria-hidden", "true");
    this.limit = make("p", body, { id: id("limit"), className: "seat-hint limit" });
    this.estimate = make("p", body, { id: id("estimate"), className: "seat-hint estimate" });
    this.slider.setAttribute("aria-describedby", `${this.limit.id} ${this.estimate.id}`);

    const varyLabel = make("label", body, { className: "check" });
    this.vary = make("input", varyLabel, { id: id("vary") });
    this.vary.type = "checkbox";
    varyLabel.append(" Vary moves");
    const varyNote = make("p", body, { id: id("vary-note"), className: "seat-hint vary", textContent: "Off: the bot plays the same move whenever it meets the same game." });
    this.vary.setAttribute("aria-describedby", varyNote.id);
    this.calibration = make("p", body, { id: id("calibration"), className: "seat-hint calibration" });

    /** Applies a change; `remember` keeps its simulations as the person's choice for the engine. */
    const edit = (bot: Bot, announce: boolean, remember: boolean): void => {
      if (remember) this.wanted[bot.engine] = bot.simulations;
      this.bot = fitTo(bot, this.context().size);
      this.draw();
      onEdit(announce ? this.describe() : null);
    };
    this.type.addEventListener("change", () => {
      this.human = this.type.value === HUMAN;
      this.draw();
      onEdit(this.describe());
    });
    this.preset.addEventListener("change", () => {
      if (this.preset.value !== CUSTOM) edit(botOf(this.preset.value as Parameters<typeof botOf>[0]), true, true);
      else this.draw();
    });
    this.engine.addEventListener("change", () => {
      const engine = this.engine.value as EngineKind;
      edit({ ...this.bot, engine, simulations: this.wanted[engine] || this.bot.simulations }, true, true);
    });
    // Dragging only previews the value (label, estimate); the game gets it when the slider is released or a key step is made.
    this.slider.addEventListener("input", () => {
      const step = stepsFor(this.bot.engine, this.context().size)[Number(this.slider.value)];
      if (step === undefined) return;
      this.wanted[this.bot.engine] = step;
      this.bot = fitTo({ ...this.bot, simulations: step }, this.context().size);
      this.draw();
    });
    this.slider.addEventListener("change", () => onEdit(null));
    this.vary.addEventListener("change", () => edit({ ...this.bot, vary: this.vary.checked }, true, false));
  }

  /** Who the next game seats here. */
  get player(): Player {
    return this.human ? HUMAN : this.bot;
  }

  /** Who a game on a board of `size` seats here: the bot as last chosen, fitted to that board. */
  playerFor(size: number): Player {
    if (this.human) return HUMAN;
    const wanted = this.wanted[this.bot.engine];
    return fitTo(wanted > 0 ? { ...this.bot, simulations: wanted } : this.bot, size);
  }

  /** Shows `player`; a person keeps the bot last chosen for when Bot is picked again. */
  set(player: Player): void {
    this.human = player === HUMAN;
    if (player !== HUMAN) {
      this.wanted[player.engine] = player.simulations;
      this.bot = fitTo(player, this.context().size);
    }
    this.draw();
  }

  /** What the seat holds, in words, for an announcement. */
  describe(): string {
    return `Player ${this.side === "p1" ? 1 : 2}: ${this.human ? "a person" : `${botLabel(this.bot)}, ${botSummary(this.bot)}`}.`;
  }

  /** Brings every control in line with the settings and the page: caps for the board size, choices that need the network, the estimate. */
  draw(): void {
    const { size, networkOff, model, moveTime } = this.context();
    // The bot a person's seat keeps for later cannot be one that needs a network none is offered for.
    if (this.human && networkOff && this.bot.engine === "network") this.bot = botOf("normal");
    const wanted = this.wanted[this.bot.engine];
    this.bot = fitTo(wanted > 0 ? { ...this.bot, simulations: wanted } : this.bot, size);
    const bot = this.bot;
    if (this.type.value !== (this.human ? HUMAN : "bot")) this.type.value = this.human ? HUMAN : "bot";
    this.settings.hidden = this.human;
    this.preset.hidden = this.human;
    this.pick.classList.toggle("solo", this.human);
    if (this.human) return;

    const named = presetOf(bot);
    if (named === null && this.wasNamed) this.more.open = true;
    this.wasNamed = named !== null;
    this.preset.value = named?.id ?? CUSTOM;
    for (const option of this.preset.options) {
      const preset = PRESETS.find((candidate) => candidate.id === option.value);
      const off = networkOff && preset?.engine === "network";
      option.disabled = off || (option.value === CUSTOM && named !== null);
      setText(option, preset ? (off ? `${preset.label} (no network)` : preset.label) : "Custom");
    }
    this.engine.value = bot.engine;
    for (const option of this.engine.options) {
      option.disabled = networkOff && option.value === "network";
      setText(option, option.value === "network" ? (networkOff ? "Network (none)" : "Network") : "Heuristic");
    }

    const steps = stepsFor(bot.engine, size);
    const max = String(steps.length - 1);
    if (this.slider.max !== max) this.slider.max = max;
    const index = String(steps.indexOf(bot.simulations));
    if (this.slider.value !== index) this.slider.value = index;
    this.slider.setAttribute("aria-valuetext", `${bot.simulations.toLocaleString("en-US")} simulations`);
    setText(this.value, bot.simulations.toLocaleString("en-US"));
    setText(this.limit, `Limit ${capFor(bot.engine, size).toLocaleString("en-US")}: ${capReason(bot.engine, size)}`);

    const found = estimateMs(bot, size, bot.engine === "network" ? model : null);
    setText(this.summary, `Settings: ${bot.simulations.toLocaleString("en-US")} simulations, ${found === null ? "time unmeasured" : `about ${formatMs(found.ms)}${found.kind === "estimate" ? " (estimate)" : ""}`}`);
    const here = moveTime !== null && moveTime.size === size && sameBot(moveTime.bot, bot) ? ` On this device: ${formatMs(moveTime.ms)}.` : "";
    setText(this.estimate, describeEstimate(bot, size, bot.engine === "network" ? model : null) + here);
    if (this.vary.checked !== bot.vary) this.vary.checked = bot.vary;
    setText(this.calibration, calibrationNote(bot, size));
  }
}
