import type * as OrtApi from "onnxruntime-web";
import { actionCount } from "../engine/constants";
import type { Network } from "./onnxEvaluator";

/** Where the browser finds onnxruntime-web's loader and WebAssembly binary; Node needs neither. */
export interface WasmPaths {
  readonly mjs: string;
  readonly wasm: string;
}

export interface OrtOptions {
  /** Inference threads; more than 1 needs a cross-origin isolated page. */
  readonly threads: number;
  readonly wasmPaths?: WasmPaths;
}

/** The onnxruntime-web module: the browser worker passes its `/wasm` entry, Node the default entry (the only one that runs threads there). */
export type OrtRuntime = typeof OrtApi;

/** Thread count each runtime started with: onnxruntime-web fixes its thread pool at its first session. */
const startedWith = new WeakMap<OrtRuntime, number>();

/** The input shape a session reports: `[batch, planes, height, width]`, with a name for each size the model leaves free. */
export type InputShape = ReadonlyArray<number | string>;

/** What a session's input must be: the card's plane count and, for a network with fixed spatial axes (fc), its one board size. */
export interface InputExpectation {
  readonly planes: number;
  readonly fixedSize: number | null;
}

/**
 * Refuses a model whose input is not what its card says, so a mismatch fails when the network starts
 * rather than at the first search. A model that fixes the plane count or the board size to something else,
 * or has another rank, is wrong; a free (named) axis is accepted. The wall count the model was trained
 * with cannot be read from its shape.
 */
export function checkInputShape(shape: InputShape, expected: InputExpectation): void {
  const [, planes, height, width] = shape;
  if (shape.length !== 4 || (typeof planes === "number" && planes !== expected.planes)) {
    const found = shape.length === 4 && typeof planes === "number" ? `${planes} planes` : `an input shaped [${shape.join(", ")}]`;
    throw new Error(`This model needs ${found}; its card says ${expected.planes} planes, so it cannot play this model`);
  }
  for (const axis of [height, width]) {
    if (expected.fixedSize !== null && typeof axis === "number" && axis !== expected.fixedSize) {
      throw new Error(`This model is fixed to ${axis}x${axis} boards; its card says ${expected.fixedSize}x${expected.fixedSize}, so it cannot play this model`);
    }
  }
}

/** The names of the only outputs a search reads; a model with more (stream outputs for inspection) does not copy them on every search. */
const FETCHES = ["policy", "value"];

/**
 * Opens an exported model (input `[batch, planes, N, N]`,
 * outputs `policy` and `value`) with onnxruntime-web's WebAssembly backend.
 * `expected` is the model's card: its plane count and, for fc, its board size.
 */
export async function createOrtNetwork(ort: OrtRuntime, model: Uint8Array, options: OrtOptions, expected: InputExpectation): Promise<Network> {
  const started = startedWith.get(ort);
  if (started !== undefined && started !== options.threads) {
    throw new Error(`onnxruntime-web already started with ${started} thread(s); it cannot change to ${options.threads}`);
  }
  startedWith.set(ort, options.threads);
  ort.env.wasm.numThreads = options.threads;
  if (options.wasmPaths) ort.env.wasm.wasmPaths = { mjs: options.wasmPaths.mjs, wasm: options.wasmPaths.wasm };
  const session = await ort.InferenceSession.create(model, { executionProviders: ["wasm"] });
  const input = session.inputMetadata?.find((value) => value.name === "input" && value.isTensor);
  if (input?.isTensor) {
    try {
      checkInputShape(input.shape, expected);
    } catch (error) {
      await session.release();
      throw error;
    }
  }
  return {
    planes: expected.planes,
    async infer(planes, size) {
      if (expected.fixedSize !== null && size !== expected.fixedSize) throw new Error(`This model plays ${expected.fixedSize}x${expected.fixedSize} only, not ${size}x${size}`);
      const input = new ort.Tensor("float32", planes, [1, expected.planes, size, size]);
      const output = await session.run({ input }, FETCHES);
      // Copy: the runtime may reuse its output buffers, and the evaluator caches the policy.
      const policy = Float32Array.from(output.policy!.data as Float32Array);
      const value = (output.value!.data as Float32Array)[0]!;
      if (policy.length !== actionCount(size) || !Number.isFinite(value)) {
        throw new Error(`The model answered with ${policy.length} policy entries and value ${value}; expected ${actionCount(size)} and a number`);
      }
      return { policy, value };
    },
    release: () => session.release(),
  };
}
