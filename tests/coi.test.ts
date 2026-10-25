// Tests of cross-origin isolation that need no browser: the vendored service
// worker and its page-side half are run in a vm with stubbed browser globals.
// They show which headers and messages the scripts produce, not that a real
// browser reaches `crossOriginIsolated === true`.

import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

const read = (name: string): string => readFileSync(`public/${name}`, "utf8");

type Listener = (event: unknown) => void;

async function respondThroughWorker(): Promise<Response> {
  const listeners = new Map<string, Listener>();
  const fetchStub = vi.fn(async () => new Response("body", { headers: { "Content-Type": "text/plain" } }));
  runInNewContext(read("coi-serviceworker.js"), {
    self: { addEventListener: (type: string, fn: Listener) => listeners.set(type, fn) },
    fetch: fetchStub,
    Headers,
    Request,
    Response,
    console,
  });
  let responded: Promise<Response> | undefined;
  listeners.get("fetch")?.({
    request: { cache: "default", mode: "same-origin" },
    respondWith: (p: Promise<Response>) => {
      responded = p;
    },
  });
  expect(responded).toBeDefined();
  return responded as Promise<Response>;
}

function runPage(isChrome: boolean) {
  const postMessage = vi.fn();
  const register = vi.fn(() => new Promise(() => undefined));
  const window: Record<string, unknown> = {
    crossOriginIsolated: false,
    isSecureContext: true,
    location: { reload: vi.fn() },
    document: { currentScript: { src: "https://example.test/quoridor/coi-serviceworker.js" } },
    ...(isChrome ? { chrome: {} } : {}),
  };
  const navigator = { serviceWorker: { controller: { postMessage }, register } };
  const context = { window, navigator, console };
  runInNewContext(read("coi-config.js"), context);
  runInNewContext(read("coi-serviceworker.js"), context);
  return { postMessage, register };
}

describe("coi-serviceworker", () => {
  it("adds the isolation headers to every response", async () => {
    const response = await respondThroughWorker();
    expect(response.headers.get("Cross-Origin-Opener-Policy")).toBe("same-origin");
    expect(response.headers.get("Cross-Origin-Embedder-Policy")).toBe("require-corp");
    expect(response.headers.get("Cross-Origin-Resource-Policy")).toBe("cross-origin");
    expect(await response.text()).toBe("body");
  });

  it.each([true, false])("asks for require-corp in every browser (chrome: %s)", (isChrome) => {
    const { postMessage, register } = runPage(isChrome);
    expect(postMessage).toHaveBeenCalledWith({ type: "coepCredentialless", value: false });
    expect(register).toHaveBeenCalledWith("https://example.test/quoridor/coi-serviceworker.js");
  });

  it("is loaded by the page after its config", () => {
    const html = readFileSync("index.html", "utf8");
    const config = html.indexOf("coi-config.js");
    const worker = html.indexOf("coi-serviceworker.js");
    expect(config).toBeGreaterThan(-1);
    expect(worker).toBeGreaterThan(config);
  });
});
