import { type ModelEntry, type ModelIndex, parseIndex } from "./index";

/** What the model code needs from the browser, so tests can stand in for it. */
export interface ModelEnv {
  readonly fetch: typeof fetch;
  /** Cache Storage; undefined where the browser has none (it is then simply not used). */
  readonly caches: CacheStorage | undefined;
  /** The site's base URL, ending in "/", for example `https://example.org/quoridor/`. */
  readonly base: string;
  /** Milliseconds without a byte after which a download is given up on; 30 seconds if unset. */
  readonly stallMs?: number;
}

export type FailureKind = "network" | "http" | "hash" | "address" | "stalled" | "cancelled" | "start";

/** A model that could not be loaded; `message` is fit to show to a person and `kind` says why. */
export class ModelError extends Error {
  constructor(
    readonly kind: FailureKind,
    message: string,
  ) {
    super(message);
  }
}

export interface Progress {
  readonly loaded: number;
  /** Bytes expected, or null when the server did not say or the body is compressed in transit (its length is then not the model's). */
  readonly total: number | null;
}

export interface LoadedModel {
  readonly bytes: ArrayBuffer;
  /** Whether the bytes came from Cache Storage. */
  readonly fromCache: boolean;
  /** False when the download could not be saved for offline use (no storage, or the quota was full). */
  readonly saved: boolean;
}

const CACHE_NAME = "quoridor-models";
const INDEX_PATH = "models/index.json";
const STALL_MS = 30_000;

/** The address of a site file, which must stay under the site's own `models/` folder. */
function siteUrl(env: ModelEnv, path: string): URL {
  const base = new URL(env.base);
  const url = new URL(path, base);
  if (url.origin !== base.origin || !url.pathname.startsWith(`${base.pathname}models/`)) {
    throw new ModelError("address", `The model address ${path} is not on this site.`);
  }
  return url;
}

/** Hex SHA-256 of `bytes` (Web Crypto). */
export async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function openCache(env: ModelEnv): Promise<Cache | null> {
  try {
    return (await env.caches?.open(CACHE_NAME)) ?? null;
  } catch {
    return null;
  }
}

/**
 * The model index. Null means nothing is published: the server says the file
 * is not there (404), or what it sends is not an index. A good index is
 * remembered, so a visit that cannot reach the server still knows which model
 * to use. Throws a `ModelError` when the server cannot be reached or answers
 * with an error and nothing is remembered, so the page can offer a retry.
 */
export async function loadIndex(env: ModelEnv): Promise<ModelIndex | null> {
  const url = siteUrl(env, INDEX_PATH);
  const cache = await openCache(env);
  let text: string;
  try {
    const response = await env.fetch(url, { credentials: "omit", mode: "same-origin", cache: "no-cache" });
    if (response.status === 404) return null;
    if (!response.ok) throw new ModelError("http", `The network could not be looked up (the server answered ${response.status}).`);
    text = await response.text();
  } catch (error) {
    try {
      const remembered = await cache?.match(url);
      if (remembered) return parseIndex(await remembered.json());
    } catch {
      // A remembered copy that cannot be read is as good as none.
    }
    throw error instanceof ModelError ? error : new ModelError("network", "The network could not be looked up. Check the connection and retry.");
  }
  let index: ModelIndex;
  try {
    index = parseIndex(JSON.parse(text));
  } catch {
    return null;
  }
  await cache?.put(url, new Response(text)).catch(() => undefined);
  return index;
}

