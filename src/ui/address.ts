import type { GameRecord } from "./history";

/** The address that opens a recorded game: its board size and moves. */
export function recordHash(record: GameRecord): string {
  return `#n=${record.size}&m=${record.moves}`;
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
