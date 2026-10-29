import "./app.css";
import { SearchClient } from "./ai/searchClient";
import { describeIsolation, searchThreads } from "./isolation";
import { element } from "./ui/dom";
import { startPage } from "./ui/page";
import { startTheme } from "./ui/theme";

const client = new SearchClient(() => new Worker(new URL("./ai/worker.ts", import.meta.url), { type: "module" }));
client.configure({ kind: "heuristic" }).catch((error: unknown) => console.error(error));

/** Cache Storage exists only in secure contexts; reading it elsewhere can throw. */
function cacheStorage(): CacheStorage | undefined {
  try {
    return globalThis.caches;
  } catch {
    return undefined;
  }
}

startTheme(element("theme", HTMLButtonElement), document, window);

startPage(client, {
  env: { fetch: globalThis.fetch.bind(globalThis), caches: cacheStorage(), base: new URL(import.meta.env.BASE_URL, location.href).href },
  start: (model, info) =>
    client.configure({
      kind: "network",
      model,
      threads: searchThreads(globalThis.crossOriginIsolated, navigator.hardwareConcurrency),
      modelId: info.id,
      planes: info.planes,
      fixedSize: info.fixedSize,
      asDefault: info.asDefault,
    }),
  stop: (id) => client.release(id),
});

const isolated = globalThis.crossOriginIsolated;
const status = document.getElementById("isolation");
if (status !== null) status.textContent = describeIsolation(isolated, searchThreads(isolated, navigator.hardwareConcurrency));
