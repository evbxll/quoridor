import { type Bot, botLabel, botOf, botSummary, calibrationNote, capFor, capReason, describeEstimate, fitTo, formatMs, PRESETS, presetOf, sameBot, stepsFor } from "./bots";
import { HUMAN, type MoveTime, type Player, type Side } from "./controller";

const CUSTOM = "custom";
const DEFAULT_BOT: Bot = botOf("strong");

/** What a seat's controls need to know about the page when they are drawn. */
export interface SeatContext {
  /** The board size the next game is set up for. */
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
 * stepped simulations, "Vary moves", the limit and the time estimate. They
 * hold the settings the next game starts with; the page reads them with
 * `player`. `onEdit` is called after each change, with a sentence to announce
 * or null when the control already announces itself (the slider).
 */
export class SeatControls {
  private human = true;
  private bot: Bot = DEFAULT_BOT;
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

    const pair = make("div", this.settings, { className: "pair" });
    const presetField = make("label", pair, { className: "field", textContent: "Preset" });
    this.preset = make("select", presetField, { id: id("preset") });
    for (const preset of PRESETS) make("option", this.preset, { textContent: preset.label }).value = preset.id;
    make("option", this.preset, { textContent: "Custom" }).value = CUSTOM;

    const engineField = make("label", pair, { className: "field", textContent: "Engine" });
    this.engine = make("select", engineField, { id: id("engine") });
    for (const [value, label] of [["heuristic", "Heuristic"], ["network", "Network"]] as const) make("option", this.engine, { textContent: label }).value = value;

    const simulations = make("div", this.settings, { className: "field" });
    make("label", simulations, { htmlFor: id("sims"), textContent: "Simulations" });
    const row = make("div", simulations, { className: "sims-row" });
    this.slider = make("input", row, { id: id("sims") });
    this.slider.type = "range";
    this.slider.step = "1";
    this.slider.min = "0";
    this.value = make("output", row, { id: id("sims-value") });
    this.value.htmlFor = this.slider.id;
    this.limit = make("p", this.settings, { id: id("limit"), className: "seat-hint limit" });
    this.estimate = make("p", this.settings, { id: id("estimate"), className: "seat-hint estimate" });
    this.slider.setAttribute("aria-describedby", `${this.limit.id} ${this.estimate.id}`);

    const varyLabel = make("label", this.settings, { className: "check" });
    this.vary = make("input", varyLabel, { id: id("vary") });
    this.vary.type = "checkbox";
    varyLabel.append(" Vary moves");
    const varyNote = make("p", this.settings, { id: id("vary-note"), className: "seat-hint vary", textContent: "Off: the bot plays the same move whenever it meets the same game." });
    this.vary.setAttribute("aria-describedby", varyNote.id);
    this.calibration = make("p", this.settings, { id: id("calibration"), className: "seat-hint calibration" });

    const edit = (bot: Bot, announce: boolean): void => {
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
      if (this.preset.value !== CUSTOM) edit(botOf(this.preset.value as Parameters<typeof botOf>[0]), true);
      else this.draw();
    });
    this.engine.addEventListener("change", () => edit({ ...this.bot, engine: this.engine.value as Bot["engine"] }, true));
    this.slider.addEventListener("input", () => {
      const step = stepsFor(this.bot.engine, this.context().size)[Number(this.slider.value)];
      if (step !== undefined) edit({ ...this.bot, simulations: step }, false);
    });
    this.vary.addEventListener("change", () => edit({ ...this.bot, vary: this.vary.checked }, true));
  }

  /** Who the next game seats here. */
  get player(): Player {
    return this.human ? HUMAN : this.bot;
  }

  /** Shows `player`; a person keeps the bot last chosen for when Bot is picked again. */
  set(player: Player): void {
    this.human = player === HUMAN;
    if (player !== HUMAN) this.bot = fitTo(player, this.context().size);
    this.draw();
  }

  /** What the seat holds, in words, for an announcement. */
  describe(): string {
    return `Player ${this.side === "p1" ? 1 : 2}: ${this.human ? "a person" : `${botLabel(this.bot)}, ${botSummary(this.bot)}`}. It applies when you press New game.`;
  }

  /** Brings every control in line with the settings and the page: caps for the board size, choices that need the network, the estimate. */
  draw(): void {
    const { size, networkOff, model, moveTime } = this.context();
    // The bot a person's seat keeps for later cannot be one that needs a network none is offered for.
    this.bot = this.human && networkOff && this.bot.engine === "network" ? botOf("normal") : fitTo(this.bot, size);
    const bot = this.bot;
    if (this.type.value !== (this.human ? HUMAN : "bot")) this.type.value = this.human ? HUMAN : "bot";
    this.settings.hidden = this.human;
    if (this.human) return;

    const named = presetOf(bot);
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

    const here = moveTime !== null && moveTime.size === size && sameBot(moveTime.bot, bot) ? ` On this device: ${formatMs(moveTime.ms)}.` : "";
    setText(this.estimate, describeEstimate(bot, size, bot.engine === "network" ? model : null) + here);
    if (this.vary.checked !== bot.vary) this.vary.checked = bot.vary;
    setText(this.calibration, calibrationNote(bot, size));
  }
}
