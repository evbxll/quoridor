import { inputOf, type ModelCard, supportsSize } from "./card";
import { botFor, type ModelEntry, type ModelIndex, networkWithheld } from "./index";
import { type FailureKind, loadCard, loadIndex, loadModel, type ModelEnv, ModelError } from "./store";

/** Where one network stands. */
export type ModelState =
  /**
   * There is no network to use: nothing is published for the size (or there is no index), or the index says
   * outright that it is not offered, or the model is not in the index, its card cannot be used (`message` says why),
   * or it does not play the size asked about. Beginner and Normal use the heuristic either way; the page keeps Strong and Max off.
   */
  | { readonly status: "unavailable"; readonly reason: "none-published" | "not-offered" | "unknown-model" | "bad-card" | "unsupported-size"; readonly message?: string }
  | { readonly status: "checking" }
  /** A gallery model that nobody has asked for yet: nothing is downloaded until `ensure`. */
  | { readonly status: "idle" }
  | { readonly status: "downloading"; readonly loaded: number; readonly total: number | null }
  | { readonly status: "ready"; readonly model: string; readonly fromCache: boolean; readonly saved: boolean }
  | { readonly status: "failed"; readonly message: string; readonly kind: FailureKind };

/** What the worker needs to start a session. */
export interface StartInfo {
  readonly id: string;
  /** Input planes from the model's card. */
  readonly planes: number;
  /** The one board size an fc model plays, else null. */
  readonly fixedSize: number | null;
  /** Whether searches that name no model use this one: true for the network `select` loads for a size. */
  readonly asDefault: boolean;
}

interface Run {
  readonly number: number;
  readonly abort: AbortController;
}

/**
 * Finds models in the index, downloads and checks them, and hands their bytes to `start` (which gives the
 * search worker a session for the model id). The page keeps playing with the heuristic until a state is `ready`.
 *
 * `select(size)` loads the network that plays the size (the bot); one such network is active at a time, and the
 * size selected last decides which: a download for another size that finishes after it is kept in Cache Storage but
 * not started, and when the active one changes the old one is stopped. `ensure(id)` loads any model of the index
 * by id, for a seat that picked it, and keeps it until the page is closed; models are never loaded before they are asked for.
 */
export class ModelManager {
  private index: ModelIndex | null | undefined;
  private indexFailure: ModelError | null = null;
  private reading: Promise<void> | null = null;
  private readonly states = new Map<string, ModelState>();
  private readonly runs = new Map<string, Run>();
  private readonly flights = new Map<string, Promise<void>>();
  private readonly cards = new Map<string, Promise<ModelCard>>();
  private readonly known = new Map<string, ModelCard>();
  /** Ids a seat asked for with `ensure`: they stay started when the size-selected network changes. */
  private readonly pinned = new Set<string>();
  private wanted: ModelEntry | null = null;
  /** The model the worker uses for searches that name none. */
  private defaultId: string | null = null;
  private runCount = 0;

  constructor(
    private readonly env: ModelEnv,
    private readonly start: (bytes: ArrayBuffer, info: StartInfo) => Promise<void>,
    private readonly onChange: () => void,
    private readonly stop?: (id: string) => Promise<void>,
  ) {}

  /** The state of the network that plays `size`. */
  state(size: number): ModelState {
    if (this.indexFailure) return { status: "failed", message: this.indexFailure.message, kind: this.indexFailure.kind };
    if (this.index === undefined) return { status: "checking" };
    if (networkWithheld(this.index, size)) return { status: "unavailable", reason: "not-offered" };
    const entry = botFor(this.index, size);
    if (!entry) return { status: "unavailable", reason: "none-published" };
    return this.states.get(entry.id) ?? { status: "checking" };
  }

  /** The id of the model that plays `size` as the bot, or null if none is published for it (or the index is not read). */
  mainIdFor(size: number): string | null {
    return botFor(this.index ?? null, size)?.id ?? null;
  }

