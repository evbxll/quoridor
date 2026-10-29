/** One published model: `path` is relative to the site root, as `quoridor-publish` writes it. */
export interface ModelEntry {
  readonly id: string;
  readonly path: string;
  readonly sha256: string;
}

/**
 * A `bots` value that means "no network at this size": the heuristic plays
 * Beginner and Normal and Strong and Max stay off. `quoridor-publish` writes
 * the id of a model there and never this value; it is for editing by hand.
 */
export const NO_NETWORK = "heuristic";

/** `public/models/index.json`: the models, and which one plays each board size. */
export interface ModelIndex {
  readonly models: readonly ModelEntry[];
  /** Model id per size, or `NO_NETWORK`. */
  readonly bots: Readonly<Record<number, string>>;
  /** Ids of the models offered for choosing beyond the bots, in the order the publisher listed them; empty when the index has no `gallery`. */
  readonly gallery: readonly string[];
}

const ID = /^[A-Za-z0-9._-]+$/;
const SHA256 = /^[0-9a-f]{64}$/;

/**
 * Reads an index, keeping only what is well formed: a model needs a safe id
 * (not `NO_NETWORK`, and the first of a repeated id wins), a path and a
 * lowercase sha256, and a bot must name a model in the list or be `NO_NETWORK`.
 * The optional `gallery` is an ordered list of ids: only ids of listed models are kept, once each.
 * `scripts/verify-dist.mjs` refuses a dist where any of this would be dropped.
 * Throws if `json` is not an index at all.
 */
export function parseIndex(json: unknown): ModelIndex {
  if (typeof json !== "object" || json === null) throw new Error("The model index is not an object");
  const { models, bots, gallery } = json as { models?: unknown; bots?: unknown; gallery?: unknown };
  if (!Array.isArray(models) || typeof bots !== "object" || bots === null) throw new Error("The model index has no models and bots");
  const entries: ModelEntry[] = [];
  for (const model of models as (Record<string, unknown> | null)[]) {
    const { id, path, sha256 } = model ?? {};
    if (
      typeof id === "string" &&
      ID.test(id) &&
      id !== NO_NETWORK &&
      typeof path === "string" &&
      typeof sha256 === "string" &&
      SHA256.test(sha256) &&
      !entries.some((entry) => entry.id === id)
    ) {
      entries.push({ id, path, sha256 });
    }
  }
  const chosen: Record<number, string> = {};
  for (const [size, id] of Object.entries(bots)) {
    if (Number.isInteger(Number(size)) && (id === NO_NETWORK || entries.some((entry) => entry.id === id))) chosen[Number(size)] = id as string;
  }
  const listed: string[] = [];
  for (const id of Array.isArray(gallery) ? (gallery as unknown[]) : []) {
    if (typeof id === "string" && entries.some((entry) => entry.id === id) && !listed.includes(id)) listed.push(id);
  }
  return { models: entries, bots: chosen, gallery: listed };
}

/** The gallery's models, in the published order. */
export function galleryEntries(index: ModelIndex | null): ModelEntry[] {
  return (index?.gallery ?? []).flatMap((id) => index?.models.filter((entry) => entry.id === id) ?? []);
}

/** The model that plays `size` with the network, or null if none is published for it or the size is set to `NO_NETWORK`. */
export function botFor(index: ModelIndex | null, size: number): ModelEntry | null {
  const id = index?.bots[size];
  return index?.models.find((entry) => entry.id === id) ?? null;
}

/** Whether the index says outright that the network is not offered at `size`. */
export function networkWithheld(index: ModelIndex | null, size: number): boolean {
  return index?.bots[size] === NO_NETWORK;
}
