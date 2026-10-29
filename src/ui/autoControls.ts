import type { AutoPlay } from "./autoplay";
import { element, onPress } from "./dom";

/** The auto-play group inside the bot controls: the checkbox, its two options, and the countdown line with Cancel. */
export class AutoControls {
  private readonly on = element("auto-on", HTMLInputElement);
  private readonly swap = element("auto-swap", HTMLInputElement);
  private readonly opening = element("auto-opening", HTMLInputElement);
  private readonly line = element("auto-line", HTMLElement);
  private readonly cancel = element("auto-cancel", HTMLButtonElement);

  /** `focusAfterCancel` takes the keyboard when Cancel goes away while it holds it. */
  constructor(
    private readonly auto: AutoPlay,
    private readonly focusAfterCancel: () => void,
  ) {
    this.on.checked = auto.enabled;
    this.swap.checked = auto.swapSides;
    this.opening.checked = auto.variedOpenings;
    this.on.addEventListener("change", () => auto.setEnabled(this.on.checked));
    this.swap.addEventListener("change", () => (auto.swapSides = this.swap.checked));
    this.opening.addEventListener("change", () => (auto.variedOpenings = this.opening.checked));
    onPress(this.cancel, () => auto.cancel());
  }

  draw(): void {
    const counting = this.auto.countdown !== null;
    const text = this.auto.message;
    if (this.line.textContent !== text) this.line.textContent = text;
    // The line and the button keep their room when idle, so nothing below them moves.
    this.cancel.classList.toggle("off", !counting);
    if (!counting && document.activeElement === this.cancel) this.focusAfterCancel();
  }
}