  /** The state of the model `id`, whichever sizes it plays. */
  stateOf(id: string): ModelState {
    if (this.indexFailure) return { status: "failed", message: this.indexFailure.message, kind: this.indexFailure.kind };
    if (this.index === undefined) return { status: "checking" };
    if (!this.index?.models.some((entry) => entry.id === id)) return { status: "unavailable", reason: "unknown-model" };
    return this.states.get(id) ?? { status: "idle" };
  }

  /** The state of the model `id` for a game on `size`: unavailable when its card says it does not play that size (a card not read yet cannot say). */
  stateFor(id: string, size: number): ModelState {
    const card = this.known.get(id);
    return card && !supportsSize(card, size) ? { status: "unavailable", reason: "unsupported-size" } : this.stateOf(id);
  }

  /** The card of a model of the index, read on first use and kept. Rejects with a `ModelError` when the model is unknown or its card cannot be used. */
  async card(id: string): Promise<ModelCard> {
    await this.read();
    if (this.indexFailure) throw this.indexFailure;
    const entry = this.index?.models.find((model) => model.id === id);
    if (!entry) throw new ModelError("card", `There is no model ${id}.`);
    return this.cardOf(entry);
  }

  /** The card if it has been read, else null; never fetches. */
  cardIfLoaded(id: string): ModelCard | null {
    return this.known.get(id) ?? null;
  }

  /** Ids of the gallery models, in the published order; empty until the index is read. */
  get gallery(): readonly string[] {
    return this.index?.gallery ?? [];
  }

  /** Whether any network is published for any size: false once the index is read and names none, null until then (or if it could not be read). */
  get publishesAny(): boolean | null {
    if (this.indexFailure || this.index === undefined) return null;
    return this.index !== null && Object.values(this.index.bots).some((id) => this.index!.models.some((entry) => entry.id === id));
  }

  /** Starts loading the network for `size` if it is not loaded or loading; reads the index first time. */
  async select(size: number): Promise<void> {
    await this.load(size, false);
  }

  /** Tries again after a failure: reads the index again if that failed, else aborts a download that hangs and starts over. */
  async retry(size: number): Promise<void> {
    if (this.indexFailure) {
      this.indexFailure = null;
      this.index = undefined;
      this.reading = null;
      this.onChange();
    }
    await this.load(size, true);
  }

  /**
   * Loads the model `id`: resolves when it is ready, or has failed or is unavailable (see `stateOf`). A model that is
   * already loading is awaited, not started twice; one that failed is tried again. Two ids load side by side.
   */
  async ensure(id: string): Promise<void> {
    await this.read();
    if (this.indexFailure) return;
    const entry = this.index?.models.find((model) => model.id === id);
    if (!entry) return;
    this.pinned.add(id);
    const current = this.states.get(id)?.status;
    if (current === "ready") return;
    await (current === "downloading" ? this.flights.get(id) : this.download(entry));
  }

  /**
   * Stops the session of a model a seat no longer uses; it loads again from Cache Storage on the next `ensure`.
   * The network of the selected size is still in use by the bot, so for it a release only unpins.
   */
  async release(id: string): Promise<void> {
    this.pinned.delete(id);
    if (this.wanted?.id === id) return;
    if (this.defaultId === id) this.defaultId = null;
    if (this.states.get(id)?.status !== "ready") return;
    this.states.delete(id);
    this.onChange();
    await this.stop?.(id);
  }

  private read(): Promise<void> {
    this.reading ??= loadIndex(this.env)
      .then((index) => {
        this.index = index;
      })
      .catch((error: unknown) => {
        this.indexFailure = error instanceof ModelError ? error : new ModelError("network", "The network could not be looked up.");
      })
      .finally(() => this.onChange());
    return this.reading;
  }

