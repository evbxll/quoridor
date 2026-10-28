import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { encodeState, INPUT_PLANES } from "../../src/ai/encoding";
import type { Evaluation } from "../../src/ai/evaluator";
import { Mcts, selectAction } from "../../src/ai/mcts";
import { type Network, OnnxEvaluator } from "../../src/ai/onnxEvaluator";
import * as ort from "onnxruntime-web";
import { checkInputShape, createOrtNetwork, type InputShape, type OrtRuntime } from "../../src/ai/ort";
import { HORIZONTAL, squareName, VERTICAL, wallName } from "../../src/engine/actions";
import { actionCount, wallCount } from "../../src/engine/constants";
import { formatAction } from "../../src/engine/notation";
import { GameState } from "../../src/engine/state";
import { discoverModels } from "../helpers/models";

/** A network that counts its calls and answers with a uniform policy. */
class CountingNetwork implements Network {
  readonly inputs: Float32Array[] = [];

  async infer(planes: Float32Array, size: number): Promise<Evaluation> {
    this.inputs.push(planes);
    return { policy: new Float32Array(actionCount(size)).fill(1 / actionCount(size)), value: 0.25 };
  }
}

function play(size: number, moves: readonly string[]): GameState {
  const state = GameState.initial(size);
  for (const move of moves) {
    const action = state.legalActions().find((a) => formatAction(state, a) === move);
    if (action === undefined) throw new Error(`${move} is not legal`);
    state.play(action);
  }
  return state;
}

describe("OnnxEvaluator with a stand-in network", () => {
  it("feeds the network the encoded position", async () => {
    const network = new CountingNetwork();
    const state = play(7, ["d2"]);
    const evaluation = await new OnnxEvaluator(network).evaluate(state);
    expect(network.inputs).toHaveLength(1);
    expect(network.inputs[0]).toEqual(encodeState(state));
    expect(evaluation.value).toBe(0.25);
  });

  it("answers a repeated position from the cache", async () => {
    const network = new CountingNetwork();
    const evaluator = new OnnxEvaluator(network);
    await evaluator.evaluate(GameState.initial(5));
    await evaluator.evaluate(GameState.initial(5));
    expect([evaluator.hits, evaluator.misses, network.inputs.length]).toEqual([1, 1, 1]);
  });

  it("recognizes a transposition", async () => {
    const network = new CountingNetwork();
    const evaluator = new OnnxEvaluator(network);
    // Both sides move out and back: the third position equals the first.
    await evaluator.evaluate(play(5, ["c2", "c4"]));
    await evaluator.evaluate(play(5, ["c2", "c4", "c1", "c5"]).clone());
    await evaluator.evaluate(play(5, ["c2", "c4"]));
    expect([evaluator.hits, evaluator.misses]).toEqual([1, 2]);
  });

  it("evicts the least recently used position past its capacity", async () => {
    const network = new CountingNetwork();
    const evaluator = new OnnxEvaluator(network, 2);
    const a = play(5, []);
    const b = play(5, ["c2"]);
    const c = play(5, ["c2", "c4"]);
    await evaluator.evaluate(a);
    await evaluator.evaluate(b);
    await evaluator.evaluate(a); // a is now newer than b
    await evaluator.evaluate(c); // evicts b
    await evaluator.evaluate(a);
    await evaluator.evaluate(b);
    expect([evaluator.hits, evaluator.misses]).toEqual([2, 4]);
  });

  it("frees the network when it is replaced", async () => {
    let released = 0;
    const network: Network = { ...new CountingNetwork(), infer: async () => ({ policy: new Float32Array(0), value: 0 }), release: async () => void released++ };
    await new OnnxEvaluator(network).dispose();
    await new OnnxEvaluator(new CountingNetwork()).dispose();
    expect(released).toBe(1);
  });

  it("separates positions of different sizes", async () => {
    const evaluator = new OnnxEvaluator(new CountingNetwork());
    await evaluator.evaluate(GameState.initial(5));
    await evaluator.evaluate(GameState.initial(7));
    expect(evaluator.misses).toBe(2);
  });

  it("searches with it and plays a legal move", async () => {
    const state = GameState.initial(5);
    const mcts = await Mcts.create(new OnnxEvaluator(new CountingNetwork()), state);
    const result = await mcts.search(20);
    expect(result.visits.reduce((a, b) => a + b, 0)).toBe(20);
    expect(state.legalActions()).toContain(selectAction(result, 0, Math.random));
  });
});

