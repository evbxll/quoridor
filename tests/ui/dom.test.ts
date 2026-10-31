import { describe, expect, it } from "vitest";
import { closePopoverOnEscapeOrOutside, opensBelow, openWhereItFits } from "../../src/ui/dom";

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

describe("openWhereItFits", () => {
  /** A View menu whose summary's top is `top` px from the window's top, with a popover `height` px tall. */
  function view(top: number, height: number) {
    let toggle = (): void => {};
    const classes = new Set<string>();
    const details = {
      open: false,
      addEventListener: (_type: string, handler: () => void) => (toggle = handler),
      getBoundingClientRect: () => ({ top }),
      classList: { toggle: (name: string, on: boolean) => (on ? classes.add(name) : classes.delete(name)) },
    };
    openWhereItFits(details as unknown as HTMLDetailsElement, { offsetHeight: height } as HTMLElement);
    return { details, open: () => ((details.open = true), toggle()), below: () => classes.has("below") };
  }

  it("opens upward when the popover fits above the control, and downward when it would cross the top of the window", () => {
    const roomy = view(400, 150);
    roomy.open();
    expect(roomy.below()).toBe(false);
    const cramped = view(80, 150);
    cramped.open();
    expect(cramped.below()).toBe(true);
  });

  it("counts the gap between the control and the popover", () => {
    expect(opensBelow(156, 150)).toBe(false);
    expect(opensBelow(155, 150)).toBe(true);
  });
});
