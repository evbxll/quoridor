import { ANALYSIS_SIMULATIONS, type Analysis } from "../analysis";
import type { GameController } from "../controller";
import { element } from "../dom";
import { evalBar } from "../evalBar";
import { barBlurb, markerBlurb } from "../evalTip";
import type { Tooltips } from "../tooltip";

const SIDES = ["p1", "p2"] as const;

/** Sets a blurb's text; one that is open updates in place, and nothing is announced. */
function setTip(id: string, text: string): void {
  const tip = element(id, HTMLElement);
  if (tip.textContent !== text) tip.textContent = text;
}

/** Draws the eval bar: its fill, the two percentages and each bot's marker, with the blurbs that explain them. */
export class EvalView {
  /** The bar's last fresh percentage, kept (dimmed) while the next position is read. */
  private shownPercent: number | null = null;

  /** Forgets the last reading, as a new game or a game opened from a link starts without one. */
  reset(): void {
    this.shownPercent = null;
  }

  /** `visible` says whether the bar is shown at all; `analysisChecked` is the Analysis checkbox. */
  draw(controller: GameController, analysis: Analysis, visible: boolean, analysisChecked: boolean, tooltips: Tooltips): void {
    const container = element("eval", HTMLElement);
    const meter = element("eval-meter", HTMLElement);
    // A person may hide the evaluation so as not to lean on it; two bots playing always show it.
    const ticks = visible && (!controller.hasHuman || analysisChecked);
    const bar = evalBar(analysis.view, this.shownPercent, ticks ? controller.opinions(analysis.ply) : null);
    container.classList.toggle("off", !visible);
    container.setAttribute("aria-hidden", String(!visible));
    if (!bar.stale) this.shownPercent = bar.percent;
    container.classList.toggle("empty", bar.percent === null);
    container.classList.toggle("stale", bar.stale);
    if (bar.percent === null) meter.removeAttribute("aria-valuenow");
    else meter.setAttribute("aria-valuenow", String(bar.percent));
    meter.setAttribute("aria-valuetext", bar.label);
    element("eval-fill", HTMLElement).style.height = `${bar.percent ?? 0}%`;
    element("eval-p1", HTMLElement).textContent = bar.percent === null ? "–" : `${bar.percent}%`;
    element("eval-p2", HTMLElement).textContent = bar.percent === null ? "–" : `${100 - bar.percent}%`;
    const sources = ticks ? controller.opinionSources(analysis.ply) : null;
    for (const side of SIDES) {
      const tick = element(`tick-${side}`, HTMLElement);
      const value = bar.ticks[side];
      tick.hidden = value === null;
      if (value !== null) tick.style.bottom = `${value}%`;
      setTip(`tip-${side}`, markerBlurb({ side, seat: controller.players[side], p1Percent: value, source: sources?.[side] ?? null, viewingPast: analysis.viewingPast }));
    }
    const status = analysis.view.status;
    setTip("tip-bar", barBlurb({ percent: bar.percent, stale: bar.stale, unavailable: status === "unavailable", failed: status === "failed", ply: analysis.ply, moves: controller.moves.length, simulations: ANALYSIS_SIMULATIONS }));
    tooltips.refresh();
  }
}
