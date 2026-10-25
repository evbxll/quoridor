/** A least-recently-used cache: at most `capacity` entries, the oldest-used dropped first. */
export class LruCache<V> {
  private readonly entries = new Map<string, V>();

  constructor(readonly capacity: number) {
    if (!Number.isInteger(capacity) || capacity < 1) throw new Error("capacity must be a whole number of at least 1");
  }

  get size(): number {
    return this.entries.size;
  }

  /** The value for `key`, which then counts as the most recently used; undefined if absent. */
  get(key: string): V | undefined {
    const value = this.entries.get(key);
    if (value !== undefined) {
      // A Map iterates in insertion order, so re-inserting moves the key to the newest end.
      this.entries.delete(key);
      this.entries.set(key, value);
    }
    return value;
  }

  set(key: string, value: V): void {
    this.entries.delete(key);
    this.entries.set(key, value);
    if (this.entries.size > this.capacity) {
      this.entries.delete(this.entries.keys().next().value as string);
    }
  }
}
