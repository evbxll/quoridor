import type { ModelState } from "../model/manager";

const megabytes = (bytes: number): string => (bytes / 1e6).toFixed(1);

/** Where the network stands, in words: the chip in the top bar with its popover, and the short form for a bot that waits for it. */
export function describeNetwork(state: ModelState, size: number): { line: string; short: string; chip: string; tone: "ok" | "busy" | "off" | "bad" } {
  switch (state.status) {
    case "checking":
      return { line: "Network: looking for it…", short: "looking for it", chip: "checking", tone: "busy" };
    case "idle":
      return { line: "Network: not loaded.", short: "not loaded", chip: "not loaded", tone: "off" };
    case "unavailable":
      if (state.reason === "bad-card" || state.reason === "unknown-model" || state.reason === "unsupported-size") {
        return { line: `Network: not usable. ${state.message ?? ""}`.trim(), short: "not usable", chip: "not usable", tone: "bad" };
      }
      return state.reason === "not-offered"
        ? { line: `Network: not offered at ${size} × ${size}. Strong and Max are off; Beginner and Normal play.`, short: "not offered at this size", chip: "not offered here", tone: "off" }
        : { line: "Network: none is published yet. Strong and Max are off; Beginner and Normal play.", short: "none published", chip: "not published", tone: "off" };
    case "downloading": {
      const percent = state.total === null ? null : Math.floor((state.loaded / state.total) * 100);
      const done = state.total === null ? `${megabytes(state.loaded)} MB` : `${megabytes(state.loaded)} of ${megabytes(state.total)} MB`;
      return { line: `Network: downloading, ${done}.`, short: percent === null ? `downloading, ${done}` : `downloading, ${percent}%`, chip: percent === null ? "downloading" : `downloading ${percent}%`, tone: "busy" };
    }
    case "ready":
      return {
        line: `Network: ready (${state.model}${state.fromCache ? ", loaded from this device" : ""}).${state.saved ? "" : " It could not be saved for offline use."}`,
        short: "ready",
        chip: "ready",
        tone: "ok",
      };
    case "failed":
      return { line: `Network: failed. ${state.message}`, short: "the download failed; choose Retry download", chip: "failed", tone: "bad" };
  }
}
