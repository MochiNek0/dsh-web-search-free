/**
 * A small in-memory TTL cache with least-recently-used eviction.
 *
 * Models repeat themselves — the same query rephrased into the identical
 * string a few turns later, the same URL fetched again to re-read a section —
 * and on a free tier every repeat costs quota. This keeps recent answers for
 * a few minutes. It lives in the plugin's process memory only: nothing is
 * written to disk, and a restart or plugin reload starts it empty.
 */
export class TtlCache<V> {
  /** Map iteration order is insertion order, so the first key is the least recently used. */
  private readonly entries = new Map<string, { value: V; expires: number }>()

  constructor(private readonly capacity: number) {}

  /** The cached value, or `undefined` when absent or expired. A hit refreshes its recency. */
  get(key: string, now = Date.now()): V | undefined {
    const entry = this.entries.get(key)
    if (!entry) return undefined
    this.entries.delete(key)
    if (entry.expires <= now) return undefined
    this.entries.set(key, entry)
    return entry.value
  }

  /** Store `value` for `ttlMs`; a non-positive TTL stores nothing. */
  set(key: string, value: V, ttlMs: number, now = Date.now()): void {
    if (!(ttlMs > 0)) return
    this.entries.delete(key)
    this.entries.set(key, { value, expires: now + ttlMs })
    while (this.entries.size > this.capacity) {
      this.entries.delete(this.entries.keys().next().value as string)
    }
  }
}