/** A stand-in for onnxruntime-web whose session answers with the given policy length and value. */
const released = { count: 0 };

function stubRuntime(policyLength: (size: number) => number, value: number, inputShape: InputShape = ["batch", INPUT_PLANES, "h", "w"]): OrtRuntime {
  let size = 0;
  return {
    env: { wasm: {} },
    Tensor: class {
      constructor(_type: string, _data: Float32Array, dims: number[]) {
        size = dims[2]!;
      }
    },
    InferenceSession: {
      create: async () => ({
        release: async () => void (released.count += 1),
        inputMetadata: [{ name: "input", isTensor: true, type: "float32", shape: inputShape }],
        run: async () => ({ policy: { data: new Float32Array(policyLength(size)) }, value: { data: Float32Array.of(value) } }),
      }),
    },
  } as unknown as OrtRuntime;
}

describe("checkInputShape", () => {
  it("accepts the site's plane count, fixed or free, at any board size", () => {
    expect(() => checkInputShape(["batch", INPUT_PLANES, "h", "w"])).not.toThrow();
    expect(() => checkInputShape([1, INPUT_PLANES, 9, 9])).not.toThrow();
    expect(() => checkInputShape([-1, "planes", 7, 7])).not.toThrow();
  });

  it("refuses another plane count or rank", () => {
    expect(() => checkInputShape(["batch", INPUT_PLANES - 1, "h", "w"])).toThrow(`needs ${INPUT_PLANES - 1} planes`);
    expect(() => checkInputShape([INPUT_PLANES, 9, 9])).toThrow("shaped [10, 9, 9]");
    expect(() => checkInputShape([])).toThrow("shaped []");
  });
});

describe("createOrtNetwork", () => {
  it("rejects an answer of the wrong length or a value that is not a number", async () => {
    const short = await createOrtNetwork(stubRuntime((size) => actionCount(size) - 1, 0), new Uint8Array(), { threads: 1 });
    await expect(short.infer(new Float32Array(250), 5)).rejects.toThrow("expected 44");
    const nan = await createOrtNetwork(stubRuntime(actionCount, Number.NaN), new Uint8Array(), { threads: 1 });
    await expect(nan.infer(new Float32Array(250), 5)).rejects.toThrow("a number");
    const fine = await createOrtNetwork(stubRuntime(actionCount, 0.5), new Uint8Array(), { threads: 1 });
    expect((await fine.infer(new Float32Array(250), 5)).value).toBe(0.5);
  });

  it("fails at start, naming both plane counts, for a model that needs another encoding", async () => {
    const before = released.count;
    await expect(createOrtNetwork(stubRuntime(actionCount, 0, ["batch", 12, "h", "w"]), new Uint8Array(), { threads: 1 })).rejects.toThrow(
      `needs 12 planes; this site encodes ${INPUT_PLANES}`,
    );
    expect(released.count).toBe(before + 1);
    await expect(createOrtNetwork(stubRuntime(actionCount, 0, [1, 10, 9, 9, 1]), new Uint8Array(), { threads: 1 })).rejects.toThrow("[1, 10, 9, 9, 1]");
  });

  it("lets the session go on release", async () => {
    const network = await createOrtNetwork(stubRuntime(actionCount, 0), new Uint8Array(), { threads: 1 });
    const before = released.count;
    await network.release!();
    expect(released.count).toBe(before + 1);
  });

  it("refuses to change the thread count after the runtime has started", async () => {
    const runtime = stubRuntime(actionCount, 0);
    await createOrtNetwork(runtime, new Uint8Array(), { threads: 2 });
    await createOrtNetwork(runtime, new Uint8Array(), { threads: 2 });
    await expect(createOrtNetwork(runtime, new Uint8Array(), { threads: 4 })).rejects.toThrow("cannot change");
  });
});

