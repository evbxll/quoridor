import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { playerAction } from "../../src/engine/actions";
import { HeuristicEvaluator } from "../../src/ai/heuristic";
import { type RecordedEvaluation, TableEvaluator } from "../../src/ai/evaluator";
import { Mcts, selectAction } from "../../src/ai/mcts";
import { numpySum } from "../../src/ai/numpySum";
import { seededRandom } from "../../src/ai/random";
import { formatAction, parseMove } from "../../src/engine/notation";
import { GameState } from "../../src/engine/state";

function fixture<T>(name: string): T {
  return JSON.parse(readFileSync(new URL(`../../fixtures/${name}.json`, import.meta.url), "utf8")) as T;
}

interface Search {
  size: number;
  key: string;
  simulations: number;
  c_puct: number;
  fpu_reduction: number;
  evaluations: RecordedEvaluation[];
  actions: number[];
  visits: number[];
  best_move: string;
}

const { searches } = fixture<{ searches: Search[] }>("search");
const { positions } = fixture<{ positions: { key: string; priors: number[]; value: number }[] }>("heuristic");

function searchFixture(s: Search): Mcts {
  return new Mcts(new TableEvaluator(s.evaluations), GameState.fromKey(s.key), s.c_puct, s.fpu_reduction);
}

describe("numpySum", () => {
  // Sums recorded from numpy at lengths around its block boundaries (8, 128 and the halving above).
  const { sums } = fixture<{ sums: Record<string, number> }>("numpy_sums");
  const formulas: Record<string, (i: number) => number> = {
    a: (i) => ((i * 37) % 101) / 101,
    b: (i) => ((i * i * 13 + 7) % 1009) / 1009,
  };

  it("matches numpy bit for bit at every recorded length", () => {
    expect(Object.keys(sums)).toHaveLength(18);
    for (const [name, expected] of Object.entries(sums)) {
      const values = Float64Array.from({ length: Number(name.slice(1)) }, (_, i) => formulas[name[0]!]!(i));
      expect(numpySum(values), name).toBe(expected);
    }
  });

  it("sums the empty array to zero", () => {
    expect(numpySum([])).toBe(0);
  });
});

describe("search.json", () => {
  it("has searches on 5x5 and 7x7", () => {
    expect(new Set(searches.map((s) => s.size))).toEqual(new Set([5, 7]));
    expect(searches.length).toBeGreaterThanOrEqual(12);
  });

  it("reproduces the visits of every recorded search exactly", () => {
    let matched = 0;
    for (const s of searches) {
      const result = searchFixture(s).search(s.simulations);
      expect(result.actions, s.key).toEqual(s.actions);
      expect(result.visits, s.key).toEqual(s.visits);
      expect(formatAction(GameState.fromKey(s.key), selectAction(result, 0, Math.random)), s.key).toBe(s.best_move);
      matched++;
    }
    expect(matched).toBe(searches.length);
  });
});

interface Advance {
  size: number;
  key: string;
  which: string;
  simulations: [number, number];
  c_puct: number;
  fpu_reduction: number;
  evaluations: RecordedEvaluation[];
  actions: number[];
  visits: number[];
  value: number;
  advance: string;
  actions2: number[];
  visits2: number[];
  value2: number;
}

describe("advance.json", () => {
  const { searches: cases } = fixture<{ searches: Advance[] }>("advance");

  it("covers both the expanded and the unexpanded child", () => {
    expect(cases.map((c) => c.which)).toContain("most");
    expect(cases.map((c) => c.which)).toContain("least");
  });

  it("searches, advances and searches again exactly as Python does", () => {
    for (const c of cases) {
      const start = GameState.fromKey(c.key);
      const mcts = new Mcts(new TableEvaluator(c.evaluations), start, c.c_puct, c.fpu_reduction);
      const first = mcts.search(c.simulations[0]);
      expect(first.visits, c.key).toEqual(c.visits);
      expect(first.value, c.key).toBe(c.value);
      mcts.advance(parseMove(start, c.advance));
      const second = mcts.search(c.simulations[1]);
      expect(second.actions, c.key).toEqual(c.actions2);
      expect(second.visits, c.key).toEqual(c.visits2);
      expect(second.value, c.key).toBe(c.value2);
    }
  });
});

