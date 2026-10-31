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

/**
 * Lets a `<details>` popover close the way one is expected to: Escape closes it and returns focus to its
 * summary, and a press outside it closes it (without moving focus away from what was pressed).
 */
export function closePopoverOnEscapeOrOutside(details: HTMLDetailsElement, doc: Document): void {
  doc.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !details.open) return;
    details.open = false;
    details.querySelector("summary")?.focus();
  });
  doc.addEventListener("pointerdown", (event) => {
    const target = event.target as Node | null;
    if (details.open && target !== null && !details.contains(target)) details.open = false;
  });
}

/** The room between a popover and the control it opens from, in px (as in the stylesheet). */
const POP_GAP = 6;

/** Whether a popover `height` px tall, opening upward from a control whose top is `top` px from the window's top, would cross the top of the window. */
export const opensBelow = (top: number, height: number): boolean => top - POP_GAP - height < 0;

/**
 * Lets a `<details>` popover that opens upward open downward instead (the class "below") when there is no room
 * above it in the window. The choice is made each time it opens, from where it then is.
 */
export function openWhereItFits(details: HTMLDetailsElement, pop: HTMLElement): void {
  details.addEventListener("toggle", () => {
    if (details.open) details.classList.toggle("below", opensBelow(details.getBoundingClientRect().top, pop.offsetHeight));
  });
}