/**
 * The models to test: the folder in `QUORIDOR_TEST_MODEL_DIR` (or `test-data/model/`), else every model published in
 * `public/models/index.json`, so the public CI checks golden parity as soon as a model is merged.
 */
const models = discoverModels(process.cwd(), process.env["QUORIDOR_TEST_MODEL_DIR"]);
if (models.length === 0) {
  console.warn("onnxEvaluator.test: NO MODEL FOUND, so the model tests are skipped; set QUORIDOR_TEST_MODEL_DIR to a folder with model.onnx and golden.json (or put them in test-data/model)");
}

interface Golden {
  tolerance: number;
  positions: Record<string, { planes: number[]; policy: number[]; value: number }[]>;
}

/**
 * The position a golden input describes, as player 1 to move. golden.json holds
 * the planes only, in the mover's frame; a player 2 position is rotated there, so
 * this is its mirror image, which encodes to the same planes.
 */
function positionOf(planes: readonly number[], size: number): GameState {
  const cells = size * size;
  const where = (plane: number): number => planes.slice(plane * cells, (plane + 1) * cells).indexOf(1);
  const pawn = (plane: number): string => squareName(Math.floor(where(plane) / size), where(plane) % size, size);
  const walls: string[] = [];
  for (let row = 0; row < size - 1; row++) {
    for (let col = 0; col < size - 1; col++) {
      if (planes[row * size + col] === 1) walls.push(wallName(row, col, HORIZONTAL, size));
      if (planes[cells + row * size + col] === 1) walls.push(wallName(row, col, VERTICAL, size));
    }
  }
  const left = (plane: number): number => Math.round(planes[plane * cells]! * wallCount(size));
  return GameState.fromKey(`${size}|1|${pawn(2)}|${pawn(3)}|${left(4)},${left(5)}|${walls.join(",")}`);
}

if (models.length === 0) it.skip("model tests: no model was found (see the warning above)", () => {});

describe.each(models)("model $id", ({ dir }) => {
  const golden = JSON.parse(readFileSync(join(dir, "golden.json"), "utf8")) as Golden;

  it("has golden inputs that encodeState reproduces bit for bit from the position they describe", () => {
    let checked = 0;
    for (const [size, cases] of Object.entries(golden.positions)) {
      for (const [i, expected] of cases.entries()) {
        const encoded = encodeState(positionOf(expected.planes, Number(size)));
        expect(Array.from(encoded), `${size}x${size} position ${i}`).toEqual(Array.from(Float32Array.from(expected.planes)));
        checked++;
      }
    }
    expect(checked).toBe(Object.values(golden.positions).reduce((total, cases) => total + cases.length, 0));
  });

  for (const size of [5, 7, 9, 11]) {
    it(`matches golden.json within its own tolerance on ${size}x${size}`, async () => {
      const cases = golden.positions[String(size)];
      if (!cases) return;
      const network = await createOrtNetwork(ort, readFileSync(join(dir, "model.onnx")), { threads: 1 });
      expect(golden.tolerance).toBe(1e-5);
      for (const [i, expected] of cases.entries()) {
        const { policy, value } = await network.infer(Float32Array.from(expected.planes), size);
        expect(policy.length).toBe(actionCount(size));
        let worst = 0;
        let argmax = 0;
        let expectedArgmax = 0;
        expected.policy.forEach((p, k) => {
          worst = Math.max(worst, Math.abs(policy[k]! - p));
          if (policy[k]! > policy[argmax]!) argmax = k;
          if (p > expected.policy[expectedArgmax]!) expectedArgmax = k;
        });
        expect(worst, `policy of position ${i}`).toBeLessThan(golden.tolerance);
        expect(Math.abs(value - expected.value), `value of position ${i}`).toBeLessThan(golden.tolerance);
        expect(argmax, `argmax of position ${i}`).toBe(expectedArgmax);
      }
    });
  }

  it("searches a 9x9 position and returns a legal move", async () => {
    const network = await createOrtNetwork(ort, readFileSync(join(dir, "model.onnx")), { threads: 1 });
    const state = GameState.initial(9);
    const mcts = await Mcts.create(new OnnxEvaluator(network), state);
    const result = await mcts.search(16);
    expect(state.legalActions()).toContain(selectAction(result, 0, Math.random));
  });
});
