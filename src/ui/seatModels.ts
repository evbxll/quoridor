import type { ModelState } from "../model/manager";
import type { Players, Side } from "./controller";
import { HUMAN } from "./controller";
import { withModel } from "./bots";

/** Whether the gallery offers a model at a board size. */
export type Offered = (id: string, size: number) => boolean;

/** The model a seat may keep on a board: the one it has if the gallery offers it there, else none (the main model). */
export const playableModel = (model: string | undefined, offered: Offered, size: number): string | undefined =>
  model !== undefined && offered(model, size) ? model : undefined;

/** A seat that lost its model because the board does not offer it. */
export interface Dropped {
  readonly side: Side;
  readonly model: string;
}

/** The seats with a model the board does not offer, and the players with that model taken away (the main bot plays instead). */
export function dropUnplayable(players: Players, offered: Offered, size: number): { readonly players: Players; readonly dropped: readonly Dropped[] } {
  const dropped: Dropped[] = [];
  const next = { ...players };
  for (const side of ["p1", "p2"] as const) {
    const seat = players[side];
    if (seat === HUMAN || seat.model === undefined || playableModel(seat.model, offered, size) !== undefined) continue;
    dropped.push({ side, model: seat.model });
    next[side] = withModel(seat, undefined);
  }
  return { players: next, dropped };
}

/** One sentence for every seat that lost its model, or null if none did. */
export function droppedSentence(dropped: readonly Dropped[], size: number, nameOf: (id: string) => string): string | null {
  if (dropped.length === 0) return null;
  const parts = dropped.map(({ side, model }) => `${nameOf(model)} is not offered on ${size} × ${size}, so player ${side === "p1" ? 1 : 2} plays the main network`);
  return `${parts.join("; ")}.`;
}

/** Changes who plays in the game on the board, then brings the loaded models in line with the seats. */
export function setSeatPlayers(controller: { setPlayers(players: Players): void }, players: Players, sync: () => void): void {
  controller.setPlayers(players);
  sync();
}

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
