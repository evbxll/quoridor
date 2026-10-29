import { HeuristicEvaluator } from "./heuristic";
import type { EngineSpec, Request, Response } from "./protocol";
import { createSearchService } from "./searchService";

/**
 * onnxruntime-web is loaded only for a network, so a failure to load it
 * cannot take the heuristic bot down with it.
 */
async function networkEvaluator(engine: Extract<EngineSpec, { kind: "network" }>) {
  const [ort, loader, binary, { OnnxEvaluator }, { createOrtNetwork }] = await Promise.all([
    import("onnxruntime-web/wasm"),
    import("onnxruntime-web/ort-wasm-simd-threaded.mjs?url"),
    import("onnxruntime-web/ort-wasm-simd-threaded.wasm?url"),
    import("./onnxEvaluator"),
    import("./ort"),
  ]);
  const network = await createOrtNetwork(
    ort,
    new Uint8Array(engine.model),
    { threads: engine.threads, wasmPaths: { mjs: loader.default, wasm: binary.default } },
    { planes: engine.planes, fixedSize: engine.fixedSize },
  );
  return new OnnxEvaluator(network);
}

const handle = createSearchService(
  (response: Response) => self.postMessage(response),
  async (engine) => (engine.kind === "heuristic" ? new HeuristicEvaluator() : networkEvaluator(engine)),
);

self.onmessage = (event: MessageEvent<Request>) => handle(event.data);
