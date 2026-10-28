import type * as OrtApi from "onnxruntime-web";
import { actionCount } from "../engine/constants";
import { INPUT_PLANES } from "./encoding";
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

/**
 * Refuses a model whose input is not the site's encoding, so a mismatch fails when the network starts
 * rather than at the first search. A model that fixes the plane count to something else, or has another rank, is wrong;
 * a free (named) plane count is accepted. The wall count the model was trained with cannot be read from its shape.
 */
export function checkInputShape(shape: InputShape): void {
  const planes = shape[1];
  if (shape.length !== 4 || (typeof planes === "number" && planes !== INPUT_PLANES)) {
    const found = shape.length === 4 && typeof planes === "number" ? `${planes} planes` : `an input shaped [${shape.join(", ")}]`;
    throw new Error(`This model needs ${found}; this site encodes ${INPUT_PLANES} planes, so it cannot play this model`);
  }
}

/**
 * Opens an exported model (design doc section 6.1: input `[batch, 10, N, N]`,
 * outputs `policy` and `value`) with onnxruntime-web's WebAssembly backend.
 */
export async function createOrtNetwork(ort: OrtRuntime, model: Uint8Array, options: OrtOptions): Promise<Network> {
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
      checkInputShape(input.shape);
    } catch (error) {
      await session.release();
      throw error;
    }
  }
  return {
    async infer(planes, size) {
      const input = new ort.Tensor("float32", planes, [1, INPUT_PLANES, size, size]);
      const output = await session.run({ input });
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
