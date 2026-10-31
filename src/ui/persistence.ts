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

const SETUP_KEY = "quoridor.setup.v1";

/** The board size and seats the viewer last used, as `setupText` writes them, or null; a page opened without a link starts from them. */
export function savedSetupText(): string | null {
  try {
    return localStorage.getItem(SETUP_KEY);
  } catch {
    return null;
  }
}

export function saveSetupText(text: string): void {
  try {
    localStorage.setItem(SETUP_KEY, text);
  } catch {
    // The setup then lasts for this visit only.
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
