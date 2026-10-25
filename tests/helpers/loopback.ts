import type { Request, Response } from "../../src/ai/protocol";
import type { WorkerLike } from "../../src/ai/searchClient";

/** A worker stand-in wired straight to a service handler; `fail` makes it report a crash. */
export class LoopbackWorker implements WorkerLike {
  onmessage: ((event: MessageEvent<Response>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: ((event: MessageEvent) => void) | null = null;
  terminated = false;
  readonly received: Request[] = [];
  private readonly handle: (request: Request) => void;

  constructor(makeHandler: (post: (response: Response) => void) => (request: Request) => void) {
    this.handle = makeHandler((response) => queueMicrotask(() => this.onmessage?.(new MessageEvent("message", { data: response }))));
  }

  postMessage(message: Request): void {
    const copy = structuredClone(message);
    this.received.push(copy);
    if (!this.terminated) this.handle(copy);
  }

  /** Reports an error the way a worker whose script threw or failed to load does. */
  fail(message: string): void {
    this.onerror?.({ message } as ErrorEvent);
  }

  terminate(): void {
    this.terminated = true;
  }
}
