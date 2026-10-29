import { type Schedule, timeout } from "./autoplay";

/** How long the question "Replace the current game?" waits for an answer, in milliseconds. */
export const CONFIRM_MS = 6000;

export type OpenState = { readonly phase: "idle" } | { readonly phase: "confirming"; readonly id: number };

/**
 * Opening a past game from the history: at once when no game is in progress, else only after a Yes.
 * idle -> confirming -> idle (opened, cancelled, or timed out). It has no DOM.
 */
export class OpenConfirm {
  private current: OpenState = { phase: "idle" };
  private cancelTimer: (() => void) | null = null;

  constructor(
    private readonly inProgress: () => boolean,
    private readonly open: (id: number) => void,
    private readonly onChange: () => void,
    private readonly schedule: Schedule = timeout,
  ) {}

  get state(): OpenState {
    return this.current;
  }

  /** Open was pressed for game `id`: returns "opened" if it opened at once, "asking" if the question is up. */
  request(id: number): "opened" | "asking" {
    if (!this.inProgress()) {
      this.settle();
      this.open(id);
      return "opened";
    }
    this.cancelTimer?.();
    this.current = { phase: "confirming", id };
    this.cancelTimer = this.schedule(() => this.cancel(), CONFIRM_MS);
    this.onChange();
    return "asking";
  }

  /** Yes was pressed. */
  confirm(): void {
    if (this.current.phase !== "confirming") return;
    const { id } = this.current;
    this.settle();
    this.open(id);
  }

  /** Cancel, Escape, leaving the question, or the time running out. */
  cancel(): void {
    if (this.current.phase !== "confirming") return;
    this.settle();
  }

  private settle(): void {
    this.cancelTimer?.();
    this.cancelTimer = null;
    const was = this.current;
    this.current = { phase: "idle" };
    if (was.phase !== "idle") this.onChange();
  }
}
