import { describeIsolation, searchThreads } from "./isolation";

const status = document.getElementById("isolation");
if (status !== null) {
  const isolated = globalThis.crossOriginIsolated;
  const threads = searchThreads(isolated, navigator.hardwareConcurrency);
  status.textContent = describeIsolation(isolated, threads);
}
