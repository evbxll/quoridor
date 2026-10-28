import { describe, expect, it } from "vitest";
import { placeTip, TipState } from "../../src/ui/tooltip";

describe("which blurb is open", () => {
  it("opens on hover and closes when the pointer leaves", () => {
    const tips = new TipState();
    tips.add("a", "hover");
    expect(tips.open).toBe("a");
    tips.remove("a", "hover");
    expect(tips.open).toBeNull();
  });

  it("stays open while focus holds it, though the pointer left", () => {
    const tips = new TipState();
    tips.add("a", "focus");
    tips.add("a", "hover");
    tips.remove("a", "hover");
    expect(tips.open).toBe("a");
    tips.remove("a", "focus");
    expect(tips.open).toBeNull();
  });

  it("opens on a tap and closes on the next tap, though a tap focused it", () => {
    const tips = new TipState();
    tips.tap("a");
    expect(tips.open).toBe("a");
    tips.add("a", "focus");
    tips.tap("a");
    expect(tips.open).toBeNull();
  });

  it("shows one blurb at a time: the last one pointed at, tapped or focused", () => {
    const tips = new TipState();
    tips.add("a", "hover");
    tips.add("b", "focus");
    expect(tips.open).toBe("b");
    tips.remove("a", "hover");
    expect(tips.open).toBe("b");
    tips.tap("a");
    expect(tips.open).toBe("a");
  });

  it("closes everything on Escape or a tap elsewhere", () => {
    const tips = new TipState();
    tips.add("a", "hover");
    tips.add("a", "focus");
    tips.close();
    expect(tips.open).toBeNull();
    tips.remove("a", "hover");
    expect(tips.open).toBeNull();
  });
});

describe("where a blurb goes", () => {
  const rect = (left: number, top: number, width: number, height: number) => ({ left, top, width, height, right: left + width, bottom: top + height }) as DOMRect;
  const viewport = { width: 390, height: 800 };

  it("sits to the right of its trigger, centred on it", () => {
    expect(placeTip(rect(20, 300, 24, 24), { width: 200, height: 60 }, viewport)).toEqual({ left: 52, top: 282 });
  });

  it("moves to the left when the right has no room, and stays inside the viewport", () => {
    expect(placeTip(rect(300, 300, 24, 24), { width: 200, height: 60 }, viewport).left).toBe(92);
    expect(placeTip(rect(10, 300, 24, 24), { width: 380, height: 60 }, viewport).left).toBe(8);
    expect(placeTip(rect(20, 2, 24, 24), { width: 200, height: 60 }, viewport).top).toBe(8);
    expect(placeTip(rect(20, 790, 24, 24), { width: 200, height: 60 }, viewport).top).toBe(732);
  });
});
