import type { ModelState } from "../model/manager";

/** The part of the model manager the seats use. */
export interface ModelPort {
  ensure(id: string): Promise<void>;
  release(id: string): Promise<void>;
}

/**
 * Keeps the models the seats use loaded and no others. `sync` is told which gallery models the seats hold now:
 * a model newly held is loaded (`ensure`), one no seat holds any more is released, so the worker keeps the main
 * model and at most one session per seat. It also says, once per load, that a model became ready or failed.
 * It is idempotent, so the page calls it after every change.
 */
export class SeatModels {
  private readonly held = new Set<string>();
  /** The last status said aloud per held model, so each ready or failed is said once. */
  private readonly told = new Map<string, ModelState["status"]>();

  constructor(
    private readonly port: ModelPort,
    private readonly say: (id: string, state: ModelState) => void,
  ) {}

  /** The ids being held. */
  get ids(): ReadonlySet<string> {
    return this.held;
  }

  sync(used: Iterable<string>, stateOf: (id: string) => ModelState): void {
    const wanted = new Set(used);
    for (const id of [...this.held]) {
      if (wanted.has(id)) continue;
      this.held.delete(id);
      this.told.delete(id);
      void this.port.release(id);
    }
    for (const id of wanted) {
      if (!this.held.has(id)) {
        this.held.add(id);
        void this.port.ensure(id);
      }
      const status = stateOf(id).status;
      if (status === this.told.get(id)) continue;
      this.told.set(id, status);
      if (status === "ready" || status === "failed" || status === "unavailable") this.say(id, stateOf(id));
    }
  }

  /** Tries a failed model again; if it fails again that is said again, since the status passes through downloading. */
  retry(id: string): void {
    void this.port.ensure(id);
  }
}
