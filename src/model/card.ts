import { SUPPORTED_PLANES } from "../ai/encoding";

/** A model's strength at a board size: Elo above Normal, as the publisher worked it out. */
export interface Strength {
  readonly size: number;
  readonly eloVsNormal: number;
}

/** The structured architecture in a card. */
export interface NetworkInfo {
  readonly head: "fc" | "conv";
  readonly inputPlanes: number;
  readonly channels: number;
  readonly blocks: number;
  readonly poolEvery: number | null;
  readonly headChannels: number | null;
  readonly boardSize: number | null;
}

/**
 * What the site reads from a model's `card.json`. Strings come from a file the publisher wrote but are
 * untrusted all the same: they are bounded in length and are to be shown as text, never as markup.
 */
export interface ModelCard {
  readonly id: string;
  readonly displayName: string;
  /** Board sizes the model is offered at (an fc model: its one size). */
  readonly sizes: readonly number[];
  readonly trainedSize: number;
  readonly sha256: string;
  readonly license: string;
  readonly parameters: number;
  readonly network: NetworkInfo;
  /** Names of the input planes, `network.inputPlanes` of them. */
  readonly planeNames: readonly string[];
  readonly strength: readonly Strength[];
}

const MAX_TEXT = 400;
const MAX_ENTRIES = 32;

type Fields = Record<string, unknown>;

const isObject = (value: unknown): value is Fields => typeof value === "object" && value !== null && !Array.isArray(value);

function text(value: unknown, what: string): string {
  if (typeof value !== "string" || value.length > MAX_TEXT) throw new Error(`${what} is not a short text`);
  return value;
}

function count(value: unknown, what: string, least = 0): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < least) throw new Error(`${what} is not a whole number of at least ${least}`);
  return value;
}

function real(value: unknown, what: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${what} is not a number`);
  return value;
}

const orNull = <T>(value: unknown, read: (value: unknown) => T): T | null => (value === null || value === undefined ? null : read(value));

function readStrength(raw: unknown): Strength {
  if (!isObject(raw)) throw new Error("not an object");
  return { size: count(raw["size"], "size", 2), eloVsNormal: real(raw["elo_vs_normal"], "elo_vs_normal") };
}

/**
 * Reads a card, throwing an `Error` whose message says what is wrong. A card whose plane count the site
 * cannot encode is refused here, so no model is started with an input it cannot build. A strength entry
 * that is malformed is left out (the rest of the card is still true); everything else is required.
 */
export function parseCard(json: unknown): ModelCard {
  if (!isObject(json)) throw new Error("The model card is not an object");
  const network = json["network"];
  if (!isObject(network)) throw new Error("The model card has no network description");
  const head = network["head"];
  if (head !== "fc" && head !== "conv") throw new Error("The model card names a network head the site does not know");
  const inputPlanes = count(network["input_planes"], "input_planes", 1);
  if (!SUPPORTED_PLANES.includes(inputPlanes)) {
    throw new Error(`The model needs ${inputPlanes} input planes; this site encodes ${SUPPORTED_PLANES.join(" or ")}`);
  }
  const names = json["plane_names"];
  if (!Array.isArray(names) || names.length !== inputPlanes) throw new Error("plane_names does not match input_planes");
  const sizes = json["sizes"];
  if (!Array.isArray(sizes) || sizes.length === 0 || sizes.length > MAX_ENTRIES) throw new Error("sizes is not a list of board sizes");
  const strength = Array.isArray(json["strength"]) ? (json["strength"] as unknown[]).slice(0, MAX_ENTRIES) : [];
  const sha256 = text(json["sha256"], "sha256");
  if (!/^[0-9a-f]{64}$/.test(sha256)) throw new Error("sha256 is not 64 lowercase hex digits");
  const card: ModelCard = {
    id: text(json["id"], "id"),
    displayName: text(json["display_name"], "display_name"),
    sizes: sizes.map((size) => count(size, "a size", 2)),
    trainedSize: count(json["trained_size"], "trained_size", 2),
    sha256,
    license: text(json["license"], "license"),
    parameters: count(json["parameters"], "parameters"),
    network: {
      head,
      inputPlanes,
      channels: count(network["channels"], "channels", 1),
      blocks: count(network["blocks"], "blocks"),
      poolEvery: orNull(network["pool_every"], (value) => count(value, "pool_every", 1)),
      headChannels: orNull(network["head_channels"], (value) => count(value, "head_channels", 1)),
      boardSize: orNull(network["board_size"], (value) => count(value, "board_size", 2)),
    },
    planeNames: names.map((name) => text(name, "a plane name")),
    strength: strength.flatMap((entry) => {
      try {
        return [readStrength(entry)];
      } catch {
        return [];
      }
    }),
  };
  if (head === "fc" && (card.sizes.length !== 1 || card.sizes[0] !== card.trainedSize)) throw new Error("An fc model plays its trained size only");
  return card;
}

/** Whether a model plays `size`: a conv model any size its card lists, an fc model only the size it was trained on. */
export function supportsSize(card: ModelCard, size: number): boolean {
  return card.network.head === "fc" ? size === card.trainedSize : card.sizes.includes(size);
}

/** What a session is checked against: the card's plane count, and the one board size an fc model is fixed to. */
export function inputOf(card: ModelCard): { readonly planes: number; readonly fixedSize: number | null } {
  return { planes: card.network.inputPlanes, fixedSize: card.network.head === "fc" ? card.trainedSize : null };
}
