import { describe, expect, it } from "vitest";
import { closePopoverOnEscapeOrOutside } from "../../src/ui/dom";

/** The few parts of a `<details>` and its document the popover handling touches. */
function setup() {
  const handlers = new Map<string, (event: object) => void>();
  const doc = { addEventListener: (type: string, handler: (event: object) => void) => handlers.set(type, handler) };
  const inside = {};
  const outside = {};
  let focused = false;
  const details = {
    open: true,
    contains: (node: unknown) => node === inside,
    querySelector: () => ({ focus: () => (focused = true) }),
  };
  closePopoverOnEscapeOrOutside(details as unknown as HTMLDetailsElement, doc as unknown as Document);
  const fire = (type: string, props: object): void => {
    handlers.get(type)!(props);
  };
  return { details, inside, outside, fire, focused: () => focused };
}

describe("closePopoverOnEscapeOrOutside", () => {
  it("closes on Escape and returns focus to the summary", () => {
    const { details, fire, focused } = setup();
    fire("keydown", { key: "Enter" });
    expect(details.open).toBe(true);
    fire("keydown", { key: "Escape" });
    expect(details.open).toBe(false);
    expect(focused()).toBe(true);
  });

  it("does not take focus on Escape when it is already closed", () => {
    const { details, fire, focused } = setup();
    details.open = false;
    fire("keydown", { key: "Escape" });
    expect(focused()).toBe(false);
  });

  it("closes on a press outside, and stays open for a press inside", () => {
    const { details, inside, outside, fire, focused } = setup();
    fire("pointerdown", { target: inside });
    expect(details.open).toBe(true);
    fire("pointerdown", { target: outside });
    expect(details.open).toBe(false);
    expect(focused()).toBe(false);
  });
});
