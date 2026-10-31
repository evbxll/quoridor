import { type ModelCard, supportsSize } from "../model/card";
import type { ModelState } from "../model/manager";
import { offSizeMeasure } from "./bots";

/** The value of the Network select's first option: the main model, whichever the index names for the board. */
export const MAIN_MODEL = "";

/** What the seat says before a model is picked: the download is large. */
export const FIRST_USE_NOTE = "A model other than the main bot downloads about 10 MB the first time you pick it.";

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
 * per architecture, the latest, so the architecture names it. Without a card, its id.
 */
export function modelTitle(id: string, card: ModelCard | null): string {
  if (card === null) return id;
  return card.network.head === "fc" ? "Fully connected" : "Convolutional";
}

/** The 9x9 ladder rating in the card, if it has one. */
const ladder = (card: ModelCard, size: number) => card.strength.find((entry) => entry.size === size) ?? null;

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
  const options: ModelOption[] = [{ value: MAIN_MODEL, label: mainCard === null || input.mainId === null ? "Main network" : modelTitle(input.mainId, mainCard), disabled: false }];
  for (const id of extras) {
    const card = input.card(id);
    const reason = card === null && input.cardFailed(id) ? "card could not be read" : disabledReason(card, input.size);
    options.push({ value: id, label: reason === null ? modelTitle(id, card) : `${modelTitle(id, card)} (${reason})`, disabled: reason !== null });
  }
  return options;
}

/** The note for a conv model on a size other than the one it trained on, or null when there is none to give. */
export function offSizeNote(id: string, card: ModelCard, size: number): string | null {
  if (card.network.head !== "conv" || size === card.trainedSize) return null;
  const trained = `Trained on ${card.trainedSize}x${card.trainedSize}. Its convolutional architecture can play other sizes, but it was never trained on this one`;
  const measured = offSizeMeasure(id, size);
  return measured === null
    ? `${trained}, so its strength here is unmeasured.`
    : `${trained}. Measured here: score ${measured} against the Evan bot (fresh tree, 95% interval over start positions).`;
}

/** One line of strength from the card, at the board size if the card rates it there, else where it does. */
export function strengthLine(card: ModelCard, size: number): string {
  const here = ladder(card, size);
  const entry = here ?? card.strength[0] ?? null;
  if (entry === null) return `No strength is measured for this model.`;
  const level = Math.round(entry.intervalLevel * 100);
  const rating = `${entry.size}x${entry.size} ladder Elo ${eloText(entry.elo)} [${eloText(entry.interval[0])}, ${eloText(entry.interval[1])}] vs the Evan bot at ${entry.simulations} simulations (${level}%). Ladder Elo, not a win rate.`;
  return here === null ? `Not rated on ${size}x${size}. ${rating}` : rating;
}

/** The conditions of the rating, from the card's own fields, for the disclosure under the strength line. */
export function strengthDetail(card: ModelCard, size: number): string | null {
  const entry = ladder(card, size) ?? card.strength[0] ?? null;
  if (entry === null) return null;
  return `Rated against: ${entry.anchor}. Openings: ${entry.openings}. Settings: ${entry.settings}. Interval: ${entry.intervalMethod}. ${entry.ladderGames} ladder games.`;
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