describe("Mcts", () => {
  const first = searches[0]!;

  it("keeps the subtree on advance", () => {
    const mcts = searchFixture(first);
    const result = mcts.search(first.simulations);
    const best = selectAction(result, 0, Math.random);
    const visitsBefore = result.visits[result.actions.indexOf(best)]!;
    mcts.advance(best);
    expect(mcts.rootState.p1Turn).toBe(!GameState.fromKey(first.key).p1Turn);
    // The new root already carries the visits spent below the chosen move.
    const again = mcts.search(0);
    expect(again.visits.reduce((a, b) => a + b, 0)).toBe(visitsBefore - 1);
  });

  it("rejects an illegal advance and a search of a finished game", () => {
    expect(() => searchFixture(first).advance(playerAction(1000))).toThrow("not legal");
    const done = new Mcts(new HeuristicEvaluator(), GameState.fromKey("5|1|c5|c2|3,3|"));
    expect(() => done.search(1)).toThrow("finished");
  });

  it("finds the winning step and scores the position as won", () => {
    const mcts = new Mcts(new HeuristicEvaluator(), GameState.fromKey("5|1|c4|c2|3,3|"));
    const result = mcts.search(50);
    expect(result.visits.reduce((a, b) => a + b, 0)).toBe(50);
    expect(selectAction(result, 0, Math.random)).toBe(0);
    expect(result.principalVariation[0]).toBe(0);
    expect(result.value).toBeGreaterThan(0.5);
  });
});

describe("selectAction", () => {
  const result = {
    actions: [3, 5, 9].map(playerAction),
    visits: [10, 30, 60],
    qValues: [0, 0, 0],
    value: 0,
    principalVariation: [],
  };

  it("plays the most visited action at temperature 0, ties to the lowest index", () => {
    expect(selectAction(result, 0, Math.random)).toBe(9);
    expect(selectAction({ ...result, visits: [30, 30, 5] }, 0, Math.random)).toBe(3);
  });

  it("samples reproducibly from a seed and in proportion to the visits", () => {
    const draw = (seed: number): number[] => {
      const random = seededRandom(seed);
      return Array.from({ length: 20 }, () => selectAction(result, 1, random));
    };
    expect(draw(7)).toEqual(draw(7));
    expect(draw(7)).not.toEqual(draw(8));
    const random = seededRandom(1);
    const counts = new Map<number, number>();
    for (let i = 0; i < 10000; i++) {
      const action = selectAction(result, 1, random);
      counts.set(action, (counts.get(action) ?? 0) + 1);
    }
    expect(counts.get(9)! / 10000).toBeCloseTo(0.6, 1);
    expect(counts.get(3)! / 10000).toBeCloseTo(0.1, 1);
  });

  it("never picks an unvisited action, even at a high temperature", () => {
    const sparse = { ...result, actions: [3, 5, 9, 11].map(playerAction), visits: [0, 10, 60, 0], qValues: [0, 0, 0, 0] };
    const random = seededRandom(5);
    const picked = new Set(Array.from({ length: 5000 }, () => selectAction(sparse, 5, random)));
    expect(picked).toEqual(new Set([5, 9]));
  });

  it("falls back to the first action when nothing was searched", () => {
    const none = { ...result, visits: [0, 0, 0] };
    expect(selectAction(none, 1, seededRandom(1))).toBe(3);
  });

  it("draws the same actions as the Python formula up to a temperature of 2", () => {
    const sparse = { ...result, actions: [3, 5, 9, 11].map(playerAction), visits: [0, 10, 60, 25], qValues: [0, 0, 0, 0] };
    // Python: weight = exp(log(max(v, 1e-12)) / T), normalized, then sampled.
    const python = (temperature: number, random: () => number): number => {
      const logits = sparse.visits.map((v) => Math.log(Math.max(v, 1e-12)) / temperature);
      const top = Math.max(...logits);
      const weights = logits.map((l) => Math.exp(l - top));
      let remaining = random() * weights.reduce((a, b) => a + b, 0);
      for (let i = 0; i < weights.length; i++) {
        remaining -= weights[i]!;
        if (remaining < 0) return sparse.actions[i]!;
      }
      return sparse.actions.at(-1)!;
    };
    for (const temperature of [0.5, 1, 2]) {
      const a = seededRandom(11);
      const b = seededRandom(11);
      for (let i = 0; i < 2000; i++) expect(selectAction(sparse, temperature, a)).toBe(python(temperature, b));
    }
  });

  it("sharpens toward the most visited action at a low temperature", () => {
    const random = seededRandom(3);
    const picks = Array.from({ length: 200 }, () => selectAction(result, 0.1, random));
    expect(picks.filter((a) => a === 9).length).toBeGreaterThan(195);
  });
});

describe("HeuristicEvaluator against heuristic.json", () => {
  it("matches priors and value within 1e-6 on every position", () => {
    expect(positions).toHaveLength(160);
    const evaluator = new HeuristicEvaluator();
    for (const p of positions) {
      const state = GameState.fromKey(p.key);
      const { policy, value } = evaluator.evaluate(state, state.legalActions());
      expect(policy.length, p.key).toBe(p.priors.length);
      p.priors.forEach((expected, i) => expect(Math.abs(policy[i]! - expected), `${p.key} ${i}`).toBeLessThan(1e-6));
      expect(Math.abs(value - p.value), p.key).toBeLessThan(1e-6);
    }
  });
});
