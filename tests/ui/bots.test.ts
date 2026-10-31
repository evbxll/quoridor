import { describe, expect, it } from "vitest";
import {
  type Bot,
  botLabel,
  botOf,
  botSummary,
  capFor,
  describeEstimate,
  estimateMs,
  fitTo,
  formatMs,
  MEASURED_MODEL,
  nearestStep,
  PRESETS,
  presetOf,
  stepsFor,
  temperatureOf,
} from "../../src/ui/bots";

describe("presets", () => {
  it("map to the engine, simulations and move choice the design gives them", () => {
    expect(PRESETS.map((p) => [p.id, p.label, p.engine, p.simulations, p.vary])).toEqual([
      ["beginner", "Beginner", "heuristic", 5, true],
      ["normal", "Normal", "heuristic", 100, false],
      ["strong", "Strong", "network", 32, false],
      ["max", "Max", "network", 200, false],
    ]);
  });

  it("are every one a step of its engine's control on every site size", () => {
    for (const preset of PRESETS) for (const size of [5, 7, 9, 11]) expect(stepsFor(preset.engine, size)).toContain(preset.simulations);
  });

  it("say what each plays with", () => {
    expect(PRESETS.map(botSummary)).toEqual([
      "Heuristic, 5 searches a move, varied",
      "Heuristic, 100 searches a move",
      "Neural network, 32 searches a move",
      "Neural network, 200 searches a move",
    ]);
  });
});

describe("Custom", () => {
  it("is a bot no preset matches, and a preset's name returns when its values do", () => {
    const normal = botOf("normal");
    expect(botLabel(normal)).toBe("Normal");
    expect(presetOf({ ...normal, simulations: 200 })).toBeNull();
    expect(botLabel({ ...normal, simulations: 200 })).toBe("Custom");
    expect(botLabel({ ...normal, vary: true })).toBe("Custom");
    expect(botLabel({ ...normal, simulations: 5, vary: true })).toBe("Beginner");
    expect(botLabel({ engine: "network", simulations: 1, vary: false })).toBe("Custom");
  });

  it("depends on the engine as well: the same simulations on the other engine are Custom", () => {
    expect(botLabel({ engine: "network", simulations: 100, vary: false })).toBe("Custom");
    expect(botLabel({ engine: "heuristic", simulations: 32, vary: false })).toBe("Custom");
  });
});

describe("simulation steps and caps", () => {
  it("offer the network 1 to 800 on 5 to 9 and 1 to 400 on 11", () => {
    const all = [1, 8, 16, 32, 64, 100, 200, 400, 800];
    for (const size of [5, 7, 9]) expect(stepsFor("network", size)).toEqual(all);
    expect(stepsFor("network", 11)).toEqual(all.slice(0, -1));
    expect([5, 7, 9, 11].map((size) => capFor("network", size))).toEqual([800, 800, 800, 400]);
  });

  it("offer the heuristic 1 to 1,600 on every size", () => {
    for (const size of [5, 7, 9, 11]) {
      expect(stepsFor("heuristic", size)).toEqual([1, 5, 25, 50, 100, 200, 400, 800, 1600]);
      expect(capFor("heuristic", size)).toBe(1600);
    }
  });

  it("move a setting to the nearest step, the lower on a tie", () => {
    expect(nearestStep("network", 9, 33)).toBe(32);
    expect(nearestStep("network", 9, 48)).toBe(32);
    expect(nearestStep("network", 9, 1000)).toBe(800);
    expect(nearestStep("network", 11, 800)).toBe(400);
    expect(nearestStep("heuristic", 9, 3)).toBe(1);
    expect(nearestStep("heuristic", 9, 4)).toBe(5);
  });

  it("fit a bot to a smaller cap and leave one that fits as it is", () => {
    const max: Bot = { engine: "network", simulations: 800, vary: false };
    expect(fitTo(max, 11)).toEqual({ engine: "network", simulations: 400, vary: false });
    expect(fitTo(max, 9)).toBe(max);
  });
});

describe("move choice", () => {
  it("samples at temperature 1 when moves vary and plays the most visited at 0 otherwise", () => {
    expect(temperatureOf(botOf("beginner"))).toBe(1);
    expect(temperatureOf(botOf("normal"))).toBe(0);
    expect(temperatureOf({ ...botOf("max"), vary: true })).toBe(1);
  });
});

