/** Upper bound on search threads (design doc section 9.2). */
const MAX_THREADS = 4;

/**
 * Chooses how many threads the inference runtime may use.
 *
 * Multithreaded WebAssembly needs `SharedArrayBuffer`, which the browser only
 * provides when the page is cross-origin isolated. Without isolation the only
 * correct choice is one thread.
 *
 * @param isolated Whether `crossOriginIsolated` is true.
 * @param hardwareConcurrency The reported logical core count.
 * @returns A thread count of at least 1.
 */
export function searchThreads(isolated: boolean, hardwareConcurrency: number): number {
  if (!isolated) {
    return 1;
  }
  return Math.max(1, Math.min(MAX_THREADS, hardwareConcurrency - 1));
}

/**
 * Describes the isolation state for the placeholder page.
 *
 * @param isolated Whether `crossOriginIsolated` is true.
 * @param threads The thread count from {@link searchThreads}.
 * @returns A one-line status message.
 */
export function describeIsolation(isolated: boolean, threads: number): string {
  return isolated
    ? `Cross-origin isolated: yes (${threads} search threads).`
    : `Cross-origin isolated: no (${threads} search thread).`;
}
