import type { StorageLike } from "./history";

const SHOW_EVAL_KEY = "quoridor.showEval";

/** Whether the viewer last chose to see the evaluation in games with a person; on until switched off. Storage can be blocked. */
export function savedShowEval(): boolean {
  try {
    return localStorage.getItem(SHOW_EVAL_KEY) !== "off";
  } catch {
    return true;
  }
}

export function saveShowEval(on: boolean): void {
  try {
    localStorage.setItem(SHOW_EVAL_KEY, on ? "on" : "off");
  } catch {
    // The choice then lasts for this visit only.
  }
}

/** The browser's storage, or null where it is blocked. */
export function savedStorage(): StorageLike | null {
  try {
    return localStorage;
  } catch {
    return null;
  }
}
