import { createHash } from "node:crypto";
import type { ModelEnv } from "../../src/model/store";

/** An in-memory Cache Storage: enough of `caches.open(...)` for the model store. */
export class FakeCaches {
  readonly stored = new Map<string, Uint8Array>();
  /** Makes every `put` fail, as a full quota does. */
  quotaFull = false;
  /** Makes every saved copy fail to read back. */
  unreadable = false;

  async open(): Promise<Cache> {
    const stored = this.stored;
    const owner = this;
    return {
      async match(request: RequestInfo | URL) {
        const bytes = stored.get(new Request(request as URL).url);
        if (!bytes) return undefined;
        if (owner.unreadable) {
          const broken = new Response(bytes.slice());
          broken.arrayBuffer = () => Promise.reject(new Error("unreadable"));
          return broken;
        }
        return new Response(bytes.slice());
      },
      async put(request: RequestInfo | URL, response: Response) {
        if (owner.quotaFull) throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
        stored.set(new Request(request as URL).url, new Uint8Array(await response.arrayBuffer()));
      },
      async delete(request: RequestInfo | URL) {
        return stored.delete(new Request(request as URL).url);
      },
      async keys() {
        return [...stored.keys()].map((url) => new Request(url));
      },
    } as unknown as Cache;
  }
}

export const BASE = "https://site.example/quoridor/";

export function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * A response whose body arrives in `chunks` and then ends. It fails when `breakAfter` chunks have been
 * sent, goes silent after `stallAfter` chunks until `signal` aborts, and carries `contentEncoding` if given.
 */
export function streamed(
  bytes: Uint8Array,
  chunks: number,
  options: { breakAfter?: number; stallAfter?: number; contentLength?: number | null; contentEncoding?: string; signal?: AbortSignal } = {},
): Response {
  const size = Math.ceil(bytes.length / chunks);
  let sent = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (options.stallAfter !== undefined && sent >= options.stallAfter) {
        return new Promise<void>((resolve) => {
          const fail = (): void => {
            controller.error(new DOMException("aborted", "AbortError"));
            resolve();
          };
          if (options.signal?.aborted) fail();
          else options.signal?.addEventListener("abort", fail);
        });
      }
      if (options.breakAfter !== undefined && sent >= options.breakAfter) {
        controller.error(new Error("connection reset"));
        return;
      }
      const start = sent * size;
      if (start >= bytes.length) controller.close();
      else controller.enqueue(bytes.slice(start, start + size));
      sent++;
    },
  });
  const length = options.contentLength === undefined ? bytes.length : options.contentLength;
  const headers: Record<string, string> = length === null ? {} : { "content-length": String(length) };
  if (options.contentEncoding) headers["content-encoding"] = options.contentEncoding;
  return new Response(body, { headers });
}

/** A fetch that serves `files` by path under the site, 404 for the rest, and records what it was asked. */
export function fakeFetch(files: Record<string, (signal?: AbortSignal) => Response>) {
  const requested: string[] = [];
  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    requested.push(url.href);
    const make = url.origin === new URL(BASE).origin ? files[url.pathname.slice(new URL(BASE).pathname.length)] : undefined;
    return make ? make(init?.signal ?? undefined) : new Response("not found", { status: 404 });
  }) as typeof fetch;
  return { fetch: fetchFn, requested };
}

export function envOf(fetchFn: typeof fetch, caches: FakeCaches | undefined, stallMs?: number): ModelEnv {
  return { fetch: fetchFn, caches: caches as unknown as CacheStorage | undefined, base: BASE, ...(stallMs === undefined ? {} : { stallMs }) };
}