describe("time estimates", () => {
  const network = (simulations: number): Bot => ({ engine: "network", simulations, vary: false });

  it("are the measured medians at the measured budgets", () => {
    expect(estimateMs(network(32), 9)).toEqual({ ms: 155, p90: 213, kind: "measured" });
    expect(estimateMs(network(200), 9)).toEqual({ ms: 635, p90: 1234, kind: "measured" });
    expect(estimateMs(network(400), 9)).toEqual({ ms: 2377, p90: 3538, kind: "measured" });
    expect(estimateMs(network(800), 9)).toEqual({ ms: 3865, p90: 5795, kind: "measured" });
    expect(estimateMs(network(32), 5)).toEqual({ ms: 50, p90: 74, kind: "measured" });
    expect(estimateMs(network(200), 11)).toEqual({ ms: 848, p90: 1720, kind: "measured" });
  });

  it("are interpolated between measured budgets and marked as estimates", () => {
    const between = estimateMs(network(100), 9)!;
    expect(between.kind).toBe("estimate");
    expect(between.ms).toBeCloseTo(155 + ((635 - 155) * (100 - 32)) / (200 - 32), 6);
    const below = estimateMs(network(1), 9)!;
    expect(below.kind).toBe("estimate");
    expect(below.ms).toBeCloseTo(155 / 32, 6);
    expect(estimateMs(network(64), 9)!.ms).toBeGreaterThan(155);
    expect(estimateMs(network(64), 9)!.ms).toBeLessThan(estimateMs(network(100), 9)!.ms);
  });

  it("are unmeasured above the last measured budget", () => {
    expect(estimateMs(network(400), 7)).toBeNull();
    expect(estimateMs(network(400), 11)).toBeNull();
    expect(describeEstimate(network(400), 11)).toBe("Time a move: unmeasured on 11 × 11.");
  });

  it("are unmeasured on a size with no table (13x13 is not offered yet) and for another network", () => {
    expect(estimateMs(network(32), 13)).toBeNull();
    expect(estimateMs(network(32), 9, "another-model")).toBeNull();
    expect(estimateMs(network(32), 9, MEASURED_MODEL)).toEqual({ ms: 155, p90: 213, kind: "measured" });
  });

  it("are derived for the heuristic from Normal's time, in proportion to simulations, and always an estimate", () => {
    const heuristic = (simulations: number): Bot => ({ engine: "heuristic", simulations, vary: false });
    expect(estimateMs(heuristic(100), 9)).toEqual({ ms: 14, p90: null, kind: "estimate" });
    expect(estimateMs(heuristic(1600), 9)).toEqual({ ms: 224, p90: null, kind: "estimate" });
    expect(estimateMs(heuristic(5), 11)!.ms).toBeCloseTo(1.2, 6);
    expect(estimateMs(heuristic(100), 13)).toBeNull();
  });

  it("read as a sentence that names the kind and the machine", () => {
    expect(describeEstimate(network(32), 9)).toBe("About 0.2 s a move on a fast desktop (measured).");
    expect(describeEstimate(network(100), 9)).toBe("About 0.3 s a move on a fast desktop (estimate).");
  });

  it("add the 90th percentile where it is more than twice the median, and only there", () => {
    expect(describeEstimate(network(400), 5)).toBe("About 0.4 s a move on a fast desktop (measured). 1 move in 10 takes over 2.0 s.");
    expect(describeEstimate(network(800), 5)).toContain("1 move in 10 takes over 2.8 s");
    expect(describeEstimate(network(200), 7)).toContain("over 0.9 s");
    expect(describeEstimate(network(200), 9)).not.toContain("1 move in 10");
    expect(describeEstimate({ engine: "heuristic", simulations: 100, vary: false }, 9)).not.toContain("1 move in 10");
  });

  it("format as ms below a tenth of a second, seconds with a decimal below ten, whole seconds above", () => {
    expect([1, 50, 99.6, 155, 635, 3865, 9949, 14200].map(formatMs)).toEqual(["1 ms", "50 ms", "100 ms", "0.2 s", "0.6 s", "3.9 s", "9.9 s", "14 s"]);
  });
});
