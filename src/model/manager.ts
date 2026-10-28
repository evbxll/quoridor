import { botFor, type ModelEntry, type ModelIndex, networkWithheld } from "./index";
import { type FailureKind, loadIndex, loadModel, type ModelEnv, ModelError } from "./store";

/** Where the network for one board size stands. */
export type ModelState =
  /**
   * There is no network at this size: nothing is published for it (or there is no index), or the index says
   * outright that it is not offered. Beginner and Normal use the heuristic either way; the page keeps Strong and Max off.
   */
  | { readonly status: "unavailable"; readonly reason: "none-published" | "not-offered" }
  | { readonly status: "checking" }
  | { readonly status: "downloading"; readonly loaded: number; readonly total: number | null }
  | { readonly status: "ready"; readonly model: string; readonly fromCache: boolean; readonly saved: boolean }
  | { readonly status: "failed"; readonly message: string; readonly kind: FailureKind };

interface Run {
  readonly number: number;
  readonly abort: AbortController;
}

/**
 * Finds the model for a board size, downloads and checks it, and hands its
 * bytes to `start` (which configures the search worker). The page keeps
 * playing with the heuristic until a size's state is `ready`.
 *
 * One network is active at a time. The size selected last decides which: a
 * download for another size that finishes after it is kept in Cache Storage
 * but not started, and loads again from there if its size is selected.
 */
export class ModelManager {
  private index: ModelIndex | null | undefined;
  private indexFailure: ModelError | null = null;
  private reading: Promise<void> | null = null;
  private readonly states = new Map<string, ModelState>();
  private readonly runs = new Map<string, Run>();
  private wanted: ModelEntry | null = null;
  private runCount = 0;

  constructor(
    private readonly env: ModelEnv,
    private readonly start: (bytes: ArrayBuffer) => Promise<void>,
    private readonly onChange: () => void,
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

  private async load(size: number, restart: boolean): Promise<void> {
    this.reading ??= loadIndex(this.env)
      .then((index) => {
        this.index = index;
      })
      .catch((error: unknown) => {
        this.indexFailure = error instanceof ModelError ? error : new ModelError("network", "The network could not be looked up.");
      })
      .finally(() => this.onChange());
    await this.reading;
    if (this.indexFailure) return;
    const entry = networkWithheld(this.index ?? null, size) ? null : botFor(this.index ?? null, size);
    this.wanted = entry;
    if (!entry) return;
    const current = this.states.get(entry.id)?.status;
    if (!restart && (current === "downloading" || current === "ready")) return;
    if (restart && current === "ready") return;
    this.runs.get(entry.id)?.abort.abort();
    await this.download(entry);
  }

  private async download(entry: ModelEntry): Promise<void> {
    const id = entry.id;
    const run: Run = { number: ++this.runCount, abort: new AbortController() };
    this.runs.set(id, run);
    const current = (): boolean => this.runs.get(id) === run;
    this.set(id, { status: "downloading", loaded: 0, total: null });
    try {
      const model = await loadModel(this.env, entry, (progress) => current() && this.set(id, { status: "downloading", ...progress }), run.abort.signal);
      if (!current()) return;
      if (this.wanted?.id !== id) {
        // Another size was chosen while this downloaded: keep the copy, leave the active network alone.
        this.states.delete(id);
        this.onChange();
        return;
      }
      await this.start(model.bytes).catch((error: unknown) => {
        throw new ModelError("start", `The network could not be started (${error instanceof Error ? error.message : String(error)}).`);
      });
      if (!current()) return;
      if (this.wanted?.id !== id) {
        // Another size was chosen while the worker started this one; the later start wins in the worker.
        this.states.delete(id);
        this.onChange();
        return;
      }
      for (const [other, state] of this.states) if (other !== id && state.status === "ready") this.states.delete(other);
      this.set(id, { status: "ready", model: id, fromCache: model.fromCache, saved: model.saved });
    } catch (error) {
      if (!current()) return;
      const failure = error instanceof ModelError ? error : new ModelError("network", error instanceof Error ? error.message : String(error));
      this.set(id, { status: "failed", message: failure.message, kind: failure.kind });
    } finally {
      if (current()) this.runs.delete(id);
    }
  }

  private set(id: string, state: ModelState): void {
    this.states.set(id, state);
    this.onChange();
  }
}