/** Reads a response body, reporting progress; a connection that drops part-way throws. */
async function readBody(response: Response, onProgress: (progress: Progress) => void, touch: () => void): Promise<ArrayBuffer> {
  const encoding = response.headers.get("content-encoding");
  const length = Number(response.headers.get("content-length"));
  // With a content encoding the length is that of the compressed body, which is not what is counted here.
  const total = (!encoding || encoding === "identity") && Number.isFinite(length) && length > 0 ? length : null;
  if (!response.body) throw new ModelError("network", "The download has no body.");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    let chunk: ReadableStreamReadResult<Uint8Array>;
    try {
      chunk = await reader.read();
    } catch {
      throw new ModelError("network", "The download was interrupted. Check the connection and retry.");
    }
    if (chunk.done) break;
    touch();
    chunks.push(chunk.value);
    loaded += chunk.value.length;
    // Outside the read's try: an error in the callback is not a network error.
    onProgress({ loaded: total === null ? loaded : Math.min(loaded, total), total });
  }
  if (total !== null && loaded !== total) throw new ModelError("network", "The download did not have the expected size. Check the connection and retry.");
  const bytes = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes.buffer;
}

/**
 * Returns the model's bytes, checked against `entry.sha256`.
 *
 * A copy in Cache Storage under this id and hash is used first, and checked
 * again; one that is unreadable or fails the check is deleted. Otherwise the
 * model is fetched from this site only, checked, and saved. A download that
 * does not match its checksum is refused and never saved. Other copies of the
 * same model (another hash) are removed after a successful save. A download
 * that receives nothing for `stallMs`, or whose `signal` aborts, fails.
 */
export async function loadModel(env: ModelEnv, entry: ModelEntry, onProgress: (progress: Progress) => void, signal?: AbortSignal): Promise<LoadedModel> {
  const url = siteUrl(env, entry.path);
  const key = new URL(url);
  key.searchParams.set("sha256", entry.sha256);
  const cache = await openCache(env);

  try {
    const remembered = await cache?.match(key);
    if (remembered) {
      const bytes = await remembered.arrayBuffer();
      if ((await sha256Hex(bytes)) === entry.sha256) return { bytes, fromCache: true, saved: true };
    }
  } catch {
    // Unreadable: fall through to the network.
  }
  await cache?.delete(key).catch(() => undefined);

  const bytes = await download(env, url, entry, onProgress, signal);

  let saved = false;
  if (cache) {
    try {
      await cache.put(key, new Response(bytes));
      saved = true;
      for (const other of await cache.keys()) {
        const same = new URL(other.url);
        if (other.url !== key.href && same.origin === url.origin && same.pathname === url.pathname) await cache.delete(other);
      }
    } catch {
      // A full quota or a private window: the model still works for this visit.
    }
  }
  return { bytes, fromCache: false, saved };
}

/** Fetches and checks the model once, with the stall watchdog and the caller's abort signal. */
async function download(env: ModelEnv, url: URL, entry: ModelEntry, onProgress: (progress: Progress) => void, signal?: AbortSignal): Promise<ArrayBuffer> {
  const abort = new AbortController();
  let reason: "stalled" | "cancelled" | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const touch = (): void => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      reason = "stalled";
      abort.abort();
    }, env.stallMs ?? STALL_MS);
  };
  const cancel = (): void => {
    reason = "cancelled";
    abort.abort();
  };
  signal?.addEventListener("abort", cancel, { once: true });
  if (signal?.aborted) cancel();
  touch();
  try {
    let response: Response;
    try {
      response = await env.fetch(url, { credentials: "omit", mode: "same-origin", cache: "no-cache", signal: abort.signal });
    } catch {
      throw new ModelError("network", "The model could not be downloaded. Check the connection and retry.");
    }
    if (!response.ok) throw new ModelError("http", `The model could not be downloaded (the server answered ${response.status}).`);
    const bytes = await readBody(response, onProgress, touch);
    if ((await sha256Hex(bytes)) !== entry.sha256) {
      throw new ModelError("hash", "The downloaded model does not match its published checksum, so it was not used or saved.");
    }
    return bytes;
  } catch (error) {
    if (reason === "stalled") throw new ModelError("stalled", `The download stalled (nothing arrived for ${Math.round((env.stallMs ?? STALL_MS) / 1000)} seconds). Check the connection and retry.`);
    if (reason === "cancelled") throw new ModelError("cancelled", "The download was cancelled.");
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", cancel);
  }
}
