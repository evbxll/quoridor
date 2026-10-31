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

const NOTE_KEY = "quoridor.note";
/** How long a kept note is still worth saying: the page's one reload for cross-origin isolation takes well under this. */
const NOTE_MS = 15_000;

/** The tab's sessionStorage, or null where it is blocked. */
export function sessionStore(): Pick<Storage, "getItem" | "setItem" | "removeItem"> | null {
  try {
    return sessionStorage;
  } catch {
    return null;
  }
}

/** Keeps a sentence for the page that follows a reload, so it is said there too. */
export function keepNote(text: string, now: number, store = sessionStore()): void {
  try {
    store?.setItem(NOTE_KEY, JSON.stringify({ text, at: now }));
  } catch {
    // The sentence was said once already.
  }
}

/** The sentence kept before a reload, if it is recent; it is taken, so it is said once. */
export function takeNote(now: number, store = sessionStore()): string | null {
  try {
    const raw = store?.getItem(NOTE_KEY) ?? null;
    store?.removeItem(NOTE_KEY);
    const note = raw === null ? null : (JSON.parse(raw) as { text?: unknown; at?: unknown });
    return note !== null && typeof note.text === "string" && typeof note.at === "number" && now - note.at >= 0 && now - note.at < NOTE_MS ? note.text : null;
  } catch {
    return null;
  }
}
