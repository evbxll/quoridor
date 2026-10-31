import { type ModelCard, supportsSize } from "../model/card";
import type { ModelState } from "../model/manager";
import { type Bot, type PresetId, presetOf } from "./bots";

/** The value of the Network select's first option: the main model, whichever the index names for the board. */
export const MAIN_MODEL = "";

/** What the seat says before another network is picked: the download is large. */
export const FIRST_USE_NOTE = "Another network downloads about 10 MB the first time you pick it.";

/** One entry of a seat's Network select. */
export interface ModelOption {
  /** `MAIN_MODEL` for the main bot, else the model id. */
  readonly value: string;
  readonly label: string;
  readonly disabled: boolean;
}

/** What the options are made from. */
export interface OptionInput {
  /** The model that plays the board size (the index's `bots`), or null before it is known. */
  readonly mainId: string | null;
  /** The published gallery, in order. */
  readonly gallery: readonly string[];
  /** The card of a model if it has been read. */
  readonly card: (id: string) => ModelCard | null;
  /** The board size of the game. */
  readonly size: number;
  /** Whether reading the model's card failed, so it is not worth waiting for. */
  readonly cardFailed: (id: string) => boolean;
}

/** The gallery models besides the main bot, in the published order (their cards are read to name and sort them). */
export const extraModels = (mainId: string | null, gallery: readonly string[]): string[] => gallery.filter((id) => id !== mainId);

/**
 * The gallery models a seat can choose: one per architecture other than the main model's, the last listed where the
 * gallery lists several of one (the gallery is in publishing order, so that is the newest). A model whose card is not
 * read yet is kept until its architecture is known.
 */
export function choosableModels(mainId: string | null, gallery: readonly string[], card: (id: string) => ModelCard | null): string[] {
  const headOf = (id: string): string | null => card(id)?.network.head ?? null;
  const mainHead = mainId === null ? null : headOf(mainId);
  const extras = extraModels(mainId, gallery);
  const newest = new Map(extras.flatMap((id) => (headOf(id) === null ? [] : [[headOf(id), id] as const])));
  return extras.filter((id) => headOf(id) === null || (headOf(id) !== mainHead && newest.get(headOf(id)) === id));
}

const eloText = (elo: number): string => `${elo < 0 ? "-" : "+"}${Math.abs(Math.round(elo))}`;

/**
 * A model in words from its card: its architecture, "Convolutional" or "Fully connected". The gallery holds one model
 * per architecture, the latest, so the architecture names it. Before its card is read, "Another network": an id is never shown.
 */
export function modelTitle(card: ModelCard | null): string {
  if (card === null) return "Another network";
  return card.network.head === "fc" ? "Fully connected" : "Convolutional";
}

/** The card's rating at a board size, if it has one. */
const ratingAt = (card: ModelCard, size: number) => card.strength.find((entry) => entry.size === size) ?? null;

/** Why the model cannot be picked for this size, or null if it can. A model whose card is not read yet cannot be told to play the size, so it waits ("loading"). */
export function disabledReason(card: ModelCard | null, size: number): string | null {
  if (card === null) return "loading";
  if (supportsSize(card, size)) return null;
  return card.network.head === "fc" ? `${card.trainedSize}x${card.trainedSize} only` : `not offered at ${size}x${size}`;
}

/**
 * The entries of a seat's Network select: the main network first, then one gallery model per other architecture
 * (`choosableModels`), in the published order. A model that cannot play the board is disabled with the reason in its label. Fewer than two entries mean there is
 * nothing to choose, so the select is not shown: the list is then empty. A gallery model is not selectable until its card is read.
 */
export function buildModelOptions(input: OptionInput): ModelOption[] {
  const extras = choosableModels(input.mainId, input.gallery, input.card);
  if (extras.length === 0) return [];
  const mainCard = input.mainId === null ? null : input.card(input.mainId);
  const options: ModelOption[] = [{ value: MAIN_MODEL, label: mainCard === null || input.mainId === null ? "Main network" : modelTitle(mainCard), disabled: false }];
  for (const id of extras) {
    const card = input.card(id);
    const reason = card === null && input.cardFailed(id) ? "card could not be read" : disabledReason(card, input.size);
    options.push({ value: id, label: reason === null ? modelTitle(card) : `${modelTitle(card)} (${reason})`, disabled: reason !== null });
  }
  return options;
}

/** Elo figures are shown to the nearest this many: the ratings behind them are good to about ±40. */
const ELO_ROUNDING = 50;

/** What the heuristic presets are, against Normal, in words; Custom heuristic settings get no line. */
const HEURISTIC_STRENGTH: Partial<Record<PresetId, string>> = {
  beginner: "Much weaker than Normal.",
  normal: "The reference level: about even with its author on 9 × 9.",
};

/**
 * A bot's strength for a casual player, in one line, or "" when there is none to give.
 *
 * A network bot's comes from its card: its figure against Normal at the board size (or at the size it was rated on,
 * which is then named), rounded to 50. Only the presets it holds for get a line: Strong ("≈ +500 Elo vs Normal") and Max
 * ("≈ +500 Elo or more", as it searches far more than was rated). A network bot with Vary moves or other Custom settings
 * plays otherwise than rated, so it gets none.
 */
export function seatStrength(bot: Bot, card: ModelCard | null, size: number): string {
  if (bot.engine === "heuristic") {
    const preset = presetOf(bot);
    return preset === null ? "" : (HEURISTIC_STRENGTH[preset.id] ?? "");
  }
  const preset = presetOf(bot)?.id;
  const entry = card === null ? null : (ratingAt(card, size) ?? card.strength[0] ?? null);
  if (entry === null || (preset !== "strong" && preset !== "max")) return "";
  const elo = Math.round(entry.eloVsNormal / ELO_ROUNDING) * ELO_ROUNDING;
  const where = entry.size === size ? "" : ` (measured on ${entry.size} × ${entry.size})`;
  return `≈ ${eloText(elo)} Elo${preset === "max" ? " or more" : ""} vs Normal${where}`;
}

/** Where a seat's model stands, in words, and how far a download is (null when unknown or not downloading). */
export interface ModelStatus {
  readonly text: string;
  readonly percent: number | null;
  readonly downloading: boolean;
  readonly failed: boolean;
}

const megabytes = (bytes: number): string => (bytes / 1e6).toFixed(1);

/** The state of a gallery model in words: "Conv, gen 50: downloading 40% (4.0 of 9.9 MB)". */
export function describeModelStatus(title: string, state: ModelState): ModelStatus {
  const plain = (text: string, failed = false): ModelStatus => ({ text, percent: null, downloading: false, failed });
  switch (state.status) {
    case "checking":
      return plain(`${title}: looking for it…`);
    case "idle":
      return plain(`${title}: not loaded.`);
    case "downloading": {
      const percent = state.total === null ? null : Math.floor((state.loaded / state.total) * 100);
      const done = state.total === null ? `${megabytes(state.loaded)} MB` : `${megabytes(state.loaded)} of ${megabytes(state.total)} MB`;
      return { text: `${title}: downloading ${percent === null ? done : `${percent}% (${done})`}`, percent, downloading: true, failed: false };
    }
    case "ready":
      return plain(`${title}: ready${state.fromCache ? ", loaded from this device" : ""}.`);
    case "failed":
      return plain(`${title}: the download failed. ${state.message}`, true);
    case "unavailable":
      return state.reason === "unsupported-size"
        ? plain(`${title}: does not play this board size.`, true)
        : plain(`${title}: not usable. ${state.message ?? ""}`.trim(), true);
  }
}
