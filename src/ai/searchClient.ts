import type { EngineSpec, Request, Response, SearchResponse } from "./protocol";

/** The part of `Worker` the client uses, so tests can stand in for it. */
export interface WorkerLike {
  postMessage(message: Request): void;
  onmessage: ((event: MessageEvent<Response>) => void) | null;
  /** The worker's script failed to load or threw. */
  onerror: ((event: ErrorEvent) => void) | null;
  /** The worker sent something that could not be read. */
  onmessageerror: ((event: MessageEvent) => void) | null;
  terminate(): void;
}

export type SearchParams = Omit<Extract<Request, { type: "search" }>, "type" | "id">;

interface Pending {
  readonly resolve: (response: Response) => void;
  readonly reject: (error: Error) => void;
}

/**
 * The page's side of the worker protocol: requests become promises. A search
 * that is cancelled, or replaced by a newer request, resolves to null.
 *
 * The worker is started on the first request. If it fails to load or crashes,
 * every pending request rejects, the worker is terminated, and the next
 * request starts a new one (configured again with the last heuristic engine).
 */
export class SearchClient {
  private nextId = 1;
  private worker: WorkerLike | null = null;
  private readonly pending = new Map<number, Pending>();
  private currentSearch: number | null = null;
  private heuristic: EngineSpec | null = null;

  constructor(private readonly createWorker: () => WorkerLike) {}

  /** Chooses the evaluator the worker searches with; any search in flight is cancelled. */
  async configure(engine: EngineSpec): Promise<void> {
    this.start();
    this.heuristic = engine.kind === "heuristic" ? engine : null;
    const response = await this.request({ type: "configure", id: this.nextId++, engine });
    if (response.type === "error") throw new Error(response.message);
  }

  /** Searches the position after `params.moves`; null if the search was cancelled or superseded. */
  async search(params: SearchParams): Promise<SearchResponse | null> {
    const id = this.nextId++;
    this.currentSearch = id;
    try {
      const response = await this.request({ type: "search", id, ...params });
      if (response.type === "error") throw new Error(response.message);
      return response.type === "result" ? response : null;
    } finally {
      if (this.currentSearch === id) this.currentSearch = null;
    }
  }

  /** Cancels the search in flight, if any; its promise resolves to null. */
  cancel(): void {
    if (this.worker && this.currentSearch !== null) this.worker.postMessage({ type: "cancel", id: this.currentSearch });
  }

  private start(): WorkerLike {
    if (this.worker) return this.worker;
    const worker = this.createWorker();
    worker.onmessage = ({ data }) => {
      const waiting = this.pending.get(data.id);
      this.pending.delete(data.id);
      waiting?.resolve(data);
    };
    worker.onerror = (event) => this.fail(worker, event.message || "The search worker failed to start");
    worker.onmessageerror = () => this.fail(worker, "The search worker sent a message that could not be read");
    this.worker = worker;
    // The answer to this replay has no waiting caller and is dropped.
    if (this.heuristic) worker.postMessage({ type: "configure", id: this.nextId++, engine: this.heuristic });
    return worker;
  }

  /** Drops a worker that failed and rejects everything waiting for it. */
  private fail(worker: WorkerLike, message: string): void {
    if (this.worker !== worker) return;
    this.worker = null;
    worker.terminate();
    const waiting = [...this.pending.values()];
    this.pending.clear();
    this.currentSearch = null;
    for (const { reject } of waiting) reject(new Error(message));
  }

  private request(request: Request): Promise<Response> {
    return new Promise((resolve, reject) => {
      const worker = this.start();
      this.pending.set(request.id, { resolve, reject });
      worker.postMessage(request);
    });
  }
}
