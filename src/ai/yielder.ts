/** Lets queued messages run between slices of a long computation. */
export interface Yielder {
  /** Resolves on a later task, after the messages already queued have been handled. */
  next(): Promise<void>;
  /** Releases the channel; `next` must not be called afterwards. */
  close(): void;
}

/**
 * A yield point built on a `MessageChannel`. A promise that is already
 * resolved would not let messages run, and `setTimeout(0)` waits several
 * milliseconds for the timer to fire, which for a search that yields every
 * few milliseconds is a large share of its time. A message to oneself runs as
 * soon as the messages ahead of it have, with no timer delay.
 */
export function createYielder(): Yielder {
  const { port1, port2 } = new MessageChannel();
  const waiting: Array<() => void> = [];
  port1.onmessage = () => waiting.shift()?.();
  return {
    next: () =>
      new Promise((resolve) => {
        waiting.push(resolve);
        port2.postMessage(null);
      }),
    close: () => {
      port1.close();
      port2.close();
    },
  };
}