  private cardOf(entry: ModelEntry): Promise<ModelCard> {
    let card = this.cards.get(entry.id);
    if (!card) {
      card = loadCard(this.env, entry).then((read) => {
        this.known.set(entry.id, read);
        return read;
      });
      // A card that failed is read again next time (a retry, or a later look).
      card.catch(() => this.cards.delete(entry.id));
      this.cards.set(entry.id, card);
    }
    return card;
  }

  private async load(size: number, restart: boolean): Promise<void> {
    await this.read();
    if (this.indexFailure) return;
    const entry = networkWithheld(this.index ?? null, size) ? null : botFor(this.index ?? null, size);
    this.wanted = entry;
    if (!entry) return;
    const current = this.states.get(entry.id)?.status;
    // A model a seat loaded already is started again when it becomes the size's network, so the worker's default follows.
    if (!restart && (current === "downloading" || (current === "ready" && this.defaultId === entry.id))) return;
    if (restart && current === "ready") return;
    this.runs.get(entry.id)?.abort.abort();
    await this.download(entry);
  }

  private download(entry: ModelEntry): Promise<void> {
    const flight = this.run(entry);
    this.flights.set(entry.id, flight);
    return flight;
  }

  private async run(entry: ModelEntry): Promise<void> {
    const id = entry.id;
    const run: Run = { number: ++this.runCount, abort: new AbortController() };
    this.runs.set(id, run);
    const current = (): boolean => this.runs.get(id) === run;
    this.set(id, { status: "downloading", loaded: 0, total: null });
    // Together: the card is a few kB, and the page must not wait a round trip for it before the model starts.
    const cardRead = this.cardOf(entry);
    cardRead.catch(() => run.abort.abort());
    // Whether a later choice of another size's network makes this one not start: not for a model a seat asked for.
    const superseded = (): boolean => !this.pinned.has(id) && this.wanted?.id !== id;
    try {
      const [card, model] = await Promise.all([
        cardRead,
        loadModel(this.env, entry, (progress) => current() && this.set(id, { status: "downloading", ...progress }), run.abort.signal),
      ]);
      if (!current()) return;
      if (superseded()) {
        // Another size was chosen while this downloaded: keep the copy, leave the active network alone.
        this.states.delete(id);
        this.onChange();
        return;
      }
      const begin = (asDefault: boolean): Promise<void> =>
        this.start(model.bytes, { id, ...inputOf(card), asDefault }).catch((error: unknown) => {
          throw new ModelError("start", `The network could not be started (${error instanceof Error ? error.message : String(error)}).`);
        });
      const startedAsDefault = this.wanted?.id === id;
      await begin(startedAsDefault);
      if (!current()) return;
      if (superseded()) {
        // Another size was chosen while the worker started this one: free the session it made.
        this.states.delete(id);
        this.onChange();
        void this.stop?.(id);
        return;
      }
      if (this.wanted?.id === id && !startedAsDefault) {
        // This size was chosen while the worker started the model for a seat: start it again as the default, from the same bytes.
        await begin(true);
        if (!current()) return;
      }
      if (this.wanted?.id === id) {
        this.defaultId = id;
        for (const [other, state] of this.states) {
          if (other === id || state.status !== "ready" || this.pinned.has(other)) continue;
          this.states.delete(other);
          void this.stop?.(other);
        }
      }
      this.set(id, { status: "ready", model: id, fromCache: model.fromCache, saved: model.saved });
    } catch (error) {
      if (!current()) return;
      const failure = error instanceof ModelError ? error : new ModelError("network", error instanceof Error ? error.message : String(error));
      this.set(id, failure.kind === "card" ? { status: "unavailable", reason: "bad-card", message: failure.message } : { status: "failed", message: failure.message, kind: failure.kind });
    } finally {
      if (current()) this.runs.delete(id);
    }
  }

  private set(id: string, state: ModelState): void {
    this.states.set(id, state);
    this.onChange();
  }
}
