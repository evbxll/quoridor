import type { AnalysisView } from "./analysis";
import type { Opinions, Side } from "./controller";

/** A share from 0 to 1 as a whole percentage. */
export function toPercent(share: number): number {
  return Math.round(Math.min(1, Math.max(0, share)) * 100);
}

/** Player 1's share in words, both ways round. */
export function shareLabel(percent: number): string {
  return `Player 1 ${percent}%, player 2 ${100 - percent}%`;
}

/** What the vertical eval bar beside the board shows. */
export interface EvalBar {
  /** Player 1's share in whole percent; the fill rises from player 1's side, at the bottom. Null when there is nothing to show. */
  readonly percent: number | null;
  /** The fill is an earlier position's reading, kept while this one is read. */
  readonly stale: boolean;
  /** The bar in words, for its `aria-valuetext`. */
  readonly label: string;
  /** Each bot's own reading in whole percent, for the markers beside the bar; null hides a marker. */
  readonly ticks: Readonly<Record<Side, number | null>>;
}

/**
 * The bar for the network's reading of the shown position. While a new
 * position is read, the bar keeps `previous` (the last percentage it showed)
 * and says it is stale, so it does not flash empty after every move.
 */
export function evalBar(view: AnalysisView, previous: number | null, opinions: Opinions | null): EvalBar {
  const ticks = { p1: opinions?.p1 == null ? null : toPercent(opinions.p1), p2: opinions?.p2 == null ? null : toPercent(opinions.p2) };
  switch (view.status) {
    case "unavailable":
      return { percent: null, stale: false, label: "No evaluation: the network is not ready.", ticks };
    case "ready": {
      const percent = toPercent(view.reading.p1Share);
      return { percent, stale: false, label: shareLabel(percent), ticks };
    }
    case "searching":
    case "failed": {
      const reason = view.status === "searching" ? "The network is reading this position." : "The network could not read this position.";
      return {
        percent: previous,
        stale: previous !== null,
        label: previous === null ? reason : `${shareLabel(previous)}, from an earlier position. ${reason}`,
        ticks,
      };
    }
  }
}
