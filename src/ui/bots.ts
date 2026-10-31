import type { ModelCard } from "../model/card";
import data from "./bots.json";

/** The evaluators a bot can search with. */
export type EngineKind = "heuristic" | "network";

/** What a bot asks of the engine: which evaluator, how many simulations a move, and whether its choice among the searched moves varies. */
export interface Bot {
  readonly engine: EngineKind;
  readonly simulations: number;
  /** False plays the most visited move; true samples among the searched moves by visits (temperature 1). */
  readonly vary: boolean;
  /**
   * The gallery model a network bot searches with. Absent means the main model (the index's `bots` for the board),
   * and the search request then names no model. A heuristic bot has none.
   */
  readonly model?: string;
}

export type PresetId = "beginner" | "normal" | "strong" | "max";

export interface Preset extends Bot {
  readonly id: PresetId;
  readonly label: string;
}

/** Measured per move: simulations, median ms, 90th percentile ms. */
type Points = readonly (readonly [number, number, number])[];
type PerEngine<T> = Readonly<Record<EngineKind, T>>;

interface BotsData {
  readonly presets: readonly Preset[];
  readonly steps: PerEngine<readonly number[]>;
  readonly caps: PerEngine<{ readonly default: number; readonly bySize: Readonly<Record<string, number>> }>;
  /** Scores of a model off its trained size, against the fresh-tree Evan bot, by model id and board size. */
  readonly offSize: Readonly<Record<string, Readonly<Record<string, { readonly simulations: number; readonly score: number; readonly interval: readonly [number, number]; readonly games: number | null }>>>>;
  readonly times: {
    readonly device: string;
    readonly deviceDetail: string;
    readonly network: {
      readonly model: string;
      /** What the measured model is made of; a model with the same make is as fast. */
      readonly architecture: { readonly head: string; readonly inputPlanes: number; readonly channels: number; readonly blocks: number };
      readonly bySize: Readonly<Record<string, Points>>;
      /** Models of another make, each with its own measured table. */
      readonly others: Readonly<Record<string, { readonly source: string; readonly bySize: Readonly<Record<string, Points>> }>>;
    };
    readonly heuristic: { readonly source: string; readonly msAt100: Readonly<Record<string, number>> };
  };
}

const DATA = data as unknown as BotsData;

export const PRESETS: readonly Preset[] = DATA.presets;
/** Where the time estimates were measured, in words ("a fast desktop"). */
export const MEASURED_ON = DATA.times.device;
/** The network whose times `bots.json` holds; the page shows no measured time for another one. */
export const MEASURED_MODEL = DATA.times.network.model;

/** The temperature a bot's searches ask for: 1 samples among the searched moves, 0 plays the most visited. */
export const temperatureOf = (bot: Bot): number => (bot.vary ? 1 : 0);

export function preset(id: PresetId): Preset {
  return PRESETS.find((candidate) => candidate.id === id)!;
}

/** Whether two bots have the same engine, budget and move choice, whichever model they use. */
const sameSettings = (a: Bot, b: Bot): boolean => a.engine === b.engine && a.simulations === b.simulations && a.vary === b.vary;

/** Whether two bots are the same bot: the same settings and the same model (absent: the main model). */
export const sameBot = (a: Bot, b: Bot): boolean => sameSettings(a, b) && (a.model ?? null) === (b.model ?? null);

/** The preset whose settings the bot has, or null: the bot is then Custom. The model is a separate setting, so a preset keeps its name with any model. */
export function presetOf(bot: Bot): Preset | null {
  return PRESETS.find((candidate) => sameSettings(candidate, bot)) ?? null;
}

/** The bot's name: its preset's, or "Custom". */
export const botLabel = (bot: Bot): string => presetOf(bot)?.label ?? "Custom";

const modelLabels = new Map<string, string>();

/** Remembers how a model is called in words (from its card), for the summaries and blurbs that name it. */
export function setModelLabel(id: string, label: string): void {
  modelLabels.set(id, label);
}

/** A model's name in words: its label if the page has one, else its id. */
export const modelName = (id: string): string => modelLabels.get(id) ?? id;

/** The bot's settings in words: "Neural network, 32 searches a move, varied"; a gallery model is named, the main model is not. */
export function botSummary(bot: Bot): string {
  const model = bot.engine === "network" && bot.model !== undefined ? `, ${modelName(bot.model)}` : "";
  return `${bot.engine === "network" ? "Neural network" : "Heuristic"}, ${bot.simulations} searches a move${bot.vary ? ", varied" : ""}${model}`;
}

/** The bot with `model` set (absent for the main model); a heuristic bot takes none. */
export function withModel(bot: Bot, model: string | undefined): Bot {
  const { model: _old, ...rest } = bot;
  return bot.engine === "network" && model !== undefined ? { ...rest, model } : rest;
}

/** The settings a preset sets. */
export function botOf(id: PresetId): Bot {
  const { engine, simulations, vary } = preset(id);
  return { engine, simulations, vary };
}

