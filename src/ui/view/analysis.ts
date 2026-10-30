import type { Analysis } from "../analysis";
import type { GameController } from "../controller";
import { element } from "../dom";
import { botsArePlaying } from "../status";

/** How many suggested moves the analysis lists; matches the three rows reserved for them. */
const TOP_LINES = 3;

/** Draws the Analysis box: the moves the network would choose most often, or why there are none. `open` says whether the box is shown. */
export function drawAnalysis(controller: GameController, analysis: Analysis, open: boolean, announce: (text: string) => void): void {
  element("analysis-box", HTMLElement).hidden = !open;
  if (!open) return;
  const view = analysis.view;
  const lines = element("analysis-lines", HTMLOListElement);
  const note = element("analysis-note", HTMLElement);
  const reading = view.status === "ready" ? view.reading.lines : [];
  const rows: HTMLLIElement[] = [];
  for (let i = 0; i < TOP_LINES; i++) {
    const line = reading[i];
    const item = document.createElement("li");
    if (line === undefined) item.className = "blank";
    else {
      const percent = Math.round(line.share * 100);
      item.className = i === 0 ? "best" : "";
      item.innerHTML = `<span class="rank">${i + 1}</span><span class="move"></span><span class="share"><span style="width:${percent}%"></span></span><span class="percent">${percent}%</span>`;
      item.querySelector(".move")!.textContent = line.move;
    }
    rows.push(item);
  }
  lines.replaceChildren(...rows);
  if (view.status === "ready") {
    note.textContent = reading.length > 0 ? "The player to move would choose these most often." : "The game is over here.";
    // While two bots play on, a new reading arrives with every move; it stays on screen but is not read aloud.
    const sentence = botsArePlaying(controller) ? null : analysis.takeAnnouncement();
    if (sentence) announce(sentence);
  } else {
    note.textContent =
      view.status === "unavailable"
        ? "Analysis needs the network, which is not ready."
        : view.status === "searching"
          ? "The network is reading this position."
          : `The analysis failed (${view.message}).`;
  }
}
