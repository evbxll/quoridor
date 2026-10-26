import type { GameState } from "../engine/state";

export function element<T extends Element>(id: string, type: abstract new () => T): T {
  const found = document.getElementById(id);
  if (!(found instanceof type)) throw new Error(`The page has no #${id} of the expected kind`);
  return found;
}

/** Fills a player's wall tray: `who` names the player ("You", "Bot", "Player 1 (Normal)"). */
export function renderTray(side: "p1" | "p2", who: string, state: GameState): void {
  const player = side === "p1" ? 0 : 1;
  const walls = state.wallsLeft(player);
  const tray = element(`tray-${side}`, HTMLElement);
  tray.setAttribute("role", "group");
  tray.setAttribute("aria-label", `${who}, player ${player + 1}: ${walls} walls left`);
  tray.innerHTML =
    `<span aria-hidden="true">${who} (P${player + 1}) walls</span>` +
    `<span class="pieces" aria-hidden="true">${"<i></i>".repeat(walls)}</span>` +
    `<span class="count">${walls}</span>`;
}

/** Greys a button out without taking it out of the tab order, so pressing it does not drop keyboard focus. */
export function setEnabled(button: HTMLButtonElement, enabled: boolean): void {
  button.setAttribute("aria-disabled", String(!enabled));
}

/** Runs `handler` on a click unless the button is greyed out. */
export function onPress(button: HTMLButtonElement, handler: () => void): void {
  button.addEventListener("click", () => {
    if (button.getAttribute("aria-disabled") !== "true") handler();
  });
}
