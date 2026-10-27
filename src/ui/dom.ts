export function element<T extends Element>(id: string, type: abstract new () => T): T {
  const found = document.getElementById(id);
  if (!(found instanceof type)) throw new Error(`The page has no #${id} of the expected kind`);
  return found;
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
