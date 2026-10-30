import type { ModelState } from "../../model/manager";
import { element } from "../dom";
import { describeNetwork } from "../networkText";

/** Draws where the network stands: the chip in the top bar and its popover, with the download progress and the retry button. */
export function drawNetwork(state: ModelState, size: number): void {
  const networkProgress = element("network-progress", HTMLProgressElement);
  const networkRetry = element("network-retry", HTMLButtonElement);
  const { line, chip, tone } = describeNetwork(state, size);
  const text = element("network-text", HTMLElement);
  if (text.textContent !== line) text.textContent = line;
  element("network-chip", HTMLElement).textContent = `Network: ${chip}`;
  element("network-dot", HTMLElement).dataset["tone"] = tone;
  if (state.status === "downloading") {
    networkProgress.hidden = false;
    if (state.total === null) networkProgress.removeAttribute("value");
    else {
      networkProgress.max = state.total;
      networkProgress.value = state.loaded;
    }
  } else networkProgress.hidden = true;
  if (state.status !== "failed" && document.activeElement === networkRetry) element("network-summary", HTMLElement).focus();
  networkRetry.hidden = state.status !== "failed";
}