/** The largest number of simulations offered for an engine on a board size. */
export const capFor = (engine: EngineKind, size: number): number => DATA.caps[engine].bySize[size] ?? DATA.caps[engine].default;

/** The simulation counts offered for an engine on a board size, smallest first, up to the cap. */
export const stepsFor = (engine: EngineKind, size: number): readonly number[] => DATA.steps[engine].filter((step) => step <= capFor(engine, size));

/** The offered step closest to `simulations` (the lower one on a tie). */
export function nearestStep(engine: EngineKind, size: number, simulations: number): number {
  const steps = stepsFor(engine, size);
  return steps.reduce((best, step) => (Math.abs(step - simulations) < Math.abs(best - simulations) ? step : best), steps[0]!);
}

/** The bot with its simulations moved to the nearest step its engine offers on this size. */
export function fitTo(bot: Bot, size: number): Bot {
  const simulations = nearestStep(bot.engine, size, bot.simulations);
  return simulations === bot.simulations ? bot : { ...bot, simulations };
}

/** How sure a time is: measured at exactly this budget, or interpolated or derived. */
export type EstimateKind = "measured" | "estimate";

/** A time on the measured desktop: the median, the 90th percentile where measured, and how sure it is. */
export interface Estimate {
  readonly ms: number;
  readonly p90: number | null;
  readonly kind: EstimateKind;
}

/**
 * What a move takes on the measured desktop, or null if unmeasured.
 * The network is looked up in the measured table: exact at a measured budget, linear between measured
 * budgets and from zero below the first, none above the last. `model` is the network that would play, if
 * known; a different one than the table's is unmeasured. The heuristic's time is derived from Normal's, in
 * proportion to simulations, so it is always an estimate and has no 90th percentile.
 */
export function estimateMs(bot: Bot, size: number, model: string | null = null): Estimate | null {
  if (bot.engine === "heuristic") {
    const at100 = DATA.times.heuristic.msAt100[size];
    return at100 === undefined ? null : { ms: (at100 * bot.simulations) / 100, p90: null, kind: "estimate" };
  }
  const table = model === null || model === MEASURED_MODEL ? DATA.times.network.bySize : DATA.times.network.others[model]?.bySize;
  const points = table?.[size];
  if (points === undefined) return null;
  let before: readonly [number, number, number] = [0, 0, 0];
  for (const point of points) {
    if (bot.simulations === point[0]) return { ms: point[1], p90: point[2], kind: "measured" };
    if (bot.simulations < point[0]) {
      const along = (bot.simulations - before[0]) / (point[0] - before[0]);
      return { ms: before[1] + (point[1] - before[1]) * along, p90: before[2] + (point[2] - before[2]) * along, kind: "estimate" };
    }
    before = point;
  }
  return null;
}

/** A time for people: "50 ms", "0.6 s", "14 s". */
export function formatMs(ms: number): string {
  if (ms < 100) return `${Math.max(1, Math.round(ms))} ms`;
  const seconds = ms / 1000;
  return seconds < 10 ? `${seconds.toFixed(1)} s` : `${Math.round(seconds)} s`;
}

/** How much slower than its median the slowest tenth of moves must be for the estimate to say so. */
const SLOW_TAIL = 2;

/** The live estimate beside the simulations control: "About 0.6 s a move on a fast desktop (estimate)." */
export function describeEstimate(bot: Bot, size: number, model: string | null = null): string {
  const found = estimateMs(bot, size, model);
  if (found === null) return `Time a move: unmeasured on ${size} × ${size}.`;
  const tail = found.p90 !== null && found.p90 > SLOW_TAIL * found.ms ? ` 1 move in 10 takes over ${formatMs(found.p90)}.` : "";
  return `About ${formatMs(found.ms)} a move on ${MEASURED_ON} (${found.kind}).${tail}`;
}

/**
 * The model whose measured times apply to a model with this card: the measured one when it is made the same way
 * (head, input planes, width, depth), else the model itself. Unknown makes have no table and read "unmeasured".
 */
export function timeModelOf(card: ModelCard): string {
  const made = DATA.times.network.architecture;
  const { head, inputPlanes, channels, blocks } = card.network;
  return head === made.head && inputPlanes === made.inputPlanes && channels === made.channels && blocks === made.blocks ? MEASURED_MODEL : card.id;
}

/** The measurement of a model off its trained size, if the repo has one: "0.927 [0.833, 1.000] at 32 simulations". */
export function offSizeMeasure(id: string, size: number): string | null {
  const found = DATA.offSize[id]?.[size];
  if (found === undefined) return null;
  const games = found.games === null ? "" : `, ${found.games} games`;
  return `${found.score.toFixed(3)} [${found.interval[0].toFixed(3)}, ${found.interval[1].toFixed(3)}] at ${found.simulations} simulations${games}`;
}

/** Where the measured and derived times come from, for the estimate's text alternative. */
export const TIME_SOURCES = { network: DATA.times.deviceDetail, heuristic: DATA.times.heuristic.source, others: Object.values(DATA.times.network.others).map((other) => other.source) } as const;
