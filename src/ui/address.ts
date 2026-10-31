import { type GameRecord, playersOf } from "./history";
import { addressOf } from "./setupLink";

/** The address that opens a recorded game: its board size, both of its players as they were, and its moves. */
export function recordHash(record: GameRecord): string {
  return addressOf(`#n=${record.size}&m=${record.moves}`, playersOf(record));
}

/** The part of the browser that opening a recorded game uses: the address's hash, and adding an entry to the session history. */
export interface Navigation {
  readonly hash: string;
  push(hash: string): void;
}

/**
 * Opens a recorded game in place with `open`, and returns what it returns. Its address gets its own history entry
 * first, so Back returns to the game before; the page does not wait for a change of address, which it could rewrite
 * before reading it.
 */
export function openRecordAt(record: GameRecord, navigation: Navigation, open: (hash: string) => boolean): boolean {
  const hash = recordHash(record);
  if (navigation.hash !== hash) navigation.push(hash);
  return open(hash);
}

/** Rewrites the address bar to `hash` if it differs. Some browsers throw if the address is rewritten too often, and a progress bar needs no new address. */
export function syncAddress(hash: string): void {
  if (location.hash !== hash) history.replaceState(null, "", hash);
}

/** Copies the page's address to the clipboard and says how it went. */
export function copyLink(announce: (text: string) => void): void {
  navigator.clipboard.writeText(location.href).then(
    () => announce("Link copied."),
    () => announce("Could not copy; the link is in the address bar."),
  );
}
