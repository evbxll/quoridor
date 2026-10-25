import "./app.css";
import { SearchClient } from "./ai/searchClient";
import { describeIsolation, searchThreads } from "./isolation";
import { startPage } from "./ui/page";

const client = new SearchClient(() => new Worker(new URL("./ai/worker.ts", import.meta.url), { type: "module" }));
client.configure({ kind: "heuristic" }).catch((error: unknown) => console.error(error));
startPage(client);

const isolated = globalThis.crossOriginIsolated;
const status = document.getElementById("isolation");
if (status !== null) status.textContent = describeIsolation(isolated, searchThreads(isolated, navigator.hardwareConcurrency));
