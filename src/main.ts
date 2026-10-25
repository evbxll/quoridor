import { SearchClient } from "./ai/searchClient";
import { describeIsolation, searchThreads } from "./isolation";

const status = document.getElementById("isolation");
if (status !== null) {
  const isolated = globalThis.crossOriginIsolated;
  const threads = searchThreads(isolated, navigator.hardwareConcurrency);
  status.textContent = describeIsolation(isolated, threads);
}

const engine = document.getElementById("engine");
if (engine !== null) {
  const client = new SearchClient(() => new Worker(new URL("./ai/worker.ts", import.meta.url), { type: "module" }));
  const began = performance.now();
  client
    .configure({ kind: "heuristic" })
    .then(() => client.search({ size: 9, moves: [], simulations: 100, temperature: 0, seed: 0 }))
    .then((result) => {
      engine.textContent = `Search worker: ${result?.move ?? "no move"} in ${Math.round(performance.now() - began)} ms.`;
    })
    .catch((error: unknown) => {
      engine.textContent = `Search worker failed: ${error instanceof Error ? error.message : String(error)}`;
    });
}
