import { describe, expect, it } from "vitest";
import { evalBar, shareLabel, toPercent } from "../../src/ui/evalBar";
import { levelSummary, LEVELS } from "../../src/ui/levels";

const ready = (p1Share: number) => ({ status: "ready" as const, reading: { p1Share, lines: [] } });

describe("the eval bar", () => {
  it("maps shares to whole percentages within 0 to 100", () => {
    expect([toPercent(0.5), toPercent(0.004), toPercent(0.996), toPercent(-1), toPercent(2)]).toEqual([50, 0, 100, 0, 100]);
    expect(shareLabel(62)).toBe("Player 1 62%, player 2 38%");
  });

  it("fills to player 1's share of a fresh reading, measured from player 1's end", () => {
    expect(evalBar(ready(0.624), null, null)).toEqual({ percent: 62, stale: false, label: "Player 1 62%, player 2 38%", ticks: { p1: null, p2: null } });
    expect(evalBar(ready(1), 40, null).percent).toBe(100);
    expect(evalBar(ready(0), 40, null).percent).toBe(0);
  });

  it("keeps the last reading, marked stale, while a new position is read or after it failed", () => {
    expect(evalBar({ status: "searching" }, 55, null)).toMatchObject({ percent: 55, stale: true });
    expect(evalBar({ status: "searching" }, 55, null).label).toMatch(/^Player 1 55%, player 2 45%, from an earlier position/);
    expect(evalBar({ status: "failed", message: "x" }, 55, null)).toMatchObject({ percent: 55, stale: true, label: expect.stringContaining("could not read") });
    expect(evalBar({ status: "searching" }, null, null)).toMatchObject({ percent: null, stale: false });
  });

  it("is empty when there is no network, even with an earlier reading", () => {
    expect(evalBar({ status: "unavailable" }, 55, null)).toMatchObject({ percent: null, stale: false, label: expect.stringContaining("not ready") });
  });

  it("places each bot's own estimate as a tick, and hides a side without one", () => {
    expect(evalBar(ready(0.5), null, { p1: 0.754, p2: null }).ticks).toEqual({ p1: 75, p2: null });
    expect(evalBar({ status: "unavailable" }, null, { p1: 0.2, p2: 0.9 }).ticks).toEqual({ p1: 20, p2: 90 });
  });
});

describe("levelSummary", () => {
  it("says what each level plays with", () => {
    expect(LEVELS.map(levelSummary)).toEqual([
      "Heuristic, 5 searches a move, varied",
      "Heuristic, 100 searches a move",
      "Neural network, 32 searches a move",
      "Neural network, 200 searches a move",
    ]);
  });
});
